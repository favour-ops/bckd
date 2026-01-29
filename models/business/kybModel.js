const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) =>{
    const verKYB = sequelize.define("kybver", {
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        bizid: {type:DataTypes.INTEGER(11), allowNull: false},        
        otpcode: {type:DataTypes.STRING(11), allowNull: true},               
        idnumber: {type:DataTypes.STRING(20), allowNull: true},               
        vertype: {type:DataTypes.STRING(20), allowNull: true},               
        verfname: {type:DataTypes.STRING, allowNull: true},               
        verlname: {type:DataTypes.STRING, allowNull: true},               
        verdob: {type:DataTypes.STRING, allowNull: true},               
        verphone: {type:DataTypes.STRING, allowNull: true},               
        veremail: {type:DataTypes.STRING, allowNull: true},               
        gender: {type:DataTypes.STRING, allowNull: true},               
        avatar: {type:DataTypes.TEXT, allowNull: true},               
        verid: {type:DataTypes.STRING(255), allowNull: true},        
        timed: {type:DataTypes.STRING(255), allowNull: true},
        jsonresp: {type:DataTypes.TEXT, allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: false},
        provider: {type:DataTypes.STRING(50), allowNull: true},
        // tier: {type:DataTypes.INTEGER(11), allowNull: true, defaultValue: 0},
        session: {type:DataTypes.TEXT, allowNull: true},
        docname: {type:DataTypes.STRING(100), allowNull: true},        
        docurl: {type:DataTypes.STRING(255), allowNull: true},        
        docurl_back: {type:DataTypes.STRING(255), allowNull: true},        
        expirydate: {type:DataTypes.STRING(55), allowNull: true},        
        issuancecountry: {type:DataTypes.STRING(55), allowNull: true},        
        metainfo: {type:DataTypes.TEXT, allowNull: true}
      }, {
        tableName: 'kybver'
      });
  
     
    return verKYB;      
}

//