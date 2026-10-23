const express = require("express");
const protect = require("../middleware/authMiddleware");
const { getMessages, clearConversation } = require("../controllers/messageController");

const router = express.Router();
router.use(protect);
router.get("/:conversationId", getMessages);
router.post("/clear/:conversationId", clearConversation);

module.exports = router;
