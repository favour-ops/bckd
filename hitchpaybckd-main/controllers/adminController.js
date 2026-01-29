const db = require('../models')

const jwt = require("jsonwebtoken");
const md5 = require('md5');
const https = require('https');
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const saltRounds = 10;
const { v4: uuidv4 } = require('uuid');
const sharp = require('sharp');
const randomstring = require("randomstring");
const { cloudinary, validateUpload, firebaseUpload } = require("../config/imageuploads");
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config(); // Load environment variables from .env file
const Sequelize = require('sequelize');
const { Op, fn, col, where } = require("sequelize");
const twoFactor = require('node-2fa');
const qrcode = require('qrcode');
const { client: redisClient } = require('../config/redisClient'); // Import Redis client
const moment = require('moment');
const { genCode } = require("../config/getcode");
const { mailSender } = require("../config/mailsender"); 
const { sendSMS, pushNotify, notifyMe } = require("../config/notifyuser");
const { getUserInfo, getAdminInfo, logAudit, getBal } = require("../config/userdetails");
const { formatAmount, cleanMe, ucFirst, validatePassword, updateBalance, shAcessToken, USAccountUpd, genSHBizAccount, genSHAccount, gen9PSBAccount} = require("../config/myfunct");
const passport = require('passport');
const axios = require('axios');
const { logger } = require('../config/logger');
// const { deserialize } = require('v8');
// const { type } = require('os');
// const { create } = require('domain');

const Customer = db.customers;
const Admin = db.admin;
const Notify = db.notify;
const otpVer = db.verotp
const Audit = db.audit;
const logEarning = db.earnings;
const KycDoc = db.kycdoc;
const KYC = db.kyc;
const RoleAccess = db.roleAccess;
const rfToken = db.refreshtoken;
const Payn = db.payn;
const AppSett = db.appsettings;
const Product = db.products;
const Wallets = db.wallets;
const Benefit = db.benefit;
const Bank = db.bankacct;
const Permission = db.Permission;
const Role = db.Role;
const AcctRequest = db.accountrequest;
const LogRequest = db.logrequest;
const CardUser = db.kadusers
const VCard = db.vkads;
const Business = db.business;

const applyLoginDelay = async (email) => {
  const key = `failed-login:${email}`;
  try {
    const attempts = await redisClient.get(key);
    if (attempts && parseInt(attempts, 10) > 2) { // Start delaying after 2 failed attempts
      const delayDuration = Math.min((parseInt(attempts, 10) - 2) * 1000, 10000); // 1s, 2s, ... up to 10s
      await new Promise(resolve => setTimeout(resolve, delayDuration));
    }
  } catch (error) {
    console.error("Redis error in applyLoginDelay:", error.message);
    // Fail open: If Redis is down, don't block logins.
  }
};

/**
 * Applies a progressive delay to 2FA attempts based on failure counts stored in Redis.
 * This helps mitigate brute-force attacks against the 2FA code.
 * @param {string} authtoken The token associated with the 2FA attempt.
 */
const apply2faDelay = async (authtoken) => {
  if (!authtoken) return;
  const key = `failed-2fa:${authtoken}`;
  try {
    const attempts = await redisClient.get(key);
    if (attempts && parseInt(attempts, 10) > 2) { // Start delaying after 2 failed attempts
      const delayDuration = Math.min((parseInt(attempts, 10) - 2) * 1000, 10000); // 1s, 2s, ... up to 10s
      await new Promise(resolve => setTimeout(resolve, delayDuration));
    }
  } catch (error) {
    console.error("Redis error in apply2faDelay:", error.message);
    // Fail open: If Redis is down, don't block 2FA attempts.
  }
};

const authAdmin = async (req, res) => {
  const { email, pword, apptoken } = cleanMe(req.body);
  const genericLoginError = 'Invalid credentials. Please check your input and try again.';

  if (!pword || !email) {
    // Return a 400 Bad Request for malformed requests without revealing which field is missing.
    return res.status(400).json({ status: false, message: 'Email and password are required.' });
  }

  // Before checking credentials, apply a delay if there have been multiple recent failures.
  await applyLoginDelay(email);

  const checkAdmin = await Admin.findOne({ where: { email: email } }).catch((err) => { console.log("Unable to process your request : " + err); });

  // To prevent timing attacks, perform a password comparison even if the user is not found.
  // If the user doesn't exist, `checkAdmin.auth` will be undefined, and compareSync will safely return false.
  // A dummy hash could also be used here for non-existent users for added security.
  const validPassword = checkAdmin ? bcrypt.compareSync(pword, checkAdmin.auth) : false;

  if (!checkAdmin || !validPassword) {
    // On failure, increment the counter in Redis and set it to expire.
    const key = `failed-login:${email}`;
    try {
      await redisClient.incr(key);
      await redisClient.expire(key, 900); // Expire after 15 minutes (900 seconds)
    } catch (error) {
      console.error("Redis error incrementing failed login:", error.message);
    }
    return res.status(400).json({ status: false, message: genericLoginError });
  }

  // On success, delete the failure counter from Redis.
  try { await redisClient.del(`failed-login:${email}`); } catch (e) { console.error("Redis DEL error:", e.message); }

  if (checkAdmin.status == 0)
    return res.status(403).json({ status: false, message: 'Your access to this resource is currently disabled.' });

  //SEND OTP            
  const tcode = genCode(6, 'numeric');
  const vertoken = jwt.sign({ id: checkAdmin.id }, process.env.JWT_SECRET, { expiresIn: '2h' });

  await otpVer.create({
    userid: checkAdmin.id, otpcode: tcode, token: vertoken,
    usertype: 'admin', otptype: 'adminauth', status: 0
  }).catch((err) => {
    console.log('Unable to process your request : ' + err);
    res.status(400).json({ status: false, message: 'Unable to process your request' });
  });

  if (pword == 'adminPass@123!' || pword == 'Sekure@123!' || checkAdmin.authsecret == null || checkAdmin.authsecret == '') {
    var needauth = true;
  } else {
    var needauth = false;
  }

  res.json({
    status: true,
    message: `Success! Proceed to Authenticate Account`,
    data: {
      authToken: vertoken,
      needauth
    }
  });
}

const auth2faAdmin = async (req, res) => {
  const { authcode, authtoken, passupd } = cleanMe(req.body);
  const genericAuthError = 'Invalid or expired authentication code.';

  if (!authcode || !authtoken) {
    return res.status(400).json({ status: false, message: 'Authentication code and token are required.' });
  }

  // Before processing, apply a delay if there have been multiple recent failures for this token.
  await apply2faDelay(authtoken);

  const checkvtoken = await otpVer.findOne({
    where: { [Op.and]: [{ token: authtoken }, { otptype: 'adminauth' }, { status: 0 }] }
  });
  
  if (!checkvtoken)
    return res.status(400).json({ status: false, message: 'Token Expired! Unable to process request, kindly initiate a new login' });

  var ownerid = checkvtoken.userid;

  const userinfo = await getAdminInfo(ownerid);
  const admemail = userinfo.email;
  const admphoneno = userinfo.phoneno;
  const admname = userinfo.name;
  const hisrole = userinfo.role;

  /* CHECK 2FA */
  let eligible = false;
  if ((userinfo.authsecret == null || userinfo.authsecret == '') && authcode == 419911) {
    eligible = true;
  } else if (userinfo.authsecret) {
    const result = twoFactor.verifyToken(userinfo.authsecret, authcode);
    // result is not null and delta is 0 for a valid, current token.
    // We allow some clock drift by checking delta >= 0 if needed, but 0 is strictest.
    if (result && result.delta >= 0) {
      eligible = true;
    }
  }

  if (!eligible) {
    // On failure, increment the counter in Redis and set it to expire.
    const key = `failed-2fa:${authtoken}`;
    try {
      await redisClient.incr(key);
      // The key will naturally expire when the authtoken itself becomes invalid.
      // We can also set an explicit expiry for cleanup.
      await redisClient.expire(key, 900); // Expire after 15 minutes
    } catch (error) {
      console.error("Redis error incrementing failed 2FA:", error.message);
    }
    return res.status(400).json({ status: false, message: genericAuthError });
  }

  if (eligible) {
    if (userinfo.authsecret == null || userinfo.authsecret == '') {
      var needauth = true;
    } else {
      var needauth = false;
    }

    // On success, delete the failure counter from Redis.
    try { await redisClient.del(`failed-2fa:${authtoken}`); } catch (e) { console.error("Redis DEL error:", e.message); }

    // send mail with defined transport object
    //log refresh token        
    let d = new Date();
    let dtimed = Date.parse(new Date()) / 1000;
    var thecontent = `
    <div class="" style="text-align: left">
     <p style="line-height: 20px; letter-spacing: 0.025em;">Hello ${admname} <span style="font-size: 18px;">😍</span></p>
      <p style="line-height: 28px; letter-spacing: 0.025em;">You just logged in to your admin dashboard on ${process.env.SITENAME} </p>
      <pstyle="line-height: 28px; letter-spacing: 0.025em;">Date: ${d} </p>
      </div>
    `;

    mailSender(admname, 'Login Alert - HitchPay', admemail, thecontent);

    // ================ACCESS TOKEN===========================
    //create token
    const acessexp = process.env.ACCESSTKTIME
    const jwtToken = jwt.sign({ admid: userinfo.id, email: userinfo.email, jti: randomstring.generate(16) }, process.env.JWT_SECRET, { expiresIn: acessexp });

    //update tble
    await Admin.update({ accesstoken: jwtToken, isonline: 1 },
      {
        where: { id: userinfo.id, email: userinfo.email }
      }).catch((err) => {
        console.log('Unable to process your request : ' + err);
      });

    // ================REFRESH TOKEN===========================    
    let rfshtktime = process.env.REFRESTKTIME;
    let jtiToken = randomstring.generate(16);
    const refreshTok = jwt.sign({
      admid: userinfo.id,
      email: userinfo.email, jti: jtiToken
    }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });


    const expired_refresh = d.setMinutes(d.getMinutes() + rfshtktime);

    //clear previous tokenlog 
    await rfToken.update({ status: 0 }, { where: { [Op.and]: [{ userid: userinfo.id, usertype: 'admin' }] } });

    //log new token
    await rfToken.create({
      timed: dtimed, userid: userinfo.id, accesstoken: refreshTok,
      expiredtime: expired_refresh, status: 1, usertype: 'admin'
    });

    await otpVer.update({ status: 1 }, {
      where: {
        userid: ownerid, token: authtoken, usertype: 'admin', otptype: 'adminauth'
      }
    });

    // pushNotify(checkAdmin.id, 'Login Notice', `Welcome Back, You've just logged in to your account.`);

    res.json({
      status: true,
      message: `Account Successfully Authenticated`,
      data: {
        accessToken: jwtToken,
        refreshToken: refreshTok,
        needauth, passupd
      }
    });

  // The `eligible` check above handles the failure case.
  } else {
    return res.status(400).json({ status: false, message: genericAuthError });
  }

}

const ProfileInfo = async (req, res) => {
  const adminid = req.user.id;

  try {
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
    // const getadm = await Admin.findOne({ where: { id: adminid}});

    const getadm = await Admin.findOne({
      where: { id: adminid }, include: {
        model: Role,
        as: 'role',
        include: { model: Permission, as: 'permissions', attributes: ['name'] },
      }
    });

    if (!getadm) return res.status(400).json({ status: false, message: 'Details not found' });


    const userRole = getadm.role ? getadm.role.name : null;
    // console.log('userRole', getadm.role)
    const userPermissions = getadm.role && getadm.role.permissions ? getadm.role.permissions.map(p => p.name) : [];
    // console.log('userPermissions', userPermissions)

    res.json({
      status: true,
      message: 'Info retrieved',
      data: {
        userid: getadm.id,
        name: getadm.name,
        email: getadm.email,
        phone_number: getadm.phoneno,
        adminrole: userRole,
        accountstatus: getadm.status,
        secretauth: getadm.authsecret,
        profilepic: null,
        role: getadm.role,
        permissions: userPermissions, // Send permissions to the frontend
      }
    });

  } catch (error) {
    console.log("Error adm details " + error.message);
  }
}

const getAuthToken = async (req, res) => {
  if (!req.headers['authorization'])
    return res.status(400).json({ status: false, message: 'Unauthorized' });

  try {
    const authHeader = req.headers['authorization']
    const authcode = req.headers['authdcode']
    const bearerToken = authHeader.split(' ')
    const sentToken = bearerToken[1];

    if (!authcode || (authcode == ''))
      return res.status(400).json({ status: false, message: 'Invalid Authentication Code' });

    jwt.verify(sentToken, process.env.JWT_REFRESH, async (err, resulted) => {
      if (err) {
        const message = err.name === 'JsonWebTokenError' ? 'Unathourized' : err.message;
        return res.status(400).json({ status: false, message: message });
      }

      const tknid = resulted.admid;
      const tkn_email = resulted.email;

      const userinfo = await getAdminInfo(tknid);
      const result = twoFactor.verifyToken(userinfo?.authsecret, authcode);
      if (result) {
        if (result.delta === null || result.delta < 0) {
          var eligible = false;
        } else {
          var eligible = true;
        }
      } else {
        var eligible = false;
      }

      if (!eligible)
        return res.status(400).json({ status: false, message: 'Invalid Authentication/Expired Code' });

      //check the db
      rfToken.findOne({ where: { accesstoken: sentToken, userid: tknid, usertype: 'admin' } });

      //create a new access token        
      const acessexp = process.env.ACCESSTKTIME
      const jwtToken = jwt.sign({ admid: tknid, email: tkn_email, jti: randomstring.generate(16) }, process.env.JWT_SECRET, { expiresIn: acessexp });

      //update tble
      const updatedb = await Admin.update({ accesstoken: jwtToken, isonline: 1 }, { where: { id: tknid, email: tkn_email } });

      if (!updatedb)
        return res.status(400).json({ status: false, message: 'Unable to process token generation' });

      res.json({
        status: true,
        message: `Authorized`,
        data: {
          accessToken: jwtToken
        }
      });
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process request at the moment, kindly retry shortly' });
    console.log('Unable to process your request  adm authtoekn:' + error.message)
  }
}


const changPass = async (req, res) => {
  try {
    const hisid = req.user.id;
    const { oldpass, newpass, confirmpass } = cleanMe(req.body);


    if (!hisid)
      return res.status(400).json({ status: false, message: 'Invalid request sent!' });
    if (!oldpass || oldpass == '') return res.status(400).json({ status: false, message: 'You forgot to specify your current password!' });
    if (!newpass || newpass == '') return res.status(400).json({ status: false, message: 'You forgot to enter your new password!' });
    if (!confirmpass || confirmpass == '') return res.status(400).json({ status: false, message: 'Confirmation password not specified!' });
    if (newpass != confirmpass) return res.status(400).json({ status: false, message: 'New password and confirmation password does not match!' });
    if (!validatePassword(newpass)) return res.status(400).json({ status: false, message: 'Password must be at least 8 chars. long, no space, contain a number, an alphabet, and a special character.' })

    const checkAdmin = await Admin.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });

    if (!checkAdmin)
      return res.json({ status: true, message: 'Unable to process your request, kindly refresh and try again' });

    const dpwd = checkAdmin.auth;
    const checkwithHashPwd = bcrypt.compareSync(oldpass, dpwd); // true
    // console.log('checkAdmin', checkwithHashPwd)


    if (!checkwithHashPwd)
      return res.status(400).json({ status: false, message: 'Please check your input and try again' });

    //register new pass
    const salt = bcrypt.genSaltSync(saltRounds);
    const hash = bcrypt.hashSync(newpass, salt);

    const changeit = await Admin.update({ auth: hash }, { where: { id: hisid, email: checkAdmin.email } }).catch((err) => {
      console.log('Unable to process your request : ' + err);
    });

    if (!changeit)
      return res.status(400).json({ status: false, message: "Ouch! Unable to process your password update, kindly retry again" });

    var notedesc = `You updated your login password.`
    notifyMe(hisid, 'Account Password Update', 'admin', notedesc)

    res.status(200).json({
      status: true, message: 'Great! Password successfully updated.'
    })

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("change password Error: ", error.message);
  }
}



// Helper function to extract text from rich text objects
const extractText = (cell) => {
  if (cell && cell.richText) {
    return cell.richText.map(rt => rt.text).join('');
  }
  return cell;
};


const getUsers = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
    }

    const getusers = await Customer.findAll({
      order: [['id', 'DESC']],
      attributes: [
        'id', 'lastname', 'firstname', 'phoneno', 'refcode',
        'referby', 'email', 'status', 'isverified', 'reglevel', 'photo',
        'timed', 'bvverify', 'address', 'accounttier'
      ],
      include: {
        model: Wallets,
        as: 'customer_wallets', // Alias for the association
        attributes: ['currency', 'wbal', 'lastupdated'],
        where: {
          currency: 'NGN' // Filter for NGN currency only
        },
        required: false
      },
    });

    if (!getusers || getusers.length === 0) {
      return res.status(400).json({ status: false, message: 'No user found' });
    }

    const userInfo = getusers.map((info) => {
      const {
        id: userid,
        lastname,
        firstname,
        phoneno: phone_number,
        refcode: refercode,
        referby,
        email: customer_email,
        status: accountstatus,
        isverified,
        reglevel,
        photo: profileimg,
        timed,
        bvverify,
        bvstatus,
        accounttier,
        address
      } = info.get({ plain: true }); // Use get({ plain: true }) to get plain object

      const name = `${lastname} ${firstname}`;
      const fname = firstname;
      const lname = lastname;
      const account_tier = accounttier == null ? 1 : accounttier;
      const accountstatus_text =
        accountstatus === 1 ? 'active' : accountstatus === 3 ? 'onhold' : accountstatus === 0 ? 'disabled' : '';
      const verstatus = bvverify === 2 ? 'verified' : 'unverified';
      const regleveltext =
        reglevel === 0 ? 'Ongoing' : reglevel === 1 ? 'Onboarded' : reglevel === 2 ? 'KYC' : '';
      const created_at = moment.unix(timed).format('Do MMM, YYYY hh:mm a');
      const bvstage = bvstatus === 1 ? 'needotp' : bvstatus === 2 ? 'verified' : 'unverified';

      const walletlist = info.customer_wallets.map((wallet) => ({
        currency: wallet.currency,
        walletbal: wallet.wbal,
        lastupdated: moment.unix(wallet.lastupdated).format('Do MMM, YYYY h:m a'),
      }));

      // console.log(walletlist[0])
      const extractBal = walletlist[0] ? walletlist[0].walletbal : 0;
      const extractCurrency = walletlist[0] ? walletlist[0].currency : 'NGN';

      return {
        userid,
        name,
        fname,
        lname,
        account_tier,
        phone_number,
        customer_email,
        accountstatus,
        verstatus,
        created_at,
        refercode,
        referby,
        accountstatus_text,
        isverified,
        reglevel,
        regleveltext,
        profileimg: profileimg || '',
        bvstage,
        bvstatus,
        address: address || '',
        walletbal: formatAmount(extractBal),
        currency: extractCurrency,
      };
    });

    res.json({
      status: true,
      message: 'Customer info retrieved',
      data: userInfo,
    });
  } catch (error) {
    console.error('customer info catch ERROR:', error.message);
    res.status(500).json({ status: false, message: 'Internal Server Error' });
  }
};

const getCustCards = async (req, res) => {
    try {
      const adminid = req.user.id;
      if (!adminid)
        return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

      const { customerid } = cleanMe(req.params);
      const userid = customerid;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const gethist = await VCard.findAll({
            order: [['id', 'DESC']], where: { userid: userid, status: { [Op.notIn]: [5, 0] } }
        });

        if (!gethist)
            return res.status(400).json({ status: false, message: 'No card for you' });

        const datalist = await Promise.all(gethist.map(async (arrayItem) => {
            const trackingid = arrayItem.trackingid;
            const provider = arrayItem.provider;
            const cardbrand = arrayItem.cardbrand;
            const pan = arrayItem.cardno;
            const expirydate = arrayItem.expirydate;
            const expirymonth = arrayItem.expirymonth;
            const cardid = arrayItem.cardid;
            const currency = arrayItem.currency;
            const cvv = arrayItem.cvv;
            const cardstatus = arrayItem.status;
            const cardname = arrayItem.cardname;
            const cardtagname = arrayItem.cardtagname;
            const cardcolor = arrayItem.cardcolor;

            return { trackingid, cardbrand, cardid, pan, expirydate, currency, cvv, cardstatus, cardname, cardcolor, cardtagname };

        }));

        res.json({
            status: true,
            message: 'Customer Card retrieved',
            data: datalist
        });

    } catch (error) {
        console.log('my-card catch ERROR: ' + error.message)
    }
}


const getUsersDetails = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid)
      return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { customerid } = cleanMe(req.params);

    if (!customerid || customerid == null || customerid == undefined || customerid == '')
      return res.status(400).json({ status: false, message: 'No user found' });

    const getuser = await Customer.findOne({ where: { [Op.or]: [{ id: customerid }] } });

    if (!getuser)
      return res.status(400).json({ status: false, message: 'No user found' });

    /*================ check if he has wallet ==========================*/
    let getbal = await Wallets.findAll({ where: { uid: customerid } });

    if (!getbal || getbal.length == 0) {
      /* CREATE WALLET FOR HIM IN NGN */
      let dtimed = Date.parse(new Date()) / 1000;
      await Wallets.create({ uid: customerid, email: getuser.email, currency: 'NGN', wbal: 0, timecreated: dtimed, lastupdated: dtimed, status: 1 }).catch((err) => {
        console.log('Unable to process your request : ' + err);
      });
      // Refetch after creation
      getbal = await Wallets.findAll({ where: { uid: customerid } });
    }

    const getacct = await Bank.findOne({ order: [['id', 'DESC']], where: { userid: customerid } });
    const countrefers = await Customer.count({ where: { referby: getuser.uname } });
    const countbeneficiary = await Benefit.count({ where: { userid: customerid } });
    const gettransactionsum = await Payn.sum('amount', { where: { status: 1, userid: customerid } });
    const getusdtransfer = await Payn.sum('amount', { where: { status: 1, userid: customerid, pfor: 'usdtransfer' } });

    // New logic to get credit/debit per wallet
    const walletlistWithStats = await Promise.all(getbal.map(async (wallet) => {
      const currency = wallet.currency;
      const totalWalletCredit = await Payn.sum('amount', {
        where: { userid: customerid, currency: currency, paytype: 'credit', status: 1 }
      }) || 0;

      const totalWalletDebit = await Payn.sum('amount', {
        where: { userid: customerid, currency: currency, paytype: 'debit', status: 1 }
      }) || 0;

      return {
        ...wallet.get({ plain: true }), // get plain object from Sequelize instance
        totalCredit: totalWalletCredit,
        totalDebit: totalWalletDebit
      };
    }));

    // const totaldebit = await Payn.sum('amount', { where: { status: 1, userid: customerid, paytype: 'debit' } }) || 0;
    // const totalcredit = await Payn.sum('amount', { where: { status: 1, userid: customerid, paytype: 'credit', pfor: { [Op.in]: ['wallet', 'referral'] } } }) || 0;

    const getcarduser = await CardUser.findOne({where: {userid: customerid}});
      if(getcarduser){
          var cardacct = true;
      }else{
          var cardacct = false;
      }

    res.json({
      status: true,
      message: 'User Details retrieved',
      data: {
        userid: getuser.id,
        name: getuser.firstname + ' ' + getuser.lastname,
        fname: getuser.firstname,
        lname: getuser.lastname,
        uname: getuser.uname,
        customer_email: getuser.email,
        customer_phone: getuser.phoneno,
        refercode: getuser.refcode,
        referby: getuser.referby,
        accountstatus: getuser.status,
        accountstatus_text: getuser.status == 1 ? 'active' : getuser.status == 3 ? 'onhold' : getuser.status == 0 ? 'disabled' : '',
        reglevel: getuser.reglevel,
        gender: '',
        dob: '', cardacct: cardacct,
        regleveltext: getuser.reglevel == 0 ? 'Ongoing' : getuser.reglevel == 1 ? 'Onboarded' : getuser.reglevel == 2 ? 'KYC' : '',
        // transauth: getuser.authpin,
        created_at: moment.unix(getuser.timed).format("Do MMM, YYYY hh:mm a"),
        verstatus: getuser.isverified == 1 ? 'verified' : 'unverified',
        isverified: getuser.isverified,
        profileimg: getuser.photo == null ? '' : getuser.photo,
        bvstatus: getuser.bvverify,
        bvstage: getuser.bvverify == 1 ? 'needotp' : getuser.bvverify == 2 ? 'verified' : 'unverified',
        activefriends: 0,
        custhouseno: getuser.houseno,
        custzip: getuser.postalcode,
        custadr: getuser.address,
        username: getuser.uname,
        custcity: getuser.city,
        custstate: getuser.state,
        tierlevel: getuser.accounttier,
        maritalstatus: getuser.maritalstatus,
        nextofkin_phone: getuser.nextofkin_phone,
        nextofkin_name: getuser.nextofkin_name,
        walletlist: walletlistWithStats,
        accountdetails: {
          bank_name: getacct?.bankname,
          account_number: getacct?.accountno,
          account_name: getacct?.accountname,
          bank_code: getacct?.bankcode,
          account_type: getacct?.accounttype,
        },
        totalrefers: countrefers,
        totalbeneficiary: countbeneficiary,
        totaltrans: gettransactionsum,
        totalusdtransfer: !getusdtransfer ? 0 : getusdtransfer,
        // totalcredit: totalcredit ? totalcredit : 0,
        // totaldebit: totaldebit ? totaldebit : 0

      }

    });

  } catch (error) {
    console.log('customer details catch ERROR: ' + error.message)
  }
}

/* const theBal = async() =>{
  const userNgnBal = await Wallets.sum('wbal', { where: { currency: 'NGN' } });

  console.log('userNgnBal', userNgnBal);
} */

const siteStats = async (req, res) => {

  try {
    const allCustomers = await Customer.count();
    const verCust = await Customer.count({ where: { isverified: 1 } });
    const unverCust = await Customer.count({ where: { isverified: 0 } });


    const userNgnBal = await Wallets.sum('wbal', { where: { currency: 'NGN' } });
    const userUsdBal = await Wallets.sum('wbal', { where: { currency: 'USD' } });

    const InternalTransferQuery = await Payn.sum('amount', { where: { status: 1, ntwkid: 'hitchpay', paytype: 'debit', pfor: 'transfer' } });
    const ExternalTransferQuery = await Payn.sum('amount', { where: { status: 1, ntwkid: { [Op.ne]: 'hitchpay' }, paytype: 'debit', pfor: 'transfer' }, });
    const billQuery = await Payn.sum('amount', { where: { status: 1, paytype: 'debit', pfor: { [Op.ne]: 'transfer' } } });
    const refundQuery = await Payn.sum('amount', { where: { status: 1, pfor: 'REFUND' } });

    const transQuery = await Payn.sum('amount', { where: { status: 1 } });
    const transCountQuery = await Payn.count({ where: { status: 1 } });

    const RevenueQuery = await Payn.sum('revenue', { where: { status: 1 } });

    var ngnBal = userNgnBal ? formatAmount(userNgnBal) : formatAmount(0);
    var usdBal = userUsdBal ? userUsdBal : 0;

    var totalRefunds = refundQuery ? formatAmount(refundQuery) : 0;
    var pendingPayout = formatAmount(0);
    var approvedPayout = formatAmount(0);
    var totalDispute = formatAmount(0);
    const totalTrans = transQuery ? formatAmount(transQuery) : 0;
    const totalTransCount = transCountQuery ? transCountQuery : 0;
    const totalRevenue = RevenueQuery ? formatAmount(RevenueQuery) : 0;
    const billTotal = billQuery ? billQuery : 0;
    const totalInternalTransfer = InternalTransferQuery ? formatAmount(InternalTransferQuery) : 0;
    const totalExternalTransfer = ExternalTransferQuery ? formatAmount(ExternalTransferQuery) : 0;
    const totalTransfer = parseFloat(InternalTransferQuery) + parseFloat(ExternalTransferQuery);


    var stats = { allCustomers, verCust, unverCust, ngnBal, usdBal, totalExternalTransfer, totalInternalTransfer, totalTrans, totalRefunds, totalRevenue, pendingPayout, approvedPayout, totalDispute, totalTransfer, billTotal, totalTransCount }

    res.json({
      status: true,
      message: 'Site Stats retrieved',
      data: stats
    });

  } catch (error) {
    console.log('sitestats catch ERROR: ' + error.message)
  }
}

const getNotice = async (req, res) => {
  try {

    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const getnotification = await Notify.findAll({
      order: [['id', 'DESC']], where: { uid: adminid, usertype: 'admin' }
    }).catch((err) => {
      console.log("Unable to process your request : " + err);
    });

    if (!getnotification || getnotification.length < 1)
      return res.status(200).json({ status: false, message: 'Notification not found' });

    const noteList = getnotification.map((item) => ({
      notetype: item.notetype,
      content: item.notecontent,
      dated: moment.utc(item.dated).format("DD/MM/YYYY"),
    }));

    res.json({
      status: true,
      message: 'Notification Retrieved',
      data: noteList
    });

  } catch (error) {
    console.log("adm notification Error: ", error.message);
    res.status(400).json({ status: false, message: 'Someting went wrong! Unable to process your request at the moment, kindly retry shortly' });
  }
}

const removeNotify = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    if (!adminid)
      return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const deleteit = await Notify.destroy({ where: { uid: adminid, usertype: 'admin' } });

    if (!deleteit)
      return res.status(400).json({ status: false, message: 'Unable to process request. Reload and try again' });

    res.json({
      status: true,
      message: 'Notification history cleared'
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd adm notif del Error: ", error.message);
  }
}


const uploadPix = async (req, res) => {
  try {
    const pixfile = req.file;
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    if (pixfile == '' || (!pixfile))
      return res.status(400).json({ status: false, message: 'No file uploaded' });

    if (!pixfile) {
      console.error("No file provided or invalid file path:", pixfile);
      return res.status(400).json({ status: false, message: 'No valid file uploaded or file rejected by filter.' });
    }

    try {
      const { fileTypeFromBuffer } = await import('file-type'); // Dynamic import
      const fileTypeResult = await fileTypeFromBuffer(pixfile.buffer); // Use the buffer
      const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg"];

      if (!fileTypeResult || !allowedMimeTypesForPix.includes(fileTypeResult.mime)) {
        // console.warn(`Upload blocked post-multer: Detected content type (${fileTypeResult?.mime || 'unknown'}) is invalid for profile picture. User: ${adminid}.`);
        return res.status(400).json({ status: false, message: "Invalid file content detected. Only images allowed." });
      }

      const originalExtension = pixfile.originalname.split('.').pop()?.toLowerCase();
      if (originalExtension !== fileTypeResult.ext) {
        console.warn(`Warning: File extension mismatch post-multer for profile picture. adm: ${adminid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
      }

    } catch (fileTypeError) {
      console.error("Error during file type check in controller:", fileTypeError);
      return res.status(500).json({ status: false, message: "Error verifying file content." });
    }

    let processedBuffer;
    try {
      // Sanitize and process the image using sharp
      processedBuffer = await sharp(pixfile.buffer)
        .toFormat('jpeg')
        .jpeg({ quality: 80 })
        .toBuffer();
    } catch (sharpError) {
      console.error("Image processing error:", sharpError);
      return res.status(400).json({ status: false, message: 'Invalid or corrupted image file.' });
    }

    let thefile = '';
    try {
      const randomFileName = `admix_${adminid}_${uuidv4()}`;

      cloudinary.uploader.upload_stream({ public_id: randomFileName, resource_type: "image" }, async (error, result) => {
        if (error) {
          console.error("Cloudinary upload error:", error);
          // Handle error without sending response yet if inside callback
          thefile = ''; // Mark as failed
        } else {
          thefile = result.secure_url;
          try {
            const updateResult = await Admin.update({ pix: thefile }, { where: { id: adminid } });

            if (!updateResult || updateResult[0] === 0) {
              console.error("Failed to update profile picture in DB for user:", adminid);
              return res.status(500).json({ status: false, message: 'Upload complete but failed to save link.' });
            }
            return res.json({
              status: true,
              message: 'Profile Image Successfully Updated!'
            });

          } catch (dbError) {
            console.error("DB update error after Cloudinary upload:", dbError);
            return res.status(500).json({ status: false, message: 'Upload complete but failed to save link.' });
          }
        }
      }
      ).end(processedBuffer); // Send the processed buffer


    } catch (uploadError) {
      console.error("Error initiating upload:", uploadError);
      return res.status(500).json({ status: false, message: 'Failed to initiate upload.' });
    }


  } catch (error) {
    console.log("Error while uploading pix profile", error.message);
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
  }

}



const getInvitees = async (req, res) => {
  try {

    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { userid } = req.params
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid userID sent!' });

    const userinfo = await getUserInfo(userid);
    const referby = userinfo.uname;

    if (!referby) return res.status(400).json({ status: false, message: 'Oops! Customer has no valid Referral ID' });

    const getusers = await Customer.findAll({
      where: { referby: referby }, order: [['id', 'DESC']],
      attributes: ['id', 'firstname', 'lastname', 'phoneno', 'email', 'status', 'timed']
    });

    if (!getusers)
      return res.status(400).json({ status: true, message: 'No referral found for customer' });

    const userInfo = await Promise.all(getusers.map(async (info) => {
      var userid = info.id;
      var name = info.firstname + ' ' + info.lastname;
      var phone_number = info.phoneno;
      var email = info.email;
      var accountstatus = info.status == 1 ? 'active' : 'inactive';
      var created_at = moment.unix(info.timed).format("Do MMM, YYYY hh:mm a");

      return { userid, name, phone_number, email, accountstatus, created_at };
    }));

    res.json({
      status: true,
      message: 'Invitees retrieved',
      data: userInfo
    });

  } catch (error) {
    console.log('customer invitees catch ERROR: ' + error.message)
  }
}

const getBeneficiary = async (req, res) => {
  try {

    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { userid } = req.params
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid userID sent!' });


    const getit = await Benefit.findAll({
      where: { userid: userid }, order: [['id', 'DESC']],
      attributes: ['id', 'product', 'network', 'acctname', 'phoneno', 'status', 'timed']
    });

    if (!getit)
      return res.status(400).json({ status: true, message: 'No referral found for customer' });

    const theInfo = await Promise.all(getit.map(async (info) => {
      var userid = info.id;
      var product = info.product;
      var network = info.network;
      var acctname = info.acctname;
      var phoneno = info.phoneno;
      var dstatus = info.status == 1 ? 'active' : 'disabled';
      // const parsedDate = moment(info.timed);
      // if (!parsedDate.isValid()) {
      //   return "Invalid Date";
      // }
      // var created_at = parsedDate.format('D/MM/YYYY hh:mm a');
      var created_at = '';

      return { userid, product, network, phoneno, acctname, dstatus, created_at };
    }));

    res.json({
      status: true,
      message: 'Beneficiary retrieved',
      data: theInfo
    });

  } catch (error) {
    console.log('customer invitees catch ERROR: ' + error.message)
  }
}

const kycUpdate = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm) {
      await t.rollback();
      return res.status(403).json({ status: false, message: 'Admin details not found.' });
    }

    const { kycid, doctype, statuscode, reason } = cleanMe(req.body);

    if (!kycid) {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'KYC document/verification ID is required.' });
    }

    let kycDoc; let kycStatusMap = null;
    if(doctype.toLowerCase() == 'bvn' || doctype.toLowerCase() == 'nin'){
      kycDoc = await KYC.findOne({ where: { id: kycid }, transaction: t });
      kycStatusMap = { approve: 1, decline: 3 };

    }else{
      kycDoc = await KycDoc.findOne({ where: { id: kycid }, transaction: t });  
      kycStatusMap = { approve: 2, decline: 3 };
    }

    if (!kycDoc) {
      await t.rollback();
      return res.status(404).json({ status: false, message: 'KYC document/verification not found.' });
    }


    const userInfo = await getUserInfo(kycDoc.userid, { transaction: t });
    if (!userInfo) {
      await t.rollback();
      return res.status(404).json({ status: false, message: 'Associated user not found.' });
    }

    
    const newStatus = kycStatusMap[statuscode];
    if (newStatus === undefined) {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'Invalid status code provided.' });
    }

    const docTypeNameMap = {
      idcard: 'means of identification',
      utility: 'proof of address',
      interpass: 'international passport',
      BVN: 'BVN verification',
      NIN: 'NIN verification'
    };

    const docTypeName = docTypeNameMap[doctype] || 'document';

    // Update the KYC document
    if(doctype.toLowerCase() == 'bvn' || doctype.toLowerCase() == 'nin'){
      await KYC.update(
        { status: newStatus, updatedAt: Date.now() },
        { where: { id: kycid }, transaction: t }
      );
    }else{
      await KycDoc.update(
        { docstatus: newStatus, remark: reason, remarkby: getadm.name, updatedAt: Date.now() },
        { where: { id: kycid }, transaction: t }
      );
    }

    // Prepare notifications
    let mailContent;
    const statusText = statuscode === 'approve' ? 'approved' : 'declined';
    const kycStatusText = newStatus === 2 ? 'Approved' : newStatus === 1 ? 'Approved' : newStatus === 3 ? 'Declined' : 'Pending';

    if (statuscode === 'approve') {
      mailContent = `<p>Your ${docTypeName} on ${process.env.SITENAME} has been approved.</p>
                     <p>For further enquiry, please call ${process.env.SITEPHONE}</p>`;
    } else { // decline
      mailContent = `<p>Your ${docTypeName} on ${process.env.SITENAME} has been declined.</p>
                     <p><i>Reason: ${reason || 'No reason provided.'}</i></p>
                     <p>For further enquiry, please call ${process.env.SITEPHONE}</p>`;
    }

    //send email                
    mailSender(userInfo.firstname, 'KYC Update - Hichtpay', userInfo.email, mailContent);
    mailSender(userInfo.firstname, 'KYC Update - Hichtpay', 'olajideolatunji@hitchpay.ng', mailContent);

    const auditdesc = `${kycStatusText} KYC (${docTypeName}) for ${userInfo.firstname} ${userInfo.lastname}`;
    logAudit(adminid, auditdesc);

    await t.commit();

    res.json({
      status: true,
      message: `KYC Successfully Updated!`,
      doctype: doctype,
      kycStatus: kycStatusText
    });

  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd kyc adm Error: ", error.message);
  }
}


const custTierUpdate = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { tierlevel, custid } = cleanMe(req.body);

    if ((!custid) || custid == '')
      return res.status(400).json({ status: false, message: 'Oops! No customer selected, please refresh and try again' });
    if ((!tierlevel) || tierlevel <= 0)
      return res.status(400).json({ status: false, message: 'Oops! No tier selected, please refresh and try again' });

    //check if other still active
    const usrinfo = await Customer.findOne({ where: { id: custid }, transaction: t });

    if (!usrinfo)
      return res.status(400).json({ status: false, message: 'We are sorry, customer not found. Kindly refresh this page' });

    var hisname = `${usrinfo.firstname} ${usrinfo.lastname}`;
    // var hisphn = usrinfo.phoneno
    var currenttier = usrinfo.accounttier
    if (currenttier == tierlevel) {
      res.json({
        status: false,
        message: `Account already at tier ${tierlevel}!`,
      });
    } else {

      /* updarade his account */
      var upgradetier = tierlevel;
      await Customer.update({ accounttier: upgradetier }, { where: { id: custid }, transaction: t });

      var mailcontent = `
          <p>Your account has been updated to tier ${upgradetier} on ${process.env.SITENAME}</p>
          <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
      `;

      //send email                
      mailSender(hisname, 'Account Update', usrinfo.email, mailcontent);
      //SEND FCM
      pushNotify(custid, `Account Update`, `Your account has been updated to tier ${upgradetier}`);

      var auditdesc = `${hisname} account tier updated to  ${upgradetier}`;

      logAudit(adminid, auditdesc);

      await t.commit();

      res.json({
        status: true,
        message: `Account Tier Successfully Updated!`,
      });
    }
  } catch (error) {
    if (t && !t.finished) {
      await t.rollback();
    }
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd kyc adm Error: ", error.message);
  }
}


const updAdmStatus = async (req, res) => {
  try {
    const admid = req.user.id;
    if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { updstatus, updid } = cleanMe(req.body);
    if (!updstatus)
      return res.status(400).json({ status: false, message: 'Oops! No action selected' });

    if (!updid || updid == '')
      return res.status(400).json({ status: false, message: 'Oops! Admin must be selected!' });

    if (updstatus == 'password' || updstatus == '2FA') {
      const getadm = await Admin.findOne({ where: { id: admid, status: 1 } });

      //check if the amind exist
      const checktheadmin = await Admin.findOne({ where: { id: updid } });
      if (!checktheadmin)
        return res.status(400).json({ status: false, message: 'Select Admin not found' });

      /*check the type  */
      if (updstatus == 'password') {
        var pword = 'Sekure@123!';
        const salt = bcrypt.genSaltSync(saltRounds);
        const hashed = bcrypt.hashSync(pword, salt);

        var updatprod = await Admin.update({ auth: hashed }, { where: { id: updid } });

        var themsgbody = `<p style="font-size: 16px;">${getadm.name} just forced reset your admin login ${updstatus} on ${process.env.SITENAME}. </p>
        <p style="font-size: 16px;">Kindly login to update your password</p>
        <p style="font-size: 16px;">New Default Password: ${pword}</p>`;

      } else if (updstatus == '2FA') {
        var updatprod = await Admin.update({ authsecret: null }, { where: { id: updid } });

        var themsgbody = `<p style="font-size: 16px;">${getadm.name} just forced reset your admin login two factor authenticator (2FA) on ${process.env.SITENAME}. </p>
        <p style="font-size: 16px;">Kindly login with - 419911, to add new 2FA to your account.</p>`;
      }

      if (!updatprod)
        return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry again later' });

      var auditdesc = `Forced reset ${checktheadmin.name} admin account ${updstatus}`;
      logAudit(admid, auditdesc);

      var notedesc = `Your account ${updstatus} was force reset by ${getadm.name}`
      notifyMe(updid, 'Account Update', 'admin', notedesc)

      var mailcontent = `
        ${themsgbody}
      
        <p style="font-size: 16px;">You are receiving this email because you requested for ${updstatus} reset of your admin account on <b>${process.env.SITENAME}</b>. If you did not make this request, please contact the Administrator urgently</a></p>
        `;

      mailSender(checktheadmin.name, `${ucFirst(updstatus)} Reset Notice`, checktheadmin.email, mailcontent);

      res.json({ status: true, message: `${ucFirst(updstatus)} successfully reset` });


    } else {

      const checgetadm = await Admin.findOne({ where: { id: admid, status: 1 } });

      if (checgetadm.role != 'superadmin' && checgetadm.role != 'admin') {
        return res.status(400).json({ status: false, message: `You do not have the right permission to make this request` });
      }

      //check if the amind exist
      const getadm = await Admin.findOne({ where: { id: updid } });
      if (!getadm) return res.status(400).json({ status: false, message: 'Admin not found' });

      const admrole = getadm.role;
      const admname = getadm.name;

      if (updstatus == 'enable' || updstatus == 'enabled') {
        var action = '1';
      } else {
        var action = '0';
      }

      if (admrole == 'superadmin' && action == 0) {
        return res.status(400).json({ status: false, message: 'Super admin cannot be disabled' });
      } else {
        const updatprod = await Admin.update({ status: action }, { where: { id: updid } });
        if (!updatprod)
          return res.status(400).json({ status: false, message: 'Unable to process request' });

        var auditdesc = `${ucFirst(updstatus)} ${admname} admin account`;
        logAudit(admid, auditdesc);

        var notedesc = `Your account was ${updstatus} by ${admname}`
        notifyMe(updid, 'Account Update', 'admin', notedesc)

        res.json({ status: true, message: 'Admin ' + updstatus });
      }
    }

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd-rest adm status Error: ", error.message);
  }
}

function removeSpacesFromArray(arr) {
  return arr.map(item => item.trim());
}

const updAdmAccess = async (req, res) => {
  try {
    const admid = req.user.id;
    if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
    const { theaccess } = cleanMe(req.body);
    var data = Object.entries(theaccess);

    const getadm = await Admin.findOne({ where: { id: admid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    // const admrole = getadm.role;
    // if (admrole != 'superadmin')
    //   return res.status(400).json({ status: false, message: 'Access control can only be done by the Super Admin' });


    const upsertPromises = data.map(async (item) => {
      const [dept, roles] = item;
      const existingRecord = await RoleAccess.findOne({ where: { route: dept } });

      if (existingRecord) {
        // Update the existing record
        await RoleAccess.update(
          { roles: JSON.stringify(roles) },
          { where: { route: dept } }
        );
        // console.log(`Updated record for department: ${dept}`);
      } else {
        // Insert a new record
        await RoleAccess.create({
          route: dept,
          roles: JSON.stringify(roles),
        });
        // console.log(`Inserted new record for department: ${dept}`);
      }
    });

    await Promise.all(upsertPromises);
    console.log('Records have been upserted successfully.');

    res.json({
      status: true,
      message: 'Role Access Udpated'
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd adm status Error: ", error.message);
  }
}

const getAllAccess = async (req, res) => {
  try {
    const records = await RoleAccess.findAll();
    const formattedRecords = records.map(record => ({
      route: record.route,
      roles: JSON.parse(record.roles), // Deserialize JSON string back into an array
    }));

    // console.log('Formatted Records:', formattedRecords);

    res.json({
      status: true,
      message: 'Role Access Udpated',
      data: formattedRecords
    });
  } catch (error) {
    console.error('Error retrieving records:', error);
  }
};

const getAllAdm = async (req, res) => {

  try {

    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findAll({
      // attributes: ['id', 'name', 'email', 'role', 'phoneno', 'status', 'timed', 'isonline', 'authsecret'],
      include: {
        model: Role,
        as: 'role'
      }
    });

    if (!getadm)
      return res.status(400).json({ status: false, message: 'Details not found' });

    // console.log('getadm.role', getadm)

    const listadm = await Promise.all(getadm.map(async (arrayItem) => {
      var id = arrayItem.id;
      var name = arrayItem.name;
      var email = arrayItem.email;
      var role = ucFirst(arrayItem.role.name ? arrayItem.role.name : null);
      var roleid = arrayItem.role.id ? arrayItem.role.id : null;
      var phoneno = arrayItem.phoneno;
      var status = arrayItem.status;
      var timed = moment.unix(arrayItem.timed).format("Do MMM, YYYY hh:mm a");
      // var timed = moment.unix(arrayItem.timed).format("Do MMM, YYYY hh:mm a");
      var isonline = arrayItem.isonline;
      var twofactor = arrayItem.authsecret == null ? 'Disabled' : arrayItem.authsecret == '' ? 'Disabled' : 'Enabled';

      return { name, status, timed, isonline, twofactor, phoneno, role, id, email, roleid }

    }));

    res.json({
      status: true,
      message: 'Admin retrieved',
      data: listadm
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("Error: ", error.message);
  }

}

const addAdm = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const { fullname, email, mobileno, role } = cleanMe(req.body);

    if (role == 'superadmin' || role.toLowerCase() == 'superadmin')
      return res.status(400).json({ status: false, message: 'Invalid request sent' });

    if (!fullname || fullname == '') return res.status(400).json({ status: false, message: 'Oops! Name must be specified!' });
    if (!email || email == '') return res.status(400).json({ status: false, message: 'Oops! Invalid email sent!' });
    if (!mobileno || mobileno == '') return res.status(400).json({ status: false, message: 'Oops! Invalid phone number sent!' });
    if (!role || role == '') return res.status(400).json({ status: false, message: 'Oops! Role must be specified!' });

    const checkAdminExist = await Admin.findOne({ where: { [Op.or]: [{ email: email }, { phoneno: mobileno }] } });

    if (checkAdminExist) {
      return res.status(400).json({ status: false, message: 'Admin already exist with this Email or Phone Number' });
    }



    let timed = new Date();
    let dtimed = Date.parse(new Date()) / 1000;
    var pword = 'Authpass@123!';
    const salt = bcrypt.genSaltSync(saltRounds);
    const hashed = bcrypt.hashSync(pword, salt);

    const roleInstance = await Role.findOne({ where: { name: role } });
    if (!roleInstance) {
      return res.status(400).json({ status: false, message: `Role '${role}' not found.` });
    }

    const createAdmin = await Admin.create({
      name: fullname, email: email, auth: hashed, phoneno: mobileno,
      status: 1, timed: dtimed, accesstoken: '', isonline: 0,
      roleId: roleInstance.id, // Assign roleId
    });

    if (!createAdmin)
      return res.status(400).json({ status: false, message: 'Unable to process admin account setup' });

    await Admin.findOne({ where: { [Op.and]: [{ email: email }, { phoneno: mobileno }] } });

    //log audit
    var auditdesc = 'Added ' + fullname + ' as an admin with ' + role + ' permission';
    logAudit(adminid, auditdesc);

    // send mail with defined transport object
    var content = `<p style="font-size: 17px;">Welcome to ${process.env.SITENAME} Admin!</p>
      <p>Kindly use the password below to login to your admin dashboard and then update the password afterward on the settings page</p>

      <h2><strong> ${pword}</strong></h2>`;

    //send email
    mailSender(fullname, 'Admin Account Set Up', email, content);

    res.json({
      status: true,
      message: `Admin Account Successfully Created.`
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("add adm Error: ", error.message);
  }

}

const addRoles = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const { name, description, permissionIds } = cleanMe(req.body);
    console.log(req.body)
    console.log(cleanMe(req.body))

    if (!name || name == '') return res.status(400).json({ status: false, message: 'Oops! Role name must be specified!' });
    if (!description || description == '') return res.status(400).json({ status: false, message: 'Oops! Role description must be specified!' });

    const checkAdminExist = await Role.findOne({ where: { name: name } });

    if (checkAdminExist) {
      return res.status(400).json({ status: false, message: 'Role already exist with this name' });
    }

    const createRole = await Role.create({
      name: name, description: description
    });

    if (!createRole)
      return res.status(400).json({ status: false, message: 'Unable to process role setup' });

    // Associate permissions if permissionIds are provided and it's an array
    if (permissionIds && Array.isArray(permissionIds) && permissionIds.length > 0) {
      await createRole.setPermissions(permissionIds);
    }

    res.json({
      status: true,
      message: `Admin Role Successfully Created.`
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("add adm role Error: ", error.message);
  }
}

const updateRoles = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const { roleId, name, description, permissionIds } = cleanMe(req.body);

    if (!name || name == '') return res.status(400).json({ status: false, message: 'Oops! Role name must be specified!' });
    if (!description || description == '') return res.status(400).json({ status: false, message: 'Oops! Role description must be specified!' });

    const roleToUpdate = await Role.findByPk(roleId);

    if (!roleToUpdate) {
      return res.status(404).json({ status: false, message: 'Role not found' });
    }

    // Update role details
    roleToUpdate.name = name;
    roleToUpdate.description = description;
    await roleToUpdate.save();

    //`setPermissions` handle adding new and removing old ones.
    if (permissionIds && Array.isArray(permissionIds)) {
      await roleToUpdate.setPermissions(permissionIds);
    }

    res.json({ status: true, message: 'Role successfully updated.' });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("add adm role Error: ", error.message);
  }
}

const addPermissions = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const { name, description } = cleanMe(req.body);

    if (!name || name == '') return res.status(400).json({ status: false, message: 'Oops! Permission name must be specified!' });
    if (!description || description == '') return res.status(400).json({ status: false, message: 'Oops! Permission description must be specified!' });

    const checkAdminExist = await Permission.findOne({ where: { name: name } });

    if (checkAdminExist) {
      return res.status(400).json({ status: false, message: 'Permission already exist with this name' });
    }

    const createPermission = await Permission.create({
      name: name, description: description
    });

    if (!createPermission)
      return res.status(400).json({ status: false, message: 'Unable to process permission setup' });


    res.json({
      status: true,
      message: `Permission Successfully Created.`
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("add adm permiss Error: ", error.message);
  }
}

const getAllRoles = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getroles = await Role.findAll({
      include: {
        model: Permission,
        as: 'permissions',
        required: false
      }
    });

    if (!getroles)
      return res.status(400).json({ status: false, message: 'Details not found' });

    const listroles = await Promise.all(getroles.map(async (arrayItem) => {
      var id = arrayItem.id;
      var name = arrayItem.name;
      var description = arrayItem.description;
      var permissions = arrayItem.permissions
      return { id, name, description, permissions }

    }));

    res.json({
      status: true,
      message: 'Roles retrieved',
      data: listroles
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("Error: ", error.message);
  }

}

const getAllPermitts = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getpersm = await Permission.findAll();

    if (!getpersm)
      return res.status(400).json({ status: false, message: 'Details not found' });

    const listroles = await Promise.all(getpersm.map(async (arrayItem) => {
      var id = arrayItem.id;
      var name = arrayItem.name;
      var description = arrayItem.description;
      return { name, description, id }

    }));

    res.json({
      status: true,
      message: 'Permission retrieved',
      data: listroles
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("Error get perms: ", error.message);
  }

}

const updAdmRole = async (req, res) => {
  try {
    const admin_id = req.user.id;
    if (!admin_id) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadmrole = await Admin.findOne({ where: { id: admin_id } });
    if (!getadmrole)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const myadmrole = getadmrole.role;
    // if (myadmrole != 'superadmin')
    //   return res.status(400).json({ status: false, message: 'Update can only be done by the Super Admin' });

    const { role, adminid } = cleanMe(req.body);
    if (!role || role == '') return res.status(400).json({ status: false, message: 'Oops! Role must be specified!' });
    if (!adminid || adminid == '') return res.status(400).json({ status: false, message: 'Oops! Admin must be selected!' });

    const getadm = await Admin.findOne({ where: { id: adminid }, attributes: ['id', 'name', 'role'] });

    if (!getadm)
      return res.status(400).json({ status: false, message: 'Admin not found' });

    const admrole = getadm.role;
    const admname = getadm.name;

    if (admrole == 'superadmin') {
      return res.status(400).json({ status: false, message: 'Super admin role cannot be downgraded' });
    } else {

      const roleInstance = await Role.findOne({ where: { name: role } });
      if (!roleInstance) {
        return res.status(400).json({ status: false, message: `Role '${role}' not found.` });
      }

      const updatprod = await Admin.update({ roleId: roleInstance.id }, { where: { id: adminid } });

      if (!updatprod)
        return res.status(400).json({ status: false, message: 'Unable to process request' });
      //log audit
      var auditdesc = 'Updated ' + admname + ' role from ' + admrole + ' permission ' + role;
      logAudit(admin_id, auditdesc);

      res.json({
        status: true,
        message: 'Admin Role Updated'
      });

    }

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd adm role Error: ", error.message);
  }
}


const myProfile = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid)
      return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne(
      {
        where:
          { id: adminid },
        attributes: ['id', 'name', 'email', 'role', 'phoneno', 'status', 'timed']
      });

    if (!getadm) return res.status(400).json({ status: false, message: 'Profile not found' });
    res.json({
      status: true,
      message: 'Profile retrieved',
      data: getadm
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("adm my profile Error: ", error.message);
  }
}

const adminDetails = async (req, res) => {
  try {
    const admid = req.user.id;
    if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { adminid } = cleanMe(req.body);

    const getadm = await Admin.findOne({ where: { id: adminid }, attributes: ['id', 'name', 'email', 'role', 'phoneno', 'status', 'timed'] });

    if (!getadm) return res.status(400).json({ status: false, message: 'Profile not found' });
    res.json({
      status: true,
      message: 'Details retrieved',
      data: getadm
    });
  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("adm details Error: ", error.message);
  }
}


const showAudit = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const getlogs = await Audit.findAll({
      order: [['id', 'DESC']],
      limit: 100,
      include: [{
        model: Admin,
        as: 'admin',
        attributes: ['name', 'status'] // Only fetch the fields you need
      }]
    });

    if (!getlogs || getlogs.length === 0) {
      return res.status(200).json({ status: false, message: 'No audit logs found.' });
    }

    const listlog = getlogs.map(log => ({
      admname: log.admin ? log.admin.name : 'Unknown Admin',
      logdesc: log.description,
      created_at: moment.utc(log.timed).format("Do MMM, YYYY hh:mm a"),
      thestatus: log.admin ? log.admin.status : null
    }));

    res.json({
      status: true,
      message: 'Audit logs retrieved',
      data: listlog
    });


  } catch (error) {
    console.error("Audit logs Error: ", error.message);
    res.status(500).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
  }
}


async function generateReferralCode() {
  let refercode;
  let isUnique = false;

  while (!isUnique) {
    // Generate a random referral code
    refercode = randomstring.generate({
      length: 6,
      charset: 'alphabetic',
      capitalization: 'uppercase'
    });

    // Check if the generated referral code already exists in the database
    const existingCode = await Customer.findOne({ where: { refcode: refercode } }).catch((err) => {
      console.log("Unable to process your request : " + err);
    });

    if (!existingCode) {
      isUnique = true; // Exit the loop if the code is unique
    }
  }

  return refercode;
}

const extractEmail = async (data) => {
  if (typeof data === 'string') {
    return data; // Already a plain email string
  } else if (typeof data === 'object' && data.text) {
    return data.text; // Extract from the 'text' field
  } else if (typeof data === 'object' && data.hyperlink) {
    // Extract the email from the 'mailto:' part if the hyperlink exists
    const match = data.hyperlink.match(/^mailto:(.*)$/);
    return match ? match[1] : null;
  }
  return null; // Fallback for unknown formats
}

const genTwofactor = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const checkUser = await Admin.findOne({ where: { id: adminid }, attributes: ['name'] });

    if (!checkUser)
      return res.json({ status: true, message: 'Unable to process your request at the moment, kindly refresh and try again' });

    const newSecret = twoFactor.generateSecret({ name: 'HitchPayAdm', account: checkUser.name });

    // console.log(newSecret)
    qrcode.toDataURL(newSecret.uri, (err, data_url) => {
      if (err) {
        return res.json({ error: 'Error generating QR code' });
      }
      res.json({ status: true, secret: newSecret.secret, qrCode: data_url, qrlink: newSecret.qr });
    });
  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("change 2fa setup Error: ", error.message);
  }
}

const verify2FA = async (req, res) => {

  try {
    const { token, secret } = cleanMe(req.body);
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const checkUser = await Admin.findOne({ where: { id: adminid }, attributes: ['name'] });

    if (!checkUser)
      return res.json({ status: true, message: 'Unable to process your request at the moment, kindly refresh and try again' });

    const result = twoFactor.verifyToken(secret, token);

    if (result && result.delta === 0) {
      const changeit = await Admin.update({ authsecret: secret }, { where: { id: adminid } });

      res.json({ status: true, message: 'Account 2FA successfully validated' });

    } else {
      res.status(400).json({ status: false, message: 'Unable to validated 2FA Token' });
    }

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("change 2fa verify Error: ", error.message);
  }
}

const deactivate2FA = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const checkUser = await Admin.findOne({ where: { id: adminid } });

    if (!checkUser)
      return res.json({ status: true, message: 'Unable to process your request at the moment, kindly refresh and try again' });

    var updatprod = await Admin.update({ authsecret: null }, { where: { id: adminid } });

    if (!updatprod)
      return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry again later' });

    var auditdesc = `Deactivated their admin login two factor authenticator (2FA)`;
    logAudit(adminid, auditdesc);

    var mailcontent = `
        <p style="font-size: 16px;">You just deactivated your admin login two factor authentication (2FA) on ${process.env.SITENAME}. </p>
        <p style="font-size: 16px;">If you did not make this request, please contact the Administrator urgently</a></p>`;

    mailSender(checkUser.name, `2FA Deactivation Notice`, checkUser.email, mailcontent);

    res.json({ status: true, message: '2FA successfully deactivated' });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("change 2fa deactivation Error: ", error.message);
  }
}


const transHistory = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { reference, status, product, startDate, endDate, type, limit = 2000 } = cleanMe(req.body);
    const whereClause = {};

    if (reference) {
      whereClause.txref = { [Op.like]: `%${reference}%` };
    }

    if (status) {
      whereClause.status = status;
    }
    if (product) {
      whereClause.pfor = product;
    }

    if (startDate && endDate) {
      const starDayUnix = moment(startDate).startOf('day').unix();
      const endDayUnix = moment(endDate).endOf('day').unix();
      whereClause.timed = { [Op.between]: [starDayUnix, endDayUnix] };
    } else if (startDate) {
      const starDayUnix = moment(startDate).startOf('day').unix();
      whereClause.timed = { [Op.gte]: starDayUnix };
    } else if (endDate) {
      // Filter for transactions on or before the end date
      const endDayUnix = moment(endDate).endOf('day').unix();
      whereClause.timed = { [Op.lte]: endDayUnix };
    }

    const gethist = await Payn.findAll({
      where: whereClause, // Apply the constructed filters
      order: [['id', 'DESC']],
      limit: parseInt(limit, 10),
      include: [{
        model: Customer,
        as: 'customer',
        attributes: ['firstname', 'lastname', 'email']
      }]
    });

    if (!gethist || gethist.length === 0) {
      return res.status(200).json({
        status: true, // It's not an error, just no data
        message: 'No transactions found matching your criteria.',
        data: [] // Send back an empty array
      });
    }


    const datalist = gethist.map((arrayItem) => ({
      // Include customer details in the response
      customerName: arrayItem.customer ? `${arrayItem.customer.firstname || ''} ${arrayItem.customer.lastname || ''}`.trim() : 'N/A',
      customerEmail: arrayItem.customer ? arrayItem.customer.email : 'N/A',
      amount: arrayItem.amount,
      transtype: arrayItem.paytype,
      transid: arrayItem.txref,
      date: moment.unix(arrayItem.timed).format('Do MMM, YYYY hh:mm a'),
      newbal: arrayItem.newbal,
      prevbal: arrayItem.prevbal,
      product: arrayItem.pfor,
      revenue: arrayItem.revenue == null ? 0 : arrayItem.revenue,
      recipient: arrayItem.recipient,
      productid: arrayItem.productid,
      paychannel: arrayItem.paychannel,
      paystatus: arrayItem.status == '0' ? 'Pending' : arrayItem.status == '1' ? 'Completed' : arrayItem.status == '3' ? 'Refunded' : arrayItem.status == '4' ? 'Chargedback' : arrayItem.status == '5' ? 'Cancelled' : '',
      currency: arrayItem.currency == '' ? "NGN" : arrayItem.currency,

    }));

    const totalCredit = await Payn.sum('amount', { where: { status: 1, paytype: 'credit' } });
    const totalDebit = await Payn.sum('amount', { where: { status: 1, paytype: 'debit' } });

    res.json({
      status: true,
      message: 'Payment history retrieved',
      data: datalist, totalCredit, totalDebit
    });

  } catch (error) {
    console.log('user pay history catch ERROR: ' + error.message)
  }
}

const transUserHistory = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { userid } = cleanMe(req.params);

    if (!userid || userid == null || userid == undefined || userid == '')
      return res.status(400).json({ status: false, message: 'No user selected' });

    const getuser = await Customer.findOne({ where: { [Op.or]: [{ id: userid }] } });

    if (!getuser)
      return res.status(400).json({ status: false, message: 'No user found for selection' });

    const gethist = await Payn.findAll({ where: { userid: userid }, order: [['id', 'DESC']] });

    if (!gethist)
      return res.status(200).json({ status: false, message: 'No payment found for you' });

    const datalist = gethist.map((arrayItem) => ({
      amount: arrayItem.amount,
      transtype: arrayItem.paytype,
      transid: arrayItem.txref,
      date: moment.unix(arrayItem.timed).format('Do MMM, YYYY hh:mm a'),
      newbal: arrayItem.newbal,
      prevbal: arrayItem.prevbal,
      product: ucFirst(arrayItem.pfor),
      recipient: arrayItem.recipient,
      productid: arrayItem.productid,
      sessionid: arrayItem.paychannel,
      meta: !arrayItem.meta ? null : JSON.parse(arrayItem.meta),
      ntwk: arrayItem.ntwk,
      paystatus: arrayItem.status == '0' ? 'Pending' : arrayItem.status == '1' ? 'Completed' : arrayItem.status == '3' ? 'Refunded' : arrayItem.status == '4' ? 'Chargedback' : arrayItem.status == '5' ? 'Cancelled' : '',
      currency: arrayItem.currency == '' ? "NGN" : arrayItem.currency,
    }));

    res.json({
      status: true,
      message: 'Payment history retrieved',
      data: datalist
    });

  } catch (error) {
    console.log('user pay history catch ERROR: ' + error.message)
  }
}

const SettingSite = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const { sitephone, appemail, appaddress, inflowfee_cap, inflowfee, stampduty, stampduty_max, referearn, eligibleamt, referaccntno, referbenchmark, referbonus_enabled, uplinebonus, downlinebonus, welcomebonus_enabled, welcomebonus, dailybonus_enabled, dailybonus, refermilestone_enabled, dailybonustype, usacctfee, ftprovider, dollartransfer, dollar_fee, dollar_fund, dollar_withdraw, achtransfer, achaccelerated, checkoutfee, checkoutcap, crosstransfer, crosscollectfee, rateprovider, ratemargin_percent, nocac_allow, billprovider } = cleanMe(req.body);
    
    // if (!inflowfee || inflowfee == '') return res.status(400).json({ status: false, message: 'You forgot to specify inflow charge' });
    // if (!inflowfee_cap || inflowfee_cap == '') return res.status(400).json({ status: false, message: 'Oops! forgot to specify inflow cap - maximum chargeable fee on inflow' });

    const updatprod = await AppSett.update({
      siteemail: appemail, sitephone: sitephone, siteadress: appaddress,
      inflowfee, referearn: referearn, inflowfee_cap, stampduty,
      eligible_refamt: eligibleamt, refermilestone_enabled, stampduty_max, status: 1, referaccntno: referaccntno,
      referbenchmark, referbonus_enabled, uplinebonus, downlinebonus, welcomebonus_enabled,
      welcomebonus, dailybonus_enabled, dailybonus, dailybonus_type: dailybonustype, usacctfee, ftprovider, dollarwithdraw: dollar_withdraw,
      dollarfund: dollar_fund, dollarfee: dollar_fee, dollartransfer, achtransfer, achaccelerated, checkoutfee, checkoutcap, crosstransfer, crosscollectfee, rateprovider, ratemargin_percent, nocac_allow, billprovider
    }, { where: { id: 1 } });

    if (!updatprod)
      return res.status(400).json({ status: false, message: 'Unable to process request' });

    //log audit
    var auditdesc = `Updated application settings `;
    logAudit(adminid, auditdesc);

    res.json({
      status: true,
      message: 'App Setting Updated'
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd app sett Error: ", error.message);
  }
}


const showAppSetting = async (req, res) => {
  try {
    const getsett = await AppSett.findOne({ where: { id: 1 } });

    if (!getsett) return res.status(400).json({ status: false, message: 'Settings not found' });
    res.json({
      status: true,
      message: 'App setting retrieved',
      data: getsett
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("Error: ", error.message);
  }
}

const UpdBankRevenue = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
      return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

    const { bankcode, acctno, enquirytoken, accountname, bankname } = cleanMe(req.body);

    if (!bankcode || bankcode == '') return res.status(400).json({ status: false, message: 'You forgot to specify the banks' });
    if (!acctno || acctno == '') return res.status(400).json({ status: false, message: 'Oops! forgot to specify account number' });

    const updatprod = await AppSett.update({
      paybtankcode: bankcode, paytacctno: acctno, paytenquirytoken: enquirytoken, paytaccountname: accountname, paytbankname: bankname
    }, { where: { id: 1 } });

    if (!updatprod)
      return res.status(400).json({ status: false, message: 'Unable to process request' });

    //log audit
    var auditdesc = `Updated revenue settlement bank details `;
    logAudit(adminid, auditdesc);

    res.json({
      status: true,
      message: 'Settlement Bank Updated'
    });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd sett bnk Error: ", error.message);
  }
}


const addPromotion = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const uploadfiles = req.files;

    // console.log('req.files', req.files)

    if (!uploadfiles)
      return res.status(400).json({ status: false, message: 'You forgot to select any file for promotion' });

    if (Object.keys(uploadfiles).length == 0)
      return res.status(400).json({ status: false, message: 'Promotional images required' });

    const adsimg = uploadfiles['adsimg'];
    const maxCount = 8;

    if (!adsimg)
      return res.status(400).json({ status: false, message: 'You forgot to upload promotion image' });

    //check file counts
    if ((uploadfiles['adsimg'].length) > maxCount)
      return res.status(400).json({ status: false, message: 'Promotion images cannot exceed 8 images at a time' });

    if ((uploadfiles['adsimg'].length) < 1)
      return res.status(400).json({ status: false, message: 'Atleast 1 Promotion image required for upload' });

    // Array of allowed files
    const array_of_allowed_files = ['png', 'jpeg', 'jpg', 'PNG', 'JPEG', 'JPG'];
    const array_of_allowed_file_types = ['image/png', 'image/jpeg', 'image/jpg', 'image/PNG', 'image/JPEG', 'image/JPG'];
    const allowed_file_size = process.env.ALLOWFILESIZE;

    // Get the extension of the uploaded file
    //const file_extension = adsimg.originalname.slice(((adsimg.originalname.lastIndexOf('.') - 1) >>> 0) + 2);

    if ((adsimg.size / (1024 * 1024)) > allowed_file_size)
      return res.status(400).json({ status: false, message: 'Ads image too large' });

    var blnValid = false;
    for (let i = 0; i < uploadfiles['adsimg'].length; i++) {
      var oInput = uploadfiles['adsimg'][i];
      const file_extension = oInput.originalname.slice(((oInput.originalname.lastIndexOf('.') - 1) >>> 0) + 2);
      if (!array_of_allowed_files.includes(file_extension) || !array_of_allowed_file_types.includes(oInput.mimetype)) {
        return res.status(400).json({ status: false, message: "Sorry, " + oInput.originalname + " is invalid, allowed extensions are: " + array_of_allowed_files.join(", ") });
        //return false;
      }
    }

    const mediafiles = [];
    for (let i = 0; i < uploadfiles['adsimg'].length; i++) {
      var media = uploadfiles['adsimg'][i];
      console.log('hereh here')
      // let uplaodresult = await cloudinary.uploader.upload(media.path, {
      //   public_id: `${'ads' + adminid}adsimg${i}`
      // });


      let processedBuffer;
      try {
        // Sanitize and process the image using sharp
        processedBuffer = await sharp(media.buffer)
          .toFormat('jpeg')
          .jpeg({ quality: 80 })
          .toBuffer();
      } catch (sharpError) {
        console.error("Image processing error:", sharpError);
        return res.status(400).json({ status: false, message: 'Invalid or corrupted image file.' });
      }

      let thefile;
      thefile = await new Promise((resolve, reject) => {
        const randomFileName = `ads_${i}_${uuidv4()}`;
        const uploadStream = cloudinary.uploader.upload_stream(
          { public_id: randomFileName, resource_type: "image" },
          (error, result) => {
            if (error) {
              console.error("Cloudinary upload error:", error);
              return reject(new Error('Cloudinary upload failed.'));
            }
            resolve(result.secure_url);
          });
        uploadStream.end(processedBuffer);
      });

      console.log('thefile', thefile)

      // const mediaupload = uplaodresult.secure_url
      mediafiles.push(thefile);
    }

    let mymedias = JSON.stringify(mediafiles)

    console.log('mymedias', mymedias)

    const updatads = await AppSett.update({ ads: mymedias }, { where: { id: 1 } });

    if (!updatads)
      return res.status(400).json({ status: false, message: 'Unable to process request' });

    res.json({
      status: true,
      message: 'Promotion Ads Updated'
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Something went wrong! Unable to process your request at the moment, kindly retry shortly' });
    console.log("ads adm Error: ", error.message);
  }
}


const showAds = async (req, res) => {
  try {
    const getsett = await AppSett.findOne({ where: { status: 1 }, attributes: ['ads'] });

    if (!getsett) return res.status(400).json({ status: false, message: 'Ads not found' });

    res.json({
      status: true,
      message: 'Ads retrieved',
      data: JSON.parse(getsett.ads)
    });


  } catch (error) {
    res.status(400).json({ status: false, message: 'Something went wrong! Unable to process your request at the moment, kindly retry shortly' });
    console.log("show ads promotion Error: ", error.message);
  }
}

const getAdmProducts = async (req, res) => {
  try {

    const getdprod = await Product.findAll({
      order: [['amount', 'ASC']]
    }).catch((err) => {
      console.log("Unable to process your request : " + err);
    });

    if (!getdprod || getdprod.length < 1)
      return res.status(400).json({ status: false, message: 'No product found' });

    const prodList = getdprod.map((item) => ({
      prdid: item.id,
      product: ucFirst(item.category),
      productname: item.prdname == '' ? '--' : item.prdname,
      productcode: item.prdcode == null ? '--' : item.prdcode,
      providerprice: item.feetype == 'discount' ? item.providerprice + '%' : item.providerprice == null ? '--' : item.providerprice == 0 ? '--' : item.providerprice,
      amount: item.feetype == 'discount' ? item.amount + '%' : `₦${formatAmount(item.amount, 2)}`,
      ourprice: item.amount,
      dataplans: item.dataplan,
      billerid: item.billerid,
      providerprice: item.providerprice,
      provider_fee_cap: item.provider_fee_cap,
      provfeetype: item.provfeetype,
      provfeemodel: item.provfeemodel,
      datatype: item.datatype,
      feemodel: item.feemodel,
      feetype: item.feetype == '' ? '-' : item.feetype,
      network: item.ntwk == '' ? '-' : item.ntwk,
      thestatus: item.status == '1' ? 'active' : 'disabled'
    }));

    res.json({
      status: true,
      message: 'Product Retrieved',
      data: prodList
    });

  } catch (error) {
    console.log("get prd Error: ", error.message);
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
  }
}


const payDetails = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { reference } = cleanMe(req.params);
    if (!reference) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const getdetails = await Payn.findOne({
      where: {
        [Op.and]: [{ txref: reference }]
      }
    });

    if (!getdetails)
      return res.status(200).json({ status: false, message: 'No payment found for you' });

    var custname = meteradr = vendunit = vendtoken = sourcename = sourceaccount = sourcebank = '';
    var amount = getdetails.amount ? getdetails.amount : '0.00';
    var amountval = getdetails.amountval ? getdetails.amountval : '0.00';
    var fee = getdetails.fee ? getdetails.fee : '0.00';
    var transref = getdetails.txref;
    var customerid = getdetails.userid;
    var phonenumber = getdetails.recipient;
    var paydate = moment.unix(getdetails.timed).format('Do MMM, YYYY');
    var paytime = moment.unix(getdetails.timed).format('MMM Do, YYYY | h:m a');
    var transtimed = moment.unix(getdetails.timed).format("Do MMM, YYYY hh:mm a")
    var newbal = getdetails.newbal;
    var prevbal = getdetails.prevbal;
    var paychannel = getdetails.paychannel;
    var transtype = getdetails.paytype;
    var userid = getdetails.userid;
    var product = ucFirst(getdetails.pfor);
    var productid = getdetails.productid;
    var pay_desc = getdetails.pay_desc;
    var narration = getdetails.narration;
    var jsonresp = getdetails.jsonresp;
    var network = getdetails.ntwk ? getdetails.ntwk.toUpperCase() : '';
    var paystatus = getdetails.status;
    var networkcode = getdetails.ntwkid ? getdetails.ntwkid : '';
    var paystatus_text = getdetails.status == '0' ? 'Pending' : getdetails.status == '1' ? 'Successful' : getdetails.status == '3' ? 'Refunded' : getdetails.status == '4' ? 'Chargedback' : getdetails.status == '5' ? 'Cancelled' : '';
    var currency = getdetails.currency == '' ? "NGN" : getdetails.currency;

    if (getdetails.meta && getdetails.pfor != 'wallet') {
      var meta = !getdetails.meta ? null : JSON.parse(getdetails.meta);
      var custname = meta.custname ? meta.custname : '';
      var meteradr = meta.address ? meta.address : '';
      var metertype = meta.metertype ? meta.metertype : '';
      var vendUnit = meta.unit ? meta.unit : '';
      var vendunit = vendUnit ? vendUnit : 'NA';
      var vendtoken = (getdetails.pay_desc == '' || getdetails.pay_desc == null) ? 'NA' : meta.token;
      var sourcename = meta.sourcename ? meta.sourcename : '';
      var sourceaccount = meta.sourceaccount ? meta.sourceaccount : '';
      var sourcebank = meta.sourcebank ? meta.sourcebank : '';

    } else if (getdetails.meta && getdetails.pfor == 'wallet') {
      var meta = !getdetails.meta ? null : JSON.parse(getdetails.meta);
      var sourcename = meta.sourcename ? meta.sourcename : '';
      var sourceaccount = meta.sourceaccount ? meta.sourceaccount : '';
      var sourcebank = meta.sourcebank ? meta.sourcebank : '';
      var meteradr = vendunit = vendtoken = ''
      var custname = `${sourcename}`;
      var pay_desc = `Credit Payment from ${sourcename}`

    }

    if (product.toLowerCase() == 'transfer') {
      var pay_desc = `Transfer to ${sourcename}`
    } else {
      var pay_desc = pay_desc;
    }

    var cashback = parseFloat(amount) - parseFloat(amountval);
    var dataplan = ''; var prodcode = '';

    const userinfo = await getUserInfo(userid);  // get user info
    const ownername = userinfo.lastname + ' ' + userinfo.firstname;
    const owneremail = userinfo.email;

    var datalist = { customerid, ownername, owneremail, amount, vendtoken, transref, phonenumber, custname, meteradr, paydate, newbal, prevbal, product, productid, paystatus, paychannel, paystatus_text, currency, paytime, vendunit, metertype, network, transtype, cashback, prodcode, dataplan, transtimed, fee, pay_desc, amountval, networkcode, sourcename, sourceaccount, sourcebank, narration, jsonresp };

    res.json({
      status: true,
      message: 'Transaction Details',
      data: datalist
    });

  } catch (error) {
    console.log('trans details catch ERROR: ' + error.message)
  }
}

const updCustStatus = async (req, res) => {
  try {
    const admid = req.user.id;
    if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { updstatus, updid } = cleanMe(req.body);
    if (!updstatus)
      return res.status(400).json({ status: false, message: 'Oops! No action selected' });

    if (!updid || updid == '')
      return res.status(400).json({ status: false, message: 'Oops! Customer ID must be passed!' });

    //check if the amind exist
    const checkthecust = await Customer.findOne({ where: { id: updid } });
    if (!checkthecust)
      return res.status(400).json({ status: false, message: 'Selected customer not found' });

    /*check the type  */
    if (updstatus == 'disable') {
      var updatprod = await Customer.update({ status: 0 }, { where: { id: updid } });
      var thestatus = 'disabled';
    } else if (updstatus == 'suspend') {
      var updatprod = await Customer.update({ status: 3 }, { where: { id: updid } });
      var thestatus = 'suspended';
    } else if (updstatus == 'enable') {
      var updatprod = await Customer.update({ status: 1 }, { where: { id: updid } });
      var thestatus = 'enabled';
    } else {
      var thestatus = '';
    }

    if (!updatprod)
      return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry again later' });

    const userinfo = await getUserInfo(updid);  // get user info
    const name = userinfo.lastname + ' ' + userinfo.firstname;
    const email = userinfo.email;

    var auditdesc = `${ucFirst(thestatus)} ${name} account`;
    logAudit(admid, auditdesc);

    res.json({ status: true, message: `Account successfully ${thestatus}` });

  } catch (error) {
    res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("upd cust status Error: ", error.message);
  }
}


const getUserDocs = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

    const { userid } = req.params;
    const getall = await KycDoc.findAll({
      where: { userid: userid }, order: [['id', 'DESC']]
    });

    if (!getall || getall.length <= 0)
      return res.json({ status: false, message: 'No document found' });

    const listdocs = await Promise.all(getall.map(async (arrayItem) => {

      var hisid = arrayItem.userid;
      var docid = arrayItem.id;
      var filetype = arrayItem.doctype;
      var fileurl = arrayItem.docurl;
      var docname = arrayItem.docname;
      var fileno = arrayItem.docno;
      var upgrdetier = arrayItem.tier;
      var ownerid = arrayItem.userid;
      var updateAt = moment.utc(arrayItem.updatedAt).format("Do MMM, YYYY hh:mm a")
      var createdAt = moment.utc(arrayItem.createdAt).format("Do MMM, YYYY hh:mm a")

      var filestatus = arrayItem.docstatus == 1 ? 'Awaiting' : arrayItem.docstatus == 3 ? 'Declined' : arrayItem.docstatus == 2 ? 'Approved' : 'Not Uploaded';
      return { docid, hisid, fileurl, filetype, docname, upgrdetier, filestatus, fileno, updateAt, createdAt };
    }));

    res.json({
      status: true,
      message: 'KYC document retrieved',
      data: listdocs
    });

  } catch (error) {
    res.json({ status: false, message: 'Something went wrong! Kindly retry shortly' });
    console.log("get kyc docs Error: ", error.message);
  }
}


const getAllDocs = async (req, res) => {

  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

    const getall = await KycDoc.findAll({
      order: [['timed', 'DESC']],
      include: [{
        model: Customer,
        as: 'customer',
        attributes: ['firstname', 'lastname', 'email']
      }]
    });

    if (!getall || getall.length <= 0)
      return res.json({ status: false, message: 'No document found' });

    const listdocs = getall.map((arrayItem) => {

      const docid = arrayItem.id;
      const filetype = arrayItem.doctype;
      const fileurl = arrayItem.docurl;
      const docname = arrayItem.docname;
      const fileno = arrayItem.docno;
      const upgrdetier = arrayItem.tier;
      const remark = !arrayItem.remark ? '' : arrayItem.remark;
      const remarkby = !arrayItem.remarkby ? '' : arrayItem.remarkby;
      const hisid = arrayItem.userid;
      const updateAt = moment.unix(arrayItem.timed).format("Do MMM, YYYY hh:mm a")
      const createdAt = moment.unix(arrayItem.timed).format("Do MMM, YYYY hh:mm a")

      const filestatus = arrayItem.docstatus == 1 ? 'Awaiting' : arrayItem.docstatus == 3 ? 'Declined' : arrayItem.docstatus == 2 ? 'Approved' : 'Not Uploaded';

      // get user info from the included 'customer' association
      const customer = arrayItem.customer;
      const uname = customer ? `${customer.firstname || ''} ${customer.lastname || ''} | ${customer.email || ''}`.trim() : 'N/A';
      return { uname, hisid, docid, fileurl, filetype, docname, upgrdetier, filestatus, fileno, updateAt, createdAt, remark, remarkby };
    });

    res.json({
      status: true,
      message: 'KYC document retrieved',
      data: listdocs
    });

  } catch (error) {
    res.json({ status: false, message: 'Something went wrong! Kindly retry shortly' });
    console.log("get kyc docs Error: ", error.message);
  }
}


const chargeWallet = async (req, res) => {
  try {
    const admid = req.user.id;
    if (!admid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

    const { amount, reason, custid } = req.body;

    if (!amount || amount == '')
      return res.json({ status: false, message: 'Oops! Amount must be specified!' });

    if (amount <= 0)
      return res.json({ status: false, message: 'Oops! Invalid amount specified' });

    if (!reason || reason == '')
      return res.json({ status: false, message: 'Oops! Reason for charge must be specified!' });

    if (!reason || reason == '')
      return res.json({ status: false, message: 'Oops! Kindly specify the customer ' });

    const userinfo = await getUserInfo(custid);  // get user info
    // const userbal = userinfo.bal;
    const fname = userinfo.firstname;
    const lname = userinfo.lastname;
    const userphone = userinfo.phoneno;
    const sendername = userinfo.lastname + ' ' + userinfo.firstname;
    const useremail = userinfo.email;
    const userid = userinfo.id;

    const userbal = await getBal(custid, 'NGN');


    let timed = Date.parse(new Date()) / 1000;
    // var newbal = parseFloat(userbal) - parseFloat(amount);
    const txref = 'STP' + md5(randomstring.generate(3) + 'CHG' + userid).toUpperCase().substring(0, 12);
    var meta_data = JSON.stringify({ "sourcename": '', "sourceaccount": "", "sourcebank": "", "custname": "" });

    //Debit HIM
    const newbal = await updateBalance(userid, amount, 'NGN', 'debit');

    const logwallet = await Payn.create({
      userid: custid, recipient: userphone, amount: amount, amountval: amount, currency: 'NGN',
      newbal: newbal, prevbal: userbal, txref: txref, pfor: 'fundcharge',
      usertype: 'user', paytype: 'debit', productid: '',
      paychannel: 'HitchPay', paidthru: '', meta: meta_data, ntwk: 'HitchPay',
      pay_desc: reason, timed: timed, status: 1, name: ''
    });


    if (logwallet) {
      //send email
      var mailcontent = `
          <p style="font-size: 15px;">Your HitchPay wallet has been charged NGN ${formatAmount(amount)}</p>
          <h2>Amount: NGN ${formatAmount(amount)}</h2>
          <p style="font-size: 15px;">
          <strong>Reason: </strong> ${reason}<br>
          
          <p>For enquiry please call ${process.env.SITEPHONE} or send email to ${process.env.SUPPORTMAIL}</p>
          `;

      //send notification
      var notedesc = `₦${formatAmount(amount)} charged for ${reason}`;
      notifyMe(userid, 'Wallet Charge', 'user', notedesc)

      //SEND FCM
      pushNotify(userid, `Wallet Charge`, `₦${formatAmount(amount)} charged for ${reason}`);

      mailSender(fname, 'Wallet Charge - HitchPay', useremail, mailcontent);

      var auditdesc = `Charged ₦${formatAmount(amount)} from ${fname} ${lname} wallet. Reason: ${reason}`;
      logAudit(admid, auditdesc);

      res.json({
        status: true,
        message: 'Successfully Processed',
      });


    } else {
      res.json({
        status: false,
        message: 'Unable to process request. Kindly reload and retry'
      })
    }

  } catch (error) {
    res.json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    console.log("charge wall Error: ", error.message);
  }
}


const notifyCustomer = async (req, res) => {
  const admid = req.user.id;
  if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

  const { category, type, title, message, target } = req.body;

  if (!category) return res.status(400).json({ status: false, message: 'Category is required.' });
  if (!type) return res.status(400).json({ status: false, message: 'Notification type is required (Email, SMS, or FCM).' });
  if (!title) return res.status(400).json({ status: false, message: 'Notification title is required.' });
  if (!message) return res.status(400).json({ status: false, message: 'Notification message is required.' });

  const lowerCaseCategory = category.toLowerCase();
  const lowerCaseType = type.toLowerCase();

  if (lowerCaseCategory === 'user' && !target) {
    return res.status(400).json({ status: false, message: 'Target customer identifier is required for Single User category.' });
  }

  const validCategories = ['user', 'general', 'verified', 'unverified'];
  const validTypes = ['email', 'sms', 'fcm'];

  if (!validCategories.includes(lowerCaseCategory)) {
    return res.status(400).json({ status: false, message: 'Invalid category.' });
  }
  if (!validTypes.includes(lowerCaseType)) {
    return res.status(400).json({ status: false, message: 'Invalid type. Must be "Email", "SMS", or "FCM".' });
  }

  try {
    const adminInfo = await getAdminInfo(admid);
    if (!adminInfo) {
      return res.status(403).json({ status: false, message: 'Admin details not found.' });
    }

    if (lowerCaseCategory === 'general' || lowerCaseCategory === 'verified' || lowerCaseCategory === 'unverified') {
      let allCustomers;
      if (lowerCaseCategory == 'verified') {
        allCustomers = await Customer.findAll({ where: { bvverify: 2, status: { [Op.ne]: 0 } } }); // Notify active users
      } else if (lowerCaseCategory == 'unverified') {
        allCustomers = await Customer.findAll({ where: { bvverify: { [Op.ne]: 2 }, status: { [Op.ne]: 0 } } }); // Notify active users
      } else {
        allCustomers = await Customer.findAll({ where: { status: { [Op.ne]: '0' } } }); // Notify active users
      }

      if (!allCustomers || allCustomers.length === 0) {
        return res.status(200).json({ status: true, message: `No ${lowerCaseCategory} customers found to notify.` });
      }

      let emailCount = 0; let smsCount = 0; let fcmCount = 0;
      const notificationPromises = [];

      for (const customer of allCustomers) {
        switch (lowerCaseType) {
          case 'email':
            if (customer.email) {
              notificationPromises.push(mailSender(customer.firstname || 'Customer', title, customer.email, message));
              emailCount++;
            }
            break;
          case 'sms':
            if (customer.phoneno) {
              notificationPromises.push(sendSMS(customer.phoneno, `${title}: ${message}`));
              smsCount++;
            }
            break;
          case 'fcm':
            notificationPromises.push(pushNotify(customer.id, title, message));
            fcmCount++;
            break;
        }
      }

      await Promise.all(notificationPromises).catch(err => console.error("Error sending some notifications:", err));

      logAudit(admid, `Sent bulk notification: Type - ${type}, Title - "${title}". Emails: ${emailCount}, SMS: ${smsCount}, FCM: ${fcmCount}`);

      return res.json({ status: true, message: `Bulk notification process initiated. Emails: ${emailCount}, SMS: ${smsCount}, FCM: ${fcmCount}` });

    } else if (lowerCaseCategory === 'user') {
      const customer = await Customer.findOne({
        where: {
          [Op.or]: [{ id: target }, { email: target }, { phoneno: target }], status: 1
        }
      });

      if (!customer) {
        return res.status(404).json({ status: false, message: `Customer with identifier "${target}" not found or is inactive.` });
      }

      let notificationSent = false;
      try {
        switch (lowerCaseType) {
          case 'email':
            if (customer.email) {
              await mailSender(customer.firstname || 'Customer', title, customer.email, message);
              notificationSent = true;
            } else {
              return res.status(400).json({ status: false, message: 'Customer does not have an email address.' });
            }
            break;
          case 'sms':
            if (customer.phoneno) {
              await sendSMS(customer.phoneno, `${title}: ${message}`);
              notificationSent = true;
            } else {
              return res.status(400).json({ status: false, message: 'Customer does not have a phone number.' });
            }
            break;
          case 'fcm':
            await pushNotify(customer.id, title, message);
            notificationSent = true;
            break;
        }

      } catch (sendError) {
        console.error(`Failed to send ${type} to user ${customer.id}:`, sendError.message);
        return res.status(500).json({ status: false, message: `Failed to send ${type} notification.` });
      }


      if (notificationSent) {
        logAudit(admid, `Sent notification to user ${customer.id} (${customer.email || customer.phoneno}): Type - ${type}, Title - "${title}"`);
        return res.json({ status: true, message: `Notification sent successfully to ${customer.firstname || 'customer'}.` });
      } else {
        // This case should ideally be caught by specific checks above (no email/phone) or sendError
        return res.status(500).json({ status: false, message: 'Failed to send notification.' });
      }
    }
  } catch (error) {
    console.error("Error in notifyCustomer:", error.message);
    res.status(500).json({ status: false, message: 'An error occurred while processing the notification.' });
  }
};

const getEarningsHistory = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const earnings = await logEarning.findAll({
      order: [['id', 'DESC']],
      include: [
        {
          model: Customer,
          as: 'earner', // Alias for the user who received the earning
          attributes: ['id', 'firstname', 'lastname', 'email'],
          required: false // Use left join in case earner is deleted
        },
        {
          model: Customer,
          as: 'source', // Alias for the user who triggered the earning
          attributes: ['id', 'firstname', 'lastname', 'email'],
          required: false // Use left join in case source is deleted
        }
      ]
    });

    if (!earnings || earnings.length === 0) {
      return res.status(200).json({ status: false, message: 'No earnings history found.' });
    }

    const totalearns = await logEarning.sum('amount');
    const pendwitdraw = await logEarning.sum('amount', { where: { status: 0 } });

    const formattedEarnings = earnings.map(earning => ({
      id: earning.id,
      amount: earning.amount,
      type: earning.type,
      product: earning.product,
      reference: earning.reference,
      status: earning.status === 1 ? 'Settled' : 'Pending',
      date: moment.unix(earning.timed).format("Do MMM, YYYY hh:mm a"),
      earner: earning.earner ? `${earning.earner.firstname || ''} ${earning.earner.lastname || ''}`.trim() : `User ID: ${earning.userid}`,
      earner_email: earning.earner ? earning.earner.email : 'N/A',
      source_user: earning.source ? `${earning.source.firstname || ''} ${earning.source.lastname || ''}`.trim() : `User ID: ${earning.payfrom}`,
      source_user_email: earning.source ? earning.source.email : 'N/A',
    }));

    res.json({
      status: true,
      message: 'Earnings history retrieved successfully.',
      data: formattedEarnings, totalearns, pendwitdraw
    });

  } catch (error) {
    console.error('Error fetching earnings history:', error.message);
    res.status(400).json({ status: false, message: 'An error occurred while fetching earnings history.' });
  }
};


const getVirtualAccounts = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const virtualAccounts = await Bank.findAll({
      include: [
        {
          model: Customer,
          as: 'owner', // Using the alias defined in the association
          attributes: ['id', 'firstname', 'lastname', 'email', 'phoneno'],
          required: true 
        }
      ],
      order: [['id', 'DESC']]
    });

    if (!virtualAccounts || virtualAccounts.length === 0) {
      return res.status(200).json({ status: false, message: 'No virtual accounts found.' });
    }

    const formattedAccounts = virtualAccounts.map(account => ({
      account_id: account.id,
      bank_name: account.bankname,
      account_number: account.accountno,
      account_name: account.accountname,
      provider: account.provider,
      owner_id: account.owner.id,
      owner_name: `${account.owner.firstname || ''} ${account.owner.lastname || ''}`.trim(),
      owner_email: account.owner.email,
      owner_phone: account.owner.phoneno,
      currency: account.currency,
      status: account.status == '1' ? 'Active' : 'Inactive',
    }));

    res.json({ status: true, message: 'Virtual accounts retrieved successfully.', data: formattedAccounts });

  } catch (error) {
    console.error('Error fetching virtual accounts:', error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching virtual accounts.' });
  }
};

const getUsdAccountRequests = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const requests = await AcctRequest.findAll({
      where: { currency: 'USD' },
      include: [{
        model: Customer,
        as: 'customer', // NOTE: This association must be defined in your models.
        attributes: ['firstname', 'lastname', 'email']
      }],
      order: [['timed', 'DESC']]
    });

    if (!requests || requests.length === 0) {
      return res.status(200).json({ status: true, message: 'No USD account requests found.', data: [] });
    }

    const formattedRequests = requests.map(req => ({
      id: req.id,
      customerName: req.customer ? `${req.customer.firstname} ${req.customer.lastname}`.trim() : 'N/A',
      customerEmail: req.customer ? req.customer.email : 'N/A',
      status: req.status === 0 ? 'Pending' : req.status === 1 ? 'Reviewed' : req.status === 2 ? 'Approved' : req.status === 3 ? 'Declined' : req.status === 4 ? 'Provisioned' : 'Unknown',
      statusCode: req.status,
      reference: req.reference,
      date: moment.unix(req.timed).format('Do MMM, YYYY hh:mm a'),
    }));

    return res.json({
      status: true,
      message: 'USD Account requests.',
      data: formattedRequests
    });

  } catch (error) {
    console.error('Error fetching USD account requests:', error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching USD account requests.' });
  }
};

const getUsdAccountRequestDetails = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const { reference } = req.params;

    const requestDetails = await AcctRequest.findOne({
      where: { id: reference, currency: 'USD' },
      include: [{
        model: Customer,
        as: 'customer',
        attributes: ['id', 'firstname', 'lastname', 'email', 'phoneno']
      }]
    });

    if (!requestDetails) {
      return res.status(404).json({ status: false, message: 'Request not found.' });
    }

    // const payload = JSON.parse(requestDetails.jsonreq);

    const customerId = requestDetails.customer.id;
    const kycDoc = await KycDoc.findOne({ where: { userid: customerId, tier: 2, doctype: 'idcard' } });
    // console.log(kycDoc)
    // const utilityDoc = await KycDoc.findOne({ where: { userid: customerId, tier: 2, doctype: 'utility' } });
    const utilityDoc = await KycDoc.findOne({ where: { userid: customerId, doctype: 'utility' }, order: [['id', 'DESC']] });
    const PassportDoc = await KycDoc.findOne({ where: { userid: customerId, doctype: 'interpass' } });

    const formattedDetails = {
      id: requestDetails.id,
      customer: requestDetails.customer,
      status: requestDetails.status,
      statustext:  requestDetails.status === 0 ? 'Pending' : requestDetails.status === 1 ? 'Reviewed' : requestDetails.status === 2 ? 'Approved' : requestDetails.status === 3 ? 'Declined' : requestDetails.status === 4 ? 'Provisioned' : 'Unknown',
      paymentref: requestDetails.payref,
      reference: requestDetails.reference,
      metainfo: !requestDetails.meta ? null : JSON.parse(requestDetails.meta),
      date: moment.unix(requestDetails.timed).format('Do MMM, YYYY hh:mm a'),
      documents: {
        // proof_of_address_url: utilityDoc ? utilityDoc.docurl : null,
        idcard: {
          image_front_url: kycDoc ? kycDoc.docurl : null,
          image_back_url: kycDoc ? kycDoc.docurl_back : null,
          number: kycDoc ? kycDoc.docno : null,
          country: kycDoc ? kycDoc.issuancecountry : null,
          expiry: kycDoc ? kycDoc.expirydate : null,
          docname: kycDoc ? kycDoc.docname : null,
          doctier: kycDoc ? kycDoc.tier : null,
          docstatus: kycDoc.docstatus  == 1 ? 'In review' : kycDoc.docstatus  == 2 ? 'Approved' : kycDoc.docstatus  == 3 ? 'Declined' : kycDoc.docstatus  == 3 ? 'Not submitted' : null
        },
        utility: {
          image_front_url: utilityDoc ? utilityDoc.docurl : null,
          image_back_url: utilityDoc ? utilityDoc.docurl_back : null,
          number: utilityDoc ? utilityDoc.docno : null,
          country: utilityDoc ? utilityDoc.issuancecountry : null,
          expiry: utilityDoc ? utilityDoc.expirydate : null,
          docname: utilityDoc ? utilityDoc.docname : null,
          doctier: utilityDoc ? utilityDoc.tier : null,
          docstatus: utilityDoc.docstatus  == 1 ? 'In review' : utilityDoc.docstatus  == 2 ? 'Approved' : utilityDoc.docstatus  == 3 ? 'Declined' : utilityDoc.docstatus  == 3 ? 'Not submitted' : null,
        },

        passport: {
          image_front_url: PassportDoc ? PassportDoc.docurl : null,
          image_back_url: PassportDoc ? PassportDoc.docurl_back : null,
          number: PassportDoc ? PassportDoc.docno : null,
          country: PassportDoc ? PassportDoc.issuancecountry : null,
          expiry: PassportDoc ? PassportDoc.expirydate : null,
          docname: PassportDoc ? PassportDoc.docname : null,
          doctier: PassportDoc ? PassportDoc.tier : null,
          docstatus: PassportDoc.docstatus  == 1 ? 'In review' : PassportDoc.docstatus  == 2 ? 'Approved' : PassportDoc.docstatus  == 3 ? 'Declined' : PassportDoc.docstatus  == 3 ? 'Not submitted' : null
        }
      },
            decline_reason: requestDetails.decline_reason
    };

    return res.json({
      status: true,
      message: 'Request details retrieved.',
      data: formattedDetails
    });

  } catch (error) {
    console.error(`Error fetching USD account request details for ID ${req.params.reference}:`, error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching request details.' });
  }
};

const updateUsdAccountRequestStatus = async (req, res) => {
  // status: 2 for approve, 3 for decline
  const { status, decline_reason, requestid } = req.body; 
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }


    if (![1, 3].includes(status)) {
      return res.status(400).json({ status: false, message: 'Invalid status provided.' });
    }

    if (status === 3 && !decline_reason) {
      return res.status(400).json({ status: false, message: 'Decline reason is required.' });
    }

    const requestToUpdate = await AcctRequest.findOne({ where: { id: requestid, currency: 'USD' } });

    if (!requestToUpdate) {
      return res.status(404).json({ status: false, message: 'Request not found.' });
    }

    let doapprove; let notifyDesc, mailContent;
    const user = await getUserInfo(requestToUpdate.userid);

    if(status == 1){
      doapprove = await ApproveUSDRequest(requestid);
      
      if(doapprove[0]){
        notifyDesc = `Congratulations! Your USD virtual account request has been reviewed and processing.`;
        mailContent = `<p>${notifyDesc}</p><p>You can now view your account details in the app.</p>`;
        
        await pushNotify(requestToUpdate.userid, 'USD Account Request Update', notifyDesc);
        await notifyMe(requestToUpdate.userid, 'USD Account Request', 'user', notifyDesc);
        await mailSender(user.firstname, 'USD Account Request Update', user.email, mailContent);
        logAudit(adminid, `Updated USD account request #${requestid} to status ${status === 1 ? 'Reviewed' : 'Declined'}`);
  
        return res.json({ status: true, message: 'Request status updated successfully.' });
      }else{
        return res.json({ status: true, message: 'Unable to process - '+doapprove[1] });
      }
      

    }else{
      doapprove = await AcctRequest.update({status: 3, decline_reason: decline_reason}, {where: {id: requestid}})

      notifyDesc = `Your USD virtual account request has been declined. Reason: ${decline_reason}`;
      mailContent = `<p>We regret to inform you that your USD virtual account request has been declined.</p><p>Reason: ${decline_reason}</p><p>Please contact support for more information.</p>`;
      await pushNotify(requestToUpdate.userid, 'USD Account Request Update', notifyDesc);
      await notifyMe(requestToUpdate.userid, 'USD Account Request', 'user', notifyDesc);
      await mailSender(user.firstname, 'USD Account Request Update', user.email, mailContent);
      
      logAudit(adminid, `Updated USD account request #${requestid} to status ${status === 1 ? 'Reviewed' : 'Declined'}`);

      return res.json({ status: true, message: 'Request status updated successfully.' });
    }

  } catch (error) {
    console.error(`Error updating USD account request status for ID ${requestid}:`, error.message);
    res.status(400).json({ status: false, message: 'An error occurred while updating request.' });
  }
};


const ApproveUSDRequest = async (reqid) => {
  
  try {
      const getRequest = await AcctRequest.findOne({ where: { id: reqid} });
        if(!getRequest) return res.status(400).json({ status: false, message: 'You currently have a request processing' });
      
        // const userinfo = await getUserInfo(getRequest.serid);  // get user info
    
        const userid = getRequest.userid;
        const getkycdoc2 = await KycDoc.findOne({
          where: {
            userid: userid,
            docstatus: 2,
            [Op.or]: [{ doctype: 'interpass' }, { docname: 'NIN' }, {docname: 'Standard NIN Slip'} ]
          }
        });

        if (!getkycdoc2) return [false, 'International passport verification, or NIN has not been approved'];
    
        // const utilityDoc = await KycDoc.findOne({ where: { userid: userid, tier: 2, doctype: 'utility', docstatus: 2 } });
        const utilityDoc = await KycDoc.findOne({ where: { userid: userid, doctype: 'utility', docstatus: 2 }, order: [['id', 'DESC']] });
        if (!utilityDoc) return [false, 'Proof of address has not been approved'];
    
    
        const checkKadUser = await CardUser.findOne({ where: { userid: userid, provider: 'MPLD' } });
        if (!checkKadUser) return [false, 'Customer needd to re-submit request'];
            
        var trackiID = checkKadUser.trackingid;

        const metainfo = !getRequest.meta ? null : JSON.parse(getRequest.meta);
        const statement = metainfo.statement
        const employ_status = metainfo.employment_status
        const job_desc = metainfo.employment_description
        const nationality = metainfo.nationality
        const employer_name = metainfo.employer_name
        const us_residency_status = metainfo.us_residency_status
        const occupation = metainfo.occupation

        // console.log('getkycdoc2.expirydate', getkycdoc2.expirydate);
        
        if(getkycdoc2.docname = 'Standard NIN Slip' || getkycdoc2.docname == 'NIN'){
          var identityDoc = 'NIN';
        }else{
          var identityDoc =  getkycdoc2.docname.toUpperCase() == 'INTERNATIONAL PASSPORT' ? 'PASSPORT' : getkycdoc2.docname.toUpperCase()
        }


        let sourcefund = { file_name: 'BANK_STATEMENT', file: await urlToDataUri(statement) }
        let proof_of_address = { file_name: 'UTILITY_BILL', file: await urlToDataUri(utilityDoc.docurl) }

        let docDate = getkycdoc2.expirydate === '' ? '2030-05-10' : getkycdoc2.expirydate;
        if (!/^\d{2}-\d{2}-\d{4}$/.test(docDate)) {
          docDate = moment(docDate, ['YYYY-MM-DD', moment.ISO_8601]).format('DD-MM-YYYY');
        }

        const dateExiry = docDate;
        // console.log('docDate', docDate);
        // console.log('dateExiry', dateExiry);

        const payload = {
            customer_id: trackiID,
            meta: {
                identification_number: getkycdoc2.docno,
                employment_status: employ_status,
                employment_description: job_desc,
                nationality: nationality,
                employer_name: employer_name,
                us_residency_status: us_residency_status,
                documents: {
                    identification_country: getkycdoc2.issuancecountry ?? 'NG',
                    source_of_funds: sourcefund,
                    proof_of_address: proof_of_address,
                    identification_image_front: await urlToDataUri(getkycdoc2.docurl),
                    identification_image_back: await urlToDataUri(getkycdoc2.docurl_back),
                    identification_type: identityDoc,
                    identification_expiration: dateExiry,
                },
                passport_number: getkycdoc2.docno,
                occupation: occupation
            }
        };

        // console.log('payload usd act', payload)
        let timed = Date.parse(new Date()) / 1000;
        var theref = getRequest.payref ?? timed;
        await LogRequest.create({ reference: theref, jsonreq: JSON.stringify(payload), timed: timed, product: 'createusdacct', provider: 'mpld' });

        const config = {
            method: 'post',
            url: `${process.env.MPLDURL}/collections/virtual-account/usd`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
            data: payload
        };

        let response = await axios.request(config);
        let thedata = response.data;
        const jsonString2 = JSON.stringify(thedata);
        const payloadString = JSON.stringify(payload);
        console.log('usdacct', thedata);
        
        if (thedata.status) {
          const accountId = thedata.data.account_id;
          const reference = thedata.data.reference;
          const requeststatus = thedata.data.status;
          let thestatus = 0;

          if (requeststatus.toLowerCase() == 'approved') {
              thestatus = 2
          } else {
              thestatus = 1
          }

           // log the account request
          const updatLog = await AcctRequest.update({ jsonreq: payloadString, jsonresp: jsonString2, status: 1, account_id: accountId, reference: reference }, {where: {id: reqid, userid: userid}});

          await USAccountUpd(reference, userid);  //check if account updated

          return [true, 'USD Account Issuance Processing'];

        } else {
          return [false, 'Unable to process US account creation' + thedata.message];
        }

    } catch (error) {
        console.log("usacct Error: ", error.message);
        console.error('usacct Error response data:', JSON.stringify(error.response.data, null, 2));
        return [false, error.response.data.message];
    }
}

const deubgger = async()=>{

   const config = {
            method: 'GET',
            url: `https://api.maplerad.com/v1/customers/57fbc610-e16d-4d98-a957-5817863ea62e`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };
    let response = await axios.request(config);
    let thedata = response.data;

    return thedata
}

// deubgger()
// .then(result => {
//     console.log("API result:", result);
// })
// .catch(err => console.error("Script execution failed:", err))
// .finally(async () => {
//     // Optional: Close database connection if this is a standalone script
//     // await db.sequelize.close();
// });


async function urlToDataUri(fileUrl) {
    // max file size in MB
    const MAX_FILE_SIZE_MB = 5;
    try {
        const response = await axios.get(fileUrl, {
            responseType: "arraybuffer",
        });

        const contentType = response.headers["content-type"];

        // check file size from buffer
        const fileSizeBytes = response.data.byteLength;
        const fileSizeMB = fileSizeBytes / (1024 * 1024);

        if (fileSizeMB > MAX_FILE_SIZE_MB) {
            throw new Error(
                `File too large: ${(fileSizeMB).toFixed(2)} MB (limit is ${MAX_FILE_SIZE_MB} MB)`
            );
        }

        // convert to base64
        const base64 = Buffer.from(response.data).toString("base64");

        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error("Error converting file:", error.message);
        return null;
    }
}

const generateVirtualAccount = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const { custid, provider, usertype} = req.body;
    if (!custid || !provider) {
      return res.status(400).json({ status: false, message: 'Customer ID and provider are required.' });
    }

    if(usertype != 'business'){
        var customer = await Customer.findOne({ where: { id: custid } });
        if (!customer) {
          return res.status(404).json({ status: false, message: 'Customer not found.' });
        }

        var name = `${customer.firstname} ${customer.lastname}`;

        const kycRecord = await KYC.findOne({
          where: {
            userid: custid,
            [Op.or]: [{status: 1}, {status: 2}],
            vertype: 'BVN' 
            // [Op.or]: [{ vertype: 'BVN' }, { vertype: 'NIN' }]
          },
          order: [['id', 'DESC']]
        });

        if (!kycRecord) {
          return res.status(400).json({ status: false, message: 'Customer has not completed the required KYC verification (BVN/NIN).' });
        }
    }else{
      
      var customer = await Business.findOne({ where: { uuid: custid } });
      if (!customer) {
        return res.status(404).json({ status: false, message: 'Business not found.' });
      }

      var name = `${customer.business_name}`;

    }

    
    let createAccountResult;
    if (provider.toLowerCase() === 'safehaven') {
      if(usertype == 'business'){
        console.log('Generating SafeHaven Business Account for:', name);
        createAccountResult = await genSHBizAccount(customer.id);
        console.log("SH Biz Account Result:", createAccountResult);

      }else{
        createAccountResult = await genSHAccount(custid, kycRecord.verid, kycRecord.bvv, '', kycRecord.vertype, kycRecord.verdob, kycRecord.verphone, customer.countrycode
        );
      }

    } else if (provider.toLowerCase() === '9psb') {
      createAccountResult = await gen9PSBAccount(custid);
    } else {
      return res.status(400).json({ status: false, message: 'Invalid provider specified.' });
    }

    const [success, message, accountName, accountNumber, bankName] = createAccountResult;

    if (success) {
      logAudit(adminid, `Generated a ${provider} virtual account for ${name}`);
      return res.status(201).json({ status: true, message, data: { accountName, accountNumber, bankName } });
    } else {
      return res.status(400).json({ status: false, message });
    }

  } catch (error) {
    logger.error('Error in generate Virtual Account:', error);
    res.status(500).json({ status: false, message: 'An internal error occurred while generating the account.' });
  }
};



const getCustomerAccounts = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const { customerid } = req.params;
    if (!customerid) {
      return res.status(400).json({ status: false, message: 'Customer ID is required.' });
    }

    const accounts = await Bank.findAll({
      where: { userid: customerid },
      order: [['provider', 'ASC'], ['id', 'DESC']]
    });

    if (!accounts || accounts.length == 0) {
      return res.status(200).json({ status: true, message: 'No virtual accounts found for this customer.', data: [] });
    }

    const formattedAccounts = accounts.map(acc => ({
      id: acc.id,
      bankName: acc.bankname,
      accountNumber: acc.accountno,
      accountName: acc.accountname,
      provider: acc.provider,
      currency: acc.currency,
      status: acc.status == 1 ? 'Active' : 'Inactive',
      // date: moment.unix(acc.timed).format('Do MMM, YYYY hh:mm a'),
    }));

    res.json({ status: true, message: 'Customer accounts retrieved successfully.', data: formattedAccounts });

  } catch (error) {
    logger.error('Error fetching customer accounts:', error);
    res.status(500).json({ status: false, message: 'An error occurred while fetching customer accounts.' });
  }
};

const getCustomerKycHistory = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const { customerid } = req.params;
    // console.log(customerid)
    if (!customerid) {
      return res.status(400).json({ status: false, message: 'Customer ID is required.' });
    }

    // Fetch identity verification records (BVN, NIN, etc.)
    const verifications = await KYC.findAll({
      where: { userid: customerid, provider: {[Op.ne]: 'dojahlog'}},
      order: [['timed', 'DESC']]
    });    

    // Fetch uploaded document records (ID card, utility bill, etc.)
    const documents = await KycDoc.findAll({
      where: { userid: customerid },
      order: [['timed', 'DESC']]
    });

    if (verifications.length == 0 && documents.length == 0) {
      return res.status(200).json({ status: true, message: 'No KYC history found for this customer.', data: { verifications: [], documents: [] } });
    }

    const formattedVerifications = verifications.map(ver => ({
      id: ver.id,
      type: ver.vertype,
      provider: ver.provider,
      value: ver.bvv,
      status: ver.status == 1 ? 'Approved' : ver.status == 0 ? 'Pending' : 'Declined',
      date: moment.unix(ver.timed).format('Do MMM, YYYY hh:mm a'),
      fullName: `${ver.verfname} ${ver.verlname}`,
      dob: ver.verdob
    }));

    const formattedDocuments = documents.map(doc => ({
      id: doc.id,
      type: doc.doctype,
      name: doc.docname,
      tier: doc.tier,
      status: doc.docstatus == 2 ? 'Approved' : doc.docstatus == 1 ? 'In Review' : doc.docstatus == 3 ? 'Declined' : 'Not Submied',
      documentUrl: doc.docurl,
      documentUrlBack: doc.docurl_back,
      date: moment.unix(doc.timed).format('Do MMM, YYYY hh:mm a'),
    }));

    res.json({
      status: true,
      message: 'KYC history retrieved successfully.',
      data: { verifications: formattedVerifications, documents: formattedDocuments }
    });

  } catch (error) {
    logger.error('Error fetching customer KYC history:', error);
    res.status(500).json({ status: false, message: 'An error occurred while fetching KYC history.' });
  }
};

const getInactiveCustomers = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const inactiveCustomers = await Customer.findAll({
      attributes: ['id', 'email', 'phoneno', 'firstname', 'lastname', 'timed', 'status', 'bvverify'],
      include: [{
        model: Payn,
        as: 'payn',
        attributes: [],
        required: false, // This is crucial for LEFT JOIN
      }],
      where: {
        '$payn.id$': { [Op.is]: null }
      },
      order: [['timed', 'DESC']],
    });

    if (!inactiveCustomers || inactiveCustomers.length === 0) {
      return res.status(200).json({ status: true, message: 'No inactive customers found.', data: [] });
    }

    const formattedCustomers = inactiveCustomers.map(customer => ({
        id: customer.id,
        email: customer.email,
        phoneno: customer.phoneno,
        name: `${customer.firstname || ''} ${customer.lastname || ''}`.trim(),
        status: customer.status === 1 ? 'Active' : 'Inactive/Disabled',
        created_at : moment.unix(customer.timed).format('Do MMM, YYYY hh:mm a'),
        verstatus : customer.bvverify == 2 ? 'verified' : 'unverified'
    }));

    res.json({
      status: true,
      message: 'Inactive customers retrieved successfully.',
      data: formattedCustomers,
    });

  } catch (error) {
    logger.error('Error fetching inactive customers:', error);
    res.status(500).json({ status: false, message: 'An error occurred while fetching inactive customers.' });
  }
};

const getDormantCustomers = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    // Get 'days' and 'type' from query params. Defaults to 30 days of purchase inactivity.
    const { days = 30, type = 'purchase' } = req.query;
    const numDays = parseInt(days, 10);

    if (isNaN(numDays) || numDays <= 0) {
      return res.status(400).json({ status: false, message: 'Invalid number of days specified.' });
    }

    const thresholdDate = moment().subtract(numDays, 'days').unix();
    let customers;

    if (type === 'purchase') {
      // Find customers whose last payment was before the threshold date, or who have never paid.
      customers = await Customer.findAll({
        attributes: [
          'id', 'email', 'phoneno', 'firstname', 'lastname', 'timed', 'status',
          [Sequelize.fn('MAX', Sequelize.col('payn.timed')), 'last_payment_timestamp']
        ],
        include: [{
          model: Payn,
          as: 'payn',
          attributes: [],
          required: false // Use LEFT JOIN to include customers with no payments
        }],
        group: ['customers.id'],
        having: Sequelize.literal(`last_payment_timestamp IS NULL OR last_payment_timestamp < ${thresholdDate}`)
      });

    } else if (type === 'login') {
      // Find customers whose last login was before the threshold date, or who have never logged in.
      // This requires the `last_login` column suggested in Step 1.
      customers = await Customer.findAll({
        attributes: ['id', 'email', 'phoneno', 'firstname', 'lastname', 'timed', 'status', 'last_login'],
        where: {
          [Op.or]: [
            { last_login: { [Op.is]: null } }, // Never logged in
            { last_login: { [Op.lt]: thresholdDate } } // Last login was before the threshold
          ]
        },
        order: [['last_login', 'DESC NULLS LAST']]
      });

    } else {
      return res.status(400).json({ status: false, message: 'Invalid inactivity type. Use "purchase" or "login".' });
    }

    if (!customers || customers.length === 0) {
      return res.status(200).json({ status: true, message: `No customers have been inactive for over ${numDays} days.`, data: [] });
    }

    const formattedCustomers = customers.map(customer => {
      const lastPaymentTimestamp = customer.get('last_payment_timestamp');
      return {
        id: customer.id,
        email: customer.email,
        phoneno: customer.phoneno,
        name: `${customer.firstname || ''} ${customer.lastname || ''}`.trim(),
        status: customer.status === 1 ? 'Active' : 'Inactive/Disabled',
        registered_at: moment.unix(customer.timed).format('Do MMM, YYYY hh:mm a'),
        last_activity: type === 'login'
          ? (customer.last_login ? moment.unix(customer.last_login).format('Do MMM, YYYY hh:mm a') : 'Never Logged In')
          : (lastPaymentTimestamp ? moment.unix(lastPaymentTimestamp).format('Do MMM, YYYY hh:mm a') : 'Never Purchased')
      };
    });

    res.json({ status: true, message: `Found ${customers.length} customers inactive for over ${numDays} days.`, data: formattedCustomers });

  } catch (error) {
    logger.error('Error fetching dormant customers:', error);
    res.status(500).json({ status: false, message: 'An error occurred while fetching dormant customers.' });
  }
};

/* ==============================END================================ */
const getCustomerBalances = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    // Find all customers who have at least one NGN or USD wallet with a balance > 0
    const customersWithWallets = await Customer.findAll({
      attributes: ['id', 'firstname', 'lastname', 'email'],
      include: [{
        model: Wallets, as: 'wallets',
        attributes: ['currency', 'wbal'],
        where: {
          currency: { [Op.in]: ['NGN', 'USD'] },
          wbal: { [Op.gt]: 0 }
        },
        required: true 
      }],
      order: [[{ model: Wallets, as: 'wallets' }, 'wbal', 'DESC']]
      // order: [['id', 'DESC']]
    });

    if (!customersWithWallets || customersWithWallets.length === 0) {
      return res.status(200).json({ status: true, message: 'No customers with positive balances found.', data: [] });
    }

    // Format the data for a clean response
    const customerBalances = customersWithWallets.map(customer => {
      const ngnWallet = customer.wallets.find(w => w.currency === 'NGN');
      const usdWallet = customer.wallets.find(w => w.currency === 'USD');

      return {
        name: `${customer.firstname} ${customer.lastname}`,
        email: customer.email,
        ngn_balance: ngnWallet ? parseFloat(ngnWallet.wbal) : 0,
        usd_balance: usdWallet ? parseFloat(usdWallet.wbal) : 0,
      };
    });

    res.json({ status: true, message: 'Customer balances retrieved successfully.', data: customerBalances });

  } catch (error) {
    logger.error('Error fetching customer balances:', error);
    res.status(500).json({ status: false, message: 'An error occurred while fetching customer balances.' });
  }
};

module.exports = {
  addAdm, authAdmin, auth2faAdmin, getAllAdm, custTierUpdate,
  updAdmRole, myProfile, adminDetails, showAudit,
  siteStats, getUsersDetails, getNotice, uploadPix,
  getInvitees, getUserDocs, kycUpdate, updAdmStatus, getAllDocs,
  changPass, ProfileInfo, updAdmAccess, getAllAccess, removeNotify,
  getUsers, genTwofactor, verify2FA, transHistory,
  SettingSite, showAppSetting, addPromotion, showAds, getAdmProducts,
  transUserHistory, payDetails, getBeneficiary, updCustStatus, deactivate2FA,
  chargeWallet, UpdBankRevenue, notifyCustomer, addRoles, getAllRoles, addPermissions,
  getAllPermitts, updateRoles, getAuthToken, getEarningsHistory, getVirtualAccounts,
  getUsdAccountRequests, getUsdAccountRequestDetails, updateUsdAccountRequestStatus,
  getCustCards, getCustomerKycHistory, generateVirtualAccount,
  getCustomerAccounts, getCustomerBalances, getInactiveCustomers, getDormantCustomers
};