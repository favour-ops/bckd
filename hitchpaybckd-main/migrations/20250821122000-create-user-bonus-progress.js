// migrations/20250821122000-create-user-bonus-progress.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("BonusProgress", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      user_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "Users", key: "id" },
        onDelete: "CASCADE",
      },
      task_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "BonusTasks", key: "id" },
        onDelete: "CASCADE",
      },
      date: { type: Sequelize.DATEONLY, defaultValue: Sequelize.fn("NOW") },
      times_completed: { type: Sequelize.INTEGER, defaultValue: 0 },
      reward_earned: { type: Sequelize.DECIMAL, defaultValue: 0 },
      claimed: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("BonusProgress");
  },
};
