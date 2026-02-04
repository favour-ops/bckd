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


// --- Other Limiters (Example: Stricter for sensitive actions) ---
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


const authMiddleware = require("../auth/authMiddleware.js");
const RequestValidator = require("../auth/validateReqMiddleware.js");
const { checkBusinessPermission, businessAuth } = require("../auth/businessAuth.js");
const idempotencyCheck = require('../auth/idempotencyMiddleware'); // Adjust path

// Define common middleware sequences as arrays
const standardMiddleChecks = [RequestValidator, idempotencyCheck, paymentLimiter, authMiddleware];
const sensitiveMiddleChecks = [RequestValidator, idempotencyCheck, sensitiveActionLimiter, authMiddleware];
const businessMiddleChecks = [RequestValidator, idempotencyCheck, paymentLimiter, businessAuth];
const noEncryptionChecks = [RequestValidator, idempotencyCheck, authMiddleware, paymentLimiter];
const NoauthMiddleChecks = [RequestValidator, paymentLimiter];

/* CONtroler */
const businessController = require("../controllers/businessControllers")
const userController = require("../controllers/userController")
const walletController = require("../controllers/walletController")

const multer = require("multer");
const { json } = require("sequelize");
// const walletBalModel = require("../models/walletBalModel.js");
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


// AUTHENTICATION & INFO
router.post("/addbizreg", standardMiddleChecks, uploads.fields([{ name: 'cacfile', maxCount: 1 }, { name: 'bizlogo', maxCount: 1 }]), validator.validateBusiness, businessController.BusinessSetUp); //mobile appp

router.post("/initbizreg", NoauthMiddleChecks, validator.validateUser, businessController.initBusinessAccount);
router.post("/regotpver", NoauthMiddleChecks, businessController.verifyRegAccount);
router.post("/newbizreg", NoauthMiddleChecks, uploads.fields([{ name: 'cacfile', maxCount: 1 }, { name: 'bizlogo', maxCount: 1 }]), businessController.BusinessRegistrationWeb);  //web
router.post("/bizauth", NoauthMiddleChecks, businessController.authBusinessUser);
router.post("/getaccesstoken", NoauthMiddleChecks, userController.getAuthToken);
router.post("/passreset", NoauthMiddleChecks, userController.resetPass);
router.post("/verpassotp", NoauthMiddleChecks, userController.verifyPassRecover);
router.post("/recoverpass", NoauthMiddleChecks, userController.recoverMyPass);
router.post("/settranspin", sensitiveMiddleChecks, userController.setupPIN);

router.get("/bizdetails/:uuid", businessMiddleChecks, businessController.getBusinessDetails);
router.post("/editbizinfo/:uuid", businessMiddleChecks, uploads.fields([{ name: 'cacfile', maxCount: 1 }, { name: 'bizlogo', maxCount: 1 }]), businessController.editBusinessInfo);

// TEAM & ROLES MANAGEMENT  
router.post("/addmember", businessMiddleChecks, validator.validateAddMember, checkBusinessPermission('team:add'), businessController.addTeamMember);
router.get("/myteam/:bizid", businessMiddleChecks, businessController.getTeamMembers);
router.get("/myteamlist/:bizid", businessMiddleChecks, businessController.getTeamMembers);
router.post("/team/update", businessMiddleChecks, checkBusinessPermission('team:manage_status'), businessController.manageTeamMember);
router.post("/team/updaterole", businessMiddleChecks, checkBusinessPermission('team:add'), businessController.updateTeamMemberRole); 
router.post("/team/updatestatus", businessMiddleChecks, checkBusinessPermission('team:add'), businessController.updateTeamMemberStatus); 
router.get("/mybiz", businessMiddleChecks, businessController.listMyBusinesses);
router.get("/myteam", noEncryptionChecks, businessController.listMemberOfBusinesses);
router.get("/allmybiz", businessMiddleChecks, businessController.listAllAssociatedBusinesses);
router.post("/switch-business/:uuid", businessMiddleChecks, businessController.switchBusiness);
router.post("/manageinvite", businessMiddleChecks, checkBusinessPermission('team:manage_invites'), businessController.manageTeamInvite);
router.get("/roles", NoauthMiddleChecks, businessController.getBusinessRolesAndPermissions);

router.get("/wallets/:uuid", businessMiddleChecks, businessController.getBusinessWallets); //checkBusinessPermission('wallets:view')
router.get("/payhistory/:uuid", businessMiddleChecks, businessController.getBusinessPaynTransactions);  //checkBusinessPermission('transactions:view')
router.get("/payhistory/:uuid/:reference", businessMiddleChecks, checkBusinessPermission('transactions:view'), businessController.getBizTransDetails);

router.get("/checkout-transactions/:uuid", businessMiddleChecks, checkBusinessPermission('transactions:view'), businessController.getBusinessCheckoutTransactions);
router.get("/checkout-transdetails/:uuid/:reference", businessMiddleChecks, checkBusinessPermission('transactions:view'), businessController.getCheckoutTransactionDetails);

router.get("/getbanklist", NoauthMiddleChecks, walletController.bankList);
router.post("/validateacctno", NoauthMiddleChecks, walletController.resolveBank);
router.post("/biztransfer", businessMiddleChecks, checkBusinessPermission('debits:initiate'), businessController.bizTransferPayment);
router.post("/paylink/create", businessMiddleChecks, checkBusinessPermission('paylinks:manage'), businessController.createBusinessPayLink); // This one uses req.body, so no change needed.
router.get("/paylink/:uuid", businessMiddleChecks, checkBusinessPermission('paylinks:manage'), businessController.getBusinessPayLinks); // No longer needs :bizid
router.post("/paylink/updatestatus", businessMiddleChecks, checkBusinessPermission('paylinks:manage'), businessController.updateBusinessPayLinkStatus);
router.post("/paylink/delete", businessMiddleChecks, checkBusinessPermission('paylinks:manage'), businessController.deleteBusinessPayLink);
router.post("/paylink/edit", businessMiddleChecks, checkBusinessPermission('paylinks:manage'), businessController.editBusinessPayLink);
router.get("/bizpayqr/:uuid", businessMiddleChecks, businessController.bizPaymentQRCode);
router.get("/bizaccountlist/:uuid", businessMiddleChecks, businessController.bizAccountList);

//compliance & verification
router.post("/tinkyb", businessMiddleChecks, businessController.businessTINVerify);
router.post("/bvnverify", businessMiddleChecks, businessController.validateBVNBiz);
router.post("/bizdocupload", businessMiddleChecks, uploads.fields([{ name: 'fileupload', maxCount: 1 }, { name: 'idcardback', maxCount: 1 }
]), businessController.uploadDocs);
router.get("/bizkycstatus/:bizid", businessMiddleChecks, businessController.getBizKYCStatus);

// router.post("/bizkyc/tier1/:uuid", businessMiddleChecks, uploads.fields([{ name: 'cacdoc', maxCount: 1 }, { name: 'addressdoc', maxCount: 1 }]), businessController.bizKYCTier1);
// router.post("/bizkyc/tier2/:uuid", businessMiddleChecks, uploads.fields([{ name: 'idcard', maxCount: 1 }, { name: 'idcardback', maxCount: 1 }]), businessController.bizKYCTier2);

router.post("/webhook/create", businessMiddleChecks, checkBusinessPermission('webhooks:manage'), businessController.addBusinessWebhook);
router.get("/webhook/:uuid", businessMiddleChecks, checkBusinessPermission('webhooks:manage'), businessController.listBusinessWebhooks); // No longer needs :bizid
router.post("/webhook/update", businessMiddleChecks, checkBusinessPermission('webhooks:manage'), businessController.updateBusinessWebhook);
router.post("/webhook/delete", businessMiddleChecks, checkBusinessPermission('webhooks:manage'), businessController.deleteBusinessWebhook);


router.post("/genapikeys", businessMiddleChecks, checkBusinessPermission('apikeys:manage'), businessController.createBizKeys);

router.get("/apikeys/:uuid", businessMiddleChecks, checkBusinessPermission('apikeys:manage'), businessController.getBizKeys);
router.get("/listkeys", businessMiddleChecks, businessController.listAllBizKeys);
router.post("/rotate_apikey", businessMiddleChecks, businessController.rotateSecret);
router.post("/apikeys/revoke", businessMiddleChecks, businessController.revokeApiKey);



module.exports = router