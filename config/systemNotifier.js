const { mailSender } = require('./mailsender');
const { pushNotify } = require('./notifyuser');
const { logger } = require('./logger');
const db = require('../models');
const Customer = db.customers;
const Op = db.Sequelize.Op;

const NOTIFICATION_EMAILS = process.env.SYSTEM_NOTIFICATION_EMAILS ? process.env.SYSTEM_NOTIFICATION_EMAILS.split(',') : [];
const SYSTEM_NOTIFICATION_IDs = process.env.SYSTEM_NOTIFICATION_ID ? process.env.SYSTEM_NOTIFICATION_ID : '4, 6, 25';


const sendSystemNotification = async ({ subject, message, channels = ['email', 'push'] }) => {
    if (!subject || !message) {
        logger.warn('System notification was called without a subject or message.');
        return;
    }

    // --- Email Notifications ---
    if (channels.includes('email') && NOTIFICATION_EMAILS.length > 0) {
        try {
            const emailPromises = NOTIFICATION_EMAILS.map(email =>
                mailSender('HitchPay System', subject, email.trim(), message)
            );
            const results = await Promise.allSettled(emailPromises);

            results.forEach((result, index) => {
                if (result.status === 'rejected') {
                    logger.error(`Failed to send system notification email to ${NOTIFICATION_EMAILS[index].trim()}`, { error: result.reason });
                }
            });
        } catch (error) {
            logger.error('An error occurred while sending system notification emails.', { error });
        }
    }

    // --- Push Notifications ---
    if (channels.includes('push')) {
        try {
            const adminsToNotify = await Customer.findAll({
                where: { id: { [Op.in]: [SYSTEM_NOTIFICATION_IDs] } } 
            });

            console.log('adminsToNotify', adminsToNotify)
            
            adminsToNotify.forEach(admin => {
                pushNotify(admin.id, subject, message, 'personal');
            });
        } catch (error) {
            logger.error('An error occurred while sending system push notifications.', { error });
        }
    }
};

module.exports = { sendSystemNotification };