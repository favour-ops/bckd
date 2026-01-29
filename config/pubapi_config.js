
require("dotenv").config();

module.exports = {
  port: process.env.PORT || 5000,
  env: process.env.APPENV || "development",
  jwtSecret: process.env.PUBLIC_API_JWT_SECRET,
  webhookSecret: process.env.WEBHOOK_SECRET,
  tokenExpiry: process.env.ACCESS_TOKEN_EXPIRY || "1h",
};
