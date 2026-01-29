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
const { formatAmount, cleanMe, ucFirst,giveWelcomeBonus, referralUplineDownlineBonus} = require("../../config/myfunct");
const { cloudinary } = require("../../config/imageuploads");
const { logger } = require('../../config/logger');

const KYC = db.kyc;
const payWhk = db.whookhandler;
const Customer = db.customers;
const KycDoc = db.kycdoc;


const initVeriff = async (req, res) => {
  try {
    const userid = req.user.id;
    if (!userid)
        return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const checkdkyc = await KYC.findOne({where: { provider: 'veriff', userid: userid} });
    if (checkdkyc){
        if (checkdkyc.status == 1) {
            return res.status(400).json({ 
                status: true, message: `Verification already completed` 
            });
        }else if(checkdkyc.status == 0){
            res.json({
                status: true,
                message: 'Verification Processing',
                data: {
                    sessionurl: checkdkyc.session,
                    sessionid: '',
                    sessiontoken: ''
                }
            });
        }else{

            // delete the old kyc for the customer from veriff
            await KYC.destroy({where: { provider: 'veriff', userid: userid} });

             const options = {
                method: 'POST',
                url: `${process.env.VERIFF_URL}/sessions`,
                headers: {
                    'X-AUTH-CLIENT': process.env.VERIFF_PKEY,
                    'accept': 'application/json',
                    'content-type': 'application/json'
                },
                data: {
                    "verification": {
                        "callback": "",
                        "vendorData": `${userid}`
                    }
                }
            };

             // Make API request
            const response = await axios.request(options);
            const thedata = response.data;
            let jsonString = JSON.stringify(thedata);

              if (thedata.status == 'success') {
                const sessID = thedata['verification']['id'];
                const sessURL = thedata['verification']['url'];
                const sessionToken = thedata['verification']['sessionToken'];
        
                const dtimed = Math.floor(Date.now() / 1000);
                try {
                    await KYC.create({
                        userid: userid, otpcode: '', verid: sessID, timed: dtimed, verfname: '', verlname: '', verdob: '', 
                        gender: '', email: '', bvv: '', avatar: '', verphone: '', status: 0, jsonresp: '', vertype: '', provider: 'veriff', session: sessURL, tier: 1
                    });  
        
        
                res.json({
                    status: true,
                    message: 'Verification Initiated',
                    data: {
                        sessionid: sessID,
                        sessionurl: sessURL,
                        sessiontoken: sessionToken
                    }
                });
        
                } catch (err) {
                    console.error('Unable to process your request : ', err);
                    return res.status(400).json({ status: false, message: 'Unable to process your request' });
                }
                
            }else{
                return res.status(400).json({ status: false, message: 'Unable to initiate verification. Try again' });   
            }
        }
        
    }else{

        const options = {
            method: 'POST',
            url: `${process.env.VERIFF_URL}/sessions`,
            headers: {
                'X-AUTH-CLIENT': process.env.VERIFF_PKEY,
                'accept': 'application/json',
                'content-type': 'application/json'
            },
            data: {
                "verification": {
                    "callback": "",
                    "vendorData": `${userid}`
                }
            }
        };
    
        // Make API request
        const response = await axios.request(options);
        const thedata = response.data;
        let jsonString = JSON.stringify(thedata);
        // console.log(thedata)

        if (thedata.status == 'success') {
            const sessID = thedata['verification']['id'];
            const sessURL = thedata['verification']['url'];
            const sessionToken = thedata['verification']['sessionToken'];
    
            const dtimed = Math.floor(Date.now() / 1000);
            try {
                await KYC.create({
                    userid: userid, otpcode: '', verid: sessID, timed: dtimed, verfname: '', verlname: '', verdob: '', 
                    gender: '', email: '', bvv: '', avatar: '', verphone: '', status: 0, jsonresp: '', vertype: '', provider: 'veriff', session: sessURL, tier: 1
                });  
    
    
            res.json({
                status: true,
                message: 'Verification Initiated',
                data: {
                    sessionid: sessID,
                    sessionurl: sessURL,
                    sessiontoken: sessionToken
                }
            });
    
            } catch (err) {
                console.error('Unable to process your request : ', err);
                return res.status(400).json({ status: false, message: 'Unable to process your request' });
            }
            
        }else{
            return res.status(400).json({ status: false, message: 'Unable to initiate verification. Try again' });   
        }

    }

  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};


const verVeriffHook = async(req, res)=>{  
    try {    
        const event = req.body;
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
        }

        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        let dtimed = Date.parse(new Date())/1000; 
        var entity = resp;
        
        // console.log('debuggg verif whk', dbody)
        payWhk.create({resp: dbody, txref: '', gateway: 'veriff', timed: dtimed, processed: 0});

        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });
        
        if((resp['action'] == 'submitted') && resp['vendorData']){
            var tknid = resp['vendorData'];
            const userid = tknid;
            const reference = resp['id'];

            const getuser = await Customer.findOne({where: {id: userid}});
            if(!getuser){
                return 'invalid customer';
            }

            // udpate the ver as pending initially before calling ver ednpoint
            await Customer.update({ bvverify: 1}, { where: { id: userid } });

            const notedesc = `Hi! Your Facial verification successfully submitted and currently awaiting approval`
            await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);


        }else if (resp['verification']['status'] == 'approved' || resp['verification']['status'] == 'resubmission_requested' || resp['verification']['status'] == 'declined'){

            const dtimed = Math.floor(Date.now() / 1000);
            const verificationStatus = resp['verification']['status'];  
    
            if(resp['verification']['vendorData']){
                var tknid = resp['verification']['vendorData'];
                const user_id = tknid;

                const person = resp['verification']['person'];
                const reason = resp['verification']['reason'];
                const reasonCode = resp['verification']['reasonCode'];
                

                const gender = !person['gender'] ? '' : person['gender'];
                const idNumber = person['idNumber'];
                const lastName = !person['lastName'] ? '' : person['lastName'];
                const firstName = !person['firstName'] ? '' : person['firstName'];
                const citizenship = !person['citizenship'] ? '' : person['citizenship'];
                const dateOfBirth = !person['dateOfBirth'] ? '' : person['dateOfBirth'];
                const nationality = !person['nationality'] ? '' : person['nationality'];
                const yearOfBirth = !person['yearOfBirth'] ? '' : person['yearOfBirth'];
                const address = !person['address'] ? '' : person['address']
                const placeOfBirth = person['placeOfBirth'];

                const pepSanctionMatch = person['pepSanctionMatch'];
                const comments = resp['verification']['comments'];
                const additionalVerifiedData = resp['verification']['additionalVerifiedData'];
                const document = resp['verification']['document'];
                const vertype = document['type'];
                const documentState = document['state'];
                const vervalue = !document['number'] ? '' : document['number'];
                const documentCountry = document['country'];
                const validFrom = document['validFrom'];
                const validUntil = document['validUntil'];

                const reference = resp['verification']['id'];
                const imagefile = ''; 
                const verstatus = verificationStatus; 
                const verification_status = verificationStatus; 
                
                var phone_number = '';
                const hisdob =  dateOfBirth;

                //chec the user exis
                const getuser = await Customer.findOne({where: {id: tknid}});
                if(!getuser){
                    return 'invalid customer';
                }

                var username = getuser.firstname;
                var useremail = getuser.email;
                const widget_email = useremail;
                var currentTier = getuser.accounttier;
                var countrycode = getuser.countrycode;

                if(verificationStatus == 'approved'){
                    var capture_status = '1';
                    var bvverify = 2;
                }else if(verificationStatus == 'resubmission_requested'){
                    var capture_status = '0';
                    var bvverify = 0;
                }else{
                    var capture_status = '3';
                    var bvverify = 0;
                }
                

            try {
                // for diaspora govid1 should be 0, 1 for NG
                var thetier = countrycode == 'NG' ? 1 : 0;
                var thetierStatus = countrycode == 'NG' ? 1 : 0;

                const addressMeta = {"houseNumber": "49", "road": "84TH ST", "city": "CLEVELAND", "state": "OH", "postcode": "44106"};  

                let updateKYC = await KYC.update({otpcode: '',timed: dtimed,
                    verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                    veremail: '', bvv: vervalue, avatar: imagefile, verphone: phone_number,
                    status: capture_status, jsonresp: dbody, vertype: vertype, tier: '1', metainfo: addressMeta
                }, { where: { userid: user_id, provider: 'veriff', verid: reference} });


                if(!updateKYC)
                    return res.json({status: false, message: 'Unable to complete verification, kindly retry again. '});            

                    if(verificationStatus == 'approved'){
                        if(currentTier > 1){
                            await Customer.update({ firstname: firstName, lastname: lastName, bvverify: bvverify, isverified: 1, state: 'OH', city: 'CLEVELAND', postalcode: '44106', address: '84TH ST', houseno: '497'}, 
                                { where: { id: user_id } });
                        }else{
                            await Customer.update(
                                { firstname: firstName, lastname: lastName, bvverify: bvverify, isverified: 1, accounttier: 1, state: 'OH', city: 'CLEVELAND', postalcode: '44106', address: '84TH ST', houseno: '497' }, 
                                { where: { id: user_id } }
                            );
                        }
                        
                        const notedesc = `Congratulations! Your Facial verification successfully approved`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)
                        
                        var mailcontent = `
                        <p>Congratulations! Your Facial verification on ${process.env.SITENAME} has been verified and approved successfully.</p>
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
            
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                        //GIVE WELCOME BONUS
                        // await giveWelcomeBonus(user_id);
                        // await referralUplineDownlineBonus(user_id);

                        // GET THE VERIFIATION MEDIA
                        await getVeriffMedia(sessionId, tknid, vervalue, validUntil, documentCountry, vertype);

                        res.json({ status: true, message: 'Completed' });
                        return true;

                    }else if(verificationStatus == 'resubmission_requested' || verificationStatus == 'declined'){
                        const notedesc = `Oops! Your Facial verification has been declined and requires resubmission`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)

                        var mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your Facial verification on ${process.env.SITENAME} has been declined and require resubmission</p>
                        ${reason }
                        <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify and resubmit the verification</p>
                        
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);

                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });

                    }else{
                        // Unverified
                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });
                    }
                        
                } catch (err) {
                    logger.error('Unable to process your request  veriff hook: ', err);
                    // return res.status(400).json({ status: false, message: 'Unable to process your request' });
                }

            }else{
                logger.info('Invalid customer ID');
            }  
            
        }else{
            logger.info('Invalid verification status verrif' );
        }

   }catch (error) {
        // res.json({ status: false, message: 'Something went wrong! Unable to process request' });
        logger.error("ver hook ERROE: ", error);
    }
}


// const verVeriffHookProd = async(req, res)=>{  }
const verVeriffHookProd = async(req, res)=>{  
    try {    
        const event = req.body;
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
        }

        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        let dtimed = Date.parse(new Date())/1000; 
        var entity = resp;
        
        // console.log('debuggg verif whk', dbody)
        payWhk.create({resp: dbody, txref: '', gateway: 'veriff', timed: dtimed, processed: 0});

        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });
        
        if((resp['action'] == 'submitted') && resp['vendorData']){
            var tknid = resp['vendorData'];
            const userid = tknid;
            const reference = resp['id'];

            const getuser = await Customer.findOne({where: {id: userid}});
            if(!getuser){
                return 'invalid customer';
            }

            // udpate the ver as pending initially before calling ver ednpoint
            await Customer.update({ bvverify: 1}, { where: { id: userid } });

            const notedesc = `Hi! Your KYC Tier 1 verification successfully submitted and currently awaiting approval`
            await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);


        }else if ((resp['data']['verification']['decision'] == 'approved') || (resp['data']['verification']['decision'] == 'resubmission_requested') || (resp['data']['verification']['decision'] == 'declined')){

            const dtimed = Math.floor(Date.now() / 1000);
            
            if(resp['vendorData']){
                const reference = resp['sessionId'];
                var sessionId = reference;
                var tknid = resp['vendorData'];
                const user_id = tknid;

                const data = resp['data'];
                const verificationStatus = data['verification']['decision'];  

                const reason = !data['verification']['reason'] ? '' : data['verification']['reason'];
                const decisionScore = data['verification']['decisionScore'];
                
                
                const person = data['verification']['person'];
                const thefirstName = !person['firstName'] ? '' : person['firstName']['value'];
                const firstName = await getVeriffFirstName(thefirstName);  // split to get only first name

                const lastName = !person['lastName'] ? '' : person['lastName']['value'];
                const dateOfBirth = !person['dateOfBirth'] ? '' : person['dateOfBirth']['value'];
                const gender = !person['gender'] ? '' : person['gender']['value'];
                const idNumber = person['idNumber'] ? '' : person['idNumber']['value'];
                // const nationality = !person['nationality'] ? '' : person['nationality']['value'];
                // const citizenship = !person['citizenship'] ? '' : person['citizenship']['value'];
                const address = !person['address'] ? '' : person['address']['value'];
                const placeOfBirth = !person['placeOfBirth'] ? '' : person['placeOfBirth']['value'];
                
                // get the address components if available 
                const addressComponents = !person['address'] ? '' : person['address']['components'];
                const houseNumber = !person['address']['components']['houseNumber'] ? '' : person['address']['components']['houseNumber'];
                const street = !person['address']['components']['road'] ? '' : person['address']['components']['road'];
                const city = !person['address']['components']['city'] ? '' : person['address']['components']['city'];
                const state = !person['address']['components']['state'] ? '' : person['address']['components']['state'];
                const postalcode = !person['address']['components']['postcode'] ? '' : person['address']['components']['postcode'];

                const addressMeta = JSON.stringify({
                    houseNumber: houseNumber,
                    street: street,
                    city: city,
                    state: state,
                    postalcode: postalcode
                });

                // const comments = resp['verification']['comments'];

                const document = data['verification']['document'];
                const vervalue = !document['number'] ? '' : document['number']['value'];
                const vertype = !document['type'] ? '' : document['type']['value'];
                const documentCountry = !document['country'] ? '' : document['country']['value'];
                const validUntil = !document['validUntil'] ? '' : document['validUntil']['value'];
                const validFrom = !document['validFrom'] ? '' : document['validFrom']['value'];
                const licenseNumber = !document['licenseNumber'] ? '' : document['licenseNumber']['value'];

                // const documentState = document['state'];
                // const additionalVerifiedData = data['verification']['additionalVerifiedData'];

                // cancel verification if documentCountry is not US
                if(documentCountry != 'US'){
                    // update kyc as declined
                    await KYC.update({otpcode: '',timed: dtimed,
                        verfname: firstName, verlname: lastName, verdob: dateOfBirth, gender: gender,
                        veremail: '', bvv: vervalue, avatar: '', verphone: '',
                        status: '3', jsonresp: dbody, vertype: vertype, tier: '0'
                    }, { where: { userid: user_id, provider: 'veriff', verid: reference} });

                await Customer.update({ bvverify: 0}, { where: { id: user_id } });

                const notedesc = `Oops! Your Facial verification has been declined as only US residents are allowed to use this service`
                await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
                await notifyMe(user_id, 'KYC Verification', 'user', notedesc)

                var mailcontent = `
                <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your Facial verification on ${process.env.SITENAME} has been declined as only US residents are allowed to use this service</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify and resubmit the verification</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;">If you have any questions, please contact support.</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;">Thank you for your understanding.</p>

                <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                `;
                //send email                
                await mailSender('', 'KYC Verification Update', getuser.email, mailcontent);
                return;
                }

                const imagefile = ''; 
                const verstatus = verificationStatus; 
                const verification_status = verificationStatus; 
                
                var phone_number = '';
                const hisdob =  dateOfBirth;

                //chec the user exis
                const getuser = await Customer.findOne({where: {id: tknid}});
                if(!getuser){
                    // console.log('Invalid customer ID');
                    return 'invalid customer';
                }

                var username = getuser.firstname;
                const widget_email = getuser.email;
                var currentTier = getuser.accounttier;

                if(verificationStatus == 'approved'){
                    var capture_status = '1';
                    var bvverify = 2;
                }else if(verificationStatus == 'resubmission_requested'){
                    var capture_status = '0';
                    var bvverify = 0;
                }else{
                    var capture_status = '3';
                    var bvverify = 0;
                }
                

            try {
                // for diaspora govid1 should be 0, 1 for NG
                // var thetier = countrycode == 'NG' ? 1 : 0;
                // var thetierStatus = countrycode == 'NG' ? 1 : 0;

                let updateKYC = await KYC.update({otpcode: '',timed: dtimed,
                    verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                    veremail: '', bvv: vervalue, avatar: imagefile, verphone: phone_number,
                    status: capture_status, jsonresp: dbody, vertype: vertype, tier: 1, metainfo: addressMeta
                }, { where: { userid: user_id, provider: 'veriff', verid: reference} });


                if(!updateKYC){
                    console.log("Unable to complete verification, kindly retry again.");            
                    return;
                }

                    if(verificationStatus == 'approved'){
                        if(currentTier > 1){
                            await Customer.update({ firstname: firstName, lastname: lastName, bvverify: bvverify, isverified: 1, state: state, city: city, postalcode: postalcode, address: street, houseno: houseNumber}, 
                                { where: { id: user_id } });
                        }else{
                            await Customer.update(
                                { firstname: firstName, lastname: lastName, bvverify: bvverify, isverified: 1, accounttier: 1, state: state, city: city, postalcode: postalcode, address: street, houseno: houseNumber }, 
                                { where: { id: user_id } }
                            );
                        }
                        
                        const notedesc = `Congratulations! Your Facial verification successfully approved`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)
                        
                        var mailcontent = `
                        <p style="line-height: 20px; letter-spacing: 0.025em;">Hello ${lastName} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            Congratulations! Your Facial verification on ${process.env.SITENAME} has been verified and successfully approved.
                        </p>
                        
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
            
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);
                        await mailSender('', 'KYC Verification Update', 'olajideolatunji@hitchpay.ng', mailcontent);

                        //GIVE WELCOME BONUS
                        // await giveWelcomeBonus(user_id);
                        // await referralUplineDownlineBonus(user_id);

                        
                        // GET THE VERIFIATION MEDIA
                        await getVeriffMedia(sessionId, tknid, vervalue, validUntil, documentCountry, vertype);
                        console.log(`Verification Successfuly Completed.`);

                        // res.json({ status: true, message: 'Completed' });
                        // return true;

                    }else if(verificationStatus == 'resubmission_requested' || verificationStatus == 'declined'){
                        
                        const notedesc = `Oops! Your Facial verification has been declined and requires resubmission`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)

                        var mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your Facial verification on ${process.env.SITENAME} has been declined and require resubmission</p>
                        ${reason }
                        <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify and resubmit the verification</p>
                        
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);
                        await mailSender('', 'KYC Verification Update', 'olajideolatunji@hitchpay.ng', mailcontent);

                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });

                    }else{
                        // Unverified
                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });
                    }
                        
                } catch (err) {
                    console.error('Unable to process your request  veriff hook: ', err.message);
                    // return res.status(400).json({ status: false, message: 'Unable to process your request' });
                }

            }else{
                console.log('Invalid customer ID')
                // res.json({ status: false, message: 'Invalid customer ID' });
            }  
            
        }else{
            console.log('Invalid verification status verrif');
        }

   }catch (error) {
        // res.json({ status: false, message: 'Something went wrong! Unable to process request' });
        logger.error("ver hook ERROE: ", error);
    }
}

const getVeriffFirstName = async(fullName)=>{
  if (!fullName || typeof fullName !== 'string') return '';

  // Trim spaces and split by one or more spaces
  const parts = fullName.trim().split(/\s+/);

  // Get the first valid word (if any)
  const firstName = parts[0] || '';

  // Format it to proper case (e.g., "Paul")
  console.log(firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase())
  return firstName.charAt(0).toUpperCase() + firstName.slice(1).toLowerCase();
}

const genVeriffHMAC = async(payload)=>{
    const sharedSecretKey = process.env.VERIFF_SKEY;
    const hash = crypto
    .createHmac("sha256", sharedSecretKey)
    .update(payload)
    .digest("hex");

    return hash;
}

const getVeriffMedia = async(sessionId, tknid, vervalue, expirydate, issuance_country, docname) =>{

    try {
    
    //get the signature
    const signature = await genVeriffHMAC(sessionId);

     const options = {
            method: 'GET',
            url: `${process.env.VERIFF_URL}/sessions/${sessionId}/media`,
            headers: {
                'X-AUTH-CLIENT': process.env.VERIFF_PKEY,
                'X-HMAC-SIGNATURE': signature,
                'content-type': 'application/json'
            }
        };
    
        // Make API request
        const response = await axios.request(options);
        const thedata = response.data;
        let jsonString = JSON.stringify(thedata);
        // console.log(thedata)

        if (thedata.status == 'success') {            
            const images = thedata['images'];
            // const videos = thedata['videos'];

            // select only first of each contect
            const selectedMedia = await selectFirstMediaFromGroup(images);
            
            if (!selectedMedia?.length) {
                console.log("No images found for this session.");
                return;
            }

            const uploadedUrls = [];
            for (const media of selectedMedia) {
                const url = await fetchAndUploadMedia(media, tknid);
                if (url) uploadedUrls.push({ name: media.name, url });
            }

            // console.log(uploadedUrls);
            var faceurl = uploadedUrls.find(item => item.name.includes('face'))?.url;
            var docfront = uploadedUrls.find(item => item.name.includes('document-front'))?.url;
            var docback = uploadedUrls.find(item => item.name.includes('document-back'))?.url;

            var userface = !faceurl ? '' : faceurl;
            var idcardfront = !docfront ? '' : docfront;
            var idcardback = !docback ? idcardfront : docback;

            // save to DB
            const dtimed = Math.floor(Date.now() / 1000);
            const [kycDoc, created] = await KycDoc.findOrCreate({
                where: { userid: tknid, tier: 2, doctype: 'idcard'}, defaults: { userid: tknid, docurl: idcardfront,
                    docurl_back: idcardback, docno: vervalue, expirydate: expirydate, issuancecountry: issuance_country,
                    docstatus: 2, doctype: 'idcard', docname: docname, tier: 2, timed: dtimed, remarkby: 'veriff'
                }
            });

            //if the docname is passport, add it to kycdocs as passsport
            if (docname.toLowerCase().includes('passport')) {
                const [passportDoc, passportCreated] = await KycDoc.findOrCreate({
                    where: { userid: tknid, tier: 2, doctype: 'interpass' }, defaults: {
                        userid: tknid, docurl: idcardfront, docurl_back: idcardback, docno: vervalue,
                        expirydate: expirydate, issuancecountry: issuance_country, docstatus: 2,
                        doctype: 'interpass', docname: docname, tier: 2, timed: dtimed, remarkby: 'veriff'
                    }
                });
                if (!passportCreated) {
                    await passportDoc.update({
                        docurl: idcardfront, docurl_back: idcardback, docno: vervalue, expirydate: expirydate,
                        issuancecountry: issuance_country, docstatus: 2, doctype: 'interpass', docname: docname,
                        timed: dtimed, remarkby: 'veriff'
                    });
                }

                //auto upgrade to tier 2
                await Customer.update({ photo: userface, accounttier: 2}, { where: { id: tknid } });
            }


            if (!created) {
                await kycDoc.update({docurl: idcardfront, docurl_back: idcardback, docno: vervalue, expirydate: expirydate,
                    issuancecountry: issuance_country, docstatus: 2, doctype: 'idcard', docname: docname, timed: dtimed, remarkby: 'veriff'
                });
            }

            // update the cutomer profile image
            await Customer.update({ photo: userface}, { where: { id: tknid } });

            console.log(`Media update completed`);
            
            return true;            
        }else{
            return false;
        }

        
    } catch (error) {
        logger.error(error);    
    }
}


async function fetchAndUploadMedia(media, userid) {
  try {
    const mediaId = media.id;
    const signature = await genVeriffHMAC(mediaId);

    // 1. Fetch binary image from Veriff
    const response = await axios.get(`${process.env.VERIFF_URL}/media/${mediaId}`, {
      headers: {
        "X-AUTH-CLIENT": process.env.VERIFF_PKEY,
        "X-HMAC-SIGNATURE": signature,
      },
      responseType: "arraybuffer",
    });

    // 2️. Convert to base64
    const base64 = Buffer.from(response.data, "binary").toString("base64");
    const dataUri = `data:${media.mimetype};base64,${base64}`;

    // 3. Upload to Cloudinary
    const randomFileName = `kyc_tier2${userid}_${uuidv4()}`;
    const uploadResult = await cloudinary.uploader.upload(dataUri, {
      folder: "veriff-media",
      public_id: randomFileName, // name like 'face', 'document-front'
      overwrite: true,
    });

    // console.log(` Uploaded ${media.name || media.id}: ${uploadResult.secure_url}`);
    return uploadResult.secure_url;

  } catch (error) {
    console.error(`Failed to upload ${media.id}:`, error.message);
    logger.error(`Failed to upload ${media.id}:`, error);
    if (error.response?.data) console.error(error.response.data);
  }
}

const selectFirstMediaFromGroup = async(images) =>{
  const selected = {};
  const groups = ['face', 'document-front', 'document-back'];

  for (const img of images) {
    for (const group of groups) {
      if (img.context.startsWith(group)) {
        // Only take the first occurrence
        if (!selected[group]) {
          selected[group] = img;
        }
      }
    }
  }

  // Return only the selected images
  return Object.values(selected);
}

const getVeriffDecision = async(sessionId)=>{
    try {
        const signature = await genVeriffHMAC(sessionId);
    
        if(!signature)
            return false;
        
        const options = {
            method: 'GET',
            url: `${process.env.VERIFF_URL}/sessions/${sessionId}/decision`,
            headers: {
                'X-AUTH-CLIENT': process.env.VERIFF_PKEY,
                'X-HMAC-SIGNATURE': signature,
                'content-type': 'application/json'
            }
        };
    
        // Make API request
        const response = await axios.request(options);
        const thedata = response.data;

        console.log('result', thedata)
        // let jsonString = JSON.stringify(thedata);

    } catch (error) {
        logger.error(error);    
        return false
    }

}


const verVeriffHookTestSimulate = async(req, res)=>{  
    try {    
        const event = req.body;
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
        }

        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        let dtimed = Date.parse(new Date())/1000; 
        var entity = resp;
        
        // console.log('debuggg verif whk', dbody)
        payWhk.create({resp: dbody, txref: '', gateway: 'veriff', timed: dtimed, processed: 0});

        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });
        
        if((resp['action'] == 'submitted') && resp['vendorData']){
            var tknid = resp['vendorData'];
            const userid = tknid;
            const reference = resp['id'];

            const getuser = await Customer.findOne({where: {id: userid}});
            if(!getuser){
                return 'invalid customer';
            }

            // udpate the ver as pending initially before calling ver ednpoint
            await Customer.update({ bvverify: 1}, { where: { id: userid } });

            const notedesc = `Hi! Your KYC Tier 1 verification successfully submitted and currently awaiting approval`
            await pushNotify(userid, 'KYC Verification - HitchPay', notedesc);


        }else if ((resp['data']['verification']['decision'] == 'approved') || (resp['data']['verification']['decision'] == 'resubmission_requested') || (resp['data']['verification']['decision'] == 'declined')){

            const dtimed = Math.floor(Date.now() / 1000);
            
            if(resp['vendorData']){
                const reference = resp['sessionId'];
                var sessionId = reference;
                var tknid = resp['vendorData'];
                const user_id = tknid;

                const data = resp['data'];
                const verificationStatus = data['verification']['decision'];  

                const reason = !data['verification']['reason'] ? '' : data['verification']['reason'];
                const decisionScore = data['verification']['decisionScore'];
                
                
                const person = data['verification']['person'];
                const thefirstName = !person['firstName'] ? '' : person['firstName']['value'];
                const firstName = await getVeriffFirstName(thefirstName);  // split to get only first name

                const lastName = !person['lastName'] ? '' : person['lastName']['value'];
                const dateOfBirth = !person['dateOfBirth'] ? '' : person['dateOfBirth']['value'];
                const gender = !person['gender'] ? '' : person['gender']['value'];
                const idNumber = person['idNumber'] ? '' : person['idNumber']['value'];
                // const nationality = !person['nationality'] ? '' : person['nationality']['value'];
                // const citizenship = !person['citizenship'] ? '' : person['citizenship']['value'];
                const address = !person['address'] ? '' : person['address']['value'];
                const placeOfBirth = !person['placeOfBirth'] ? '' : person['placeOfBirth']['value'];
                
                // get the address components if available 
                const addressComponents = !person['address'] ? '' : person['address']['components'];
                const houseNumber = !person['address']['components']['houseNumber'] ? '' : person['address']['components']['houseNumber'];
                const street = !person['address']['components']['road'] ? '' : person['address']['components']['road'];
                const city = !person['address']['components']['city'] ? '' : person['address']['components']['city'];
                const state = !person['address']['components']['state'] ? '' : person['address']['components']['state'];
                const postalcode = !person['address']['components']['postcode'] ? '' : person['address']['components']['postcode'];

                const addressMeta = JSON.stringify({
                    houseNumber: houseNumber,
                    street: street,
                    city: city,
                    state: state,
                    postalcode: postalcode
                });

                // const comments = resp['verification']['comments'];

                const document = data['verification']['document'];
                const vervalue = !document['number'] ? '' : document['number']['value'];
                const vertype = !document['type'] ? '' : document['type']['value'];
                const documentCountry = !document['country'] ? '' : document['country']['value'];
                const validUntil = !document['validUntil'] ? '' : document['validUntil']['value'];
                const validFrom = !document['validFrom'] ? '' : document['validFrom']['value'];
                const licenseNumber = !document['licenseNumber'] ? '' : document['licenseNumber']['value'];

                // const documentState = document['state'];
                // const additionalVerifiedData = data['verification']['additionalVerifiedData'];

                //chec the user exis
                const getuser = await Customer.findOne({where: {id: tknid}});
                if(!getuser){
                    console.log('Invalid customer ID');
                    return 'invalid customer';
                }

                // cancel verification if documentCountry is not US
                if(documentCountry != 'US'){
                    // update kyc as declined
                    await KYC.update({otpcode: '',timed: dtimed,
                        verfname: firstName, verlname: lastName, verdob: dateOfBirth, gender: gender,
                        veremail: '', bvv: vervalue, avatar: '', verphone: '',
                        status: '3', jsonresp: dbody, vertype: vertype, tier: '0'
                    }, { where: { userid: user_id, provider: 'veriff', verid: reference} });

                await Customer.update({ bvverify: 0}, { where: { id: user_id } });

                const notedesc = `Oops! Your Facial verification has been declined as only US residents are allowed to use this service`
                await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
                await notifyMe(user_id, 'KYC Verification', 'user', notedesc)

                var mailcontent = `
                <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your Facial verification on ${process.env.SITENAME} has been declined as only US residents are allowed to use this service</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify and resubmit the verification</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;">If you have any questions, please contact support.</p>
                <p style="line-height: 20px; letter-spacing: 0.025em;">Thank you for your understanding.</p>

                <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                `;
                //send email                
                await mailSender('', 'KYC Verification Update', getuser.email, mailcontent);
                await mailSender('', 'KYC Verification Update', 'olajideolatunji@hitchpay.ng', mailcontent);
                console.log('Non US resident - verification declined')
                return;
                }

                
                const imagefile = ''; 
                const verstatus = verificationStatus; 
                const verification_status = verificationStatus; 
                
                var phone_number = '';
                const hisdob =  dateOfBirth;


                var username = getuser.firstname;
                const widget_email = getuser.email;
                var currentTier = getuser.accounttier;

                if(verificationStatus == 'approved'){
                    var capture_status = '1';
                    var bvverify = 2;
                }else if(verificationStatus == 'resubmission_requested'){
                    var capture_status = '0';
                    var bvverify = 0;
                }else{
                    var capture_status = '3';
                    var bvverify = 0;
                }
                

            try {
                // for diaspora govid1 should be 0, 1 for NG
                // var thetier = countrycode == 'NG' ? 1 : 0;
                // var thetierStatus = countrycode == 'NG' ? 1 : 0;

                let updateKYC = await KYC.update({otpcode: '',timed: dtimed,
                    verfname: firstName, verlname: lastName, verdob: hisdob, gender: gender,
                    veremail: '', bvv: vervalue, avatar: imagefile, verphone: phone_number,
                    status: capture_status, jsonresp: dbody, vertype: vertype, tier: 1, metainfo: addressMeta
                }, { where: { userid: user_id, provider: 'veriff', verid: reference} });


                if(!updateKYC){
                    console.log("Unable to complete verification, kindly retry again.");            
                    return;
                }

                    if(verificationStatus == 'approved'){
                        if(currentTier > 1){
                            await Customer.update({ firstname: firstName, lastname: lastName, bvverify: bvverify, isverified: 1, state: state, city: city, postalcode: postalcode, address: street, houseno: houseNumber}, 
                                { where: { id: user_id } });
                        }else{
                            await Customer.update(
                                { firstname: firstName, lastname: lastName, bvverify: bvverify, isverified: 1, accounttier: 1, state: state, city: city, postalcode: postalcode, address: street, houseno: houseNumber }, 
                                { where: { id: user_id } }
                            );
                        }
                        
                        const notedesc = `Congratulations! Your Facial verification successfully approved`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)
                        
                        var mailcontent = `
                        <p style="line-height: 20px; letter-spacing: 0.025em;">Hello ${lastName} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            Congratulations! Your Facial verification on ${process.env.SITENAME} has been verified and successfully approved.
                        </p>
                        
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
            
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);
                        await mailSender('', 'KYC Verification Update', 'olajideolatunji@hitchpay.ng', mailcontent);

                        //GIVE WELCOME BONUS
                        // await giveWelcomeBonus(user_id);
                        // await referralUplineDownlineBonus(user_id);

                        
                        // GET THE VERIFIATION MEDIA
                        await getVeriffMedia(sessionId, tknid, vervalue, validUntil, documentCountry, vertype);
                        console.log(`Verification Successfuly Completed.`);

                        // res.json({ status: true, message: 'Completed' });
                        // return true;

                    }else if(verificationStatus == 'resubmission_requested' || verificationStatus == 'declined'){
                        
                        const notedesc = `Oops! Your Facial verification has been declined and requires resubmission`
                        await pushNotify(user_id, 'KYC Verification - HitchPay', notedesc);
            
                        await notifyMe(user_id, 'KYC Verification', 'user', notedesc)

                        var mailcontent = `
                        <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your Facial verification on ${process.env.SITENAME} has been declined and require resubmission</p>
                        ${reason }
                        <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify and resubmit the verification</p>
                        
            
                        <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                        `;
                        //send email                
                        await mailSender('', 'KYC Verification Update', widget_email, mailcontent);
                        await mailSender('', 'KYC Verification Update', 'olajideolatunji@hitchpay.ng', mailcontent);

                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });

                    }else{
                        // Unverified
                        await Customer.update({ bvverify: 0}, { where: { id: user_id } });
                    }
                        
                } catch (err) {
                    console.error('Unable to process your request  veriff hook: ', err.message);
                    // return res.status(400).json({ status: false, message: 'Unable to process your request' });
                }

            }else{
                console.log('Invalid customer ID')
                // res.json({ status: false, message: 'Invalid customer ID' });
            }  
            
        }else{
            console.log('Invalid verification status verrif');
        }

   }catch (error) {
        // res.json({ status: false, message: 'Something went wrong! Unable to process request' });
        logger.error("ver hook ERROE: ", error);
    }
}

module.exports = {
    initVeriff,
    verVeriffHook,
    verVeriffHookProd,
    verVeriffHookTestSimulate
}