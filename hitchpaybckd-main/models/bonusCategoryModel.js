const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BonusCategory = sequelize.define("BonusCategory", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        name: {type:DataTypes.ENUM("welcome", "referral", "checkin", "daily_task", "voucher"), allowNull: false},       
        description: {type:DataTypes.STRING(20),allowNull: true},
        is_active: {type:DataTypes.BOOLEAN, allowNull: false, defaultValue: true}    
      }, {
        tableName: 'bonuscategory',
        timestamps: false
      });

    /* BonusCategory.associate = function(models) {
       BonusCategory.hasMany(models.BonusTask, { foreignKey: "category_id" });
    }; */
    return BonusCategory;      
}
