const crypto = require("crypto");
const { client } = require('../config/redisClient'); // Use the shared Redis client

// Middleware factory function
const blockDuplicateRequest = (options) => {
  return async (req, res, next) => {
    try {
      // Extract the fields to check from the request body
      const requestData = {};
      for (const field of options.fields) {
        if (req.body[field] !== undefined) {
          requestData[field] = req.body[field];
        } else {
          return res.status(400).json({ error: `Missing required field: ${field}` });
        }
      }

      // Generate a hash of the specified fields
      const requestHash = crypto
        .createHash("sha256")
        .update(JSON.stringify(requestData))
        .digest("hex");

      // Use SET with NX and EX to avoid race conditions
      const exists = await client.set(requestHash, "exists", { EX: options.ttl || 5, NX: true });
      if (!exists) {
        return res.status(429).json({ error: "Duplicate request detected." });
      }

      next();
    } catch (err) {
      console.error("Error in preventDuplicateRequest:", err);
      next(); // Allow the request to proceed if something goes wrong
    }
  };
};

// Example usage for different endpoints
// app.post(
//   "/endpoint1",
//   preventDuplicateRequest({ fields: ["userId", "resourceId"], ttl: 10 }), // Check userId and resourceId, TTL of 10 seconds
//   (req, res) => {
//     res.json({ message: "Request processed successfully for endpoint1!" });
//   }
// );

// app.post(
//   "/endpoint2",
//   preventDuplicateRequest({ fields: ["email", "productId"], ttl: 5 }), // Check email and productId, TTL of 5 seconds
//   (req, res) => {
//     res.json({ message: "Request processed successfully for endpoint2!" });
//   }
// );
module.exports = blockDuplicateRequest;
