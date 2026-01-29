const { logApiActivity } = require('../config/myfunct');
const { v4: uuidv4 } = require('uuid');

/**
 * Middleware to automatically log API requests and their corresponding responses.
 * It captures the request body and intercepts the response body before it's sent.
 * Logging is performed "fire-and-forget" on the 'finish' event to avoid delaying the response.
 */

const apiLoggingMiddleware = (options = {}) => {
    const excludeRoutes = options.exclude || [];

    return (req, res, next) => {
        // If the request path is in the exclusion list, skip logging.
        if (excludeRoutes.includes(req.path)) {
            return next();
        }

    const reference = uuidv4();
    req.reference = reference; // Attach to request object for potential use in controllers

    const requestPayload = { ...req.body }; // Shallow copy to avoid mutation issues
    const originalJson = res.json;
    let responseBody = null;

    // Override res.json to capture the response body
    res.json = function (body) {
        responseBody = body;
        return originalJson.apply(res, arguments);
    };

    // Listen for the 'finish' event, which is emitted when the response has been sent
    res.on('finish', () => {
        // The ownerId might be on req.user (for dashboard users)
        // or req.merchant (for public API key users). We handle both.
        const ownerId = req.user?.id || req.merchant?.bizid || null;

        // Determine a product/endpoint name from the request path.
        // e.g., /api/business/paylink/create -> business:paylink:create
        const product = req.path.split('/').filter(Boolean).join(':');

        // Don't await this; let it run in the background.
        logApiActivity({
            reference: reference,
            ownerId: ownerId,
            requestPayload: requestPayload,
            responsePayload: responseBody,
            product: product,
            provider: 'internal-middleware'
        });
    });

    next();
    }
};

module.exports = apiLoggingMiddleware;
