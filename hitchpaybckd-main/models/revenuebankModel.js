const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const RevenueBank = sequelize.define("revenuebank", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},       
        totalcount: {type:DataTypes.INTEGER,allowNull: true}, 
        dated: {type:DataTypes.INTEGER,allowNull: true, index: true},   
        datefrom: {type:DataTypes.INTEGER,allowNull: true, index: true},   
        dateto: {type:DataTypes.INTEGER,allowNull: true, index: true},   
        settleby:{type:DataTypes.STRING,allowNull: true},
        reference:{type:DataTypes.STRING,allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: false, defaultValue: 0, index: true}        
      }, {
        tableName: 'revenuebank',
        timestamps: false
      });

    return RevenueBank;      
}