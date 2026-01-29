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

// add stripe 

const PayLink = db.paylinks;
const AppSett = db.appsettings;
const Customer = db.customers;
const Business = db.business;
const CheckoutTrans = db.checkouttrans
const payWhk = db.whookhandler;


const initStripeCheckout = async (req, res) => {

  try {
    const { reference } = cleanMe(req.body);
    // get the owner of the payment link
    if (!reference) {
      return res.status(400).json({ status: false, message: 'Kindly reload page and try again.' });
    }
    const getPayment = await CheckoutTrans.findOne({ where: { reference: reference } });

    if (!getPayment) {
      return res.status(404).json({ status: false, message: 'Payment not found.' });
    }

    //  validate is payment already processed
    if (getPayment.status == '1') {
      return res.status(404).json({ status: false, message: 'Payment already processed.' });
    }


    const amount = getPayment.amount;
    const currency = getPayment.currency;
    const customer_name = getPayment.customer_name;
    const customer_email = getPayment.customer_email;
    const pay_desc = getPayment.pay_desc;
    const usertype = getPayment.usertype;
    const ownerid = getPayment.ownerid;
    const paymode = getPayment.mode;

    const name = customer_name;
    const email = customer_email;
    const payslugid = reference;

    const theFee = await calcCheckOutFee('stripe', parseFloat(amount), 'USD');
    const gatewayfee = theFee[1];
    const ourfee = theFee[2];
    const TotalFee = theFee[3];

    const payAmount = parseFloat(amount) + parseFloat(TotalFee);

    // Convert USD amount to cents
    const amountInCents = Math.round(payAmount * 100)

    //redirectulr
    if (process.env.APPENV == 'production') {
      var redirecturl = process.env.STRIPE_REDIRECT_URL; //live
    } else {
      var redirecturl = process.env.STRIPE_REDIRECT_URL;  //test
    }

    // const userid = ownerid;
    let merchantName = '';

    const session = await stripe.checkout.sessions.create({
      customer_email: email,
      mode: 'payment',
      client_reference_id: reference,
      currency: 'USD',
      automatic_tax: {
        enabled: true,
      },
      branding_settings: {
        background_color: '#ffffff',
        border_style: 'rounded',
        button_color: '#d400c7',
        display_name: 'HitchPay',
        font_family: 'default'
      },
      metadata: {
        order_id: reference,
        customer_name: name,
        pay_desc: pay_desc,
      },
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Payment to ${merchantName}`,
              description: `Customer: ${name}`,
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],

      success_url: `${redirecturl}/success?reference=${reference}`,
      cancel_url: `${redirecturl}/checkout?canceled=true`,
    })

    // Store the Stripe session ID in your transaction record
    // Safely parse existing metadata and merge new data
    let existingMeta = {};
    try {
      if (getPayment.meta) {
        existingMeta = JSON.parse(getPayment.meta);
      }
    } catch (e) {
      logger.warn(`Could not parse existing metadata for reference ${reference}. It will be overwritten.`);
    }

    // console.log('sessionid', session)

    const newMeta = Object.assign(existingMeta, { sessionid: session.id });

    await CheckoutTrans.update({
      provref: session.id, paidthru: 'stripe',
      meta: JSON.stringify(newMeta), payment_amount: payAmount
    }, { where: { ownerid: ownerid, reference: reference } });

    res.json({
      status: true,
      message: 'Payment Initiated',
      data: {
        url: session.url,
        reference: reference,
        account_number: '',
        bank_name: '',
        account_name: '',
        validFor: '',
        account_bank: '',
        mode: process.env.APPENV == 'development' ? 'sandbox' : 'live',
        amount: payAmount,
        currency: currency,
        customer_name: customer_name,
        customer_email: customer_email,
        pay_desc: pay_desc
      }
    })

  } catch (err) {
    console.error(err)
    logger.error(err)
    // Correctly handle the error response
    if (err.response) {
      res.status(500).json({ status: false, message: err.response.data?.error?.message || 'An error occurred with the payment provider.' });
    } else {
      res.status(500).json({ status: false, message: err.message || 'An internal server error occurred.' });
    }
  }
}

const stripeWebhkHandlerTest = async (req, res) => {
  const sig = req.headers['stripe-signature']
  console.log('signature', sig)
  const endpointSecret = !process.env.STRIPE_WEBHOOK_SECRET ? 'whsec_soW8bBXiP4lfHaYQwDpSANAlm5QbiL7M' : process.env.STRIPE_WEBHOOK_SECRET;

  // Check if the webhook secret is available
  if (!endpointSecret) {
    logger.error('Missing STRIPE_WEBHOOK_SECRET environment variable');
    return res.status(500).send('Webhook Error: Configuration error');
  }

  res.status(200).json({ status: true, message: "STRP Webhook received and queued for processing." });

  let event
  console.log('req.body', JSON.stringify(req.rawBody))
  console.log('req.headers', req.headers)
  try {

    event = stripe.webhooks.constructEvent(JSON.stringify(req.body), sig, endpointSecret);

  } catch (err) {
    logger.error(`Webhook signature verification failed: ${err}`);
    return;
    // return res.status(400).send(`Webhook Error: ${err.message}`)
  }

  if (!event || typeof event != 'object' || Object.keys(event).length == 0) {
    logger.warn('Invalid event: Request body is empty or not an object');
    return;
    // return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
  }

  // Log the raw event for debugging
  const dbody = req.body.toString('utf8'); // Log the original raw body
  let dtimed = Math.floor(Date.now() / 1000);

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
      // Store the webhook event with the transaction reference
      await payWhk.create({ resp: dbody, txref: client_reference_id || '', gateway: 'stripe', timed: dtimed, processed: 0 });

      // Update your transaction record in the database
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
  }
}


const verifyStripeCheckout = async (req, res) => {
  try {
    const { reference } = req.params;

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
          amount: localTrans.amount,
          amountpaid: localTrans.payment_amount,
          customer_email: localTrans.customer_email,
          customer_name: localTrans.customer_name
        },
      });
    }

    // --- Phase 2: External API Call (Outside of any DB Transaction) ---
    const sessionId = localTrans.provref;
    if (!sessionId) {
      return res.status(400).json({ status: false, message: 'Stripe session ID not found for this transaction.' });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status == 'paid') {
      const amount_total = session.amount_total / 100; // Convert from cents

      // validate if amount paid is less than expected amount
      if (amount_total < parseFloat(localTrans.amount)) {
        logger.warn(`Stripe webhook: Received amount ${amount_total} is less than expected ${localTrans.amount} for transaction ${reference}.`);
        await localTrans.update({
          status: '3',
          payment_amount: amount_total,
          payment_date: Math.floor(Date.now() / 1000)
        });
        return res.status(200).json({ status: false, message: 'Partial payment received.' });
      }

      // Use a managed transaction for atomicity
      const ownerid = localTrans.ownerid;
      const usertype = localTrans.usertype;


      /* calc settlement amount */
      const theFee = await calcCheckOutFee('stripe', parseFloat(localTrans.amount), 'USD');
      const gatewayfee = theFee[1];
      const ourFee = theFee[2];
      const TotalFee = theFee[3];

      var settledAmount = parseFloat(amount_total) - parseFloat(TotalFee);
      const revenue = ourFee;

      await db.sequelize.transaction(async (t) => {
        const transactionMode = localTrans.mode;
        const userbal = await getLedgerBal(ownerid, 'USD', { transaction: t }, usertype, transactionMode);

        // Update ledger balance
        const newbal = await updateLedgerBalance(ownerid, settledAmount, 'USD', 'credit', { transaction: t }, true, usertype, transactionMode);

        // Update the checkout transaction record
        await CheckoutTrans.update(
          {
            status: '1', payment_amount: amount_total, paidthru: 'stripe',
            payment_date: Math.floor(Date.now() / 1000),
            prevbal: userbal, newbal: newbal, fee: ourFee, revenue: revenue
          }, { where: { reference: reference }, transaction: t }
        );
      });

      // --- Phase 4: Post-Transaction Notifications (run outside the DB transaction) ---
      const customerSubject = `Payment Confirmation for Your Purchase`;
      const customerEmailContent = `
          <p>Dear ${localTrans.customer_name},</p>
          <p>Your payment of <strong>${localTrans.currency} ${formatAmount(amount_total)}</strong> for 
          <strong>${!localTrans.pay_desc ? 'puchases' : localTrans.pay_desc}</strong> has been successfully processed.</p>
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

        // send webhook notification to merchant's webhook url if set
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

        if (!webhookResult.success) {
          logger.warn(`Failed to send webhook for transaction ${localTrans.reference}: ${webhookResult.error}`);
        } else {
          logger.info(`Webhook sent successfully for transaction ${localTrans.reference}`);
        }

      } catch (notificationError) {
        logger.error('Error sending merchant notification for Stripe payment:', notificationError);
        // Don't fail the request, just log the error.
      }

      // Fire off the webhook event. No need to await it.
      // dispatchEvent('transaction.updated', {
      //   status: 'successful',
      //   reference: reference,
      //   amount: amount_total,
      //   currency: localTrans.currency,
      //   description: localTrans.pay_desc
      // });

      return res.json({
        status: true,
        message: 'Payment successful.',
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
      return res.status(400).json({ status: false, message: 'Payment not completed.', data: { status: session.payment_status } });
    }

  } catch (error) {
    logger.error('Error verifying Stripe checkout session:', error);
    res.status(500).json({ status: false, message: 'An error occurred while verifying the payment.' });
  }
};


module.exports = {
  initStripeCheckout, stripeWebhkHandlerTest, verifyStripeCheckout
}