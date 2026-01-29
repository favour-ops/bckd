//========================IMPORT DEPENDENCIES======================
const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, LogRequest, ucFirst, logger, Customer, ExternaUser, getUserInfo, KycDoc, KYC, formatPhoneNumber, LogResponse} = require('./dependencies');
const crypto = require("crypto");
const axios = require("axios");
// import cybridauth module
const { getCybridAccessToken } = require('./cybridauth');
const e = require('express');


const createCustomerEnroll = async (userid, customerData) => {
    
    try {
        /* const existingCybridCustomer = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (existingCybridCustomer && existingCybridCustomer.trackingid) {
            logger.info(`createCustomer: Cybd customer already exists for internal user ${userid}. GUID: ${existingCybridCustomer.cybrid_customer_guid}`);

            return [true, existingCybridCustomer.trackingid, 'Customer already exists with banking provider'];
        } */

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

        console.log('customerData Params', customerData);

        // GET THE CUSTOMER kyc
        var getkycdoc = await KycDoc.findOne({ where: {userid: userid, docstatus: 2, remarkby: 'veriff'}, order: [['id', 'DESC']]});

        if (!getkycdoc){
            return [false, null, 'Kindly complete your tier 2 verification in order to proceed'];
        }

        if(getkycdoc.docname == 'International Passport' || getkycdoc.docname == 'passport'){
            var kycdocname = 'passport';
        }else if(getkycdoc.docname == 'Driver License' || getkycdoc.docname == 'drivers_license'){
            var kycdocname = 'drivers_license';
        }else if(getkycdoc.docname == 'idcard' || getkycdoc.docname == 'identification_card'){
            var kycdocname = 'identification_card';
        }else if(getkycdoc.docname == 'ssn' || getkycdoc.docname == 'social_security_number'){
            var kycdocname = 'social_security_number';
        }else if(getkycdoc.docname == 'tin' || getkycdoc.docname == 'tax_identification_number' || getkycdoc.docname == 'itin'){
            var kycdocname = 'tax_identification_number';
        }else {
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
                "street": customerData.houseno  + ' ' + customerData.address,
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
            await ExternaUser.create({ userid: userid, provider: 'cybrid', trackingid: customerId, status: '0', verstate: state, timed: '', tier: '1'});
            
            logger.info(`createCustomer: Cybd customer created successfully for internal user ${userid}. GUID: ${customerId}`);
            return [true, customerId, 'Customer created successfully'];

        } else {

            logger.error('createCustomer: Failed to create Cybd customer.', thedata);
            return [false, null, thedata.message || 'Failed to create customer'];
        }

    }catch (error) {
        logger.error('createCustomer: Error creating Cybd customer', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error creating customer'];
    }
}

// check customer status
const getCybridCustomerDetails = async(customerGuid)=>{
    
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

        // log the response
        await LogResponse.create({ ownerid: customerGuid, reference: customerGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybcustdetails', provider: 'cybd' });

        if (thedata && thedata.guid) {
            const accountState = thedata.state;

            // update the customer record with the latest state
            await ExternaUser.update({ verstate: accountState }, { where: { trackingid: customerGuid, provider: 'cybrid' } });

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

        var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, provider: 'veriff'}, order: [['id', 'DESC']]});

        if (!getkyc){
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
                "street":  `${kyc_houseno} ${kyc_street}`,
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

            }else{
                var persona_inquiry_id = verStatus[2];
                var customer_guid = verStatus[3];
                var country_code = verStatus[4];
                var method = verStatus[5];
                var persona_state = verStatus[6];

                // update the status of the external user to 1 - verification initiated
                await ExternaUser.update({ status: '1', verstate: state, verification_id: verificationId, persona_inquiry_id: persona_inquiry_id, customer_guid: customer_guid, persona_state: persona_state}, { where: { trackingid: customerGuid, userid: userid, provider: 'cybrid' } });

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

        // log the response
        await LogResponse.create({ ownerid: verificationGuid, reference: verificationGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybkycverifstatus', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var state = thedata.state;
            var customer_guid = thedata.customer_guid;
            var persona_state = thedata.persona_state;
            var persona_inquiry_id = thedata.persona_inquiry_id;
            var country_code = thedata.country_code;
            var method = thedata.method;

            return [true, state, persona_inquiry_id, customer_guid, country_code, method, persona_state];

        } else {

            logger.error('getIdentity VerificationStatus: Failed to retrieve identity verification status.', thedata);
            return [false, null, thedata.message || 'Failed to retrieve identity verification status'];
        }

    } catch (error) {
        logger.error('getIdentity VerificationStatus: Error retrieving identity verification status', {
        message: error.message,
        response: error.response ? error.response.data : null});

        // return provider error message if available
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving identity verification status'];
    }
}

// initiate account link,  * backend check, does this customer have cybrid account, if yes, is he verified, then you give me the token I'll pass to the SDK
// * If the customer doesn't have cybrid account, you create it, and return the persona_id to me. With a state for me to know that this customer need to do verification
// * And if the customer has cybrid account, you still need to check their verification status, maybe they didn't complete it when we create account for them.

const initiateAccountLink = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });
    
    try {
        // get the cutomer info
        const getUser = await Customer.findOne({ where: { id: userid } });
        
        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });

        //check the country of the customer to be US

        if(getUser.countrycode != 'US'){
            return res.status(400).json({ status: false, message: 'Remittance service is only available for US customers at the moment.' });
        }

        // check customer status
        const customerRecord = await ExternaUser.findOne({ where: { userid: userid, provider: 'cybrid' } });

        if (!customerRecord || !customerRecord.trackingid) {
            //CALL THE CREATE CUSTOMER FUNCTION HERE
            const [createSuccess, customerId, createMessage] = await createCustomerEnroll (userid, customerRecord)

            if (!createSuccess) {
                return res.status(500).json({ status: false, message: createMessage || 'Failed to create customer remittance account.' });
            }else{

                logger.info(`initiateAccountLink: Cybrid customer created successfully for internal user ${userid}. GUID: ${customerId}`);

                // CHECK THE CUSTOMER DETAILS AND VERIFICATION STATUS
                const checkDetails = await getCybridCustomerDetails(customerId);  //first timer
                
                if (!checkDetails[0]) {
                    logger.error(`initiateAccountLink: Failed to retrieve customer remittance details for internal user ${userid}.`);
                    return res.status(500).json({ status: false, message: checkDetails[2] || 'Failed to retrieve customer remittance details.' });

                }else{

                    var customerState = checkDetails[1];
                    logger.info(`initiateAccountLink: Cybrid customer details retrieved successfully for internal user ${userid}. State: ${customerState}`);

                    if(customerState == 'unverified' || customerState == 'storing' || customerState == 'rejected'){
                        
                        logger.info(`initiateAccountLink: Cybrid customer is unverified for internal user ${userid}. State: ${customerState}`);

                        // INTIAIE IDENTITY VERIFICATION
                        const identityVerif = await createIdentityVerification(customerId, userid, getUser);  //first timer
                        
                        if (!identityVerif[0]) {
                            return res.status(500).json({ status: false, message: identityVerif[2] || 'Failed to initiate identity verification.' });
                        }else{

                            var verificationData = identityVerif[1];
                            
                            // check if the verifcation state is completed already, then create accout link
                            if(verificationData.persona_state == 'completed'){

                                logger.info(`initiateAccountLink: Cybrid customer verification already completed for internal user ${userid}. State: ${verificationData.persona_state}`);

                                // create account link
                                const accountLink =  await createAccountLink(customerId);

                                if (!accountLink[0]) {
                                    return res.status(500).json({ status: false, message: accountLink[2] || 'Failed to create account link.' });
                                }else{
                                    var linkData = accountLink[1];
                                    logger.info(`initiateAccountLink: Cybrid account link created successfully for internal user ${userid}. Link State: ${linkData.link_state}`);
                                    return res.status(200).json({
                                        status: true,
                                        message: 'Customer remittance account created successfully.',
                                        data: {
                                            customer_guid: customerId,
                                            customer_state: customerState,
                                            persona_state: verificationData.persona_state,
                                            verification_id: verificationData.verificationId,
                                            persona_inquiry_id: verificationData.persona_inquiry_id,
                                            link_token: linkData.link_token,
                                            link_state: linkData.link_state
                                        }
                                    });
                                }


                            }else{

                                logger.info(`initiateAccountLink: Cybrid customer verification pending for internal user ${userid}. State: ${verificationData.persona_state}`);

                                // get the state of the verification
                                const checkVerStatus = await getIdentityVerificationStatus(verificationData.verificationId);
                                
                                if (!checkVerStatus[0]) {
                                    return res.status(500).json({ status: false, message: checkVerStatus[2] || 'Failed to retrieve identity verification status.' });
                                }else{

                                    var verState = checkVerStatus[1];
                                    var persona_inquiry_id = checkVerStatus[2];
                                    var customer_guid = checkVerStatus[3];
                                    var country_code = checkVerStatus[4];
                                    var method = checkVerStatus[5];
                                    var persona_state = checkVerStatus[6];

                                    //update the external user record with the latest status
                                    await ExternaUser.update({ verstate: verState, persona_state: persona_state }, { where: { trackingid: customerId, userid: userid, provider: 'cybrid' } });

                                    if(persona_state == 'completed'){
                                        const accountLink =  await createAccountLink(customerId);

                                        if (!accountLink[0]) {
                                            return res.status(500).json({ status: false, message: accountLink[2] || 'Failed to create account link.' });
                                        }else{

                                            var linkData = accountLink[1];
                                            logger.info(`initiateAccountLink: Cybrid account link created successfully for internal user ${userid}. Link State: ${linkData.link_state}`);
                                            return res.status(200).json({
                                                status: true,
                                                message: 'Customer remittance account created successfully.',
                                                data: {
                                                    customer_guid: customerId,
                                                    customer_state: 'verified',
                                                    persona_state: persona_state,
                                                    verification_id: null,
                                                    persona_inquiry_id: persona_inquiry_id,
                                                    link_token: linkData.link_token,
                                                    link_state: linkData.link_state
                                                }
                                            });
                                        }
                                    }else{
                                        const checkVerStatus = await getIdentityVerificationStatus(verificationData.verificationId);
                                        

                                    }
                                }
                            }
                        }

                    }else{
                        logger.info(`initiateAccountLink: Cybrid customer is verified for internal user ${userid}. State: ${customerState}`);   

                        return res.status(200).json({
                            status: true,
                            message: 'Customer remittance account retrieved successfully.',
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
            }

        }else if(customerRecord.status == '1' && (customerRecord.verstate == 'unverified' || customerRecord.verstate == 'waiting' || customerRecord.verstate == 'storing') && customerRecord.verification_id){
            // check the verification status from cybrid
            console.log('customerRecord', customerRecord);
            const checkVerStatus = await getIdentityVerificationStatus(customerRecord.verification_id);

            console.log('checkVerStatus', checkVerStatus);

            if (!checkVerStatus[0]) {
                return res.status(500).json({ status: false, message: checkVerStatus[2] || 'Failed to retrieve identity verification status.' });
            }else{
                var verState = checkVerStatus[1];
                var persona_inquiry_id = checkVerStatus[2];
                var customer_guid = checkVerStatus[3];
                var country_code = checkVerStatus[4];
                var method = checkVerStatus[5];
                var persona_state = checkVerStatus[6];

                logger.info(`initiateAccountLink: Cybrid identity verification status retrieved successfully for internal user ${userid}. State: ${verState}`);

                //update the external user record with the latest status
                await ExternaUser.update({ verstate: verState, persona_state: persona_state }, { where: { trackingid: customerRecord.trackingid, userid: userid, provider: 'cybrid' } });

                if(verState == 'completed'){
                    logger.info(`initiateAccountLink: Cybrid customer verification now completed for internal user ${userid}. State: ${verState}`);
                    // create account link
                    const accountLink =  await createAccountLink(customerRecord.trackingid);

                    if (!accountLink[0]) {
                        return res.status(500).json({ status: false, message: accountLink[2] || 'Failed to create account link.' });
                    }else{
                        var linkData = accountLink[1];
                        logger.info(`initiateAccountLink: Cybrid account link created successfully for internal user ${userid}. Link State: ${linkData.link_state}`);
                        return res.status(200).json({
                            status: true,
                            message: 'Customer remittance account retrieved successfully.',
                            data: {
                                customer_guid: customerRecord.trackingid,
                                customer_state: 'verified',
                                persona_state: persona_state,
                                verification_id: null,
                                persona_inquiry_id: persona_inquiry_id,
                                link_token: linkData.link_token,
                                link_state: linkData.link_state
                            }
                        });
                    }
                }else{
                    logger.info(`initiateAccountLink: Cybrid customer verification still pending for internal user ${userid}. State: ${verState}`);
                    return res.status(200).json({
                        status: true,
                        message: 'Customer remittance account retrieved successfully.',
                        data: {
                            customer_guid: customerRecord.trackingid,
                            customer_state: 'pending',
                            persona_state: persona_state,
                            verification_id: null,
                            persona_inquiry_id: persona_inquiry_id,
                            link_token: null,
                            link_state: null
                        }
                    });
                }
            }
        }else if(customerRecord.persona_state == 'completed'){

            logger.info(`initiateAccountLink: Cybrid customer verification already completed for internal user ${userid}. State: ${customerRecord.verstate}`);
            // create account link
            const accountLink =  await createAccountLink(customerRecord.trackingid);

            if (!accountLink[0]) {
                return res.status(500).json({ status: false, message: accountLink[2] || 'Failed to create account link.' });
            }else{
                var linkData = accountLink[1];
                logger.info(`initiateAccountLink: Cybrid account link created successfully for internal user ${userid}. Link State: ${linkData.link_state}`);
                return res.status(200).json({
                    status: true,
                    message: 'Customer remittance account retrieved successfully.',
                    data: {
                        customer_guid: customerRecord.trackingid,
                        customer_state: customerState,
                        persona_state: 'null',
                        verification_id: null,
                        persona_inquiry_id: null,
                        link_token: null,
                        link_state: null
                    }
                });
            }
        }else{

            const cybridCustomerGuid = customerRecord.trackingid;

            const checkDetails = await getCybridCustomerDetails(cybridCustomerGuid);  //second call

            console.log('checkDetails', checkDetails);
            
            if (!checkDetails[0]) {
                logger.error(`initiateAccountLink 2: Failed to retrieve customer remittance details for internal user ${userid}.`);
                return res.status(500).json({ status: false, message: checkDetails[2] || 'Failed to retrieve customer remittance details.' });

            }else{

                var customerState = checkDetails[1];
                logger.info(`initiateAccountLink2: Cybrid customer details retrieved successfully for internal user ${userid}. State: ${customerState}`);

                if(customerState == 'unverified' || customerState == 'storing' || customerState == 'rejected'){
                    logger.info(`initiateAccountLink: Cybrid customer is unverified for internal user ${userid}. State: ${customerState}`);

                    // INTIAIE IDENTITY VERIFICATION
                    const identityVerif = await createIdentityVerification(cybridCustomerGuid, userid, getUser);

                    console.log('identityVerif', identityVerif);
                    
                    if (!identityVerif[0]) {
                        return res.status(500).json({ status: false, message: identityVerif[2] || 'Failed to initiate identity verification.' });
                    }else{

                        var verificationData = identityVerif[1];
                        logger.info(`initiateAccountLink: Cybrid identity verification initiated successfully for internal user ${userid}. Verification ID: ${verificationData.verificationId}`);

                        // check if the verifcation state is completed already, then create accout link
                        if(verificationData.persona_state == 'completed'){
                            logger.info(`initiateAccountLink: Cybrid customer verification already completed for internal user ${userid}. State: ${verificationData.persona_state}`);
                            // create account link
                            const accountLink =  await createAccountLink(cybridCustomerGuid);

                            if (!accountLink[0]) {
                                return res.status(500).json({ status: false, message: accountLink[2] || 'Failed to create account link.' });
                            }else{
                                var linkData = accountLink[1];
                                logger.info(`initiateAccountLink: Cybrid account link created successfully for internal user ${userid}. Link State: ${linkData.link_state}`);
                                return res.status(200).json({
                                    status: true,
                                    message: 'Customer remittance account retrieved successfully.',
                                    data: {
                                        customer_guid: cybridCustomerGuid,
                                        customer_state: customerState,
                                        persona_state: verificationData.persona_state,
                                        verification_id: verificationData.verificationId,
                                        persona_inquiry_id: verificationData.persona_inquiry_id,
                                        link_token: linkData.link_token,
                                        link_state: linkData.link_state
                                    }
                                });
                            }


                        }else{
                            logger.info(`initiateAccountLink: Cybrid customer verification pending for internal user ${userid}. State: ${verificationData.persona_state}`);
                            return res.status(200).json({
                                status: true,
                                message: 'Customer remittance account retrieved successfully.',
                                data: {
                                    customer_guid: cybridCustomerGuid,
                                    customer_state: customerState,
                                    persona_state: verificationData.persona_state,
                                    verification_id: verificationData.verificationId,
                                    persona_inquiry_id: verificationData.persona_inquiry_id,
                                    link_token: null,
                                    link_state: null
                                }
                            });
                        }
                    }

                }else{
                    logger.info(`initiateAccountLink: Cybrid customer is verified for internal user ${userid}. State: ${customerState}`);
                    return res.status(200).json({
                        status: true,
                        message: 'Customer remittance account retrieved successfully.',
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

        }

    } catch (error) {
        logger.error('initiateAccountLink: Error initiating account link', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error initiating account link.' });
    }
}


//creaate account link after verification
const createAccountLink = async (customerGuid) => {

    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();
        if (!tokenSuccess) {
            logger.error('createAccountLink: Unable to process request.');
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

            const linkTokenResult = await getLinkToken(workflowId);

            if (!linkTokenResult[0]) {
                return [false, null, linkTokenResult[3] || 'Failed to retrieve account link token'];
            }else{
                var linkToken = linkTokenResult[1];
                var customer_guid = linkTokenResult[2];
                var linkState = linkTokenResult[3];

                return [true, {
                    link_token: linkToken,
                    customer_guid: customer_guid,
                    link_state: linkState
                }, 'Account link created successfully.'];
            }

        }


    } catch (error) {
        logger.error('createAccountLink: Error creating account link', {
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
            logger.error('createAccountLink: Unable to process request.');
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
            await ExternaUser.update({ link_token: linkToken, link_state: linkState }, { where: { trackingid: customer_guid, provider: 'cybrid' } });

            return [true, linkToken, customer_guid, linkState];

        } else {
            logger.error('getLinkToken: Failed to retrieve link token.', thedata);
            return [false, null, null, thedata.message || 'Failed to retrieve link token'];
        }

    } catch (error) {
        logger.error('getLinkToken: Error retrieving link token', {
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

    const {account_id, plaid_token} = req.body;

    if (!account_id || !plaid_token){
        return res.status(400).json({ status: false, message: 'Kindly provide all required fields to proceed.' });
    }

    try{
        // get the cutomer info
        const getUser = await Customer.findOne({ where: { id: userid } });
        
        if (!getUser){
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
        if (customerRecord && customerRecord.trackingid && customerRecord.verstate == 'completed') {
            const cybridCustomerGuid = customerRecord.trackingid;
            
            const payload = {
                "account_kind": "plaid",
                "name": `${getUser.firstname} ${getUser.lastname}`,
                "customer_guid": cybridCustomerGuid,
                "plaid_public_token": plaid_token,
                "plaid_account_id": account_id
            }

            // log the request
            await LogRequest.create({ reference: cybridCustomerGuid, jsonreq: JSON.stringify(payload), timed: '', product: 'cybextbank', provider: 'cybd' });

            const options = {
                method: 'POST',
                url: `${process.env.CYBRID_API_BASEURL2}/api/external_bank_accounts`,
                headers: {
                    accept: 'application/json',
                    'content-type': 'application/json',
                    "Authorization": "Bearer " + access_token
                }
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

                // retrieve the external bank account details and store in our db if needed
                const retrieveBankDetails = await RetrieveExternalBankDetails(externalBankGuid);
                if (!retrieveBankDetails[0]) {
                    logger.error(`createExternalBank: Failed to retrieve external bank account details for internal user ${userid}.`);
                }else{
                    var bankDetails = retrieveBankDetails[1];
                    logger.info(`createExternalBank: External bank account details retrieved successfully for internal user ${userid}. Bank GUID: ${externalBankGuid}`);

                    // create function to verify the bank account
                    const verifyBankAccount = await verifyExternalBankAccount(cybridCustomerGuid, externalBankGuid);
                    if (!verifyBankAccount[0]) {
                        logger.error(`createExternalBank: Failed to verify external bank account for internal user ${userid}.`);
                        
                        return res.status(500).json({ status: false, message: verifyBankAccount[2] || 'Failed to verify external bank account.' });

                    }else{
                        logger.info(`createExternalBank: External bank account verification initiated successfully for internal user ${userid}. Bank GUID: ${externalBankGuid}`);
                        var verificationData = verifyBankAccount[1];
                        return res.status(200).json({
                            status: true,
                            message: 'External bank account linked and verification initiated successfully.',
                            data: {
                                external_bank_guid: externalBankGuid,
                                external_bank_state: state,
                                verification_id: verificationData.verificationId
                            }
                        });
                    }

                }

            }else{
                logger.error('createExternalBank: Failed to link external bank account.', thedata);
                return res.status(400).json({ status: false, message: thedata.message || 'Failed to link external bank account.' });
            }
            
        }else{
            return res.status(400).json({ status: false, message: 'No external bank workflow found for this customer.' });

        }
    }catch(error){
        logger.error('createExternalBank: Error linking external bank account', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        
        return res.status(500).json({ status: false, message: error.response?.data?.error_message || error.response?.data?.message || 'Error linking external bank account.' });

    }

}

const RetrieveExternalBankDetails = async(externalBankGuid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();

        if (!tokenSuccess) {
            logger.error('Retrieve ExternalBankDetails: Unable to process request.');
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

            return [true, {
                state: state,
                name: name,
                environment: environment,
                bank_guid: bank_guid,
                holder: holder,
                balances: balances
            }, 'External bank account details retrieved successfully.'];

        } else {
            logger.error('Retrieve ExternalBankDetails: Failed to retrieve external bank account details.', thedata);
            return [false, null, thedata.message || 'Failed to retrieve external bank account details'];
        }

    } catch (error) {
        logger.error('Retrieve ExternalBankDetails: Error retrieving external bank account details', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return [false, null, error.response?.data?.error_message || error.response?.data?.message || 'Error retrieving external bank account details.'];
    }

}

const verifyExternalBankAccount = async(customerGuid, externalBankGuid) => {
    try {
        const [tokenSuccess, access_token, expires_in, scope] = await getCybridAccessToken();

        if (!tokenSuccess) {
            logger.error('verifyExternalBankAccount: Unable to process request.');
            return [false, null, 'Unable to connect to the partner bank'];
        }

        const data = {
            "type": "bank_account",
            "method": "account_ownership",
            "customer_guid": customerGuid,
            "external_bank_account_guid": externalBankGuid
        };

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

        // log the response
        await LogResponse.create({ ownerid: externalBankGuid, reference: externalBankGuid, jsonresp: JSON.stringify(thedata), timed: '', product: 'cybextbankverif', provider: 'cybd' });

        if (thedata && thedata.guid) {
            var verificationId = thedata.guid;
            return [true, {
                verificationId: verificationId
            }, 'External bank account verification initiated successfully.'];

        }else {
            logger.error('verifyExternalBankAccount: Failed to verify external bank account.', thedata);
            return [false, null, thedata.message || 'Failed to verify external bank account'];
        }

    }
    catch (error) {
        logger.error('verifyExternalBankAccount: Error verifying external bank account', {
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
        
        if (!getUser){
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
                const simplifiedList = thedata.objects.map(bank => ({
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
                
            }  else {
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


//========================EXPORT MODULES======================
module.exports = {
    initiateAccountLink, createExternalBank, getLinkedBankList
}