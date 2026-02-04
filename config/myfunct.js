const db = require('../models')
const { json } = require('sequelize');
const { dispatchEvent } = require('../utils/webhookService');
const { Op, fn } = require("sequelize");
const http = require('https');
const jwt = require("jsonwebtoken");
const axios = require('axios');
const crypto = require('crypto');
const randomstring = require("randomstring");
const moment = require('moment');
const { getUserInfo, getBizInfo} = require("./userdetails");
const { sendSMS, sendWhatsApp, pushNotify, notifyMe } = require("./notifyuser");
const { mailSender } = require("./mailsender");
const md5 = require('md5');
const { ExtractJwt } = require('passport-jwt'); // Helper to extract token
const { logger } = require('../config/logger');
const { ycRequest } = require('../controllers/crossBorderControllers/ycauth');
// const { ycRequest } = require('../config/ycClient'); // Corrected import path

const PricingFee = db.pricing;
const PayLimit = db.translimit
const Payn = db.payn
const Wallets = db.wallets;
const Bank = db.bankacct;
const AppSett = db.appsettings;
const logEarning = db.earnings;
const Customer = db.customers;
const BonusTask = db.bonusTask;
const UserBonusProgress = db.bonusprogress;
const BonusCategory = db.bonuscategory;
const AcctRequest = db.accountrequest;
const bonusCoupon = db.bonusCoupon;
const KycDoc = db.kycdoc;
const KYC = db.kyc;
const LogRequest = db.logrequest;
const CardUser = db.kadusers
const VCard = db.vkads;
const otpVer = db.verotp;


const formatAmount = (nStr, n = 2) => {
    let a = `${parseFloat(nStr).toFixed(n)}`;
    a += "";
    let x = a.split(".");
    let x1 = x[0];
    let x2 = x.length > 1 ? "." + x[1] : ".00";
    let rgx = /(\d+)(\d{3})/;
    while (rgx.test(x1)) {
        x1 = x1.replace(rgx, "$1" + "," + "$2");
    }

    return x1 + x2;
}

function cleanMe(input) {
    if (typeof input === 'string') {
        // Sanitize strings
        let cleanedString = input
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            // .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/\//g, '&#x2F;')
            .replace(/\\/g, '&#x5C;')
            .replace(/--/g, '')
            .replace(/;/g, '')
            .replace(/%/g, '&#37;')
            .replace(/OR\s+1\s*=\s*1/gi, '')
            .replace(/AND\s+1\s*=\s*1/gi, '')
            .replace(/UNION\s+SELECT/gi, '')
            .replace(/UNION\s+ALL\s+SELECT/gi, '')
            .replace(/INFORMATION_SCHEMA/gi, '')
            .replace(/system_user/gi, '')
            .replace(/current_user/gi, '')
            .replace(/database\(\)/gi, '')
            .replace(/version\(\)/gi, '')
            .replace(/alert/gi, '') // Remove alert keyword
            .replace(/script/gi, '') // Remove script keyword
            .replace(/iframe/gi, '') // Remove iframe keyword
            .replace(/onerror/gi, '') // Remove onerror keyword
            .replace(/onload/gi, '') // Remove onload keyword
            .replace(/onmouseover/gi, '') // Remove onmouseover keyword
            .replace(/onmouseout/gi, '') // Remove onmouseout keyword
            .replace(/javascript:/gi, '') //remove javascript: keyword
            .replace(/vbscript:/gi, '') //remove vbscript: keyword
            .replace(/expression/gi, '')//remove expression keyword
            .replace(/eval/gi, '') //remove eval keyword
            .trim();
        return cleanedString;
    } else if (input && typeof input === 'object' && !Buffer.isBuffer(input)) {
        // Recursively sanitize plain objects and arrays.
        // !Buffer.isBuffer check prevents trying to sanitize file buffers.
        // We must check if the input is not null before trying to iterate over its keys.
        for (const key in input) {
            // Use a safer check for properties on objects that might have a null prototype.
            if (Object.prototype.hasOwnProperty.call(input, key)) {
                input[key] = cleanMe(input[key]); // Recursively clean each property.
            }
        }
        return input;
    }
    // Return other types (numbers, booleans, null, undefined) as-is
    return input;
}

function cleanMe2(input) {
    return input
}

const sanitizeInput = (obj) => {
    for (let key in obj) {
        if (typeof obj[key] === 'object' && obj[key] !== null) {
            sanitizeInput(obj[key]); // Recursively sanitize nested objects
        } else if (typeof obj[key] === 'string') {
            obj[key] = obj[key].replace(/[<>]/g, ''); // Remove dangerous characters like < >
        }
    }
}

async function generatePassword() {
    const thpass = randomstring.generate({
        length: 10,  // 10-character long password
        charset: 'alphanumeric', // use alphanumeric characters
    });

    return thpass;
}

async function generateRegCode(rowId, length = 3) {
    const dcode = String(rowId).padStart(length, '0');
    return dcode;
}

function formatPhoneNumber(phone) {
    // Remove all non-numeric characters
    phone = phone.replace(/\D/g, "");

    // Check if number starts with "234" (Nigeria's country code)
    if (phone.startsWith("234") && phone.length === 13) {
        return `+${phone}`;
    }
    if (phone.startsWith("+234") && phone.length === 13) {
        return `+${phone}`;
    }

    // If number starts with "0", replace it with "+234"
    if (phone.startsWith("0") && phone.length === 11) {
        return `+234${phone.substring(1)}`;
    }

    // If number is 10 digits (without leading 0), add "+234"
    if (phone.length === 10) {
        return `+234${phone}`;
    }

    // If number is already in international format
    if (phone.startsWith("+")) {
        return phone;
    }

    return phone;
}

const shAcessToken = async () => {
    try {
        const options = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/oauth2/token`,
            headers: { accept: 'application/json', 'content-type': 'application/json' },
            data: {
                grant_type: 'client_credentials',
                client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
                client_id: process.env.SHCLIENTID,
                client_assertion: process.env.SH_CLIENT_ASCERTION
            }
        };
    
        let response = await axios.request(options);
        let thedata = response.data;

        // console.log('shktoken reps', thedata)

        const jsonString = JSON.stringify(thedata);
        if (!thedata.access_token) {
            console.log('shtokn', 'failed')
            return [false, '', '', '', ''];
        } else {
            console.log('shtokn', 'success')
            const access_token = thedata.access_token
            const expires_in = thedata.expires_in
            const client_id = thedata.client_id
            const refresh_token = thedata.refresh_token
            const ibs_client_id = thedata.ibs_client_id
            const ibs_user_id = thedata.ibs_user_id
            return [true, access_token, ibs_client_id, ibs_user_id, refresh_token];
        }

    } catch (error) {
        logger.error('shtoken', error)
    }
}

const ucFirst = (str) => {
    // console.log(str)
    if (!str) return str; // Handle empty strings
    return str.charAt(0).toUpperCase() + str.slice(1);
}

function validatePassword(password) {
    // Regex Explanation:
    // (?=.*[A-Z])          - At least one uppercase letter
    // (?=.*[a-z])          - At least one lowercase letter
    // (?=.*\d)             - At least one number
    // (?=.*[\W_])          - At least one special character
    // (?!.*\s)             - Disallow spaces
    // [A-Za-z\d\W_]{6,}    - At least 6 characters (letters, numbers, special chars)
    const regex = /^(?!.*\s)(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*[\W_])[A-Za-z\d\W_]{8,}$/;
    return regex.test(password);
}

/**
 * Validates a Nigerian CAC (Corporate Affairs Commission) registration number.
 * It checks for a valid prefix (RC, BN, IT) followed by at least 6 digits.
 * @param {string} cacNumber - The CAC number to validate.
 * @returns {boolean} - True if the format is valid, false otherwise.
 */

function validateCacNumber(cacNumber) {
    if (!cacNumber || typeof cacNumber !== 'string') {
        return false;
    }
    // Regex Explanation:
    // ^           - Start of the string
    // (RC|BN|IT)  - Matches 'RC', 'BN', or 'IT' (case-insensitive due to 'i' flag)
    // \s*         - Allows for zero or more spaces between prefix and numbers
    // \d{6,}      - Matches at least 6 digits
    // $           - End of the string
    // i           - Case-insensitive flag
    const cacRegex = /^(RC|BN|IT)\s*\d{6,}$/i;
    return cacRegex.test(cacNumber.trim());
}


const getFee = async (product, transamount, tier = 1) => {
    try {
        const feeData = await PricingFee.findOne({
            where: {
                product: product,
                tierlevel: tier,
                [Op.or]: [
                    {
                        min_amount: { [Op.lte]: transamount || 0 },
                        max_amount: { [Op.gte]: transamount || Number.MAX_SAFE_INTEGER }
                    },
                    { min_amount: null, max_amount: null } // For products without a range
                ]
            }
        });

        if (!feeData) {
            // throw new Error(`No pricing fee found for ${product}`);
            return [0, 0, ''];
        }

        let fee = 0; let providerfee = 0; let valueAddedTax = 0;
        if (feeData.feetype === 'fixed') {
            fee = feeData.fee;
            providerfee = feeData.providerfee
        } else if (feeData.feetype === 'percentage') {
            fee = (transamount * feeData.fee_percentage) / 100;
            providerfee = (transamount * feeData.providerfee) / 100;
        }

        // Cap the fee if a totalfee_cap is set and the calculated fee exceeds it.
        const totalFeeCap = parseFloat(feeData.totalfee_cap);
        if (!isNaN(totalFeeCap) && fee > totalFeeCap) {
            fee = totalFeeCap;
        }

        // Cap the provider fee if a providerfee_cap is set and the calculated fee exceeds it.
        const providerFeeCap = parseFloat(feeData.providerfee_cap);
        if (!isNaN(providerFeeCap) && providerfee > providerFeeCap) {
            providerfee = providerFeeCap;
        }

        if(fee > 0 && process.env.VAT){
            valueAddedTax = (fee * parseFloat(process.env.VAT)) / 100;
        }
        

        return [fee, providerfee, feeData.feetype, valueAddedTax];

    } catch (error) {
        console.error(error.message);
        return [0, 0, ''];
    }
}


const getTransferFee = async () => {
    try {
        const feeData = await PricingFee.findAll({ where: { product: 'transfer' } });

        if (!feeData) {
            throw new Error(`No pricing fee found for ${product}`);
        }

        var dataInfo = await Promise.all(feeData.map(async (info) => {
            var min_amount = info.min_amount;
            var max_amount = info.max_amount;
            var providerfee = info.providerfee;
            var fee = info.fee;
            var fee_percentage = info.fee_percentage;
            var feetype = info.feetype;

            let dfee = 0; let dproviderfee = 0;
            if (feetype === 'fixed') {
                dfee = fee;
                dproviderfee = providerfee
            } else if (feetype === 'percentage') {
                dfee = (transamount * fee_percentage) / 100;
                dproviderfee = (transamount * providerfee) / 100;
            }

            // Cap the fee if a totalfee_cap is set and the calculated fee exceeds it.
            const totalFeeCap = parseFloat(info.totalfee_cap);
            if (!isNaN(totalFeeCap) && dfee > totalFeeCap) {
                dfee = totalFeeCap;
            }
            // Cap the provider fee if a providerfee_cap is set and the calculated fee exceeds it.
            const providerFeeCap = parseFloat(info.providerfee_cap);
            if (!isNaN(providerFeeCap) && dproviderfee > providerFeeCap) {
                dproviderfee = providerFeeCap;
            }


            return { minamount: min_amount, maxamount: max_amount, fee: dfee }

        }))

        return dataInfo;

    } catch (error) {
        console.error(error.message);
        return null;
    }
}


const TransLimit = async (tier) => {
    try {
        if (!tier || tier == '' || tier == null)
            return [false, 0, 0, 0, 0, 0, 'null'];

        const tiertype = `Tier ${tier}`;   //e.g Tier 2
        const getdlimt = await PayLimit.findOne({ where: { tiertype: tiertype } });

        // console.log(tier)

        if (!getdlimt)
            return [false, 0, 0, 0, 0, 0, 'not found'];

        var inflowlimit = getdlimt.maxinflow;
        var transferlimit = getdlimt.maxtransfer;
        var dailytrans = getdlimt.dailymaxtrans;
        var free_transfer = getdlimt.freetransfer;
        var free_inflows = getdlimt.free_inflows;

        return [true, inflowlimit, transferlimit, dailytrans, free_transfer, free_inflows, 'Success']

    } catch (error) {
        return [false, 0, 0, 0, 0, 0, error.message];
    }
}


const FreeTransfersCount = async (userid) => {
    const startOfMonth = moment().startOf('month').unix();
    const endOfMonth = moment().endOf('month').unix(); // End of the current month (UNIX timestamp)

    const freeTransfers = await Payn.count({
        where: {
            userid: userid,
            paytype: 'debit',
            pfor: 'transfer',
            status: 1,
            fee: 0,
            timed: { [Op.between]: [startOfMonth, endOfMonth] },
            ntwkid: { [Op.ne]: 'hitchpay' }
        }
    });

    // console.log(freeTransfers);
    return freeTransfers;
}

async function updateBalanceCLOSED(userId, amount, currency, type, options = {}, isswap = false) {

    const { transaction } = options; // Expect transaction to be passed
    if (!userId || !amount || !currency || !type) {
        throw new Error('Missing required parameters for wallet update');
    }

    let currentBalance = 0;
    var wallet = await Wallets.findOne({
        where: { uid: userId, currency: currency },
        transaction: transaction,
        lock: transaction.LOCK.UPDATE // Add pessimistic lock
    });

    if (!wallet && !isswap) {
        throw new Error(`Wallet not found for user ${userId} and currency ${currency}.`);
    }

    if (!wallet && isswap) {
        // Use findOrCreate to avoid race conditions on wallet creation
        let dtimed = Math.floor(Date.now() / 1000);
        var [wallet, created] = await Wallets.findOrCreate({
            where: { uid: userId, currency: currency },
            defaults: { email: '', wbal: 0, timecreated: dtimed, lastupdated: dtimed, status: 1 },
            transaction: transaction,
            lock: transaction.LOCK.UPDATE
        });
        currentBalance = parseFloat(wallet.wbal);
    } else {
        currentBalance = parseFloat(wallet.wbal);
    }

    const numericAmount = parseFloat(amount); // Ensure amount is a number
    console.log('currentBalance', currentBalance)
    // console.log('currentBalance', numericAmount)

    let newBalance;
    if (type === 'debit') {
        if (currentBalance < numericAmount) {
            throw new Error(`Insufficient funds for user ${userId}. 
            Current balance: ${currentBalance}, Amount to debit: ${numericAmount}.`);
        }
        newBalance = currentBalance - numericAmount;
    } else if (type === 'credit') {
        newBalance = currentBalance + numericAmount;
    } else {
        throw new Error(`Invalid transaction type: ${type}. Must be 'debit' or 'credit'.`);
    }

    const [affectedRows] = await Wallets.update(
        { wbal: newBalance, lastupdated: Math.floor(Date.now() / 1000) }, {
        where: { uid: userId, currency: currency },
        transaction: transaction
    }
    );

    if (affectedRows === 0) {
        // This case should ideally not happen if the findOne above succeeded,
        // but it's a safeguard.
        throw new Error(`Failed to update wallet balance for user ${userId}. No rows affected.`);
    }

    console.log('newBalance89', newBalance)

    return newBalance; // Return the calculated new balance
}

/**
 * Atomically updates a user's wallet balance.
 * This function is transaction-aware. If a transaction is passed in the options,
 * it will use it. Otherwise, it will create its own managed transaction to ensure atomicity.
 *
 * @param {number} userId - The ID of the user.
 * @param {number|string} amount - The amount to credit or debit.
 * @param {string} currency - The currency of the wallet (e.g., 'NGN').
 * @param {'credit'|'debit'} type - The type of transaction.
 * @param {object} [options={}] - Optional parameters.
 * @param {Sequelize.Transaction} [options.transaction] - An existing Sequelize transaction.
 * @param {boolean} [isswap=false] - If true, creates a wallet if it doesn't exist.
 * @returns {Promise<number>} The new balance of the wallet.
 */


async function updateBalance(userId, amount, currency, type, options = {}, isswap = false, usertype = 'personal') {
    const { transaction } = options;

    const operation = async (t) => {
        if (!userId || amount === undefined || amount === null || !currency || !type) {
            throw new Error('Missing required parameters for wallet update');
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount)) {
            throw new Error(`Invalid amount provided: ${amount}`);
        }

        let wallet = await Wallets.findOne({
            where: { uid: userId, currency: currency, usertype: usertype },
            transaction: t,
            lock: t.LOCK.UPDATE // Pessimistic lock to prevent race conditions
        });

        if (!wallet) {
            if (isswap) {
                const now = Math.floor(Date.now() / 1000);
                [wallet] = await Wallets.findOrCreate({
                    where: { uid: userId, currency: currency, usertype: usertype },
                    defaults: { email: '', wbal: 0, ledger: 0, timecreated: now, lastupdated: now, status: 1, usertype: usertype },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
            } else {
                throw new Error(`Wallet not found for user ${userId} and currency ${currency}.`);
            }
        }

        const currentBalance = parseFloat(wallet.wbal) || 0;

        let newBalance;
        if (type === 'debit') {
            if (currentBalance < numericAmount) {
                throw new Error(`Insufficient funds for user ${userId}. Current balance: ${currentBalance}, Amount to debit: ${numericAmount}.`);
            }
            newBalance = currentBalance - numericAmount;
        } else if (type === 'credit') {
            newBalance = currentBalance + numericAmount;
        } else {
            throw new Error(`Invalid transaction type: ${type}. Must be 'debit' or 'credit'.`);
        }

        const [affectedRows] = await Wallets.update(
            { wbal: newBalance, lastupdated: Math.floor(Date.now() / 1000) },
            { where: { id: wallet.id }, transaction: t }
        );

        if (affectedRows === 0) {
            throw new Error(`Failed to update wallet balance for user ${userId}. Wallet row was locked but not updated.`);
        }

        return newBalance;
    };

    // If a transaction is already provided, use it. Otherwise, create a new one.
    if (transaction) {
        return await operation(transaction);
    } else {
        // console.warn(`[updateBalance] Warning: Running without a parent transaction for user ${userId}. Creating a new one.`);
        return await db.sequelize.transaction(operation);
    }
}


async function updateLedgerBalance(userId, amount, currency, type, options = {}, isswap = false, usertype = 'personal', transactionMode = 'live') {
    
    const { transaction } = options;

    const operation = async (t) => {
        if (!userId || amount === undefined || amount === null || !currency || !type) {
            throw new Error('Missing required parameters for wallet update');
        }

        const numericAmount = parseFloat(amount);
        if (isNaN(numericAmount)) {
            throw new Error(`Invalid amount provided: ${amount}`);
        }

        // Select the correct wallet model based on the transaction mode
        // const WalletModel = transactionMode === 'test' ? db.testwallet : db.wallets;
        const WalletModel = db.wallets;

        let wallet = await WalletModel.findOne({
            where: { uid: userId, currency: currency, usertype: usertype },
            transaction: t,
            lock: t.LOCK.UPDATE // Pessimistic lock to prevent race conditions
        });

        if (!wallet) {
            if (isswap) {
                const now = Math.floor(Date.now() / 1000);
                [wallet] = await WalletModel.findOrCreate({
                    where: { uid: userId, currency: currency, usertype: usertype},
                    defaults: { email: '', wbal: 0, ledger: 0, timecreated: now, lastupdated: now, status: 1, usertype: usertype },
                    transaction: t,
                    lock: t.LOCK.UPDATE
                });
            } else {
                throw new Error(`Wallet not found for user ${userId} and currency ${currency}.`);
            }
        }

        const currentBalance = parseFloat(wallet.ledger) || 0;

        let newBalance;
        if (type === 'debit') {
            if (currentBalance < numericAmount) {
                throw new Error(`Insufficient funds for user ${userId}. Current balance: ${currentBalance}, Amount to debit: ${numericAmount}.`);
            }
            newBalance = currentBalance - numericAmount;
        } else if (type === 'credit') {
            newBalance = currentBalance + numericAmount;
        } else {
            throw new Error(`Invalid transaction type: ${type}. Must be 'debit' or 'credit'.`);
        }

        const [affectedRows] = await WalletModel.update(
            { ledger: newBalance, lastupdated: Math.floor(Date.now() / 1000) },
            { where: { id: wallet.id}, transaction: t }
        );

        if (affectedRows === 0) {
            throw new Error(`Failed to update ledger balance for user ${userId}. Ledger row was locked but not updated.`);
        }

        return newBalance;
    };

    // If a transaction is already provided, use it. Otherwise, create a new one.
    if (transaction) {
        return await operation(transaction);
    } else {
        // console.warn(`[updateBalance] Warning: Running without a parent transaction for user ${userId}. Creating a new one.`);
        return await db.sequelize.transaction(operation);
    }
}


const genSHAccount = async (userid, verid, bvnno, otpcode, vertype, dob = '', verphone = '', countrycode = 'NG') => {
    try {

    // if(countrycode != 'NG'){
    //     return [false, `Unable to create NGN account for ${countrycode} customer`, '', '', ''];
    // }

    const getacct = await Bank.findOne({ where: { userid: userid, provider: 'safehaven', status: 1 } });

    if (getacct)
        return [false, `Account number already generated`, getacct.accountname, getacct.accountno, getacct.bankname]

    const gettoken = await shAcessToken();
    if (gettoken[0]) {
        var access_token = gettoken[1]
        var ibs_client_id = gettoken[2]
        var ibs_user_id = gettoken[3]

        const txref = md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);

        /* CALL USER DETAILS */
        const userinfo = await getUserInfo(userid);
        const useremail = userinfo.email;
        const fname = userinfo.firstname;
        const userphoneno = verphone == '' ? formatPhoneNumber(userinfo.phoneno) : formatPhoneNumber(verphone);

        // if(vertype == 'NIN'){
        //     //modify the dob
        //     const momentDate = moment(dob, 'YYYY-MM-DD');
        //     var dateOfBirth = momentDate.format('DD-MM-YYYY');
        //     console.log('dateOfBirth', dateOfBirth)
        // }else{
        //     var dateOfBirth = dob;
        //     console.log('dateOfBirthBVN', dateOfBirth)
        // }

        const momentDate = moment(dob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');
        // console.log('dateOfBirthReal', dob)
        // console.log('modifiydateOfBirth', dateOfBirth)

        const options = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/accounts/v2/subaccount`,
            headers: {
                accept: 'application/json',
                ClientID: ibs_client_id,
                'content-type': 'application/json',
                authorization: `Bearer ${access_token}`
            },
            data: {
                phoneNumber: userphoneno,
                emailAddress: useremail,
                identityType: vertype,
                autoSweep: true,
                autoSweepDetails: { schedule: 'Instant', accountNumber: process.env.SH_DEBITACCOUNT },
                externalReference: `HTCH${userid}`,
                identityNumber: bvnno,
                dateOfBirth: dateOfBirth,
                booleanMatch: true
            }
        };

        // console.log('data', options)

        let response = await axios.request(options);
        let thedata = response.data;
        // console.log('thedata', thedata)

        if (thedata.statusCode == 200) {
            const jsonString = JSON.stringify(thedata);

            var accountid = thedata['data']['_id'];
            var accountNumber = thedata['data']['accountNumber'];
            var accountName = thedata['data']['accountName'];
            var accountType = thedata['data']['accountType']; //current
            var currencyCode = thedata['data']['currencyCode'];
            var identityId = thedata['data']['identityId'];
            var accountBalance = thedata['data']['accountBalance'];
            var isSubAccount = thedata['data']['isSubAccount'];
            var subAccountDetails = thedata['data']['subAccountDetails'];

            var verfname = subAccountDetails['firstName'].trim();
            var verlname = subAccountDetails['lastName'].trim();
            var veremail = subAccountDetails['emailAddress'].trim();

            var bankname = 'Safe Haven MFB';
            var bankcode = '090286';

            const createAccount = await Bank.create({
                userid: userid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, 
                bankcode: bankcode, trackid: accountid, trackingref: accountid, jsonresp: jsonString, accounttype: accountType, 
                provider: 'safehaven', currency: 'NGN', usertype: 'personal'
            }).catch((err) => {
                return { status: false, message: 'Unable to process your request : ' + err };
            });

            if (createAccount) {
                var thecontent = `
                 <div>
                <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got New Account Number</h3>
                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Hello ${fname} </p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        Congratulations! A virtual account number has been generated for you on <strong>HitchPay</strong>. Get instant wallet funding when you pay into your dedicated account number.
                    </p>

                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                </div>
                `;

                mailSender(fname, 'Virtual Account', useremail, thecontent);

                /* send SMS */
                const msg = `Hi! ${bankname} account number has been generated for you on HitchPay. Get instant wallet funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

                await sendSMS(userinfo.phoneno, msg);

                await pushNotify(userid, 'Virtual Account', msg);

                return [true, `Account number generated`, accountName, accountNumber, bankname]

            } else {
                return [false, `Unable to process identity validation and account creation`, '', '', '']
            }

        } else {
            // return [false, thedata.message, '', '', '']
            return [false, 'Unable to generate account number at the moment', '', '', '']
        }

    } else {
        return [false, `Something went wrong, kindly try again`, '', '', '']

    }
    }catch(error){

        console.log('error', error)
        logger.error('genSHAccount Error:', error);
        return [false, `Unable to generate account number at the moment`, '', '', '']
    }   

}


const genProvidusAccount = async (userid, bvvno) => {
    try {

        /* CALL USER DETAILS */
        const userinfo = await getUserInfo(userid);
        const useremail = userinfo.email;
        const fname = `${userinfo.firstname}`;
        const fullname = `${userinfo.firstname} ${userinfo.lastname}`;

        // const ClientId = process.env.PRVDS_CLIENT_ID;
        // const ClientSecret = process.env.PRVDS_CLIENT_SECRET;
        const ClientId = "dGVzdF9Qcm92aWR1cw==";
        const ClientSecret = "29A492021F4B709A8D1152C3EF4D32DC5A7092723ECAC4C511781003584B48873CCBFEBDEAE89CF22ED1CB1A836213549BC6638A3B563CA7FC009BEB3BC30CF8";

        if (!ClientId || !ClientSecret) {
            logger.error('Providus client ID or secret is not configured.');
            return [false, `Banking service is currently not available`, '', '', '']
        }

        // Dynamically generate the signature
        const XAuthSignature = crypto.createHash('sha512').update(`${ClientId}:${ClientSecret}`).digest('hex').toLocaleUpperCase();

        // Use dynamic payload from request body
        const payload = {
            "account_name": fullname,
            "bvn": bvvno
        };

        const options = {
            method: 'POST',
            maxBodyLength: `Infinity`,
            // url: `${process.env.PRVDS_BASEURL}/PiPCreateReservedAccountNumber`,
            url: `http://154.113.16.142:8088/appdevapi/api/PiPCreateReservedAccountNumber`,
            headers: {
                'Client-Id': ClientId,
                'X-Auth-Signature': XAuthSignature,
                'Content-Type': 'application/json'
            },
            data: JSON.stringify(payload)
        };
        

        // Make API request
        const response = await axios.request(options);
        const responseData = response.data;
        const jsonString = JSON.stringify(responseData);

        if(responseData && responseData.requestSuccessful && responseData.responseCode === '00'){
            var accountNumber = responseData.account_number
            var accountName = responseData.account_name
            var accountType = 'individual';
            var bankname = 'Providus Bank';
            var bankcode = '101';

            const createAccount = await Bank.create({
                userid: userid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, 
                bankcode: bankcode, trackid: userid, trackingref: userid, jsonresp: jsonString, accounttype: accountType, 
                provider: 'providus', currency: 'NGN', usertype: 'personal'
            });

               if (createAccount) {
                var thecontent = `
                 <div>
                <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got New Account Number</h3>
                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Hello ${fname} </p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        Congratulations! A providus bank account number has been generated for you on <strong>HitchPay</strong>. Get instant wallet funding when you pay into your dedicated account number.
                    </p>

                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                </div>
                `;

                mailSender(fname, 'Virtual Account', useremail, thecontent);

                /* send SMS */
                const msg = `Hi! ${bankname} account number has been generated for you on HitchPay. Get instant wallet funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

                await pushNotify(userid, 'New Banking Account', msg);

                return [true, `Account number generated`, accountName, accountNumber, bankname]

            } else {
                return [false, `Unable to process identity validation and account creation`, '', '', '']
            }
            
        }else{
            return [false, 'Unable to generate account number at the moment', '', '', '']
        }

    } catch (error) {
        logger.error('genProvidusAccount Error:', error);
        return [false, `Network Error, kindly try again`, '', '', '']
    }
}

const genGTBankAccount = async (userid, getkyc) => {

    try{
    const getacct = await Bank.findOne({ where: { userid: userid, provider: 'gtbank', status: 1 } });
    if (getacct)
        return [false, `Account number already generated`, getacct.accountname, getacct.accountno, getacct.bankname]

    const getuser = await Customer.findOne({ where: { id: userid, status: 1} });
    
    if (!getuser)
        return [false, 'Customer details not found. Kindly reload page', '', '', ''];

    const firstname = getuser.firstname;
    const lastname = getuser.lastname;
    const email = getuser.email;
    const address = getuser.address;
    const bvnno = getkyc.bvv;
    const dob = getkyc.verdob;
    const gender = getkyc.gender;
    const phoneno = getuser.phoneno;
    
    // Format phone number to 11 digits with leading 0
    let formattedPhoneno = phoneno.replace(/\D/g, ''); // Remove all non-numeric characters
    if (formattedPhoneno.startsWith('234')) {
        formattedPhoneno = '0' + formattedPhoneno.substring(3);
    } else if (!formattedPhoneno.startsWith('0') && formattedPhoneno.length === 10) {
        formattedPhoneno = '0' + formattedPhoneno;
    }
    // Ensure it's 11 digits
    if (formattedPhoneno.length !== 11) {
        return [false, 'Invalid phone number format for GTBank account creation. Must be 11 digits with leading 0.', '', '', ''];
    }

    const momentDate = moment(dob, 'YYYY-MM-DD');
    var dateOfBirth = momentDate.format('DD/MM/YYYY');

    //validate each fields separately
    if(!firstname)
        return [false, 'Kindly update your first name', '', '', ''];
    if(!lastname)
        return [false, 'Kindly update your last name', '', '', ''];
    if(!email)
        return [false, 'Email is required', '', '', ''];
    if(!address)
        return [false, 'Kindly update your address verification', '', '', ''];
    if(!bvnno)
        return [false, 'Kindly verify your BVN', '', '', ''];
    if(!dob)
        return [false, 'Date of birth is required', '', '', ''];
    if(!gender)
        return [false, 'Gender is required', '', '', ''];
    if(!phoneno)
        return [false, 'Phone number is required', '', '', ''];


    const payload = {
            customer_identifier: `HTCH${userid}`,
            first_name: firstname,
            last_name: lastname,
            mobile_num: formattedPhoneno,
            email: email,
            bvn: bvnno,
            dob: dateOfBirth,
            address: address,
            gender: gender.toLowerCase() == 'male' ? '1' : '2',
            beneficiary_account: !process.env.SQD_BENECIARY_ACCOUNT ? "4920299492" : process.env.SQD_BENECIARY_ACCOUNT
    };

    console.log('payload', payload)

    const options = {
        method: 'POST',
        url: `${process.env.SQD_URL}/virtual-account`,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.SQD_SKEY}`
        },
        data: payload
    };
    let response = await axios.request(options);
    let thedata = response.data;

    console.log('thedata', thedata)
    
    if (thedata.success && thedata.data) {
        var first_name = thedata.data.first_name;
        var last_name = thedata.data.last_name;
        // var bank_code = thedata.data.bank_code;
        var bank_code = '000013';
        var accountNumber = thedata.data.virtual_account_number;
        var beneficiary_account = thedata.data.beneficiary_account;
        var customer_identifier = thedata.data.customer_identifier;

        var accountName = `${first_name} ${last_name}`;
        var bankname = 'GTBank';
        const jsonString = JSON.stringify(thedata);

        const createAccount = await Bank.create({
            userid: userid, inactive: 0, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, 
            bankcode: bank_code, trackid: customer_identifier, trackingref: customer_identifier, jsonresp: jsonString, accounttype: 'savings', 
            provider: 'gtbank', currency: 'NGN', usertype: 'personal'
        });

        var thecontent = `
            <div>
        <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got A New Account Number</h3>
        <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
        <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
            <p style="line-height: 20px; letter-spacing: 0.025em;">
                Hello ${firstname} </p>
                <p style="line-height: 28px; letter-spacing: 0.025em;">
                Congratulations! A virtual account number has been generated for you on <strong>HitchPay</strong>. Get instant wallet funding when you pay into your dedicated account number.
            </p>
            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
            <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
        </div>
        `;
        mailSender(firstname, 'Virtual Account', email, thecontent);

        /* send SMS */
        const msg = `Hi! ${bankname} account number has been generated for you on HitchPay. Get instant wallet funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

        await pushNotify(userid, 'Virtual Account', msg);

        return [true, `Account number generated`, accountName, accountNumber, bankname]

    }else{
        return [false, `${thedata.message} from Partner Bank`, '', '', '']
    }
    }catch(error){
        console.log('GTBANK accnt creation error', error.message)
        logger.error('genGTBankAccount Error:', error);
        return [false, `Unable to generate account number at the moment - ${error.message}`, '', '', '']
    }
}

// genGTBankAccount('878', { bvv: '22222222222', verdob: '1990-01-01', gender: 'male' })
//   .then(result => {     console.log("USD to NGN Rate:", result);
//   })
//   .catch(err => console.error("Script execution failed:", err))
//   .finally(async () => {
//       // Optional: Close database connection if this is a standalone script
//       // await db.sequelize.close();
//   });

// get all gtbank accounts

const getAllGTBankAccounts = async () => {
     const options = {
        method: 'GET',
        url: `${process.env.SQD_URL}/virtual-account/merchant/accounts`,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.SQD_SKEY}`
        }
    };
    let response = await axios.request(options);
    let thedata = response.data;

    // console.log('thedata', thedata)
    if (thedata.success && thedata.data) {
        return thedata.data;
    }
};


// genBizGTBAccount(4)
//   .then(result => {     console.log("Account:", result);
//   })
//   .catch(err => console.error("Script execution failed:", err))
//   .finally(async () => {
//       // Optional: Close database connection if this is a standalone script
//       // await db.sequelize.close();
// });

const genBizGTBAccount = async (bizid) => {
    try{
    const getacct = await Bank.findOne({ where: { userid: bizid, provider: 'gtbank', status: 1, usertype: 'business' } });

    if (getacct)
        return [false, `Account number already generated`, getacct.accountname, getacct.accountno, getacct.bankname]

        /* CALL USER DETAILS */
        const userinfo = await getBizInfo(bizid);
        const useremail = userinfo.business_email;
        const fname = userinfo.business_name;
        const cacno = userinfo.cacno;
        const ownerid = userinfo.ownerid;
        // const userphoneno = formatPhoneNumber(userinfo.business_phoneno); 

        // get biz kyc 
         const getkyc = await KYC.findOne({
            order: [['id', 'DESC']],
            where: { userid: ownerid,  [Op.or]: [{status: 2}, {status: 1}],
                [Op.or]: [{ vertype: 'BVN' }]
            }
        });

        if (!getkyc)
            return [false, `Business Director's BVN verification must be completed in order to create account`]

        const momentDate = moment(getkyc.verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD/MM/YYYY');
        const userphoneno = !getkyc.verphone ? userinfo.business_phoneno : getkyc.verphone;

        // Format phone number to 11 digits with leading 0
        // Remove all non-numeric characters
        let formattedPhoneno = userphoneno.replace(/\D/g, ''); 
        if (formattedPhoneno.startsWith('234')) {
            formattedPhoneno = '0' + formattedPhoneno.substring(3);
        } else if (!formattedPhoneno.startsWith('0') && formattedPhoneno.length === 10) {
            formattedPhoneno = '0' + formattedPhoneno;
        }

        // Ensure it's 11 digits
        if (formattedPhoneno.length !== 11) {
            return [false, 'Invalid business phone number format for GTBank account creation. Must be 11 digits with leading 0.', '', '', ''];
        }

        const payload = {
            customer_identifier: `HTCHBIZ${bizid}`,
            business_name: fname,
            mobile_num: formattedPhoneno,
            bvn: getkyc.bvv,
            beneficiary_account: !process.env.SQD_BENECIARY_ACCOUNT ? "4920299492" : process.env.SQD_BENECIARY_ACCOUNT
        }

        const options = {
            method: 'POST',
            url: `${process.env.SQD_URL}/virtual-account/business`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${process.env.SQD_SKEY}`
            },
            data: payload
        };

        let response = await axios.request(options);
        let thedata = response.data;
        console.log('thedata', thedata)

        if (thedata.success && thedata.data) {
            const jsonString = JSON.stringify(thedata);

            var accountid = thedata['data']['customer_identifier'];
            var accountNumber = thedata['data']['virtual_account_number'];
            var accountName = thedata['data']['first_name'];
            var last_name = thedata['data']['last_name'];
            // var beneficiary_account = thedata['data']['beneficiary_account'];
            var accountType = 'savings';

            var bankname = 'GTBank';
            var bankcode = '000013';

            const createAccount = await Bank.create({
                userid: bizid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, 
                accountname: accountName, bankcode: bankcode, trackid: accountid, trackingref: accountid, 
                jsonresp: jsonString, accounttype: accountType, provider: 'gtbank', currency: 'NGN', usertype: 'business'
                
            });

            var thecontent = `
                <div>
            <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got New Account Number</h3>
            <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
            <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                <p style="line-height: 20px; letter-spacing: 0.025em;">
                    Hello ${fname} </p>
                    <p style="line-height: 28px; letter-spacing: 0.025em;">
                    Congratulations! A business account number has been generated for ${fname} on <strong>HitchPay</strong>. Get instant wallet funding when your customers/clients pay into your business account number.
                </p>

                <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
            </div>
            `;

            mailSender(fname, 'Virtual Account', useremail, thecontent);

            /* send SMS */
            const msg = `Hi! ${bankname} account number has been generated for your business on HitchPay. Get instant wallet funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

            // await sendSMS(userinfo.business_phoneno, msg);

            // await pushNotify(userid, 'Virtual Account', msg);

            return [true, `Business account number generated`, accountName, accountNumber, bankname]


        } else {
            return [false, `${thedata.message} from Partner Bank`, '', '', '']
        }
    }catch(error){
        console.log('error', error)
        logger.error('genBizGTBAccount Error:', error);
        return [false, `Unable to generate account number at the moment`, '', '', '']
    }
}


const genSHBizAccount = async (bizid) => {

    try{
    const getacct = await Bank.findOne({ where: { userid: bizid, provider: 'safehaven', status: 1, usertype: 'business' } });

    if (getacct)
        return [false, `Account number already generated`, getacct.accountname, getacct.accountno, getacct.bankname]

    const gettoken = await shAcessToken();
    if (gettoken[0]) {
        var access_token = gettoken[1]
        var ibs_client_id = gettoken[2]
        var ibs_user_id = gettoken[3]

        /* CALL USER DETAILS */
        const userinfo = await getBizInfo(bizid);
        const useremail = userinfo.business_email;
        const fname = userinfo.business_name;
        const cacno = userinfo.cacno;
        const ownerid = userinfo.ownerid;
        // const userphoneno = formatPhoneNumber(userinfo.business_phoneno); 

        // get biz kyc 
         const getkyc = await KYC.findOne({
            order: [['id', 'DESC']],
            where: { 
                userid: ownerid, 
                [Op.or]: [{status: 2}, {status: 1}],
                [Op.or]: [{ vertype: 'BVN' }]
            }
        });

        if (!getkyc)
            return [false, 'Business account verification needs to be completed in order to create account']

        const momentDate = moment(getkyc.verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');
        const userphoneno = !getkyc.verphone ? formatPhoneNumber(userinfo.business_phoneno) : formatPhoneNumber(getkyc.verphone);

        const options = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/accounts/v2/subaccount`,
            headers: {
                accept: 'application/json',
                ClientID: ibs_client_id,
                'content-type': 'application/json',
                authorization: `Bearer ${access_token}`
            },
            data: {
                phoneNumber: userphoneno,
                emailAddress: useremail,
                identityType: getkyc.vertype,
                autoSweep: true,
                companyRegistrationNumber: cacno,
                autoSweepDetails: { schedule: 'Instant', accountNumber: process.env.SH_DEBITACCOUNT },
                externalReference: `HTCHBIZ${bizid}`,
                identityNumber: getkyc.bvv,
                dateOfBirth: dateOfBirth,
                booleanMatch: true
            }
        };

        // console.log('data', options)

        let response = await axios.request(options);
        let thedata = response.data;
        console.log('thedata', thedata)

        if (thedata.statusCode == 200 && thedata['data']) {
            const jsonString = JSON.stringify(thedata);

            var accountid = thedata['data']['_id'];
            var accountNumber = thedata['data']['accountNumber'];
            var accountName = thedata['data']['accountName'];
            var accountType = thedata['data']['accountType']; //current
            var currencyCode = thedata['data']['currencyCode'];
            var identityId = thedata['data']['identityId'];
            var accountBalance = thedata['data']['accountBalance'];
            var isSubAccount = thedata['data']['isSubAccount'];
            var subAccountDetails = thedata['data']['subAccountDetails'];

            var bankname = 'Safe Haven MFB';
            var bankcode = '090286';

            const createAccount = await Bank.create({
                userid: bizid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, 
                accountname: accountName, bankcode: bankcode, trackid: accountid, trackingref: accountid, 
                jsonresp: jsonString, accounttype: accountType, provider: 'safehaven', currency: 'NGN', usertype: 'business'
                
            }).catch((err) => {
                return [false, 'Unable to process your request : ' + err ];
            });

            if (createAccount) {
                var thecontent = `
                 <div>
                <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got New Account Number</h3>
                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Hello ${fname} </p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        Congratulations! A virtual account number has been generated for your business on <strong>HitchPay</strong>. Get instant wallet funding when your customers/clients pay into your business account number.
                    </p>

                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                </div>
                `;

                mailSender(fname, 'Virtual Account', useremail, thecontent);

                /* send SMS */
                const msg = `Hi! ${bankname} account number has been generated for your Business on HitchPay. Get instant wallet funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

                // await sendSMS(userinfo.business_phoneno, msg);

                // await pushNotify(userid, 'Virtual Account', msg);

                return [true, `Account number generated`, accountName, accountNumber, bankname]

            } else {
                return [false, `Unable to process identity validation and account creation`, '', '', '']
            }

        } else {
            return [false, `${thedata.message} from Partner Bank`, '', '', '']
        }

    } else {
        return [false, `Something went wrong, kindly try again`, '', '', '']
    }

    }catch(error){
        console.log('error', error)
        logger.error('genBizSHAccount Error:', error);
        return [false, `Unable to generate account number at the moment`, '', '', '']
    }
}

const calculateProfitAndFee = (productDetails, transactionAmount) => {
    let providerImpactOnOurProfit = 0; // What we gain/lose from the provider
    let ourChargeToCustomer = 0;      // What we charge/discount the customer

    const {
        providerprice,
        provfeetype,
        provfeemodel,
        amount,
        feetype,
        feemodel
    } = productDetails;

    const parsedProviderPrice = parseFloat(providerprice) || 0;
    const parsedOurRate = parseFloat(amount) || 0;
    const parsedTransactionAmount = parseFloat(transactionAmount) || 0;

    // Calculate provider's impact on our profit
    if (provfeemodel === 'commission') {
        if (provfeetype === 'percentage') {
            providerImpactOnOurProfit = (parsedProviderPrice / 100) * parsedTransactionAmount;
        } else if (provfeetype === 'fixed') {
            providerImpactOnOurProfit = parsedProviderPrice;
        }
    } else if (provfeemodel === 'charge') {
        if (provfeetype === 'percentage') {
            providerImpactOnOurProfit = -(parsedProviderPrice / 100) * parsedTransactionAmount;
        } else if (provfeetype === 'fixed') {
            providerImpactOnOurProfit = -parsedProviderPrice;
        }
    }

    // Calculate our charge/discount to the customer
    if (feetype === 'discount') {
        if (feemodel === 'percentage') {
            ourChargeToCustomer = -(parsedOurRate / 100) * parsedTransactionAmount;
        } else if (feemodel === 'fixed') {
            ourChargeToCustomer = -parsedOurRate;
        }
    } else if (feetype === 'charge' || feetype === 'fixed') {
        if (feemodel === 'percentage') {
            ourChargeToCustomer = (parsedOurRate / 100) * parsedTransactionAmount;
        } else if (feemodel === 'fixed') {
            ourChargeToCustomer = parsedOurRate;
        }
    }

    // console.log('ourChargeToCustomer', ourChargeToCustomer)


    // The total amount the customer needs to pay for the service + our fee/discount
    const totalAmountCustomerPays = parsedTransactionAmount + ourChargeToCustomer;

    // console.log('parsedTransactionAmount', parsedTransactionAmount)
    // console.log('totalAmountCustomerPays', totalAmountCustomerPays)

    // Our net profit is what we get from the customer (ourChargeToCustomer) plus what we get from the provider (providerImpactOnOurProfit)
    const netProfit = ourChargeToCustomer + providerImpactOnOurProfit;

    // console.log('netProfit', netProfit)

    return {
        totalChargedToCustomer: totalAmountCustomerPays,
        ourFee: ourChargeToCustomer, // This is the actual fee/discount applied to the customer
        profit: netProfit,
        providerFeeActual: providerImpactOnOurProfit, // This is the actual amount of provider's fee/commission
        ProviderComm: parsedProviderPrice
    };
};

const giveWelcomeBonus = async (userid) => {
    const getsett = await AppSett.findOne({ where: { id: 1 } });

    var welcomebonus = getsett.welcomebonus;
    var welcomebonus_enabled = getsett.welcomebonus_enabled;

    if (welcomebonus_enabled && welcomebonus > 0) {
        const checkpayouts = await logEarning.findOne({
            where: { userid: userid, type: 'welcomebonus' }
        })

        let transref = Date.parse(new Date()) / 1000;

        if (!checkpayouts) {
            //give bonus
            const earnref = transref + '_ENWC';
            let timed = Date.parse(new Date()) / 1000;

            var logit = await logEarning.create({
                userid: userid, amount: welcomebonus, product: `Welcome bonus for signing up with HitchPay`,
                type: 'welcomebonus', reference: earnref, status: 0, timed: timed, payfrom: ''
            });

            if (!logit) return false;

            /* send notify */
            var note_desc = `You've just earn N${formatAmount(welcomebonus)} as a signup bonus for signing up on HitchPay`;
            await notifyMe(userid, 'Sign Up Bonus', 'user', note_desc)
            await pushNotify(userid, 'Sign Up Bonus', note_desc);

            return true;

        } else {
            return false;
        }
    } else {
        return false;
    }
}

const logReferEarn = async (userid, transref, options = {}) => {
    const { transaction } = options;
    /* Log the refereral earning */
    const getsett = await AppSett.findOne({ where: { id: 1 }, transaction });
    if (!getsett) {
        console.error("Application settings not found. Cannot process referral earnings.");
        return false;
    }

    var eligible_refamt = getsett.eligible_refamt;  //musst have done atleast sum of this
    var referearn = getsett.referearn;
    var referbenchmark = getsett.referbenchmark;
    var refermilestone_enabled = getsett.refermilestone_enabled;

    if (!refermilestone_enabled) return false;  //dont proceed

    const getuser = await Customer.findOne({ where: { id: userid }, transaction });
    if (!getuser)
        return false;

    /* get Boss info */
    var mybosscode = getuser.referby;
    if (!mybosscode) { // Explicitly check if a referrer exists
        return false;
    }

    var sendername = `${getuser.firstname} ${getuser.lastname}`;

    const getboss = await Customer.findOne({ where: { bvverify: 2, [Op.or]: [{ refcode: mybosscode }, { uname: mybosscode }] }, transaction });

    if (!getboss)
        return false;

    var bossid = getboss.id;

    /* check if hhe boss has been paid */
    const checkpayouts = await logEarning.findOne({ where: { userid: bossid, payfrom: userid, type: 'referral' }, transaction })

    if (checkpayouts)
        return false;

    if (referbenchmark == 'KYC') {
        var userinfo = await getUserInfo(userid, { transaction }); //check if the upline/customer i refer has done kyc
        var bvverify = userinfo.bvverify;

        if (bvverify == '2') {
            //give him bonus
            const earnref = transref + '_ENKRF';
            let timed = Date.parse(new Date()) / 1000;

            var logit = await logEarning.create({
                userid: bossid, amount: referearn, product: `Referral Earn from ${sendername}`,
                type: 'referral', reference: earnref, status: 0, timed: timed, payfrom: userid
            }, { transaction });

            if (!logit) return false;

            /* send notify */
            var notedesc = `You've just earn N${formatAmount(referearn)} as referral bonus for ${sendername}`;
            notifyMe(bossid, 'Referral Earning', 'user', notedesc)
            return true;
        }

    } else {
        //transaction benchmark
        /* check if his total debit is up to the eligible amount */
        // const totalSpend = await Payn.sum('amount', { where: { userid: userid, status: 1, paytype: 'debit',  }, transaction });
        const totalSpend = await Payn.sum('amount', { where: { userid: userid, status: 1, paytype: 'debit', pfor: { [Op.ne]: 'transfer' } }, transaction });
        if (totalSpend >= eligible_refamt) {
            //give bonus
            const earnref = transref + '_ENRF';
            let timed = Date.parse(new Date()) / 1000;

            var logit = await logEarning.create({
                userid: bossid, amount: referearn, product: `Referral Earn from ${sendername}`,
                type: 'referral', reference: earnref, status: 0, timed: timed, payfrom: userid
            }, { transaction });

            if (logit) return false;

            /* send notify */
            var notedesc = `You've just earn N${formatAmount(referearn)} as referral bonus for ${sendername}`;
            notifyMe(bossid, 'Referral Earning', 'user', notedesc)
            return true;

        } else {
            return true
        }

    }
}

const dailyBonus = async (userid, transref, options = {}) => {
    const { transaction } = options;
    try {
        // 1. Get App Settings and check if the feature is enabled
        const settings = await AppSett.findOne({ where: { id: 1 }, transaction });
        if (!settings || !settings.dailybonus_enabled) {
            return false; // Feature is disabled
        }

        const { dailybonus, dailybonus_type } = settings;

        // 2. Check if the user has already received a bonus today
        const todayStart = moment().startOf('day').unix();
        const todayEnd = moment().endOf('day').unix();
        const existingBonus = await logEarning.findOne({
            where: {
                userid: userid,
                type: 'dailybonus',
                timed: { [Op.between]: [todayStart, todayEnd] }
            }, transaction
        });

        if (existingBonus) {
            return false; // Bonus already awarded today
        }

        let bonusAmount = 0;

        // 3. Calculate bonus based on type
        if (dailybonus_type.toLowerCase() === 'fixed') {
            bonusAmount = parseFloat(dailybonus);
        } else if (dailybonus_type.toLowerCase() === 'percentage') {
            const firstTransaction = await Payn.findOne({
                where: {
                    userid: userid, status: 1, paytype: 'debit', pfor: { [Op.ne]: 'transfer' },
                    timed: { [Op.between]: [todayStart, todayEnd] }
                }, transaction,
                order: [['timed', 'ASC']]
            });

            if (firstTransaction) {
                const transactionAmount = parseFloat(firstTransaction.amount);
                bonusAmount = (transactionAmount * parseFloat(dailybonus)) / 100;
            }

        }

        // 4. Award the bonus if applicable
        if (bonusAmount > 0) {
            const earnref = transref ? `${transref}_ENDB` : `DBN_${userid}_${todayStart}`;
            await logEarning.create({
                userid: userid, amount: bonusAmount, product: `Daily Bonus Reward`,
                type: 'dailybonus', reference: earnref, status: 0, timed: Math.floor(Date.now() / 1000), payfrom: ''
            }, { transaction });

            const note_desc = `Congratulations! You've earned a daily bonus of N${formatAmount(bonusAmount)}.`;
            await notifyMe(userid, 'Daily Bonus!', 'user', note_desc);
            await pushNotify(userid, 'Daily Bonus!', note_desc);
            return true;
        }

        return false;
    } catch (error) {
        console.error('Error in dailyBonus function:', error);
        return false;
    }
}

const referralUplineDownlineBonus = async (userid) => {
    let transref = Date.parse(new Date()) / 1000;
    try {
        const settings = await AppSett.findOne({ where: { id: 1 } });
        if (!settings || !settings.referbonus_enabled) {
            return false; // Feature is disabled
        }

        const { uplinebonus, downlinebonus } = settings;

        // Get the user who was referred (downline)
        const downlineUser = await getUserInfo(userid);
        if (!downlineUser || !downlineUser.referby) {
            return false; // No referrer
        }

        // Get the user who referred (upline)
        const uplineUser = await Customer.findOne({
            where: {
                bvverify: 2, // Upline must be verified
                [Op.or]: [{ refcode: downlineUser.referby }, { uname: downlineUser.referby }]
            }
        });

        if (!uplineUser) {
            return false; // Upline not found or not verified
        }

        const downlineName = `${downlineUser.firstname} ${downlineUser.lastname}`;
        const uplineName = `${uplineUser.firstname} ${uplineUser.lastname}`;
        let timed = Math.floor(Date.now() / 1000);

        // Award Upline Bonus
        if (uplinebonus > 0) {
            const uplineBonusExists = await logEarning.findOne({
                where: { userid: uplineUser.id, payfrom: downlineUser.id, type: 'uplinebonus' }
            });

            if (!uplineBonusExists) {
                const earnref_upline = `${uplineUser.id}${transref}_UPL`;

                await logEarning.create({
                    userid: uplineUser.id, amount: uplinebonus, product: `Referral bonus from ${downlineName}`,
                    type: 'uplinebonus', reference: earnref_upline, status: 0, timed: timed, payfrom: downlineUser.id
                });

                const uplineNotifyDesc = `You've earned N${formatAmount(uplinebonus)} as a referral bonus for inviting ${downlineName}.`;

                await notifyMe(uplineUser.id, 'Referral Bonus', 'user', uplineNotifyDesc);
                await pushNotify(uplineUser.id, 'Referral Bonus', uplineNotifyDesc);
            }
        }

        // Award Downline Bonus
        if (downlinebonus > 0) {
            const downlineBonusExists = await logEarning.findOne({ where: { userid: downlineUser.id, type: 'downlinebonus' } });

            if (!downlineBonusExists) {
                const earnref_downline = `${transref}${downlineUser.id}_DWNL`;
                await logEarning.create({
                    userid: downlineUser.id, amount: downlinebonus, product: `Referral bonus for being invited by ${uplineName}`, type: 'downlinebonus', reference: earnref_downline, status: 0, timed: timed, payfrom: uplineUser.id
                });

                const downlineNotifyDesc = `You've earned N${formatAmount(downlinebonus)} as a bonus for joining through ${uplineName}'s referral.`;

                await notifyMe(downlineUser.id, 'Referral Bonus', 'user', downlineNotifyDesc);
                await pushNotify(downlineUser.id, 'Referral Bonus', downlineNotifyDesc);
            }
        }

        return true;

    } catch (error) {
        console.error('Error in referralUplineDownlineBonus function:', error);
        return false;
    }
}

const psb9Token = async () => {
    const options = {
        method: 'POST',
        url: `${process.env.PSBNK_URL}/merchant/virtualaccount/authenticate`,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json'
        },
        data: {
            publickey: "93A8E96555024655BAE488CE5E832EFF",
            privatekey: "9x393Qci6BvkPIug_Dguv3gMVUVW1M5eQ_lSv1GF-RhXkiosfDQMAmoLDVW754Ph"
        }
    };

    let response = await axios.request(options);
    let thedata = response.data;
    // console.log(thedata)
    const jsonString = JSON.stringify(thedata);

    if (thedata['code'] == '00') {
        const access_token = thedata.access_token
        const expires_in = thedata.expires_in

        return [true, access_token, expires_in];
    } else {
        return [false, '', ''];
    }
}


const gen9PSBAccount = async (userid) => {

    const getacct = await Bank.findOne({ where: { userid: userid, provider: '9psb', status: 1 } });

    if (getacct)
        return [false, `Account number already generated`, getacct.accountname, getacct.accountno, getacct.bankname]

    const gettoken = await psb9Token();
    if (gettoken[0]) {
        const access_token = gettoken[1]
        var expires_in = gettoken[2]

        // const txref = md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);

        /* CALL USER DETAILS */
        const userinfo = await getUserInfo(userid);
        const useremail = userinfo.email;
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const fullname = `${fname} ${lname}`;

        const payload = JSON.stringify({
            transaction: { reference: `HTCH${userid}` },
            order: { amount: "", currency: "NGN", description: "Account Issuance", country: "NGA", amounttype: "ANY" },
            customer: { account: { name: fullname, type: "STATIC" } }
        });

        const theHeader = {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${access_token}`
        };

        const options = {
            method: 'POST',
            url: `${process.env.PSBNK_URL}/merchant/virtualaccount/create`,
            headers: theHeader,
            data: payload
        };

        // console.log('data', options)

        let response = await axios.request(options);
        let thedata = response.data;
        // console.log('thedata', thedata)
        const jsonString = JSON.stringify(thedata);

        if (thedata.code == '00') {

            var accountid = thedata['transaction']['reference'];
            var accountNumber = thedata['customer']['account']['number'];
            var accountName = thedata['customer']['account']['name'];
            var accountType = thedata['customer']['account']['type'];
            var currencyCode = 'NGN';
            var bankname = '9 Payment Service Bank';
            var bankcode = '120001';

            const createAccount = await Bank.create({
                userid: userid, inactive: 0, bankname: bankname, status: 1, accountno: accountNumber, 
                accountname: accountName, bankcode: bankcode, trackid: accountid, trackingref: accountid, 
                jsonresp: jsonString, accounttype: accountType, provider: '9psb', currency: 'NGN', usertype: 'personal'
            }).catch((err) => {
                return { status: false, message: 'Unable to process your request : ' + err };
            });

            if (createAccount) {
                var thecontent = `
                 <div>
                <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got New Account Number</h3>
                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Hello ${fname} </p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        Congratulations! A virtual account number has been generated for you on <strong>HitchPay</strong>. Get instant wallet funding when you pay into your dedicated account number.
                    </p>

                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                </div>
                `;

                mailSender(fname, 'Virtual Account', useremail, thecontent);

                /* send SMS */
                const msg = `Hi! ${bankname} account number has been generated for you on HitchPay. Get instant wallet funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

                await sendSMS(userinfo.phoneno, msg);

                await pushNotify(userid, 'Virtual Account', msg);

                return [true, `Account number generated`, accountName, accountNumber, bankname]

            } else {
                return [false, `Unable to process account creation`, '', '', '']
            }

        } else {
            return [false, thedata.message, '', '', '']
        }

    } else {
        return [false, `Something went wrong, kindly try again`, '', '', '']

    }

}

function toTwoDecimal(num) {
    const numericValue = parseFloat(num);

    if (isNaN(numericValue)) {
        // Handle cases where the input isn't a number
        return '0.00';
    }

    return numericValue.toFixed(2);
}

const processBonus = async (req, res) => {
    try {
        const { userId, action, amount } = req.body;

        // Find all active tasks matching the action
        const tasks = await BonusTask.findAll({ where: { action, is_active: true } });

        if (!tasks.length) {
            return res.status(404).json({ message: "No bonus available for this action" });
        }

        let rewards = [];

        for (let task of tasks) {
            if (amount >= task.min_amount) {
                let reward = 0;

                if (task.reward_unit === "percent") {
                    reward = (amount * task.reward_value) / 100;
                    if (task.max_reward) reward = Math.min(reward, task.max_reward);
                } else {
                    reward = task.reward_value;
                }

                // Save progress
                await UserBonusProgress.create({
                    user_id: userId,
                    task_id: task.id,
                    reward_earned: reward,
                    date: new Date()
                });

                // Update user wallet (if cashback)
                if (task.reward_type === "cashback") {
                    const user = await Customer.findByPk(userId);
                    user.wallet_balance = parseFloat(user.wallet_balance) + parseFloat(reward);
                    await user.save();
                }

                rewards.push({ task: task.title, reward });
            }
        }

        return res.json({ message: "Bonus processed", rewards });
    } catch (error) {
        console.error(error);
        return res.status(500).json({ message: "Server error", error: error.message });
    }
}


const USAccountUpd = async (reference, userid, usertype = 'personal') => {

    try {

        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/collections/virtual-account/status/${reference}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;

        if (thedata.status && thedata.data.status == 'APPROVED') {
            const accountId = thedata.data.account_id
            const getacct = await Bank.findOne({ where: { userid: userid, trackid: accountId, provider: 'mpld', status: 1 } });

            if (getacct) {
                return [true, 'Account number already generated'];

            } else {

                // get tjhe account details
                try {
                    let apiconfig = {
                        method: 'GET',
                        url: `${process.env.MPLDURL}/collections/virtual-account/${accountId}`,
                        headers: {
                            accept: 'application/json',
                            'content-type': 'application/json',
                            'Authorization': `Bearer ${process.env.MPLSKEY}`
                        },
                    };

                    let apiResponse = await axios.request(apiconfig);
                    let theresp = apiResponse.data;
                    let jsonString = JSON.stringify(theresp);
                    // console.log(theresp)

                    if (theresp.status) {
                        const bankname = theresp.data.bank_name;
                        const accountNumber = theresp.data.account_number
                        const accountName = theresp.data.account_name
                        const accountid = theresp.data.id
                        const iban = JSON.stringify(theresp.data.iban);
                        

                        const ibanData = theresp.data.iban || [];
                        const instructionTypes = new Set();
                        const memos = new Set();
                        const swiftCodes = new Set();

                        let primaryIban = null;
                        for (const entry of ibanData) {
                            // Track unique values
                            if (entry.instruction_type) instructionTypes.add(entry.instruction_type);
                            if (entry.memo) memos.add(entry.memo);
                            if (entry.swift_code) swiftCodes.add(entry.swift_code);

                            // Choose FEDWIRE as priority for primary data
                            if (entry.instruction_type === "FEDWIRE" && !primaryIban) {
                                primaryIban = entry;
                            }
                        }

                        // If FEDWIRE not found, fallback to first
                        if (!primaryIban && ibanData.length > 0) {
                            primaryIban = ibanData[0];
                        }

                        const routing_number = primaryIban?.routing_number || "";
                        const institution_address =  primaryIban?.institution_address || "";

                        const createAccount = await Bank.create({
                            userid: userid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, 
                            accountname: accountName, bankcode: routing_number, trackid: accountid, currency: 'USD', 
                            trackingref: '', jsonresp: jsonString, accounttype: 'ACH, FEDWIRE', provider: 'mpld', usertype: usertype
                        });

                        await AcctRequest.update({ status: 4 }, { where: { reference: reference } });

                        if (createAccount) {
                            const userinfo = await getUserInfo(userid);
                            const useremail = userinfo.email;
                            const fname = userinfo.firstname;

                            var thecontent = `
                            <div>
                        <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                        <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                            <p style="line-height: 20px; letter-spacing: 0.025em;">
                                Hello ${fname} </p>
                                <p style="line-height: 28px; letter-spacing: 0.025em;">
                                Congratulations! A USD account number has been provisioned for you on <strong>HitchPay</strong>. Get instant funding when you pay into the USD account number.
                            </p>
        
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Address:</strong> ${institution_address}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Routing Number:</strong> ${routing_number}</p>
                            <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                        </div>
                        `;

                            mailSender(fname, 'USD Account Provisioned', useremail, thecontent);
                            mailSender(fname, 'USD Account Provisioned', 'ojidex17@gmail.com', thecontent);

                            /* send SMS */
                            const msg = `Hi! US account number has been provisioned for you on HitchPay. Get instant funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

                            await sendSMS(userinfo.phoneno, msg);

                            await pushNotify(userid, 'Virtual Account Provisioned', msg);
                            await pushNotify(4, 'Virtual Account Provisioned', msg);

                            return [true, 'Account number successfully created'];

                        } else {

                            return [false, 'Unable to process account creation'];
                        }

                    } else {

                        return [false, theresp.message];

                    }

                } catch (error) {

                    console.log("us acct req details: Error", error.message);
                    if (error.response && error.response.data) {
                        console.error('usacct detail Error response data:', JSON.stringify(error.response.data, null, 2));

                        return [false, error.response.data.message];
                    } else {
                        return [false, 'Unable to process your request at the moment, kindly retry shortly'];
                    }
                }

            }

        } else {
            return [false, 'Request in review'];
        }

    } catch (error) {
        console.log("usacct Error: ", error.message);
        console.error('usacct reqq Error response data:', JSON.stringify(error.response.data, null, 2));
        console.log("us acct req status: Error", error.message);
        return [false, 'Unable to process request'];
    }
}


// --- In-memory cache for exchange rates ---

let rateCache = {
    data: null,
    timestamp: 0,
};
const RATE_CACHE_DURATION = 1 * 60 * 1000; // 1 minute

const getFX = async (sourcefiat, targetfiat, amount = 100, marginAction = 'add') => {

    // Add margin when selling a currency (calculating the cost for the user), and subtract margin when buying a currency (calculating the payout to the user).
    // Add Margin (+): When the rate represents the price the user pays. Increasing the rate increases the cost to the user, generating profit for you. (e.g., User paying NGN to fund a USD card).
    // Subtract Margin (-): When the rate represents the value the user receives. Decreasing the rate reduces the amount the user gets, generating profit for you. (e.g., User swapping USD to NGN, or withdrawing).
    /* Future: We can implement a dynamic margin based on the transaction amount size. How can I modify getFX to support tiered margins */

    const now = Date.now();

    // Check if the cache is still valid
    if (rateCache.data && (now - rateCache.timestamp < RATE_CACHE_DURATION) && 
        rateCache.data.sourcefiat === sourcefiat && 
        rateCache.data.targetfiat === targetfiat && 
        rateCache.data.marginAction === marginAction) {
        logger.info('Serving exchange rates from cache.');
        return rateCache.data.rateInfo; // Return the cached rate info
    } else {

    try {

       const appsett = await AppSett.findOne({ where: { id: 1 }});
        if (!appsett || !appsett.rateprovider) {
            logger.warn('FX rate provider not configured or disabled.');
            return [false, 0, '']; 
        }

         const { ratemargin_percent, rateprovider } = appsett;
        let rateInfo = [false, 0, ''];
        
        logger.info(`Fetching fresh exchange rates from API using ${rateprovider}.`);

        if (rateprovider === 'maplerad') {
            rateInfo = await mapleradFx(sourcefiat, targetfiat, amount);
        } else if (rateprovider === 'yellocard' || rateprovider == 'yellowcard') {
            rateInfo = await getYCFX(sourcefiat, targetfiat); // getYCFX doesn't use amount directly
        } else if (rateprovider === 'publicCDN') {
            rateInfo = await publicCDN_Fx(sourcefiat, targetfiat); // publicCDN_Fx doesn't use amount directly
        } else {
            logger.warn(`Unknown FX rate provider: ${rateprovider}`);
            return [false, 0, ''];
        }

        // Apply margin if rate is successfully fetched and margin is configured
        if (rateInfo[0] && ratemargin_percent && ratemargin_percent > 0) {
            const originalRate = rateInfo[1];
            const margin = (parseFloat(ratemargin_percent) / 100) * originalRate;

            if (marginAction === 'subtract' || sourcefiat == 'USD') {
                rateInfo[1] = originalRate - margin; // subtract margin (User receives less)
                logger.info(`Applied -${ratemargin_percent}% margin. New rate: ${rateInfo[1]} from Provider rate of ${originalRate}`);
            } else {
                rateInfo[1] = originalRate + margin; // add margin (User pays more)
                logger.info(`Applied +${ratemargin_percent}% margin. New rate: ${rateInfo[1]} from Provider rate of ${originalRate}`);
            }

        }

        // Update cache
        rateCache = { data: { sourcefiat, targetfiat, rateInfo }, timestamp: now };
        return rateInfo;

        } catch (error) {
            logger.error(`Error fetching FX rate from provider: ${error.message}`, error);
            return [false, 0, '']; // Return a generic error
        }
    }

};

const mapleradFx = async (sourcefiat, targetfiat, amount) =>{
     try {
        let amtdenom = 1000;
        if (sourcefiat === 'USD' && targetfiat === 'NGN') {
            amtdenom = 100;
        } else if (sourcefiat === 'NGN' && targetfiat === 'USD') {
            amtdenom = 10000;
        }

        const params = {
            source_currency: sourcefiat,
            target_currency: targetfiat,
            amount: amtdenom,
        };

        const response = await axios.post(
            `${process.env.MPLDURL}/fx/quote`,
            params,
            {
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    Authorization: `Bearer ${process.env.MPLSKEY}`,
                },
            }
        );

        const data = response.data;
        // console.log('data', data)

        if (data.status) {
            const rate = data.data.rate;
            const quoteid = data.data.reference;

            logger.info(`MPLD FX Rate for ${sourcefiat}/${targetfiat}: ${rate}`);
            return [true, rate, quoteid];
        } else {
            return [false, 0, ''];
        }
    } catch (error) {
        console.error('exch error : ', error.response?.data || error.message);
        return [false, 0, ''];
    }
}

const publicCDN_Fx = async (sourcefiat, targetfiat) =>{

     try {
      
        const fromcurrency = sourcefiat.toLowerCase();
        const tocurrency = targetfiat.toLowerCase();


        const response = await axios.get(
            `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${fromcurrency}.json`,
            {
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json'
                },
            }
        );

        const json = response.data;

        if (json[fromcurrency]) {
            const data = json[fromcurrency];
            const rate = parseFloat(data[tocurrency]);
            logger.info(`PublicCDN FX Rate for ${sourcefiat}/${targetfiat}: ${rate}`);
            return [true, rate, ''];
        } else {
             logger.warn(`PublicCDN: Rate for ${sourcefiat}/${targetfiat} not found.`);
            return [false, 0, ''];
        }

    } catch (error) {
         logger.error(`PublicCDN FX fetch error: ${error.message}`, error.response?.data);
        return [false, 0, ''];
    }
}


/* YELLOW CARD RATE HERE ONLY WORKS WELL FOR NON USD PAIRS */
const getYCFX = async (sourceCurrency, destinationCurrency, amount) => {
    try {
        if (!sourceCurrency || !destinationCurrency) {
             return [false, 0, 'Source and destination currencies are required.'];
        }
    
        let rateData;
        const now = Date.now();

        const freshRateData = await ycRequest("GET", `/business/rates`);
        // console.log('freshRateData', freshRateData)

        if (!freshRateData || !freshRateData.rates) {
            return [false, 0, 'Could not retrieve exchange rates from YellowCard.'];
        }

        let sourceRateInfo;
        let destRateInfo;
        let crossRate = 0;

        if(sourceCurrency.toUpperCase() == 'USD'){
            
            destRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === destinationCurrency.toUpperCase());  //extract
            if (!destRateInfo) return [false, 0, `Exchange rate for destination currency '${destinationCurrency}' not found.`];
            // console.log('freshRateData1', destRateInfo)

            const sourcePerUsd = 1;
            const destPerUsd = destRateInfo.buy;
            crossRate = destPerUsd / sourcePerUsd;
            
        }else if(destinationCurrency.toUpperCase() == 'USD'){
            sourceRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === sourceCurrency.toUpperCase());  //exrtact
            if (!sourceRateInfo) return [false, 0, `Exchange rate for source currency '${sourceCurrency}' not found.`];
            // console.log('freshRateData2', sourceRateInfo)

            const sourcePerUsd = sourceRateInfo.buy;
            const destPerUsd = 1;
            crossRate = destPerUsd / sourcePerUsd;
            
        }else{
            sourceRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === sourceCurrency.toUpperCase());  //exrtact
            destRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === destinationCurrency.toUpperCase());  //extract

            if (!sourceRateInfo) return [false, 0, `Exchange rate for source currency '${sourceCurrency}' not found.`];
            if (!destRateInfo) return [false, 0, `Exchange rate for destination currency '${destinationCurrency}' not found.`];

            const sourcePerUsd = sourceRateInfo.buy;
            const destPerUsd = destRateInfo.buy;
            crossRate = destPerUsd / sourcePerUsd;
        }

        // return freshRateData;

        logger.info(`Yellow Card FX Rate for ${sourceCurrency}/${destinationCurrency}: ${crossRate}`);
        return [true, crossRate, ''];
    
    } catch (error) {
        logger.error(`Yellow Card FX fetch error`, error);
        return [false, 0, ''];
    }
}


/* getFX('USD', 'NGN', '100', 'subtract')
.then(() => {
    console.log("Script finished.");
    process.exit(0);
})
.catch(err => {
    console.error("Script failed with error:", err);
    process.exit(1);
}); */

const checkinBonus = async (userId) => {
    const t = await db.sequelize.transaction();

    try {
        if (!userId) {
            await t.rollback();
            return [false, 'Oops! Invalid request sent!'];
        }

        const task = await BonusTask.findOne({ where: { type: "checkin", is_active: true }, transaction: t });
        if (!task) {
            await t.rollback();
            return [false, 'Check-in bonus not available'];
        }

        const lastCheckin = await UserBonusProgress.findOne({
            where: { userid: userId, task_id: task.id },
            order: [["date", "DESC"]],
            transaction: t
        });

        let streak = 1; // Default to 1 for a new streak
        const today = moment().format("YYYY-MM-DD");

        if (lastCheckin) {
            const lastDate = moment(lastCheckin.date).format("YYYY-MM-DD");
            if (lastDate === today) {
                await t.rollback();
                return [true, 'You have already checked in today']; 
            }

            // Check if the last check-in was yesterday to continue the streak
            if (moment().subtract(1, "day").format("YYYY-MM-DD") === lastDate) {
                streak = lastCheckin.times_completed + 1;
            }
            // If it was before yesterday, the streak resets to 1 (which is the default)
        }

        // If the streak goes past 7, it resets to 1 for a new cycle
        if (streak > 7) {
            streak = 1;
        }

        // --- Award bonus only on Day 7 ---
        if (streak === 7) {
            // On the 7th day, calculate the total reward for the entire week
            const rewards = await CheckinReward.findAll({
                where: { day: { [Op.between]: [1, 7] } },
                transaction: t
            });

            if (rewards.length < 7) {
                await t.rollback();
                return [true, 'Check-in reward configuration is incomplete'];
            }

            const totalReward = rewards.reduce((sum, day) => sum + parseFloat(day.reward), 0);

            // Save progress for the 7th day
            await UserBonusProgress.create({
                userid: userId,
                task_id: task.id,
                date: today,
                times_completed: streak,
                reward_earned: totalReward, // Log the total reward earned for this streak
            }, { transaction: t });

            // Credit the user's earning with the total sum
            const earnref = 'HTCH' + md5(randomstring.generate(3) + userId).toUpperCase().substring(0, 10)+'EARN';
            var logit = await logEarning.create({
                userid: userId, amount: totalReward, product: `Daily Checkin Reward`,
                type: 'checkin', reference: earnref, status: 0, timed: timed, payfrom: ''
            }, { transaction: t });

            if (!logit){
                await t.rollback();
                return [false, 'Unable to credit earning'];
            } 

            await t.commit();

            // add push notification 
            const thenotedesc = `Congratulations! You've completed a 7-day streak and earned a bonus of ${formatAmount(totalReward)}. Your streak will restart tomorrow.`;
            await pushNotify(userId, 'Daily Check-in', thenotedesc);
            
            await notifyMe(userId, 'Daily Check-in', 'user', thenotedesc);

            return [true, `Congratulations! You've completed a 7-day streak and earned a bonus of NGN ${formatAmount(totalReward)}`];
            /* return res.json({
                status: true,
                message: ,
                data: {
                    streak: streak,
                    reward: totalReward,
                    nextDay: "Your streak will restart tomorrow."
                }
            }); */

        } else {
            // For days 1-6, just log the check-in without giving a reward
            await UserBonusProgress.create({
                userid: userId,
                task_id: task.id,
                date: today,
                times_completed: streak,
                reward_earned: 0, // No reward earned yet
            }, { transaction: t });

            await t.commit();

            // add push notification 
            const note_desc = `You've checked in for day ${streak}. Keep going to complete your 7-day streak and earn a bonus!`;
            await pushNotify(userId, 'Daily Check-in', note_desc);
            
            await notifyMe(userId, 'Daily Check-in', 'user', note_desc);

            return [true, `Check-in successful! You are on a ${streak}-day streak. Complete 7 days to get your bonus.`];

            /* return res.json({
                status: true,
                message: `Check-in successful! You are on a ${streak}-day streak. Complete 7 days to get your bonus.`,
                data: {
                    streak: streak,
                    reward: 0,
                    nextDay: `Day ${streak + 1}`
                }
            }); */
        }

    } catch (error) {
        await t.rollback();
        console.error("Error during check-in:", error);
        return [false, 'Server error during check-in.'];
    }
}

const applyTaskBonus = async (userId, bonusId, transactionAmount, transactionNetwork, transactionRef, transactionProduct, options = {}) => {
    const { transaction } = options;
    if (!userId || !bonusId || !transactionAmount) {
        console.log('[applyTaskBonus] Missing required parameters.');
        return; // Silently fail if essential info is missing
    }

    const operation = async (t) => {
        try {
            // Finding the task and its category
            const task = await BonusTask.findOne({
                where: { id: bonusId, is_active: 1 },
                transaction: t
            });

            if (!task) { // Add a null check for the task itself
                console.log(`[applyTaskBonus] Task ${bonusId} not found or is inactive.`);
                return;
            }

            // Checking if user has already completed this task
            const existingProgress = await UserBonusProgress.findOne({
                where: { userid: userId, task_id: bonusId },
                transaction: t
            });

            if (existingProgress) return; // Silently exit if already completed

            // Validating transaction against task criteria
            if (parseFloat(transactionAmount) < parseFloat(task.min_amount)) {
                console.log(`[applyTaskBonus] Transaction amount ${transactionAmount} is less than min_amount ${task.min_amount}.`);
                await pushNotify(userId, 'Bonus Earned!', `Your transaction amount ${transactionAmount} is less than min_amount ${task.min_amount}.`);
                return;
            }

            if (task.network_type && task.network_type.toLowerCase() !== transactionNetwork.toLowerCase()) {
                console.log(`[applyTaskBonus] Transaction network ${transactionNetwork} does not match required network ${task.network_type}.`);
                // await pushNotify(userId, 'Bonus Earned!', `Transaction network ${transactionNetwork} does not match required network ${task.network_type}`);
                return;
            }

            // --- Consolidated and Corrected Logic ---
            const isGenericBillPay = task.action === 'pay_bill' && ['airtime', 'databundle', 'electricity', 'cabletv', 'education'].includes(transactionProduct);
            const isSpecificProduct = task.action === `buy_${transactionProduct}`;

            if (!isGenericBillPay && !isSpecificProduct) {
                console.log(`[applyTaskBonus] Transaction product '${transactionProduct}' does not match the requirement for task action '${task.action}'.`);
                return;
            }

            // Calculating and award the reward
            let rewardAmount = 0;
            if (task.reward_unit === "percent") {
                rewardAmount = (parseFloat(transactionAmount) * parseFloat(task.reward_value)) / 100;
                if (task.max_reward) {
                    rewardAmount = Math.min(rewardAmount, parseFloat(task.max_reward));
                }
            } else { // 'flat'
                rewardAmount = parseFloat(task.reward_value);
            }

            if (rewardAmount <= 0) {
                console.log(`[applyTaskBonus] Calculated reward is zero or less for task ${bonusId}.`);
                return;
            }

            const timed = Math.floor(Date.now() / 1000);

            // Log the reward in the earnings table
                const earnref = `${transactionRef}_BONUS`;
                await logEarning.create({
                    userid: userId, amount: rewardAmount, product: `Bonus for: ${task.title} ${task.type}`,
                    type: `${task.type}`, reference: earnref,
                    status: 0, // Pending settlement
                    timed: timed,
                    payfrom: ''
                }, { transaction: t });

            // Record the user's progress to prevent future rewards for this task
            await UserBonusProgress.create({
                userid: userId,
                task_id: bonusId,
                reward_earned: rewardAmount,
                date: moment().format("YYYY-MM-DD"),
                times_completed: 1 // First time completing this task
            }, { transaction: t });

            console.log(`[applyTaskBonus] Successfully awarded ${rewardAmount} to user ${userId} for task ${bonusId}.`);

            // Notify the user
            const notifyDesc = `Congratulations! You've earned a bonus of ${formatAmount(rewardAmount)} for completing the '${task.title} ${task.type}' task.`;
            await pushNotify(userId, 'Bonus Earned!', notifyDesc);
            await notifyMe(userId, 'Bonus Earned!', 'user', notifyDesc);

        } catch (error) {
            console.error(`[applyTaskBonus] Error processing bonus for task ${bonusId} and user ${userId}:`, error.message);
            await pushNotify(userId, 'Bonus Earned!', `Error processing bonus for task`);
            throw error; // Re-throw the error to ensure the internal transaction for the bonus is rolled back.
        }
    };

    // Use the parent transaction if provided, otherwise run in its own standalone, atomic transaction.
    if (transaction) {
        await operation(transaction);
    } else {
        await db.sequelize.transaction(operation);
    }
};

const applyCouponDiscount = async (userId, couponId, transactionAmount, productForPurchase, options = {}) => {
    const { transaction } = options;
    if (!userId || !couponId) {
        return { discount: 0, message: 'User ID and Coupon ID are required.' };
    }

    const operation = async (t) => {
        try {
            // Find the coupon and lock the row for the transaction
            const coupon = await bonusCoupon.findByPk(couponId, {
                transaction: t,
                lock: t.LOCK.UPDATE,
            });

            //Perform all validations
            if (!coupon) return { discount: 0, message: 'Coupon not found.' };

            const now = moment().unix();
            if (!coupon.is_active || coupon.validity_date < now) {
                return { discount: 0, message: 'This coupon is not active or has expired.' };
            }

            if (coupon.usage_quantity !== null && coupon.usage_quantity < 1) {
                return { discount: 0, message: 'This coupon has no uses left.' };
            }

            // Check if the user is eligible to use the coupon
            let isEligible = false;
            if (coupon.assigned_coupon === 'all_users') {
                isEligible = true;
            } else if (coupon.assigned_coupon === 'specific_users' && coupon.assigned) {
                const assignedData = JSON.parse(coupon.assigned);
                if (assignedData.type === 'specific' && assignedData.users.includes(userId)) {
                    isEligible = true;
                }
            }

            if (!isEligible) {
                return { discount: 0, message: 'You are not eligible to use this coupon.' };
            }

            // Checkin if the user has already used this coupon
            const usedByUsers = coupon.used_by ? JSON.parse(coupon.used_by) : [];
            if (usedByUsers.includes(userId)) {
                return { discount: 0, message: 'You have already used this coupon.' };
            }

            // Check if the coupon applies to the specific product being purchased
            if (coupon.scope === 'specific_product' && coupon.product !== productForPurchase) {
                return { discount: 0, message: `This coupon is only valid for ${coupon.product}.` };
            }

            // Check if the transaction amount meets the coupon's minimum amount requirement
            if (coupon.min_amount && parseFloat(transactionAmount) < parseFloat(coupon.min_amount)) {
                return { discount: 0, message: `This coupon requires a minimum transaction amount of NGN ${formatAmount(coupon.min_amount)}.` };
            }

            // If All checks passed, calculate discount and update coupon
            const discountAmount = parseFloat(coupon.amount);
            if (discountAmount > transactionAmount) {
                return { discount: 0, message: 'Coupon value is greater than the transaction amount.' };
            }

            // Update coupon state
            usedByUsers.push(userId);
            coupon.used_by = JSON.stringify(usedByUsers);
            if (coupon.usage_quantity !== null) {
                coupon.usage_quantity -= 1;
            }
            await coupon.save({ transaction: t });

            return { discount: discountAmount, message: 'Coupon applied successfully.', couponName: coupon.name };

        } catch (error) {
            console.error(`[applyCouponDiscount] Error:`, error.message);
            return { discount: 0, message: 'An error occurred while applying the coupon.' };
        }
    };

    if (transaction) {
        return await operation(transaction);
    } else {
        console.warn(`[applyCouponDiscount] Warning: Running without a parent transaction for user ${userId}.`);
        return await db.sequelize.transaction(operation);
    }
};

const toDecimalPlace = async(num, decimals)=>{
    const result = Number(num.toFixed(decimals));
    console.log(result); // 0.000492
    return result;
}

const createMPLDCustomer = async (userid) => {
  try {
    if (!userid) {
      return [false, 'Oops! Invalid request sent!', { errortype: "" }];
    }

    // --- Parallel Database Lookups ---
    const [userinfo, kycRecord, idCardDoc, passportDoc] = await Promise.all([
      getUserInfo(userid),
      KYC.findOne({
        where: { userid: userid, status: 1, [Op.or]: [{ vertype: 'BVN' }, { vertype: 'NIN' }, { provider: 'veriff' }] },
        order: [['id', 'DESC']]
      }),
      KycDoc.findOne({ where: { userid: userid, tier: 2, doctype: 'idcard', docstatus: { [Op.in]: [1, 2] } } }),
      KycDoc.findOne({ where: { userid: userid, doctype: { [Op.in]: ['passport', 'interpass', 'ssn'] }, docstatus: { [Op.in]: [1, 2] } } })
    ]);

    // --- Initial Validations ---
    if (!userinfo) {
      return [false, 'Unable to load your account, kindly logout and re-login!', { errortype: "" }];
    }

    if (!kycRecord) {
        if(userinfo.countrycode == 'NG'){
            return [false, 'Kindly complete your BVN/NIN verification in order to proceed', { errortype: "verificaton" }];
        }else{
            return [false, 'Kindly complete your facial verification in order to proceed', { errortype: "verificaton" }];
        }
        
    }

    const { address, city, state, postalcode } = userinfo;

    if (!address || !city || !state || !postalcode) {
      return [false, 'Kindly update your profile address, city, postal code/zipcode and state before proceeding', { errortype: "profile" }];
    }

    // --- Determine Identity Document and Number ---
    let getkycdoc, identityNumber, kycidno;
    
    if (userinfo.countrycode !== 'NG') {
      getkycdoc = passportDoc;
      if (!getkycdoc) {
        return [false, 'Kindly submit a valid passport in order to proceed', { errortype: "extrakyc" }];
      }
      identityNumber = getkycdoc.docno;
      kycidno = getkycdoc.docno;

    } else {
        // NIGERIANS
      getkycdoc = idCardDoc;
      if (!getkycdoc) {
        return [false, 'Kindly submit a valid Government ID Card in order to proceed', { errortype: "kyc" }];
      }
      identityNumber = kycRecord.bvv;
      kycidno = getkycdoc.docno || kycRecord.bvv;
    }

    // --- Prepare Payload ---
    const { verfname, verlname, verphone, verdob } = kycRecord;
    const dateOfBirth = moment(verdob, 'YYYY-MM-DD').format('DD-MM-YYYY');
    const userphoneno = verphone ? cleanPhoneNumber(verphone) : cleanPhoneNumber(userinfo.phoneno);
    const dialcode = userinfo.dialcode || '+234';

        if ((getkycdoc.docname != '' && (getkycdoc.docname == 'NIN' && getkycdoc.docname == 'VOTERS_CARD'))) {
            var kycdocname = getkycdoc.docname.toUpperCase();
        }else if(getkycdoc.docname == 'International Passport' || getkycdoc.docname == 'passport'){
            var kycdocname = 'PASSPORT';
        }else if(getkycdoc.docname == 'Driver License' || getkycdoc.docname == 'drivers_license'){
            var kycdocname = 'DRIVERS_LICENSE';
        }else {
            var kycdocname = 'NIN';
        }

        const data = JSON.stringify({
            first_name: verfname,
            last_name: verlname,
            email: userinfo.email,
            country: userinfo.countrycode,
            dob: dateOfBirth,
            phone: { phone_country_code: dialcode, phone_number: userphoneno },
            address: {
                street: address,
                city: city,
                state: state,
                country: userinfo.countrycode,
                postal_code: postalcode
            },
            identification_number: identityNumber,
            identity: {
                type: kycdocname,
                image: getkycdoc.docurl,
                number: kycidno,
                country: !getkycdoc.issuancecountry || getkycdoc.issuancecountry === '' ? userinfo.countrycode : getkycdoc.issuancecountry
            }, 
            
            photo: getkycdoc.docurl,
        })

        // console.log('datadebug: ', data);

        await LogRequest.create({ reference: userid, jsonreq: data, timed: '', product: 'kaduser', provider: 'mpld' });

        let config = {
            method: 'post',
            url: `${process.env.MPLDURL}/customers/enroll`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
            data: data
        };

        let response = await axios.request(config);
        let thedata = response.data;
        if (thedata.status && thedata['data']['status'] == 'COMPLETED') {
            const respdata = thedata['data'];
            const trackiID = respdata['id'];
            const tier = respdata['tier'];

            /* update the record */
            let timed = Date.parse(new Date()) / 1000;
            await CardUser.create({ userid: userid, trackingid: trackiID, provider: 'MPLD', tier: tier, timed: timed, status: 1 });

            return [true, 'US Profile Successfully Created', {trackingid: trackiID}];

        } else {
            return [false, 'Unable to process your request at the moment', {errortype: ""}];
        }

    } catch (error) {
        logger.error(error);
        console.error('createMPLDCustomer Error:', error.message);

        if (error.response && error.response.data) {
            console.error('Provider API Error:', JSON.stringify(error.response.data, null, 2));
            return [false, error.response.data.message || 'Failed to create profile with provider.', {errortype: ""}];
        } else {
            return [false, 'An unexpected error occurred. Please try again shortly.', {errortype: ""}];
        }
    }
}

function cleanPhoneNumber(phone) {
    // Remove all non-digit characters first (optional, in case user types spaces or dashes)
    phone = phone.replace(/\D/g, "");

    // Remove leading 0 if it exists
    return phone.replace(/^0+/, "");
}

const calcCheckOutFee = async (provider, amount, currency) => {
  const getsett = await AppSett.findOne({ where: { id: 1 } });
    const checkoutfee = getsett?.checkoutfee || 0;
    const crosscollectfee = getsett?.crosscollectfee || 0;
    const checkoutcap = getsett?.checkoutcap || 0;

  let gatewayfee = 0; let TotalFee = 0; let ourfee = 0;
  let gatewaytotal = 0;

  if(provider == 'stripe' || currency == 'USD'){
    gatewayfee = 2.9;

    var gatwaycalc = (gatewayfee / 100) * amount; //gateway fee
    var extracent = gatwaycalc + (30 / 100); //2.9% + 30 cent
    // var extracent21 = (1.5 / 100) * amount; //1.5% for international card
    // gatewaytotal = gatwaycalc + parseFloat(extracent21) + parseFloat(extracent);
    gatewaytotal = gatwaycalc + parseFloat(extracent);

    // our fee
    ourfee = (parseFloat(crosscollectfee) / 100) * parseFloat(amount);
    const toChargeCalc = ourfee + gatewaytotal;

    TotalFee = checkoutcap > 0 && toChargeCalc > checkoutcap ? checkoutcap : toChargeCalc;
  }else if(provider == 'safehaven' || currency == 'NGN'){
        gatewayfee = 1.5;

        var gatwaycalc = (gatewayfee / 100) * amount; 
        gatewaytotal = gatwaycalc;

        // our fee
        ourfee = (parseFloat(checkoutfee) / 100) * parseFloat(amount);
        const toChargeCalc = ourfee + gatewaytotal;

    TotalFee = checkoutcap > 0 && toChargeCalc > checkoutcap ? checkoutcap : toChargeCalc;
  }

  return [true, gatewaytotal, ourfee, TotalFee];

}


const processPendingInvitations = async (newUser, options = {}) => {
    const { transaction } = options;
    if (!newUser || !newUser.id || !newUser.email) {
        logger.warn('[processPendingInvitations] Invalid newUser object provided.');
        return;
    }

    const operation = async (t) => {
        try {
            const pendingInvites = await db.bizinvites.findAll({
                where: { email: newUser.email, status: 0 }, // 0 = pending
                transaction: t
            });

            if (pendingInvites.length === 0) {
                return; // No pending invites for this user
            }

            for (const invite of pendingInvites) {
                // Add user to the business team
                await db.bizteam.create({
                    bizid: invite.business_id,
                    customerid: newUser.id,
                    role: invite.assignrole,
                    staffid: invite.staffid,
                    staffpin: invite.staffpin, // The pre-set hashed PIN
                    status: 1, // Active
                    timed: Math.floor(Date.now() / 1000)
                }, { transaction: t });

                // Delete the consumed invitation
                await invite.destroy({ transaction: t });

                logger.info(`User ${newUser.id} automatically added to business ${invite.business_id} from pending invite.`);

                // Notifications
                const business = await db.business.findByPk(invite.business_id, { transaction: t });
                if (business) {
                    const notificationTitle = 'You\'ve Joined a Business Team!';
                    const notificationMessage = `Welcome! You have automatically been added to the "${business.business_name}" team as a ${ucFirst(invite.assignrole)}.`;
                    await notifyMe(newUser.id, notificationTitle, 'user', notificationMessage);
                    await pushNotify(newUser.id, notificationTitle, notificationMessage);
                    // sene email
                    const emailContent = `
                        <div>
                            <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">Welcome to the Team!</h3>
                            <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                            <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                                <p style="line-height: 20px; letter-spacing: 0.025em;">
                                    Hello ${newUser.firstname} <span style="font-size: 18px;">👋</span></p>
                                <p style="line-height: 28px; letter-spacing: 0.025em;">
                                    You have successfully joined the <strong>${business.business_name}</strong> team on HitchPay as a <strong>${ucFirst(invite.assignrole)}</strong>.
                                    You can now access the business dashboard and perform tasks assigned to your role.
                                </p>
                                <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                            </div>
                        </div>
                    `;
                    mailSender(newUser.firstname, 'Welcome to the Team!', newUser.email, emailContent);
                }
            }
        } catch (error) {
            logger.error(`[processPendingInvitations] Error for user ${newUser.id}:`, error);
            throw error; // Re-throw to ensure transaction is rolled back
        }
    };

    if (transaction) {
        await operation(transaction);
    } else {
        await db.sequelize.transaction(operation);
    }
};


const checkTransAuth = async (userid, authtoken) => {
    try {
        let decoded;
        try {
            decoded = jwt.verify(authtoken, process.env.JWT_SECRET);
        } catch (err) {
            const message = err.name == 'JsonWebTokenError' ? 'Invalid token.' : err.name == 'TokenExpiredError' ? '2FA Token has expired.' : err.name == 'NotBeforeError' ? ' 2FA Token is not yet valid.' : err.message;
            return [false, message];
        }

        const verUserID = decoded.id;
        if (String(verUserID) !== String(userid)) {
            return [false, '2FA Token user mismatch.'];
        }

        const checkToken = await otpVer.findOne({ where: { token: authtoken, status: 0, otptype: 'transauth', userid: userid} });
        if (!checkToken) {
            return [false, 'Invalid or expired 2FA token.'];
        }

        // invalidate the token after use
        // await otpVer.update({ status: 1 }, { where: { token: authtoken } });

        return [true, 'Token verified successfully.'];

    } catch (error) {
        console.error('check TransAuth Error:', error);
        logger.error(`check TransAuth Error for user ${userid}:`, error);
        return [false, 'Server error during token verification. Retry later.'];
    }
}

module.exports = {
    formatAmount, ucFirst, generatePassword, generateRegCode,
    cleanMe, formatPhoneNumber, shAcessToken, ucFirst, validatePassword, getFee,
    TransLimit, FreeTransfersCount, getTransferFee, updateBalance, genSHAccount, validateCacNumber, dispatchEvent,
    calculateProfitAndFee, giveWelcomeBonus, logReferEarn, dailyBonus, referralUplineDownlineBonus,
    psb9Token, gen9PSBAccount, toTwoDecimal, processBonus, USAccountUpd, getFX, checkinBonus, 
    applyTaskBonus, applyCouponDiscount, toDecimalPlace, createMPLDCustomer, updateLedgerBalance, calcCheckOutFee,
    processPendingInvitations, genSHBizAccount, genProvidusAccount, publicCDN_Fx, getYCFX, mapleradFx, genGTBankAccount, 
    genBizGTBAccount, checkTransAuth
};