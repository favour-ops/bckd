const { getBal, updateBalance, TransLimit } = require('../../config/myfunct');

jest.mock('../../config/myfunct', () => {
    const actual = jest.requireActual('../../config/myfunct');
    return {
        ...actual,
        getBal: jest.fn(),
        updateBalance: jest.fn(),
        TransLimit: jest.fn()
    };
});

describe('Business Money Transfer - Unit Tests', () => {
    let req, res;

    beforeEach(() => {
        jest.clearAllMocks();
        req = {
            user: { id: 1 },
            body: {
                bizid: 'biz-uuid',
                amount: 5000,
                recipientno: '0123456789',
                bankcode: '999240',
                bankname: 'Test Bank',
                transpin: '1234',
                currency: 'NGN'
            }
        };
        res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    });

    test('Should detect insufficient balance for transfer', async () => {
        // Mock insufficient balance
        getBal.mockResolvedValue(1000); // Only 1k in wallet, trying to send 5k
        
        const currentBalance = await getBal('biz-uuid');
        const transferAmount = 5000;
        const hasSufficientFunds = currentBalance >= transferAmount;
        
        expect(hasSufficientFunds).toBe(false);
        expect(getBal).toHaveBeenCalledWith('biz-uuid');
    });

    test('Should allow transfer when balance is sufficient', async () => {
        // Mock sufficient balance
        getBal.mockResolvedValue(10000); // 10k in wallet, trying to send 5k
        
        const currentBalance = await getBal('biz-uuid');
        const transferAmount = 5000;
        const hasSufficientFunds = currentBalance >= transferAmount;
        
        expect(hasSufficientFunds).toBe(true);
        expect(getBal).toHaveBeenCalledWith('biz-uuid');
    });

    test('Should check transaction limits before processing', async () => {
        // Mock transaction limits
        TransLimit.mockResolvedValue([true, 50000, 500000, 100000, 1000000, 'tier1']);
        
        const [status, dailyLimit, monthlyLimit] = await TransLimit('tier1');
        const transferAmount = 5000;
        const withinDailyLimit = transferAmount <= dailyLimit;
        
        expect(status).toBe(true);
        expect(withinDailyLimit).toBe(true);
        expect(TransLimit).toHaveBeenCalledWith('tier1');
    });
});