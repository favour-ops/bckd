const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const refreshToken = sequelize.define("refreshtoken", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},        
        accesstoken: {type:DataTypes.STRING(255), allowNull: false},                        
        timed: {type:DataTypes.STRING(255), allowNull: true},
        expiredtime: {type:DataTypes.STRING, allowNull: true},
        usertype: {type:DataTypes.STRING, allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: false},
        jti: {type:DataTypes.STRING(255), allowNull: true},                        
      }, {
        tableName: 'refreshtoken'
      });
  
      
    
    return refreshToken;      
}