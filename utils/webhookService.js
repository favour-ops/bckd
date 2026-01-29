const db = require('../models');
const axios = require('axios');
const crypto = require('crypto');
const { Op } = require('sequelize');
const { logger } = require('../config/logger');
const BizWebhook = db.bizwebhook;

/**
 * Signs the webhook payload using HMAC-SHA256.
 * @param {string} secret - The webhook's secret key.
 * @param {string} payload - The JSON stringified payload.
 * @returns {string} The HMAC signature.
 */
const signPayload = (secret, payload) => {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
};

/**
 * Dispatches an event to all subscribed webhooks.
 * This function is designed to be "fire-and-forget" from the caller's perspective.
 *
 * @param {string} eventName - The name of the event (e.g., 'transaction.updated').
 * @param {object} data - The data payload for the event.
 */
const dispatchEvent = async (eventName, data) => {
    const env = process.env.APPENV === 'production' ? 'live' : 'test';
    logger.info(`Dispatching webhook event: ${eventName} in ${env} environment.`);

    try {
        // Find all active webhooks subscribed to this event for the current environment
        const subscriptions = await BizWebhook.findAll({
            where: {
                env: env,
                status: 'active',
                events: {
                    [Op.contains]: [eventName]
                }
            }
        });

        if (subscriptions.length === 0) {
            logger.info(`No active subscribers for event: ${eventName}`);
            return;
        }

        const payload = JSON.stringify({
            event: eventName,
            data: data
        });

        // Process all webhook deliveries concurrently
        const deliveryPromises = subscriptions.map(async (webhook) => {
            const signature = signPayload(webhook.secret, payload);
            const headers = {
                'Content-Type': 'application/json',
                'hitchpay-signature': signature
            };

            try {
                await axios.post(webhook.url, payload, { headers, timeout: 10000 }); // 10-second timeout
                logger.info(`Successfully sent webhook for event ${eventName} to ${webhook.url} for bizid ${webhook.bizid}`);
                // Reset failure count on success
                if (webhook.failure_count > 0) {
                    await webhook.update({ failure_count: 0, last_failure: null });
                }
            } catch (error) {
                logger.error(`Failed to send webhook to ${webhook.url} for bizid ${webhook.bizid}. Error: ${error.message}`);
                const newFailureCount = webhook.failure_count + 1;
                const updatePayload = {
                    failure_count: newFailureCount,
                    last_failure: new Date()
                };

                // Deactivate webhook after 5 consecutive failures
                if (newFailureCount >= 5) {
                    updatePayload.status = 'inactive';
                    logger.warn(`Deactivated webhook for ${webhook.url} (bizid: ${webhook.bizid}) after 5 consecutive failures.`);
                }
                await webhook.update(updatePayload);
            }
        });

        // Wait for all deliveries to be attempted
        await Promise.allSettled(deliveryPromises);

    } catch (error) {
        logger.error('Critical error in dispatchEvent service:', error);
    }
};

module.exports = {
    dispatchEvent
};