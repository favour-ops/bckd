const crypto = require("crypto");
const fs = require("fs");
const { remoteConfig } = require("./firebase-config");

// Function to generate new RSA key pair
function generateRSAKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048, // 2048-bit encryption
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });

  // Save private key securely on the backend
  fs.writeFileSync("private.pem", privateKey);

  return publicKey; // Return the new public key
}

// Function to update Firebase Remote Config
async function updateFirebasePublicKey() {
  try {
    const newPublicKey = generateRSAKeys();
    // console.log("Generated new RSA public key.");

    // Fetch current Firebase Remote Config template
    const template = await remoteConfig.getTemplate();

    // Update RSA Public Key
    template.parameters["rsa_public_key"] = {
      defaultValue: { value: newPublicKey },
      description: "RSA Public Key for encrypting API requests",
    };

    // Publish the updated config
    await remoteConfig.publishTemplate(template);
    // console.log("✅ Firebase Remote Config updated successfully!");

  } catch (error) {
    console.error("❌ Failed to update Firebase Remote Config:", error);
  }
}


module.exports = {updateFirebasePublicKey, generateRSAKeys};