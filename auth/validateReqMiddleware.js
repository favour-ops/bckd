/**
 * Middleware to decrypt request payload
 */
const { decryptAESKey, decryptRequest} = require("../config/encryptionHandler");

function DecryptDataMiddleware(req, res, next) {
    const encryptedAesKey = req.headers["auth_key"];

    if (!encryptedAesKey) {
        return res.status(400).json({ error: "Missing encryption key" });
    }

    let aesKey;
    try {
        aesKey = decryptAESKey(encryptedAesKey);
        if (!aesKey) {
            console.error("Failed to decrypt AES key from header.");
            return res.status(400).json({ error: "Invalid encryption key" });
        }

        // Key successfully decrypted, so it's available even if there's no body to decrypt.
        req.aesKey = aesKey;

    } catch (keyError) {
        console.error("Error decrypting AES key:", keyError);
        return res.status(400).json({ error: "Invalid encryption key" });
    }

    // Now, check if there's a body to decrypt.
    // Only proceed with body decryption if data and iv are present.
    const { data, iv } = req.body || {}; // Use default empty object if req.body is null/undefined

    // console.log('req.body', req.body)
    if (data && iv) {
        // console.log('Found data and iv in request body, attempting decryption...');
        try {
            const decryptedString = decryptRequest(data, aesKey, iv); // Pass the already decrypted aesKey
            if (decryptedString === null || decryptedString === undefined) { // Check explicitly for null/undefined return
                // console.error("decryptRequest returned null or undefined.");
                return res.status(400).json({ error: "Failed to decrypt payload" });
            }

            let decryptedData;
            try {
                decryptedData = JSON.parse(decryptedString);
            } catch (parseError) {
                // console.error("Failed to parse decrypted data:", parseError);
                return res.status(400).json({ error: "Invalid data format after decryption" });
            }

            // console.log('decryptedData', decryptedData)
            req.body = decryptedData; // Replace encrypted body with decrypted object
            console.log('Request body successfully decrypted and replaced.');
            next(); // Continue processing

        } catch (decryptError) {
            // console.error("Error during request body decryption:", decryptError);
            res.status(500).json({ error: "Internal server error during decryption" });
        }
    } else {
        // If there's no data/iv in the body, that's okay for some routes (like GET).
        // The aesKey is already attached (req.aesKey), so just proceed.
        console.log('No data/iv found in request body, proceeding without body decryption.');
        next(); // Continue processing
    }
}

module.exports = DecryptDataMiddleware;