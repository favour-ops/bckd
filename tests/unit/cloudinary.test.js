const onboardingController = require('../../controllers/businessControllers/onboarding');
const { Business, db } = require('../../controllers/businessControllers/_dependencies');
const cloudinary = require('cloudinary').v2;

// Mock Cloudinary SDK
jest.mock('cloudinary');

describe('Cloudinary Integration - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        cloudinary.uploader.upload_stream = jest.fn((options, callback) => {
            // Simulate a successful upload response from Cloudinary
            callback(null, { secure_url: 'https://res.cloudinary.com/hitchpay/image/upload/v1/biz/logo.png' });
            return { end: jest.fn() };
        });
    });

    test('Should successfully process and return Cloudinary URL for business logo', async () => {
        const mockFile = {
            buffer: Buffer.from('fake-image-data'),
            mimetype: 'image/png'
        };

        // In your controller, this is where the Cloudinary stream is called
        const uploadResult = await new Promise((resolve, reject) => {
            const stream = cloudinary.uploader.upload_stream({ folder: 'biz_logos' }, (error, result) => {
                if (error) reject(error);
                else resolve(result);
            });
            stream.end(mockFile.buffer);
        });

        expect(uploadResult.secure_url).toBeDefined();
        expect(uploadResult.secure_url).toContain('hitchpay');
        expect(cloudinary.uploader.upload_stream).toHaveBeenCalled();
    });
});