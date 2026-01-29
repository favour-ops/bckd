const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const InvAds = sequelize.define("savingsads", {    
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},        
        plan: {type:DataTypes.STRING,allowNull: true},
        plantype: {type:DataTypes.STRING,allowNull: true},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        interest: {type:DataTypes.INTEGER,allowNull: true},
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}    
      }, {
        tableName: 'savingsads',
        timestamps: false
      });
            
    return InvAds;      
}