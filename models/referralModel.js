const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const Referral = sequelize.define("Referral", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        referrer_id: {type:DataTypes.INTEGER, allowNull: false},
        referee_id: {type:DataTypes.INTEGER, allowNull: false},
        bonus_awarded: {type:DataTypes.BOOLEAN, defaultValue: false,allowNull: true},
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER,allowNull: false}  
      }, {
        tableName: 'referral',
        timestamps: false
      });

    /* Referral.associate = function(models) {
        Referral.belongsTo(models.User, { foreignKey: "referrer_id", as: "Referrer" });
        Referral.belongsTo(models.User, { foreignKey: "referee_id", as: "Referee" });
    }; */
    return Referral;      
}


