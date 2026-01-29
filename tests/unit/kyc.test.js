// Test KYC controller functions
const kycController = require('../../controllers/kycController');

describe('KYC Verification - Unit Tests', () => {
    test('initVeriff should be available as a function', async () => {
        // Test that the function exists
        expect(typeof kycController.initVeriff).toBe('function');
    });

    test('verVeriffHook should be available as a function', async () => {
        // Test that the function exists
        expect(typeof kycController.verVeriffHook).toBe('function');
    });

    test('verVeriffHookProd should be available as a function', async () => {
        // Test that the function exists
        expect(typeof kycController.verVeriffHookProd).toBe('function');
    });

    test('verVeriffHookTestSimulate should be available as a function', async () => {
        // Test that the function exists
        expect(typeof kycController.verVeriffHookTestSimulate).toBe('function');
    });

    test('KYC controller should export required functions', async () => {
        // Test that all expected functions are exported
        const expectedFunctions = ['initVeriff', 'verVeriffHook', 'verVeriffHookProd', 'verVeriffHookTestSimulate'];
        
        expectedFunctions.forEach(funcName => {
            expect(typeof kycController[funcName]).toBe('function');
        });
    });
});