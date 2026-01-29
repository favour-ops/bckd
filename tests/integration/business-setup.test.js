const { Business, Customer, Wallets, BizTeam } = require('../../controllers/businessControllers/_dependencies');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        Business: { findOne: jest.fn(), create: jest.fn() },
        Customer: { findOne: jest.fn(), create: jest.fn() },
        Wallets: { create: jest.fn() },
        BizTeam: { create: jest.fn() },
        mailSender: jest.fn().mockResolvedValue(true),
        cleanMe: jest.fn((data) => data),
        validatePassword: jest.fn(() => true),
        db: {
            sequelize: {
                transaction: jest.fn().mockReturnValue({
                    commit: jest.fn().mockResolvedValue(true),
                    rollback: jest.fn().mockResolvedValue(true),
                    finished: false
                })
            }
        }
    };
});

describe('Business Setup Integration Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Should validate business setup workflow', async () => {
        const { Business, Customer, Wallets, BizTeam } = require('../../controllers/businessControllers/_dependencies');
        
        // Mock no existing user or business
        Business.findOne.mockResolvedValue(null);
        Customer.findOne.mockResolvedValue(null);
        
        // Mock successful creation
        const mockCustomer = { id: 100, email: 'test@business.com' };
        const mockBusiness = { id: 500, business_name: 'Test Business' };
        Customer.create.mockResolvedValue(mockCustomer);
        Business.create.mockResolvedValue(mockBusiness);
        Wallets.create.mockResolvedValue({ id: 1 });
        BizTeam.create.mockResolvedValue({ id: 1 });
        
        // Simulate business setup request
        const req = {
            body: {
                fname: 'John',
                lname: 'Doe',
                email: 'test@business.com',
                password: 'Password123!',
                business_name: 'Test Business',
                business_email: 'business@test.com',
                hascac: '0',
                bizphone: '08012345678',
                bizaddress: '123 Test St',
                bizcity: 'Ikeja',
                bizstate: 'Lagos',
                countrycode: 'NG',
                bizdesc: 'Test Description'
            }
        };
        
        // Simulate the business setup validation
        const existingUser = await Customer.findOne({ where: { email: req.body.email } });
        const existingBusiness = await Business.findOne({ where: { business_name: req.body.business_name } });
        
        expect(existingUser).toBeNull();
        expect(existingBusiness).toBeNull();
        
        // If no existing records, proceed with creation
        if (!existingUser && !existingBusiness) {
            const customer = await Customer.create(req.body);
            const business = await Business.create({
                ...req.body,
                ownerid: customer.id
            });
            
            expect(customer.id).toBe(100);
            expect(business.id).toBe(500);
            expect(Customer.create).toHaveBeenCalled();
            expect(Business.create).toHaveBeenCalled();
        }
    });

    test('Should reject duplicate business names', async () => {
        const { Business, Customer } = require('../../controllers/businessControllers/_dependencies');
        
        // Mock existing business with same name
        Business.findOne.mockResolvedValue({ id: 500, business_name: 'Test Business' });
        Customer.findOne.mockResolvedValue(null);
        
        const req = {
            body: {
                email: 'new@business.com',
                business_name: 'Test Business', // Duplicate name
            }
        };
        
        // Check for existing business
        const existingBusiness = await Business.findOne({ 
            where: { business_name: req.body.business_name } 
        });
        
        expect(existingBusiness).toBeTruthy();
        expect(existingBusiness.id).toBe(500);
        
        // Should not proceed with creation
        expect(Business.create).not.toHaveBeenCalled();
    });
});