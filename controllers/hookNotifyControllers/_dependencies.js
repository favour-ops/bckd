const db = require('../../models')
const { v4: uuidv4 } = require('uuid');
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const { Op, fn, col } = require("sequelize");
const sharp = require('sharp');
const md5 = require('md5');
const https = require('https');
const randomstring = require("randomstring");
const axios = require('axios');
const { getUserInfo, getBal } = require("../../config/userdetails");
const { mailSender } = require("../../config/mailsender");
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
const { stringify } = require('querystring');
const moment = require('moment');
const crypto = require('crypto');
// const { time, Console } = require('console');
const { formatAmount, cleanMe, ucFirst, genSHAccount, shAcessToken, getFee, updateBalance, giveWelcomeBonus, referralUplineDownlineBonus, psb9Token, USAccountUpd, getFX, formatPhoneNumber} = require("../../config/myfunct");
const { logger } = require('../../config/logger');
//create main Model

const {
    customers: Customer,
    business: Business,
    wallets: Wallets,
    bizteam: BizTeam,
    bizinvites: BizInvites,
    bizkeys: BizKeys,
    kyc: KYC,
    kycdoc: KycDoc,
    whookhandler: payWhk,
    payn: Payn,
    appsettings: AppSett,
    logrequest: LogRequest,
    bankacct: Bank,
    kadusers: CardUser,
    vkads: VCard,
    cardtrans: CardTrans,
    accountrequest: AcctRequest,
    kadusers: ExternaUser,
    logresponse: LogResponse,
    remittance_accounts: RemittanceAccounts,
    remittancepay: RemittancePay

} = db;

module.exports = {
    db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, logger, formatPhoneNumber, genSHAccount, shAcessToken, getFee, getUserInfo, psb9Token, USAccountUpd, getFX, Customer, Business, Wallets, BizTeam, BizInvites, BizKeys, KYC, KycDoc, payWhk, Payn, AppSett, LogRequest, getBal, updateBalance, Bank, CardUser, VCard, CardTrans, AcctRequest, ExternaUser, LogResponse, RemittanceAccounts, RemittancePay
};
