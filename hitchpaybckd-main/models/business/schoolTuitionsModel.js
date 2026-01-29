const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const TuitionFees = sequelize.define("tuitions", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        dept_id: {type:DataTypes.STRING, allowNull: false},
        amount: {type:DataTypes.DECIMAL(16,2), allowNull: true},  
        portalfee: {type:DataTypes.DECIMAL(16,2), allowNull: true},     
        paytypeid: {type:DataTypes.STRING, allowNull: true},
        paytype: {type:DataTypes.STRING, allowNull: true},        
        loan_type: {type:DataTypes.STRING, allowNull: true},  //e.g bnpl, installment
        description: {type:DataTypes.STRING, allowNull: true},
        schoolid: {type:DataTypes.STRING, allowNull: true},
        facultyid: {type:DataTypes.STRING, allowNull: true},
        deptid: {type:DataTypes.STRING, allowNull: true},
        currency: {type:DataTypes.STRING, allowNull: true},
        status: {type:DataTypes.STRING, allowNull: true}
      }, {
        tableName: 'tuitions',
        timestamps: false
      });
  
     
    return TuitionFees;      
}