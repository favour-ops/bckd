const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const { Op, fn, col } = require("sequelize");
const crypto = require('crypto');
const sharp = require('sharp');
const randomstring = require('randomstring');
const md5 = require('md5');
moment.tz.setDefault('Africa/Lagos');

const { genCode } = require("../../config/getcode");
const { uploadFile } = require("../../config/imageuploads");
const { mailSender } = require('../../config/mailsender');
const { formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, validatePassword, genSHBizAccount, getFee, FreeTransfersCount, TransLimit, updateBalance, psb9Token, shAcessToken} = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const { getBizInfo, getUserInfo, getBal, logBeneficiary} = require('../../config/userdetails');
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
const { cloudinary, firebaseUpload, AWSFileUpload } = require("../../config/imageuploads");

const {
    customers: Customer,
    business: Business,
    wallets: Wallets,
    bizteam: BizTeam,
    bizinvites: BizInvites,
    bizkeys: BizKeys,
    payn: Payn,
    checkouttrans: CheckoutTrans,
    kyc: KYC, 
    kycdoc: KycDoc,
    whookhandler: payWhk,
    refreshtoken: rfToken,
    bizwebhook: BizWebhook,
    paylinks: PayLink,
    appsettings: AppSett,
    testwallet: SandboxWallets,
    bankacct: Bank,
    products:Product,
    logrequest:LogRequest,
    verotp: otpVer,
    kybver: BizKYB
} = db;

module.exports = {
    db, randomstring, md5,jwt,
    uuidv4,
    axios,
    moment,
    bcrypt,
    Op, fn, col,
    crypto,
    sharp, LogRequest,
    mailSender, notifyMe, sendSMS, pushNotify, bcrypt, psb9Token,shAcessToken,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, genSHBizAccount,
    validateCacNumber, validatePassword, logger,getFee, FreeTransfersCount, TransLimit, getBal, updateBalance,
    cloudinary, firebaseUpload, AWSFileUpload, BizWebhook, logBeneficiary,
    Customer, Business, Wallets, BizTeam, BizInvites, BizKeys, KYC, KycDoc, getUserInfo, getBizInfo, 
    payWhk,rfToken, Payn, CheckoutTrans, PayLink, AppSett, SandboxWallets, Bank, Product, otpVer, uploadFile, genCode, BizKYB
};
