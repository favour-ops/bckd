const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const TransLimit = sequelize.define("limit", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        tiertype: {type:DataTypes.STRING(50), allowNull: false},        
        maxinflow: {type:DataTypes.DECIMAL(16,2), allowNull: false},    //e.g 50000
        maxtransfer: {type:DataTypes.DECIMAL(16,2), allowNull: true},       //e.g 50000
        dailymaxtrans: {type:DataTypes.DECIMAL(16,2), allowNull: false},    //e.g 100000                       
        freetransfer: {type:DataTypes.INTEGER(11), allowNull: true},                    
        free_inflows: {type:DataTypes.INTEGER(11), allowNull: true},                    
      }, {
        tableName: 'limit',
        timestamps: false
      });
  
     
    return TransLimit;      
}