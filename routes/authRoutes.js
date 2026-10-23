const express = require("express");
const { login, register, resendVerification, verifyEmail } = require("../controllers/authController");

const router = express.Router();
router.post("/register", register);
router.post("/login", login);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);

module.exports = router;
