const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
moment.tz.setDefault('Africa/Lagos');
const { mailSender } = require('../../config/mailsender');
const { Op, fn, col } = require("sequelize");
const { getUserInfo, getBal, getLedgerBal } = require("../../config/userdetails");
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");

const { formatAmount, cleanMe, ucFirst, calcCheckOutFee, updateLedgerBalance, dispatchEvent } = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const { log } = require('winston');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const ExternaUser = db.kadusers
const AppSett = db.appsettings;
const Customer = db.customers;
const LogRequest = db.logrequest;
const LogResponse = db.logresponse;
const KycDoc = db.kycdoc;
const KYC = db.kyc;
const RemittanceAccounts = db.remittance_accounts;
const RemittancePay = db.remittancepay;
const Payn = db.payn


const enrollCustomerStripe = async (userid, customerData) => {
    try {
        const existingCustomer = await ExternaUser.findOne({ where: { userid: userid, provider: 'stripe' } });

        if (existingCustomer && existingCustomer.trackingid) {
            logger.info(`createCustomer: Strp customer already exists for internal user ${userid}. GUID: ${existingCustomer.trackingid}`);

            return [true, existingCustomer.trackingid, 'Customer already exists with banking provider'];
        }


        const customer = await stripe.customers.create({
            name: customerData.firstname + ' ' + customerData.lastname,
            email: customerData.email,
        });

        // console.log('customer', customer)
        if (customer && customer.id) {
            var customerId = customer.id;
            var bank_guid = customer.bank_guid;
            var state = customer.state;

            //create the customer on the ExternaUser table
            await ExternaUser.create({ userid: userid, provider: 'stripe', trackingid: customerId, status: '1', verstate: '', timed: '', tier: '1' });

            logger.info(`createCustomer: Strp customer created successfully for internal user ${userid}. GUID: ${customerId}`);
            return [true, customerId, 'Customer created successfully'];

        } else {
            logger.error('createCustomer: Failed to create Strp customer.', customer);
            return [false, null, 'Failed to create customer'];
        }


    } catch (error) {
        logger.error('createCustomer: Error creating Strp customer', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.message || 'Error creating customer'];
    }
}

const createIntent = async (userid, customerid) => {
    try {
        const intent = await stripe.setupIntents.create({
            customer: customerid,
            payment_method_types: ['card'],
            confirm: false,
            usage: 'off_session'
        });


        // console.log('intent', intent);

        if (intent && intent.client_secret) {
            const intent_id = intent.id;
            const clientSecret = intent.client_secret;
            const payment_method = intent.payment_method;


            //create remittance account
            var dtimed = Date.parse(new Date()) / 1000;

            await RemittanceAccounts.create({
                userid: userid, customer_guid: customerid, workflow_id: '', link_token: clientSecret,
                link_state: 'storing', external_bank_guid: '', provider: 'stripe', status: 0, timed: dtimed
            });

            logger.info(`createCustomer: Strp customer intent created successfully for internal user ${userid}. GUID: ${intent_id}`);
            return [true, clientSecret, 'Customer intent created successfully'];

        } else {
            logger.error('createCustomer: Failed to create Strp customer intent.', intent);

        }

    } catch (error) {
        logger.error('createCustomer: Error creating Strp customer intent ', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.message || 'Error creating customer intent'];
    }
}

const customerSession = async (userid, customerid, remittanceid) => {
    try {
        const customerSession = await stripe.customerSessions.create({
            customer: customerid,
            components: {
                payment_element: {
                    enabled: true,
                },
                buy_button: {
                    enabled: false
                }
            },
        });

        // console.log('customerSession', customerSession);

        if (customerSession && customerSession.client_secret) {
            const client_secret = customerSession.client_secret;

            //udpate remttance account
            await RemittanceAccounts.update({
                workflow_id: client_secret
            }, {
                where: { userid: userid, id: remittanceid }
            });
            logger.info(`createCustomer: Strp customer session created successfully for internal user ${userid}. GUID: ${client_secret}`);
            return [true, client_secret, 'Customer session created successfully'];

        } else {
            logger.error('createCustomer: Failed to create Strp customer session.', customerSession);
            return [false, null, 'Failed to create customer session'];
        }

    } catch (error) {
        logger.error('createCustomer: Error creating Strp customer session ', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.message || 'Error creating customer session'];
    }

}

const initiatCardLink = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    try {
        // get the cutomer info
        const getUser = await Customer.findOne({ where: { id: userid } });

        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });

        //check the country of the customer to be US
        if (getUser.countrycode != 'US') {
            return res.status(400).json({ status: false, message: 'Remittance service is only available for US customers at the moment.' });
        }

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'stripe' } });
        if (!customerRecord) {

            //CALL THE CREATE CUSTOMER FUNCTION HERE
            const [createSuccess, customerId, createMessage] = await enrollCustomerStripe(userid, getUser);

            if (!createSuccess) {
                return res.status(500).json({ status: false, message: createMessage || 'Failed to create customer remittance account with the partner bank.' });
            }

            // gettjhe intent secret
            const [intentSuccess, intentSecret, intentMessage] = await createIntent(userid, customerId);

            if (!intentSuccess) {
                return res.status(500).json({ status: false, message: intentMessage || 'Failed to create customer remittance account with the partner bank.' });
            }

            //get the remittance account
            const remittanceAccount = await RemittanceAccounts.findOne({ where: { userid: userid, customer_guid: customerId, provider: 'stripe' } });

            //get the customer session
            const [sessionSuccess, sessionSecret, sessionMessage] = await customerSession(userid, customerId, remittanceAccount.id);

            if (!sessionSuccess) {
                return res.status(500).json({ status: false, message: sessionMessage || 'Failed to create customer session with the partner bank.' });
            }

            return res.status(200).json({
                status: true,
                message: 'Card link initiated successfully.',
                data: {
                    customer_guid: customerId,
                    intent_secret: intentSecret,
                    session_secret: sessionSecret
                }
            });

        } else {

            // new secretoken
            const customerId = customerRecord.trackingid;

            // gettjhe intent secret
            const [intentSuccess, intentSecret, intentMessage] = await createIntent(userid, customerId);

            if (!intentSuccess) {
                return res.status(500).json({ status: false, message: intentMessage || 'Failed to create customer remittance account with the partner bank.' });
            }

            //get the remittance account
            const remittanceAccount = await RemittanceAccounts.findOne({ where: { userid: userid, customer_guid: customerId, provider: 'stripe' } });

            //get the customer session
            const [sessionSuccess, sessionSecret, sessionMessage] = await customerSession(userid, customerId, remittanceAccount.id);

            if (!sessionSuccess) {
                return res.status(500).json({ status: false, message: sessionMessage || 'Failed to create customer session with the partner bank.' });
            }

            return res.status(200).json({
                status: true,
                message: 'Card link successfully initiated.',
                data: {
                    customer_guid: customerId,
                    intent_secret: intentSecret,
                    session_secret: sessionSecret
                }
            });
        }


    } catch (error) {
        // console.log(error);
        logger.error('Error initiating card link', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Unable to initiate card linking' });
    }

}


const customerPaymentList = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'stripe', status: 1 } });
        if (customerRecord) {
            const customerid = customerRecord.trackingid;

            const paymentMethods = await stripe.customers.listPaymentMethods(
                customerid,
                { limit: 10, }
            );

            if (paymentMethods && paymentMethods.data) {
                let thedata = paymentMethods.data;
                // loop over this to get id, type, card object, billing details
                const formattedPaymentMethods = thedata.map(item => ({
                    id: item.id,
                    type: item.type,
                    card_brand: item.card ? item.card.brand : null,
                    card_last4: item.card ? item.card.last4 : null,
                    card_exp_month: item.card ? item.card.exp_month : null,
                    card_exp_year: item.card ? item.card.exp_year : null,
                    // billing_name: item.billing_details.name ? item.billing_details.name : null,
                    // billing_email: item.billing_details.email ? item.billing_details.email : null,
                    // billing_phone: item.billing_details.phone ? item.billing_details.phone : null,
                    // billing_address: item.billing_details.address ? item.billing_details.address : null,
                    // created: item.created,
                    // customer: item.customer,
                }));

                // logger.info(`customerPaymentList: Strp customer payment methods retrieved successfully for customer ${customerid}.`);

                return res.status(200).json({
                    status: true,
                    message: 'Customer payment methods retrieved successfully',
                    data: formattedPaymentMethods
                });

            } else {
                logger.error('customer PaymentList: Failed to retrieve Strp customer payment methods.', paymentMethods);
                return res.status(500).json({ status: false, message: 'Failed to retrieve customer payment methods' });
            }

        } else {
            logger.error('customerPaymentList: Customer record not found.');
            return res.status(400).json({ status: false, message: 'Customer record not found.' });
        }


    } catch (error) {
        logger.error('customerPaymentList: Error retrieving customer payment methods', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error retrieving customer payment methods' });
    }

}




const createPaymentIntent = async (userid, paymentid, amount, tocharge, reference) => {

        //get the customer id from the externaluse
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'stripe', status: 1} });
        if (!customerRecord) {
            logger.error('createPayment Intent: Customer record not found.');
            return [false, 'Customer record not found with the partner bank', null];
        }

        const customerId = customerRecord.trackingid;
        if (!customerId) {
            logger.error('createPayment Intent: Customer ID not found.');
            return [false, 'Customer ID not found with the partner bank', null];
        }

        // console.log('customerId', customerId)
    try{
        const paymentIntent = await stripe.paymentIntents.create({
            amount: parseFloat(tocharge) * 100,  //to cent
            customer: customerId,
            currency: 'usd',
            payment_method_types: ['card'],
            confirm: true,
            off_session: true,
            payment_method: paymentid
        });

        //log response
        await LogResponse.create({ ownerid: userid, reference: paymentid, jsonresp: JSON.stringify(paymentIntent), timed: '', product: 'strppayintent', provider: 'stripe' });

        if(paymentIntent && paymentIntent.id){
            const payintent_id = paymentIntent.id;
            const clientSecret = paymentIntent.client_secret;
            const payment_method = paymentIntent.payment_method;
            const payment_amount = paymentIntent.amount;
            const application_fee_amount = paymentIntent.application_fee_amount;
            const confirmation_method = paymentIntent.confirmation_method;
            const paycurrency = paymentIntent.currency;
            const pay_status = paymentIntent.status;

            const data = {
                payintent_id: payintent_id,
                clientSecret: clientSecret,
                payment_method: payment_method,
                payment_amount: payment_amount ? parseFloat(payment_amount)/100 : 0,
                application_fee_amount: application_fee_amount,
                confirmation_method: confirmation_method,
                paycurrency: paycurrency,
                pay_status: pay_status,
                customerid: customerId,
                requiresAction: false
            }

            // log to the Remittance Pay
            var dtimed = Date.parse(new Date()) / 1000;
            await RemittancePay.create({
                userid: userid, customer_guid: customerId, external_bank_guid: paymentid,
                fiat_account_guid: paymentid, reference: reference,
                quote_guid: '', status: pay_status == 'succeeded' ? 'processing' : 'pending',
                fee: '', provider: 'stripe', timed: dtimed, deposit_guid: paymentIntent.id, payment_rail: clientSecret,
                amount: tocharge,  //amount + fee
                deliver_amount: amount,  //only amount sending
            });

            return [true, 'Payment intent created successfully', data, false];

        }else{
            return [false, 'Payment intent creation failed', null]
        }

    } catch (error) {
         logger.error('Error creating payment intent', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        // If the payment requires authentication, catch the error
        if (error.code === 'authentication_required') {
            // Create a new PaymentIntent for on-session authentication
            const paymentIntent = await stripe.paymentIntents.create({
                amount: parseFloat(tocharge) * 100,
                customer: customerId,
                currency: 'usd',
                payment_method: paymentid,
                setup_future_usage: 'off_session'
            });

            logger.warn('paymentIntent', paymentIntent);
            await LogResponse.create({ ownerid: userid, reference: paymentid, jsonresp: JSON.stringify(paymentIntent), timed: '', product: 'strppayintent', provider: 'stripe' });
            
            // Return the client secret to your frontend to complete authentication
            const data = {
                payintent_id: paymentIntent.id,
                clientSecret: paymentIntent.client_secret,
                payment_method: paymentIntent.payment_method,
                payment_amount: paymentIntent.amount ? parseFloat(paymentIntent.amount)/100 : 0,
                application_fee_amount: paymentIntent.application_fee_amount,
                confirmation_method: paymentIntent.confirmation_method,
                paycurrency: paymentIntent.currency,
                pay_status: paymentIntent.status,
                customerid: customerId,
                requiresAction: true
            }

             // log to the Remittance Pay for auth rquire
            var dtimed = Date.parse(new Date()) / 1000;
            await RemittancePay.create({
                userid: userid, customer_guid: customerId, external_bank_guid: paymentid, deposit_guid: paymentIntent.id,
                fiat_account_guid: paymentid, quote_guid: '', status: paymentIntent.status == 'succeeded' ? 'processing' : 'pending', fee: 0, reference: reference, provider: 'stripe', payment_rail: paymentIntent.client_secret, timed: dtimed,
                deliver_amount: amount, amount: tocharge
            });
            
            return [true, 'Payment intent initiated successfully', data, true];

        } else {
            // Handle other errors
            // throw error;
            return [false, error.response?.data?.message || 'Unable to initiate card payment' ];
        }
    }      
}

//verify payment intent
const verifyPaymentIntent = async (req, res) => {
    const userid = req.user.id;
    // const userid = '818';
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const {paymentid, reference} = req.body;
    if (!paymentid)    
        return res.status(400).json({ status: false, message: 'Kindly provide all required fields to proceed.' });

    try {
        const paymentIntent = await stripe.paymentIntents.retrieve(paymentid);

        // console.log('paymentIntent', paymentIntent)

        //log response
        await LogResponse.create({ ownerid: userid, reference: paymentid, jsonresp: JSON.stringify(paymentIntent), timed: '', product: 'strppayintent_verify', provider: 'stripe' });

        if (paymentIntent && paymentIntent.id) {
            const payintent_id = paymentIntent.id;
            const clientSecret = paymentIntent.client_secret;
            const payment_method = paymentIntent.payment_method;
            const payment_amount = paymentIntent.amount;
            const application_fee_amount = paymentIntent.application_fee_amount;
            const confirmation_method = paymentIntent.confirmation_method;
            const paycurrency = paymentIntent.currency;
            const pay_status = paymentIntent.status;

            const data = {
                payintent_id: payintent_id,
                clientSecret: clientSecret,
                payment_method: payment_method,
                payment_amount: payment_amount ? parseFloat(payment_amount) / 100 : 0,
                application_fee_amount: application_fee_amount,
                confirmation_method: confirmation_method,
                paycurrency: paycurrency,
                pay_status: pay_status,
                customerid: paymentIntent.customer,
                requiresAction: false
            }

            const payStatus = pay_status == 'succeeded' ? 1 : 0
            await Payn.update({
                status: payStatus, paychannel: 'YC',
                jsonresp: JSON.stringify(data)
            }, { where: { provref: payintent_id, txref: reference } });


            // Update Remittance Pay record
            await RemittancePay.update({ status: 'processing', transfer_state: pay_status, payment_rail: clientSecret
            },{ where: { deposit_guid: payintent_id, userid: userid }});

            return res.status(200).json({
                status: true,
                message: 'Payment successfully verified',
                data: data
            });

        } else {
            logger.error('verify PaymentIntent: Failed to retrieve payment intent.', paymentIntent);
            return res.status(500).json({ status: false, message: 'Failed to retrieve payment intent' });
        }

    } catch (error) {
        logger.error('verify PaymentIntent: Error retrieving payment intent', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error retrieving payment intent' });
    }
    

}


const dodebugg = async(customerid)=>{
    const paymentMethods = await stripe.customers.listPaymentMethods(
                customerid,
                { limit: 10, }
            );

        logger.error(paymentMethods);
        return paymentMethods
}

/* dodebugg('cus_TszlxbhfRG5FQt')
.then(result => {
    console.log("API result:", result);
})
.catch(err => console.error("Script execution failed:", err))
.finally(async () => {
    // Optional: Close database connection if this is a standalone script
    // await db.sequelize.close();
}); */


module.exports = {
    initiatCardLink, customerPaymentList, createPaymentIntent, verifyPaymentIntent
}

