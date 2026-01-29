const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const config = require("../config/pubapi_config.js");
const randomstring = require("randomstring");

// exports.generateRefreshToken = () => {
//   return crypto.randomBytes(48).toString('hex'); // raw token (send to client once)
// };

exports.generateRefreshToken = (merchant) => {
  // console.log('merchantId', merchant)
  return jwt.sign({ merchantId: merchant.id, merchantname: merchant.bizname, jti: randomstring.generate(16)}, config.jwtSecret, {
    expiresIn: config.tokenExpiry,
  });
};

exports.hashRefreshToken = (token) => {
  return crypto.createHash('sha256').update(token).digest('hex');
};

exports.hashClientSecret = async (secret) => {
  return bcrypt.hash(secret, 12);
};

exports.compareClientSecret = async (secret, hash) => {
  return bcrypt.compare(secret, hash);
};
