const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

async function loadConversationForUser(userId, conversationId) {
  return Conversation.findOne({ _id: conversationId, members: userId }).select("_id members clearedAt disappearAfter");
}

function clearedAtFor(conversation, userId) {
  const entry = (conversation.clearedAt || []).find(
    (item) => String(item.user?._id || item.user) === String(userId),
  );
  return entry ? new Date(entry.at) : new Date(0);
}

exports.getMessages = async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.isValidObjectId(conversationId)) return res.status(400).json({ message: "Invalid conversation." });

    const conversation = await loadConversationForUser(req.user._id, conversationId);
    if (!conversation) return res.status(403).json({ message: "You do not have access to this conversation." });

    const clearFrom = clearedAtFor(conversation, req.user._id);

    if (conversation.disappearAfter > 0) {
      const cutoff = new Date(Date.now() - conversation.disappearAfter * 1000);
      await Message.deleteMany({ conversation: conversationId, createdAt: { $lt: cutoff } });
    }

    const filter = { conversation: conversationId, createdAt: { $gt: clearFrom } };
    if (conversation.disappearAfter > 0) {
      filter.createdAt.$gt = new Date(Math.max(
        clearFrom.getTime(),
        Date.now() - conversation.disappearAfter * 1000,
      ));
    }

    const messages = await Message.find(filter)
      .populate("sender", "name avatar")
      .sort({ createdAt: 1 });

    return res.json(messages);
  } catch (error) {
    return res.status(500).json({ message: "Could not load the message history." });
  }
};

exports.clearConversation = async (req, res) => {
  try {
    const { conversationId } = req.params;
    if (!mongoose.isValidObjectId(conversationId)) return res.status(400).json({ message: "Invalid conversation." });

    const conversation = await loadConversationForUser(req.user._id, conversationId);
    if (!conversation) return res.status(403).json({ message: "You do not have access to this conversation." });

    const remaining = (conversation.clearedAt || []).filter(
      (item) => String(item.user?._id || item.user) !== req.user._id.toString(),
    );
    conversation.clearedAt = [...remaining, { user: req.user._id, at: new Date() }];
    await conversation.save();

    return res.json({ cleared: true });
  } catch (error) {
    return res.status(500).json({ message: "Could not clear this chat." });
  }
};
