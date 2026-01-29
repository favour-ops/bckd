const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const bonusCoupon = sequelize.define("bonusCoupon", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},             
        name: {type:DataTypes.STRING,allowNull: false},
        amount: {type:DataTypes.STRING,allowNull: false},
        scope: {type:DataTypes.STRING,allowNull: false},
        product: {type:DataTypes.STRING,allowNull: true},
        usage_quantity: {type:DataTypes.INTEGER,allowNull: true},
        validity_date: {type:DataTypes.TEXT,allowNull: true},
        timecreated: {type:DataTypes.TEXT,allowNull: true},
        is_active: {type:DataTypes.INTEGER,allowNull: true},
        used_by: {type:DataTypes.TEXT,allowNull: true},
        assigned: {type:DataTypes.TEXT,allowNull: true},
        assigned_coupon: {type:DataTypes.STRING,allowNull: true},
        min_amount: {type:DataTypes.DECIMAL(16, 2), allowNull: true},
        // validity_date: {type:DataTypes.DATEONLY,allowNull: true}, // Changed from validity for clarity
        // status: {type:DataTypes.ENUM("unused", "used"), defaultValue: "unused"}
      }, {
        tableName: 'bonuscoupons',
        timestamps: false
      });
    
    return bonusCoupon;      
}