const { checkBusinessPermission, businessAuth } = require('../../auth/businessAuth');
const { BizTeam, Customer, db } = require('../../controllers/businessControllers/_dependencies');
const jwt = require('jsonwebtoken');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        BizTeam: { findOne: jest.fn() },
        Customer: { findOne: jest.fn() },
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

jest.mock('jsonwebtoken');

describe('Authentication & Authorization Middleware', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            headers: { authorization: 'Bearer valid-token' },
            user: { id: 1, email: 'test@example.com' },
            business: { id: 500, role: 'admin' }
        };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        next = jest.fn();
    });

    test('checkBusinessPermission should allow access if user has required permission', async () => {
        const middleware = checkBusinessPermission('team:add');
        
        await middleware(req, res, next);
        expect(next).toHaveBeenCalled();
    });

    test('checkBusinessPermission should deny access if user lacks permission', async () => {
        req.business.role = 'finance'; // finance role doesn't have team:add permission
        const middleware = checkBusinessPermission('team:add');

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Access Denied')
        }));
    });

    test('checkBusinessPermission should return 401 if authentication context is missing', async () => {
        delete req.user;
        const middleware = checkBusinessPermission('team:add');

        await middleware(req, res, next);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Authentication context is missing')
        }));
    });

    test('businessAuth should verify JWT token and user belongs to business', async () => {
        // Mock JWT verification
        jwt.verify.mockReturnValue({ id: 1, email: 'test@example.com', bizid: 500 });
        
        // Mock database calls
        BizTeam.findOne.mockResolvedValue({ 
            id: 1, 
            customerid: 1, 
            bizid: 500, 
            role: 'owner',
            status: 1 
        });

        await businessAuth(req, res, next);

        expect(jwt.verify).toHaveBeenCalledWith('valid-token', process.env.JWT_SECRET);
        expect(BizTeam.findOne).toHaveBeenCalledWith({
            where: {
                customerid: 1,
                bizid: 500,
                status: 1
            }
        });
        expect(next).toHaveBeenCalled();
        expect(req.user).toEqual({ id: 1, email: 'test@example.com' });
        expect(req.business).toEqual({ id: 500, role: 'owner' });
    });

    test('businessAuth should return 401 for invalid token', async () => {
        jwt.verify.mockImplementation(() => {
            throw new jwt.JsonWebTokenError('Invalid token');
        });

        await businessAuth(req, res, next);

        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('Invalid token')
        }));
    });
});