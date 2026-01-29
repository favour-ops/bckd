// This is a junction table, often Sequelize can manage it implicitly
// if you define belongsToMany correctly, but explicit model can be useful.
module.exports = (sequelize, DataTypes) => {
  const RolePermission = sequelize.define('RolePermission', {
    roleId: {
      type: DataTypes.INTEGER,
      references: { model: 'role', key: 'id' }, 
      primaryKey: true,
    },
    permissionId: {
      type: DataTypes.INTEGER,
      references: { model: 'permission', key: 'id' },
      primaryKey: true,
    },
  },{
      tableName: 'RolePermission',
      timestamps: false
  });
  return RolePermission;
};