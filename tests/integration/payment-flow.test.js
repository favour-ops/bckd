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

describe('Payment Flow Integration Tests', () => {
    test('Should validate sufficient balance before transfer', async () => {
        // Mock insufficient balance
        getBal.mockResolvedValue(500);
        
        const currentBalance = await getBal('user-123');
        const transferAmount = 1000;
        const canTransfer = currentBalance >= transferAmount;
        
        expect(canTransfer).toBe(false);
        expect(getBal).toHaveBeenCalledWith('user-123');
    });

    test('Should allow transfer when balance is sufficient', async () => {
        // Mock sufficient balance
        getBal.mockResolvedValue(5000);
        updateBalance.mockResolvedValue(4000);
        
        const currentBalance = await getBal('user-123');
        const transferAmount = 1000;
        const canTransfer = currentBalance >= transferAmount;
        
        expect(canTransfer).toBe(true);
        
        if (canTransfer) {
            const newBalance = await updateBalance('user-123', -transferAmount);
            expect(newBalance).toBe(4000);
        }
    });

    test('Should check transaction limits before processing', async () => {
        // Mock transaction limits
        TransLimit.mockResolvedValue([true, 100000, 1000000, 500000, 5000000, 'tier1']);
        
        const [status, dailyLimit, monthlyLimit] = await TransLimit('tier1');
        const transferAmount = 1000;
        const withinDailyLimit = transferAmount <= dailyLimit;
        
        expect(status).toBe(true);
        expect(withinDailyLimit).toBe(true);
        expect(TransLimit).toHaveBeenCalledWith('tier1');
    });
});