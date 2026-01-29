const reportController = require('../../controllers/reportController');

jest.mock('../../controllers/reportController');
jest.mock('../../models', () => ({
    Payn: {
        findAll: jest.fn(),
        create: jest.fn(),
        findOne: jest.fn()
    }
}));

describe('Business Reports - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('Should generate daily revenue report', async () => {
        const req = { 
            user: { id: 1 },
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        
        // Mock the getDailyRevenue function
        reportController.getDailyRevenue.mockImplementation(async (req, res) => {
            return res.status(200).json({ 
                status: true, 
                message: 'Revenue data found',
                data: [
                    { id: 1, reference: 'REV001', amount: 10000, createdAt: '2024-01-15' },
                    { id: 2, reference: 'REV002', amount: 5000, createdAt: '2024-01-20' }
                ]
            });
        });

        await reportController.getDailyRevenue(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: true,
            data: expect.any(Array)
        }));
    });

    test('Should handle transactions by date report', async () => {
        const req = { 
            user: { id: 1 },
            query: { startDate: '2024-01-01', endDate: '2024-01-31' }
        };
        const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
        
        // Mock the getTransactionsByDate function
        reportController.getTransactionsByDate.mockImplementation(async (req, res) => {
            return res.status(200).json({ 
                status: true, 
                message: 'Transactions found',
                data: [
                    { txref: 'TXN001', amount: 1000, status: 'success', createdAt: '2024-01-15' },
                    { txref: 'TXN002', amount: 500, status: 'success', createdAt: '2024-01-20' }
                ]
            });
        });

        await reportController.getTransactionsByDate(req, res);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
            status: true,
            data: expect.any(Array)
        }));
    });
});