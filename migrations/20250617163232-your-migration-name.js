'use strict';

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up (queryInterface, Sequelize) {
   // Name of the incorrect constraint might vary.
    // You might need to find it using a DB tool (e.g., SHOW CREATE TABLE RolePermission; in MySQL)
    // Common default naming pattern is `RolePermission_ibfk_2` or similar if Sequelize auto-generated it.
    // Or it could be a custom name if you defined it.
    // Let's assume the constraint name from your error message is correct.
    try {
      await queryInterface.removeConstraint('RolePermission', 'RolePermission_ibfk_2');
      console.log('Successfully removed incorrect constraint RolePermission_ibfk_2');
    } catch (error) {
      console.warn('Could not remove constraint RolePermission_ibfk_2 (it might not exist or have a different name):', error.message);
      // If you know the exact name of the constraint on permissionId, use that.
      // Alternatively, you might need to drop the column and re-add it if finding the constraint name is hard.
    }

    // Add the correct foreign key constraint
    await queryInterface.addConstraint('RolePermission', {
      fields: ['permissionId'],
      type: 'foreign key',
      name: 'RolePermission_permissionId_fkey', // A new, clear name for the constraint
      references: {
        table: 'permission', // Correct: should reference the 'permission' table
        field: 'id',
      },
      onDelete: 'CASCADE',
      onUpdate: 'CASCADE',
    });
  },

  async down (queryInterface, Sequelize) {
   await queryInterface.removeConstraint('RolePermission', 'RolePermission_permissionId_fkey');
  }
};
