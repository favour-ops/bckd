const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Earning = sequelize.define("earnings", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: false},
        payfrom: {type:DataTypes.STRING(20), allowNull: true},
        amount: {type:DataTypes.DECIMAL,allowNull: true},
        type: {type:DataTypes.STRING,allowNull: true}, //cashback or referral
        product: {type:DataTypes.STRING,allowNull: true}, //e.g MTN Airtime
        reference: {type:DataTypes.STRING,allowNull: true}, 
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}    
      }, {
        tableName: 'earnings',
        timestamps: false
      });
            
    return Earning;      
}