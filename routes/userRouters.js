const express = require("express")
const router = express.Router()
const validator = require("../validator");
const passport = require("passport");
const rateLimit = require('express-rate-limit');
const { pinLimiter, paymentLimiter, sensitiveActionLimiter, generalApiLimiter} = require('../auth/rateLimiter.js');
const authMiddleware = require("../auth/authMiddleware.js");
// const blockDuplicateRequest = require("../auth/duplicateMiddleware.js");
const RequestValidator = require("../auth/validateReqMiddleware.js");
const idempotencyCheck = require('../auth/idempotencyMiddleware'); // Adjust path
const EncryptResponseMiddleware = require("../auth/encryptRespMiddleware.js"); // Import it here

// Apply Encryption Middleware (After route handlers)
router.use(EncryptResponseMiddleware);

// Define common middleware sequences as arrays
const standardMiddleChecks = [RequestValidator, idempotencyCheck, paymentLimiter, authMiddleware];
const sensitiveMiddleChecks = [RequestValidator, idempotencyCheck, authMiddleware];
const pinLimitMiddleChecks = [RequestValidator, idempotencyCheck, pinLimiter, authMiddleware];
const noEncryptionChecks = [idempotencyCheck, authMiddleware];
const NoauthMiddleChecks = [RequestValidator];

/* CONtroler */
const userController = require("../controllers/userController.js")
const walletController = require("../controllers/walletController.js")
const payController = require("../controllers/paymentController.js")
const productController = require("../controllers/productController.js")
const whatsAppController = require("../controllers/whatsAppController.js")
const cardController = require("../controllers/cardController.js")
const bonusController  = require("../controllers/bonusController.js");
const multiCurrencyController  = require("../controllers/multiCurrencyController.js");
const KycController = require("../controllers/kycController");
const crossBorderControllers = require("../controllers/crossBorderControllers");
const remittanceControllers = require("../controllers/remittanceControllers");
const loanControllers = require("../controllers/loanControllers");
const savingsControllers = require("../controllers/savingsControllers");

const multer = require("multer");
const { json } = require("sequelize");
const storage = multer.memoryStorage(); // Store file in memory as Buffer

const fileFilter = (req, file, cb) => { 
  // No longer 
  const allowedMimeTypes = [
    "image/png",
    "image/jpeg",
    "image/jpg",
    "application/pdf", // Keep PDF if needed for KYC docs
  ];

  if (!allowedMimeTypes.includes(file.mimetype)) {
    console.warn(`Upload blocked by fileFilter: Invalid client-provided MIME type - ${file.mimetype}`);
    return cb(new Error("Invalid file type provided."), false);
  }

  cb(null, true);
};

const uploads = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 } // Limit file size to 5MB
});


router.post("/regaccount", NoauthMiddleChecks, validator.validateUser, userController.initAccount);
router.post("/regotpver", NoauthMiddleChecks, userController.verifyAccount);
router.post("/authsetup", NoauthMiddleChecks, userController.setUpAccount);
router.post("/otpresend", NoauthMiddleChecks,  userController.resendOTP);
router.post("/authlogin", NoauthMiddleChecks, userController.loginUser);
router.post("/getaccesstoken", NoauthMiddleChecks, userController.getAuthToken);
router.get("/userdetails", sensitiveMiddleChecks, userController.userInfo);
router.post("/settranspin", sensitiveMiddleChecks, userController.setupPIN);
router.post("/setuname", sensitiveMiddleChecks, userController.updPromoCode);
router.post("/logout", authMiddleware, userController.logoutUser); // Add this line
router.get("/ipaddress", userController.ipAddress);
router.post("/uploadpix", sensitiveMiddleChecks, uploads.single('pixfile'), userController.uploadPix);
router.post("/passreset", NoauthMiddleChecks, userController.resetPass);
router.post("/verpassotp", NoauthMiddleChecks, userController.verifyPassRecover);
router.post("/recoverpass", NoauthMiddleChecks, userController.recoverMyPass);
router.post("/updpass", pinLimitMiddleChecks, userController.updatePass);
router.post("/updinfo", standardMiddleChecks, userController.updateProfile);
router.post("/updtpin", pinLimitMiddleChecks, userController.updatePin);
router.post("/forgotpin", standardMiddleChecks, userController.resetPIN);
router.post("/verifypinotp", NoauthMiddleChecks, userController.verifyPinRecover);
router.post("/recoverpin", standardMiddleChecks, userController.RecoverPIN);
router.get("/getnotify", standardMiddleChecks, userController.getNotification);
router.get("/viewnote", standardMiddleChecks, userController.viewNotify); 
router.post("/clearnote", standardMiddleChecks, userController.removeNotify); 
router.get("/myfriends", standardMiddleChecks, userController.getFriends);
router.post("/bvver", standardMiddleChecks, userController.validateBVN);
router.post("/verbvotp", sensitiveMiddleChecks, userController.verifyBVOTP);
router.post("/initvercheck", standardMiddleChecks, userController.InitvalidateBVN);
router.post("/addvaccount", standardMiddleChecks, userController.createVAccount);
router.get("/vaccountlist", standardMiddleChecks, userController.myAccountList);
router.post("/accountclosure", standardMiddleChecks, userController.delAccount);
// router.post("/tier2kyc", noEncryptionChecks, uploads.single('fileupload'), userController.tier2KYC);
router.post("/tier2kyc", noEncryptionChecks, uploads.fields([{ name: 'fileupload', maxCount: 1 }, { name: 'idcardback', maxCount: 1 }
]), userController.tier2KYC);

router.post("/upldintpsst", noEncryptionChecks, uploads.fields([{ name: 'fileupload', maxCount: 1 }, { name: 'idcardback', maxCount: 1 }
]), userController.InterPassUpload);

router.post("/tier3kyc", sensitiveMiddleChecks, uploads.single('fileupload'), userController.tier2bKYC);
router.post("/addrkyc", sensitiveMiddleChecks, userController.addressKYC);
router.post("/ninverkyc", sensitiveMiddleChecks, userController.tier2Ver);
router.post("/addrver", sensitiveMiddleChecks, userController.submitAddrVer);
router.post("/tier3stmt", sensitiveMiddleChecks, uploads.single('fileupload'), userController.tierBankStmt);
router.get("/kycstatus", sensitiveMiddleChecks, userController.kycStatus);
router.post("/validatepin", standardMiddleChecks, userController.validatePIN);
router.post("/validatekyc", standardMiddleChecks, userController.verifyKYCDojah);
router.get("/wireinfo", NoauthMiddleChecks, productController.usTransferInfo);

router.get("/appsettings", noEncryptionChecks, userController.AppSetting);
router.post("/whksh23x", walletController.shHookNotify);
router.get("/showads", userController.showAds);

router.get("/getbanklist", NoauthMiddleChecks, walletController.bankList);
router.post("/validateacctno", NoauthMiddleChecks, walletController.resolveBank);
router.post("/dotransfer", standardMiddleChecks, payController.transferPayment);
router.get("/mywallets", sensitiveMiddleChecks, walletController.myWallets);
router.get("/payhistory", sensitiveMiddleChecks, walletController.payHistory);
router.get("/payhistory/:reference", sensitiveMiddleChecks, walletController.transDetails);
router.post("/accountstatement", sensitiveMiddleChecks, walletController.accountStatement);
// router.post("/buyproduct", standardMiddleChecks, payController.processPayment);
router.post("/dopayproduct", standardMiddleChecks, payController.processPaymentNew); //new price restructure
router.get("/beneficiary", standardMiddleChecks, payController.BeneficiaryList);
router.get("/myearns", standardMiddleChecks, payController.myEarnings);
router.post("/withdrawearnings", standardMiddleChecks, payController.withdrawEarning);
router.get("/gettvplans", NoauthMiddleChecks, productController.cableTVPlans);
router.post("/veriuc", sensitiveMiddleChecks, productController.verifyIUC);
router.get("/getpackages", NoauthMiddleChecks, productController.getBillersPackage);
router.post("/validatemeter", NoauthMiddleChecks, productController.verifyBillerId);
router.post("/getdataplans", NoauthMiddleChecks, productController.dataPlans);
router.post("/getbillerprices", NoauthMiddleChecks, productController.billerPrices);
router.get("/getproducts", NoauthMiddleChecks, productController.getProducts);
router.post("/initpay", NoauthMiddleChecks, payController.initiatePay);
router.post("/initpaymnt", NoauthMiddleChecks, payController.initiatePayNew);  //new price restructure
router.post("/verifypayonline", NoauthMiddleChecks, payController.verifyInitPay);
router.post("/paysummary", sensitiveMiddleChecks, walletController.transSum);
router.get("/getservices", NoauthMiddleChecks, productController.getServicesCategory);
router.get("/billerpackages", NoauthMiddleChecks, productController.getBillersPackage);
router.get("/packageplans", whatsAppController.packagePlans);
router.get("/translimit", sensitiveMiddleChecks, productController.getTransLimit);
router.post("/validatephoto", sensitiveMiddleChecks, uploads.single("photo"), userController.validatePhoto);
router.get("/databiller", NoauthMiddleChecks, productController.dataBillers);

router.get("/gentwofactor", standardMiddleChecks, userController.gen2FA);
router.post("/verify2fa", standardMiddleChecks, userController.verify2FA);
router.post("/deactivate2fa", standardMiddleChecks, userController.deactivate2FA);
router.post("/auth2factor", NoauthMiddleChecks, userController.auth2faUser);
router.get("/genpayqr", standardMiddleChecks, userController.generatePaymentQRCode);

router.post("/createkaduser", standardMiddleChecks, cardController.createVKadAccount);
router.get("/checkcardacct", standardMiddleChecks, cardController.cardAccountStatus);
router.post("/createvcard", standardMiddleChecks, cardController.getVCard);
router.post("/vcardissuance", standardMiddleChecks, uploads.fields([{ name: 'passportback', maxCount: 1 }, { name: 'passport', maxCount: 1 }]), cardController.getVCardNew);
router.get("/getmycards", standardMiddleChecks, cardController.getMyCards);
router.post("/card-details", standardMiddleChecks, cardController.getCardDetails);
router.post("/vcardfund", standardMiddleChecks, cardController.fundVCard);
router.post("/vcardwithdraw", standardMiddleChecks, cardController.withdrawVCard);
router.get("/getcardtrans/:cardid", standardMiddleChecks, cardController.getCardTrans);
router.post("/cardupdstatus", standardMiddleChecks, cardController.UpdCardStatus);

// mutil curren
router.post("/getrate", standardMiddleChecks, multiCurrencyController.getExchange);
router.post("/fundxchange", standardMiddleChecks, multiCurrencyController.fundSwap);
router.get("/listcurrencies", NoauthMiddleChecks, multiCurrencyController.listCurrencies);


router.post("/getusaccount", noEncryptionChecks, uploads.single("statement"), multiCurrencyController.createUSDAccount);
router.post("/createusaccount", noEncryptionChecks, uploads.fields([{ name: 'passportback', maxCount: 1 }, { name: 'passport', maxCount: 1 }, { name: 'statement', maxCount: 1 }]), multiCurrencyController.createUSDAccountNew);

router.get("/usdacctreq", standardMiddleChecks, multiCurrencyController.USDRequestDetails);
router.get("/acctreqstatus", standardMiddleChecks, multiCurrencyController.USAccountStatus);
router.get("/acctdetails", standardMiddleChecks, multiCurrencyController.USAccountDetails);

router.post("/regenacct", userController.regenerateVAccounts);
router.post("/addcounterparty", standardMiddleChecks, multiCurrencyController.createCounterParty);
router.post("/dowiresend", standardMiddleChecks, multiCurrencyController.USDWireTransfer);
router.get("/usdbeneficiary", standardMiddleChecks, multiCurrencyController.USDBeneficiaryList);

// BONUS
router.get("/checkin-rewards", standardMiddleChecks, bonusController.getCheckInRewards);
router.post("/docheckin", noEncryptionChecks, bonusController.checkinBonus);
router.get("/categories", noEncryptionChecks, bonusController.getBonusCategory);
// router.post("/updbonustask", noEncryptionChecks, bonusController.updateBonusTask);
router.get("/mycheckins", standardMiddleChecks, bonusController.getUserCheckinStatus);
router.get("/getbonustask", standardMiddleChecks, bonusController.getBonusTasks);

// Coupon routes
router.get("/showcoupons", standardMiddleChecks, bonusController.getAvailableCoupons);

router.post('/verifyus', standardMiddleChecks, KycController.initVeriff);

/* CROSS BORDER */
router.get("/yccountrylist", standardMiddleChecks, crossBorderControllers.supportedCountries);
router.get("/getycchannel", standardMiddleChecks, crossBorderControllers.getChannels);
router.get("/getycnetworks", standardMiddleChecks, crossBorderControllers.getNetworks);
router.get("/getycrate", sensitiveMiddleChecks, crossBorderControllers.getRate);
router.post("/globaldisburse", standardMiddleChecks, crossBorderControllers.initiatePayment);
router.post("/globalcollections", standardMiddleChecks, crossBorderControllers.initiateCollections);
router.get("/collstatus/:reference", standardMiddleChecks, crossBorderControllers.getCollectionLookup);


/* REMITTANCE BANK*/
router.get("/initremittance", standardMiddleChecks, remittanceControllers.initiateCustomerAccount);  //initiate customer enrollment
router.get("/doverifycustomer", standardMiddleChecks, remittanceControllers.initiateVerification);  //initiate verification
router.post("/initiateaccountlink", standardMiddleChecks, remittanceControllers.initiateAccountLink);  //get public token
router.post("/createexternalbank", standardMiddleChecks, remittanceControllers.createExternalBank);  //create external n
router.post("/verexternalbank", standardMiddleChecks, remittanceControllers.ExternalBankVerification);  //create external ban verification
router.get("/getlinkedbank", standardMiddleChecks, remittanceControllers.getLinkedBankList);  //get linked bank account
router.post("/globaldisburse", standardMiddleChecks, crossBorderControllers.initiatePayment);  //process deposit
router.post("/transauth", standardMiddleChecks, userController.validatMFAAuth);  //process deposit
router.get("/rempaystatus/:reference", standardMiddleChecks, remittanceControllers.getRemittancePayStatus);  //process deposit
router.get("/removelinkbank/:accountid", standardMiddleChecks, remittanceControllers.removeLinkedBank);  

/* REMITTANCE CARD */
router.get("/initcardlink", standardMiddleChecks, remittanceControllers.initiatCardLink);  //initiate card link
router.get("/cardpaymethods", standardMiddleChecks, remittanceControllers.customerPaymentList);  //initiate card link
router.post("/verifypayintent", standardMiddleChecks, remittanceControllers.verifyPaymentIntent); 



/* LOAN ANS SAVINGS */
router.get("/eligibleschool", standardMiddleChecks, loanControllers.fetchSchools);
router.get("/faculties/:schoolid", standardMiddleChecks, loanControllers.fetchFaculties);
router.post("/tuitionoffer", standardMiddleChecks, loanControllers.fetchTuitionsLoan);
router.post("/submitbnpl_loan", standardMiddleChecks, uploads.single('fileupload'), loanControllers.submitLoanApplication);  //process deposit
router.get("/loanhistory", standardMiddleChecks, loanControllers.fetchAllLoanHistory);
router.get("/loanhistory/:reference", standardMiddleChecks, loanControllers.fetchLoanDetails);
router.post("/dorepay", standardMiddleChecks, loanControllers.repayLoan); 



/* SAVINGS & LOCKS */
router.get("/savingsplans", standardMiddleChecks, savingsControllers.getLockPlans);
router.post("/savedeposit", standardMiddleChecks, savingsControllers.createSavings);
router.get("/getsavings", standardMiddleChecks, savingsControllers.getSavings);
router.get("/getsavings/:savingsid", standardMiddleChecks, savingsControllers.getSavingsDetails);
router.post("/savetopup", standardMiddleChecks, savingsControllers.topUpSavings);
router.post("/savewithdraw", standardMiddleChecks, savingsControllers.withdrawSavings);



// router.get("/tuitionoffer", standardMiddleChecks, loanControllers.fetchTuitionsLoan);  //process deposit
//bvverify = 0 -pending, 1 - OTP SENT, 2 - Verified
//isverified = 0 -pending, 1 - verified (when selfie-bvn is completed)
//reglevel  = 0 - ongoing, 1- onboarded, 2 - done kyc
//accountstatus 0 - disabled, 1 - active, 3 - onhold, 5 - account closed
//docskyc -  0 - not submitted,  1- in review, 2 - approved and 3- decline


module.exports = router