// middlewares/errorHandler.js
const { logger } = require('./logger');

module.exports = (err, req, res, next) => {
    console.error(`[Error] ${err.message}`);
    logger.error('Error handler triggered:', err); // Log the error
    console.log('here is the error handler', err)
    res.status(500).json({
        status: false,
        // message: err.message || 'Internal Server Error'
        message: 'Something went wrong. Please try again later.'
    });
};
