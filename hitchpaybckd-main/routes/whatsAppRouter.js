const express = require("express")
const router = express.Router()
const validator = require("../validator");
const passport = require("passport");
const { json } = require("sequelize");

const userController = require("../controllers/userController.js")
const whatsAppController = require("../controllers/whatsAppController.js")
const productController = require("../controllers/productController.js")
const payController = require("../controllers/paymentController.js")

/* WHATSAPP INTEGRATIONS */
router.post("/register", validator.validateUser, userController.miniAccount);
router.post("/signin", userController.loginUser);
router.post("/custdetails", whatsAppController.custInfo);
router.get("/getbillers", whatsAppController.getBillers);
router.get("/billerpackages", productController.getBillersPackage);
router.get("/packageplans", whatsAppController.packagePlans);
router.post("/validatcustid", whatsAppController.verifyCustId);
router.post("/dopayment", payController.whatsAppPayment);

//bvverify = 0 -pending, 1 - OTP SENT, 2 - Verified
//isverified = 0 -pending, 1 - verified (when selfie-bvn is completed)
//reglevel  = 0 - ongoing, 1- onboarded, 2 - done kyc
//accountstatus 0 - disabled, 1 - active, 3 - onhold 

module.exports = router