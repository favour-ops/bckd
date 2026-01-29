const config = require("../config/pubapi_config.js");

export const authenticateAPIKey = (req, res, next) => {
  const key = req.headers["authorization"]?.replace("Bearer ", "");

  if (!key || key !== config.apiKey) {
    return res.status(401).json({
      status: "error",
      code: "AUTH_FAILED",
      message: "Invalid or missing API key",
    });
  }

  next();
};
