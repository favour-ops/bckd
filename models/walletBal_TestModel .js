const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const TestWallet = sequelize.define("sandboxwallets", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        email: {type:DataTypes.STRING,allowNull: false},
        currency: {type:DataTypes.STRING(20),allowNull: true},                
        wbal: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        ledger: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        usertype: {type:DataTypes.STRING(20),allowNull: false},
        timecreated: {type:DataTypes.TEXT,allowNull: true},
        lastupdated: {type:DataTypes.TEXT,allowNull: true},
        uid: {type:DataTypes.INTEGER(11), allowNull: false, references: {
          model: 'customers', // Name of the Customer model table
          key: 'id' // Primary key of the Customer model
        }},  
        status: {type:DataTypes.INTEGER,allowNull: false}
      }, {
        tableName: 'sandboxwallets',
        timestamps: false
      });
  
    
    return TestWallet;      
}