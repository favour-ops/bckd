// migrations/20250821123000-create-referral.js
"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("Referrals", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      referrer_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "customers", key: "id" },
        onDelete: "CASCADE",
      },
      referee_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "customers", key: "id" },
        onDelete: "CASCADE",
      },
      bonus_awarded: { type: Sequelize.BOOLEAN, defaultValue: false },
      createdAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
      updatedAt: { allowNull: false, type: Sequelize.DATE, defaultValue: Sequelize.fn("NOW") },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("Referrals");
  },
};
