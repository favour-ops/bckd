const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const Faculty = sequelize.define("faculties", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        bizid: {type:DataTypes.STRING, allowNull: false}, //school id  
        name: {type:DataTypes.STRING, allowNull: true},               
        uuid: {type:DataTypes.STRING, allowNull: true},
        status: {type:DataTypes.STRING, allowNull: true}
      }, {
        tableName: 'faculties'
      });
  
     
    return Faculty;      
}