const express = require("express");
const { login, register } = require("../controllers/authController");
const {
  exchangeOAuthCode,
  facebookCallback,
  googleCallback,
  startFacebook,
  startGoogle,
} = require("../controllers/oauthController");

const router = express.Router();
router.post("/register", register);
router.post("/login", login);
router.get("/google", startGoogle);
router.get("/google/callback", googleCallback);
router.get("/facebook", startFacebook);
router.get("/facebook/callback", facebookCallback);
router.post("/oauth/exchange", exchangeOAuthCode);

module.exports = router;
