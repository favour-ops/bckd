const db = require('../../models')
const { json } = require('sequelize');
const { dispatchEvent } = require('../../utils/webhookService');
const { Op, fn } = require("sequelize");
const http = require('https');
const axios = require('axios');
const crypto = require('crypto');
const randomstring = require("randomstring");
const moment = require('moment');
const md5 = require('md5');
const { logger } = require('../../config/logger');


const BizWebHook = db.bizwebhook;
const WebHookLogs = db.bizwebhook_logs;


function generateWebhookSignature(payload, webSecret) {
  return 'sha256=' + crypto
    .createHmac('sha256', webSecret)
    .update(payload)
    .digest('hex');
}

const MAX_ATTEMPTS = 5;
const backoffSchedule = { // in minutes
  1: 1,   // 1st retry after 1 minute
  2: 5,   // 2nd retry after 5 minutes
  3: 15,  // 3rd retry after 15 minutes
  4: 60,  // 4th retry after 60 minutes (1 hour)
  5: 360, // 5th retry after 6 hours
};


const retryFailedWebhooks = async () => {
  logger.info('Starting webhook retry job...');

  const logsToRetry = await WebHookLogs.findAll({
    where: {
      status: 'pending', // Look for webhooks that are still pending
      attempt: {
        [Op.gte]: 1, // Retry any attempt that is still pending, starting from the first.
        [Op.lte]: MAX_ATTEMPTS
      }
    }
  });

  if (logsToRetry.length === 0) {
    logger.info('No webhooks to retry.');
    return;
  }

  logger.info(`Found ${logsToRetry.length} webhooks to potentially retry.`);

  for (const log of logsToRetry) {
    const lastAttemptTime = moment(log.timed, 'YYYY-MM-DD HH:mm:ss');
    const nextAttemptDelay = backoffSchedule[log.attempt];
    const nextAttemptTime = lastAttemptTime.clone().add(nextAttemptDelay, 'minutes');

    if (moment().isBefore(nextAttemptTime)) {
      // Not time to retry this one yet
      continue;
    }

    logger.info(`Retrying webhook for event: ${log.event}, reference: ${log.reference}, attempt: ${log.attempt}`);

    const webhook = await BizWebHook.findOne({ where: { bizid: log.bizid, status: 'active' } });

    if (!webhook) {
      await log.update({ status: 'failure', response_body: 'Business webhook is disabled or deleted.' });
      logger.warn(`Webhook for bizid ${log.bizid} is disabled. Marking as failure.`);
      continue;
    }

    const payload = JSON.stringify(log.payload);
    const signature = generateWebhookSignature(payload, webhook.secret);

    try {
      const response = await axios.post(webhook.url, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-hitchpay-signature': signature
        },
        timeout: 15000 // 15 seconds timeout for retries
      });

      // SUCCESS on retry
      await log.update({
        status: 'success',
        response_code: response.status.toString(),
        response_body: JSON.stringify(response.data),
        http_status: response.status,
        timed: moment().format('YYYY-MM-DD HH:mm:ss')
      });
      logger.info(`Webhook retry successful for reference: ${log.reference}`);

    } catch (error) {
      // FAILURE on retry
      const isFinalAttempt = log.attempt >= MAX_ATTEMPTS;
      await log.update({
        status: isFinalAttempt ? 'failure' : 'pending', // Mark as failure only on the last attempt
        attempt: log.attempt + 1,
        response_code: error.response?.status?.toString() || 'CLIENT_ERROR',
        response_body: error.response?.data ? JSON.stringify(error.response.data) : error.message,
        http_status: error.response?.status || null,
        timed: moment().format('YYYY-MM-DD HH:mm:ss')
      });
      logger.warn(`Webhook retry failed for reference: ${log.reference}. Is final attempt: ${isFinalAttempt}`);
    }
  }
  logger.info('Webhook retry job finished.');
};

module.exports = { retryFailedWebhooks};
