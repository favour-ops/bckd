const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const Savings = sequelize.define("savelock", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: true},
        amount: {type:DataTypes.DECIMAL,allowNull: true},
        interest: {type:DataTypes.DECIMAL(16,2),allowNull: true},  //in percentage
        totalpayback: {type:DataTypes.DECIMAL(16,2),allowNull: true},  //in percentage
        planid: {type:DataTypes.INTEGER,allowNull: true},
        planname: {type:DataTypes.STRING(150),allowNull: true},
        lockid: {type:DataTypes.STRING(150),allowNull: true},
        days: {type:DataTypes.INTEGER,allowNull: true},
        fundingsource: {type:DataTypes.STRING(150),allowNull: true},
        type: {type:DataTypes.STRING(50),allowNull: true},  //e.g smartsaver
        currency: {type:DataTypes.STRING(150),allowNull: true},
        withdrawdate: {type:DataTypes.TEXT,allowNull: true},
        depositdate: {type:DataTypes.TEXT,allowNull: true},
        rate: {type:DataTypes.STRING(150),allowNull: true},     
        title: {type:DataTypes.STRING(150), allowNull: true},
        reference: {type:DataTypes.STRING(150), allowNull: false},
        status: {type:DataTypes.INTEGER,allowNull: false}, //0 pending approval, 1 - approved/running, 3 - declined,  - withdrawn
        timed: {type:DataTypes.TEXT,allowNull: true},
        timedupdated: {type:DataTypes.TEXT,allowNull: true}

      }, {
        tableName: 'savelock',
        timestamps: false
      });
            
    return Savings;
}