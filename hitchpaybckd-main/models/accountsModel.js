const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BankAccount = sequelize.define("bankaccounts", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},                
        inactive: {type:DataTypes.INTEGER(11), allowNull: false},                
        bankname: {type:DataTypes.STRING(50), allowNull: false},        
        provider: {type:DataTypes.STRING(20), allowNull: false},        
        accountno: {type:DataTypes.STRING(20), allowNull: false},        
        accountname: {type:DataTypes.STRING(150), allowNull: true},                              
        bankcode: {type:DataTypes.STRING(20), allowNull: true},                              
        currency: {type:DataTypes.STRING(20), allowNull: true},                              
        accounttype: {type:DataTypes.STRING(20), allowNull: true},                              
        trackid: {type:DataTypes.STRING(100), allowNull: true},                              
        trackingref: {type:DataTypes.STRING(20), allowNull: true},                              
        usertype: {type:DataTypes.STRING(20), allowNull: true},                              
        status: {type:DataTypes.STRING(11), allowNull: true},    
        jsonresp: {type:DataTypes.TEXT, allowNull: true}                
      }, {
        tableName: 'bankaccounts',
        timestamps: false
      });
  
     
    return BankAccount;      
}