const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{

    const Payments = sequelize.define("payments", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: true},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        amountval: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        fee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        revenue: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        providerfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        pfor: {type:DataTypes.STRING(50),allowNull: true},
        prevbal: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        newbal: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        txref: {type:DataTypes.STRING(150), allowNull: true},        
        paytype: {type:DataTypes.STRING(20), allowNull: true},        
        productid: {type:DataTypes.STRING(100), allowNull: true},        
        paychannel: {type:DataTypes.STRING(20), allowNull: true},        
        pay_desc: {type:DataTypes.STRING(155), allowNull: true},        
        narration: {type:DataTypes.STRING(155), allowNull: true},        
        paidthru: {type:DataTypes.STRING(50), allowNull: true},        
        recipient: {type:DataTypes.STRING(50), allowNull: true},        
        ntwk: {type:DataTypes.STRING(50), allowNull: true},        
        ntwkid: {type:DataTypes.STRING(50), allowNull: true},        
        timed: {type:DataTypes.INTEGER,allowNull: true, index: true},
        status: {type:DataTypes.INTEGER,allowNull: false, index: true},    
        meta: {type:DataTypes.TEXT, allowNull: true},
        payroute: {type:DataTypes.STRING(20), allowNull: true},
        jsonresp: {type:DataTypes.TEXT, allowNull: true},
        currency: {type:DataTypes.STRING(20), allowNull: true},
        settlement_route: {type:DataTypes.STRING(20), allowNull: true},
        usertype: {type:DataTypes.STRING(20), allowNull: true},  //business or personal
        provref: {type:DataTypes.STRING(100), allowNull: true},
        rate: {type:DataTypes.DECIMAL(16,4),allowNull: true}

      }, {
        tableName: 'payments',
        timestamps: false
      });
            
    return Payments;
}