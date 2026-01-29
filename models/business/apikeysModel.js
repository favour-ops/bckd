const {Sequelize, DataTypes} = require('sequelize');

module.exports = (sequelize, DataTypes) => {
  const BizKeys = sequelize.define('bizkeys', {
    id: {type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true, allowNull: false},
    bizid: { type: DataTypes.INTEGER, allowNull: false },
    bizname: { type: DataTypes.STRING, allowNull: false },
    client_id: { type: DataTypes.STRING, allowNull: false, unique: true },
    client_secret_hash: { type: DataTypes.STRING, allowNull: false }, // hashed with bcrypt
    keyname: { type: DataTypes.STRING, allowNull: true },
    keymode: { type: DataTypes.STRING, allowNull: false },
    status: { type: DataTypes.ENUM('1', '0'), defaultValue: '1' },
    timed: {type:DataTypes.TEXT,allowNull: true},
  }, {
    tableName: 'bizkeys',
    timestamps: false,
  });

  BizKeys.associate = (models) => {
    BizKeys.hasMany(models.RefreshToken, { foreignKey: 'bizid' });
  };

  return BizKeys;
};
