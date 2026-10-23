const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const User = require("../models/User");
const { areFriends, isBlockedBetween } = require("../utils/friendships");

const DISAPPEAR_OPTIONS = [0, 600, 3600, 86400, 604800];

const populatedConversation = (id) => Conversation.findById(id)
  .populate("members", "name email username chatlyId avatar bio status isOnline lastSeen")
  .populate({ path: "lastMessage", populate: { path: "sender", select: "name avatar" } });

function clearedAtFor(conversation, userId) {
  const entry = (conversation.clearedAt || []).find(
    (item) => String(item.user?._id || item.user) === String(userId),
  );
  return entry ? entry.at : new Date(0);
}

exports.accessConversation = async (req, res) => {
  try {
    const { userId } = req.body;
    if (!mongoose.isValidObjectId(userId) || userId === req.user._id.toString()) {
      return res.status(400).json({ message: "Choose a valid contact to start a conversation." });
    }

    const contact = await User.findById(userId).select("_id");
    if (!contact) return res.status(404).json({ message: "That user was not found." });
    if (await isBlockedBetween(req.user._id, userId)) {
      return res.status(403).json({ message: "You cannot chat with this person right now." });
    }
    if (!(await areFriends(req.user._id, userId))) {
      return res.status(403).json({ message: "Accept a friend request before starting a private chat." });
    }

    let conversation = await Conversation.findOne({
      isGroup: false,
      members: { $all: [req.user._id, userId], $size: 2 },
    });
    const created = !conversation;
    if (!conversation) conversation = await Conversation.create({ members: [req.user._id, userId] });

    const fullConversation = await populatedConversation(conversation._id);
    return res.status(created ? 201 : 200).json(fullConversation);
  } catch (error) {
    return res.status(500).json({ message: "Could not open this conversation." });
  }
};

exports.createGroup = async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const requestedMembers = Array.isArray(req.body.members) ? req.body.members : [];
    const members = [...new Set(requestedMembers.map(String).filter((id) => mongoose.isValidObjectId(id)))];

    if (!name || members.length < 2) {
      return res.status(400).json({ message: "A group name and at least two contacts are required." });
    }

    const validMembers = await User.countDocuments({ _id: { $in: members } });
    if (validMembers !== members.length) return res.status(400).json({ message: "One or more selected users do not exist." });
    const friendshipChecks = await Promise.all(members.map((memberId) => areFriends(req.user._id, memberId)));
    if (friendshipChecks.some((isFriend) => !isFriend)) {
      return res.status(403).json({ message: "Groups can only include accepted contacts." });
    }

    const group = await Conversation.create({
      members: [...new Set([...members, req.user._id.toString()])],
      isGroup: true,
      groupName: name,
      groupAdmin: req.user._id,
    });

    return res.status(201).json(await populatedConversation(group._id));
  } catch (error) {
    return res.status(500).json({ message: "Could not create this group." });
  }
};

exports.getMyConversations = async (req, res) => {
  try {
    const conversations = await Conversation.find({ members: req.user._id })
      .populate("members", "name email username chatlyId avatar bio status isOnline lastSeen")
      .populate({ path: "lastMessage", populate: { path: "sender", select: "name avatar" } })
      .sort({ updatedAt: -1 });

    const visible = conversations.map((conversation) => {
      const clearFrom = clearedAtFor(conversation, req.user._id);
      const plain = conversation.toObject();
      if (plain.lastMessage && new Date(plain.lastMessage.createdAt) <= clearFrom) {
        plain.lastMessage = null;
      }
      return plain;
    });

    return res.json(visible);
  } catch (error) {
    return res.status(500).json({ message: "Could not load your conversations." });
  }
};

exports.deleteConversation = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.conversationId, members: req.user._id });
    if (!conversation) return res.status(404).json({ message: "Conversation not found." });

    await Conversation.updateOne({ _id: conversation._id }, { $pull: { members: req.user._id } });
    // Keep the chat intact for other members — clear only my view of the history.
    const existingClear = (conversation.clearedAt || []).filter(
      (item) => String(item.user) !== req.user._id.toString(),
    );
    await Conversation.updateOne(
      { _id: conversation._id },
      { $set: { clearedAt: [...existingClear, { user: req.user._id, at: new Date() }] } },
    );
    if (conversation.isGroup && (conversation.members.length - 1) < 1) {
      await Conversation.deleteOne({ _id: conversation._id });
    }
    return res.json({ deleted: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not delete this conversation." });
  }
};

exports.updateConversationSettings = async (req, res) => {
  try {
    const conversation = await Conversation.findOne({ _id: req.params.conversationId, members: req.user._id });
    if (!conversation) return res.status(404).json({ message: "Conversation not found." });

    if (req.body.disappearAfter !== undefined) {
      const seconds = Number(req.body.disappearAfter);
      if (!DISAPPEAR_OPTIONS.includes(seconds)) {
        return res.status(400).json({ message: "Choose a valid disappearing-message duration." });
      }
      conversation.disappearAfter = seconds;
      await conversation.save();
      const io = req.app.get("io");
      if (io) {
        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("conversationUpdated", {
            conversationId: conversation._id,
            disappearAfter: seconds,
          });
        });
      }
    }

    return res.json(await populatedConversation(conversation._id));
  } catch (error) {
    return res.status(500).json({ message: "Could not update this conversation." });
  }
};
