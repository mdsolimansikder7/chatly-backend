const express = require("express");
const { login, register } = require("../controllers/authController");
const {
  exchangeOAuthCode,
  facebookCallback,
  startFacebook,
} = require("../controllers/oauthController");
const { exchangeBetterAuthSession } = require("../controllers/betterAuthController");

const router = express.Router();
router.post("/register", register);
router.post("/login", login);
router.get("/facebook", startFacebook);
router.get("/facebook/callback", facebookCallback);
router.post("/oauth/exchange", exchangeOAuthCode);
router.post("/better/exchange", exchangeBetterAuthSession);

module.exports = router;
