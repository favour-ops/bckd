const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Pricing = sequelize.define("pricings", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        product: {type:DataTypes.STRING(50), allowNull: false},        
        min_amount: {type:DataTypes.DECIMAL(16, 2),allowNull: true},       
        max_amount: {type:DataTypes.DECIMAL(16, 2),allowNull: true},       
        providerfee: {type:DataTypes.DECIMAL(16, 2),allowNull: true},       
        fee: {type:DataTypes.DECIMAL(16, 2),allowNull: true},       
        fee_percentage: {type:DataTypes.DECIMAL(16, 2),allowNull: true},              
        feetype: {type:DataTypes.ENUM('fixed', 'percentage'),allowNull: false, defaultValue: 'fixed'},       
        status: {type:DataTypes.INTEGER(11), allowNull: false},    
        tierlevel: {type:DataTypes.INTEGER(11), allowNull: true},       
        currency: {type:DataTypes.STRING(20), allowNull: false},
        totalfee_cap: {type:DataTypes.DECIMAL(16, 2),allowNull: true},       
        providerfee_cap: {type:DataTypes.DECIMAL(16, 2),allowNull: true},       
      }, {
        tableName: 'pricings',
        timestamps: false
      });

    return Pricing;      
}