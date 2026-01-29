const { mailSender } = require('../../config/mailsender');
const sgMail = require('@sendgrid/mail');

// Mock SendGrid SDK
jest.mock('@sendgrid/mail');

describe('SendGrid Notifications - Unit Tests', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('mailSender should call SendGrid with correct parameters', async () => {
        sgMail.send.mockResolvedValue([{ statusCode: 202 }]);

        const emailParams = {
            to: 'customer@test.com',
            subject: 'Welcome to HitchPay',
            content: '<p>Hello User</p>',
            username: 'John Doe'
        };

        await mailSender(
            emailParams.username,
            emailParams.subject,
            emailParams.to,
            emailParams.content
        );

        expect(sgMail.send).toHaveBeenCalledWith(expect.objectContaining({
            to: emailParams.to,
            from: {
                email: 'support@hitchpay.ng',
                name: 'HitchPay'
            },
            subject: emailParams.subject,
            html: expect.stringContaining('Welcome to HitchPay')
        }));
    });

    test('mailSender should throw errors when SendGrid fails', async () => {
        // Simulate a SendGrid API failure
        sgMail.send.mockRejectedValue(new Error('SendGrid API Down'));

        // The mailSender actually re-throws errors, so we expect it to throw
        await expect(
            mailSender('User', 'Subject', 'test@test.com', 'Body')
        ).rejects.toThrow('SendGrid API Down');
    });
});