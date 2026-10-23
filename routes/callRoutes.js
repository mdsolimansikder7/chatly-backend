const express = require("express");
const protect = require("../middleware/authMiddleware");
const Call = require("../models/Call");

const router = express.Router();
router.use(protect);

// GET /api/calls - list call history for the current user
router.get("/", async (req, res) => {
  try {
    const userId = req.user._id;
    const { status, type, limit = 50, skip = 0 } = req.query;
    const query = {
      $or: [{ caller: userId }, { receiver: userId }],
    };
    if (status) query.status = status;
    if (type) query.type = type;

    const calls = await Call.find(query)
      .populate("caller", "name avatar")
      .populate("receiver", "name avatar")
      .populate("conversation", "_id isGroup groupName")
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .skip(Number(skip));

    const total = await Call.countDocuments(query);

    const formatted = calls.map((call) => {
      const isCaller = String(call.caller._id) === String(userId);
      const other = isCaller ? call.receiver : call.caller;
      return {
        _id: call._id,
        conversationId: call.conversation?._id || null,
        type: call.type,
        status: call.status,
        isCaller,
        duration: call.duration,
        startedAt: call.startedAt,
        answeredAt: call.answeredAt,
        endedAt: call.endedAt,
        peer: { _id: other._id, name: other.name, avatar: other.avatar },
      };
    });

    res.json({ calls: formatted, total });
  } catch (error) {
    res.status(500).json({ message: "Could not load call history." });
  }
});

// GET /api/calls/:callId - single call record
router.get("/:callId", async (req, res) => {
  try {
    const call = await Call.findById(req.params.callId)
      .populate("caller", "name avatar")
      .populate("receiver", "name avatar");
    if (!call) return res.status(404).json({ message: "Call not found." });
    const isMember =
      String(call.caller._id) === String(req.user._id) ||
      String(call.receiver._id) === String(req.user._id);
    if (!isMember) return res.status(403).json({ message: "Access denied." });
    res.json(call);
  } catch (error) {
    res.status(500).json({ message: "Could not load call record." });
  }
});

// PATCH /api/calls/:callId - update status/duration (used by server-side handlers)
router.patch("/:callId", async (req, res) => {
  try {
    const call = await Call.findById(req.params.callId);
    if (!call) return res.status(404).json({ message: "Call not found." });
    const isMember =
      String(call.caller) === String(req.user._id) ||
      String(call.receiver) === String(req.user._id);
    if (!isMember) return res.status(403).json({ message: "Access denied." });

    const { status, endedAt, duration } = req.body;
    if (status) call.status = status;
    if (endedAt) call.endedAt = new Date(endedAt);
    if (typeof duration === "number") call.duration = duration;
    await call.save();
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ message: "Could not update call record." });
  }
});

module.exports = router;