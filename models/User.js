const mongoose = require("mongoose");

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 80 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    chatlyId: { type: String, unique: true, sparse: true, trim: true, uppercase: true, immutable: true },
    username: {
      type: String,
      unique: true,
      sparse: true,
      lowercase: true,
      trim: true,
      minlength: 3,
      maxlength: 20,
      match: /^[a-z0-9_]+$/,
    },
    password: { type: String, select: false },
    googleId: { type: String, unique: true, sparse: true, select: false },
    facebookId: { type: String, unique: true, sparse: true, select: false },
    avatar: { type: String, default: "" },
    bio: { type: String, default: "Hey, I am using Chatly!", maxlength: 140 },
    status: { type: String, default: "Available", maxlength: 50 },
    isOnline: { type: Boolean, default: false },
    lastSeen: { type: Date, default: Date.now },
    showActiveStatus: { type: Boolean, default: true },
    blocking: [{ type: mongoose.Schema.Types.ObjectId, ref: "User" }],
  },
  { timestamps: true },
);

module.exports = mongoose.model("User", userSchema);
