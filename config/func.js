const db = require('../models')
const { json } = require('sequelize');
const { Op, fn } = require("sequelize");
const http = require('https');
const axios = require('axios');
const randomstring = require("randomstring");
const moment = require('moment');
const { getUserInfo } = require("./userdetails");
const { sendSMS, sendWhatsApp, pushNotify, notifyMe } = require("./notifyuser");
const { mailSender } = require("./mailsender");
const md5 = require('md5');
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
            .replace(/'/g, '')
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
    } else if (typeof input === 'object' && input !== null) {
        // Recursively sanitize objects or arrays
        for (let key in input) {
            if (input.hasOwnProperty(key)) {
                input[key] = cleanMe(input[key]);
            }
        }
        return input;
    }
    // Return other types (numbers, booleans, null, undefined) as-is
    return input;
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

    return "Invalid number";
}

const shAcessToken = async () => {
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

    const jsonString = JSON.stringify(thedata);
    if (thedata.access_token) {
        const access_token = thedata.access_token
        const expires_in = thedata.expires_in
        const client_id = thedata.client_id
        const refresh_token = thedata.refresh_token
        const ibs_client_id = thedata.ibs_client_id
        const ibs_user_id = thedata.ibs_user_id

        return [true, access_token, ibs_client_id, ibs_user_id, refresh_token];
    } else {
        return [false, '', '', '', ''];
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

        let fee = 0; let providerfee = 0;
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

        return [fee, providerfee, feeData.feetype];

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

            if (feetype === 'fixed') {
                var dfee = fee;
                dproviderfee = providerfee
            } else if (feetype === 'percentage') {
                var dfee = (transamount * fee_percentage) / 100;
                var dproviderfee = (transamount * providerfee) / 100;
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
async function updateBalance(userId, amount, currency, type, options = {}, isswap = false) {
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
            where: { uid: userId, currency: currency },
            transaction: t,
            lock: t.LOCK.UPDATE // Pessimistic lock to prevent race conditions
        });

        if (!wallet) {
            if (isswap) {
                const now = Math.floor(Date.now() / 1000);
                [wallet] = await Wallets.findOrCreate({
                    where: { uid: userId, currency: currency },
                    defaults: { email: '', wbal: 0, timecreated: now, lastupdated: now, status: 1 },
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


const genSHAccount = async (userid, verid, bvnno, otpcode, vertype, dob = '', verphone = '', countrycode = 'NG') => {

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
        console.log('dateOfBirthReal', dob)
        console.log('modifiydateOfBirth', dateOfBirth)

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
                userid: userid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, bankcode: bankcode, trackid: accountid, trackingref: accountid, jsonresp: jsonString, accounttype: accountType, provider: 'safehaven', currency: 'NGN'
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
                        Hello ${fname} <span style="font-size: 18px;">😍</span></p>
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
            return [false, thedata.message, '', '', '']
        }

    } else {
        return [false, `Something went wrong, kindly try again`, '', '', '']

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

    // console.log('productDetails', productDetails)
    // console.log('transactionAmount', transactionAmount)

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

    // console.log('providerImpactOnOurProfit', providerImpactOnOurProfit)

    // Calculate our charge/discount to the customer
    if (feetype === 'discount') {
        if (feemodel === 'percentage') {
            ourChargeToCustomer = -(parsedOurRate / 100) * parsedTransactionAmount;
        } else if (feemodel === 'fixed') {
            ourChargeToCustomer = -parsedOurRate;
        }
    } else if (feetype === 'charge') {
        if (feemodel === 'percentage') {
            ourChargeToCustomer = (parsedOurRate / 100) * parsedTransactionAmount;
        } else if (feemodel === 'fixed') {
            ourChargeToCustomer = parsedOurRate;
        }
    }

    console.log('ourChargeToCustomer', ourChargeToCustomer)


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

const logReferEarn = async (userid, transref) => {
    /* Log the refereral earning */
    const getsett = await AppSett.findOne({ where: { id: 1 } });
    if (!getsett) {
        console.error("Application settings not found. Cannot process referral earnings.");
        return false;
    }

    var eligible_refamt = getsett.eligible_refamt;  //musst have done atleast sum of this
    var referearn = getsett.referearn;
    var referbenchmark = getsett.referbenchmark;
    var refermilestone_enabled = getsett.refermilestone_enabled;

    if (!refermilestone_enabled) return false;  //dont proceed

    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return false;

    /* get Boss info */
    var mybosscode = getuser.referby;
    if (!mybosscode) { // Explicitly check if a referrer exists
        return false;
    }

    var sendername = `${getuser.firstname} ${getuser.lastname}`;

    const getboss = await Customer.findOne({ where: { bvverify: 2, [Op.or]: [{ refcode: mybosscode }, { uname: mybosscode }] } });

    if (!getboss)
        return false;

    var bossid = getboss.id;

    /* check if hhe boss has been paid */
    const checkpayouts = await logEarning.findOne({ where: { userid: bossid, payfrom: userid, type: 'referral' } })

    if (checkpayouts)
        return false;

    if (referbenchmark == 'KYC') {
        var userinfo = await getUserInfo(userid); //check if the upline/customer i refer has done kyc
        var bvverify = userinfo.bvverify;

        if (bvverify == '2') {
            //give him bonus
            const earnref = transref + '_ENKRF';
            let timed = Date.parse(new Date()) / 1000;

            var logit = await logEarning.create({
                userid: bossid, amount: referearn, product: `Referral Earn from ${sendername}`,
                type: 'referral', reference: earnref, status: 0, timed: timed, payfrom: userid
            });

            if (!logit) return false;

            /* send notify */
            var notedesc = `You've just earn N${formatAmount(referearn)} as referral bonus for ${sendername}`;
            notifyMe(bossid, 'Referral Earning', 'user', notedesc)
            return true;
        }

    } else {
        //transaction benchmark
        /* check if his total debit is up to the eligible amount */
        // const totalSpend = await Payn.sum('amount', { where: { userid: userid, status: 1, paytype: 'debit',  } });
        const totalSpend = await Payn.sum('amount', { where: { userid: userid, status: 1, paytype: 'debit', pfor: { [Op.ne]: 'transfer' } } });
        if (totalSpend >= eligible_refamt) {
            //give bonus
            const earnref = transref + '_ENRF';
            let timed = Date.parse(new Date()) / 1000;

            var logit = await logEarning.create({
                userid: bossid, amount: referearn, product: `Referral Earn from ${sendername}`,
                type: 'referral', reference: earnref, status: 0, timed: timed, payfrom: userid
            });

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

const dailyBonus = async (userid, transref) => {
    try {
        // 1. Get App Settings and check if the feature is enabled
        const settings = await AppSett.findOne({ where: { id: 1 } });
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
            }
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
                },
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
            });

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

        console.log('data', options)

        let response = await axios.request(options);
        let thedata = response.data;
        console.log('thedata', thedata)
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
                userid: userid, inactive: 0, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, bankcode: bankcode, trackid: accountid, trackingref: accountid, jsonresp: jsonString, accounttype: accountType, provider: '9psb', currency: 'NGN'
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
                        Hello ${fname} <span style="font-size: 18px;">😍</span></p>
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


const USAccountUpd = async (reference, userid) => {

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
                            userid: userid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, bankcode: routing_number, trackid: accountid, currency: 'USD', trackingref: '', jsonresp: jsonString, accounttype: 'ACH, FEDWIRE', provider: 'mpld'
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
                                Hello ${fname} <span style="font-size: 18px;">😍</span></p>
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


module.exports = {
    formatAmount, ucFirst, generatePassword, generateRegCode,
    cleanMe, formatPhoneNumber, shAcessToken, validatePassword, getFee,
    TransLimit, FreeTransfersCount, getTransferFee, updateBalance, genSHAccount,
    calculateProfitAndFee, giveWelcomeBonus, logReferEarn, dailyBonus, referralUplineDownlineBonus,
    psb9Token, gen9PSBAccount, toTwoDecimal, processBonus, USAccountUpd
};