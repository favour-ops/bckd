const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Notify = sequelize.define("notify", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        uid: {type:DataTypes.INTEGER(11), allowNull: false},                
        notetype: {type:DataTypes.STRING(50), allowNull: false},        
        usertype: {type:DataTypes.STRING(50), allowNull: false},        
        notecontent: {type:DataTypes.TEXT, allowNull: false},                              
        status: {type:DataTypes.STRING(11), allowNull: true},                
        dated: {type:DataTypes.DATE, allowNull: true}        
      }, {
        tableName: 'notify'
      });
  
     
    return Notify;      
}