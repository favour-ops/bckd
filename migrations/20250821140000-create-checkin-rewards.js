// migrations/20250821140000-create-checkin-rewards.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("CheckinRewards", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      day: { type: Sequelize.INTEGER, allowNull: false }, // 1-7
      reward: { type: Sequelize.DECIMAL, allowNull: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("CheckinRewards");
  },
};
