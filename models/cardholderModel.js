const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const CardHolders = sequelize.define("vkardholders", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},              
        trackingid: {type:DataTypes.STRING(50), allowNull: false},        
        provider: {type:DataTypes.STRING(20), allowNull: true},
        cardbrand: {type:DataTypes.STRING(50), allowNull: true},
        cardtype: {type:DataTypes.STRING(20), allowNull: true},
        cardname: {type:DataTypes.STRING(100), allowNull: true},
        cardno: {type:DataTypes.STRING(50), allowNull: true},
        cardcolor: {type:DataTypes.STRING(50), allowNull: true},
        cardtagname: {type:DataTypes.STRING(50), allowNull: true},
        expirydate: {type:DataTypes.STRING(20), allowNull: true},
        expirymonth: {type:DataTypes.STRING(20), allowNull: true},
        cardid: {type:DataTypes.STRING(200), allowNull: true},
        cvv: {type:DataTypes.STRING(20), allowNull: true},
        currency: {type:DataTypes.STRING(20), allowNull: true},
        timed: {type:DataTypes.STRING(255), allowNull: true},
        status: {type:DataTypes.STRING(11), allowNull: true},  //  0 - terminated/deleted, 1 - active, 2 - hold by admin, 3 - freezed
        jsonresp: {type:DataTypes.TEXT, allowNull: true},
        prefund: {type:DataTypes.DECIMAL(16,2), allowNull: true},
        custref: {type:DataTypes.STRING(45), allowNull: true},
        address: {type:DataTypes.TEXT, allowNull: true},
      }, {
        tableName: 'vkardholders',
        timestamps: false
      });

      // ALTER TABLE `hitchpay`.`vkardholders` 
      // ADD COLUMN `prefund` DECIMAL(16,2) NULL AFTER `jsonresp`,
      // ADD COLUMN `custref` VARCHAR(45) NULL AFTER `prefund`;
      // ADD COLUMN `address` TEXT NULL AFTER `custref`;
      // ADD COLUMN `cardname` VARCHAR(100) NULL AFTER `cardno`;

  

    return CardHolders;      
}