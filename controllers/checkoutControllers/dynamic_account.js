const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
moment.tz.setDefault('Africa/Lagos');
const { mailSender } = require('../../config/mailsender');
const { Op, fn, col, where } = require("sequelize");
const { getLedgerBal } = require("../../config/userdetails");
const { sendSMS, pushNotify } = require("../../config/notifyuser");
const crypto = require('crypto');
const md5 = require('md5');
const randomstring = require("randomstring");
const { formatAmount, cleanMe, ucFirst, shAcessToken, calcCheckOutFee, updateLedgerBalance} = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const { sendWebhook } = require("../../config/sendWebhookHelper");



const PayLink = db.paylinks;
const AppSett = db.appsettings;
const Customer = db.customers;
const Admin = db.admin;
const Business = db.business;
const CheckoutTrans = db.checkouttrans
const payWhk = db.whookhandler;


const processSuccessfulDynamicPayment = async (checkoutTrans, actualAmountReceived, providerFees) => {
    const ownerid = checkoutTrans.ownerid;
    const usertype = checkoutTrans.usertype;
    const currency = checkoutTrans.currency;
    const reference = checkoutTrans.reference;

    const [feeStatus, calculatedGatewayFee, ourPlatformFeeBeforeCap, totalFeeChargedToCustomer] = await calcCheckOutFee('safehaven', parseFloat(actualAmountReceived), currency);

    if (!feeStatus) {
        logger.error(`Failed to calculate fees for dynamic account payment reference ${reference}`);
        throw new Error('Failed to calculate payment fees.');
    }

    const ourRevenue = ourPlatformFeeBeforeCap; // This is HitchPay's share
    const settledAmount = parseFloat(actualAmountReceived) - totalFeeChargedToCustomer; // Amount to credit to merchant's ledger

    await db.sequelize.transaction(async (t) => {
        const transactionMode = checkoutTrans.mode;

        const userbal = await getLedgerBal(ownerid, currency, { transaction: t }, usertype, transactionMode);

        // Update ledger balance
        const newbal = await updateLedgerBalance(ownerid, settledAmount, currency, 'credit', { transaction: t }, true, usertype, transactionMode);

        // Update the checkout transaction record
        await checkoutTrans.update(
            {
                status: '1',
                payment_amount: actualAmountReceived,
                paidthru: 'dynamic_account',
                payment_date: Math.floor(Date.now() / 1000),
                prevbal: userbal,
                newbal: newbal,
                fee: totalFeeChargedToCustomer, // Total fee charged to customer
                providerfee: providerFees, // Provider's fee (from webhook)
                revenue: ourRevenue // Our platform's revenue
            },
            { transaction: t }
        );
    });

     let merchantEmail, merchantPhone, merchantName;
    if (usertype == 'personal') {
        const customer = await Customer.findOne({ where: { id: ownerid } });
        merchantEmail = customer.email;
        merchantPhone = customer.phoneno;
        merchantName = `${customer.firstname} ${customer.lastname}`;
    } else if (usertype == 'business') {
        const business = await Business.findOne({ where: { id: ownerid } });
        merchantEmail = business.business_email;
        merchantPhone = business.business_phoneno;
        merchantName = business.business_name;
    }

    // Send notifications (outside the transaction)
    const customerSubject = `Payment Confirmation`;
    const customerEmailContent = `
        <p>Dear ${checkoutTrans.customer_name},</p>
        <p>Your payment of <strong>${checkoutTrans.currency} ${formatAmount(actualAmountReceived)}</strong> to <strong>${merchantName}</strong> has been successfully processed.</p>
        <p><strong>Transaction Reference:</strong> ${reference}</p>
        <p>Thank you for your purchase!</p>
        <p>If you have any questions, please contact the merchant at ${merchantEmail}.</p>
    `;
    await mailSender(checkoutTrans.customer_name, customerSubject, checkoutTrans.customer_email, customerEmailContent);

    // Notify merchant
    try {
    
        const subject = `Payment Received: ${checkoutTrans.currency} ${formatAmount(actualAmountReceived)}`;
        const emailContent = `
            <p>Dear ${merchantName},</p>
            <p>You have successfully received a payment of <strong>${checkoutTrans.currency} ${formatAmount(actualAmountReceived)}</strong> from <strong>${checkoutTrans.customer_name} (${checkoutTrans.customer_email})</strong>.</p>
            <p><strong>Payment Description:</strong> ${!checkoutTrans.pay_desc ? '' : checkoutTrans.pay_desc}</p>
            <p><strong>Transaction Reference:</strong> ${reference}</p>
            <p><strong>${checkoutTrans.currency} ${formatAmount(settledAmount)}</strong> has been credited to your ledger balance.</p>
            <p>Thank you for using HitchPay.</p>
            `;
        await mailSender(merchantName, subject, merchantEmail, emailContent);

        const smsMessage = `Hi ${merchantName}, you've received ${checkoutTrans.currency} ${formatAmount(actualAmountReceived)} from ${checkoutTrans.customer_name} for ${checkoutTrans.pay_desc}. Ref: ${reference}. Amount credited to ledger: ${checkoutTrans.currency} ${formatAmount(settledAmount)}.`;
        await pushNotify(ownerid, 'Payment Received', smsMessage);

         // send webhook notification to merchant's webhook url if set
        const webhookResult = await sendWebhook({
            bizid: checkoutTrans.ownerid, event: 'payment.success', 
            payreference: checkoutTrans.reference,
            data: {
            reference: checkoutTrans.reference,
            amount: formatAmount(checkoutTrans.amount),
            amount_paid: formatAmount(checkoutTrans.payment_amount),
            amount_settled: formatAmount(settledAmount),
            currency: checkoutTrans.currency,
            charged_fee: formatAmount(checkoutTrans.fee),
            whopay_fee: 'cuctomer',
            payment_date: moment.unix(checkoutTrans.payment_date).local().format("Do MMM, YYYY hh:mm a"),
            payment_unixtime: checkoutTrans.payment_date,
            merchant_reference: checkoutTrans.external_reference,
            redirect_url: checkoutTrans.redirecturl,
            env_mode: checkoutTrans.mode,
            enable_multicurrency: checkoutTrans.multicurrency == 1 ? true : false,
            payment_channel: checkoutTrans.paychannel,
            status: 'success',
            customer: {
                name: checkoutTrans.customer_name,
                email: checkoutTrans.customer_email,
                phone: ''
            },
            description: checkoutTrans.pay_desc,
            }
        });

        if (!webhookResult.success) {
            logger.warn(`Failed to send webhook for transaction ${checkoutTrans.reference}: ${webhookResult.error}`);
        } else {
            logger.info(`Webhook sent successfully for transaction ${checkoutTrans.reference}`);
        }


    } catch (notificationError) {
        logger.error('Error sending merchant notification for dynamic account payment:', notificationError);
    }
    return { status: true, message: 'Payment processed successfully.' };
};

const genDynamicAccount = async (req, res) => {
    try {
        const { reference} = cleanMe(req.body);

        if (!reference ) {
            return res.status(400).json({ status: false, message: 'Kindly reload page and try again.' });
        }
        
        // get the owner of the payment link
        const getPayment = await CheckoutTrans.findOne({ where: { reference: reference } });

        if (!getPayment) {
            return res.status(404).json({ status: false, message: 'Payment not found.' });
        }

        const amount = getPayment.amount;
        const currency = getPayment.currency;
        const customer_name = getPayment.customer_name;
        const customer_email = getPayment.customer_email;
        const pay_desc = getPayment.pay_desc;
        const usertype = getPayment.usertype;
        const ownerid = getPayment.ownerid;

        const sh_access_token = await shAcessToken();
        // logger.error('sh_access_token', sh_access_token)


        if (!sh_access_token[1]) {
            console.error('Error generating dynamic account:', 'Payment gateway not available');
            return res.status(400).json({ status: false, message: 'Payment gateway not available' });
        }

        // console.log('here herhe')
         /* get fee*/
        const theFee = await calcCheckOutFee('', parseFloat(amount), currency);
        const gatewayfee = theFee[1];
        const ourfee = theFee[2];
        const TotalFee = theFee[3];
        const payAmount = parseFloat(amount) + parseFloat(TotalFee);

        const validFor = 900;  //15 minutes

        if(process.env.APPENV == 'development'){
            var callbackUrl = 'https://dev.hitchpay.ng/paywpphk/whksh223xdynm';
        }else{
            var callbackUrl = 'https://prod.hitchpay.ng/paywpphk/whksh223xdynm';
        }

        const payload = {
            "amount": payAmount,
            "externalReference": reference,
            "validFor": validFor,
            "settlementAccount": {
                "bankCode": process.env.SH_BANKCODE,
                "accountNumber": process.env.SH_DEBITACCOUNT
            },
            "accountName": "Hitchpay Checkout",
             "amountControl": "Fixed",
             "callbackUrl": callbackUrl
        };

        const sh_response = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/virtual-accounts`,
            headers: {
                accept: 'application/json',
                "content-type": "application/json",
                ClientID: sh_access_token[2],
                authorization: `Bearer ${sh_access_token[1]}`
            },
            data: payload
        };

        let response1 = await axios.request(sh_response);
        let thedata1 = response1.data;

        // console.log('response1', response1)

        if (thedata1.statusCode == 200) {
            const virtualAccount = thedata1.data;

            // Safely parse existing metadata and merge new data
            let existingMeta = {};
            try {
                if (getPayment.meta) {
                    existingMeta = JSON.parse(getPayment.meta);
                }
            } catch (e) {
                logger.warn(`Could not parse existing metadata for reference ${reference}. It will be overwritten.`);
            }

            const newMeta = Object.assign(existingMeta, {account_number: virtualAccount.accountNumber, bank_name: virtualAccount.bankName, account_name: virtualAccount.accountName});

            await CheckoutTrans.update({
                provref: virtualAccount['_id'], paidthru: 'dynamic_account',
                accountno: virtualAccount.accountNumber,
                meta: JSON.stringify(newMeta), payment_amount: virtualAccount.amount
            }, { where: { ownerid: ownerid, reference: reference} });

            return res.json({
                status: true,
                message: 'Dynamic account generated successfully. Awaiting payment.',
                data: {
                    url: null,
                    reference: reference,
                    account_number: virtualAccount.accountNumber,
                    bank_name: virtualAccount.bankName,
                    account_name: virtualAccount.accountName,
                    validFor: virtualAccount.validFor,
                    account_bank: 'SAFEHAVEN MICROFINANCE BANK',
                    mode: process.env.APPENV == 'development' ? 'sandbox' : 'live',
                    amount: virtualAccount.amount,
                    currency: currency,
                    customer_name: customer_name,
                    customer_email: customer_email,
                    pay_desc: pay_desc
                }
            });
        } else {
            logger.error('Error generating dynamic account:', sh_response);
            return res.status(400).json({ 
                status: false, 
                message: sh_response.data?.message || 'Failed to generate dynamic account.' 
            });
        }

    } catch (error) {
        logger.error('Error generating dynamic account:', error);
        // console.error('SH API Error:', error.response.data);
        return res.status(400).json({ status: false, message: error.message || 'An error occurred with the payment provider.'});
    }
};

const dynamicAccountWebhook = async (req, res) => {
    try {
        const event = req.body;
        // logger.info('Received SafeHaven webhook:', event);

        // Validate webhook signature if provided by SafeHaven
        // For now, we'll trust the source, but in production, always verify.

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);
        var event_type = resp['type'];

        if (event_type == 'virtualAccount.transfer' && resp['data']) {
            // const { reference, amount, currency, status, providerChannel,  debitAccountName, paymentReference, externalReference, fees} = resp['data'];

            const reference = resp['data']['provider'];
            const creditAccountNumber = resp['data']['creditAccountNumber'];
            const creditAccountName = resp['data']['creditAccountName'];
            const amount = resp['data']['amount'];
            const currency = 'NGN';
            const status = resp['data']['status'];
            const providerChannel = resp['data']['providerChannel'];
            const debitAccountName = resp['data']['debitAccountName'];
            const paymentReference = resp['data']['paymentReference'];
            const externalReference = resp['data']['externalReference'];
            const providerFees = resp['data']['fees'];


            // Find the corresponding checkout transaction
            const checkoutTrans = await CheckoutTrans.findOne({ where: { reference: externalReference, accountno:creditAccountNumber } });

            if (!checkoutTrans) {
                logger.warn(`Dynamic account webhook: Transaction with reference ${externalReference} not found.`);
                return res.status(404).json({ status: false, message: 'Transaction not found.' });
            }

            console.log(status.toLowerCase())
            if (status.toLowerCase() != 'completed') {
                logger.info(`Transaction not completed for reference ${externalReference}.`);
                return res.status(200).json({ status: true, message: `Transaction not completed for reference ${externalReference}` });
            }

            if (checkoutTrans.status == '1') {
                logger.info(`Dynamic account webhook: Transaction ${externalReference} already processed.`);
                return res.status(200).json({ status: true, message: 'Transaction already processed.' });
            }

            // Check if the payment amount matches the expected amount
            const dtimed = Math.floor(Date.now() / 1000);
            if (parseFloat(amount) < parseFloat(checkoutTrans.amount)) {
                logger.warn(`Dynamic account webhook: Received amount ${amount} is less than expected ${checkoutTrans.amount} for transaction ${externalReference}.`);

                // You might want to handle this as a partial payment or flag it for manual review
                await checkoutTrans.update({ status: '3', payment_amount: amount, payment_date: dtimed });
                return res.status(200).json({ status: true, message: 'Partial payment received.' });
            }

            // Process successful payment
            if (status.toLowerCase() == 'completed') {
                // Use the new helper function to process the successful payment
                await processSuccessfulDynamicPayment(checkoutTrans, parseFloat(amount), providerFees);

                return res.status(200).json({ status: true, message: 'Payment processed successfully.' });

            } else if (status == 'failed') {
                await checkoutTrans.update({ status: '2', payment_date: Math.floor(Date.now() / 1000) }); // Mark as failed
                logger.warn(`Dynamic account webhook: Payment failed for transaction ${reference}.`);
                return res.status(200).json({ status: true, message: 'Payment marked as failed.' });
            }
        }

        return res.status(200).json({ status: true, message: 'Webhook received, but no action taken.' });

    } catch (error) {
        logger.error('Error processing SafeHaven dynamic account webhook:', error);
        res.status(400).json({ status: false, message: 'An error occurred while processing the webhook.' });
    }
};


const verifyDynamicAccountCheckout = async (req, res) => {
    try {
        const { reference } = req.body;

        if (!reference) {
            return res.status(400).json({ status: false, message: 'Transaction reference is required.' });
        }

        const localTrans = await CheckoutTrans.findOne({ where: { reference: reference } });

        if (!localTrans) {
            return res.status(404).json({ status: false, message: 'Transaction not found.' });
        }

        if (localTrans.status == '1') {
            return res.json({
                status: true,
                message: 'Payment already confirmed.',
                data: {
                    status: 'paid',
                    reference: localTrans.reference,
                    amount: localTrans.payment_amount,
                    customer_email: localTrans.customer_email,
                    customer_name: localTrans.customer_name,
                    pay_desc: localTrans.pay_desc
                },
            });
        }

        // --- TEST MODE AUTOMATION ---
        // If the transaction is in test mode, automatically process it as successful
        // without calling the external provider.
        if (localTrans.mode === 'test' && process.env.APPENV == 'development') {
            logger.info(`Processing test mode transaction automatically for reference: ${reference}`);
            await processSuccessfulDynamicPayment(localTrans, parseFloat(localTrans.payment_amount), 0);

            return res.status(200).json({
                status: true,
                message: 'Test transaction processed successfully.',
                data: {
                    status: 'paid',
                    reference: localTrans.reference,
                    amount: localTrans.payment_amount,
                    customer_email: localTrans.customer_email,
                    customer_name: localTrans.customer_name,
                    pay_desc: localTrans.pay_desc
                },
            });
        }
        // --- END TEST MODE AUTOMATION ---


        // If status is not '1', check with the provider
        const sh_access_token = await shAcessToken();
        if (!sh_access_token) {
            return res.status(400).json({ status: false, message: 'Could not retrieve payment .' });
        }

        const virtualAccountId = localTrans.provref;

        const sh_response = {
            method: 'GET',
            url: `${process.env.SH_BASEURL}/virtual-accounts/${virtualAccountId}/transaction`,
            headers: {
                accept: 'application/json',
                "content-type": "application/json",
                ClientID: sh_access_token[2],
                authorization: `Bearer ${sh_access_token[1]}`
            }
        };

        let response1 = await axios.request(sh_response);
        let thedata1 = response1.data;

        if (thedata1.data && thedata1.statusCode == 200) {
            const resp = thedata1;

            const provider = resp['data']['provider'];
            const creditAccountNumber = resp['data']['creditAccountNumber'];
            const creditAccountName = resp['data']['creditAccountName'];
            const amount = resp['data']['amount'];
            const currency = 'NGN';
            const status = resp['data']['status'];
            const providerChannel = resp['data']['providerChannel'];
            const debitAccountName = resp['data']['debitAccountName'];
            const paymentReference = resp['data']['paymentReference'];
            const externalReference = resp['data']['externalReference'];
            const providerFees = resp['data']['fees'];
            const stampDuty = resp['data']['stampDuty'];

            // Find the corresponding checkout transaction
            const checkoutTrans = await CheckoutTrans.findOne({ where: { reference: externalReference, accountno:creditAccountNumber } });

            if (!checkoutTrans) {
                // logger.warn(`Dynamic account webhook: Transaction with reference ${externalReference} not found.`);
                return res.status(200).json({ status: false, message: 'Payment not received yet.' });
            }

            if (status.toLowerCase() != 'completed') {
                return res.status(200).json({ status: false, message: `Transaction not completed` });
            }

            if (checkoutTrans.status == '1') {
                return res.status(200).json({ 
                    status: true, 
                    message: 'Transaction processed.',
                     data: {
                        status: 'paid',
                        reference: localTrans.reference,
                        amount: localTrans.payment_amount,
                        customer_email: localTrans.customer_email,
                        customer_name: localTrans.customer_name,
                        pay_desc: localTrans.pay_desc
                    } 
                    });
            }

            // Check if the payment amount matches the expected amount
            const dtimed = Math.floor(Date.now() / 1000);
            if (parseFloat(amount) < parseFloat(checkoutTrans.amount)) {
                logger.warn(`Dynamic account webhook: Received amount ${amount} is less than expected ${checkoutTrans.amount} for transaction ${externalReference}.`);
                
                await checkoutTrans.update({ status: '3', payment_amount: amount, payment_date: dtimed });
                return res.status(200).json({ status: false, message: 'Partial payment received.' });
            }


            // Process successful payment
            if (status.toLowerCase() == 'completed') {
                await processSuccessfulDynamicPayment(checkoutTrans, parseFloat(amount), providerFees);
                
                return res.status(200).json({ 
                    status: true, 
                    message: 'Payment processed successfully.', 
                    data: {
                    status: 'paid',
                    reference: localTrans.reference,
                    amount: localTrans.payment_amount,
                    customer_email: localTrans.customer_email,
                    customer_name: localTrans.customer_name,
                    pay_desc: localTrans.pay_desc
                },
            });

            } else if (status == 'failed') {
                await checkoutTrans.update({ status: '2', payment_date: Math.floor(Date.now() / 1000) }); // Mark as failed
                logger.warn(`Dynamic account webhook: Payment failed for transaction ${reference}.`);
                return res.status(200).json({ status: true, message: 'Payment marked as failed.' });
            }


        } else {
            return res.status(200).json({ 
                status: false, message: 'Payment not completed.', 
                data: { 
                    status: sh_response.data?.data?.status || 'unknown' 
                } });
        }

    } catch (error) {
        logger.error('Error verifying SafeHaven dynamic account checkout:', error);
        if (error.response) {
            logger.error('SafeHaven API Error:', error.response.data);
            return res.status(400).json({ status: false, message: error.response.data.message || 'An error occurred with the payment provider.' });
        }
        res.status(400).json({ status: false, message: 'An error occurred while verifying the payment.' });
    }
};

module.exports = {
    genDynamicAccount, dynamicAccountWebhook, verifyDynamicAccountCheckout
    
}