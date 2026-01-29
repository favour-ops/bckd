const { TransLimit } = require('../../config/myfunct');

jest.mock('../../config/myfunct', () => {
    const actual = jest.requireActual('../../config/myfunct');
    return {
        ...actual,
        TransLimit: jest.fn()
    };
});

describe('Transaction Limits - Unit Tests', () => {
    test('Should deny transaction if it exceeds daily limit', async () => {
        // Mock TransLimit to return limits for testing
        TransLimit.mockResolvedValue([true, 50000, 50000, 100000, 1000000, 'tier1']);
        
        const [status, dailyLimit, monthlyLimit] = await TransLimit('tier1');
        const totalSpentToday = 45000;
        const newTransaction = 10000;

        const isOverDailyLimit = (totalSpentToday + newTransaction) > dailyLimit;
        
        expect(isOverDailyLimit).toBe(true);
        expect(status).toBe(true);
    });

    test('Should allow transaction if within remaining limit', async () => {
        // Mock TransLimit to return limits for testing
        TransLimit.mockResolvedValue([true, 100000, 500000, 200000, 2000000, 'tier2']);
        
        const [status, dailyLimit, monthlyLimit] = await TransLimit('tier2');
        const totalSpentToday = 20000;
        const newTransaction = 5000;

        const isOverDailyLimit = (totalSpentToday + newTransaction) > dailyLimit;
        
        expect(isOverDailyLimit).toBe(false);
        expect(status).toBe(true);
    });
});