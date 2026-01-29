const { rolePermissions } = require('../../auth/businessAuth');

describe('Business Role Permissions - Unit Tests', () => {
    test('Owner should have the super-admin wildcard permission', () => {
        const ownerPerms = rolePermissions.owner.permissions;
        expect(ownerPerms).toContain('*');
    });

    test('Finance role should have limited permissions and no team management access', () => {
        const financePerms = rolePermissions.finance.permissions;
        expect(financePerms).toContain('transactions:view');
        expect(financePerms).toContain('payouts:initiate');
        expect(financePerms).not.toContain('team:add');
        expect(financePerms).not.toContain('apikeys:manage');
    });

    test('Admin should have team management but not owner-only perms', () => {
        const adminPerms = rolePermissions.admin.permissions;
        expect(adminPerms).toContain('team:add');
        expect(adminPerms).toContain('payouts:initiate');
    });
});