const express = require("express")
const router = express.Router()
const validator = require("../validator");
const passport = require("passport");
const rateLimit = require('express-rate-limit');


const sensitiveActionLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes window
  max: 5,  // Allow only 5 attempts within 5 minutes per IP/user
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many attempts for this action, please try again later.',
  keyGenerator: (req, res) => {
    return `${req.ip}:${req.path}`;
  }
});

const generalApiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 60, // Allow only 10 attempts within 1 minutes per IP/user
    standardHeaders: true,
    legacyHeaders: false,
    message: 'Too many requests, please slow down.',
    keyGenerator: (req, res) => {
        return `${req.ip}:${req.path}`;
    }
});

// --- Cron Job Limiter ---
const cronLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes window
  max: 10, // Allow 10 requests per 5 minutes per IP
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests for this cron endpoint.',
  keyGenerator: (req, res) => {
      return req.ip;
  }
});

const payController = require("../controllers/paymentController.js")
const walletController = require("../controllers/walletController.js")
const KycController = require("../controllers/kycController");
const productController = require("../controllers/productController");
const checkoutControllers = require("../controllers/checkoutControllers")
const crossBorderControllers = require("../controllers/crossBorderControllers");
const hookNotifyControllers = require("../controllers/hookNotifyControllers");
const statementController = require("../controllers/statementController.js");
const inactiveUserController = require("../controllers/inactiveUserNotifier.js");

const { json } = require("sequelize");


router.get("/dotransfund", sensitiveActionLimiter, payController.refundPendingTransactions);
router.get("/collaterevenue", sensitiveActionLimiter, payController.logDailyRevenue);
router.get("/collatedailycheckout/:secret", cronLimiter, payController.collateDailyCheckoutSettlements);
router.post("/whksh23x", generalApiLimiter, walletController.shHookNotify);
router.post("/whksh223xdynm", generalApiLimiter, checkoutControllers.dynamicAccountWebhook);
router.post("/whgk35plmxb", generalApiLimiter, walletController.veryPlembyHook);
router.post("/whgk135djh", generalApiLimiter, walletController.verDojahHook);
router.post("/whkc12mpl", walletController.maplHkNotify);
router.post("/hkwh459pssb", generalApiLimiter, walletController.hook9psNotify);
router.post("/hkwh378psprd", generalApiLimiter, walletController.hook9psNotify);
router.post("/whgk123veff", generalApiLimiter, KycController.verVeriffHook);  //teting
router.post("/whgk123veffsimulate", generalApiLimiter, KycController.verVeriffHookTestSimulate);  //teting
router.post("/whgk3145veff", generalApiLimiter, KycController.verVeriffHookProd);  //prod


router.get("/idleconnections/:secret", generalApiLimiter, walletController.runKillIdleConnections);
router.get("/notifypending/:secret", cronLimiter, productController.notifyPendingTransactions); 
router.post("/xbodwhgkyc44", generalApiLimiter, crossBorderControllers.theYcWebhook);  //prod
router.post("/whk98prvd", generalApiLimiter, hookNotifyControllers.prvdNotify);
router.post("/cybdywhk98tst", generalApiLimiter, hookNotifyControllers.CybdWbkNotifyTest); //test
router.post("/cybdwhk938prd", generalApiLimiter, hookNotifyControllers.CybdWbkNotifyProd); //test
router.post("/whgk45sqdtst", generalApiLimiter, hookNotifyControllers.SqdTransNotify);  //test
router.post("/whkkra58tst", generalApiLimiter, hookNotifyControllers.KraWhkNotify);  //test



router.get("/generatestatements/:secret", generalApiLimiter, statementController.generateMonthlyStatements);
router.get("/notifyinactiveusers/:secret", generalApiLimiter, inactiveUserController.NotifyInactiveUsers);
router.get("/notifyrecent_inactive/:secret", generalApiLimiter, inactiveUserController.runInactiveUserNotifier);
router.get("/repushwebhooks/:secret", generalApiLimiter, checkoutControllers.retryFailedWebhooks);


// Stripe webhook needs the raw body for signature verification.
// This route must be defined before any middleware that parses the body as JSON (like express.json()).
router.post("/whkk920strptst", generalApiLimiter, hookNotifyControllers.stripeWebhkHandlerTest);  //test
router.post("/whk352strpnoty/:secret", generalApiLimiter, hookNotifyControllers.stripeWebhkLive);  //live
// router.post("/whkk920strptst", express.raw({type: 'application/json'}), checkoutControllers.stripeWebhkHandlerTest);  //prod


module.exports = router