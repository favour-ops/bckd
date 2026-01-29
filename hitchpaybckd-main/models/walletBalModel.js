const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const MWallet = sequelize.define("thewallets", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        email: {type:DataTypes.STRING,allowNull: false},
        currency: {type:DataTypes.STRING(20),allowNull: true},                
        wbal: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        ledger: {type:DataTypes.DECIMAL(16,2),allowNull: false},
        usertype: {type:DataTypes.STRING(20),allowNull: false},  //personal or business
        timecreated: {type:DataTypes.TEXT,allowNull: true},
        lastupdated: {type:DataTypes.TEXT,allowNull: true},
        uid: {type:DataTypes.INTEGER(11), allowNull: false}, // This column will store the ID of either a customer or a business
        status: {type:DataTypes.INTEGER,allowNull: false}
      }, {
        tableName: 'thewallets',
        timestamps: false
      });
  
    
    return MWallet;      
}