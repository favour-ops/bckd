const db = require('../models')
const passport = require("passport");
const passportJwt = require('passport-jwt');
const ExtractJwt = passportJwt.ExtractJwt;
const JwtStrategy = passportJwt.Strategy;
const User = db.customers; 
const Admin = db.admin; 

const options = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: process.env.JWT_SECRET
};

passport.use( "jwt", new JwtStrategy(options, async (jwtPayload, done) => {
  try {
    const user = await User.findOne({ where: { id: jwtPayload.id, email: jwtPayload.email } });

    if (!user) {
      return done(null, false, { message: "User not found" });
    }

    return done(null, user);
  } catch (err) {
    return done(err, false);
  }
}));


passport.use('admauth', new JwtStrategy(options, async (jwtPayload, done) => {
  try {
    if(jwtPayload.admid > 0){
    const admin = await Admin.findOne({ where: { id: jwtPayload.admid, email: jwtPayload.email } });

    if (!admin) {
      return done(null, false, { message: "User not found" });
    }

    return done(null, admin);
  }else{
    return done(null, 'Unathourized Access');
  }
  } catch (err) {
    return done(err, false);
  }
}));

module.exports = passport;