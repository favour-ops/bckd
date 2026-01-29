//========================IMPORT DEPENDENCIES======================
const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, LogRequest, ucFirst, logger, Customer, ExternaUser, KycDoc, KYC, formatPhoneNumber, LogResponse, RemittanceAccounts, RemittancePay, checkTransAuth, Payn } = require('./dependencies');
const crypto = require("crypto");
const axios = require("axios");
// import cybridauth module
const { getCybridAccessToken } = require('./cybridauth');
const e = require('express');


const createCustomerEnroll = async (userid, customerData) => {

    try {
        const existingCybridCustomer = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (existingCybridCustomer && existingCybridCustomer.trackingid) {
            logger.info(`createCustomer: Cybd customer already exists for internal user ${userid}. GUID: ${existingCybridCustomer.cybrid_customer_guid}`);

            return [true, existingCybridCustomer.trackingid, 'Customer already exists with banking provider'];
        }

        // get the token
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createCustomer: Unable to process request.');
            return [false, null, 'Failed to get  access token'];
        }

        //get the custome inof
        // const customerData = await Customer.findOne({ where: { id: userid } });

        // if (!customerData) {
        //     logger.error('createCustomer: Customer information not found.');
        //     return [false, null, 'Customer information not found'];
        // }

        // console.log('customerData Params', customerData);

        // GET THE CUSTOMER kyc
        var getkycdoc = await KycDoc.findOne({ where: { userid: userid, docstatus: 2, remarkby: 'veriff' }, order: [['id', 'DESC']] });

        if (!getkycdoc) {
            return [false, null, 'Kindly complete your tier 2 verification in order to proceed'];
        }

        if (getkycdoc.docname == 'International Passport' || getkycdoc.docname == 'passport') {
            var kycdocname = 'passport';
        } else if (getkycdoc.docname == 'Driver License' || getkycdoc.docname == 'drivers_license') {
            var kycdocname = 'drivers_license';
        } else if (getkycdoc.docname == 'idcard' || getkycdoc.docname == 'identification_card') {
            var kycdocname = 'identification_card';
        } else if (getkycdoc.docname == 'ssn' || getkycdoc.docname == 'social_security_number') {
            var kycdocname = 'social_security_number';
        } else if (getkycdoc.docname == 'tin' || getkycdoc.docname == 'tax_identification_number' || getkycdoc.docname == 'itin') {
            var kycdocname = 'tax_identification_number';
        } else {
            var kycdocname = getkycdoc.docname.toLowerCase();
        }

        // validate address, city, postalcode, country_code
        if (!customerData.address || !customerData.city || !customerData.postalcode || !customerData.countrycode) {
            logger.error('createCustomer: Invalid customer information.');
            return [false, null, 'Kindly update your address, city, postal code, and country information in your profile to proceed'];
        }

        const payload = {
            "type": "individual",
            "address": {
                "street": customerData.houseno + ' ' + customerData.address,
                "city": customerData.city,
                "subdivision": customerData.state || "",
                "postal_code": customerData.postalcode,
                "country_code": customerData.countrycode
            },
            "identification_numbers": [
                {
                    "type": kycdocname,
                    "issuing_country_code": getkycdoc.issuancecountry,
                    "identification_number": getkycdoc.docno
                }
            ],
            "name": {
                "first": customerData.firstname,
                "last": customerData.lastname,
                "full": `${customerData.firstname} ${customerData.lastname}`
            },
            "phone_number": formatPhoneNumber(customerData.phoneno),
            "email_address": customerData.email
        };

        //log the request
        await LogRequest.create({ reference: userid, jsonreq: JSON.stringify(payload), timed: '', product: 'cybcust', provider: 'cybd' });

        const options = {
            method: 'POST',
            url: `${process.env.CYBRID_API_BASEURL2}/api/customers`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            },
            data: payload
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: userid, reference: userid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybcustenrol', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var customerId = thedata.guid;
            var bank_guid = thedata.bank_guid;
            var state = thedata.state;

            //create the customer on the ExternaUser table
            await ExternaUser.create({ userid: userid, provider: 'cybrid', trackingid: customerId, status: '0', verstate: state, timed: '', tier: '1' });

            logger.info(`createCustomer: Cybd customer created successfully for internal user ${userid}. GUID: ${customerId}`);
            return [true, customerId, 'Customer created successfully'];

        } else {

            logger.error('createCustomer: Failed to create Cybd customer.', thedata);
            return [false, null, thedata.message || 'Failed to create customer'];
        }

    } catch (error) {
        logger.error('createCustomer: Error creating Cybd customer', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error creating customer'];
    }
}


// check customer status
const getCybridCustomerDetails = async (customerGuid) => {

    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();

        if (!tokenSuccess) {
            logger.error('getCybrid CustomerDetails: Unable to process request.');
            return [false, null, 'Failed to connect to the partner bank'];
        }

        const options = {
            method: 'GET',
            url: `${process.env.CYBRID_API_BASEURL2}/api/customers/${customerGuid}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            }
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // console.log('thedataloger', thedata)

        // log the response
        await LogResponse.create({ ownerid: customerGuid, reference: customerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybcustdetails', provider: 'cybd' });

        if (thedata && thedata.guid) {
            const accountState = thedata.state;

            // update the customer record with the latest state
            await ExternaUser.update({ verstate: accountState }, { where: { trackingid: customerGuid, provider: 'cybrid' } });

            logger.info(`getCustomerDetails: Cybrid customer details retrieved successfully for customer ${customerGuid}. State: ${accountState}`);
            return [true, accountState, 'Customer details retrieved successfully'];

        } else {
            logger.error('getCustomerDetails: Failed to retrieve Cybrid customer details.', thedata);
            return [false, null, thedata.message || 'Failed to retrieve customer details.'];

        }

    } catch (error) {
        logger.error('getCustomerDetails: Error retrieving Cybrid customer details', {
            message: error.message,
            response: error.response ? error.response.data : null
        });


        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving customer details'];
    }
}


// create a helper function to intitiate verification for the cuatomer on cybrid
const createIdentityVerification = async (customerGuid, userid, userinfo) => {
    try {

        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createIdentity Verification: Unable to process request.');
            return [false, null, 'Failed to connect to the partner bank'];
        }

        var getkyc = await KYC.findOne({ where: { userid: userid, status: 1, provider: 'veriff' }, order: [['id', 'DESC']] });

        if (!getkyc) {
            return [false, null, 'Kindly complete your tier 2 verification to proceed'];
        }

        const verdob = getkyc.verdob;
        const momentDate = moment(verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('YYYY-MM-DD');
        const metainfo = JSON.parse(getkyc.metainfo)

        const kyc_houseno = !metainfo.houseNumber ? userinfo.houseno : metainfo.houseNumber;
        const kyc_street = !metainfo.street ? userinfo.address : metainfo.street;
        const kyc_city = !metainfo.city ? userinfo.city : metainfo.city;
        const kyc_state = !metainfo.state ? userinfo.state : metainfo.state;
        const kyc_postcode = !metainfo.postalcode ? userinfo.postalcode : metainfo.postalcode;

        const payload = {
            "type": "kyc",
            "customer_guid": customerGuid,
            "method": "id_and_selfie",
            "require_tax_id": false,
            "name": {
                "first": userinfo.firstname,
                "middle": '',
                "last": userinfo.lastname,
                "full": `${userinfo.firstname} ${userinfo.lastname}`
            },
            "address": {
                "street": `${kyc_houseno} ${kyc_street}`,
                "street2": '',
                "city": kyc_city,
                "subdivision": kyc_state,
                "postal_code": kyc_postcode,
                "country_code": userinfo.countrycode
            },
            "date_of_birth": dateOfBirth,
            "identification_numbers": getkyc.bvv,
            "phone_number": userinfo.phoneno,
            "email_address": userinfo.email,
            "occupation": ''
        };

        // log the request
        await LogRequest.create({ reference: customerGuid, jsonreq: JSON.stringify(payload), timed: '', product: 'cybkyc', provider: 'cybd' });

        const options = {
            method: 'POST',
            url: `${process.env.CYBRID_API_BASEURL2}/api/identity_verifications`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            },
            data: payload
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: userid, reference: customerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybkycverif', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var verificationId = thedata.guid;
            var state = thedata.state;
            var country_code = thedata.country_code;

            // get the customer verifcation link for persona 
            const verStatus = await getIdentityVerificationStatus(verificationId);

            if (!verStatus[0]) {
                return [false, null, 'Failed to initiate remittance identity verification'];

            } else {
                var persona_inquiry_id = verStatus[2];
                var customer_guid = verStatus[3];
                var country_code = verStatus[4];
                var method = verStatus[5];
                var persona_state = verStatus[6];

                // update the status of the external user to 1 - verification initiated
                await ExternaUser.update({ status: '1', verification_id: verificationId, persona_inquiry_id: persona_inquiry_id, customer_guid: customer_guid, persona_state: persona_state }, { where: { trackingid: customerGuid, userid: userid, provider: 'cybrid' } });

                //create the remittance_account

                return [true, {
                    persona_inquiry_id: persona_inquiry_id,
                    customer_guid: customer_guid,
                    persona_state: persona_state,
                    verificationId: verificationId,
                    state: state
                }, 'Identity verification initiated successfully.'];
            }


        } else {
            logger.error('createIdentity Verification: Failed to initiate identity verification.', thedata);

            return [false, null, thedata.message || 'Failed to initiate identity verification.'];
        }
    } catch (error) {
        logger.error('createIdentity Verification: Error initiating identity verification', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error creating customer verification'];
    }
}

// check customer vrification status
const getIdentityVerificationStatus = async (verificationGuid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('getIdentity VerificationStatus: Unable to process request.');
            return [false, null, 'Unable to connect to the partner  bank'];
        }
        if (!verificationGuid) {
            return [false, null, 'Invalid verification GUID provided'];
        }

        const options = {
            method: 'GET',
            url: `${process.env.CYBRID_API_BASEURL2}/api/identity_verifications/${verificationGuid}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            }
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // console.log('thedatadlogger', thedata)

        // log the response
        await LogResponse.create({ ownerid: verificationGuid, reference: verificationGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybkycverifstatus', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var state = thedata.state;
            var customer_guid = thedata.customer_guid;
            var veriff_state = thedata.state || 'storing';  //verifcation state
            var persona_inquiry_id = thedata.persona_inquiry_id;
            var country_code = thedata.country_code || '';
            var method = thedata.method;

            if (method == 'id_and_selfie') {
                //update the external user record with the latest status
                await ExternaUser.update({ persona_state: veriff_state }, { where: { trackingid: customer_guid, provider: 'cybrid' } });
            }else if(method == 'account_ownership'){
                //update the account record verification state
                await RemittanceAccounts.update({ verification_state: veriff_state }, { where: { customer_guid: customer_guid, verification_id: verificationGuid} });
            }

            return [true, state, persona_inquiry_id, customer_guid, country_code, method, veriff_state, thedata];

        } else {

            logger.error('getIdentity VerificationStatus: Failed to retrieve identity verification status.', thedata);
            return [false, null, thedata.message || 'Failed to retrieve identity verification status'];
        }

    } catch (error) {
        logger.error('getIdentity VerificationStatus: Error retrieving identity verification status', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        // return provider error message if available
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving identity verification status'];
    }
}


const initiateCustomerAccount = async (req, res) => {
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
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (!customerRecord) {

            //CALL THE CREATE CUSTOMER FUNCTION HERE
            const [createSuccess, customerId, createMessage] = await createCustomerEnroll(userid, getUser)

            if (!createSuccess) {
                return res.status(500).json({ status: false, message: createMessage || 'Failed to create customer remittance account.' });
            } else {

                logger.info(`create customer 1: Cybrid customer created successfully for internal user ${userid}. GUID: ${customerId}`);

                // CHECK THE CUSTOMER DETAILS AND VERIFICATION STATUS
                const checkDetails = await getCybridCustomerDetails(customerId);  //first timer

                if (!checkDetails[0]) {
                    logger.error(`create customer 1: Failed to retrieve customer remittance details for internal user ${userid}.`);
                    return res.status(500).json({ status: false, message: checkDetails[2] || 'Failed to retrieve customer remittance details.' });

                } else {

                    var customerState = checkDetails[1];
                    logger.info(`create customer 1: Cybrid customer details retrieved successfully for internal user ${userid}. State: ${customerState}`);

                    // return the state to the frontend
                    return res.status(200).json({
                        status: true,
                        message: 'Customer account initiated.',
                        data: {
                            customer_guid: customerId,
                            customer_state: customerState,
                            persona_state: 'null',
                            verification_id: null,
                            persona_inquiry_id: null,
                            link_token: null,
                            link_state: null
                        }
                    });

                }
            }

        } else {

            const cybridCustomerGuid = customerRecord.trackingid;
            const checkDetails = await getCybridCustomerDetails(cybridCustomerGuid);  //second call

            if (!checkDetails[0]) {
                logger.error(`create customer 2: Failed to retrieve customer remittance details for internal user ${userid}.`);
                return res.status(500).json({ status: false, message: checkDetails[2] || 'Failed to retrieve customer remittance details.' });

            } else {

                var customerState = checkDetails[1];
                logger.info(`create customer 2: Cybrid customer details retrieved successfully for internal user ${userid}. State: ${customerState}`);

                return res.status(200).json({
                    status: true,
                    message: 'Customer account re-initiated.',
                    data: {
                        customer_guid: cybridCustomerGuid,
                        customer_state: customerState,
                        persona_state: 'null',
                        verification_id: null,
                        persona_inquiry_id: null,
                        link_token: null,
                        link_state: null
                    }
                });
            }
        }
    } catch (error) {
        // console.log(error);
        logger.error('create customer_account: Error initiating account link', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Unable to initiate customer account link' });
    }
}

const initiateVerification = async (req, res) => {
    const userid = req.user.id;
    // const userid = '818';
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    try {
        // get the cutomer info
        const getUser = await Customer.findOne({ where: { id: userid } });

        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (customerRecord.status == '1' && (customerRecord.verstate == 'unverified' || customerRecord.verstate == 'waiting' || customerRecord.verstate == 'storing') && customerRecord.verification_id && customerRecord.persona_state != 'expired' && customerRecord.persona_state != 'pending') {

            const checkVerStatus = await getIdentityVerificationStatus(customerRecord.verification_id);

            console.log('checkVerStatus', checkVerStatus);

            if (!checkVerStatus[0]) {
                return res.status(500).json({ status: false, message: checkVerStatus[2] || 'Failed to retrieve identity verification status.' });
            } else {
                var verState = checkVerStatus[1];
                var persona_inquiry_id = checkVerStatus[2];
                var customer_guid = checkVerStatus[3];
                var country_code = checkVerStatus[4];
                var method = checkVerStatus[5];
                var persona_state = checkVerStatus[6];

                logger.info(`customer verification: Cybrid identity verification status retrieved successfully for internal user ${userid}. State: ${verState}`);

                //update the external user record with the latest status
                await ExternaUser.update({ persona_state: persona_state }, { where: { trackingid: customerRecord.trackingid, userid: userid, provider: 'cybrid' } });

                return res.status(200).json({
                    status: true,
                    message: 'Customer remittance account retrieved successfully.',
                    data: {
                        customer_guid: customerRecord.trackingid,
                        customer_state: customerRecord.verstate,
                        persona_state: persona_state,
                        verification_id: customerRecord.verification_id,
                        persona_inquiry_id: persona_inquiry_id,
                        link_token: null,
                        link_state: null
                    }
                });

            }

        } else if (customerRecord && customerRecord.trackingid) {

            // CHECK THE CUSTOMER DETAILS AND VERIFICATION STATUS
            const customerId = customerRecord.trackingid
            const checkDetails = await getCybridCustomerDetails(customerRecord.trackingid);  //first timer

            if (!checkDetails[0]) {
                logger.error(`customer verification: Failed to retrieve customer remittance details for internal user ${userid}.`);
                return res.status(500).json({ status: false, message: checkDetails[2] || 'Failed to initiate customer remittance verification.' });

            } else {
                var customerState = checkDetails[1];

                if (customerState == 'unverified' || customerState == 'storing' || customerState == 'rejected') {

                    // INTIAIE IDENTITY VERIFICATION
                    const identityVerif = await createIdentityVerification(customerId, userid, getUser);  //first timer

                    if (!identityVerif[0]) {
                        return res.status(500).json({ status: false, message: identityVerif[2] || 'Failed to initiate identity verification.' });
                    } else {

                        var verificationData = identityVerif[1];

                        return res.status(200).json({
                            status: true,
                            message: 'Customer remittance account retrieved successfully.',
                            data: {
                                customer_guid: customerRecord.trackingid,
                                customer_state: customerState,
                                persona_state: verificationData.persona_state,
                                verification_id: verificationData.verificationId,
                                persona_inquiry_id: verificationData.persona_inquiry_id,
                                link_token: null,
                                link_state: null
                            }
                        });
                    }

                } else {
                    logger.info(`customer verification: Cybrid customer is verified for internal user ${userid}. State: ${customerState}`);

                    return res.status(200).json({
                        status: true,
                        message: `Customer account is ${customerState}`,
                        data: {
                            customer_guid: customerId,
                            customer_state: customerState,
                            persona_state: 'null',
                            verification_id: null,
                            persona_inquiry_id: null,
                            link_token: null,
                            link_state: null
                        }
                    });
                }
            }

        } else {
            return res.status(400).json({ status: false, message: 'No remittance account found for this user.' });

        }

    } catch (error) {
        logger.error('customer verification: Error initiating account link', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error initiating customer verification.' });
    }
}


const initiateAccountLink = async (req, res) => {
    const userid = req.user.id;
    if (!userid)
        return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    try {
        const { authtoken } = req.body;
        //validate 2fa token
        const [isTokenValid, tokenMessage] = await checkTransAuth(userid, authtoken);
        if (!isTokenValid) {
            return res.status(400).json({ status: false, message: tokenMessage });  
        }

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (customerRecord && customerRecord.trackingid && customerRecord.verification_id) {

            // get the state of the verification
            const customerId = customerRecord.trackingid;
            const checkVerStatus = await getIdentityVerificationStatus(customerRecord.verification_id);

            if (!checkVerStatus[0]) {
                return res.status(500).json({ status: false, message: checkVerStatus[2] || 'Unable to retrieve customer identity verification status.' });
            } else {

                var verState = checkVerStatus[1];
                var persona_inquiry_id = checkVerStatus[2];
                var customer_guid = checkVerStatus[3];
                var country_code = checkVerStatus[4];
                var method = checkVerStatus[5];
                var persona_state = checkVerStatus[6];

                if (persona_state == 'completed') {

                    // create the fiat account here since customer has been verified
                    if (!customerRecord.fiat_account_guid) {
                        createFiatAccount(customerId, userid);
                    }

                    // check if the link state
                    if (customerRecord.link_state == 'storing' || customerRecord.link_state == 'unverified') {
                        // get the latest state
                        const linkTokenResult = await getLinkToken(customerRecord.workflow_id);

                        if (!linkTokenResult[0]) {
                            return res.status(500).json({ status: false, message: linkTokenResult[3] || 'Failed to retrieve account link token' });

                        } else {
                            var linkToken = linkTokenResult[1];
                            var customer_guid = linkTokenResult[2];
                            var linkState = linkTokenResult[3];

                            return res.status(200).json({
                                status: true,
                                message: 'Account link successfully retrieved',
                                data: {
                                    customer_guid: customerId,
                                    customer_state: verState,
                                    persona_state: persona_state,
                                    verification_id: customerRecord.verification_id,
                                    persona_inquiry_id: persona_inquiry_id,
                                    link_token: linkToken,
                                    link_state: linkState
                                }
                            });
                        }


                    } else {
                        // generate new one
                        const accountLink = await createAccountLink(customerId, userid);

                        if (!accountLink[0]) {
                            return res.status(500).json({ status: false, message: accountLink[2] || 'Unable to create account linking.' });
                        } else {

                            var linkData = accountLink[1];
                            logger.info(`initiateAccountLink: Cybrid account link created successfully for internal user ${userid}. Link State: ${linkData.link_state}`);

                            return res.status(200).json({
                                status: true,
                                message: 'Account link created successfully.',
                                data: {
                                    customer_guid: customerId,
                                    customer_state: verState,
                                    persona_state: persona_state,
                                    verification_id: customerRecord.verification_id,
                                    persona_inquiry_id: persona_inquiry_id,
                                    link_token: linkData.link_token,
                                    link_state: linkData.link_state
                                }
                            });
                        }
                    }

                } else {
                    // return account verification not verified 
                    return res.status(200).json({
                        status: false,
                        message: 'Customer identity verification not completed.',
                        data: {
                            customer_guid: customerId,
                            customer_state: verState,
                            persona_state: persona_state,
                            verification_id: customerRecord.verification_id,
                            persona_inquiry_id: persona_inquiry_id,
                            link_token: null,
                            link_state: null
                        }
                    });

                }
            }
        } else {
            return res.status(400).json({ status: false, message: 'No remittance account found for this customer.' });
        }

    } catch (error) {
        logger.error('initiate AccountLink: Error initiating account link', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Unable to initiate account link at the moment.' });
    }
}


//creaate account link after verification
const createAccountLink = async (customerGuid, userid) => {

    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('create AccountLink: Unable to process request.');
            return [false, null, 'Unable to connect to the partner  bank'];
        }

        const data = {
            "type": "plaid",
            "kind": "link_token_create",
            "customer_guid": customerGuid,
            "language": "en",
            "link_customization_name": "default"
        };

        // log the request
        await LogRequest.create({ reference: customerGuid, jsonreq: JSON.stringify(data), timed: '', product: 'cybacctlink', provider: 'cybd' });

        const options = {
            method: 'post',
            url: `${process.env.CYBRID_API_BASEURL2}/api/workflows`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            },
            data: data
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: customerGuid, reference: customerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybacctlinkres', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var workflowId = thedata.guid;
            var workflowState = thedata.state;
            var bank_guid = thedata.bank_guid;

            const linkTokenResult = await getLinkToken(workflowId);

            if (!linkTokenResult[0]) {
                return [false, null, linkTokenResult[3] || 'Failed to retrieve account link token'];
            } else {
                var linkToken = linkTokenResult[1];
                var customer_guid = linkTokenResult[2];
                var linkState = linkTokenResult[3];

                //create remittance account
                var dtimed = Date.parse(new Date()) / 1000;

                await RemittanceAccounts.create({
                    userid: userid, customer_guid: customer_guid, workflow_id: workflowId, link_token: linkToken,
                    link_state: linkState, external_bank_guid: bank_guid, provider: 'cybrid', status: 0, timed: dtimed
                });

                return [true, {
                    link_token: linkToken,
                    customer_guid: customer_guid,
                    link_state: linkState
                }, 'Account link created successfully.'];
            }
        }

    } catch (error) {
        logger.error('create AccountLink: Error creating account link', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error creating account link.'];
    }
};

// get the account link token
const getLinkToken = async (workflowId) => {
    try {

        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('get AccountLink: Unable to process request.');
            return [false, null, null, 'Unable to connect to the partner  bank'];
        }

        const options = {
            method: 'GET',
            url: `${process.env.CYBRID_API_BASEURL2}/api/workflows/${workflowId}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            }
        };
        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: workflowId, reference: workflowId, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybacctlinktoken', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var linkToken = thedata.plaid_link_token;
            var linkState = thedata.state;
            var customer_guid = thedata.customer_guid;

            //update the external user record with the link token and state
            await ExternaUser.update({ link_token: linkToken, link_state: linkState, workflow_id: workflowId }, { where: { trackingid: customer_guid, provider: 'cybrid' } });

            return [true, linkToken, customer_guid, linkState, 'Account link token retrieved successfully.'];

        } else {
            logger.error('getLink Token: Failed to retrieve link token.', thedata);
            return [false, null, null, thedata.message || 'Failed to retrieve link token'];
        }

    } catch (error) {
        logger.error('getLink Token: Error retrieving link token', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving link token'];
    }
}

//create external bank workflow initiation endpoint
const createExternalBank = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { account_id, plaid_token } = req.body;

    if (!account_id || !plaid_token) {
        return res.status(400).json({ status: false, message: 'Kindly provide all required fields to proceed.' });
    }

    try {
        // get the cutomer info
        const getUser = await Customer.findOne({ where: { id: userid } });

        if (!getUser) {
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });
        }

        //check token
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createIdentity Verification: Unable to process request.');
            return res.status(400).json({ status: false, message: 'Failed to connect to the partner bank' });
        }

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (customerRecord && customerRecord.trackingid && customerRecord.persona_state == 'completed') {
            const cybridCustomerGuid = customerRecord.trackingid;


            // CHECK IF THE PLAID_TOKEN AND ACCOUNT_ID HAS BEEN USED WITH ACCOUNT LINK BEFORE by the customer, THEN ONLY CALL VERIFY DONT CALL THE CREATE EXTERNAL BANK AGAIN
            const existingRemittanceAccount = await RemittanceAccounts.findOne({ where: { plaid_token: plaid_token, plaid_account_id: account_id, customer_guid: cybridCustomerGuid } });

            if (existingRemittanceAccount) {

                // If it exists, just verify it
                const retrieveBankDetails = await RetrieveExternalBankDetails(existingRemittanceAccount.external_bank_guid);
                // console.log('retrieveBankDetails', retrieveBankDetails)
                const bankDetails = retrieveBankDetails[1];

                return res.status(200).json({
                    status: true,
                    message: 'External bank account details retrieved successfully.',
                    data: {
                        customer_guid: customerRecord.trackingid,
                        customer_state: 'verified',
                        persona_state: customerRecord.persona_state,
                        verification_id: customerRecord.verification_id,
                        persona_inquiry_id: customerRecord.persona_inquiry_id,
                        link_token: customerRecord.link_token,
                        link_state: customerRecord.link_state,
                        external_bank_guid: existingRemittanceAccount.external_bank_guid,
                        external_bank_state: bankDetails.state
                    }
                });

            } else {

                // CREATE EXTERNAL ACCOUNT
                const payload = {
                    "account_kind": "plaid",
                    "name": `${getUser.firstname} ${getUser.lastname}`,
                    "customer_guid": cybridCustomerGuid,
                    "plaid_public_token": plaid_token,
                    "plaid_account_id": account_id
                }

                await LogRequest.create({ reference: cybridCustomerGuid, jsonreq: JSON.stringify(payload), timed: '', product: 'cybextbank', provider: 'cybd' });

                const options = {
                    method: 'POST',
                    url: `${process.env.CYBRID_API_BASEURL2}/api/external_bank_accounts`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        "Authorization": "Bearer " + access_token
                    },
                    data: payload
                };
                let response = await axios.request(options);
                let thedata = response.data;

                // log the response
                await LogResponse.create({ ownerid: cybridCustomerGuid, reference: cybridCustomerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybextbankres', provider: 'cybd' });

                if (thedata && thedata.guid) {
                    const externalBankGuid = thedata.guid;
                    const state = thedata.state;
                    const name = thedata.name;
                    const environment = thedata.environment;
                    const bank_guid = thedata.bank_guid;
                    const holder = thedata.holder;

                    // create the remittance
                    var dtimed = Date.parse(new Date()) / 1000;
                    await RemittanceAccounts.create({
                        userid: userid, customer_guid: cybridCustomerGuid, external_bank_guid: externalBankGuid,
                        external_bank_state: state, bank_env: environment, provider: 'cybrid', status: 0, timed: dtimed,
                        plaid_token: plaid_token, plaid_account_id: account_id
                    });

                    // retrieve the external bank account details and store in our db if needed
                    const retrieveBankDetails = await RetrieveExternalBankDetails(externalBankGuid);

                    if (!retrieveBankDetails[0]) {
                        logger.error(`createExternal Bank: Failed to retrieve external bank account details for internal user ${userid}.`);
                    } else {

                        var bankDetails = retrieveBankDetails[1];
                        logger.info(`createExternal Bank: External bank account details retrieved successfully for internal user ${userid}. Bank GUID: ${externalBankGuid}`);

                        return res.status(200).json({
                            status: true,
                            message: 'External bank account created successfully.',
                            data: {
                                customer_guid: customerRecord.trackingid,
                                customer_state: 'verified',
                                persona_state: customerRecord.persona_state,
                                verification_id: '',
                                persona_inquiry_id: customerRecord.persona_inquiry_id,
                                link_token: customerRecord.link_token,
                                link_state: customerRecord.link_state,
                                external_bank_guid: externalBankGuid,
                                external_bank_state: bankDetails.state,
                            }
                        });

                    }

                } else {
                    logger.error('createExternal Bank: Failed to link external bank account.', thedata);
                    return res.status(400).json({ status: false, message: thedata.message || 'Failed to link external bank account.' });
                }

            }


        } else {
            return res.status(400).json({ status: false, message: 'No external bank workflow found for this customer.' });
        }

    } catch (error) {
        logger.error('createExternal Bank: Error linking external bank account', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.error_message || error.response?.data?.message || 'Error linking external bank account.' });

    }

}

//create external bank workflow initiation endpoint
const ExternalBankVerification = async (req, res) => {
    const userid = req.user.id;
    // const userid = '818';
    if (!userid)
        return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { bankguid } = req.body;

    if (!bankguid) {
        return res.status(400).json({ status: false, message: 'Kindly provide all required fields to proceed.' });
    }

    try {

        //check token
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createIdentity Verification: Unable to process request.');
            return res.status(400).json({ status: false, message: 'Failed to connect to the partner bank' });
        }

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (customerRecord && customerRecord.trackingid && customerRecord.persona_state == 'completed') {
            const cybridCustomerGuid = customerRecord.trackingid;

            const existingRemittanceAccount = await RemittanceAccounts.findOne({ where: { external_bank_guid: bankguid, customer_guid: cybridCustomerGuid } });

            if (existingRemittanceAccount) {
                // console.log('existingRemittanceAccount', existingRemittanceAccount)
                // If it exists, just verify it
                const retrieveBankDetails = await RetrieveExternalBankDetails(existingRemittanceAccount.external_bank_guid);
                // console.log('retrieveBankDetails', retrieveBankDetails)
                const bankDetails = retrieveBankDetails[1];

                // console.log('bankDetails', bankDetails)


                // chec if the external bank dtate is completed, dont call verify again
                if (retrieveBankDetails[0] && bankDetails.state == 'completed') {
                    return res.status(200).json({
                        status: true,
                        message: 'External bank account already linked and verified.',
                        data: {
                            customer_guid: customerRecord.trackingid,
                            customer_state: 'verified',
                            persona_state: customerRecord.persona_state,
                            verification_id: customerRecord.verification_id,
                            persona_inquiry_id: customerRecord.persona_inquiry_id,
                            link_token: customerRecord.link_token,
                            link_state: customerRecord.link_state,
                            external_bank_guid: existingRemittanceAccount.external_bank_guid,
                            external_bank_state: bankDetails.state,
                            verification_state: bankDetails.state
                        }
                    });

                }else if (existingRemittanceAccount && (existingRemittanceAccount.verification_state == 'storing' || existingRemittanceAccount.verification_state == 'waiting' || existingRemittanceAccount.verification_state == 'pending' || existingRemittanceAccount.verification_state == 'reviewing')) {

                    const checkVerStatus = await getIdentityVerificationStatus(existingRemittanceAccount.verification_id);

                        if (!checkVerStatus[0]) {
                            return res.status(500).json({ status: false, message: checkVerStatus[2] || 'Failed to retrieve identity verification state.' });
                        } else {
                            var verState = checkVerStatus[1];
                            var persona_inquiry_id = checkVerStatus[2];
                            var verData = checkVerStatus[7];

                            logger.info(`external bank verification:bank identity verification status retrieved successfully for internal user ${userid}. State: ${verState}`);

                            return res.status(200).json({
                                status: true,
                                message: 'External bank account verification fetched.',
                                data: {
                                    customer_guid: customerRecord.trackingid,
                                    customer_state: 'verified',
                                    persona_state: 'completed',
                                    verification_id: existingRemittanceAccount.verification_id,
                                    persona_inquiry_id: persona_inquiry_id,
                                    link_token: customerRecord.link_token,
                                    link_state: customerRecord.link_state,
                                    external_bank_guid: existingRemittanceAccount.external_bank_guid,
                                    external_bank_state: existingRemittanceAccount.external_bank_state,
                                    verification_state: verState,
                                    compliance_checks: verData.compliance_checks
                                }
                            });
                        }
                    
                }else if(existingRemittanceAccount.verification_state == 'failed'){
                    return res.status(400).json({ status: false, message: 'External bank linking failed.' });

                } else {

                    const verifyBankAccount = await verifyExternalBankAccount(cybridCustomerGuid, existingRemittanceAccount.external_bank_guid);

                    if (!verifyBankAccount[0]) {
                        logger.error(`ExternalBank Verification: Failed to verify existing external bank account for internal user ${userid}.`);
                        return res.status(500).json({ status: false, message: verifyBankAccount[2] || 'Failed to verify external bank account.' });
                    } else {

                        var verificationData = verifyBankAccount[1];

                        const checkVerStatus = await getIdentityVerificationStatus(verificationData.verificationId);

                        if (!checkVerStatus[0]) {
                            return res.status(500).json({ status: false, message: checkVerStatus[2] || 'Failed to retrieve identity verification status.' });
                        } else {
                            var verState = checkVerStatus[1];
                            var persona_inquiry_id = checkVerStatus[2];
                            var verData = checkVerStatus[6];

                            logger.info(`external bank verification: Cybrid identity verification status retrieved successfully for internal user ${userid}. State: ${verState}`);

                            return res.status(200).json({
                                status: true,
                                message: 'External bank account verification initiated successfully.',
                                data: {
                                    customer_guid: customerRecord.trackingid,
                                    customer_state: 'verified',
                                    persona_state: 'completed',
                                    verification_id: verificationData.verificationId,
                                    persona_inquiry_id: persona_inquiry_id,
                                    link_token: customerRecord.link_token,
                                    link_state: customerRecord.link_state,
                                    external_bank_guid: existingRemittanceAccount.external_bank_guid,
                                    external_bank_state: existingRemittanceAccount.external_bank_state,
                                    verification_state: verState,
                                    compliance_checks: verData.compliance_checks
                                }
                            });
                        }
                    }

                }

            } else {
                return res.status(400).json({ status: false, message: 'No external bank workflow found for this customer.' });

            }

        } else {
            return res.status(400).json({ status: false, message: 'Customer verification not completed with the partner bank.' });
        }

    } catch (error) {
        logger.error('createExternal Bank: Error linking external bank account', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.error_message || error.response?.data?.message || 'Error linking external bank account.' });

    }

}

const RetrieveExternalBankDetails = async (externalBankGuid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();

        if (!tokenSuccess) {
            logger.error('Retrieve External BankDetails: Unable to process request.');
            return [false, null, 'Unable to connect to the partner  bank'];
        }

        const options = {
            method: 'GET',
            url: `${process.env.CYBRID_API_BASEURL2}/api/external_bank_accounts/${externalBankGuid}?force_balance_refresh=true&include_balances=true`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            }
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: externalBankGuid, reference: externalBankGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybextbankdetails', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var state = thedata.state;
            var name = thedata.name;
            var environment = thedata.environment;
            var bank_guid = thedata.bank_guid;
            var holder = thedata.holder;
            var balances = thedata.balances;
            var plaid_account_mask = thedata.plaid_account_mask;
            var plaid_account_name = thedata.plaid_account_name;
            var customer_guid = thedata.customer_guid;
            var account_kind = thedata.account_kind;
            var asset = thedata.asset;

            // update the remittance account
            await RemittanceAccounts.update({
                external_bank_state: state,
                account_mask: plaid_account_mask,
                accountname: plaid_account_name,
                asset: asset,
                bankname: name,
                accounttype: account_kind,
                jsonresp: JSON.stringify(thedata)
            }, { where: { external_bank_guid: externalBankGuid, customer_guid: customer_guid } });

            return [true, {
                state: state,
                name: name,
                environment: environment,
                bank_guid: bank_guid,
                holder: holder,
                balances: balances,
                plaid_account_mask: plaid_account_mask,
                plaid_account_name: plaid_account_name,
                customer_guid: customer_guid,
                account_kind: account_kind,
                asset: asset
            }, 'External bank account details retrieved successfully.'];

        } else {
            logger.error('Retrieve External BankDetails: Failed to retrieve external bank account details.', thedata);
            return [false, null, thedata.message || 'Failed to retrieve external bank account details'];
        }

    } catch (error) {
        logger.error('Retrieve External BankDetails: Error retrieving external bank account details', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving external bank account details.'];
    }

}


//create customer fiat account
const createFiatAccount = async (customerGuid, userid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createFiat Account: Unable to process request.');
            return [false, null, 'Unable to connect to the partner bank'];
        }

        //get the customer name using userid
        const getCustomer = await Customer.findOne({ where: { id: userid } });
        const name = `${getCustomer.firstname} ${getCustomer.lastname}`;

        // fiat account payload
        const payload = {
            "type": "fiat",
            "asset": "USD",
            "customer_guid": customerGuid,
            "name": name
        };

        // log the request
        await LogRequest.create({ reference: customerGuid, jsonreq: JSON.stringify(payload), timed: '', product: 'cybfiatacct', provider: 'cybd' });

        const options = {
            method: 'POST',
            url: `${process.env.CYBRID_API_BASEURL2}/api/accounts`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            },
            data: payload
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: userid, reference: customerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybfiatacctres', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var fiatAccountGuid = thedata.guid;
            var state = thedata.state;
            var asset = thedata.asset;

            var dtimed = Date.parse(new Date()) / 1000;
            await ExternaUser.create({
                userid: userid,
                trackingid: customerGuid,
                fiat_account_guid: fiatAccountGuid,
                fiat_account_state: state
            });

            // call the getFiatAccountDetails
            await getFiatAccountDetails(customerGuid);

            return [true, {
                fiatAccountGuid: fiatAccountGuid,
                state: state,
                asset: asset
            }, 'Fiat account created successfully.'];

        } else {
            logger.error('createFiat Account: Failed to create fiat account.', thedata);
            return [false, null, thedata.message || 'Failed to create fiat account'];
        }

    } catch (error) {
        logger.error('createFiat Account: Error creating fiat account', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error creating fiat account'];
    }
}


// get the fiat account details
const getFiatAccountDetails = async (customerGuid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('getFiatAccountDetails: Unable to process request.');
            return [false, null, 'Unable to connect to the partner bank'];
        }

        const options = {
            method: 'GET',
            url: `${process.env.CYBRID_API_BASEURL2}/api/accounts?customer_guid=${customerGuid}&type=fiat`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            }
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // log the response
        await LogResponse.create({ ownerid: customerGuid, reference: customerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybfiatacctdetails', provider: 'cybd' });

        if (thedata && thedata.objects && thedata.objects.length > 0) {
            const fiatAccount = thedata.objects[0]; // Assuming the first fiat account is the primary one

            // UPDATE RECORD
            await ExternaUser.update({
                fiat_account_guid: fiatAccount.guid,
                fiat_account_state: fiatAccount.state
            }, { where: { trackingid: customerGuid, provider: 'cybrid' } });

            return [true, {
                fiatAccountGuid: fiatAccount.guid,
                state: fiatAccount.state,
                asset: fiatAccount.asset,
                name: fiatAccount.name,
                balance: fiatAccount.platform_balance,
                available_balance: fiatAccount.platform_available
            }, 'Fiat account details retrieved successfully.'];

        } else {
            logger.error('getFiatAccountDetails: No fiat account found for customer.', thedata);
            return [false, null, 'No fiat account found for this customer.'];
        }

    } catch (error) {
        logger.error('getFiatAccountDetails: Error retrieving fiat account details', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving fiat account details'];
    }

}


const verifyExternalBankAccount = async (customerGuid, externalBankGuid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();

        if (!tokenSuccess) {
            logger.error('verifyExternal BankAccount: Unable to process request.');
            return [false, null, 'Unable to connect to the partner bank'];
        }

        const data = {
            "type": "bank_account",
            "method": "account_ownership",
            "customer_guid": customerGuid,
            "external_bank_account_guid": externalBankGuid,
            "expected_behaviours": ["passed_immediately"]

        };

        // console.log('dadadata', data)

        // log the request
        await LogRequest.create({ reference: customerGuid, jsonreq: JSON.stringify(data), timed: '', product: 'cybextbankverif', provider: 'cybd' });

        const options = {
            method: 'POST',
            url: `${process.env.CYBRID_API_BASEURL2}/api/identity_verifications`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            },
            data: data
        };

        let response = await axios.request(options);
        let thedata = response.data;

        // console.log('thedata56', thedata)

        // log the response
        await LogResponse.create({ ownerid: customerGuid, reference: externalBankGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybextbankverif', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var verificationId = thedata.guid;

            // log the verification_state to remittanceAccount
            await RemittanceAccounts.update({ verification_id: verificationId, verification_state: thedata.state }, { where: { external_bank_guid: externalBankGuid, customer_guid: customerGuid } });

            return [true, { verificationId: verificationId }, 'External bank account verification initiated successfully.'];

        } else {
            logger.error('verifyExternal BankAccount: Failed to verify external bank account.', thedata);
            return [false, null, thedata.message || 'Failed to verify external bank account'];
        }

    }
    catch (error) {
        logger.error('verifyExternal BankAccount: Error verifying external bank account', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error verifying external bank account.'];
    }

}

const getLinkedBankList = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    try {
        // get the cutomer info
        const getUser = await Customer.findOne({ where: { id: userid } });

        if (!getUser) {
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });
        }

        //check token
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createIdentity Verification: Unable to process request.');
            return res.status(400).json({ status: false, message: 'Failed to connect to the partner bank' });
        }

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });
        if (customerRecord && customerRecord.trackingid) {
            const cybridCustomerGuid = customerRecord.trackingid;

            const options = {
                method: 'GET',
                url: `${process.env.CYBRID_API_BASEURL2}/api/external_bank_accounts?customer_guid=${cybridCustomerGuid}`,
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    "Authorization": "Bearer " + access_token
                }
            };

            let response = await axios.request(options);
            let thedata = response.data;

            // log the response
            await LogResponse.create({ ownerid: userid, reference: cybridCustomerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybextbanklist', provider: 'cybd' });

            if (thedata && thedata.objects) {
                const simplifiedList = thedata.objects
                    .filter(bank => bank.state !== 'failed')
                    .map(bank => ({
                        guid: bank.guid,
                        asset: bank.asset,
                        account_kind: bank.account_kind,
                        environment: bank.environment,
                        name: bank.name,
                        state: bank.state,
                        plaid_account_mask: bank.plaid_account_mask,
                        plaid_account_name: bank.plaid_account_name
                    }));

                return res.status(200).json({
                    status: true,
                    message: 'External bank accounts retrieved successfully.',
                    data: simplifiedList
                });

            } else {
                logger.error('getLinked BankList: Failed to retrieve external bank accounts.', thedata);
                return res.status(200).json({
                    status: true,
                    message: 'No external bank accounts linked yet.',
                    data: []
                });
            }

        } else {
            logger.error('getLinked BankList: Failed to retrieve external bank accounts.', thedata);
            return res.status(400).json({ status: false, message: thedata.message || 'Failed to retrieve external bank accounts.' });
        }

    } catch (error) {
        logger.error('getLinkedBankList: Error retrieving external bank accounts', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving external bank accounts.' });
    }

}

const processBankDeposit = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });
    try {
        const { amount, accountid } = cleanMe(req.body);
        if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter amount' });
        if (parseFloat(amount) <= 0) return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
        if (!accountid || (accountid == '')) return res.status(400).json({ status: false, message: 'Kindly select your preffered bank' });

        // convert to cent
        const centAmnt = parseFloat(amount) * 100;


        //check token
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createIdentity Verification: Unable to process request.');
            return res.status(400).json({ status: false, message: 'Failed to connect to the partner bank' });
        }

        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });
        if (customerRecord && customerRecord.trackingid) {
            const cybridCustomerGuid = customerRecord.trackingid;
            const fiataccount_guid = customerRecord.fiat_account_guid;

            // console.log(cybridCustomerGuid, accountid, fiataccount_guid)

            // get the quotes guid
            const [quoteSuccess, quoteData, quoteMessage] = await getCybridQuote(cybridCustomerGuid, centAmnt, access_token);

            if (!quoteSuccess) {
                return res.status(500).json({ status: false, message: quoteMessage || 'Failed to get a quote for the deposit.' });
            }

            const quoteGuid = quoteData.quoteGuid;
            const quoteFee = quoteData.quoteFee;
            const quoteDeliverAmount = quoteData.quoteDeliverAmount/100;

            // console.log('quoteDeliverAmount', quoteDeliverAmount)

            // get the remittance details
            const getRemittance = await RemittanceAccounts.findOne({ where: { external_bank_guid: accountid, customer_guid: cybridCustomerGuid } });

            if (!getRemittance) {
                return res.status(400).json({ status: false, message: 'Remittance account not found.' });
            }


            // log to the RemittancePay
            var dtimed = Date.parse(new Date()) / 1000;
            const newRemittancePay = await RemittancePay.create({
                userid: userid,
                customer_guid: cybridCustomerGuid,
                external_bank_guid: accountid,
                deposit_guid: '',
                fiat_account_guid: fiataccount_guid,
                amount: amount,
                fee: quoteFee,
                deliver_amount: quoteDeliverAmount,
                quote_guid: quoteGuid,
                status: 'pending',
                provider: 'cybrid',
                timed: dtimed
            });

            const remittancePayId = newRemittancePay.id;

            const payload = {
                "transfer_type": "funding",
                "quote_guid": quoteGuid,  //quote guid
                "customer_guid": cybridCustomerGuid, //customer guid
                "external_bank_account_guid": accountid, //external bank guid
                "customer_fiat_account_guid": fiataccount_guid, //customer fiat account guid
                "source_participants": [
                    {
                        "type": "bank",
                        "amount": centAmnt,
                        "guid": process.env.CYBRID_BANK_GUID //bank guid
                    }
                ],
                "destination_participants": [
                    {
                        "type": "customer",
                        "amount": centAmnt,
                        "guid": cybridCustomerGuid //customer guid
                    }
                ]
            }

            //log the request
            await LogRequest.create({ reference: remittancePayId, jsonreq: JSON.stringify(payload), timed: '', product: 'cybdeposit', provider: 'cybd' });


            const options = {
                method: 'POST',
                url: `${process.env.CYBRID_API_BASEURL2}/api/transfers`,
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    "Authorization": "Bearer " + access_token
                },
                data: payload
            }

            let response = await axios.request(options);
            let thedata = response.data;
            if (thedata && thedata.guid) {
                var depositGuid = thedata.guid;
                var depositState = thedata.state;
                var deposit_estimated_amount = thedata.estimated_amount/100;
                var payment_rail = thedata.payment_rail;
                var failure_code = thedata.failure_code;

                var hold_duration = thedata.hold_details.duration;
                var hold_started_at = thedata.hold_details.started_at;
                var hold_applicable_types = thedata.hold_details.applicable_types;

                // log the response
                await LogResponse.create({ ownerid: userid, reference: remittancePayId, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybdepositres', provider: 'cybd' });

                // update the remittance pay
                await RemittancePay.update({
                    transfer_state: depositState,
                    estimated_amount: deposit_estimated_amount/100,
                    payment_rail: payment_rail,
                    deposit_guid: depositGuid,
                    failure_code: failure_code,
                    hold_duration: hold_duration,
                    hold_started_at: hold_started_at,
                    hold_applicable_types: hold_applicable_types,
                    status: depositState
                }, { where: { id: remittancePayId } });

                return res.status(200).json({
                    status: true,
                    message: 'Deposit initiated successfully.',
                    data: {
                        transfer_guid: depositGuid,
                        transfer_state: depositState,
                        estimated_amount: deposit_estimated_amount/100,
                        payment_rail: payment_rail,
                        failure_code: failure_code,
                        hold_duration: hold_duration,
                        hold_started_at: hold_started_at,
                        hold_applicable_types: hold_applicable_types
                    }
                });

            } else {
                logger.error('process BankDeposit: Failed to initiate deposit.', thedata);
                return res.status(400).json({ status: false, message: thedata.message || 'Failed to initiate deposit.' });
            }

        } else {
            return res.status(400).json({ status: false, message: 'No remittance account found for this customer.' });
        }

    } catch (error) {
        logger.error('processBank Deposit: Error processing bank deposit', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.error_message || error.response?.data?.message || 'Error processing bank deposit.' });
    }
}

const doCybridBankDeposit = async (amount, accountid, userid, sendingAmount, reference) => {
    if (!userid)
        return [false, 'Eh! Invalid request sent!'];

    try {

        if (!amount || (amount == '')) {
            return [false, 'Kindly enter a valid amount']
        }
        if (parseFloat(amount) <= 0) { return [false, 'Invalid amount sent.'] }

        if (!accountid || (accountid == ''))
            return [false, 'Kindly select your preffered bank']

        // convert to cent
        const centAmnt = parseFloat(amount) * 100;

        //check token
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createIdentity Verification: Unable to process request.');
            return [false, 'Failed to connect to the partner bank']
        }

        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });
        if (customerRecord && customerRecord.trackingid) {
            const cybridCustomerGuid = customerRecord.trackingid;
            const fiataccount_guid = customerRecord.fiat_account_guid;

            // console.log(cybridCustomerGuid, accountid, fiataccount_guid)

            // get the quotes guid
            const [quoteSuccess, quoteData, quoteMessage] = await getCybridQuote(cybridCustomerGuid, centAmnt, access_token);

            if (!quoteSuccess) {
                logger.error('doCybrid BankDeposit: Failed to get a quote for the deposit.', quoteMessage);
                return [false, quoteMessage || 'Failed to get a quote for the deposit.'];
            }

            const quoteGuid = quoteData.quoteGuid;
            const quoteFee = quoteData.quoteFee;
            const quoteDeliverAmount = quoteData.quoteDeliverAmount/100;

            // get the remittance details
            const getRemittance = await RemittanceAccounts.findOne({ where: { external_bank_guid: accountid, customer_guid: cybridCustomerGuid } });

            if (!getRemittance) {
                logger.error('doCybrid BankDeposit: Failed to get remittance account for the deposit.', getRemittance);
                return [false, 'Remittance account not found.'];
            }

            // log to the RemittancePay
            var dtimed = Date.parse(new Date()) / 1000;
            const newRemittancePay = await RemittancePay.create({
                userid: userid,
                customer_guid: cybridCustomerGuid,
                external_bank_guid: accountid,
                deposit_guid: '',
                fiat_account_guid: fiataccount_guid,
                amount: amount,  //amount + fee
                fee: quoteFee,
                deliver_amount: sendingAmount,  //only amount sending
                quote_guid: quoteGuid,
                status: 'processing',
                provider: 'cybrid',
                timed: dtimed, reference: reference
            });

            const remittancePayId = newRemittancePay.id;

            const payload = {
                "transfer_type": "funding",
                "quote_guid": quoteGuid,  //quote guid
                "customer_guid": cybridCustomerGuid, //customer guid
                "external_bank_account_guid": accountid, //external bank guid
                "customer_fiat_account_guid": fiataccount_guid, //customer fiat account guid
                "source_participants": [
                    {
                        "type": "bank",
                        "amount": centAmnt,
                        "guid": !process.env.CYBRID_BANK_GUID ? 'd26957acfdfe7e70f9e2c679ba859c84' : process.env.CYBRID_BANK_GUID //bank guid
                    }
                ],
                "destination_participants": [
                    {
                        "type": "customer",
                        "amount": centAmnt,
                        "guid": cybridCustomerGuid //customer guid
                    }
                ]
            }

            //log the request
            await LogRequest.create({ reference: remittancePayId, jsonreq: JSON.stringify(payload), timed: '', product: 'cybdeposit', provider: 'cybd' });


            const options = {
                method: 'POST',
                url: `${process.env.CYBRID_API_BASEURL2}/api/transfers`,
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    "Authorization": "Bearer " + access_token
                },
                data: payload
            }

            let response = await axios.request(options);
            let thedata = response.data;
            if (thedata && thedata.guid) {
                var depositGuid = thedata.guid;
                var depositState = thedata.state;
                var deposit_estimated_amount = thedata.estimated_amount/100;
                var payment_rail = thedata.payment_rail;
                var failure_code = thedata.failure_code;

                var hold_duration = thedata.hold_details.duration;
                var hold_started_at = thedata.hold_details.started_at;
                var hold_applicable_types = thedata.hold_details.applicable_types;

                // log the response
                await LogResponse.create({ ownerid: userid, reference: remittancePayId, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybdepositres', provider: 'cybd' });

                // update the remittance pay
                await RemittancePay.update({
                    transfer_state: depositState,
                    estimated_amount: deposit_estimated_amount/100,
                    payment_rail: payment_rail,
                    deposit_guid: depositGuid,
                    failure_code: failure_code,
                    hold_duration: hold_duration,
                    hold_started_at: hold_started_at,
                    hold_applicable_types: hold_applicable_types,
                    status: depositState
                }, { where: { id: remittancePayId } });

                // return the response
                return [true, 'Deposit Initiated Successfully', {
                    transfer_guid: depositGuid,
                    transfer_state: depositState,
                    estimated_amount: deposit_estimated_amount/100,
                    payment_rail: payment_rail,
                    failure_code: failure_code,
                    hold_duration: hold_duration,
                    hold_started_at: hold_started_at,
                    hold_applicable_types: hold_applicable_types
                }];

            } else {
                logger.error('doCybrid BankDeposit: Failed to initiate deposit.', thedata);
                return [false, thedata.message || 'Failed to initiate deposit.'];
            }

        } else {
            return [false, 'No remittance account found for this customer.'];
        }

    } catch (error) {
        logger.error('doCybrid BankDeposit: Error processing bank deposit', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, error.response?.data?.error_message || error.response?.data?.message || 'Error processing bank deposit.'];
    }
}


const getCybridQuote = async (customerGuid, amount, access_token) => {
    try {
        // convert to cent
        const centAmnt = parseFloat(amount);

        const payload = {
            "product_type": "funding",
            "customer_guid": customerGuid,
            "asset": "USD",
            "side": "deposit",
            "deliver_amount": centAmnt
        }

        const options = {
            method: 'POST',
            url: `${process.env.CYBRID_API_BASEURL2}/api/quotes`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                "Authorization": "Bearer " + access_token
            },
            data: payload
        }

        let response = await axios.request(options);
        let thedata = response.data;
        if (thedata && thedata.guid) {
            var quoteGuid = thedata.guid;
            var quoteFee = thedata.fee;
            var quoteDeliverAmount = thedata.deliver_amount;
            var quoteReceiveAmount = thedata.receive_amount;
            var issued_at = thedata.issued_at;
            var expires_at = thedata.expires_at;

            return [true, {
                quoteGuid: quoteGuid,
                quoteFee: quoteFee,
                quoteDeliverAmount: quoteDeliverAmount,
                quoteReceiveAmount: quoteReceiveAmount
            }, 'Quote created successfully.'];
        } else {
            logger.error('getCybrid Quote: Failed to create quote.', thedata);
            return [false, null, thedata.message || 'Failed to create quote.'];
        }
    } catch (error) {
        logger.error('getCybrid Quote: Error creating quote ', error)
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error creating quote.'];
    }
}


const getRemittancePayStatus = async (req, res) => {
    try {
        const userid = req.user.id;
        let payStatus = 'pending';

        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });
        const { reference } = req.params;

        //get deposit guid from payn
        const getPay = await Payn.findOne({ where: { userid: userid, txref: reference } });

        if (!getPay) {
            return res.status(400).json({ status: false, message: 'No remittance record found.' });
        }

        const depositGuid = getPay.provref;
        payStatus = getPay.status == 0 ? 'pending' : getPay.status == 1 ? 'completed' : getPay.status == 6 ? 'failed' : 'processing';

        if (!depositGuid) {
            return res.status(400).json({ status: false, message: 'Deposit not yet initiated.' });
        }

        if (!depositGuid || (depositGuid == '')) return res.status(400).json({ status: false, message: 'Kindly provide deposit id' });

        const getRemittancePay = await RemittancePay.findOne({ where: { deposit_guid: depositGuid, userid: userid } });
        if (!getRemittancePay) {
            return res.status(400).json({ status: false, message: 'No remittance payment record found for the provided deposit id' });
        }
        
        payStatus = getRemittancePay.status == 'storing' ? 'pending' : getRemittancePay.status;

        //only return the status and relevant fields
        return res.status(200).json({
            status: true,
            message: 'Remittance pay record retrieved successfully',
            data: {
                amount: getRemittancePay.amount,
                fee: getRemittancePay.fee,
                // deliver_amount: getRemittancePay.deliver_amount,
                status: payStatus,
                transfer_guid: getRemittancePay.deposit_guid,
                currency: getPay.currency
                // transfer_state: getRemittancePay.transfer_state,
                // estimated_amount: getRemittancePay.estimated_amount,
                // payment_rail: getRemittancePay.payment_rail,
                // failure_code: getRemittancePay.failure_code,
                // hold_duration: getRemittancePay.hold_duration,
            }
        });

    } catch (error) {
        logger.error('getRemittancePay Status: Error retrieving remittance pay status', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving remittance pay status.' });
    }
}


//========================EXPORT MODULES======================
module.exports = {
    initiateCustomerAccount, initiateVerification, initiateAccountLink, createExternalBank, ExternalBankVerification, getLinkedBankList,
    processBankDeposit, doCybridBankDeposit, getRemittancePayStatus
}