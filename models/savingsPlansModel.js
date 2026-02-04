const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const lockPlans = sequelize.define("savingsplans", {    
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},        
        planname: {type:DataTypes.STRING,allowNull: true},
        days: {type:DataTypes.STRING,allowNull: true},
        interest: {type:DataTypes.DECIMAL(16, 2),allowNull: true},  //in percentage
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}    
      }, {
        tableName: 'savingsplans',
        timestamps: false
      });
            
    return lockPlans;      
}