const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const OAuthCode = require("../models/OAuthCode");
const User = require("../models/User");
const { createChatlyId, ensureChatlyId } = require("../utils/chatlyId");

const STATE_COOKIE_MAX_AGE = 10 * 60 * 1000;
const CODE_TTL = 2 * 60 * 1000;
const FACEBOOK_GRAPH_VERSION = "v22.0";

function getClientUrl() {
  return (process.env.CLIENT_URL || "http://localhost:5173").replace(/\/+$/, "");
}

function getProviderConfig(provider) {
  const prefix = provider === "google" ? "GOOGLE" : "FACEBOOK";
  const vercelHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  const apiBase = (
    process.env.API_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL ||
    (vercelHost ? `https://${vercelHost}` : `http://localhost:${Number(process.env.PORT) || 5000}`)
  ).replace(/\/+$/, "");
  return {
    clientId: process.env[`${prefix}_CLIENT_ID`],
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`],
    callbackUrl: process.env[`${prefix}_CALLBACK_URL`] || `${apiBase}/api/auth/${provider}/callback`,
  };
}

function stateCookieName(provider) {
  return `chatly_oauth_${provider}_state`;
}

function cookieOptions(provider, secure) {
  return {
    httpOnly: true,
    secure,
    sameSite: "lax",
    maxAge: STATE_COOKIE_MAX_AGE,
    path: `/api/auth/${provider}`,
  };
}

function redirectError(res, code) {
  return res.redirect(`${getClientUrl()}/oauth/callback?error=${encodeURIComponent(code)}`);
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const result = await response.json();
  if (!response.ok) {
    throw new Error(`OAuth provider returned HTTP ${response.status}.`);
  }
  return result;
}

function readCookie(req, name) {
  const cookieHeader = req.headers.cookie || "";
  const entry = cookieHeader.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function safeStateMatch(expected, received) {
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && crypto.timingSafeEqual(expectedBytes, receivedBytes);
}

async function startProviderAuth(req, res, provider) {
  const { clientId, clientSecret, callbackUrl } = getProviderConfig(provider);
  if (!clientId || !clientSecret) {
    return redirectError(res, `${provider}_not_configured`);
  }

  const state = crypto.randomBytes(32).toString("hex");
  const secure = callbackUrl.startsWith("https://");
  res.cookie(stateCookieName(provider), state, cookieOptions(provider, secure));

  const authUrl = provider === "google"
    ? new URL("https://accounts.google.com/o/oauth2/v2/auth")
    : new URL(`https://www.facebook.com/${FACEBOOK_GRAPH_VERSION}/dialog/oauth`);
  authUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: provider === "google" ? "openid email profile" : "email,public_profile",
    state,
    ...(provider === "google" ? { prompt: "select_account" } : {}),
  }).toString();
  return res.redirect(authUrl.toString());
}

function startGoogle(req, res) {
  return startProviderAuth(req, res, "google");
}

function startFacebook(req, res) {
  return startProviderAuth(req, res, "facebook");
}

async function exchangeGoogleCode(code, callbackUrl, clientId, clientSecret) {
  const token = await requestJson("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: callbackUrl,
      grant_type: "authorization_code",
    }),
  });
  const profile = await requestJson("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  if (!profile.sub || !profile.email || profile.email_verified !== true) {
    throw new Error("Google did not return a verified email.");
  }
  return {
    subject: String(profile.sub),
    email: String(profile.email).trim().toLowerCase(),
    name: String(profile.name || profile.given_name || profile.email).trim().slice(0, 80),
    avatar: String(profile.picture || ""),
    emailVerified: true,
  };
}

async function exchangeFacebookCode(code, callbackUrl, clientId, clientSecret) {
  const tokenUrl = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/oauth/access_token`);
  tokenUrl.search = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: callbackUrl,
    code,
  }).toString();
  const token = await requestJson(tokenUrl, { method: "GET" });
  const profileUrl = new URL(`https://graph.facebook.com/${FACEBOOK_GRAPH_VERSION}/me`);
  profileUrl.search = new URLSearchParams({
    fields: "id,name,email,picture.type(large)",
    access_token: token.access_token,
  }).toString();
  const profile = await requestJson(profileUrl, { method: "GET" });
  if (!profile.id || !profile.email) {
    throw new Error("Facebook did not provide an email address.");
  }
  return {
    subject: String(profile.id),
    email: String(profile.email).trim().toLowerCase(),
    name: String(profile.name || profile.email).trim().slice(0, 80),
    avatar: String(profile.picture?.data?.url || ""),
    emailVerified: false,
  };
}

async function usernameForEmail(email) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 14) || "chatlyuser";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const username = `${base}_${crypto.randomBytes(2).toString("hex")}`.slice(0, 20);
    if (!(await User.exists({ username }))) return username;
  }
  throw new Error("Could not create a unique username for this account.");
}

async function findOrCreateProviderUser(provider, profile) {
  const providerField = provider === "google" ? "googleId" : "facebookId";
  let user = await User.findOne({ [providerField]: profile.subject });
  if (user) {
    if (user.email !== profile.email && profile.emailVerified) {
      const conflictingUser = await User.findOne({ email: profile.email });
      if (conflictingUser && !conflictingUser._id.equals(user._id)) {
        throw new Error("This provider email is already used by another account.");
      }
      user.email = profile.email;
    }
    if (!user.avatar && profile.avatar) user.avatar = profile.avatar;
    await ensureChatlyId(user);
    return user;
  }

  user = await User.findOne({ email: profile.email });
  if (user) {
    if (provider !== "google" || !profile.emailVerified) {
      throw new Error("An account already uses this email. Sign in with that account first.");
    }
    if (user.googleId && user.googleId !== profile.subject) {
      throw new Error("This email is already linked to another Google account.");
    }
    user.googleId = profile.subject;
    if (!user.avatar && profile.avatar) user.avatar = profile.avatar;
    await user.save();
    await ensureChatlyId(user);
    return user;
  }

  return User.create({
    name: profile.name,
    email: profile.email,
    username: await usernameForEmail(profile.email),
    chatlyId: await createChatlyId(),
    [providerField]: profile.subject,
    avatar: profile.avatar,
  });
}

async function providerCallback(req, res, provider) {
  const config = getProviderConfig(provider);
  const cookieName = stateCookieName(provider);
  const options = cookieOptions(provider, config.callbackUrl.startsWith("https://"));
  const expectedState = readCookie(req, cookieName);
  const receivedState = String(req.query.state || "");
  res.clearCookie(cookieName, options);

  if (req.query.error) return redirectError(res, "oauth_cancelled");
  if (!safeStateMatch(expectedState, receivedState)) return redirectError(res, "oauth_state_invalid");
  if (!config.clientId || !config.clientSecret || !req.query.code) return redirectError(res, `${provider}_auth_failed`);

  try {
    const profile = provider === "google"
      ? await exchangeGoogleCode(String(req.query.code), config.callbackUrl, config.clientId, config.clientSecret)
      : await exchangeFacebookCode(String(req.query.code), config.callbackUrl, config.clientId, config.clientSecret);
    const user = await findOrCreateProviderUser(provider, profile);
    const rawCode = crypto.randomBytes(32).toString("hex");
    const codeHash = crypto.createHash("sha256").update(rawCode).digest("hex");
    await OAuthCode.create({ codeHash, user: user._id, expiresAt: new Date(Date.now() + CODE_TTL) });
    return res.redirect(`${getClientUrl()}/oauth/callback?code=${encodeURIComponent(rawCode)}`);
  } catch (error) {
    console.error(`${provider} OAuth callback failed:`, error.message);
    const code = error.message.includes("already uses this email") || error.message.includes("already linked")
      ? "oauth_account_exists"
      : provider === "facebook" && error.message.includes("email address")
        ? "facebook_email_required"
        : `${provider}_auth_failed`;
    return redirectError(res, code);
  }
}

function googleCallback(req, res) {
  return providerCallback(req, res, "google");
}

function facebookCallback(req, res) {
  return providerCallback(req, res, "facebook");
}

async function exchangeOAuthCode(req, res) {
  try {
    const code = String(req.body?.code || "");
    if (!/^[a-f0-9]{64}$/.test(code)) {
      return res.status(400).json({ message: "The sign-in session is invalid or expired." });
    }
    const codeHash = crypto.createHash("sha256").update(code).digest("hex");
    const grant = await OAuthCode.findOneAndDelete({
      codeHash,
      expiresAt: { $gt: new Date() },
    });
    if (!grant) return res.status(400).json({ message: "The sign-in session is invalid or expired." });
    const user = await User.findById(grant.user).select("-password");
    if (!user) return res.status(401).json({ message: "This account is no longer available." });
    await ensureChatlyId(user);
    const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: "7d" });
    return res.json({ token, user: {
      _id: user._id,
      name: user.name,
      email: user.email,
      chatlyId: user.chatlyId,
      username: user.username,
      avatar: user.avatar,
      bio: user.bio,
      status: user.status,
      isOnline: user.isOnline,
      lastSeen: user.lastSeen,
      showActiveStatus: user.showActiveStatus,
    } });
  } catch (error) {
    console.error("OAuth code exchange failed:", error.message);
    return res.status(500).json({ message: "Could not complete sign-in." });
  }
}

module.exports = {
  exchangeOAuthCode,
  facebookCallback,
  googleCallback,
  startFacebook,
  startGoogle,
};
