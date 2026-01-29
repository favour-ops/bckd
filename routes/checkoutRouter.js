const express = require("express")
const router = express.Router()
const validator = require("../validator");
const passport = require("passport");
const rateLimit = require('express-rate-limit');
const { json } = require("sequelize");

const apiLoggingMiddleware = require('../auth/apiLoggingMiddleware.js');

const { sensitiveActionLimiter} = require('../auth/rateLimiter.js');

const RequestValidator = require("../auth/validateReqMiddleware.js");
const idempotencyCheck = require('../auth/idempotencyMiddleware'); // Adjust path
const EncryptResponseMiddleware = require("../auth/encryptRespMiddleware.js"); // Import it here
const GenerateResponseKeyMiddleware = require("../auth/generateRespKeyMiddleware.js"); // Import our new middleware



// Define routes to exclude from API logging
const excludedLogRoutes = [
    '/addpaylink',
    '/paymelink/:payslug'
];

const sensitiveMiddleChecks = [RequestValidator, idempotencyCheck, sensitiveActionLimiter];
const NosensitiveMiddleChecks = [RequestValidator, idempotencyCheck];
const noRequestEncryptionChecks = [idempotencyCheck, sensitiveActionLimiter]; // For routes where request is not encrypted but response should be.
const generateKeyAndEncryptResponseChecks = [GenerateResponseKeyMiddleware, idempotencyCheck, sensitiveActionLimiter];


const checkoutControllers = require("../controllers/checkoutControllers")
const crossBorderControllers = require("../controllers/crossBorderControllers")
router.post("/inlinepay", checkoutControllers.initPayWithHitchPay);

// Apply Encryption Middleware (After route handlers)
router.use(EncryptResponseMiddleware);
router.post("/addpaylink", sensitiveMiddleChecks, checkoutControllers.createPayLink);
router.get("/paymelink/:payslug", sensitiveMiddleChecks, checkoutControllers.getMerchantSlug);
router.post("/initpayment", sensitiveMiddleChecks, checkoutControllers.initCheckPay);
router.get("/getcheckoutdetails/:reference", sensitiveMiddleChecks, checkoutControllers.getCheckoutDetails);
router.post("/initcheckoutsession", sensitiveMiddleChecks, checkoutControllers.initStripeCheckout);
router.get("/verifypayment/:reference", NosensitiveMiddleChecks, checkoutControllers.verifyStripeCheckout);
router.post("/generatedynamicaccount", sensitiveMiddleChecks, checkoutControllers.genDynamicAccount);
router.post("/verifytransaction", NosensitiveMiddleChecks, checkoutControllers.verifyDynamicAccountCheckout);
router.post("/getxrate", sensitiveMiddleChecks, checkoutControllers.getXRate);

router.get("/getsupportedcountries", sensitiveMiddleChecks, crossBorderControllers.supportedCountries);
router.get("/getycchannel", sensitiveMiddleChecks, crossBorderControllers.getChannels);
router.get("/getpaymentoptions", sensitiveMiddleChecks, crossBorderControllers.getNetworks);
router.post("/inichckpayment", sensitiveMiddleChecks, checkoutControllers.initiateCheckoutGlobal);
router.get("/validateglobalpay/:reference", sensitiveMiddleChecks, checkoutControllers.verifyGlobalPay);

// router.post("/webhook", sensitiveMiddleChecks, checkoutControllers.stripeWebhookHandler);
// router.post("/dynamic-account/webhook", sensitiveMiddleChecks, checkoutControllers.dynamicAccountWebhook);

module.exports = router