const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BonusTask = sequelize.define("BonusTask", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        title: {type:DataTypes.STRING,allowNull: true},
        action: {type:DataTypes.STRING, allowNull: false},       
        name: { type: DataTypes.STRING, allowNull: false }, // e.g., "Welcome Bonus", "Daily Check-in", "Referral"
        description: { type: DataTypes.STRING }, // for admin UI
        type: { type: DataTypes.STRING, allowNull: false }, 
        min_amount: {type:DataTypes.DECIMAL(16, 2), allowNull: true},
        max_reward: {type:DataTypes.DECIMAL(16, 2), allowNull: true},
        reward_value: {type:DataTypes.STRING, allowNull: true},
        network_type: {type:DataTypes.STRING, allowNull: true},
        reward_type: {type:DataTypes.STRING, allowNull: false},       
        reward_unit: {type:DataTypes.ENUM("percent", "flat"), allowNull: false},       
        daily_limit: {type:DataTypes.INTEGER,allowNull: true, defaultValue: 1},
        is_active: {type:DataTypes.BOOLEAN, allowNull: false, defaultValue: true},
        meta: { type: DataTypes.JSON }, // flexible field, e.g. {days:7}, {voucherCode:"ABC123"}
      }, {
        tableName: 'bonustasks',
        timestamps: false
      });

    return BonusTask;      
}


