
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { createChatlyId, ensureChatlyId } = require("../utils/chatlyId");
const { sendVerificationEmail } = require("../utils/email");

// =========================
// Constants
// =========================

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const PASSWORD_MIN_LENGTH = 6;
const VERIFICATION_TOKEN_EXPIRY_MS = 60 * 60 * 1000;
const RESEND_COOLDOWN_MS = 60 * 1000;

// =========================
// Helpers
// =========================

function createToken(id) {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured.");
  }

  return jwt.sign({ id: String(id) }, process.env.JWT_SECRET, {
    expiresIn: "7d",
  });
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

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeUsername(value) {
  return String(value || "")
    .trim()
    .replace(/^@+/, "")
    .toLowerCase();
}

function createVerificationToken() {
  const token = crypto.randomBytes(32).toString("hex");

  return {
    token,
    tokenHash: crypto.createHash("sha256").update(token).digest("hex"),
  };
}

function handleServerError(res, error, message) {
  // Full error details go to server logs, not to the client.
  console.error(message, error);

  return res.status(500).json({
    message,
  });
}

// =========================
// Email Verification Helper
// =========================

async function issueVerificationEmail(user) {
  const { token, tokenHash } = createVerificationToken();

  user.emailVerificationToken = tokenHash;
  user.emailVerificationExpires = new Date(
    Date.now() + VERIFICATION_TOKEN_EXPIRY_MS
  );
  user.verificationEmailSentAt = new Date();

  await user.save();

  await sendVerificationEmail({
    email: user.email,
    name: user.name,
    token,
  });
}

// =========================
// REGISTER
// =========================

exports.register = async (req, res) => {
  let createdUserId = null;

  try {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    const rawUsername = req.body?.username;
    let username;

    if (!name || !email || !password) {
      return res.status(400).json({
        message: "Name, email, and password are required.",
      });
    }

    if (name.length > 100) {
      return res.status(400).json({
        message: "Name must not exceed 100 characters.",
      });
    }

    if (email.length > 254) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    // Basic email format validation.
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!emailPattern.test(email)) {
      return res.status(400).json({
        message: "Please enter a valid email address.",
      });
    }

    if (password.length < PASSWORD_MIN_LENGTH) {
      return res.status(400).json({
        message: "Password must contain at least 6 characters.",
      });
    }

    if (Buffer.byteLength(password, "utf8") > 72) {
      return res.status(400).json({
        message: "Password is too long.",
      });
    }

    // Optional username validation.
    if (
      rawUsername !== undefined &&
      String(rawUsername).trim() !== ""
    ) {
      username = normalizeUsername(rawUsername);

      if (!USERNAME_PATTERN.test(username)) {
        return res.status(400).json({
          message:
            "Username must be 3-20 characters and contain only lowercase letters, numbers, or underscores.",
        });
      }

      const existingUsername = await User.exists({ username });

      if (existingUsername) {
        return res.status(409).json({
          message: "That username is already taken.",
        });
      }
    }

    // Check duplicate email.
    const existingUser = await User.findOne({ email });

    if (existingUser) {
      return res.status(409).json({
        message: "An account already uses this email.",
      });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const chatlyId = await createChatlyId();

    const userData = {
      name,
      email,
      password: hashedPassword,
      chatlyId,
      emailVerified: false,
    };

    if (username) {
      userData.username = username;
    }

    const user = await User.create(userData);
    createdUserId = user._id;

    try {
      await issueVerificationEmail(user);
    } catch (emailError) {
      console.error("Verification email sending failed:", emailError);

      // Do not leave an unusable unverified account if email sending fails.
      await User.deleteOne({ _id: user._id });

      return res.status(503).json({
        message:
          "Could not send a verification email. Please check your email settings and try again later.",
      });
    }

    return res.status(201).json({
      message: "We sent a verification link to your email address.",
      email: user.email,
    });
  } catch (error) {
    console.error("Register error:", error);

    // Handle MongoDB duplicate-key errors safely.
    if (error?.code === 11000) {
      const duplicateField = Object.keys(error.keyPattern || {})[0];

      if (duplicateField === "username") {
        return res.status(409).json({
          message: "That username is already taken.",
        });
      }

      if (duplicateField === "email") {
        return res.status(409).json({
          message: "An account already uses this email.",
        });
      }

      return res.status(409).json({
        message: "This information is already in use.",
      });
    }

    return handleServerError(
      res,
      error,
      "Could not create your account."
    );
  }
};

// =========================
// LOGIN
// =========================

exports.login = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required.",
      });
    }

    const user = await User.findOne({ email }).select("+password");

    if (!user || !user.password) {
      return res.status(401).json({
        message: "Incorrect email or password.",
      });
    }

    const passwordMatches = await bcrypt.compare(
      password,
      user.password
    );

    if (!passwordMatches) {
      return res.status(401).json({
        message: "Incorrect email or password.",
      });
    }

    if (!user.emailVerified) {
      return res.status(403).json({
        code: "EMAIL_NOT_VERIFIED",
        message: "Verify your email address before signing in.",
      });
    }

    await ensureChatlyId(user);

    const token = createToken(user._id);

    return res.status(200).json({
      message: "Signed in successfully.",
      token,
      user: publicUser(user),
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Could not sign you in."
    );
  }
};

// =========================
// VERIFY EMAIL
// =========================

exports.verifyEmail = async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();

    if (!token) {
      return res.status(400).json({
        message: "Verification link is missing.",
      });
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const user = await User.findOne({
      emailVerificationToken: tokenHash,
      emailVerificationExpires: { $gt: new Date() },
    }).select(
      "+emailVerificationToken +emailVerificationExpires"
    );

    if (!user) {
      return res.status(400).json({
        message:
          "This verification link is invalid or has expired. Please request a new one.",
      });
    }

    user.emailVerified = true;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpires = undefined;

    await user.save();

    return res.status(200).json({
      message: "Your email has been verified. You can now sign in.",
    });
  } catch (error) {
    return handleServerError(
      res,
      error,
      "Could not verify your email."
    );
  }
};

// =========================
// RESEND VERIFICATION EMAIL
// =========================

exports.resendVerification = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);

    if (!email) {
      return res.status(400).json({
        message: "Email is required.",
      });
    }

    const user = await User.findOne({ email }).select(
      "+verificationEmailSentAt"
    );

    // Avoid revealing whether an account exists.
    if (!user) {
      return res.status(200).json({
        message:
          "If this account exists and needs verification, an email will be sent.",
      });
    }

    if (user.emailVerified) {
      return res.status(400).json({
        message:
          "This email address is already verified. Please sign in.",
      });
    }

    if (
      user.verificationEmailSentAt &&
      Date.now() - new Date(user.verificationEmailSentAt).getTime() <
        RESEND_COOLDOWN_MS
    ) {
      return res.status(429).json({
        message:
          "Please wait one minute before requesting another email.",
      });
    }

    await issueVerificationEmail(user);

    return res.status(200).json({
      message: "A new verification link has been sent.",
    });
  } catch (error) {
    console.error("Resend verification error:", error);

    return res.status(503).json({
      message:
        "Could not send a verification email. Please try again later.",
    });
  }
};
