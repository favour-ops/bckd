const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{

    const SaveHistory = sequelize.define("lockhistory", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER,allowNull: true},
        lockref: {type:DataTypes.STRING(50),allowNull: true},
        amount: {type:DataTypes.DECIMAL(16,2),allowNull: true}, 
        currency: {type:DataTypes.STRING(50),allowNull: true},
        txref: {type:DataTypes.STRING(150), allowNull: false},        
        prevbal: {type:DataTypes.DECIMAL,allowNull: true}, 
        newbal: {type:DataTypes.DECIMAL,allowNull: true},    
        type: {type:DataTypes.STRING(20),allowNull: true},  //deposit or withdraw
        status: {type:DataTypes.INTEGER,allowNull: false},
        timed: {type:DataTypes.TEXT,allowNull: true},
      }, {
        tableName: 'lockhistory',
        timestamps: false
      });
            
    return SaveHistory;
}