const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const { Op } = require("sequelize");
const md5 = require('md5');
const https = require('https');
const randomstring = require("randomstring");
const axios = require('axios');
const axiosApiClient = require('../config/axiosInstance');
const { getUserInfo, logAudit, logBeneficiary, getBal } = require("../config/userdetails");
const { mailSender } = require("../config/mailsender");
const { notifyMe, sendSMS, pushNotify } = require("../config/notifyuser");
const { formatAmount, ucFirst, cleanMe, shAcessToken, getFee, 
    TransLimit, FreeTransfersCount, getTransferFee, updateBalance, calculateProfitAndFee } = require("../config/myfunct");
const { stringify } = require('querystring');
const express = require('express');
const moment = require('moment');

//create main Model
const Customer = db.customers;
const Payn = db.payn;
const Product = db.products;
const Admin = db.admin;
const Wallets = db.wallets;
const Bank = db.bankacct;
const theTransLimit = db.translimit;
const PricingFee = db.pricing;
const AppSett = db.appsettings;


const dataBillers = async (req, res) => {
    res.json({
        status: true,
        message: 'Data Biller Retrieved',
        data: [
            {
                "title": "MTN",
                "value": "MTN_NIGERIA",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/mtn_a3znmu.png",
                "skipValidation": true,
            },
            {
                "title": "GLO",
                "value": "GLO_NIGERIA",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090142/glo_anhvcf.png",
                "skipValidation": true,
            },
            {
                "title": "AIRTEL",
                "value": "AIRTEL_NIGERIA",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/airtel_zvbylq.png",
                "skipValidation": true,
            },
            {
                "title": "9MOBILE",
                "value": "9MOBILE_NIGERIA",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/9mobile_dkxe6c.png",
                "skipValidation": true,
            },
            {
                "title": "SPECTRANET",
                "value": "SPECTRANET",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/spectranet_tu8q58.png",
                "skipValidation": true
            },
            {
                "title": "SMILE",
                "value": "SMILE",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/smile_oni5a6.png",
                "skipValidation": false
            },

            {
                "title": "IPNX",
                "value": "IPNX",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/ipnx_ymvz7q.png",
                "skipValidation": false
            },
            {
                "title": "VDT",
                "value": "VDT",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/vdt_fionpo.png",
                "skipValidation": false
            },
            {
                "title": "SWIFT NETWORK",
                "value": "SWIFT_NETWORKS",
                "icon": "https://res.cloudinary.com/hitchpay/image/upload/v1748090140/swift_jlmuvx.jpg",
                "skipValidation": false
            },
        ]
    });
}

const getBillersPackage = async (req, res) => {

    try {
        let { billertype, billerslug } = req.query

        var billerSlug = billerslug ? billerslug : billertype

        if (billerSlug == 'DATA' || billerSlug == 'AIRTIME') {
            var billerSlug = 'AIRTIME_AND_DATA';
        }else if (billerSlug.toUpperCase() == 'ELECTRICITY') {
            var billerSlug = 'ELECTRIC_DISCO';
        }else if (billerSlug.toUpperCase() == 'CABLE TV') {
            var billerSlug = 'PAY_TV';
        }else if (billerSlug.toUpperCase() == 'SPORTS' || billerSlug.toUpperCase() == 'BETTING') {
            var billerSlug = 'BETTING_AND_LOTTERY';
        }else if (billerSlug.toUpperCase() == 'TRANSPORT') {
            var billerSlug = 'TRANSPORT_AND_TOLL_PAYMENT';
        }else if (billerSlug.toUpperCase() == 'INTERNATIONAL AIRTIME') {
            var billerSlug = 'INTERNATIONAL_AIRTIME';
        }else if (billerSlug.toUpperCase() == 'EDUCATION') {
            var billerSlug = 'EDUCATION';
        } else {
            var billerSlug = billerSlug.toUpperCase();
        }

        // console.log('billerSlug', billerSlug)

        if (!billerSlug || billerSlug == '')
            return res.status(400).json({ status: false, message: 'No billertype or slug passed' })
        let config = {
            method: 'get',
            url: `${process.env.CORAL_URL}/billers/group/slug/${billerSlug}`,
            headers: {
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
        };

        const allowedBillers = ["MTN_NIGERIA", "AIRTEL_NIGERIA", "GLO_NIGERIA", "9MOBILE_NIGERIA"];
        let response = await axios.request(config);
        let thedata = response.data;

        // console.log(response)

        if (thedata.responseCode == '00' && thedata.status == 'success' && thedata.responseData.length > 0) {
            const dataInfo = await Promise.all(thedata.responseData.map(async (info) => {
                var billersId = info.id;
                var billersName = info.name;
                var billersSlug = info.slug;
                var groupId = info.groupId;
                var billerId = info.billerId;
                var skipValidation = info.skipValidation;
                var hideInstitution = info.hideInstitution;
                var isRestricted = info.isRestricted;
                var handleWithProductCode = info.handleWithProductCode;

                return { billersId, billersName, billersSlug, groupId, billerId, skipValidation, hideInstitution };
            }));

            res.json({
                status: true,
                message: 'Successfully fetched billers',
                data: billerSlug == 'AIRTIME_AND_DATA' ? dataInfo.filter(biller => allowedBillers.includes(biller.billersSlug)) : dataInfo
            });

        } else {
            res.status(400).json({
                status: false,
                message: thedata['message'],
            });
        }
    } catch (error) {
        if (error.code === 'ECONNABORTED') {
            // Axios timeout error
            res.status(504).json({ status: false, message: 'Request timed out. Please try again later.' });
        } else if (error.response) {
            // Server responded with a status code outside the 2xx range
            res.status(error.response.status).json({
                status: false,
                // message: `API error: ${error.response.statusText}`
                message: `Something went wrong, kindly check your internet and try again`
            });
        } else if (error.request) {
            // Request was made but no response was received
            res.status(503).json({ status: false, message: 'No response from upstream server' });
        } else {
            // Something else happened
            res.status(500).json({ status: false, message: 'An unexpected error occurred' });
        }
        console.log("Biller Package Error: ", error.message);
        // res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        // console.log("biller pcksg Error: ", error.message);
    }
}

function extractPlanDetails(packageName) {
    // Regex to find a number followed by GB, MB, or TB (case-insensitive)
    const match = packageName.match(/(\d+)\s*(GB|MB|TB)/i);
    if (match && match[1] && match[2]) {
        // match[1] is the number (e.g., "75")
        // match[2] is the unit (e.g., "GB")
        return `${match[1]}${match[2].toUpperCase()}`;
    }

    return packageName;
}

const dataPlans = async (req, res) => {
    let { network} = req.body

    if(network == 'MTN'){
        network = 'MTN_NIGERIA';
    }else if(network == 'GLO'){
        network = 'GLO_NIGERIA';
    }else if(network == 'AIRTEL'){
        network = 'AIRTEL_NIGERIA';
    }else if(network == '9MOBILE'){
        network = '9MOBILE_NIGERIA';
    }else{
        network = network;
    }

    if (!network || network == '')
        return res.status(400).json({ status: false, message: 'No network passed' })
    try {
        let config = {
            method: 'get',
            url: `${process.env.CORAL_URL}/packages/biller/slug/${network}`,
            headers: {
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
        };

        let response = await axios.request(config);
        let thedata = response.data;
        
        if (thedata.responseCode == '00' && thedata.status == 'success') {
            // console.log(thedata.responseData)

            const dataInfo = thedata.responseData.filter(info => info.amount && parseFloat(info.amount) > 0)
                .map(info => {
                    return {
                        amount: `₦${info.amount}`,
                        dataplans: extractPlanDetails(info.name), // e.g., "75GB"
                        productname: info.name,
                        feetype: 'fixed',
                        prdid: '',
                        network: network, // from req.query
                        otherfee: [],
                        ourprice: info.amount,
                        product: 'databundle',
                        productcode: info.id, // The package ID from the provider
                        billerid: info.billerId, // The biller ID from the provider
                        thestatus: 'approved'
                    };
            });
          
            res.json({
                status: true,
                message: 'Successfully fetched packages',
                data: dataInfo
            });

        } else {
            res.status(400).json({
                status: false,
                message: 'Unable to retrieve package',
            });
        }
        
    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        console.log("data plan Error: ", error.message);
    }
}


const billerPrices = async (req, res) => {
    let { network, amount, product, tierlevel, userid} = req.body

    // console.log('get fee', req.body)

    if (!network || network == '')
        return res.status(400).json({ status: false, message: 'No network passed' })

    if (!product || product == '')
        return res.status(400).json({ status: false, message: 'No product passed' })

    try {

        if(product.toLowerCase() == 'transfer'){
               const accountLimit = await TransLimit(tierlevel);
                const free_transfer_allowance = accountLimit[4];
                const freetransfer_used_count = await FreeTransfersCount(userid);
                
                var [feeAmount, prvFee, feemodel] = await getFee('transfer', amount, tierlevel);

                let thefeemodel = ''; let feeTopay = 0; let theAmount; let theDiscount;
                if (parseInt(freetransfer_used_count) < parseInt(free_transfer_allowance)) {
                    feeTopay = -feeAmount;
                    thefeemodel = 'discount';
                    theAmount = parseFloat(amount)
                    theDiscount = feeAmount
                } else {
                    feeTopay = feeAmount;
                    thefeemodel = feemodel;
                    theAmount = parseFloat(feeTopay) + parseFloat(amount)
                    theDiscount = 0
                }

             res.json({
                status: true,
                message: 'Fee retrieved',
                    data: {
                    totalcharge: theAmount,
                    fee: feeTopay, feetype: thefeemodel,
                    discount : theDiscount, feemodel: 'fixed'
                }
            });

        }else{
            var checkFee = await Product.findOne({ where: {
                [Op.and]: [{category: product}, {status: 1}, {[Op.or]: [{prdname: network}, { ntwk: { [Op.like]: `%${network}%` } }]}]
            } });
            
            if (!checkFee){
                return res.json({ 
                    status: false, 
                    message: 'Unable to retrieve fee',
                    data: {
                        totalcharge: 0, fee: 0,  feetype: '', discount : 0, feemodel: ''
                    }
                });
            }else{
                const { totalChargedToCustomer, ourFee } = calculateProfitAndFee(checkFee, parseFloat(amount));
                res.json({
                    status: true,
                    message: 'Fee retrieved',
                        data: {
                        totalcharge: totalChargedToCustomer,
                        fee: ourFee, feetype: checkFee.feetype,
                        discount : checkFee.amount, feemodel: checkFee.feemodel
                    }
                });
            }

        }



    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        console.log("bille fee Error: ", error.message);
    }
}

const cableTVPlans = async (req, res, next) => {

    try {
        let { provider } = cleanMe(req.query)
        let config = {
            method: 'get',
            url: `${process.env.CORAL_URL}/packages/biller/slug/${provider}`,
            headers: {
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
        };

        let response = await axiosApiClient.request(config);
        let thedata = response.data;

        // console.log(thedata)

        if (thedata.responseCode == '00' && thedata.status == 'success' && thedata.responseData.length > 0) {
            const dataInfo = await Promise.all(thedata.responseData.map(async (info) => {
                var pckgId = info.id;
                var productName = info.name;
                var productSlug = info.slug;
                var price = info.amount;
                var billerId = info.billerId;
                var hasPending = info.hasPending;
                var sequenceNumber = info.sequenceNumber;

                return { pckgId, productName, productSlug, price, billerId };
            }));

            res.json({
                status: true,
                message: 'TV Plans Retrieved',
                data: dataInfo
                // data: dataInfo.filter((item)=>item.price > 0)
            });

        } else {
            res.status(200).json({
                status: false,
                message: 'No packages found',
            });
        }

    } catch (error) {
        // res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        // console.log("cabletv plan Error: ", error.message);
        next(error);
    }
}

const verifyIUC = async (req, res) => {
    try {

        let { productname, iucno, billerslug } = req.body

        let data = JSON.stringify({
            "customerId": iucno,
            "billerSlug": billerslug,
            "productName": productname
        });

        let config = {
            method: 'POST',
            url: `${process.env.CORAL_URL}/transactions/customer-lookup`,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
            data: data
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
                message: 'IUC number Verified',
                data: {
                    minVend, billerName,
                    customerName: customerName ? customerName : `${firstName} ${lastName}`, canVend, accountNumber,
                    address: address ? address : '', arrearsBalance, customerType, phoneNumber, emailAddress
                }
            });
        } else {
            res.status(400).json({
                status: false,
                message: 'Unable to verify IUC',
            });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment' });
        console.log("ver iuc Error: ", error.message);
    }

}

const AddProducts = async (req, res) => {
    try {
        const { 
            network, prodcode, product, productname, amount, providerprice, dataplan, 
            provfeetype, provfeemodel, ourfeetype, ourfeemodel, provider_fee_cap, billerid
        } = cleanMe(req.body);

        // console.log('log', cleanMe(req.body))
        
        const adminid = req.user.id;
        if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        var theProduct = product.toLowerCase();

        if (!provfeetype || (provfeetype == '')) return res.status(400).json({ status: false, message: 'Kindly select provider fee type' });
        if (!provfeemodel || (provfeemodel == '')) return res.status(400).json({ status: false, message: 'Kindly select provider fee model' });
        if (!ourfeetype || (ourfeetype == '')) return res.status(400).json({ status: false, message: 'Kindly select our fee type' });
        if (!ourfeemodel || (ourfeemodel == '')) return res.status(400).json({ status: false, message: 'Kindly select our fee model' });
        if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter preferred product amount' });
        if ((!network || (network == '')) && (theProduct == 'databundle' || theProduct == 'airtime')) return res.status(400).json({ status: false, message: 'No Network/Provider Selected' });

        if (theProduct == 'airtime' || theProduct == 'databundle') {
            const checkPrd = await Product.findOne({ where: { [Op.and]: [{ category: product }, { ntwk: network }, {billerid}] } });

            if (checkPrd)
                return res.status(400).json({ status: false, message: 'Product already existed, kindly use the edit button instead' });
        } else {
            const checkPrd = await Product.findOne({ where: { category: product, prdname: productname, billerid } });

            if (checkPrd)
                return res.status(400).json({ status: false, message: 'Product already existed, kindly use the edit button instead' });
        }

        if (network == '' || network == null) {
            var dnetwork = product;
        } else {
            var dnetwork = network;
        }

        var feetype = ourfeemodel;
        const logprodct = Product.create({
            category: product, prdname: productname, prdcode: '', providerprice: providerprice,
            amount: amount, feetype: feetype, ntwk: dnetwork, status: 0, dataplan: dataplan, provfeetype: provfeetype,
            provfeemodel: provfeemodel, feetype: feetype, feemodel: ourfeetype, 
            provider_fee_cap:provider_fee_cap, billerid:billerid
        });

        if (logprodct) {
            res.json({ status: true, message: `${productname} Successfully Added` });
        } else {
            res.status(400).json({ status: false, message: 'Unable to add product' });
        }

    } catch (error) {
        console.log("add prodct: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}

const EditProducts = async (req, res) => {
    try {
        const { network, prodcode, product, productname, amount, datatype, providerprice, 
            dataplan, prdid, provfeetype, provfeemodel, ourfeetype, ourfeemodel, provider_fee_cap} = cleanMe(req.body);

        const adminid = req.user.id;
        if (!adminid)
            return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        if (!prdid)
            return res.status(400).json({ status: false, message: 'Invalid product ID!' });

        var theProduct = product.toLowerCase();
        /* if (theProduct == 'databundle') {
            // if (!datatype || (datatype == '')) return res.status(400).json({ status: false, message: 'Kindly specify the data type' });
            if (!prodcode || (prodcode == '')) return res.status(400).json({ status: false, message: 'No product code sent' });
            if (!productname || (productname == '')) return res.status(400).json({ status: false, message: 'No product name sent' });
            if (!product || (product == '')) return res.status(400).json({ status: false, message: 'No product selected' });
            if (!dataplan || (dataplan == '')) return res.status(400).json({ status: false, message: 'No data plan entered' });
        } */

        if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter preffered product amount' });
        // if (amount <= 0 && theProduct != 'airtime') return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
        if ((!network || (network == '')) && (theProduct == 'databundle' || theProduct == 'airtime')) return res.status(400).json({ status: false, message: 'No Network/Provider Selected' });
        if (!provfeetype || (provfeetype == '')) return res.status(400).json({ status: false, message: 'Kindly select provider fee type' });
        if (!provfeemodel || (provfeemodel == '')) return res.status(400).json({ status: false, message: 'Kindly select provider fee model' });
        if (!ourfeetype || (ourfeetype == '')) return res.status(400).json({ status: false, message: 'Kindly select our fee type' });
        if (!ourfeemodel || (ourfeemodel == '')) return res.status(400).json({ status: false, message: 'Kindly select our fee model' });


        const checkPrd = await Product.findOne({ where: { id: prdid } });
        if (!checkPrd)
            return res.status(400).json({ status: false, message: 'Unable to process request, kindly reload and try again' });

        if (network == '' || network == null) {
            var dnetwork = product;
        } else {
            var dnetwork = network;
        }

        /* if (theProduct == 'airtime') {
            var feetype = 'discount';
        } else if (theProduct != 'airtime' && theProduct != 'databundle') {
            var feetype = 'fee';
        } else {
            var feetype = 'fixed';
        } */

        var feetype = ourfeemodel;

        const updprodct = await Product.update({
            category: product, prdname: productname, prdcode: prodcode, providerprice: providerprice,
            amount: amount, feetype: feetype, ntwk: dnetwork, dataplan: dataplan, datatype: datatype,
            provfeetype, provfeemodel, ourfeemodel, provider_fee_cap
        }, { where: { id: prdid } });

        if (updprodct) {
            res.json({ status: true, message: `${productname} Successfully Edited` });
        } else {
            res.status(400).json({ status: false, message: 'Unable to edit product' });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("edit prodct: ", error.message);
    }
}

const removeProduct = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getadm = await Admin.findOne({ where: { id: adminid } });
        if (!getadm)
            return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

        // const admrole = getadm.role;
        // if (admrole != 'superadmin')
        //     return res.status(400).json({ status: false, message: 'Product removal can only be done by the Super Admin' });

        const { prdid } = cleanMe(req.body);

        if (!prdid || prdid == '')
            return res.status(400).json({ status: false, message: 'Oops! No product selected!' });

        const checke = await Product.findOne({ where: { id: prdid } });

        if (!checke)
            return res.status(400).json({ status: false, message: `Unable to get selected product` });

        const delAds = await Product.destroy({ where: { id: prdid } });

        if (!delAds)
            return res.status(400).json({ status: false, message: 'Unable to process product removal' });

        res.json({
            status: true,
            message: `Product Successfully Removed`
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("remove prod adm Error: ", error.message);
    }
}


const getProducts = async (req, res) => {
    try {

        const getdprod = await Product.findAll({
            where: { status: 1 },
            order: [['amount', 'ASC']],
        }).catch((err) => {
            console.log("Error Occurred: " + err);
        });


        if (!getdprod || getdprod.length < 1)
            return res.status(400).json({ status: false, message: 'No product found' });

        const transferFee = await getTransferFee();

        const prodList = getdprod.map((item) => ({
            prdid: item.id,
            product: item.category.toLowerCase(),
            productname: item.prdname == '' ? '-' : item.prdname,
            productcode: item.prdcode == null ? '-' : item.prdcode,
            //   providerprice: item.providerprice == null ? '-' : item.providerprice,
            amount: item.feetype == 'discount' ? item.amount + '%' : `₦${formatAmount(item.amount, 2)}`,
            ourprice: item.amount,
            dataplans: item.dataplan,
            feetype: item.feetype == '' ? '-' : item.feetype,
            network: item.ntwk == '' ? '-' : item.ntwk,
            thestatus: item.status == '1' ? 'approved' : 'disabled',
            otherfee: item.category.toLowerCase() == 'transfer' ? transferFee : []
        }));


        res.json({
            status: true,
            message: 'Product Retrieved',
            data: prodList

        });

    } catch (error) {
        console.log("get prd Error: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}

const updPrdStatus = async (req, res) => {
    try {
        const admid = req.user.id;
        if (!admid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const { updstatus, prdid } = cleanMe(req.body);
        if (!updstatus)
            return res.status(400).json({ status: false, message: 'Oops! No action selected' });

        if (!prdid || prdid == '')
            return res.status(400).json({ status: false, message: 'Oops! Product must be selected!' });

        //check if the amind exist
        const getprd = await Product.findOne({ where: { id: prdid } });
        if (!getprd) return res.status(400).json({ status: false, message: 'Product not found' });

        var action = updstatus == 'enable' ? '1' : '0';

        const updatprod = await Product.update({ status: action }, { where: { id: prdid } });

        if (!updatprod)
            return res.status(400).json({ status: false, message: 'Unable to process request' });

        var auditdesc = `${ucFirst(updstatus)} ${getprd.prdname}`;
        logAudit(admid, auditdesc);

        res.json({ status: true, message: `Product ${updstatus}d` });


    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("upd prd status Error: ", error.message);
    }
}

const verifyBillerId = async (req, res) => {
    try {
        let { vendtype, meterno, billerslug } = req.body

        if (!meterno || meterno == '') return res.status(400).json({ status: false, message: "Customer id number must be specified" })
        if (!vendtype || vendtype == '') return res.status(400).json({ status: false, message: "Package/vend type must be specified" })
        if (!billerslug || billerslug == '') return res.status(400).json({ status: false, message: "Biller slug must be specified" })

        let config = {
            method: 'POST',
            url: `${process.env.CORAL_URL}/transactions/customer-lookup`,
            headers: {
                'Authorization': `Basic ${process.env.CORAL_AUTH}`
            },
            data: {
                customerId: meterno,
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
                    address: address ? address : '', arrearsBalance, customerType, phoneNumber, emailAddress
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
        console.log("validate no Error: ", error.message);
    }

}

const transDetails = async (req, res) => {

    try {
        const userid = req.user.id;
        if (!userid)
            return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { reference } = cleanMe(req.params);
        if (!reference) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const getdetails = await Payn.findOne({
            where: {
                [Op.and]: [{ txref: reference }]
            }
        });

        if (!getdetails)
            return res.status(200).json({ status: false, message: 'No payment found for you' });

        var amount = getdetails.amount ? formatAmount(getdetails.amount) : '0.00';
        var amountval = getdetails.amountval ? formatAmount(getdetails.amountval) : '0.00';
        var fee = getdetails.fee ? formatAmount(getdetails.fee) : '0.00';
        var transref = getdetails.txref;
        var phone = getdetails.recipient;
        var date = moment.unix(getdetails.timed).format('Do MMM, YYYY');
        var paytime = moment.unix(getdetails.timed).format('MMM Do, YYYY | h:m a');
        var transtimed = moment.unix(getdetails.timed).format("Do MMM, YYYY hh:mm a")
        var newbal = getdetails.newbal;
        var prevbal = getdetails.prevbal;
        var paytype = getdetails.paytype;
        var product = ucFirst(getdetails.pfor);
        var productid = getdetails.productid;
        var narration = getdetails.pay_desc;
        var network = getdetails.ntwk ? getdetails.ntwk.toUpperCase() : '';
        var paystatus = getdetails.status == '0' ? 'Pending' : getdetails.status == '1' ? 'Successful' : getdetails.status == '5' ? 'Cancelled' : '';
        var currency = "NGN";

        if (getdetails.meta && getdetails.pfor != 'wallet') {
            var meta = JSON.parse(getdetails.meta);
            var custname = meta.custname ? meta.custname : '';
            var meteradr = meta.address ? meta.address : '';
            var metertype = meta.metertype ? meta.metertype : '';
            var vendunit = (metertype.toLowerCase() == 'prepaid') ? vendUnit : 'NA';
            var vendUnit = meta.unit ? meta.unit : '';
            var vendtoken = (getdetails.pay_desc == '' || getdetails.pay_desc == null) ? 'NA' : meta.token;

            var sourcename = sourceaccount = sourcebank = '';

        } else if (getdetails.meta && getdetails.pfor == 'wallet') {
            var meta = JSON.parse(getdetails.meta);
            var sourcename = meta.sourcename ? meta.sourcename : '';
            var sourceaccount = meta.sourceaccount ? meta.sourceaccount : '';
            var sourcebank = meta.sourcebank ? meta.sourcebank : '';
            var meteradr = vendunit = vendtoken = ''
            var custname = `${sourcename} ${sourceaccount} - ${sourcebank}`;

        } else {
            var custname = meteradr = vendunit = vendtoken = sourcename = sourceaccount = sourcebank = '';
        }

        var cashback = parseFloat(amount) - parseFloat(amountval);
        var dataplan = ''; var prodcode = '';

        var datalist = { amount, vendtoken, transref, phone, custname, meteradr, date, newbal, prevbal, product, productid, paystatus, currency, paytime, vendunit, metertype, network, paytype, cashback, prodcode, dataplan, transtimed, fee, narration, amountval };

        res.json({
            status: true,
            message: 'Transaction Details',
            data: datalist
        });

    } catch (error) {
        console.log('trans details catch ERROR: ' + error.message)
    }
}

const transferPaymentCLOSED = async (req, res) => {
    try {
        const userid = req.user.id;
        const { amount, recipientno, bankname, bankcode, accountname, isbeneficiary, narration, enquirytoken, transpin } = cleanMe(req.body);
        // console.log('reqbdo', cleanMe(req.body))

        if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter amount' });
        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Kindly enter your transaction PIN' });
        if (amount <= 0) return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
        if (!recipientno || (recipientno == '')) return res.status(400).json({ status: false, message: 'Kindly enter recipient phone number' });
        if (!bankname || (bankname == '')) return res.status(400).json({ status: false, message: 'No provider Selected' });

        var paydesc = narration;
        const userinfo = await getUserInfo(userid);  // get user info
        const fname = userinfo.firstname;
        const lname = userinfo.lastname;
        const sourcephone = userinfo.phoneno;
        const sendername = userinfo.lastname + ' ' + userinfo.firstname;
        const useremail = userinfo.email;
        const authpin = userinfo.authpin;

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Transaction PIN' });

        var userbal = await getBal(userid, 'NGN');

        /* format */
        const theProduct = 'transfer';
        var checkFee = await Product.findOne({ where: { category: 'trasfer' } }).catch((err) => { console.log("Unable to process your request : " + err); });

        // if (!checkFee)
        //     return res.status(400).json({ status: false, message: 'Invalid product selected, kindly reload and retry'});   

        var prdamnt = checkFee?.status == 1 ? checkFee?.amount : 0
        var topay = parseFloat(amount) + parseFloat(prdamnt);

        const txref = 'HTCH' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
        let timed = Date.parse(new Date()) / 1000;

        if (amount < 50)
            return res.status(400).json({ status: false, message: 'You cannot transfer below N50.00' });

        if (userinfo.status != '1')
            return res.status(400).json({ status: false, message: 'Your account is not active. Kindly verify your account' });

        if (userinfo.status == '3')
            return res.status(400).json({ status: false, message: 'Your account is currently on hold. Kindly contact our support' });

        if (topay <= 0)
            return res.status(400).json({ status: false, message: 'Invalid charged amount detected, kindly reload and retry' });

        if (bankcode == 'hitchpay') {
            /* get the receiver details */
            const getreceiver = await Customer.findOne({ where: { phoneno: { [Op.like]: `%${recipientno}%` } } }).catch((err) => {
                console.log("Error Occurred: " + err);
            });

            if (!getreceiver)
                return res.status(400).json({ status: false, message: 'Unable to validate account/phone number on HitchPay' });

            if (getreceiver.id == userid)
                return res.status(400).json({ status: false, message: 'You cannot transfer money to self' });

            var paydesc = `Transfer to ${getreceiver?.firstname} ${getreceiver?.lastname}`
        }

        if (userbal > 0 && userbal >= topay) {
            /* Charge customer and log it */
            // Wallets.increment({ wbal: -topay }, { where: { uid: userid, currency: 'NGN' } });
            // var newbal = (userbal - topay);

            /* Update wallet */
            const updbal = await updateBalance(userid, topay, 'NGN', 'debit');
            if (!updbal[0])
                return res.status(400).json({ status: false, message: 'Unable to complete request at the moment' });

            var newbal = updbal[2]; //newbal
            const logwallet = Payn.create({
                userid: userid, amount: topay, amountval: amount, newbal: newbal, prevbal: userbal,
                txref: txref, pfor: 'transfer', usertype: 'user', paytype: 'debit', productid: '', ntwk: bankname,
                paidthru: 'Wallet', pay_desc: paydesc, timed: timed, status: 0, recipient: recipientno, ntwkid: bankcode
            });

            if (logwallet) {
                var thenarration = `${fname} ${lname} - ${paydesc}`


                /* HITCHPAY */
                if (bankcode == 'hitchpay') {
                    const getreceiver = await Customer.findOne({ where: { phoneno: { [Op.like]: `%${recipientno}%` } } }).catch((err) => {
                        console.log("Error Occurred: " + err);
                    });

                    /* Charge customer and log it */
                    var receiverid = getreceiver.id;
                    var receiverbal = await getBal(receiverid, 'NGN');
                    var receivernewbal = parseFloat(receiverbal) + parseFloat(amount);

                    var thenarration = `Transfer from ${sendername}`

                    const dtxref = 'HTCH' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);
                    var meta_data = JSON.stringify({ "sourcename": sendername, "sourceaccount": sourcephone, "sourcebank": 'HitchPay' });

                    // LOG CREDIT
                    const logwallet = await Payn.create({
                        userid: receiverid, recipient: recipientno, amount: amount, amountval: amount, currency: 'NGN', newbal: receivernewbal, prevbal: receiverbal, txref: dtxref, pfor: 'wallet', usertype: 'user', paytype: 'credit', productid: txref, paychannel: 'hitchpay', paidthru: 'hitchpay', meta: meta_data, ntwkid: bankcode,
                        ntwk: 'HitchPay', pay_desc: thenarration, timed: timed, status: 1
                    });

                    if (logwallet) {
                        // Wallets.increment({ wbal: +amount }, { where: { uid: receiverid, currency: 'NGN' } });

                        /* Update wallet */
                        const updbal = await updateBalance(receiverid, amount, 'NGN', 'credit');
                        if (!updbal[0])
                            return res.status(400).json({ status: false, message: 'Unable to complete request at the moment' });

                        var newbal = updbal[2]; //newbal
                        var profit = parseFloat(topay) - parseFloat(amount);

                        /* udpdate sender record */
                        let updit = await Payn.update({
                            status: 1, paidthru: 'wallet', paychannel: 'hitchpay', productid: dtxref,
                            jsonresp: '', meta: '', revenue: profit
                        }, { where: { txref: txref, userid: userid } }
                        );

                        if (isbeneficiary) {
                            logBeneficiary(userid, theProduct, recipientno);
                        }

                        res.json({
                            status: true,
                            message: 'Transfer Payment Successful',
                            data: {
                                amount: amount,
                                amountcharged: topay,
                                fee: topay - amount,
                                reference: txref,
                                sessionid: dtxref,
                                transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"),
                            }
                        });

                    } else {

                        //refund the customer
                        // Wallets.increment({ wbal: +topay }, { where: { uid: userid, currency: 'NGN' } });
                        // var newbal = (userbal + topay);

                        /* Update wallet */
                        const updbal = await updateBalance(userid, topay, 'NGN', 'credit');
                        if (!updbal[0])
                            return res.status(400).json({ status: false, message: 'Unable to complete request at the moment' });

                        var newbal = updbal[2]; //newbal
                        var provref = thedata.dtxref;
                        let updit = await Payn.update({
                            status: 5, paidthru: 'wallet', paychannel: 'hitchpay', productid: provref,
                            jsonresp: '', newbal: userbal
                        }, { where: { txref: txref, userid: userid } });

                        res.status(400).json({
                            status: false,
                            message: `Unable to process transfer request, kindly try again`
                        })
                    }

                } else {
                    try {
                        const gettoken = await shAcessToken();
                        if (gettoken[0]) {
                            var access_token = gettoken[1]
                            var ibs_client_id = gettoken[2]
                            var ibs_user_id = gettoken[3]

                            const options = {
                                method: 'POST',
                                url: `${process.env.SH_BASEURL}/transfers`,
                                headers: {
                                    accept: 'application/json',
                                    ClientID: ibs_client_id,
                                    'content-type': 'application/json',
                                    authorization: `Bearer ${access_token}`
                                },
                                data: {
                                    saveBeneficiary: false,
                                    nameEnquiryReference: enquirytoken,
                                    debitAccountNumber: process.env.SH_DEBITACCOUNT,
                                    beneficiaryBankCode: bankcode,
                                    beneficiaryAccountNumber: recipientno,
                                    amount: parseFloat(amount),
                                    narration: thenarration,
                                    paymentReference: txref
                                }
                            };

                            let response = await axios.request(options);
                            let theresponse = response.data;


                            if (theresponse.statusCode == 200 && theresponse.responseCode == '00') {
                                const jsonString = JSON.stringify(theresponse);

                                const thedata = theresponse.data
                                var sessionId = thedata.sessionId
                                var type = thedata.type
                                var nameEnquiryReference = thedata.nameEnquiryReference
                                var paymentReference = thedata.paymentReference
                                var providerChannel = thedata.providerChannel
                                var payamount = thedata.amount
                                var fees = thedata.fees
                                var status = thedata.status
                                var responseCode = thedata.responseCode
                                var vat = thedata.vat
                                var stampDuty = thedata.stampDuty
                                var charged = payamount

                                var profit = parseFloat(topay) - parseFloat(charged);

                                let updit = await Payn.update(
                                    {
                                        status: 1, paidthru: 'wallet', paychannel: 'safehaven', productid: sessionId,
                                        jsonresp: jsonString, meta: '', revenue: profit
                                    }, { where: { txref: txref, userid: userid } }
                                );

                                /* save beneficiary */
                                if (isbeneficiary) {
                                    logBeneficiary(userid, theProduct, recipientno);
                                }

                                res.json({
                                    status: true,
                                    message: 'Transfer Payment Successful',
                                    data: {
                                        amount: amount,
                                        amountcharged: topay,
                                        fee: topay - amount,
                                        reference: txref,
                                        sessionid: sessionId,
                                        transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a"),
                                    }
                                });

                            } else {
                                //refund the customer
                                // Wallets.increment({ wbal: +topay }, { where: { uid: userid, currency: 'NGN' } });
                                // var newbal = (userbal + topay);

                                const updbal = await updateBalance(userid, topay, 'NGN', 'credit');
                                if (!updbal[0])
                                    return res.status(400).json({ status: false, message: 'Unable to complete request at the moment' });

                                var provref = thedata.sessionId;
                                let updit = await Payn.update({
                                    status: 5, paidthru: 'wallet', paychannel: 'safehaven', productid: provref, jsonresp: jsonString, newbal: userbal
                                }, { where: { txref: txref, userid: userid } }
                                );

                                res.status(400).json({
                                    status: false,
                                    message: `${theresponse.message}`
                                })
                            }
                        }
                    } catch (error) {
                        console.log("Error transf provider edn: ", error.message);
                        res.status(400).json({ status: false, message: 'Unable to process request' });
                    }
                }

            } else {
                res.status(400).json({
                    status: false,
                    message: 'Unable to process request. Kindly reload and retry'
                })
            }

        } else {
            res.status(400).json({
                status: false,
                message: 'Insufficient balance to process transfer of N' + formatAmount(amount)
            })
        }
    } catch (error) {
        console.log("Error trasnfer paynt: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}


const getServicesCategory = async (req, res) => {
    const service = [
        {
            "id": 1,
            "serviceName": "Transport and Toll Payment",
            "serviceSlug": "TRANSPORT_AND_TOLL_PAYMENT"
        },
        {
            "id": 2,
            "serviceName": "Collections",
            "serviceSlug": "COLLECTIONS"
        },
        {
            "id": 3,
            "serviceName": "Food",
            "serviceSlug": "FOOD"
        },
        {
            "id": 4,
            "serviceName": "Government Collections",
            "serviceSlug": "GOVERNMENT_COLLECTIONS"
        },
        {
            "id": 5,
            "serviceName": "International Airtime",
            "serviceSlug": "INTERNATIONAL_AIRTIME"
        },
        {
            "id": 6,
            "serviceName": "Education",
            "serviceSlug": "EDUCATION"
        },
        {
            "id": 7,
            "serviceName": "Entertainment and lifestyle",
            "serviceSlug": "ENTERTAINMENT_AND_LIFESTYLE"
        },
        {
            "id": 8,
            "serviceName": "Payments",
            "serviceSlug": "paymentss"
        },
        {
            "id": 9,
            "serviceName": "INSURANCE",
            "serviceSlug": "INSURANCE"
        },
    ]

    res.json({
        status: true,
        message: 'Services Category',
        data: service
    })
}

const AddLimits = async (req, res) => {
    try {
        const { tiertype, max_inflow, max_transfer, daily_maxtrans, free_transfer } = cleanMe(req.body);

        const adminid = req.user.id;
        if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        if (!tiertype || (tiertype == '')) return res.status(400).json({ status: false, message: 'Kindly specify tier name as Tier 1, Tier 2 or Tier 3' });
        if (!max_inflow || (max_inflow == '')) return res.status(400).json({ status: false, message: 'Kindly enter maximum deposit amount per time' });
        if (!max_transfer || (max_transfer == '')) return res.status(400).json({ status: false, message: 'Kindly enter maximum amount transferable per time' });
        if (!daily_maxtrans || (daily_maxtrans == '')) return res.status(400).json({ status: false, message: 'Kindly specify maximum transaction at a time' });
        if (!free_transfer || (free_transfer == '')) return res.status(400).json({ status: false, message: 'Kindly specify number of daily free transfer' });

        var dtier = ucFirst(tiertype);

        const checklim = await theTransLimit.findOne({ where: { [Op.and]: [{ tiertype: dtier }] } });

        if (checklim)
            return res.status(400).json({ status: false, message: `${dtier} already existed, kindly use the edit button instead` });

        const logprodct = theTransLimit.create({
            tiertype: tiertype, maxinflow: max_inflow, maxtransfer: max_transfer, dailymaxtrans: daily_maxtrans,
            freetransfer: free_transfer, status: 1
        });

        if (logprodct) {
            res.json({ status: true, message: `${ucFirst(tiertype)} Limit Successfully Added` });
        } else {
            res.status(400).json({ status: false, message: 'Unable to add tier' });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("add tier: ", error.message);
    }
}


const getTransLimit = async (req, res) => {
    try {

        const getdlimt = await theTransLimit.findAll().catch((err) => {
            console.log("Unable to process your request : " + err);
        });

        if (!getdlimt || getdlimt.length < 0)
            return res.status(400).json({ status: false, message: 'No limit found' });

        const prodList = getdlimt.map((item) => ({
            limitid: item.id,
            tiertype: item.tiertype,
            max_inflow: item.maxinflow,
            max_transfer: item.maxtransfer,
            daily_maxtrans: item.dailymaxtrans,
            free_transfer: item.freetransfer,
            free_inflows: item.free_inflows,
            thestatus: 'active'
        }));

        res.json({
            status: true,
            message: 'Translimit Retrieved',
            data: prodList
        });

    } catch (error) {
        console.log("get translimit Error: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}

const EditTransLimits = async (req, res) => {
    try {
        const { max_inflow, max_transfer, daily_maxtrans, free_transfer, limitid, free_inflows } = cleanMe(req.body);

        const adminid = req.user.id;
        if (!adminid)
            return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        if (!limitid)
            return res.status(400).json({ status: false, message: 'Invalid limit ID!' });

        // if (!tiertype || (tiertype == '')) return res.status(400).json({ status: false, message: 'Kindly specify tier name as Tier 1, Tier 2 or Tier 3' });
        if (!max_inflow || (max_inflow == '')) return res.status(400).json({ status: false, message: 'Kindly enter maximum deposit amount per time' });
        if (!max_transfer || (max_transfer == '')) return res.status(400).json({ status: false, message: 'Kindly enter maximum amount transferable per time' });
        if (!daily_maxtrans || (daily_maxtrans == '')) return res.status(400).json({ status: false, message: 'Kindly specify maximum transaction at a time' });
        if (!free_transfer || (free_transfer == '')) return res.status(400).json({ status: false, message: 'Kindly specify number of monthly free transfer' });
        if (!free_inflows || (free_inflows == '')) return res.status(400).json({ status: false, message: 'Kindly specify number of monthly free transfer' });


        const checkLimit = await theTransLimit.findOne({ where: { id: limitid } });
        if (!checkLimit)
            return res.status(400).json({ status: false, message: 'Unable to process request, kindly reload and try again' });


        // var dtier = ucFirst(tiertype);

        const updlimt = theTransLimit.update({
            maxinflow: max_inflow, maxtransfer: max_transfer, dailymaxtrans: daily_maxtrans,
            freetransfer: free_transfer, free_inflows: free_inflows, status: 1
        }, { where: { id: limitid } });

        if (updlimt) {
            res.json({ status: true, message: `Limit Successfully Edited` });
        } else {
            res.status(400).json({ status: false, message: 'Unable to edit tier' });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("edit tier: ", error.message);
    }
}

const removeTransLimit = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getadm = await Admin.findOne({ where: { id: adminid } });
        if (!getadm)
            return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

        const { limitid } = cleanMe(req.body);

        if (!limitid || limitid == '')
            return res.status(400).json({ status: false, message: 'Oops! No limit selected!' });

        const checke = await theTransLimit.findOne({ where: { id: limitid } });

        if (!checke)
            return res.status(400).json({ status: false, message: `Unable to get selected limit` });

        const delLIM = await theTransLimit.destroy({ where: { id: limitid } });

        if (!delLIM)
            return res.status(400).json({ status: false, message: 'Unable to process limit removal' });

        res.json({
            status: true,
            message: `Transaction Limit Successfully Removed`
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("remove limt adm Error: ", error.message);
    }
}

const AddPricings = async (req, res) => {
    try {
        const { product, min_amount, max_amount, fee, feetype, providerfee, tierlevel, currency, providerfee_cap, totalfee_cap} = cleanMe(req.body);

        const adminid = req.user.id;
        if (!adminid) return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        if ((!providerfee || (providerfee == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the provider fee' });
        if ((!providerfee_cap || (providerfee_cap == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the provider fee cap' });
        if ((!totalfee_cap || (totalfee_cap == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the total fee cap' });
        if ((!currency || (currency == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the pricing currency' });
        if ((!product || (product == ''))) return res.status(400).json({ status: false, message: 'Pricing product must be specified.' });
        if ((!feetype || (feetype == ''))) return res.status(400).json({ status: false, message: 'Pricing type must be specified.' });
        if ((!tierlevel || (tierlevel == ''))) return res.status(400).json({ status: false, message: 'Tier type must be specified.' });

        const theProduct = product.toLowerCase() == 'inflow' ? 'virtualaccount' : product.toLowerCase();

        let thefixedfee; let theperctfee;
        if(feetype == 'percentage'){
            thefixedfee = 0;
            theperctfee = fee;
        }else{
            thefixedfee = fee;
            theperctfee = 0;
        }

        const checkprice = await PricingFee.findOne({ where: { [Op.and]: [{ product: theProduct }, { min_amount: min_amount }, { max_amount: max_amount }, { feetype: feetype }, { tierlevel: tierlevel }, { currency: currency }] } });

        if (checkprice)
            return res.status(400).json({ status: false, message: `Price already existed, kindly update instead` });

        const logprodct = PricingFee.create({
            product: theProduct, min_amount: min_amount, max_amount: max_amount, fee: thefixedfee,
            fee_percentage: theperctfee, feetype: feetype, status: 1, providerfee: providerfee,
            tierlevel: tierlevel, currency: currency, totalfee_cap: totalfee_cap, providerfee_cap: providerfee_cap
        });

        if (logprodct) {
            res.json({ status: true, message: `Price Successfully Added` });
        } else {
            res.status(400).json({ status: false, message: 'Unable to add pricing' });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("add price: ", error.message);
    }
}

const getPricing = async (req, res) => {
    try {

        const getdprice = await PricingFee.findAll().catch((err) => { console.log("Unable to process your request : " + err); });

        if (!getdprice || getdprice.length < 0)
            return res.status(400).json({ status: false, message: 'No pricing found' });

        const prodList = getdprice.map((item) => ({
            priceid: item.id,
            product: item.product == 'virtualaccount' ? 'INFLOW' : item.product.toUpperCase(),
            min_amount: item.min_amount,
            max_amount: item.max_amount,
            providerfee: item.providerfee,
            providerfee_cap: item.providerfee_cap,
            totalfee_cap: item.totalfee_cap,
            fee: item.feetype == 'percentage' ? item.fee_percentage : item.fee,
            fee_percentage: item.fee_percentage,
            feetype: item.feetype,
            tierlevel: item.tierlevel,
            currency: item.currency,
            thestatus: item.status == '1' ? 'active' : 'inactive'
        }));

        res.json({
            status: true,
            message: 'Pricing Retrieved',
            data: prodList
        });

    } catch (error) {
        console.log("get price Error: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
}


const EditPricing = async (req, res) => {
    try {
        const { prdtype, min_amount, max_amount, fee, feetype, providerfee, tierlevel, priceid, currency, providerfee_cap, totalfee_cap} = cleanMe(req.body);

        const adminid = req.user.id;
        if (!adminid)
            return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

        if (!priceid)
            return res.status(400).json({ status: false, message: 'Invalid pricing ID!' });

        if ((!providerfee || (providerfee == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the provider fee' });
        if ((!providerfee_cap || (providerfee_cap == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the provider fee cap' });
        if ((!totalfee_cap || (totalfee_cap == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the total fee cap' });
        if ((!currency || (currency == ''))) return res.status(400).json({ status: false, message: 'Kindly specify the pricing currency' });
        if ((!prdtype || (prdtype == ''))) return res.status(400).json({ status: false, message: 'Pricing product must be specified.' });
        if ((!feetype || (feetype == ''))) return res.status(400).json({ status: false, message: 'Pricing type must be specified.' });
        if ((!tierlevel || (tierlevel == ''))) return res.status(400).json({ status: false, message: 'Tier type must be specified.' });

        var product = prdtype.toLowerCase() == 'inflow' ? 'virtualaccount' : prdtype.toLowerCase();

        const checkPrice = await PricingFee.findOne({ where: { id: priceid } });
        if (!checkPrice)
            return res.status(400).json({ status: false, message: 'Unable to process request, kindly reload and try again' });

        const theProduct = product.toLowerCase();

        let thefixedfee; let theperctfee;
        if(feetype == 'percentage'){
            thefixedfee = 0;
            theperctfee = fee;
        }else{
            thefixedfee = fee;
            theperctfee = 0;
        }

        const updprice = PricingFee.update({
            product: theProduct, min_amount: min_amount, max_amount: max_amount, fee: thefixedfee,
            fee_percentage: theperctfee, feetype: feetype, status: 1, providerfee: providerfee,
            tierlevel: tierlevel, currency: currency, providerfee_cap: providerfee_cap, totalfee_cap: totalfee_cap
        }, { where: { id: priceid } });

        if (updprice) {
            res.json({ status: true, message: `Price Successfully Edited` });
        } else {
            res.status(400).json({ status: false, message: 'Unable to add pricing' });
        }

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("edit price: ", error.message);
    }
}

const removePricing = async (req, res) => {
    try {
        const adminid = req.user.id;
        if (!adminid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getadm = await Admin.findOne({ where: { id: adminid } });
        if (!getadm)
            return res.status(400).json({ status: false, message: 'Something went wrong please reload the page' });

        const { priceid } = cleanMe(req.body);

        if (!priceid || priceid == '')
            return res.status(400).json({ status: false, message: 'Oops! No pricing selected!' });

        const checke = await PricingFee.findOne({ where: { id: priceid } });

        if (!checke)
            return res.status(400).json({ status: false, message: `Unable to get selected pricing` });

        const delLIM = await PricingFee.destroy({ where: { id: priceid } });

        if (!delLIM)
            return res.status(400).json({ status: false, message: 'Unable to process pricing removal' });

        res.json({
            status: true,
            message: `Pricing Successfully Removed`
        });

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("remove price adm Error: ", error.message);
    }
}


// (async () => {
//     console.log(`Bank Transfer Fee: `, await getFee("transfer", 1000));
//     console.log(`Subscription Fee (5% of 20000): `, await getFee("virtualaccount", 20000));
// })();

const usTransferInfo = async (req, res) => {
  try {
    const getsett = await AppSett.findOne({ where: { id: 1 } });

    if (!getsett) {
      return res.status(400).json({ status: false, message: 'Unable to retrieve transfer fees. Settings not found.' });
    }

    const { dollartransfer, achtransfer, achaccelerated } = getsett;

    res.json({
      status: true,
      message: 'Info retrieved',
      data: [
        {
          "type": "FEDWIRE",
          "dtime": "Instantly",
          "fee": `$${dollartransfer}`,
          "feevalue": dollartransfer
        },
        {
          "type": "ACH-ACCELERATED",
          "dtime": "within 3-4 hours",
          "fee": `$${achaccelerated}`,
          "feevalue": achaccelerated
        },
        {
          "type": "ACH",
          "dtime": "within 24 hours",
          "fee": `$${achtransfer}`,
          "feevalue": achtransfer
        }
      ]
    });

    } catch (error) {
        console.log("wire transfer info: Error", error.message);
        res.json({ status: false, message: 'Unable to process request at the moment' });
    }
}

const notifyPendingTransactions = async (req, res) => {
    // This endpoint should be protected, e.g., by a secret key in the query
    const cronSecret = req.params.secret;
    if (cronSecret !== process.env.CRON_SECRET) {
        return res.status(403).json({ status: false, message: 'Forbidden: Invalid secret.' });
    }

    try {
        const fiveMinutesAgo = moment().subtract(5, 'minutes').unix();

        const pendingTransactions = await Payn.findAll({
            where: {
                status: 0, // Pending status
                timed: { [Op.lte]: fiveMinutesAgo } // Older than 5 minutes
            },
            include: [{
                model: Customer,
                as: 'customer',
                attributes: ['id', 'firstname', 'lastname', 'email']
            }],
            order: [['timed', 'ASC']]
        });

        if (pendingTransactions.length === 0) {
            console.log('No pending transactions older than 5 minutes found.');
            return res.json({ status: true, message: 'No pending transactions to report.' });
        }

        // Format the transactions into an HTML table for the email
        const transactionRows = pendingTransactions.map(tx => `
            <tr>
                <td style="border: 1px solid #ddd; padding: 8px;">${moment.unix(tx.timed).format('YYYY-MM-DD HH:mm:ss')}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${tx.txref}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${tx.pfor}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${tx.amount} ${tx.currency}</td>
                <td style="border: 1px solid #ddd; padding: 8px;">${tx.customer ? `${tx.customer.firstname} ${tx.customer.lastname}` : `User ID: ${tx.userid}`}</td>
            </tr>
        `).join('');

        const emailContent = `
            <p>Hello Settlement Team,</p>
            <p>The following ${pendingTransactions.length} transaction(s) have been in a 'Pending' state for more than 5 minutes and may require investigation:</p>
            <table style="width: 100%; border-collapse: collapse; font-family: sans-serif; font-size: 14px;">
                <thead>
                    <tr style="background-color: #f2f2f2;">
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Date</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Reference</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Product</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Amount</th>
                        <th style="border: 1px solid #ddd; padding: 8px; text-align: left;">Customer</th>
                    </tr>
                </thead>
                <tbody>
                    ${transactionRows}
                </tbody>
            </table>
            <p>Please review these transactions in the admin dashboard.</p>
            <p>Thank you,<br/>HitchPay Monitoring System</p>
        `;

        // await mailSender('Settlement Team', 'Alert: Pending Transactions', 'ugochukwuokoye@hitchpay.ng', emailContent);
        await mailSender('Settlement Team', 'Alert: Pending Transactions', 'feliciankwoashi@hitchpay.ng', emailContent);
        await mailSender('Settlement Team', 'Alert: Pending Transactions', 'olajideolatunji@hitchpay.ng', emailContent);

        res.json({ status: true, message: `Notification sent for ${pendingTransactions.length} pending transaction(s).` });

    } catch (error) {
        console.error('Error in notifyPendingTransactions:', error);
        res.status(500).json({ status: false, message: 'An error occurred while checking for pending transactions.' });
    }
};


module.exports = {
    getBillersPackage, dataPlans, cableTVPlans, verifyIUC, transDetails, verifyBillerId,
    AddProducts, EditProducts, removeProduct, getProducts, updPrdStatus,
    getServicesCategory, AddLimits, getTransLimit, EditTransLimits, removeTransLimit, AddPricings,
    EditPricing, removePricing, getPricing, dataBillers, billerPrices, usTransferInfo, notifyPendingTransactions
};