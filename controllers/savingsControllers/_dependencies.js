const db = require('../../models');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');
const moment = require('moment-timezone');
const bcrypt = require('bcryptjs');
const { Op, fn, col } = require("sequelize");
const crypto = require('crypto');
const sharp = require('sharp');
const md5 = require('md5');
const randomstring = require("randomstring");
moment.tz.setDefault('Africa/Lagos');

const { mailSender } = require('../../config/mailsender');
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
const { formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, updateBalance, formatPhoneNumber} = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const { getBal, logBeneficiary, getUserInfo } = require("../../config/userdetails");
const { cloudinary, firebaseUpload, AWSFileUpload } = require("../../config/imageuploads");

const {
    customers: Customer,
    business: Business,
    wallets: Wallets,
    payn: Payn,
    appsettings: AppSett,
    logrequest: LogRequest,
    logresponse: LogResponse,
    savelock: SaveLock,
    savingsads: savingsAds,
    kyc: KYC,

} = db;

module.exports = {
    db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify, logBeneficiary,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, logger,
    cloudinary, firebaseUpload, AWSFileUpload, formatPhoneNumber,
    Customer, Business, Wallets, Payn, AppSett, LogRequest, getBal, updateBalance,
     getUserInfo, LogResponse, SaveLock, savingsAds, KYC
};
