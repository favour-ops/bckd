const { Sequelize, DataTypes } = require('sequelize');

module.exports = (sequelize, DataTypes) => {
    const Settlement = sequelize.define("settlements", {
        id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true, allowNull: false },
        ownerid: { type: DataTypes.INTEGER, allowNull: false, comment: "ID of the Business or Customer" },
        usertype: { type: DataTypes.STRING(20), allowNull: false, comment: "Either 'business' or 'personal'" },
        gross_amount: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
        total_fee: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
        net_amount: { type: DataTypes.DECIMAL(16, 2), allowNull: false },
        currency: { type: DataTypes.STRING(20), allowNull: false },
        settlement_reference: { type: DataTypes.STRING(50), allowNull: false, unique: true },
        settlement_date: { type: DataTypes.DATEONLY, allowNull: false },
        status: { type: DataTypes.ENUM('pending', 'processing', 'paid', 'failed'), allowNull: false, defaultValue: 'pending' },
        payout_date: { type: DataTypes.DATE, allowNull: true },
        payout_reference: { type: DataTypes.STRING(100), allowNull: true },
        payout_by: { type: DataTypes.STRING(100), allowNull: true }
    }, {
        tableName: 'settlements',
        timestamps: true
    });

    return Settlement;
};