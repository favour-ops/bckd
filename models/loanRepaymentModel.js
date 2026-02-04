const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{

    const LoanRepayHistory = sequelize.define("loanrepay", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: true},
        loanref: {type:DataTypes.STRING(50),allowNull: true},
        installment: {type:DataTypes.INTEGER,allowNull: true},
        score: {type:DataTypes.INTEGER,allowNull: true},
        paywith: {type:DataTypes.STRING(50),allowNull: true},
        fxrate: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true}, 
        status: {type:DataTypes.INTEGER,allowNull: false},
        timed: {type:DataTypes.TEXT,allowNull: true},
      }, {
        tableName: 'loanrepay',
        timestamps: false
      });
            
    return LoanRepayHistory;
}