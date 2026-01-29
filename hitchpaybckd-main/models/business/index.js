const bizRegModel = require('./businessRegModel');
const bizInviteModel = require('./businessInvitesModel');
const bizRoleModel = require('./businessRolesModel');
const bizTeamModel = require('./businessTeamModel');
const webhookModel = require('./webhookModel');
const webhook_LogsModel = require('./webhook_logsModel');
const kybModel = require('./kybModel');

module.exports = {
  ...bizRegModel,
  ...bizInviteModel,
  ...bizRoleModel,
  ...bizTeamModel,
  ...webhookModel,
  ...webhook_LogsModel,
  ...kybModel
};


// 'use strict';

// require('dotenv').config();
// const {Sequelize, DataTypes, BelongsTo} = require('sequelize');

// const db = {};
// let sequelize;
// db.Sequelize = Sequelize
// db.sequelize = sequelize

// db.business = require('./businessRegModel')(sequelize, DataTypes);

// db.businesskyc = require('./businessKycModel')(sequelize, DataTypes);
// db.businessacct = require('./businessAcctModel')(sequelize, DataTypes);
// db.businesswallet = require('./businessWalletModel')(sequelize, DataTypes);
// db.businessuser = require('./businessUserModel')(sequelize, DataTypes);
// db.businessrole = require('./businessRoleModel')(sequelize, DataTypes);
// db.businesspermission = require('./businessPermissionModel')(sequelize, DataTypes);
// db.businessrolepermission = require('./businessRolePermissionModel')(sequelize, DataTypes);


/* db.business.hasMany(db.businesskyc, {
    foreignKey: 'businessId',
    as: 'kyc_documents',
    onDelete: 'CASCADE'
});
db.businesskyc.belongsTo(db.business, {
    foreignKey: 'businessId',
    as: 'business_info'
});

db.business.hasMany(db.businessacct, {
    foreignKey: 'businessId',
    as: 'bank_accounts',
    onDelete: 'CASCADE'
});
db.businessacct.belongsTo(db.business, {
    foreignKey: 'businessId',
    as: 'business_info'
});

db.business.hasMany(db.businesswallet, {
    foreignKey: 'businessId',
    as: 'wallets',
    onDelete: 'CASCADE'
});
db.businesswallet.belongsTo(db.business, {
    foreignKey: 'businessId',
    as: 'business_info'
});

db.business.hasMany(db.businessuser, {
    foreignKey: 'businessId',
    as: 'users',
    onDelete: 'CASCADE'
});
db.businessuser.belongsTo(db.business, {
    foreignKey: 'businessId',
    as: 'business_info'
});

// Business User to Business Role
db.businessuser.belongsTo(db.businessrole, { foreignKey: 'roleId', as: 'role' });
db.businessrole.hasMany(db.businessuser, { foreignKey: 'roleId', as: 'users' });

// Business Role to Business Permission (Many-to-Many)
db.businessrole.belongsToMany(db.businesspermission, { through: db.businessrolepermission });
db.businesspermission.belongsToMany(db.businessrole, { through: db.businessrolepermission }); */

// module.exports = db;