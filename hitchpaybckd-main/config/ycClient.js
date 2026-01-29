const axios = require('axios');
const crypto = require('crypto');
const { logger } = require('../config/logger');

const BASE_URL = !process.env.YC_BASEURL ? "https://sandbox.api.yellowcard.io" : process.env.YC_BASEURL;
const API_KEY = !process.env.YC_PUBKEY ? "712003a266035b436b279b881488ee7c" : process.env.YC_PUBKEY;
const API_SECRET = !process.env.YC_SECRET ? "541f0378820b663c968280676e14058ce732148008ebd2510974487fce04d68f" : process.env.YC_SECRET;

// === HELPER: Generate HMAC Signature ===
const generateSignature = async (method, path, body = "") => {
  const timestamp = new Date().toISOString();
  let signatureBaseString = `${timestamp}${path}${method.toUpperCase()}`;

  if (body) {
    // 1. Create a raw binary SHA256 hash of the body string.
    const bodyHash = crypto.createHash("sha256").update(body).digest();
    // 2. Base64-encode the raw hash and append it.
    signatureBaseString += bodyHash.toString("base64");
  }

  // 3. Create a raw binary HMAC-SHA256 hash of the base string.
  const hmac = crypto.createHmac("sha256", API_SECRET).update(signatureBaseString).digest();
  // 4. Base64-encode the final HMAC hash.
  const signature = hmac.toString("base64");

  const Authorization = `YcHmacV1 ${API_KEY}:${signature}`;

  return { timestamp, Authorization };
}


const ycRequest = async (method, path, body = null) => {
    try {
        const timestamp = Math.floor(Date.now() / 1000);
        const nonce = Math.random().toString(36).substring(2, 12);
        const apiKey = process.env.YC_APIKEY;
        const apiSecret = process.env.YC_APISECRET;

        let signaturePayload = `${timestamp}${nonce}${method.toUpperCase()}${path}`;
        if (body) {
            signaturePayload += JSON.stringify(body);
        }

        const signature = crypto
            .createHmac('sha512', apiSecret)
            .update(signaturePayload)
            .digest('hex');

        const config = {
            method: method,
            url: `${process.env.YC_BASEURL}${path}`,
            headers: {
                'Content-Type': 'application/json',
                'X-YC-APIKEY': apiKey,
                'X-YC-TIMESTAMP': timestamp,
                'X-YC-NONCE': nonce,
                'X-YC-SIGNATURE': signature
            },
            data: body
        };

        const response = await axios(config);
        return response.data;
    } catch (error) {
        logger.error(`YellowCard API Request Error for ${path}: ${error.message}`, { response: error.response?.data });
        throw error; // Re-throw the error to be handled by the caller
    }
};

module.exports = { ycRequest };