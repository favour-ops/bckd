
const express = require("express");
const router = express.Router();
const { verifyAccessToken } = require("../../auth/pubApiVerifyToken.js");
const { initiatePayment, verifyPayment, getMerchantPayments } = require("../../controllers/publicAPIControllers/paymentcontroller.js")

router.post("/initiate", verifyAccessToken, initiatePayment);
router.get("/verify/:reference", verifyAccessToken, verifyPayment);
router.get("/", verifyAccessToken, getMerchantPayments);

module.exports = router;
