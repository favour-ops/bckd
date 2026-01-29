const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
// const { Op } = require("sequelize");
const { Op, fn, col } = require("sequelize");
const md5 = require('md5');
const https = require('https');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const randomstring = require("randomstring");
const axios = require('axios');
const axiosApiClient = require('../config/axiosInstance');
const { getUserInfo, logAudit, logBeneficiary, getBal } = require("../config/userdetails");
const { mailSender } = require("../config/mailsender");
const { cloudinary, firebaseUpload, AWSFileUpload } = require("../config/imageuploads");
const { notifyMe, sendSMS, pushNotify } = require("../config/notifyuser");
const { formatAmount, ucFirst, cleanMe, formatPhoneNumber,getFX, updateBalance, createMPLDCustomer } = require("../config/myfunct");
const { stringify } = require('querystring');
const express = require('express');
const moment = require('moment');
const { client } = require('../config/redisClient');
const { logger } = require('../config/logger'); 
const { sendSystemNotification } = require('../config/systemNotifier');

//create main Model
const Customer = db.customers;
const Payn = db.payn;
const OfflinePay = db.offlinepay;
const Product = db.products;
const Admin = db.admin;
const KycDoc = db.kycdoc;
const KYC = db.kyc;
const LogRequest = db.logrequest;
const AppSett = db.appsettings;
const CardUser = db.kadusers
const VCard = db.vkads;
const CardTrans = db.cardtrans;
const AcctRequest = db.accountrequest;
const Bank = db.bankacct;
const Benefit = db.benefit;

const getExchange = async (req, res) => {
    const { currency_from, currency_to, amount, type } = req.body

    if (!currency_to || currency_to == '')
        return res.status(400).json({ status: false, message: 'Kindly specify source currency and retry' });

    if (!currency_from || currency_from == '')
        return res.status(400).json({ status: false, message: 'Kindly specify target currency and retry' });

    const getsett = await AppSett.findOne({ where: { id: 1 } });

    if (!getsett)
        return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

    const { dollarfee, dollarwithdraw, dollarfund } = getsett;

    // Determine margin action: Add for costs (issuance/funding), Subtract for payouts (withdraw/swap)
    let marginAction = 'add';
    if (type !== 'issuance' && type !== 'funding') {
        marginAction = 'subtract';
    }

    const getrate = await getFX(currency_from, currency_to, amount, marginAction);
    if (getrate[0]) {
        var rate = getrate[1];
        var quoteid = getrate[2];
    } else {
        var rate = 0;
        var quoteid = '';
    }

    if (dollarfee <= 0)
        return res.status(400).json({ status: false, message: 'Unable to get issuance fee. Kindly contact our support' });

    if (rate <= 0)
        return res.status(400).json({ status: false, message: 'Unable to get exchange rate. Kindly contact our support' });

    let ourfee;
    let converted_amount;
    let final_amount; // This will be the amount after fees are applied

    if (type == 'issuance') {
        ourfee = parseFloat(dollarfee) * parseFloat(rate);  //convert to NGN
        converted_amount = parseFloat(amount) * parseFloat(rate);
        final_amount = converted_amount + ourfee;
    } else if (type == 'funding') {
        const thepercent = (parseFloat(dollarfund) / 100) * parseFloat(amount);  // 2/100 * 10
        ourfee = parseFloat(thepercent) * parseFloat(rate);  //convert to NGN
        converted_amount = parseFloat(amount) * parseFloat(rate);
        final_amount = converted_amount + ourfee;
    } else if (type == 'withdraw') {
        //when fee is percentage
        const thepercent = (parseFloat(dollarwithdraw) / 100) * parseFloat(amount);  // 2/100 * 10
        ourfee = parseFloat(thepercent) * parseFloat(rate);  //convert to NGN
        converted_amount = parseFloat(amount) * parseFloat(rate);
        final_amount = converted_amount - ourfee;

    } else {
        // for swap
        ourfee = parseFloat(dollarfee) * parseFloat(rate);  //convert to NGN
        if(currency_to == 'USD'){ ourfee = dollarfee}
        // topay = (parseFloat(amount) * parseFloat(rate)) - parseFloat(ourfee);
        // for swap (e.g., NGN to USD)
        // The rate is how many target units you get for 1 source unit.
        converted_amount = parseFloat(amount) * parseFloat(rate);

        // Fee calculation depends on the target currency
        if (currency_to.toUpperCase() === 'USD') {
            ourfee = parseFloat(dollarfee); // Fee is in USD
        } else {
            ourfee = parseFloat(dollarfee) * parseFloat(rate); // Convert USD fee to target currency (e.g., NGN)
        }
        final_amount = converted_amount - ourfee;
    }

    res.json({
        status: true,
        message: 'Exchange Retrieved',
        data: {
            amount: parseFloat(amount),
            converted_amount: parseFloat(converted_amount.toFixed(4)), // The direct conversion before fees
            rate: parseFloat(rate),
            fee: parseFloat(ourfee),
            convert: parseFloat(final_amount.toFixed(4)), // The final amount after fees
            final_amount: parseFloat(final_amount.toFixed(4)), // The final amount after fees
            convert: parseFloat(final_amount.toFixed(4)), // The final amount after fees
            currency: currency_to,
            source_currency: currency_from,
            target_currency: currency_to,
            quoteid: quoteid
        }
    })
}


const fundSwap = async (req, res) => {
    try {

        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const { curryfrom, curryto, amount, transpin } = cleanMe(req.body);

        const userinfo = await getUserInfo(userid);  // get user info
        const authpin = userinfo.authpin;

        if (!authpin)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        if (!curryfrom || curryfrom == '' || !curryto || curryto == '')
            return res.status(400).json({ status: false, message: 'Source and target currency is required' });

        if (curryfrom.toLowerCase() == curryto.toLowerCase())
            return res.status(400).json({ status: false, message: 'Invalid currency pair' });

        /* if (curryfrom != 'NGN' && curryfrom != 'USD')
            return res.status(400).json({ status: false, message: 'Unexpected currency pair' });

        if (curryto != 'NGN' && curryto != 'USD')
            return res.status(400).json({ status: false, message: 'Unexpected currency pair' }); */

        if (!amount || amount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (amount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        //create the card
        const getsett = await AppSett.findOne({ where: { id: 1 } });

        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

        if (getsett.dollarfee <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get exchange fee. Kindly contact our support' });


        var fee = getsett.dollarfee; //e.g 5
        var getrate = await getFX(curryfrom, curryto, amount, 'subtract'); //echange rate (Subtract margin for swaps)
        var rate = getrate[1];
        var quoteid = getrate[2];

        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        let timed = Date.parse(new Date()) / 1000;

        //debit amount
        let network = curryfrom + curryto;
        let currency = curryfrom;
        let todebit = amount;
        let convertAmount = amount * rate;

        // calculate fee
        if(curryto == 'USD'){
            var chargefee = fee; //fixed amount
            var calculatedProfit = (fee / rate);   //e.g 5/0.00158730158 to NGN
        }else{
            var chargefee = fee * rate;
            var calculatedProfit = fee * rate; //to NGN
        }

        let tosettle = convertAmount - chargefee;
        let targetCurrency = curryto;
        let paidthru = `${currency} Wallet`;

        if(tosettle <= 0){
            return res.status(400).json({status: false, message: 'Invalid settlement amount' });
        }

        const userbal = await getBal(userid, curryfrom);

        if (userbal > 0 && userbal >= todebit) {

            // --- Phase 1: Debit User and Log Initial Transaction ---
            const debitTransaction = await db.sequelize.transaction();
            let initialDebitLog;

            try {
                const newbal = await updateBalance(userid, todebit, currency, 'debit', { transaction: debitTransaction }, true);
                const pay_desc = `Fund exchange of ${currency} ${formatAmount(amount)}`;

                initialDebitLog = await Payn.create({
                    userid: userid, amount: todebit, amountval: todebit, newbal: newbal, prevbal: userbal, currency: currency,
                    txref: txref, pfor: 'fundconvert', usertype: 'user', paytype: 'debit', productid: rate, ntwk: network,
                    paidthru: paidthru, pay_desc: pay_desc, timed: timed, status: 0, // Status 0 for Pending
                    recipient: '', fee: '0', paychannel: 'Hitchpay', revenue: 0
                }, { transaction: debitTransaction });

                await debitTransaction.commit();

            } catch (debitError) {
                await debitTransaction.rollback();
                console.error(`[${txref}] Fund Swap Debit Error:`, debitError.message);
                return res.status(500).json({ status: false, message: 'Failed to debit account for swap. Please try again.' });
            }

            // --- Phase 2: External API Call (Outside of any transaction) ---
            let apiResponse;
            try {
                const config = {
                    method: 'post',
                    url: `${process.env.MPLDURL}/fx`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    },
                    data: { quote_reference: quoteid }
                };
                apiResponse = await axios.request(config);
            } catch (error) {

                logger.error(`[${txref}] Fund Swap Provider API Error:`, error.message);
                console.error(`[${txref}] Fund Swap Provider API Error:`, error.message);
                // --- Phase 3a: Handle API Failure (Refund) ---
                const refundTransaction = await db.sequelize.transaction();
                try {
                    await updateBalance(userid, todebit, currency, 'credit', { transaction: refundTransaction }, true);
                    await Payn.update({ status: 5, pay_desc: 'Swap failed at provider' }, { where: { id: initialDebitLog.id }, transaction: refundTransaction });
                    await refundTransaction.commit();
                    return res.status(400).json({ status: false, message: 'Currency exchange provider is currently unavailable.' });
                } catch (refundError) {
                    await refundTransaction.rollback();
                    console.error(`[${txref}] CRITICAL: API failed AND refund failed. Manual intervention required.`, refundError.message);
                    // Notify admin of critical failure
                    return res.status(500).json({ status: false, message: 'Something went wrong. Please contact support.' });
                }
            }


            // --- Phase 3b: Handle API Success (Credit and Finalize) ---
            const creditTransaction = await db.sequelize.transaction();
            try {
                const thedata = apiResponse.data;
                const jsonString2 = JSON.stringify(thedata);

                if (thedata.status) {
                    const provref = thedata.data.id;
                    const targetUserbal = await getBal(userid, targetCurrency, { transaction: creditTransaction });
                    const targetNewbal = await updateBalance(userid, tosettle, targetCurrency, 'credit', { transaction: creditTransaction }, true);

                    // Update original debit transaction to success
                    await Payn.update({ status: 1, productid: provref }, { where: { id: initialDebitLog.id }, transaction: creditTransaction });

                    // const revenue = parseFloat(chargefee) * rate;
                    const revenue = parseFloat(calculatedProfit);
                    const meta_data = JSON.stringify({ rate: parseFloat(rate), amount: amount, ourfee: chargefee, revenuengn: revenue});

                    // Log the credit part of the swap
                    const targetReference = `${txref}_${targetCurrency}`;
                    const narration = `Fund exchange settlement for ${currency} ${formatAmount(amount)}`;
                    await Payn.create({
                        userid: userid, recipient: '', amount: tosettle, amountval: tosettle, currency: targetCurrency, newbal: targetNewbal, prevbal: targetUserbal, txref: targetReference, pfor: 'fundconvert', paytype: 'credit', productid: rate, paychannel: 'Hitchpay', paidthru: '', meta: meta_data, ntwk: network, pay_desc: narration, timed: timed, status: 1, name: '', ntwkid: '', fee: chargefee, narration: narration, revenue: revenue, providerfee: 0, settlement_route: 'dollar'
                    }, { transaction: creditTransaction });

                    await creditTransaction.commit();

                    return res.json({
                        status: true,
                        message: thedata.message,
                        data: {
                            transref: txref,
                            transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"),
                            paystatus: 'Successful',
                            settleAmount: tosettle,
                            debitedAmount: todebit,
                            fee: chargefee,
                            network: network
                        }
                    });
                } else {
                    // API returned a non-success status
                    throw new Error(thedata.message || 'Currency exchange provider returned a failure status.');
                }
            } catch (error) {
                await creditTransaction.rollback();
                console.log("swap provider Error: ", error.message);
            }

            // Since the API call itself didn't throw, but processing its

        } else {
            return res.status(400).json({
                status: false,
                message: 'Insufficient balance to process currency ' + currency + formatAmount(amount)
            })
        }

    } catch (error) {
        res.json({ status: false, message: 'Unable to process exchange request at the moment' });
        console.log("cfx Error: ", error.message);
    }
}

const mockTrans = async (cardid) => {
    let config = {
        method: 'POST',
        url: `${process.env.MPLDURL}/test/issuing/${cardid}/mock-transaction`,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Authorization': `Bearer ${process.env.MPLSKEY}`
        },
        data: { amount: 13000, type: 'DEBIT' }
    };

    let response = await axios.request(config);
    let thedata = response.data;
    const jsonString = JSON.stringify(thedata);
    console.log(jsonString)
    return jsonString;

}
/* mockTrans('dd576f7a-8a23-460a-9083-58c12555b7f5')
.then(() => {
    console.log("Script finished.");
    process.exit(0);
})
.catch(err => {
    console.error("Script failed with error:", err);
    process.exit(1);
}); */


const listCurrencies = async (req, res) => {
    try {

        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/currencies`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;

        // console.log('thedata', thedata)

        if (thedata.status) {
            res.json({
                status: true,
                message: thedata.message,
                data: [
                    {
                        "name": "Nigerian Naira",
                        "currency": "NGN",
                        "symbol": "₦"
                    },
                    {
                        "name": "US Dollar",
                        "currency": "USD",
                        "symbol": "$"
                    }
                ]

                // data: thedata.data
            });

        } else {
            res.json({
                status: false, message: 'Unable to process request',
                data: []
            });
        }

    } catch (error) {
        console.log("currency list: Error", error.message);
        res.json({ status: false, message: 'Unable to process request at the moment' });
    }
}

const createUSDAccount = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { employ_status, job_desc, employer, us_residency_status, occupation } = req.body;

    if (!employ_status || employ_status == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your employment status', data: { errortype: "" } });

    if (!employer || employer == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your employer/company name', data: { errortype: "" } });

    if (!job_desc || job_desc == '')
        return res.status(400).json({ status: false, message: 'Kindly state your employment description', data: { errortype: "" } });

    if (!occupation || occupation == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your occupation or job role', data: { errortype: "" } });

    if (!us_residency_status || us_residency_status == '')
        return res.status(400).json({ status: false, message: 'Do you resides in US?', data: { errortype: "" } });

    // check if doesnt have a pending usd account request
    const getpending = await AcctRequest.findOne({ where: {userid: userid } });
    if(getpending){
        if(getpending.status == 0 || getpending.status == 1 || getpending.status == 2 )
            return res.status(400).json({ status: false, message: 'You currently have a request processing' });

        if(getpending.status == 4)
            return res.status(400).json({ status: false, message: 'You currently have a USD account provisioned' });

        var currentStatus = getpending.status

    }else{
        var currentStatus = 0
    }

    const statement = req.file;
    if (statement == '' || (!statement))
        return res.status(400).json({ status: false, message: 'No bank statement uploaded' });

    const getsett = await AppSett.findOne({ where: { id: 1 } });
    if (!getsett)
        return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

    const userinfo = await getUserInfo(userid);  // get user info
    const authpin = userinfo.authpin;

    const userbal = await getBal(userid, 'USD');

    //check if he has declined request
    if(currentStatus == 3){
        var creationFee = 0;  //free
        var currentStatus = 3
    }else{
        var creationFee = getsett.usacctfee;
    }

    if (creationFee > 0 && userbal < creationFee)
        return res.status(400).json({ status: false, message: 'Unable to process request due to insfficient balance' });

    // const getkycdoc2 = await KycDoc.findOne({ where: { userid: userid, doctype: 'interpass', docstatus: 2 } });
    // const getkycdoc2 = await KycDoc.findOne({where: {[Op.and]: [{ userid: userid }, { doctype: 'interpass' }, { [Op.or]: [{ docstatus: 1 }, { docstatus: 2 }] }]}});

    const getkycdoc2 = getkycdoc2 = await KycDoc.findOne({ where: { userid: userid, doctype: {[Op.in]: ['passport', 'interpass']}, docstatus: { [Op.in]: [1, 2] }} });

    if (!getkycdoc2)
        return res.status(400).json({
            status: false,
            message: 'Kindly complete your international passport KYC in order to proceed',
            data: {
                errortype: "extrakyc",
            }
        });

    // const utilityDoc = await KycDoc.findOne({ where: { {userid: userid}, {tier: 2}, {doctype: 'utility'}, {[Op.or]: [{ docstatus: 1 }, { docstatus: 2 }]}} });

    // const utilityDoc = await KycDoc.findOne({where: {[Op.and]: [{ userid: userid },{ tier: 2 }, { doctype: 'utility' }, { [Op.or]: [{ docstatus: 1 }, { docstatus: 2 }] }]}});
    const utilityDoc = await KycDoc.findOne({
    where: {
        [Op.and]: [
        { userid: userid }, { doctype: 'utility' },
        { tier: { [Op.in]: [2, 3] } },
        { [Op.or]: [{ docstatus: 1 }, { docstatus: 2 }] }
        ]
    },
    order: [['id', 'DESC']] // optional if you want the latest
    });


    if (!utilityDoc)
    return res.status(400).json({
        status: false,
        message: 'Kindly complete your proof of address KYC in order to proceed',
        data: {
            errortype: "kyc",
        }
    });

    const checkKadUser = await CardUser.findOne({ where: { userid: userid, provider: 'MPLD' } });
    if (!checkKadUser)
        return res.status(400).json({ status: false, message: 'Kindly setup USD profile  in order to proceed' });

    var trackiID = checkKadUser.trackingid;

    try {
        const { fileTypeFromBuffer } = await import('file-type'); // Dynamic import
        const fileTypeResult = await fileTypeFromBuffer(statement.buffer); // Use the buffer
        const allowedMimeTypesForPix = ["application/pdf"];

        if (!fileTypeResult || !allowedMimeTypesForPix.includes(fileTypeResult.mime)) {
            return res.status(400).json({ status: false, message: "Invalid file detected. Only pdf allowed." });
        }

        const originalExtension = statement.originalname.split('.').pop()?.toLowerCase();
        if (originalExtension !== fileTypeResult.ext) {
            console.warn(`Warning: File extension mismatch post-multer. User: ${userid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
        }

    } catch (fileTypeError) {
        console.error("Error during file type check in controller:", fileTypeError);
        return res.status(500).json({ status: false, message: "Error verifying file content." });
    }

    let thefile = '';
    /* upload licencedoc */
    const randomFileName = `stmt_${userid}_${uuidv4()}.pdf`;
    const doUpload = await AWSFileUpload(statement.buffer, randomFileName);
    if (doUpload[0]) {
        thefile = doUpload[1];
    }

    try {
            const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
            let timed = Date.parse(new Date()) / 1000;

            const debitTransaction = await db.sequelize.transaction();
            const meta = JSON.stringify({
                statement: thefile,
                employment_status: employ_status,
                employment_description: job_desc,
                nationality: 'NG',
                employer_name: employer,
                us_residency_status: us_residency_status,
                occupation: occupation
            });

            try {

                //===========CHARGE THE CUSTOMER AND LOG TRANSACTION===//

                if(currentStatus == 3){

                    await AcctRequest.update({status: 0, timed: timed, reference: '', meta: meta}, {where:{userid: userid, payref: getpending.payref}}, { transaction: debitTransaction });
                    await debitTransaction.commit();

                }else{
                    
                    var provfeedollar = 3; //provider fee $3
                    var getrate = await getFX('USD', 'NGN'); //echange rate
                    var rate = toDecimalPlace(getrate[1]);

                    const provfeeNGN = parseFloat(provfeedollar) * rate;  //to NGN
                    const creationFeeNGN = parseFloat(creationFee) * rate;  //to NGN
                    const revenue = parseFloat(creationFeeNGN) - parseFloat(provfeeNGN);

                    const meta_data = JSON.stringify({ rate: rate, amount: 0, ourfee: creationFee, revenuengn: revenue, providerfee: provfeedollar });
                
                    const newbal = await updateBalance(userid, creationFee, 'USD', 'debit', { transaction: debitTransaction });

                    const pay_desc = `USD account processing fee`;
                    initialPayLog = await Payn.create({
                        userid: userid, amount: creationFee, amountval: creationFee, newbal: newbal, prevbal: userbal, currency: 'USD',
                        txref: txref, pfor: 'usdaccount', usertype: 'user', paytype: 'debit', productid: '', ntwk: 'HitchPay',
                        paidthru: 'Wallet', pay_desc: pay_desc, timed: timed, status: 1, recipient: '', providerfee: provfeeNGN, revenue: revenue, settlement_route: 'dollar', meta: meta_data
                    }, { transaction: debitTransaction });
    
                    await debitTransaction.commit();

                    let thestatus = 0;
    
                     // log the account request
                    await AcctRequest.create({
                        userid: userid, currency: 'USD', jsonreq: '', jsonresp: '', status: thestatus, provider: 'MPLD',
                        timed: timed, account_id: '', reference: '', payref: txref, meta: meta
                    });

                }

                res.json({
                    status: true,
                    message: 'USD Account Request Submitted for Approval',
                    data: {
                        fee: creationFee
                    }
                });

            } catch (debitError) {

                await debitTransaction.rollback();
                // rollback the transaction.
                console.error(`usd acnt fail for ${txref}:`, debitError.message);
                return res.status(400).json({ status: false, message: 'Failed to process processing fee debit. Please try again.' });
            }


    } catch (error) {
        console.log("usacct Error: ", error.message);

        if (error.response && error.response.data) {
            console.error('usacct Error response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
        }
    }
}

const createUSDAccountNew = async (req, res, next) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    try {
        const { employ_status, job_desc, employer, us_residency_status, occupation, fileno, doctype, expirydate, issuance_country, walletmethod, fundsource } = req.body;

        // console.log('reqaccnt', req.body)
        let thedoctype;
        if(doctype == 'International Passport'){
            thedoctype = 'interpass';
        }else if(doctype == 'Driver License'){
            thedoctype = 'drivers_license';
        }else if(doctype == 'Passport'){
            thedoctype = 'interpass';
        }else{
            thedoctype = 'NIN';
        }

        // --- Parallel DB Lookups ---
        const [getsett, getpending, utilityDoc, cardUser] = await Promise.all([
            AppSett.findOne({ where: { id: 1 } }),
            AcctRequest.findOne({ where: { userid: userid } }),
            KycDoc.findOne({
                where: {
                    userid: userid,
                    doctype: 'utility',
                    docstatus: { [Op.in]: [1, 2] }
                },
                order: [['id', 'DESC']]
            }),
            CardUser.findOne({ where: { userid: userid, provider: 'MPLD' } })
        ]);

        // --- Initial Validations ---
        if (!getsett) return res.status(400).json({ status: false, message: 'USD Account service is temporarily unavailable.' });

        if (getpending) {
            if ([0, 1, 2].includes(getpending.status)) return res.status(400).json({ status: false, message: 'You currently have a request processing.' });
            if (getpending.status === 4) return res.status(400).json({ status: false, message: 'You already have a provisioned USD account.' });
        }

        if (!utilityDoc) return res.status(400).json({ status: false, message: 'Please complete your proof of address verification to proceed.', data: { errortype: "kyc" } });

        const requiredFields = { employ_status, job_desc, employer, us_residency_status, occupation, fund_source: fundsource };
        for (const [field, value] of Object.entries(requiredFields)) {
            if (!value) return res.status(400).json({ status: false, message: `Kindly specify your ${field.replace('_', ' ')}.` });
        }

        // --- File Handling ---
        const uploadfiles = req.files;
        const statement = uploadfiles?.['statement']?.[0];
        const passportFront = uploadfiles?.['passport']?.[0];
        const passportBack = uploadfiles?.['passportback']?.[0];

        if (!statement) return res.status(400).json({ status: false, message: 'Kindly upload your proof of funds.' });

        // Validate statement
        const { fileTypeFromBuffer } = await import('file-type');
        const statementFileType = await fileTypeFromBuffer(statement.buffer);
        if (!statementFileType || statementFileType.mime !== "application/pdf") {
            return res.status(400).json({ status: false, message: "Invalid statement file. Only PDF is allowed." });
        }

        // --- Handle Passport Document (Upload or Verify Existing) ---
        if (passportFront) {
            if (!passportBack) return res.status(400).json({ status: false, message: 'Passport back image is required.' });
            if (!fileno || !thedoctype || !issuance_country) return res.status(400).json({ status: false, message: 'ID number, type, and issuance country are required when uploading a new passport.' });

            // Parallel uploads
            const [frontUploadResult, backUploadResult] = await Promise.all([
                uploadKycDoc(passportFront, `kyc_intpsst_front_${userid}_${uuidv4()}`, userid),
                uploadKycDoc(passportBack, `kyc_intpsst_back_${userid}_${uuidv4()}`, userid)
            ]);

            if (!frontUploadResult.success || !backUploadResult.success) {
                return res.status(400).json({ status: false, message: 'Failed to upload one or both ID documents. Please try again.' });
            }

            const dtimed = Math.floor(Date.now() / 1000);
            const existingDoc = await KycDoc.findOne({
            where: { userid, doctype: thedoctype }
            });

            if (existingDoc) {
            await existingDoc.update({ docurl: frontUploadResult.url,
                docurl_back: backUploadResult.url, docno: fileno, expirydate, issuancecountry: issuance_country,
                docstatus: 1, tier: '', timed: dtimed
            });
            } else {
            await KycDoc.create({
                userid, doctype: thedoctype, docname: thedoctype, docurl: frontUploadResult.url, docurl_back: backUploadResult.url,
                docno: fileno, expirydate, issuancecountry: issuance_country, docstatus: 1, tier: '', timed: dtimed
            });
            }

        } else {
            const existingPassport = await KycDoc.findOne({ where: { userid: userid, doctype: 'interpass', docstatus: { [Op.in]: [1, 2] } } });
            if (!existingPassport) return res.status(400).json({ status: false, message: 'No valid international passport found or uploaded.' });
        }

        // --- Create MPLD Customer if not exists ---
        if (!cardUser) {

            const createMPLDKYC = await createMPLDCustomer(userid);
            if (!createMPLDKYC[0]) {
                return res.status(400).json({ status: false, message: createMPLDKYC[1] || 'Failed to create required user USD profile.' });
            }
        }

        // --- Fee and Balance Check ---
        const currentStatus = getpending?.status;
        const creationFeeUSD = (currentStatus == 3) ? 0 : getsett.usacctfee;

        let feeToDebit = 0;
        let debitCurrency = 'USD';
        let rate = 1;

        if (creationFeeUSD > 0) {
            if (walletmethod === 'NGN') {
                debitCurrency = 'NGN';
                const fxResult = await getFX('USD', 'NGN');
                if (!fxResult[0] || fxResult[1] <= 0) {
                    return res.status(400).json({ status: false, message: 'Could not retrieve NGN exchange rate for fee payment.' });
                }
                rate = fxResult[1];
                feeToDebit = creationFeeUSD * rate;
            } else {
                debitCurrency = 'USD';
                feeToDebit = creationFeeUSD;
            }

            const userbal = await getBal(userid, debitCurrency);
            if (userbal < feeToDebit) {
                return res.status(400).json({ status: false, message: `Insufficient ${debitCurrency} balance to pay the account creation fee.` });
            }
        }

        // --- Upload Statement ---
        const randomFileName = `stmt_${userid}_${uuidv4()}.pdf`;
        const [uploadSuccess, statementUrl] = await AWSFileUpload(statement.buffer, randomFileName);
        if (!uploadSuccess) {
            return res.status(400).json({ status: false, message: 'Failed to upload your bank statement. Please try again.' });
        }

        // --- Final DB Operations within a Transaction ---
        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        const timed = Math.floor(Date.now() / 1000);
        const meta = JSON.stringify({
            statement: statementUrl,
            employment_status: employ_status,
            employment_description: job_desc,
            nationality: 'NG',
            employer_name: employer,
            us_residency_status: us_residency_status,
            occupation: occupation,
            walletmethod: walletmethod,
            fundsource: fundsource
        });

        await db.sequelize.transaction(async (t) => {
            if (currentStatus === 3) {
                await AcctRequest.update({ status: 0, timed: timed, reference: '', meta: meta }, { where: { userid: userid, id: getpending.id }, transaction: t });
            } else {
                
                if (feeToDebit > 0) {
                    const userbal = await getBal(userid, debitCurrency, { transaction: t });
                    const newbal = await updateBalance(userid, feeToDebit, debitCurrency, 'debit', { transaction: t });

                    const provfeedollar = 3;
                    const provfeeNGN = parseFloat(provfeedollar) * rate;
                    const creationFeeNGN = parseFloat(creationFeeUSD) * rate;
                    const revenue = creationFeeNGN - provfeeNGN;

                    const meta_data = JSON.stringify({ rate, amount: 0, ourfee: creationFeeUSD, revenuengn: revenue, providerfee: provfeedollar });

                    await Payn.create({
                        userid, amount: feeToDebit, amountval: feeToDebit, newbal, prevbal: userbal, currency: debitCurrency,
                        txref, pfor: 'usdaccount', usertype: 'user', paytype: 'debit', productid: '', ntwk: 'HitchPay',
                        paidthru: 'Wallet', pay_desc: 'USD account processing fee', timed, status: 1, recipient: '',
                        providerfee: provfeeNGN, revenue, settlement_route: 'dollar', meta: meta_data
                    }, { transaction: t });
                }

                // await AcctRequest.create({
                await AcctRequest.upsert({
                    userid, currency: 'USD', jsonreq: '', jsonresp: '', status: 0, provider: 'MPLD',
                    timed, account_id: '', reference: '', payref: feeToDebit > 0 ? txref : null, meta
                }, { transaction: t });
            }
        });

        const userinfo = await getUserInfo(userid);
        if(userinfo){
            const subject = "New USD Account Request";
            const message = `
                <p>A new USD Account request has been submitted by a customer.</p>
                <ul>
                    <li><strong>Customer Name:</strong> ${userinfo.firstname} ${userinfo.lastname}</li>
                    <li><strong>Customer Email:</strong> ${userinfo.email}</li>
                </ul>
                <p>Please log in to the admin panel to review the request.</p>
            `;
            const channels = ['email', 'push']

            // This one call handles both email and push notifications
            sendSystemNotification({ subject, message, channels});
        }

        res.json({
            status: true,
            message: 'USD Account Request Submitted for Approval',
            data: { fee: feeToDebit, currency: debitCurrency }
        });

    } catch (error) {
        console.error("createUSDAccountNew Error: ", error.message);
        logger.error("createUSDAccountNew Error: ", { message: error, stack: error.stack });
        next(error); // Pass to global error handler
    }
}


async function uploadKycDoc(file, publicId, userid) {
    try {
        const { fileTypeFromBuffer } = await import('file-type');
        const fileType = await fileTypeFromBuffer(file.buffer);
        const allowedMimeTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        if (!fileType || !allowedMimeTypes.includes(fileType.mime)) {
            throw new Error(`Invalid file type: ${fileType?.mime || 'unknown'}`);
        }

        if (fileType.mime === 'application/pdf') {
            const randomFileName = `${publicId}.pdf`;
            const [uploadSuccess, fileUrl] = await AWSFileUpload(file.buffer, randomFileName);
            if (!uploadSuccess) throw new Error('AWS S3 upload failed.');
            return { success: true, url: fileUrl };
        } else {
            const processedBuffer = await sharp(file.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream({ public_id: publicId, resource_type: "image" }, (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                });
                uploadStream.end(processedBuffer);
            });
            return { success: true, url: result.secure_url };
        }

    } catch (error) {
        console.error(`KYC Doc upload failed for ${publicId}:`, error.message);
        logger.error(`KYC Doc upload failed for ${publicId}:`, error);
        return { success: false, url: null };
    }
}


const createUSDAccountKEEP = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const { employ_status, job_desc, employer, us_residency_status, occupation, fileno, doctype, expirydate, issuance_country, walletmethod} = cleanMe(req.body);

    const getsett = await AppSett.findOne({ where: { id: 1 } });
    if (!getsett)
        return res.status(400).json({ status: false, message: 'USD Account service is temporarily unavailable. Please try again later.' });

    // check if doesnt have a pending usd account request
    const getpending = await AcctRequest.findOne({ where: {userid: userid } });
    if(getpending){
        if(getpending.status == 0 || getpending.status == 1 || getpending.status == 2 )
            return res.status(400).json({ status: false, message: 'You currently have a request processing' });

        if(getpending.status == 4)
            return res.status(400).json({ status: false, message: 'You currently have a USD account provisioned' });

        var currentStatus = getpending.status

    }else{
        var currentStatus = 0
    }

    /* VALIDTE INPUT */

    if (!employ_status || employ_status == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your employment status', data: { errortype: "" } });

    if (!employer || employer == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your employer/company name', data: { errortype: "" } });

    if (!job_desc || job_desc == '')
        return res.status(400).json({ status: false, message: 'Kindly state your employment description', data: { errortype: "" } });

    if (!occupation || occupation == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your occupation or job role', data: { errortype: "" } });

    if (!us_residency_status || us_residency_status == '')
        return res.status(400).json({ status: false, message: 'Do you resides in US?', data: { errortype: "" } });

    const uploadfiles = req.files;
    const statement = uploadfiles['statement']?.[0];
    const passport = uploadfiles['passport']?.[0];
    const passportback = uploadfiles['passportback']?.[0];
    const fileupload = passport;
    const idcardback = passportback;
    const maxCount = 1;

    if (statement == '' || (!statement))
        return res.status(400).json({ status: false, message: 'Kindly upload your proof of funds' });

    // checck if passport is not uploaded, then check the kyc if he has submitted it already before
    if (!passport || passport == '') {
        const getkycdoc = await KycDoc.findOne({ where: { userid: userid, doctype: 'interpass', docstatus: { [Op.in]: [1, 2] } } });
        if (!getkycdoc)
            return res.status(400).json({ status: false, message: 'No international passport uploaded' });
    }else{

        if(!fileno || fileno == '')
        return res.status(400).json({ status: false, message: 'Kindly specify your ID number', data: { errortype: "" } });

        if(!doctype || doctype == '')
            return res.status(400).json({ status: false, message: 'Kindly specify your ID type', data: { errortype: "" } });

        if(!issuance_country || issuance_country == '')
            return res.status(400).json({ status: false, message: 'Kindly specify your ID issuance country', data: { errortype: "" } });

        if (!fileupload)
                return res.status(400).json({ status: false, message: 'ID front is required' });
    
        if (!idcardback)
            return res.status(400).json({ status: false, message: 'ID back is required' });
    
        if ((uploadfiles['fileupload'].length > maxCount) || (uploadfiles['idcardback'].length > maxCount))
            return res.status(400).json({ status: false, message: 'Document can not exceed 1 file per upload' });
    
        if (!fileno)
             return res.status(400).json({ status: false, message: 'Oops! ID number not specified!' });
    
        const { fileTypeFromBuffer } = await import('file-type');
        const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];
    
        // Process front image
        const frontTypeResult = await fileTypeFromBuffer(fileupload.buffer);
        if (!frontTypeResult || !allowedMimeTypesForPix.includes(frontTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid front file type." });

        const frontExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
        if (frontExtension !== frontTypeResult.ext)
            console.warn(`Warning: Front file extension mismatch. User: ${userid}`);
    
        // Process back image
        const backTypeResult = await fileTypeFromBuffer(idcardback.buffer);
        if (!backTypeResult || !allowedMimeTypesForPix.includes(backTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid back file type." });
    
        const backExtension = idcardback.originalname.split('.').pop()?.toLowerCase();
        if (backExtension !== backTypeResult.ext)
            console.warn(`Warning: Back file extension mismatch. User: ${userid}`);

        // Upload front file
        let thefile = '';
        if (frontExtension === 'pdf') {
            const randomFileName = `kyc_intpsst_${userid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) thefile = doUpload[1];
        } else {
            const processedBuffer = await sharp(fileupload.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_intpsst_front_${userid}_${uuidv4()}`;
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
            const randomFileName = `kyc_intpsst_back_${userid}_${uuidv4()}.pdf`;
            const doUploadBack = await AWSFileUpload(idcardback.buffer, randomFileName);
            if (doUploadBack[0]) thefileBack = doUploadBack[1];
        } else {
            const processedBackBuffer = await sharp(idcardback.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefileBack = await new Promise((resolve, reject) => {
                const randomFileName = `kyc_intpsst_back_${userid}_${uuidv4()}`;
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
            return res.status(400).json({ status: false, message: 'Unable to upload one of your ID documents. Please try again.' });

        //Searches for a record matching the where condition.
        //If not found, it creates it using the defaults values.
        /* const dtimed = Math.floor(Date.now() / 1000);
        const [kycDoc, created] = await KycDoc.findOrCreate({
            where: { userid: userid, doctype: {[Op.in]: ['passport', 'interpass', 'ssn']}},
            defaults: { userid: userid, docurl: thefile, docurl_back: thefileBack, docno: fileno, expirydate: expirydate, issuancecountry: issuance_country, docstatus: 1, doctype: 'interpass', docname: doctype, tier: '', timed: dtimed
            }
        });

        if (!created) {
            await kycDoc.update({docurl: thefile, docurl_back: thefileBack, docno: fileno, expirydate: expirydate, issuancecountry: issuance_country,
                docstatus: 1, doctype: doctype, docname: doctype, timed: dtimed});
        } */

    
        const dtimed = Math.floor(Date.now() / 1000);
        const result = await KycDoc.upsert({userid, doctype, docname: doctype, docurl: thefile, docurl_back: thefileBack, docno: fileno,
        expirydate, issuancecountry: issuance_country, docstatus: 1, tier: '', timed: dtimed
        });

        if (result === undefined) {
        return res.status(400).json({
            status: false,
            message: 'Unable to upload ID documents. Please try again.'
        });
        }
    }
    // const userinfo = await getUserInfo(userid);  // get user info
    // const authpin = userinfo.authpin;

    //check if he has declined request

    if(currentStatus == 3){
        var creationFee = 0;  //free
        var currentStatus = 3
    }else{
        var creationFee = getsett.usacctfee;
    }

    const userbal = await getBal(userid, 'USD');
    if (creationFee > 0 && userbal < creationFee)
        return res.status(400).json({ status: false, message: 'Unable to process request due to insfficient balance' });

    const utilityDoc = await KycDoc.findOne({where: {[Op.and]: [{ userid: userid }, { doctype: 'utility' }, 
        { [Op.or]: [{ docstatus: 1 }, { docstatus: 2 }] }]}, order: [['id', 'DESC']] // optional if you want the latest
    });

    if (!utilityDoc)
        return res.status(400).json({status: false, message: 'Kindly complete your proof of address verification in order to proceed', data: {errortype: "kyc"}});


    const checkKadUser = await CardUser.findOne({ where: { userid: userid, provider: 'MPLD' } });
    if (!checkKadUser){
        // return res.status(400).json({ status: false, message: 'Kindly setup USD profile  in order to proceed' });

        // CREATE CUSTOMER KYC ACCOUNT
        const createCardCustomer =await createMPLDCustomer(userid);
    }

    var trackiID = checkKadUser.trackingid;

    try {
        const { fileTypeFromBuffer } = await import('file-type'); // Dynamic import
        const fileTypeResult = await fileTypeFromBuffer(statement.buffer); // Use the buffer
        const allowedMimeTypesForPix = ["application/pdf"];

        if (!fileTypeResult || !allowedMimeTypesForPix.includes(fileTypeResult.mime)) {
            return res.status(400).json({ status: false, message: "Invalid file detected. Only pdf allowed." });
        }

        const originalExtension = statement.originalname.split('.').pop()?.toLowerCase();
        if (originalExtension !== fileTypeResult.ext) {
            console.warn(`Warning: File extension mismatch post-multer. User: ${userid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
        }

    } catch (fileTypeError) {
        console.error("Error during file type check in controller:", fileTypeError);
        return res.status(500).json({ status: false, message: "Error verifying file content." });
    }

    let thefile = '';
    /* upload licencedoc */
    const randomFileName = `stmt_${userid}_${uuidv4()}.pdf`;
    const doUpload = await AWSFileUpload(statement.buffer, randomFileName);
    if (doUpload[0]) {
        thefile = doUpload[1];
    }

    try {
            const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
            let timed = Date.parse(new Date()) / 1000;
            const debitTransaction = await db.sequelize.transaction();
            const meta = JSON.stringify({
                statement: thefile,
                employment_status: employ_status,
                employment_description: job_desc,
                nationality: 'NG',
                employer_name: employer,
                us_residency_status: us_residency_status,
                occupation: occupation
            });

            try {

                //===========CHARGE THE CUSTOMER AND LOG TRANSACTION===//
                if(currentStatus == 3){
                    await AcctRequest.update({status: 0, timed: timed, reference: '', meta: meta}, {where:{userid: userid, payref: getpending.payref}}, { transaction: debitTransaction });
                    await debitTransaction.commit();

                }else{
                    
                    var provfeedollar = 3; //provider fee $3
                    var getrate = await getFX('USD', 'NGN'); //echange rate
                    var rate = toDecimalPlace(getrate[1]);

                    const provfeeNGN = parseFloat(provfeedollar) * rate;  //to NGN
                    const creationFeeNGN = parseFloat(creationFee) * rate;  //to NGN
                    const revenue = parseFloat(creationFeeNGN) - parseFloat(provfeeNGN);

                    const meta_data = JSON.stringify({ rate: rate, amount: 0, ourfee: creationFee, revenuengn: revenue, providerfee: provfeedollar });
                
                    const newbal = await updateBalance(userid, creationFee, 'USD', 'debit', { transaction: debitTransaction });

                    const pay_desc = `USD account processing fee`;
                    initialPayLog = await Payn.create({
                        userid: userid, amount: creationFee, amountval: creationFee, newbal: newbal, prevbal: userbal, currency: 'USD',
                        txref: txref, pfor: 'usdaccount', usertype: 'user', paytype: 'debit', productid: '', ntwk: 'HitchPay',
                        paidthru: 'Wallet', pay_desc: pay_desc, timed: timed, status: 1, recipient: '', providerfee: provfeeNGN, revenue: revenue, settlement_route: 'dollar', meta: meta_data
                    }, { transaction: debitTransaction });
    
                    await debitTransaction.commit();

                    let thestatus = 0;
    
                     // log the account request
                    await AcctRequest.create({
                        userid: userid, currency: 'USD', jsonreq: '', jsonresp: '', status: thestatus, provider: 'MPLD',
                        timed: timed, account_id: '', reference: '', payref: txref, meta: meta
                    });

                }

                res.json({
                    status: true,
                    message: 'USD Account Request Submitted for Approval',
                    data: {
                        fee: creationFee
                    }
                });

            } catch (debitError) {

                await debitTransaction.rollback();
                // rollback the transaction.
                console.error(`usd acnt fail for ${txref}:`, debitError.message);
                return res.status(400).json({ status: false, message: 'Failed to process processing fee debit. Please try again.' });
            }

    } catch (error) {
        console.log("usacct Error: ", error.message);

        if (error.response && error.response.data) {
            console.error('usacct Error response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
        }
    }
}


const USAccountStatus = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getusact = await AcctRequest.findOne({ where: { userid: userid } });

    if (!getusact || getusact.length == 0)
        return res.status(400).json({ status: false, message: 'No account request found' });

    // get usd account reqest status
    const reference = getusact.reference;

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
                return res.json({
                    status: true,
                    message: 'Account number already generated'
                });

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
                        const routing_number = '';

                        const createAccount = await Bank.create({
                            userid: userid, inactive: 1, bankname: bankname, status: 1, accountno: accountNumber, accountname: accountName, bankcode: routing_number, trackid: accountid, currency: 'USD', trackingref: '', jsonresp: jsonString, accounttype: 'ACH, FEDWIRE', provider: 'mpld'
                        });

                        if (createAccount) {
                            const userinfo = await getUserInfo(userid);
                            const useremail = userinfo.email;
                            const fname = userinfo.firstname;

                            // <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got a USD Account Number</h3>
                            var thecontent = `
                            <div>
                        <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                        <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                            <p style="line-height: 20px; letter-spacing: 0.025em;">
                                Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                                <p style="line-height: 28px; letter-spacing: 0.025em;">
                                Congratulations! A USD account number has been created for you on <strong>HitchPay</strong>. Get instant funding when you pay into the USD account number.
                            </p>
        
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Number:</strong> ${accountNumber}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Account Name:</strong> ${accountName}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Bank Name:</strong> ${bankname}</p>
                            <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Routing Number:</strong> ${routing_number}</p>
                            <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                        </div>
                        `;

                            mailSender(fname, 'USD Account Approved', useremail, thecontent);

                            /* send SMS */
                            const msg = `Hi! US account number has been created for you on HitchPay. Get instant funding when you pay into the account. Account Number: ${accountNumber}. Account Name: ${accountName}. Powered By HitchPay`;

                            await sendSMS(userinfo.phoneno, msg);

                            await pushNotify(userid, 'Virtual Account', msg);

                            return res.json({
                                status: true,
                                message: 'Account number successfully created'
                            });

                        } else {
                            return res.json({
                                status: false,
                                message: 'Unable to process account creation'
                            });
                        }

                    } else {
                        return res.json({
                            status: false,
                            message: theresp.message
                        });

                    }

                } catch (error) {
                    console.log("us acct req details: Error", error.message);
                    if (error.response && error.response.data) {
                        console.error('usacct detail Error response data:', JSON.stringify(error.response.data, null, 2));
                        return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
                    } else {
                        return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
                    }
                }

            }

        } else {
            res.json({
                status: false, message: 'Request in review',
            });
        }

    } catch (error) {
        console.log("us acct req status: Error", error.message);
        res.json({ status: false, message: 'Unable to process request' });
    }
}

const USAccountDetails = async (req, res) => {
    // get usd account reqest status
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const getusact = await Bank.findOne({ where: { userid: userid, currency: 'USD', provider: 'mpld' } });

    if (!getusact || getusact.length == 0)
        return res.status(400).json({ status: false, message: 'No account request found' });

    const accountid = getusact.trackid;
    try {
        // Parse jsonresp if it exists and merge relevant details
        if (getusact.jsonresp) {
            const thedata = JSON.parse(getusact.jsonresp);
            const ibanData = thedata.data.iban || [];
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


            res.json({
                status: true,
                message: 'Account number retrieved',
                data: {
                    bankName: thedata.data.bank_name,
                    accountNumber: thedata.data.account_number,
                    accountName: thedata.data.account_name,
                    currency: thedata.data.currency,
                    requireConsent: thedata.data.require_consent,
                    consented: thedata.data.consented,
                    consentUrl: thedata.data.consent_url,
                    reference: thedata.data.reference,
                    instruction_type: Array.from(instructionTypes).join(', '),
                    memo: Array.from(memos).join(', '),
                    swift_code: Array.from(swiftCodes).join(', '),
                    account_holder_address: primaryIban?.account_holder_address || "",
                    institution_address: primaryIban?.institution_address || "",
                    routing_number: primaryIban?.routing_number || ""
                }
            });
        } else {
            res.json({
                status: false, message: 'Account details no available',
                data: []
            });
        }

    } catch (error) {
        console.log("USAccountDetails Error: ", error.message);
        console.log("us acct req status: Error", error.message);

        if (error.response && error.response.data) {
            console.error('usacct detail Error response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to retrieve USD account details at the moment.', data: { errortype: "" } });
        }

    }
}


const USDWireTransfer = async (req, res) => {

    try {
        const { payment_rails, payment_reason, amount, payment_description, beneficiaryid, transpin, envroute } = req.body;


        const userid = req.user.id;
        if (!userid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const userinfo = await getUserInfo(userid);
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const sourcephone = userinfo.phoneno;
        const sendername = `${userinfo.lastname} ${userinfo.firstname}`;
        const useremail = userinfo.email;
        const authpin = userinfo.authpin;
        const bvverify = userinfo.bvverify;
        const histier = userinfo.accounttier;

        const env = (envroute === 'web') ? 'web' : 'app';
        const counterPartyID = beneficiaryid;

        if (!transpin || transpin == '') return res.status(400).json({ status: false, message: 'Transaction PIN is required' });
        if (!authpin) return res.status(400).json({ status: false, message: 'Kindly setup your transaction PIN to proceed.' });
        if (!bcrypt.compareSync(transpin, authpin)) return res.status(400).json({ status: false, message: 'Invalid Transaction PIN.' });
        if (bvverify != 2) return res.status(400).json({ status: false, message: 'Kindly complete your tier 1 account verification to proceed.' });
        if (!histier) return res.status(400).json({ status: false, message: 'Kindly complete your account KYC to proceed.' });
        if (parseFloat(amount) < 500) return res.status(400).json({ status: false, message: 'You cannot transfer below USD500.00.' });
        if (userinfo.status != '1') return res.status(400).json({ status: false, message: 'Your account is not active.' });
        if (userinfo.status == '3') return res.status(400).json({ status: false, message: 'Your account is on hold.' });

        // validate to make sure no field is empty or not specified
        if (!payment_rails || payment_rails == '') return res.status(400).json({ status: false, message: 'Payment rail is required' });
        if (!payment_reason || payment_reason == '') return res.status(400).json({ status: false, message: 'Payment reason is required' });
        if (!amount || amount == '') return res.status(400).json({ status: false, message: 'Amount is required' });
        if (!beneficiaryid || beneficiaryid == '') return res.status(400).json({ status: false, message: 'Beneficiary is not specified' });
        if (!payment_description || payment_description == '') return res.status(400).json({ status: false, message: 'Payment description is required' });

        const checkFeeProduct = await Product.findOne({ where: { category: 'transfer', status: 1 } });
        if (!checkFeeProduct)
            return res.status(400).json({ status: false, message: 'Transfer service is currently unavailable.' });

        const getusact = await Bank.findOne({ where: { userid: userid, currency: 'USD' } });
        if (!getusact || getusact.length == 0)
            return res.status(400).json({ status: false, message: 'You currently do not have USD account. Kindly create one, in order to proceed' });

        const checkBenefit = await Benefit.findOne({ where: { userid: userid, currency: 'USD', productid: counterPartyID, status: 1 } });
        if (!checkBenefit || checkBenefit.length == 0)
            return res.status(400).json({ status: false, message: 'Invalid beneficiary sent. Kindly add the recipient as a beneficiary again' });

        const txref = 'HTCH' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        let timed = Date.parse(new Date()) / 1000;

        const getsett = await AppSett.findOne({ where: { id: 1 } });
        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });
        
        const { dollartransfer, achtransfer, achaccelerated } = getsett;

        let usdTransferFee = 0;
        if(payment_rails.toLowerCase() == 'fedwire'){
            usdTransferFee = dollartransfer;  //FEDWIRE
        }else if(payment_rails.toLowerCase() == 'ach'){
            usdTransferFee = achtransfer; //ACH
        }else if(payment_rails.toLowerCase() == 'ach-accelerated'){
            usdTransferFee = achaccelerated; //ACH ACCELERATED
        }

        if (!usdTransferFee || usdTransferFee <= 0)
            return res.status(400).json({ status: false, message: 'Unable to fetch transfer fee. Kindly reload the page and retry' });

        const topay = parseFloat(amount) + parseFloat(usdTransferFee);

        const userbal = await getBal(userid, 'USD');

        if (userbal < topay)
            return res.status(400).json({ status: false, message: `Insufficient balance for USD${formatAmount(topay)}.` });


        const debitSenderTransaction = await db.sequelize.transaction();

        let pay_desc_transfer = payment_description || `USD Transfer to ${checkBenefit.acctname || checkBenefit.phoneno}`;
        // charge the customer and log the trnsactin

        const newbalSender = await updateBalance(userid, topay, 'USD', 'debit', { transaction: debitSenderTransaction });

        const meta_data_sender = JSON.stringify({ sourcename: checkBenefit.acctname, sourceaccount: checkBenefit.phoneno, sourcebank: checkBenefit.network });

        await Payn.create({
            userid: userid, amount: topay, amountval: parseFloat(amount), newbal: newbalSender, prevbal: userbal,
            txref: txref, pfor: 'usdtransfer', usertype: 'user', paytype: 'debit', productid: '', ntwk: checkBenefit.network,
            paidthru: 'Wallet', pay_desc: pay_desc_transfer, timed: timed, status: 0, recipient: checkBenefit.phoneno, ntwkid: checkBenefit.routing_no, meta: meta_data_sender, fee: usdTransferFee, narration: payment_description, revenue: 0, payroute: env, currency: 'USD', providerfee: 0
        }, { transaction: debitSenderTransaction }
        );

        await debitSenderTransaction.commit();

        try {
            const finalizeTransaction = await db.sequelize.transaction();

            const payloadApi = JSON.stringify({
                memo: payment_description,
                amount: amount * 100, //to cent
                payment_rail: payment_rails,
                reason: payment_reason,
                reference: txref,
                counterparty_id: counterPartyID
            })

            await LogRequest.create({ reference: txref, jsonreq: payloadApi, timed: timed, product: 'usd transfer', provider: 'mpld' }, { transaction: finalizeTransaction });

            const config = {
                method: 'POST',
                url: 'https://api.maplerad.com/v2/transfers/usd',
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    'Authorization': `Bearer ${process.env.MPLSKEY}`
                },
                data: payloadApi
            };

            let apiResponse = await axios.request(config);
            let theresp = apiResponse.data;
            let jsonString = JSON.stringify(theresp);

            // console.log(theresp)

            if (theresp.status) {
                const sessID = theresp['data']['id'];
                const status = theresp['data']['status'];
                const summary = theresp['data']['summary'];
                const providerfee = (theresp['data']['fee'] / 100);
                const counterparty = theresp['data']['counterparty'];

                const profit = parseFloat(usdTransferFee) - parseFloat(providerfee);

                var getrate = await getFX('USD', 'NGN'); //echange rate
                var rate = getrate[1];

                const revenue = parseFloat(profit) * rate;  //in NGN
                const meta_data = JSON.stringify({ rate: parseFloat(rate), amount: amount, ourfee: usdTransferFee, revenuengn: revenue});


                await Payn.update({
                    status: 1, paychannel: 'mpld', productid: sessID, narration: summary,
                    jsonresp: jsonString, revenue: revenue, providerfee: providerfee, meta: meta_data, settlement_route: 'dollar'
                }, { where: { txref: txref, userid: userid }, transaction: finalizeTransaction });

                await finalizeTransaction.commit();

                const emailReceipt = `
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Hello ${fname}<span style="font-size: 18px;">😍</span></p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        Your USD Transfer transaction with reference - ${txref} is processing.
                    </p>
                    <h3>Transaction Details</h3>
                    <table style="width: 100%; color: #54424d; font-size: 15px; font-weight: 500;" class="cke_show_border" cellspacing="1" cellpadding="1" border="0">
                        <tbody class="transbody">
                            <tr><td><p>Amount</p></td><td><p>$${formatAmount(amount)}</p></td></tr>
                            <tr><td><p>Product</p></td><td><p>USD Transfer</p></td></tr>
                            <tr><td><p>Fee</p></td><td><p>$${formatAmount(usdTransferFee)}</p></td></tr>
                            <tr><td><p>Recipient Number</p></td><td><p>${checkBenefit.phoneno}</p></td></tr>
                            <tr><td><p>Payment Rail</p></td><td><p>${payment_rails}</p></td></tr>
                            <tr><td><p>Routing</p></td><td><p>${checkBenefit.routing_no}</p></td></tr>
                            <tr><td><p>Description</p></td><td><p>${payment_description}</p></td></tr>
                            <tr><td><p>Transaction Reference</p></td><td width="50%"><p>${txref}</p></td></tr>
                            <tr><td><p>Transaction Date</p></td><td width="50%"><p>${moment.unix(timed).format("Do MMM, YYYY hh:mm a")}</p></td></tr>
                        </tbody>
                    </table>`;

                mailSender(fname, 'Transaction Receipt', useremail, emailReceipt);
                pushNotify(userid, 'Transaction Notice - HitchPay', `Your USD${formatAmount(amount)} transfer to ${checkBenefit.acctname} (${checkBenefit.phoneno}) is proccesing.`);


                res.json({
                    status: true,
                    message: 'Transfer Proccessing.',
                    data: {
                        amount: parseFloat(amount),
                        currency: 'USD',
                        amountcharged: topay,
                        fee: usdTransferFee, reference: txref,
                        sessionid: sessID,
                        paystatus: 'Successful',
                        transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a")
                    }
                });


            } else {
                return res.json({
                    status: false,
                    message: theresp.message
                });
            }

        } catch (error) {
            console.log("us acct req api: Error", error.message);
            if (error.response && error.response.data) {
                console.error('Error response data:', JSON.stringify(error.response.data, null, 2));
                res.json({ status: false, message: error.response.data.message });
            } else {
                res.json({ status: false, message: 'Unable to process request' });
            }
        }

    } catch (error) {
        console.log("us acct req counter: Error", error.message);
        if (error.response && error.response.data) {
            console.error('createCounterParty Error response data:', JSON.stringify(error.response.data, null, 2));
            res.json({ status: false, message: error.response.data.message });
        } else {
            res.json({ status: false, message: 'Unable to process request' });
        }
    }
}


const createCounterParty = async (req, res) => {

    const userid = req.user.id;
    if (!userid)
        return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    try {
        const { account_type, payment_rails, routing_no, swift_code, bank_name, account_number, account_name, recipient_address, recipient_city, recipient_state, recipient_houseno, recipient_zip, recipient_country, payment_description, is_corporate, institution_address, institution_houseno, institution_city, institution_state, institution_postalcode, institution_country } = req.body

        const userinfo = await getUserInfo(userid);
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const sourcephone = userinfo.phoneno;
        const useremail = userinfo.email;
        const sendername = `${userinfo.lastname} ${userinfo.firstname}`;
        const authpin = userinfo.authpin;
        const bvverify = userinfo.bvverify;
        const histier = userinfo.accounttier;
        let timed = Date.parse(new Date()) / 1000;

        const getusact = await Bank.findOne({ where: { userid: userid, currency: 'USD', status: 1 }, order: [['id', 'DESC']] });

        if (!getusact || getusact.length == 0)
            return res.status(400).json({ status: false, message: 'You currently do no have a USD account. Kindly create one in order to proceed' });

        if (!payment_rails || payment_rails == '') return res.status(400).json({ status: false, message: 'Payment rail is required' });
        if (!account_number || account_number == '') return res.status(400).json({ status: false, message: 'Account number is required' });
        if (!account_name || account_name == '') return res.status(400).json({ status: false, message: 'Account name is required' });
        if (!recipient_address || recipient_address == '') return res.status(400).json({ status: false, message: 'Recipient address is required' });
        if (!recipient_city || recipient_city == '') return res.status(400).json({ status: false, message: 'Recipient city is required' });
        if (!recipient_state || recipient_state == '') return res.status(400).json({ status: false, message: 'Recipient state is required' });
        if (!recipient_zip || recipient_zip == '') return res.status(400).json({ status: false, message: 'Recipient postal code is required' });
        if (!recipient_country || recipient_country == '') return res.status(400).json({ status: false, message: 'Recipient country is required' });
        // if (!amount || amount == '') return res.status(400).json({ status: false, message: 'Amount is required' });
        if (!payment_description || payment_description == '') return res.status(400).json({ status: false, message: 'Payment description is required' });
        if (!institution_address || institution_address == '') return res.status(400).json({ status: false, message: 'Recipient bank address is required' });
        if (!institution_houseno || institution_houseno == '') return res.status(400).json({ status: false, message: 'Recipient bank unit number is required' });
        if (!institution_city || institution_city == '') return res.status(400).json({ status: false, message: 'Recipient bank city is required' });
        if (!institution_state || institution_state == '') return res.status(400).json({ status: false, message: 'Recipient bank state is required' });
        if (!institution_postalcode || institution_postalcode == '') return res.status(400).json({ status: false, message: 'Recipient bank postal code is required' });
        if (!institution_country || institution_country == '') return res.status(400).json({ status: false, message: 'Recipient bank country is required' });

        const payload = JSON.stringify({
            beneficiary_address: {
                unit_number: recipient_houseno,
                street: recipient_address,
                city: recipient_city,
                state: recipient_state,
                postal_code: recipient_zip,
                country: recipient_country
            },
            account_information: {
                type: account_type,
                institution_name: bank_name,
                 institution_address: {
                    unit_number: institution_houseno,
                    street: institution_address,
                    city: institution_city,
                    state: institution_state,
                    postal_code: institution_postalcode,
                    country: institution_country
                },
                account_name: account_name,
                account_number: account_number,
                payment_rails: [payment_rails],
                routing_number: routing_no,
                swift_code: swift_code
            },
            is_corporate: is_corporate,
            account_id: getusact.trackid,
            // account_id: '15c1bbd0-0ace-4d56-a9e0-c3e61997244b',
            email: useremail,
            first_name: fname,
            last_name: lname,
            description: payment_description,
            phone_number: formatPhoneNumber(sourcephone),
            business_name: ''
        });

        // log request
        await LogRequest.create({ reference: userid, jsonreq: payload, timed: timed, product: 'createcounterparty', provider: 'mpld' });

        

    //     const payload2 = JSON.stringify({
    //         beneficiary_address: {
    //         unit_number: '21',
    //         street: 'Adeniyi Jones',
    //         city: 'ikeja',
    //         state: 'lagos',
    //         postal_code: '210422',
    //         country: 'NG'
    //         },
    //         account_information: {
    //         type: 'SAVINGS',
    //         institution_name: 'Bank of the Lakes',
    //         institution_address: {
    //             unit_number: '21',
    //             street: 'Adeniyi Jones',
    //             city: 'ikeja',
    //             state: 'lagos',
    //             postal_code: '210422',
    //             country: 'NG'
    //         },
    //         account_name: 'Taye',
    //         account_number: 'Major',
    //         payment_rails: ['FEDWIRE'],
    //         routing_number: '394843',
    //         swift_code: 'LAKEUS41'
    //         },
    //         is_corporate: false,
    //         account_id: 'af103fc8-a72e-410e-90e0-a0459e794c0d',
    //         email: 'johndoe@testmail.com',
    //         description: 'Tuition',
    //         first_name: 'fAYO',
    //         last_name: 'dANIEL'
    //     });


    //     const payload3 = JSON.stringify({
    //         beneficiary_address: {
    //         unit_number: '21',
    //         street: 'Adeniyi Jones',
    //         city: 'ikeja',
    //         state: 'lagos',
    //         postal_code: '210422',
    //         country: 'NG'
    //         },
    //         account_information: {
    //         type: 'CHECKING',
    //         institution_name: 'Bank of the Lakes',
    //         institution_address: {
    //             unit_number: '21',
    //             street: 'Adeniyi Jones',
    //             city: 'ikeja',
    //             state: 'lagos',
    //             postal_code: '210422',
    //             country: 'NG'
    //         },
    //         account_name: 'Olatunji',
    //         account_number: 'Defelopa',
    //         payment_rails: ['FEDWIRE'],
    //         routing_number: 'MD3004'
    //         },
    //         is_corporate: false,
    //         account_id: '15c1bbd0-0ace-4d56-a9e0-c3e61997244b',
    //         email: 'Johndoe@testmail.com',
    //         description: 'Test Payment',
    //         phone_number: '+2348158752142',
    //         first_name: 'Olatunji',
    //         last_name: 'Defelopa'
    //     });

    //    console.log('payload', payload)

        let config = {
            method: 'POST',
            url: `${process.env.MPLDURL}/collections/virtual-account/counterparties`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
            data: payload
        };

        let response = await axios.request(config);
        let thedata = response.data;

        // console.log(thedata)

        if (thedata.status) {
            const counterData = thedata['data'];
            const account_number = counterData['account_number'];
            const institution_name = counterData['institution_name'];
            const account_name = counterData['account_name'];
            const dataid = counterData['id'];
            const routing_number = counterData['routing_number'];


            await Benefit.create({ userid, product: 'wiretransfer', phoneno: account_number, network: institution_name, productid: dataid, acctname: account_name, status: 1, timed: timed, currency: 'USD', routing_no: routing_number });

            res.json({
                status: true,
                message: 'Successfully Added To USD Transfer Beneficiary',
                data: {
                    beneficialId: dataid,
                    account_number: account_number,
                    account_name: account_name,
                    routing_no: routing_number
                }
            });

        } else {
            return res.json({
                status: false,
                message: thedata.message
            });
        }

    } catch (error) {
        console.error("createCounterParty Error: ", error.message);

        if (error.response && error.response.data) {
            console.error('createCounterParty Error response data:', JSON.stringify(error.response.data, null, 2));
            return res.json({
                status: false,
                message: error.response.data.message
            });
        } else {
            return res.json({
                status: false,
                message: 'Unable to process your request at the moment, kindly retry shortly'
            });
        }
    }

}


const USDBeneficiaryList = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const getacct = await Benefit.findAll({ order: [['id', 'DESC']], where: { userid: hisid, currency: 'USD' } });

        if (!getacct || getacct.length === 0) {
            return res.status(200).json({ status: true, message: 'No beneficiary found for you' });
        }

        const datalist = getacct.map((arrayItem) => ({
            product: ucFirst(arrayItem.product),
            account_number: arrayItem.phoneno,
            network: arrayItem.network,
            ntwkid: arrayItem.productid,
            accountname: arrayItem.acctname
        }));

        res.json({
            status: true,
            message: 'Beneficiary list retrieved',
            data: datalist
        });


    } catch (error) {
        console.log('usd ben list catch ERROR: ' + error.message)
        res.status(400).json({ status: false, message: 'unable to get list at the moment' }); // Send 500 for server errors
    }
}

const USDRequestDetails = async (req, res) => {    
    try {

        // get usd account reqest status
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const requestDetails = await AcctRequest.findOne({
              where: { currency: 'USD', userid: userid },
              include: [{
                model: Customer,
                as: 'customer',
                attributes: ['id', 'firstname', 'lastname', 'email', 'phoneno']
              }],
              order: [['timed', 'DESC']]
            });
    
        if (!requestDetails) {
          return res.status(200).json({ status: true, message: 'No USD account requests found.', data: [] });
        }

    
        const kycDoc = await KycDoc.findOne({ where: { userid: userid, tier: 2, doctype: 'idcard' } });
        const utilityDoc = await KycDoc.findOne({ where: { userid: userid, doctype: 'utility' }, order: [['id', 'DESC']] });
        const PassportDoc = await KycDoc.findOne({ where: { userid: userid, doctype: 'interpass' } });

         const formattedDetails = {
              status: requestDetails.status,
              statustext:  requestDetails.status === 0 ? 'Pending' : requestDetails.status === 1 ? 'Reviewed' : requestDetails.status === 2 ? 'Approved' : requestDetails.status === 3 ? 'Declined' : requestDetails.status === 4 ? 'Provisioned' : 'Unknown',
              paymentref: requestDetails.payref,
              reference: requestDetails.reference,
              metainfo: JSON.parse(requestDetails.meta),
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
        console.log("us acct req user: Error", error.message);

        if (error.response && error.response.data) {
            console.error('usacct request detail Error response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to retrieve USD account details at the moment.', data: { errortype: "" } });
        }

    }
}


module.exports = {
    getExchange, fundSwap, listCurrencies, createUSDAccount,
    USAccountStatus, USAccountDetails, USDWireTransfer, createCounterParty, createUSDAccountNew,
    USDBeneficiaryList, USDRequestDetails
};