const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
moment.tz.setDefault('Africa/Lagos');
const { mailSender } = require('../../config/mailsender');
const { Op, fn, col } = require("sequelize");
const { getUserInfo, getBal, getLedgerBal } = require("../../config/userdetails");
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
// const crypto = require('crypto');
// const { time, Console } = require('console');
const { formatAmount, cleanMe, ucFirst, calcCheckOutFee, updateLedgerBalance, dispatchEvent } = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { sendWebhook } = require("../../config/sendWebhookHelper");
const { YCPayment } = require('../crossBorderControllers/ycnetwkchannels');
const { shAcessToken } = require('../../config/myfunct');
const { SHTransfer } = require('../paymentController');

// add stripe 
const CheckoutTrans = db.checkouttrans
const payWhk = db.whookhandler;
const RemittancePay = db.remittancepay;
const Payn = db.payn
const ExternaUser = db.kadusers
const LogRequest = db.logrequest;
const LogResponse = db.logresponse;
const RemittanceAccounts = db.remittance_accounts;


const stripeWebhkHandlerTest = async (req, res) => {

    const sig = req.headers['stripe-signature']
    // console.log('signature', sig)
    const endpointSecret = !process.env.STRIPE_WEBHOOK_SECRET ? 'whsec_soW8bBXiP4lfHaYQwDpSANAlm5QbiL7M' : process.env.STRIPE_WEBHOOK_SECRET;

    // Check if the webhook secret is available
    if (!endpointSecret) {
        logger.error('Missing WEBHOOK_SECRET environment variable');
        return res.status(500).send('Webhook Error: Configuration error');
    }


    res.status(200).json({ status: true, message: "STRP Webhook received and queued for processing." });

    let event
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
        logger.error(`Webhook signature verification failed: ${err}`);
        return;
    }

    if (!event || typeof event != 'object' || Object.keys(event).length == 0) {
        logger.warn('Invalid event: Request body is empty or not an object');
        return;
    }

    // const dbody = req.body.toString('utf8'); // Log the original raw body
    let dtimed = Math.floor(Date.now() / 1000);
    event = req.body;
    const dbody = JSON.stringify(event);

    // chec for duplicate notification
    const checkhook = await payWhk.findAll({ where: { txref: event.id, gateway: 'stripe' } });

    if (checkhook.length > 0) {
        console.warn(`[Webhook] Duplicate notification detected for reference: ${event.id}. Ignoring.`);
        return;
    }

    await payWhk.create({ resp: dbody, txref: event.id, gateway: 'stripe', timed: dtimed, processed: 1 });
    


    // Properly handle checkout.session.completed event
    if (event.type == 'checkout.session.completed') {
        const session = event.data.object;

        const amount_total = session.amount_total / 100;
        const payment_intent = session.payment_intent;
        const customer_email = session.customer_email;
        const currency = session.currency;
        const client_reference_id = session.client_reference_id;

        if (amount_total < parseFloat(localTrans.amount)) {
            logger.warn(`Stripe webhook: Received amount ${amount_total} is less than expected ${localTrans.amount} for transaction ${reference}.`);
            await localTrans.update({ status: '3', payment_amount: amount_total, payment_date: Math.floor(Date.now() / 1000) });
            return;
        }

        try {
            // await payWhk.create({ resp: dbody, txref: client_reference_id || '', gateway: 'stripe', timed: dtimed, processed: 0 });
            await CheckoutTrans.update(
                { status: '1', payment_amount: amount_total, paidthru: 'stripe', payment_date: dtimed }, { where: { reference: client_reference_id } }
            );

            // send webhook notification to merchant's webhook url if set
            const localTrans = await CheckoutTrans.findOne({ where: { provref: client_reference_id } });
            if (localTrans) {
                const webhookResult = await sendWebhook({
                    bizid: localTrans.ownerid, event: 'payment.success',
                    payreference: localTrans.reference,
                    data: {
                        reference: localTrans.reference,
                        amount: formatAmount(localTrans.amount),
                        amount_paid: formatAmount(localTrans.payment_amount),
                        amount_settled: formatAmount(settledAmount),
                        currency: localTrans.currency,
                        charged_fee: formatAmount(localTrans.fee),
                        whopay_fee: 'customer',
                        payment_date: moment.unix(localTrans.payment_date).local().format("Do MMM, YYYY hh:mm a"),
                        payment_unixtime: localTrans.payment_date,
                        merchant_reference: localTrans.external_reference,
                        redirect_url: localTrans.redirecturl,
                        env_mode: localTrans.mode,
                        enable_multicurrency: localTrans.multicurrency == 1 ? true : false,
                        payment_channel: localTrans.paychannel,
                        status: 'success',
                        customer: {
                            name: localTrans.customer_name,
                            email: localTrans.customer_email,
                            phone: ''
                        },
                        description: localTrans.pay_desc,
                    }
                });

            }



        } catch (err) {
            console.error('Error processing webhook:', err);
            logger.error(`Webhook processing error: ${err.message}`);
            // Still return 200 to acknowledge receipt
        }
    } else if (event.type == 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const amount_total = paymentIntent.amount / 100;
        const amount_received = paymentIntent.amount_received / 100;
        const payment_intent = paymentIntent.id;
        const customerId = paymentIntent.customer;
        const currency = paymentIntent.currency;
        const client_reference_id = paymentIntent.client_secret;
        const payment_status = paymentIntent.status;
        const deposit_guid = payment_intent;

        // get the payment with the productid of the deposit id
        const getPayment = await RemittancePay.findOne({ where: { deposit_guid: deposit_guid, provider: 'stripe' } });

        if (getPayment) {
            const txref = getPayment.txref;

            if (getPayment.status === 'completed') {
                console.warn(`[Webhook Stripe GLobalPayment] Duplicate transaction detected for reference: ${txref}. Ignoring.`);
                return;
            }

            // get the transaction payload meta from Payn 
            const getPayn = await Payn.findOne({ where: { provref: deposit_guid } });

            const payload = JSON.parse(getPayn.meta);
            // console.log('Payload from Payn meta', payload);
            const network = getPayn.ntwk;
            const userid = getPayn.userid;
            const accountname = payload.accountname;

            if (network == 'NG') {
                var provider = 'safehaven';
                const accesstoken = await shAcessToken();
                if (!accesstoken[0])
                    throw new Error('Service provider unavailable.');

                const enquirytoken = payload.enquirytoken;
                const bankcode = payload.bankcode;
                const recipientno = payload.recipientno;
                const amount = payload.amount;
                const narration = payload.narration;
                const txref = getPayn.txref;
                // const deposit_guid = getPayn.provref;
                const dtimed = getPayn.timed;
                const currency = payload.currency;

                // route through NGN TRANSFER CHANNEL
                var data = JSON.stringify(payload);
                await LogRequest.create({ reference: deposit_guid, jsonreq: data, timed: dtimed, product: 'globaltransfer', provider: 'yc' });

                // call the TRANSFER FUNCTION
                const ftApiResponse = await SHTransfer(accesstoken, enquirytoken, bankcode, recipientno, amount, narration, txref, dtimed);

                if ((ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') || ftApiResponse.code == '00') {
                    var sessID = ftApiResponse.data.sessionId;

                    // Update the payment status to success
                    await RemittancePay.update(
                        { status: 'completed', jsonresp: dbody },
                        { where: { deposit_guid: deposit_guid, provider: 'stripe' } }
                    );

                    await Payn.update({
                        status: 1, paychannel: provider, productid: sessID,
                        jsonresp: JSON.stringify(ftApiResponse)
                    }, {
                        where: { txref: txref, userid: userid }
                    });

                    pushNotify(userid, 'Transaction Notice - HitchPay', `Your NGN${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`);

                    console.log(`[Webhook] Successfully processed for ${deposit_guid} `);

                    // send email and push notification to the owner
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    const fname = userinfo.firstname;

                    const notedesc = `Your NGN${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`;

                    await notifyMe(userid, 'NGN Transfer Completed', 'user', notedesc);

                    const mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Your NGN transfer of <strong>NGN ${formatAmount(amount)}</strong> to <strong>${accountname}</strong> has been successfully completed.</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Name:</strong> ${accountname}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Account:</strong> ${recipientno}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Bank:</strong> ${bankcode}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Sent:</strong> NGN ${formatAmount(amount)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${txref}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                        <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                    `;
                    await mailSender(fname, 'NGN Transfer Completed', useremail, mailcontent);

                } else {
                    logger.error(`stripe Webhook: NGN Transfer failed for deposit_guid: ${deposit_guid}. Response: ${JSON.stringify(ftApiResponse)}`);
                }

            } else {

                // log request payload
                var data = JSON.stringify(payload);
                await LogRequest.create({ reference: deposit_guid, jsonreq: data, timed: dtimed, product: 'globaltransfer', provider: 'yc' });

                // call the provider
                // console.log('thepayload', payload)

                const paymentResponse = await YCPayment(payload);
                console.log('paymentResponse from hook', paymentResponse)
                if (!paymentResponse || (paymentResponse.status !== 'created' && paymentResponse.status !== 'processing')) {
                    logger.error(`Stripe Webhook: Failed to initiate payment for deposit_guid: ${deposit_guid}`);
                    return
                }

                const jsonString2 = JSON.stringify(paymentResponse);
                if (paymentResponse && (paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process')) {

                    const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
                    const localAmount_convertedAmount = paymentResponse.convertedAmount; //localamount
                    const api_rate = paymentResponse.rate;
                    const api_amount = paymentResponse.amount;
                    const networkName = paymentResponse.destination?.networkName;
                    const api_currency = paymentResponse?.currency;
                    const attempt = paymentResponse.attempt;

                    const payloadDestination = payload.destination
                    // console.log('payloadDestination', payloadDestination)

                    const account_type = payloadDestination.accountType;
                    const account_number = payloadDestination.accountNumber
                    const network_id = payloadDestination.networkId
                    const account_name = payloadDestination.accountName
                    const countrycode = payloadDestination.country

                    const localamount = payload.localAmount;
                    const reason = payload.reason;
                    const channel_id = payload.channel_id;
                    const exchangeRate = getPayn.productid;
                    const topay = getPayn.amount;
                    const main_amount_converted = getPayn.amountval;
                    const feeconvert = getPayn.fee;

                    // prepare meta data
                    const meta_data = JSON.stringify({
                        account_type, account_number, network_id, channel_id, account_name,
                        localamount, reason, countrycode, network_name: networkName, rate: exchangeRate,
                        converted_paycurrency: topay, main_amount_converted, feeconvert
                    });

                    // update the log with provider reference
                    await Payn.update({
                        meta: meta_data,
                    }, { where: { txref: getPayn.txref } });


                    // Update the payment status to success
                    await RemittancePay.update(
                        { status: 'completed', jsonresp: dbody },
                        { where: { deposit_guid: deposit_guid, provider: 'stripe' } }
                    );

                    console.log(`[Webhook] Successfully processed for ${deposit_guid} `);

                    // send email and push notification to the owner
                    const userinfo = await getUserInfo(getPayn.userid);
                    const useremail = userinfo.email;
                    const fname = userinfo.firstname;

                    const notedesc = `Your global transfer of ${getPayn.currency} ${formatAmount(getPayn.amountval)} to ${account_name} has been completed.`;
                    await pushNotify(getPayn.userid, 'Global Transfer Completed', notedesc);
                    await notifyMe(getPayn.userid, 'Global Transfer', 'user', notedesc);

                    const mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Your global transfer of <strong>${getPayn.currency} ${formatAmount(getPayn.amountval)}</strong> to <strong>${account_name}</strong> has been successfully completed.</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Name:</strong> ${account_name}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Account:</strong> ${account_number}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Bank/Network:</strong> ${networkName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Sent:</strong> ${getPayn.currency} ${formatAmount(getPayn.amountval)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Received:</strong> ${api_currency} ${formatAmount(localAmount_convertedAmount)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Exchange Rate:</strong> 1 ${getPayn.currency} = ${api_rate} ${api_currency}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${getPayn.txref}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Payment Channel:</strong> Debit Card</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(getPayn.timed).format("Do MMM, YYYY hh:mm a")}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                        <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                    `;

                    await mailSender(fname, 'Global Transfer Completed', useremail, mailcontent);
                    // await mailSender(fname, 'Global Transfer Completed', 'olajideolatunji@hitchpay.ng', mailcontent);

                } else {
                    logger.error(`stripe Webhook: Payment initiation failed for deposit_guid: ${deposit_guid}. Response: ${jsonString2}`);
                }
            }

        } else {
            logger.warn(`Stripe Webhook: No matching Payn record found for deposit_guid: ${deposit_guid}`);
            return;
        }
    }
}

const stripeWebhkLive = async (req, res) => {
    const { secret } = req.params;
    if (secret !== process.env.CRON_SECRET) {
        return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    const sig = req.headers['stripe-signature']
    // console.log('signature', sig)
    const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

    // Check if the webhook secret is available
    if (!endpointSecret) {
        logger.error('Missing prod WEBHOOK_SECRET environment variable');
        return res.status(500).send('Webhook Error: Configuration error');
    }


    res.status(200).json({ status: true, message: "STRP Webhook received and queued for processing." });

    let event
    try {
        event = stripe.webhooks.constructEvent(req.rawBody, sig, endpointSecret);
    } catch (err) {
        logger.error(`Webhook signature verification failed: ${err}`);
        return;
    }

    if (!event || typeof event != 'object' || Object.keys(event).length == 0) {
        logger.warn('Invalid event: Request body is empty or not an object');
        return;
    }

    // const dbody = req.body.toString('utf8'); // Log the original raw body
    let dtimed = Math.floor(Date.now() / 1000);
    event = req.body;
    const dbody = JSON.stringify(event);

    // chec for duplicate notification
    const checkhook = await payWhk.findAll({ where: { txref: event.id, gateway: 'stripe' } });

    if (checkhook.length > 0) {
        console.warn(`[Webhook] Duplicate notification detected for reference: ${event.id}. Ignoring.`);
        return;
    }

    await payWhk.create({ resp: dbody, txref: event.id, gateway: 'stripe', timed: dtimed, processed: 1 });
    


    // Properly handle checkout.session.completed event
    if (event.type == 'checkout.session.completed') {
        const session = event.data.object;

        const amount_total = session.amount_total / 100;
        const payment_intent = session.payment_intent;
        const customer_email = session.customer_email;
        const currency = session.currency;
        const client_reference_id = session.client_reference_id;

        if (amount_total < parseFloat(localTrans.amount)) {
            logger.warn(`Stripe webhook: Received amount ${amount_total} is less than expected ${localTrans.amount} for transaction ${reference}.`);
            await localTrans.update({ status: '3', payment_amount: amount_total, payment_date: Math.floor(Date.now() / 1000) });
            return;
        }

        try {
            // await payWhk.create({ resp: dbody, txref: client_reference_id || '', gateway: 'stripe', timed: dtimed, processed: 0 });
            await CheckoutTrans.update(
                { status: '1', payment_amount: amount_total, paidthru: 'stripe', payment_date: dtimed }, { where: { reference: client_reference_id } }
            );

            // send webhook notification to merchant's webhook url if set
            const localTrans = await CheckoutTrans.findOne({ where: { provref: client_reference_id } });
            if (localTrans) {
                const webhookResult = await sendWebhook({
                    bizid: localTrans.ownerid, event: 'payment.success',
                    payreference: localTrans.reference,
                    data: {
                        reference: localTrans.reference,
                        amount: formatAmount(localTrans.amount),
                        amount_paid: formatAmount(localTrans.payment_amount),
                        amount_settled: formatAmount(settledAmount),
                        currency: localTrans.currency,
                        charged_fee: formatAmount(localTrans.fee),
                        whopay_fee: 'customer',
                        payment_date: moment.unix(localTrans.payment_date).local().format("Do MMM, YYYY hh:mm a"),
                        payment_unixtime: localTrans.payment_date,
                        merchant_reference: localTrans.external_reference,
                        redirect_url: localTrans.redirecturl,
                        env_mode: localTrans.mode,
                        enable_multicurrency: localTrans.multicurrency == 1 ? true : false,
                        payment_channel: localTrans.paychannel,
                        status: 'success',
                        customer: {
                            name: localTrans.customer_name,
                            email: localTrans.customer_email,
                            phone: ''
                        },
                        description: localTrans.pay_desc,
                    }
                });

            }



        } catch (err) {
            console.error('Error processing webhook:', err);
            logger.error(`Webhook processing error: ${err.message}`);
            // Still return 200 to acknowledge receipt
        }
    } else if (event.type == 'payment_intent.succeeded') {
        const paymentIntent = event.data.object;
        const amount_total = paymentIntent.amount / 100;
        const amount_received = paymentIntent.amount_received / 100;
        const payment_intent = paymentIntent.id;
        const customerId = paymentIntent.customer;
        const currency = paymentIntent.currency;
        const client_reference_id = paymentIntent.client_secret;
        const payment_status = paymentIntent.status;
        const deposit_guid = payment_intent;

        // get the payment with the productid of the deposit id
        const getPayment = await RemittancePay.findOne({ where: { deposit_guid: deposit_guid, provider: 'stripe' } });

        if (getPayment) {
            const txref = getPayment.txref;

            if (getPayment.status === 'completed') {
                console.warn(`[Webhook Stripe GLobalPayment] Duplicate transaction detected for reference: ${txref}. Ignoring.`);
                return;
            }

            // get the transaction payload meta from Payn 
            const getPayn = await Payn.findOne({ where: { provref: deposit_guid } });

            const payload = JSON.parse(getPayn.meta);
            // console.log('Payload from Payn meta', payload);
            const network = getPayn.ntwk;
            const userid = getPayn.userid;
            const accountname = payload.accountname;

            if (network == 'NG') {
                var provider = 'safehaven';
                const accesstoken = await shAcessToken();
                if (!accesstoken[0])
                    throw new Error('Service provider unavailable.');

                const enquirytoken = payload.enquirytoken;
                const bankcode = payload.bankcode;
                const recipientno = payload.recipientno;
                const amount = payload.amount;
                const narration = payload.narration;
                const txref = getPayn.txref;
                // const deposit_guid = getPayn.provref;
                const dtimed = getPayn.timed;
                const currency = payload.currency;

                // route through NGN TRANSFER CHANNEL
                var data = JSON.stringify(payload);
                await LogRequest.create({ reference: deposit_guid, jsonreq: data, timed: dtimed, product: 'globaltransfer', provider: 'yc' });

                // call the TRANSFER FUNCTION
                const ftApiResponse = await SHTransfer(accesstoken, enquirytoken, bankcode, recipientno, amount, narration, txref, dtimed);

                if ((ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') || ftApiResponse.code == '00') {
                    var sessID = ftApiResponse.data.sessionId;

                    // Update the payment status to success
                    await RemittancePay.update(
                        { status: 'completed', jsonresp: dbody },
                        { where: { deposit_guid: deposit_guid, provider: 'stripe' } }
                    );

                    await Payn.update({
                        status: 1, paychannel: provider, productid: sessID,
                        jsonresp: JSON.stringify(ftApiResponse)
                    }, {
                        where: { txref: txref, userid: userid }
                    });

                    pushNotify(userid, 'Transaction Notice - HitchPay', `Your NGN${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`);

                    console.log(`[Webhook] Successfully processed for ${deposit_guid} `);

                    // send email and push notification to the owner
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    const fname = userinfo.firstname;

                    const notedesc = `Your NGN${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`;

                    await notifyMe(userid, 'NGN Transfer Completed', 'user', notedesc);

                    const mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Your NGN transfer of <strong>NGN ${formatAmount(amount)}</strong> to <strong>${accountname}</strong> has been successfully completed.</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Name:</strong> ${accountname}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Account:</strong> ${recipientno}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Bank:</strong> ${bankcode}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Sent:</strong> NGN ${formatAmount(amount)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${txref}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                        <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                    `;
                    await mailSender(fname, 'NGN Transfer Completed', useremail, mailcontent);

                } else {
                    logger.error(`stripe Webhook: NGN Transfer failed for deposit_guid: ${deposit_guid}. Response: ${JSON.stringify(ftApiResponse)}`);
                }

            } else {

                // log request payload
                var data = JSON.stringify(payload);
                await LogRequest.create({ reference: deposit_guid, jsonreq: data, timed: dtimed, product: 'globaltransfer', provider: 'yc' });

                // call the provider
                // console.log('thepayload', payload)

                const paymentResponse = await YCPayment(payload);
                console.log('paymentResponse from hook', paymentResponse)
                if (!paymentResponse || (paymentResponse.status !== 'created' && paymentResponse.status !== 'processing')) {
                    logger.error(`Stripe Webhook: Failed to initiate payment for deposit_guid: ${deposit_guid}`);
                    return
                }

                const jsonString2 = JSON.stringify(paymentResponse);
                if (paymentResponse && (paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process')) {

                    const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
                    const localAmount_convertedAmount = paymentResponse.convertedAmount; //localamount
                    const api_rate = paymentResponse.rate;
                    const api_amount = paymentResponse.amount;
                    const networkName = paymentResponse.destination?.networkName;
                    const api_currency = paymentResponse?.currency;
                    const attempt = paymentResponse.attempt;

                    const payloadDestination = payload.destination
                    // console.log('payloadDestination', payloadDestination)

                    const account_type = payloadDestination.accountType;
                    const account_number = payloadDestination.accountNumber
                    const network_id = payloadDestination.networkId
                    const account_name = payloadDestination.accountName
                    const countrycode = payloadDestination.country

                    const localamount = payload.localAmount;
                    const reason = payload.reason;
                    const channel_id = payload.channel_id;
                    const exchangeRate = getPayn.productid;
                    const topay = getPayn.amount;
                    const main_amount_converted = getPayn.amountval;
                    const feeconvert = getPayn.fee;

                    // prepare meta data
                    const meta_data = JSON.stringify({
                        account_type, account_number, network_id, channel_id, account_name,
                        localamount, reason, countrycode, network_name: networkName, rate: exchangeRate,
                        converted_paycurrency: topay, main_amount_converted, feeconvert
                    });

                    // update the log with provider reference
                    await Payn.update({
                        meta: meta_data,
                    }, { where: { txref: getPayn.txref } });


                    // Update the payment status to success
                    await RemittancePay.update(
                        { status: 'completed', jsonresp: dbody },
                        { where: { deposit_guid: deposit_guid, provider: 'stripe' } }
                    );

                    console.log(`[Webhook] Successfully processed for ${deposit_guid} `);

                    // send email and push notification to the owner
                    const userinfo = await getUserInfo(getPayn.userid);
                    const useremail = userinfo.email;
                    const fname = userinfo.firstname;

                    const notedesc = `Your global transfer of ${getPayn.currency} ${formatAmount(getPayn.amountval)} to ${account_name} has been completed.`;
                    await pushNotify(getPayn.userid, 'Global Transfer Completed', notedesc);
                    await notifyMe(getPayn.userid, 'Global Transfer', 'user', notedesc);

                    const mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                        <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Your global transfer of <strong>${getPayn.currency} ${formatAmount(getPayn.amountval)}</strong> to <strong>${account_name}</strong> has been successfully completed.</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Name:</strong> ${account_name}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Account:</strong> ${account_number}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Bank/Network:</strong> ${networkName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Sent:</strong> ${getPayn.currency} ${formatAmount(getPayn.amountval)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Received:</strong> ${api_currency} ${formatAmount(localAmount_convertedAmount)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Exchange Rate:</strong> 1 ${getPayn.currency} = ${api_rate} ${api_currency}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${getPayn.txref}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Payment Channel:</strong> Debit Card</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(getPayn.timed).format("Do MMM, YYYY hh:mm a")}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                        <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                    `;

                    await mailSender(fname, 'Global Transfer Completed', useremail, mailcontent);
                    // await mailSender(fname, 'Global Transfer Completed', 'olajideolatunji@hitchpay.ng', mailcontent);

                } else {
                    logger.error(`stripe Webhook: Payment initiation failed for deposit_guid: ${deposit_guid}. Response: ${jsonString2}`);
                }
            }

        } else {
            logger.warn(`Stripe Webhook: No matching Payn record found for deposit_guid: ${deposit_guid}`);
            return;
        }
    }
}

const setupHook = async() => {
  try {
    const webhookEndpoint = await stripe.webhookEndpoints.create({
      enabled_events: ['*'],
      url: 'https://pre-prod.hitchpay.ng/paywpphk/whk352strpnoty/6b002cd779e274a05934ee7204b14',
    });

    return webhookEndpoint;

  }catch (error) {
    logger.error('Error setting up Stripe webhook:', error);
  }
}


/* setupHook('setupHook')
.then(result => {
    console.log("Aresult:", result);
})
.catch(err => console.error("Script execution failed:", err))
.finally(async () => {
    // Optional: Close database connection if this is a standalone script
    // await db.sequelize.close();
}); */




module.exports = {
    stripeWebhkHandlerTest, stripeWebhkLive
}