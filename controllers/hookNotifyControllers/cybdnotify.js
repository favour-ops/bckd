const { db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify, logBeneficiary,
    formatAmount, cleanMe, ucFirst, validateCacNumber, logger, getFee, getUserInfo, updateBalance, payWhk, ExternaUser, Payn, RemittanceAccounts, RemittancePay, LogRequest} = require('./_dependencies');
const { YCPayment } = require('../crossBorderControllers/ycnetwkchannels');
const {shAcessToken} = require('../../config/myfunct');
const {SHTransfer}  = require('../paymentController');


const CybdWbkNotifyTest = async (req, res, buf) => {
    try {

        const requestSignature = req.headers["x-cybrid-signature"];
        // console.log("requestSignature", requestSignature);
        let dtimed = Date.parse(new Date()) / 1000;

        //vlidate is present
        if (!requestSignature) {
            return res.status(401).json({
                requestSuccessful: true,
                responseMessage: "Signature header is missing",
            });
        }

        // req.rawBody populated by the express.json() verify callback in index.js
        const rawBody = req.rawBody;
        if (!rawBody) {
            console.log("Raw body not found");
            return res.status(400).json({
                requestSuccessful: false,
                responseMessage: "Raw body missing for signature verification",
            });
        }
        // console.log("req.rawBody", rawBody);

        const SIGNING_KEY = !process.env.CYBRID_WBHOOK_SIGN ? 'ecf83b9d5a9e54fe29f6395928e436b2a3d4fd1e4e82d04f191272696123b4d0' : process.env.CYBRID_WBHOOK_SIGN;

        const expectedSignature = crypto.createHmac('sha256', SIGNING_KEY).update(rawBody).digest('hex');
        console.log("expectedSignature", expectedSignature);

        if (requestSignature == expectedSignature) {

            // console.log('Valid request:', req.body); 
            res.status(200).send('OK');

            const event = req.body;
            const dbody = JSON.stringify(event);
            var resp = JSON.parse(dbody);
            let dtimed = Date.parse(new Date()) / 1000;

            const event_type = resp['event_type'];
            const guid = resp['guid'];
            const object_guid = resp['object_guid'];
            const environment = resp['environment'];
            const organization_guid = resp['organization_guid'];
            const bank_guid = resp['bank_guid'];

            // cgec for duplicate wevhook
            const checkhook = await payWhk.findAll({ where: { txref: guid, gateway: 'cybd' } });

            if (checkhook.length > 0) {
                console.warn(`[Webhook] Duplicate notification detected for reference: ${object_guid} - ${guid}. Ignoring.`);
                return;
            }

            // log the whk
            await payWhk.create({resp: dbody, txref: guid, gateway: 'cybd', timed: dtimed, processed: 1});

            if (event_type == 'identity_verification.completed') {

                await ExternaUser.update(
                    { persona_state: 'completed', verstate: 'completed', status: '2' },
                    { where: { verification_id: object_guid, provider: 'cybrid' } }
                );

                logger.info(`Cybrid Webhook: Identity verification completed for verification id ${object_guid}`);

            } else if (event_type == 'transfer.completed') {
                const deposit_guid = resp['object_guid'];
                const notification_id = resp['guid'];

                // get the payment with the productid of the deposit id
                const getPayment = await RemittancePay.findOne({ where: { deposit_guid: deposit_guid, provider: 'cybrid' } });

                if (getPayment) {
                    const txref = getPayment.txref;
                    
                    if (getPayment.status === 'completed'){
                        console.warn(`[Webhook] Duplicate transaction detected for reference: ${txref}. Ignoring.`);
                        return;
                    }

                    // get the transaction payload meta from Payn 
                    const getPayn = await Payn.findOne({ where: { provref: deposit_guid } });

                    if (getPayn) {
                        const payload = JSON.parse(getPayn.meta);
                        console.log('Payload from Payn meta', payload);
                        const network = getPayn.ntwk;
                        const userid = getPayn.userid;
                        const accountname = payload.accountname;
                        const paycurrency = getPayn.currency;

                        if(network == 'NG'){
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

                            // console.log('SH Transfer Response from hook', ftApiResponse)
                            if ((ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') || ftApiResponse.code == '00') {
                                var sessID = ftApiResponse.data.sessionId;

                                // Update the payment status to success
                                await RemittancePay.update(
                                    { status: 'completed', jsonresp: dbody },
                                    { where: { deposit_guid: deposit_guid, provider: 'cybrid' } }
                                );

                                await Payn.update({
                                    status: 1, paychannel: provider, productid: sessID,
                                    jsonresp: JSON.stringify(ftApiResponse)}, { where: { txref: txref, userid: userid } 
                                });

                                pushNotify(userid, 'Transaction Notice - HitchPay', `Your ${paycurrency}${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`);

                                console.log(`[Webhook] Successfully processed for ${deposit_guid} `);
    
                                // send email and push notification to the owner
                                const userinfo = await getUserInfo(userid);
                                const useremail = userinfo.email;
                                const fname = userinfo.firstname;

                                const notedesc = `Your ${paycurrency}${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`;

                                await notifyMe(userid, `${paycurrency} Transfer Completed`, 'user', notedesc);

                                const mailcontent = `
                                    <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                                    <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Your ${paycurrency} transfer of <strong>${paycurrency} ${formatAmount(amount)}</strong> to <strong>${accountname}</strong> has been successfully completed.</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Name:</strong> ${accountname}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Account:</strong> ${recipientno}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Bank:</strong> ${bankcode}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Sent:</strong> ${paycurrency} ${formatAmount(amount)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${txref}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                                    <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                                `;
                                await mailSender(fname, `${paycurrency} Transfer Completed`, useremail, mailcontent);

                            } else {
                                logger.error(`Cybrid Webhook: ${paycurrency} Transfer failed for deposit_guid: ${deposit_guid}. Response: ${JSON.stringify(ftApiResponse)}`);
                            }

                        }else{

                            // log request payload
                            var data = JSON.stringify(payload);
                            await LogRequest.create({ reference: deposit_guid, jsonreq: data, timed: dtimed, product: 'globaltransfer', provider: 'yc' });
                            
                            // call the provider
                            console.log('payloadpayload', payload)
                            const paymentResponse = await YCPayment(payload);
    
                            console.log('paymentResponse from hook', paymentResponse)
                            if (!paymentResponse || (paymentResponse.status !== 'created' && paymentResponse.status !== 'processing')) {
                                logger.error(`Cybrid Webhook: Failed to initiate payment for deposit_guid: ${deposit_guid}`);
                                return
                            }

                            const jsonString2 = JSON.stringify(paymentResponse);
                            if (paymentResponse && paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process') {
                                

                                const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
                                const localAmount_convertedAmount = paymentResponse.convertedAmount; //localamount
                                const api_rate = paymentResponse.rate;
                                const api_amount = paymentResponse.amount;
                                const networkName = paymentResponse.destination?.networkName;
                                const api_currency = paymentResponse?.currency;
                                const attempt = paymentResponse.attempt;
    
                                const payloadDestination = payload.destination
                                console.log('payloadDestination', payloadDestination)
                                
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
                                }, { where: {txref: getPayn.txref }});
                    
    
                                // Update the payment status to success
                                await RemittancePay.update(
                                    { status: 'completed', jsonresp: dbody },
                                    { where: { deposit_guid: deposit_guid, provider: 'cybrid' } }
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
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Payment Channel:</strong> US Bank Account</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(getPayn.timed).format("Do MMM, YYYY hh:mm a")}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                                    <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                                `;
    
                                await mailSender(fname, 'Global Transfer Completed', useremail, mailcontent);
    
                            } else {
                                logger.error(`Cybrid Webhook: Payment initiation failed for deposit_guid: ${deposit_guid}. Response: ${jsonString2}`);
                            }
                        }

                    } else {
                        logger.warn(`Cybrid Webhook: No matching Payn record found for deposit_guid: ${deposit_guid}`);
                    }

                } else {
                    logger.error(`Cybrid Webhook: Error processing remittance for txref ${txref}: ${error.message}`);
                }

            } else if (event_type === 'transfer.failed') {
                const deposit_guid = resp['object_guid'];
                const notification_id = resp['guid'];

                // Update the payment status to failed
                await RemittancePay.update(
                    { status: 'failed', jsonresp: dbody },
                    { where: { deposit_guid: deposit_guid, provider: 'cybrid' } }
                );

                // udpate status to failed in payn also
                await Payn.update(
                    { status: 5}, { where: { provref: deposit_guid } }
                );

                // notify the customer
                const getPayment = await RemittancePay.findOne({ where: { deposit_guid: deposit_guid, provider: 'cybrid' } });

                if (getPayment) {
                    const getPayn = await Payn.findOne({ where: { provref: deposit_guid } });
                    const getCustomer = await getUserInfo(getPayn.userid);
                    const fname = getCustomer.firstname;
                    const useremail = getCustomer.email;
                    const mailcontent = `
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">We regret to inform you that your global transfer has failed.</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${getPayn.txref}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(getPayn.timed).format("Do MMM, YYYY hh:mm a")}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                        <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                    `;

                    await mailSender(fname, 'Global Transfer Failed', useremail, mailcontent);
                }

                logger.warn(`Cybrid Webhook: Transfer failed/rejected for ${deposit_guid}. Amount: ${amount}`);
            } else {
                logger.warn(`Cybrid Webhook: No matching payment found for deposit_guid`);
            }


        } else {
            console.log('Invalid signature');
            return res.status(403).json({
                requestSuccessful: false,
                responseMessage: "Invalid signature",
            });
        }


    } catch (error) {
        logger.error(`Notify Error: ${error}`);
        return
        // res.status(401).json({ 
        //     requestSuccessful: true,
        //     responseMessage: `Something went wrong! Unable to process request ${error.message}`
        // });
    }
}


const CybdWbkNotifyProd = async (req, res, buf) => {
    try {

        const requestSignature = req.headers["x-cybrid-signature"];
        let dtimed = Date.parse(new Date()) / 1000;

        //vlidate is present
        if (!requestSignature) {
            return res.status(401).json({
                requestSuccessful: true,
                responseMessage: "Signature header is missing",
            });
        }

        const rawBody = req.rawBody;
        if (!rawBody) {
            console.log("Raw body not found");
            return res.status(400).json({
                requestSuccessful: false,
                responseMessage: "Raw body missing for signature verification",
            });
        }

        const SIGNING_KEY = process.env.CYBRID_WBHOOK_SIGN;

        if(!SIGNING_KEY){
            console.log("missing signing key");
            return res.status(400).json({
                requestSuccessful: false,
                responseMessage: "Unable to process request, missing signing key",
            });
        }


        const expectedSignature = crypto.createHmac('sha256', SIGNING_KEY).update(rawBody).digest('hex');
        // console.log("expectedSignature", expectedSignature);

        if (requestSignature == expectedSignature) { 
            res.status(200).send('OK');

            const event = req.body;
            const dbody = JSON.stringify(event);
            var resp = JSON.parse(dbody);
            let dtimed = Date.parse(new Date()) / 1000;

            const event_type = resp['event_type'];
            const guid = resp['guid'];
            const object_guid = resp['object_guid'];
            const environment = resp['environment'];
            const organization_guid = resp['organization_guid'];
            const bank_guid = resp['bank_guid'];

            // cgec for duplicate wevhook
            const checkhook = await payWhk.findAll({ where: { txref: guid, gateway: 'cybd' } });

            if (checkhook.length > 0) {
                console.warn(`[Webhook] Duplicate notification detected for reference: ${object_guid} - ${guid}. Ignoring.`);
                return;
            }

            // log the whk
            await payWhk.create({resp: dbody, txref: guid, gateway: 'cybd', timed: dtimed, processed: 1});

            if (event_type == 'identity_verification.completed') {

                await ExternaUser.update(
                    { persona_state: 'completed', verstate: 'completed', status: '2' },
                    { where: { verification_id: object_guid, provider: 'cybrid' } }
                );

                logger.info(`Cybrid Webhook: Identity verification completed for verification id ${object_guid}`);

            } else if (event_type == 'transfer.completed') {
                const deposit_guid = resp['object_guid'];
                const notification_id = resp['guid'];

                // get the payment with the productid of the deposit id
                const getPayment = await RemittancePay.findOne({ where: { deposit_guid: deposit_guid, provider: 'cybrid' } });

                if (getPayment) {
                    const txref = getPayment.txref;
                    
                    if (getPayment.status === 'completed'){
                        console.warn(`[Webhook] Duplicate transaction detected for reference: ${txref}. Ignoring.`);
                        return;
                    }

                    // get the transaction payload meta from Payn 
                    const getPayn = await Payn.findOne({ where: { provref: deposit_guid } });

                    if (getPayn) {
                        const payload = JSON.parse(getPayn.meta);
                        console.log('Payload from Payn meta', payload);
                        const network = getPayn.ntwk;
                        const userid = getPayn.userid;
                        const accountname = payload.accountname;
                        const paycurrency = getPayn.currency;

                        if(network == 'NG'){
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

                            // console.log('SH Transfer Response from hook', ftApiResponse)
                            if ((ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') || ftApiResponse.code == '00') {
                                var sessID = ftApiResponse.data.sessionId;

                                // Update the payment status to success
                                await RemittancePay.update(
                                    { status: 'completed', jsonresp: dbody },
                                    { where: { deposit_guid: deposit_guid, provider: 'cybrid' } }
                                );

                                await Payn.update({
                                    status: 1, paychannel: provider, productid: sessID,
                                    jsonresp: JSON.stringify(ftApiResponse)}, { where: { txref: txref, userid: userid } 
                                });

                                pushNotify(userid, 'Transaction Notice - HitchPay', `Your ${paycurrency}${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`);

                                console.log(`[Webhook] Successfully processed for ${deposit_guid} `);
    
                                // send email and push notification to the owner
                                const userinfo = await getUserInfo(userid);
                                const useremail = userinfo.email;
                                const fname = userinfo.firstname;

                                const notedesc = `Your ${paycurrency}${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successfully received.`;

                                await notifyMe(userid, `${paycurrency} Transfer Completed`, 'user', notedesc);

                                const mailcontent = `
                                    <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                                    <p style="line-height: 30px; letter-spacing: 0.025em; font-size: 15px;">Your ${paycurrency} transfer of <strong>${paycurrency} ${formatAmount(amount)}</strong> to <strong>${accountname}</strong> has been successfully completed.</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Name:</strong> ${accountname}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Recipient Account:</strong> ${recipientno}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Bank:</strong> ${bankcode}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Amount Sent:</strong> ${paycurrency} ${formatAmount(amount)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${txref}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                                    <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                                `;
                                await mailSender(fname, `${paycurrency} Transfer Completed`, useremail, mailcontent);

                            } else {
                                logger.error(`Cybrid Webhook: ${paycurrency} Transfer failed for deposit_guid: ${deposit_guid}. Response: ${JSON.stringify(ftApiResponse)}`);
                            }

                        }else{

                            // log request payload
                            var data = JSON.stringify(payload);
                            await LogRequest.create({ reference: deposit_guid, jsonreq: data, timed: dtimed, product: 'globaltransfer', provider: 'yc' });
                            
                            // call the provider
                            console.log('payloadpayload', payload)
                            const paymentResponse = await YCPayment(payload);
    
                            console.log('paymentResponse from hook', paymentResponse)
                            if (!paymentResponse || (paymentResponse.status !== 'created' && paymentResponse.status !== 'processing')) {
                                logger.error(`Cybrid Webhook: Failed to initiate payment for deposit_guid: ${deposit_guid}`);
                                return
                            }

                            const jsonString2 = JSON.stringify(paymentResponse);
                            if (paymentResponse && paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process') {
                                

                            const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
                            const localAmount_convertedAmount = paymentResponse.convertedAmount; //localamount
                            const api_rate = paymentResponse.rate;
                            const api_amount = paymentResponse.amount;
                            const networkName = paymentResponse.destination?.networkName;
                            const api_currency = paymentResponse?.currency;
                            const attempt = paymentResponse.attempt;

                            const payloadDestination = payload.destination
                            console.log('payloadDestination', payloadDestination)
                            
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
                            }, { where: {txref: getPayn.txref }});
                

                            // Update the payment status to success
                            await RemittancePay.update(
                                { status: 'completed', jsonresp: dbody },
                                { where: { deposit_guid: deposit_guid, provider: 'cybrid' } }
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
                                <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Payment Channel:</strong> US Bank Account</p>
                                <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(getPayn.timed).format("Do MMM, YYYY hh:mm a")}</p>
                                <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                                <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                            `;

                            await mailSender(fname, 'Global Transfer Completed', useremail, mailcontent);

                        } else {
                            logger.error(`Cybrid Webhook: Payment initiation failed for deposit_guid: ${deposit_guid}. Response: ${jsonString2}`);
                        }
                    }

                    } else {
                        logger.warn(`Cybrid Webhook: No matching Payn record found for deposit_guid: ${deposit_guid}`);
                    }

                } else {
                    logger.error(`Cybrid Webhook: Error processing remittance for txref ${txref}: ${error.message}`);
                }

            } else if (event_type === 'transfer.failed') {
                const deposit_guid = resp['object_guid'];
                const notification_id = resp['guid'];

                // Update the payment status to failed
                await RemittancePay.update(
                    { status: 'failed', jsonresp: dbody },
                    { where: { deposit_guid: deposit_guid, provider: 'cybrid' } }
                );

                // udpate status to failed in payn also
                await Payn.update(
                    { status: 5}, { where: { provref: deposit_guid } }
                );

                // notify the customer
                const getPayment = await RemittancePay.findOne({ where: { deposit_guid: deposit_guid, provider: 'cybrid' } });

                if (getPayment) {
                    const getPayn = await Payn.findOne({ where: { provref: deposit_guid } });
                    const getCustomer = await getUserInfo(getPayn.userid);
                    const fname = getCustomer.firstname;
                    const useremail = getCustomer.email;
                    const mailcontent = `
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">We regret to inform you that your global transfer has failed.</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${getPayn.txref}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(getPayn.timed).format("Do MMM, YYYY hh:mm a")}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                        <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                    `;

                    await mailSender(fname, 'Global Transfer Failed', useremail, mailcontent);
                }

                logger.warn(`Cybrid Webhook: Transfer failed/rejected for ${deposit_guid}. Amount: ${amount}`);
            } else {
                logger.warn(`Cybrid Webhook: No matching payment found for deposit_guid`);
            }


        } else {
            console.log('Invalid signature');
            return res.status(403).json({
                requestSuccessful: false,
                responseMessage: "Invalid signature",
            });
        }


    } catch (error) {
        logger.error(`Notify Error: ${error}`);
        return
        // res.status(401).json({ 
        //     requestSuccessful: true,
        //     responseMessage: `Something went wrong! Unable to process request ${error.message}`
        // });
    }
}

module.exports = {
    CybdWbkNotifyTest, CybdWbkNotifyProd
}