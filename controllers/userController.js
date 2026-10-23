const mongoose = require("mongoose");
const User = require("../models/User");
const FriendRequest = require("../models/FriendRequest");
const Report = require("../models/Report");
const { ensureChatlyId } = require("../utils/chatlyId");

const USERNAME_PATTERN = /^[a-z0-9_]{3,20}$/;

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

exports.getMe = async (req, res) => {
  try {
    await ensureChatlyId(req.user);
    return res.json({ ...publicUser(req.user), blocking: req.user.blocking || [] });
  } catch (error) {
    return res.status(500).json({ message: "Could not load your profile." });
  }
};

exports.updateMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const { name, bio, avatar, status, username, showActiveStatus } = req.body;

    if (name !== undefined) user.name = String(name).trim() || user.name;
    if (bio !== undefined) user.bio = String(bio).slice(0, 140);
    if (avatar !== undefined) user.avatar = String(avatar);
    if (status !== undefined) user.status = String(status).slice(0, 50);
    if (showActiveStatus !== undefined) user.showActiveStatus = Boolean(showActiveStatus);

    if (username !== undefined) {
      const clean = String(username).trim().replace(/^@+/, "").toLowerCase();
      if (clean) {
        if (!USERNAME_PATTERN.test(clean)) {
          return res.status(400).json({ message: "Usernames use 3-20 letters, numbers, or underscores." });
        }
        if (clean !== user.username) {
          const taken = await User.exists({ username: clean, _id: { $ne: user._id } });
          if (taken) return res.status(409).json({ message: "That username is already taken." });
          user.username = clean;
        }
      }
    }

    await user.save();
    return res.json({ ...publicUser(user), blocking: user.blocking || [] });
  } catch (error) {
    return res.status(500).json({ message: "Could not update your profile." });
  }
};

exports.blockUser = async (req, res) => {
  try {
    const targetId = String(req.body.userId || "");
    if (!mongoose.isValidObjectId(targetId) || targetId === req.user._id.toString()) {
      return res.status(400).json({ message: "Choose a valid person to block." });
    }
    if (!(await User.exists({ _id: targetId }))) {
      return res.status(404).json({ message: "That person was not found." });
    }
    await User.updateOne({ _id: req.user._id }, { $addToSet: { blocking: targetId } });
    return res.json({ blocked: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not block this person." });
  }
};

exports.unblockUser = async (req, res) => {
  try {
    const targetId = String(req.body.userId || "");
    if (!mongoose.isValidObjectId(targetId)) {
      return res.status(400).json({ message: "Choose a valid person to unblock." });
    }
    await User.updateOne({ _id: req.user._id }, { $pull: { blocking: targetId } });
    return res.json({ blocked: false });
  } catch (error) {
    return res.status(500).json({ message: "Could not unblock this person." });
  }
};

exports.reportUser = async (req, res) => {
  try {
    const targetId = String(req.body.userId || "");
    if (!mongoose.isValidObjectId(targetId) || targetId === req.user._id.toString()) {
      return res.status(400).json({ message: "Choose a valid person to report." });
    }
    if (!(await User.exists({ _id: targetId }))) {
      return res.status(404).json({ message: "That person was not found." });
    }
    await Report.create({
      reporter: req.user._id,
      reported: targetId,
      conversation: mongoose.isValidObjectId(req.body.conversationId) ? req.body.conversationId : undefined,
      reason: String(req.body.reason || "").slice(0, 500),
    });
    return res.status(201).json({ reported: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not submit your report." });
  }
};

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

exports.searchUsers = async (req, res) => {
  try {
    const keyword = String(req.query.search || "").trim();
    if (!keyword) return res.json([]);

    const pattern = new RegExp(escapeRegex(keyword), "i");
    const me = await User.findById(req.user._id).select("blocking");
    const users = await User.find({
      _id: { $ne: req.user._id, $nin: me?.blocking || [] },
      $or: [{ chatlyId: pattern }, { username: pattern }, { name: pattern }, { email: pattern }],
    })
      .select("name email username chatlyId avatar bio status isOnline lastSeen")
      .limit(20);

    const relationships = await FriendRequest.find({
      $or: [
        { sender: req.user._id, recipient: { $in: users.map((user) => user._id) } },
        { recipient: req.user._id, sender: { $in: users.map((user) => user._id) } },
      ],
    });

    const results = users.map((user) => {
      const relationship = relationships.find((item) => (
        item.sender.equals(user._id) || item.recipient.equals(user._id)
      ));
      let connection = { status: "none" };
      if (relationship?.status === "accepted") connection = { status: "friends", requestId: relationship._id };
      if (relationship?.status === "pending") {
        connection = relationship.recipient.equals(req.user._id)
          ? { status: "incoming", requestId: relationship._id }
          : { status: "outgoing", requestId: relationship._id };
      }
      return { ...publicUser(user), connection };
    });

    return res.json(results);
  } catch (error) {
    return res.status(500).json({ message: "Could not search users." });
  }
};
