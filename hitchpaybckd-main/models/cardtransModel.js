const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const CardTrans = sequelize.define("cardtrans", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},                    
        amount: {type:DataTypes.DECIMAL(16,2), allowNull: true},
        provider: {type:DataTypes.STRING(20), allowNull: true},
        transtype: {type:DataTypes.STRING(20), allowNull: true},
        mode: {type:DataTypes.STRING(20), allowNull: true},
        cardid: {type:DataTypes.STRING(200), allowNull: true},
        currency: {type:DataTypes.STRING(20), allowNull: true},
        timed: {type:DataTypes.STRING(255), allowNull: true},
        status: {type:DataTypes.STRING(50), allowNull: true},
        reference: {type:DataTypes.STRING(45), allowNull: true},
        description: {type:DataTypes.STRING(150), allowNull: true},
        merchant: {type:DataTypes.STRING(50), allowNull: true},
        merchantdesc: {type:DataTypes.TEXT, allowNull: true},
      }, {
        tableName: 'cardtrans',
        timestamps: false
      });

    return CardTrans;      
}