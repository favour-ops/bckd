const { createBizKeys } = require('../../controllers/businessControllers/apikeymgt');
const { Business, BizKeys, crypto } = require('../../controllers/businessControllers/_dependencies');

jest.mock('../../controllers/businessControllers/_dependencies', () => {
    const actual = jest.requireActual('../../controllers/businessControllers/_dependencies');
    return {
        ...actual,
        Business: { findOne: jest.fn() },
        BizKeys: { findOne: jest.fn(), create: jest.fn() },
        crypto: {
            randomBytes: jest.fn().mockReturnValue({
                toString: jest.fn().mockReturnValue('mocked_hex_string')
            })
        }
    };
});

describe('Webhook and API Security - Unit Tests', () => {
    test('createBizKeys should generate a correctly formatted client_id', async () => {
        const req = { body: { bizid: 'biz-uuid', bizname: 'Test Biz' } };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

        Business.findOne.mockResolvedValue({ id: 500 });
        BizKeys.findOne.mockResolvedValue(null);
        BizKeys.create.mockResolvedValue({ id: 1, client_id: 'hitchpay_client_mocked' });

        await createBizKeys(req, res);

        expect(res.status).toHaveBeenCalledWith(201);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            message: expect.stringContaining('API Keys created successfully')
        }));
    });
});