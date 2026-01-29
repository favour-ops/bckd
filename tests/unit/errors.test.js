const onboardingController = require('../../controllers/businessControllers/onboarding');
const { Customer, logger } = require('../../controllers/businessControllers/_dependencies');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        Customer: { findOne: jest.fn() },
        logger: { error: jest.fn() },
        db: {
            sequelize: {
                transaction: jest.fn().mockReturnValue({
                    rollback: jest.fn().mockResolvedValue(true),
                    finished: false
                })
            }
        }
    };
});

describe('Global Error Handling - Unit Tests', () => {
    test('BusinessRegistrationWeb should return 500 and log error on unexpected crash', async () => {
        const req = { 
            body: { 
                email: 'test@biz.com', 
                password: 'Password123!',
                fname: 'Test',
                lname: 'User',
                bizname: 'Test Business',
                bizemail: 'business@test.com',
                hascac: '0',
                bizphone: '08012345678',
                bizaddress: '123 Test St',
                bizcity: 'Ikeja',
                bizstate: 'Lagos',
                countrycode: 'NG',
                bizdesc: 'Test Description'
            } 
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        const next = jest.fn();

        // Simulate a critical failure during the first DB call
        Customer.findOne.mockRejectedValue(new Error('Internal Database Crash'));

        await onboardingController.BusinessRegistrationWeb(req, res, next);

        // The error should be passed to the next middleware (global error handler)
        expect(next).toHaveBeenCalledWith(expect.any(Error));
        expect(logger.error).toHaveBeenCalled();
    });
});