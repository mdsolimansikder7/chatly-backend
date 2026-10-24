const jwt = require("jsonwebtoken");
const crypto = require("crypto");
const User = require("../models/User");
const { getBetterAuth } = require("../config/betterAuth");
const { createChatlyId, ensureChatlyId } = require("../utils/chatlyId");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function usernameForEmail(email) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 14) || "chatlyuser";
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const username = `${base}_${crypto.randomBytes(2).toString("hex")}`.slice(0, 20);
    if (!(await User.exists({ username }))) return username;
  }
  throw new Error("Could not create a unique username.");
}

exports.exchangeBetterAuthSession = async (req, res) => {
  try {
    const [{ fromNodeHeaders }, auth] = await Promise.all([
      import("better-auth/node"),
      getBetterAuth(),
    ]);
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });
    const email = normalizeEmail(session?.user?.email);
    if (!email || session.user.emailVerified !== true) {
      return res.status(401).json({ message: "A verified Google sign-in is required." });
    }

    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name: String(session.user.name || email).trim().slice(0, 80),
        email,
        username: await usernameForEmail(email),
        chatlyId: await createChatlyId(),
        avatar: String(session.user.image || ""),
      });
    } else {
      await ensureChatlyId(user);
      if (!user.avatar && session.user.image) {
        user.avatar = String(session.user.image);
        await user.save();
      }
    }

    if (!process.env.JWT_SECRET) {
      throw new Error("JWT_SECRET is not configured.");
    }
    const token = jwt.sign({ id: String(user._id) }, process.env.JWT_SECRET, { expiresIn: "7d" });
    return res.json({
      token,
      user: {
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
      },
    });
  } catch (error) {
    console.error("Better Auth session exchange failed:", error.message);
    return res.status(503).json({ message: "Could not complete Google sign-in." });
  }
};
