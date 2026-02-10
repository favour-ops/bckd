const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
// const { Op } = require("sequelize");
const { Op, fn, col } = require("sequelize");
const md5 = require('md5');
const https = require('https');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const randomstring = require("randomstring");
const axios = require('axios');
const axiosApiClient = require('../config/axiosInstance');
const { getUserInfo, logAudit, logBeneficiary, getBal } = require("../config/userdetails");
const { mailSender } = require("../config/mailsender");
const { cloudinary, firebaseUpload, AWSFileUpload } = require("../config/imageuploads");
const { notifyMe, sendSMS, pushNotify } = require("../config/notifyuser");
const { formatAmount, ucFirst, cleanMe, updateBalance, createMPLDCustomer, getFX } = require("../config/myfunct");
const { stringify } = require('querystring');
const express = require('express');
const moment = require('moment');
const { client } = require('../config/redisClient');
const { logger } = require('../config/logger');

//create main Model
const Customer = db.customers;
const Payn = db.payn;
const OfflinePay = db.offlinepay;
const Product = db.products;
const Admin = db.admin;
const KycDoc = db.kycdoc;
const KYC = db.kyc;
const LogRequest = db.logrequest;
const AppSett = db.appsettings;
const CardUser = db.kadusers
const VCard = db.vkads;
const CardTrans = db.cardtrans;
const AcctRequest = db.accountrequest;
const Bank = db.bankacct;
const Benefit = db.benefit;


function cleanPhoneNumber(phone) {
    // Remove all non-digit characters first (optional, in case user types spaces or dashes)
    phone = phone.replace(/\D/g, "");

    // Remove leading 0 if it exists
    return phone.replace(/^0+/, "");
}


const createVKadAccount = async (req, res) => {
    try {
        const { address, city, state, postalcode } = req.body

        const userid = req.user.id;

        if (!userid) 
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        /* CHECK FOR EXISTENCE */
        const getUser = await Customer.findOne({ where: { id: userid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin', data: { errortype: "" } });

        // const getkyc = await KYC.findOne({
        //     where: { userid: userid, status: 1, vertype: 'BVN' }, order: [['id', 'DESC']],
        // });

        if(getUser.countrycode == 'NG'){
            // var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, vertype: 'BVN'}, order: [['id', 'DESC']]});
            var getkyc = await KYC.findOne({where: { userid: userid, status: 1, [Op.or]: [{ vertype: 'BVN' }, { vertype: 'NIN' }, { provider: 'veriff' }] }, order: [['id', 'DESC']]})

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your BVN verification to proceed', data: { errortype: "verificaton" } });

        }else{
            // var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, vertype: 'PASSPORT_ID'}, order: [['id', 'DESC']]});

            var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, provider: 'veriff'}, order: [['id', 'DESC']]});

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your tier 2 verification to proceed', data: { errortype: "verificaton" } });
        }


        // const userbvn = getkyc.bvv;
        // const vertype = getkyc.vertype;
        const verfname = getkyc.verfname;
        const verlname = getkyc.verlname;
        const verphone = getkyc.verphone;
        const verdob = getkyc.verdob;

        const momentDate = moment(verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');

        const userinfo = await getUserInfo(userid);  // get user info
        const fname = userinfo.firstname;
        const userphone = userinfo.phoneno;
        const sendername = userinfo.lastname + ' ' + userinfo.firstname;
        const useremail = userinfo.email;
        const useradr = userinfo.address ? userinfo.address : address;
        const usercity = userinfo.city ? userinfo.city : city;
        const userstate = userinfo.state ? userinfo.state : state;
        const userphoneno = !verphone ? cleanPhoneNumber(userinfo.phoneno) : cleanPhoneNumber(verphone);
        const dialcode = !userinfo.dialcode ? '+234' : userinfo.dialcode;
        
        if (useradr == '' || usercity == '' || userstate == '')
            return res.status(400).json({ status: false, message: 'Kindly update your address, city and state before proceeding', data: { errortype: "profile" } });

        let getkycdoc;
        if(getUser.countrycode != 'NG'){
            // In CASE i want to get  for customer who used passport during the veriff kyc
            /* const getkycdoc = await KycDoc.findOne({where: {userid: userid, docstatus: { [Op.in]: [1, 2] }, [Op.or]: [{ docname: 'passport' }, { doctype: 'passport' }, { doctype: 'interpass' }]}}); */
            
            getkycdoc = await KycDoc.findOne({ where: { userid: userid, doctype: {[Op.in]: ['passport', 'interpass']}, docstatus: { [Op.in]: [1, 2] }} });
            if (!getkycdoc)
            return res.status(400).json({
                status: false,
                message: 'Kindly submit a valid Passport in order to proceed',
                data: {errortype: "extrakyc"}
            });

            var identityNumber = getkycdoc.docno; // for customers in diaspora
            var kycidno = getkycdoc.docno; // for customers in diaspora

        }else{

            getkycdoc = await KycDoc.findOne({ where: { userid: userid, tier: 2, doctype: 'idcard', docstatus: { [Op.in]: [1, 2] }} });
            if (!getkycdoc)
            return res.status(400).json({
                status: false,
                message: 'Kindly submit a valid Government ID Card in order to proceed',
                data: {errortype: "kyc"}
            });

            var identityNumber = getkyc.bvv; // for Nigerians
            var kycidno = getkycdoc.docno == '' ? getkyc.bvv : getkycdoc.docno
        }


        if ((getkycdoc.docname != '' && (getkycdoc.docname == 'NIN' && getkycdoc.docname == 'VOTERS_CARD'))) {
            var kycdocname = getkycdoc.docname.toUpperCase();
        }else if(getkycdoc.docname == 'International Passport' || getkycdoc.docname == 'passport'){
            var kycdocname = 'PASSPORT';
        }else if(getkycdoc.docname == 'Driver License' || getkycdoc.docname == 'drivers_license'){
            var kycdocname = 'DRIVERS_LICENSE';
        }else {
            var kycdocname = 'NIN';
        }

        const data = JSON.stringify({
            first_name: verfname,
            last_name: verlname,
            email: useremail,
            country: getUser.countrycode,
            dob: dateOfBirth,
            phone: { phone_country_code: dialcode, phone_number: userphoneno },
            address: {
                street: useradr,
                city: usercity,
                state: userstate,
                country: getUser.countrycode,
                postal_code: postalcode
            },
            identification_number: identityNumber,
            identity: {
                type: kycdocname,
                image: getkycdoc.docurl,
                number: kycidno,
                country: !getkycdoc.issuancecountry || getkycdoc.issuancecountry === '' ? getUser.countrycode : getkycdoc.issuancecountry
            },
            
            photo: getkycdoc.docurl,
        })

        // console.log('datadebug: ', data);

        await LogRequest.create({ reference: userid, jsonreq: data, timed: '', product: 'kaduser', provider: 'mpld' });

        let config = {
            method: 'post',
            url: `${process.env.MPLDURL}/customers/enroll`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
            data: data
        };

        let response = await axios.request(config);
        let thedata = response.data;
        if (thedata.status && thedata['data']['status'] == 'COMPLETED') {
            const respdata = thedata['data'];
            const trackiID = respdata['id'];
            const tier = respdata['tier'];

            /* update the record */
            let timed = Date.parse(new Date()) / 1000;
            await CardUser.create({ userid: userid, trackingid: trackiID, provider: 'MPLD', tier: tier, timed: timed, status: 1 });

            return res.json({
                status: true,
                message: 'US Profile Successfully Created',
                data: {
                    trackingid: trackiID
                }
            });

        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment', data: { errortype: "" } });
        }

    } catch (error) {
        console.log('error kad acct', error.message)

        if (error.response && error.response.data) {
            console.error('Server response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: 'Unable to process request', data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
        }
    }
}

const AdmincreateVKadAccount = async (req, res) => {
    try {
        const { address, city, state, postalcode, userid} = req.body


        if (!userid) 
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        /* CHECK FOR EXISTENCE */
        const getUser = await Customer.findOne({ where: { id: userid } }).catch((err) => { console.log("Unable to process your request : " + err); });

        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin', data: { errortype: "" } });

        // const getkyc = await KYC.findOne({
        //     where: { userid: userid, status: 1, vertype: 'BVN' }, order: [['id', 'DESC']],
        // });

        if(getUser.countrycode == 'NG'){
            //they are only using bvn, for other vertype they are returning could not validate bVN
            var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, vertype: 'BVN'}, order: [['id', 'DESC']]});
            // var getkyc = await KYC.findOne({where: { userid: userid, status: 1, [Op.or]: [{ vertype: 'BVN' }, { vertype: 'NIN' }, { provider: 'veriff' }] }, order: [['id', 'DESC']]})

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your BVN verification to proceed', data: { errortype: "verificaton" } });

        }else{
            // var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, vertype: 'PASSPORT_ID'}, order: [['id', 'DESC']]});

            var getkyc = await KYC.findOne({ where: {userid: userid, status: 1, provider: 'veriff'}, order: [['id', 'DESC']]});

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your tier 2 verification to proceed', data: { errortype: "verificaton" } });
        }



        // const userbvn = getkyc.bvv;
        // const vertype = getkyc.vertype;
        const verfname = getkyc.verfname;
        const verlname = getkyc.verlname;
        const verphone = getkyc.verphone;
        const verdob = getkyc.verdob;

        const momentDate = moment(verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');

        const userinfo = await getUserInfo(userid);  // get user info
        const fname = userinfo.firstname;
        const userphone = userinfo.phoneno;
        const sendername = userinfo.lastname + ' ' + userinfo.firstname;
        const useremail = userinfo.email;
        const useradr = userinfo.address ? userinfo.address : address;
        const usercity = userinfo.city ? userinfo.city : city;
        const userstate = userinfo.state ? userinfo.state : state;
        const userphoneno = !verphone ? cleanPhoneNumber(userinfo.phoneno) : cleanPhoneNumber(verphone);
        const dialcode = !userinfo.dialcode ? '+234' : userinfo.dialcode;
        
        if (useradr == '' || usercity == '' || userstate == '')
            return res.status(400).json({ status: false, message: 'Kindly update your address, city and state before proceeding', data: { errortype: "profile" } });

        let getkycdoc;
        if(getUser.countrycode != 'NG'){
            // In CASE i want to get  for customer who used passport during the veriff kyc
            /* const getkycdoc = await KycDoc.findOne({where: {userid: userid, docstatus: { [Op.in]: [1, 2] }, [Op.or]: [{ docname: 'passport' }, { doctype: 'passport' }, { doctype: 'interpass' }]}}); */
            
            getkycdoc = await KycDoc.findOne({ where: { userid: userid, doctype: {[Op.in]: ['passport', 'interpass']}, docstatus: { [Op.in]: [1, 2] }} });
            if (!getkycdoc)
            return res.status(400).json({
                status: false,
                message: 'Kindly submit a valid Passport in order to proceed',
                data: {errortype: "extrakyc"}
            });

            var identityNumber = getkycdoc.docno; // for customers in diaspora
            var kycidno = getkycdoc.docno; // for customers in diaspora

        }else{

            getkycdoc = await KycDoc.findOne({ where: { userid: userid, tier: 2, doctype: 'idcard', docstatus: { [Op.in]: [1, 2] }} });
            if (!getkycdoc)
            return res.status(400).json({
                status: false,
                message: 'Kindly submit a valid Government ID Card in order to proceed',
                data: {errortype: "kyc"}
            });

            var identityNumber = getkyc.bvv; // for Nigerians
            var kycidno = getkycdoc.docno == '' ? getkyc.bvv : getkycdoc.docno
        }


        if ((getkycdoc.docname != '' && (getkycdoc.docname == 'NIN' && getkycdoc.docname == 'VOTERS_CARD'))) {
            var kycdocname = getkycdoc.docname.toUpperCase();
        }else if(getkycdoc.docname == 'International Passport' || getkycdoc.docname == 'passport'){
            var kycdocname = 'PASSPORT';
        }else if(getkycdoc.docname == 'Driver License' || getkycdoc.docname == 'drivers_license'){
            var kycdocname = 'DRIVERS_LICENSE';
        }else {
            var kycdocname = 'NIN';
        }

        const data = JSON.stringify({
            first_name: verfname,
            last_name: verlname,
            email: useremail,
            country: getUser.countrycode,
            dob: dateOfBirth,
            phone: { phone_country_code: dialcode, phone_number: userphoneno },
            address: {
                street: useradr,
                city: usercity,
                state: userstate,
                country: getUser.countrycode,
                postal_code: postalcode
            },
            identification_number: identityNumber,
            identity: {
                type: kycdocname,
                image: getkycdoc.docurl,
                number: kycidno,
                country: !getkycdoc.issuancecountry || getkycdoc.issuancecountry === '' ? getUser.countrycode : getkycdoc.issuancecountry
            },
            
            photo: getkycdoc.docurl,
        })

        // console.log('datadebug: ', data);

        await LogRequest.create({ reference: userid, jsonreq: data, timed: '', product: 'kaduser', provider: 'mpld' });

        let config = {
            method: 'post',
            url: `${process.env.MPLDURL}/customers/enroll`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
            data: data
        };

        let response = await axios.request(config);
        let thedata = response.data;
        if (thedata.status && thedata['data']['status'] == 'COMPLETED') {
            const respdata = thedata['data'];
            const trackiID = respdata['id'];
            const tier = respdata['tier'];

            /* update the record */
            let timed = Date.parse(new Date()) / 1000;
            await CardUser.create({ userid: userid, trackingid: trackiID, provider: 'MPLD', tier: tier, timed: timed, status: 1 });

            return res.json({
                status: true,
                message: 'US Profile Successfully Created',
                data: {
                    trackingid: trackiID
                }
            });

        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment', data: { errortype: "" } });
        }

    } catch (error) {
        console.log('error kad acct', error.message)

        if (error.response && error.response.data) {
            console.error('Server response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: 'Unable to process request', data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
        }
    }
}


const createKiraCust = async (data) => {
    try {
    

        const data = JSON.stringify({
            first_name: verfname,
            last_name: verlname,
            email: useremail,
            country: getUser.countrycode,
            dob: dateOfBirth,
            phone: { phone_country_code: dialcode, phone_number: userphoneno },
            address: {
                street: useradr,
                city: usercity,
                state: userstate,
                country: getUser.countrycode,
                postal_code: postalcode
            },
            identification_number: identityNumber,
            identity: {
                type: kycdocname,
                image: getkycdoc.docurl,
                number: kycidno,
                country: !getkycdoc.issuancecountry || getkycdoc.issuancecountry === '' ? getUser.countrycode : getkycdoc.issuancecountry
            },
            
            photo: getkycdoc.docurl,
        })

        const payload = {
            "type": "individual",
            "email": data.useremail,
            "address_street": data.useradr,
            "address_city": data.usercity,
            "address_state": data.userstate,
            "address_country": data.countrycode,
            "phone": `${data.dialcode}${data.userphoneno}`,
            "status": "active",
            "address_zip_code": data.postalcode,
            "pep_status": false,
            "source_of_funds": "business_income",
            "account_purpose": "payments_to_friends_or_family_abroad",
            "expected_monthly_payments": "0_4999",
            "first_name": "Olajide",
            "last_name": "Olatunji",
            "birth_date": "1990-09-02",
            "nationality": "NGA",
            "employment_status": "employed",
            "occupation": "Software Engineer",
            "identifying_information": [
                {
                "type": "drivers_license",
                "documents": [
                    {
                    "type": "front",
                    "file": "BASE64 OR URL"
                    },
                    {
                    "type": "back",
                    "file": "BASE64 OR URL"
                    }
                ],
                "issuing_country": "NIG",
                "number": "2322322",
                "expiration": "2034-09-03"
                }
            ],
            }

        // console.log('datadebug: ', data);

        await LogRequest.create({ reference: userid, jsonreq: data, timed: '', product: 'kaduser', provider: 'mpld' });

        let config = {
            method: 'post',
            url: `${process.env.MPLDURL}/customers/enroll`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
            data: data
        };

        let response = await axios.request(config);
        let thedata = response.data;
        if (thedata.status && thedata['data']['status'] == 'COMPLETED') {
            const respdata = thedata['data'];
            const trackiID = respdata['id'];
            const tier = respdata['tier'];

            /* update the record */
            let timed = Date.parse(new Date()) / 1000;
            await CardUser.create({ userid: userid, trackingid: trackiID, provider: 'MPLD', tier: tier, timed: timed, status: 1 });

            return res.json({
                status: true,
                message: 'US Profile Successfully Created',
                data: {
                    trackingid: trackiID
                }
            });

        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment', data: { errortype: "" } });
        }

    } catch (error) {
        console.log('error kad acct', error.message)

        if (error.response && error.response.data) {
            console.error('Server response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: 'Unable to process request', data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
        }
    }
}



const cardAccountStatus = async (req, res) => {
    const tknid = req.user.id;
    if (!tknid) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

    const getcarduser = await CardUser.findOne({ where: { userid: tknid } });

    if (getcarduser) {
        res.json({
            status: true,
            message: 'Card account retrieved',
            data: {
                trackingid: getcarduser.trackingid
            }
        });
    } else {
        res.json({
            status: false,
            message: 'Card account retrieved',
            trackingid: '',
        });
    }

}

const getVCard = async (req, res) => {
    try {
        const { cardbrand, amount, currency, cardtag, cardcolor, transpin, sourcewallet } = req.body;

        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        /* CHECK FOR EXISTENCE */
        const getUser = await Customer.findOne({ where: { id: userid } });

        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });

        const authpin = getUser.authpin;
        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        if (!cardbrand || cardbrand == '')
            return res.status(400).json({ status: false, message: 'Kindly select your card brand' });

        if (!amount || amount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (amount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (amount <= 1)
            return res.status(400).json({ status: false, message: 'Minimum prefund amount required is $2.00' });

        if (!currency || currency == '')
            return res.status(400).json({ status: false, message: 'Kindly select your preferred card currency' });

        // if(currency.toLowerCase() != 'usd' && currency.toLowerCase() != 'ngn')
        if (currency.toLowerCase() != 'usd')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid currency' });

        if (cardbrand.toLowerCase() != 'mastercard' && cardbrand.toLowerCase() != 'visa' && cardbrand.toLowerCase() != 'verve')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid currency' });

        /* chec if he has virtual card accont */
        const checkKadUser = await CardUser.findOne({ where: { userid: userid, provider: 'MPLD' } });
        if (!checkKadUser)
            return res.status(400).json({ status: false, message: 'Kindly initiate card account in order to proceed' });

        var trackiID = checkKadUser.trackingid;
        if (trackiID != '') {
            //create the card
            const getsett = await AppSett.findOne({ where: { id: 1 } });

            if (!getsett)
                return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

            if (getsett.dollarfee <= 0)
                return res.status(400).json({ status: false, message: 'Unable to get processing fee. Kindly contact our support' });

            var fee = getsett.dollarfee;
            var getrate = await getFX('USD', 'NGN'); //echange rate
            var rate = getrate[1];
            var quoteid = getrate[2];

            if (rate <= 0)
                return res.status(400).json({ status: false, message: 'Unable to get exchange rate. Kindly contact our support' });


            if (sourcewallet == 'USD') {
                var sourceCurrency = 'USD';
                var ourfee = parseFloat(fee); //e.g $2
                var topay = parseFloat(amount) + parseFloat(ourfee); //e.g 10 + 2 = $12
            } else {
                var sourceCurrency = 'NGN';
                var ourfee = parseFloat(fee) * parseFloat(rate);  //convert to NGN $2 * 1500
                var topay = (parseFloat(amount) * parseFloat(rate)) + parseFloat(ourfee); // e.g (10 * 1500) + N3000 = N18000
            }


            if (topay <= 0)
                return res.status(400).json({ status: false, message: 'Invalid charged amount detected, kindly reload and retry' });


            const userbal = await getBal(userid, sourceCurrency);
            const phoneno = parseFloat(getUser.phoneno);

            const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
            let timed = Date.parse(new Date()) / 1000;


            if (parseFloat(userbal) > 0 && parseFloat(userbal) >= topay) {
                // --- Phase 1: Debit User and Log Initial Transaction ---
                let initialPayLog;
                const debitTransaction = await db.sequelize.transaction();

                try {

                    //===========CHARGE THE CUSTOMER AND LOG TRANSACTION===//
                    const newbal = await updateBalance(userid, topay, sourceCurrency, 'debit', { transaction: debitTransaction });
                    const pay_desc = `Virtual card issuance with a prefund of $${formatAmount(amount)}`;

                    initialPayLog = await Payn.create({
                        userid: userid, amount: topay, amountval: topay, newbal: newbal, prevbal: userbal, currency: sourceCurrency,
                        txref: txref, pfor: 'cardissuance', usertype: 'user', paytype: 'debit', productid: rate, ntwk: cardbrand,
                        paidthru: 'Wallet', pay_desc: pay_desc, timed: timed, status: 1, recipient: phoneno, fee: ourfee
                    }, { transaction: debitTransaction });

                    await debitTransaction.commit();
                } catch (debitError) {
                    // rollback the transaction.
                    await debitTransaction.rollback();
                    console.error(`failed for ${txref}:`, debitError.message);
                    return res.status(400).json({ status: false, message: 'Failed to debit account. Please try again.' });
                }


                // --- Phase 2: External API Call ---
                const data = JSON.stringify({
                    customer_id: trackiID, currency: currency, type: 'VIRTUAL', auto_approve: true, brand: cardbrand.toUpperCase(),
                    amount: parseFloat(amount * 100)  //in cent
                });

                await LogRequest.create({ reference: userid, jsonreq: data, timed: '', product: 'createkad', provider: 'mpld' });

                let config = {
                    method: 'post',
                    url: `${process.env.MPLDURL}/issuing`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    },
                    data: data
                };

                try {
                    let response = await axios.request(config);
                    let thedata = response.data;
                    const jsonString = JSON.stringify(thedata);

                    if (thedata['status']) {
                        // --- Phase 3: Finalize Success ---
                        const finalizeTransaction = await db.sequelize.transaction();

                        try {
                            var custref = thedata['data']['reference'];
                            //calcl/report profit in NGN
                            let profit = 0;
                            if (sourcewallet == 'USD') {
                                profit = (parseFloat(topay) - parseFloat(amount)) * parseFloat(rate);  //($12 - $10) * 1500 = N3000
                            } else {
                                profit = parseFloat(topay) - (parseFloat(amount) * parseFloat(rate));  //18,000 - ($10 * 1500) = 3000
                            }

                            const revenue = parseFloat(profit);
                            const meta_data = JSON.stringify({ rate: parseFloat(rate), amount: amount, ourfee: ourfee, revenuengn: profit});

                            await Payn.update(
                                { status: 1, paidthru: 'wallet', paychannel: 'MPLD', jsonresp: '', meta: meta_data, revenue: revenue, settlement_route: 'dollar' },
                                { where: { txref: txref, userid: userid }, transaction: finalizeTransaction }
                            );

                            await VCard.create({
                                userid: userid, trackingid: trackiID, provider: 'MPLD', currency,
                                cardbrand: cardbrand, expirydate: '', expirymonth: '', cardno: '', cardcolor: cardcolor, cardtagname: cardtag,
                                cardid: '', custref: custref, cvv: '', timed: timed, status: 5, name: '', jsonresp: jsonString
                            }, { transaction: finalizeTransaction });

                            await finalizeTransaction.commit();

                            res.json({
                                status: true,
                                message: 'Your card is being processed',
                                data: {
                                    transref: txref,
                                    transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"),
                                    paystatus: 'Successful'
                                }
                            });

                        } catch (transError) {
                            // rollback the transaction.
                            await finalizeTransaction.rollback();
                            console.error(`failed for ${txref}:`, transError.message);
                            return res.status(400).json({ status: false, message: `Failed to process transaction. Please try again.` });
                        }

                    } else {
                        res.json({
                            status: false,
                            message: `Your balance is too low for this ${sourcewallet} ${formatAmount(topay)} transaction. Please top up to proceed`
                        })
                    }

                } catch (transError) {
                     if (transError.response && transError.response.data) {
                    console.error('Card issuance API call failed with server Error response data:', JSON.stringify(transError.response.data, null, 2));
                        
                    }else{
                        console.error(`Card issuance API failed for ${txref}:`, transError.message);
                        
                    }    

                    const refundTransaction = await db.sequelize.transaction();
                    try {

                        await Payn.update(
                            { status: 5, pay_desc: `Failed card issuance for $${amount}` }, { where: { id: initialPayLog.id }, transaction: refundTransaction }
                        );

                        // Credit the user's wallet back
                        await updateBalance(userid, topay, sourceCurrency, 'credit', { transaction: refundTransaction });

                        await refundTransaction.commit();

                        // Notify user of the failure and refund
                        pushNotify(userid, 'Card Creation Failed', `Your virtual card request failed, and ${sourceCurrency} ${formatAmount(topay)} has been refunded to your wallet.`);

                        return res.status(400).json({ status: false, message: 'Card creation failed with partner bank' });

                    } catch (refundError) {

                        await refundTransaction.rollback();
                        console.error(`[${txref}] CRITICAL: API failed AND refund failed. Manual intervention required.`, refundError.message);
                        // Notify admin of critical failure
                        return res.status(500).json({ status: false, message: 'An error occurred. Please contact support.' });

                    }
                }

            } else {
                return res.status(400).json({ status: false, message: 'Insufficient balance' });
            }
        } else {
            return res.status(400).json({ status: false, message: 'Kindly re-initiate card account creation in order to proceed' });
        }

    } catch (error) {
        res.json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("vcard issu Error: ", error.message);
    }
}

const getVCardNew = async (req, res, next) => {
    try {
        const { cardbrand, amount, currency, cardtag, cardcolor, transpin, sourcewallet, fileno, doctype, expirydate, issuance_country } = req.body;

        const userid = req.user.id;
        if (!userid) 
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const requiredFields = { cardbrand, amount, currency, cardtag, cardcolor, sourcewallet };
        for (const [field, value] of Object.entries(requiredFields)) {
            if (!value) return res.status(400).json({ status: false, message: `Kindly specify your ${field.replace('_', ' ')}.` });
        }

        if (parseFloat(amount) <= 1) return res.status(400).json({ status: false, message: 'Minimum prefund amount required is $2.00' });
        if (currency.toLowerCase() !== 'usd') return res.status(400).json({ status: false, message: 'Only USD cards are currently supported.' });
        if (!['mastercard', 'visa', 'verve'].includes(cardbrand.toLowerCase())) return res.status(400).json({ status: false, message: 'Invalid card brand specified.' });

        // --- File Handling ---
        const uploadfiles = req.files;
        // console.log('uploadfiles', uploadfiles)
        const passportFront = uploadfiles?.['passport']?.[0];
        const passportBack = uploadfiles?.['passportback']?.[0];

         const [
            getUser,
            getsett,
            checkKadUser,
            existingPassport,
            fxRateResult,
            frontUploadResult,
            backUploadResult
        ] = await Promise.all([
            Customer.findOne({ where: { id: userid } }),
            AppSett.findOne({ where: { id: 1 } }),
            CardUser.findOne({ where: { userid: userid, provider: 'MPLD' } }),
            !passportFront ? KycDoc.findOne({ where: { userid: userid, doctype: 'interpass', docstatus: { [Op.in]: [1, 2] } } }) : Promise.resolve(null),
            getFX('USD', 'NGN'),
            passportFront ? uploadKycDoc(passportFront, `kyc_intpsst_front_${userid}_${uuidv4()}`, userid) : Promise.resolve({ success: true }),
            passportBack ? uploadKycDoc(passportBack, `kyc_intpsst_back_${userid}_${uuidv4()}`, userid) : Promise.resolve({ success: true })
        ]);


         // --- Validate Results from Parallel Operations ---
        if (!getUser) return res.status(400).json({ status: false, message: 'Unable to locate your account, please re-login.' });
        if (!getsett) return res.status(400).json({ status: false, message: 'Service temporarily unavailable. Please try again later.' });
        if (getsett.dollarfee <= 0) return res.status(400).json({ status: false, message: 'Unable to get issuance fee. Please contact support.' });

        if (!bcrypt.compareSync(transpin, getUser.authpin)) {
            return res.status(400).json({ status: false, message: 'Invalid Transaction PIN.' });
        }

        // Validate passport (newly uploaded or existing)
        if (passportFront) {
            if (!passportBack) return res.status(400).json({ status: false, message: 'Passport back image is required when providing the front.' });

            if (!fileno || !doctype || !issuance_country) return res.status(400).json({ status: false, message: 'ID number, type, and issuance country are required for new passport uploads.' });

            if (!frontUploadResult.success || !backUploadResult.success) return res.status(400).json({ status: false, message: 'Failed to upload one or both ID documents. Please try again.' });

            let thedoctype;
            if(doctype == 'International Passport'){
                thedoctype = 'interpass';
            }else if(doctype == 'Driver License'){
                thedoctype = 'drivers_license';
            }else if(doctype == 'Passport'){
                thedoctype = 'interpass';
            }else{
                thedoctype = 'NIN';
            }

            var dtimed = Math.floor(Date.now() / 1000);

            const existingDoc = await KycDoc.findOne({
            where: { userid, doctype: thedoctype }
            });

            if (existingDoc) {
            await existingDoc.update({ docurl: frontUploadResult.url,
                docurl_back: backUploadResult.url, docno: fileno, expirydate, issuancecountry: issuance_country,
                docstatus: 1, tier: '', timed: dtimed
            });
            } else {
            await KycDoc.create({
                userid, doctype: thedoctype, docname: thedoctype, docurl: frontUploadResult.url, docurl_back: backUploadResult.url,
                docno: fileno, expirydate, issuancecountry: issuance_country, docstatus: 1, tier: '', timed: dtimed
            });
            }

        } else if (!existingPassport && getUser.countrycode != 'NG') {
            return res.status(400).json({ status: false, message: 'No valid international passport found on your account. Please upload one.' });
        }

        // Validate or use MPLD customer creation result
        let trackiID;
        if (checkKadUser) {
            trackiID = checkKadUser.trackingid;
        } else {
            const mplcResult = await createMPLDCustomer(userid);

            if (!mplcResult[0]) {
                return res.status(400).json({ status: false, message: mplcResult[1] || 'Failed to create required user USD profile.', data: mplcResult[2] });
            }

            trackiID = mplcResult[2].trackingid;
        }

        if (!trackiID) {
            return res.status(400).json({ status: false, message: 'Could not retrieve customer profile ID. Please try again.' });
        }

        // --- Fee Calculation ---
        const [fxSuccess, rate, quoteid] = fxRateResult;
        if (!fxSuccess || rate <= 0) return res.status(400).json({ status: false, message: 'Unable to get exchange rate. Please try again later.' });

        const fee = getsett.dollarfee;
        let topay, ourfee, sourceCurrency;

        if (sourcewallet === 'USD') {
            sourceCurrency = 'USD';
            ourfee = parseFloat(fee);
            topay = parseFloat(amount) + ourfee;
        } else {
            sourceCurrency = 'NGN';
            ourfee = parseFloat(fee) * rate;
            topay = (parseFloat(amount) * rate) + ourfee;
        }

        if (topay <= 0) 
            return res.status(400).json({ status: false, message: 'Invalid charged amount calculated. Please try again.' });

        // --- Balance Check and Final Operations ---
        const userbal = await getBal(userid, sourceCurrency);
        if (userbal < topay) {
            return res.status(400).json({ status: false, message: `Insufficient ${sourceCurrency} balance.` });
        }

        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        const timed = Math.floor(Date.now() / 1000);

        // --- Debit and API Call ---
        const debitTransaction = await db.sequelize.transaction();
        try {
            const newbal = await updateBalance(userid, topay, sourceCurrency, 'debit', { transaction: debitTransaction });
            const pay_desc = `Virtual card issuance with a prefund of $${formatAmount(amount)}`;
            await Payn.create({
                userid, amount: topay, amountval: topay, newbal, prevbal: userbal, currency: sourceCurrency,
                txref, pfor: 'cardissuance', usertype: 'user', paytype: 'debit', productid: rate, ntwk: cardbrand,
                paidthru: 'Wallet', pay_desc, timed, status: 1, recipient: getUser.phoneno, fee: ourfee
            }, { transaction: debitTransaction });
            await debitTransaction.commit();
        } catch (debitError) {
            await debitTransaction.rollback();
            logger.error(`Card Issuance Debit Error for ${txref}:`, debitError);
            return res.status(500).json({ status: false, message: 'Failed to debit account. Please try again.' });
        }

         // --- External API Call ---
        try {
            const data = JSON.stringify({
                customer_id: trackiID, currency, type: 'VIRTUAL', auto_approve: true, brand: cardbrand.toUpperCase(),
                amount: parseFloat(amount) * 100 // to cents
            });

            await LogRequest.create({ reference: userid, jsonreq: data, timed: '', product: 'createkad', provider: 'mpld' });

            const config = {
                method: 'post',
                url: `${process.env.MPLDURL}/issuing`,
                headers: { 'accept': 'application/json', 
                    'content-type': 'application/json', 
                    'Authorization': `Bearer ${process.env.MPLSKEY}` },
                data
            };

            const response = await axios.request(config);
            const thedata = response.data;

            if (!thedata.status) 
                throw new Error(thedata.message || 'Card issuance failed at provider.');

            // --- Finalize Success ---
            const finalizeTransaction = await db.sequelize.transaction();
            try {
                const custref = thedata.data.reference;
                const profit = (sourcewallet === 'USD') ? (topay - parseFloat(amount)) * rate : topay - (parseFloat(amount) * rate);
                const meta_data = JSON.stringify({ rate, amount, ourfee, revenuengn: profit });

                await Payn.update(
                    { status: 1, paidthru: 'wallet', paychannel: 'MPLD', jsonresp: JSON.stringify(thedata), meta: meta_data, revenue: profit, settlement_route: 'dollar' },
                    { where: { txref, userid }, transaction: finalizeTransaction }
                );

                await VCard.create({
                    userid, trackingid: trackiID, provider: 'MPLD', currency, cardbrand, cardcolor, cardtagname: cardtag,
                    custref, timed, status: 5, jsonresp: JSON.stringify(thedata)
                }, { transaction: finalizeTransaction });

                await finalizeTransaction.commit();

                res.json({
                    status: true,
                    message: 'Your card is being processed',
                    data: { transref: txref, transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"), paystatus: 'Successful' }
                });

            } catch (finalizationError) {
                await finalizeTransaction.rollback();
                logger.error(`[${txref}] CRITICAL: API succeeded but DB finalization failed. Manual intervention required.`, finalizationError);
                throw new Error('Transaction status is uncertain. Please contact support.');
            }

        } catch (apiError) {

            // --- Handle API Failure (Refund) ---
            logger.error(`Card Issuance API Error for ${txref}:`, apiError);
            const refundTransaction = await db.sequelize.transaction();
            try {

                await updateBalance(userid, topay, sourceCurrency, 'credit', { transaction: refundTransaction });

                await Payn.update({ status: 5, pay_desc: `Failed card issuance for $${amount}` }, { where: { txref }, transaction: refundTransaction });

                await refundTransaction.commit();

                pushNotify(userid, 'Card Creation Failed', `Your virtual card request failed, and ${sourceCurrency} ${formatAmount(topay)} has been refunded.`);

                return res.status(400).json({ status: false, message: 'Card creation failed with our partner. Your funds have been returned.' });

            } catch (refundError) {
                await refundTransaction.rollback();
                logger.error(`[${txref}] CRITICAL: API failed AND refund failed. Manual intervention required.`, refundError);
                
                return res.status(500).json({ status: false, message: 'A critical error occurred. Please contact support.' });
            }
        }


    } catch (error) {
        // res.json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("vcard issu Error: ", error.message);
        logger.error("getVCardNew Error (Outer): ", error);
        next(error);
    }
}


async function uploadKycDoc(file, publicId, userid) {
    try {
        const { fileTypeFromBuffer } = await import('file-type');
        const fileType = await fileTypeFromBuffer(file.buffer);
        const allowedMimeTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        if (!fileType || !allowedMimeTypes.includes(fileType.mime)) {
            throw new Error(`Invalid file type: ${fileType?.mime || 'unknown'}`);
        }

        if (fileType.mime === 'application/pdf') {
            const randomFileName = `${publicId}.pdf`;
            const [uploadSuccess, fileUrl] = await AWSFileUpload(file.buffer, randomFileName);
            if (!uploadSuccess) throw new Error('AWS S3 upload failed.');
            return { success: true, url: fileUrl };
        } else {
            const processedBuffer = await sharp(file.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            const result = await new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream({ public_id: publicId, resource_type: "image" }, (error, result) => {
                    if (error) return reject(error);
                    resolve(result);
                });
                uploadStream.end(processedBuffer);
            });
            console.log('uploaderesult', result)
            return { success: true, url: result.secure_url };
        }



    } catch (error) {
        console.error(`KYC Doc upload failed for ${publicId}:`, error.message);
        logger.error(`KYC Doc upload failed for ${publicId}:`, error);
        return { success: false, url: null };
    }
}

const getMyCards = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const gethist = await VCard.findAll({
            order: [['id', 'DESC']], where: { userid: userid, status: { [Op.notIn]: [5, 0] } }
        });

        if (!gethist)
            return res.status(400).json({ status: false, message: 'No card for you' });

        const datalist = await Promise.all(gethist.map(async (arrayItem) => {
            const trackingid = arrayItem.trackingid;
            const provider = arrayItem.provider;
            const cardbrand = arrayItem.cardbrand;
            const pan = arrayItem.cardno;
            const expirydate = arrayItem.expirydate;
            const expirymonth = arrayItem.expirymonth;
            const cardid = arrayItem.cardid;
            const currency = arrayItem.currency;
            const cvv = arrayItem.cvv;
            const cardstatus = arrayItem.status;
            const cardname = arrayItem.cardname;
            const cardtagname = arrayItem.cardtagname;
            const cardcolor = arrayItem.cardcolor;

            return { trackingid, cardbrand, cardid, pan, expirydate, currency, cvv, cardstatus, cardname, cardcolor, cardtagname };

        }));

        res.json({
            status: true,
            message: 'Card retrieved',
            data: datalist
        });

    } catch (error) {
        console.log('my-card catch ERROR: ' + error.message)
    }
}

const fundVCard = async (req, res) => {
    try {
        const { cardid, amount, sourcewallet, transpin } = cleanMe(req.body);

        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const userinfo = await getUserInfo(userid);  // get user info
        const authpin = userinfo.authpin;
        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const getcard = await VCard.findOne({ where: { userid, cardid } });

        if (!getcard)
            return res.status(400).json({ status: false, message: 'Card not found' });

        if (!amount || amount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (amount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (getcard.currency.toLowerCase() == 'usd' && amount > 500)
            return res.status(400).json({ status: false, message: 'You cannot fund over $500 at a time' });

        const thecurrency = getcard.currency;

        const getsett = await AppSett.findOne({ where: { id: 1 } });
        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

        if (getsett.dollarfund <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get funding fee. Kindly contact our support' });


        const fee = getsett.dollarfund; // in dollars
        var getrate = await getFX('USD', 'NGN'); //echange rate
        var rate = getrate[1];
        var quoteid = getrate[2];

        if (rate <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get exchange rate. Kindly contact our support' });

        if (sourcewallet == 'USD') {
            var sourceCurrency = 'USD';
            var thepercent = (parseFloat(fee) / 100) * parseFloat(amount); //e.g 2% * $10 = $0.2
            var ourfee = parseFloat(thepercent); // e.g $0.2
            var topay = parseFloat(amount) + parseFloat(ourfee); //e.g 10 + $0.2 = $10.2

        } else {
            var sourceCurrency = 'NGN';
            var thepercent = (parseFloat(fee) / 100) * parseFloat(amount); //e.g 2% * $10 = $0.2
            var ourfee = parseFloat(thepercent) * parseFloat(rate);  //convert to NGN $0.2 * 1500 = 300
            var topay = (parseFloat(amount) * parseFloat(rate)) + parseFloat(ourfee); //e.g ($10 * 1500) + 300 = N15300 

        }

        if (topay <= 0)
            return res.status(400).json({ status: false, message: 'Invalid charged amount detected, kindly reload and retry' });

        const phoneno = parseFloat(userinfo.phoneno);
        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        let timed = Date.parse(new Date()) / 1000;

        const userbal = await getBal(userid, sourceCurrency);

        if (userbal > 0 && userbal >= topay) {
            // --- Phase 1: Debit User and Log Initial Transaction ---
            const debitTransaction = await db.sequelize.transaction();
            let initialPayLog;

            try {
                const newbal = await updateBalance(userid, topay, sourceCurrency, 'debit', { transaction: debitTransaction });

                const pay_desc = `Dollar card funding of $${formatAmount(amount)}`;

                initialPayLog = await Payn.create({
                    userid: userid, amount: topay, amountval: topay, newbal: newbal, prevbal: userbal, currency: sourceCurrency,
                    txref: txref, pfor: 'cardfunding', usertype: 'user', paytype: 'debit', productid: rate, ntwk: getcard.cardbrand,
                    paidthru: 'Wallet', pay_desc: pay_desc, timed: timed, status: 0, recipient: phoneno, fee: ourfee // Status 0 for Pending
                }, { transaction: debitTransaction });

                await debitTransaction.commit();
            } catch (debitError) {
                await debitTransaction.rollback();
                console.error(`[${txref}] Card Funding Debit Error:`, debitError.message);
                return res.status(500).json({ status: false, message: 'Failed to debit account for funding. Please try again.' });
            }

            // --- Phase 2: External API Call & Finalization ---
            try {
                const tofund = parseFloat(amount) * 100;
                const config = {
                    method: 'post',
                    url: `${process.env.MPLDURL}/issuing/${cardid}/fund`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    },
                    data: { amount: tofund }
                };

                const response = await axios.request(config);
                const thedata = response.data;
                const jsonString2 = JSON.stringify(thedata);

                if (thedata.status) {
                    // --- Phase 3a: Finalize Success ---
                    const finalizeTransaction = await db.sequelize.transaction();
                    try {
                        const provref = thedata['data']['id'];
                        let profit = 0;
                        if (sourcewallet == 'USD') {
                            profit = (parseFloat(topay) - parseFloat(amount)) * parseFloat(rate);
                        } else {
                            profit = parseFloat(topay) - (parseFloat(amount) * parseFloat(rate));
                        }
                        const revenue = parseFloat(profit);
                        const meta_data = JSON.stringify({ rate: parseFloat(rate), amount: amount, ourfee: ourfee, revenuengn: profit });

                        await Payn.update({
                            status: 1, paidthru: 'wallet', paychannel: 'MPLD', productid: provref,
                            jsonresp: jsonString2, meta: meta_data, revenue: revenue, settlement_route: 'dollar'
                        }, { where: { id: initialPayLog.id }, transaction: finalizeTransaction });

                        await finalizeTransaction.commit();

                        return res.json({
                            status: true,
                            message: `Card funding of $${formatAmount(amount)} successfully processed`,
                            data: {
                                transref: txref,
                                transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"),
                                paystatus: 'Successful'
                            }
                        });
                    } catch (finalizationError) {
                        await finalizeTransaction.rollback();
                        console.error(`[${txref}] CRITICAL: API succeeded but DB finalization failed. Manual intervention required.`, finalizationError.message);
                        return res.status(500).json({ status: false, message: 'Transaction status is uncertain. Please contact support.' });
                    }
                } else {
                    throw new Error(thedata.message || 'Card funding provider returned a failure status.');
                }
            } catch (apiError) {
                // --- Phase 3b: Handle API Failure (Refund) ---
                console.error(`[${txref}] Card Funding API Error:`, apiError.message);
                const refundTransaction = await db.sequelize.transaction();
                try {
                    await updateBalance(userid, topay, sourceCurrency, 'credit', { transaction: refundTransaction });
                    await Payn.update({ status: 5, pay_desc: `Failed card funding for $${amount}` }, { where: { id: initialPayLog.id }, transaction: refundTransaction });
                    await refundTransaction.commit();
                    return res.status(400).json({ status: false, message: 'Card funding failed with our partner. Your funds have been returned.' });
                } catch (refundError) {
                    await refundTransaction.rollback();
                    console.error(`[${txref}] CRITICAL: API failed AND refund failed. Manual intervention required.`, refundError.message);
                    return res.status(500).json({ status: false, message: 'A critical error occurred. Please contact support.' });
                }
            }

        } else {
            return res.status(400).json({
                status: false,
                message: `Your balance is too low for this ${sourcewallet} ${formatAmount(topay)} transaction. Please top up to proceed`
            })
        }

    } catch (error) {
        res.status(500).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("vcard fund Error: ", error.message);
    }
}

const getCardDetails = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

        const userinfo = await getUserInfo(userid);  // get user info
        const authpin = userinfo.authpin;

        if (!authpin)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const { cardid, transpin } = cleanMe(req.body);

        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const gethist = await VCard.findOne({ where: { cardid, userid } });

        if (!gethist)
            return res.status(400).json({ status: false, message: 'Card details not found for you' });

        let data = JSON.stringify({
            "cardid": cardid
        });

        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/issuing/${cardid}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;
        const jsonString = JSON.stringify(thedata);

        if (thedata.status) {

            res.json({
                status: true,
                message: 'Card details retrieved',
                data: {
                    cardid: thedata.data.id,
                    name: thedata.data.name,
                    card_number: thedata.data.card_number,
                    masked_pan: thedata.data.masked_pan,
                    expiry: thedata.data.expiry,
                    cvv: thedata.data.cvv,
                    status: thedata.data.status,
                    type: thedata.data.type,
                    issuer: thedata.data.issuer,
                    currency: thedata.data.currency,
                    balance: thedata.data.balance > 0 ? (thedata.data.balance / 100) : 0,
                    balance_updated_at: thedata.data.balance_updated_at,
                    auto_approve: thedata.data.auto_approve,
                    address: thedata.data.address,
                    created_at: thedata.data.created_at,
                    updated_at: thedata.data.updated_at
                }
            });

        } else {
            return res.status(400).json({
                status: false,
                message: 'Card details could not retrieved',
                data: []
            });
        }

    } catch (error) {
        return res.status(400).json({
            status: false,
            message: 'Card details could not retrieved ' + error.message,
            data: []
        });
    }
}

const getCardTrans = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

        const { cardid } = cleanMe(req.params);

        const gethist = await VCard.findOne({ where: { cardid } });

        if (!gethist)
            return res.json({ status: false, message: 'Card not found' });

        const kadTrans = await CardTrans.findAll({ where: { cardid: cardid, userid: hisid }, order: [['amount', 'DESC']] });

        if (!kadTrans || kadTrans.length < 1)
            return res.status(400).json({ status: false, message: 'No transaction history found for this card' });

        const transList = kadTrans.map((item) => {
            let merchantInfo = '';
            if (item.merchant) {
                try {
                    const merchantObj = JSON.parse(item.merchant);
                    if (merchantObj.name.toLowerCase().includes('maplerad')) {
                        var merchantName = 'Card Merchant';
                    }else{
                        var merchantName = merchantObj.name;
                    }
        
                    merchantInfo = `${merchantName.trim()} (${merchantObj.city.trim()}, ${merchantObj.country.trim()}`

                } catch (error) {
                    merchantInfo = item.merchant.trim();
                    console.warn(`Could not parse merchant JSON for transaction ${error.message}`);
                }
            }

            if (item.merchantdesc.toLowerCase().includes('-')) {
                var merchantDecription = item.description;
            }else{
                var merchantDecription = item.merchantdesc;
            }

            return {
                amount: item.amount,
                transtype: item.transtype,
                transmode: item.mode,
                currency: item.currency,
                description: item.description,
                reference: item.reference,
                merchant: merchantInfo,
                merchantdesc: merchantDecription ?? '',
                transstatus: item.status,
                date: moment.unix(item.timed).format('Do MMM, YYYY'),
                paytime: moment.unix(item.timed).format('MMM Do, YYYY | h:m a'),
                transtimed: moment.unix(item.timed).format("Do MMM, YYYY hh:mm a")
            };
        });

        res.json({
            status: true,
            message: `Card transctions retrieved`,
            data: transList
        });

    } catch (error) {
        console.log("Error while fertch card trans", error.message);
        res.json({ status: false, message: 'Unable to fetch card transactions at the moment' });
    }
}

const UpdCardStatus = async (req, res) => {
    try {
        const userid = req.user.id;
        if (!userid) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

        const userinfo = await getUserInfo(userid);  // get user info
        const authpin = userinfo.authpin;

        if (!authpin)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const { cardid, updtype, transpin } = cleanMe(req.body);

        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });
        if (!cardid || (cardid == '')) return res.status(400).json({ status: false, message: 'Invalid Card ID' });
        if (!updtype || (updtype == '')) return res.status(400).json({ status: false, message: 'Invalid Update Type' });
        if (updtype != 'freeze' && updtype != 'unfreeze' && updtype != 'terminate')
            return res.status(400).json({ status: false, message: 'Invalid Update Type' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const gethist = await VCard.findOne({ where: { userid: userid, cardid: cardid } });

        if (!gethist)
            return res.json({ status: false, message: 'Card not found' });

        if (gethist.status == 0)
            return res.json({ status: false, message: 'Card already terminated' });

        if (gethist.status == 3 && updtype == 'terminate')
            return res.json({ status: false, message: 'Kindly activate the card first in order to terminate the card' });

        if (updtype == 'terminate') {
            var headerMethod = 'PUT';
        } else {
            var headerMethod = 'PATCH';
        }

        let config = {
            method: headerMethod,
            url: `${process.env.MPLDURL}/issuing/${cardid}/${updtype}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;

        if (thedata.status) {
            const updmode = updtype == 'freeze' ? '3' : updtype == 'terminate' ? '0' : '1';

            await VCard.update({ status: updmode }, { where: { userid: userid, cardid: cardid } });

            res.json({
                status: true,
                message: thedata.message,
            });

        } else {
            res.json({
                status: false, message: 'Unable to process card update',
            });
        }

    } catch (error) {
        console.log("frez card: Error", error.message);
        if (error.response && error.response.data) {
            console.error('frez card Error response data:', JSON.stringify(error.response.data, null, 2));
            return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
        } else {
            return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
        }
    }
}

const withdrawVCard = async (req, res) => {
    try {

        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const { cardid, amount, transpin } = cleanMe(req.body);

        const userinfo = await getUserInfo(userid);  // get user info
        const authpin = userinfo.authpin;

        if (!authpin)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Authentication PIN' });

        const getcard = await VCard.findOne({ where: { userid, cardid } });

        if (!getcard)
            return res.status(400).json({ status: false, message: 'Card not found' });

        if (!amount || amount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (amount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (amount < 5)
            return res.status(400).json({ status: false, message: 'You can not withdraw less than $5.00' });

        const thecurrency = getcard.currency;

        const getsett = await AppSett.findOne({ where: { id: 1 } });
        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

        if (getsett.dollarwithdraw <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get withdrawal fee. Kindly contact our support' });


        const fee = getsett.dollarwithdraw; // in dollars
        var getrate = await getFX('USD', 'NGN', amount, 'subtract'); //echange rate (Subtract margin for withdrawals)
        var rate = getrate[1];
        // var quoteid = getrate[2];

        if (rate <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get exchange rate. Kindly contact our support' });

        const thepercent = (parseFloat(fee) / 100) * parseFloat(amount);  // 2/100 * 10
        const ourfee = parseFloat(thepercent);

        if (thecurrency.toLowerCase() == 'usd') {
            var tocharge = parseFloat(ourfee); //e.g 0.2 + 10
        } else {
            var tocharge = 0;
        }

        if (tocharge <= 0)
            return res.status(400).json({ status: false, message: 'Invalid processing fee detected, kindly reload and retry' });

        const phoneno = parseFloat(userinfo.phoneno);
        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        let timed = Date.parse(new Date()) / 1000;
        var tocredit = (parseFloat(amount) - parseFloat(tocharge)) * parseFloat(rate);  //to NGN
        const towithdraw = parseFloat(amount) * 100;

        //call the provider to check the card balance first 
        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/issuing/${cardid}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;
        const jsonString = JSON.stringify(thedata);

        if (thedata.status) {
            var available_balance = thedata.data.balance > 0 ? (thedata.data.balance / 100) : 0;
        } else {
            var available_balance = 0;
        }

        if (available_balance >= amount) {

            // --- Phase 1: External API Call for withdrawal ---
            try {
                const config = {
                    method: 'post',
                    url: `${process.env.MPLDURL}/issuing/${cardid}/withdraw`,
                    headers: {
                        'accept': 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`,
                    },
                    data: { amount: towithdraw }
                };

                const response = await axios.request(config);
                const thedata = response.data;
                const jsonString2 = JSON.stringify(thedata);

                if (thedata.status) {
                    // --- Phase 2: Credit User Wallet ---
                    const creditTransaction = await db.sequelize.transaction();
                    try {
                        const provref = thedata['data']['id'];
                        const userbal = await getBal(userid, 'NGN', { transaction: creditTransaction });
                        const revenue = (tocharge * rate);
                        const newbal = await updateBalance(userid, tocredit, 'NGN', 'credit', { transaction: creditTransaction }, true);
            
                        const meta_data = JSON.stringify({ rate: rate, amount: amount, ourfee: tocharge, revenuengn: revenue});
                        const pay_desc = `Virtual card withdrawal of $${formatAmount(amount)}`;

                        await Payn.create({
                            userid: userid, amount: tocredit, amountval: tocredit, newbal: newbal, prevbal: userbal, currency: 'NGN', paychannel: 'MPLD', txref: txref, pfor: 'cardwithdraw', usertype: 'user', paytype: 'credit', productid: rate, ntwk: getcard.cardbrand, paidthru: 'Wallet', pay_desc: pay_desc, timed: timed, status: 1, recipient: phoneno, fee: revenue, revenue: revenue, jsonresp: jsonString2, meta: meta_data, settlement_route: 'dollar'
                        }, { transaction: creditTransaction });

                        await creditTransaction.commit();

                        return res.json({
                            status: true,
                            message: `Card withdrawal request of $${formatAmount(amount)} has been processed and credited to your NGN wallet`,
                            data: {
                                transref: txref,
                                transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"),
                                paystatus: 'Successful',
                                amount: amount
                            }
                        });
                    } catch (dbError) {
                        await creditTransaction.rollback();
                        console.error(`[${txref}] CRITICAL: Card withdrawal API succeeded but DB credit failed. Manual intervention required.`, dbError.message);
                        // Notify admin of critical failure
                        return res.status(500).json({ status: false, message: 'A critical error occurred. Please contact support.' });
                    }
                } else {
                    throw new Error(thedata.message || 'Card withdrawal provider returned a failure status.');
                }
            } catch (error) {
                if (error.response && error.response.data) {
                    console.error('cad withd Error response data:', JSON.stringify(error.response.data, null, 2));
                    return res.status(400).json({ status: false, message: error.response.data.message, data: { errortype: "" } });
                } else {
                    console.error(`[${txref}] Card Withdrawal API Error:`, error.message);
                    return res.status(400).json({ status: false, message: 'Card withdrawal process could not be completed at this time.', data: { errortype: "" } });
                }
            }

        } else {
            return res.json({ status: false, message: `You have insufficient balance of $${formatAmount(available_balance)} on your card to process $${formatAmount(amount)} withdrawal` });
        }

    } catch (error) {
        console.log("vcard fund Error: ", error.message);
        res.status(500).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}


const cardList = async (req, res) => {

    try {
        const adminid = req.user.id;
        if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

        const gethist = await VCard.findAll({ order: [['id', 'DESC']] });

        if (!gethist)
            return res.json({ status: false, message: 'No card found' });


        const datalist = await Promise.all(gethist.map(async (arrayItem) => {
            var userid = arrayItem.userid;
            var trackingid = arrayItem.trackingid;
            var provider = arrayItem.provider;
            var cardbrand = arrayItem.cardbrand;
            var cardpan = arrayItem.cardno;
            var expirydate = arrayItem.expirydate;
            var expirymonth = arrayItem.expirymonth;
            var cardid = arrayItem.cardid;
            var cvv = arrayItem.cvv;
            var currency = arrayItem.currency;
            var date = moment.unix(arrayItem.timed).format('Do MMM, YYYY hh:mm a');
            var cardstatus = arrayItem.status == '0' ? 'Inactive' : arrayItem.status == '1' ? 'Active' : '';

            const userinfo = await getUserInfo(userid);  // get user info
            const username = userinfo.lastname + ' ' + userinfo.firstname;

            return { username, trackingid, provider, cardbrand, cardpan, expirydate, expirymonth, cvv, cardid, currency, date, cardstatus };
        }));


        res.json({
            status: true,
            message: 'Card list retrieved',
            data: datalist
        });

    } catch (error) {
        console.log('user kads catch ERROR: ' + error.message)
    }
}

const mockTrans = async (cardid) => {
    let config = {
        method: 'POST',
        url: `${process.env.MPLDURL}/test/issuing/${cardid}/mock-transaction`,
        headers: {
            accept: 'application/json',
            'content-type': 'application/json',
            'Authorization': `Bearer ${process.env.MPLSKEY}`
        },
        data: { amount: 13000, type: 'DEBIT' }
    };

    let response = await axios.request(config);
    let thedata = response.data;
    const jsonString = JSON.stringify(thedata);
    console.log(jsonString)
    return jsonString;

}
/* mockTrans('dd576f7a-8a23-460a-9083-58c12555b7f5')
.then(() => {
    console.log("Script finished.");
    process.exit(0);
})
.catch(err => {
    console.error("Script failed with error:", err);
    process.exit(1);
}); */

const cardStats = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid) {
            return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
        }

        //count of all cards issued
        const allCards = await VCard.count();
        const activeCards = await VCard.count({ where: { status: 1 } });
        const inActiveCards = await VCard.count({ where: { status: 3 } });
        const terminatedCards = await VCard.count({ where: { status: 0 } });
        const NgnCards = await VCard.count({ where: { currency: 'NGN' } });
        const UsdCards = await VCard.count({ where: { currency: 'USD' } });
        const virtualCards = await VCard.count({ where: { cardtype: 'virtual' } });
        const physicalCards = await VCard.count({ where: { cardtype: 'physical' } });
        const cardTransCount = await CardTrans.count();
        // const cardTransVolume = await Payn.sum('amount', { where: { [Op.or]: [{ pfor: 'cardissuance' }, { pfor: 'cardfunding' }] } });
        const cardTransVolume = 0;
        

        var stats = { allCards, activeCards, inActiveCards, terminatedCards, NgnCards, UsdCards, virtualCards, physicalCards, cardTransVolume, cardTransCount }

        res.json({
            status: true,
            message: 'Card Stats retrieved',
            data: stats
        });

    } catch (error) {
        console.error('Error fetching top referrers:', error.message);
        res.status(500).json({ status: false, message: 'An error occurred while fetching top referrers.' });
    }
}

const cardTransactions = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid) {
            return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
        }

        const gethist = await CardTrans.findAll({
            order: [['id', 'DESC']],
            include: [{
                model: Customer,
                as: 'customer',
                attributes: ['firstname', 'lastname', 'email']
            }]
        });

        if (!gethist || gethist.length === 0) {
            return res.status(200).json({
                status: true, // It's not an error, just no data
                message: 'No transactions found matching your criteria.',
                data: [] // Send back an empty array
            });
        }

        const formattedTransactions = gethist.map(tx => ({
            id: tx.id,
            amount: tx.amount,
            transtype: tx.transtype,
            currency: tx.currency,
            description: tx.description,
            reference: tx.reference,
            card_id: tx.cardid,
            merchant: tx.merchant,
            modetype: tx.mode,
            merchantdetails: tx.merchantdesc,
            status: tx.status,
            date: moment.unix(tx.timed).format('Do MMM, YYYY hh:mm a'),
            customer: tx.customer ? `${tx.customer.firstname} ${tx.customer.lastname}`.trim() : 'N/A',
            customerEmail: tx.customer ? tx.customer.email : 'N/A'
        }));

        return res.json({
            status: true,
            message: 'Card transactions retrieved successfully.',
            data: formattedTransactions
        });

    } catch (error) {
        console.error('Error fetching card transactions:', error.message);
        res.status(500).json({ status: false, message: 'An error occurred while fetching card transactions.' });
    }
}

const fetchCardDetails = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid) {
            return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
        }
        const { cardid } = cleanMe(req.body);
        const gethist = await VCard.findOne({ where: { cardid } });

        if (!gethist)
            return res.status(400).json({ status: false, message: 'Card details not found for you' });

        let data = JSON.stringify({
            "cardid": cardid
        });

        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/issuing/${cardid}`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;
        const jsonString = JSON.stringify(thedata);

        if (thedata.status) {

            res.json({
                status: true,
                message: 'Card details retrieved',
                data: {
                    cardid: thedata.data.id,
                    name: thedata.data.name,
                    card_number: thedata.data.card_number,
                    masked_pan: thedata.data.masked_pan,
                    expiry: thedata.data.expiry,
                    cvv: thedata.data.cvv,
                    status: thedata.data.status,
                    type: thedata.data.type,
                    issuer: thedata.data.issuer,
                    currency: thedata.data.currency,
                    balance: thedata.data.balance > 0 ? (thedata.data.balance / 100) : 0,
                    balance_updated_at: thedata.data.balance_updated_at,
                    auto_approve: thedata.data.auto_approve,
                    address: thedata.data.address,
                    created_at: thedata.data.created_at,
                    updated_at: thedata.data.updated_at
                }
            });

        } else {
            return res.status(400).json({
                status: false,
                message: 'Card details could not retrieved',
                data: []
            });
        }

    } catch (error) {
        return res.status(400).json({
            status: false,
            message: 'adm Card details could not retrieved ' + error.message,
            data: []
        });
    }
}


const fetchCardTransApi = async (req, res) => {
    try {
        const hisid = req.user.id;
        if (!hisid) return res.json({ status: false, message: 'Eh! Invalid request sent!' });

        const { cardid } = cleanMe(req.params);

        const gethist = await VCard.findOne({ where: { cardid } });

        if (!gethist)
            return res.json({ status: false, message: 'Card not found' });

        let data = JSON.stringify({
            "vcardid": cardid,
        });

        let config = {
            method: 'GET',
            url: `${process.env.MPLDURL}/issuing/${cardid}/transactions`,
            headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'Authorization': `Bearer ${process.env.MPLSKEY}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;

        if (thedata.status && thedata.data.length > 0) {

            res.json({
                status: true,
                message: `Card transctions retried`,
                data: thedata.data
            });

        } else {
            res.json({
                status: false, message: 'Unable to fetch card transactions',
            });
        }

    } catch (error) {
        console.log("Error while fertch a card trans ", error.message);
        res.json({ status: false, message: 'Unable to process card update' });
    }
}


async function urlToDataUri(fileUrl) {
    // max file size in MB
    const MAX_FILE_SIZE_MB = 5;
    try {
        const response = await axios.get(fileUrl, {
            responseType: "arraybuffer",
        });

        const contentType = response.headers["content-type"];

        // check file size from buffer
        const fileSizeBytes = response.data.byteLength;
        const fileSizeMB = fileSizeBytes / (1024 * 1024);

        if (fileSizeMB > MAX_FILE_SIZE_MB) {
            throw new Error(
                `File too large: ${(fileSizeMB).toFixed(2)} MB (limit is ${MAX_FILE_SIZE_MB} MB)`
            );
        }

        // convert to base64
        const base64 = Buffer.from(response.data).toString("base64");

        return `data:${contentType};base64,${base64}`;
    } catch (error) {
        console.error("Error converting file:", error.message);
        return null;
    }
}

// Example usage
// (async () => {
//   const imgUrl = "https://res.cloudinary.com/hitchpay/image/upload/v1757166208/kyc_tier2_front_4_23b196c0-4325-45f6-a8da-ae7fc6612fd1.jpg";
//   const pdfUrl = "https://hitchpaykyc.s3.eu-west-1.amazonaws.com/stmt_4_ebe2650f-8ef4-4a4f-9838-53077ed11e7d.pdf";

//   const imgDataUri = await urlToDataUri(imgUrl);
//   if (imgDataUri) {
//     console.log("✅ Image Data URI:", imgDataUri.substring(0, 200) + "...");
//   }

//   const pdfDataUri = await urlToDataUri(pdfUrl);
//   if (pdfDataUri) {
//     console.log("✅ PDF Data URI:", pdfDataUri.substring(0, 200) + "...");
//   }
// })();


module.exports = {
    createVKadAccount, getVCard, getMyCards, fundVCard, cardList, getCardDetails,
    getCardTrans, UpdCardStatus, withdrawVCard, cardAccountStatus,
    cardStats, cardTransactions, fetchCardDetails, fetchCardTransApi,
    AdmincreateVKadAccount, getVCardNew
};