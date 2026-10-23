const crypto = require("crypto");
const User = require("../models/User");

async function createChatlyId() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const candidate = `CLY-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const existing = await User.exists({ chatlyId: candidate });
    if (!existing) return candidate;
  }

  throw new Error("Could not create a unique Chatly ID.");
}

async function ensureChatlyId(user) {
  if (user.chatlyId) return user;
  user.chatlyId = await createChatlyId();
  await user.save();
  return user;
}

module.exports = { createChatlyId, ensureChatlyId };
