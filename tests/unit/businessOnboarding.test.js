const onboardingController = require('../../controllers/businessControllers/onboarding');
const { Customer, Business, Wallets, BizTeam, mailSender, db } = require('../../controllers/businessControllers/_dependencies');

// 1. Mock the dependencies
jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        Customer: {
            findOne: jest.fn(),
            create: jest.fn(),
        },
        Business: {
            findOne: jest.fn(),
            create: jest.fn(),
        },
        Wallets: { create: jest.fn() },
        BizTeam: { create: jest.fn() },
        mailSender: jest.fn().mockResolvedValue(true),
        cleanMe: jest.fn((data) => data), // Mock cleanMe to return data as-is
        validatePassword: jest.fn(() => true), // Mock validatePassword to return true
        db: {
            sequelize: {
                transaction: jest.fn().mockReturnValue({
                    commit: jest.fn().mockResolvedValue(true),
                    rollback: jest.fn().mockResolvedValue(true),
                    finished: false
                }),
                where: jest.fn(),
                fn: jest.fn(),
                col: jest.fn(), // Add missing col function
                Op: actual.Op // Use actual Op from dependencies
            }
        }
    };
});

describe('Business Web Registration - Unit Tests', () => {
    let req, res, next;

    beforeEach(() => {
        jest.clearAllMocks(); // Reset mocks between tests
        req = {
            body: {
                fname: 'John', lname: 'Doe', email: 'john@hitchpay.ng', password: 'Password123!',
                bizname: 'John Ventures', bizemail: 'biz@hitchpay.ng', bizphone: '08012345678',
                bizaddress: 'Lagos', bizcity: 'Ikeja', bizstate: 'Lagos', countrycode: 'NG', 
                bizdesc: 'Fintech', countryname: 'Nigeria'
            }
        };
        res = {
            status: jest.fn().mockReturnThis(),
            json: jest.fn()
        };
        next = jest.fn();
    });

    test('Should return 400 if user email already exists', async () => {
        Customer.findOne.mockResolvedValue({ id: 1, email: 'john@hitchpay.ng' });

        await onboardingController.BusinessRegistrationWeb(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: false,
            message: 'A user with this email already exists.'
        }));
    });

    test('Should return 400 if password does not meet security requirements', async () => {
        req.body.password = '123'; 
        // Override validatePassword to return false for this test
        const { validatePassword } = require('../../controllers/businessControllers/_dependencies');
        validatePassword.mockReturnValue(false);

        await onboardingController.BusinessRegistrationWeb(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: false,
            message: expect.stringContaining('Password must be at least 8 chars')
        }));
    });

test('Should successfully create User, Business, and Wallets on valid input', async () => {
        // 1. Ensure no existing user or business is found
        // Using mockResolvedValue(null) ensures the "if (existingUser)" and "if (existingBusiness)" blocks are skipped
        Customer.findOne.mockResolvedValue(null);
        Business.findOne.mockResolvedValue(null);
        
        // 2. Reset validatePassword to return true for this test
        const { validatePassword } = require('../../controllers/businessControllers/_dependencies');
        validatePassword.mockReturnValue(true);
        
        // 3. Mock creation returns
        const mockCustomer = { id: 100, email: 'john@hitchpay.ng', firstname: 'John' };
        const mockBusiness = { id: 500, business_name: 'John Ventures' };
        Customer.create.mockResolvedValue(mockCustomer);
        Business.create.mockResolvedValue(mockBusiness);
        Wallets.create.mockResolvedValue({ id: 1 });
        BizTeam.create.mockResolvedValue({ id: 1 });

        // 4. Add missing required fields to req.body to pass controller validation
        req.body.hascac = '0'; // Skip CAC-specific validation
        req.body.bizphone = '08012345678';
        req.body.bizaddress = '123 Test St';
        req.body.bizcity = 'Ikeja';
        req.body.bizstate = 'Lagos';
        req.body.countrycode = 'NG';
        req.body.bizdesc = 'Fintech Services';

        // 5. Run the controller
        await onboardingController.BusinessRegistrationWeb(req, res, next);

        
        // 6. Verify Customer Creation - Check the actual call parameters
        expect(Customer.create).toHaveBeenCalled();
        const customerCall = Customer.create.mock.calls[0];
        expect(customerCall[0]).toMatchObject({
            firstname: 'John',
            lastname: 'Doe',
            email: 'john@hitchpay.ng'
        });
        expect(customerCall[1]).toMatchObject({
            transaction: expect.any(Object)
        });

        // 7. Verify Business Creation
        expect(Business.create).toHaveBeenCalled();
        const businessCall = Business.create.mock.calls[0];
        expect(businessCall[0]).toMatchObject({
            business_name: 'John Ventures',
            business_email: 'biz@hitchpay.ng',
            ownerid: 100
        });
        expect(businessCall[1]).toMatchObject({
            transaction: expect.any(Object)
        });
        
        // 8. Verify 2 wallets were created (Personal + Business)
        expect(Wallets.create).toHaveBeenCalledTimes(2);

        // 9. Verify the success response
        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: true,
            message: expect.stringContaining('successfully')
        }));
    });

    test('Should return 400 if a business with that name already exists', async () => {
        Customer.findOne.mockResolvedValue(null); // User is new
        Business.findOne.mockResolvedValue({ id: 500, business_name: 'John Ventures' }); // Business name is taken

        await onboardingController.BusinessRegistrationWeb(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: false,
            message: 'A business with this name already exists.'
        }));
    });

    test('Should rollback transaction if business creation fails', async () => {
        Customer.findOne.mockResolvedValue(null);
        Business.findOne.mockResolvedValue(null);
        Customer.create.mockResolvedValue({ id: 100 });
        
        // Simulate a database crash during business creation
        Business.create.mockRejectedValue(new Error('DB Crash'));

        await onboardingController.BusinessRegistrationWeb(req, res, next);

        // Verify rollback was triggered (the error is caught in the catch block)
        const transaction = db.sequelize.transaction();
        expect(transaction.rollback).toHaveBeenCalled();
    });
});