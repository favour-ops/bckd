const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const RemittanceAccount = sequelize.define("remittance_account", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},   
        bankname: {type:DataTypes.STRING(50), allowNull: true},        
        provider: {type:DataTypes.STRING(20), allowNull: true},        
        accountno: {type:DataTypes.STRING(20), allowNull: true},        
        accountname: {type:DataTypes.STRING(150), allowNull: true},                              
        accounttype: {type:DataTypes.STRING(20), allowNull: true},                              
        token_id: {type:DataTypes.STRING(100), allowNull: true},                              
        customer_guid: {type:DataTypes.STRING(100), allowNull: true},  
        external_bank_guid: {type:DataTypes.STRING(100), allowNull: true},   
        external_bank_state: {type:DataTypes.STRING(50), allowNull: true},   
        account_mask: {type:DataTypes.STRING(50), allowNull: true},   
        bank_env: {type:DataTypes.STRING(50), allowNull: true},   
        asset: {type:DataTypes.STRING(50), allowNull: true},   
        verification_id: {type:DataTypes.STRING(50), allowNull: true},
        verification_state: {type:DataTypes.STRING(50), allowNull: true},
        persona_inquiry_id: {type:DataTypes.STRING(50), allowNull: true},
        persona_state: {type:DataTypes.STRING(50), allowNull: true},
        customer_state: {type:DataTypes.STRING(50), allowNull: true},
        link_token: {type:DataTypes.STRING(255), allowNull: true},
        link_state: {type:DataTypes.STRING(50), allowNull: true},     
        workflow_id: {type:DataTypes.STRING(255), allowNull: true},                                                 
        type: {type:DataTypes.STRING(50), allowNull: true},  //bank / card
        status: {type:DataTypes.STRING(11), allowNull: true},    
        jsonresp: {type:DataTypes.TEXT, allowNull: true},
        plaid_token: {type:DataTypes.STRING(255), allowNull: true},
        plaid_account_id: {type:DataTypes.STRING(150), allowNull: true},

      }, {
        tableName: 'remittance_account',
        timestamps: false
      });
  
     
    return RemittanceAccount;      
}