const { success, error } = require("../../utils/pubapi_response.js");
const { cleanMe } = require("../../config/myfunct.js");
const { logger } = require('../../config/logger.js');
const db = require('../../models/index.js');
const { v4: uuidv4 } = require('uuid');
const md5 = require('md5');
const randomstring = require("randomstring");
const { response } = require("express");

const AppSett = db.appsettings;
const Customer = db.customers;
const Admin = db.admin;
const Business = db.business;
const Wallet = db.wallets


const getWalletBalance = async (req, res, next) => {
  try {
    const merchant = req.merchant;
    const userid = merchant.bizid;
    const usertype = 'business';

    if (usertype != 'business') {
      // This case should ideally not be hit if usertype is strictly 'business' for public API
      return error(res, "UNAUTHORIZED", "Only business accounts can access wallet balance via public API.");
    }
    
    const wallets = await Wallet.findAll({ where: { uid: userid, usertype: 'personal' } });
    
    if (!wallets || wallets.length === 0) {
      return success(res, {
        balances: [],
      }, "No wallets found for this merchant.");
    }

    const formattedBalances = wallets.map(wallet => ({
      currency: wallet.currency,
      available_balance: parseFloat(wallet.wbal) || 0,
      ledger_balance: parseFloat(wallet.ledger) || 0,
    }));

    return success(res, {
      balances: formattedBalances,
    }, "Wallet balance retrieved successfully.");
    

  } catch (err) {
    next(err);
  }
};


module.exports = {
  getWalletBalance

};