const { Timestamp } = require('firebase-admin/firestore');
const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Audit = sequelize.define("auditlogs", {            
        adminid: {type:DataTypes.STRING,allowNull: true},
        description: {type:DataTypes.TEXT,allowNull: false},
        timed: {type:DataTypes.DATE, allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}    
      }, {
        tableName: 'auditlogs',
        timestamps: false
      });
            
    return Audit;      
}