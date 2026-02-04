'use strict';

require('dotenv').config();

const fs = require('fs');
const path = require('path');
// const Sequelize = require('sequelize');
const {Sequelize, DataTypes, BelongsTo} = require('sequelize');
const basename = path.basename(__filename);

const db = {};
const config = {
  username: process.env.DB_USER,
  password: process.env.DB_PW,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT || 'mysql',
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000
  },
  logging: false // Disable verbose logging in production
};

let sequelize;


// Check if all required environment variables are present
if (config.database && config.username && config.host) {
  sequelize = new Sequelize(config.database, config.username, config.password, config);
} else {
  // Fallback to a DATABASE_URL if it exists (common for services like Heroku)
  if (process.env.JAWSDB_URL) {
    sequelize = new Sequelize(process.env.JAWSDB_URL, config);
  } else {
    console.error('Database configuration is incomplete. Please check your connection file.');
    process.exit(1);
  }
}


db.Sequelize = Sequelize
db.sequelize = sequelize

// USERS MODEL
db.customers = require('./userModel.js')(sequelize, DataTypes);
db.refreshtoken = require('./tokenModel.js')(sequelize, DataTypes);
db.resetpass = require('./passwordModel.js')(sequelize, DataTypes);
db.verotp = require('./otpverModel.js')(sequelize, DataTypes);
db.notify = require('./notifyModel.js')(sequelize, DataTypes);
db.whookhandler = require('./whkModel.js')(sequelize, DataTypes);
db.kyc = require('./kycModel.js')(sequelize, DataTypes);
db.bankacct = require('./accountsModel.js')(sequelize, DataTypes);
db.payn = require('./paymentModel.js')(sequelize, DataTypes);
db.products = require('./productsModel.js')(sequelize, DataTypes);
db.benefit = require('./beneficiaryModel.js')(sequelize, DataTypes);
db.wallets = require('./walletBalModel.js')(sequelize, DataTypes);
db.admin = require('./admBackModel.js')(sequelize, DataTypes);
db.audit = require('./auditLogsModel.js')(sequelize, DataTypes);
db.offlinepay = require('./offlineBucketModel.js')(sequelize, DataTypes);
db.appsettings = require('./appsettingsModel.js')(sequelize, DataTypes);
db.translimit = require('./limitModel.js')(sequelize, DataTypes);
db.delacct = require('./delAcctModel.js')(sequelize, DataTypes);
db.kycdoc = require('./kycDocsModel.js')(sequelize, DataTypes);
db.logrequest = require('./logrequestModel.js')(sequelize, DataTypes);
db.pricing = require('./pricingModel.js')(sequelize, DataTypes);
db.revenuebank = require('./revenuebankModel.js')(sequelize, DataTypes);
db.earnings = require('./earningsModel.js')(sequelize, DataTypes);
db.kadusers = require('./vkadusersModel.js')(sequelize, DataTypes);
db.vkads = require('./cardholderModel.js')(sequelize, DataTypes);
db.cardtrans = require('./cardtransModel.js')(sequelize, DataTypes);
db.accountrequest = require('./accountReqModel.js')(sequelize, DataTypes);
db.addressverification = require('./addressVerModel.js')(sequelize, DataTypes);
db.referral = require('./referralModel.js')(sequelize, DataTypes);
db.bonuscategory = require('./bonusCategoryModel.js')(sequelize, DataTypes);
db.bonusprogress = require('./bonusProgressModel.js')(sequelize, DataTypes);
db.bonusTask = require('./bonusTaskModel.js')(sequelize, DataTypes);
db.checkinRewards = require('./checkinRewardsModel.js')(sequelize, DataTypes);
db.bonusCoupon = require('./couponModel.js')(sequelize, DataTypes);
db.Role = require('./roleAdm.js')(sequelize, Sequelize.DataTypes);
db.Permission = require('./permissionAdm.js')(sequelize, Sequelize.DataTypes);
db.RolePermissionModel = require('./rolePermission.js')(sequelize, Sequelize.DataTypes); // If explicitly defined
db.checkouttrans = require('./checkoutModel.js')(sequelize, DataTypes);
db.logresponse = require('./logRespModel.js')(sequelize, DataTypes);
db.paylinks = require('./paylinkModel.js')(sequelize, DataTypes);
db.testwallet = require('./walletBal_TestModel .js')(sequelize, DataTypes);
db.raffledraw = require('./raffledrawModel.js')(sequelize, DataTypes);
db.settlements = require('./settlementModel.js')(sequelize, DataTypes);
db.remittance_accounts = require('./remittanceAccountsModel.js')(sequelize, DataTypes);
db.remittancepay = require('./remittance.js')(sequelize, DataTypes);
db.loanapply = require('./loanModel.js')(sequelize, DataTypes);
db.savelock = require('./savelockModel.js')(sequelize, DataTypes);
db.savingsads = require('./savingsAdsModel.js')(sequelize, DataTypes);
db.lockplans = require('./savingsPlansModel.js')(sequelize, DataTypes);
db.savehistory = require('./savingsHistoryModel.js')(sequelize, DataTypes);
db.loanplans = require('./loanPlansModel.js')(sequelize, DataTypes);
db.loanrepay = require('./loanRepaymentModel.js')(sequelize, DataTypes);

// db.loanpayment = require('./loanpaymentModel.js')(sequelize, DataTypes);
// db.loanrepayment = require('./loanrepaymentModel.js')(sequelize, DataTypes);




db.admin.belongsTo(db.Role, { foreignKey: 'roleId', as: 'role' });
db.Role.hasMany(db.admin, { foreignKey: 'roleId', as: 'admin' });


// Call associate on each model
Object.keys(db).forEach(modelName => {
  if (db[modelName] && db[modelName].associate) {
    db[modelName].associate(db);
  }
});


// ======================BUSINESS MODELS ======================
db.business = require('./business/businessRegModel.js')(sequelize, DataTypes);
db.bizinvites = require('./business/businessInvitesModel.js')(sequelize, DataTypes);
db.bizteam = require('./business/businessTeamModel.js')(sequelize, DataTypes);
db.bizroles = require('./business/businessRolesModel.js')(sequelize, DataTypes);
db.bizkeys = require('./business/apikeysModel.js')(sequelize, DataTypes);
db.bizwebhook = require('./business/webhookModel.js')(sequelize, DataTypes);
db.bizapirefreshtoken = require('./business/apirefreshTokenModel.js')(sequelize, DataTypes);
db.bizwebhook_logs = require('./business/webhook_logsModel.js')(sequelize, DataTypes);
db.kybver = require('./business/kybModel.js')(sequelize, DataTypes);
db.faculties = require('./business/facultyModel.js')(sequelize, DataTypes); //BNPL School Faculties
db.departments = require('./business/deptModel.js')(sequelize, DataTypes); //BNPL School Departments
db.tuitions = require('./business/schoolTuitionsModel.js')(sequelize, DataTypes);  //BNPL School Tuitions


// Business Team to Customer
db.bizteam.belongsTo(db.customers, {
    foreignKey: 'customerid',
    as: 'customer'
});
db.customers.hasMany(db.bizteam, {
    foreignKey: 'customerid',
    as: 'teams'
});

// Business to BizTeam
db.business.hasMany(db.bizteam, {
    foreignKey: 'bizid',
    as: 'teamMembers'
});
db.bizteam.belongsTo(db.business, {
    foreignKey: 'bizid',
    as: 'businessDetails'
});

db.business.hasMany(db.bizwebhook, {
    foreignKey: 'bizid',
    as: 'webhooks'
});

db.business.hasMany(db.settlements, { foreignKey: 'ownerid', constraints: false, scope: { usertype: 'business' }, as: 'settlements' });
db.settlements.belongsTo(db.business, { foreignKey: 'ownerid', constraints: false, as: 'business' });


db.bizwebhook.belongsTo(db.business, { foreignKey: 'bizid' });



db.Role.belongsToMany(db.Permission, {
  through: 'RolePermission', // Can be a string or the model: db.RolePermission
  as: 'permissions',
  foreignKey: 'roleId',
  otherKey: 'permissionId',
  timestamps: false
});
db.Permission.belongsToMany(db.Role, {
  through: 'RolePermission',
  as: 'roles',
  foreignKey: 'permissionId',
  otherKey: 'roleId',
  timestamps: false
});




/* relationship */
// Polymorphic Association for Wallets
db.customers.hasMany(db.wallets, {
    foreignKey: 'uid',
    constraints: false,
    scope: { usertype: 'personal' }, // Match the 'usertype' column
    as: 'customer_wallets'
});
db.business.hasMany(db.wallets, {
    foreignKey: 'uid',
    constraints: false,
    scope: { usertype: 'business' }, // Match the 'usertype' column
    as: 'business_wallets'
});
db.wallets.belongsTo(db.customers, { foreignKey: 'uid', constraints: false, as: 'customer' });
db.wallets.belongsTo(db.business, { foreignKey: 'uid', constraints: false, as: 'business' });


db.customers.hasMany(db.kycdoc, {
    foreignKey: 'userid',
    as: 'kycdocs',
    onDelete: 'CASCADE'
});

db.kycdoc.belongsTo(db.customers, {
    foreignKey: 'userid',
    as: 'customer',
    onDelete: 'CASCADE'
});

db.customers.hasMany(db.payn, {
    foreignKey: 'userid',
    as: 'payn',
    onDelete: 'CASCADE'
});

db.payn.belongsTo(db.customers, {
    foreignKey: 'userid',
    as: 'customer',
    onDelete: 'CASCADE'
});

db.earnings.belongsTo(db.customers, {
    foreignKey: 'userid',
    as: 'earner',
    targetKey: 'id'
});

db.earnings.belongsTo(db.customers, {
    foreignKey: 'payfrom',
    as: 'source',
    targetKey: 'id'
});

db.customers.hasMany(db.earnings, { foreignKey: 'userid', as: 'earningsReceived' });
db.customers.hasMany(db.earnings, { foreignKey: 'payfrom', as: 'earningsGenerated' });

db.audit.belongsTo(db.admin, {
    foreignKey: 'adminid',
    as: 'admin',
    targetKey: 'id'
});

db.bankacct.belongsTo(db.customers, {
    foreignKey: 'userid',
    as: 'owner',
    targetKey: 'id'
});

db.customers.hasMany(db.bankacct, {
    foreignKey: 'userid',
    as: 'bankAccounts'
});

db.vkads.belongsTo(db.customers, {
    foreignKey: 'userid',
    as: 'customer',
    targetKey: 'id'
});

db.customers.hasMany(db.vkads, {
    foreignKey: 'userid',
    as: 'vcards'
});

db.cardtrans.belongsTo(db.customers, {
    foreignKey: 'userid',
    as: 'customer',
    targetKey: 'id'
});

db.customers.hasMany(db.cardtrans, {
    foreignKey: 'userid',
    as: 'cardTransactions'
});

db.bonusTask.belongsTo(db.bonuscategory, { foreignKey: "category_id" });
db.bonuscategory.hasMany(db.bonusTask, { foreignKey: "category_id" });

db.bonusprogress.belongsTo(db.customers, { foreignKey: "userid" });
db.bonusprogress.belongsTo(db.bonusTask, { foreignKey: "task_id" });

db.referral.belongsTo(db.customers, { foreignKey: "referrer_id", as: "Referrer" });
db.referral.belongsTo(db.customers, { foreignKey: "referee_id", as: "Referee" });

db.bonusTask.hasMany(db.bonusprogress, { foreignKey: "task_id" });

// In models/accountrequest.js
db.accountrequest.belongsTo(db.customers, { foreignKey: 'userid', as: 'customer' });

// In models/customer.js
db.customers.hasMany(db.accountrequest, { foreignKey: 'userid', as: 'accountRequests' });


// db.sequelize.sync({alter : true})
db.sequelize.sync({alter : false})  //not to repeat already created db 
.then(() =>{
    console.log('yes re-sync done!')
})

/* db.sequelize.authenticate({force: false, alter : true})  //not to repeat already created db
.then(() =>{
    console.log('yes re-sync done!')
}) */

// process.on('SIGTERM', async () => {
//   logger.info('SIGTERM signal received: closing HTTP server');
//   logger.info('Closing database connection...');
//   await sequelize.close();
//   logger.info('Database connection closed');
//   logger.info('HTTP server closed');
//   process.exit(0);
// });

module.exports = db;