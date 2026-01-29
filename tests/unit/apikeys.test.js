const keyController = require('../../controllers/businessControllers/apikeymgt');
const { Business, BizKeys } = require('../../controllers/businessControllers/_dependencies');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        Business: { findOne: jest.fn() },
        BizKeys: { findOne: jest.fn(), create: jest.fn() },
        logger: { error: jest.fn() }
    };
});

describe('API Key Management - Unit Tests', () => {
    let req, res;

    beforeEach(() => {
        req = { body: { bizid: 'biz-uuid', keyid: 10 } };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });

    test('rotateSecret should generate a new secret and update timestamp', async () => {
        const mockKey = { 
            client_id: 'hp_123', 
            save: jest.fn().mockResolvedValue(true),
            keymode: 'test'
        };
        Business.findOne.mockResolvedValue({ id: 500 });
        BizKeys.findOne.mockResolvedValue(mockKey);

        await keyController.rotateSecret(req, res);

        expect(mockKey.save).toHaveBeenCalled();
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('rotated successfully')
        }));
    });
});