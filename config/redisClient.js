// c:\Workspace\nodejs\hitchpaybckd\config\redisClient.js
const redis = require('redis');
require('dotenv').config();

const redisUrl = process.env.REDIS_URL;
const redisHost = process.env.REDIS_HOST;
const redisPort = process.env.REDIS_PORT;
const redisPassword = process.env.REDIS_PASSWORD;

// Use environment variables or hardcoded values for connection
const client = redis.createClient({
    password: redisPassword || 'd5KzPDUE4FG278iWehkRjWM9CDhh04nT', // Use env var first
    socket: {
        host: redisHost || 'redis-13461.c258.us-east-1-4.ec2.redns.redis-cloud.com', // Use env var first
        port: redisPort || 13461 // Use env var first
    }
    // Or use the URL if you have it:
    // url: redisUrl
});

client.on('error', err => console.error('Global Redis Client Error:', err.message, new Date().toISOString())); // Enhanced logging
client.on('connect', () => console.log('Redis client connecting...', new Date().toISOString())); // Changed log message
client.on('ready', () => console.log('Redis client ready', new Date().toISOString()));
client.on('end', () => console.warn('Redis client connection closed', new Date().toISOString())); // Log warning on close
client.on('reconnecting', () => console.warn('Redis client reconnecting...', new Date().toISOString())); // Log reconnect attempts

// Function to connect during startup (Keep this as it is)
const connectRedis = async () => {
    if (!client.isOpen) {
        try {
            console.log('Attempting to connect to Redis...');
            await client.connect();
            console.log('Successfully connected to Redis');
        } catch (err) {
            console.error('Failed to connect to Redis during startup:', err);
            process.exit(1); // Exit if Redis is critical for the app
        }
    } else {
        console.log('Redis client is already open or connecting.');
    }
};

module.exports = { client, connectRedis };
