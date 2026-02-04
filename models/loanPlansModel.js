const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const loansPlans = sequelize.define("loanplans", {    
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},        
        planname: {type:DataTypes.STRING,allowNull: true},
        days: {type:DataTypes.STRING,allowNull: true},
        rate: {type:DataTypes.DECIMAL(16, 2),allowNull: true},  //in percentage
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}    
      }, {
        tableName: 'loanplans',
        timestamps: false
      });
            
    return loansPlans;      
}

