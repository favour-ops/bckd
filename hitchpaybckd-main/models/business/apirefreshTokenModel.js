const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const RefreshToken = sequelize.define('RefreshToken', {
    id: { type: DataTypes.INTEGER.UNSIGNED, primaryKey: true, autoIncrement: true },
    token_hash: { type: DataTypes.STRING, allowNull: false }, // hashed (sha256)
    expires_at: { type: DataTypes.DATE, allowNull: false },
    revoked: { type: DataTypes.BOOLEAN, defaultValue: false },
    bizid: { type: DataTypes.INTEGER.UNSIGNED, allowNull: false },
  }, {
    tableName: 'refresh_tokens',
    timestamps: true,
  });

  RefreshToken.associate = (models) => {
    RefreshToken.belongsTo(models.BizKeys, { foreignKey: 'bizid' });
  };

  return RefreshToken;
};
