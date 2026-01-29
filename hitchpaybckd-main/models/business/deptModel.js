const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const Dept = sequelize.define("departments", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        bizid: {type:DataTypes.STRING, allowNull: false}, //school id  
        faculty_id: {type:DataTypes.STRING, allowNull: false}, //faculty id
        name: {type:DataTypes.STRING, allowNull: true},               
        uuid: {type:DataTypes.STRING, allowNull: true},
        status: {type:DataTypes.STRING, allowNull: true}
      }, {
        tableName: 'departments'
      });
  
     
    return Dept;      
}