
const express = require("express");
const router = express.Router();
const { verifyAccessToken } = require("../../auth/pubApiVerifyToken.js");
const { getWalletBalance } = require("../../controllers/publicAPIControllers/walletcontroller.js")

router.get("/balance", verifyAccessToken, getWalletBalance);


module.exports = router;
