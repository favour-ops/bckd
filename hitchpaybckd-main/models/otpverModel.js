const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const verOTP = sequelize.define("otpver", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},        
        otpcode: {type:DataTypes.STRING(11), allowNull: false},        
        usertype: {type:DataTypes.STRING(50), allowNull: false},        
        otptype: {type:DataTypes.STRING(50), allowNull: false},        
        token: {type:DataTypes.TEXT, allowNull: false},        
        timed: {type:DataTypes.STRING(255), allowNull: true},
        date_updated: {type:DataTypes.DATE, allowNull: true},
        regphone: {type:DataTypes.STRING(25), allowNull: true},
        regemail: {type:DataTypes.STRING(100), allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: false},      
        attempts: {type:DataTypes.INTEGER(11), allowNull: true}        
      }, {
        tableName: 'otpver'
      });
  
     
    return verOTP;      
}