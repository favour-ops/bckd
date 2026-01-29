const {Sequelize, DataTypes} = require('sequelize');
module.exports = (sequelize, DataTypes) =>{
    const BonusProgress = sequelize.define("BonusProgress", {            
        id: {type:DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false},
        userid: { type: DataTypes.INTEGER, allowNull: false },
        task_id: { type: DataTypes.INTEGER, allowNull: false },
        status: { type: DataTypes.ENUM("pending", "completed", "claimed"), defaultValue: "pending"},
        lastClaimedAt: { type: DataTypes.DATE },
        progress: { type: DataTypes.JSON },
        date: { type: DataTypes.DATEONLY, defaultValue: DataTypes.NOW },
        timed: {type:DataTypes.TEXT,allowNull: true},
        times_completed: { type: DataTypes.INTEGER, defaultValue: 0 },
        reward_earned: { type: DataTypes.DECIMAL, defaultValue: 0 },
        claimed: { type: DataTypes.BOOLEAN, defaultValue: false }
      }, {
        tableName: 'bonus_progress',
        timestamps: false
      });

    /* BonusProgress.associate = function(models) {
        BonusProgress.belongsTo(models.User, { foreignKey: "user_id" });
        BonusProgress.belongsTo(models.BonusTask, { foreignKey: "task_id" });
    }; */
    return BonusProgress;      
}
