const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{

    const Checkout = sequelize.define("checkouttrans", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        ownerid: {type:DataTypes.INTEGER,allowNull: true},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        payment_amount: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        reference: {type:DataTypes.STRING(150), allowNull: true},        
        provref: {type:DataTypes.STRING(150), allowNull: true},        
        fee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        amountsettled: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        revenue: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        providerfee: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        accountno: {type:DataTypes.STRING(20), allowNull: true},   //e.g usd
        currency: {type:DataTypes.STRING(20), allowNull: true},   //e.g usd
        customer_name: {type:DataTypes.STRING(50),allowNull: true},
        customer_email: {type:DataTypes.STRING(50),allowNull: true},
        usertype: {type:DataTypes.STRING(50),allowNull: true},   //business/personal
        prevbal: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        newbal: {type:DataTypes.DECIMAL(16,2),allowNull: true},
        productid: {type:DataTypes.STRING(100), allowNull: true},    //e.g delightpay
        paychannel: {type:DataTypes.STRING(20), allowNull: true},   //e.g checkout
        pay_desc: {type:DataTypes.STRING(155), allowNull: true},                
        paidthru: {type:DataTypes.STRING(50), allowNull: true},    //e.g stripe, yc
        timed: {type:DataTypes.INTEGER,allowNull: true, index: true},
        payment_date: {type:DataTypes.INTEGER,allowNull: true, index: true},
        status: {type:DataTypes.INTEGER,allowNull: false, index: true},    
        meta: {type:DataTypes.TEXT, allowNull: true},
        external_reference: {type:DataTypes.STRING(50), allowNull: true},
        redirecturl: {type:DataTypes.STRING(225), allowNull: true},
        mode: {type:DataTypes.STRING(20), allowNull: true},
        multicurrency: {type:DataTypes.INTEGER(11), allowNull: true},
        settled: {type:DataTypes.INTEGER(11), allowNull: true},
        settlemet_reference: {type:DataTypes.STRING(50), allowNull: true},
        paymethod: {type:DataTypes.STRING(50), allowNull: true},
        ipaddress: {type:DataTypes.STRING(50), allowNull: true},
        useragent: {type:DataTypes.TEXT, allowNull: true},
        // jsonresp: {type:DataTypes.TEXT, allowNull: true},

      }, {
        tableName: 'checkouttrans',
        timestamps: false
      });

      
    return Checkout;
}