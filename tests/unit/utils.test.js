const { formatAmount } = require('../../config/myfunct');

describe('Utility Functions - formatAmount', () => {
    
    test('should format a whole number with commas and two decimal places', () => {
        const result = formatAmount(1000);
        expect(result).toBe('1,000.00');
    });

    test('should handle decimal numbers correctly', () => {
        const result = formatAmount(1250.5);
        expect(result).toBe('1,250.50');
    });

    test('should return 0.00 if the input is zero', () => {
        const result = formatAmount(0);
        expect(result).toBe('0.00');
    });

    test('should handle string numbers by converting them', () => {
        const result = formatAmount("5000");
        expect(result).toBe('5,000.00');
    });
});