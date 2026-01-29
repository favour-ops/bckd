'use strict';
// Ensure environment variables are loaded. This is crucial.
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const Sequelize = require('sequelize');
const basename = path.basename(__filename);

const db = {};

// Build the configuration object directly from environment variables
const config = {
  username: process.env.DB_USER,
  password: process.env.DB_PW,
  database: process.env.DB_NAME,
  host: process.env.DB_HOST,
  dialect: process.env.DB_DIALECT || 'mysql', // Default to mysql if not specified
  // Add other Sequelize options here if needed, e.g., for connection pooling
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
  if (process.env.DATABASE_URL) {
    sequelize = new Sequelize(process.env.DATABASE_URL, config);
  } else {
    console.error('Database configuration is incomplete. Please check your connection file.');
    process.exit(1); // Exit if DB config is missing
  }
}

fs
  .readdirSync(__dirname)
  .filter(file => {
    return (
      file.indexOf('.') !== 0 &&
      file !== basename &&
      file.slice(-3) === '.js' &&
      file.indexOf('.test.js') === -1
    );
  })
  .forEach(file => {
    const model = require(path.join(__dirname, file))(sequelize, Sequelize.DataTypes);
    db[model.name] = model;
  });

// =================================================================
// == MANUAL ASSOCIATION DEFINITIONS
// =================================================================
// After all models are loaded automatically, their relationships are defined here.
db.admin.belongsTo(db.Role, { foreignKey: 'roleId', as: 'role' });
db.Role.hasMany(db.admin, { foreignKey: 'roleId', as: 'admin' });

db.Role.belongsToMany(db.Permission, {
    through: 'RolePermission',
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

db.customers.hasMany(db.wallets, {
    foreignKey: 'uid', // The foreign key in the Wallets table
    as: 'wallets', // Alias for the association (used in include)
    onDelete: 'CASCADE' // Add this line
});

db.wallets.belongsTo(db.customers, {
    foreignKey: 'uid',
    as: 'customer',
    onDelete: 'CASCADE' // Add this line
});

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
    as: 'customer', // This alias should match the one in Payn model if defined
    onDelete: 'CASCADE'
});

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

// =================================================================

db.sequelize = sequelize;
db.Sequelize = Sequelize;

// db.sequelize.sync({alter : true})
db.sequelize.sync({alter : false})  //not to repeat already created db 
.then(() =>{
    console.log('yes re-sync done!')
})
module.exports = db;