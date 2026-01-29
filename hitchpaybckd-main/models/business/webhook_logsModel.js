const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const WebHookLogs = sequelize.define('webhook_logs', {
    id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
    bizid: { type: DataTypes.INTEGER, allowNull: false },
    reference : { type: DataTypes.STRING(50), allowNull: false },
    event: { type: DataTypes.STRING(50), allowNull: false },
    response_code : { type: DataTypes.STRING(50), allowNull: true },
    payload: { type: DataTypes.JSON, allowNull: false },
    response_body: { type: DataTypes.TEXT, allowNull: true },
    http_status : { type: DataTypes.INTEGER, allowNull: true },
    attempt  : { type: DataTypes.INTEGER, allowNull: false, defaultValue: 1 },
    status: { type: DataTypes.ENUM('pending', 'success', 'failure'), defaultValue: 'pending'},
    timed: {type:DataTypes.STRING,allowNull: true},
  }, {
    tableName: 'webhook_logs',
    timestamps: false,
  });


  return WebHookLogs;
};
