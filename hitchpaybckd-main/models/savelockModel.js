const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const Payn = sequelize.define("savelock", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: true},
        amount: {type:DataTypes.DECIMAL,allowNull: true},
        // target: {type:DataTypes.DECIMAL,allowNull: true},
        lockcategory: {type:DataTypes.STRING(50),allowNull: true},  //target, voluntary, regular
        locktype: {type:DataTypes.STRING(50),allowNull: true},  //monthly, quaterly, annual
        title: {type:DataTypes.STRING(150), allowNull: true},        
        reference: {type:DataTypes.STRING(150), allowNull: false},        
        regcode: {type:DataTypes.STRING(20), allowNull: false},        
        rmcode: {type:DataTypes.STRING(20), allowNull: false},         
        // startdate: {type:DataTypes.TEXT,allowNull: true},
        // enddate: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}, //0 pending approval, 2 - approved/running, 1 - declined, 3 - withdrawn
        submittedby: {type:DataTypes.STRING,allowNull: true},
        approvedby: {type:DataTypes.STRING,allowNull: true},
        initiatedby: {type:DataTypes.STRING(20),allowNull: true},
        timed: {type:DataTypes.TEXT,allowNull: true},
        plandatewithdraw: {type:DataTypes.TEXT,allowNull: true},
        timedupdated: {type:DataTypes.TEXT,allowNull: true}

      }, {
        tableName: 'savelock',
        timestamps: false
      });
            
    return Payn;
}