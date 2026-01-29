const jwt = require("jsonwebtoken");
const config = require("../config/pubapi_config.js");
const randomstring = require("randomstring");

/* exports.generateAccessToken = (merchantId) => {
  // console.log('merchantId', merchantId)
  return jwt.sign({ merchantId, jti: randomstring.generate(16)}, config.jwtSecret, {
    expiresIn: config.tokenExpiry,
  });
}; */

exports.generateAccessToken = (merchant) => {
  return jwt.sign({ 
    merchantId: merchant.id, 
    grant_type: "access_token",
    merchantName: merchant.bizname, 
    credential_type: merchant.keymode, 
    jti: randomstring.generate(32)
  }, 
    config.jwtSecret, {
    expiresIn: config.tokenExpiry,
  });
};