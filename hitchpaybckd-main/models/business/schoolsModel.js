const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const skulEnroll = sequelize.define("schools", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        bizid: {type:DataTypes.INTEGER(11), allowNull: false},        
        name: {type:DataTypes.STRING, allowNull: true},               
        slug: {type:DataTypes.STRING, allowNull: true},               
        
      }, {
        tableName: 'schools'
      });
  
     
    return skulEnroll;      
}