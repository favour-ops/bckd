const { Sequelize, DataTypes } = require('sequelize');


module.exports = (sequelize, DataTypes) => {
    const Permission = sequelize.define('permission', {
        name: {
            type: DataTypes.STRING, // e.g., 'view_users', 'edit_product'
            allowNull: false,
            unique: true,
        },
        description: {
            type: DataTypes.TEXT,
        },
    }, {
        tableName: 'permission',
        timestamps: false
    });

    return Permission;
};