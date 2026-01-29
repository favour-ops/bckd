const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BusinessUser = sequelize.define("business", {
        id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
        business_name: {type:DataTypes.STRING, allowNull: true, unique: true},               
        business_email: {type:DataTypes.STRING,allowNull: false},
        business_phoneno: {type:DataTypes.STRING,allowNull: false},            
        business_type: {type:DataTypes.STRING, allowNull: true},
        business_address: {type:DataTypes.STRING, allowNull: true},
        business_city: {type:DataTypes.STRING, allowNull: true},
        business_state: {type:DataTypes.STRING, allowNull: true},
        trade_name: {type:DataTypes.STRING, allowNull: true},
        business_country: {type:DataTypes.STRING, allowNull: true},
        business_description: {type:DataTypes.TEXT, allowNull: true},
        ownerid: {type:DataTypes.INTEGER,allowNull: false},
        cacno: {type:DataTypes.STRING(50),allowNull: true},
        cacreg_type: {type:DataTypes.STRING(50),allowNull: true},
        cacreg_cert: {type:DataTypes.TEXT,allowNull: true},
        logo: {type:DataTypes.STRING,allowNull: true},                              
        isverified: {type:DataTypes.INTEGER,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false},
        accounttier: {type:DataTypes.INTEGER(11),allowNull: true},
        env: {type:DataTypes.STRING(20), allowNull: true},        //reg channel e.g web or app
        postalcode: {type:DataTypes.STRING(20),allowNull: true},                  
        regtime: {type:DataTypes.STRING(50), allowNull: true},
        uuid: {type:DataTypes.CHAR(36), defaultValue: DataTypes.UUIDV4, unique: true},
        bnpl_enabled: {type:DataTypes.INTEGER,allowNull: true},
      }, {
        tableName: 'business',
        timestamps: false
      });
  
    
    return BusinessUser;      
}