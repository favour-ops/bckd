const db = require('../models')
const { json, Sequelize } = require('sequelize');
const { dispatchEvent } = require('../utils/webhookService');
const { Op, fn } = require("sequelize");
const http = require('https');
const axios = require('axios');
const crypto = require('crypto');
const randomstring = require("randomstring");
const moment = require('moment');
const { getUserInfo, getBizInfo } = require("./userdetails");
const { sendSMS, sendWhatsApp, pushNotify, notifyMe } = require("./notifyuser");
const { mailSender } = require("./mailsender");
const md5 = require('md5');
const { logger } = require('../config/logger');


const BizWebHook = db.bizwebhook;
const WebHookLogs = db.bizwebhook_logs;


function generateWebhookSignature(payload, webSecret) {
  return crypto
    .createHmac('sha256', webSecret)
    .update(payload)
    .digest('hex');
}


async function sendWebhook({ bizid, event, payreference, data }) {
  try {
    const webhook = await BizWebHook.findOne({
      where: {
        bizid, status: 'active',
        [Op.and]: [Sequelize.where(Sequelize.fn('JSON_CONTAINS', Sequelize.col('events'), `"${event}"`), 1)]
      }
    });

    // console.log('Webhook fetched:', webhook);

    if (!webhook) {
      return { success: false, error: 'No active webhook found for this event.' };
    }

    const { url: webhookUrl, secret: webSecret } = webhook;

    // Prepare the payload
    const payload = JSON.stringify({
      event, data,
      sent_at: new Date().toISOString()
    });

    const signature = generateWebhookSignature(payload, webSecret);

    try {

      // log the attempt before sending
      await WebHookLogs.create({
        bizid, reference: payreference, event,
        response_code: '', payload, response_body: '', http_status: null,
        attempt: 1, status: 'pending', timed: moment().format('YYYY-MM-DD HH:mm:ss')
      });

      // Send the request
      const response = await axios.post(webhookUrl, payload, {
        headers: {
          'Content-Type': 'application/json',
          'x-hitchpay-signature': signature
        },
        timeout: 10000 // 10 seconds
      });

      //log the response
      await WebHookLogs.update({
        response_code: response.status.toString(),
        response_body: JSON.stringify(response.data),
        http_status: response.status,
        status: 'success',
        timed: moment().format('YYYY-MM-DD HH:mm:ss')
      }, {
        where: {
          bizid, reference: payreference, event
        }
      }
      );

      // Return success if the request was successful
      return {
        success: true,
        statusCode: response.status,
        response: response.data
      };

    } catch (error) {
      // On failure, update the log with the error, but keep status as 'pending' for the retry job.
      await WebHookLogs.update({
        response_code: error.response?.status?.toString() || 'CLIENT_ERROR',
        response_body: error.response?.data ? JSON.stringify(error.response.data) : error.message,
        http_status: error.response?.status || null,
        timed: moment().format('YYYY-MM-DD HH:mm:ss')
      }, {
        where: {
          bizid, reference: payreference, event
        }
      }
      );

      return {
        success: false,
        statusCode: error.response?.status || 500,
        error: error.message
      };
    }
  } catch (error) {
    return { success: false, error: error.message };
  }
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
        [Op.gt]: 1, // Initial attempt is 1, so we retry for attempts > 1
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

module.exports = { sendWebhook, retryFailedWebhooks };
