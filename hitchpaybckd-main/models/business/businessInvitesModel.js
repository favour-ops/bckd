const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BusinessInvite = sequelize.define("bizinvites", {
        id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
        business_id: {type:DataTypes.INTEGER,allowNull: true},
        name: {type:DataTypes.STRING,allowNull: true},
        email: {type:DataTypes.STRING,allowNull: false, unique: true},
        phoneno: {type:DataTypes.STRING, allowNull: true},        
        assignrole: {type:DataTypes.STRING, allowNull: true},        
        staffid: {type:DataTypes.STRING,allowNull: false},
        staffpin: {type:DataTypes.STRING,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false},
        timed: {type:DataTypes.STRING(50), allowNull: true}              
      }, {
        tableName: 'bizinvites',
        timestamps: false
      });
  
    
    return BusinessInvite;  
}