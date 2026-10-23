const express = require("express");
const protect = require("../middleware/authMiddleware");
const { blockUser, getMe, reportUser, searchUsers, unblockUser, updateMe } = require("../controllers/userController");

const router = express.Router();
router.use(protect);
router.get("/me", getMe);
router.put("/me", updateMe);
router.get("/", searchUsers);
router.post("/block", blockUser);
router.post("/unblock", unblockUser);
router.post("/report", reportUser);

module.exports = router;
