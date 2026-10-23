const express = require("express");
const protect = require("../middleware/authMiddleware");
const { accessConversation, createGroup, deleteConversation, getMyConversations, updateConversationSettings } = require("../controllers/conversationController");

const router = express.Router();
router.use(protect);
router.route("/").get(getMyConversations).post(accessConversation);
router.post("/group", createGroup);
router.delete("/:conversationId", deleteConversation);
router.patch("/:conversationId/settings", updateConversationSettings);

module.exports = router;
