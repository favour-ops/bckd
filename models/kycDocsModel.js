const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const KYCDocs = sequelize.define("kycdocs", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false, index: true},             
        doctype: {type:DataTypes.STRING(55), allowNull: true, index: true},        
        tier: {type:DataTypes.STRING(20), allowNull: true},        
        docno: {type:DataTypes.STRING(55), allowNull: true},        
        docurl: {type:DataTypes.STRING(255), allowNull: true},        
        docstatus: {type:DataTypes.STRING(11), allowNull: true},      
        timed: {type:DataTypes.INTEGER(11), allowNull: true},
        docname: {type:DataTypes.STRING(100), allowNull: true},        
        docurl_back: {type:DataTypes.STRING(255), allowNull: true},        
        expirydate: {type:DataTypes.STRING(55), allowNull: true},        
        issuancecountry: {type:DataTypes.STRING(55), allowNull: true},        
        remark: {type:DataTypes.TEXT, allowNull: true},        
        remarkby: {type:DataTypes.STRING(100), allowNull: true},        
      }, {
        tableName: 'kycdocs',
        timestamps: false
      });

//       ALTER TABLE `hitchpy`.`kycdocs` 
// ADD COLUMN `docurl_back` VARCHAR(255) NULL AFTER `docname`,
// ADD COLUMN `expirydate` VARCHAR(50) NULL AFTER `docurl_back`;
// ADD COLUMN `issuancecountry` VARCHAR(45) NULL AFTER `expirydate`;
               
    return KYCDocs;      
}