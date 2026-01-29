const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BusinessTeam = sequelize.define("bizteam", {
        id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
        bizid: {type:DataTypes.INTEGER,allowNull: true},
        customerid: {type:DataTypes.INTEGER,allowNull: true}, //from custoner tbl
        role: {type:DataTypes.STRING, allowNull: true},        
        staffid: {type:DataTypes.STRING,allowNull: false},
        staffpin: {type:DataTypes.STRING,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false},
        can_debit: {type:DataTypes.INTEGER,allowNull: true},  //0-disable or 1 - enable
        timed: {type:DataTypes.STRING(50), allowNull: true},                 
      }, {
        tableName: 'bizteam',
        timestamps: false
      });
  
    
    return BusinessTeam;      
}