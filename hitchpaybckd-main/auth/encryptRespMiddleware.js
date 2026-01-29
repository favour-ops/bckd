/**
 * Middleware to decrypt request payload
 */

const { encryptResponse, decryptAESKey } = require("../config/encryptionHandler");

const DEFAULT_IV_FOR_RESPONSE = process.env.DEFAULT_RESPONSE_IV || 'skoXl1JFHjEs+uftd8f35g==';

function EncryptResponseMiddleware(req, res, next) { 
    //1. Store the original res.json
    // res._json = res.json; 
    const originalJson = res.json;

    res.json = function (data) {
        let aesKeyForResponse = req.aesKey; // Key from request decryption middleware, if any
        let ivForResponse = req.iv;       // IV from request decryption middleware, if any

        // If aesKey was not set by a request decryption middleware,
        // attempt to get it from the 'x-auth-key' header.

        if (!aesKeyForResponse) {
            const authKeyFromHeader = req.headers['auth_key']; // Header names are case-insensitive in req.headers
            if (authKeyFromHeader) {

                try {
                    aesKeyForResponse = decryptAESKey(authKeyFromHeader);
                    // console.log('AES Key for response encryption obtained and decrypted from auth_key header.');
                } catch (keyError) {
                    // console.error("Failed to decrypt AES key from auth_key header:", keyError.message);
                    return originalJson.call(this, { error: "Invalid encryption key in header" });
                }

                // If key is from header, also try to get IV from header
                const ivFromHeader = req.headers['x-auth-iv'];
                if (ivFromHeader) {
                    ivForResponse = ivFromHeader;
                    // console.log('IV for response encryption obtained from x-auth-iv header.');
                } else {
                    // If no IV from header, and not from req.iv, use a default (for context).
                    ivForResponse = DEFAULT_IV_FOR_RESPONSE;
                    // console.log('IV for response encryption not in headers, using default IV.');
                }
            }
        }

        if (!aesKeyForResponse) {
            // console.error("Encryption key (aesKey) is missing for response encryption.");
            return originalJson.call(this, { error: "Encryption key is missing" });
        }

        if (!ivForResponse) {
            // console.warn("IV was not found from req.iv or x-auth-iv header, using default IV for response encryption.");
            ivForResponse = DEFAULT_IV_FOR_RESPONSE;
        }

        let dataAsString;
        try {
            // 3. Prepare data (convert object to JSON string)
            dataAsString = JSON.stringify(data);
        } catch (stringifyError) {
            return originalJson.call(this, { error: "Failed to prepare data for encryption" });
        }

        // const encryptedResponse = encryptResponse(dataAsString, aesKeyForResponse, ivForResponse);
        const encryptedResponse = encryptResponse(dataAsString, aesKeyForResponse);

        if (!encryptedResponse) {
            // return res.status(500).send("Failed to encrypt response"); // Alternative
            return originalJson.call(this, { error: "Failed to encrypt response" });
        }

        return originalJson.call(this, encryptedResponse);
    };


   /*  res.json = function (data) { 
        const aesKey = req.aesKey;
        console.log('AES Key in Encrypt:', req.aesKey);
        console.log(data)
        if (!aesKey) {
            return res._json({ error: "Encryption key is missing" });
        }
        
        let dataAsString;
        try {
            dataAsString = JSON.stringify(data);
            
        } catch (stringifyError) {
           return res._json({ error: "Failed to prepare data for encryption" });
        }
    
        const encryptedResponse = encryptResponse(dataAsString, aesKey);

        if (!encryptedResponse) {
            return res._json({ error: "Failed to encrypt response" });        
        }

        return res._json(encryptedResponse);
    }; */

    next();
}

module.exports = EncryptResponseMiddleware;