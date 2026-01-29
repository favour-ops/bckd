const db = require('../models')
const passport = require("passport");
const passportJwt = require('passport-jwt');
const ExtractJwt = passportJwt.ExtractJwt;
const JwtStrategy = passportJwt.Strategy;
const Admin = db.admin; 
const Permission  = db.Permission;
const Role = db.Role; 

/* admin middleware */
const adminMiddleware = async (req, res, next) => {
  passport.authenticate("admauth", { session: false }, async (err, user, info) => {
    
    if (err || !user) {
      return res.status(401).json({ message: "Unauthorized" });
    }

    // Extract the access token manually
    const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);

    // Check if the extracted token matches the one stored in the database
    const dbAdmin = await Admin.findOne({ where: { id: user.id } });

    if (!dbAdmin || dbAdmin.accesstoken !== token) {
      return res.status(401).json({status: false, message: "Session expired. Login again." });
    }

    req.user = user; 
    next();
  })(req, res, next);
};

const checkPermission = (requiredPermissionName) => {
  return async (req, res, next) => {
    if (!req.user || !req.user.id) {
      return res.status(401).json({ message: 'User not authenticated.' });
    }

    try {
      const user = await Admin.findByPk(req.user.id, {
        include: {
          model: Role,
          as: 'role',
          include: { model: Permission, as: 'permissions' },
        },
      });

      if (user.role.name === 'superadmin') { 
        return next(); // Superadmin bypasses specific permission check
      }

      if (!user || !user.role || !user.role.permissions) {
        return res.status(403).json({ message: 'Forbidden: Role or permissions not found.' });
      }

      const hasPermission = user.role.permissions.some(p => p.name === requiredPermissionName);

      if (hasPermission) {
        return next();
      }

      return res.status(403).json({ message: 'Forbidden: You do not have the required permission.' });
    } catch (error) {
      console.error('Permission check error:', error);
      return res.status(500).json({ message: 'Error checking permissions.' });
    }
  };
};

module.exports = {adminMiddleware, checkPermission };
// module.exports = adminMiddleware ;
