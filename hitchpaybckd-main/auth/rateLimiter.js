const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
// Import the shared Redis client instance from your config file.
const { client: redisClient, connectRedis } = require('../config/redisClient');

const pinLimiter = rateLimit({
    // 1. Configure the store
    // server instances or restarts.
    store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
    }),

    // 2. Set the time window
    windowMs: 15 * 60 * 1000, // 15 minutes

    // 3. Set the max number of requests 5 strikes (use 'max' instead of 'limit')
    max: 5,

    // 4. Customize the response

    message: {
        status: false,
        message: 'Too many attempts. Action has been blocked. Please try again in 15 minutes.'
    },

    // 5. Use modern, standardized headers
    standardHeaders: 'draft-7', // Recommended
    legacyHeaders: false,

    // 6. Customize the key to be more secure
    keyGenerator: (req, res) => {
        // Assuming you have user info on the request object after authentication
        if (req.user?.id) {
            return req.user.id;
        }
        // Fallback to IP address if user is not available
        return req.ip;
    },
});



// --- Updated Rate Limiter ---
const paymentLimiter = rateLimit({
  store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  windowMs: 10 * 1000, // 10 seconds window
  max: 3, // Max 3 request *per endpoint per IP* within the window
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
      status: false,
      message: 'Too many requests on this endpoint, please try again later.'
  },
  keyGenerator: (req, res) => {
    // Using user ID if available makes the limit more specific and fair
    return req.user?.id || `${req.ip}:${req.path}`;
  }
});

// --- Other Limiters (Example: Stricter for sensitive actions) ---
const sensitiveActionLimiter = rateLimit({
  store: new RedisStore({
      sendCommand: (...args) => redisClient.sendCommand(args),
  }),
  windowMs: 5 * 60 * 1000, // 5 minutes window
  max: 5,  // Allow only 5 attempts within 5 minutes per IP/user
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: {
      status: false,
      message: 'Too many attempts for this action, please try again later.'
  },
  keyGenerator: (req, res) => {
    // Using user ID if available makes the limit more specific and fair
    return req.user?.id || `${req.ip}:${req.path}`;
  }
});

// --- General API Limiter (Optional: For less critical endpoints) ---
const generalApiLimiter = rateLimit({
    store: new RedisStore({
        sendCommand: (...args) => redisClient.sendCommand(args),
    }),
    windowMs: 1 * 60 * 1000, // 1 minute window
    max: 60, // Allow 60 requests per minute per endpoint per IP
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: {
        status: false,
        message: 'Too many requests, please slow down.'
    },
    keyGenerator: (req, res) => {
        // Using user ID if available makes the limit more specific and fair
        return req.user?.id || `${req.ip}:${req.path}`;
    }
});

// connectRedis();

module.exports = {generalApiLimiter, sensitiveActionLimiter, paymentLimiter, pinLimiter};
