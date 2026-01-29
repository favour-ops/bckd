const jwt = require("jsonwebtoken");
const config = require("../config/pubapi_config.js");
const db = require('../models');
const BizKeys = db.bizkeys;

exports.verifyAccessToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) 
    return res.status(401).json({ 
        status:'error', 
        code:'UNAUTHORIZED', 
        message:'Missing authorization header' 
    });

  const token = authHeader.split(' ')[1];
  if (!token) 
    return res.status(401).json({ 
      status:'error', 
      code:'UNAUTHORIZED', 
      message:'Token missing'
     });


  jwt.verify(token, config.jwtSecret, async (err, decoded) => {
    if (err) return res.status(401).json({ status:'error', code:'INVALID_TOKEN', message:'Invalid or expired token' });

    // Optionally check that merchant still exists & is active
    // console.log('decoded.merchantId:', decoded)
    const merchant = await BizKeys.findByPk(decoded.merchantId);
    
    if (!merchant || merchant.status != '1') 
      return res.status(401).json({ status:'error', code:'INVALID_TOKEN', message:'Merchant not active' });

    req.merchantId = decoded.merchantId;
    req.merchant = merchant;
    next();
  });
};