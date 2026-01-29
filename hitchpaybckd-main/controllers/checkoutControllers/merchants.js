const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
moment.tz.setDefault('Africa/Lagos');
const { mailSender } = require('../../config/mailsender');
// const { getUserInfo, getBal } = require("../../config/userdetails");
const { Op, fn, col } = require("sequelize");
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
const crypto = require('crypto');
// const { time, Console } = require('console');
const { formatAmount, cleanMe, ucFirst, calcCheckOutFee } = require("../../config/myfunct");
const { cloudinary } = require("../../config/imageuploads");
const { logger } = require('../../config/logger');
const md5 = require('md5');
const randomstring = require("randomstring");

/* models */
const PayLink = db.paylinks;
const AppSett = db.appsettings;
const Customer = db.customers;
const Admin = db.admin;
const Business = db.business;
const CheckoutTrans = db.checkouttrans



const createPayLink = async (req, res) => {
  const t = await db.sequelize.transaction();
  try {
    const adminid = req.user.id;
    if (!adminid) {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const { customeremail, usertype, tagname, description, currencies } = cleanMe(req.body);

    if (!customeremail || !usertype || !tagname || !currencies) {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'Missing required fields.' });
    }

    if (!Array.isArray(currencies) || currencies.length === 0) {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'Currencies must be a non-empty array.' });
    }

    // validate if the customer id exist
    let userExists;
    if (usertype === 'personal') {
      userExists = await Customer.findOne({ where: { email: customeremail }, transaction: t });
    } else if (usertype === 'business') {
      userExists = await Business.findOne({ where: { business_email: customeremail }, transaction: t });
    } else {
      await t.rollback();
      return res.status(400).json({ status: false, message: 'Invalid user type.' });
    }

    if (!userExists) {
      await t.rollback();
      return res.status(404).json({ status: false, message: `${ucFirst(usertype)} with ${customeremail} not found.` });
    }

    // Generate a unique slug
    let slug = tagname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '');
    let existingLink = await PayLink.findOne({ where: { slug: slug }, transaction: t });

    let counter = 1;
    while (existingLink) {
      slug = `${tagname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '')}-${counter}`;
      existingLink = await PayLink.findOne({ where: { slug: slug }, transaction: t });
      counter++;
    }

    var dtimed = Math.floor(Date.now() / 1000);
    const newPayLink = await PayLink.create({
      userid: userExists.id, usertype, tagname, slug, description,
      currencies: currencies, timed: dtimed, status: 1, reference: uuidv4()
    }, { transaction: t });

    await t.commit();

    res.status(201).json({
      status: true,
      message: 'Payment link created successfully.',
      data: newPayLink,
    });

  } catch (error) {
    await t.rollback();
    console.error(error);
    logger.error(error);
    res.status(500).json({ status: false, message: 'Unable to process request' + error.message });
  }
}


// gget all payment for admin 
const getAllPayLinks = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const payLinks = await PayLink.findAll({
      order: [['id', 'DESC']],
    });

    // i want to format the timed and status coming from the  payLinks
    const formattedPayLinks = await Promise.all(payLinks.map(async (link) => {
      const formattedTimed = moment.unix(link.timed).format("Do MMM, YYYY hh:mm a");
      const statusText = link.status === 1 ? 'Active' : 'Inactive';
      let ownerEmail = '';
      if (link.usertype === 'personal') {
        const customer = await Customer.findOne({ where: { id: link.userid } });
        ownerEmail = customer ? customer.email : 'N/A';
      } else if (link.usertype === 'business') {
        const business = await Business.findOne({ where: { id: link.userid } });
        ownerEmail = business ? business.business_email : 'N/A';
      }
      return {
        ...link.toJSON(),
        timed: formattedTimed,
        statusText: statusText,
        ownerEmail: ownerEmail,
      };
    }));


    res.status(200).json({
      status: true,
      message: 'Payment links retrieved successfully.',
      data: formattedPayLinks,
    });

  } catch (error) {
    console.error(error);
    logger.error(error);
    res.status(500).json({ status: false, message: 'Unable to process request' });
  }
};

// get all payment for a user
const getUserPayLinks = async (req, res) => {
  try {
    const userid = req.user.id;
    if (!userid) {
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const payLinks = await PayLink.findAll({
      where: { userid: userid },
      order: [['id', 'DESC']],
    });

    res.status(200).json({
      status: true,
      message: 'Payment links retrieved successfully.',
      data: payLinks,
    });

  } catch (error) {
    console.error(error);
    logger.error(error);
    res.status(500).json({ status: false, message: 'Unable to process request' });
  }
};

const getMerchantSlug = async (req, res) => {
  try {
    const { payslug } = cleanMe(req.params);

    if (!payslug)
      return res.status(400).json({ status: false, message: 'Eh! Invalid payment link!' });

    // get the details from PayLink table
    const payLink = await PayLink.findOne({ where: { slug: payslug } });

    if (!payLink) {
      return res.status(404).json({ status: false, message: 'Payment link not found.' });
    }

    const userid = payLink.userid;
    let merchantName;
    let merchantLogo = ''; // Initialize with empty string
    let merchantDescription = payLink.description;

    if (payLink.usertype === 'personal') {
      const customer = await Customer.findOne({ where: { id: userid } });
      merchantName = customer ? `${customer.firstname} ${customer.lastname}` : '';
      merchantLogo = customer ? customer.profilepic : ''; // Assuming customer has a profilepic field
    } else if (payLink.usertype === 'business') {
      const business = await Business.findOne({ where: { id: userid } });
      merchantName = business ? business.businessname : '';
      merchantLogo = business ? business.businesslogo : ''; // Assuming business has a businesslogo field
    } else {
      merchantName = '';
    }

    const additionalInfo = payLink.slug.includes('weldios') ? true : false;

    // return the details as shown below
    res.json({
      status: true,
      message: 'Merchant Details Retrieved',
      data: {
        "payid": payLink.id,
        "userid": payLink.userid,
        "usertype": payLink.usertype,
        "tagname": payLink.tagname,
        "slug": payLink.slug,
        "payslugid": payLink.reference,
        "name": merchantName,
        "logo": merchantLogo,
        "description": merchantDescription,
        "currencies": payLink.currencies,
        "collect_additional_info": additionalInfo
      }
    });


  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


const initCheckPay = async (req, res) => {

  try {
    const { fname, lname, email, amount, currency, payslugid, pay_desc, designation, gender, organization, role, receive_updates, consent } = cleanMe(req.body)

    // console.log('req.body', req.body)

    // validations
    if (!fname || !lname || !email || !amount || !currency || !payslugid) {
      return res.status(400).json({ status: false, message: 'Some required fields are missing. Kindly check and try again.' });
    }

    if (isNaN(amount) || amount <= 0) {
      return res.status(400).json({ status: false, message: 'Invalid amount.' });
    }

    // add max amount limit for ngn - 5000000 and usd max - 10000
    if (currency === 'NGN' && amount > 5000000) {
      return res.status(400).json({ status: false, message: "Maximum amount for NGN is 5,000,000." });
    }
    if (currency === 'USD' && amount > 10000) {
      return res.status(400).json({ status: false, message: "Maximum amount for USD is 10,000." });
    }

    const name = `${fname} ${lname}`;
    const customer_email = email;


    // get the owner of the  payment link
    const payLink = await PayLink.findOne({ where: { reference: payslugid } });

    if (!payLink) {
      return res.status(404).json({ status: false, message: 'Payment link not found.' });
    }

    const dtimed = Math.floor(Date.now() / 1000);
    const userid = payLink.userid;
    let merchantName;

    if (payLink.usertype == 'personal') {
      const customer = await Customer.findOne({ where: { id: userid } });
      merchantName = customer ? `${customer.firstname} ${customer.lastname}` : '';
    } else if (payLink.usertype == 'business') {
      const business = await Business.findOne({ where: { id: userid } });
      merchantName = business ? business.businessname : '';
    } else {
      merchantName = '';
    }

    const reference = 'HCHK' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 12);
    //log the transction on the checkout trans

    const metadata = JSON.stringify({ designation: designation, gender: gender, organization: organization, role: role, receive_updates, consent });

    let paymode = 'live';
    if (process.env.APPENV == 'development') {
      paymode = 'test';
    }

    const newCheckoutTrans = await CheckoutTrans.create({
      ownerid: userid, usertype: payLink.usertype,
      reference: reference, amount: amount, currency: currency, customer_name: name, paychannel: 'checkout',
      customer_email: email, productid: merchantName, paidthru: '', status: '0', pay_desc,
      timed: dtimed, meta: metadata, mode: paymode
    });


    if (!newCheckoutTrans) {
      return res.status(404).json({ status: false, message: 'Unable to initiate checkout transaction' });
    }

    if (process.env.APPENV == 'production') {
      var payment_url = `https://payment.hitchpay.ng/checkout/${reference}`;
      // var payment_url = `http://localhost:3000/checkout/${reference}`;
    } else {
      var payment_url = `https://dev-payment.hitchpay.ng/checkout/${reference}`;
      // var payment_url = `http://localhost:3000/checkout/${reference}`;
    }


    res.json({
      status: true,
      message: 'Payment Initiated',
      data: {
        payment_url: payment_url,
        reference: reference,
        amount: amount,
        currency: currency,
        customer_name: name,
        customer_email: email,
        pay_desc: pay_desc
      }
    })
    
  } catch (err) {
    // console.error(err)
    logger.error(err)
    // Correctly handle the error response
    if (err.response) {
      res.status(500).json({ status: false, message: err.response.data?.error?.message || 'An error occurred with the payment provider.' });
    } else {
      res.status(500).json({ status: false, message: err.message || 'An internal server error occurred.' });
    }
  }
}

const getCheckoutDetails = async (req, res) => {
  try {
    const { reference } = cleanMe(req.params);

    if (!reference) {
      return res.status(400).json({ status: false, message: 'Transaction reference is required.' });
    }

    const checkoutTrans = await CheckoutTrans.findOne({ where: { reference: reference } });

    if (!checkoutTrans) {
      return res.status(404).json({ status: false, message: 'Checkout transaction not found.' });
    }

    if (checkoutTrans.status == 1) {
      return res.status(404).json({ status: false, message: 'Transactions already completed.' });
    }

    let merchantName;
    let merchantLogo = '';
    let merchantEmail = '';

    if (checkoutTrans.usertype === 'personal') {
      const customer = await Customer.findOne({ where: { id: checkoutTrans.ownerid } });
      merchantName = customer ? `${customer.firstname} ${customer.lastname}` : '';
      merchantLogo = customer ? customer.profilepic : '';
      merchantEmail = customer ? customer.email : '';
    } else if (checkoutTrans.usertype === 'business') {
      const business = await Business.findOne({ where: { id: checkoutTrans.ownerid } });
      merchantName = business ? business.business_name : '';
      merchantLogo = business ? business.logo : '';
      merchantEmail = business ? business.business_email : '';
    } else {
      merchantName = '';
    }

    /* get fee*/
    const theFee = await calcCheckOutFee('', parseFloat(checkoutTrans.amount), checkoutTrans.currency);
    const gatewayfee = theFee[1];
    const ourfee = theFee[2];
    const TotalFee = theFee[3];

    res.status(200).json({
      status: true,
      message: 'Checkout details retrieved successfully.',
      data: {
        checkout: {
          reference: checkoutTrans.reference,
          amount: checkoutTrans.amount,
          total_amount: parseFloat(checkoutTrans.amount) + parseFloat(TotalFee),
          currency: checkoutTrans.currency,
          customer_name: checkoutTrans.customer_name,
          customer_email: checkoutTrans.customer_email,
          pay_desc: checkoutTrans.pay_desc,
          status: checkoutTrans.status,
          paidthru: checkoutTrans.paidthru,
          callback_url: checkoutTrans.redirecturl,
          mode: checkoutTrans.mode,
          payment_amount: checkoutTrans.payment_amount,
          payment_date: checkoutTrans.payment_date ? moment.unix(checkoutTrans.payment_date).format('YYYY-MM-DD HH:mm:ss') : null,
          allow_currency_selection: checkoutTrans.multicurrency,
          payment_provider: (checkoutTrans.multicurrency == 1 && checkoutTrans.currency == 'USD') ? 'yellowcard' : '',
        },
        merchant: {
          name: merchantName,
          logo: merchantLogo,
          email: merchantEmail,

        }
      }
    });

  } catch (error) {
    logger.error('Error retrieving checkout details:', error);
    res.status(500).json({ status: false, message: 'An error occurred while retrieving checkout details.' });
  }
};




module.exports = {
  createPayLink, getAllPayLinks, getUserPayLinks, getMerchantSlug, initCheckPay, getCheckoutDetails
};