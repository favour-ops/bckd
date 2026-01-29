const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Admin = sequelize.define("admdxers", {
        name: {type:DataTypes.STRING, allowNull: false},                
        email: {type:DataTypes.STRING,allowNull: false, unique: true},
        phoneno: {type:DataTypes.STRING,allowNull: false},
        auth: {type:DataTypes.STRING,allowNull: true},
        // role: {type:DataTypes.STRING,allowNull: true},
        timed: {type:DataTypes.TEXT,allowNull: true},    
        pix: {type:DataTypes.TEXT,allowNull: true},    
        status: {type:DataTypes.INTEGER,allowNull: false},
        authsecret: {type:DataTypes.STRING(200), allowNull: true},
        isonline: {type:DataTypes.INTEGER,allowNull: false},
        accesstoken: {type:DataTypes.STRING(255),allowNull: false},
        apptoken: {type:DataTypes.TEXT, allowNull: true},
        roleId: { type: DataTypes.INTEGER, allowNull: true, references: { model: 'role', key: 'id' } }
      }, {
        tableName: 'admdxers',
        timestamps: false
      });
            
    return Admin;      
}