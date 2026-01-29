const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{

    const Loan = sequelize.define("loanapply", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: true},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        offeramount: {type:DataTypes.DECIMAL(16,2),allowNull: true, defaultValue: 0},
        duration: {type:DataTypes.INTEGER,allowNull: true},
        loantype: {type:DataTypes.STRING,allowNull: true},
        interest: {type:DataTypes.INTEGER(11), allowNull: false},  //e.g 12 in %
        totalint: {type:DataTypes.DECIMAL(16,2), allowNull: false},     //4000
        totalpayback: {type:DataTypes.DECIMAL(16,2), allowNull: false}, //104000   
        reference: {type:DataTypes.STRING(50), allowNull: true},                
        status: {type:DataTypes.STRING(11), allowNull: true},
        startdate: {type:DataTypes.INTEGER,allowNull: true},                
        paybackdate: {type:DataTypes.INTEGER,allowNull: true},    
        declinemsg: {type:DataTypes.TEXT,allowNull: true},    
        loanprofileid: {type:DataTypes.INTEGER,allowNull: true},
        downpayment: {type:DataTypes.DECIMAL(16,2),allowNull: true, defaultValue: 0},
        metedata: {type:DataTypes.TEXT,allowNull: true}
        
      }, {
        tableName: 'loanapply',
        timestamps: false
      });
            
    return Loan;
}