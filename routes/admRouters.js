const express = require("express")
const router = express.Router()
const validator = require("../validator");
const passport = require("passport");
const rateLimit = require('express-rate-limit');
const { adminMiddleware, checkPermission } = require("../auth/adminMiddleware.js"); // Destructure here
const userController = require("../controllers/userController.js")
const adminController = require("../controllers/adminController.js")
const payController = require("../controllers/paymentController.js")
const productController = require("../controllers/productController.js")
const statsController = require("../controllers/statsController.js")
const reportController = require("../controllers/reportController.js")
const walletController = require("../controllers/walletController.js")
const cardController = require("../controllers/cardController.js")
const bonusController  = require("../controllers/bonusController.js");
const multiCurrencyController  = require("../controllers/multiCurrencyController.js");
// const { isAuthenticated } = require('../middleware/authMiddleware'); // Your auth middleware
const statementController = require("../controllers/statementController.js");
const checkoutControllers = require("../controllers/checkoutControllers")
const businessControllers = require("../controllers/businessControllers")


const multer = require("multer");
// const storage = multer.diskStorage({});
const MulterError = require("../config/imageuploads.js");
const { json } = require("sequelize");
const { listing } = require("../models/index.js");

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

// Apply to login and 2FA routes
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 10 login requests per windowMs
  message: {
    status: false,
    message: 'Too many login attempts. Please try again after 15 minutes'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

router.post("/admauthlogin",  adminController.authAdmin);
router.post("/authenticate", adminController.auth2faAdmin);
router.get("/admdetails", adminMiddleware, adminController.ProfileInfo);
router.post("/getaccesstoken", adminController.getAuthToken);
router.post("/createadm", adminMiddleware, adminController.addAdm);
router.get("/getadmin", adminMiddleware, adminController.getAllAdm);
router.get("/sitestats", adminMiddleware, adminController.siteStats);
router.get("/getusers", adminMiddleware, adminController.getUsers);
router.get("/getusers/:customerid", adminMiddleware, adminController.getUsersDetails);
router.get("/inactivecustomers", adminMiddleware, checkPermission('marketing_reports'), adminController.getInactiveCustomers);
router.get("/getusercards/:customerid", adminMiddleware, adminController.getCustCards);
router.get("/getcustomerbalances", adminMiddleware, checkPermission('view_reports'), adminController.getCustomerBalances);
router.get("/getuservaccounts/:customerid", adminMiddleware, checkPermission('manage_users'), adminController.getCustomerAccounts);
router.post("/getinvitees/:userid", adminMiddleware, adminController.getInvitees);
router.post("/getbeneficials/:userid", adminMiddleware, adminController.getBeneficiary);
router.post("/updcuststatus", adminMiddleware,  checkPermission('manage_users'), adminController.updCustStatus);

router.post("/createrole", adminMiddleware, adminController.addRoles);
router.post("/updaterole", adminMiddleware, adminController.updateRoles);
router.get("/getroles", adminMiddleware, adminController.getAllRoles);
router.post("/addpermissions", adminMiddleware, adminController.addPermissions);
router.get("/getpermissions", adminMiddleware, adminController.getAllPermitts);

router.get("/gentwofactor", adminMiddleware, adminController.genTwofactor);
router.post("/verify2fa", adminMiddleware, adminController.verify2FA);
router.post("/deactivate2fa", adminMiddleware, adminController.deactivate2FA);
router.get("/admauditlog", adminMiddleware, checkPermission('view_audit_log'), adminController.showAudit);

router.post("/updateadm", adminMiddleware, checkPermission('manage_roles'), adminController.updAdmRole);
router.post("/updadmstatus", adminMiddleware,  checkPermission('manage_roles'), adminController.updAdmStatus);
router.post("/updateaccess", adminMiddleware, checkPermission('manage_roles'), adminController.updAdmAccess);

router.post("/updpass", adminMiddleware, adminController.changPass);
router.get("/getroleaccess", adminMiddleware, checkPermission('view_roles'), adminController.getAllAccess);
router.get("/showsettings", adminMiddleware, adminController.showAppSetting);
router.post("/salesgraph", adminMiddleware, statsController.yrSalesGraph);
router.post("/usergrowth", adminMiddleware, statsController.UserGrowth);
router.get("/topsalestoday", adminMiddleware, statsController.getTopProducts);
router.post("/transactiongrowth", adminMiddleware, statsController.TransactionGrowthGraph);
router.post("/transvolumegrowth", adminMiddleware, statsController.TransVolumeGraph);
router.post("/activedormant", adminMiddleware, statsController.getActiveDormantStats);
router.post("/customerstates", adminMiddleware, statsController.getCustomersByState);
router.get("/toprefferals", adminMiddleware, statsController.getTopReferrers);
router.get("/earnshistory", adminMiddleware, checkPermission('view_reports'), adminController.getEarningsHistory);
router.get("/getnotice", adminMiddleware, adminController.getNotice);
router.post("/pixupload", adminMiddleware, uploads.single('pixfile'), adminController.uploadPix);
router.post("/clearnote", adminMiddleware, adminController.removeNotify); 
// router.get("/earnshistory", adminMiddleware, adminController.EarningHistory);
router.get("/getpackages", adminMiddleware, productController.getBillersPackage);
router.get("/datacategories", adminMiddleware, productController.getBillersPackage);
router.get("/getplans", adminMiddleware, productController.dataPlans);

router.post("/addproduct", adminMiddleware, checkPermission('manage_products'), productController.AddProducts);
router.get("/getproducts", adminMiddleware, adminController.getAdmProducts);
router.post("/editprduct", adminMiddleware, checkPermission('manage_products'), productController.EditProducts);
router.post("/updprdstatus", adminMiddleware,  checkPermission('manage_products'), productController.updPrdStatus);
router.post("/removeprd",  adminMiddleware, checkPermission('manage_products'), productController.removeProduct);

router.post("/updsett", adminMiddleware, checkPermission('edit_settings'), adminController.SettingSite);
router.post("/addpaylimit", adminMiddleware, checkPermission('edit_settings'), productController.AddLimits);
router.get("/gettranslimit", adminMiddleware, productController.getTransLimit);
router.post("/editlimit", adminMiddleware, checkPermission('edit_settings'), productController.EditTransLimits);
router.post("/removelimit",  adminMiddleware, checkPermission('edit_settings'), productController.removeTransLimit);
router.post("/addpaypricing", adminMiddleware, checkPermission('edit_settings'), productController.AddPricings);
router.post("/editprices", adminMiddleware, checkPermission('edit_settings'), productController.EditPricing);
router.post("/removepricing", adminMiddleware, checkPermission('edit_settings'), productController.removePricing);
router.post("/updrevenuebnk", adminMiddleware, checkPermission('edit_settings'), adminController.UpdBankRevenue);
router.get("/getpricing", adminMiddleware, productController.getPricing);

router.get("/getcustdocs/:userid", adminMiddleware, adminController.getUserDocs);
router.get("/getkycdocs", adminMiddleware, adminController.getAllDocs);
router.post("/updkycstatus", adminMiddleware, checkPermission('manage_kyc'), adminController.kycUpdate);
router.post("/updcusttier", adminMiddleware, checkPermission('manage_kyc'), adminController.custTierUpdate);
router.get("/getkychistory/:customerid", adminMiddleware, checkPermission('manage_kyc'), adminController.getCustomerKycHistory);
router.post("/genviraccount", adminMiddleware, checkPermission('manage_virtual_accounts'), adminController.generateVirtualAccount);
// router.post("/removeprices", adminMiddleware, productController.EditPricing);
router.post("/payhistory", adminMiddleware, adminController.transHistory);
router.post("/payhistory/:userid", adminMiddleware, adminController.transUserHistory);
router.post("/billsummary", adminMiddleware, statsController.billsSummary);
router.post("/transferstats", adminMiddleware, statsController.getTransferStats);
router.get("/transdetails/:reference", adminMiddleware, adminController.payDetails);
router.get("/transstatus/:reference", adminMiddleware, payController.transStatus);
// router.post("/dopayout", adminMiddleware, payController.approvePayout);t

router.get("/dopayrefund/:reference", adminMiddleware, checkPermission('manage_transactions'), payController.doRefund);
router.get("/dopayupd/:reference/:type", adminMiddleware, checkPermission('manage_transactions'), payController.doPayUpd);

router.post("/chargewallet", adminMiddleware, checkPermission('manage_wallets'), adminController.chargeWallet);
router.get("/getbanklist", adminMiddleware, walletController.bankList);
router.post("/validateacctno", adminMiddleware, walletController.resolveBank);
router.post("/notifyusers", adminMiddleware, checkPermission('send_notifications'), adminController.notifyCustomer);
router.get("/allvaccounts", adminMiddleware, checkPermission('manage_wallets'), adminController.getVirtualAccounts);
router.get("/inactivecustomers", adminMiddleware, checkPermission('view_reports'), adminController.getInactiveCustomers);
// router.post("/exportearnings", adminMiddleware, reportController.cashBackExport);


/* products settings */
// router.get("/billers", adminMiddleware, productController.getBillersPackage);

/* REPORTS */
router.post("/reporthist/:parameter", adminMiddleware, reportController.exportHistory);
router.post("/exportsales", adminMiddleware, checkPermission('export_sales'),  reportController.SalesExport);
router.post("/exportcustomer", adminMiddleware, checkPermission('export_customers'), reportController.userExport);
router.get("/dailyrevenue", adminMiddleware, reportController.getDailyRevenue);
router.get("/revenuetrans/:reference", adminMiddleware, reportController.getTransactionsByDate);
router.post("/processpayout", adminMiddleware, checkPermission('settle_revenue'), reportController.settleRevenue);
router.post("/dorepush", adminMiddleware, checkPermission('manage_transactions'), payController.SHRepushTrans);

/* CARDS */
router.post("/getexchange", adminMiddleware, multiCurrencyController.getExchange);
router.get("/kadstats", adminMiddleware, cardController.cardStats);
router.get("/kadtrans", adminMiddleware, cardController.cardTransactions);
router.get("/cardlist", adminMiddleware, cardController.cardList);
router.post("/getcard-details", adminMiddleware, cardController.fetchCardDetails);
router.get("/getcardtrans/:cardid", adminMiddleware, cardController.fetchCardTransApi);
router.post("/mpldkycfull/", adminMiddleware, cardController.AdmincreateVKadAccount);  //temporary kyc onbehalf of affected customer

/* USD ACCOUNT REQUESTS */
router.get("/usdaccount-requests", adminMiddleware, checkPermission('view_usd_accounts'), adminController.getUsdAccountRequests);
router.get("/usdaccount-details/:reference", adminMiddleware, checkPermission('view_usd_accounts'), adminController.getUsdAccountRequestDetails);
router.post("/usdaccount-update", adminMiddleware, checkPermission('manage_usd_accounts'), adminController.updateUsdAccountRequestStatus);
// router.get("/getcustcards/:custid", adminMiddleware, cardController.CustomerCards);

// BONUS
router.post("/checkin", adminMiddleware, bonusController.checkinBonus);
router.get("/categories", adminMiddleware, bonusController.getBonusCategory);
router.post("/addtask", adminMiddleware, checkPermission('manage_bonus'), bonusController.createBonusTask);
router.post("/edittask", adminMiddleware, checkPermission('manage_bonus'), bonusController.updateBonusTask);
router.get("/bonustasks", adminMiddleware, bonusController.getBonusTasks);
router.post("/updbonustask", adminMiddleware, checkPermission('manage_bonus'), bonusController.updateBonusTask);
router.post("/delbonustask", adminMiddleware, checkPermission('manage_bonus'), bonusController.deleteBonusTask);
router.get("/checkin-reward", adminMiddleware, bonusController.getCheckInRewards);
router.post("/updcheckin-reward", adminMiddleware, bonusController.updateCheckInRewards);

// coupon
router.post("/createcoupon", adminMiddleware, checkPermission('manage_bonus'), bonusController.createBonusCoupon);
router.get("/getcoupons", adminMiddleware, bonusController.getBonusCoupons);
router.post("/assigncoupon", adminMiddleware, checkPermission('manage_bonus'), bonusController.assignCoupon);
router.post("/updcouponstatus", adminMiddleware, checkPermission('manage_bonus'), bonusController.updateCouponStatus);
router.post("/editcoupon", adminMiddleware, checkPermission('manage_bonus'), bonusController.editCoupon);
router.post("/delcoupon", adminMiddleware, checkPermission('manage_bonus'), bonusController.deleteCoupon);

/* site ads */
router.post('/uploadadsimg', adminMiddleware, uploads.fields([{ name: 'adsimg', maxCount: 5 }]), adminController.addPromotion);


/* checkout and paylink */
router.post("/addpaylink", adminMiddleware, checkPermission('manage_products'), checkoutControllers.createPayLink);
router.get("/getpaylinks", adminMiddleware, checkoutControllers.getAllPayLinks);


// businesses routers
router.get("/getallbusiness", adminMiddleware, checkPermission('manage_business'), businessControllers.getAllBusinesses);
router.get("/bizdetails/:businessid", adminMiddleware, checkPermission('manage_business'), businessControllers.getBusinessAdminDetails);
router.post("/updbizstatus", adminMiddleware, checkPermission('manage_business'), businessControllers.updateBusinessStatus);



module.exports = router