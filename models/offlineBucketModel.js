const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{

    const offlinePayn = sequelize.define("offlinepay", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        custemail: {type:DataTypes.TEXT,allowNull: false},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        amountval: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        fee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        revenue: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        pfor: {type:DataTypes.STRING(50),allowNull: true},
        prevbal: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        newbal: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        txref: {type:DataTypes.STRING(150), allowNull: true},        
        paytype: {type:DataTypes.STRING(20), allowNull: true},        
        productid: {type:DataTypes.STRING(100), allowNull: true},        
        paychannel: {type:DataTypes.STRING(20), allowNull: true},        
        pay_desc: {type:DataTypes.STRING(155), allowNull: true},        
        paidthru: {type:DataTypes.STRING(50), allowNull: true},        
        recipient: {type:DataTypes.STRING(50), allowNull: true},        
        ntwk: {type:DataTypes.STRING(50), allowNull: true},        
        ntwkid: {type:DataTypes.STRING(50), allowNull: true},        
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false},    
        meta: {type:DataTypes.TEXT, allowNull: true},
        jsonresp: {type:DataTypes.TEXT, allowNull: true},
        jsonreqst: {type:DataTypes.TEXT, allowNull: true},
        gatewayresp: {type:DataTypes.TEXT, allowNull: true}

      }, {
        tableName: 'offlinepay',
        timestamps: false
      });
            
    return offlinePayn;
}