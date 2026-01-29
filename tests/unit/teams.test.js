const teamController = require('../../controllers/businessControllers/teams');
const { BizTeam, Customer, Business, BizInvites, db } = require('../../controllers/businessControllers/_dependencies');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        Customer: { findOne: jest.fn(), findByPk: jest.fn() },
        Business: { findOne: jest.fn() },
        BizTeam: { findOne: jest.fn(), create: jest.fn() },
        BizInvites: { findOne: jest.fn(), create: jest.fn() },
        mailSender: jest.fn().mockResolvedValue(true),
        notifyMe: jest.fn().mockResolvedValue(true),
        pushNotify: jest.fn().mockResolvedValue(true),
        db: {
            sequelize: {
                transaction: jest.fn().mockReturnValue({
                    commit: jest.fn().mockResolvedValue(true),
                    rollback: jest.fn().mockResolvedValue(true),
                })
            }
        }
    };
});

describe('Team Management - Unit Tests', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            user: { id: 1 },
            body: { bizid: 'biz-uuid', member_email: 'new@user.com', member_name: 'New User', role: 'admin' }
        };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });

    test('Should create an invitation if the user does not exist', async () => {
        Business.findOne.mockResolvedValue({ id: 500, business_name: 'Test Biz' });
        Customer.findOne.mockResolvedValue(null); // User not found
        BizInvites.findOne.mockResolvedValue(null); // No previous invite
        Customer.findByPk.mockResolvedValue({ firstname: 'Owner', lastname: 'User' });

        await teamController.addTeamMember(req, res);

        expect(BizInvites.create).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Invitation sent successfully')
        }));
    });

    test('Should add user to team if they already have an account', async () => {
        Business.findOne.mockResolvedValue({ id: 500, business_name: 'Test Biz' });
        Customer.findOne.mockResolvedValue({ id: 200, email: 'new@user.com', firstname: 'John' });
        BizTeam.findOne.mockResolvedValue(null); // Not already a member

        await teamController.addTeamMember(req, res);

        expect(BizTeam.create).toHaveBeenCalledWith(expect.objectContaining({
            customerid: 200,
            role: 'admin'
        }), expect.any(Object));
        expect(res.status).toHaveBeenCalledWith(201);
    });
});