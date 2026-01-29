const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const { Op } = require("sequelize");

const Customer = db.customers; 
const Audit = db.audit; 
const Admin = db.admin; 
const logEarn = db.logEarning; 
const Timeline = db.Timeline; 
const Benefit = db.benefit;
const Wallets = db.wallets;
const Permission  = db.Permission;
const Role = db.Role; 
const Business = db.business

const getBal = async (userid, currency, options = {}, usertype = 'personal') =>{
    const { transaction } = options;

    if(!userid || userid == '') 
        return 0;

    if(!currency || currency == '') 
        return 0;

    const getbal = await Wallets.findOne({
        attributes: ['wbal'],
        where: { uid: userid, currency: currency, usertype: usertype},
        transaction // Pass transaction if reading within one
    });

    return getbal ? parseFloat(getbal.wbal) : 0;
}

const getLedgerBal = async (userid, currency, options = {}, usertype = 'personal', transactionMode = 'live') =>{
    const { transaction } = options;

    if(!userid || userid == '') 
        return 0;

    if(!currency || currency == '') 
        return 0;

    // Select the correct wallet model based on the transaction mode
    // const WalletModel = transactionMode === 'test' ? db.testwallet : db.wallets;
    const WalletModel = db.wallets;

     const getbal = await WalletModel.findOne({
        attributes: ['ledger'],
        where: { uid: userid, currency: currency, usertype: usertype},
        transaction // Pass transaction if reading within one
    });

    return getbal ? parseFloat(getbal.ledger) : 0;
}


const getUserInfo = async (id) =>{
    try {
        const getinfo = await Customer.findOne({where: {[Op.or]: [{ id: id }]}
        });

        if (!getinfo) {
            return null;
        }

        return getinfo; // Sequelize model instance
    } catch (err) {
        console.error("Unable to process your request  in getUserInfo: " + err.message); // Log with more details
        throw err; // Re-throw the error to be handled by the caller
    }
}

const getBizInfo = async (bizid) =>{
    try {
        const getinfo = await Business.findOne({where: {[Op.or]: [{ id: bizid }]}
        });

        if (!getinfo) {
            return null;
        }

        return getinfo;
    } catch (err) {
        console.error("Unable to process your request  in get Biz Info: " + err.message); 
        throw err; 
    }
}

const getUserName = async (id) =>{
    const getinfo = await Customer.findOne({where: {[Op.or]: [{ id: id }]}
    }).catch((err) =>{
        console.log("Unable to process your request : "+ err);
    });

    const hisname = getinfo;
    return hisname.name;   
}

const getAdminInfo = async (id) =>{
    const getinfo = await Admin.findOne({
        where: {id: id},
        include: {
            model: Role,
            as: 'role',
            include: { model: Permission, as: 'permissions', attributes: ['name'] }, // Only fetch permission names
        },
    }).catch((err) =>{
        console.log("Unable to process your request : "+ err);
    });

    const myinfo = getinfo; 
    return myinfo;
}


const logAudit = async (id, desc) =>{
    let timed = new Date().toString();    
    await Audit.create({adminid: id, description: desc, status: 1, timed: timed}).catch((err) =>{
        console.log("Unable to process your request : "+ err);
    });
}

const logTimeline = async (savingsref, title, note, status) =>{
    let timed = Date.parse(new Date())/1000;
    await Timeline.create({lockref: savingsref, title: title, note: note, status: status, timed: timed}).catch((err) =>{
        console.log("Unable to process your request : "+ err);
    });
}


const logEarnings = async (userid, amount, usertype, type, txref, rate, payfrom) =>{
    let timed = Date.parse(new Date())/1000;
    var logit = await logEarn.create({userid: userid, usertype: usertype, amount: amount, 
        earntype: type, paychannel: type, txref: txref, status: 0, timed: timed, share: rate, payfrom
    }).catch((err) =>{
        console.log("Unable to process your request : "+ err);
    });

    if(logit){
        return true;
    }else{
        return false;
    }
}


const logBeneficiary = async (userid, product, phoneno, bank, bankcode, acctname, options = {}, usertype = 'personal') =>{

    let timed = new Date().toString();    
    const { transaction } = options; // Expect transaction to be passed
    const checkIt = await Benefit.findOne({where: {userid, product, phoneno, usertype}, transaction: transaction})

    if(!checkIt){
        await Benefit.create({userid, product, phoneno, network: bank, productid: bankcode, acctname: acctname, status: 1, timed: timed, usertype});
        console.log('beneficiary added')
        return true;
    }else{
        console.log('beneficiary already exist')
        return false;
    }
}

module.exports = {
    getBal, getUserInfo, logAudit, getAdminInfo, 
    getUserName, logEarnings, logTimeline, logBeneficiary, getLedgerBal, getBizInfo
};