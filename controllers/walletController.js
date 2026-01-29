const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const { Op } = require("sequelize");
const md5 = require('md5');
const https = require('https');
const randomstring = require("randomstring");
const axios = require('axios');
const { getUserInfo, getBal } = require("../config/userdetails");
const { mailSender } = require("../config/mailsender");
const { notifyMe, sendSMS, pushNotify } = require("../config/notifyuser");
const { stringify } = require('querystring');
const moment = require('moment');
const crypto = require('crypto');
// const { time, Console } = require('console');
const { formatAmount, cleanMe, ucFirst, genSHAccount, shAcessToken, getFee, updateBalance, giveWelcomeBonus, referralUplineDownlineBonus, psb9Token, USAccountUpd, getFX} = require("../config/myfunct");
const { logger } = require('../config/logger');
//create main Model
// const Customer = db.customers; 
const payWhk = db.whookhandler;
const Bank = db.bankacct;
const Payn = db.payn;
const Customer = db.customers;
const Wallets = db.wallets;
const AppSett = db.appsettings;
const KYC = db.kyc;
const CardUser = db.kadusers
const VCard = db.vkads;
const CardTrans = db.cardtrans;
const AcctRequest = db.accountrequest;
const Business = db.business;

// const checkdebugger = async()=>{
//     const chargefee = await getFee('virtualaccount', 1000000, 2); //get inflow fee
//     console.log(chargefee)
// }

// checkdebugger();

const shHookNotify = async (req, res) => {
    try {

        // Immediately acknowledge the webhook to prevent timeouts from the provider.
        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });

        const event = cleanMe(req.body);

        if (!event) {
            console.error('[Webhook Error] shHookNotify: Invalid or empty event body received.');
            return; // Stop processing, response already sent.
        }

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);
        // console.log('resp', resp)
        var event_type = resp['eventType'];
        
        if ((event_type == 'account.credit' || event_type == 'virtualAccount.transfer' || resp['type'] == 'transfer') && (resp['data']['type'] == 'Inwards') ) {
            var type = resp['type'];
            var noteid = resp['data']['_id'];
            var notetype = resp['data']['type']; // Inwards/Outwards
            var sessionId = resp['data']['sessionId'];
            var provider = resp['data']['provider'];
            var providerChannel = resp['data']['providerChannel'];
            var AccountNo = resp['data']['creditAccountNumber'];
            var SourceName = resp['data']['debitAccountName'];
            var SourceAcct = resp['data']['debitAccountNumber'];
            var AmountPaid = resp['data']['amount'];
            var bankCode = resp['data']['destinationInstitutionCode'];
            var narration = resp['data']['narration'];
            var responseCode = resp['data']['responseCode']; //00 successful
            var status = resp['data']['status']; //Completed
            var isDeleted = resp['data']['isDeleted'];
            var isReversed = resp['data']['isReversed'];
            var fees = resp['data']['fees'];
            var Reference = sessionId;
            var SourceBank = provider;

        const t = await db.sequelize.transaction();
        
        try {
            var checkhook = await Payn.findAll({ where: { txref: Reference }, transaction: t })

            if (checkhook.length > 0){
                await t.rollback();
                console.warn(`[Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                return;
            }

            //log the hook
            let timed = Date.parse(new Date()) / 1000;
            var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")
            await payWhk.create({ resp: dbody, txref: Reference, gateway: 'safehaven', 
                timed: timed, processed: 0 }, { transaction: t }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

            var checkbank = await Bank.findOne({ where: { accountno: AccountNo }, transaction: t })
            
            if (checkbank) {
                    /* call the verify endpoint */
                var validateHook = await verifyStatus(sessionId);

                if (validateHook) {
                    var userid = checkbank.userid;
                    var usertype = !checkbank.usertype ? 'personal' : checkbank.usertype;
                    
                    let getuser; let customerType = ''; let duser_type; let ownerid;
                    if(usertype == 'business'){
                        //get business 
                        getuser = await Business.findOne({ where: { id: userid }, transaction: t });
                        customerType = 'business';
                        duser_type = 'business';
                        ownerid = getuser.ownerid;

                    }else{
                        getuser = await Customer.findOne({ where: { id: userid }, transaction: t });
                        customerType = 'personal';
                        duser_type = 'user';
                        ownerid = userid;
                    }

                    if (!getuser) {
                        await t.rollback();
                        console.warn(`[Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                        return;
                    }
                    
                    let fname; let useremail; let accounttier;
                    if(customerType == 'business'){
                        fname = getuser.business_name;
                        useremail = getuser.business_email;
                        accounttier = 2;
                    }else{
                        fname = getuser.firstname;
                        useremail = getuser.email;
                        accounttier = getuser.accounttier;
                    }

                    var userbal = await getBal(userid, 'NGN', { transaction: t }, customerType);
    
                    // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                    const chargefee = await getFee('virtualaccount', AmountPaid, accounttier); //get inflow fee
                    const getsett = await AppSett.findOne({ where: { id: 1 } });

                    if (!getsett){ 
                        var inflowfee_cap = 1000;
                    }else{
                        var inflowfee_cap = parseFloat(getsett.maxamount)
                    }
            
                    var inflowfee = parseFloat(chargefee[0]); //fee  10
                    var prvfee = chargefee[1]  //provider charg  40
                        
                    if(fees == 0){  //if provider fees is 0, it means its SH to SH
                        var tocharge = 0;
                        var amountcharged = 0;
                        var revenue = 0;
                    }else{
                        var tocharge = inflowfee;
                        var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                        var revenue = parseFloat(tocharge) - parseFloat(fees);
                    }

                    var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);
                    // var newbal = parseFloat(userbal) + parseFloat(tosettle)
                    var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                    
                    /* Update wallet */
                    const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t }, true, customerType);

                    // console.log('thenewbal', newbal)
    
                    // LOG CREDIT
                    await Payn.create({
                        userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: duser_type, paytype: 'credit', productid: AccountNo, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees
                    }, { transaction: t });
                
                    await payWhk.update({ processed: 1 }, { where: { txref: Reference }, transaction: t });
    
                    /* CALCULATE EMTLFee */
                    var EMTLFee = 0;
                    var EMTLFee_Max = parseFloat('10000000000000000');  //amount to apply the emtl on

                    if (AmountPaid >= EMTLFee_Max) {
                        var userbal2 = await getBal(userid, 'NGN', { transaction: t }, customerType);

                        var newbal2 = parseFloat(userbal2) - parseFloat(EMTLFee)
                        var dref = `${Reference}_EMTL`;
    
                        var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
    
                        // LOG CREDIT
                        await Payn.create({
                            userid: userid, recipient: AccountNo, amount: EMTLFee, amountval: EMTLFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Electronic Money Transfer Levy', usertype: 'user', paytype: 'debit', productid: Reference, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: 'According to the Electronic Money Transfer Levy (EMTL) regulation from 2022, a tax of ₦50 is imposed on all deposits of ₦10,000 or more made into your account', timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: 0, narration: `Electronic Money Transfer Levy (EMTL) applied on ${Reference}`, providerfee: 0, revenue: 0
                        }, { transaction: t });
    
                        //DEBIT HIM
                        /* Update wallet */
                        await updateBalance(userid, EMTLFee, 'NGN', 'debit', { transaction: t }, false, customerType);
                    } else {
                        var EMTLFee = 0;
                    }

                    await t.commit();  //commit transaction

                    const dnewbal = parseFloat(newbal) - parseFloat(EMTLFee);
        
                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${AccountNo}(Safe Haven MFB)
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> N${formatAmount(tosettle)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? '' : SourceBank}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> N${formatAmount(amountcharged)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Electronic Money Transfer Levy (EMTL):</strong> N${formatAmount(EMTLFee)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> N${formatAmount(dnewbal)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;
    
                    await mailSender(fname, 'Wallet Funding', useremail, thecontent);
    
                    //send notification
                    var notedesc = `Wallet successfully credited with NGN${(tosettle).toFixed(2)} through ${AccountNo}`;
    
                    await notifyMe(userid, 'Wallet Funding', duser_type, notedesc)
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(Safe Haven MFB)`;

                    await pushNotify(ownerid, 'Funding Alert - HitchPay', thesmg, customerType)

                    // return res.status(200).json({
                    //     status: true, message: 'Processed'
                    // })

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                }else{
                    await t.rollback();
                    console.error(`[Webhook Error] Could not validate hook via verifyStatus for session ID: ${sessionId}. Transaction rolled back.`);
                }

                } else {
                    await t.rollback();
                    console.error(`[Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                }

            } catch (error) {
                if (t.finished !== 'commit' && t.finished !== 'rollback') {
                    await t.rollback();
                }
                console.error(`[Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
            }

        } else {
            console.warn(`[Webhook] Received unknown event type: ${event_type}`);
        }

    } catch (error) {
        console.error("[Webhook Error] Top-level catch block in shHookNotify: ", error.message);
    }
}

const shHookDynamicNotify = async (req, res) => {
    try {

        // Immediately acknowledge the webhook to prevent timeouts from the provider.
        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });

        const event = cleanMe(req.body);

        if (!event) {
            console.error('[Webhook Error] shHookNotify: Invalid or empty event body received.');
            return; // Stop processing, response already sent.
        }

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);
        var event_type = resp['eventType'];
        
        if ((event_type == 'virtualAccount.transfer') ) {
            var type = resp['type'];
            var noteid = resp['data']['_id'];
            var notetype = resp['data']['type']; // Inwards/Outwards
            var sessionId = resp['data']['sessionId'];
            var externalReference = resp['data']['externalReference'];  //our reference
            var provider = resp['data']['provider'];
            var providerChannel = resp['data']['providerChannel'];
            var AccountNo = resp['data']['creditAccountNumber'];
            var SourceName = resp['data']['debitAccountName'];
            var SourceAcct = resp['data']['debitAccountNumber'];
            var AmountPaid = resp['data']['amount'];
            var bankCode = resp['data']['destinationInstitutionCode'];
            var narration = resp['data']['narration'];
            var responseCode = resp['data']['responseCode']; //00 successful
            var status = resp['data']['status']; //Completed
            var isDeleted = resp['data']['isDeleted'];
            var isReversed = resp['data']['isReversed'];
            var fees = resp['data']['fees'];
            var Reference = sessionId;
            var SourceBank = provider;

        const t = await db.sequelize.transaction();
        
        try {
            var checkhook = await Payn.findAll({ where: { reference: externalReference }, transaction: t })

            if (checkhook.length > 0){
                await t.rollback();
                console.warn(`[Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                return;
            }

            //log the hook
            let timed = Date.parse(new Date()) / 1000;
            var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")
            await payWhk.create({ resp: dbody, txref: Reference, gateway: 'safehaven', 
                timed: timed, processed: 0 }, { transaction: t }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

            var checkbank = await Bank.findOne({ where: { accountno: AccountNo }, transaction: t })
            
            if (checkbank) {
                    /* call the verify endpoint */
                var validateHook = await verifyStatus(sessionId);

                if (validateHook) {
                    var userid = checkbank.userid;
                    const getuser = await Customer.findOne({ where: { id: userid }, transaction: t }).catch((err) => { console.log("Unable to process your request : " + err); });
                    if (!getuser) {
                        await t.rollback();
                        console.warn(`[Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                        return;
                    }

                    var fname = getuser.firstname;
                    var useremail = getuser.email;
                    var accounttier = getuser.accounttier;
                    var userbal = await getBal(userid, 'NGN', { transaction: t });
    
                    // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                    const chargefee = await getFee('virtualaccount', AmountPaid, accounttier); //get inflow fee
                    const getsett = await AppSett.findOne({ where: { id: 1 } });

                    if (!getsett){ 
                        var inflowfee_cap = 1000;
                    }else{
                        var inflowfee_cap = parseFloat(getsett.maxamount)
                    }
            
                    var inflowfee = parseFloat(chargefee[0]); //fee  10
                    var prvfee = chargefee[1]  //provider charg  40
                        
                    if(fees == 0){  //if provider fees is 0, it means its SH to SH
                        var tocharge = 0;
                        var amountcharged = 0;
                        var revenue = 0;
                    }else{
                        var tocharge = inflowfee;
                        var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                        var revenue = parseFloat(tocharge) - parseFloat(fees);
                    }

                    var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);
                    // var newbal = parseFloat(userbal) + parseFloat(tosettle)
                    var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                    
                    /* Update wallet */
                    const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t });

                    // console.log('thenewbal', newbal)
    
                    // LOG CREDIT
                    await Payn.create({
                        userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: 'user', paytype: 'credit', productid: AccountNo, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees
                    }, { transaction: t });
                
                    await payWhk.update({ processed: 1 }, { where: { txref: Reference }, transaction: t });
    
                    /* CALCULATE EMTLFee */
                    var EMTLFee = 0;
                    var EMTLFee_Max = parseFloat('10000000000000000');  //amount to apply the emtl on

                    if (AmountPaid >= EMTLFee_Max) {
                        var userbal2 = await getBal(userid, 'NGN', { transaction: t });

                        var newbal2 = parseFloat(userbal2) - parseFloat(EMTLFee)
                        var dref = `${Reference}_EMTL`;
    
                        var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
    
                        // LOG CREDIT
                        await Payn.create({
                            userid: userid, recipient: AccountNo, amount: EMTLFee, amountval: EMTLFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Electronic Money Transfer Levy', usertype: 'user', paytype: 'debit', productid: Reference, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: 'According to the Electronic Money Transfer Levy (EMTL) regulation from 2022, a tax of ₦50 is imposed on all deposits of ₦10,000 or more made into your account', timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: 0, narration: `Electronic Money Transfer Levy (EMTL) applied on ${Reference}`, providerfee: 0, revenue: 0
                        }, { transaction: t });
    
                        //DEBIT HIM
                        /* Update wallet */
                        await updateBalance(userid, EMTLFee, 'NGN', 'debit', { transaction: t });
                    } else {
                        var EMTLFee = 0;
                    }

                    await t.commit();  //commit transaction

                    const dnewbal = parseFloat(newbal) - parseFloat(EMTLFee);
        
                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${AccountNo}(Safe Haven MFB)
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> N${formatAmount(tosettle)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? '' : SourceBank}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> N${formatAmount(amountcharged)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Electronic Money Transfer Levy (EMTL):</strong> N${formatAmount(EMTLFee)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> N${formatAmount(dnewbal)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;
    
                    await mailSender(fname, 'Wallet Funding', useremail, thecontent);
    
                    //send notification
                    var notedesc = `Wallet successfully credited with NGN${(tosettle).toFixed(2)} through ${AccountNo}`;
    
                    await notifyMe(userid, 'Wallet Funding', 'user', notedesc)
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(Safe Haven MFB)`;

                    await pushNotify(userid, 'Funding Alert - HitchPay', thesmg)

                    // return res.status(200).json({
                    //     status: true, message: 'Processed'
                    // })

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                }else{
                    await t.rollback();
                    console.error(`[Webhook Error] Could not validate hook via verifyStatus for session ID: ${sessionId}. Transaction rolled back.`);
                }

                } else {
                    await t.rollback();
                    console.error(`[Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                }

            } catch (error) {
                if (t.finished !== 'commit' && t.finished !== 'rollback') {
                    await t.rollback();
                }
                console.error(`[Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
            }

        } else {
            console.warn(`[Webhook] Received unknown event type: ${event_type}`);
        }

    } catch (error) {
        console.error("[Webhook Error] Top-level catch block in shHookNotify: ", error.message);
    }
}


const verifyStatus = async(sessionId)=>{
    try{
        const gettoken = await shAcessToken();
        if (gettoken[0]) {
            var access_token = gettoken[1]
            var ibs_client_id = gettoken[2]
            var ibs_user_id = gettoken[3]

        const options = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/transfers/status`,
            headers: {
            accept: 'application/json',
            ClientID: ibs_client_id,
            'content-type': 'application/json',
            authorization: `Bearer ${access_token}`
        },
        data: {sessionId: sessionId}
        };

        let response = await axios.request(options); 
        let thedata = response.data;
        
        if (thedata.statusCode == 200 && (thedata.data['status'] == 'Completed')) {
            return true
        }else{
            return false
        }

        }else{
            return false    
        }
    } catch (error) {
        console.log("sh transfer status: ", error.message);
        return false    
    }
}

const verify9PSBStatus = async(sessionId, accntno, amount)=>{
     try{
        const gettoken = await psb9Token();
        if (gettoken[0]) {
            var access_token = gettoken[1]

        const options = {
            method: 'POST',
            url: `${process.env.PSBNK_URL}/merchant/virtualaccount/confirmpayment`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${access_token}`
            },
            data: {
                sessionid: sessionId,
                amount: amount,
                accountnumber: accntno,
                reference: "",
            }
        };

        let response = await axios.request(options); 
        let thedata = response.data;

        // console.log('thedata ver', thedata)
        
        if (thedata['code'] == '00') {
            return true
        }else{
            return false
        }

        }else{
            return false    
        }
    } catch (error) {
        console.log("9ps transfer status: ", error.message);
        return false    
    }
}

const bankList = async (req, res) => {
    const getsett = await AppSett.findOne({ where: { id: 1 } });
    const ftProvider = getsett.ftprovider;

    // console.log('ftProvider', ftProvider)

    if(ftProvider.toLowerCase() == 'safehaven' || ftProvider.toLowerCase() == 'gtbank'){
        /* SAFEHAVEN Banllist */
        try {
            const gettoken = await shAcessToken();
            if (gettoken[0]) {
                var access_token = gettoken[1]
                var ibs_client_id = gettoken[2]
                var ibs_user_id = gettoken[3]
    
                const options = {
                    method: 'GET',
                    url: `${process.env.SH_BASEURL}/transfers/banks`,
                    headers: {
                        accept: 'application/json',
                        ClientID: ibs_client_id,
                        authorization: `Bearer ${access_token}`
                    }
                };
    
                let response = await axios.request(options);
                let thedata = response.data;
    
                if (thedata.statusCode == 200 && thedata.responseCode == '00') {
                    const dataInfo = await Promise.all(thedata.data.map(async (info) => {
                        var bankname = info.name;
                        var routingKey = info.routingKey;
                        var bankcode = info.bankCode;
    
                        return { bankname, bankcode };
                    }));
    
                    res.json({
                        status: true,
                        message: 'Bank list retrieved',
                        data: dataInfo
                    });
    
                } else {
                    res.status(400).json({
                        status: false,
                        message: 'Unable to retrieve bank list',
                    });
                }
    
            }else{
                res.status(400).json({
                    status: false,
                    message: 'Unable to retrieve bank list',
                });
            }
        } catch (error) {
            console.log("Error bank lsi chk: ", error.message);
            res.status(400).json({ status: false, message: 'Unable to process request' });
        }
    }else{
        /* 9PSB banklist */
        try {
            const gettoken = await psb9Token();
            if (gettoken[0]) {
                var access_token = gettoken[1]
    
                const options = {
                    method: 'GET',
                    url: `${process.env.PSBNK_FTURL}/merchant/transfer/getbanks`,
                    headers: {
                        accept: 'application/json',
                        authorization: `Bearer ${access_token}`
                    }
                };
    
                let response = await axios.request(options);
                let thedata = response.data;
                // console.log(thedata['BankList'])
    
                if ((thedata['code'] == '00') && thedata['BankList'] && (thedata['BankList'].length > 0)) {
                    const dataInfo = await Promise.all(thedata.BankList.map(async (info) => {
                        var bankname = info.BankName;
                        var bankcode = info.BankCode;
                        var banklongcode = info.BankLongCode;
    
                        return { bankname, bankcode };
                    }));
    
                    res.json({
                        status: true,
                        message: 'Bank list retrieved',
                        data: dataInfo
                    });
    
                } else {
                    res.status(400).json({
                        status: false,
                        message: 'Unable to retrieve bank list',
                    });
                }
    
            }else{
                res.status(400).json({
                    status: false,
                    message: 'Unable to retrieve the bank list',
                });
            }
        } catch (error) {
            console.log("Error bank 9pssb chk: ", error.message);
            res.status(400).json({ status: false, message: 'Unable to process request' });
        }
    }
}

const resolveBank = async (req, res) => {

    try {
        let { bankcode, acctno, accounttype } = req.body

        if (!bankcode || bankcode == '') return res.status(400).json({ status: false, message: 'Bank code not specified' });
        if (!acctno || acctno == '') return res.status(400).json({ status: false, message: 'Account number not specified' });
        // if (acctno.length < 8) return res.status(400).json({ status: false, message: 'Invalid Account number specified' });

        if (bankcode == 'hitchpay') {
            let getuser;
            if(accounttype == 'business'){
                getuser = await Business.findOne({
                    where: { [Op.or]: [{ business_phoneno: { [Op.like]: `%${acctno}%` } }] }
                });

                var name = getuser.business_name
            }else{
                getuser = await Customer.findOne({
                    where: { [Op.or]: [{ phoneno: { [Op.like]: `%${acctno}%` } }, { uname: acctno }] }
                });

                var name = getuser.firstname + ' ' + getuser.lastname
            }

            if (!getuser)
                return res.status(400).json({ status: false, message: 'Unable to verify account number on HitchPay' });

            if (getuser.status != 1)
                return res.status(400).json({ status: false, message: 'Verified account number not in good state to received funds' });

            res.json({
                status: true,
                message: 'Account number verified on HitchPay',
                data: {
                    accountname: name,
                    enquirytoken: acctno
                }
            });
        } else {
            const getsett = await AppSett.findOne({ where: { id: 1 } });
            const ftProvider = getsett.ftprovider;

            if(ftProvider.toLowerCase() == 'safehaven'){
                /* SAFEHAVEN account validation */
                const gettoken = await shAcessToken();
                if (gettoken[0]) {
                    var access_token = gettoken[1]
                    var ibs_client_id = gettoken[2]
                    var ibs_user_id = gettoken[3]

                    const options = {
                        method: 'POST',
                        url: `${process.env.SH_BASEURL}/transfers/name-enquiry`,
                        headers: {
                            accept: 'application/json',
                            ClientID: ibs_client_id,
                            authorization: `Bearer ${access_token}`
                        },
                        data: { bankCode: bankcode, accountNumber: acctno }
                    };

                    let response = await axios.request(options);
                    let thedata = response.data;

                    // console.log('validateact', thedata)

                    if (thedata.statusCode == 200 && thedata.responseCode == '00') {
                        var sessionId = thedata.data.sessionId;
                        var bankCode = thedata.data.bankCode;
                        var accountNumber = thedata.data.accountNumber;
                        var kycLevel = thedata.data.kycLevel;
                        var accountName = thedata.data.accountName;
                        var responseMessage = thedata.data.responseMessage;

                        res.json({
                            status: true,
                            message: 'Account number Verified',
                            data: {
                                accountname: accountName,
                                enquirytoken: sessionId
                            }
                        });

                    } else {
                        res.status(400).json({
                            status: false,
                            message: 'Unable to verify account number',
                        });
                    }
                }else{
                    res.status(400).json({
                        status: false,
                        message: 'Unable to resolve account number',
                    });
                }
           }else if(ftProvider.toLowerCase() == 'gtbank'){
            const lookupRes = await lookupAccntGTB(bankcode, acctno);
            // console.log('lookupRes', lookupRes)
                if (lookupRes[0]) {
                    res.json({
                        status: true,
                        message: 'Account number Verified',
                        data: {
                            accountname: lookupRes[2].account_name,
                            enquirytoken: ''
                        }
                    });
                } else {
                    res.status(400).json({
                        status: false,
                        message: lookupRes[1],
                    });
                }


           }else{
                /* 9PSB account validation */
                const gettoken = await psb9Token();
                if (gettoken[0]) {
                    var access_token = gettoken[1]

                     const options = {
                        method: 'POST',
                        url: `${process.env.PSBNK_FTURL}/merchant/account/enquiry`,
                        headers: {
                            accept: 'application/json',
                            authorization: `Bearer ${access_token}`
                        },
                        data: {customer: {account: {number: acctno, bank: bankcode}}}
                    };

                    let response = await axios.request(options);
                    let thedata = response.data;

                    if (thedata['code'] == '00') {
                        var accountName = thedata.customer.account.name;
                    
                        res.json({
                            status: true,
                            message: 'Account number Verified',
                            data: {
                                accountname: accountName,
                                enquirytoken: ''
                            }
                        });

                    } else {
                        res.status(400).json({
                            status: false,
                            message: 'Unable to verify account number',
                        });
                    }
                
                }else{
                    res.status(400).json({
                        status: false,
                        message: 'Unable to resolve account number',
                    });
                }
           }
        }

    } catch (error) {
        console.log("Error bank val chk: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

const lookupAccntGTB = async (bank_code, account_number) => {
    try {
     const options = {
        method: 'POST',
        url: `${process.env.SQD_URL}/payout/account/lookup`,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${process.env.SQD_SKEY}`
        },
        data: {
            bank_code: bank_code,
            account_number: account_number
        }
    };

    let response = await axios.request(options);
    let thedata = response.data;

    console.log('thedata', thedata)
    if (thedata.success && thedata.data) {
        const accountName = thedata.data.account_name;
        const accountNumber = thedata.data.account_number;

        return [true, 'success', { account_name: accountName, account_number: accountNumber }];
        
    }else{
        console.log('Lookup failed:', thedata.message);
        return [false, thedata.message, null];
    }

    } catch (error) {
        console.error('lookup AccntGTB Error:', error);
        return [false, `Network Error, kindly try again`, ''];
    }
};

/* lookupAccntGTB('000013', '0247813350')
  .then(result => {     console.log("Account list:", result);
  })
  .catch(err => console.error("Script execution failed:", err))
  .finally(async () => {
}); */

const myWallets = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const getwallt = await Wallets.findAll({ order: [['id', 'ASC']], where: { uid: hisid, status: 1, usertype: 'personal' } });

        if (!getwallt || getwallt.length == 0)
            return res.status(400).json({ status: false, message: 'No currency wallet found for you' });

        const datalist = getwallt.map((arrayItem) => ({
            // bank_name: arrayItem.uid,
            // email: arrayItem.email,
            currency: arrayItem.currency,
            walletbal: arrayItem.wbal,
            lastupdated: moment.unix(arrayItem.lastupdated).format('Do MMM, YYYY h:m a')
        }));

        res.json({
            status: true,
            message: 'Wallet  retrieved',
            data: datalist
        });

    } catch (error) {
        console.log('user walle list catch ERROR: ' + error.message)
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

const payHistory = async (req, res) => {

    try {
        const hisid = req.user.id;
        if (!hisid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        let { page = 1, dateFrom, dateTo, query, limit = 20, currency = 'NGN' } = req.query;

        const maxlimit = parseInt(limit) || 20;
        const offset = (page - 1) * maxlimit;
        let whereCondition = { userid: hisid };

        const fromTimestamp = dateFrom ? moment(dateFrom, "DD-MM-YYYY").startOf('day').unix(): null;
        const toTimestamp = dateTo? moment(dateTo, "DD-MM-YYYY").endOf('day').unix(): null;

        if (fromTimestamp && toTimestamp) {
            whereCondition.timed = { [Op.between]: [fromTimestamp, toTimestamp] };
        }
        if (currency) {
            whereCondition.currency = currency;
        }

        if (query) {
            whereCondition = {
                [Op.and]: [
                    { userid: hisid },
                    {
                        [Op.or]: [
                            { pay_desc: { [Op.like]: `%${query}%` } },
                            { amount: { [Op.like]: `%${query}%` } },
                            { pfor: { [Op.like]: `%${query}%` } },
                            { ntwk: { [Op.like]: `%${query}%` } },
                            { txref: { [Op.like]: `%${query}%` } },
                            { paytype: { [Op.like]: `%${query}%` } },
                            { narration: { [Op.like]: `%${query}%` } },
                            { recipient: { [Op.like]: `%${query}%` } }
                        ]
                    }
                ]
            };
        }

        // Fetch transaction history
        const gethist = await Payn.findAndCountAll({
            where: whereCondition,
            limit: maxlimit,
            offset,
            order: [['timed', 'DESC']]
        });

        if (!gethist.rows.length) {
            return res.status(200).json({ status: false, message: "No payment found for you" });
        }


        const datalist = await Promise.all(gethist.rows.map(async (arrayItem) => {
            var custname = meteradr = vendunit = vendtoken = sourcename = sourceaccount = sourcebank = '';
            var amount = arrayItem.amount;
            var amountval = arrayItem.amountval;
            var transtype = arrayItem.paytype;
            var transref = arrayItem.txref;
            var dated = moment.unix(arrayItem.timed).format("DD/MM/YYYY");
            var timed = moment.unix(arrayItem.timed).format("hh:mm A");
            var timestamp = arrayItem.timed.toString();
            var newbal = arrayItem.newbal;
            var prevbal = arrayItem.prevbal;
            var phonenumber = arrayItem.recipient;
            var product = ucFirst(arrayItem.pfor);
            var productid = arrayItem.productid;
            var paidthru = arrayItem.paidthru;
            var network = arrayItem.ntwk;
            var pay_desc = arrayItem.pay_desc;
            var networkcode = arrayItem.ntwkid ? arrayItem.ntwkid : '';
            var paystatus = arrayItem.status;
            var narration = arrayItem.narration;
            var fee = arrayItem.fee ? formatAmount(arrayItem.fee) : '0.00';
            var paystatus_text = arrayItem.status == '0' ? 'pending' : arrayItem.status == '1' ? 'completed' : arrayItem.status == '2' ? 'processing' : arrayItem.status == '3' ? 'refunded' : arrayItem.status == '4' ? 'chargedback' : arrayItem.status == '5' ? 'cancelled' : '';
            var currency = arrayItem.currency;

            if (arrayItem.meta && arrayItem.pfor != 'wallet') {
                var meta = JSON.parse(arrayItem.meta);
                var custname = meta.custname ? meta.custname : '';
                var meteradr = meta.address ? meta.address : '';
                var metertype = meta.metertype ? meta.metertype : '';
                var vendUnit = meta.unit ? meta.unit : '';
                var vendunit =  vendUnit ? vendUnit : 'NA';
                var vendtoken = (arrayItem.pay_desc == '' || arrayItem.pay_desc == null) ? 'NA' : meta.token;
                var sourcename = meta.sourcename ? meta.sourcename : '';
                var sourceaccount = meta.sourceaccount ? meta.sourceaccount : '';
                var sourcebank = meta.sourcebank ? meta.sourcebank : '';

            } else if (arrayItem.meta && arrayItem.pfor == 'wallet') {
                var meta = JSON.parse(arrayItem.meta);
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

            var dataplan = ''; var prodcode = '';

            return { amount, amountval, transtype, transref, dated, timed, timestamp, newbal, prevbal, phonenumber, product, productid, pay_desc, paidthru, network, paystatus, paystatus_text, currency, custname, meteradr, metertype, vendunit, vendtoken, dataplan, prodcode, fee, networkcode, sourcename, sourceaccount, sourcebank, narration };

        }));

        res.json({
            status: true,
            message: 'Transaction history retrieved',
            data: {
                total: gethist.count,
                totalPages: Math.ceil(gethist.count / maxlimit),
                currentPage: parseInt(page),
                maxlimit,
                data: datalist
            }
        });

    } catch (error) {
        console.log('user trans history catch ERROR: ' + error.message)
    }
}


const transDetails = async (req, res) => {

    try {
        const userid = req.user.id;
        if (!userid)
            return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

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
        var phonenumber = getdetails.recipient;
        var paydate = moment.unix(getdetails.timed).format('Do MMM, YYYY');
        var paytime = moment.unix(getdetails.timed).format('MMM Do, YYYY | h:m a');
        var transtimed = moment.unix(getdetails.timed).format("Do MMM, YYYY hh:mm a")
        var newbal = getdetails.newbal;
        var prevbal = getdetails.prevbal;
        var transtype = getdetails.paytype;
        var product = ucFirst(getdetails.pfor);
        var productid = getdetails.productid;
        var pay_desc = getdetails.pay_desc;
        var narration = getdetails.narration;
        var network = getdetails.ntwk ? getdetails.ntwk.toUpperCase() : '';
        var paystatus = getdetails.status;
        var networkcode = getdetails.ntwkid ? getdetails.ntwkid : '';
        var paystatus_text = getdetails.status == '0' ? 'Pending' : getdetails.status == '1' ? 'Successful' : getdetails.status == '3' ? 'Refunded' : getdetails.status == '4' ? 'Chargedback' : getdetails.status == '5' ? 'Cancelled' : '';
        var currency = getdetails.currency;

        if (getdetails.meta && getdetails.pfor != 'wallet') {
            var meta = JSON.parse(getdetails.meta);
            var custname = meta.custname ? meta.custname : '';
            var meteradr = meta.address ? meta.address : '';
            var metertype = meta.metertype ? meta.metertype : '';
            var vendUnit = meta.unit ? meta.unit : '';
            var vendunit =  vendUnit ? vendUnit : 'NA';
            var vendtoken = (getdetails.pay_desc == '' || getdetails.pay_desc == null) ? 'NA' : meta.token;
            var sourcename = meta.sourcename ? meta.sourcename : '';
            var sourceaccount = meta.sourceaccount ? meta.sourceaccount : '';
            var sourcebank = meta.sourcebank ? meta.sourcebank : '';

        } else if (getdetails.meta && getdetails.pfor == 'wallet') {
            var meta = JSON.parse(getdetails.meta);
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

        var datalist = { amount, vendtoken, transref, phonenumber, custname, meteradr, paydate, newbal, prevbal, product, productid, paystatus, paystatus_text, currency, paytime, vendunit, metertype, network, transtype, cashback, prodcode, dataplan, transtimed, fee, pay_desc, amountval, networkcode, sourcename, sourceaccount, sourcebank, narration };

        res.json({
            status: true,
            message: 'Transaction Details',
            data: datalist
        });

    } catch (error) {
        console.log('trans details catch ERROR: ' + error.message)
    }
}


const transSum = async (req, res) => {

    try {
        const userid = req.user.id;
        if (!userid)
            return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { month, year, currency } = cleanMe(req.body);

        if (!month || !year) {
            return res.status(400).json({
                status: false,
                message: 'Month and year are required'
            });
        }

        // Convert month and year to integers
        const selectedMonth = parseInt(month, 10);
        const selectedYear = parseInt(year, 10);

        // Get the start and end timestamps for the given month and year
        const startOfMonth = moment(`${selectedYear}-${selectedMonth}`, "YYYY-M").startOf("month").unix();
        const endOfMonth = moment(`${selectedYear}-${selectedMonth}`, "YYYY-M").endOf("month").unix();

        // Get total inflow (credit transactions)
        const totalInflow = await Payn.sum('amount', {
            where: {
                userid: userid, currency: currency,
                paytype: 'credit', status: 1,
                timed: { [Op.between]: [startOfMonth, endOfMonth] }
            }
        }) || 0;

        // Get total outflow (debit transactions)
        const totalOutflow = await Payn.sum('amount', {
            where: { userid: userid, paytype: 'debit', currency: currency, status: 1, timed: { [Op.between]: [startOfMonth, endOfMonth] } }
        }) || 0;

        res.json({
            status: true,
            message: `Transaction summary for ${moment(`${selectedYear}-${selectedMonth}`, "YYYY-M").format("MMMM YYYY")}`,
            data: {
                month: selectedMonth,
                year: selectedYear,
                totalInflow: totalInflow.toString(),
                totalOutflow: totalOutflow.toString()
            }
        });
    } catch (error) {
        console.error(error);
        // res.status(500).json({ status: false, message: 'Error retrieving cashback history' });
    }

}


const accountStatement = async (req, res) => {

    try {
        const hisid = req.user.id;
        if (!hisid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });
        let { dateFrom, dateTo, currency} = cleanMe(req.body);

        if (!dateFrom || dateFrom == '') return res.status(400).json({ status: false, message: 'Kindly select statement starting date' });
        if (!dateTo || dateTo == '') return res.status(400).json({ status: false, message: 'Kindly select statement end date' });

        // Convert dateFrom and dateTo to Unix timestamps (seconds)
        const fromDate = dateFrom ? moment(dateFrom, "DD-MM-YYYY").startOf('day').unix(): null;
        const toDate = dateTo? moment(dateTo, "DD-MM-YYYY").endOf('day').unix(): null;

        if (!currency) currency = 'NGN'; // Ensure currency has a default value if it's null or undefined

        // Step 1: Get Opening Balance (before fromDate)
        const openingBalance = await Payn.findOne({
            where: { userid: hisid, currency: currency, status: { [Op.gt]: 0 }, timed: { [Op.gt]: fromDate } }
        });

        const closingBalance = await Payn.findOne({
            where: {
                userid: hisid, currency: currency,
                status: { [Op.gt]: 0 },
                timed: { [Op.lte]: toDate }
            },
            order: [['timed', 'DESC']]
        });


        // Step 2: Get Transactions Within Period
        const transactions = await Payn.findAll({
            where: {
                userid: hisid, currency: currency,
               status: { [Op.gt]: 0 },
                timed: { [Op.between]: [fromDate, toDate] }
            },
            order: [['timed', 'ASC']]
        });

        if(transactions.length == 0){
            return res.status(400).json({ status: false, message: 'No record found for your selected date range' });
        }

        const userinfo = await getUserInfo(hisid);
        const useremail = userinfo.email;
        const userphone = userinfo.phoneno;
        const hisname = userinfo.firstname + ' ' + userinfo.lastname;
        const address = userinfo.address + ' ' + userinfo.city;

        // Step 3: Compute Running Balance
        let runningBalance = 0;
        const statementRecords = transactions.map(tx => {
            const amount = Number(tx.amount); // Convert to number
            const credit = tx.paytype == 'credit' ? amount : 0;
            const debit = tx.paytype == 'debit' ? amount : 0;

            runningBalance += amount;

            return {
                date : new Date(tx.timed * 1000).toLocaleString(),
                timed: tx.timed.toString(),
                product: tx.pfor || '',
                recipient: tx.recipient || '',
                credit, debit,
                reference: tx.txref || '',
                description: (tx.narration == '' || tx.narration == null) ? tx.pay_desc : tx.narration,
                balance: formatAmount(tx.newbal, 2)
            };
        });

        // Step 4: Calculate Totals
        const totalInflow = formatAmount(statementRecords.reduce((sum, record) => sum + record.credit, 0), 2);
        const totalOutflow = formatAmount(statementRecords.reduce((sum, record) => sum + record.debit, 0), 2);
        // const closingBalance = formatAmount(runningBalance);

        // Step 5: Format and Output the Statement
        const data = {
            period: `${new Date(fromDate * 1000).toISOString().split('T')[0]} to ${new Date(toDate * 1000).toISOString().split('T')[0]}`,
            openingBalance: openingBalance ? formatAmount(openingBalance?.prevbal, 2) : 0,
            startdate: dateFrom,
            enddate: dateTo,
            totalInflow: totalInflow,
            totalOutflow: totalOutflow,
            closingBalance: closingBalance ? formatAmount(closingBalance.newbal, 2) : 0,
            customerName: hisname,
            customerEmail: useremail,
            customerAddress: ucFirst(address),
            accountNumber: userphone,
            records: statementRecords
        };

        res.json({
            status: true,
            message: 'Account statement retrieved',
            data
        });

    } catch (error) {
        console.log('user statmt act catch ERROR: ' + error.message)
    }
}

const veryPlembyHook = async (req, res) => {
    try {
        const event = req.body;

        // console.log('event', event)

        if (!event || event == '' )
            return res.status(400).json({ status: false, message: 'Invalid event' });

        // Modify resp object before stringifying and saving
        if (event && event['widget_info'] && event['widget_info']['payload'] && event['widget_info']['payload']['image']) {
            event['widget_info']['payload']['image'] = ""; // Empty the image field
        }

        if (event && event['nin_data'] && event['nin_data']['signature']) {
            event['nin_data']['signature'] = ""; // Empty the signature on bvn field
        }

        const modifyBody = JSON.stringify(event); //modify body

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);

        let dtimed = Date.parse(new Date()) / 1000;
        var transtimed = moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")

        const respMessage = resp['detail'];
        var reference = resp['verification']['reference'];
        var verStatus = resp['verification']['status'];

        var widget_email = resp['widget_info']['email'];
        var widget_last_name = resp['widget_info']['last_name'];
        var widget_first_name = resp['widget_info']['first_name'];
        var userid = resp['widget_info']['user_ref'];  //userid
        var number_nin = resp['widget_info']['payload']['number_nin']; 
        var imagefile = resp['widget_info']['payload']['image'];
        
        if (resp['status'] && resp['response_code'] == '00') {

            await payWhk.create({ resp: modifyBody, txref: dtimed, gateway: 'plemby', timed: dtimed, processed: 0 });

            if (resp && resp['nin_data']) {
                var vertype = 'NIN';
                var data = resp['nin_data'];
                var lastName = data['surname']; 
                var firstName = data['firstname'];
                var dateOfBirth = data['birthdate']; //10-JAN-1990
                var ver_email = data['email'];
                var bvnno = data['nin'];
                var gender = data['gender'];
                var phoneNumber1 = data['telephoneno'];
                var maritalStatus = data['maritalstatus'];
                var base64Image = data['photo'];

            }else{
                var vertype = 'BVN';
                var data = resp['data'];
                var base64Image = data['base64Image'];
                var bvnno = data['bvn'];
                var dateOfBirth = data['dateOfBirth']; //10-JAN-1990
                var firstName = data['firstName'];
                var gender = data['gender'];
                var lastName = data['lastName']; 
                var maritalStatus = data['maritalStatus'];
                var phoneNumber1 = data['phoneNumber1'];
                var ver_email = data['email'];
            }

            const hisdob = moment(dateOfBirth, 'DD-MMM-YYYY').format('YYYY-MM-DD');
            
            const theverstatus = verStatus.toLowerCase() == 'verified' ? 1 : 3;

            const getuser = await Customer.findOne({ where: { id: userid } });

             if (!getuser)
                 return res.status(400).json({ status: false, message: 'User details not found with the user ref received' });

                const checkdbvn = await KYC.findOne({ order: [['id', 'ASC']], where: { bvv: bvnno, vertype: vertype, status: 1, userid:  { [Op.ne]: userid } } });
                
                if (checkdbvn){
                    
                    var mailcontent = `
                    <p>Ouch! Your Facial verification on ${process.env.SITENAME} has been declined. Kindly check the reason below.</p>

                    <p>${vertype} used already exist with another account</p>

                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                `;

                await Customer.update({ bvverify: 0}, { where: { id: userid } });

                //send email                
                await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                const notedesc = `Your Facial verification failed. ${vertype} used already exist with another account`
                await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);

                await notifyMe(userid, 'KYC Verification', 'user', notedesc)

                return res.status(400).json({ status: false, message: `${vertype} already exist with another account` });
            }

            const logKYC = await KYC.create({
                userid: userid, otpcode: '', otptoken: reference, verid: reference, timed: dtimed,
                verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                veremail: ver_email, bvv: bvnno, avatar: imagefile, verphone: phoneNumber1,
                status: theverstatus, jsonresp: '', vertype: vertype, provider: 'prembly'
            });

            
            if (!logKYC)
                return res.status(400).json({ status: false, message: "Ouch! Unable to process request, kindly retry again" });

            const bvverify = verStatus.toLowerCase() == 'verified' ? 2 : 0;

            //update customer tble with the new access token
            await Customer.update(
                { firstname: firstName, lastname: lastName, bvverify: bvverify, accounttier: 1 }, { where: { id: userid } }
            );

            const notedesc = `Congratulation! Your Facial verification successfully approved`
            await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);

            await notifyMe(userid, 'KYC Verification', 'user', notedesc)

            
            var createAccount = await genSHAccount(userid, reference, bvnno, '', vertype, hisdob);
            
            var mailcontent = `
            <p>Congratulations! Your Facial verification on ${process.env.SITENAME} has been verified and approved successfully.</p>

            <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
            `;

            //send email                
            await mailSender('', 'KYC Verification Update', widget_email, mailcontent);
            
            return res.status(200).json({
                status: true, message: `Account successfully verified and account number generated`
            })

        }else{
            var mailcontent = `
            <p>Ouch! Your Facial verification on ${process.env.SITENAME} has been declined. Kindly check the reason below.</p>

            <p>${respMessage}</p>

            <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
          `;

            //send email                
            await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

            const notedesc = `Your Facial verification failed. ${respMessage}`
            await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);

            await notifyMe(userid, 'KYC Verification', 'user', notedesc)

            res.json({
                status: false,
                message: respMessage
            });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Something went wrong! Unable to process request' });
        console.log("plxm hook ERROE: ", error.message);
    }
}


const verDojahHook = async(req, res)=>{  
    try {    
        const event = req.body;
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
        }

        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        let dtimed = Date.parse(new Date())/1000; 
        var entity = resp;

        // console.log('debuggg doj whk', dbody)
        
        payWhk.create({resp: dbody, txref: '', gateway: 'dojah', timed: dtimed, processed: 0});

        if (resp['reference_id']){
    
            const verificationStatus = resp['verification_status'];  
    
            if(resp['metadata']['user_id']){
                var tknid = resp['metadata']['user_id'];
                const user_id = entity['metadata']['user_id'];
                const widget_email = entity['metadata']['email'];

                const respMessage = entity['message']; //NIN/BVN
                const id_type = entity['id_type']; //NIN/BVN
                const idvalue = entity['value']; //76526262222
                const reference = entity['reference_id']; //76526262222
                const verification_mode = entity['verification_mode']; //76526262222
                const vertype = entity['verification_type']; //NIN/BVN
                const vervalue = entity['verification_value']; //76526262222
                const imagefile = entity['selfie_url']; 
                const verstatus = entity['status']; 
                const verification_status = entity['verification_status']; 

                if(vertype == 'nin' || vertype == 'NIN'){
                    var dataEntity = entity['data']['government_data']['data']['nin']['entity'];
                    var phone_number = dataEntity['phone_number'];
                }else{
                    var dataEntity = entity['data']['government_data']['data']['bvn']['entity'];
                    var phone_number = dataEntity['phone_number1'];
                }

                const firstName = dataEntity['first_name'];
                const lastName = dataEntity['last_name'];
                const gender = dataEntity['gender'];
                const dateOfBirth = dataEntity['date_of_birth'];
                const image_url = dataEntity['image_url'];
                const veremail = dataEntity['email'];
                const marital_status = dataEntity['marital_status'];

                const hisdob =  dateOfBirth;

                //chec the user exis
                const getuser = await Customer.findOne({where: {id: tknid}});
                if(!getuser){
                    // console.log('Invalid customer ID');
                    return 'invalid customer';
                }

                var username = getuser.firstname;
                var useremail = getuser.email;
                var currentTier = getuser.accounttier;

                if(verstatus || verificationStatus == 'Completed'){
                    var capture_status = '1';
                    var bvverify = 2;
                }else{
                    var capture_status = '3';
                    var bvverify = 0;
                }
                
                const dtimed = Math.floor(Date.now() / 1000);

            try {
                let updateKYC;
                const checkhisdoc = await KYC.findOne({where: {[Op.and]: [{userid: tknid}, {provider: 'dojah'}]} });

                if(checkhisdoc){
                    //update
                    updateKYC = await KYC.update({otpcode: '', otptoken: reference, verid: reference, timed: dtimed,
                        verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                        veremail: veremail, bvv: vervalue, avatar: imagefile, verphone: phone_number,
                        status: capture_status, jsonresp: dbody, vertype: vertype, provider: 'dojah', tier: 1
                    }, { where: { userid: user_id} });
                }else{
                    //not found                            
                    updateKYC = await KYC.create({
                        userid: user_id, otpcode: '', otptoken: reference, verid: reference, timed: dtimed,
                        verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                        veremail: veremail, bvv: vervalue, avatar: imagefile, verphone: phone_number,
                        status: capture_status, jsonresp: dbody, vertype: vertype, provider: 'dojah', tier: 1
                    });
                }

                if(!updateKYC)
                    return res.json({status: false, message: 'Unable to complete verification, kindly retry again. '});            

                    if(verstatus || verificationStatus == 'Completed'){
                        if(currentTier > 1){
                            await Customer.update({ firstname: firstName, lastname: lastName, bvverify: bvverify}, 
                                { where: { id: user_id } });
                        }else{
                            await Customer.update(
                                { firstname: firstName, lastname: lastName, bvverify: bvverify, accounttier: 1 }, 
                                { where: { id: user_id } }
                            );
                        }
                        
            
                        const notedesc = `Congratulations! Your Facial verification successfully completed`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)
            
                        // GENERATE ACCOUNT
                        const GenAcct = await genSHAccount(user_id, reference, vervalue, '', vertype, hisdob);

                        // console.log('GenAcct', GenAcct)
                        
                        var mailcontent = `
                        <p>Congratulations! Your Facial verification on ${process.env.SITENAME} has been verified and approved successfully.</p>
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
            
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                        //GIVE WELCOME BONUS
                        await giveWelcomeBonus(user_id);
                        await referralUplineDownlineBonus(user_id);

                        res.json({
                            status: true,
                            message: 'Verification Successfuly Completed'
                        });

                    }else{
                        // Unverified
                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });
                    }
                        
                } catch (err) {
                    console.error('Unable to process your request  dojah hook: ', err.message);
                    // return res.status(400).json({ status: false, message: 'Unable to process your request' });
                }

            }else{
                res.json({ status: false, message: 'Invalid customer ID' });
            }  
            
        }else{
            res.json({ status: false, message: 'Invalid reference ID' });
        }

   }catch (error) {
        res.json({ status: false, message: 'Something went wrong! Unable to process request' });
        console.log("ver hook ERROE: ", error.message);
    }
}

const getWebhookSignature = async(svixId, svixTimestamp, body)=>{

    const signedContent = `${svixId}.${svixTimestamp}.${body}`
    // const secret = process.env.MPLWK_SKEY; // your webhook secret
    const secret = 'whsec_422544c97d76491a84c02c5a67db3e9f'; // your webhook secret

    // Need to base64 decode the secret
    const secretBytes = (secret.split('_')[1], "base64");
    const signature = crypto.createHmac('sha256', secretBytes).update(signedContent).digest('base64');

    // console.log(signature);
    return signature
}

const maplHkNotify = async(req, res)=>{  
     try {    
        const event = req.body;
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
        }

        const svixId = req.headers["svix-id"]
        const svixTimestamp = req.headers["svix-timestamp"]
        const svixSignature = req.headers["svix-signature"]
        const signature = await getWebhookSignature(svixId, svixTimestamp, event);

        // console.log('svixId', svixId)
        // console.log('svixTimestamp', svixTimestamp)
        // console.log('svixSignature', svixSignature)
        // console.log('signature', signature)
        // console.log('event', event)

         // Check if the signature is valid
        // if (signature !== svixSignature) {        
        //     return res.json({ status: false, message: 'Unathourized notification' });
        // }

        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        const eventtype = resp['event'];  

        let dtimed = Date.parse(new Date())/1000; 
        // console.log('mlphk', resp)

        payWhk.create({resp: dbody, txref: resp['reference'], gateway: 'mpld', timed: dtimed, processed: 0});

        res.status(200).json({ status: true, message: "Webhook received and processing." });

        
        if(eventtype == 'issuing.created.successful'){
            const reference = resp['reference'];  
            const data = resp['card'];
            const card_id = data['id'];
            const cardstatus = data['status'];
            const cardtype = data['type'];

            /* get the card */
            const checkkad = await VCard.findOne({where: {custref: reference} });
            if(checkkad){
                const userid = checkkad.userid; 
                const custid = checkkad.trackingid;
                const tofund_amount = checkkad.prefund;
                let timed = Date.parse(new Date())/1000;
                var transtimed = moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")

                /* GET CARD DETAILS */
                let config = {
                    method: 'get',
                    url: `${process.env.MPLDURL}/issuing/${card_id}`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    }
                };

                let response = await axios.request(config);
                let thedata = response.data;    

                // console.log('thedata', thedata)

                if(thedata['status']){
                    const kaddata = thedata['data']
                    const kadid = kaddata['id'];
                    const kadname = kaddata['name'];
                    const masked_pan = kaddata['masked_pan'];
                    const expiry = kaddata['expiry'];
                    const cvv = kaddata['cvv'];
                    const status = kaddata['status'];
                    const issuer = kaddata['issuer'];  //mastercard or visa
                    const address = JSON.stringify(kaddata['address']);
                    const balance = kaddata['balance']/100;  //cent to dola

                    // console.log('masked_pan', masked_pan)
                    // console.log('expiry', expiry)

                    const kadUpdat = await VCard.update({
                        provider: 'MPLD', cardbrand: issuer, cardtype: 'virtual', prefund: balance, 
                        expirydate: expiry, expirymonth: '', cardname: kadname, cardno: masked_pan, 
                        address: address, cardid: card_id, cvv: cvv, timed: timed, status: 1, jsonresp: '' }, 
                        { where: {custref: reference }
                    } );


                    if(!kadUpdat)
                        return res.status(400).json({
                            status: false,
                            message: 'Unable to complete update'
                        });

                    const notedesc = `Congratulation! Your ${issuer} virtual card issuance is successfully processed`
                    await pushNotify(userid, 'Card Issuance - HitchPay', notedesc);
        
                    await notifyMe(userid, 'Card Issuance', 'user', notedesc)

                     var mailcontent = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">Congratulations! Your ${issuer} virtual card issuance verification on ${process.env.SITENAME} has been processed successfully.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Brand:</strong> ${issuer}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Name:</strong> ${kadname}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${reference}</p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;
        
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    //send email                
                    await mailSender('', 'Card Issuance', useremail, mailcontent);

                    //UPDATE HOOK
                    await payWhk.update({ processed: 1 }, { where: { txref: reference} });

                    //log the transaction
                    await CardTrans.create({
                        userid: userid, amount: balance, provider: 'MPLD', transtype: 'ISSUANCE',
                        mode: 'CREDIT', cardid: card_id, currency: 'USD', timed: timed, status: 'SUCCESS',
                        reference: reference, description: 'Virtual card issuance', merchant: 'HitchPay', merchantdesc: ''
                    });

                    res.json({
                        status: true,
                        message: 'Notification Processed'
                    });
                }else{
                    return res.status(400).json({
                        status: false,
                        message: thedata
                    });
                }
            }else{
                return res.status(400).json({
                    status: false,
                    message: 'Unable to process request'
                });
            }

        }else if(eventtype == 'issuing.transaction'){
            
            const reference = resp['reference'];  
            const card_id = resp['card_id'];
            const transstatus = resp['status'];
            const transtype = resp['type'];
            const amount = parseFloat(resp['amount']) / 100; //frm cent to dola
            const currency = resp['currency'];
            const description = resp['description'];
            const fee = resp['fee'];
            const merchant =  JSON.stringify(resp['merchant']);
            const authorization_amount = resp['authorization_amount'];
            const authorization_currency = resp['authorization_currency'];
            const card_acceptor_mcc = resp['card_acceptor_mcc'] ?? '';
            const card_acceptor_mid = resp['card_acceptor_mid'] ?? '';
            const card_acceptor_state = resp['card_acceptor_state'] ?? '';            
            const is_termination = resp['is_termination'];
            const mode = resp['mode'];
            const settled = resp['settled'];

            const merchantdesc = `${card_acceptor_mcc}  ${card_acceptor_mid} ${card_acceptor_state}`;
 
            /* get the card */
            const checkkad = await VCard.findOne({where: {cardid: card_id} });
            if(checkkad){
                
                if(transtype && transtype.toLowerCase() == 'withdrawal' && is_termination == true){
                    // console.log('na here')
                    const withdrwTransaction = await db.sequelize.transaction();

                    var checkhook = await Payn.findAll({ where: { txref: reference }, transaction: withdrwTransaction })

                    if (checkhook.length > 0){
                        await withdrwTransaction.rollback();
                        console.warn(`[Webhook] Duplicate transaction detected for reference: ${reference}. Ignoring.`);
                        
                        return res.status(400).json({
                            status: false,
                            message: `Duplicate transaction detected for reference: ${reference}`
                        });
                    }

                    var provref = reference;
                    var userid = checkkad.userid;
                    var tocredit = amount;
                    var themerchant = '';

                    const userbal = await getBal(userid, 'USD', { transaction: withdrwTransaction });
                    // const revenue = (tocharge * rate) - tocredit;
                    const newbal = await updateBalance(userid, tocredit, 'USD', 'credit', { transaction: withdrwTransaction }, true);

                    // Define your replacement map (all lowercase keys for consistency)
                    const replacements = {
                    "maplerad": "Hitchpay",
                    }

                    // Get the merchant name (default to empty string if missing)
                    let merchantName = resp?.merchant?.name || ""
                    // Normalize to lowercase and check replacement
                    merchantName = replacements[merchantName.toLowerCase()] || merchantName
                    const pay_desc = `${description} - ${merchantName} ${resp['merchant']['country']}`;

                    await Payn.create({
                        userid: userid, amount: tocredit, amountval: tocredit, newbal: newbal, prevbal: userbal, currency: 'USD', paychannel: 'MPLD',
                        txref: reference, pfor: 'cardwithdraw', usertype: 'user', paytype: 'credit', productid: '', ntwk: checkkad.cardbrand,
                        paidthru: 'Card', pay_desc: pay_desc, timed: dtimed, status: 1, recipient: '', fee: '0', revenue: '0', jsonresp: ''
                    }, { transaction: withdrwTransaction });

                    await withdrwTransaction.commit();

                     //send notification
                    var notedescrpt = `$${formatAmount(tocredit)} balance on your terminated card - ${checkkad.cardno} has been credited your USD wallet`;
    
                    await notifyMe(userid, 'Card Terminated Balance', 'user', notedescrpt)
                    await pushNotify(userid, 'Card Terminated Alert - HitchPay', notedescrpt)

                     // send email to the customer for the card termination
                    var mailbody = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">Your virtual card has been terminated and the balance of $${formatAmount(tocredit)} on the terminated card - ${checkkad.cardno} has been credited to your USD wallet.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Number:</strong> ${checkkad.cardno}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount Credited:</strong> $${formatAmount(tocredit)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${reference}</p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;
                          
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    //send email                
                    await mailSender('', 'Card Terminated Balance Credited', useremail, mailbody);

                }else{
                    var themerchant = merchant;
                }

                //log the transaction
                await CardTrans.create({
                    userid: checkkad.userid, amount: amount, provider: 'MPLD', transtype: transtype,
                    mode: mode, cardid: card_id, currency: currency, timed: dtimed, status: transstatus,
                    reference: reference, description: description, merchant: themerchant, merchantdesc: merchantdesc
                });

                // Send notification to the user
                const notedesc = `Your virtual card (${checkkad.cardno}) transaction for ${description} of ${currency}${formatAmount(amount)} was ${transstatus}.`;
                await pushNotify(checkkad.userid, 'Virtual Card Transaction', notedesc);
                await notifyMe(checkkad.userid, 'Virtual Card Transaction', 'user', notedesc);

                // Send email to the user
                const userinfo = await getUserInfo(checkkad.userid);
                const useremail = userinfo.email;
                const mailcontent = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">A transaction occurred on your virtual card.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Number:</strong> ${checkkad.cardno}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Description:</strong> ${description}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> ${currency}${formatAmount(amount)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Status:</strong> ${transstatus}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${reference}</p>
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                `;
                await mailSender('', 'Virtual Card Transaction Alert', useremail, mailcontent);

                res.json({
                    status: true,
                    message: 'Notification Processed'
                });

            }else{
                return res.status(400).json({
                    status: false,
                    message: 'Card not found'
                });
            }

        }else if(eventtype == 'account.creation.failed'){
            const decline_reason = resp['decline_reason'];  //loop
            const txref = resp['reference'];
            const id = resp['id'];

            const uniqueCombined = formatDeclineReasons(decline_reason);

            const listItems  = reasonsStringToEmailList(uniqueCombined);


            const checkkad = await AcctRequest.findOne({where: {reference: txref} });
            if(checkkad){
                const userid = checkkad.userid;
                await AcctRequest.update({ status: 3, decline_reason: uniqueCombined }, { where: { reference: txref }});

                 const notedesc = `Oops! Your USD virtual account request has been declined. Kindly check your email for more details`
                    await pushNotify(userid, 'USD Account Request - HitchPay', notedesc);
        
                    await notifyMe(userid, 'USD Account Request', 'user', notedesc)

                     var mailcontent = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your USD virtual account request has been declined by our partner bank.</p>
                    ${listItems }
                    <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify the issue(s) above</p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;
        
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    //send email                
                    await mailSender('', 'USD Account Request', useremail, mailcontent);

                    //UPDATE HOOK
                    await payWhk.update({ processed: 1 }, { where: { txref: txref} });

                    res.json({
                        status: true,
                        message: 'Notification Processed'
                    });
            }else{
                res.json({
                    status: true,
                    message: 'Request not found'
                });
            }

        }else if(eventtype == 'account.creation.successful'){
            const txref = resp['reference'];
            const id = resp['id'];

            const checkkad = await AcctRequest.findOne({where: {reference: txref} });
            if(checkkad){
                const userid = checkkad.userid;

                await USAccountUpd(txref, userid);  //check if account updated
                
                //UPDATE HOOK
                await payWhk.update({ processed: 1 }, { where: { txref: txref} });

                res.json({
                    status: true,
                    message: 'Notification Processed'
                });
            }else{
                res.json({
                    status: true,
                    message: 'Request not found'
                });
            }
            
        }else if(eventtype == 'collection.successful'){
            const txref = resp['reference'];
            const transid = resp['id'];

            // get the transaction details
            try {
                let config = {
                    method: 'GET',
                    url: `${process.env.MPLDURL}/transactions/${transid}`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    },
                };

                let response = await axios.request(config);
                let thedata = response.data;

                console.log('thedata', thedata);

                if (thedata.status && thedata.data.status == 'SUCCESS' && thedata.data.type == 'COLLECTION') {
                    const data = thedata['data'];
                    const transId = data['id'];
                    const transtype = data['entry'].toLowerCase(); //credit
                    const amount = data['amount'] > 0 ? data['amount']/100 : 0; //cent;
                    const fee = data['fee'] > 0 ? data['fee']/100 : 0; //cent;
                    const currency = data['currency'];
                    const channel = data['channel'];  // e.g fedwire
                    const narration = data['summary'];
                    const reason = data['reason'];
                    const sessionId = data['reference'];
                    const trackingId = data['account_id'];
                    const AmountPaid = amount;

                    var Reference = transId;

                    const receiver_info = data['customer'];
                    const receiverId = receiver_info['id'];
                    const receiverName = receiver_info['name'];
                    const receiverEmail = receiver_info['email'];
                    const receiverPhone = receiver_info['phone_number'];

                    
                    const sender_info = data['source'];
                    const SourceBank = sender_info['bank_name'];
                    const bankCode = sender_info['bank_code'];
                    const SourceName = sender_info['account_name'];
                    const SourceAcct = sender_info['account_number'];

                    // primary merchnat 
                    const ledger_info = data['ledger'];
                    const creditAmount = ledger_info['credit'];
                    const debitAmount = ledger_info['debit'];
                    const balance_type = ledger_info['balance_type']; //e.g available
                    const reversal = ledger_info['reversal'];

                    const t = await db.sequelize.transaction();

                    try {
                        var checkhook = await Payn.findAll({ where: { txref: Reference }, transaction: t })

                        if (checkhook.length > 0){
                            await t.rollback();
                            console.warn(`[Mpld Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                            return;
                        }

                        //log the hook
                        let timed = Date.parse(new Date()) / 1000;
                        var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")

                        var checkbank = await Bank.findOne({ where: { trackid: trackingId, currency: 'USD' }, transaction: t })
                        
                        if (checkbank) {
                            
                            var userid = checkbank.userid;
                            var AccountNo = checkbank.accountno;
                            var receivingBank = checkbank.bankname;
                            const getuser = await Customer.findOne({ where: { id: userid }, transaction: t }).catch((err) => { console.log("Unable to process your request : " + err); });
                            if (!getuser) {
                                await t.rollback();
                                console.warn(`[Mpld Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                                return;
                            }

                            var fname = getuser.firstname;
                            var useremail = getuser.email;
                            var accounttier = getuser.accounttier;
                            var userbal = await getBal(userid, currency, { transaction: t });

                            // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                            const chargefee = await getFee('usdcollection', AmountPaid, accounttier); //get inflow fee
                           
            
                            var inflowfee_cap = 500;
                            var inflowfee = parseFloat(chargefee[0]); //fee  10
                            var prvfee = chargefee[1]  //provider charg  40
                            // var tocharge = inflowfee;
                            // var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                            // var revenue = parseFloat(tocharge) - parseFloat(fee);
                            
                            var tocharge = inflowfee;
                            var getrate = await getFX('USD', 'NGN'); //echange rate
                            var rate = getrate[1];

                            var ourfee = inflowfee * rate;
                            var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                            var revenue = (parseFloat(tocharge) - parseFloat(fee)) * parseFloat(rate);

                            var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);

                            // var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });


                            // const revenue = parseFloat(profit);
                            const meta_data = JSON.stringify({ rate: parseFloat(rate), amount: AmountPaid, ourfee: ourfee, revenuengn: revenue, sourcename: SourceName, sourceaccount: SourceAcct, sourcebank: SourceBank});

                                
                            /* Update wallet */
                            const newbal = await updateBalance(userid, tosettle, currency, 'credit', { transaction: t }, true);

                            // LOG CREDIT
                            await Payn.create({
                                userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: currency, newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: 'user', paytype: transtype, productid: AccountNo, paychannel: 'mpld', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fee, settlement_route: 'dollar'
                            }, { transaction: t });
                            
                                await payWhk.update({ processed: 1 }, { where: { txref: txref }, transaction: t });
                
                                await t.commit();  //commit transaction

                                const dnewbal = parseFloat(newbal);
                    
                                var thecontent = `
                                <div>
                                <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                                <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                                        Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                                        You have just received ${currency} collection in your ${currency} account - ${AccountNo}
                                    </p>
                
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> $${formatAmount(AmountPaid)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount Settled:</strong> $${formatAmount(tosettle)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> $${formatAmount(amountcharged)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? 'HitchPay' : SourceBank}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> $${formatAmount(dnewbal)}</p> <br>
                                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                                </div>
                                `;
                
                                await mailSender(fname, `${currency} Collection Alert`, useremail, thecontent);
                                await mailSender(fname, `${currency} Collection Alert`, 'ojidex17@gmail.com', thecontent);
                
                                //send notification
                                var notedesc = `Account successfully credited with ${currency}${(tosettle).toFixed(2)} through ${AccountNo}- ${receivingBank}`;
                
                                await notifyMe(userid, `${currency} Collection Alert`, 'user', notedesc)
                
                                var thesmg = `You have just received a credit of ${currency}${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo} - (${receivingBank})`;

                                await pushNotify(userid, `${currency} Collection Alert - HitchPay`, thesmg)
                                await pushNotify(4, `${currency} Collection Alert - HitchPay`, thesmg)

                                // return res.status(200).json({
                                //     status: true, message: 'Processed'
                                // })

                                console.log(`[Mpld Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                            } else {
                                await t.rollback();
                                console.error(`[Mpld Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                            }

                        } catch (error) {
                            if (t.finished !== 'commit' && t.finished !== 'rollback') {
                                await t.rollback();
                            }
                            console.error(`[Mpld Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
                        }

                } else {
                
                }

            } catch (error) {
                console.log(error)
                // return res.status(400).json({
                //     status: false,
                //     message: 'adm Card details could not retrieved ' + error.message,
                //     data: []
                // });
            }


            const checkkad = await AcctRequest.findOne({where: {reference: txref} });
            if(checkkad){
                const userid = checkkad.userid;

                await USAccountUpd(txref, userid);  //check if account updated
                
                //UPDATE HOOK
                await payWhk.update({ processed: 1 }, { where: { txref: txref} });

                res.json({
                    status: true,
                    message: 'Notification Processed'
                });
            }else{
                res.json({
                    status: true,
                    message: 'Request not found'
                });
            }
            
        }else{
            return res.status(400).json({
                status: false,
                message: 'Unexpected event type'
            });
        }
        
    }catch (error) {
        console.log("mpl hook ERROE: ", error.message);
        res.json({ status: false, message: `Something went wrong! Unable to process request ${error.message}` });
    }
}


function formatDeclineReasons(decline_reason) {
  if (!decline_reason || decline_reason.length === 0) {
    return "Your account creation failed due to an unknown error.";
  }

  const reasons = [...new Set(decline_reason)] // remove duplicates
    .map(r => r.trim().replace(/\.$/, "")) // clean spaces & trailing period
    .join(", ");

  return reasons;
}

function reasonsStringToEmailList(reasonString) {
  if (!reasonString || reasonString.length === 0) {
    return "<p>Your account creation failed due to an unknown error.</p>";
  }

  const listItems = reasonString.split(",").map(r => `<li>${r.trim()}</li>`).join("");

  return `
    <p>Your account creation failed for the following reason(s):</p>
    <ul>
      ${listItems}
    </ul>
  `;
}


const hook9psNotify = async (req, res) => {
    try {

        // Immediately acknowledge the webhook to prevent timeouts from the provider.
    
        const event = cleanMe(req.body);

        if (!event) {
            console.error('[Webhook Error] 9psbNotify: Invalid or empty event body received.');
            return; // Stop processing, response already sent.
        }

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);
        // console.log('resp', resp)
    
        if (resp['code'] == '00') {
            var sessionId = resp['transaction']['sessionid'];
            var transreference = resp['transaction']['reference'];
            var accountName = resp['customer']['account']['name'];
            var AccountNo = resp['customer']['account']['number'];
            var provider = resp['customer']['account']['bank'];
            var SourceBankCode = resp['customer']['account']['senderbankcode'];
            var SourceBank = resp['customer']['account']['senderbankname'];
            var SourceName = resp['customer']['account']['sendername'];
            var SourceAcct = resp['customer']['account']['senderaccountnumber'];
            var AmountPaid = resp['order']['amount'];
            var currency = resp['order']['currency'];
            var narration = cleanMe(resp['order']['description']);
            var hash = resp['hash'];
            var paymentcode = resp['code'];
            var provider = '9PSB'; var bankCode = '';
            var Reference = sessionId; var fees = 0;

        const t = await db.sequelize.transaction();
        
        try {
            var checkhook = await Payn.findAll({ where: { txref: Reference }, transaction: t })

            if (checkhook.length > 0){
                await t.rollback();
                console.warn(`[Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                return;
            }

            //log the hook
            let timed = Date.parse(new Date()) / 1000;
            var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")

            await payWhk.create({ resp: dbody, txref: Reference, gateway: '9psb', 
                timed: timed, processed: 0 }, { transaction: t }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

            /* respond */
             res.status(200).json({            
                success: true,
                status: "success",
                code:"00",
                message:"Acknowledged"
            });

            var checkbank = await Bank.findOne({ where: { accountno: AccountNo, provider: '9psb' }, transaction: t })
            
            if (checkbank) {
                /* call the verify endpoint */
                var validateHook = await verify9PSBStatus(sessionId, AccountNo, AmountPaid);

                if (validateHook) {
                    var userid = checkbank.userid;
                    const getuser = await Customer.findOne({ where: { id: userid }, transaction: t });

                    if (!getuser) {
                        await t.rollback();
                        console.warn(`[Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                        return;
                    }

                    var fname = getuser.firstname;
                    var useremail = getuser.email;
                    var accounttier = getuser.accounttier;
                    var userbal = await getBal(userid, 'NGN', { transaction: t });
    
                    // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                    const chargefee = await getFee('virtualaccount', AmountPaid, accounttier); //get inflow fee

                    const getsett = await AppSett.findOne({ where: { id: 1 } });

                    if (!getsett){ 
                        var inflowfee_cap = 1000;
                    }else{
                        var inflowfee_cap = parseFloat(getsett.maxamount)
                    }
            
                    var inflowfee = parseFloat(chargefee[0]); //fee  10
                    var prvfee = chargefee[1]  //provider charg  40
                        
                    if(fees == 0){  //if provider fees is 0, it means its SH to SH
                        var tocharge = 0;
                        var amountcharged = 0;
                        var revenue = 0;
                    }else{
                        var tocharge = inflowfee;
                        var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                        var revenue = parseFloat(tocharge) - parseFloat(fees);
                    }

                    var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);
                    // var newbal = parseFloat(userbal) + parseFloat(tosettle)
                    var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                    
                    /* Update wallet */
                    const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t });

                    // console.log('thenewbal', newbal)
    
                    // LOG CREDIT
                    await Payn.create({
                        userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: 'user', paytype: 'credit', productid: AccountNo, paychannel: '9psb', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees
                    }, { transaction: t });
                
                    await payWhk.update({ processed: 1 }, { where: { txref: Reference }, transaction: t });
    
                    /* CALCULATE EMTLFee */
                    var EMTLFee = 0;
                    var EMTLFee_Max = parseFloat('10000000000000000');  //amount to apply the emtl on

                    if (AmountPaid >= EMTLFee_Max) {
                        var userbal2 = await getBal(userid, 'NGN', { transaction: t });

                        var newbal2 = parseFloat(userbal2) - parseFloat(EMTLFee)
                        var dref = `${Reference}_EMTL`;
    
                        var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
    
                        // LOG CREDIT
                        await Payn.create({
                            userid: userid, recipient: AccountNo, amount: EMTLFee, amountval: EMTLFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Electronic Money Transfer Levy', usertype: 'user', paytype: 'debit', productid: Reference, paychannel: '9psb', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: 'According to the Electronic Money Transfer Levy (EMTL) regulation from 2022, a tax of ₦50 is imposed on all deposits of ₦10,000 or more made into your account', timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: 0, narration: `Electronic Money Transfer Levy (EMTL) applied on ${Reference}`, providerfee: 0, revenue: 0
                        }, { transaction: t });
    
                        //DEBIT HIM
                        /* Update wallet */
                        await updateBalance(userid, EMTLFee, 'NGN', 'debit', { transaction: t });

                    } else {
                        var EMTLFee = 0;
                    }

                    await t.commit();  //commit transaction

                    const dnewbal = parseFloat(newbal) - parseFloat(EMTLFee);
        
                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${AccountNo}(Safe Haven MFB)
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> N${formatAmount(tosettle)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? '' : SourceBank}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> N${formatAmount(amountcharged)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Electronic Money Transfer Levy (EMTL):</strong> N${formatAmount(EMTLFee)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> N${formatAmount(dnewbal)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;
    
                    await mailSender(fname, 'Wallet Funding', useremail, thecontent);
    
                    //send notification
                    var notedesc = `Wallet successfully credited with NGN${(tosettle).toFixed(2)} through ${AccountNo}`;
    
                    await notifyMe(userid, 'Wallet Funding', 'user', notedesc)
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(Safe Haven MFB)`;

                    await pushNotify(userid, 'Funding Alert - HitchPay', thesmg)

                    // return res.status(200).json({
                    //     status: true, message: 'Processed'
                    // })

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                }else{
                    await t.rollback();
                    console.error(`[Webhook Error] Could not validate hook via verifyStatus for session ID: ${sessionId}. Transaction rolled back.`);
                }

                } else {
                    await t.rollback();
                    console.error(`[Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                }

            } catch (error) {
                if (t.finished !== 'commit' && t.finished !== 'rollback') {
                    await t.rollback();
                }
                console.error(`[Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
            }

        } else {
            console.warn(`[Webhook] Received unknown event type: ${event_type}`);
        }

    } catch (error) {
        console.error("[Webhook Error] Top-level catch block in shHookNotify: ", error.message);
    }
}

const runKillIdleConnections = async (req, res) => {
  const cronSecret = req.params.secret;

  if (cronSecret !== process.env.CRON_SECRET) {
    logger.warn('Unauthorized attempt to run killIdleConnections cron job.');
    return res.status(403).json({ status: false, message: 'Forbidden' });
  }

  let killedCount = 0;
  let statusMessage = 'No idle connections found to kill.';

  try {
    const [rows] = await db.sequelize.query(`
      SELECT id, user, host, db, command, time, state, info
      FROM information_schema.processlist
      WHERE command = 'Sleep'
        AND time > 300
        AND user NOT IN ('system user','event_scheduler')
    `);

    if (!rows.length) {
      logger.info('CRON: No idle connections found older than 5 minutes.');
    } else {
      killedCount = rows.length;
      statusMessage = `Cleanup complete. Killed ${killedCount} idle connection(s).`;
      logger.info(`CRON: Found ${killedCount} idle connections to kill.`);

      for (const row of rows) {
        logger.warn(`- Killing idle thread ID: ${row.id}`, {
          user: row.user,
          host: row.host,
          db: row.db,
          idleTime: row.time,
          state: row.state,
          lastQuery: row.info
        });
        await db.sequelize.query(`KILL ${row.id}`);
      }
      logger.info(`CRON: ${statusMessage}`);
    }

    res.status(200).json({ status: true, message: statusMessage, killed: killedCount });
  } catch (error) {
    logger.error('❌ CRON: Error killing idle connections:', error);
    res.status(500).json({ status: false, message: 'An error occurred during cleanup.' });
  }
}

const fetchMpldTransDetails = async (reference) => {
    try {
        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/transactions/${reference}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;

        console.log(thedata);

        if (thedata.status && thedata.data.status == 'SUCCESS' && thedata.data.type == 'COLLECTION') {
            return [true, rate, quoteid];
            
        } else {
           
        }

    } catch (error) {
        console.log(error)
        // return res.status(400).json({
        //     status: false,
        //     message: 'adm Card details could not retrieved ' + error.message,
        //     data: []
        // });
    }
}

/* fetchMpldTransDetails('39040013-f2dd-456b-867e-72ad992572f4')
    .then(() => {
        console.log("Script finished.");
        process.exit(0);
    })
    .catch(err => {
        console.error("Script failed with error:", err);
        process.exit(1);
    });
 */

/* https.get("https://api.ipify.org?format=json", (resp) => {
  let data = ""

  resp.on("data", (chunk) => {
    data += chunk
  })

  resp.on("end", () => {
    console.log("Public outgoing IP:", JSON.parse(data).ip)
  })
}).on("error", (err) => {
  console.error("Error:", err.message)
}) */

module.exports = {
    shHookNotify, bankList, resolveBank, myWallets, transDetails, 
    payHistory, transSum, accountStatement, veryPlembyHook, verDojahHook,
    maplHkNotify, verify9PSBStatus, hook9psNotify, runKillIdleConnections,
    shHookDynamicNotify
};