const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const payLinks = sequelize.define("paylinks", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: {type:DataTypes.INTEGER(11), allowNull: false},        
        usertype: {type:DataTypes.STRING(20), allowNull: false},        
        tagname: {type:DataTypes.STRING(50), allowNull: false},        
        reference: {type:DataTypes.STRING(100), allowNull: false},        
        slug: {type:DataTypes.STRING(50), allowNull: false},        
        description: {type:DataTypes.STRING(255), allowNull: true},
        currencies: {type:DataTypes.JSON, allowNull: true},   
        timed: {type:DataTypes.STRING(255), allowNull: true},
        envtype: {type:DataTypes.STRING(20), allowNull: true},        
        status: {type:DataTypes.INTEGER(11), allowNull: false}        
      }, {
        tableName: 'paylinks',
        timestamps: false
      });

    return payLinks;      
}