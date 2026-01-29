const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const resetPass = sequelize.define("password_reset", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},        
        token: {type:DataTypes.STRING(20), allowNull: false},        
        usertype: {type:DataTypes.STRING(20), allowNull: false},        
        authtoken: {type:DataTypes.STRING(355), allowNull: false},        
        timed: {type:DataTypes.STRING(255), allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: false}        
      }, {
        tableName: 'password_reset'
      });
  
      
    
    return resetPass;      
}