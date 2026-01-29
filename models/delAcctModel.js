const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const CancelAcct = sequelize.define("cancelacct", {        
        userid: {type:DataTypes.INTEGER,allowNull: false},
        reason: {type:DataTypes.STRING,allowNull: true}, 
        dated: {type:DataTypes.TEXT,allowNull: true},    
        status: {type:DataTypes.INTEGER,allowNull: false}
      }, {
        tableName: 'cancelacct',
        timestamps: false
      });
            
    return CancelAcct;      
}