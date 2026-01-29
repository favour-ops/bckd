// utils/axiosInstance.js
const axios = require('axios');

// Create an Axios instance
const axiosApiClient = axios.create({
    timeout: 10000, // 10 seconds timeout
});

// Add a response interceptor to handle errors globally
axiosApiClient.interceptors.response.use(
    (response) => response,
    (error) => {
        if (error.code === 'ECONNABORTED') {
            throw new Error('Request timed out. Please try again later.');
        } else if (error.code === 'ECONNREFUSED') {
            throw new Error('Failed to connect to the provider. Please try again later.');
        } else if (error.response) {
            const status = error.response.status;
            const message = error.response.statusText || 'API error occurred';
            throw new Error(`API Error (${status}): ${message}`);
            // throw new Error(`Something went wrong. Kindly check your internet and try again`);
        } else if (error.request) {
            throw new Error('No response received from the upstream server.');
        } else {
            throw new Error('An unexpected error occurred.');
        }
    }
);

module.exports = axiosApiClient;
