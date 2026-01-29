// migrations/20250821120000-create-bonus-category.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BonusCategory", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: {
        type: Sequelize.ENUM("welcome", "referral", "checkin", "daily_task", "voucher"),
        allowNull: false,
      },
      description: { type: Sequelize.STRING },
      is_active: { type: Sequelize.BOOLEAN, defaultValue: true },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("BonusCategory");
  },
};
