//========================IMPORT DEPENDENCIES======================
const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, ucFirst, logger, Customer, Business, BizTeam, BizInvites } = require('./dependencies');
const crypto = require("crypto");
const axios = require("axios");




// const BASE_URL = process.env.YC_BASEURL;
// const API_KEY = process.env.YC_PUBKEY;
// const API_SECRET = process.env.YC_SECRET;

const BASE_URL = !process.env.YC_BASEURL ? "https://sandbox.api.yellowcard.io" : process.env.YC_BASEURL;
const API_KEY = !process.env.YC_PUBKEY ? "712003a266035b436b279b881488ee7c" : process.env.YC_PUBKEY;
const API_SECRET = !process.env.YC_SECRET ? "541f0378820b663c968280676e14058ce732148008ebd2510974487fce04d68f" : process.env.YC_SECRET;

// console.log('BASE_URL', BASE_URL);
// console.log('API_KEY', API_KEY);
// console.log('API_SECRET', API_SECRET);


// === HELPER: Generate HMAC Signature ===
const generateSignature = async (method, path, body = "") => {
  const timestamp = new Date().toISOString();
  let signatureBaseString = `${timestamp}${path}${method.toUpperCase()}`;

  if (body) {
    const bodyHash = crypto.createHash("sha256").update(body).digest();
    signatureBaseString += bodyHash.toString("base64");
  }

  // 3. Create a raw binary HMAC-SHA256 hash of the base string.
  const hmac = crypto.createHmac("sha256", API_SECRET).update(signatureBaseString).digest();
  // 4. Base64-encode the final HMAC hash.
  const signature = hmac.toString("base64");

  const Authorization = `YcHmacV1 ${API_KEY}:${signature}`;

  return { timestamp, Authorization };
}


// === HELPER: Make Authenticated Request ===
const ycRequest = async (method, path, data = null) => {
  const url = `${BASE_URL}${path}`;

  let actualPath = path;
  // If path contains query parameters, extract the base path for signature
  if (path.includes('?')) {
    actualPath = path.split('?')[0];
  }
  // console.log("actualPath:", actualPath);


  const body = data ? JSON.stringify(data) : "";
  const { timestamp, Authorization } = await generateSignature(method, actualPath, body);


  try {

     let config = {
          method: method,
          url: url,
          headers: {
              "Content-Type": "application/json",
              "Accept": "application/json",
              "X-YC-Timestamp": timestamp,
              Authorization: Authorization,
            },
          data: body
      };

    let res = await axios.request(config);
    let thedata = res.data;

    return thedata;

  } catch (err) {
    if (err.response) {
      logger.error("❌ YellowCard API Error:", {
        status: err.response.status,
        data: err.response.data,
        headers: err.response.headers,
      });
      const error = new Error(err.response.data.message || 'An error occurred with the payment provider.');
      error.providerResponse = err.response.data;
      throw error;
    } else {

      logger.error("❌ Network or Request Setup Error:", err.message);
      throw new Error('A network error occurred while communicating with the payment provider.');
    }
  }
}

module.exports = {
  ycRequest,
  // getRate
}