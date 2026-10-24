
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/User");
const { createChatlyId, ensureChatlyId } = require("../utils/chatlyId");

// =========================
// Constants
// =========================

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;
const PASSWORD_MIN_LENGTH = 6;

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

function handleServerError(res, error, message) {
  // Full error details go to server logs, not to the client.
  console.error(message, error);

  return res.status(500).json({
    message,
  });
}

// =========================
// REGISTER
// =========================

exports.register = async (req, res) => {
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
    };

    if (username) {
      userData.username = username;
    }

    const user = await User.create(userData);

    return res.status(201).json({
      message: "Account created successfully.",
      token: createToken(user._id),
      user: publicUser(user),
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
