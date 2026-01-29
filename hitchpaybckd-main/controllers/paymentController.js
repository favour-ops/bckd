const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
// const { Op } = require("sequelize");
const { Op, fn, col } = require("sequelize");
const md5 = require('md5');
const https = require('https');
const randomstring = require("randomstring");
const axios = require('axios');
const axiosApiClient = require('../config/axiosInstance');
const { getUserInfo, logAudit, logBeneficiary, getBal } = require("../config/userdetails");
const { mailSender } = require("../config/mailsender");
const { notifyMe, sendSMS, pushNotify } = require("../config/notifyuser");
const { formatAmount, ucFirst, cleanMe, shAcessToken, psb9Token, getFee, TransLimit, FreeTransfersCount, updateBalance, calculateProfitAndFee,
    logReferEarn, dailyBonus, toTwoDecimal, applyTaskBonus, applyCouponDiscount, checkTransAuth
} = require("../config/myfunct");

const { stringify } = require('querystring');
const express = require('express');
const crypto = require('crypto');
const { logger } = require('../config/logger');
const moment = require('moment');
const { client } = require('../config/redisClient');
const { fetchExchangeRate } = require('../controllers/crossBorderControllers/ycnetwkchannels');
const { doCybridBankDeposit } = require('../controllers/remittanceControllers/customers');
const { createPaymentIntent } = require('../controllers/remittanceControllers/stripe_remittance');

//create main Model
const Customer = db.customers;
const Payn = db.payn;
const OfflinePay = db.offlinepay;
const Product = db.products;
const Admin = db.admin;
const Wallets = db.wallets;
const Benefit = db.benefit;
const Bank = db.bankacct;
const KYC = db.kyc;
const LogRequest = db.logrequest;
const RevenueBank = db.revenuebank;
const logEarning = db.earnings;
const AppSett = db.appsettings;
const Business = db.business;
const CheckoutTrans = db.checkouttrans;
const Settlements = db.settlements;
const otpVer = db.verotp;



const processPaymentNew = async (req, res, next) => {
    try {
        const userid = req.user.id;

        const { amount, recipientno, network, isdiscounted, product, metadata, prdid, packageid, packageslug, transpin, envroute, billerid, bonustype, bonusid } = cleanMe(req.body);

        // console.log('buy bod', cleanMe(req.body))

        if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter amount' });
        if (parseFloat(amount) <= 0) return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
        if (!recipientno || (recipientno == '')) return res.status(400).json({ status: false, message: 'Kindly enter recipient phone number' });
        if (!network || (network == '')) return res.status(400).json({ status: false, message: 'No provider Selected' });
        if (!product || (product == '')) return res.status(400).json({ status: false, message: 'No product selected' });
        // if (!prdid || (prdid == '')) return res.status(400).json({ status: false, message: 'Invalid product passed' });
        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });


        // const ntwk = network.toLowerCase();
        const ntwk = network;
        const userinfo = await getUserInfo(userid);  // get user info
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const userphoneno = userinfo.phoneno;
        const sendername = userinfo.lastname + ' ' + userinfo.firstname;
        const useremail = userinfo.email;
        const authpin = userinfo.authpin;
        const histier = userinfo.accounttier;

        if (!authpin)
            return res.status(400).json({ status: false, message: 'Kindly setup your transaction PIN in order to proceed' });

        if (!histier)
            return res.status(400).json({ status: false, message: 'Kindly complete your account KYC in order to proceed' });

        var productid = packageid;
        var productCodeForExternalCall = packageid;
        const datatype = metadata?.metertype;
        const dataplan = metadata?.dataplan;
        const custname = metadata?.custname ? metadata?.custname : sendername;
        const address = metadata?.address;
        const paydesc = metadata?.narration;
        let pay_desc_initial = metadata?.narration;

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Incorrect Transaction PIN' });

        /* format */
        const theProduct = product.toLowerCase();
        if (prdid) {
            var checkFee = await Product.findOne({ where: { id: prdid, category: product, status: 1 } })
        } else {

            var checkFee = await Product.findOne({ where: { [Op.and]: [{ category: theProduct }, { status: 1 }, { [Op.or]: [{ prdname: network }, { ntwk: { [Op.like]: `%${network}%` } }] }] } });
        }

        if (!checkFee)
            return res.status(400).json({ status: false, message: 'Selected product is currently not available' });

        // --- START: Profit Calculation Logic ---
        const { totalChargedToCustomer, ourFee, profit, providerFeeActual, ProviderComm } = calculateProfitAndFee(checkFee, parseFloat(amount));

        let topay = totalChargedToCustomer;
        let amountval = parseFloat(amount); //The actual value of the service being purchased
        var calculatedProfit = profit;
        let couponDiscount = 0;
        if (theProduct == 'airtime' && ourFee < 0) {
            var dfee = 0;
        } else {
            var dfee = ourFee; //The fee we charge the customer (can be negative for discount)
        }
        let actualProviderFee = providerFeeActual; //The actual amount of provider's fee/commission
        let providerAmount = parseFloat(amount);

        // --- Logic to prevent double-discounting ---
        // If a coupon is being used and a product discount was already applied (ourFee is negative),
        // reset topay to the original amount to nullify the product discount before applying the coupon.
        if (bonustype === 'coupon' && bonusid && ourFee < 0) {
            topay -= ourFee; // Add back the discount to reset to the base amount
            calculatedProfit -= ourFee; // The coupon discount reduces our profit
        }

        const txref = 'HTCH' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12);
        let timed = Date.parse(new Date()) / 1000;


        /* TOTAL TRANS TODAY */
        const accountLimit = await TransLimit(histier);
        var dailytrans = accountLimit[3]; // total daily transaction 

        const transToday = await OutflowToday(userid);
        const totalToday = parseFloat(transToday) + topay;

        if (parseFloat(totalToday) > parseFloat(dailytrans))
            return res.status(400).json({ status: false, message: `This transaction will cause you to go beyond your account daily transaction limit of NGN${formatAmount(dailytrans)}` });

        if (amount < 0)
            return res.status(400).json({ status: false, message: 'Invalid product amount' });

        if (amount < 50 && theProduct == 'airtime')
            return res.status(400).json({ status: false, message: 'You cannot buy below N50.00' });

        if ((theProduct == 'airtime' || theProduct == 'databundle') && ((recipientno.length > 11) || (recipientno.length < 11)))
            return res.status(400).json({ status: false, message: 'Phone number cannot be less than 11 digits nor greater than 11 digits' });

        if ((theProduct == 'cable tv' || theProduct == 'electricity') && (recipientno.length < 10))
            return res.status(400).json({ status: false, message: 'Account number cannot be less than 10 digits' });

        if (userinfo.status != '1')
            return res.status(400).json({ status: false, message: 'Your account is not active. Kindly verify your account' });

        if (userinfo.status == '3')
            return res.status(400).json({ status: false, message: 'Your account is currently on hold. Kindly contact our support' });

        if (theProduct == 'airtime' && amount > 20000)
            return res.status(400).json({ status: false, message: 'You cannot buy over N20,000 airtime' });

        if (theProduct == 'electricity' && amount < 2000)
            return res.status(400).json({ status: false, message: 'Electricity vend amount cannot be less than your minimum vend amount N2,000' });

        if (topay <= 0)
            return res.status(400).json({ status: false, message: 'Invalid charged amount detected, kindly reload and retry' });

        const userbal = await getBal(userid, 'NGN');

        if (userbal > 0 && userbal >= topay) {
            pay_desc_initial = ucFirst(theProduct == 'databundle' ? `${dataplan} Databundle` : `${theProduct == 'others' ? ntwk : theProduct} payment to ${recipientno}`);

            let modifyprd = theProduct == 'others' ? 'Other Billers' : theProduct;
            const env = (envroute === 'web') ? 'web' : 'app';

            // --- Stage 1: Debit User and Log Initial Transaction ---
            let initialLog;
            const debitTransaction = await db.sequelize.transaction();

            try {
                // --- Apply Coupon Discount if provided ---
                if (bonustype === 'coupon' && bonusid) {
                    const couponResult = await applyCouponDiscount(userid, bonusid, amountval, theProduct, { transaction: debitTransaction });

                    if (couponResult.discount > 0) {
                        couponDiscount = couponResult.discount;
                        topay -= couponDiscount; // Reduce the amount the user has to pay
                        calculatedProfit -= couponDiscount; // The coupon discount reduces our profit
                        pay_desc_initial += ` with Coupon`;
                    } else {
                        // If coupon is invalid, roll back and inform the user.
                        await debitTransaction.rollback();
                        return res.status(400).json({ status: false, message: couponResult.message || 'Invalid coupon.' });
                    }
                }

                //===========CHARGE THE CUSTOMER AND LOG TRANSACTION===//
                const newbalFromUpdate = await updateBalance(userid, topay, 'NGN', 'debit', { transaction: debitTransaction });

                initialLog = await Payn.create({
                    userid: userid, amount: topay, amountval: amountval, newbal: newbalFromUpdate, prevbal: userbal,
                    txref: txref, pfor: modifyprd, usertype: 'user', paytype: 'debit', productid: productCodeForExternalCall, ntwk: ntwk, paidthru: 'Wallet', pay_desc: pay_desc_initial, timed: timed, status: 0, recipient: recipientno, fee: dfee, payroute: env, currency: 'NGN', revenue: calculatedProfit, providerfee: actualProviderFee
                }, { transaction: debitTransaction });

                await debitTransaction.commit();

            } catch (error) {
                // rollback the transaction.
                await debitTransaction.rollback();

                console.error(`Debit failed for ${txref}:`, debitError.message);
                return res.status(400).json({ status: false, message: 'Failed to debit account. Please try again.' });
            }


            /* STAGE 2 Call Extrnal Provider API */
            let externalApiResponse;

            try {

                if (theProduct == 'airtime') {
                    externalApiResponse = await buyAirtime(ntwk, recipientno, amount, txref);

                } else if (theProduct == 'databundle' || product == 'databundle') {
                    externalApiResponse = await buyData(recipientno, providerAmount, txref, productCodeForExternalCall);
                } else if (theProduct == 'cable tv') {
                    externalApiResponse = await buyCable(recipientno, amountval, txref, productCodeForExternalCall, custname);
                } else if (theProduct == 'electricity' || product == 'Electricity') {
                    const vendtype = ucFirst(packageslug.toLowerCase());
                    externalApiResponse = await vendElect(recipientno, amountval, txref, vendtype, custname, userphoneno);
                } else if (theProduct == 'betting') {
                    const vendtype = ucFirst(packageslug.toLowerCase());
                    externalApiResponse = await payBetting(vendtype, recipientno, amountval, txref, custname);

                } else if (theProduct == 'education' || theProduct == 'others') {
                    const vendtype = ucFirst(packageslug.toLowerCase());
                    externalApiResponse = await payOtherBiller(vendtype, recipientno, amountval, txref, custname);
                } else {
                    return res.status(400).json({ status: false, message: 'Invalid product name passed' })
                }

            } catch (apiError) {
                externalApiResponse = apiError.response ? apiError.response.data : {
                    status: 'error', responseCode: '099',  //penidn
                    message: apiError.message || 'Failed to connect to provider', responseData: null
                };

                logger.error(`External API call failed for ${txref} (immediately caught):`, { txref, error: externalApiResponse });
            }

            // --- Stage 3: Process External API Response and Finalize Transaction ---
            const finalizeTransaction = await db.sequelize.transaction();

            try {
                const jsonString = JSON.stringify(externalApiResponse);
                let meta_data_final = {};
                let vendtoken = '';
                let vendunit = '';
                let receiptmeta_email = '';
                let convenienceFee = '';

                if (externalApiResponse.responseCode == '00') {
                    const details = externalApiResponse.responseData;
                    convenienceFee = parseFloat(details.convenienceFee) || 0;

                    /* if(theProduct != 'airtime'){
                        profit = dfee - convenienceFee;
                    }else{
                        convenienceFee = providerAmount;
                    } */

                    if (theProduct == 'electricity' || theProduct == 'education') {
                        const tokenData = details['tokenData'] && details['tokenData']['stdToken'] ? details['tokenData']['stdToken'] : {};
                        vendtoken = tokenData['value'] || '';
                        vendunit = tokenData['units'] || '';
                        const receiptNumber = tokenData['receiptNumber'] || '';
                        meta_data_final = { productid: productCodeForExternalCall, dataplan, custname, address, token: vendtoken, unit: vendunit, metertype: datatype, receiptNumber, providercomm: ProviderComm };
                        receiptmeta_email = `
                            <tr><td><p>Customer Name</p></td><td><p>${custname}</p></td></tr>
                            <tr><td><p>Address</p></td><td><p>${address || 'N/A'}</p></td></tr>
                            <tr><td><p>Token/PIN</p></td><td><p>${vendtoken}</p></td></tr>
                            <tr><td><p>Unit</p></td><td><p>${vendunit}</p></td></tr>`;
                    } else if (theProduct === 'airtime') {
                        meta_data_final = { productid: productCodeForExternalCall, dataplan, custname, metertype: datatype, providercomm: ProviderComm };
                        receiptmeta_email = `<tr><td><p>Cashback</p></td><td><p>N${formatAmount(Math.abs(dfee))}</p></td></tr>`;
                    } else {
                        meta_data_final = { productid: productCodeForExternalCall, dataplan, custname, address, metertype: datatype, providercomm: ProviderComm };
                        if (theProduct == 'electricity' || theProduct == 'education') {
                            receiptmeta_email = `<tr><td><p>Customer Name</p></td><td><p>${custname}</p></td></tr>`;
                        }
                    }

                    await Payn.update(
                        { status: 1, productid: details.transactionId, provref: details.transactionId, jsonresp: jsonString, meta: JSON.stringify(meta_data_final), revenue: calculatedProfit, providerfee: actualProviderFee },
                        { where: { txref: txref, userid: userid }, transaction: finalizeTransaction }
                    );

                    await finalizeTransaction.commit();

                    const emailReceipt = `
                            <p style="line-height: 20px; letter-spacing: 0.025em;">
                                Hello ${fname}<span style="font-size: 18px;">😍</span></p>
                                <p style="line-height: 28px; letter-spacing: 0.025em;">
                                Your ${modifyprd} transaction with reference - ${txref} was successful.
                            </p>
                            <h3>Transaction Details</h3>
                            <table style="width: 100%; color: #54424d; font-size: 15px; font-weight: 500;" class="cke_show_border" cellspacing="1" cellpadding="1" border="0">
                                <tbody class="transbody">
                                    <tr><td><p>Amount</p></td><td><p>N${formatAmount(amountval)}</p></td></tr>
                                    <tr><td><p>Product</p></td><td><p>${ucFirst(modifyprd)}</p></td></tr>
                                    <tr><td><p>Fee</p></td><td><p>N${formatAmount(dfee)}</p></td></tr>
                                    <tr><td><p>Recipient Number</p></td><td><p>${recipientno}</p></td></tr>
                                    <tr><td><p>Provider/Network</p></td><td><p>${network}</p></td></tr>
                                    <tr><td><p>Description</p></td><td><p>${pay_desc_initial}</p></td></tr>
                                    <tr><td><p>Transaction Reference</p></td><td width="50%"><p>${txref}</p></td></tr>
                                    <tr><td><p>Transaction Date</p></td><td width="50%"><p>${moment.unix(timed).format("Do MMM, YYYY hh:mm a")}</p></td></tr>
                                    ${receiptmeta_email}
                                </tbody>
                            </table>`;

                    mailSender(fname, 'Transaction Receipt', useremail, emailReceipt);
                    pushNotify(userid, 'Transaction Notice - HitchPay', `Your N${formatAmount(amountval)} ${modifyprd} purchase was successful.`);

                    res.json({
                        status: true, message: 'Transaction Successfully Processed',
                        data: {
                            amount: amountval, amountcharged: topay, fee: dfee, product: modifyprd, provider: network,
                            reference: txref, vendunit, vendtoken, walbal: await getBal(userid, 'NGN'), // Fetch fresh balance
                            paystatus: 'Successful', transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a")
                        }
                    });


                    const rewardTransaction = await db.sequelize.transaction();
                    try {
                        /* CHECK FOR REFERRAL & DAILY BONUS */
                        await logReferEarn(userid, txref, { transaction: rewardTransaction });
                        // await dailyBonus(userid, txref, { transaction: rewardTransaction });

                        // Apply Welcome/Daily Task Bonus if applicable
                        if (bonusid && (bonustype === 'welcome' || bonustype === 'daily_task')) {
                            const rewardReseult = await applyTaskBonus(userid, bonusid, amountval, ntwk, txref, product, { transaction: rewardTransaction });
                            console.log('rewardReseult', rewardReseult)
                        }

                        await rewardTransaction.commit();

                    } catch (bonusError) {
                        // Log the bonus error for debugging/review, but don't fail the user's request.
                        console.error(`[BonusApplication] Failed to apply bonus for txref ${txref}. Error: ${bonusError.message}`);
                        await rewardTransaction.rollback();
                    }

                } else if (externalApiResponse.responseCode == '06') {
                    // External API call failed or was not successful
                    await finalizeTransaction.rollback();

                    logger.warn(`External API call unsuccessful for ${txref}: ${externalApiResponse.message}. Initiating refund.`);

                    await Payn.update(
                        // Mark original as failed
                        { status: 5, jsonresp: jsonString, productid: externalApiResponse.responseData?.transactionId || '' },
                        { where: { txref: txref, userid: userid } }
                    );


                    const refundTransaction = await db.sequelize.transaction();

                    try {
                        // Use existing userbal from before debit
                        const currentBalanceBeforeRefund = await getBal(userid, 'NGN', { transaction: refundTransaction });

                        const newBalanceAfterRefund = await updateBalance(userid, topay, 'NGN', 'credit', { transaction: refundTransaction });

                        const refundTxRef = `REF_${txref}`;
                        await Payn.create({
                            userid: userid, amount: topay, amountval: topay, newbal: newBalanceAfterRefund, prevbal: currentBalanceBeforeRefund,
                            txref: refundTxRef, pfor: 'REFUND', usertype: 'user', paytype: 'credit', productid: txref,
                            ntwk: network, paidthru: 'System Refund', pay_desc: `Refund for failed transaction ${txref}`,
                            timed: Math.floor(Date.now() / 1000), status: 1, recipient: recipientno, fee: 0,
                            payroute: env, currency: 'NGN', revenue: 0, providerfee: 0
                        }, { transaction: refundTransaction }
                        );

                        await refundTransaction.commit();


                        // console.log(`Refund successful for ${txref}.`);

                        mailSender(fname, 'Transaction Failed & Refunded', useremail, `Your transaction ${txref} for ${modifyprd} failed and N${formatAmount(topay)} has been refunded to your wallet.`);

                        pushNotify(userid, 'Transaction Failed - HitchPay', `Your ${modifyprd} transaction ${txref} failed and has been refunded.`);

                    } catch (refundError) {
                        await refundTransaction.rollback();

                        console.error(`CRITICAL: Refund failed for ${txref} after external API failure. User has been debited. Manual intervention required. Error: ${refundError.message}`);
                        logger.error(`CRITICAL: Refund failed for ${txref} after external API failure. Manual intervention required.`, { txref, error: refundError });
                        mailSender(fname, 'Transaction Failed - Refund Pending', useremail, `Your transaction ${txref} for ${modifyprd} failed. We are processing your refund. Please contact support if not resolved soon.`);

                        pushNotify(userid, 'Transaction Failed - HitchPay', `Your ${modifyprd} transaction ${txref} failed. Refund is being processed.`);

                    }

                    res.status(400).json({ status: false, message: externalApiResponse.message || 'Transaction failed with provider.' });

                } else {
                    // External API call failed or was not successful
                    await finalizeTransaction.rollback();

                    logger.warn(`External API call unsuccessful for ${txref}: ${externalApiResponse.message}. Transaction held for TSQ.`);

                    await Payn.update(
                        { jsonresp: jsonString, productid: externalApiResponse.responseData?.transactionId || '' },
                        { where: { txref: txref, userid: userid } }
                    );

                    res.status(400).json({ status: false, message: externalApiResponse.message || 'Transaction failed with provider.' });
                }

            } catch (finalizationError) {
                // await finalizeTransaction.rollback();

                logger.error(`Error during finalization for ${txref}:`, finalizationError);

                res.status(400).json({ status: false, message: 'Transaction processing encountered an issue. Please check your history or contact support.' });

            }

        } else {
            return res.status(400).json({
                status: false,
                message: `Your balance is too low for this NGN ${formatAmount(amountval)} transaction. Please top up to proceed`
            })
        }

    } catch (error) {
        console.log("Error product paynt (outer): ", error.message);
        logger.error("Error in processPaymentNew (outer catch):", error);
        return res.status(500).json({ status: false, message: 'An unexpected error occurred.' });
    }
}


const buyAirtime = async (ntwk, recipientno, amount, txref) => {

    const getsett = await AppSett.findOne({ where: { id: 1 } });
    const BillProvider = getsett.billprovider;

    if (BillProvider == 'vtpass') {
        let data = JSON.stringify({
            "reference": txref,
            "customerId": recipientno,
            "packed": `${ntwk.toUpperCase()}_VTU`,
            "amount": amount,
            "customerName": "Airtime Purchase",
            "phoneNumber": recipientno,
            "email": "",
            "accountNumber": recipientno
        });

        /* ======================logreuest start ============================== */
        let timed = Date.parse(new Date()) / 1000;
        try {
            await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'airtime', provider: 'coralpay' });
        } catch (logError) {
            console.error("Failed to log request for buyAirtime:", logError.message);
        }

        /* ======================logreuest end ============================== */
        // call the vtpass airtime purchasde api
        var config = {
            method: 'post',
            url: `${process.env.VTPASS_URL}/airtime/buy`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${process.env.VTPASS_APIKEY}`
            },
            data: data  //payload
        };


    } else {
        let data = JSON.stringify({
            "paymentReference": txref,
            "customerId": recipientno,
            "packageSlug": `${ntwk.toUpperCase()}_VTU`,
            "channel": "WEB",
            "amount": amount,
            "customerName": "Airtime Purchase",
            "phoneNumber": recipientno,
            "email": "",
            "accountNumber": recipientno
        });

        /* ======================logreuest start ============================== */
        let timed = Date.parse(new Date()) / 1000;
        try {
            await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'airtime', provider: 'coralpay' });
        } catch (logError) {
            console.error("Failed to log request for buyAirtime:", logError.message);
        }
        /* ======================logreuest end ============================== */
        //call coralpay
        var config = {
            method: 'post',
            url: `${process.env.CORAL_URL}/transactions/process-payment`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
            data: data
        };

    }

    try {
        let response = await axiosApiClient.request(config);
        return response.data;
    } catch (error) {
        logger.error(`CoralPay API Error for buyAirtime (txref: ${txref}):`, { error: error.message, response: error.response?.data });

        // Construct a consistent error response structure
        return {
            status: 'error', // or 'failed'
            responseCode: error.response ? error.response.status : 'NETWORK_ERROR', // Or a custom code
            message: error.response ? (error.response.data.message || error.message) : 'Network error or timeout with provider',
            responseData: null
        };
    }
}

const buyData = async (recipientno, amount, txref, productid) => {
    const getsett = await AppSett.findOne({ where: { id: 1 } });
    const BillProvider = getsett.billprovider;

    if (BillProvider == 'vtpass') {
        //call vtapss endpit

    } else {

        let data = JSON.stringify({
            "paymentReference": txref, "customerId": recipientno, "packageId": productid,
            "channel": "WEB", "amount": amount, "customerName": "Databundle",
            "phoneNumber": recipientno, "email": "", "accountNumber": ""
        });

        /* ======================logreuest start ============================== */
        let timed = Date.parse(new Date()) / 1000;
        try {
            await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'databundle', provider: 'coralpay' });
        } catch (logError) {
            console.error("Failed to log request for buyData:", logError.message);
        }
        /* ======================logreuest end ============================== */
        // console.log(data)

        var config = {
            method: 'post',
            url: `${process.env.CORAL_URL}/transactions/process-payment`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
            data: data
        };

    }

    try {
        let response = await axios.request(config);
        return response.data;
    } catch (error) {
        logger.error(`CoralPay API Error for buyData (txref: ${txref}):`, { error: error.message, response: error.response?.data });
        return {
            status: 'error',
            responseCode: error.response ? error.response.status : 'NETWORK_ERROR',
            message: error.response ? (error.response.data.message || error.message) : 'Network error or timeout with provider',
            responseData: null
        };
    }
}

const buyCable = async (recipientno, amount, txref, productid, custname) => {

    let data = JSON.stringify({
        "paymentReference": txref, "customerId": recipientno,
        "packageId": productid, "channel": "WEB", "amount": amount,
        "customerName": custname,
        "phoneNumber": recipientno, "email": "", "accountNumber": ""
    });

    /* ======================logreuest start ============================== */
    let timed = Date.parse(new Date()) / 1000;
    try {
        await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'cabletv', provider: 'coralpay' });
    } catch (logError) {
        console.error("Failed to log request for buyCable:", logError.message);
    }
    /* ======================logreuest end ============================== */

    let config = {
        method: 'post',
        url: `${process.env.CORAL_URL}/transactions/process-payment`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${process.env.CORAL_AUTH}`
        },
        data: data
    };

    try {
        let response = await axios.request(config);
        return response.data;
    } catch (error) {
        logger.error(`CoralPay API Error for buyCable (txref: ${txref}):`, { error: error.message, response: error.response?.data });
        return {
            status: 'error',
            responseCode: error.response ? error.response.status : 'NETWORK_ERROR',
            message: error.response ? (error.response.data.message || error.message) : 'Network error or timeout with provider',
            responseData: null
        };
    }

}

const vendElect = async (recipientno, amount, txref, vendtype, custname, userphoneno) => {

    // get provider from appsetting


    var pakcgslug = vendtype.toUpperCase();
    let data = JSON.stringify({
        "paymentReference": txref, "customerId": recipientno,
        "packageSlug": pakcgslug, "channel": "WEB", "amount": amount,
        "customerName": custname,
        "phoneNumber": userphoneno, "email": "", "accountNumber": recipientno
    });

    /* ======================logreuest start ============================== */
    let timed = Date.parse(new Date()) / 1000;
    try {
        await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'electricity', provider: 'coralpay' });
    } catch (logError) {
        console.error("Failed to log request for vendElect:", logError.message);
    }
    /* ======================logreuest end ============================== */


    let config = {
        method: 'post',
        url: `${process.env.CORAL_URL}/transactions/process-payment`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${process.env.CORAL_AUTH}`
        },
        data: data
    };

    try {
        let response = await axios.request(config);
        return response.data;
    } catch (error) {
        logger.error(`CoralPay API Error for vendElect (txref: ${txref}):`, { error: error.message, response: error.response?.data });
        return {
            status: 'error',
            responseCode: error.response ? error.response.status : 'NETWORK_ERROR',
            message: error.response ? (error.response.data.message || error.message) : 'Network error or timeout with provider',
            responseData: null
        };
    }
}

const payBetting = async (packageslug, recipientno, amount, txref, custname) => {

    let data = JSON.stringify({
        "paymentReference": txref, "customerId": recipientno,
        "packageSlug": packageslug, "channel": "WEB", "amount": amount,
        "customerName": custname,
        "phoneNumber": recipientno, "email": "", "accountNumber": recipientno
    });

    /* ======================logreuest start ============================== */
    let timed = Date.parse(new Date()) / 1000;
    try {
        await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'betting', provider: 'coralpay' });
    } catch (logError) {
        console.error("Failed to log request for payBetting:", logError.message);
    }
    /* ======================logreuest end ============================== */

    let config = {
        method: 'post',
        url: `${process.env.CORAL_URL}/transactions/process-payment`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${process.env.CORAL_AUTH}`
        },
        data: data
    };

    try {
        let response = await axios.request(config);
        return response.data;
    } catch (error) {
        logger.error(`CoralPay API Error for payBetting (txref: ${txref}):`, { error: error.message, response: error.response?.data });
        return {
            status: 'error',
            responseCode: error.response ? error.response.status : 'NETWORK_ERROR',
            message: error.response ? (error.response.data.message || error.message) : 'Network error or timeout with provider',
            responseData: null
        };
    }
}

const payOtherBiller = async (packageslug, recipientno, amount, txref, custname) => {
    let data = JSON.stringify({
        "paymentReference": txref, "customerId": recipientno,
        "packageSlug": packageslug, "channel": "WEB", "amount": amount,
        "customerName": custname,
        "phoneNumber": recipientno, "email": "", "accountNumber": recipientno
    });

    /* ======================logreuest start ============================== */
    let timed = Date.parse(new Date()) / 1000;
    try {
        await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'otherbiller', provider: 'coralpay' });
    } catch (logError) {
        console.error("Failed to log request for payOtherBiller:", logError.message);
    }
    /* ======================logreuest end ============================== */

    let config = {
        method: 'post',
        url: `${process.env.CORAL_URL}/transactions/process-payment`,
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Basic ${process.env.CORAL_AUTH}`
        },
        data: data
    };

    try {
        let response = await axios.request(config);
        return response.data;
    } catch (error) {
        logger.error(`Coral API Error for payOtherBiller (txref: ${txref}):`, { error: error.message, response: error.response?.data });
        return {
            status: 'error',
            responseCode: error.response ? error.response.status : 'NETWORK_ERROR',
            message: error.response ? (error.response.data.message || error.message) : 'Network error or timeout with provider',
            responseData: null
        };
    }
}

const transferPayment = async (req, res) => {
    const userid = req.user.id;
    let { amount, recipientno, bankname, bankcode, accountname, isbeneficiary, narration, enquirytoken, transpin, envroute, currency, accounttype, paymenttype, paywith, authtoken } = cleanMe(req.body);

    // console.log('transferbod', req.body)

    if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter amount' });
    if (parseFloat(amount) <= 0) return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
    if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Kindly enter your transaction PIN' });
    if (!recipientno || (recipientno == '')) return res.status(400).json({ status: false, message: 'Kindly enter recipient phone number' });
    if (!bankname || (bankname == '')) return res.status(400).json({ status: false, message: 'No provider Selected' });
    if (!currency) { currency = 'NGN' }; // Ensure currency has a default value if it's null or undefined
    if (!paymenttype) { paymenttype = 'wallet' };

    if (paymenttype === 'linked_account') {
        //validate 2fa token
        const [isTokenValid, tokenMessage] = await checkTransAuth(userid, authtoken);
        if (!isTokenValid) {
            return res.status(400).json({ status: false, message: tokenMessage });
        }
    }

    const txref = 'HTCH' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12);
    let timed = Date.parse(new Date()) / 1000;
    let topay; let prdamnt; let revenue = 0; let providerfee = 0; let vatFee = 0; let theFeetype = '';
    let pay_desc_transfer = narration || `Transfer to ${accountname || recipientno}`;

    let topay_with_stampduty = 0;
    var StampdutyFee = process.env.STAMPDUTY_CHARGE ? process.env.STAMPDUTY_CHARGE : 50;
    var Stampduty_Fee_Max = !process.env.STAMPDUTY_MAX ? parseFloat(10000) : process.env.STAMPDUTY_MAX;  //amount to apply the emtl on


    try {
        const userinfo = await getUserInfo(userid);
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const sourcephone = userinfo.phoneno;
        const sendername = `${userinfo.lastname} ${userinfo.firstname}`;
        const useremail = userinfo.email;
        const authpin = userinfo.authpin;
        const bvverify = userinfo.bvverify;
        const histier = userinfo.accounttier;

        if (!authpin) return res.status(400).json({ status: false, message: 'Kindly setup your transaction PIN to proceed.' });
        if (!bcrypt.compareSync(transpin, authpin)) return res.status(400).json({ status: false, message: 'Invalid Transaction PIN.' });

        if (bvverify != 2) return res.status(400).json({ status: false, message: 'Kindly complete your tier 1 verification to proceed.' });
        if (!histier) return res.status(400).json({ status: false, message: 'Kindly complete your account KYC to proceed.' });

        // if paymenttype is linked_account, linked_card only allow countrycode US
        if (paymenttype === 'linked_account' || paymenttype === 'linked_card') {
            if (userinfo.countrycode !== 'US') {
                return res.status(400).json({ status: false, message: 'Linked accounts and cards only supported for US customers.' });
            }

            //if payment type is linked account or caard, call the
            currency = 'USD';
            var baseurrency = 'USD';
        }

        // GET LIMIT
        const accountLimit = await TransLimit(histier);
        const transferlimit = accountLimit[2];
        const dailytrans = accountLimit[3];
        const free_transfer_allowance = accountLimit[4];

        if (parseFloat(amount) > parseFloat(transferlimit)) {
            return res.status(400).json({ status: false, message: `You cannot transfer above your account transfer limit of ${currency}${formatAmount(transferlimit)}.` });
        }

        const transToday = await OutflowToday(userid);
        if ((parseFloat(transToday) + parseFloat(amount)) > parseFloat(dailytrans)) {
            return res.status(400).json({ status: false, message: `This transaction exceeds your daily limit of ${currency}${formatAmount(dailytrans)}.` });
        }

        const checkFeeProduct = await Product.findOne({ where: { category: 'transfer', status: 1 } });
        if (!checkFeeProduct) return res.status(400).json({ status: false, message: 'Transfer service is currently unavailable.' });

        if (bankcode.toLowerCase() === 'hitchpay') {
            prdamnt = 0;
            theFeetype = '';
            vatFee = 0;
        } else {
            const freetransfer_used_count = await FreeTransfersCount(userid);

            const [feeAmount, prvFee, feetype, vatCharge] = await getFee('transfer', amount);
            providerfee = parseFloat(prvFee) || 0;
            vatFee = parseFloat(vatCharge) || 0;
            theFeetype = feetype;

            if (parseInt(freetransfer_used_count) >= parseInt(free_transfer_allowance)) {
                prdamnt = parseFloat(feeAmount) || 0;
                revenue = prdamnt - providerfee;
            } else {
                prdamnt = 0;
                revenue = prdamnt - providerfee;
            }
        }


        if (parseFloat(amount) < 50 && currency == 'NGN') return res.status(400).json({ status: false, message: 'You cannot transfer below N50.00.' });

        if (parseFloat(amount) < 1 && currency != 'NGN') return res.status(400).json({ status: false, message: `You cannot transfer below ${currency}1.00` });

        if (userinfo.status != '1') return res.status(400).json({ status: false, message: 'Your account is not active.' });
        if (userinfo.status == '3') return res.status(400).json({ status: false, message: 'Your account is on hold.' });


        if (paymenttype === 'linked_account' || paymenttype === 'linked_card') {
            //PAYMNT TYPE IS LINKED BANK OR CARD

            let fee = 0;
            const getRateData = await fetchExchangeRate('USD', 'NGN');
            if (!getRateData.status) {
                return res.status(400).json({ status: false, message: getRateData.message || 'Unable to get exchange rate. Kindly retry' });
            }

            const exchangeRate = getRateData.data.rate;
            // console.log('exchn', exchangeRate)

            const getsett = await AppSett.findOne({ where: { id: 1 } });
            // GET EACH PAYMENT FEE
            if (paymenttype === 'linked_account') {
                fee = getsett.remittance_bank ? parseFloat(getsett.remittance_bank) : 0; //feepercent
            } else if (paymenttype === 'linked_card') {
                fee = getsett.remittance_card ? parseFloat(getsett.remittance_card) : 0; //feepercent
            } else {
                fee = getsett.crosstransfer ? parseFloat(getsett.crosstransfer) : 0; //feepercent
            }

            // CALLCULATE THE FEES
            const ourfee = (parseFloat(fee) * amount) / 100; //fee percentage
            const dfee = parseFloat(ourfee.toFixed(2)); //our fee
            const tocharge = parseFloat(amount) + dfee; //total to debit from user wallet
            const totalFee = tocharge - parseFloat(amount);

            const topay = (parseFloat(tocharge) * parseFloat(exchangeRate)).toFixed(2);  //to pay with destinaton currency
            const feeconvert = (parseFloat(dfee) * parseFloat(exchangeRate)).toFixed(2);  //fee to pay with destination currency
            const totalAmount = (topay - feeconvert).toFixed(2); //main transaction amount in destination currency

            var countrycode = 'NG'; const localamount = amount
            let pay_desc_initial = `Transfer of USD${amount}(NGN${totalAmount}) to ${accountname} - (${recipientno}) in ${countrycode}`;
            const modifyprd = 'globaltransfer';
            const timed = Math.floor(Date.now() / 1000);
            const ntwk = countrycode;

            // const recipientno = recipientno;

            //calculate profit
            const providerfeepercent = getsett.providerfee ? parseFloat(getsett.providerfee) : 0;
            const actualProviderFee = (providerfeepercent * localamount) / 100;
            const calculatedProfit = dfee - actualProviderFee; // This might need review based on which baseurrency the fee is in
            const env = process.env.APPENV == 'production' ? 'live' : 'test';

            const metapayload = {
                accountname: accountname,
                accounttype: accounttype,
                bankcode: bankcode,
                bankname: bankname,
                enquirytoken: enquirytoken,
                recipientno: recipientno,
                amount: totalAmount,
                narration: narration,
                currency: 'NGN'
            }


            if (paymenttype === 'linked_card') {
                pay_desc_initial = `Debit Purchase`
            }


            // Log the deposit initiation
            initialPayLog = await Payn.create({
                userid: userid, amount: tocharge, amountval: amount, newbal: 0, prevbal: 0,
                txref: txref, pfor: modifyprd, usertype: 'user', paytype: 'debit', productid: exchangeRate, ntwk: ntwk,
                paidthru: 'Linked Account', pay_desc: pay_desc_initial, timed: timed, status: 0, recipient: recipientno, fee: totalFee, payroute: env, currency: baseurrency, revenue: totalFee, providerfee: actualProviderFee, meta: JSON.stringify(metapayload),
            });

            if (!initialPayLog) {
                return res.status(500).json({ status: false, message: 'Failed to initiate transaction.' });
            }

            /* PROCESS EACH ROUTE */
            if (paymenttype === 'linked_account') {
                const InitDeposit = await doCybridBankDeposit(tocharge, paywith, userid, amount, txref); //charge the amount from the customer bank account

                if (!InitDeposit[0]) {
                    return res.status(500).json({ status: false, message: InitDeposit[1] || 'Failed to initiate deposit to the account.' });
                }

                // successful
                const depositData = InitDeposit[2];
                const depositId = depositData.transfer_guid;
                const customerGuid = depositData.customerGuid;
                const bankGuid = depositData.bankGuid;
                const depositState = depositData.transfer_state;
                const estimatedAmount = depositData.estimated_amount / 100;
                const paymentRail = depositData.payment_rail;
                const holdDuration = depositData.hold_duration;
                const holdStarted_at = depositData.hold_started_at;
                const hold_applicable_types = depositData.hold_applicable_types;

                const thepayload = {
                    amount, recipientno, bankname, bankcode, accountname, isbeneficiary, narration, enquirytoken, envroute, currency, accounttype, paymenttype, paywith, deposit_id: depositId, customer_id: customerGuid, bank_guid: bankGuid
                }

                await Payn.update({
                    provref: depositId, status: 0, paychannel: 'YC',
                    jsonresp: JSON.stringify(depositData),
                    meta: JSON.stringify(thepayload),
                }, { where: { id: initialPayLog.id, txref: txref } });

                return res.status(200).json({
                    status: true,
                    message: 'Transfer successfully initiated. Payment processing..',
                    data: {
                        reference: txref, paymentid: depositId, sessionid: depositId, amount: localamount, amountcharged: topay,
                        paystatus: 'Processing', fee: dfee, currency: baseurrency, rate: exchangeRate, attempt: 1, prevbal: 0,
                        newbal: 0, customerGuid: customerGuid, bankGuid: bankGuid, depositState: depositState, estimatedAmount: estimatedAmount, paymentRail: paymentRail, holdDuration: holdDuration, holdStarted_at: holdStarted_at,
                        hold_applicable_types: hold_applicable_types, transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a")
                    }
                });

            } else if (paymenttype === 'linked_card') {
                const paymentIntent = await createPaymentIntent(userid, paywith, amount, tocharge, txref); // create a payment intent

                if (paymentIntent && paymentIntent[0] && paymentIntent[3]) {
                    const intentData = paymentIntent[2];
                    var paymentStatus = intentData.pay_status == 'succeeded' ? 1 : 0;

                    // update record
                    await Payn.update({ provref: intentData.payintent_id }, { where: { id: initialPayLog.id, txref: txref } });

                    return res.status(200).json({
                        status: false,
                        message: 'Payment requires confirmation.',
                        data: {
                            reference: txref, paymentid: intentData.payintent_id, bankGuid: intentData.clientSecret,
                            paymentRail: intentData.clientSecret, require_auth: paymentIntent[3]
                        }
                    });

                } else if (paymentIntent && paymentIntent[0]) {

                    // PROCEED, IT REQUIRE NO FURTHER AUTHENTICATION

                    const intentData = paymentIntent[2];
                    const paymentIntentId = intentData.payintent_id;
                    const paymentIntentStatus = intentData.pay_status;
                    const paymentIntentClientSecret = intentData.clientSecret;
                    const payment_method = intentData.payment_method;
                    const application_fee_amount = intentData.application_fee_amount;
                    const customerid = intentData.customerid;

                    var paymentStatus = paymentIntentStatus == 'succeeded' ? 1 : 0;

                    await Payn.update({
                        provref: paymentIntentId, status: paymentStatus, paychannel: 'YC',
                        jsonresp: JSON.stringify(intentData)
                    }, { where: { id: initialPayLog.id, txref: txref } });

                    return res.status(200).json({
                        status: true,
                        message: 'Payment successfully initiated. Payment processing...',
                        data: {
                            reference: txref, paymentid: paymentIntentId, amount: localamount, currency: baseurrency, rate: exchangeRate,
                            attempt: 1, prevbal: 0, newbal: 0, customerGuid: customerid, bankGuid: paymentIntentClientSecret,
                            depositState: paymentIntentStatus, estimatedAmount: 0, paymentRail: paymentIntentClientSecret, holdDuration: '',
                            holdStarted_at: '', hold_applicable_types: '', require_auth: paymentIntent[3]
                        }
                    });


                } else {
                    return res.status(400).json({ status: false, message: 'Failed to initiate payment.' });
                }

            } else {
                return res.status(400).json({ status: false, message: 'Failed to initiate payment for the global transfer route.' });
            }


        } else {

            // PAYMENT TYPE IS WALLET
            const userbal = await getBal(userid, currency);
            topay = parseFloat(amount) + prdamnt

            if (parseFloat(amount) >= Stampduty_Fee_Max && currency == 'NGN' && bankcode.toLowerCase() != 'hitchpay') {
                topay_with_stampduty = parseFloat(amount) + prdamnt + parseFloat(StampdutyFee); //add stampduty

                if (userbal < topay_with_stampduty)
                    return res.status(400).json({ status: false, message: `Insufficient balance for ${currency}${formatAmount(topay_with_stampduty)} due to stamp duty charge of ${currency}${formatAmount(StampdutyFee)} on transfer of NGN10,000 or more - Nigerian Tax Act (NTA) 2025` });

            } else {

                topay_with_stampduty = parseFloat(amount) + prdamnt

                if (userbal < topay_with_stampduty)
                    return res.status(400).json({
                        status: false,
                        message: `Insufficient balance for ${currency}${formatAmount(topay_with_stampduty)}.`
                    });
            }


            let getreceiver;
            if (bankcode.toLowerCase() === 'hitchpay') {
                if (accounttype && accounttype == 'business') {
                    getreceiver = await Business.findOne({
                        where: { [Op.or]: [{ business_phoneno: { [Op.like]: `%${recipientno}%` } }] }
                    });

                    var receiver_name = getreceiver.business_name
                } else {
                    getreceiver = await Customer.findOne({
                        where: { [Op.or]: [{ phoneno: { [Op.like]: `%${recipientno}%` } }, { uname: recipientno }] }
                    });
                    var receiver_name = getreceiver.firstname + ' ' + getreceiver.lastname
                }

                if (!getreceiver) return res.status(400).json({ status: false, message: 'Invalid HitchPay recipient account.' });

                if (getreceiver.id == userid) return res.status(400).json({ status: false, message: 'You cannot transfer to yourself.' });
                pay_desc_transfer = `Transfer to ${getreceiver.firstname} ${getreceiver.lastname}`;
            }


            const env = (envroute === 'web') ? 'web' : 'app';

            // --- Stage 1: Debit Sender & Log Initial ---
            const debitSenderTransaction = await db.sequelize.transaction();

            try {
                // charge the sending customer and log the trnsactin
                const newbalSender = await updateBalance(userid, topay, currency, 'debit', { transaction: debitSenderTransaction });

            // Calculate correct previous balance based on the atomic update result
            const correctPrevBal = parseFloat(newbalSender) + parseFloat(topay);
                const meta_data_sender = JSON.stringify({ sourcename: accountname, sourceaccount: recipientno, sourcebank: bankname });
                await Payn.create({
                userid: userid, amount: topay, amountval: parseFloat(amount), newbal: newbalSender, prevbal: correctPrevBal,
                    txref: txref, pfor: 'transfer', usertype: 'user', paytype: 'debit', productid: '', ntwk: bankname,
                    paidthru: 'Wallet', pay_desc: pay_desc_transfer, timed: timed, status: 0, // Pending
                    recipient: recipientno, ntwkid: bankcode, meta: meta_data_sender, fee: prdamnt,
                    narration: narration, revenue: revenue, payroute: env, currency: currency, providerfee: 0
                }, { transaction: debitSenderTransaction }
                );

                

                /* CHARGE STAMP DUTY ON TRANSFER FROM JAN 1, 2026 */
                if (parseFloat(amount) >= Stampduty_Fee_Max && currency == 'NGN' && bankcode.toLowerCase() != 'hitchpay') {
                    var userbal2 = await getBal(userid, 'NGN', { transaction: debitSenderTransaction }, 'personal');

                    var newbal2 = parseFloat(userbal2) - parseFloat(StampdutyFee)
                    var dref = `${txref}_STAMPDUTY`;

                    // LOG Stampduty
                    await Payn.create({
                        userid: userid, recipient: recipientno, amount: StampdutyFee, amountval: StampdutyFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Stampduty', usertype: 'user', paytype: 'debit', productid: txref, paychannel: '', paidthru: 'Wallet', meta: '', ntwk: bankname, pay_desc: `Stamp duty of ${StampdutyFee} is applied on ${txref}`, timed: timed, status: 1, name: '', ntwkid: bankcode, fee: 0, narration: `According to Nigerian Tax Act (NTA) 2025, a stamp duty of N50 is charged on all transfers of N10,000 or more made from your account`, providerfee: 0, revenue: 0
                    }, { transaction: debitSenderTransaction });

                    //DEBIT HIM
                    /* Update wallet */
                    await updateBalance(userid, StampdutyFee, 'NGN', 'debit', { transaction: debitSenderTransaction }, false, 'personal');
                }

                // charge VAT
                if(bankcode.toLowerCase() != 'hitchpay'){
                    // if (parseFloat(vatFee) >= 0 && currency == 'NGN') {

                    //     var userbal3 = await getBal(userid, 'NGN', { transaction: debitSenderTransaction }, 'personal');

                    //     var newbal3 = parseFloat(userbal3) - parseFloat(vatFee)
                    //     var dref = `${txref}_VAT`;

                    //     // LOG Stampduty
                    //     await Payn.create({
                    //         userid: userid, recipient: recipientno, amount: vatFee, amountval: vatFee, currency: 'NGN', newbal: newbal3, prevbal: userbal3, txref: dref, pfor: 'VAT', usertype: 'user', paytype: 'debit', productid: txref, paychannel: '', paidthru: 'Wallet', meta: '', ntwk: bankname, pay_desc: `Value Added Tax (VAT)`, timed: timed, status: 1, name: '', ntwkid: bankcode, fee: 0, narration: `7.5% Value Added Tax (VAT) charged on service fees of NGN${prdamnt}`, providerfee: 0, revenue: 0
                    //     }, { transaction: debitSenderTransaction });

                    //     //DEBIT HIM
                    //     /* Update wallet */
                    //     // await updateBalance(userid, vatFee, 'NGN', 'debit', { transaction: debitSenderTransaction }, false, 'personal');
                    // }
                }

                await debitSenderTransaction.commit();


            } catch (debitError) {

                await debitSenderTransaction.rollback();

                logger.error(`Debit failed for transfer ${txref}:`, debitError);

                return res.status(400).json({ status: false, message: 'Failed to debit your account. Please try again.' });
            }



            // --- Stage 2: Perform Transfer (Internal or External) ---
            if (bankcode.toLowerCase() === 'hitchpay') {

                const internalTransferTransaction = await db.sequelize.transaction();
                let dtxref_receiver, receiverid, receiverName, receivermail, newbalReceiver;

                try {

                    // const getreceiver = await Customer.findOne({ where: { phoneno: { [Op.like]: `%${recipientno}%` } }, transaction: internalTransferTransaction });

                    if (!getreceiver) {
                        throw new Error("Receiver not found");
                    }

                    if (accounttype && accounttype == 'business') {
                        receiverid = getreceiver.id;
                        receivermail = getreceiver.business_email;
                        receiverName = getreceiver.business_name;
                        receivertype = 'business';
                        receiverpaytype = 'business';
                    } else {
                        receiverid = getreceiver.id;
                        receivermail = getreceiver.email;
                        receiverName = `${getreceiver.firstname} ${getreceiver.lastname}`;
                        receivertype = 'personal';
                        receiverpaytype = 'user';
                    }

                    // CREDIT THE RECEIVER AND LOG
                    const receiverbal_before = await getBal(receiverid, currency, { transaction: internalTransferTransaction }, receivertype);

                    newbalReceiver = await updateBalance(receiverid, parseFloat(amount), currency, 'credit', { transaction: internalTransferTransaction }, true, receivertype);

                    dtxref_receiver = 'HTCH' + md5(randomstring.generate(3) + receiverid).toUpperCase().substring(0, 10);
                    const meta_data_receiver = JSON.stringify({ sourcename: sendername, sourceaccount: sourcephone, sourcebank: 'HitchPay' });

                    // Log for receiver
                    await Payn.create({
                        userid: receiverid, recipient: sourcephone, amount: parseFloat(amount), amountval: parseFloat(amount), currency: currency, newbal: newbalReceiver, prevbal: receiverbal_before, txref: dtxref_receiver, pfor: 'wallet',
                        usertype: receiverpaytype, paytype: 'credit', productid: txref, paychannel: 'hitchpay',
                        paidthru: 'hitchpay', meta: meta_data_receiver, ntwkid: bankcode, ntwk: 'HitchPay', pay_desc: `Transfer from ${sendername}`, narration: narration, timed: timed, status: 1,
                        payroute: env, fee: 0, revenue: 0, providerfee: 0,
                    }, { transaction: internalTransferTransaction });


                    // Update sender's log
                    await Payn.update({
                        status: 1, productid: dtxref_receiver, revenue: revenue, providerfee: 0
                    }, { where: { txref: txref, userid: userid }, transaction: internalTransferTransaction }
                    );

                    if (isbeneficiary) {
                        await logBeneficiary(userid, 'transfer', recipientno, bankname, bankcode, accountname, { transaction: internalTransferTransaction });
                    }

                    await internalTransferTransaction.commit();

                    // Notifications
                    //notifier the receiver
                    pushNotify(receiverid, 'Funding Alert - HitchPay', `You just received ${currency}${formatAmount(amount)} from ${sendername}.`);

                    mailSender(receiverName, 'Wallet Funding', receivermail, `You have received ${currency}${formatAmount(amount)} from ${sendername} via HitchPay. Ref: ${dtxref_receiver}.`);

                    //notifier the sender
                    pushNotify(userid, 'Transaction Notice - HitchPay', `Your ${currency}${formatAmount(amount)} transfer to ${receiverName} (${recipientno}) was successful.`);

                    /* CHECK FOR REFERREAL BONUS */
                    await logReferEarn(userid, dtxref_receiver);

                    var transtimed = moment.unix(timed).local().format("Do MMM, YYYY hh:mm a")

                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${getreceiver.firstname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${recipientno}(HitchPay)
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> ${currency}${formatAmount(amount)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> HitchPay</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${sourcephone}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${sendername}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${dtxref_receiver}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> ${currency}${formatAmount(0)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Stamp duty:</strong> ${currency}${formatAmount(0)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> ${currency}${formatAmount(newbalReceiver)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;

                    mailSender(getreceiver.firstname, 'Wallet Funding', receivermail, thecontent);

                    res.json({
                        status: true, message: 'Transfer Successful.',
                        data: {
                            amount: parseFloat(amount),
                            amountcharged: topay, fee: prdamnt,
                            reference: txref, sessionid: dtxref_receiver,
                            stampduty: StampdutyFee,
                            paystatus: 'Successful',
                            transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a")
                        }
                    });

                } catch (internalError) {
                    await internalTransferTransaction.rollback();
                    logger.error(`Internal transfer failed for ${txref}:`, internalError);

                    // For now, log and inform user.
                    await Payn.update({ status: 5, pay_desc: `${pay_desc_transfer} (Failed - Internal Error)` }, { where: { txref: txref, userid: userid } });

                    res.status(400).json({ status: false, message: 'Internal transfer failed. Please contact support.' });
                }

            } else {

                // External Bank Transfer
                let ftApiResponse;

                try {
                    const getsett = await AppSett.findOne({ where: { id: 1 } });
                    const FTProvider = getsett.ftprovider;

                    if (FTProvider.toLowerCase() == 'safehaven') {
                        var provider = 'safehaven';
                        const accesstoken = await shAcessToken();
                        if (!accesstoken[0])
                            throw new Error('Service provider unavailable.');

                        const thenarration = `${fname} ${lname} - ${pay_desc_transfer}`;
                        ftApiResponse = await SHTransfer(accesstoken, enquirytoken, bankcode, recipientno, amount, thenarration, txref, timed);


                    } else if (FTProvider.toLowerCase() == 'gtbank') {
                        var provider = 'gtbank';
                        ftApiResponse = await GTBankTransfer(amount, txref, fname + ' ' + lname, recipientno, bankcode, accountname, timed);

                    } else {

                        /* 9PSB TRANSDFER */
                        var provider = '9psb';
                        const gettoken = await psb9Token();
                        if (!gettoken[0]) throw new Error('Service provider unavailable.');

                        // hash the payload
                        const thenarration = `${fname} ${lname} - ${pay_desc_transfer}`;
                        ftApiResponse = await PSB9Transfer(gettoken, amount, txref, thenarration, recipientno, bankcode, accountname, timed)

                    }

                    // console.log('transferApiResponse', ftApiResponse)

                    if ((ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') || ftApiResponse.code == '00' || (ftApiResponse.status == '200' && ftApiResponse.success == true)) {

                        if (provider == '9psb') {
                            var sessID = ftApiResponse['transaction']['externalreference'];
                        } else if (provider == 'gtbank') {
                            var sessID = ftApiResponse.data.nip_transaction_reference;
                        } else {
                            var sessID = ftApiResponse.data.sessionId;
                        }

                        await Payn.update({
                            status: 1, paychannel: provider, productid: sessID,
                            jsonresp: JSON.stringify(ftApiResponse), revenue: revenue, providerfee: providerfee
                        }, { where: { txref: txref, userid: userid } });

                        if (isbeneficiary) {
                            await logBeneficiary(userid, 'transfer', recipientno, bankname, bankcode, accountname);
                        }

                        pushNotify(userid, 'Transaction Notice - HitchPay', `Your NGN${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successful.`);

                        /* CHECK FOR REFERREAL BONUS */
                        await logReferEarn(userid, txref);

                        res.json({
                            status: true, message: 'Transfer Successful.',
                            data: {
                                amount: parseFloat(amount), amountcharged: topay, fee: prdamnt,
                                reference: txref, sessionid: sessID, paystatus: 'Successful',
                                transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a")
                            }
                        });

                    } else {
                        // throw new Error(ftApiResponse.message || 'Transfer failed with provider.');
                        throw new Error('Unable to process your request, kindly retry shortly');
                    }

                } catch (externalError) {
                    await Payn.update({ jsonresp: JSON.stringify(ftApiResponse || { error: externalError.message }), pay_desc: `${pay_desc_transfer} (Failed - Provider Error)` }, { where: { txref: txref, userid: userid } });
                    logger.error(`External transfer failed for ${txref}:`, externalError);
                    if (externalError.response && externalError.response.data) {
                        console.error('usacct detail Error response data:', JSON.stringify(externalError.response.data, null, 2));
                        // return res.status(400).json({ status: false, message: externalError.response.data.message, data: {errortype: ""} });
                        return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
                    } else {
                        return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
                    }
                }
            }
        }

    } catch (error) {
        logger.error("Error in transferPayment (outer):", error);
        res.status(500).json({ status: false, message: 'An unexpected error occurred during the transfer.' });
        // if (!res.headersSent) {
        //     next(error);
        // }
    }
}


const SHTransfer = async (accesstoken, enquirytoken, bankcode, recipientno, amount, narration, txref, timed) => {
    try {

        const payload = JSON.stringify({
            saveBeneficiary: false,
            nameEnquiryReference: enquirytoken, debitAccountNumber: process.env.SH_DEBITACCOUNT,
            beneficiaryBankCode: bankcode, beneficiaryAccountNumber: recipientno, amount: parseFloat(amount),
            narration: narration, paymentReference: txref
        });

        // console.log(payload)

        await LogRequest.create({ reference: txref, jsonreq: payload, timed: timed, product: 'transfer', provider: 'safehaven' });

        const theHeader = {
            accept: 'application/json', ClientID: accesstoken[2],
            'content-type': 'application/json',
            authorization: `Bearer ${accesstoken[1]}`
        };

        const options = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/transfers`,
            headers: theHeader,
            data: payload
        };

        let response = await axios.request(options);
        return response.data;

    } catch (error) {
        logger.error(`SH FXN Transfer Error for ${txref}:`, error.message);
        throw error;
    }
}

const GTBankTransfer = async (amount, txref, narration, recipientno, bankcode, accountname, timed) => {
    try {
        const modref = `SBRLNU1CZ8_${txref}`;
        const amountKobo = parseFloat(amount) * 100;
        const payload = JSON.stringify({
            "remark": narration,
            "bank_code": bankcode,
            "currency_id": "NGN",
            "amount": amountKobo,
            "account_number": recipientno,
            "transaction_reference": modref,
            "account_name": accountname
        });

        await LogRequest.create({ reference: txref, jsonreq: payload, timed: timed, product: 'transfer', provider: 'gtbank' });

        const options = {
            method: 'POST',
            url: `${process.env.SQD_URL}/payout/transfer`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                authorization: `Bearer ${process.env.SQD_SKEY}`
            },
            data: payload
        };

        let response = await axios.request(options);
        let thedata = response.data;

        return thedata;

    } catch (error) {
        logger.error(`GTBank FXN Transfer Error for ${txref}:`, error.message);
        throw error;
    }
}

// GTBankTransfer(100, 'TEXREF123', 'Test Narration', '0247813350', '000013', 'John Doe', Math.floor(Date.now() / 1000))
//   .then(result => {     
//     console.log("Reslt:", result);
//   })
//   .catch(err => console.error("Script execution failed:", err))
//   .finally(async () => {
//       // Optional: Close database connection if this is a standalone script
//       // await db.sequelize.close();
//   });

const PSB9Transfer = async (gettoken, amount, txref, narration, recipientno, bankcode, accountname, timed) => {
    try {
        const tohash = process.env.PSBNK_PRVKEY + process.env.PSBNK_DEBITACCT + recipientno + bankcode + toTwoDecimal(amount) + txref;
        const hashed_string = (crypto.createHash('sha512').update(tohash).digest('hex')).toUpperCase();

        const payload = JSON.stringify({
            transaction: { reference: txref },
            order: {
                amount: toTwoDecimal(amount), //double
                description: narration,
                currency: "NGN",
                country: "NGA"
            },
            customer: {
                account: {
                    number: recipientno,
                    bank: bankcode, name: 'HitchPay',
                    senderaccountnumber: process.env.PSBNK_DEBITACCT,
                    sendername: accountname
                }
            },
            hash: hashed_string
        });

        await LogRequest.create({ reference: txref, jsonreq: payload, timed: timed, product: 'transfer', provider: '9psb' });

        const theHeader = {
            accept: 'application/json',
            'content-type': 'application/json',
            authorization: `Bearer ${gettoken[1]}`
        };

        const options = {
            method: 'POST',
            url: `${process.env.PSBNK_FTURL}/merchant/account/transfer`,
            headers: theHeader,
            data: payload
        };

        let response = await axios.request(options);
        return response.data;

    } catch (error) {
        logger.error(`9PSB FNX Transfer Error for ${txref}:`, error.message);
        throw error;
    }
}



const BeneficiaryList = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const getacct = await Benefit.findAll({ order: [['id', 'DESC']], where: { userid: hisid } });

        if (!getacct || getacct.length === 0) { // Check for empty array
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
        console.log('user ben list catch ERROR: ' + error.message)
        res.status(400).json({ status: false, message: 'unable to get list at the moment' }); // Send 500 for server errors
    }
}

const initiatePay = async (req, res) => {
    return res.status(400).json({ status: false, message: 'Kindly update your app in order to proceed' });
}

const initiatePayNew = async (req, res) => {
    try {
        const { email, amount, recipientno, network, isdiscounted, product, metadata, prdid, packageid, packageslug } = cleanMe(req.body);

        if (!amount || (parseFloat(amount) <= 0)) return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
        if (!recipientno) return res.status(400).json({ status: false, message: 'Kindly enter recipient phone number.' });
        if (!network) return res.status(400).json({ status: false, message: 'No provider Selected.' });
        if (!product) return res.status(400).json({ status: false, message: 'No product selected.' });
        // if (!prdid) return res.status(400).json({ status: false, message: 'Invalid product passed.' });
        if (!email) return res.status(400).json({ status: false, message: 'Customer email address must be specified.' });
        if (product.toLowerCase() == 'airtime' && amount < 100)
            return res.status(400).json({ status: false, message: 'Airtime amount must be greater than N100' });


        let productCodeForExternalCall = packageid;
        const datatype = metadata?.metertype;
        const dataplan = metadata?.dataplan;
        const custname = metadata?.custname;
        const address = metadata?.address;
        const paydesc_initial = metadata?.narration;

        const theProduct = product.toLowerCase();
        let checkFee;
        if (prdid) {
            checkFee = await Product.findOne({ where: { id: prdid, category: theProduct, status: 1 } });
        } else {
            // checkFee = await Product.findOne({ where: { category: theProduct, prdname: network, status: 1 } });
            checkFee = await Product.findOne({ where: { [Op.and]: [{ category: theProduct }, { status: 1 }, { [Op.or]: [{ prdname: network }, { ntwk: { [Op.like]: `%${network}%` } }] }] } });
        }

        if (!checkFee) return res.status(400).json({ status: false, message: 'Selected product is currently not available.' });

        // --- START: Centralized Fee & Profit Calculation ---
        const { totalChargedToCustomer, ourFee, profit, providerFeeActual } = calculateProfitAndFee(checkFee, parseFloat(amount));

        let topay = totalChargedToCustomer;
        let amountval_service = parseFloat(amount);
        var calculatedProfit = profit;
        let actualProviderFee = providerFeeActual; //The actual amount of provider's fee/commission
        let providerAmount = parseFloat(amount);

        if (theProduct == 'airtime' && ourFee < 0) {
            var dfee_hitchpay = 0;
        } else {
            var dfee_hitchpay = ourFee;
        }

        const txref = 'HTCH' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12);
        let timed = Date.parse(new Date()) / 1000;

        if (amount < 50 && theProduct === 'airtime') {
            return res.status(400).json({ status: false, message: 'You cannot buy below N50.00' });
        }
        if ((theProduct === 'airtime' || theProduct === 'databundle') && (recipientno.length !== 11)) {
            return res.status(400).json({ status: false, message: 'Phone number must be 11 digits.' });
        }
        if ((theProduct === 'cable tv' || theProduct === 'electricity') && (recipientno.length < 10)) {
            return res.status(400).json({ status: false, message: 'Account/Meter number cannot be less than 10 digits.' });
        }

        if (topay <= 0) return res.status(400).json({ status: false, message: 'Invalid charged amount detected.' });

        const pay_desc_log = ucFirst(theProduct == 'databundle' ? `${checkFee?.prdname}` : `${product} payment to ${recipientno}`);
        const logreq_json = JSON.stringify(req.body); // Log the original request for reference


        let addOffline = false;
        let debitTransaction; // Declare outside try for broader scope if needed for debugging
        try {
            debitTransaction = await db.sequelize.transaction();

            const payload = {
                custemail: email, amount: topay, amountval: amountval_service,
                newbal: 0, prevbal: 0, paychannel: 'safehaven', txref: txref,
                pfor: product, usertype: 'user', paytype: 'debit',
                productid: productCodeForExternalCall, ntwk: network, fee: dfee_hitchpay,
                paidthru: 'Online', pay_desc: pay_desc_log, timed: timed, status: 0,
                recipient: recipientno, jsonreqst: logreq_json, revenue: calculatedProfit, providerfee: actualProviderFee
            };

            addOffline = await OfflinePay.create(payload, { transaction: debitTransaction });

            await debitTransaction.commit();

        } catch (error) {
            if (debitTransaction && !debitTransaction.finished) { // Check if transaction is still active before rolling back
                await debitTransaction.rollback();
                console.error(`[${txref}] Transaction rolled back.`);
            }

            console.error(`[${txref}] Error during OfflinePay creation/commit:`, error.message, error.stack);

            return res.status(400).json({ status: false, message: 'Failed to initiate payment. Please try again.' });
        }

        // console.log(addOffline)
        if (!addOffline) {
            return res.status(400).json({ status: false, message: 'Failed to initiate request' });
        }

        const emailContent = `
        <div>
            <div class="greybg" style="padding: 30px 20px;">
                <p style="font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                    Hello <span style="font-size: 18px;">😍</span><br>
                    You initiated an offline ${product} payment. Kindly proceed with your payment.<br>
                    <strong>Transaction Reference: ${txref}</strong><br>
                    <strong>Transaction Date: ${moment.unix(timed).format('MMM Do, YYYY | h:m a')} </strong><br>
                </p>
                <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
            </div>
        </div>`;

        mailSender('', 'Offline Payment - HitchPay', email, emailContent);

        console.log(`[${txref}] Sending success response.`);
        res.json({
            status: true,
            message: 'Payment Initiated',
            data: {
                amount: topay, // Total amount customer needs to pay
                reference: txref,
                bankCode: process.env.APPENV == 'production' ? '090286' : '999240',
                accountNumber: process.env.SH_DEBITACCOUNT,
                clientId: process.env.SHCLIENTID,
                whoBearFee: 'customer',
                emailAddress: email,
                environment: process.env.APPENV == 'production' ? 'production' : 'sandbox'
            }
        });

    } catch (error) {
        console.log("Error pay init: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}


const verifyInitPay = async (req, res) => {
    const { txref } = cleanMe(req.body);
    if (!txref || (txref == '')) {
        return res.status(400).json({ status: false, message: 'Invalid reference sent.' });
    }

    try {
        const gettoken = await shAcessToken();
        if (!gettoken[0]) {
            return res.status(400).json({ status: false, message: 'Failed, Unable to confirm payment at the moment. Kindly contact our support' });
        }
        var access_token = gettoken[1]
        var ibs_client_id = gettoken[2]

        const options = {
            method: 'GET',
            url: `${process.env.SH_BASEURL}/checkout/${txref}/verify`,
            headers: {
                accept: 'application/json',
                ClientID: ibs_client_id,
                'content-type': 'application/json',
                authorization: `Bearer ${access_token}`
            },
        };


        let response = await axios.request(options);
        let theresponse = response.data;

        if (theresponse.statusCode == 200 && theresponse.data.status == 'Paid') {
            const gateWayJsonString = JSON.stringify(theresponse);

            const t = await db.sequelize.transaction();
            try {
                const checkOfflinePay = await OfflinePay.findOne({ where: { txref: txref, paytype: 'debit' }, transaction: t });

                if (!checkOfflinePay) {
                    await t.rollback();
                    return res.status(400).json({ status: false, message: 'Unable to verify your payment reference, kindly contact our support' });
                }

                if (checkOfflinePay.status != 0) { // Already processed
                    await t.rollback();
                    return res.status(400).json({ status: false, message: 'Payment Already processed' });
                }

                var expectedamount = parseFloat(checkOfflinePay.amount);
                var amountPaidByCustomer = parseFloat(theresponse.data.amount);

                if (amountPaidByCustomer < expectedamount) { // Underpayment
                    await t.rollback();
                    // Log this event for manual review/refund if necessary
                    console.warn(`Underpayment for txref ${txref}. Expected ${expectedamount}, Paid ${amountPaidByCustomer}`);
                    return res.status(400).json({ status: false, message: 'Partial payment detected. Please contact support.' });
                }

                // Give value
                var theProduct = checkOfflinePay.pfor.toLowerCase();
                var ntwk_provider = checkOfflinePay.ntwk;
                var recipientno = checkOfflinePay.recipient;
                var amount_service_value = checkOfflinePay.amountval; // The actual value of the service

                var jsonReqst = JSON.parse(checkOfflinePay.jsonreqst);
                var packageid_external = jsonReqst.packageid; // This is the packageId for CoralPay
                var customerEmail = jsonReqst.email;
                var packageslug_external = jsonReqst.packageslug;
                var metadata_original = jsonReqst.metadata || {};
                var custname_original = metadata_original.custname;
                var address_original = metadata_original.address;
                const datatype_original = metadata_original.metertype;
                const dfee = metadata_original.fee;
                const calrevenue = metadata_original.revenue;
                const theproviderfee = metadata_original.providerfee;
                const dataplan_original = metadata_original.dataplan;
                var productid_for_external = checkOfflinePay.productid; // This should be the specific ID for Coral (e.g. data plan ID)

                let externalCallResult;
                var receiptmeta_email = '';

                if (theProduct == 'airtime') {
                    externalCallResult = await buyAirtime(ntwk_provider, recipientno, amount_service_value, txref);
                } else if (theProduct == 'databundle') {
                    // For databundle, amount_service_value is the providerPrice
                    externalCallResult = await buyData(recipientno, amount_service_value, txref, productid_for_external);
                } else if (theProduct == 'cable tv') {
                    externalCallResult = await buyCable(recipientno, amount_service_value, txref, productid_for_external, custname_original);
                    receiptmeta_email = `<tr><td><p>Customer Name</p></td><td><p>${custname_original || 'N/A'}</p></td></tr>`;
                } else if (theProduct == 'electricity') {
                    const vendtype = ucFirst(packageslug_external.toLowerCase());
                    externalCallResult = await vendElect(recipientno, amount_service_value, txref, vendtype, custname_original, ''); // Assuming no user phone for offline
                } else if (theProduct == 'betting') {
                    const vendtype = ucFirst(packageslug_external.toLowerCase());
                    externalCallResult = await payBetting(vendtype, recipientno, amount_service_value, txref, custname_original);
                    receiptmeta_email = `<tr><td><p>Customer Name</p></td><td><p>${custname_original || 'N/A'}</p></td></tr>`;
                } else if (theProduct == 'education' || theProduct == 'others') {
                    const vendtype = ucFirst(packageslug_external.toLowerCase());
                    externalCallResult = await payOtherBiller(vendtype, recipientno, amount_service_value, txref, custname_original);
                } else {
                    await t.rollback();
                    return res.status(400).json({ status: false, message: 'Invalid product name passed for value delivery.' });
                }

                const coralJsonString = JSON.stringify(externalCallResult);

                if (externalCallResult.responseCode == '00' && externalCallResult.status == 'success') {
                    const details = externalCallResult.responseData;
                    const convenienceFee = parseFloat(details.convenienceFee) || 0;

                    const profit = parseFloat(checkOfflinePay.fee) - convenienceFee;

                    let vendtoken = '', vendunit = '', meta_data_final = {};
                    if (theProduct == 'electricity' || theProduct == 'education') {
                        const tokenData = details.tokenData?.stdToken || {};
                        vendtoken = tokenData.value || '';
                        vendunit = tokenData.units || '';
                        receiptmeta_email += `
                            <tr><td><p>Customer Name</p></td><td><p>${custname_original || 'N/A'}</p></td></tr>
                            <tr><td><p>Address</p></td><td><p>${address_original || 'N/A'}</p></td></tr>
                            <tr><td><p>Token</p></td><td><p>${vendtoken}</p></td></tr>
                            <tr><td><p>Unit</p></td><td><p>${vendunit} units</p></td></tr>`;
                        meta_data_final = { productid: productid_for_external, dataplan: dataplan_original, custname: custname_original, address: address_original, token: vendtoken, unit: vendunit, metertype: datatype_original, receiptNumber: tokenData.receiptNumber || '' };
                    } else {
                        meta_data_final = { productid: productid_for_external, dataplan: dataplan_original, custname: custname_original, address: address_original, metertype: datatype_original };
                    }

                    await OfflinePay.update({
                        status: 1, paidthru: 'online', paychannel: 'Coral', productid: details.transactionId,
                        jsonresp: coralJsonString, meta: JSON.stringify(meta_data_final), gatewayresp: gateWayJsonString
                    }, { where: { txref: txref }, transaction: t });


                    let timed = Date.parse(new Date()) / 1000;
                    const pay_desc_log = `NGN${expectedamount} offline payment for ${theProduct} to ${recipientno}`;

                    /* LOG RECORD ON PAYMENT TBL */
                    await Payn.create({
                        userid: null, amount: expectedamount, amountval: amount_service_value, newbal: 0, prevbal: 0,
                        txref: txref, pfor: theProduct, usertype: 'offline', paytype: 'debit', productid: details.transactionId,
                        ntwk: ntwk_provider, jsonresp: coralJsonString, meta: JSON.stringify(meta_data_final), paidthru: 'offline', pay_desc: pay_desc_log, timed: timed, status: 1, recipient: recipientno, fee: dfee, payroute: 'app', currency: 'NGN', revenue: calrevenue, providerfee: theproviderfee
                    }, { transaction: t });

                    await t.commit();

                    const emailReceipt = `
                    <p style="line-height: 20px; letter-spacing: 0.025em;">Hello <span style="font-size: 18px;">😍</span></p>
                    <p style="line-height: 28px; letter-spacing: 0.025em;">Your ${theProduct} transaction with reference - ${txref} was successful.</p>
                    <h3>Transaction Details</h3>
                    <table style="width: 100%; color: #54424d; font-size: 15px; font-weight: 500;" class="cke_show_border" cellspacing="1" cellpadding="1" border="0">
                        <tbody class="transbody">
                            <tr><td><p>Amount Paid</p></td><td><p>N${formatAmount(checkOfflinePay.amount)}</p></td></tr>
                            <tr><td><p>Product</p></td><td><p>${ucFirst(theProduct)}</p></td></tr>
                            <tr><td><p>Fee</p></td><td><p>N${formatAmount(checkOfflinePay.fee)}</p></td></tr>
                            <tr><td><p>Recipient Number</p></td><td><p>${recipientno}</p></td></tr>
                            <tr><td><p>Provider/Network</p></td><td><p>${ntwk_provider}</p></td></tr>
                            <tr><td><p>Transaction Reference</p></td><td width="50%"><p>${txref}</p></td></tr>
                            <tr><td><p>Transaction Date</p></td><td width="50%"><p>${moment.unix(checkOfflinePay.timed).format("Do MMM, YYYY hh:mm a")}</p></td></tr>
                            ${receiptmeta_email}
                        </tbody>
                    </table>`;
                    mailSender('', 'Payment Receipt', customerEmail, emailReceipt);

                    return res.json({
                        status: true, message: details.narration || "Transaction Successful",
                        data: { /* ... construct response data similar to processPayment ... */
                            amount: amountPaidByCustomer, amountcharged: amountPaidByCustomer,
                            amountval: checkOfflinePay.amountval, transref: txref,
                            fee: checkOfflinePay.fee ? formatAmount(checkOfflinePay.fee) : '0.00',
                            phonenumber: recipientno,
                            paydate: moment.unix(checkOfflinePay.timed).format('Do MMM, YYYY'),
                            paytime: moment.unix(checkOfflinePay.timed).format('MMM Do, YYYY | h:m a'),
                            transtimed: moment.unix(checkOfflinePay.timed).format("Do MMM, YYYY hh:mm a"),
                            product: ucFirst(checkOfflinePay.pfor),
                            productid: productid_for_external,
                            pay_desc: checkOfflinePay.pay_desc,
                            narration: details.narration, paystatus: 1,
                            network: ntwk_provider ? ntwk_provider.toUpperCase() : '',
                            paystatus_text: 'Successful', currency: "NGN",
                            custname: custname_original, meteradr: address_original, metertype: datatype_original,
                            vendunit: vendunit, vendtoken: vendtoken,
                            cashback: 0, // No direct cashback for offline pay usually
                            dataplan: dataplan_original,
                        }
                    });
                } else { // CoralPay call failed
                    await t.rollback(); // Rollback OfflinePay update attempt
                    console.error(`Failed to give value for ${txref} after successful SH payment. CoralPay error: ${externalCallResult.message}`);
                    // Log this for manual intervention - customer paid, but value not given.
                    // Potentially update OfflinePay status to something like 'PENDING_MANUAL_FULFILLMENT'

                    await OfflinePay.update({ status: 2, jsonresp: coralJsonString, gatewayresp: gateWayJsonString }, { where: { txref: txref } }); // Status 2 for pending manual check

                    mailSender('', 'Payment Issue - Action Required', customerEmail, `Your payment for transaction ${txref} was successful, but there was an issue delivering the service. Please contact support.`);

                    return res.status(400).json({ status: false, message: `Payment verified, but failed to deliver product: ${externalCallResult.message}. Contact support.` });
                }

            } catch (innerError) {
                // Catch errors within the 'give value' transaction
                if (!t.finished) await t.rollback();
                console.error("Error processing verified payment (inner try): ", innerError.message);

                // Also log for manual intervention
                // Status 2 for pending manual check
                await OfflinePay.update({ status: 2, gatewayresp: gateWayJsonString }, { where: { txref: txref } });

                mailSender('', 'Payment Issue - Action Required', customerEmail, `Your payment for transaction ${txref} was successful, but an issue occurred while processing the service. Please contact support.`);

                return res.status(400).json({ status: false, message: 'Payment verified, but an internal error occurred. Contact support.' });
            }

        } else {
            // SH Verification failed or payment not 'Paid'
            return res.status(400).json({ status: false, message: theresponse.message || 'Unable to confirm payment with payment provider.' });
        }

    } catch (error) {
        console.error("Error in verifyInitPay (outer try): ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment. Kindly contact our support.' }); // Use 500 for server errors
    }
}


const whatsAppPayment = async (req, res, next) => {
    const { authtoken } = cleanMe(req.body);

    jwt.verify(authtoken, process.env.JWT_SECRET, async (err, resulted) => {
        if (err) {
            const message = err.name === 'JsonWebTokenError' ? 'Unathourized Authorization Token' : 'Token expired';
            return res.status(400).json({ status: false, message: message });
        }

        const userid = resulted.id;
        if (!userid) {
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
        }


        try {
            // Fetch user info once
            const userinfo = await getUserInfo(userid);
            if (!userinfo) {
                return res.status(400).json({ status: false, message: 'User details not found' });
            }

            const { amount, recipientno, network, isdiscounted, product, metadata, prdid, packageid, packageslug, transpin, envroute = 'whatsapp', billerid } = cleanMe(req.body);

            if (!amount || (parseFloat(amount) <= 0)) return res.status(400).json({ status: false, message: 'Kindly enter amount' });
            if (!recipientno) return res.status(400).json({ status: false, message: 'Kindly enter recipient phone number' });
            if (!network) return res.status(400).json({ status: false, message: 'No provider Selected' });
            if (!product) return res.status(400).json({ status: false, message: 'No product selected' });
            // if (!prdid) return res.status(400).json({ status: false, message: 'Invalid product passed' });
            if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

            const ntwk_provider = network; // Keep original casing
            const fname = userinfo.firstname;
            const userphoneno_sender = userinfo.phoneno;
            const sendername = `${userinfo.lastname} ${userinfo.firstname}`;
            const useremail = userinfo.email;
            const authpin = userinfo.authpin;
            const histier = userinfo.accounttier;

            if (!authpin) return res.status(400).json({ status: false, message: 'Kindly setup your transaction PIN to proceed' });

            if (!histier)
                return res.status(400).json({ status: false, message: 'Kindly complete your account KYC in order to proceed' });

            // if (!bcrypt.compareSync(transpin, authpin)) return res.status(400).json({ status: false, message: 'Incorrect Transaction PIN' });

            let productCodeForExternalCall_whatsapp = packageid;
            const datatype_whatsapp = metadata?.metertype;
            const dataplan_whatsapp = metadata?.dataplan;
            const custname_whatsapp = metadata?.custname ? metadata.custname : sendername;
            const address_whatsapp = metadata?.address;
            let pay_desc_whatsapp = metadata?.narration;
            let pay_desc_initial = metadata?.narration;

            const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

            if (!checkwithHashPwd)
                return res.status(400).json({ status: false, message: 'Incorrect Transaction PIN' });

            const theProduct_whatsapp = product.toLowerCase();
            let checkFee_whatsapp;

            // if (prdid) {
            //     checkFee_whatsapp = await Product.findOne({ where: { id: prdid, category: theProduct_whatsapp, status: 1 } });
            // } else {

            // }
            checkFee_whatsapp = await Product.findOne({ where: { [Op.and]: [{ category: theProduct_whatsapp }, { status: 1 }, { [Op.or]: [{ prdname: network }, { ntwk: { [Op.like]: `%${network}%` } }] }] } });

            if (!checkFee_whatsapp)
                return res.status(400).json({ status: false, message: 'Selected product is currently not available' });

            // --- START: Profit Calculation Logic ---
            const { totalChargedToCustomer, ourFee, profit, providerFeeActual, ProviderComm } = calculateProfitAndFee(checkFee_whatsapp, parseFloat(amount));

            let topay_whatsapp = totalChargedToCustomer;
            let amountval_whatsapp = parseFloat(amount); //The actual value of the service being purchased
            var calculatedProfit = profit;
            if (theProduct_whatsapp == 'airtime' && ourFee < 0) {
                var dfee_whatsapp = 0;
            } else {
                var dfee_whatsapp = ourFee; //The fee we charge the customer (can be negative for discount)
            }

            let actualProviderFee = providerFeeActual; //The actual amount of provider's fee/commission
            let providerAmount_whatsapp = parseFloat(amount);
            // var prdamnt_whatsapp = providerAmount;

            const txref_whatsapp = 'HTCH' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
            let timed_whatsapp = Date.parse(new Date()) / 1000;

            /* TOTAL TRANS TODAY */
            const accountLimit = await TransLimit(histier);
            var dailytrans = accountLimit[3]; // total daily transaction

            const transToday = await OutflowToday(userid);
            const totalToday = parseFloat(transToday) + topay_whatsapp;

            if (parseFloat(totalToday) > parseFloat(dailytrans))
                return res.status(400).json({ status: false, message: `This transaction will cause you to go beyond your account daily transaction limit of NGN${formatAmount(dailytrans)}` });

            if (amount < 0)
                return res.status(400).json({ status: false, message: 'Invalid product amount' });

            if (amount < 50 && theProduct_whatsapp == 'airtime')
                return res.status(400).json({ status: false, message: 'You cannot buy below N50.00' });

            if ((theProduct_whatsapp == 'airtime' || theProduct_whatsapp == 'databundle') && ((recipientno.length > 11) || (recipientno.length < 11)))
                return res.status(400).json({ status: false, message: 'Phone number cannot be less than 11 digits nor greater than 11 digits' });

            if ((theProduct_whatsapp == 'cable tv' || theProduct_whatsapp == 'electricity') && (recipientno.length < 10))
                return res.status(400).json({ status: false, message: 'Account number cannot be less than 10 digits' });

            if (userinfo.status != '1')
                return res.status(400).json({ status: false, message: 'Your account is not active. Kindly verify your account' });

            if (userinfo.status == '3')
                return res.status(400).json({ status: false, message: 'Your account is currently on hold. Kindly contact our support' });

            if (theProduct_whatsapp == 'airtime' && amount > 20000)
                return res.status(400).json({ status: false, message: 'You cannot buy over N20,000 airtime' });

            if (theProduct_whatsapp == 'electricity' && amount < 2000)
                return res.status(400).json({ status: false, message: 'Electricity vend amount cannot be less than your minimum vend amount N2,000' });

            if (topay_whatsapp <= 0)
                return res.status(400).json({ status: false, message: 'Invalid charged amount detected, kindly reload and retry' });

            const userbal = await getBal(userid, 'NGN');

            if (userbal > 0 && userbal >= topay_whatsapp) {
                pay_desc_whatsapp = ucFirst(theProduct_whatsapp == 'databundle' ? `${checkFee_whatsapp?.prdname}` : `${theProduct_whatsapp == 'others' ? ntwk : theProduct_whatsapp} payment to ${recipientno}`);

                let modifyprd_whatsapp = theProduct_whatsapp == 'others' ? 'Other Billers' : theProduct_whatsapp;
                const env = 'whatsapp';

                // --- Stage 1: Debit User and Log Initial Transaction ---
                let initialLog;
                const debitTransaction = await db.sequelize.transaction();
                try {
                    //===========CHARGE THE CUSTOMER AND LOG TRANSACTION===//
                    const newbalFromUpdate = await updateBalance(userid, topay_whatsapp, 'NGN', 'debit', { transaction: debitTransaction });

                    initialLog = await Payn.create({
                        userid: userid, amount: topay_whatsapp, amountval: amountval_whatsapp, newbal: newbalFromUpdate, prevbal: userbal,
                        txref: txref_whatsapp, pfor: modifyprd_whatsapp, usertype: 'user', paytype: 'debit', productid: productCodeForExternalCall_whatsapp,
                        ntwk: ntwk_provider, paidthru: 'Wallet', pay_desc: pay_desc_whatsapp, timed: timed_whatsapp, status: 0, recipient: recipientno,
                        fee: dfee_whatsapp, payroute: 'whatsapp', currency: 'NGN', revenue: calculatedProfit, providerfee: actualProviderFee
                    }, { transaction: debitTransaction });

                    await debitTransaction.commit();

                } catch (debitError) {
                    await debitTransaction.rollback();

                    console.error(`Debit failed for ${txref_whatsapp}:`, debitError.message);

                    return res.status(500).json({ status: false, message: 'Failed to debit account. Please try again.' });
                }


                let externalApiResponse_whatsapp; let receiptmeta;
                try {
                    if (theProduct_whatsapp == 'airtime') {
                        externalApiResponse_whatsapp = await buyAirtime(ntwk_provider, recipientno, amountval_whatsapp, txref_whatsapp);
                    } else if (theProduct_whatsapp == 'databundle') {
                        externalApiResponse_whatsapp = await buyData(recipientno, providerAmount_whatsapp, txref_whatsapp, productCodeForExternalCall_whatsapp);

                    } else if (theProduct_whatsapp == 'cable tv') {
                        externalApiResponse_whatsapp = await buyCable(recipientno, amountval_whatsapp, txref_whatsapp, productCodeForExternalCall_whatsapp, custname_whatsapp);
                    } else if (theProduct_whatsapp == 'electricity') {
                        const vendtype = ucFirst(packageslug.toLowerCase());

                        externalApiResponse_whatsapp = await vendElect(recipientno, amountval_whatsapp, txref_whatsapp, vendtype, custname_whatsapp, userphoneno_sender);

                    } else if (theProduct_whatsapp == 'betting') {
                        const vendtype = ucFirst(packageslug.toLowerCase());
                        externalApiResponse_whatsapp = await payBetting(vendtype, recipientno, amountval_whatsapp, txref_whatsapp, custname_whatsapp);

                    } else if (theProduct_whatsapp == 'education' || theProduct_whatsapp == 'others') {
                        const vendtype = ucFirst(packageslug.toLowerCase());
                        externalApiResponse_whatsapp = await payOtherBiller(vendtype, recipientno, amountval_whatsapp, txref_whatsapp, custname_whatsapp);

                    } else {
                        return res.status(400).json({ status: false, message: 'Invalid product name passed' })
                    }

                } catch (apiError) {
                    externalApiResponse_whatsapp = apiError.response ? apiError.response.data : {
                        status: 'error', responseCode: '099',
                        message: apiError.message || 'Failed to connect to provider', responseData: null
                    };

                    console.error(`External API call failed for ${txref} (immediately caught):`, externalApiResponse_whatsapp.message);
                }

                // --- Stage 3: Process External API Response and Finalize Transaction ---
                const t_whatsapp = await db.sequelize.transaction();

                try {
                    const jsonString_whatsapp = JSON.stringify(externalApiResponse_whatsapp);
                    let meta_data_final_whatsapp = {};
                    let vendtoken = '';
                    let vendunit = '';
                    let receiptmeta_email = '';
                    let convenienceFee = '';

                    if (externalApiResponse_whatsapp.responseCode == '00' && externalApiResponse_whatsapp.status == 'success') {

                        const details_whatsapp = externalApiResponse_whatsapp.responseData;
                        const convenienceFee_whatsapp = parseFloat(details_whatsapp.convenienceFee) || 0;

                        // const profit_whatsapp = dfee_whatsapp - convenienceFee_whatsapp;

                        if (theProduct_whatsapp == 'electricity' || theProduct_whatsapp == 'education') {
                            const tokenData = details_whatsapp['tokenData'] && details_whatsapp['tokenData']['stdToken'] ? details_whatsapp['tokenData']['stdToken'] : {};

                            vendtoken = tokenData['value'] || '';
                            vendunit = tokenData['units'] || '';

                            const receiptNumber = tokenData['receiptNumber'] || '';
                            meta_data_final_whatsapp = { productid: productCodeForExternalCall_whatsapp, dataplan_whatsapp, custname_whatsapp, address_whatsapp, token: vendtoken, unit: vendunit, metertype: datatype_whatsapp, receiptNumber, providercomm: ProviderComm };

                            receiptmeta_email = `
                            <tr><td><p>Customer Name</p></td><td><p>${custname_whatsapp}</p></td></tr>
                            <tr><td><p>Address</p></td><td><p>${address_whatsapp || 'N/A'}</p></td></tr>
                            <tr><td><p>Token/PIN</p></td><td><p>${vendtoken}</p></td></tr>
                            <tr><td><p>Unit</p></td><td><p>${vendunit}</p></td></tr>`;

                        } else if (theProduct_whatsapp === 'airtime') {
                            meta_data_final_whatsapp = { productid: productCodeForExternalCall_whatsapp, dataplan_whatsapp, custname_whatsapp, metertype: datatype_whatsapp, providercomm: ProviderComm };
                            receiptmeta_email = `<tr><td><p>Cashback</p></td><td><p>N${formatAmount(Math.abs(dfee_whatsapp))}</p></td></tr>`;
                        } else {
                            meta_data_final_whatsapp = { productid: productCodeForExternalCall_whatsapp, dataplan_whatsapp, custname_whatsapp, address_whatsapp, metertype: datatype_whatsapp, providercomm: ProviderComm };
                            if (theProduct_whatsapp == 'electricity' || theProduct_whatsapp == 'education') {
                                receiptmeta_email = `<tr><td><p>Customer Name</p></td><td><p>${custname_whatsapp}</p></td></tr>`;
                            }
                        }

                        await Payn.update({
                            status: 1, productid: details_whatsapp.transactionId, jsonresp: jsonString_whatsapp, meta: JSON.stringify(meta_data_final_whatsapp), revenue: calculatedProfit, providerfee: actualProviderFee
                        }, { where: { txref: txref_whatsapp, userid: userid }, transaction: t_whatsapp }
                        );

                        await t_whatsapp.commit();

                        // await logReferEarn(userid, txref_whatsapp);

                        // mailSender, pushNotify as in processPayment
                        var receipt = `
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname}<span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            Your ${modifyprd_whatsapp} transaction with reference - ${txref_whatsapp} was successful.
                        </p>
                        <h3>Transaction Details</h3>
                        <table style="width: 100%; color: #54424d; font-size: 15px; font-weight: 500;" class="cke_show_border" cellspacing="1" cellpadding="1" border="0">
                            <tbody class="transbody">
                                <tr><td><p>Amount</p></td><td><p>N${formatAmount(amountval_whatsapp)}</p></td></tr>
                                <tr><td><p>Product</p></td><td><p>${ucFirst(modifyprd_whatsapp)}</p></td></tr>
                                <tr><td><p>Fee</p></td><td><p>N${formatAmount(dfee_whatsapp)}</p></td></tr>
                                <tr><td><p>Recipient Number</p></td><td><p>${recipientno}</p></td></tr>
                                <tr><td><p>Provider/Network</p></td><td><p>${ntwk_provider}</p></td></tr>
                                <tr><td><p>Description</p></td><td><p>${pay_desc_whatsapp}</p></td></tr>
                                <tr><td><p>Transaction Reference</p></td><td width="50%"><p>${txref_whatsapp}</p></td></tr>
                                <tr><td><p>Transaction Date</p></td><td width="50%"><p>${moment.unix(timed_whatsapp).format("Do MMM, YYYY hh:mm a")}</p></td></tr>
                                ${receiptmeta_email}
                            </tbody>
                        </table>`;

                        mailSender(fname, 'Transaction Receipt', useremail, receipt);

                        pushNotify(userid, 'Transaction Notice - HitchPay', `Your N${formatAmount(amountval_whatsapp)} ${modifyprd_whatsapp} purchase was successful.`);

                        res.json({
                            status: true,
                            // message: details_whatsapp.narration || 'Transaction Successful (WhatsApp)',
                            message: 'Payment Successful',
                            data: {
                                amount: amountval_whatsapp, amountcharged: topay_whatsapp, fee: dfee_whatsapp, product: modifyprd_whatsapp, provider: ntwk_provider,
                                reference: txref_whatsapp, vendunit, vendtoken, walbal: await getBal(userid, 'NGN'), // Fetch fresh balance
                                paystatus: 'Successful', transtimed: moment.unix(timed_whatsapp).format("Do MMM, YYYY hh:mm a")
                            }
                        });


                    } else if (externalApiResponse_whatsapp.responseCode == '06') {
                        //Outrihtly failed

                        await t_whatsapp.rollback();

                        console.error(`External API call unsuccessful for ${txref_whatsapp}: ${externalApiResponse_whatsapp.message}. Initiating refund(whatsapp).`);

                        await Payn.update(
                            { status: 5, jsonresp: jsonString_whatsapp, productid: externalApiResponse_whatsapp.responseData?.transactionId || '' },
                            { where: { txref: txref_whatsapp, userid: userid } }
                        );


                        /* REFUND IT */
                        const refundTransaction_whatspp = await db.sequelize.transaction();

                        try {
                            // Use existing userbal from before debit
                            const currentBalanceBeforeRefund = await getBal(userid, 'NGN', { transaction: refundTransaction_whatspp });

                            const newBalanceAfterRefund = await updateBalance(userid, topay_whatsapp, 'NGN', 'credit', { transaction: refundTransaction_whatspp });

                            const refundTxRef = `REF_${txref_whatsapp}`;
                            await Payn.create({
                                userid: userid, amount: topay_whatsapp, amountval: amountval_whatsapp, newbal: newBalanceAfterRefund, prevbal: currentBalanceBeforeRefund, txref: refundTxRef, pfor: 'REFUND', usertype: 'user', paytype: 'credit', productid: txref_whatsapp, ntwk: ntwk_provider, paidthru: 'System Refund', pay_desc: `Refund for failed transaction ${txref_whatsapp}`,
                                timed: Math.floor(Date.now() / 1000), status: 1, recipient: recipientno, fee: 0,
                                payroute: 'whatsapp', currency: 'NGN', revenue: 0, providerfee: 0
                            }, { transaction: refundTransaction_whatspp }
                            );

                            await refundTransaction_whatspp.commit();

                            console.log(`Refund successful for ${txref_whatsapp}.`);

                            mailSender(fname, 'Transaction Failed & Refunded', useremail, `Your transaction ${txref_whatsapp} for ${modifyprd_whatsapp} failed and N${formatAmount(topay_whatsapp)} has been refunded to your wallet.`);

                            pushNotify(userid, 'Transaction Failed - HitchPay', `Your ${modifyprd_whatsapp} transaction ${txref_whatsapp} failed and has been refunded.`);

                        } catch (refundError) {
                            await refundTransaction_whatspp.rollback();

                            console.error(`CRITICAL: Refund failed for ${txref_whatsapp} after external API failure. User has been debited. Manual intervention required. Error: ${refundError.message}`);

                            mailSender(fname, 'Transaction Failed - Refund Pending', useremail, `Your transaction ${txref_whatsapp} for ${modifyprd_whatsapp} failed. We are processing your refund. Please contact support if not resolved soon.`);

                            pushNotify(userid, 'Transaction Failed - HitchPay', `Your ${modifyprd_whatsapp} transaction ${txref_whatsapp} failed. Refund is being processed.`);

                        }

                        res.status(400).json({ status: false, message: externalApiResponse_whatsapp.message || 'Transaction failed with provider.' });

                    } else {
                        // External API call failed or was not successful
                        await t_whatsapp.rollback();

                        console.error(`External API call unsuccessful for ${txref_whatsapp}: ${externalApiResponse_whatsapp.message}. Transaction held for TSQ.`);
                        await Payn.update(
                            { jsonresp: jsonString, productid: externalApiResponse_whatsapp.responseData?.transactionId || '' },
                            { where: { txref: txref_whatsapp, userid: userid } }
                        );

                        // No need for separate refund logic here if debit is rolled back
                        res.status(400).json({ status: false, message: externalApiResponse_whatsapp.message || 'Transaction failed with provider (WhatsApp).' });

                    }

                } catch (paymentError_whatsapp) {
                    await t_whatsapp.rollback();

                    console.error(`Error during whatsAppPayment finalization for ${txref}:`, paymentError_whatsapp.message);
                    // res.status(400).json({ status: false, message: 'Transaction processing encountered an issue. Please check your history or contact support.' })

                    // Pass to global error handler
                    return next(paymentError_whatsapp);
                }
            } else {
                res.status(400).json({
                    status: false,
                    message: `Your balance is too low for this NGN ${formatAmount(amountval_whatsapp)} transaction. Please top up to proceed`
                })
            }

        } catch (outerError_whatsapp) {
            console.error("Error in whatsAppPayment (outer):", outerError_whatsapp.message);
            if (!res.headersSent) {
                if (outerError_whatsapp.message.startsWith("Insufficient funds") || outerError_whatsapp.message.startsWith("Wallet not found")) {
                    return res.status(400).json({ status: false, message: outerError_whatsapp.message });
                }

                next(outerError_whatsapp);
            }
        }

    });

}

const OutflowToday = async (userid) => {
    const startOfToday = moment().startOf('day').unix(); // Get start of today in UNIX timestamp
    const endOfToday = moment().endOf('day').unix(); // Get end of today in UNIX timestamp

    const totalOutflow = await Payn.sum('amount', {
        where: {
            userid: userid,
            paytype: 'debit',
            status: 1,
            timed: { [Op.between]: [startOfToday, endOfToday] }
        }
    }) || 0;

    return totalOutflow;
}


const refundPendingTransactions = async (req, res) => {
    try {
        const twoHoursAgo = moment().subtract(1, 'hours').unix();
        const pendingTransactions = await Payn.findAll({
            where: {
                status: 0,
                paytype: 'debit',
                prevbal: { [Op.gt]: db.sequelize.col('newbal') },
                [Op.and]: db.sequelize.where(
                    db.sequelize.literal('`prevbal` - `newbal`'),
                    Op.eq, db.sequelize.col('amount')
                ),
                timed: { [Op.lte]: twoHoursAgo },
            },
        });

        if (pendingTransactions.length === 0) {
            console.log('No pending transactions found to refund.');
            return res.json({
                status: true,
                message: 'No pending transactions found to refund.'
            })
        }

        let successCount = 0;
        let failureCount = 0;
        let reconciledAsSuccessCount = 0;

        for (const transaction of pendingTransactions) {

            const { userid, amount: debitedAmount, txref, prevbal, newbal, pfor, ntwk, recipient, payroute } = transaction;

            // Start a new transaction for each refund operationt
            const wasDebitedForThisTx = parseFloat(prevbal) > parseFloat(newbal) && (parseFloat(prevbal) - parseFloat(newbal) === parseFloat(debitedAmount));

            const refundTx = await db.sequelize.transaction();


            try {
                let todoAction;
                let coralVendStatus = null;

                if (pfor.toLowerCase() != 'transfer' && pfor.toLowerCase() != 'wallet' && pfor.toLowerCase() != 'refund') {

                    // Only for bill payments
                    try {
                        const coralConfig = {
                            method: 'get',
                            url: `${process.env.CORAL_URL}/transactions/payment-lookup/?paymentReference=${txref}`,
                            headers: { 'Authorization': `Basic ${process.env.CORAL_AUTH}` },
                        };

                        const coralResponse = (await axios.request(coralConfig)).data;

                        if (coralResponse.responseCode == '00' && coralResponse.status == 'success') {
                            coralVendStatus = coralResponse.responseData.vendStatus; // e.g., CONFIRMED, FAILED, PENDING
                        }

                    } catch (coralError) {
                        console.warn(`CoralPay lookup failed for ${txref}: ${coralError.message}. Assuming refund might be needed.`);
                    }
                }

                if (coralVendStatus === 'CONFIRMED') {
                    // Value was given. Update our record to success. No refund.
                    await Payn.update({ status: 1 }, { where: { txref: txref }, transaction: refundTx });

                    await refundTx.commit();

                    reconciledAsSuccessCount++;
                    console.log(`Transaction ${txref} reconciled as successful based on provider status.`);
                    continue;
                }

                // If not CONFIRMED (i.e., FAILED, PENDING for too long, or lookup error), proceed with refund logic IF user was debited.
                if (!wasDebitedForThisTx) {
                    // User was not actually debited for this txref, or debit was rolled back.
                    // Mark as failed, no refund needed.
                    await Payn.update({ status: 5, pay_desc: `${transaction.pay_desc} (Marked failed - no debit found)` }, { where: { txref: txref }, transaction: refundTx });

                    await refundTx.commit();

                    failureCount++;
                    // Or a different counter for "reconciled_failed_no_debit"

                    console.log(`Transaction ${txref} for user ${userid} marked as failed (no debit or debit mismatch). No refund processed.`);
                    continue;
                }

                // Proceed with refund as user was debited and value likely not given or status is uncertain/failed

                const userinfo = await getUserInfo(userid, { transaction: refundTx });

                // Ensure getUserInfo can accept transaction
                const fname = userinfo.firstname;
                const useremail = userinfo.email;
                const userbal_before_refund = await getBal(userid, 'NGN', { transaction: refundTx });

                const newbal_after_refund = await updateBalance(userid, debitedAmount, 'NGN', 'credit', { transaction: refundTx });

                // Mark original as refunded
                await Payn.update(
                    { status: 3, pay_desc: `${transaction.pay_desc} (Refunded)` },
                    { where: { txref: txref }, transaction: refundTx }
                );

                const refund_log_ref = `${txref}_REFUND`;
                const refund_pay_desc = `Refund for ${pfor} (Ref: ${txref})`;
                const refund_timed = Date.parse(new Date()) / 1000;

                // Log the refund action
                await Payn.create({
                    userid: userid, amount: debitedAmount, amountval: debitedAmount, newbal: newbal_after_refund, prevbal: userbal_before_refund,
                    txref: refund_log_ref, pfor: 'REFUND', usertype: 'user', paytype: 'credit', productid: txref, ntwk: ntwk, paidthru: 'System Refund', pay_desc: refund_pay_desc, timed: refund_timed, status: 1, recipient: recipient, fee: 0, payroute: 'cronjob', currency: 'NGN', revenue: 0, providerfee: 0
                }, { transaction: refundTx }
                );

                await refundTx.commit();

                successCount++;
                console.log(`Successfully refunded ${debitedAmount} for transaction ${txref} to user ${userid}`);

                // Send notifications (outside transaction)
                const emailContent = `
                <div>
                    <div class="greybg" style="padding: 30px 20px;">
                        <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                            Hello ${fname || 'Customer'}<br>
                            Your ${pfor} transaction (Ref: ${txref}) failed or was pending for too long and has been refunded to your wallet.
                        </p>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                </div>`;

                mailSender(fname, 'Transaction Refund - HitchPay', useremail, emailContent);

                // mailSender(fname, 'Transaction Refund - HitchPay', 'ojidex17@gmail.com', emailContent);

                const notifyDesc = `Your ${pfor} transaction (Ref: ${txref}) failed/pending and has been refunded.`;

                notifyMe(userid, 'Transaction Refund', 'user', notifyDesc);

                pushNotify(userid, 'Transaction Refund - HitchPay', notifyDesc);
                // pushNotify(1, 'Transaction Refund - HitchPay', notedesc)

            } catch (refundError) {
                if (!refundTx.finished) await refundTx.rollback();
                failureCount++;
                console.error(`Failed to process refund for transaction ${txref} (User: ${userid}):`, refundError.message);
            }
        }

        console.log(`Refund process completed. Success: ${successCount}, Reconciled as Success: ${reconciledAsSuccessCount}, Failures: ${failureCount}.`);

        res.json({
            status: true,
            message: `Refund process completed. Success: ${successCount}, Reconciled as Success: ${reconciledAsSuccessCount}, Failures: ${failureCount}.`
        })

    } catch (error) {
        console.error('Error during refund process:', error);
        res.status(400).json({
            status: false,
            message: `Error during refund process: ${error.message}`
        })
    }
}


const transStatus = async (req, res) => {
    try {
        // const admid = req.user.id;
        // if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const { reference } = cleanMe(req.params);
        if (!reference) {
            return res.status(400).json({ status: false, message: 'Oops! No transaction selected' });
        }



        const localTransaction = await Payn.findOne({
            where: { txref: reference }
        });

        if (!localTransaction) {
            return res.status(404).json({ status: false, message: 'Transaction not found locally.' });
        }

        // Determine provider and call appropriate status check
        let providerResponseData = null;
        let providerStatusMessage = "";

        if (localTransaction.pfor && (localTransaction.pfor.toLowerCase() === 'transfer' || localTransaction.pfor.toLowerCase() === 'wallet')) {
            // Assuming productid stores the sessionId for SafeHaven transfers
            // var respSessionId = JSON.parse(localTransaction.jsonresp).data.sessionId
            // const sessionId = localTransaction.productid != '' ? localTransaction.sessionId : respSessionId;

            let sessionId = localTransaction.productid;
            // Fallback to parsing the full JSON response if productid is missing
            if (!sessionId && localTransaction.jsonresp) {
                try {
                    const parsedResp = JSON.parse(localTransaction.jsonresp);
                    // Safely access nested property
                    sessionId = parsedResp?.data?.sessionId;
                } catch (e) {
                    console.error(`Failed to parse jsonresp for txref ${reference}:`, e.message);
                }
            }

            if (sessionId) {
                try {
                    const gettoken = await shAcessToken();
                    if (gettoken[0]) {
                        const shConfig = {
                            method: 'POST',
                            url: `${process.env.SH_BASEURL}/transfers/status`,
                            headers: {
                                accept: 'application/json', ClientID: gettoken[2],
                                'content-type': 'application/json', authorization: `Bearer ${gettoken[1]}`
                            },
                            data: { sessionId: sessionId }
                        };
                        const shResponse = (await axios.request(shConfig)).data;

                        providerResponseData = shResponse;
                        providerStatusMessage = {
                            "Provider TQS Message:": shResponse.message,
                            "Provider TSQ Status:": shResponse.data.status
                        }
                    } else {
                        providerStatusMessage = "Could not get SafeHaven token for status check.";
                    }
                } catch (shError) {
                    console.error("SafeHaven status check error:", shError.message);
                    providerStatusMessage = "Error fetching status from SafeHaven.";
                    providerResponseData = { error: shError.message, response: shError.response?.data };
                }
            } else {
                providerStatusMessage = "SafeHaven session ID not found for this transaction.";
            }
        } else {
            try {
                const coralConfig = {
                    method: 'get',
                    url: `${process.env.CORAL_URL}/transactions/payment-lookup/?paymentReference=${reference}`,
                    headers: { 'Authorization': `Basic ${process.env.CORAL_AUTH}` },
                };
                const coralResponse = (await axios.request(coralConfig)).data;
                providerResponseData = coralResponse;
                providerStatusMessage = coralResponse.message || "Fetched from CoralPay.";
            } catch (coralError) {
                console.error("CoralPay status check error:", coralError.message);
                providerStatusMessage = "Error fetching status from CoralPay.";
                providerResponseData = { error: coralError.message, response: coralError.response?.data };
            }
        }



        res.json({
            status: true,
            message: 'Transaction Status Fetched',
            data: {
                // localDetails: localTransaction, // Send full local details
                providerStatus: providerStatusMessage,
                providerResponse: providerResponseData
            }
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Transaction no found' });
        console.log("get trans status Error: ", error.message);
    }

}


const doRefund = async (req, res) => {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });
    const getadm = await Admin.findOne({ where: { id: adminid } });

    if (!getadm)
        return res.json({ status: false, message: 'Something went wrong please reload the page' });

    const { reference } = req.params;
    if (!reference) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

    const t = await db.sequelize.transaction();
    try {

        const originalTx = await Payn.findOne({ where: { txref: reference }, transaction: t });

        if (!originalTx) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Transaction not found.' });
        }

        if (originalTx.status == 3) { // Already Refunded
            await t.rollback();
            return res.status(409).json({ status: false, message: 'Conflict: Transaction already refunded.' });
        }

        if (originalTx.status == 1 && originalTx.paytype === 'credit') { // Cannot refund a successful credit this way
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Invalid operation: Cannot manually refund a successful credit transaction via this endpoint.' });
        }

        const amountToRefund = parseFloat(originalTx.amount);
        const userid = originalTx.userid;

        const userinfo = await getUserInfo(userid, { transaction: t }); // Pass transaction if getUserInfo supports it
        if (!userinfo) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'User for the transaction not found.' });
        }
        const firstname = userinfo.firstname;
        const useremail = userinfo.email;

        const userbal_before_refund = await getBal(userid, originalTx.currency, { transaction: t });

        const newbal_after_refund = await updateBalance(userid, amountToRefund, originalTx.currency, 'credit', { transaction: t });

        let timed_refund = Date.parse(new Date()) / 1000;
        const refund_ref = `${originalTx.txref}_REFUND`; // More unique refund ref
        const refund_pay_desc = `Refund for ${originalTx.pfor} (Tx: ${originalTx.txref})`;

        await Payn.create({ // Log the refund transaction
            userid: userid, amount: amountToRefund, amountval: amountToRefund, newbal: newbal_after_refund, prevbal: userbal_before_refund, currency: originalTx.currency,
            txref: refund_ref, pfor: 'REFUND', usertype: 'user', paytype: 'credit', productid: originalTx.txref,
            ntwk: originalTx.ntwk, paidthru: 'Refund', pay_desc: refund_pay_desc, timed: timed_refund,
            status: 1, // Refund is successful
            recipient: originalTx.recipient, fee: 0, payroute: 'admin', revenue: 0, providerfee: 0
        }, { transaction: t });

        await Payn.update({ status: 3, pay_desc: `${originalTx.pay_desc}` }, { where: { txref: reference, userid: userid }, transaction: t });

        await t.commit();

        logAudit(adminid, `Manual refund of ${originalTx.currency}${formatAmount(amountToRefund)} for Tx: ${reference} (Product: ${originalTx.pfor})`);
        const notifyDesc = `A refund of ${originalTx.currency}${formatAmount(amountToRefund)} for your ${originalTx.pfor} transaction (Ref: ${reference}) has been processed.`;
        notifyMe(userid, 'Transaction Refund - HitchPay', 'user', notifyDesc);
        pushNotify(userid, 'Transaction Refund - HitchPay', notifyDesc);

        const emailReceipt = `
            <p>Hello ${firstname || 'Customer'},</p>
            <p>Your ${originalTx.pfor} transaction (Ref: ${reference}) has been refunded.</p>
            <h3>Refund Details</h3>
            <table style="width: 100%;" border="0">
                <tr><td>Amount Refunded:</td><td>${originalTx.currency} ${formatAmount(amountToRefund)}</td></tr>
                <tr><td>Original Product:</td><td>${originalTx.pfor}</td></tr>
                <tr><td>Refund Reference:</td><td>${refund_ref}</td></tr>
                <tr><td>Date:</td><td>${moment.unix(timed_refund).format("Do MMM, YYYY hh:mm a")}</td></tr>
            </table>`;
        mailSender(firstname, 'Transaction Refund - HitchPay', useremail, emailReceipt);

        return res.json({ status: true, message: 'Transaction Refunded Successfully.' });

    } catch (error) {
        if (t.finished !== 'commit' && t.finished !== 'rollback') {
            await t.rollback();
        }
        console.log('trans refund catch ERROR: ' + error.message)

        res.status(400).json({
            status: false,
            message: `Error during refund process: ${error.message}`
        })
    }
}

const doPayUpd = async (req, res) => {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

    const getadm = await Admin.findOne({ where: { id: adminid } });
    if (!getadm)
        return res.json({ status: false, message: 'Something went wrong please reload the page' });

    const { reference, type } = req.params;
    if (!reference) return res.json({ status: false, message: 'Eh! Invalid reference request sent!' });

    const t = await db.sequelize.transaction();

    try {
        const getdetails = await Payn.findOne({ where: { txref: reference }, transaction: t });

        if (!getdetails) {
            await t.rollback();
            return res.json({ status: false, message: 'No payment found for you' });
        }

        if (type == 'complete') {

            if (getdetails.status == 1) {
                await t.rollback();
                return res.json({ status: false, message: 'Transaction already completed' });
            }

            /* UPDATE THE TRANCTION AS COMPLETTED */
            await Payn.update({ status: 1 }, { where: { txref: reference }, transaction: t });

            await t.commit();

            var auditdesc = `Updated N${formatAmount(getdetails.amount)} for ${getdetails.pfor} with the payment of ${reference} as completed`;
            logAudit(adminid, auditdesc);

            return res.json({
                status: true,
                message: 'Transaction Marked Completed',
            });


        } else if (type == 'recharge' || type == 'charge back') {
            if (getdetails.status == 4) {
                await t.rollback();
                return res.json({ status: false, message: 'Transaction already re-charged' });
            }

            var amount = getdetails.amount;
            var amountval = getdetails.amountval;
            var fee = getdetails.fee;
            const userid = getdetails.userid

            const userinfo = await getUserInfo(userid, { transaction: t });
            const firstname = userinfo.firstname;
            const lastname = userinfo.lastname;
            const sendername = userinfo.lastname + ' ' + userinfo.firstname;
            const useremail = userinfo.email;

            const userbal = await getBal(userid, getdetails.currency, { transaction: t });

            // re-charge the amount to the user's wallet            
            const newbal = await updateBalance(userid, amount, getdetails.currency, 'debit', { transaction: t });

            /* LOG REFUND */
            let timed = Date.parse(new Date()) / 1000;
            const dref = `${getdetails.txref}_CHARGEBACK`;

            const pay_desc = `Transaction re-charge for ${getdetails.txref}`

            await Payn.create({
                userid: userid, amount: amount, amountval: amount, newbal: newbal, prevbal: userbal, currency: getdetails.currency,
                txref: dref, pfor: 'CHARGEBACK', usertype: 'user', paytype: 'debit', productid: getdetails.txref, ntwk: getdetails.ntwk, paidthru: 'Wallet', pay_desc: pay_desc, timed: timed, status: 1, recipient: getdetails.recipient, fee: 0, payroute: 'admin', revenue: 0, providerfee: 0
            }, { transaction: t });

            /* UPDATE THE TRANCTION AS chargeback */
            await Payn.update({ status: 4 }, { where: { txref: reference, userid: userid }, transaction: t });

            await t.commit(); //commit and close trasnaction

            var auditdesc = `Make a  chargeback of N${formatAmount(amount)} for ${getdetails.pfor} with the payment of ${reference}`;

            logAudit(adminid, auditdesc);

            var notedesc = `You've just got a chargeback of N${formatAmount(amount)} for ${getdetails.pfor} with the payment of ${reference}`;

            notifyMe(userid, 'Chargeback Notice - HitchPay', 'user', notedesc)
            pushNotify(userid, 'Chargeback Notice - HitchPay', notedesc)

            var receipt = `
            <p style="line-height: 20px; letter-spacing: 0.025em;">
                Hello ${firstname}<span style="font-size: 18px;"></span></p>
                <p style="line-height: 28px; letter-spacing: 0.025em;">
                Your wallet has been charged back for the ${getdetails.pfor} transaction with the reference - ${reference}.
            </p>

            <h3>Chargeback Details</h3>
            <table style="width: 100%; color: #54424d; font-size: 15px; font-weight: 500;" class="cke_show_border" cellspacing="1" cellpadding="1" border="0">
                <tbody class="transbody">
                    <tr><td><p>Amount</p></td><td><p>N${formatAmount(amount)}</p></td></tr>
                    <tr><td><p>Product</p></td><td><p>${getdetails.pfor}</p></td></tr>
                    <tr><td><p>Fee</p></td><td><p>N${formatAmount(0)}</p></td></tr>
                    <tr><td><p>Chargeback Reference</p></td><td width="50%"><p>${dref}</p></td></tr>
                    <tr><td><p>Chargeback Date</p></td><td width="50%"><p>${moment.unix(timed).format("Do MMM, YYYY hh:mm a")}</p></td></tr>
                </tbody>
            </table>

        `;

            mailSender(firstname, 'Chargeback Notice - HitchPay', useremail, receipt);

            return res.json({
                status: true,
                message: 'Transaction Chargeback Completed',
            });

        } else {
            await t.rollback();
            return res.json({
                status: false,
                message: 'Action not availbale',
            });
        }

    } catch (error) {
        if (t.finished !== 'commit' && t.finished !== 'rollback') {
            await t.rollback();
        }
        console.log('trans refund catch ERROR: ' + error.message)

        res.status(400).json({
            status: false,
            message: `Error trans refund process: ${error.message}`
        })
    }
}


async function compileDailySettlement() {
    const scriptStartTime = moment().format('YYYY-MM-DD HH:mm:ss');
    console.log(`[${scriptStartTime}] Starting daily settlement compilation script.`);

    const yesterday = moment().subtract(1, 'days');
    const yesterdayStartUnix = yesterday.startOf('day').unix();
    const yesterdayEndUnix = yesterday.endOf('day').unix();
    const settlementDateForDB = yesterday.format('YYYY-MM-DD');

    try {
        const settlementData = await Payn.findOne({
            attributes: [
                [fn('SUM', col('revenue')), 'total_revenue_for_day'],
                [fn('COUNT', col('id')), 'total_transactions_for_day']

            ],
            where: {
                status: 1,
                timed: {
                    [Op.between]: [yesterdayStartUnix, yesterdayEndUnix]
                }
            },
            raw: true
        });

        console.log('settlementData', settlementData)

        const totalRevenue = settlementData ? parseFloat(settlementData.total_revenue_for_day) || 0 : 0;
        const totalTransactions = settlementData ? parseInt(settlementData.total_transactions_for_day) || 0 : 0;
        const unixTimestamp = moment(settlementDateForDB, "YYYY-MM-DD").unix();

        console.log(`Data for ${settlementDateForDB}: Total Revenue = ${totalRevenue}, Total Transactions = ${totalTransactions}`);

        // Check if a record for this date already exists
        const existingSettlement = await RevenueBank.findOne({
            where: { dated: unixTimestamp }
        });

        console.log('existingSettlement', existingSettlement)
        /* 


        if (existingSettlement) {
            // Update existing record
            await RevenueBank.update({
                amount: totalRevenue,
                totalcount: totalTransactions,
                settleby: '',
                status: 0,
            }, {
                where: { dated: unixTimestamp }
            });
            console.log(`Updated settlement record for ${settlementDateForDB}.`);
        } else {
            // Create new record
            await RevenueBank.create({
                dated: unixTimestamp,
                amount: totalRevenue,
                totalcount: totalTransactions,
                settleby: '',
                status: 0
            });

            console.log(`Created new settlement record for ${settlementDateForDB}.`);
        } */

        console.log(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Daily settlement compilation finished successfully for ${settlementDateForDB}.`);

    } catch (error) {
        console.error(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Error during daily settlement compilation for ${settlementDateForDB}:`, error);
    } finally {

    }
}

async function logDailyRevenue(req, res) {
    const currentYear = moment().year();
    // const yesterdayStartUnix = moment(`${currentYear}-06-27`).startOf('day').unix();
    // const yesterdayEndUnix = moment(`${currentYear}-06-27`).endOf('day').unix();
    // const settlementDateForDB = yesterdayStartUnix

    const yesterday = moment().subtract(1, 'days');
    const yesterdayStartUnix = yesterday.startOf('day').unix();
    const yesterdayEndUnix = yesterday.endOf('day').unix();
    const settlementDateForDB = yesterday.format('YYYY-MM-DD');

    const startFomart = moment.unix(yesterdayStartUnix)
    const endFomart = moment.unix(yesterdayEndUnix)

    console.log(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Starting revenue compilation script for ${currentYear}.`);

    console.log(`Period: ${startFomart} to ${endFomart}`);


    try {
        const settlementData = await Payn.findOne({
            attributes: [
                [fn('SUM', col('revenue')), 'total_revenue_for_period'],
                [fn('COUNT', col('id')), 'total_transactions_for_period']
            ],
            where: {
                status: 1,
                timed: {
                    [Op.between]: [yesterdayStartUnix, yesterdayEndUnix]
                }
            },
            raw: true
        });

        const totalRevenue = settlementData ? parseFloat(settlementData.total_revenue_for_period) || 0 : 0;
        const totalTransactions = settlementData ? parseInt(settlementData.total_transactions_for_period) || 0 : 0;


        const datedForRevenueBank = Date.parse(new Date()) / 1000;;

        console.log(`Data for ${currentYear}: Total Revenue = ${totalRevenue}, Total Transactions = ${totalTransactions}`);

        const existingSettlement = await RevenueBank.findOne({
            where: {
                datefrom: yesterdayStartUnix,
                dateto: yesterdayEndUnix
            }
        });

        const txref = 'HCH' + md5(randomstring.generate(5) + 'RV').toUpperCase().substring(0, 12);

        if (existingSettlement) {
            // Update existing record for this specific May 1-31 period
            await RevenueBank.update({
                amount: totalRevenue,
                totalcount: totalTransactions,
                status: 0, // Or your desired status
                dated: datedForRevenueBank // Keep the settlement date consistent
            }, {
                where: { id: existingSettlement.id } // Update by its ID
            });
            console.log(`Updated settlement record for ${startFomart} to ${endFomart}`);
        } else {
            // Create new record for this specific May 1-31 period
            await RevenueBank.create({
                dated: datedForRevenueBank, // Represents the start of the settlement period
                datefrom: yesterdayStartUnix,
                dateto: yesterdayEndUnix,
                amount: totalRevenue,
                reference: txref,
                totalcount: totalTransactions,
                settleby: '',
                status: 0 // Or your desired status
            });
            console.log(`Created new settlement record for ${startFomart} to ${endFomart}`);
        }

        console.log(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Revenue compilation finished successfully for ${settlementDateForDB}.`);

        res.json({
            status: true,
            message: 'Completed',
        });

    } catch (error) {
        console.error(`[${moment().format('YYYY-MM-DD HH:mm:ss')}] Error during revenue compilation for ${settlementDateForDB}:`, error);
    }
}

// To run the function:
// logDailyRevenue()
//   .then(() => console.log("Script execution finished."))
//   .catch(err => console.error("Script execution failed:", err))
//   .finally(async () => {
//       // Optional: Close database connection if this is a standalone script
//       // await db.sequelize.close();
//   });


const myEarnings = async (req, res) => {

    try {
        const hisid = req.user.id;
        if (!hisid) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

        const gethist = await logEarning.findAll({ order: [['id', 'DESC']], where: { userid: hisid } });

        if (!gethist)
            return res.json({ status: false, message: 'No earnings found for you' });

        const totalCompletedRefferal = await logEarning.sum('amount', { where: { userid: hisid, status: 1, type: 'referral' } });
        const totalReferBonus = await logEarning.sum('amount', { where: { userid: hisid, status: 0, type: 'referral' } });

        // Get current month's start and end timestamps
        const startOfMonth = moment().startOf('month').unix();
        const endOfMonth = moment().endOf('month').unix();

        // Get current year's start and end timestamps
        const startOfYear = moment().startOf('year').unix();
        const endOfYear = moment().endOf('year').unix();

        const totalEarningsThisMonth = await logEarning.sum('amount', {
            where: {
                userid: hisid,
                timed: { [Op.between]: [startOfMonth, endOfMonth] }
            }
        });

        const totalEarningsThisYear = await logEarning.sum('amount', {
            where: {
                userid: hisid,
                timed: { [Op.between]: [startOfYear, endOfYear] }
            }
        });

        const totalEarnings = await logEarning.sum('amount', { where: { userid: hisid } });
        const pendingEarnings = await logEarning.sum('amount', { where: { userid: hisid, status: 0 } });


        const datalist = gethist.map((arrayItem) => ({
            amount: arrayItem.amount,
            amountval: arrayItem.amountval,
            cashbacktype: arrayItem.type,
            product: arrayItem.product,
            transid: arrayItem.txref,
            dated: moment.unix(arrayItem.timed).format("DD/MM/YYYY hh:mm A"),
            thestatus: arrayItem.status == '0' ? 'pending' : arrayItem.status == '1' ? 'settled' : '',
        }));

        res.json({
            status: true,
            message: 'Cashback history retrieved',
            data: {
                totalEarningsThisMonth, totalEarningsThisYear, totalEarnings, pendingEarnings,
                totalCompleted: totalCompletedRefferal == null ? 0 : totalCompletedRefferal,  //total withdrawn
                totalReferBonus: totalReferBonus == null ? 0 : totalReferBonus, //pedning withdrw
                history: datalist,

            },
        });

    } catch (error) {
        console.log('user cashback history catch ERROR: ' + error.message)
    }
}

const withdrawEarning = async (req, res) => {
    try {
        const userid = req.user.id;

        const totalPending = await logEarning.sum('amount', { where: { userid: userid, status: 0 } });

        if (totalPending <= 0)
            return res.json({ status: false, message: 'It seems you are a robot with wrong parameter' });

        const getsett = await AppSett.findOne({ where: { id: 1 } });

        if (!getsett)
            return res.json({ status: false, message: 'Unable to process request. Minimum withdraw parameter not found' });

        if (totalPending < getsett.withdrawmin)
            return res.json({ status: false, message: 'You are not eligible to make withdrawal below expected minimum withdrawable earning' });

        const userinfo = await getUserInfo(userid);  // get user info
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const userphone = userinfo.phoneno;
        const sendername = userinfo.lastname + ' ' + userinfo.firstname;
        const useremail = userinfo.email;

        const userbal = await getBal(userid, 'NGN');

        let curtimed = Date.parse(new Date()) / 1000;
        var totalpayout = totalPending;

        if (userinfo.status != '1')
            return res.json({ status: false, message: 'Your account is not active. Kindly verify your account' });

        if (userinfo.status == '3')
            return res.json({ status: false, message: 'Your account is currently on hold. Kindly contact our support' });

        var newbal = parseFloat(userbal) + totalpayout;
        const txref = 'STP' + md5(randomstring.generate(5) + 'EARN' + userid).toUpperCase().substring(0, 12);
        let timed = Date.parse(new Date()) / 1000;

        // check is the referral account is set
        const referaccntno = getsett.referaccntno;
        if (referaccntno) {

            const gettoken = await shAcessToken();
            if (!gettoken[0]) {
                res.json({
                    status: false,
                    message: 'Service provider unavailable.'
                })
            }

            /* GENERATION SESSION ID FOR ACCOUNT VALIDATION */
            const options1 = {
                method: 'POST',
                url: `${process.env.SH_BASEURL}/transfers/name-enquiry`,
                headers: {
                    accept: 'application/json',
                    ClientID: gettoken[2],
                    authorization: `Bearer ${gettoken[1]}`
                },
                data: { bankCode: '090286', accountNumber: process.env.SH_DEBITACCOUNT }
            };

            let response1 = await axios.request(options1);
            let thedata1 = response1.data;

            if (thedata1.statusCode != 200 && thedata1.responseCode != '00') {
                res.json({
                    status: false,
                    message: 'Service provider unavailable to process request. Try again shortly'
                })
            }

            /* WITHDRAW EARNING FROM BONUS ACCOUNT TO MAIN ACCOUNT */
            var sessionId = thedata1.data.sessionId;
            // console.log('sessionId', sessionId)
            const payload = JSON.stringify({
                saveBeneficiary: false,
                nameEnquiryReference: sessionId, debitAccountNumber: referaccntno,
                beneficiaryBankCode: '090286', beneficiaryAccountNumber: process.env.SH_DEBITACCOUNT, amount: parseFloat(totalpayout),
                narration: `${fname} ${lname} - earnings withdrawal`, paymentReference: txref
            });

            await LogRequest.create({ reference: txref, jsonreq: payload, timed: timed, product: 'withdraw', provider: 'safehaven' });

            const theHeader = {
                accept: 'application/json',
                ClientID: gettoken[2],
                'content-type': 'application/json',
                authorization: `Bearer ${gettoken[1]}`
            };

            const options = {
                method: 'POST',
                url: `${process.env.SH_BASEURL}/transfers`,
                headers: theHeader,
                data: payload
            };

            let response = await axios.request(options);
            ftApiResponse = response.data;

            if (ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') {
                var meta_data = JSON.stringify({ "sourcename": 'HitchPay Earnings', "sourceaccount": '', "sourcebank": "Hitchpay", "custname": "Hitchpay" });

                const logwallet = await Payn.create({
                    userid: userid, recipient: userphone, amount: totalpayout, amountval: totalpayout, fee: 0, revenue: 0, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: txref, pfor: 'reward',
                    usertype: 'user', paytype: 'credit', productid: '',
                    paychannel: 'reward', paidthru: '', meta: meta_data, ntwk: 'Hitchpay',
                    pay_desc: `Earning withdrawal`, timed: timed, status: 1, name: ''
                });


                var newbal = await updateBalance(userid, totalpayout, 'NGN', 'credit');

                const upEarn = await logEarning.update(
                    { status: 1 }, { where: { userid: userid, status: 0 } }
                );

                if (upEarn) {
                    //send email
                    var mailcontent = `
                    <p style="font-size: 16px;">Your earnings withdrawal request has been processed to your wallet.</p>
                    <h2>Withdraw Amount: NGN ${formatAmount(totalpayout)}</h2>
                    <h2>Balance Before: NGN ${formatAmount(userbal)}</h2>
                    <h2>Balance After: NGN ${formatAmount(newbal)}</h2>
                    <p>For support and enquiry please call ${process.env.SITEPHONE} or shoot email to ${process.env.SUPPORTMAIL}</p>
                    `;

                    //send notification
                    var notedesc = `₦${formatAmount(totalpayout)} withdrawal request processed`;
                    await notifyMe(userid, 'Earnings Withdrawal', 'user', notedesc)

                    //SEND FCM
                    await pushNotify(userid, `Earnings Withdrawal`, `Your earnings withdrawal request of NGN ${formatAmount(totalpayout)} has been processed to your wallet.`);

                    await mailSender(fname, 'Earnings Withdrawal', useremail, mailcontent);


                    res.json({
                        status: true,
                        message: 'Withdrawal Request Processed',
                    });


                } else {
                    res.json({
                        status: false,
                        message: 'Unable to process request. Kindly reload and retry'
                    })
                }
            } else {
                res.json({
                    status: false,
                    message: 'Unable to process withdrawal request at the moment. Please try again later'
                })
            }
        } else {
            res.json({
                status: false,
                message: 'System Issue! Request can not be processed at moment. Kindly reach out to our support'
            })
        }

    } catch (error) {
        console.log("Error earning withdrw: ", error.message);
        res.json({ status: false, message: 'Unable to process request' });
    }
}



const SHRepushTrans = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid) {
            return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
        }

        const { sessionid } = req.body;
        if (!sessionid) {
            return res.status(400).json({ status: false, message: 'No Session ID / Reference Entered' });
        }

        const originalTx = await Payn.findOne({ where: { txref: sessionid } });

        if (originalTx) {
            return res.status(404).json({ status: false, message: 'Transaction already process to customer wallet.' });
        }

        let providerStatusMessage = "";
        if (sessionid) {
            try {
                const gettoken = await shAcessToken();
                if (gettoken[0]) {
                    const shConfig = {
                        method: 'POST',
                        url: `${process.env.SH_BASEURL}/transfers/repush`,
                        headers: {
                            accept: 'application/json',
                            ClientID: gettoken[2],
                            'content-type': 'application/json',
                            authorization: `Bearer ${gettoken[1]}`
                        },
                        data: {
                            sessionId: sessionid,
                            type: "SessionId",
                            accountType: "subAccount",
                        }
                    };
                    const shResponse = (await axios.request(shConfig)).data;
                    console.log(shResponse)

                    res.json({ status: true, message: `Provider Response: ${shResponse.message}` });

                } else {
                    providerStatusMessage = "Could not get SafeHaven token for status check.";
                    res.json({ status: false, message: providerStatusMessage });
                }

            } catch (shError) {
                providerStatusMessage = "Error fetching status from SafeHaven.";
                res.json({ status: false, message: shError.message });
            }
        } else {
            providerStatusMessage = "SafeHaven session ID not found for this transaction.";
            res.json({ status: false, message: providerStatusMessage });
        }

    } catch (error) {
        console.error('Unable to process your request :', error.message);
        res.status(500).json({ status: false, message: 'An error occurred while processing request.' });
    }
};


const collateDailyCheckoutSettlements = async (req, res, next) => {
    const { secret } = req.params;
    if (secret !== process.env.CRON_SECRET) {
        return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const t = await db.sequelize.transaction();
    try {
        const today = moment();
        const startOfDay = today.clone().startOf('day').unix();
        const endOfDay = today.clone().endOf('day').unix();

        // Find all successful, unsettled checkout transactions for the day
        const transactionsToSettle = await CheckoutTrans.findAll({
            where: {
                status: 1,
                settled: { [Op.or]: [null, 0] },
                usertype: 'business',
                payment_date: {
                    [Op.between]: [startOfDay, endOfDay]
                }
            },
            attributes: [
                'ownerid',
                'currency',
                [db.sequelize.fn('SUM', db.sequelize.col('payment_amount')), 'gross_amount'],
                [db.sequelize.fn('SUM', db.sequelize.col('fee')), 'total_fee']
            ],
            group: ['ownerid', 'currency'],
            raw: true
        });

        if (transactionsToSettle.length === 0) {
            logger.info('No checkout transactions to settle for today.');
            await t.commit();
            return res.status(200).json({ status: true, message: 'No checkout transactions to settle for today.' });
        }

        for (const group of transactionsToSettle) {
            const { ownerid, currency, gross_amount, total_fee } = group;
            const net_amount = parseFloat(gross_amount) - parseFloat(total_fee);
            const settlement_reference = `SETT${moment().format('YYYYMMDD')}${ownerid}${currency}`;

            // Create a new settlement record
            await db.settlements.create({
                ownerid,
                usertype: 'business',
                gross_amount,
                total_fee,
                net_amount,
                currency,
                settlement_reference,
                settlement_date: today.format('YYYY-MM-DD'),
                status: 'pending'
            }, { transaction: t });

            // Mark the original transactions as settled
            await CheckoutTrans.update(
                {
                    settled: 1,
                    settlemet_reference: settlement_reference
                },
                {
                    where: {
                        ownerid,
                        currency,
                        status: 1,
                        settled: { [Op.or]: [null, 0] },
                        payment_date: { [Op.between]: [startOfDay, endOfDay] }
                    },
                    transaction: t
                }
            );
        }

        await t.commit();
        logger.info(`Successfully collated ${transactionsToSettle.length} settlement group(s).`);
        res.status(200).json({ status: true, message: `Successfully collated ${transactionsToSettle.length} settlement group(s).` });

    } catch (error) {
        await t.rollback();
        logger.error('Error in collateDaily Checkout Settlements:', error);
        next(error);
    }
};

module.exports = {
    transferPayment, BeneficiaryList, initiatePay,
    verifyInitPay, whatsAppPayment, refundPendingTransactions, transStatus,
    doRefund, doPayUpd, myEarnings, withdrawEarning, logDailyRevenue,
    processPaymentNew, initiatePayNew, SHRepushTrans, collateDailyCheckoutSettlements,
    SHTransfer, PSB9Transfer
};