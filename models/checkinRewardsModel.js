const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const CheckinRewards = sequelize.define("CheckinRewards", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        day: { type: DataTypes.INTEGER, allowNull: false }, // 1-7
        reward: { type: DataTypes.DECIMAL, allowNull: false },
        createdAt: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.fn("NOW") },
        updatedAt: { allowNull: false, type: DataTypes.DATE, defaultValue: Sequelize.fn("NOW") },
        timed: {type:DataTypes.TEXT,allowNull: true},
        status: {type:DataTypes.INTEGER(11), allowNull: true},
        is_active: {type:DataTypes.BOOLEAN, allowNull: false, defaultValue: true}    
      }, {
        tableName: 'checkin_rewards',
        timestamps: false
      });

    return CheckinRewards;      
}
