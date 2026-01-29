const { privateDecrypt, constants, randomBytes, createCipheriv, createDecipheriv} = require("crypto");
const { readFileSync } = require("fs");

// Load RSA Private Key
const privateKey = readFileSync("private.pem", "utf8");

function decryptAESKey(encryptedAesKeyBase64) {
    const encryptedBuffer = Buffer.from(encryptedAesKeyBase64, "base64");

    try {
        let decryptedBuffer = privateDecrypt(
            {
                key: privateKey,
                padding: constants.RSA_PKCS1_OAEP_PADDING,
                oaepHash: "sha1",
            },
            encryptedBuffer
        );

        // Return the raw buffer, not a string representation
        // return decrypted; // <--- CHANGE HERE
        // return decrypted.toString("utf8");

        if (decryptedBuffer.length === 44) {
            console.warn("WORKAROUND: Decrypted AES key is 44 bytes, attempting Base64 decode. Client should send raw key encrypted.");
            try {
                const potentiallyRawKey = Buffer.from(decryptedBuffer.toString('utf8'), 'base64');
                if (potentiallyRawKey.length === 32) {
                    // console.log("WORKAROUND: Successfully decoded Base64 AES key to 32 bytes.");
                    return potentiallyRawKey; // Return the actual 32-byte key
                } else {
                    // console.error(`WORKAROUND FAILED: Decoded key length is ${potentiallyRawKey.length}, expected 32.`);
                    // Fall through to throw error below
                }
            } catch (decodeError) {
                // console.error("WORKAROUND FAILED: Error decoding suspected Base64 key:", decodeError);
            }
        }

        return decryptedBuffer; 
        
    } catch (error) {
        console.error("AES key decryption failed:", error);
        // Handle the error appropriately, maybe throw or return null
        throw new Error("Failed to decrypt AES key.");
    }
}

// Step 4: Decrypt client request
function decryptRequest(encryptedDataBase64, aesKeyBuffer, ivBase64) {
    try {
        const iv = Buffer.from(ivBase64, "base64");
        // const key = Buffer.from(aesKeyBuffer.toString(), "base64");
        // const key = aesKeyBuffer;
        // The aesKeyBuffer from decryptAESKey is the raw key buffer. Use it directly.
        const key = aesKeyBuffer;

        console.log('keykey', aesKeyBuffer)
        console.log('ivBase64', ivBase64)
        console.log('AES Key Buffer Length (Decrypt):', aesKeyBuffer?.length); // Optional: Debugging

        // Validate key length before using
        if (!key || key.length !== 32) {
            throw new Error(`Invalid AES key length received: ${key?.length || 0} bytes. Expected 32.`);
        }

        const decipher = createDecipheriv("aes-256-cbc", key, iv);

        const encryptedBuffer = Buffer.from(encryptedDataBase64, "base64");
        let decrypted = decipher.update(encryptedBuffer);
        decrypted = Buffer.concat([decrypted, decipher.final()]);

        return decrypted.toString("utf8");
    } catch (error) {
        console.error("Request decryption error:", error);
        throw new Error(`Failed to decrypt request data: ${error.message}`);
    }
}

// Step 5: Encrypt response
function encryptResponse(plainText, aesKeyBuffer) {
    // console.log('plainText', plainText)
    const key = aesKeyBuffer;
    const iv = randomBytes(16);
    // const key = Buffer.from(aesKeyBuffer.toString(), "base64");
    // const key = aesKeyBuffer; // <--- CHANGE HERE

    // Validate key length before using
    if (!key || key.length !== 32) {
        throw new Error(`Invalid AES key length for encryption: ${key?.length || 0} bytes. Expected 32.`);
    }

    const cipher = createCipheriv("aes-256-cbc", key, iv);

    // Ensure plainText is a string (e.g., JSON stringified)
    const plainTextString = typeof plainText === 'string' ? plainText : JSON.stringify(plainText);

    // console.log('plainTextString', plainTextString)

    let encrypted = cipher.update(plainTextString, "utf8");
    encrypted = Buffer.concat([encrypted, cipher.final()]);

    return {
        data: encrypted.toString("base64"),
        iv: iv.toString("base64"),
    };
}

module.exports = { decryptAESKey, encryptResponse, decryptRequest };  