const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const { Op } = require("sequelize");
const md5 = require('md5');
const https = require('https');
const randomstring = require("randomstring");
const axios = require('axios');
const { getUserInfo, logAudit, logBeneficiary, getBal } = require("../config/userdetails");
const { mailSender } = require("../config/mailsender");
const { notifyMe, sendSMS, pushNotify } = require("../config/notifyuser");
const { formatAmount, ucFirst, cleanMe, shAcessToken, getFee } = require("../config/myfunct");
const { stringify } = require('querystring');
const express = require('express');
const moment = require('moment');
const redis = require('redis');
const { client } = require('../config/redisClient');

//create main Model
const Customer = db.customers;
const Payn = db.payn;
const OfflinePay = db.offlinepay;
const Product = db.products;
const Admin = db.admin;
const Wallets = db.wallets;
const Benefit = db.benefit;
const Bank = db.bankacct;
const Notify = db.notify;


const getBillers = async(req, res)=>{
    const service = [
        {
            "id": 1,
            "serviceName": "Airtime",
            "serviceSlug": "AIRTIME"
        },
        {
            "id": 2,
            "serviceName": "Data",
            "serviceSlug": "DATA"
        },
        {
            "id": 3,
            "serviceName": "ELECTRIC DISCO",
            "serviceSlug": "ELECTRIC_DISCO"
        },
        {
            "id": 4,
            "serviceName": "PAY TV",
            "serviceSlug": "PAY_TV"
        },
        {
            "id": 5,
            "serviceName": "Betting and Lottery",
            "serviceSlug": "BETTING_AND_LOTTERY"
        },
        {
            "id": 6,
            "serviceName": "Education",
            "serviceSlug": "EDUCATION"
        },
    ]

    res.json({
        status: true,
        message: 'Biller service retrieved',
        data: service
    })
}


const packagePlans = async (req, res) => {

    try {
        let { provider, serviceslug } = cleanMe(req.query)

        if (!serviceslug || (serviceslug == '')) return res.status(400).json({ status: false, message: 'No servive selected' });
        if (!provider || (provider == '')) return res.status(400).json({ status: false, message: 'No provider selected' });

        var theProduct = serviceslug.toLowerCase();

        var billername = '';
        if(theProduct == 'pay_tv'){
            var prd = 'cable tv';
            var ntwk = 'Cable TV';
        }else if(theProduct == 'betting_and_lottery'){
            var prd = 'betting';
            var ntwk = 'Betting';
        }else if(theProduct == 'electric_disco'){
            var prd = 'electricity';
            var ntwk = 'Electricity';
        }else if(theProduct == 'education'){
            var prd = 'education';
            var ntwk = 'Education';
        }else if(theProduct == 'data'){
            var prd = 'databundle';
            var ntwk = provider;
            var exp = provider.split('_')
            billername = exp[0];
        }else if(theProduct == 'airtime'){
            var prd = 'airtime';
            var ntwk = provider;
            var exp = provider.split('_')
            billername = exp[0];
        }else{
            var prd = '';
            var ntwk = '';
        }

        const getdprod = await Product.findAll({
            where: { status: 1, category: prd, ntwk: ntwk },
            order: [['amount', 'ASC']],
        }).catch((err) => {
            console.log("Error Occurred: " + err);
        });

        // console.log(getdprod)

        if (!getdprod || getdprod.length < 1)
            return res.status(400).json({ status: false, message: 'No product found' });

        if(prd == 'databundle' || prd == 'airtime'){
            const prodList = getdprod.map((item) => ({
                pckgId: item.id,
                product: item.category,
                productSlug: serviceslug,
                productName: item.dataplan,
                // productName: item.prdname == '' ? '-' : item.prdname,
                productcode: item.prdcode == null ? '-' : item.prdcode,
                amount: item.feetype == 'discount' ? 0 : `₦${formatAmount(item.amount, 2)}`,
                price: item.feetype == 'discount' ? 0 : item.amount,
                fee: 0,
                discount: prd == 'airtime' ? item.amount : 0,
                feetype: item.feetype == 'discount' ? 'percentage' : item.feetype,
                discountType: item.feetype == 'discount' ? 'percentage' : item.feetype,
                billerId: item.ntwk == '' ? '-' : item.ntwk,
                network: billername,
                validateCustomer: false,
                priceId: item.id,
            }));
            res.json({
                status: true,
                message: 'Package Plans Retrieved',
                data: prodList
            });
        }else{
            let config = {
                method: 'get',
                url: `${process.env.CORAL_URL}/packages/biller/slug/${provider}`,
                headers: {
                    'Authorization': `Basic ${process.env.CORAL_AUTH}`
                },
            };
    
            let response = await axios.request(config);
            let thedata = response.data
            const ourprice = getdprod[0]['amount']

            // console.log(response)

            if (thedata.responseCode == '00' && thedata.status == 'success') {
                const dataInfo = await Promise.all(thedata.responseData.map(async (info) => {
                    // console.log(getdprod[0]['id'])
                    var priceId = getdprod.id;
                    var pckgId = info.id;
                    var productcode = info.id;
                    var amount = prd == 'betting' ? 0 : `₦${formatAmount(info.amount, 2)}`;
                    var product = prd;
                    var productName = info.name;
                    var productSlug = info.slug;
                    var price = prd == 'betting' ? 0 : info.amount;
                    var feetype = 'fixed';
                    var priceId = getdprod[0]['id'];
                    var fee = parseFloat(ourprice);
                    var discount =  0;
                    var billerId = info.billerId;
                    var hasPending = info.hasPending;
                    var sequenceNumber = info.sequenceNumber;
                    var validateCustomer =  true;
                    var network =  provider;
                    var discountType = '';

                    return { pckgId, product, productSlug, productName,productcode, amount, price, fee, discount, feetype, discountType, billerId, network, validateCustomer, priceId};
                }));
    
                res.json({
                    status: true,
                    message: 'Package Plans Retrieve',
                    data: (prd == 'cable tv') ? dataInfo.filter((item)=>item.price > 0) : dataInfo
                    // data: dataInfo.filter((item)=>item.price > 0)
                });
    
            } else {
                res.json({
                    status: false,
                    message: 'Unable to retrieve package plans',
                });
            } 
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        console.log("Package Plans plan Error: ", error.message);
    }
}


const custInfo = async (req, res) => {
    try {
        const { authtoken } = cleanMe(req.body);
        
        jwt.verify(authtoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Authorization Token' : 'Token expired';
                return res.status(400).json({ status: false, message: message });
            }

            const tokenid = resulted.id;

            if (!tokenid)
                return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
    
            const getuser = await Customer.findOne({ where: { id: tokenid } }).catch((err) => { console.log("Unable to process your request : " + err); });
    
            if (!getuser)
                return res.status(400).json({ status: false, message: 'Details not found' });
    
        
            /*================ check if he has wallet ==========================*/
            const getbal = await Wallets.findOne({ where: { uid: tokenid, currency: 'NGN' } })
            
            if (!getbal || getbal.length == 0) {
                /* CREATE WALLET FOR HIM IN NGN */
                let dtimed = Date.parse(new Date()) / 1000;
                await Wallets.create({ uid: tokenid, email: getuser.email, currency: 'NGN', wbal: 0, timecreated: dtimed, lastupdated: dtimed, status: 1 }).catch((err) => {
                    console.log('Unable to process your request : ' + err);
                });
            }

            const getacct = await Bank.findOne({order: [['id', 'DESC']], where: {userid: tokenid}});
            
            res.json({
                status: true,
                message: 'User Details retrieved',
                data: {
                    userid: getuser.id,
                    name: getuser.firstname + ' ' + getuser.lastname,
                    fname: getuser.firstname,
                    lname: getuser.lastname,
                    walletbal: getbal.wbal,
                    customer_email: getuser.email,
                    customer_phone: getuser.phoneno,
                    hasaccount: getacct == null ? false : true,
                    acountmsg: getacct == null ? 'You currently do not have a dedicated account numnber. Kindly log in to your HitchPay app and complete your KYC' : 'Copy your account number, transfer to it and get funded instantly',
                    accountdetails:{
                        bank_name: getacct?.bankname,
                        account_number: getacct?.accountno,
                        account_name: getacct?.accountname,
                        bank_code: getacct?.bankcode,
                        account_type: getacct?.accounttype,
                    }        
                }
    
            });
        })



    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("whatsapp user info Error: ", error.message);
    }
}

const verifyCustId = async (req, res) => {
    try {
        let { vendtype, customerId, billerslug, priceid } = req.body

        if(!customerId || customerId == '') return res.status(400).json({ status: false, message: "Customer id number must be specified"})
        if(!vendtype || vendtype == '') return res.status(400).json({ status: false, message: "Package/vend type must be specified"})
        if(!billerslug || billerslug == '') return res.status(400).json({ status: false, message: "Biller slug must be specified"})
        if(!priceid || priceid == '') return res.status(400).json({ status: false, message: "Product Price Id must be specified"})

        const getdprod = await Product.findOne({where: { id: priceid}}).catch((err) => {console.log("Error Occurred: " + err);});

        if (!getdprod)
            return res.status(400).json({ status: false, message: 'Product not available' });

        // console.log('getdprod', getdprod)
        
        let config = {
            method: 'POST',
            url: `${process.env.CORAL_URL}/transactions/customer-lookup`,
            headers: {
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
            data: {
                customerId: customerId,
                billerSlug: billerslug,
                productName: vendtype
            }
        };
        let response = await axios.request(config);
        let thedata = response.data;
    
        if (thedata.responseCode == '00' && thedata.status == 'success') {
            var info = thedata.responseData;
            var billerName = info.billerName;
            var minVend = info.minPayableAmount;
            var firstName = info['customer']['firstName'];
            var lastName = info['customer']['lastName'];
            var userName = info['customer']['userName'];
            var customerName = info['customer']['customerName'];
            var accountNumber = info['customer']['accountNumber'];
            var dueDate = info['customer']['dueDate'];
            var canVend = info['customer']['canVend'];
            var customerType = info['customer']['customerType'];
            var address = info['customer']['address'];
            var arrearsBalance = info['customer']['arrearsBalance'];
            var phoneNumber = info['customer']['phoneNumber'];
            var emailAddress = info['customer']['emailAddress'];



            res.json({
                status: true,
                message: 'Customer ID Verified',
                data: {
                    minVend, billerName,
                    customerName: customerName ? customerName : `${firstName} ${lastName}`, canVend, accountNumber, 
                    address: address ? address : '', arrearsBalance, customerType, phoneNumber, emailAddress,
                    amount: getdprod.amount, feetype: getdprod.feetype,
                }
            });
        } else {
            res.status(400).json({ 
                status: false,
                message: 'Unable to verify Account ID',
            });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        console.log("vald cust Error: ", error.message);
    }

}

module.exports = {
    getBillers, packagePlans, custInfo, verifyCustId
};