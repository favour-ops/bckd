const admin = require('firebase-admin');  
const fs = require("fs");

// Load Firebase credentials
// const serviceAccount = require("./servAcctKey.json");

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  });

// Export Firebase Remote Config
const remoteConfig = admin.remoteConfig();

module.exports = { remoteConfig };