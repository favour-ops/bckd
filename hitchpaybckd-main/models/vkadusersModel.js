//this  table houses all users account details created with external partners e.g card etc
const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const CardUsers = sequelize.define("vcardsaccount", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},              
        trackingid: {type:DataTypes.STRING(50), allowNull: false},        
        tier: {type:DataTypes.INTEGER(11), allowNull: true},
        timed: {type:DataTypes.STRING(255), allowNull: true},
        provider: {type:DataTypes.STRING(20), allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: true},
        verstate: {type:DataTypes.STRING(50), allowNull: true},
        verification_id: {type:DataTypes.STRING(50), allowNull: true},
        persona_inquiry_id: {type:DataTypes.STRING(50), allowNull: true},
        persona_state: {type:DataTypes.STRING(50), allowNull: true},
        customer_state: {type:DataTypes.STRING(50), allowNull: true},
        link_token: {type:DataTypes.STRING(255), allowNull: true},
        link_state: {type:DataTypes.STRING(50), allowNull: true},     
        workflow_id: {type:DataTypes.STRING(50), allowNull: true},    
        fiat_account_guid: {type:DataTypes.STRING(100), allowNull: true}, 
        fiat_account_state: {type:DataTypes.STRING(50), allowNull: true}, 
      }, {
        tableName: 'vcardsaccount',
        timestamps: false
      });
  
      
    
    return CardUsers;      
}