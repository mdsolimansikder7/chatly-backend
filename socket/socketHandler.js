const jwt = require("jsonwebtoken");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");
const User = require("../models/User");
const Call = require("../models/Call");
const { areFriends, isBlockedBetween } = require("../utils/friendships");

const connections = new Map();

function visibleOnlineIds() {
  return [...connections.entries()]
    .filter(([, entry]) => entry.visible)
    .map(([id]) => id);
}

// Helper to check if a user is currently connected (any socket)
function isUserOnline(userId) {
  const entry = connections.get(String(userId));
  return Boolean(entry && entry.count > 0);
}

function socketHandler(io) {
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("Authentication required"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("name emailVerified");
      if (!user) return next(new Error("User not found"));
      if (!user.emailVerified) return next(new Error("Verify your email address before connecting."));
      socket.data.user = { id: user._id.toString(), name: user.name };
      return next();
    } catch (error) {
      return next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", async (socket) => {
    const userId = socket.data.user.id;
    socket.join(userId);

    const profile = await User.findById(userId).select("showActiveStatus");
    const visible = profile?.showActiveStatus !== false;

    const entry = connections.get(userId) || { count: 0, visible: false };
    entry.count += 1;
    entry.visible = visible;
    connections.set(userId, entry);

    if (visible) {
      await User.findByIdAndUpdate(userId, { isOnline: true });
      socket.broadcast.emit("userOnline", userId);
    }
    socket.emit("onlineUsers", visibleOnlineIds());

    socket.on("setActiveStatus", ({ visible: nextVisible } = {}, callback) => {
      const show = Boolean(nextVisible);
      const current = connections.get(userId);
      const wasVisible = current ? current.visible : false;
      const update = show
        ? { showActiveStatus: true, isOnline: true }
        : { showActiveStatus: false, isOnline: false, lastSeen: new Date() };

      User.findByIdAndUpdate(userId, update)
        .then(() => {
          if (current) current.visible = show;
          if (show && !wasVisible) socket.broadcast.emit("userOnline", userId);
          if (!show && wasVisible) socket.broadcast.emit("userOffline", userId);
          if (callback) callback({ ok: true });
        })
        .catch(() => {
          if (callback) callback({ ok: false, error: "Could not update your active status." });
        });
    });

    socket.on("sendMessage", async ({ conversationId, text, fileUrl, fileName, fileType }, callback) => {
      try {
        const cleanText = String(text || "").trim();
        const hasFile = Boolean(fileUrl);
        if (!cleanText && !hasFile) throw new Error("Message must contain text or a file.");
        if (cleanText.length > 2000) throw new Error("Messages must contain 1 to 2000 characters.");

        const conversation = await Conversation.findOne({ _id: conversationId, members: userId });
        if (!conversation) throw new Error("Conversation not found.");
        if (!conversation.isGroup) {
          const otherMemberId = conversation.members.find((memberId) => memberId.toString() !== userId);
          if (!otherMemberId || (await isBlockedBetween(userId, otherMemberId))) {
            throw new Error("You cannot message this person.");
          }
          if (!otherMemberId || !(await areFriends(userId, otherMemberId))) {
            throw new Error("Accept a friend request before sending messages.");
          }
        }

        let message = await Message.create({
          conversation: conversation._id,
          sender: userId,
          text: cleanText,
          fileUrl: hasFile ? String(fileUrl).slice(0, 2048) : "",
          fileName: hasFile ? String(fileName || "").slice(0, 255) : "",
          fileType: hasFile ? String(fileType || "").slice(0, 128) : "",
        });
        conversation.lastMessage = message._id;
        await conversation.save();
        message = await message.populate("sender", "name avatar");

        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("receiveMessage", message);
        });
        if (callback) callback({ ok: true });
      } catch (error) {
        if (callback) callback({ ok: false, error: error.message });
      }
    });

    socket.on("typing", async ({ conversationId }) => {
      const conversation = await Conversation.findOne({ _id: conversationId, members: userId }).select("members");
      if (!conversation) return;
      conversation.members.forEach((memberId) => {
        if (memberId.toString() !== userId) {
          io.to(memberId.toString()).emit("typing", { conversationId, userId, name: socket.data.user.name });
        }
      });
    });

    socket.on("stopTyping", async ({ conversationId }) => {
      const conversation = await Conversation.findOne({ _id: conversationId, members: userId }).select("members");
      if (!conversation) return;
      conversation.members.forEach((memberId) => {
        if (memberId.toString() !== userId) io.to(memberId.toString()).emit("stopTyping", { conversationId, userId });
      });
    });

    socket.on("markSeen", async ({ conversationId }) => {
      const conversation = await Conversation.findOne({ _id: conversationId, members: userId }).select("members");
      if (!conversation) return;
      await Message.updateMany({ conversation: conversationId, sender: { $ne: userId }, status: { $ne: "seen" } }, { status: "seen" });
      conversation.members.forEach((memberId) => {
        if (memberId.toString() !== userId) {
          io.to(memberId.toString()).emit("messagesSeen", { conversationId, seenBy: userId });
        }
      });
    });

    // Helper to emit to a user by their userId (uses rooms, which are already set up)
    const emitToUser = (targetUserId, event, data) => {
      if (!targetUserId) return false;
      const targetId = String(targetUserId);
      if (!isUserOnline(targetId)) return false;
      io.to(targetId).emit(event, data);
      return true;
    };

    // Audio call signaling (WebRTC + Socket.io)
    // Caller initiates call
    socket.on("call:start", async ({ to, offer, callerName, conversationId }) => {
      try {
        const targetId = String(to);
        if (targetId === userId) return;
        if (await isBlockedBetween(userId, targetId) || !(await areFriends(userId, targetId))) {
          socket.emit("call:rejected", { to: targetId, reason: "not_friend" });
          return;
        }

        // Persist call record as "started" (ringing)
        let callDoc = null;
        if (conversationId) {
          callDoc = await Call.create({
            conversation: conversationId,
            caller: userId,
            receiver: targetId,
            type: "audio",
            status: "started",
          });
        }

        const delivered = emitToUser(targetId, "call:incoming", {
          from: userId,
          callerName: callerName || socket.data.user.name,
          offer,
          conversationId,
          callId: callDoc?._id,
        });
        if (!delivered) {
          if (callDoc) {
            await Call.findByIdAndDelete(callDoc._id);
          }
          socket.emit("call:unavailable", { to: targetId });
          return;
        }

        // Mark as ringing
        if (callDoc) {
          await Call.findByIdAndUpdate(callDoc._id, { status: "ringing" });
        }
      } catch (error) {
        socket.emit("call:error", { to, message: error.message });
      }
    });

    // Receiver accepts call
    socket.on("call:accept", async ({ to, answer, callId, conversationId }) => {
      emitToUser(to, "call:accepted", { answer });
      if (callId) {
        await Call.findByIdAndUpdate(callId, { status: "answered", answeredAt: new Date() });
      }
      if (conversationId) {
        await Message.create({
          conversation: conversationId,
          sender: userId,
          text: "",
          system: true,
          callStatus: "answered",
          callDuration: 0,
        });
        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("receiveMessage", {
            conversation: conversationId,
            sender: userId,
            system: true,
            callStatus: "answered",
            callDuration: 0,
          });
        });
      }
    });

    // Receiver rejects call
    socket.on("call:reject", async ({ to, callId, conversationId }) => {
      emitToUser(to, "call:rejected", {});
      if (callId) {
        await Call.findByIdAndUpdate(callId, { status: "rejected", endedAt: new Date() });
      }
      if (conversationId) {
        await Message.create({
          conversation: conversationId,
          sender: userId,
          text: "",
          system: true,
          callStatus: "rejected",
          callDuration: 0,
        });
        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("receiveMessage", {
            conversation: conversationId,
            sender: userId,
            system: true,
            callStatus: "rejected",
            callDuration: 0,
          });
        });
      }
    });

    // Receiver is busy with another call
    socket.on("call:busy", async ({ to, callId, conversationId }) => {
      emitToUser(to, "call:busy", {});
      if (callId) {
        await Call.findByIdAndUpdate(callId, { status: "busy", endedAt: new Date() });
      }
      if (conversationId) {
        await Message.create({
          conversation: conversationId,
          sender: userId,
          text: "",
          system: true,
          callStatus: "busy",
          callDuration: 0,
        });
        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("receiveMessage", {
            conversation: conversationId,
            sender: userId,
            system: true,
            callStatus: "busy",
            callDuration: 0,
          });
        });
      }
    });

    // ICE candidate exchange (both directions)
    socket.on("call:ice", ({ to, candidate }) => {
      emitToUser(to, "call:ice", { candidate });
    });

    // End call
    socket.on("call:end", async ({ to, callId, duration, conversationId }) => {
      emitToUser(to, "call:ended", {});
      if (callId) {
        await Call.findByIdAndUpdate(callId, {
          status: "ended",
          endedAt: new Date(),
          duration: Number(duration) || 0,
        });
      }
      if (conversationId && duration) {
        await Message.create({
          conversation: conversationId,
          sender: userId,
          text: "",
          system: true,
          callStatus: "ended",
          callDuration: Number(duration),
        });
        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("receiveMessage", {
            conversation: conversationId,
            sender: userId,
            system: true,
            callStatus: "ended",
            callDuration: Number(duration),
          });
        });
      }
    });

    // Caller marks call as missed (no answer within timeout)
    socket.on("call:missed", async ({ to, callId, conversationId }) => {
      if (callId) {
        await Call.findByIdAndUpdate(callId, { status: "missed", endedAt: new Date() });
      }
      if (conversationId) {
        await Message.create({
          conversation: conversationId,
          sender: userId,
          text: "",
          system: true,
          callStatus: "missed",
          callDuration: 0,
        });
        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("receiveMessage", {
            conversation: conversationId,
            sender: userId,
            system: true,
            callStatus: "missed",
            callDuration: 0,
          });
        });
      }
    });

    // Toggle message reaction (add/remove emoji reaction)
    socket.on("toggleReaction", async ({ messageId, emoji }, callback) => {
      try {
        const message = await Message.findById(messageId);
        if (!message) throw new Error("Message not found.");
        const conversation = await Conversation.findOne({ _id: message.conversation, members: userId });
        if (!conversation) throw new Error("Access denied.");

        const user = await User.findById(userId).select("name");
        const existingIdx = message.reactions.findIndex(
          (r) => String(r.emoji) === String(emoji) && String(r.userId) === String(userId),
        );

        if (existingIdx >= 0) {
          message.reactions.splice(existingIdx, 1);
        } else {
          message.reactions.push({ emoji, userId, userName: user.name });
        }
        await message.save();

        conversation.members.forEach((memberId) => {
          io.to(memberId.toString()).emit("reactionUpdated", {
            messageId,
            reactions: message.reactions,
          });
        });
        if (callback) callback({ ok: true });
      } catch (error) {
        if (callback) callback({ ok: false, error: error.message });
      }
    });

    socket.on("disconnect", async () => {
      const entry = connections.get(userId);
      if (!entry) return;
      entry.count -= 1;
      if (entry.count > 0) return connections.set(userId, entry);
      connections.delete(userId);
      if (entry.visible) {
        await User.findByIdAndUpdate(userId, { isOnline: false, lastSeen: new Date() });
        socket.broadcast.emit("userOffline", userId);
      } else {
        await User.findByIdAndUpdate(userId, { lastSeen: new Date() });
      }
    });
  });
}

module.exports = socketHandler;
