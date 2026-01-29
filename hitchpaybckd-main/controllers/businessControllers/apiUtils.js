const db = require('../models');
const { logger } = require('./logger');

const LogRequest = db.logrequest;
const LogResponse = db.logresponse;

/**
 * Logs API request and response payloads to the database.
 * This is an async function but is designed to be "fire-and-forget"
 * so it doesn't block the main API response flow.
 *
 * @param {object} logData - The data to be logged.
 * @param {string} logData.reference - A unique reference for the transaction.
 * @param {number} logData.ownerId - The ID of the business or user making the request.
 * @param {object} logData.requestPayload - The incoming request body.
 * @param {object} logData.responsePayload - The outgoing response body.
 * @param {string} logData.product - A string identifying the API product/endpoint.
 * @param {string} logData.provider - The internal service or provider handling the request.
 */


const logApiActivity = async (logData) => {
    const { reference, ownerId, requestPayload, responsePayload, product, provider } = logData;
    const timed = Math.floor(Date.now() / 1000);

    try {
        // Use Promise.allSettled to ensure both logging attempts are made,
        // even if one fails.
        await Promise.allSettled([
            LogRequest.create({
                reference, product, provider, timed,
                jsonreq: JSON.stringify(requestPayload),
            }),
            LogResponse.create({
                reference, ownerid: ownerId, product, provider, timed,
                jsonresp: JSON.stringify(responsePayload),
            })
        ]);
    } catch (error) {
        logger.error('Failed to log API activity for reference:', { reference, error: error.message });
    }
};

module.exports = { logApiActivity };