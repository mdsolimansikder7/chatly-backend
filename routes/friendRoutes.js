const express = require("express");
const protect = require("../middleware/authMiddleware");
const { acceptRequest, getNetwork, rejectRequest, sendRequest } = require("../controllers/friendController");

const router = express.Router();

router.use(protect);
router.get("/", getNetwork);
router.post("/requests", sendRequest);
router.post("/requests/:requestId/accept", acceptRequest);
router.post("/requests/:requestId/reject", rejectRequest);

module.exports = router;
