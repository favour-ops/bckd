const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const ResponseLog = sequelize.define("logresponse", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        reference: {type:DataTypes.STRING(50), allowNull: false},     
        ownerid: {type:DataTypes.INTEGER(11), allowNull: false},     
        jsonresp: {type:DataTypes.TEXT, allowNull: false},
        product: {type:DataTypes.STRING, allowNull: true},               
        provider: {type:DataTypes.STRING, allowNull: true}, 
        timed: {type:DataTypes.TEXT,allowNull: true}      
      }, {
        tableName: 'logresponse'
      });
  
     
    return ResponseLog;      
}