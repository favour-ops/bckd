
const jwt = require('jsonwebtoken');
const db = require('../../models');
const config = require('../../config/pubapi_config.js');
const { cleanMe} = require("../../config/myfunct.js");

const { success, error } = require("../../utils/pubapi_response.js");
const { generateRefreshToken, hashRefreshToken, compareClientSecret } = require('../../utils/public_tokenhelpers.js');
const { generateAccessToken } = require("../../utils/pubapi_gentoken.js");



const BizKeys = db.bizkeys;
const RefreshToken = db.bizapirefreshtoken;

const ms = require('ms'); // optional if you want human durations; else we compute dates

exports.generateToken = async (req, res, next) => {
  try {
    // Support both JSON body and form-encoded requests (OAuth2 style)
    const grant_type = cleanMe(req.body).grant_type || 'client_credentials';

    if (grant_type === 'client_credentials') {
      const client_id = req.body.client_id;
      const client_secret = req.body.client_secret;

      if (!client_id || !client_secret)
        return error(res, 'INVALID_REQUEST', 'Missing client credentials', 400);

      const merchant = await BizKeys.findOne({ where: { client_id } });
      
      if (!merchant || merchant.status != '1')
        return error(res, 'INVALID_CLIENT', 'Invalid client credentials', 401);

      const ok = await compareClientSecret(client_secret, merchant.client_secret_hash);
      if (!ok) return error(res, 'INVALID_CLIENT', 'Invalid client credentials', 401);

      // issue access token (JWT)
      const access_token = generateAccessToken(merchant);

      // create refresh token (optional)
      const rawRefreshToken = generateRefreshToken(merchant);
      const token_hash = hashRefreshToken(rawRefreshToken);

      const expiresInDays = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '30', 10);
      const expires_at = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

      await RefreshToken.create({
        token_hash,
        merchantId: merchant.id,
        bizid: merchant.bizid,
        expires_at
      });

      return success(res, {
        access_token,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: rawRefreshToken 
      }, 'Access token generated successfully');
    }

    if (grant_type === 'refresh_token') {
      const rawRefreshToken = cleanMe(req.body).refresh_token;
      
      if (!rawRefreshToken) 
        return error(res, 'INVALID_REQUEST', 'Missing refresh_token', 400);

      const token_hash = hashRefreshToken(rawRefreshToken);
      
      // Find token record
      const tokenRecord = await RefreshToken.findOne({ where: { token_hash } });
      console.log('tokenRecord', tokenRecord)
      if (!tokenRecord || tokenRecord.revoked) 
        return error(res, 'INVALID_GRANT', 'Invalid refresh token', 401);

      if (new Date(tokenRecord.expires_at) < new Date()) 
        return error(res, 'INVALID_GRANT', 'Refresh token expired', 401);

      // OK — issue new access token (and optionally rotate refresh token)
      const merchant = await BizKeys.findOne({ where: { bizid: tokenRecord.bizid } });
      console.log('merchant', merchant)

      if (!merchant || merchant.status != '1') 
        return error(res, 'INVALID_CLIENT', 'Credentials invalid', 401);

      const access_token = generateAccessToken(merchant);

      // ROTATE: revoke old refresh token and create a new one
      tokenRecord.revoked = true;
      await tokenRecord.save();

      const newRawRefresh = generateRefreshToken(merchant);
      const newHash = hashRefreshToken(newRawRefresh);
      const expiresInDays = parseInt(process.env.REFRESH_TOKEN_EXPIRY_DAYS || '30', 10);
      const expires_at = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

      await RefreshToken.create({
        token_hash: newHash,
        bizid: merchant.bizid,
        expires_at
      });

      return success(res, {
        access_token,
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: newRawRefresh
      }, 'Access token refreshed');
    }

    return error(res, 'UNSUPPORTED_GRANT_TYPE', 'grant_type not supported', 400);
  } catch (err) {
    next(err);
  }
};
