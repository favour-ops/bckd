const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BusinessRoles = sequelize.define("bizroles", {
        id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
        name: {type:DataTypes.STRING,allowNull: true}, //from custoner tbl
        desc: {type:DataTypes.TEXT, allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}
      }, {
        tableName: 'bizroles',
        timestamps: false
      });
  
    
    return BusinessRoles;  
}