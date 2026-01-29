const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Beneficiary = sequelize.define("beneficiary", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        product: {type:DataTypes.STRING(20),allowNull: true},
        phoneno: {type:DataTypes.STRING(20),allowNull: true},
        network: {type:DataTypes.STRING(50),allowNull: true},
        acctname: {type:DataTypes.STRING(50),allowNull: true},
        productid: {type:DataTypes.STRING(20),allowNull: true},
        currency: {type:DataTypes.STRING(20),allowNull: true},
        routing_no: {type:DataTypes.STRING(50),allowNull: true},
        usertype: {type:DataTypes.STRING(50),allowNull: true},
        userid: {type:DataTypes.STRING,allowNull: true},
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}    
      }, {
        tableName: 'beneficiary',
        timestamps: false
      });
            
    return Beneficiary;      
}