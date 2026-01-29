const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
moment.tz.setDefault('Africa/Lagos');
const { mailSender } = require('../../config/mailsender');
const { getUserInfo, getBal, getLedgerBal} = require("../../config/userdetails");
const { Op, fn, col, where } = require("sequelize");
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
const crypto = require('crypto');
const { formatAmount, cleanMe, ucFirst, calcCheckOutFee, getFX, formatPhoneNumber, updateLedgerBalance} = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const md5 = require('md5');
const randomstring = require("randomstring");
const { ycRequest } = require('../crossBorderControllers/ycauth');
const { sendWebhook } = require("../../config/sendWebhookHelper");


/* models */
const PayLink = db.paylinks;
const AppSett = db.appsettings;
const Customer = db.customers;
const Admin = db.admin;
const Business = db.business;
const BizKeys = db.bizkeys;
const CheckoutTrans = db.checkouttrans;
const KYC = db.kyc;
const KycDoc = db.kycdoc;
const LogRequest = db.logrequest


const initPayWithHitchPay = async (req, res) => {
    const { amount, currency, email, reference, callback, clientid} = cleanMe(req.body)

    console.log('req.query', req.body)

    if (isNaN(amount) || amount <= 0) {
        return res.status(404).json({ status: false, message: 'Invalid amount' });
    }

    // add max amount limit for ngn - 5000000 and usd max - 10000
    if (currency == 'NGN' && amount > 5000000) {
        return res.status(404).json({ status: false, message: 'Maximum amount for NGN is 5,000,000' });
    }
    if (currency == 'USD' && amount > 10000) {
        return res.status(404).json({ status: false, message: 'Maximum amount for USD is 10,000' });
    }

    //check if public_key
    if (!clientid) {
        return res.status(404).json({ status: false, message: 'Client ID is required to initiate payment' });
    }

    const merchant = await BizKeys.findOne({ where: { client_id: clientid }});
    
    if (!merchant) {
        return res.status(404).json({ status: false, message: 'Invalid client credentials' });
    }
    
    const userid = merchant.bizid; //owner ID
    const keymode = merchant.keymode;
    const usertype = 'business'

      // check if the external reference doesnt exist before
    if(reference){
      const existingTrans = await CheckoutTrans.findOne({ where: { external_reference: reference, ownerid: userid } });
      if (existingTrans) {
          return res.status(404).json({ status: false, message: 'A transaction with this external reference already exists for this merchant' });
      }

      var externalref = reference;
    }else{
      var externalref = '';
    }

    let merchantName;
    if (usertype == 'personal') {
        const thecustomer = await Customer.findOne({ where: { id: userid } });
        merchantName = thecustomer ? `${thecustomer.firstname} ${thecustomer.lastname}` : 'Unknown Merchant';
    } else if (usertype == 'business') {
        const business = await Business.findOne({ where: { id: userid } });
        merchantName = business ? business.businessname : 'Unknown Business';
    } else {
        merchantName = 'Unknown Merchant';
    }

    const txref = 'HCHK' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
    let dtimed = Math.floor(Date.now() / 1000);

    let paymode = 'live';
    if (process.env.APPENV == 'development') {
      paymode = 'test';
    }

    //log the transction on the checkout trans
    const newCheckoutTrans = await CheckoutTrans.create({
        ownerid: userid, usertype: usertype, reference: txref, amount: amount, currency: currency, 
        customer_name: '', paychannel: 'api', customer_email: '', 
        productid: merchantName, paidthru: '', status: '0', pay_desc: '', timed: dtimed, 
        external_reference: externalref, meta: '', redirecturl: '', mode: paymode
    });
    

    if (!newCheckoutTrans) {
        return res.status(404).json({ status: false, message: 'Failed to initiate checkout transaction' });  
    }

    if(process.env.APPENV == 'development'){
      var payment_url = `https://dev-payment.hitchpay.ng/checkout/${txref}`;
      // var payment_url = `http://localhost:3000/checkout/${txref}`;
    }else{
      var payment_url = `https://payment.hitchpay.ng/checkout/${txref}`;
      // var payment_url = `http://localhost:3000/checkout/${txref}`;
    }


    res.json({
      status: true,
      message: 'Payment Initiated',
      data: {
        payment_url: payment_url,
        reference: reference,
        amount: amount,
        currency: currency,
        customer_name: '',
        customer_email: email,
        pay_desc: ''
      }
    })
}


const getXRate = async (req, res) => {
    try {
        const { source_currency: sourceCurrency, destination_currency: destinationCurrency } = cleanMe(req.body);
        console.log('req.body', req.body)

        if (!sourceCurrency || !destinationCurrency) {
            return res.status(400).json({
                status: false,
                message: '`sourceCurrency` and `destinationCurrency` query parameters are required.',
            });
        }

        const getrate = await getFX(sourceCurrency, destinationCurrency);
    
        var rate = getrate[1];
        var quoteid = getrate[2];

        if (rate <= 0)
            return res.status(400).json({ status: false, message: `Unable to get ${sourceCurrency}/${destinationCurrency} exchange rate` });

        res.status(200).json({
            status: true,
            message: 'Exchange rate retrieved successfully.',
            data: {
                rate
            },
        });

    } catch (error) {
        logger.error('Error in getRate endpoint:', error);
        return res.status(500).json({ status: false, message: 'Unble to process request at the moment.' });
    }
};


const initiateCheckoutGlobal = async (req, res) => {
    
    try {
        // if (process.env.APPENV !== 'development') {
        //     return res.status(403).json({ status: false, message: 'This feature is temporarily not available' });
        // }
        
        const {account_type, account_number, network_id, channel_id, account_name, localamount, reason, countrycode, currency, dialcode, reference} = cleanMe(req.body);

        // console.log('req.bodyreq.body', req.body)

        // Basic validation
        if (!account_type || !channel_id || !localamount || !reason || !countrycode || !currency) {
            return res.status(400).json({
                status: false,
                message: 'One or more required fields are missing. Please check your input.'
            });
        }

         // dialcode is compulsory for mobilemoney / mono
        if (account_type != 'bank' && !dialcode) {
            return res.status(400).json({ status: false, message: 'Dial code is required for mobile money payments.' });
        }
        if (account_type != 'bank' && !network_id) {
            return res.status(400).json({ status: false, message: 'Kindly select your payment network' });
        }

        /* CHECK FOR EXISTENCE */
        if (!localamount || localamount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (localamount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (!reference)
            return res.status(400).json({ status: false, message: 'Kindly reload the checkout and try again' });

        // get the checkout transaction that has the reference
        const getPayment = await CheckoutTrans.findOne({ where: { reference: reference } });
        if (!getPayment) {
            return res.status(404).json({ status: false, message: 'Payment not found.' });
        }

        const amount = getPayment.amount;
        // const currency = getPayment.currency;
        const customer_name = getPayment.customer_name;
        const customer_email = getPayment.customer_email;
        const pay_desc = getPayment.pay_desc;
        const usertype = getPayment.usertype;
        const bizid = getPayment.ownerid;
        const paymode = getPayment.mode;
        // our refercence 

        // get the business owner by bizid
        const business = await Business.findOne({ where: { id: bizid }, attributes: ['ownerid'] });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Business not found.' });
        }
        const ownerid = business.ownerid;
        const userid = ownerid;

        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getUser = await Customer.findOne({ where: { id: userid } });
        
        if (!getUser)
            return res.status(400).json({ status: false, message: 'Recipient account not in good shape to receive payment' });
    
        let initialPayLog;
        const getsett = await AppSett.findOne({ where: { id: 1 } });
        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

        if (getsett.crosscollectfee <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get processing fee. Kindly contact our support' });

        var fee = getsett.crosscollectfee;
        const ourfee = (parseFloat(fee) * localamount) / 100; //fee percentage
        const dfee = parseFloat(ourfee.toFixed(2)); //our fee
        
        const topay = localamount + dfee; //total to debit from user
        const pay_desc_initial = `Global Collection of ${currency} ${localamount} to ${account_name} - (${account_number}) in ${countrycode}`;
        const modifyprd = 'crosscollection';
        const timed = Math.floor(Date.now() / 1000);
        const ntwk = countrycode;
        const recipientno = account_number;

        //calculate profit
        const providerfeepercent = getsett.providerfee ? parseFloat(getsett.providerfee) : 0;
        const actualProviderFee = (providerfeepercent * localamount) / 100;
        const calculatedProfit = dfee - actualProviderFee;

        const env = 'test';
    
        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);

        if(getUser.countrycode == 'NG'){
            var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, vertype: 'BVN'}, order: [['id', 'DESC']]});

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your BVN verification to proceed', data: { errortype: "verificaton" } });

            var userphoneno = formatPhoneNumber(getUser.phoneno);
        }else{    
            var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, provider: 'veriff'}, order: [['id', 'DESC']]});

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your tier 2 verification to proceed', data: { errortype: "verificaton" } });

            var userphoneno = `${!getUser.dialcode ? '+1' : getUser.dialcode}${getUser.phoneno}`;
        }

        const verfname = getkyc.verfname;
        const verlname = getkyc.verlname;
        const verphone = getkyc.verphone;
        const verdob = getkyc.verdob;
        var identityNumber = getkyc.bvv;
        const momentDate = moment(verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');


        const payload = { 
            recipient: {
                name: `${verfname} ${verlname}`,
                country: getUser.countrycode,
                phone: userphoneno,
                address: getUser.address,
                dob: dateOfBirth,
                email: getUser.email,
                idNumber: identityNumber,
                idType: "license",
                businessId: !process.env.YC_MERCHANTID ? 'dd84d7e2-cb73-42d5-8320-6419a3439752' : process.env.YC_MERCHANTID,
                businessName: 'Hitchpay'
            },
            source: {
                accountNumber: `${dialcode}${!account_number ? '1111111111' : account_number}`,
                accountType: account_type,
                networkId: !network_id ? '' : network_id,
            },
            forceAccept: true, 
            customerType: 'institution', 
            channelId: channel_id,
            sequenceId: txref, 
            localAmount: parseFloat(localamount), 
            // reason: reason,
            reason: "school-fees",
            fee: 0,
            redirectUrl: "https://dev-payment.hitchpay.ng/vercrossborder"
        };
        
        // console.log('payload', payload)

        // log request payload
        const data = JSON.stringify(payload);
        await LogRequest.create({ reference: userid, jsonreq: data, timed: timed, product: 'checkoutyc', provider: 'yc' });

        // call the provider
        const paymentResponse = await ycRequest("POST", "/business/collections", payload);

        const jsonString2 = JSON.stringify(paymentResponse);

        // console.log('paymentResponse', paymentResponse)


        if (paymentResponse && (paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process')) {
            const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
            const api_convertedAmount = paymentResponse.convertedAmount;
            const api_rate = paymentResponse.rate;
            const api_amount = paymentResponse.amount;
            const networkName = paymentResponse.destination?.networkName;
            const api_currency = paymentResponse?.currency;
            const attempt = paymentResponse.attempt;
            const service_fee_local = paymentResponse.serviceFeeAmountLocal;
            const service_fee_usd = paymentResponse.serviceFeeAmountUSD;
            const deposit_id = paymentResponse.depositId;
            const bank_info = paymentResponse.bankInfo;

            // prepare meta data
            const meta_data = JSON.stringify({
                account_type: account_type, account_number, network_id, channel_id, account_name,currency, dialcode, reference,
                localamount, reason, countrycode, network_name: networkName, depositid: deposit_id, service_fee_local: service_fee_local, service_fee_usd: service_fee_usd, bank_info: bank_info, initref: txref
            });


            const newCheckoutTrans = await CheckoutTrans.update({
                meta: meta_data, provref: provref
            }, {where: {reference: reference}});

            // if (!newCheckoutTrans) {
            //     return res.status(500).json({ status: false, message: 'Failed to log payment.' });
            // }

            return res.status(200).json({
                status: true,
                message: 'Payment initiated successfully.',
                data: {
                    reference: txref,
                    paymentid: provref,
                    amount: api_convertedAmount,
                    currency: api_currency,
                    rate: api_rate,
                    bankInfo: paymentResponse.bankInfo
                }
            });

        }else{
            return res.status(400).json({
                status: false,
                message: paymentResponse?.message || 'Failed to initiate payment with the provider.',
                data: paymentResponse
            });
        }


    } catch (error) {
        logger.error('Error in initiateCollections:', error);
        return res.status(400).json({ status: false, message: 'Unable to completely process your request.' });
    }
};

const verifyGlobalPay = async (req, res) => {
    // if (process.env.APPENV !== 'development') {
    //     return res.status(403).json({ status: false, message: 'This feature is temporarily not available' });
    // }
    
    try {
        const { reference } = cleanMe(req.params);

        if (!reference) {
            return res.status(400).json({ status: false, message: 'Payment reference is required.' });
        }

        // check if the reference exist and get the provider trasnaction id from productid column
        const localTrans = await CheckoutTrans.findOne({
            where: { reference: reference }
        });

        if (!localTrans) {
            return res.status(404).json({ status: false, message: 'Payment not found.' });
        }

        // validate if trasnaction alread marked as completed
        if (localTrans.status == '1') {
        return res.json({
            status: true,
            message: 'Payment already confirmed.',
            data: {
            status: 'paid',
            reference: localTrans.reference,
            amount: localTrans.amount,
            amountpaid: localTrans.payment_amount,
            customer_email: localTrans.customer_email,
            customer_name: localTrans.customer_name
            },
        });
        }

        const collectionId = localTrans.provref;
        if (!collectionId) {
            return res.status(404).json({ status: false, message: 'Provider Payment ID not found for this transaction.' });
        }

        const lookupResponse = await ycRequest("GET", `/business/collections/${collectionId}`);

        // console.log("lookupResponse", lookupResponse)
        const paytime = Math.floor(Date.now() / 1000);
        if (lookupResponse && lookupResponse.id && lookupResponse.status == 'complete') {
            const amount_total = lookupResponse.amount;  //usd value
            const currency = lookupResponse.currency; //e.g KES
            const convertedAmount = parseFloat(lookupResponse.convertedAmount); // e.g in kes
            const serviceFeeAmountLocal = lookupResponse.serviceFeeAmountLocal; // e.g KES 28.91
            const serviceFeeAmountUSD = lookupResponse.serviceFeeAmountUSD; //e.g 0.22 usd
            const sessionId = lookupResponse.sessionId;
            const serviceFeeId = lookupResponse.serviceFeeId;
            const rate = lookupResponse.rate;

            // Use a managed transaction for atomicity
            const ownerid = localTrans.ownerid;
            const usertype = localTrans.usertype;
            const payCurrency = localTrans.currency;
            

            // calculte the our fee, update the payn for the trasction and credit the customer
            
            const getsett = await AppSett.findOne({ where: { id: 1 } });
            if (!getsett)
                return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

            if (!getsett.crosscollectfee ||getsett.crosscollectfee <= 0)
                return res.status(400).json({ status: false, message: 'Unable to get processing fee. Kindly contact our support' });

            const tocharge = getsett.crosscollectfee; //percent
            const calculatedOurFee = (parseFloat(tocharge) * localTrans.amount) / 100;

            var settledAmount = parseFloat(localTrans.amount) - parseFloat(calculatedOurFee);

            const revenue = calculatedOurFee - serviceFeeAmountUSD;

            await db.sequelize.transaction(async (t) => {
            const transactionMode = localTrans.mode;

            const userbal = await getLedgerBal(ownerid, payCurrency, { transaction: t }, usertype, transactionMode);

            // Update ledger balance
            const newbal = await updateLedgerBalance(ownerid, settledAmount, payCurrency, 'credit', { transaction: t }, true, usertype, transactionMode);

            // Update the checkout transaction record
            
            await CheckoutTrans.update(
            { status: '1', payment_amount: localTrans.amount, amountsettled: settledAmount,
                paidthru: 'yc', payment_date: paytime,
                prevbal: userbal, newbal: newbal, fee: calculatedOurFee, revenue: revenue
            }, { where: { reference: reference }, transaction: t }
            );
        });

              const customerSubject = `Payment Confirmation for Your Purchase`;
              const customerEmailContent = `
                  <p>Dear ${localTrans.customer_name},</p>
                  <p>Your payment of <strong>${localTrans.currency} ${formatAmount(amount_total)}</strong> for <strong>${!localTrans.pay_desc ? 'puchases' : localTrans.pay_desc}</strong> has been successfully processed.</p>
                  <p><strong>Transaction Reference:</strong> ${localTrans.reference}</p>
                  <p>Thank you for your purchase!</p>
                  <p>If you have any questions, please contact us.</p>
                `;
              await mailSender(localTrans.customer_name, customerSubject, localTrans.customer_email, customerEmailContent);
        
              // Notify merchant
              try {
                
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
        
                const subject = `Payment Received: ${localTrans.currency} ${formatAmount(amount_total)}`;
                const emailContent = `
                  <p>Dear ${merchantName},</p>
                  <p>You have successfully received a payment of <strong>${localTrans.currency} ${formatAmount(amount_total)}</strong> from <strong>${localTrans.customer_name} (${localTrans.customer_email})</strong>.</p>
                  <p><strong>Payment Description:</strong> ${!localTrans.pay_desc ? '' : localTrans.pay_desc}</p>
                  <p><strong>Transaction Reference:</strong> ${localTrans.reference}</p>
                  <p>The amount of <strong>${localTrans.currency} ${formatAmount(settledAmount)}</strong> has been credited to your ledger balance.</p>
                  <p>Thank you for using HitchPay.</p>
                `;
                await mailSender(merchantName, subject, merchantEmail, emailContent);
        
                const smsMessage = `Hi ${merchantName}, you've received ${localTrans.currency} ${formatAmount(amount_total)} from ${localTrans.customer_name} for ${!localTrans.pay_desc ? 'puchases' : localTrans.pay_desc}. Ref: ${localTrans.reference}. Amount credited to ledger: ${localTrans.currency} ${formatAmount(settledAmount)}.`;
        
                // await sendSMS(merchantPhone, smsMessage);
                await pushNotify(ownerid, 'Payment Received', smsMessage);
              } catch (notificationError) {
                logger.error('Error sending merchant notification for Stripe payment:', notificationError);
                // Don't fail the request, just log the error.
              }

            // send webhook notification to merchant's webhook url if set
            const webhookResult = await sendWebhook({
                bizid: ownerid, event: 'payment.success', payreference: reference,
                data: {
                    reference: localTrans.reference,
                    amount: formatAmount(localTrans.amount),
                    amount_paid: formatAmount(localTrans.amount),
                    amount_settled: formatAmount(settledAmount),
                    currency: localTrans.currency,
                    charged_fee: formatAmount(calculatedOurFee),
                    whopay_fee: 'merchant',
                    payment_date: moment.unix(paytime).local().format("Do MMM, YYYY hh:mm a"),
                    payment_unixtime: paytime,
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
    
            if (!webhookResult.success) {
                logger.warn(`Failed to send webhook for transaction ${localTrans.reference}: ${webhookResult.error}`);
            } else {
                logger.info(`Webhook sent successfully for transaction ${localTrans.reference}`);
            }

            return res.json({
                status: true,
                message: 'Payment successfully Processed.',
                data: {
                status: 'paid',
                reference: reference,
                amount: localTrans.amount,
                amountpaid: amount_total,
                customer_email: localTrans.customer_email,
                customer_name: localTrans.customer_name,
                pay_desc: !localTrans.pay_desc ? '' : localTrans.pay_desc
                }
            });

        } else {
            return res.status(404).json({ 
                status: false, 
                message: !lookupResponse.status ? 'Unable to retrieve payment details at the moment' : lookupResponse.status, 
                data: lookupResponse 
            });
        }

    } catch (error) {
        // Log the full error for debugging purposes.
        logger.error('Error in initiatePayment:', { message: error.message, providerResponse: error.providerResponse, stack: error.stack });

        const errorMessage = error.providerResponse?.message || error.message || 'Unable to completely process your request.';

        const statusCode = error.providerResponse ? 400 : 500;
        return res.status(statusCode).json({ status: false, message: errorMessage });
    }
};


module.exports = {
  initPayWithHitchPay,
  getXRate,
  initiateCheckoutGlobal,
  verifyGlobalPay
}