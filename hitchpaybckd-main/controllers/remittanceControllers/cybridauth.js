//========================IMPORT DEPENDENCIES======================
const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, ucFirst, logger, Customer, Business, BizTeam, BizInvites } = require('./dependencies');
const crypto = require("crypto");
const axios = require("axios");

let cybridAccessTokenCache = {
    token: null,
    expiry: 0
};

const cybridToken = async () => {
    // console.log('cybdtokn')
    try {
        const options = {
            method: 'POST',
            url: `${process.env.CYBRID_API_BASE}/oauth/token`,
            headers: { 
                accept: 'application/json', 
                'content-type': 'application/json' 
            },
            data: {
                grant_type: 'client_credentials',
                client_id: process.env.CYBRD_BANK_ID,
                client_secret: process.env.CYBRD_BANK_SECRET,
                scope: 'banks:read banks:write bank_applications:execute accounts:read accounts:execute counterparties:read counterparties:pii:read counterparties:write counterparties:execute customers:read customers:pii:read customers:write customers:execute prices:read quotes:execute quotes:read trades:execute trades:read transfers:execute transfers:read transfers:write external_bank_accounts:read external_bank_accounts:pii:read external_bank_accounts:write external_bank_accounts:execute external_wallets:read external_wallets:execute workflows:read workflows:execute deposit_addresses:read deposit_addresses:execute deposit_bank_accounts:read deposit_bank_accounts:execute invoices:read invoices:write invoices:execute identity_verifications:read identity_verifications:pii:read identity_verifications:write identity_verifications:execute persona_sessions:execute plans:execute plans:read executions:execute executions:read files:read files:pii:read files:execute',
            }
        };
    
        let response = await axios.request(options);
        let thedata = response.data;

        if (thedata && thedata.access_token) {
            const access_token = thedata.access_token;
            const expires_in = thedata.expires_in; // in seconds
            const token_type = thedata.token_type;
            const scope = thedata.scope;

            // Cache the token with its expiry time (a few seconds before actual expiry for buffer)
            cybridAccessTokenCache = {
                token: access_token,
                expiry: Date.now() + (expires_in * 1000) - 5000 // 5 seconds buffer
            };
            logger.info('Cybrid token refreshed successfully.');
            return [true, access_token, expires_in, scope];
        } else {
            logger.error('cybridToken: Failed to get access token from Cybrid response.', thedata);
            return [false, 'Failed to retrieve access token', null, null];
        }

    } catch (error) {
        logger.error('cybridToken: Error fetching token from Cybrid', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, 'Error fetching Cybrid token', null, null];
    }
}

const getCybridAccessToken = async () => {
    if (cybridAccessTokenCache.token && cybridAccessTokenCache.expiry > Date.now()) {
        logger.info('Using cached Cybrid access token.');
        return [true, cybridAccessTokenCache.token, null, null]; // Return cached token
    } else {
        return await cybridToken(); // Fetch a new token if expired or not present
    }
}


module.exports = {
  getCybridAccessToken,
};
