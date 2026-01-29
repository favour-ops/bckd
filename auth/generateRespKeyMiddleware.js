const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

/**
 * Middleware to generate an AES key for response encryption when the request is unencrypted.
 * It generates a new AES key, encrypts it with the server's public RSA key,
 * and sends the encrypted key back in the 'x-hitch-key' response header.
 * The raw AES key is attached to `req.aesKey` for the EncryptResponseMiddleware to use.
 */
function GenerateResponseKeyMiddleware(req, res, next) {
    try {
        const privateKeyPem = fs.readFileSync(path.join(__dirname, '..', 'private.pem'), 'utf8');
        const publicKey = crypto.createPublicKey(privateKeyPem);

        const aesKey = crypto.randomBytes(32); // Generate a 256-bit AES key
        req.aesKey = aesKey; // Attach raw key for EncryptResponseMiddleware

        const encryptedAesKey = crypto.publicEncrypt({ key: publicKey, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha1' }, aesKey);
        res.setHeader('x-hitch-key', encryptedAesKey.toString('base64'));
        next();
    } catch (error) {
        console.error("Error in GenerateResponseKeyMiddleware:", error);
        res.status(500).json({ error: "Could not generate encryption key for response." });
    }
}

module.exports = GenerateResponseKeyMiddleware;