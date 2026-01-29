const redis = require('redis');
const { client } = require('../config/redisClient');

const idempotencyCheck = async (req, res, next) => {
    const key = req.headers['uuidkey'];

    if (!key) {
        return res.status(400).json({ status: false, message: 'Missing Idempotency-Key header' });
    }

    try {
        // The shared Redis client is connected at application startup and handles reconnections automatically.
        // An explicit check/connect here is generally not needed.
        // Use a reasonable TTL, e.g., 15 minutes (900 seconds) or longer depending on expected transaction time + buffer
        const setResult = await client.set(key, 'processing', {
            NX: true, // Set only if the key does not already exist (Atomic operation)
            EX: 900   // Set the key to expire after 900 seconds (15 minutes)
        });

        if (setResult === null) {
            // console.log(`Idempotency check failed: Key "${key}" already exists.`);
            return res.status(409).json({
                status: false,
                message: 'Duplicate Request. This request is potentially already being processed or completed.'
            });
        }

        // console.log(`Idempotency check passed: Key "${key}" set.`);
        req.idempotencyKey = key;
        next();

    } catch (error) {
        // console.error("Idempotency Middleware Redis Error:", error.message);
        return res.status(503).json({
             status: false,
             message: 'Service temporarily unavailable. Could not verify request uniqueness.'
        });
        // Option B: Log the error and proceed (less safe, might allow duplicates if Redis fails)
        // console.error("Proceeding without idempotency check due to Redis error.");
        // next();
    }
};

module.exports = idempotencyCheck;