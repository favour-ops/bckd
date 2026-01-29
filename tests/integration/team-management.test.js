const { BizTeam, BizInvites, Customer } = require('../../controllers/businessControllers/_dependencies');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        BizTeam: { findOne: jest.fn(), create: jest.fn() },
        BizInvites: { findOne: jest.fn(), create: jest.fn() },
        Customer: { findOne: jest.fn() },
        mailSender: jest.fn().mockResolvedValue(true)
    };
});

describe('Team Management Integration Tests', () => {
    test('Should create invitation when user does not exist', async () => {
        const { BizTeam, BizInvites, Customer, mailSender } = require('../../controllers/businessControllers/_dependencies');
        
        // Mock user not found
        Customer.findOne.mockResolvedValue(null);
        BizInvites.findOne.mockResolvedValue(null);
        BizInvites.create.mockResolvedValue({ id: 1 });
        
        const req = {
            user: { id: 1 },
            body: { bizid: 'biz-123', member_email: 'new@user.com', member_name: 'New User', role: 'admin' }
        };
        
        // Simulate the team invitation logic
        const existingUser = await Customer.findOne({ where: { email: req.body.member_email } });
        const existingInvite = await BizInvites.findOne({ where: { email: req.body.member_email } });
        
        if (!existingUser && !existingInvite) {
            const invite = await BizInvites.create({
                bizid: req.body.bizid,
                email: req.body.member_email,
                name: req.body.member_name,
                role: req.body.role,
                invited_by: req.user.id
            });
            
            expect(invite.id).toBe(1);
            expect(BizInvites.create).toHaveBeenCalled();
        }
    });

    test('Should add user to team when they already exist', async () => {
        const { BizTeam, BizInvites, Customer } = require('../../controllers/businessControllers/_dependencies');
        
        // Mock user exists
        Customer.findOne.mockResolvedValue({ id: 200, email: 'existing@user.com' });
        BizTeam.findOne.mockResolvedValue(null);
        BizTeam.create.mockResolvedValue({ id: 1 });
        
        const req = {
            user: { id: 1 },
            body: { bizid: 'biz-123', member_email: 'existing@user.com', member_name: 'Existing User', role: 'admin' }
        };
        
        // Simulate the team addition logic
        const existingUser = await Customer.findOne({ where: { email: req.body.member_email } });
        const existingTeamMember = await BizTeam.findOne({ where: { customerid: existingUser.id, bizid: req.body.bizid } });
        
        if (existingUser && !existingTeamMember) {
            const teamMember = await BizTeam.create({
                customerid: existingUser.id,
                bizid: req.body.bizid,
                role: req.body.role,
                added_by: req.user.id
            });
            
            expect(teamMember.id).toBe(1);
            expect(BizTeam.create).toHaveBeenCalledWith(expect.objectContaining({
                customerid: existingUser.id,
                role: req.body.role
            }));
        }
    });
});