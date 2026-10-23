const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { createChatlyId, ensureChatlyId } = require("../utils/chatlyId");
const { sendVerificationEmail } = require("../utils/email");

function createToken(id) {
  return jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: "7d" });
}

function publicUser(user) {
  return {
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
    emailVerified: user.emailVerified,
  };
}

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

async function issueVerificationEmail(user) {
  const token = crypto.randomBytes(32).toString("hex");
  user.emailVerificationToken = crypto.createHash("sha256").update(token).digest("hex");
  user.emailVerificationExpires = new Date(Date.now() + 60 * 60 * 1000);
  user.verificationEmailSentAt = new Date();
  await user.save();
  await sendVerificationEmail({ email: user.email, name: user.name, token });
}

exports.register = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");

    if (!name || !email || !password) {
      return res.status(400).json({ message: "Name, email, and password are required." });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must contain at least 6 characters." });
    }

    let username;
    if (req.body.username !== undefined && String(req.body.username).trim() !== "") {
      username = String(req.body.username).trim().replace(/^@+/, "").toLowerCase();
      if (!USERNAME_PATTERN.test(username)) {
        return res.status(400).json({ message: "Usernames use 3-20 letters, numbers, or underscores." });
      }
      if (await User.exists({ username })) {
        return res.status(409).json({ message: "That username is already taken." });
      }
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(409).json({ message: "An account already uses this email." });

    const hashedPassword = await bcrypt.hash(password, 12);
    const user = await User.create({
      name,
      email,
      password: hashedPassword,
      chatlyId: await createChatlyId(),
      ...(username ? { username } : {}),
    });

    try {
      await issueVerificationEmail(user);
    } catch (emailError) {
      await User.deleteOne({ _id: user._id });
      return res.status(503).json({ message: "Could not send a verification email. Please try again later." });
    }

    return res.status(201).json({
      message: "We sent a verification link to your email address.",
      email: user.email,
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not create your account." });
  }
};

exports.login = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    const password = String(req.body.password || "");
    if (!email || !password) return res.status(400).json({ message: "Email and password are required." });

    const user = await User.findOne({ email }).select("+password");
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ message: "Incorrect email or password." });
    }
    if (!user.emailVerified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email address before signing in.",
      });
    }

    await ensureChatlyId(user);

    return res.json({ token: createToken(user._id), user: publicUser(user) });
  } catch (error) {
    return res.status(500).json({ message: "Could not sign you in." });
  }
};

exports.verifyEmail = async (req, res) => {
  try {
    const token = String(req.body.token || "");
    if (!token) return res.status(400).json({ message: "Verification link is missing." });

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const user = await User.findOne({
      emailVerificationToken: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    }).select("+emailVerificationToken +emailVerificationExpires");
    if (!user) return res.status(400).json({ message: "This verification link is invalid or has expired." });

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;
    await user.save();
    return res.json({ message: "Your email has been verified. You can now sign in." });
  } catch (error) {
    return res.status(500).json({ message: "Could not verify your email." });
  }
};

exports.resendVerification = async (req, res) => {
  try {
    const email = String(req.body.email || "").trim().toLowerCase();
    if (!email) return res.status(400).json({ message: "Email is required." });

    const user = await User.findOne({ email }).select("+verificationEmailSentAt");
    if (!user) return res.json({ message: "If this account exists, a verification email has been sent." });
    if (user.emailVerified) return res.status(400).json({ message: "This email address is already verified. Please sign in." });
    if (user.verificationEmailSentAt && Date.now() - user.verificationEmailSentAt.getTime() < 60 * 1000) {
      return res.status(429).json({ message: "Please wait one minute before requesting another email." });
    }

    await issueVerificationEmail(user);
    return res.json({ message: "A new verification link has been sent." });
  } catch (error) {
    return res.status(503).json({ message: "Could not send a verification email. Please try again later." });
  }
};
