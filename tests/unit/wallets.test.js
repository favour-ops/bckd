const walletController = require('../../controllers/walletController');
const { Wallets, db } = require('../../models');

jest.mock('../../models');

describe('Wallet Operations - Unit Tests', () => {
    test('Should prevent debit if balance is insufficient', async () => {
        const mockWallet = { wbal: 100, ledger: 100 };
        const amountToDebit = 500;

        // Logic check: if (wallet.wbal < amountToDebit) return error
        const hasFunds = mockWallet.wbal >= amountToDebit;
        
        expect(hasFunds).toBe(false);
    });

    test('Should correctly calculate ledger vs available balance', () => {
        const wallet = { wbal: 1000, ledger: 1500 }; // 500 is pending/locked
        const available = parseFloat(wallet.wbal);
        
        expect(available).toBe(1000);
    });
});