const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const RemittancePay = sequelize.define("remittancepay", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},   
        amount: {type:DataTypes.DECIMAL(16,2), allowNull: false},
        customer_guid: {type:DataTypes.STRING(100), allowNull: true},
        fiat_account_guid: {type:DataTypes.STRING(100), allowNull: true},
        external_bank_guid: {type:DataTypes.STRING(100), allowNull: true},
        fee: {type:DataTypes.DECIMAL(16,2), allowNull: true},
        deliver_amount: {type:DataTypes.DECIMAL(16,2), allowNull: true},
        deposit_guid: {type:DataTypes.STRING(100), allowNull: true},
        quote_guid: {type:DataTypes.STRING(100), allowNull: true},
        provider: {type:DataTypes.STRING(20), allowNull: true},
        timed: {type:DataTypes.STRING(50), allowNull: true},
        status: {type:DataTypes.STRING(11), allowNull: true},    
        jsonresp: {type:DataTypes.TEXT, allowNull: true}, 
        reference: {type:DataTypes.STRING(50), allowNull: true}

      }, {
        tableName: 'remittancepay',
        timestamps: false
      });
  
     
    return RemittancePay;      
}