const express = require("express")
const router = express.Router()
const validator = require("../validator");
const passport = require("passport");
const rateLimit = require('express-rate-limit');

// --- Updated Rate Limiter ---
const paymentLimiter = rateLimit({
  windowMs: 10 * 1000, // 10 seconds window
  max: 3, // Max 3 request *per endpoint per IP* within the window
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests on this endpoint, please try again later.',
  keyGenerator: (req, res) => {
    return `${req.ip}:${req.path}`;
  }
});

const NoauthMiddleChecks = [paymentLimiter];

const {initiateDraw, getWinner, resetDraws} = require("../controllers/raffeDrawControllers/rafflecontroller.js");
const {getCustomerNgnAccount} = require("../controllers/raffeDrawControllers/payqrcontroller.js");


router.post("/draw", NoauthMiddleChecks, initiateDraw);
router.get("/winner/:referralCode", NoauthMiddleChecks, getWinner);
router.post("/reset", NoauthMiddleChecks, resetDraws);
router.post("/payqr", NoauthMiddleChecks, getCustomerNgnAccount);

module.exports = router