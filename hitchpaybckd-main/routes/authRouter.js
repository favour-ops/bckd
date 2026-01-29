const express = require("express");
const router = express.Router();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * @route   GET /auth/public-key
 * @desc    Get the RSA public key for request encryption
 * @access  Public
 */
router.get("/public-key", (req, res) => {
    try {
        const privateKey = fs.readFileSync(path.join(__dirname, '..', 'private.pem'), 'utf8');
        const publicKey = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
        res.status(200).json({ publicKey });
    } catch (error) {
        console.error("Error reading public key:", error);
        res.status(500).json({ status: false, message: "Could not retrieve public key." });
    }
});

module.exports = router;
