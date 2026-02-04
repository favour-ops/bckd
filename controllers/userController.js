const db = require('../models')
const jwt = require("jsonwebtoken");

const bcrypt = require('bcryptjs');
const md5 = require('md5');
const { json } = require('sequelize');
const saltRounds = 12;
const randomstring = require("randomstring");
const Sequelize = require('sequelize');
const https = require('https');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const { client: redisClient } = require('../config/redisClient'); // Import Redis client
const { ExtractJwt } = require('passport-jwt'); // Helper to extract token
const twoFactor = require('node-2fa');
const qrcode = require('qrcode');

//moment
const moment = require('moment-timezone');
require('moment-timezone/builds/moment-timezone-with-data');
moment.tz.setDefault('Africa/Lagos');
const axios = require('axios');
const { cleanMe, shAcessToken, genSHAccount, gen9PSBAccount, genProvidusAccount, validatePassword, FreeTransfersCount, TransLimit, giveWelcomeBonus, referralUplineDownlineBonus, checkinBonus, genSHBizAccount, processPendingInvitations, genGTBankAccount, genBizGTBAccount } = require("../config/myfunct");
const { compareNames } = require("../config/nameMatcher");

const Op = Sequelize.Op;
const Customer = db.customers;
const ResetPass = db.resetpass;
const rfToken = db.refreshtoken;
const Notify = db.notify;
const otpVer = db.verotp;
const KYC = db.kyc;
const Bank = db.bankacct;
const Wallets = db.wallets;
const DelAcct = db.delacct;
const KycDoc = db.kycdoc;
const AppSett = db.appsettings;
const CardUser = db.kadusers
const AcctRequest = db.accountrequest;
const AddrVer = db.addressverification;
const BizTeam = db.bizteam;
const Business = db.business;
const LoanApply = db.loanapply;


const { check } = require('express-validator');
const { genCode } = require("../config/getcode");
const { sendSMS, notifyMe, sendWhatsApp, pushNotify } = require("../config/notifyuser");
const { mailSender } = require("../config/mailsender");
const { cloudinary, firebaseUpload, AWSFileUpload } = require("../config/imageuploads");
const { getUserInfo, getBal } = require("../config/userdetails");
const path = require('path');
const { logger } = require('../config/logger');
const { group } = require('console');

async function generateReferralCode() {
    let refercode;
    let isUnique = false;

    while (!isUnique) {
        // Generate a random referral code
        refercode = randomstring.generate({
            length: 5,
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

const initAccount = async (req, res) => {
    //REGISTER FOR USER
    try {
        const { fname, lname, mname, countrycode, email, phone } = cleanMe(req.body);

        if (!countrycode || countrycode == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to select your country' });
        if (countrycode.length != 2) return res.status(400).json({ status: false, message: 'Oops! Invalid country code sent' });
        if (!email || email == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your email address' });
        if (!phone || phone == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your phone number' });

        const checkExistUser = await Customer.findOne({ where: { email } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (checkExistUser)
            return res.status(400).json({ status: false, message: 'Account already exist with email, kindly use another email address' });

        const checkExistPhone = await Customer.findOne({ where: { phoneno: phone } }).catch((err) => {
            console.log("Unable to process your request : " + err);
        });

        if (checkExistPhone) return res.status(400).json({
            status: false, message: 'Account already exist with phone number, kindly use another phone number'
        });

        let dtimed = Math.floor(Date.now() / 1000);
        /* Cancel any previous code for the phone number or email */
        await otpVer.update({ status: 5 }, { where: { [Op.or]: [{ regemail: email }, { regphone: phone }] } }).catch((err) => { console.log("Unable to process your request : " + err); });

        //SEND OTP            
        const tcode = genCode(6, 'numeric');
        const vertoken = jwt.sign({ regemail: email, regphn: phone }, process.env.JWT_SECRET, { expiresIn: '2h' });

        const logOTP = await otpVer.create({
            userid: '', otpcode: tcode, token: vertoken, timed: dtimed,
            usertype: 'user', otptype: 'regauth', status: 0, regphone: phone, regemail: email
        });

        var thecontent = `
             <div>
               <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1738019510/otpnote_fehcv4.png" alt="HitchPay">
                 <h1>Account Verification</h1>
                 <div class="" style="width: 110.59px; left: 243.24px; top: 412px; border-bottom: 3px solid #000000; margin: auto;"></div>
                 
                 <div class="greybg" style=" background: #F8F1FF; padding: 30px 20px;">
                     <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                         Hello <span style="font-size: 18px;">😍</span><br>
                         To complete your account setup, please use the following code for verification:<br>
                         <strong>OTP : ${tcode}</strong><br>
                         <strong>The code expires in 5 minutes</strong>
                     </p>
           
                     <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                 </div>
                 
             </div>
         `;

        // //console.log(sendMail)
        mailSender('', 'Account Verification', email, thecontent);

        //send sms
        // const msg = `Welcome to ${process.env.SITENAME}! Kindly use this OTP - ${tcode} to complete your account setup. Powered by HitchPay`
        // if (process.env.APPENV == 'production') {
        //     sendSMS(phone, msg);
        // }

        const currentTime = Date.now(); // Milliseconds
        const fiveMinutesInMs = process.env.OTP_EXPIRES * 1000;
        const expiryTime = currentTime + fiveMinutesInMs;
        res.status(201).json({
            status: true,
            message: 'Account Creation Successfully Initiated',
            data: {
                accessToken: vertoken,
                otpExpiryTimestamp: expiryTime
            }
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        // console.log("Create account Error: ", error.message);
    }
}


const verifyAccount = async (req, res) => {
    try {
        const { otpcode, vertoken } = cleanMe(req.body);

        if (!otpcode || otpcode == '')
            return res.status(400).json({ status: false, message: 'You forgot to enter your OTP' });

        if (!vertoken || vertoken == '')
            return res.status(400).json({ status: false, message: 'Invalid verification token' });

        jwt.verify(vertoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Verification Token' : err.message;
                return res.status(400).json({ status: false, message: message });
            }

            const verUserEmail = resulted.regemail;
            const verUserPhone = resulted.regphn;

            // Find the OTP record first, regardless of the code match
            const checkvtoken = await otpVer.findOne({
                where: {
                    regphone: verUserPhone,
                    token: vertoken,
                    otptype: 'regauth',
                    regemail: verUserEmail,
                    status: 0 // Only look for active OTPs
                }
            });

            if (!checkvtoken) {
                return res.status(400).json({
                    status: false,
                    message: `Invalid or expired verification session. Please request a new OTP.`,
                });
            }

            const storedTime = parseInt(checkvtoken.timed, 10);
            const currentTime = Math.floor(Date.now() / 1000); // Current UNIX timestamp
            const expiryTime = storedTime + parseInt(process.env.OTP_EXPIRES);

            if (currentTime > expiryTime) {
                await otpVer.update({ status: 3 }, { where: { id: checkvtoken.id } }); // Mark as expired by ID
                return res.status(400).json({ status: false, message: 'OTP has expired. Kindly initiate resend' });
            }

            if (checkvtoken.otpcode === otpcode) {
                // Correct OTP
                await otpVer.update({ status: 1 }, { where: { id: checkvtoken.id } }); // Mark as verified

                res.json({
                    status: true,
                    message: `Account Successfully Verified`,
                    data: {
                        authtoken: vertoken
                    }
                });

            } else {
                // Incorrect OTP
                const currentAttempts = (checkvtoken.attempts || 0) + 1;
                const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS || 3); // e.g., 3 attempts

                if (currentAttempts >= maxAttempts) {
                    // Max attempts reached, invalidate OTP
                    await otpVer.update({ status: 4, attempts: currentAttempts }, { where: { id: checkvtoken.id } }); // Mark as invalid due to attempts
                    return res.status(400).json({
                        status: false,
                        message: `Invalid OTP. Maximum attempts reached. Please request a new OTP.`,
                    });
                } else {
                    // Increment attempts
                    await otpVer.update({ attempts: currentAttempts }, { where: { id: checkvtoken.id } });
                    return res.status(400).json({
                        status: false,
                        message: `Invalid Verification OTP Code. ${maxAttempts - currentAttempts} attempts remaining.`,
                    });
                }
            }

        });


    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("verify account Error: ", error.message);
    }
}

const setUpAccount = async (req, res) => {
    try {
        /* COMPLETE ACCOUNT SETUP */
        const { pword, confirmpass, authtoken, countrycode, email, phone, referby, envv, countryname, dialcode, fname, lname, mname } = cleanMe(req.body);

        jwt.verify(authtoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Verification Session' : 'Registration session expired, Kindly restart your onboarding' ? 'Authentication Session Expired, Kindly restart registration process' : err.message;
                return res.status(400).json({
                    status: false,
                    message: message
                });
            }

            const verUserEmail = resulted.regemail;
            const verUserPhone = resulted.regphn;
            const checkvtoken = await otpVer.findOne({
                where: {
                    [Op.and]: [{ regphone: verUserPhone }, { token: authtoken }, { otptype: 'regauth' },
                    { regemail: verUserEmail }, { status: 1 }]
                }
            });


            if (!checkvtoken)
                return res.status(400).json({ status: false, message: 'Invalid authentication token detected. Kindly reload and start again' });


            if (!pword || pword == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your password!' });
            // if (pword.length < 8) return res.status(400).json({ status: false, message: 'Oops! Password must not be less than 8 characters!' });
            if (!confirmpass || confirmpass == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your confirmation password!' });
            if (pword != confirmpass) return res.status(400).json({ status: false, message: 'Oops! Confirmation Password does not match!' });
            if (!validatePassword(pword)) return res.status(400).json({ status: false, message: 'Password must be at least 8 chars. long, no space, contain a number, an alphabet, and a special character.' })
            if (!countrycode || countrycode == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to select your country' });
            if (countrycode.length != 2) return res.status(400).json({ status: false, message: 'Oops! Invalid country code sent' });
            if (!email || email == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your email address' });
            if (!phone || phone == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your phone number' });
            if (verUserPhone != phone) return res.status(400).json({ status: false, message: `Oops! You've just enter an unexpected phone number` });
            if (verUserEmail.toLowerCase() != email.toLowerCase()) return res.status(400).json({ status: false, message: `Oops! You've just enter an unexpected email address` });

            if (referby != '' && referby != null) {
                const checkrcode = await Customer.findOne({ where: { uname: referby } }).catch((err) => { console.log("Unable to process your request : " + err); });

                if (!checkrcode)
                    return res.status(400).json({ status: false, message: `Invalid referal code. Kindly leave empty if you don't have one` });
            }

            const checkExistUser = await Customer.findOne({ where: { email } }).catch((err) => { console.log("Unable to process your request : " + err); });

            if (checkExistUser)
                return res.status(400).json({ status: false, message: 'Account already exist with email, kindly restart your verification' });

            const checkExistPhone = await Customer.findOne({ where: { phoneno: phone } }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

            if (checkExistPhone) return res.status(400).json({
                status: false, message: 'Account already exist with phone number, kindly use another phone number'
            });

            const salt = bcrypt.genSaltSync(saltRounds);
            const hashed = bcrypt.hashSync(pword, salt);
            const accountstatus = 1;

            /* GENERATE REFER CODE */
            const refercode = await generateReferralCode();
            let dtimed = Math.floor(Date.now() / 1000);

            const creatUser = await Customer.create({
                firstname: fname, lastname: lname, middlename: mname, email, status: accountstatus, accesstoken: '', phoneno: phone, countrycode: countrycode, apptoken: '', authy: hashed, address: '', timed: dtimed, reglevel: 1, refcode: refercode, referby, dialcode: dialcode, countryname: countryname, env: envv
            });

            if (!creatUser)
                return res.status(400).json({ status: false, message: 'Unable to process your request, kindly retry' });

            var name = ``;
            const getmyID = await Customer.findOne({
                where: { email: email, phoneno: phone }
            });

            if (!getmyID)
                return res.status(400).json({ status: false, message: 'Request not fully processed, kindly retry' });

            if (countrycode == 'NG') {
                /* CREATE WALLET FOR HIM IN NGN */
                await Wallets.create({ uid: getmyID.id, email: getmyID.email, currency: 'NGN', wbal: 0, ledger: 0, timecreated: dtimed, lastupdated: dtimed, status: 1, usertype: 'personal' });
            } else {
                /* CREATE WALLET FOR HIM IN USD */
                await Wallets.create({ uid: getmyID.id, email: getmyID.email, currency: 'USD', wbal: 0, ledger: 0, timecreated: dtimed, lastupdated: dtimed, status: 1, usertype: 'personal' });
            }

            // Check for and process any pending business invitations for the new user.
            await processPendingInvitations(getmyID);

            //update verification tble with the new access token        
            await otpVer.update({ status: 2 }, {
                where: {
                    regemail: verUserEmail, otptype: 'regauth',
                    token: authtoken, regphone: verUserPhone
                }
            });

            // ================ACCESS TOKEN===========================
            //create token
            const acessexp = process.env.ACCESSTKTIME
            const jwtToken = jwt.sign({ id: getmyID.id, email: getmyID.email, jti: randomstring.generate(16) }, process.env.JWT_SECRET, { expiresIn: acessexp });

            //update tble
            const updatedb = await Customer.update({ accesstoken: jwtToken }, { where: { id: getmyID.id, email: getmyID.email } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });


            // ================REFRESH TOKEN=====================
            let rfshtktime = process.env.REFRESTKTIME;
            let jtiToken = randomstring.generate(16);
            const refreshTok = jwt.sign({
                id: getmyID.id, email: getmyID.email,
                jti: jtiToken
            }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });


            //log refresh token        
            let d = new Date();
            const expired_refresh = d.setMinutes(d.getMinutes() + rfshtktime);

            let dtimed2 = Math.floor(Date.now() / 1000);
            await rfToken.create({
                timed: dtimed2, userid: getmyID.id, accesstoken: refreshTok,
                expiredtime: expired_refresh, status: 1, usertype: 'user'
            }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            const emailcontent = `
            <div>
            <h1 style="font-weight: 800; font-size: 32px; line-height: 40px; text-align: center; color: #40196D; margin-top: 50px;">Welcome to HitchPay</h1>
            <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">Simplify Your Finances with Ease!</h3>
            <img style="margin: 20px 0;"
                src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="hitchpay">
            <div style=" background: #fff; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                <p style="line-height: 20px; letter-spacing: 0.025em;">
                    Hello ${!fname ? '' : fname} <span style="font-size: 18px;">😍</span></p>
                    <p style="line-height: 28px; letter-spacing: 0.025em;">
                    Welcome to <strong>HitchPay!</strong> We're excited to have you join our community. With HitchPay, managing your finances has never been easier. From bill payments to tracking transactions, we've got you covered.
                </p>

                <div>
                    <button type="button" style="max-width: 426px; height: 58px;background: #40196D; font-weight: 700; font-size: 20px; line-height: 30px; letter-spacing: 0.025em; color: #FFFFFF;padding: 0px 12px;">What Can HitchPay Do for You?</button>
                </div>

                <div>
                    <ol>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Effortless Bill Payments:</strong> <br> Say goodbye to late fees! With HitchPay, you can schedule and pay all your bills from one convenient platform. Never miss a due date again.</li>
                            <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Transaction Tracking:</strong> <br> Monitor your spending and keep track of all your transactions in real-time. HitchPay categorizes your expenses, giving you a clear view of where your money goes.
                        </li>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Smart Budgeting Tools:</strong><br>
                            Set financial goals and create budgets tailored to your lifestyle. HitchPay helps you stay on track and reach your savings goals faster.
                        </li>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Secure & Safe:</strong><br>
                            Your financial security is our top priority. We use the latest encryption technology to ensure your data is protected at all times.
                        </li>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Instant Notifications:</strong>
                            Stay informed with instant alerts on your transactions, bill due dates, and account activity. You’re always in control with HitchPay.
                        </li>
                    </ol>
                </div>

                <div>
                    <button type="button" style="max-width: 426px; height: 58px;background: #40196D; font-weight: 700; font-size: 20px; line-height: 30px; letter-spacing: 0.025em; color: #FFFFFF;padding: 0px 12px;">Get Started Today</button>
                </div>

                <div style="display: flex;">
                    <p style="width: 27px; height: 27px; background: #BA68C8; border-radius: 30px; color: #fff; align-items: center !important; justify-content: center !important; position: relative;display: flex
                    ;"></p> 
                    <p style="font-weight: 700; margin-left: 10px;"> Download the App</p>
                </div>

                <div style="display: flex;">
                    <p style="width: 29px; height: 27px; background: #BA68C8; border-radius: 30px; color: #fff; align-items: center !important; justify-content: center !important; position: relative;display: flex
                    ;"></p> 
                    <p style="margin: 10px;"><strong>Login:</strong> Access your account using your registered email and password.</p>
                </div>

                <div style="display: flex;">
                    <p style="width: 42px; height: 27px; background: #BA68C8; border-radius: 30px; color: #fff; align-items: center !important; justify-content: center !important; position: relative;display: flex
                    ;"></p> 
                    <p style="margin: 10px;"><strong>Explore Features:</strong> Take a tour of HitchPay and discover how we can help simplify your financial life.</p>
                </div>

                <p>Thank you for choosing HitchPay. Were excited to help you take control of your finances!</p>
                <p style="font-weight: 700;">Best regards, <br> The HitchPay Team</p>
            </div>
            </div>`;

            mailSender('', 'Welcome', getmyID.email, emailcontent);



            res.status(201).json({
                status: true,
                message: `Account Setup Successfully Completed`,
                data: {
                    accetoken: jwtToken,
                    authtoken: authtoken,
                }
            });


        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("setup pass Error: ", error.message);
    }
}


const loginUser = async (req, res) => {
    // console.log('realh', req)
    try {
        const { email, pword, authtype, device_token, device_type, device_name } = cleanMe(req.body);


        if (!pword || pword == '') {
            return res.status(400).json({ status: false, message: 'No Password entered!' });
        }

        if (!email || email == '') {
            return res.status(400).json({ status: false, message: 'Kindly enter your email address or phone number' });
        }

        const checkwithEmail = await Customer.findOne({ where: { [Op.or]: [{ email: email }, { phoneno: email }] } });

        if (!checkwithEmail)
            return res.status(400).json({ status: false, message: 'Email or Phone number does not match any record!' });

        if (authtype == 'pin') {
            const authpin = checkwithEmail.authpin;
            const checkwithHashPwd = bcrypt.compareSync(pword, authpin); // true

            if (!checkwithHashPwd)
                return res.status(400).json({ status: false, message: 'Invalid login credentials' });

        } else {
            const dpwd = checkwithEmail.authy;
            const checkwithHashPwd = bcrypt.compareSync(pword, dpwd); // true

            if (!checkwithHashPwd)
                return res.status(400).json({ status: false, message: 'Invalid login details' });
        }

        const acctStatus = checkwithEmail.status;

        if (acctStatus == 3)
            return res.status(400).json({ status: false, message: 'This account is temporarily on hold. Kindly contact or support' })

        if (acctStatus == 5)
            return res.status(400).json({ status: false, message: 'This account has been closed and is no longer operational' })

        if (acctStatus == 0)
            return res.status(400).json({ status: false, message: 'This account currently disabled. Kindly contact our support for futher assistance.' })

        if (acctStatus != 1)
            return res.status(400).json({ status: false, message: 'Account setup not completed' })

        // Check if the user is part of any business team
        let bizId = null;
        const teamMember = await BizTeam.findOne({ where: { customerid: checkwithEmail.id } });
        if (teamMember) {
            bizId = teamMember.bizid;
        }


        if (checkwithEmail.secretauth != '' && checkwithEmail.secretauth != null && authtype != 'pin') {

            const tcode = genCode(6, 'numeric');
            const vertoken = jwt.sign({ id: checkwithEmail.id, bizid: bizId, jti: randomstring.generate(16), email: checkwithEmail.email }, process.env.JWT_SECRET, { expiresIn: '2h' });

            await otpVer.create({
                userid: checkwithEmail.id, otpcode: tcode, token: vertoken,
                usertype: 'user', otptype: 'userauth', status: 0
            }).catch((err) => {
                console.log('Unable to process your request : ' + err);
                res.status(400).json({ status: false, message: 'Unable to process your request' });
            });

            // give checking bonus
            let checkResult = await checkinBonus(checkwithEmail.id);
            console.log('checkResult', checkResult)

            return res.json({
                status: true,
                message: `Welcome back ${checkwithEmail.firstname}!`,
                data: {
                    acctstatus: 1, accessToken: vertoken,
                    custemail: checkwithEmail.email,
                    reglevel: checkwithEmail.reglevel,
                    refreshToken: '', need2auth: true
                }
            });

        } else {
            // ================ACCESS TOKEN===========================
            const acessexp = process.env.ACCESSTKTIME
            //console.log(checkwithEmail.id)
            const jwtToken = jwt.sign({
                id: checkwithEmail.id,
                bizid: bizId,
                email: checkwithEmail.email,
                jti: randomstring.generate(16)
            }, process.env.JWT_SECRET, { expiresIn: acessexp });

            // NEW: Add last_login timestamp update
            const lastLoginTimestamp = Math.floor(Date.now() / 1000);

            await Customer.update({
                accesstoken: jwtToken, apptoken: device_token, devicename: device_name, devicetype: device_type,
                apptoken: device_token,
                devicename: device_name,
                devicetype: device_type,
                last_login: lastLoginTimestamp
            }, {
                where: { id: checkwithEmail.id, email: checkwithEmail.email }
            }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            // ================REFRESH TOKEN===========================    
            let rfshtktime = process.env.REFRESTKTIME;
            let jtiToken = randomstring.generate(16);
            const refreshTok = jwt.sign({ id: checkwithEmail.id, email: checkwithEmail.email, jti: jtiToken }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });
            //log refresh token        
            let d = new Date();
            const expired_refresh = d.setMinutes(d.getMinutes() + rfshtktime);

            //clear previous tokenlog
            await rfToken.update({ status: 0 }, { where: { userid: checkwithEmail.id } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            //log new token
            let dtimed = Math.floor(Date.now() / 1000);
            const creatUser = await rfToken.create({
                timed: dtimed, userid: checkwithEmail.id, accesstoken: refreshTok, expiredtime: expired_refresh, status: 1, jti: jtiToken
            }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            var thesmg = `Welcome Back! You've just logged in to your HitchPay account using ${device_name} - ${device_type}.`;
            pushNotify(checkwithEmail.id, 'Login Notice - HitchPay', thesmg)

            // console.log('Controller attempting to send JSON response for path:', req.path); // <-- Add this

            // give checking bonus
            let checkResult = await checkinBonus(checkwithEmail.id);
            console.log('checkResult', checkResult)

            res.json({
                status: true,
                message: `Welcome back ${checkwithEmail.firstname}!`,
                data: {
                    acctstatus: 1,
                    accessToken: jwtToken,
                    custemail: checkwithEmail.email,
                    reglevel: checkwithEmail.reglevel,
                    refreshToken: refreshTok,
                    need2auth: false
                }
            });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("login account Error: ", error.message);
    }
}


const auth2faUser = async (req, res) => {
    const { authcode, authtoken, device_token, device_type, device_name } = cleanMe(req.body);

    if ((!authcode) || (authcode == ''))
        return res.status(400).json({ status: false, message: 'No 2FA code entered!' });

    if ((!authtoken) || (authtoken == ''))
        return res.status(400).json({ status: false, message: 'Invalid Authentication Token. Kindly login again' });

    const checkvtoken = await otpVer.findOne({ where: { [Op.and]: [{ token: authtoken }, { otptype: 'userauth' }, { status: 0 }] } });

    if (!checkvtoken)
        return res.status(400).json({ status: false, message: 'Token Expired! Unable to process request, kindly initiate a new login' });

    var ownerid = checkvtoken.userid;
    const userinfo = await getUserInfo(ownerid);
    const useremail = userinfo.email;
    const admphoneno = userinfo.phoneno;
    const username = userinfo.fname;
    const hisrole = userinfo.role;

    /* CHECK 2FA */
    if ((userinfo.secretauth == null || userinfo.secretauth == '')) {
        var eligible = false;
    } else if (userinfo.secretauth == null) {
        var eligible = false;
    } else {

        const result = twoFactor.verifyToken(userinfo.secretauth, authcode);
        // console.log(result)
        // console.log('checkvtoken.secretauth', userinfo.secretauth)

        if (result) {
            if (result.delta === null || result.delta < 0) {
                var eligible = false;
            } else {
                var eligible = true;
            }
        } else {
            var eligible = false;
        }
    }


    if (eligible) {
        // ================ACCESS TOKEN===========================
        const acessexp = process.env.ACCESSTKTIME
        //console.log(userinfo.id)
        const jwtToken = jwt.sign({
            id: userinfo.id,
            email: userinfo.email,
            jti: randomstring.generate(16)
        }, process.env.JWT_SECRET, { expiresIn: acessexp });

        await Customer.update({
            accesstoken: jwtToken, apptoken: device_token, devicename: device_name, devicetype: device_type
        }, {
            where: { id: userinfo.id, email: userinfo.email }
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });

        // ================REFRESH TOKEN===========================
        let rfshtktime = process.env.REFRESTKTIME;
        let jtiToken = randomstring.generate(16);

        const refreshTok = jwt.sign({ id: userinfo.id, email: userinfo.email, jti: jtiToken }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });
        //log refresh token        
        let d = new Date();
        const expired_refresh = d.setMinutes(d.getMinutes() + rfshtktime);

        //clear previous tokenlog
        await rfToken.update({ status: 0 }, { where: { userid: userinfo.id } }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });


        //log new token
        let dtimed = Math.floor(Date.now() / 1000);
        const creatUser = await rfToken.create({
            timed: dtimed, userid: userinfo.id, accesstoken: refreshTok, expiredtime: expired_refresh, status: 1, jti: jtiToken
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });


        var thesmg = `Welcome Back! You've just logged in to your HitchPay account using ${device_name} - ${device_type}.`;
        pushNotify(userinfo.id, 'Login Notice - HitchPay', thesmg)

        await otpVer.update({ status: 1 }, { where: { userid: ownerid, token: authtoken, usertype: 'user', otptype: 'userauth' } });

        res.json({
            status: true,
            message: `Welcome back ${userinfo.firstname}!`,
            data: {
                acctstatus: 1,
                accessToken: jwtToken,
                custemail: userinfo.email,
                reglevel: userinfo.reglevel,
                refreshToken: refreshTok,
                need2auth: false
            }
        });

        // res.json({
        // status: true,
        // message: `Account Successfully Authenticated`,
        // data: {
        //     accessToken: jwtToken,
        //     refreshToken: refreshTok,
        //     needauth, passupd
        // }
        // });

    } else {
        res.status(400).json({ status: false, message: 'Please check your code and try again' });
    }

}


const getAuthToken = async (req, res) => {
    if (!req.headers['authorization'])
        return res.status(400).json({ status: false, message: 'Unauthorized' });

    try {

        const authHeader = req.headers['authorization']
        const bearerToken = authHeader.split(' ')
        const sentToken = bearerToken[1];

        jwt.verify(sentToken, process.env.JWT_REFRESH, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized' : err.message;
                return res.status(400).json({ status: false, message: message });
            }

            const tknid = resulted.id;
            const tkn_email = resulted.email;

            //check the db
            const checktoken = rfToken.findOne({ where: { accesstoken: sentToken, userid: tknid } }).catch((err) => { console.log("Unable to process your request : " + err); });

            // Check if the user is part of any business team
            let bizId = null;
            const teamMember = await BizTeam.findOne({ where: { customerid: tknid } });
            if (teamMember) {
                bizId = teamMember.bizid;
            }

            //create a new access token        
            const jwtToken = jwt.sign({ id: tknid, email: tkn_email, bizid: bizId, jti: randomstring.generate(16) }, process.env.JWT_SECRET, { expiresIn: process.env.ACCESSTKTIME });

            //update customer tble with the new access token
            const updatedb = Customer.update({ accesstoken: jwtToken }, { where: { id: tknid, email: tkn_email } });

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
        console.log('Unable to process your request  authtoekn:' + error.message)
    }
}


const userInfo = async (req, res) => {
    try {
        const tokenid = req.user.id;
        if (!tokenid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getuser = await Customer.findOne({ where: { id: tokenid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!getuser)
            return res.status(400).json({ status: false, message: 'Details not found' });

        var notification = await Notify.count({
            where: { usertype: { [Op.not]: 'admin' }, [Op.and]: [{ uid: tokenid }, { status: 1 }] }
        });

        const getcarduser = await CardUser.findOne({ where: { userid: tokenid } });
        if (getcarduser) {
            var cardacct = true;
        } else {
            var cardacct = false;
        }

        // USD ACCOUNT REQUEST
        let usdacctstatus; let requestid;
        const getusact = await AcctRequest.findOne({ where: { userid: tokenid } });
        if (!getusact || getusact.length == 0) {
            usdacctstatus = 'norequest';
        } else {
            if (getusact.status == 1 || getusact.status == 0) {
                usdacctstatus = 'pending';
            } else if (getusact.status == 2) {
                usdacctstatus = 'approved';
            } else if (getusact.status == 3) {
                usdacctstatus = 'declined';
            } else if (getusact.status == 4) {
                usdacctstatus = 'provisioned';
            } else {
                usdacctstatus = 'norequest';
            }
            requestid = getusact.reference;
        }

        var myrefer = 0;

        /*================ check if he has wallet ==========================*/
        const getbal = await Wallets.findOne({ where: { uid: tokenid, currency: 'NGN' } })
        if (!getbal || getbal.length == 0) {
            /* CREATE WALLET FOR HIM IN NGN */
            let dtimed = Math.floor(Date.now() / 1000);
            await Wallets.create({ uid: tokenid, email: getuser.email, currency: 'NGN', wbal: 0, usertype: 'personal', ledger: 0, timecreated: dtimed, lastupdated: dtimed, status: 1 }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });
        }

        //get is transfer limit
        var histier = getuser.accounttier == null ? 0 : getuser.accounttier;
        const freetransfer_used = await FreeTransfersCount(tokenid);
        const accountLimit = await TransLimit(histier);
        var free_transfer = accountLimit[4];
        const freetransfer = parseInt(free_transfer) - parseInt(freetransfer_used); //remaining free transfer

        // get customer all unpaid loan with status 1 group by loantype to show each total amount, paid
        const unPaidLoans = await LoanApply.findAll({
            attributes: [
                'currency', 'loantype',
                [Sequelize.fn('SUM', Sequelize.col('totalpayback')), 'totalAmount'],
                [Sequelize.fn('SUM', Sequelize.col('totalpaid')), 'totalPaid']
            ],
            where: {
                userid: tokenid,
                status: 1
            }
        });

        // console.log('unPaidLoans', unPaidLoans)

        // format it
        const formattedLoans = unPaidLoans.map(loan => ({
            totalAmount: loan.getDataValue('totalAmount') || 0,
            totalPaid: loan.getDataValue('totalPaid') || 0,
            totalPaid: loan.getDataValue('totalPaid') || 0,
            currency: loan.getDataValue('currency'),
            balance: (loan.getDataValue('totalAmount') || 0) - (loan.getDataValue('totalPaid') || 0)
        }))[0];


        res.json({
            status: true,
            message: 'User Details retrieved',
            data: {
                userid: getuser.id,
                name: getuser.firstname + ' ' + getuser.lastname,
                fname: getuser.firstname,
                lname: getuser.lastname,
                customer_email: getuser.email,
                customer_phone: getuser.phoneno,
                dob: getuser.dateofbirth,
                refercode: getuser.refcode,
                referby: getuser.referby,
                countryname: getuser.countryname,
                dialcode: getuser.dialcode,
                countrycode: getuser.countrycode,
                has2fa: getuser.secretauth == null ? false : true,
                invitedfriends: 0,
                accountstatus: getuser.status,
                accountstatus_text: getuser.status == 1 ? 'active' : getuser.status == 3 ? 'onhold' : getuser.status == 0 ? 'disabled' : '',
                reglevel: getuser.reglevel,
                regleveltext: getuser.reglevel == 0 ? 'Ongoing' : getuser.reglevel == 1 ? 'Onboarded' : getuser.reglevel == 2 ? 'KYC' : '',
                transauth: getuser.authpin,
                created_at: moment.unix(getuser.timed).local().format("Do MMM, YYYY hh:mm a"),
                verstatus: getuser.isverified == 1 ? 'verified' : 'unverified',
                isverified: getuser.isverified,
                profileimg: getuser.photo == null ? '' : getuser.photo,
                bvstatus: getuser.bvverify,  //0, 1, 2, 3
                bvstage: getuser.bvverify == 1 ? 'needotp' : getuser.bvverify == 2 ? 'verified' : 'unverified',
                activefriends: 0,
                custadr: getuser.address,
                custcity: getuser.city,
                custstate: getuser.state,
                username: getuser.uname,
                maritalstatus: getuser.maritalstatus,
                nextofkin_phone: getuser.nextofkin_phone,
                nextofkin_name: getuser.nextofkin_name,
                nextkin_relationship: getuser.nextkin_relationship,
                account_tier: getuser.accounttier == null ? 0 : getuser.accounttier,
                notificationcount: notification,
                freetransfer: freetransfer > 0 ? freetransfer : 0,
                cardacct: cardacct,
                usdacctstatus: usdacctstatus,
                usacctreqid: requestid,
                myrefer: myrefer,
                banklist: [
                    { title: 'SafeHaven Microfinance Bank', value: "safehaven" },
                    { title: 'GT Bank', value: "gtbank" },
                    // {title: '9 Payment Service Bank', value: "9psb"},
                ],
                loan: {
                    total_loan: Number(formattedLoans?.totalAmount).toFixed(2) || 0,
                    paid: Number(formattedLoans?.totalPaid).toFixed(2) || 0,
                    loan_balance: Number(formattedLoans?.balance).toFixed(2) || 0,
                    currency: formattedLoans?.currency || 'NGN'
                }
            },

        });
    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("user info Error: ", error.message);
    }
}


const setupPIN = async (req, res) => {
    try {
        const hisid = req.user.id;
        const { otpcode, bizid } = cleanMe(req.body);

        if (!hisid)
            return res.status(400).json({ status: false, message: 'Invalid request sent!' });
        if (!otpcode || otpcode == '') return res.status(400).json({ status: false, message: 'You forgot to enter your new transaction PIN!' });
        if (otpcode.length != '4') return res.status(400).json({ status: false, message: 'Transaction PIN should be 4 digit number' });

        const checkUser = await Customer.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!checkUser)
            return res.status(400).json({ status: false, message: 'Unable to process your request, kindly refresh and try again' });

        if (checkUser.authpin != '' && checkUser.authpin != null)
            return res.status(400).json({ status: false, message: 'PIN already setup, kindly use the reset PIN to update instead' });

        //register pin
        const salt = bcrypt.genSaltSync(saltRounds);
        const hashedpin = bcrypt.hashSync(otpcode, salt);

        const changeit = await Customer.update({ authpin: hashedpin },
            { where: { id: hisid, email: checkUser.email } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

        if (!changeit)
            return res.status(400).json({ status: false, message: "Ouch! Unable to process your PIN setup, kindly retry again" });

        res.status(201).json({
            status: true, message: 'PIN Code Setup Successfully.'
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("setup pin Error: ", error.message);
    }
}


const getNotification = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        const getnotification = await Notify.findAll({
            order: [['id', 'DESC']], where: { uid: userid, usertype: 'user' }
        }).catch((err) => {
            console.log("Unable to process your request : " + err);
        });

        if (!getnotification || getnotification.length < 1)
            return res.status(200).json({ status: false, message: 'Notification not found' });

        const noteList = getnotification.map((item) => ({
            notetype: item.notetype,
            content: item.notecontent,
            dated: moment.utc(item.dated).local().format("DD/MM/YYYY"),
        }));

        /* update as viewed */
        await Notify.update({ status: 0 }, { where: { uid: userid } });

        res.json({
            status: true,
            message: 'Notification Retrieved',
            data: noteList
        });

    } catch (error) {
        console.log("notification Error: ", error.message);
        res.status(400).json({ status: false, message: 'Someting went wrong! Unable to process your request at the moment, kindly retry shortly' });
    }
}

const updateProfile = async (req, res) => {
    const tokenid = req.user.id;
    const { fname, lname, address, maritalstatus, nextofkin_phone, nextofkin_name, city, state, nextkin_relationship } = cleanMe(req.body);

    if (!fname || fname == '') return res.status(400).json({ status: false, message: 'Oops! Firstname is required' });
    if (!lname || lname == '') return res.status(400).json({ status: false, message: 'Oops! Lastname is required' });
    if (!address || address == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to specify your residential address' });
    if (address.length < 10) return res.status(400).json({ status: false, message: 'Oops! Residential address should be more descriptive' });

    const checkUser = await Customer.findOne({ where: { id: tokenid } }).catch((err) => { console.log("Unable to process your request : " + err); });

    if (!checkUser) {
        return res.status(400).json({ status: false, message: 'Acount not logged in' });
    }

    if (checkUser.bvverify == 2) {
        //update the record without name 
        var updatedb = await Customer.update({ maritalstatus: maritalstatus, address, nextofkin_phone, nextofkin_name, city, state, nextkin_relationship },
            { where: { id: tokenid } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });
    } else {
        //update the record with name since no bvn completed
        var updatedb = await Customer.update({
            firstname: fname, lastname: lname, nextofkin_phone, nextofkin_name, maritalstatus: maritalstatus, address, city, state, nextkin_relationship
        },
            { where: { id: tokenid } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });
    }

    if (!updatedb)
        return res.status(400).json({ status: false, message: 'Unable to process your request, try again' });

    res.json({
        status: true,
        message: 'Profile Details Successfully Updated!'
    });
}

const updatePin = async (req, res) => {
    try {
        const hisid = req.user.id;
        const { currentpin, newpin, confirmpin } = cleanMe(req.body);

        if (!hisid) return res.status(400).json({ status: false, message: 'Invalid request sent!' });

        if (!currentpin || currentpin == '') return res.status(400).json({ status: false, message: 'You forgot to specify your current PIN!' });
        if (!newpin || newpin == '') return res.status(400).json({ status: false, message: 'You forgot to enter your new PIN!' });
        if (!confirmpin || confirmpin == '') return res.status(400).json({ status: false, message: 'Confirmation PIN not specified!' });
        if (newpin != confirmpin) return res.status(400).json({ status: false, message: 'New PIN and confirmation PIN do not match!' });

        const checkUser = await Customer.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!checkUser)
            return res.status(400).json({ status: false, message: 'Unable to process your request, kindly refresh and try again' });

        const dpwd = checkUser.authpin;
        const checkwithHashPwd = bcrypt.compareSync(currentpin, dpwd); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Your entered current PIN is incorrect' });

        // you cannot use 
        const validatedpwd = checkUser.authpin;
        const checthecur = bcrypt.compareSync(newpin, validatedpwd); // true

        if (checthecur)
            return res.status(400).json({ status: false, message: 'You cannot use your current PIN' });

        //register pin
        const salt = bcrypt.genSaltSync(saltRounds);
        const hashedpin = bcrypt.hashSync(newpin, salt);

        const changeit = await Customer.update({ authpin: hashedpin },
            { where: { id: hisid, email: checkUser.email } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

        if (!changeit)
            return res.status(400).json({ status: false, message: "Ouch! Unable to process your PIN update, kindly retry again" });

        res.status(200).json({
            status: true, message: 'Great! PIN successfully updated.'
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("change PIN Error: ", error.message);
    }
}

const resetPIN = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        /* CHECK FOR EXISTENCE */
        const checkwithUser = await Customer.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });
        if (!checkwithUser)
            return res.status(400).json({ status: false, message: 'Invalid request, kindly reload the page' });

        //SEND OTP            
        const tcode = genCode(6, 'numeric');
        const vertoken = jwt.sign({ id: hisid }, process.env.JWT_SECRET, { expiresIn: '24h' });

        const logOTP = await otpVer.create({
            userid: hisid, otpcode: tcode, token: vertoken,
            usertype: 'user', otptype: 'pinreset', status: 0
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
            res.status(400).json({ status: false, message: 'Unable to process your request' });
        });

        const hismail = checkwithUser.email;
        const fname = checkwithUser.firstname;
        const phoneno = checkwithUser.phoneno;

        let dtimed = Math.floor(Date.now() / 1000);

        // send mail 
        var content = `
        <div>
        <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1738019510/otpnote_fehcv4.png" alt="HitchPay">
            <h1>PIN Reset</h1>
            <div class="" style="width: 110.59px; left: 243.24px; top: 412px; border-bottom: 3px solid #000000; margin: auto;"></div>
            <p>Your ${tcode.length}-digit code is:</p>
            <div style=" margin: 15px 0; font-style: normal; font-weight: 800; font-size: 32px; line-height: 40px; color: #000000;">${tcode}</div>
            
            <div class="greybg" style=" background: #F8F1FF; padding: 30px 20px;">
                <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                    Hello <span style="font-size: 18px;">😍</span><br>
                    To complete your PIN reset, please use the above code for verification:<br>
                    <strong>The code expires in 5 minutes</strong>
                </p>
    
                <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
            </div>
        </div>
    `;

        mailSender(fname, 'Transaction PIN Recovery', hismail, content);

        //send sms
        const msg = `Dear ${fname}, Kindly use this OTP - ${tcode} to reset your account on ${process.env.SITENAME}. Powered by HitchPay`
        sendSMS(phoneno, msg);

        res.status(200).json({
            status: true,
            message: 'We\'ve just sent a recovery code to your phone number and email',
            data: {
                token: vertoken
            }
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("reset pin forgot: ", error.message);
    }
}


const verifyPinRecover = async (req, res) => {
    try {
        const { otpcode, resettoken } = cleanMe(req.body);
        if (!otpcode || otpcode == '') return res.status(400).json({ status: false, message: 'Oops! OTP not entered!' });
        if (!resettoken || resettoken == '') return res.status(400).json({ status: false, message: 'Oops! Invalid Reset Token!' });

        jwt.verify(resettoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Reset Token' : 'Token expired. Kindly initiate new PIN reset';
                return res.status(400).json({ status: false, message: message });
            }

            const tknid = resulted.id;

            const checkdToken = await otpVer.findOne({
                where: { userid: tknid, status: 0, token: resettoken, otptype: 'pinreset' }
            }).catch((err) => {
                console.log("Unable to process your request : " + err);
                return res.status(400).json({ status: false, message: 'Invalid reset token' });
            });

            if (!checkdToken) {
                return res.status(400).json({ status: false, message: 'Invalid reset otp detected' });
            }

            // Check expiry FIRST
            const storedTime = parseInt(checkdToken.timed, 10);
            const currentTime = Math.floor(Date.now() / 1000);
            const expiryTime = storedTime + parseInt(process.env.OTP_EXPIRES || 300); // Default 5 mins

            if (currentTime > expiryTime) {
                await otpVer.update({ status: 3 }, { where: { id: checkdToken.id } }); // Mark as expired by ID
                return res.status(400).json({ status: false, message: 'OTP has expired. Kindly initiate resend' });
            }

            if (checkdToken.otpcode === otpcode) {
                // Correct OTP
                await otpVer.update({ status: 1 }, { where: { id: checkdToken.id } });

                res.json({
                    status: true,
                    message: 'PIN Recovery OTP Verified',
                    data: {
                        token: resettoken
                    }
                });

            } else {
                // Incorrect OTP
                const currentAttempts = (checkdToken.attempts || 0) + 1;
                const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS || 3); // e.g., 3 attempts

                if (currentAttempts >= maxAttempts) {
                    // Max attempts reached, invalidate OTP
                    await otpVer.update({ status: 4, attempts: currentAttempts }, { where: { id: checkdToken.id } });

                    return res.status(400).json({
                        status: false,
                        message: `Invalid OTP. Maximum attempts reached. Please request a new OTP.`,
                    });

                } else {

                    // Increment attempts
                    await otpVer.update({ attempts: currentAttempts }, { where: { id: checkdToken.id } });
                    return res.status(400).json({
                        status: false,
                        message: `Invalid Verification OTP Code. ${maxAttempts - currentAttempts} attempts remaining.`,
                    });
                }

            }

        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("pass otp Error: ", error.message);
    }
}


const RecoverPIN = async (req, res) => {
    try {
        const hisid = req.user.id;
        const { newpin, confirmpin, resettoken } = cleanMe(req.body);

        if (!hisid) return res.status(400).json({ status: false, message: 'Invalid request sent!' });
        if (!newpin || newpin == '') return res.status(400).json({ status: false, message: 'You forgot to enter your new PIN!' });
        if (!confirmpin || confirmpin == '') return res.status(400).json({ status: false, message: 'Confirmation PIN not specified!' });
        if (newpin != confirmpin) return res.status(400).json({ status: false, message: 'New PIN and Confirmation PIN do not match!' });
        if (newpin.length != 4) return res.status(400).json({ status: false, message: 'Invalid New OTP Length' });


        const checkvtoken = await otpVer.findOne({
            where: {
                [Op.and]: [{ userid: hisid }, { otptype: 'pinreset' }, { token: resettoken }]
            }
        });

        if (!checkvtoken) {
            return res.status(400).json({ status: false, message: 'Invalid OTP or Expired Token' });
        }

        //register pin
        const salt = bcrypt.genSaltSync(saltRounds);
        const hashedpin = bcrypt.hashSync(newpin, salt);

        const changeit = await Customer.update({ authpin: hashedpin },
            { where: { id: hisid } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

        if (!changeit)
            return res.status(400).json({ status: false, message: "Ouch! Unable to process your PIN reset, kindly retry again" });

        res.status(200).json({
            status: true, message: 'Great! PIN successfully updated.'
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("recover PIN Error: ", error.message);
    }
}


const updatePass = async (req, res) => {

    try {
        const hisid = req.user.id;
        const { oldpass, newpass, confirmpass } = cleanMe(req.body);

        if (!hisid)
            return res.status(400).json({ status: false, message: 'Invalid request sent!' });
        if (!oldpass || oldpass == '') return res.status(400).json({ status: false, message: 'You forgot to specify your current password!' });
        if (!newpass || newpass == '') return res.status(400).json({ status: false, message: 'You forgot to enter your new password!' });
        if (!confirmpass || confirmpass == '') return res.status(400).json({ status: false, message: 'Confirmation password not specified!' });
        if (newpass != confirmpass) return res.status(400).json({ status: false, message: 'New password and confirmation password do not match!' });

        const checkUser = await Customer.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!checkUser)
            return res.status(400).json({ status: false, message: 'Unable to process your request, kindly refresh and try again' });

        const dpwd = checkUser.authy;
        const checkwithHashPwd = bcrypt.compareSync(oldpass, dpwd); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Your entered current password is incorrect' });

        //register new pass
        const salt = bcrypt.genSaltSync(saltRounds);
        const hash = bcrypt.hashSync(newpass, salt);

        const changeit = await Customer.update({ authy: hash }, { where: { id: hisid, email: checkUser.email } }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });

        if (!changeit)
            return res.status(400).json({ status: false, message: "Ouch! Unable to process your password update, kindly retry again" });

        res.status(200).json({
            status: true, message: 'Great! Password successfully updated.'
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("change password Error: ", error.message);
    }
}

const uploadPix = async (req, res) => {
    try {
        const pixfile = req.file;
        const tknid = req.user.id;

        // console.log('pixfile', pixfile)

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
                // console.warn(`Upload blocked post-multer: Detected content type (${fileTypeResult?.mime || 'unknown'}) is invalid for profile picture. User: ${tknid}.`);
                return res.status(400).json({ status: false, message: "Invalid file content detected. Only images allowed." });
            }

            const originalExtension = pixfile.originalname.split('.').pop()?.toLowerCase();
            if (originalExtension !== fileTypeResult.ext) {
                console.warn(`Warning: File extension mismatch post-multer for profile picture. User: ${tknid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
            }

        } catch (fileTypeError) {
            console.error("Error during file type check in controller:", fileTypeError);
            return res.status(500).json({ status: false, message: "Error verifying file content." });
        }

        const userinfo = await getUserInfo(tknid);
        if (!userinfo) {
            return res.status(400).json({ status: false, message: 'User not found.' });
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
            const randomFileName = `userpix_${tknid}_${uuidv4()}`;

            cloudinary.uploader.upload_stream(
                { public_id: randomFileName, resource_type: "image" }, async (error, result) => {
                    if (error) {
                        console.error("Cloud upload error:", error);
                        // Handle error without sending response yet if inside callback
                        thefile = ''; // Mark as failed
                    } else {
                        thefile = result.secure_url;
                        // Now update the database *after* successful upload

                        // Update database
                        try {
                            const updateResult = await Customer.update({ photo: thefile }, { where: { id: tknid } });
                            if (!updateResult || updateResult[0] === 0) { // Check if update affected any rows
                                console.error("Failed to update profile picture in DB for user:", tknid);
                                // Consider deleting from Cloudinary if DB update fails
                                return res.status(500).json({ status: false, message: 'Upload complete but failed to save link.' });
                            }
                            return res.json({
                                status: true,
                                message: 'Profile Image Successfully Updated!'
                            });
                        } catch (dbError) {
                            console.error("DB update error after Cloud upload:", dbError);
                            // Consider deleting from Cloudinary
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

const viewNotify = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        await Notify.update({ status: 0 }, { where: { uid: hisid } });

        res.json({
            status: true,
            message: 'Notification history viewed'
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("upd notif view Error: ", error.message);
    }
}


const removeNotify = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const deleteit = await Notify.destroy({ where: { uid: hisid, usertype: 'user' } });

        if (!deleteit)
            return res.status(400).json({ status: false, message: 'Unable to process request. Reload and try again' });

        res.json({
            status: true,
            message: 'Notification history deleted'
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("upd notif del Error: ", error.message);
    }
}

const resetPass = async (req, res) => {
    try {
        const { resetpinput, passtype } = cleanMe(req.body);

        if (!resetpinput || resetpinput == '')
            return res.status(400).json({ status: false, message: 'Kindly enter your email or phone number' });

        if (!passtype || passtype == '')
            return res.status(400).json({ status: false, message: 'Password recovery type not selected' });

        if (passtype != 'email' && passtype != 'phone')
            return res.status(400).json({ status: false, message: 'Invalid password type entered' });

        if (passtype == 'email') {
            var checkwithUser = await Customer.findOne({
                where: {
                    email: resetpinput
                }
            }).catch((err) => { console.log("Unable to process your request : " + err); });
        } else {
            var checkwithUser = await Customer.findOne({
                where: {
                    phoneno: resetpinput
                }
            }).catch((err) => { console.log("Unable to process your request : " + err); });
        }

        if (!checkwithUser)
            return res.status(400).json({ status: false, message: `You will receive a recovery OTP on your ${passtype} shortly if account exist` });

        const hismail = checkwithUser.email;
        const fname = checkwithUser.firstname;
        const phoneno = checkwithUser.phoneno;

        let timed = new Date();
        const tcode = genCode(6, 'numeric');

        const jwtToken = jwt.sign({ id: checkwithUser.id }, process.env.JWT_SECRET, { expiresIn: '5h' });

        let dtimed = Math.floor(Date.now() / 1000);

        const logToken = await ResetPass.create({
            userid: checkwithUser.id, timed: dtimed, usertype: 'user',
            token: tcode, status: 0, authtoken: jwtToken
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
            res.status(400).json({ status: false, message: 'Unable to process your password reset request' });
        });


        await otpVer.create({
            userid: checkwithUser.id, otpcode: tcode, token: jwtToken,
            usertype: 'user', otptype: 'passauth', status: 0
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
            res.status(400).json({ status: false, message: 'Unable to process your request' });
        });

        if (passtype == 'email') {
            // send mail 
            var content = `
            <div>
              <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/resetpass_uiq9wk.png" alt="hitchpay">
                <div class="" style="width: 110.59px; left: 243.24px; top: 412px; border-bottom: 3px solid #000000; margin: auto;"></div>
                
                <div class="greybg" style=" background: #F8F1FF; padding: 30px 20px;">
                    <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                        Hello ${fname} <span style="font-size: 18px;">😍</span><br>
                        To reset your password, please use the following code for verification:<br>
                        <strong>OTP : ${tcode}</strong><br>
                        <strong>The code expires in 5 minutes</strong>
                    </p>
          
                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                </div>
                
            </div>
        `;
            mailSender(fname, 'Password Reset', hismail, content);

        } else if (passtype == 'phone') {
            //send sms
            const msg = `Dear ${fname}, Kindly use this OTP - ${tcode} to reset your account pass on ${process.env.SITENAME}. Powered by Hitchpay`
            sendSMS(phoneno, msg);
        } else { }


        if (logToken)
            res.status(200).json({
                status: true,
                message: `You will receive a recovery OTP on your ${passtype} shortly if account exist`,
                data: { token: jwtToken }
            });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("verify pass forgot: ", error.message);
    }
}

const getFriends = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        const userinfo = await getUserInfo(userid);  // get user info
        const myrefcode = userinfo.uname ? userinfo.uname : userinfo.refcode;

        const getit = await Customer.findAll({
            order: [['id', 'DESC']], where: { referby: myrefcode }
        });

        var activeFriend = await Customer.count({
            where: { referby: myrefcode, bvverify: 2 }
        });

        var totalFriend = await Customer.count({
            where: { referby: myrefcode }
        });

        if (!getit || getit.length < 1)
            return res.status(400).json({ status: false, message: 'No invited friends found' });

        const noteList = getit.map((item) => ({
            name: item.firstname + ' ' + item.lastname[0],
            referstatus: item.bvverify == 2 ? 'active' : 'inactive',
            email: '',
            datejoined: moment.unix(item.timed).format('YYYY-MM-DD HH:mm:ss')
        }));

        res.json({
            status: true,
            message: 'Referrals Retrieved',
            data: {
                noteList,
                totalRefer: totalFriend,
                activeRefer: activeFriend
            }
        });

    } catch (error) {
        console.log("ref list Error: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}


const verifyPassRecover = async (req, res) => {
    try {
        const { otpcode, resettoken } = req.body;

        if (!otpcode || otpcode == '')
            return res.status(400).json({ status: false, message: 'Oops! OTP not sent!' });

        jwt.verify(resettoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Reset Token' : 'Token expired. Kindly initiate new password reset';
                return res.status(400).json({ status: false, message: message });
            }

            const tknid = resulted.id;

            const checkdToken = await ResetPass.findOne({
                where: { userid: tknid, token: otpcode, status: 0, authtoken: resettoken }
            }).catch((err) => {
                console.log("Unable to process your request : " + err);
                return res.status(400).json({ status: false, message: 'Invalid reset token' });
            });

            if (!checkdToken)
                return res.status(400).json({ status: false, message: 'Invalid reset otp detected' });

            const storedTime = parseInt(checkdToken.timed, 10);
            const currentTime = Math.floor(Date.now() / 1000); // Current UNIX timestamp
            const expiryTime = storedTime + parseInt(process.env.OTP_EXPIRES);

            if (currentTime > expiryTime) {
                await ResetPass.update({ status: '3' }, { where: { userid: tknid, token: otpcode } });
                return res.status(400).json({ status: false, message: 'OTP has expired. Kindly initiate resend' });
            }

            const updatestats = await ResetPass.update(
                { status: 1 }, { where: { userid: tknid, status: 0, authtoken: resettoken } }
            ).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            if (!updatestats)
                return res.status(400).json({ status: false, message: 'Unable to process your password recovery request, try again' });

            res.json({
                status: true,
                message: 'Password Recovery OTP Verified',
                data: {
                    token: resettoken
                }
            });

        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("pass otp ver Error: ", error.message);
    }
}

const recoverMyPass = async (req, res) => {
    try {
        const { newpass, confirmpass, resettoken } = cleanMe(req.body);
        jwt.verify(resettoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Reset Token' : 'Token expired. Kindly initiate new password reset';
                return res.status(400).json({ status: false, message: message });
            }

            const tknid = resulted.id;

            if (!newpass || newpass == '') return res.status(400).json({ status: false, message: 'Kindly enter your new password' });
            if (!confirmpass || confirmpass == '') return res.status(400).json({ status: false, message: 'Confirmation Password not sent!' });
            if (confirmpass !== newpass) return res.status(400).json({ status: false, message: 'Confirmation Password does not match!' });
            if (!validatePassword(newpass)) return res.status(400).json({ status: false, message: 'Password must be at least 8 chars. long, no space, contain a number, an alphabet, and a special character.' })

            const checkdToken = await ResetPass.findOne({
                where: { userid: tknid, status: 1, authtoken: resettoken }
            }).catch((err) => {
                console.log("Unable to process your request : " + err);
                return res.status(400).json({ status: false, message: 'Unable to process your request : Invalid reset token' });
            });

            if (!checkdToken)
                return res.status(400).json({ status: false, message: 'Unable to process your request : Invalid reset otp detected' });

            const salt = await bcrypt.genSaltSync(saltRounds);
            const hash = await bcrypt.hashSync(newpass, salt);

            const updateuser = await Customer.update({ authy: hash, accesstoken: '' },
                { where: { id: tknid } }).catch((err) => {
                    console.log('Unable to process your request : ' + err);
                });

            //clear previous tokenlog
            await rfToken.update({ status: 0 }, { where: { userid: tknid } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            if (!updateuser)
                return res.status(400).json({ status: false, message: 'Unable to process your password recovery request, try again' });

            res.json({
                status: true,
                message: 'Password Successfully Recovered'
            });

        });
    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("recover pass Error: ", error.message);
    }
}


const maskPhoneNumber = async (phoneNumber) => {
    return phoneNumber.slice(0, 4) + '****' + phoneNumber.slice(-3);
}

const ipAddress = async (req, res, next) => {
    const clientIp = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
    console.log('Client IP:', clientIp);

    // Fetch external IP
    https.get('https://api.ipify.org?format=json', (res) => {
        let data = '';
        res.on('data', (chunk) => {
            data += chunk;
        });
        res.on('end', () => {
            const ipInfo = JSON.parse(data);
            console.log('External IP:', ipInfo.ip);
        });
    }).on('error', (err) => {
        console.error('Error fetching external IP:', err.message);
    });
}


const testNIN = async () => {
    const vertype = 'NIN'; const bvnno = '15630331320';

    try {
        const gettoken = await shAcessToken();
        if (gettoken[0]) {
            var access_token = gettoken[1]
            var ibs_client_id = gettoken[2]
            var ibs_user_id = gettoken[3]

            const options = {
                method: 'POST',
                url: `${process.env.SH_BASEURL}/identity/v2`,
                headers: {
                    accept: 'application/json',
                    ClientID: ibs_client_id,
                    'content-type': 'application/json',
                    authorization: `Bearer ${access_token}`
                },
                data: {
                    type: vertype.toUpperCase(),
                    number: bvnno,
                    debitAccountNumber: process.env.SH_DEBITACCOUNT
                }
            };

            console.log(options)

            let response = await axios.request(options);
            let thedata = response.data;

            console.log('bvnre', thedata)
        }

    } catch (error) {
        console.log(error)
    }
}

// testNIN();

const InitvalidateBVN = async (req, res) => {

    const { bvnno, vertype } = cleanMe(req.body);

    //valdiate bvnno
    if (!vertype || vertype == '') return res.status(400).json({ status: false, message: 'Verification type not supplied!' });
    if (!bvnno || bvnno == '') return res.status(400).json({ status: false, message: `${vertype.toUpperCase()} number not supplied!` });

    if (bvnno.length < 11) return res.status(400).json({ status: false, message: `Invalid ${vertype.toUpperCase()} number supplied!` });

    const userid = req.user.id;
    if (!userid)
        return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const getuser = await Customer.findOne({ where: { id: userid } });

    if (!getuser)
        return res.status(400).json({ status: false, message: 'User details not found. Kindly reload page' });

    if (getuser.bvverify == 1)
        return res.status(400).json({ status: false, message: 'KYC already processing/awaiting approval' });

    // if customer is NG us the below, else use kyver if he has done bvn or nin
    if (getuser.countrycode == 'NG' && getuser.bvverify == 2) {
        return res.status(400).json({ status: false, message: 'KYC verification already completed' });
    } else {
        var checkdbvn = await KYC.findOne({
            order: [['id', 'DESC']], where: {
                userid: userid, tier: 1, vertype: { [Op.in]: ['NIN', 'BVN'] }
            }
        });

        logger.info(checkdbvn)

        if (checkdbvn && checkdbvn.status == 1) {
            return res.status(400).json({ status: false, message: 'KYC completed already' });
        }
    }

    try {
        const checkdbvn = await KYC.findOne({
            order: [['id', 'ASC']], where: { bvv: bvnno, vertype: vertype, status: 1, userid: { [Op.ne]: userid } }
        });

        if (checkdbvn) {
            return res.status(400).json({ status: false, message: `${vertype} already exists with another account` });

        } else {
            res.json({
                status: true,
                message: `${vertype.toUpperCase()} Intiated`,
            });
        }
    } catch (error) {
        console.log("Error bvnn init: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

const validateBVN = async (req, res) => {

    //Discontinue - 11/7/25
    return res.status(400).json({ status: false, message: 'Kindly update your app from appstore/playstore to continue' });

    // try {
    //     const { bvnno, vertype } = req.body

    //     const userid = req.user.id;
    //     if (!userid)
    //         return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    //     const getuser = await Customer.findOne({ where: { id: userid } }).catch((err) => { console.log("Unable to process your request : " + err); });

    //     if (vertype.toLowerCase() != 'bvn' && vertype.toLowerCase() != 'nin')
    //         return res.status(400).json({ status: false, message: 'Invalid Vertype value' });

    //     if (!getuser)
    //         return res.status(400).json({ status: false, message: 'User details not found. Kindly reload page' });

    //     // const userinfo = await getUserInfo(userid);
    //     /* check if the BVN doesnt exist before  */
    //     const checkdbvn = await KYC.findOne({ where: { bvv: bvnno, vertype: vertype, status: 1 } }).catch((err) => { console.log("Unable to process your request : " + err); });

    //     if (checkdbvn)
    //         return res.status(400).json({ status: false, message: `${vertype} already exist with another account` });

    //     /* GENE TOKEN */

    //     const gettoken = await shAcessToken();
    //     if (gettoken[0]) {
    //         var access_token = gettoken[1]
    //         var ibs_client_id = gettoken[2]
    //         var ibs_user_id = gettoken[3]

    //         const options = {
    //             method: 'POST',
    //             url: `${process.env.SH_BASEURL}/identity/v2`,
    //             headers: {
    //                 accept: 'application/json',
    //                 ClientID: ibs_client_id,
    //                 'content-type': 'application/json',
    //                 authorization: `Bearer ${access_token}`
    //             },
    //             data: {
    //                 type: vertype.toUpperCase(),
    //                 number: bvnno,
    //                 debitAccountNumber: process.env.SH_DEBITACCOUNT
    //             }
    //         };

    //         let response = await axios.request(options);
    //         let thedata = response.data;
    //         // console.log('bvnre', thedata)

    //         if (thedata.statusCode == 200) {
    //             var verid = thedata['data']['_id'];
    //             var clientId = thedata['data']['clientId'];
    //             var dvertype = thedata['data']['type']; // BVN or NIN
    //             var amount_charge = thedata['data']['amount'];
    //             var debitSessionId = thedata['data']['debitSessionId'];
    //             var otpId = thedata['data']['otpId'];
    //             var otpVerified = thedata['data']['otpVerified'];  //true or false

    //             /* log kyc */
    //             let dtimed = Math.floor(Date.now() / 1000);
    //             const logKYC = await KYC.create({
    //                 userid: userid, otpcode: '', otptoken: otpId, verid: verid, timed: dtimed,
    //                 verfname: '', verlname: '', verdob: '', gender: '',
    //                 veremail: '', bvv: bvnno, avatar: '', verphone: '',
    //                 status: 0, jsonresp: '', vertype: vertype, provider: 'safehaven'
    //             }).catch((err) => {
    //                 console.log('Unable to process your request : ' + err);
    //                 res.status(400).json({ status: false, message: 'Unable to process your request' });
    //             });

    //             // var formattedNumber = await maskPhoneNumber(phoneNumber1)

    //             if (!logKYC)
    //                 return res.status(400).json({ status: false, message: "Ouch! Unable to process request, kindly retry again" });

    //             res.json({
    //                 status: true,
    //                 message: thedata['message'],
    //                 // message: `We have sent a verification OTP to this phone number - ${formattedNumber} attached with your ${vertype} `,
    //                 data: {
    //                     token: verid
    //                 }
    //             });

    //         } else {
    //             res.json({
    //                 status: false,
    //                 // message: `Unable to verify your ${vertype} number. Kindly retry in few minute`
    //                 message: `${thedata.message}`
    //             })
    //         }


    //     } else {
    //         res.status(400).json({
    //             status: false,
    //             message: `Something went wrong, kindly try again`
    //         })
    //     }
    // } catch (error) {
    //     console.log("Error bvnn chk: ", error.message);
    //     res.status(400).json({ status: false, message: 'Unable to process request' });
    // }

}

const verifyBVOTP = async (req, res) => {
    //Discontinued - 11/7/25
    return res.status(400).json({ status: false, message: 'Kindly update your app from appstore/playstore to continue' });

}

const createVAccount = async (req, res) => {
    try {
        const { bankname, bizid, teamid, accounttype } = cleanMe(req.body);

        if (!bankname || bankname == '')
            return res.status(400).json({ status: false, message: 'Bank name not supplied!' });
        // if (!accounttype || accounttype == '')
        //     return res.status(400).json({ status: false, message: 'Account type not supplied!' });
        const userid = req.user.id
        if (!userid)
            return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        if (accounttype == 'business' && bizid) {
            // get the business with the uuid
            if (!bizid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

            const business = await Business.findOne({
                where: { uuid: bizid },
                attributes: ['id'],
            });

            if (!business) {
                return res.status(404).json({ status: false, message: 'Unauthorized request.' });
            }

            if (bankname == 'gtbank') {
                var createAccount = await genBizGTBAccount(business.id);
            } else {
                var createAccount = await genSHBizAccount(business.id);
            }


        } else {
            const getuser = await Customer.findOne({ where: { id: userid } });

            if (!getuser)
                return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

            const getkyc = await KYC.findOne({
                order: [['id', 'DESC']], where: { userid: userid, [Op.or]: [{ status: 1 }, { status: 2 }], [Op.or]: [{ vertype: 'BVN' }] }
            });


            if (!getkyc)
                return res.status(400).json({
                    status: false, message: 'Kindly complete your account verification in order to proceed', data: {
                        errortype: "kyc"
                    }
                });

            /* CALL CREATE ACCOUNT ENDPOINT */

            if (bankname == '9psb') {
                var createAccount = await gen9PSBAccount(userid);
            } else if (bankname == 'providus') {
                var createAccount = await genProvidusAccount(userid, getkyc.bvv);
            } else if (bankname == 'gtbank') {
                var createAccount = await genGTBankAccount(userid, getkyc);
            } else {
                var createAccount = await genSHAccount(userid, getkyc.verid, getkyc.bvv, getkyc.otpcode, getkyc.vertype, getkyc.verdob, getkyc.verphone, getuser.countrycode);
            }
        }

        if (createAccount[0]) {
            res.status(201).json({
                status: true,
                message: createAccount[1],
                data: {
                    accountname: createAccount[2],
                    accountno: createAccount[3],
                    bankname: createAccount[4]
                }
            });

        } else {
            res.status(400).json({
                status: false,
                message: createAccount[1],
                data: {
                    accountname: '',
                    accountno: '',
                    bankname: ''
                }
            })
        }

    } catch (error) {
        logger.error("Error acctn gen logger: ", error);
        console.log("Error acctn gen: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}


const validatePhoto = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        if (!req.file) {
            return res.status(400).json({ status: false, message: "No file uploaded" });
        }

        const photo = req.file;
        if (!photo) return res.status(400).json({ status: false, message: 'No file uploaded' });

        // // Fetch user details
        const getuser = await Customer.findOne({ where: { id: userid } });
        if (!getuser)
            return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

        if (getuser.isverified > 0)
            return res.status(400).json({ status: false, message: 'Selfie-BVN verification already completed, kindly reload your page' });

        // // Fetch KYC verification details
        const getkyc = await KYC.findOne({
            where: { [Op.and]: [{ userid: userid }, { [Op.or]: [{ vertype: 'NIN' }, { vertype: 'BVN' }] }] }
        });

        if (!getkyc)
            return res.status(400).json({ status: false, message: 'Kindly re-verify your BVN/NIN or contact our support' });

        // // Allowed file types
        const allowedExtensions = ['jpeg', 'jpg'];
        const allowedMimeTypes = ['image/jpeg', 'image/jpg'];

        // // Get file extension safely
        const fileExtension = path.extname(photo.originalname).replace('.', '').toLowerCase();
        // console.log(fileExtension)

        // Validate file type
        if (!allowedExtensions.includes(fileExtension) || !allowedMimeTypes.includes(photo.mimetype)) {
            return res.status(400).json({ status: false, message: 'Invalid file uploaded. File should be a jpeg or jpg image' });
        }

        // Convert to Base64
        const base64Image = photo.buffer.toString('base64');
        const base64WithoutPrefix = base64Image.replace(/^data:image\/\w+;base64,/, "");


        try {

            const options = {
                method: 'POST',
                url: `${process.env.DOJAH_URL}/api/v1/kyc/bvn/verify`,
                headers: {
                    AppId: process.env.DOJAH_APPID,
                    Authorization: process.env.DOJAH_SKEY,
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
                data: {
                    bvn: getkyc.bvv, // Ensure this is correct
                    selfie_image: base64WithoutPrefix
                }
            };

            // Make API request
            const response = await axios.request(options);
            const thedata = response.data;

            if (thedata.entity) {
                const jsonString = JSON.stringify(thedata);
                const entity = thedata.entity;

                const confidence_value = entity.selfie_verification?.confidence_value || 0;
                const match = entity.selfie_verification?.match || false;

                // Log KYC
                const dtimed = Math.floor(Date.now() / 1000);
                try {
                    await KYC.create({
                        userid: userid, otpcode: '', otptoken: '', verid: '', timed: dtimed,
                        verfname: entity.first_name, verlname: entity.last_name, verdob: entity.date_of_birth,
                        gender: entity.gender, email: '', bvv: getkyc.bvn, avatar: entity.image,
                        verphone: entity.phone_number1, status: 0, jsonresp: jsonString, vertype: 'photo'
                    });
                } catch (err) {
                    console.error('Unable to process your request : ', err);
                    return res.status(400).json({ status: false, message: 'Unable to process your request' });
                }

                // Match Verification
                if (match === true && confidence_value > 90) {
                    await Customer.update({ isverified: 1, reglevel: 2 }, { where: { id: userid } });
                    return res.json({ status: true, message: 'Customer Successfully Verified' });
                } else {
                    return res.status(400).json({ status: false, message: 'Customer Verification Failed' });
                }
            }
        } catch (error) {
            console.error("Error in axios request:", error.message);

            // Handle different error types
            if (error.response) {
                // Server responded with a status code outside 2xx
                console.error("Response Data:", error.response.data);
                console.error("Response Status:", error.response.status);
                res.status(400).json({ status: false, message: "Unable to process request at the moment", details: error.response.data });
            } else if (error.request) {
                // No response received (network issue, timeout, etc.)
                console.error("No Response Received");
                res.status(400).json({ status: false, message: "Unable to process request. Please try again later." });
            } else {
                // Other errors (e.g., incorrect config)
                console.error("Axios Configuration Error:", error.message);
                res.status(400).json({ status: false, message: "Internal Server Error" });
            }
        }
    } catch (error) {
        console.error('Error photo validate gen: ', error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
};


const myAccountList = async (req, res) => {
    try {
        const hisid = req.user.id;

        if (!hisid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const getacct = await Bank.findAll({
            order: [['id', 'DESC']],
            where: {
                userid: hisid, status: 1, currency: 'NGN',
                [Op.or]: [{ usertype: { [Op.ne]: 'business' } }, { usertype: null }]
            }
        });

        if (!getacct)
            return res.status(400).json({ status: false, message: 'No account number found for you' });

        const datalist = getacct.map((arrayItem) => ({
            bank_name: arrayItem.bankname,
            account_number: arrayItem.accountno,
            account_name: arrayItem.accountname,
            bank_code: arrayItem.bankcode,
            account_type: arrayItem.accounttype,
            account_typr: arrayItem.accounttype
        }));

        res.json({
            status: true,
            message: 'Account number retrieved',
            data: datalist
        });

    } catch (error) {
        console.log('user acct list catch ERROR: ' + error.message)
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

const resendOTP = async (req, res) => {
    try {
        const { otproute, vertoken, otptype } = cleanMe(req.body);

        if (!otptype || otptype == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to specify the OTP type' });
        if (!otproute || otproute == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to specify the otp reset route' });
        if (!vertoken || vertoken == '') return res.status(400).json({ status: false, message: 'Invalid Token' });

        const checkvtoken = await otpVer.findOne({
            where: { [Op.and]: [{ token: vertoken }, { otptype: otptype }] }
        });

        if (!checkvtoken) {
            return res.status(400).json({ status: false, message: 'Token Expired! Unable to process request, kindly initiate a new verification' });
        }

        var tokenStatus = checkvtoken.status;
        if (tokenStatus == 0) {
            var tcode = checkvtoken.otpcode;
        } else {
            // generate new
            var tcode = genCode(6, 'numeric');
            let dtimed = Math.floor(Date.now() / 1000);
            await otpVer.update({ status: 0, otpcode: tcode, timed: dtimed }, { where: { id: checkvtoken.id } });
        }

        if (otptype == 'regauth') {
            var useremail = checkvtoken.regemail;
            var userphoneno = checkvtoken.regphone;
        } else {
            var ownerid = checkvtoken.userid;
            var userinfo = await getUserInfo(ownerid);
            var useremail = userinfo.email;
            var userphoneno = userinfo.phoneno;
        }

        if (otptype == 'passauth') {
            var ddtype = 'Password Reset';
        } else if (otptype == 'pinreset') {
            var ddtype = 'Password Reset';
        } else if (otptype == 'regauth') {
            var ddtype = 'Account Setup';
        } else {
            var ddtype = '';
        }

        const currentTime = Date.now(); // Milliseconds
        const fiveMinutesInMs = process.env.OTP_EXPIRES * 1000;
        const expiryTime = currentTime + fiveMinutesInMs;

        if (otproute == 'email') {
            if (useremail) {
                var thecontent = `
                    <div>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1738019510/otpnote_fehcv4.png" alt="HitchPay">
                        <div class="" style="width: 110.59px; left: 243.24px; top: 412px; border-bottom: 3px solid #000000; margin: auto;"></div>   
                        <div class="greybg" style=" background: #F8F1FF; padding: 30px 20px;">
                            <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                                Hello <span style="font-size: 18px;">😍</span><br>
                                Please use the code below to complete your ${ddtype.toLowerCase()} verification:<br>
                                <strong>OTP Token: ${!tcode ? '' : tcode}</strong><br>
                                <strong>The code expires in 5 minutes</strong>
                            </p>
                
                            <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                        </div>
                    </div>
                `;
                mailSender('', `${ddtype} OTP Verification`, useremail, thecontent);

                return res.status(200).json({ status: true, otpExpiryTimestamp: expiryTime, message: `Verification OTP successfully resent to your email address` })
            } else {
                return res.status(200).json({ status: false, message: `Invalid email address` })
            }

        } else if (otproute == 'sms') {
            const msg = `Kindly use this OTP - ${tcode} to complete your setup. Powered by HitchPay`
            await sendSMS(userphoneno, msg);

            return res.status(200).json({ status: true, otpExpiryTimestamp: expiryTime, message: `Verification OTP successfully resent to your phone number` })

        } else if (otproute == 'whatsapp') {
            await sendWhatsApp(userphoneno, tcode);

            return res.status(200).json({ status: true, otpExpiryTimestamp: expiryTime, message: `Verification OTP successfully resent to your phone number on WhatsApp` })
        } else {
            return res.status(400).json({ status: false, message: 'Invalid OTP Route' })
        }

    } catch (error) {
        res.status(400).json({ status: false, otpExpiryTimestamp: '', message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("resendotp Error: ", error.message);
    }
}

const miniAccount = async (req, res) => {
    //REGISTER FOR USER
    try {
        const { countrycode, email, phone, tpin, pword } = cleanMe(req.body);

        if (!countrycode || countrycode == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your country e.g NG' });
        if (!email || email == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your email address' });
        if (!phone || phone == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your phone number' });
        if (!pword || pword == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your password!' });
        if (!tpin || tpin == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to specify your transaction PIN' });
        if (tpin.length != '4') return res.status(400).json({ status: false, message: 'Transaction should be 4 digit number' });
        if (!validatePassword(pword)) return res.status(400).json({ status: false, message: 'Password must be at least 8 chars. long, no space, contain a number, an alphabet, and a special character.' })

        const checkExistUser = await Customer.findOne({ where: { email } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (checkExistUser) return res.status(400).json({ status: false, message: 'Account already exist with email' });

        const checkExistPhone = await Customer.findOne({ where: { phoneno: phone } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (checkExistPhone) return res.status(400).json({ status: false, message: 'Account already exist with phone number' });

        /* GENERATE REFER CODE */
        const refercode = await generateReferralCode();
        let dtimed = Math.floor(Date.now() / 1000);

        /* PIN HASHING */
        //register pin
        const pinsalt = bcrypt.genSaltSync(saltRounds);
        const hashedpin = bcrypt.hashSync(tpin, pinsalt);

        /* PWORD HASHIN */
        const salt = bcrypt.genSaltSync(saltRounds);
        const hashed = bcrypt.hashSync(pword, salt);

        const creatUser = await Customer.create({
            firstname: '', lastname: '', email, status: 1, accesstoken: '', phoneno: phone, countrycode: countrycode, regchannel: 'whatsapp',
            apptoken: '', authy: hashed, address: '', timed: dtimed, authpin: hashedpin, reglevel: 1, refcode: refercode, referby: ''
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });

        if (creatUser) {
            var name = ``;
            const getmyID = await Customer.findOne({
                where: { email: email, phoneno: phone }
            }).catch((err) => { console.log("Unable to process your request : " + err); });

            if (!getmyID)
                return res.status(400).json({ status: false, message: 'Email or Password does not match!' });

            /* CREATE WALLET FOR HIM IN NGN */
            await Wallets.create({ uid: getmyID.id, email: getmyID.email, currency: 'NGN', wbal: 0, ledger: 0, usertype: 'personal', timecreated: dtimed, lastupdated: dtimed, status: 1 }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

            // send mail with defined transport object

            const emailcontent = `
            <div>
            <h1 style="font-weight: 800; font-size: 32px; line-height: 40px; text-align: center; color: #40196D; margin-top: 50px;">Welcome to HitchPay</h1>
            <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">Simplify Your Finances with Ease!</h3>
            <img style="margin: 20px 0;"
                src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="hitchpay">
            <div style=" background: #fff; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                <p style="line-height: 20px; letter-spacing: 0.025em;">
                    Hello <span style="font-size: 18px;">😍</span></p>
                    <p style="line-height: 28px; letter-spacing: 0.025em;">
                    Welcome to <strong>HitchPay!</strong> We're excited to have you join our community. With HitchPay, managing your finances has never been easier. From bill payments to tracking transactions, we've got you covered.
                </p>

                <div>
                    <button type="button" style="max-width: 426px; height: 58px;background: #40196D; font-weight: 700; font-size: 20px; line-height: 30px; letter-spacing: 0.025em; color: #FFFFFF;padding: 0px 12px;">What Can HitchPay Do for You?</button>
                </div>

                <div>
                    <ol>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Effortless Bill Payments:</strong> <br> Say goodbye to late fees! With HitchPay, you can schedule and pay all your bills from one convenient platform. Never miss a due date again.</li>
                            <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Transaction Tracking:</strong> <br> Monitor your spending and keep track of all your transactions in real-time. HitchPay categorizes your expenses, giving you a clear view of where your money goes.
                        </li>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Smart Budgeting Tools:</strong><br>
                            Set financial goals and create budgets tailored to your lifestyle. HitchPay helps you stay on track and reach your savings goals faster.
                        </li>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Secure & Safe:</strong><br>
                            Your financial security is our top priority. We use the latest encryption technology to ensure your data is protected at all times.
                        </li>
                        <li style="font-size: 18px; margin: 10px 0px;">
                            <strong>Instant Notifications:</strong>
                            Stay informed with instant alerts on your transactions, bill due dates, and account activity. You’re always in control with HitchPay.
                        </li>
                    </ol>
                </div>

                <div>
                    <button type="button" style="max-width: 426px; height: 58px;background: #40196D; font-weight: 700; font-size: 20px; line-height: 30px; letter-spacing: 0.025em; color: #FFFFFF;padding: 0px 12px;">Get Started Today</button>
                </div>

                <div style="display: flex;">
                    <p style="width: 27px; height: 27px; background: #BA68C8; border-radius: 30px; color: #fff; align-items: center !important; justify-content: center !important; position: relative;display: flex
                    ;"></p> 
                    <p style="font-weight: 700; margin-left: 10px;"> Download the App</p>
                </div>

                <div style="display: flex;">
                    <p style="width: 29px; height: 27px; background: #BA68C8; border-radius: 30px; color: #fff; align-items: center !important; justify-content: center !important; position: relative;display: flex
                    ;"></p> 
                    <p style="margin: 10px;"><strong>Login:</strong> Access your account using your registered email and password.</p>
                </div>

                <div style="display: flex;">
                    <p style="width: 42px; height: 27px; background: #BA68C8; border-radius: 30px; color: #fff; align-items: center !important; justify-content: center !important; position: relative;display: flex
                    ;"></p> 
                    <p style="margin: 10px;"><strong>Explore Features:</strong> Take a tour of HitchPay and discover how we can help simplify your financial life.</p>
                </div>

                <p>Thank you for choosing HitchPay. Were excited to help you take control of your finances!</p>
                <p style="font-weight: 700;">Best regards, <br> The HitchPay Team</p>
            </div>
            </div>`;

            mailSender('', 'Welcome to HitchPay', getmyID.email, emailcontent);

            //send sms
            const msg = `Welcome to ${process.env.SITENAME}! We're excited to have you join our community. With HitchPay, managing your finances has never been easier. From bill payments to tracking transactions, we've got you covered. Powered by HitchPay`
            sendSMS(phone, msg);

            res.status(200).json({
                status: true,
                message: 'Account Creation Successfully Created',
            })

        } else {
            res.status(200).json({ status: false, message: 'Oops! Unable to process your request.' })
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("Create min acnt Error: ", error.message);
    }
}

const delAccount = async (req, res) => {
    const tokenid = req.user.id;
    const { reason, transpin } = cleanMe(req.body);
    try {
        if (!tokenid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        if (!reason || reason == '') return res.status(400).json({ status: false, message: `We're sorry to see you go! As much as we'd love you to stay, we respect your decision. To help us improve our services, could you please let us know why you're closing your account` });
        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Kindly enter your transaction PIN' });

        const checkUser = await Customer.findOne(
            {
                where: { id: tokenid }
            }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

        if (!checkUser) {
            return res.status(400).json({ status: false, message: 'Acount not logged in' });
        }

        const checkwithHashPwd = bcrypt.compareSync(transpin, checkUser.authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid PIN Entered' });

        let updalog = false;
        const checkhisdoc = await DelAcct.findOne({ where: { userid: tokenid } });

        let dtimed = Math.floor(Date.now() / 1000);
        if (checkhisdoc) {
            //update
            updalog = await DelAcct.update({ reason: reason, status: 0 }, { where: { userid: tokenid } });
        } else {
            //not found
            updalog = await DelAcct.create({ userid: tokenid, reason: reason, status: 0, dated: dtimed });
        }

        if (!updalog)
            return res.status(400).json({ status: false, message: 'Unable to process your request, kindly try again' });

        var thecontent = `
        <div>  
            <div class="greybg" style=" background: #fff;">
                <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">We have received your request.</p>
                <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">We will review your account closure request within 24 hours. If any further action is required, we will notify you.</p>
                <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">If you have any concerns or would like to reconsider, feel free to reach out to our support team.</p>
                <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">Thank you.</p>
      
                <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
            </div>
        </div>
    `;

        mailSender(checkUser.firstname, 'Account Closure', checkUser.email, thecontent);

        res.json({
            status: true,
            message: 'We will review your account closure request within 24 hours. If any further action is required, we will notify you.'
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Server Error! Unable to process your request at the moment, kindly retry shortly' });
        console.log("del acct Error: ", error.message);
    }
}

const tier2KYC = async (req, res) => {
    try {
        const tknid = req.user.id;
        if (!tknid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { fileno, doctype, docname, idcardno, expirydate, issuance_country, usertype } = req.body;
        const uploadfiles = req.files;

        const fileupload = uploadfiles['fileupload']?.[0];
        const idcardback = uploadfiles['idcardback']?.[0];
        const maxCount = 1;

        if (!fileupload)
            return res.status(400).json({ status: false, message: 'No ID card front uploaded' });

        if (!idcardback)
            return res.status(400).json({ status: false, message: 'No ID card back uploaded' });

        if ((uploadfiles['fileupload'].length > maxCount) || (uploadfiles['idcardback'].length > maxCount))
            return res.status(400).json({ status: false, message: 'Document can not exceed 1 file per upload' });

        if (!fileno) return res.status(400).json({ status: false, message: 'Oops! ID Card number not specified!' });

        const { fileTypeFromBuffer } = await import('file-type');
        const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        // Process front image
        const frontTypeResult = await fileTypeFromBuffer(fileupload.buffer);
        if (!frontTypeResult || !allowedMimeTypesForPix.includes(frontTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid front file type." });

        const frontExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
        if (frontExtension !== frontTypeResult.ext)
            console.warn(`Warning: Front file extension mismatch. User: ${tknid}`);

        // Process back image
        const backTypeResult = await fileTypeFromBuffer(idcardback.buffer);
        if (!backTypeResult || !allowedMimeTypesForPix.includes(backTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid back file type." });

        const backExtension = idcardback.originalname.split('.').pop()?.toLowerCase();
        if (backExtension !== backTypeResult.ext)
            console.warn(`Warning: Back file extension mismatch. User: ${tknid}`);

        // Upload front file
        let thefile = '';
        if (frontExtension === 'pdf') {
            const randomFileName = `kyc_tier2_${tknid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) thefile = doUpload[1];
        } else {
            const processedBuffer = await sharp(fileupload.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_tier2_front_${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) return reject(new Error('Cloud upload failed for front.'));
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBuffer);
            });
        }

        // Upload back file
        let thefileBack = '';
        if (backExtension === 'pdf') {
            const randomFileName = `kyc_tier2_back_${tknid}_${uuidv4()}.pdf`;
            const doUploadBack = await AWSFileUpload(idcardback.buffer, randomFileName);
            if (doUploadBack[0]) thefileBack = doUploadBack[1];
        } else {
            const processedBackBuffer = await sharp(idcardback.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefileBack = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_tier2_back_${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) return reject(new Error('Cloud upload failed for back.'));
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBackBuffer);
            });
        }

        if (!thefile || !thefileBack) {
            return res.status(400).json({ status: false, message: 'Unable to upload one or both ID card images. Please try again.' });
        }

        const dtimed = Math.floor(Date.now() / 1000);
        const [kycDoc, created] = await KycDoc.findOrCreate({
            where: { userid: tknid, tier: 2, doctype: 'idcard' },
            defaults: {
                userid: tknid,
                docurl: thefile,
                docurl_back: thefileBack, // Add this column to your DB model if not present
                docno: fileno,
                expirydate: expirydate,
                issuancecountry: issuance_country,
                docstatus: 1,
                doctype: 'idcard',
                docname: doctype,
                tier: 2,
                timed: dtimed
            }
        });

        if (!created) {
            await kycDoc.update({
                docurl: thefile,
                docurl_back: thefileBack,
                docno: fileno,
                expirydate: expirydate,
                issuancecountry: issuance_country,
                docstatus: 1,
                doctype: 'idcard',
                docname: doctype,
                timed: dtimed
            });
        }

        return res.json({
            status: true,
            message: 'Great! ID Card Successfully Submitted, Awaiting Approval!'
        });

    } catch (error) {
        console.error("KYC Upload Error:", error.message);
        return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
};

const InterPassUpload = async (req, res) => {
    try {
        const tknid = req.user.id;
        if (!tknid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { fileno, doctype, expirydate, issuance_country } = req.body;
        const uploadfiles = req.files;

        const fileupload = uploadfiles['fileupload']?.[0];
        const idcardback = uploadfiles['idcardback']?.[0];
        const maxCount = 1;

        if (!fileupload)
            return res.status(400).json({ status: false, message: 'International passport front is required' });

        if (!idcardback)
            return res.status(400).json({ status: false, message: 'International passport back is required' });

        if ((uploadfiles['fileupload'].length > maxCount) || (uploadfiles['idcardback'].length > maxCount))
            return res.status(400).json({ status: false, message: 'Document can not exceed 1 file per upload' });

        if (!fileno) return res.status(400).json({ status: false, message: 'Oops! International passport number not specified!' });

        const { fileTypeFromBuffer } = await import('file-type');
        const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        // Process front image
        const frontTypeResult = await fileTypeFromBuffer(fileupload.buffer);
        if (!frontTypeResult || !allowedMimeTypesForPix.includes(frontTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid front file type." });

        const frontExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
        if (frontExtension !== frontTypeResult.ext)
            console.warn(`Warning: Front file extension mismatch. User: ${tknid}`);

        // Process back image
        const backTypeResult = await fileTypeFromBuffer(idcardback.buffer);
        if (!backTypeResult || !allowedMimeTypesForPix.includes(backTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid back file type." });

        const backExtension = idcardback.originalname.split('.').pop()?.toLowerCase();
        if (backExtension !== backTypeResult.ext)
            console.warn(`Warning: Back file extension mismatch. User: ${tknid}`);

        // Upload front file
        let thefile = '';
        if (frontExtension === 'pdf') {
            const randomFileName = `kyc_intpsst_${tknid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) thefile = doUpload[1];
        } else {
            const processedBuffer = await sharp(fileupload.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_intpsst_front_${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) return reject(new Error('Cloud upload failed for front.'));
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBuffer);
            });
        }

        // Upload back file
        let thefileBack = '';
        if (backExtension === 'pdf') {
            const randomFileName = `kyc_intpsst_back_${tknid}_${uuidv4()}.pdf`;
            const doUploadBack = await AWSFileUpload(idcardback.buffer, randomFileName);
            if (doUploadBack[0]) thefileBack = doUploadBack[1];
        } else {
            const processedBackBuffer = await sharp(idcardback.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefileBack = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_intpsst_back_${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) return reject(new Error('Cloud upload failed for back.'));
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBackBuffer);
            });
        }

        if (!thefile || !thefileBack)
            return res.status(400).json({ status: false, message: 'Unable to upload one or both international passport images. Please try again.' });

        const dtimed = Math.floor(Date.now() / 1000);
        const [kycDoc, created] = await KycDoc.findOrCreate({
            where: { userid: tknid, doctype: 'interpass' },
            defaults: {
                userid: tknid,
                docurl: thefile,
                docurl_back: thefileBack, // Add this column to your DB model if not present
                docno: fileno,
                expirydate: expirydate,
                issuancecountry: issuance_country,
                docstatus: 1,
                doctype: 'interpass',
                docname: doctype,
                tier: '',
                timed: dtimed
            }
        });

        if (!created) {
            await kycDoc.update({
                docurl: thefile,
                docurl_back: thefileBack,
                docno: fileno,
                expirydate: expirydate,
                issuancecountry: issuance_country,
                docstatus: 1,
                doctype: 'interpass',
                docname: doctype,
                timed: dtimed
            });
        }

        return res.json({
            status: true,
            message: 'Great! International Passport Successfully Submitted, Awaiting Approval!'
        });

    } catch (error) {
        console.error("INtl KYC Upload Error:", error.message);
        return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
};

const tier2bKYC = async (req, res) => {

    try {
        const tknid = req.user.id;

        if (!tknid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { doctype, docname } = req.body;
        const fileupload = req.file;

        if (fileupload == '' || (!fileupload))
            return res.status(400).json({ status: false, message: 'No file uploaded' });

        if (doctype == '') return res.status(400).json({ status: false, message: 'Oops! Document not specified as Statement or Utility!' });

        try {
            const { fileTypeFromBuffer } = await import('file-type'); // Dynamic import
            const fileTypeResult = await fileTypeFromBuffer(fileupload.buffer); // Use the buffer
            const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

            if (!fileTypeResult || !allowedMimeTypesForPix.includes(fileTypeResult.mime)) {
                return res.status(400).json({ status: false, message: "Invalid file detected. Only images and pdf allowed." });
            }

            const originalExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
            if (originalExtension !== fileTypeResult.ext) {
                console.warn(`Warning: File extension mismatch post-multer. User: ${tknid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
            }

        } catch (fileTypeError) {
            console.error("Error during file type check in controller:", fileTypeError);
            return res.status(500).json({ status: false, message: "Error verifying file content." });
        }

        const userinfo = await getUserInfo(tknid);
        if (!userinfo) {
            return res.status(400).json({ status: false, message: 'User not found.' });
        }

        let thefile = '';
        /* upload licencedoc */
        const file_extension = fileupload.originalname.split('.').pop().toLowerCase();
        if (file_extension === 'pdf') {
            const randomFileName = `kyc_tier3_${tknid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) {
                thefile = doUpload[1];
            }
        } else {
            let processedBuffer;
            try {
                processedBuffer = await sharp(fileupload.buffer)
                    .toFormat('jpeg')
                    .jpeg({ quality: 80 })
                    .toBuffer();
            } catch (sharpError) {
                console.error("Image processing error:", sharpError);
                return res.status(400).json({ status: false, message: 'Invalid or corrupted image file.' });
            }

            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_tier3_${tknid}_${uuidv4()}`;

                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) {
                            console.error("Cloud upload error:", error);
                            return reject(new Error('Cloud upload failed.'));
                        }
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBuffer);
            });
        }

        if (!thefile) {
            return res.status(400).json({ status: false, message: 'Unable to process upload request, please try again' });
        }

        const dtimed = Math.floor(Date.now() / 1000);

        const [kycDoc, created] = await KycDoc.findOrCreate({
            where: { userid: tknid, tier: 2, doctype: 'utility' },
            defaults: { userid: tknid, docurl: thefile, docno: '', docstatus: 1, doctype: 'utility', docname: docname, tier: 2, timed: dtimed }
        });

        if (!created) {
            await kycDoc.update({ docurl: thefile, docno: '', docstatus: 1, doctype: 'utility', docname: docname, timed: Math.floor(Date.now() / 1000) });
        }

        res.json({
            status: true,
            message: 'Great! Proof of Address Successfuly Submitted, Awaiting Approval!'
        });


    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("Error while uploading doc file", error.message);
    }
}

const tierBankStmt = async (req, res) => {

    try {
        const tknid = req.user.id;

        if (!tknid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { doctype, docname } = req.body;
        const fileupload = req.file;

        if (fileupload == '' || (!fileupload))
            return res.status(400).json({ status: false, message: 'No file uploaded' });

        if (doctype == '') return res.status(400).json({ status: false, message: 'Oops! Document not specified as Statement or Utility!' });

        try {
            const { fileTypeFromBuffer } = await import('file-type'); // Dynamic import
            const fileTypeResult = await fileTypeFromBuffer(fileupload.buffer); // Use the buffer
            const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

            if (!fileTypeResult || !allowedMimeTypesForPix.includes(fileTypeResult.mime)) {
                return res.status(400).json({ status: false, message: "Invalid file detected. Only images and pdf allowed." });
            }

            const originalExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
            if (originalExtension !== fileTypeResult.ext) {
                console.warn(`Warning: File extension mismatch post-multer. User: ${tknid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
            }

        } catch (fileTypeError) {
            console.error("Error during file type check in controller:", fileTypeError);
            return res.status(500).json({ status: false, message: "Error verifying file content." });
        }

        const userinfo = await getUserInfo(tknid);
        if (!userinfo) {
            return res.status(400).json({ status: false, message: 'User not found.' });
        }

        let thefile = '';
        /* upload licencedoc */
        const file_extension = fileupload.originalname.split('.').pop().toLowerCase();
        if (file_extension === 'pdf') {
            const randomFileName = `kyc_tier3_${tknid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) {
                thefile = doUpload[1];
            }
        } else {
            let processedBuffer;
            try {
                processedBuffer = await sharp(fileupload.buffer)
                    .toFormat('jpeg')
                    .jpeg({ quality: 80 })
                    .toBuffer();
            } catch (sharpError) {
                console.error("Image processing error:", sharpError);
                return res.status(400).json({ status: false, message: 'Invalid or corrupted image file.' });
            }

            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_tier3_${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) {
                            console.error("Cloud upload error:", error);
                            return reject(new Error('Cloud upload failed.'));
                        }
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBuffer);
            });
        }

        if (!thefile) {
            return res.status(400).json({ status: false, message: 'Unable to process upload request, please try again' });
        }

        const dtimed = Math.floor(Date.now() / 1000);

        const [kycDoc, created] = await KycDoc.findOrCreate({
            where: { userid: tknid, tier: 3 },
            defaults: { userid: tknid, docurl: thefile, docno: '', docstatus: 1, doctype: 'utility', docname: docname, tier: 3, timed: dtimed }
        });

        if (!created) {
            await kycDoc.update({ docurl: thefile, docno: '', docstatus: 1, doctype: 'utility', docname: docname, timed: Math.floor(Date.now() / 1000) });
        }

        res.json({
            status: true,
            message: 'Great! KYC Successfuly Submitted, Awaiting Approval!'
        });


    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("Error while uploading doc file", error.message);
    }

}


const kycStatus = async (req, res) => {
    try {

        const tknid = req.user.id;

        if (!tknid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getuser = await Customer.findOne({ where: { id: tknid } });
        if (!getuser) {
            return res.status(400).json({ status: false, message: 'Unable to load your KYC status. Kindly retry shortly' });
        }


        var countrycode = getuser.countrycode;

        if (getuser.city != '' && getuser.state != '' && getuser.address != '') {
            var addrStatus = 2
        } else {
            var addrStatus = 0
        }

        const getkyc = await KycDoc.findAll({ where: { [Op.and]: [{ userid: tknid }] } });

        if (getkyc.length > 0) {
            var dataInfo = await Promise.all(getkyc.map(async (info) => {
                var statscd1;

                var doctype = info.docname ? info.docname : info.doctype;
                var docname = info.doctype;
                var doctier = info.tier;
                var docno = info.docno;
                var docurl = info.docurl;
                var docstatus = info.docstatus;

                if (docstatus == 1) {
                    var statustext = 'in review'; statscd1 = 1
                } else if (docstatus == 2) {
                    var statustext = 'approved'; statscd1 = 2
                } else if (docstatus == 3) {
                    var statustext = 'declined'; statscd1 = 3
                } else {
                    var statustext = 'not submitted'; statscd1 = 0
                }

                return { doctier: doctier, fileurl: docurl, kycstatus: statscd1, statustext: statustext, fileno: docno, doctype: doctype, docname }
            }));
        } else {
            var dataInfo = [];
        }


        // KYC TIER 1
        var checkdbvn = await KYC.findOne({ order: [['id', 'DESC']], where: { userid: tknid, tier: 1, vertype: { [Op.in]: ['NIN', 'BVN'] } } });
        // if(countrycode == 'NG'){
        // }else{
        //     var checkdbvn = await KYC.findOne({order: [['id', 'DESC']], where: {userid:tknid, tier: 1} });
        // }


        if (checkdbvn) {
            var kycStatus = checkdbvn.status == 0 ? 1 : checkdbvn.status == 1 ? 2 : checkdbvn.status
            // if(countrycode == 'NG'){
            // }else{
            //     var kycStatus = 0; //alwys 0 for diaspora
            // }
            var vertype = checkdbvn.vertype

        } else {
            var kycStatus = 0;
            var vertype = ''
        }



        // tier 1 bvn/nin
        var tier1doc = {
            "doctier": "1",
            "fileurl": "",
            "kycstatus": kycStatus,
            "statustext": kycStatus == 1 ? 'approved' : 'pending',
            "fileno": "",
            "doctype": vertype,
            "docname": 'govid1'
        }


        // KYC TIER 2
        const checkdbvn2 = await KYC.findOne({ order: [['id', 'DESC']], where: { userid: tknid, tier: 2 } });

        if (checkdbvn2) {
            var kycStatus2 = checkdbvn2.status == 1 ? 2 : checkdbvn2.status == 0 ? 1 : checkdbvn2.status
            var vertype2 = checkdbvn2.vertype
        } else {
            var kycStatus2 = 0;
            var vertype2 = ''
        }

        //tier
        var tier2doc = {
            "doctier": "2",
            "fileurl": "",
            "kycstatus": kycStatus2,
            "statustext": kycStatus2 == 1 ? 'approved' : 'pending',
            "fileno": "",
            "doctype": vertype2,
            "docname": 'govid2'
        }

        var addresskyc = {
            "doctier": "2",
            "fileurl": "",
            "kycstatus": addrStatus,
            "statustext": addrStatus == 2 ? 'approved' : addrStatus == 0 ? 'not submitted' : 'in review',
            "fileno": "",
            "doctype": "address",
            "docname": "address"
        }

        const getAddrVer = await AddrVer.findOne({ where: { userid: tknid } });
        if (getAddrVer) {
            var verAddrStatus = getAddrVer.status
        } else {
            var verAddrStatus = 0;
        }

        var addrVer = {
            "doctier": "3",
            "fileurl": "",
            "kycstatus": verAddrStatus,
            "statustext": verAddrStatus == 2 ? 'approved' : verAddrStatus == 1 ? 'in review' : verAddrStatus == 0 ? 'not submitted' : 'pending',
            "fileno": "",
            "doctype": "address_ver",
            "docname": "address_ver"
        };

        dataInfo.push(tier1doc, tier2doc, addresskyc, addrVer)

        res.json({
            status: true,
            message: 'KYC Status Retrieved',
            data: dataInfo
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to load KYC status at the moment, kindly retry shortly' });
        console.log("kyc status Error: ", error.message);
        logger.error("kyc status Error: ", error);
    }
}


const updPromoCode = async (req, res) => {

    try {
        const hisid = req.user.id;
        const { uname } = cleanMe(req.body);

        if (!hisid)
            return res.status(400).json({ status: false, message: 'Invalid request sent!' });

        if (!uname || uname == '') return res.status(400).json({ status: false, message: 'You forgot to enter your preferred promo/referral code!' });
        if (uname.length > '15') return res.status(400).json({ status: false, message: 'Username/Promo code cannot be more than 15 character long' });

        const checkUser = await Customer.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!checkUser)
            return res.status(400).json({ status: false, message: 'Unable to process your request, kindly refresh and try again' });

        var username = uname.toLowerCase();

        /* check if the username already used */
        const checkuname = await Customer.findOne({ where: { uname: username } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (checkuname)
            return res.status(400).json({ status: false, message: 'Username already taken, kindly use another username' });


        const changeit = await Customer.update({ uname: username },
            { where: { id: hisid, email: checkUser.email } }).catch((err) => {
                console.log('Unable to process your request : ' + err);
            });

        if (!changeit)
            return res.status(400).json({ status: false, message: "Ouch! Unable to process requests, kindly retry again" });

        res.status(201).json({
            status: true, message: 'Username Successfully Added.'
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("setup uname Error: ", error.message);
    }
}


const logoutUser = async (req, res, next) => {
    try {
        const token = ExtractJwt.fromAuthHeaderAsBearerToken()(req);
        const userId = req.user.id;

        if (!token) {
            return res.status(400).json({ status: false, message: 'No token provided.' });
        }

        // Decode the token to get its payload (including jti and exp)
        const decoded = jwt.decode(token);
        console.log(decoded)
        if (!decoded || !decoded.exp || !decoded.jti) { // Check for jti if you added it
            // Fallback: Use the token itself as the key if jti is missing
            const decodedFallback = jwt.verify(token, process.env.JWT_SECRET, { ignoreExpiration: true });
            // Verify signature but ignore expiry for getting payload
            if (!decodedFallback || !decodedFallback.exp) {
                return res.status(400).json({ status: false, message: 'Invalid token.' });
            }

            const tokenKey = `bl_${token}`; // Use token itself
            const expiresAt = decodedFallback.exp;
            const now = Math.floor(Date.now() / 1000);
            const ttl = expiresAt - now;

            if (ttl > 0) {
                await redisClient.set(tokenKey, 'blacklisted', { EX: ttl });
                console.log(`User ${userId} logged out. Token blacklisted (using token). TTL: ${ttl}s`);
            }

        } else {
            const tokenKey = `bl_${decoded.jti}`; // Use jti as the key
            const expiresAt = decoded.exp;
            const now = Math.floor(Date.now() / 1000);
            const ttl = expiresAt - now; // Calculate remaining time in seconds

            // Add the token's JTI to the Redis blacklist if it hasn't expired yet
            if (ttl > 0) {
                await redisClient.set(tokenKey, 'blacklisted', { EX: ttl });
                console.log(`User ${userId} logged out. Token JTI ${decoded.jti} blacklisted. TTL: ${ttl}s`);
            }
        }


        // Invalidate the refresh token in the database
        await rfToken.update(
            { status: 0 }, // Set status to inactive/invalidated
            { where: { userid: userId, usertype: 'user', status: 1 } } // Find active refresh token for this user
        );

        // console.log(`User ${userId} refresh tokens invalidated.`);

        // Clear the access token from the user record (optional, but good practice)
        await Customer.update({ accesstoken: '' }, { where: { id: userId } });

        res.status(200).json({ status: true, message: 'Logout successful.' });

    } catch (error) {
        console.error("Logout Error:", error);
        next(error); // Pass to global error handler
    }
};

const validatePIN = async (req, res) => {

    try {
        const hisid = req.user.id;
        const { authcode } = req.body;

        if (!hisid)
            return res.status(400).json({ status: false, message: 'Invalid request sent!' });
        if (!authcode || authcode == '') return res.json({ status: false, message: 'You forgot to enter your transaction PIN!' });
        const checkUser = await Customer.findOne({ where: { id: hisid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!checkUser) {
            return res.status(400).json({ status: true, message: 'Unable to process your request, kindly refresh and try again' });
        }

        const transpin = authcode;
        const checkwithHashPin = bcrypt.compareSync(transpin, checkUser.authpin); // true/false

        if (!checkwithHashPin)
            return res.status(400).json({ status: false, message: 'Invalid Transaction PIN' });

        res.status(200).json({
            status: true, message: 'PIN Validated.'
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("validate check pin Error: ", error.message);
    }
}

const AppSetting = async (req, res) => {
    try {
        const getsett = await AppSett.findOne({
            where: { id: 1 }, attributes: [
                'referearn', 'eligible_refamt', 'inflowfee', 'minwithdraw', 'dollarfund', 'dollarfee',
                'dollarwithdraw', 'usacctfee', 'dollartransfer', 'crosstransfer', 'crosscollectfee', 'nocac_allow', 'remittance_bank', 'remittance_card'
            ]
        });

        if (!getsett) return res.status(400).json({ status: false, message: 'Settings not found' });
        res.json({
            status: true,
            message: 'Settings retrieved',
            data: getsett
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("Error: ", error.message);
    }
}

const showAds = async (req, res) => {
    try {
        const getsett = await AppSett.findOne({ where: { status: 1 }, attributes: ['ads'] });

        if (!getsett) return res.json({ status: false, message: 'Ads not found' });

        res.json({
            status: true,
            message: 'Ads retrieved',
            data: JSON.parse(getsett.ads)
        });


    } catch (error) {
        res.json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("show ads promotion Error: ", error.message);
    }
}


const verifyKYCDojah = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { referenceid } = req.body;
        // console.log('referenceid', referenceid)

        if (!referenceid) return res.status(400).json({ status: false, message: 'No KYC initiated' });

        // // Fetch user details
        const getuser = await Customer.findOne({ where: { id: userid } });
        if (!getuser)
            return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

        // const getkyc = await KYC.findOne({
        //     where: { [Op.and]: [{ userid: userid }, { [Op.or]: [{ vertype: 'NIN' }, { vertype: 'BVN' }]}] }
        // });

        // if (!getkyc)
        //     return res.status(400).json({ status: false, message: 'Kindly re-verify your BVN/NIN or contact our support' });

        // udpate the ver as pending initially before calling ver ednpoint
        await Customer.update(
            { bvverify: 1 }, { where: { id: userid } }
        );

        try {
            const options = {
                method: 'GET',
                url: `${process.env.DOJAH_URL}/api/v1/kyc/verification?reference_id=${referenceid}`,
                headers: {
                    AppId: process.env.DOJAH_APPID,
                    Authorization: process.env.DOJAH_SKEY,
                    accept: 'application/json',
                    'content-type': 'application/json'
                }
            };

            // Make API request
            const response = await axios.request(options);
            const thedata = response.data;
            // console.log('kycbv', thedata)

            const jsonString = JSON.stringify(thedata);

            if (thedata.entity) {
                const entity = thedata.entity;
                const user_id = entity['metadata']['user_id'];
                const widget_email = entity['metadata']['email'];

                const respMessage = entity['message'];
                const id_type = entity['id_type'];
                const idvalue = entity['value'];
                const reference = entity['reference_id'];
                const verification_mode = entity['verification_mode'];
                const vertype = entity['verification_type']; //NIN/BVN
                const vervalue = entity['verification_value']; //76526262222
                const imagefile = entity['selfie_url'];
                const verstatus = entity['status'];

                if (entity['verification_status']) {
                    var verification_status = entity['verification_status'];
                } else if (entity['verificationStatus']) {
                    var verification_status = entity['verificationStatus'];
                } else {
                    var verification_status = 'declined';
                }

                // console.log('verification_status', verification_status)

                if (vertype == 'nin' || vertype == 'NIN') {
                    var dataEntity = entity['data']['government_data']['data']['nin']['entity'];
                    var phone_number = dataEntity['phone_number'];
                } else if (vertype.toLowerCase() == 'passport_id') {
                    var dataEntity = entity['data']['id']['data']['id_data'];
                    var phone_number = '';
                } else {
                    var dataEntity = entity['data']['government_data']['data']['bvn']['entity'];
                    var phone_number = dataEntity['phone_number1'];
                }
                const firstName = dataEntity['first_name'];
                const lastName = dataEntity['last_name'];
                const gender = dataEntity['gender'];
                const dateOfBirth = dataEntity['date_of_birth'];
                // const image_url = dataEntity['image_url'];
                const veremail = dataEntity['email'] ?? '';
                // const telephoneno = dataEntity['telephoneno'];
                // const marital_status = dataEntity['marital_status'];


                // const hisdob = moment(dateOfBirth, 'DD-MMM-YYYY').format('YYYY-MM-DD'); 
                const dtimed = Math.floor(Date.now() / 1000);
                const hisdob = dateOfBirth;

                if (verification_status.toLowerCase() == 'pending') {
                    // console.log('logger')
                    const logKYC = await KYC.create({
                        userid: userid, otpcode: '', otptoken: reference, verid: reference, timed: dtimed,
                        verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                        veremail: veremail, bvv: vervalue, avatar: imagefile, verphone: phone_number,
                        status: 0, jsonresp: jsonString, vertype: vertype, provider: 'dojah', tier: 1
                    });

                    var bvverify = 1;
                    await Customer.update(
                        { bvverify: bvverify }, { where: { id: userid } }
                    );

                    //pending
                    var mailcontent = `
                    <p>Eh! Your KYC verification on ${process.env.SITENAME} has been received and undergoing futher checks.</p>
        
                    <p><i>${respMessage}</i></p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;

                    //send email                
                    await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                    const notedesc = `Your KYC verification is processing. ${respMessage}`
                    await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);

                    await notifyMe(userid, 'KYC Verification', 'user', notedesc);


                    res.json({
                        status: true,
                        message: 'KYC Processing.'
                    });


                } else if (verstatus && verification_status.toLowerCase() == 'completed') {
                    var bvverify = 2;

                    // Log KYC
                    try {
                        const logKYC = await KYC.create({
                            userid: userid, otpcode: '', otptoken: reference, verid: reference, timed: dtimed,
                            verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                            veremail: veremail, bvv: vervalue, avatar: imagefile, verphone: phone_number,
                            status: 1, jsonresp: jsonString, vertype: vertype, provider: 'dojah', tier: 1
                        });

                        if (!logKYC)
                            return res.status(400).json({ status: false, message: "Ouch! Unable to process request, kindly reach out to our support" });

                        //update customer tble with the new access token
                        await Customer.update(
                            { firstname: firstName, lastname: lastName, bvverify: bvverify, accounttier: 1 }, { where: { id: userid } }
                        );

                        const notedesc = `Congratulation! Your KYC verification successfully completed`
                        await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);

                        await notifyMe(userid, 'KYC Verification', 'user', notedesc)

                        // GENERATE ACCOUNT
                        const GenAcct = await genSHAccount(userid, reference, vervalue, '', vertype, hisdob, phone_number, getuser.countrycode);

                        // console.log('GenAcct', GenAcct)

                        var mailcontent = `
                        <p>Congratulations! Your KYC verification on ${process.env.SITENAME} has been verified and approved successfully.</p>
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;

                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                        //GIVE WELCOME BONUS
                        await giveWelcomeBonus(userid);
                        await referralUplineDownlineBonus(userid);

                        if (getuser.countrycode == 'NG') {
                            return res.status(200).json({
                                status: true,
                                message: `Account successfully verified. Kindly proceed to generate your account number`
                            })
                        } else {
                            return res.status(200).json({
                                status: true,
                                message: `Account successfully verified`
                            })
                        }


                    } catch (err) {
                        console.error('Unable to process your request : ', err);
                        return res.status(400).json({ status: false, message: 'Unable to process your request' });
                    }

                } else {
                    var mailcontent = `
                    <p>Ouch! Your KYC verification on ${process.env.SITENAME} has been declined</p>
        
                    <p><i>${respMessage}</i></p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;

                    //send email                
                    await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                    const notedesc = `Your KYC verification failed. ${respMessage}`
                    await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);

                    await notifyMe(userid, 'KYC Verification', 'user', notedesc)

                    res.json({
                        status: false,
                        message: 'Unable to complete verification'
                    });
                }
            } else {
                return res.status(400).json({ status: false, message: 'Unable to process verification' });
            }

        } catch (error) {
            console.error("Error in axios request:", error.message);
            res.status(400).json({ status: false, message: "Provider Error", details: error.response.data });
        }

    } catch (error) {
        console.error('Error kyc validate gen: ', error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
};


async function generateMissingAccounts() {
    console.log("Starting script to generate missing bank accounts...");
    let accountsGenerated = 0;
    let customersProcessed = 0;
    let alreadyHadAccount = 0;
    let kycNotVerified = 0;
    let errorsEncountered = 0;

    try {
        const customers = await Customer.findAll({
            where: {
                bvverify: 2 // Consider only active customers
            }, order: [['id', 'DESC']]
        });
        // SELECT customers.lastname, customers.firstname, customers.email, customers.phoneno, customers.bvverify FROM customers LEFT JOIN  bankaccounts ON bankaccounts.userid = customers.id WHERE  bankaccounts.id IS NULL  AND customers.bvverify = 2;

        if (!customers || customers.length === 0) {
            console.log("No customers found.");
            return;
        }

        console.log(`Found ${customers.length} active customers to process.`);

        for (const customer of customers) {
            customersProcessed++;
            console.log(`\nProcessing customer ID: ${customer.id} - ${customer.email}`);

            // 1. Check KYC status
            // We'll look for a verified BVN or NIN KYC record.
            // genSHAccount requires details from a successful KYC verification.
            const kycRecord = await KYC.findOne({
                where: {
                    userid: customer.id,
                    vertype: 'BVN',
                    [Op.or]: [{ status: 1 }, { status: 2 }],
                },
                order: [['id', 'DESC']] // Get the latest verified record
            });

            if (!kycRecord) {
                console.log(`  - KYC not verified or no BVN/NIN record found for customer ID: ${customer.id}. Skipping.`);
                kycNotVerified++;
                continue;
            }
            console.log(`  - KYC record found (Type: ${kycRecord.vertype}, ID: ${kycRecord.id}, BVN/NIN: ${kycRecord.bvv})`);


            // 2. Check if a bank account already exists
            const existingBankAccount = await Bank.findOne({
                where: {
                    userid: customer.id,
                    provider: 'safehaven', // Assuming SafeHaven is the provider for genSHAccount
                    status: 1 // Active account
                }
            });

            if (existingBankAccount) {
                console.log(`  - Bank account already exists for customer ID: ${customer.id} (Account No: ${existingBankAccount.accountno}). Skipping.`);
                alreadyHadAccount++;
                continue;
            }

            console.log(`  - No existing SafeHaven bank account found. Attempting to generate one.`);

            // 3. Gather details and generate account
            const userId = customer.id;
            const verId = kycRecord.verid; // Verification ID from KYC record
            const bvnOrNin = kycRecord.bvv; // BVN or NIN from KYC record
            const otpCode = ''; // genSHAccount seems to handle empty if not applicable
            const verType = kycRecord.vertype; // 'BVN' or 'NIN'
            const dob = kycRecord.verdob; // Date of birth from KYC
            const verPhone = kycRecord.verphone; // Phone from KYC

            if (!bvnOrNin || !verType) {
                console.error(`  - ERROR: Missing bvn/nin or vertype from KYC record for customer ID: ${customer.id}. Cannot generate account.`);
                errorsEncountered++;
                continue;
            }

            try {
                console.log(`  - Calling genSHAccount with: userId=${userId}, verId=${verId}, bvnOrNin=${bvnOrNin}, verType=${verType}, dob=${dob}, verPhone=${verPhone}`);
                const [success, message, accountName, accountNumber, bankName] = await genSHAccount(
                    userId,
                    verId,
                    bvnOrNin,
                    otpCode,
                    verType,
                    dob,
                    verPhone
                );

                if (success) {
                    console.log(`  - SUCCESS: Account generated for customer ID: ${customer.id}. Account: ${accountNumber} (${accountName}) - ${bankName}. Message: ${message}`);
                    accountsGenerated++;
                } else {
                    console.error(`  - FAILED to generate account for customer ID: ${customer.id}. Reason: ${message}`);
                    errorsEncountered++;
                }
            } catch (genError) {
                console.error(`  - ERROR during genSHAccount for customer ID: ${customer.id}: ${genError.message}`);
                errorsEncountered++;
            }
        }

        console.log("\n--- Script Summary ---");
        console.log(`Total Customers Processed: ${customersProcessed}`);
        console.log(`Accounts Successfully Generated: ${accountsGenerated}`);
        console.log(`Customers Already Had Account: ${alreadyHadAccount}`);
        console.log(`Customers with No Verified KYC: ${kycNotVerified}`);
        console.log(`Errors Encountered: ${errorsEncountered}`);

    } catch (error) {
        console.error("An unexpected error occurred during the script:", error);
    } finally {
        // Close database connection if necessary
        // await db.sequelize.close();
        // console.log("Database connection closed.");
    }
}

// generateMissingAccounts()
//     .then(() => {
//         console.log("Script finished.");
//         process.exit(0);
//     })
//     .catch(err => {
//         console.error("Script failed with error:", err);
//         process.exit(1);
//     });

const regenerateVAccounts = async () => {
    console.log("Starting script to regenerate problematic bank accounts...");

    try {
        // 1. Find all bank accounts matching the criteria.
        const problematicAccounts = await db.bankacct.findAll({
            where: {
                accountno: {
                    [Op.like]: '%602000%'
                },
                provider: 'safehaven', // Assuming these are safehaven accounts
                status: 1 // Only regenerate active accounts
            },
            limit: 1
        });

        if (!problematicAccounts || problematicAccounts.length === 0) {
            console.log("No problematic accounts found matching the criteria.");
            return;
        }

        console.log(`Found ${problematicAccounts.length} problematic accounts to regenerate.`);

        for (const account of problematicAccounts) {
            const { userid, id: bankAccountId, accountno: oldAccountNo, jsonresp: jsonRespStr } = account;

            console.log(`\nProcessing user ID: ${userid} with old account: ${oldAccountNo}`);

            try {
                // 1. Parse the jsonresp to get the identityId and other details.
                let jsonResp;
                try {
                    jsonResp = JSON.parse(jsonRespStr);
                } catch (parseError) {
                    console.error(`  - FAILED: Could not parse jsonresp for account ${oldAccountNo}. Skipping. Error: ${parseError.message}`);
                    continue; // Skip to next account
                }

                const identityId = jsonResp.data ? jsonResp.data.identityId : null;
                const oldBvn = jsonResp.data ? jsonResp.data.bvn : null;

                if (!identityId) {
                    console.error(`  - FAILED: No identityId found in jsonresp for account ${oldAccountNo}. Skipping.`);
                    continue;
                }

                console.log(`  - Extracted identityId: ${identityId} from jsonresp. Old BVN: ${oldBvn}`);


                // 3. Get KYC info needed for regeneration.
                const kycRecord = await KYC.findOne({
                    where: {
                        userid: userid,
                        status: { [Op.or]: [1, 3] }, // Verified KYC
                        [Op.or]: [{ vertype: 'BVN' }, { vertype: 'NIN' }]
                    },
                    order: [['id', 'DESC']]
                });

                if (!kycRecord) {
                    console.error(`  - FAILED: No verified KYC record found for user ID: ${userid}. Cannot regenerate account.`);
                    // Reactivate the old account since we can't create a new one.
                    await db.bankacct.update({ status: 1, inactive: 1 }, { where: { id: bankAccountId } });
                    console.log(`  - Re-activated old bank account for user ${userid} due to missing KYC.`);
                    continue; // Move to the next account
                }

                const [success, message, newAccountName, newAccountNumber, newBankName] = await genSHAccount(
                    userid,
                    identityId,
                    oldBvn,
                    '',
                    'BVN',
                    kycRecord.verdob,
                    kycRecord.verphone
                );

                if (success) {
                    // The genSHAccount function returns true even if an account already exists.
                    // We need to check the message.
                    if (message.includes('Account number already generated')) {
                        // This case should not happen if we deactivated the old one, but as a safeguard:
                        console.warn(`  - WARN: genSHAccount reported an existing account for user ${userid}, but old one was deactivated. New account details: ${newAccountNumber}. Please verify manually.`);
                    } else {
                        console.log(`  - SUCCESS: Regenerated account for user ID: ${userid}. New Account: ${newAccountNumber} (${newAccountName})`);
                    }


                    // 2. Deactivate the old bank account record.
                    await db.bankacct.update(
                        { status: 3, inactive: 0 }, // Set to inactive
                        { where: { id: bankAccountId } }
                    );

                    console.log(`  - Deactivated old bank account (ID: ${bankAccountId}).`);
                } else {
                    console.error(`  - FAILED to regenerate account for user ID: ${userid}. Reason: ${message}`);
                    // Reactivate the old account since regeneration failed.
                    await db.bankacct.update({ status: 1, inactive: 1 }, { where: { id: bankAccountId } });
                    console.log(`  - Re-activated old bank account for user ${userid} due to regeneration failure.`);
                }



            } catch (error) {
                console.error(`  - ERROR processing user ID ${userid}: ${error.message}`);
                // Attempt to reactivate the old account on any error during the process for that user.
                await db.bankacct.update({ status: 1, inactive: 1 }, { where: { id: bankAccountId } });
                console.log(`  - Re-activated old bank account for user ${userid} due to an error.`);
            }
        }

        console.log("\nScript finished.");

    } catch (error) {
        console.error("A critical error occurred in the main script:", error);
    } finally {
        // await db.sequelize.close();
        console.log("Database connection closed.");
    }
};

// regenerateVAccounts()
//     .then(() => {
//         console.log("Script finished.");
//         process.exit(0);
//     })
//     .catch(err => {
//         console.error("Script failed with error:", err);
//         process.exit(1);
//     });

const gen2FA = async (req, res) => {

    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        const checkUser = await Customer.findOne({ where: { id: userid }, attributes: ['firstname', 'lastname'] });

        if (!checkUser)
            return res.json({ status: true, message: 'Unable to process your request at the moment, kindly refresh and try again' });

        const newSecret = twoFactor.generateSecret({ name: 'HitchPay', account: `${checkUser.firstname} ${checkUser.lastname}` });

        // console.log(newSecret)
        qrcode.toDataURL(newSecret.uri, (err, data_url) => {
            if (err) {
                return res.json({ error: 'Error generating QR code' });
            }
            res.json({
                status: true,
                message: 'Generated',
                data: {
                    secret: newSecret.secret,
                    qrCode: data_url,
                    qrlink: newSecret.qr
                }
            });
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("change 2fa setup Error: ", error.message);
    }
}

const verify2FA = async (req, res) => {

    try {
        const { token, secret } = cleanMe(req.body);

        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        if ((!token) || (token == ''))
            return res.status(400).json({ status: false, message: 'Invalid 2FA code entered!' });

        if ((!secret) || (secret == ''))
            return res.status(400).json({ status: false, message: 'Invalid Authentication Token' });


        const checkUser = await Customer.findOne({ where: { id: userid }, attributes: ['firstname', 'lastname'] });

        if (!checkUser)
            return res.json({ status: true, message: 'Unable to process your request at the moment, kindly refresh and try again' });

        const result = twoFactor.verifyToken(secret, token);

        if (result && result.delta === 0) {
            const changeit = await Customer.update({ secretauth: secret }, { where: { id: userid } });

            res.json({ status: true, message: '2FA Successfully Setup' });

        } else {
            res.status(400).json({ status: false, message: 'Unable to validated 2FA Token' });
        }

    } catch (error) {
        console.log("user 2fa verify Error: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}

const deactivate2FA = async (req, res) => {

    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        const { transpin } = req.body

        const checkUser = await Customer.findOne({ where: { id: userid } });

        if (!checkUser)
            return res.json({ status: true, message: 'Unable to process your request at the moment, kindly refresh and try again' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, checkUser.authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Incorrect PIN' });

        var updatprod = await Customer.update({ secretauth: null }, { where: { id: userid } });

        if (!updatprod)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry again later' });

        var mailcontent = `
        <p style="font-size: 16px;">You've just deactivated your account login two factor authentication (2FA) on ${process.env.SITENAME}. </p>
        <p style="font-size: 16px;">If you did not make this request, please contact our support urgently</a></p>`;

        mailSender(checkUser.firstname, `2FA Deactivation Notice`, checkUser.email, mailcontent);

        res.json({ status: true, message: '2FA successfully deactivated' });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("change 2fa deactivation Error: ", error.message);
    }
}


const retryVAccount = async (userid) => {
    try {
        const getkyc = await KYC.findOne({
            order: [['id', 'DESC']],
            where: {
                userid: userid,
                [Op.or]: [{ status: 1 }, { status: 2 }],
                [Op.or]: [{ vertype: 'NIN' }, { vertype: 'BVN' }]
            }
        });


        if (!getkyc) {
            console.log('Kindly complete your account verification to proceed')
            return
        }

        /* CALL CREATE ACCOUNT ENDPOINT */
        var createAccount = await genSHAccount(userid, getkyc.verid, getkyc.bvv, getkyc.otpcode, getkyc.vertype, getkyc.verdob, getkyc.verphone);

        console.log(createAccount, createAccount)
        return;



    } catch (error) {
        console.log("Error acctn gen: ", error.message);
        return
        // res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

const addressKYC = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    // // Fetch user details
    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

    const { address, city, state, houseno, postalcode } = cleanMe(req.body);

    if (!address || address == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to specify your residential address' });
    if (address.length < 10) return res.status(400).json({ status: false, message: 'Oops! Residential address should be more descriptive' });
    if (!city || city == '') return res.status(400).json({ status: false, message: 'Oops! City field is required' });
    if (!postalcode || postalcode == '') return res.status(400).json({ status: false, message: 'Oops! Postal code field is required' });
    if (!state || state == '') return res.status(400).json({ status: false, message: 'Oops! State field is required' });

    //update the record with name since no bvn completed
    var updatedb = await Customer.update({ address, city, state, postalcode, houseno }, { where: { id: userid } });

    if (!updatedb)
        return res.status(400).json({ status: false, message: 'Unable to process your request, try again' });

    res.json({
        status: true,
        message: 'Address Successfully Updated!'
    });
}

const tier2Ver = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    // // Fetch user details
    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

    const { ninbvno, vertype } = cleanMe(req.body);

    if (!vertype || vertype == '') return res.status(400).json({ status: false, message: 'Oops! Verification type is required' });
    if (ninbvno.length < 10) return res.status(400).json({ status: false, message: `Oops! Invalid ${vertype} number` });

    const checkdbvn = await KYC.findOne({
        order: [['id', 'ASC']], where: { bvv: ninbvno, vertype: vertype, status: 1, userid: { [Op.ne]: userid } }
    });

    if (checkdbvn) {
        return res.status(400).json({ status: false, message: `${vertype} already exists with another account` });
    }

    const checkdbvn2 = await KYC.findOne({
        order: [['id', 'ASC']], where: { bvv: ninbvno, vertype: vertype, status: 1 }
    });

    if (checkdbvn2) {
        return res.status(400).json({ status: false, message: `${vertype} already exists` });
    }

    try {
        if (vertype.toLowerCase() == 'bvn') {
            var endpointPath = `${process.env.DOJAH_URL}/api/v1/kyc/bvn/full?bvn=${ninbvno}`;
        } else {
            var endpointPath = `${process.env.DOJAH_URL}/api/v1/kyc/nin?nin=${ninbvno}`;
        }
        const options = {
            method: 'GET',
            url: endpointPath,
            headers: {
                AppId: process.env.DOJAH_APPID,
                Authorization: 'prod_sk_OZsmApDiPseK2zv2BeB0k5lfJ',
                accept: 'application/json',
                'content-type': 'application/json'
            }
        };

        // Make API request
        const response = await axios.request(options);
        const thedata = response.data;

        // console.log('thedata', thedata)

        if (thedata.entity) {
            const jsonString = JSON.stringify(thedata);

            const entity = thedata.entity;

            const first_name = entity.first_name;
            const last_name = entity.last_name;
            const phone_number = entity.phone_number;
            const middle_name = entity.middle_name;
            const date_of_birth = entity.date_of_birth;
            const gender = entity.gender;
            const custnin = entity.nin ? entity.nin : entity.bvn;
            const photo = entity.photo ? entity.photo : entity.image;

            // Log KYC
            const dtimed = Math.floor(Date.now() / 1000);
            try {
                await KYC.create({
                    userid: userid, otpcode: '', otptoken: '', verid: '', timed: dtimed,
                    verfname: first_name, verlname: last_name, verdob: date_of_birth,
                    gender: gender, veremail: '', bvv: ninbvno, avatar: photo,
                    verphone: phone_number, status: 0, jsonresp: jsonString, vertype: vertype.toUpperCase(),
                    provider: 'dojah', tier: 2
                });

                const hisname = getuser.firstname + ' ' + getuser.lastname;
                const vername = first_name + ' ' + last_name;
                // compare name matching
                const matchName = compareNames(hisname, vername);

                // console.log('matchName', matchName)

                if (matchName.score >= 60) {
                    //update as compleed
                    await KYC.update({ status: 1 }, { where: { userid: userid, tier: 2, bvv: custnin } })

                    res.json({
                        status: true,
                        message: `${vertype} successfully verified`
                    });
                } else {
                    return res.status(400).json({ status: false, message: `Unable to verify ${vertype}. Details doesn't match your account KYC details` });
                }

            } catch (err) {
                console.error('tier2kyc: ', err);
                return res.status(400).json({ status: false, message: 'Unable to process your request' });
            }
        }


    } catch (error) {
        console.error("Error in axios request:", error.message);

        // Handle different error types
        if (error.response) {
            // Server responded with a status code outside 2xx
            console.error("Response Data:", error.response.data);
            console.error("Response Status:", error.response.status);
            res.status(400).json({ status: false, message: "Unable to process request at the moment", details: error.response.data });
        } else if (error.request) {
            // No response received (network issue, timeout, etc.)
            console.error("No Response Received");
            res.status(400).json({ status: false, message: "Unable to process request. Please try again later." });
        } else {
            // Other errors (e.g., incorrect config)
            console.error("Axios Configuration Error:", error.message);
            res.status(400).json({ status: false, message: "Internal Server Error" });
        }
    }
}

const submitAddrVer = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

    // const { transpin } = cleanMe(req.body);

    // if (!transpin || transpin == '') return res.status(400).json({ status: false, message: 'Oops! Kindly confirm request' });

    const checkdbvn = await AddrVer.findOne({ where: { userid: userid } });

    if (checkdbvn) {
        return res.status(400).json({
            status: false,
            message: `Request already submitted. You will be notified on the progress`
        });
    }

    const dtimed = Math.floor(Date.now() / 1000);
    const dosubmit = await AddrVer.create({ userid: userid, timed: dtimed, status: 1, tier: 3 });

    if (dosubmit) {
        res.json({
            status: true,
            message: `Address verification request submitted. You will be notified on the progress`
        });

    } else {
        return res.status(400).json({ status: false, message: `Unable to submit request. Kindly try again shortly` });
    }
}



/**
 * Calculates the total wallet balance of ALL customers at a specific point in time.
 * @param {string} targetDate - The date-time string (e.g., '30-09-2025 23:59:59').
 * @param {string} currency - The currency of the wallets (e.g., 'NGN').
 * @returns {Promise<number|null>} The total balance at the specified time, or null on error.
 */
async function getTotalBalanceAtTime(targetDate, currency = 'NGN') {
    const WalletTransactions = db.wallettransactions;

    if (!WalletTransactions) {
        console.error("Transaction model (db.wallettransactions) not found.");
        return null;
    }

    try {
        // 1. Get the sum of all current wallet balances for the specified currency.
        const totalCurrentBalance = await Wallets.sum('wbal', {
            where: { currency: currency }
        });

        if (totalCurrentBalance === null || isNaN(totalCurrentBalance)) {
            console.log(`Could not calculate total current balance for currency: ${currency}`);
            return 0;
        }

        // 2. Convert the target date to a UNIX timestamp.
        const targetTimestamp = moment(targetDate, 'DD-MM-YYYY HH:mm:ss').unix();

        // 3. Find all transactions for all users that happened AFTER the target date.
        const transactionsAfterDate = await WalletTransactions.findAll({
            where: {
                currency: currency,
                status: 'success', // Only consider completed transactions
                timed: {
                    [Op.gt]: targetTimestamp // Greater than the target timestamp
                }
            }
        });

        let totalNetChange = 0;
        for (const trans of transactionsAfterDate) {
            const amount = parseFloat(trans.amount);
            if (trans.transtype === 'credit') {
                // To reverse a credit that happened after the target date, we subtract it.
                totalNetChange -= amount;
            } else if (trans.transtype === 'debit') {
                // To reverse a debit, we add it back.
                totalNetChange += amount;
            }
        }

        // 4. Calculate the historical total balance.
        // The historical balance is the current balance adjusted by the net change.
        const historicalTotalBalance = totalCurrentBalance + totalNetChange;

        return historicalTotalBalance;

    } catch (error) {
        console.error(`Error calculating total balance at time for currency ${currency}:`, error);
        return null;
    }
}

const getHistoricalBalance = async (req, res) => {
    try {
        // Get date and currency from query params, with defaults.
        const { date = '30-09-2025 23:59:59', currency = 'NGN' } = req.query;

        // Call the new function to get the total balance for all customers.
        const totalBalance = await getTotalBalanceAtTime(date, currency);

        if (totalBalance === null) {
            return res.status(500).json({ status: false, message: 'Error calculating total historical balance.' });
        }

        res.json({
            status: true,
            message: `Total balance for all customers calculated successfully.`,
            data: {
                asOfDate: date,
                currency: currency,
                totalBalance: totalBalance.toFixed(2)
            }
        });
    } catch (error) {
        console.error("getHistoricalBalance Error: ", error.message);
        res.status(500).json({ status: false, message: 'An error occurred while processing your request.' });
    }
};

const generatePaymentQRCode = async (req, res, next) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getuser = await Customer.findOne({
            where: { id: userid },
            attributes: ['id', 'firstname', 'lastname', 'phoneno'],
        });
        if (!getuser)
            return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

        // Construct the payment URL
        const paymentUrl = `https://apps.hitchpay.ng/T2JB/qrpay/?phone=${getuser.phoneno}`;

        // Generate the QR code as a data URI
        const qrCodeDataUri = await qrcode.toDataURL(paymentUrl);

        res.json({
            status: true,
            message: `Payment QR code generated successfully`,
            data: {
                customerName: `${getuser.firstname} ${getuser.lastname}`,
                paymentUrl: paymentUrl,
                qrCode: qrCodeDataUri,
            }
        });

    } catch (err) {
        logger.error('Error in generatePaymentQRCode:', err);
        next(err);
    }
};

const validatMFAAuth = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { authcode } = cleanMe(req.body);

    if ((!authcode) || (authcode == ''))
        return res.status(400).json({ status: false, message: 'No 2FA code entered!' });

    var ownerid = userid;
    const userinfo = await getUserInfo(ownerid);

    /* CHECK 2FA */
    if ((userinfo.secretauth == null || userinfo.secretauth == '')) {
        return res.status(400).json({ status: false, message: '2FA not setup on the account. Kindly setup your 2FA' });
    }

    const result = twoFactor.verifyToken(userinfo.secretauth, authcode);

    if (result) {
        if (result.delta === null || result.delta < 0) {
            var eligible = false;
        } else {
            var eligible = true;
        }
    } else {
        var eligible = false;
    }


    if (eligible) {
        const acessexp = '5m';

        //console.log(userinfo.id)
        const jwtToken = jwt.sign({
            id: userinfo.id, email: userinfo.email,
            jti: randomstring.generate(16)
        }, process.env.JWT_SECRET, { expiresIn: acessexp });

        // log the token to otpVer table
        const logToken = await otpVer.create({
            userid: userinfo.id, usertype: 'user', otpcode: '',
            token: jwtToken, otptype: 'transauth', status: 0, regphone: '', regemail: '',
            timed: Math.floor(Date.now() / 1000)
        });

        if (!logToken) {
            return res.status(400).json({ status: false, message: 'Unable to process request at the moment' });
        }

        res.json({
            status: true,
            message: `Account Successfully Authenticated`,
            data: {
                token: jwtToken,
                tokenType: 'transauth',
                expiresInSec: 300 // 5 minutes
            }
        });

    } else {
        res.status(400).json({ status: false, message: 'Invalid 2FA authentication code' });
    }
}


// retryVAccount(9739)
//     .then(() => {
//         console.log("Script finished.");
//         process.exit(0);
//     })
//     .catch(err => {
//         console.error("Script failed with error:", err);
//         process.exit(1);
//     });


module.exports = {
    initAccount, verifyAccount, setUpAccount, setupPIN, loginUser, auth2faUser, userInfo, getNotification,
    updateProfile, updatePass, uploadPix, resetPIN, verifyPinRecover, RecoverPIN, getFriends,
    removeNotify, resetPass, verifyPassRecover, recoverMyPass, validateBVN,
    verifyBVOTP, updatePin, ipAddress, createVAccount, validatePhoto,
    myAccountList, getAuthToken, resendOTP, miniAccount, delAccount, tier2KYC, tier2bKYC, tierBankStmt, kycStatus,
    viewNotify, updPromoCode, logoutUser, validatePIN, AppSetting, InitvalidateBVN, verifyKYCDojah,
    gen2FA, verify2FA, deactivate2FA, retryVAccount, regenerateVAccounts, addressKYC, tier2Ver, submitAddrVer,
    showAds, InterPassUpload, getHistoricalBalance, generatePaymentQRCode, validatMFAAuth
};