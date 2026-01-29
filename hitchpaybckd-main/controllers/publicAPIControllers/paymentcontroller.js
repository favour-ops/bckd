const { success, error } = require("../../utils/pubapi_response.js");
const { cleanMe } = require("../../config/myfunct.js");
const { logger } = require('../../config/logger');
const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const md5 = require('md5');
const randomstring = require("randomstring");
const { response } = require("express");

const AppSett = db.appsettings;
const Customer = db.customers;
const Admin = db.admin;
const Business = db.business;
const CheckoutTrans = db.checkouttrans


const initiatePayment = async(req, res, next) => {
  try {
    const { amount, currency, customer, reference, allow_currency_selection } = req.body;
    const callback_url = req.body.callback_url;

    if (!amount || !currency || !customer?.email || !customer?.name) 
      return error(res, "INVALID_REQUEST", "Missing required fields");

    if (isNaN(amount) || amount <= 0) {
        return error(res, "INVALID_REQUEST", "Invalid amount");
    }

    if(allow_currency_selection && currency != 'USD'){
      return error(res, "INVALID_REQUEST", "Muilti-currecy selections only allows USD as base currency");
    }

    // add max amount limit for ngn - 5000000 and usd max - 10000
    if (currency == 'NGN' && amount > 5000000) {
        return error(res, "INVALID_REQUEST", "Maximum amount for NGN is 5,000,000.");
    }
    if (currency == 'USD' && amount > 10000) {
        return error(res, "INVALID_REQUEST", "Maximum amount for USD is 10,000.");
    }
    

    const customer_name = customer.name
    const customer_email = customer.email;

    // get business/merhcnat that made the call to the initialize payment 
    const merchant = req.merchant; 
    const userid = merchant.bizid; //owner ID
    const keymode = merchant.keymode;
    const usertype = 'business'
    let multicurrency = 0;
    if(allow_currency_selection && (allow_currency_selection == 1 || allow_currency_selection == true)){
      multicurrency = 1
    }

     // check if the external reference doesnt exist before
    const existingTrans = await CheckoutTrans.findOne({ where: { external_reference: reference, ownerid: userid } });
    if (existingTrans) {
        return error(res, "DUPLICATE_REQUEST", "A transaction with this external reference already exists for this merchant.");
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
        customer_name: customer_name, paychannel: 'api', customer_email: customer_email, 
        productid: merchantName, paidthru: '', status: '0', pay_desc: '', timed: dtimed, 
        external_reference: reference, meta: '', redirecturl: callback_url, mode: paymode,
        multicurrency: multicurrency
    });
    

    if (!newCheckoutTrans) {
        return error(res, "REQUEST_FAILED", "Failed to initiate checkout transaction");   
    }
    

    if(process.env.APPENV == 'production'){
       var payment_url = `https://payment.hitchpay.ng/checkout/${txref}`;
      //  var payment_url = `http://localhost:3000/checkoutpay/${txref}`;
    }else{
      var payment_url = `https://dev-payment.hitchpay.ng/checkout/${txref}`;
      // var payment_url = `http://localhost:3000/checkoutpay/${txref}`;
    }

    return success(res, { payment_url, reference: txref, external_reference: reference}, "Payment initiated");

  } catch (err) {
    next(err);
  }
};



const verifyPayment = async(req, res, next) => {
  try {
    const { reference } = cleanMe(req.params);

    if (!reference) {
      return error(res, "INVALID_REQUEST", "Transaction reference is required.");
    }

    // Find the transaction in your database
    const checkoutTrans = await CheckoutTrans.findOne({ where: { reference: reference } });

    if (!checkoutTrans) {
      return error(res, "NOT_FOUND", "Transaction not found.");
    }

    // Determine the status message based on the 'status' field
    let statusMessage; let respMessage
    switch (checkoutTrans.status) {
      case 0:
        statusMessage = 'pending';
        respMessage = 'Payment unverified'
        break;
      case 1:
        statusMessage = 'successful';
        respMessage = 'Payment verified'
        break;
      case 2:
        statusMessage = 'failed';
        respMessage = 'Payment failed'
        break;
      case 3:
        statusMessage = 'partial';
        respMessage = 'Partial payment'
        break;
      default:
        statusMessage = 'unknown';
        respMessage = ''
        break
    }

    let merchantName;
    let merchantLogo = '';
    let merchantEmail = '';

    if (checkoutTrans.usertype == 'personal') {
      const customer = await Customer.findOne({ where: { id: checkoutTrans.ownerid } });
      merchantName = customer ? `${customer.firstname} ${customer.lastname}` : 'Unknown Merchant';
      merchantLogo = customer ? customer.profilepic : '';
      merchantEmail = customer ? customer.email : '';
    } else if (checkoutTrans.usertype == 'business') {
      const business = await Business.findOne({ where: { id: checkoutTrans.ownerid } });
      merchantName = business ? business.businessname : 'Unknown Business';
      merchantLogo = business ? business.businesslogo : '';
      merchantEmail = business ? business.business_email : '';
    } else {
      merchantName = 'Unknown Merchant';
    }

    return success(res, {
      status: statusMessage,
      response_code: `0${checkoutTrans.status}`,
      amount: checkoutTrans.amount,
      currency: checkoutTrans.currency,
      amount_paid: !checkoutTrans.payment_amount ? 0 : checkoutTrans.payment_amount,
      external_reference: '',
      reference: checkoutTrans.reference,
      paid_at: checkoutTrans.payment_date ? new Date(checkoutTrans.payment_date * 1000).toISOString() : null,
      description: checkoutTrans.pay_desc,
      payment_channel: checkoutTrans.paidthru,
      customer: {
        email: checkoutTrans.customer_email,
        name: checkoutTrans.customer_name,
      },
      merchant: {
        name: merchantName,
        email: merchantEmail,
      }
      
    }, respMessage);

    
  } catch (err) {
    next(err);
  }
};


const getMerchantPayments = async (req, res, next) => {
  try {
    const merchant = req.merchant; // This comes from the verifyAccessToken middleware
    const userid = merchant.bizid;
    const usertype = 'business';

    const { page = 1, limit = 10, status, currency } = cleanMe(req.query);
    const offset = (page - 1) * limit;

    const whereClause = {
      ownerid: userid,
      usertype: usertype,
      paychannel: 'api', // Filter for payments initiated via API
    };

    if (status) {
      // Map status string to integer
      const statusMap = {
        'pending': 0,
        'successful': 1,
        'failed': 2,
        'partial': 3,
      };

      

      if (statusMap[status.toLowerCase()] !== undefined) {
        whereClause.status = statusMap[status.toLowerCase()];
      } else {
        return error(res, "INVALID_REQUEST", "Invalid status filter. Allowed values: pending, successful, failed, partial.");
      }
    }

    // console.log('statusMap', whereClause.status)

    if (currency) {
      whereClause.currency = currency.toUpperCase();
    }

    const { count, rows: payments } = await CheckoutTrans.findAndCountAll({
      where: whereClause,
      limit: parseInt(limit),
      offset: parseInt(offset),
      order: [['timed', 'DESC']],
    });

    const formattedPayments = await Promise.all(payments.map(async (payment) => {
      let merchantName;
      let merchantLogo = '';
      let merchantEmail = '';

      if (payment.usertype == 'personal') {
        const customer = await Customer.findOne({ where: { id: payment.ownerid } });
        merchantName = customer ? `${customer.firstname} ${customer.lastname}` : 'Unknown Merchant';
        merchantLogo = customer ? customer.profilepic : '';
        merchantEmail = customer ? customer.email : '';
      } else if (payment.usertype == 'business') {
        const business = await Business.findOne({ where: { id: payment.ownerid } });
        merchantName = business ? business.businessname : 'Unknown Business';        
        merchantLogo = business ? business.businesslogo : '';
        merchantEmail = business ? business.business_email : '';
      } else {
        merchantName = 'Unknown Merchant';
      }

      let statusMessage;
      switch (payment.status) {
        case 0: statusMessage = 'pending'; break;
        case 1: statusMessage = 'successful'; break;
        case 2: statusMessage = 'failed'; break;
        case 3: statusMessage = 'partial'; break;
        default: statusMessage = 'unknown'; break;
      }

      return {
        status: statusMessage,
        response_code: `0${payment.status}`,
        amount: payment.amount,
        currency: payment.currency,
        amount_paid: !payment.payment_amount ? 0 : payment.payment_amount,
        external_reference: payment.external_reference || null, // Assuming you might add this field later
        reference: payment.reference,
        paid_at: payment.payment_date ? new Date(payment.payment_date * 1000).toISOString() : null,
        description: payment.pay_desc,
        payment_channel: payment.paidthru,
        customer: {
          email: payment.customer_email,
          name: payment.customer_name,
        },
        merchant: {
          name: merchantName,
          email: merchantEmail,
        }
      };
    }));

    return success(res, {
      total_count: count,
      page: parseInt(page),
      limit: parseInt(limit),
      payments: formattedPayments,
    }, "Payments history retrieved successfully.");

  } catch (err) {
    next(err);
  }
};

const initCheckoutPay = async(req, res, next) => {
  try {
    const { amount, currency, customer, reference } = req.body;
    const callback_url = req.body.callback_url;

    if (!amount || !currency || !customer?.email || !customer?.name) 
      return error(res, "INVALID_REQUEST", "Missing required fields");

    if (isNaN(amount) || amount <= 0) {
        return error(res, "INVALID_REQUEST", "Invalid amount");
    }

    // add max amount limit for ngn - 5000000 and usd max - 10000
    if (currency == 'NGN' && amount > 5000000) {
        return error(res, "INVALID_REQUEST", "Maximum amount for NGN is 5,000,000.");
    }
    if (currency == 'USD' && amount > 10000) {
        return error(res, "INVALID_REQUEST", "Maximum amount for USD is 10,000.");
    }
    

    const customer_name = customer.name
    const customer_email = customer.email;

    // get business/merhcnat that made the call to the initialize payment 
    const merchant = req.merchant; 
    const userid = merchant.bizid; //owner ID
    const keymode = merchant.keymode;
    const usertype = 'business'

     // check if the external reference doesnt exist before
    const existingTrans = await CheckoutTrans.findOne({ where: { external_reference: reference, ownerid: userid } });
    if (existingTrans) {
        return error(res, "DUPLICATE_REQUEST", "A transaction with this external reference already exists for this merchant.");
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
        ownerid: userid, usertype: usertype, reference: txref, amount: amount, currency: 'usd', 
        customer_name: customer_name, paychannel: 'api', customer_email: customer_email, 
        productid: merchantName, paidthru: '', status: '0', pay_desc: '', timed: dtimed, 
        external_reference: reference, meta: '', redirecturl: callback_url, mode: paymode
    });
    

    if (!newCheckoutTrans) {
        return error(res, "REQUEST_FAILED", "Failed to initiate checkout transaction");   
    }
    

    if(process.env.APPENV == 'production'){
       var payment_url = `https://payment.hitchpay.ng/checkoutpay/${txref}`;
      //  var payment_url = `http://localhost:3000/checkoutpay/${txref}`;
    }else{
      var payment_url = `https://dev-payment.hitchpay.ng/checkoutpay/${txref}`;
      // var payment_url = `http://localhost:3000/checkoutpay/${txref}`;
    }

    return success(res, { 
      payment_url, 
      reference: txref, 
      external_reference: reference
    }, "Payment initiated");

  } catch (err) {
    next(err);
  }
};




module.exports = {
  initiatePayment,
  verifyPayment,
  getMerchantPayments,
  initCheckoutPay
};