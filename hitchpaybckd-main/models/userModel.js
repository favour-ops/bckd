const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Customer = sequelize.define("customers", {
        id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
        lastname: {type:DataTypes.STRING, allowNull: true},        
        firstname: {type:DataTypes.STRING, allowNull: true},   
        middlename: {type:DataTypes.STRING, allowNull: true},   
        email: {type:DataTypes.STRING,allowNull: false},
        maritalstatus: {type:DataTypes.STRING(50),allowNull: true},
        phoneno: {type:DataTypes.STRING,allowNull: false},            
        refcode: {type:DataTypes.STRING(20),allowNull: true},                              
        referby: {type:DataTypes.STRING(20),allowNull: true},                              
        authy: {type:DataTypes.STRING,allowNull: true},                           
        authpin: {type:DataTypes.STRING,allowNull: true},                   
        isverified: {type:DataTypes.INTEGER,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false},
        reglevel: {type:DataTypes.INTEGER,allowNull: false},
        // wbal: {type:DataTypes.DECIMAL,allowNull: false},
        address: {type:DataTypes.TEXT, allowNull: true},     
        city: {type:DataTypes.STRING(50),allowNull: true},                
        state: {type:DataTypes.STRING(20),allowNull: true},                                 
        nextofkin_phone: {type:DataTypes.STRING(50),allowNull: true},                
        nextofkin_name: {type:DataTypes.STRING(50),allowNull: true},          
        regchannel: {type:DataTypes.STRING(20),allowNull: true},                              
        bvvno: {type:DataTypes.STRING(20),allowNull: true},                              
        countrycode: {type:DataTypes.STRING(20),allowNull: true},                              
        photo: {type:DataTypes.STRING(255),allowNull: true},
        docverify: {type:DataTypes.INTEGER(11),allowNull: true},
        bvverify: {type:DataTypes.INTEGER(11),allowNull: true},
        accounttier: {type:DataTypes.INTEGER(11),allowNull: true},
        apptoken: {type:DataTypes.TEXT, allowNull: true},
        devicename: {type:DataTypes.STRING(50), allowNull: true},
        devicetype: {type:DataTypes.STRING(50), allowNull: true},
        timed: {type:DataTypes.STRING(255), allowNull: true},
        accesstoken: {type:DataTypes.STRING(255),allowNull: false},
        uname: {type:DataTypes.STRING(20), allowNull: true},        //username
        env: {type:DataTypes.STRING(20), allowNull: true},        //reg channel e.g web or app
        nextkin_relationship: {type:DataTypes.STRING(20),allowNull: true},                                                             
        secretauth: {type:DataTypes.STRING, allowNull: true}, 
        postalcode: {type:DataTypes.STRING(20),allowNull: true},                  
        houseno: {type:DataTypes.STRING(20),allowNull: true},                                                               
        countryname: {type:DataTypes.STRING(20),allowNull: true},                                                               
        dialcode: {type:DataTypes.STRING(20),allowNull: true},                                                               
        last_login: { type: DataTypes.STRING(50), allowNull: true },
        last_buy: { type: DataTypes.STRING(50), allowNull: true },
        cronupd: { type: DataTypes.INTEGER(11), allowNull: true },
      }, {
        tableName: 'customers',
        timestamps: false
      });
  
    
    return Customer;      
}