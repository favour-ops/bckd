const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const AddressVer = sequelize.define("addressver", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},                
        tier: {type:DataTypes.INTEGER(11), allowNull: true},   
        status: {type:DataTypes.INTEGER(11), allowNull: true},   
        timed: {type:DataTypes.INTEGER,allowNull: true, index: true},         
      }, {
        tableName: 'addressver',
        timestamps: false
      });
  
     
    return AddressVer;      
}