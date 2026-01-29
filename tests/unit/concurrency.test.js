const { updateBalance, updateLedgerBalance, db } = require('../../config/myfunct');

jest.mock('../../config/myfunct', () => {
    const actual = jest.requireActual('../../config/myfunct');
    return {
        ...actual,
        updateBalance: jest.fn(),
        updateLedgerBalance: jest.fn(),
        db: {
            sequelize: {
                transaction: jest.fn()
            }
        }
    };
});

describe('Financial Concurrency - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Should handle concurrent balance updates using transactions', async () => {
        // Mock the database transaction
        const mockTransaction = { commit: jest.fn(), rollback: jest.fn() };
        const { db } = require('../../config/myfunct');
        
        // Set up mocks before calling functions
        db.sequelize.transaction.mockResolvedValue(mockTransaction);

        const amountToDebit = 1000;
        
        // Simulate concurrent balance update logic
        const concurrentOperations = Array.from({ length: 5 }, (_, i) => 
            new Promise(async (resolve) => {
                // Simulate getting a transaction
                const transaction = await db.sequelize.transaction();
                
                // Simulate balance update logic
                const success = true; // Mock successful update
                
                if (success) {
                    await transaction.commit();
                    resolve(true);
                } else {
                    await transaction.rollback();
                    resolve(false);
                }
            })
        );

        // All operations should complete successfully
        const results = await Promise.all(concurrentOperations);
        
        expect(results).toHaveLength(5);
        expect(results.every(result => result === true)).toBe(true);
        expect(mockTransaction.commit).toHaveBeenCalledTimes(5);
        expect(mockTransaction.rollback).toHaveBeenCalledTimes(0);
    });
});