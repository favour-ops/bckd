const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const BizWebhook = sequelize.define('bizwebhook', {
    id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
    bizid: { type: DataTypes.INTEGER, allowNull: false },
    url: { type: DataTypes.STRING(255), allowNull: false },
    secret: { type: DataTypes.STRING(255), allowNull: false },
    events: { type: DataTypes.JSON, allowNull: false }, // Store events as a JSON array
    env: { type: DataTypes.ENUM('test', 'live'), allowNull: false },
    status: { type: DataTypes.ENUM('active', 'inactive'), defaultValue: 'active' },
    last_failure: { type: DataTypes.DATE, allowNull: true },
    failure_count: { type: DataTypes.INTEGER, defaultValue: 0 },
    timed: {type:DataTypes.STRING,allowNull: true},
  }, {
    tableName: 'bizwebhooks',
    timestamps: false,
  });

  BizWebhook.associate = (models) => {
    BizWebhook.belongsTo(models.business, { foreignKey: 'bizid' });
  };

  return BizWebhook;
};
