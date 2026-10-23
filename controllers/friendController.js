const mongoose = require("mongoose");
const Conversation = require("../models/Conversation");
const FriendRequest = require("../models/FriendRequest");
const User = require("../models/User");

const contactFields = "name email chatlyId avatar bio status isOnline lastSeen";
const publicUser = (user) => ({
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
});

exports.getNetwork = async (req, res) => {
  try {
    const [accepted, incoming, outgoing] = await Promise.all([
      FriendRequest.find({ status: "accepted", $or: [{ sender: req.user._id }, { recipient: req.user._id }] })
        .populate("sender", contactFields)
        .populate("recipient", contactFields),
      FriendRequest.find({ status: "pending", recipient: req.user._id }).populate("sender", contactFields).sort({ createdAt: -1 }),
      FriendRequest.find({ status: "pending", sender: req.user._id }).populate("recipient", contactFields).sort({ createdAt: -1 }),
    ]);

    return res.json({
      contacts: accepted.map((request) => publicUser(request.sender._id.equals(req.user._id) ? request.recipient : request.sender)),
      incoming: incoming.map((request) => ({ _id: request._id, createdAt: request.createdAt, user: publicUser(request.sender) })),
      outgoing: outgoing.map((request) => ({ _id: request._id, createdAt: request.createdAt, user: publicUser(request.recipient) })),
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not load friend requests." });
  }
};

exports.sendRequest = async (req, res) => {
  try {
    const recipientId = String(req.body.userId || "");
    if (!mongoose.isValidObjectId(recipientId) || recipientId === req.user._id.toString()) {
      return res.status(400).json({ message: "Choose a valid person." });
    }

    const recipient = await User.findById(recipientId).select("_id");
    if (!recipient) return res.status(404).json({ message: "That person was not found." });

    const existing = await FriendRequest.findOne({
      $or: [
        { sender: req.user._id, recipient: recipientId },
        { sender: recipientId, recipient: req.user._id },
      ],
    });
    if (existing?.status === "accepted") return res.status(409).json({ message: "You are already connected." });
    if (existing?.status === "pending" && existing.sender.equals(req.user._id)) return res.status(409).json({ message: "A request has already been sent." });
    if (existing?.status === "pending") return res.status(409).json({ message: "This person has already sent you a request. Accept it from Requests." });

    const request = existing
      ? await FriendRequest.findByIdAndUpdate(existing._id, { sender: req.user._id, recipient: recipientId, status: "pending" }, { new: true })
      : await FriendRequest.create({ sender: req.user._id, recipient: recipientId });
    return res.status(201).json({ _id: request._id, status: request.status });
  } catch (error) {
    return res.status(500).json({ message: "Could not send the friend request." });
  }
};

exports.acceptRequest = async (req, res) => {
  try {
    let request = await FriendRequest.findOne({
      _id: req.params.requestId,
      recipient: req.user._id,
      status: { $in: ["pending", "accepted"] },
    });
    if (!request) return res.status(404).json({ message: "Friend request not found." });

    const newlyAccepted = request.status === "pending";
    if (newlyAccepted) {
      request.status = "accepted";
      await request.save();
    }

    const members = [request.sender, request.recipient];
    let conversation = await Conversation.findOne({
      isGroup: false,
      members: { $all: members, $size: 2 },
    });
    if (!conversation) conversation = await Conversation.create({ members });

    if (newlyAccepted) {
      const io = req.app.get("io");
      if (io) {
        const event = { conversationId: conversation._id.toString() };
        io.to(request.sender.toString()).emit("friendRequestAccepted", event);
        io.to(request.recipient.toString()).emit("friendRequestAccepted", event);
      }
    }

    return res.json({
      _id: request._id,
      status: request.status,
      conversationId: conversation._id,
    });
  } catch (error) {
    return res.status(500).json({ message: "Could not accept the friend request." });
  }
};

exports.rejectRequest = async (req, res) => {
  try {
    const request = await FriendRequest.findOneAndUpdate(
      { _id: req.params.requestId, recipient: req.user._id, status: "pending" },
      { status: "rejected" },
      { new: true },
    );
    if (!request) return res.status(404).json({ message: "Friend request not found." });
    return res.json({ _id: request._id, status: request.status });
  } catch (error) {
    return res.status(500).json({ message: "Could not update the friend request." });
  }
};
