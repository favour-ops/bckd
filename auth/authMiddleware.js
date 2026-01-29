const db = require('../models')
const passport = require("passport");
const passportJwt = require('passport-jwt');
const ExtractJwt = passportJwt.ExtractJwt;
const JwtStrategy = passportJwt.Strategy;
const User = db.customers; 
const { client: redisClient } = require('../config/redisClient'); // Import Redis client
const jwt = require('jsonwebtoken'); // Import jwt 

const authMiddleware = async (req, res, next) => {
  passport.authenticate("jwt", { session: false }, async (err, user, info) => {
    try {
      if (err) {
        return next(err);
      }

      if (!user) {
        // Distinguish between token format errors and actual invalid/expired tokens
        let message = "Unauthorized";
        if (info instanceof Error) {
            if (info.name === 'TokenExpiredError') {
                message = "Session expired. Please log in again.";
            } else if (info.name === 'JsonWebTokenError') {
                message = "Invalid token format.";
            } else {
                message = info.message || message;
            }
        } else if (typeof info === 'object' && info !== null && info.message) {
            message = info.message; // Use message from passport strategy if available
        }
        return res.status(401).json({ status: false, message: message });
      }

      // --- Check Database and Blacklist ---
      const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
      if (!token) {
          return res.status(401).json({ status: false, message: "Authorization token missing." });
      }

      // 1. Check if token is still valid in the database user record (optional but good)
      const dbUser = await User.findOne({ where: { id: user.id } });
      if (!dbUser || dbUser.accesstoken !== token) {
          // This check helps if you manually clear the token on password change etc.
          // It also catches cases where a user logs in elsewhere, getting a new token.
          return res.status(401).json({ status: false, message: "Session invalidated. Please log in again." });
      }

       // 2. Check Redis Blacklist
       const decoded = jwt.decode(token);
       let tokenKey;
        if (decoded && decoded.jti) {
            tokenKey = `bl_${decoded.jti}`; // Use JTI if available
        } else {
            tokenKey = `bl_${token}`; // Fallback to using the token itself
        }

       const blacklisted = await redisClient.get(tokenKey);
      
       if (blacklisted) {
           console.log(`Access denied. Token (or JTI) found in blacklist: ${tokenKey}`);
           return res.status(401).json({ status: false, message: "Session terminated (logged out)." });
       }

        // --- Attach user and proceed ---
        req.user = user;
        next();
      
    } catch (error) {
      console.error("Auth Middleware Error:", error);
      return res.status(500).json({ status: false, message: "Internal server error during authentication." });
    }
  })(req, res, next);
};


module.exports = authMiddleware;
