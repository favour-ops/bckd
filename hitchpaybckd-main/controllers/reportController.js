const db = require('../models')
const { json } = require('sequelize');
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config(); // Load environment variables from .env file
const Sequelize = require('sequelize');
const { Op, fn, col } = require("sequelize");
const md5 = require('md5');
const randomstring = require("randomstring");
const axios = require('axios');
const moment = require('moment');
const { formatAmount, shAcessToken } = require("../config/myfunct");
const { logAudit} = require("../config/userdetails");
const { logger } = require('../config/logger');
// const axiosApiClient = require('../config/axiosInstance');
const Customer = db.customers;
const Admin = db.admin;
// const Lock = db.lock;
// const LockHistory = db.lockhistory;
const Payn = db.payn;
// const Invest = db.invest;
// const logEarning = db.earnings;
const RevenueBank = db.revenuebank;
const LogRequest = db.logrequest;
const AppSett = db.appsettings;
const Wallets = db.wallets;
const Audit = db.audit;



const customerExport = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid)
      return res.json({ status: false, message: 'Oops! Invalid request sent!' });

    const { datefrom, dateto } = req.body
    if (!datefrom || datefrom == '') return res.json({ status: false, message: 'Oops! You forgot to specify the start date' });
    if (!dateto || dateto == '') return res.json({ status: false, message: 'Oops! You forgot to specify the end date' });

    const starttimestamp = moment(datefrom, 'MMM DD, YYYY').startOf('day').unix(); // Start of the day in seconds
    const endtimestamp = moment(dateto, 'MMM DD, YYYY').endOf('day').unix(); // End of the day in seconds

    const getusers = await Customer.findAll({
      where: { timed: { [Op.between]: [starttimestamp, endtimestamp] } },
      order: [['id', 'DESC']]
    });

    if (!getusers || getusers.length <= 0)
      return res.json({ status: false, message: 'No record found for the selected dates' });

    const userInfo = await Promise.all(getusers.map(async (info) => {
      var name = info.lastname + ' ' + info.firstname;
      var walletbal = info.bal;
      var phone_number = info.phoneno;
      var email = info.email;
      var address = info.address == null ? '' : info.address;
      var city = info.city == null ? '' : info.city;
      var state = info.state == null ? '' : info.state;
      var accountstatus = info.status == 1 ? 'Active' : info.status == 3 ? 'Oh-hold' : info.status == 0 ? 'Disabled' : 'Unknown';
      var verstatus = info.isverified == 1 ? 'verified' : 'unverified';
      var docverify = info.docverify;
      var bvverify = info.bvverify;
      var profileimg = info.photo;
      var created_at = moment.unix(info.timed).format("Do MMM, YYYY hh:mm a");
      var referby = info.referby;
      var next_of_kin = info.nextkin;
      var nextofkin_name = info.nextofkin_name;
      var maritalstatus = info.maritalstatus;
      var next_of_kin_phone = info.nextofkin_phone;
      var refcode = info.refcode;
      var dateofbirth = info.dateofbirth;


      var userInfo = { name, walletbal, phone_number, email, address, city, state, accountstatus, verstatus, docverify, bvverify, created_at, referby, nextofkin_name, next_of_kin, next_of_kin_phone, maritalstatus, refcode, dateofbirth };

      return userInfo;
    }));

    res.json({
      status: true,
      message: 'Customer record retrieved',
      data: userInfo
    });

  } catch (error) {
    console.log('customer export catch ERROR: ' + error.message)
  }
}


const depositExport = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const { datefrom, dateto } = req.body
    if (!datefrom || datefrom == '') return res.json({ status: false, message: 'Oops! You forgot to specify the start date' });
    if (!dateto || dateto == '') return res.json({ status: false, message: 'Oops! You forgot to specify the end date' });


    const starttimestamp = moment(datefrom, 'MMM DD, YYYY').startOf('day').unix(); // Start of the day in seconds
    const endtimestamp = moment(dateto, 'MMM DD, YYYY').endOf('day').unix(); // End of the day in seconds

    const gethist = await Payn.findAll({
      where: { paytype: 'credit', timed: { [Op.between]: [starttimestamp, endtimestamp] } }, order: [['id', 'DESC']]
    });

    if (gethist.length == 0) {
      return res.json({ status: false, message: 'No history found for the selected dates' });
    }

    const datalist = await Promise.all(gethist.map(async (arrayItem) => {
      var amount = arrayItem.amount;
      var transid = arrayItem.txref;
      var prevbal = arrayItem.prevbal;
      var newbal = arrayItem.newbal;
      var thestatuscode = arrayItem.status;
      var transtype = arrayItem.paytype;
      var product = arrayItem.pfor;
      var productid = arrayItem.productid;
      var paychannel = arrayItem.paychannel;
      var revenue = arrayItem.revenue ? arrayItem.revenue : 0;
      var thecurrency = arrayItem.currency == 'USD' ? '$' : '₦';
      var paystatus = arrayItem.status == '0' ? 'Pending' : arrayItem.status == '1' ? 'Completed' : arrayItem.status == '3' ? 'Refunded' : arrayItem.status == '4' ? 'Chargedback' : arrayItem.status == '5' ? 'Cancelled' : ''
      var date = moment.unix(arrayItem.timed).format('Do MMM, YYYY hh:mm a');

      return { amount, date, transid, newbal, prevbal, thestatuscode, transtype, paystatus, product, paychannel, productid, thecurrency, revenue }

    }));

    res.json({
      status: true,
      message: 'Funding history retrieved',
      data: datalist
    });

  } catch (error) {
    console.log('funding export catch ERROR: ' + error.message)
  }
}

const SalesExport = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const {datefrom, dateto, isrevenue = false } = req.body

    if(!isrevenue){
      if (!datefrom || datefrom == '') return res.json({ status: false, message: 'Oops! You forgot to specify the start date' });
      if (!dateto || dateto == '') return res.json({ status: false, message: 'Oops! You forgot to specify the end date' });
  
      var starttimestamp = moment(datefrom, 'MMM DD, YYYY').startOf('day').unix(); // Start of the day in seconds
      var endtimestamp = moment(dateto, 'MMM DD, YYYY').endOf('day').unix(); // End of the day in seconds
    }else{
      var starttimestamp = datefrom
      var endtimestamp = dateto
    }

    const gethist = await Payn.findAll({
      where: { timed: { [Op.between]: [starttimestamp, endtimestamp] } }, order: [['id', 'DESC']]
    });

    if (gethist.length == 0) {
      return res.json({ status: false, message: 'No history found for the selected dates' });
    }

    const datalist = gethist.map((arrayItem) => {

      const dataObj = !arrayItem.meta ? null : JSON.parse(arrayItem.meta);

        return {
          amount: arrayItem.amount,
          transid : arrayItem.txref,
          prevbal : arrayItem.prevbal,
          newbal : arrayItem.newbal,
          thestatuscode : arrayItem.status,
          transtype : arrayItem.paytype,
          product : arrayItem.pfor,
          amountval : arrayItem.amountval,
          network : arrayItem.ntwk,
          providerfee : arrayItem.providerfee,
          dfee : arrayItem.fee,
          productid : arrayItem.productid,
          paychannel : arrayItem.paychannel,
          metadetails : !arrayItem.meta ? null : JSON.parse(arrayItem.meta),
           meta_sourcename: !dataObj?.sourcename ? '' : dataObj.sourcename,
          meta_sourceaccount: !dataObj?.sourceaccount ? '' : dataObj.sourceaccount,
          meta_sourcebank: !dataObj?.sourcebank ? '' : dataObj.sourcebank,
          meta_productid: !dataObj?.productid ? '' : dataObj.productid,
          meta_address: !dataObj?.address ? '' : dataObj.address,
          meta_metertype: !dataObj?.metertype ? '' : dataObj.metertype,
          meta_providercomm: !dataObj?.providercomm ? '' : dataObj.providercomm,
          meta_custname: !dataObj?.custname ? '' : dataObj.custname,
          meta_rate: !dataObj?.rate ? '' : dataObj.rate,
          meta_ourfee: !dataObj?.ourfee ? '' : dataObj.ourfee,
          meta_amount: !dataObj?.amount ? '' : dataObj.amount,
          meta_revenuengn: !dataObj?.revenuengn ? '0' : dataObj.revenuengn,   
          revenue : arrayItem.revenue ? arrayItem.revenue : 0,
          currency : arrayItem.currency,
          thecurrency : arrayItem.currency == 'USD' ? '$' : '₦',
          paystatus : arrayItem.status == '0' ? 'Pending' : arrayItem.status == '1' ? 'Completed' : arrayItem.status == '3' ? 'Refunded' : arrayItem.status == '4' ? 'Chargedback' : arrayItem.status == '5' ? 'Cancelled' : '',
          date : moment.unix(arrayItem.timed).format('DD/MM/YYYY'),
          timed : moment.unix(arrayItem.timed).format('hh:mm a'),
      }
    });


    res.json({
      status: true,
      message: 'Sales retrieved',
      data: datalist
    }); 
      


  } catch (error) {
    logger.error('Sales export catch ERROR: ' + error)
    console.log('Sales export catch ERROR: ' + error)
  }
}

const userExport = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const { datefrom, dateto, exportype } = req.body
    // console.log(req.body)

    if (!datefrom || datefrom == '') return res.json({ status: false, message: 'Oops! You forgot to specify the start date' });
    if (!dateto || dateto == '') return res.json({ status: false, message: 'Oops! You forgot to specify the end date' });

    const starttimestamp = moment(datefrom, 'MMM DD, YYYY').startOf('day').unix();
    const endtimestamp = moment(dateto, 'MMM DD, YYYY').endOf('day').unix();

    let getusers;
    const walletInclude = {
      model: Wallets,
      as: 'wallets',
      attributes: ['currency', 'wbal', 'lastupdated'],
      where: {
        currency: 'NGN'
      },
      required: false
    }

    if (exportype == 'unveruser') {
      getusers = await Customer.findAll({
        where: { timed: { [Op.between]: [starttimestamp, endtimestamp] } },
        order: [['id', 'ASC']]
      });
    } else if (exportype == 'veruser') {
      getusers = await Customer.findAll({
        where: { bvverify: '2', timed: { [Op.between]: [starttimestamp, endtimestamp] } },
        order: [['id', 'ASC']]
      });
    } else {
      getusers = await Customer.findAll({
        where: { timed: { [Op.between]: [starttimestamp, endtimestamp] } }, order: [['id', 'ASC']],
      });
    }

    if (!getusers || getusers.length === 0) {
      return res.status(400).json({ status: false, message: 'No customer found for the set parameter' });
    }

    const userInfo = getusers.map((info) => {
      const {
        id: userid,
        lastname,
        firstname,
        phoneno: phone_number,
        refcode: refercode,
        referby,
        email: customer_email,
        status: accountstatus,
        isverified,
        reglevel,
        photo: profileimg,
        timed,
        bvverify,
        bvstatus,
        accounttier,
        address,
      } = info.get({ plain: true }); // Use get({ plain: true }) to get plain object

      const name = `${lastname} ${firstname}`;
      const fname = firstname;
      const lname = lastname;
      const account_tier = accounttier == null ? 1 : accounttier;
      const accountstatus_text =
        accountstatus === 1 ? 'active' : accountstatus === 3 ? 'onhold' : accountstatus === 0 ? 'disabled' : '';
      const verstatus = bvverify === 2 ? 'verified' : 'unverified';
      const regleveltext =
        reglevel === 0 ? 'Ongoing' : reglevel === 1 ? 'Onboarded' : reglevel === 2 ? 'KYC' : '';
      const created_at = moment.unix(timed).format('DD-MM-YYYY hh:mm a');
      const bvstage = bvstatus === 1 ? 'needotp' : bvstatus === 2 ? 'verified' : 'unverified';

      // const walletlist = wallets.map((wallet) => ({
      //   currency: wallet.currency,
      //   walletbal: wallet.wbal,
      //   lastupdated: moment.unix(wallet.lastupdated).format('Do MMM, YYYY h:m a'),
      // }));

      // console.log(walletlist[0])
      // const extractBal = walletlist[0] ? walletlist[0].walletbal : 0;
      // const extractCurrency = walletlist[0] ? walletlist[0].currency : 'NGN';

      return {
        userid,
        name,
        fname,
        lname,
        account_tier,
        phone_number,
        customer_email,
        accountstatus,
        verstatus,
        created_at,
        refercode,
        referby,
        accountstatus_text,
        isverified,
        reglevel,
        regleveltext,
        profileimg: profileimg || '',
        bvstage,
        bvstatus,
        address: address || '',
        // walletbal: formatAmount(extractBal),
        // currency: extractCurrency,
      };
    });


    res.json({
      status: true,
      message: 'Customer data retrieved',
      data: userInfo
    });

  } catch (error) {
    console.log('cust export catch ERROR: ' + error.message)
  }
}


const RevenueExport = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    const { datefrom, dateto } = req.body
    if (!datefrom || datefrom == '') return res.json({ status: false, message: 'Oops! You forgot to specify the start date' });
    if (!dateto || dateto == '') return res.json({ status: false, message: 'Oops! You forgot to specify the end date' });


    const starttimestamp = moment(datefrom, 'MMM DD, YYYY').startOf('day').unix(); // Start of the day in seconds
    const endtimestamp = moment(dateto, 'MMM DD, YYYY').endOf('day').unix(); // End of the day in seconds

    const gethist = await Payn.findAll({
      where: { timed: { [Op.between]: [starttimestamp, endtimestamp] } }, order: [['id', 'DESC']]
    });

    if (gethist.length == 0) {
      return res.json({ status: false, message: 'No history found for the selected dates' });
    }

    const datalist = await Promise.all(gethist.map(async (arrayItem) => {
      var amount = arrayItem.amount;
      var transid = arrayItem.txref;
      var thestatuscode = arrayItem.status;
      var transtype = arrayItem.paytype;
      var paychannel = arrayItem.paychannel;
      var product = arrayItem.pfor;
      var revenue = arrayItem.revenue ? arrayItem.revenue : 0;
      var thecurrency = arrayItem.currency == 'USD' ? '$' : '₦';
      var paystatus = arrayItem.status == '0' ? 'Pending' : arrayItem.status == '1' ? 'Completed' : arrayItem.status == '3' ? 'Refunded' : arrayItem.status == '4' ? 'Chargedback' : arrayItem.status == '5' ? 'Cancelled' : ''
      var date = moment.unix(arrayItem.timed).format('Do MMM, YYYY hh:mm a');

      return { amount, date, transid, thestatuscode, transtype, paystatus, product, paychannel, thecurrency, revenue }

    }));

    res.json({
      status: true,
      message: 'Revenue retrieved',
      data: datalist
    });

  } catch (error) {
    console.log('revenue export catch ERROR: ' + error.message)
  }
}

const exportHistory = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

    const { parameter } = req.params;
    const { startDate, endDate } = req.body;

    let whereClause = {};
    let gethist;

    if (startDate && endDate) {
        // Assuming 'timed' is a UNIX timestamp stored as a number
        const startOfDay = moment(startDate).startOf('day').unix();
        const endOfDay = moment(endDate).endOf('day').unix();
        whereClause.timed = {
            [Op.between]: [startOfDay, endOfDay]
        };
    }

    if (parameter === 'credit') {
      whereClause.paytype = 'credit';
      gethist = await Payn.findAll({ where: whereClause, order: [['id', 'DESC']] });
    } else if (parameter === 'debit') {
      whereClause.paytype = 'debit';
      gethist = await Payn.findAll({ where: whereClause, order: [['id', 'DESC']] });
    } else if (parameter === 'revenue') {
      whereClause.revenue = { [Op.ne]: null };
      gethist = await Payn.findAll({ where: whereClause, order: [['id', 'DESC']] });
    } else if (parameter === 'sales') {
        // For sales, we might not need an extra paytype filter, just the date range.
        // If 'sales' implies 'debit', you can add: whereClause.paytype = 'debit';
        gethist = await Payn.findAll({ where: whereClause, order: [['id', 'DESC']] });
    } else {
      gethist = await Payn.findAll({ where: whereClause, order: [['id', 'DESC']] });
    }

    if (!gethist || gethist.length === 0) {
      return res.json({ status: true, message: 'No history found', data: [] });
    }

    const datalist = gethist.map((arrayItem) => {

      const dataObj = !arrayItem.meta ? null : JSON.parse(arrayItem.meta);
    
        return {
          amount: arrayItem.amount,
          amountval: arrayItem.amountval,
          providerfee: arrayItem.providerfee,
          dfee: arrayItem.fee,
          transtype: arrayItem.paytype,
          network: arrayItem.ntwk,
          paidthru: arrayItem.paidthru,
          payroute: arrayItem.payroute,
          transid: arrayItem.txref,
          date: moment.unix(arrayItem.timed).format('Do MMM, YYYY'),
          timed: moment.unix(arrayItem.timed).format('hh:mm a'),
          newbal: arrayItem.newbal,
          prevbal: arrayItem.prevbal,
          product: arrayItem.pfor,
          receipt: arrayItem.receipt,
          productid: arrayItem.productid,
          revenue: arrayItem.revenue ? arrayItem.revenue : 0,
          sessionid: arrayItem.paychannel,
          paychannel: arrayItem.paychannel,
          currency: arrayItem.currency,
          thecurrency : arrayItem.currency == 'USD' ? '$' : '₦',
          paystatus : arrayItem.status == '0' ? 'Pending' : arrayItem.status == '1' ? 'Completed' : arrayItem.status == '3' ? 'Refunded' : arrayItem.status == '4' ? 'Chargedback' : arrayItem.status == '5' ? 'Cancelled' : '',
          date : moment.unix(arrayItem.timed).format('DD/MM/YYYY'),
          timed : moment.unix(arrayItem.timed).format('hh:mm a'),
          
          metadetails : !arrayItem.meta ? null: JSON.parse(arrayItem.meta),
          meta_sourcename: !dataObj?.sourcename ? '' : dataObj.sourcename,
          meta_sourceaccount: !dataObj?.sourceaccount ? '' : dataObj.sourceaccount,
          meta_sourcebank: !dataObj?.sourcebank ? '' : dataObj.sourcebank,
          meta_productid: !dataObj?.productid ? '' : dataObj.productid,
          meta_address: !dataObj?.address ? '' : dataObj.address,
          meta_metertype: !dataObj?.metertype ? '' : dataObj.metertype,
          meta_providercomm: !dataObj?.providercomm ? '' : dataObj.providercomm,
          meta_custname: !dataObj?.custname ? '' : dataObj.custname,
          meta_rate: !dataObj?.rate ? '' : dataObj.rate,
          meta_ourfee: !dataObj?.ourfee ? '' : dataObj.ourfee,
          meta_amount: !dataObj?.amount ? '' : dataObj.amount,
          meta_revenuengn: !dataObj?.revenuengn ? '0' : dataObj.revenuengn,    
          
      }
    });

    res.json({
      status: true,
      message: 'Payment history retrieved',
      data: datalist
    });

  } catch (error) {
    console.log('user pay history catch ERROR: ' + error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching history.' });
  }
};


const getDailyRevenue = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const dailyRevenueData = await RevenueBank.findAll({order: [['id', 'DESC']]});

    if (!dailyRevenueData || dailyRevenueData.length === 0) {
      return res.status(200).json({ status: true, message: 'No revenue data found.', data: [] });
    }

      const datalist = await Promise.all(dailyRevenueData.map(async (arrayItem) => {
            var revid = arrayItem.id;
            var reference = arrayItem.reference;
            var amount = arrayItem.amount;
            var totalcount = arrayItem.totalcount;
            var dated = arrayItem.dated;
            var datefrom = moment.unix(arrayItem.datefrom).format("DD/MM/YYYY");
            var dateto = moment.unix(arrayItem.dateto).format("DD/MM/YYYY");
            var settlestatus = arrayItem.status == '1' ? 'settled' : "unsettled";

            return {reference, amount, totalcount, datefrom, dateto, settlestatus};

        }));


    res.json({
      status: true,
      message: 'Daily revenue report retrieved successfully.',
      data: datalist
    });

  } catch (error) {
    console.error('Error fetching daily revenue:', error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching daily revenue.' });
  }
};


const getTransactionsByDate = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const { reference } = req.params; // e.g., "20231027"
    const dailyData = await RevenueBank.findOne({where: {reference: reference}});

    if (!dailyData) {
      return res.status(200).json({ status: true, message: 'No revenue data found.', data: [] });
    }
    
    var collatedID = dailyData.id;
    // var reference = dailyData.reference;
    var collatedAmount = dailyData.amount;
    var collatedCount = dailyData.totalcount;
    var startOfDay = dailyData.datefrom;
    var endOfDay = dailyData.dateto;
    var settlestatus = dailyData.status;

    const transactions = await Payn.findAll({
      where: {
        status: 1, timed: { [Op.between]: [startOfDay, endOfDay] },
        // revenue: { [Op.ne]: null, [Op.gt]: 0 }
      },
      order: [['timed', 'ASC']],
    });

    if (!transactions || transactions.length === 0) {
      return res.status(200).json({ status: true, message: `No transactions found for ${reference}.`, data: [] });
    }

    const formattedTransactions = transactions.map(tx => {
      let metaDetails = {};
      if (tx.meta) {
        try {
          metaDetails = JSON.parse(tx.meta);
        } catch (e) {
          console.warn(`Failed to parse meta for txref ${tx.txref}: ${e.message}`);
        }
      }

      return {
        transaction_id: tx.id,
        reference: tx.txref,
        user_id: tx.userid,
        amount: tx.amount,
        service_value: tx.amountval,
        revenue: tx.revenue,
        fee: tx.fee,
        provider_fee: tx.providerfee,
        product: tx.pfor,
        network_provider: tx.ntwk,
        recipient: tx.recipient,
        description: tx.pay_desc,
        status_code: tx.status,
        status_text: tx.status === 1 ? 'Successful' : tx.status === 0 ? 'Pending' : tx.status === 3 ? 'Refunded' : tx.status === 4 ? 'Chargedback' : tx.status === 5 ? 'Cancelled' : '',
        payment_channel: tx.paychannel,
        payment_route: tx.payroute,
        transaction_time: moment.unix(tx.timed).format("YYYY-MM-DD HH:mm:ss"),
        timestamp: tx.timed,
        transtype: tx.paytype,
        transid: tx.txref,
        date: moment.unix(tx.timed).format('DD/MM/YYYY hh:mm a'),
        newbal: tx.newbal,
        prevbal: tx.prevbal
      };
    });

    res.json({
      status: true,
      message: `Transactions for ${reference} retrieved successfully.`,
      data: formattedTransactions,
      doSum: {
        total_collated_revenue: collatedAmount ? collatedAmount : 0,
        total_collated_count: collatedCount ? collatedCount : 0,
        settledstatus: settlestatus,
        settledId: collatedID,
        settleDateFrom : moment.unix(startOfDay).format("DD/MM/YYYY HH:MM"),
        settleDateTo: moment.unix(endOfDay).format("DD/MM/YYYY HH:MM"),
        startTimestamp: dailyData.datefrom,
        endTimestamp:dailyData.dateto
      }
    });

  } catch (error) {
    console.error(`Error fetching transactions for ${req.params.reference}:`, error.message);
    res.status(400).json({ status: false, message: 'An error occurred while fetching transactions.' });
  }
};

const getDailyRevenueCombined = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const queryOptions = (model) => ({
      attributes: [
        [fn('DATE', fn('FROM_UNIXTIME', col('timed'))), 'revenue_date'],
        [fn('SUM', col('revenue')), 'daily_sum']
      ],
      where: {
        status: 1,
        revenue: { [Op.ne]: null, [Op.gt]: 0 } // Ensure revenue is positive
      },
      group: [fn('DATE', fn('FROM_UNIXTIME', col('timed')))],
      raw: true
    });

    const paynRevenue = await Payn.findAll(queryOptions(Payn));
    const offlinePayRevenue = await OfflinePay.findAll(queryOptions(OfflinePay));

    const combinedRevenueMap = new Map();

    paynRevenue.forEach(item => {
      const date = item.revenue_date;
      const currentSum = combinedRevenueMap.get(date) || 0;
      combinedRevenueMap.set(date, currentSum + parseFloat(item.daily_sum || 0));
    });

    offlinePayRevenue.forEach(item => {
      const date = item.revenue_date;
      const currentSum = combinedRevenueMap.get(date) || 0;
      combinedRevenueMap.set(date, currentSum + parseFloat(item.daily_sum || 0));
    });

    const result = Array.from(combinedRevenueMap, ([revenue_date, total_daily_revenue]) => ({
      revenue_date,
      total_daily_revenue
    })).sort((a, b) => new Date(a.revenue_date) - new Date(b.revenue_date)); // Sort by date

    if (result.length === 0) {
      return res.status(200).json({ status: true, message: 'No revenue data found.', data: [] });
    }

    res.json({
      status: true,
      message: 'Daily combined revenue successfully retrieved.',
      data: result
    });

  } catch (error) {
    console.error('Error fetching daily combined revenue:', error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching combined daily revenue.' });
  }
};

const settleRevenue = async (req, res) => {
  const adminid = req.user.id;
  if (!adminid) return res.json({ status: false, message: 'Oops! Invalid request sent!' });

  const getadm = await Admin.findOne({ where: { id: adminid } });
  if (!getadm)
    return res.json({ status: false, message: 'Something went wrong please reload the page' });

  const { settleid } = req.body;
  if (!settleid) return res.json({ status: false, message: 'Eh! Invalid settlement ID request sent!' });


  try {
    const getdetails = await RevenueBank.findOne({ where: { id: settleid, status: 0 } });

    if (!getdetails) {
      return res.json({ status: false, message: 'No settlement found for you' });
    }

    if (getdetails.status == 1) {
      return res.json({ status: false, message: 'Settlement already completed' });
    }

    if (getdetails.amount <= 0) {
      return res.json({ status: false, message: 'Revenue amount is invalid' });
    }

    const getsett = await AppSett.findOne({ where: { id: 1 } });
    if (!getsett)
      return res.json({ status: false, message: 'Unable to process request. Kindly retry' });


    if (!getsett.paytacctno)
      return res.json({ status: false, message: 'Kindly update the revenue settlement bank' });

    if (!getsett.paybtankcode)
      return res.json({ status: false, message: 'Kindly update the revenue settlement bank' });

    const txref = 'PAYT' + md5(randomstring.generate(3)).toUpperCase().substring(0, 10);
    let timed = Date.parse(new Date()) / 1000;
    const settled_datefrom = moment.unix(getdetails.datefrom).format("DD-MM-YYYY");
    const settled_dateto = moment.unix(getdetails.dateto).format("DD-MM-YYYY");
    const settled_period = `${settled_datefrom} to ${settled_dateto}`;
    const narration = `Revenue Settlement for ${settled_period}`;

    const gettoken = await shAcessToken();
    if (!gettoken[0]) throw new Error('Service provider unavailable.');

      var access_token = gettoken[1]
      var ibs_client_id = gettoken[2]
      var ibs_user_id = gettoken[3]

      const options = {
          method: 'POST',
          url: `${process.env.SH_BASEURL}/transfers/name-enquiry`,
          headers: {
              accept: 'application/json',
              ClientID: ibs_client_id,
              authorization: `Bearer ${access_token}`
          },
          data: { bankCode: getsett.paybtankcode, accountNumber: getsett.paytacctno }
      };

      let response = await axios.request(options);
      let thedata = response.data;

        console.log('validateact', thedata)

    if (thedata.statusCode == 200 && thedata.responseCode == '00') {
        var sessionId = thedata.data.sessionId;

        const payload = JSON.stringify({
          saveBeneficiary: false,
          nameEnquiryReference: getsett.paytenquirytoken,
          debitAccountNumber: process.env.SH_DEBITACCOUNT,
          beneficiaryBankCode: getsett.paybtankcode,
          beneficiaryAccountNumber: getsett.paytacctno,
          amount: parseFloat(getdetails.amount),
          narration: narration,
          paymentReference: txref
        });

        await LogRequest.create({ reference: txref, jsonreq: payload, timed: timed, product: 'transfer', provider: 'safehaven' });

        const theHeader = {
          accept: 'application/json',
          ClientID: gettoken[2],
          'content-type': 'application/json',
          authorization: `Bearer ${gettoken[1]}`
        };

        const options = {
          method: 'POST',
          url: `${process.env.SH_BASEURL}/transfers`,
          headers: theHeader,
          data: payload
        };

        let response = await axios.request(options);
      shApiResponse = response.data;

      // console.log('senderresponse', shApiResponse)

      if (shApiResponse.statusCode == 200 && shApiResponse.responseCode == '00') {

        await RevenueBank.update({ status: 1 }, { where: { id: settleid } });

        var auditdesc = `Processed revenue settlement of N${formatAmount(getdetails.amount)} for ${settled_period} with the payment reference of ${txref} and sessionID ${shApiResponse.data.sessionId}`;
        logAudit(adminid, auditdesc);

        return res.json({
          status: true,
          message: 'Revenue Payout Completed',
        });

      } else {
        return res.json({
          status: false,
          message: `Revenue Payout Failed ${shApiResponse.message}`,
        });
      }
   }else{

   }

  } catch (error) {

    console.log('revenue payout catch ERROR: ' + error.message)

    res.status(400).json({
      status: false,
      message: `Error revenue payout process: ${error.message}`
    })
  }
}

module.exports = {
  customerExport, depositExport, SalesExport, exportHistory, 
  RevenueExport, getDailyRevenue,
  getTransactionsByDate, settleRevenue, userExport
};