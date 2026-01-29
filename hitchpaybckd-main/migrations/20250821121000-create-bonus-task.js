// migrations/20250821121000-create-bonus-task.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BonusTasks", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      category_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "BonusCategory", key: "id" },
        onDelete: "CASCADE",
      },
      title: { type: Sequelize.STRING, allowNull: false },
      action: {
        type: Sequelize.ENUM("fund_wallet", "buy_airtime", "buy_data", "checkin", "referral"),
        allowNull: false,
      },
      min_amount: { type: Sequelize.DECIMAL, allowNull: true },
      reward_type: { type: Sequelize.ENUM("cashback", "points", "voucher"), allowNull: false },
      reward_value: { type: Sequelize.DECIMAL, allowNull: false },
      reward_unit: { type: Sequelize.ENUM("percent", "flat"), allowNull: false },
      max_reward: { type: Sequelize.DECIMAL, allowNull: true },
      daily_limit: { type: Sequelize.INTEGER, defaultValue: 1 },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("BonusTasks");
  },
};
