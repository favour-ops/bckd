const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const AccountRequest = sequelize.define("account_request", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        currency: {type:DataTypes.STRING(50), allowNull: false},        
        userid: {type:DataTypes.INTEGER(11),allowNull: true}, 
        jsonreq: {type:DataTypes.TEXT, allowNull: true},      
        jsonresp: {type:DataTypes.TEXT, allowNull: true},      
        timed: {type:DataTypes.INTEGER,allowNull: true, index: true},
        provider: {type:DataTypes.STRING(50), allowNull: true},
        account_id: {type:DataTypes.STRING(50), allowNull: true},
        reference: {type:DataTypes.STRING(50), allowNull: true},
        payref: {type:DataTypes.STRING(50), allowNull: true},
        decline_reason: {type:DataTypes.TEXT, allowNull: true},      
        meta: {type:DataTypes.TEXT, allowNull: true},      
        status: {type:DataTypes.INTEGER(11), allowNull: false}
      }, {
        tableName: 'account_request',
        timestamps: false
      });

    return AccountRequest;      
}