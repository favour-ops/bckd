const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const payWhook = sequelize.define("whpaywhks", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},        
        resp: {type:DataTypes.TEXT, allowNull: false},        
        timed: {type:DataTypes.STRING(20), allowNull: true},
        dated: {type:DataTypes.STRING(20), allowNull: true},
        gateway: {type:DataTypes.STRING, allowNull: true},
        txref: {type:DataTypes.STRING, allowNull: false},
        processed: {type:DataTypes.INTEGER, allowNull: false}           
      }, {
        tableName: 'whpaywhks',
        timestamps: false
      });
  
      
    
    return payWhook;      
}