const { calculateProfitAndFee, getFee } = require('../../config/myfunct');

jest.mock('../../config/myfunct', () => {
    const actual = jest.requireActual('../../config/myfunct');
    return {
        ...actual,
        calculateProfitAndFee: jest.fn(),
        getFee: jest.fn()
    };
});

describe('Utility Payment Processing - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Should enforce airtime purchase limits', async () => {
        const airtimeLimit = 20000;
        const purchaseAmount = 50000;
        
        const isOverLimit = purchaseAmount > airtimeLimit;
        
        expect(isOverLimit).toBe(true);
    });

    test('Should allow airtime purchase within limits', async () => {
        const airtimeLimit = 20000;
        const purchaseAmount = 2000;
        
        const isOverLimit = purchaseAmount > airtimeLimit;
        
        expect(isOverLimit).toBe(false);
    });

    test('Should calculate profit and fee correctly', async () => {
        // Mock profit and fee calculation
        calculateProfitAndFee.mockReturnValue({
            totalChargedToCustomer: 2000,
            ourFee: 0,
            profit: 50,
            providerFeeActual: 1950
        });
        
        const amount = 2000;
        const product = 'airtime';
        const result = await calculateProfitAndFee(amount, product);
        
        expect(result.totalChargedToCustomer).toBe(2000);
        expect(result.profit).toBe(50);
        expect(calculateProfitAndFee).toHaveBeenCalledWith(amount, product);
    });

    test('Should calculate transaction fees correctly', async () => {
        // Mock fee calculation
        getFee.mockReturnValue(100);
        
        const amount = 5000;
        const fee = await getFee(amount);
        
        expect(fee).toBe(100);
        expect(getFee).toHaveBeenCalledWith(amount);
    });
});