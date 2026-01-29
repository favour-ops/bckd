const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const RequestLog = sequelize.define("logrequest", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        reference: {type:DataTypes.STRING(50), allowNull: false},        
        jsonreq: {type:DataTypes.TEXT, allowNull: false},
        product: {type:DataTypes.STRING, allowNull: true},               
        provider: {type:DataTypes.STRING, allowNull: true}, 
        timed: {type:DataTypes.TEXT,allowNull: true}      
      }, {
        tableName: 'logrequest'
      });
  
     
    return RequestLog;      
}