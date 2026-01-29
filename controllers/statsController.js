const db = require('../models')

const jwt = require("jsonwebtoken");
const md5 = require('md5');
const https = require('https');
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const saltRounds = 10;
const randomstring = require("randomstring");
const { cloudinary, validateUpload, firebaseUpload } = require("../config/imageuploads");
const dotenv = require('dotenv');
const fs = require('fs');
dotenv.config(); // Load environment variables from .env file
const Sequelize = require('sequelize');
const { Op, fn, col, where } = require("sequelize");
const twoFactor = require('node-2fa');
const qrcode = require('qrcode');
const moment = require('moment');
const { genCode } = require("../config/getcode");
const { mailSender } = require("../config/mailsender");
const { sendSMS, pushNotify, notifyMe } = require("../config/notifyuser");
const { getUserInfo, getAdminInfo, logAudit } = require("../config/userdetails");
const { formatAmount, cleanMe, ucFirst, validatePassword } = require("../config/myfunct");
// const { deserialize } = require('v8');
// const { type } = require('os');
// const { create } = require('domain');

const Customer = db.customers;
const Admin = db.admin;
const Notify = db.notify;
const otpVer = db.verotp
const Audit = db.audit;
const logEarning = db.logEarning;
const KycDoc = db.kycdoc;
const RoleAccess = db.roleAccess;
const rfToken = db.refreshtoken;
const Payn = db.payn;
const AppSett = db.appsettings;
const Product = db.products;
const Wallets = db.wallets;
const Benefit = db.benefit;
const Bank = db.bankacct;


const yrSalesGraph = async (req, res) => {
  try {
    const { year = moment().year(), month } = cleanMe(req.body);
    let startDate, endDate;

    if (month) {
      // Set the start and end dates to the first and last days of the requested month
      startDate = moment(`${year}-${month}`, 'YYYY-MM').startOf('month');
      endDate = moment(`${year}-${month}`, 'YYYY-MM').endOf('month');
    } else {
      // Set the start and end dates to the first and last days of the requested year
      startDate = moment(`${year}`, 'YYYY').startOf('year');
      endDate = moment(`${year}`, 'YYYY').endOf('year');
    }

    // Find all orders that were created between the start and end dates
    const orders = await Payn.findAll({
      where: {
        timed: {
          [Op.between]: [startDate.unix(), endDate.unix()] // Use unix() to get the timestamp
        }
      },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('SUM', Sequelize.col('amount')), 'total_sales']
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('SUM', Sequelize.col('amount')), 'total_sales']
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']]
    });

    // Create an array of all days in the requested month or all months in the requested year
    const dates = [];
    let date = moment(startDate);
    while (date <= endDate) {
      dates.push(month ? date.format('DD') : date.format('MMM'));
      date = date.clone().add(1, month ? 'day' : 'month');
    }

    // Create a new array that includes both the day/month and total sales for each day/month
    const data = dates.map(d => {
      const order = orders.find(o => (month ? o.get('day') : o.get('month')) === d);
      return order ? order.get('total_sales') : 0;
    });

    res.json({
      status: true,
      message: 'Payment Analytics Retrieved',
      data: {
        categories: dates,
        series: data,

      }
    });

  } catch (error) {
    console.log('graph catch ERROR: ' + error.message);
    res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
  }
};

const UserGrowth = async (req, res) => {
  try {
    const { year = moment().year(), month } = cleanMe(req.body);
    let startDate, endDate;

    if (month) {
      startDate = moment(`${year}-${month}`, 'YYYY-MM').startOf('month');
      endDate = moment(`${year}-${month}`, 'YYYY-MM').endOf('month');
    } else {
      startDate = moment(`${year}`, 'YYYY').startOf('year');
      endDate = moment(`${year}`, 'YYYY').endOf('year');
    }

    const orders = await Customer.findAll({
      where: { timed: { [Op.between]: [startDate.unix(), endDate.unix()] } },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_count']
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_count']
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']]
    });

    const dates = [];
    let date = moment(startDate);
    while (date <= endDate) {
      dates.push(month ? date.format('DD') : date.format('MMM'));
      date = date.clone().add(1, month ? 'day' : 'month');
    }

    const data = dates.map(d => {
      const order = orders.find(o => (month ? o.get('day') : o.get('month')) === d);
      return order ? order.get('total_count') : 0;
    });

    res.json({
      status: true,
      message: 'Customer Analytics Retrieved',
      data: {
        categories: dates,
        series: data,

      }
    });

  } catch (error) {
    console.log('cust graph catch ERROR: ' + error.message);
    res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
  }
};


const UserGrowthTwoGraph = async (req, res) => {
  try {
    const { year = moment().year(), month } = req.body;
    let startDate, endDate;

    if (month) {
      startDate = moment(`${year}-${month}`, 'YYYY-MM').startOf('month');
      endDate = moment(`${year}-${month}`, 'YYYY-MM').endOf('month');
    } else {
      startDate = moment(`${year}`, 'YYYY').startOf('year');
      endDate = moment(`${year}`, 'YYYY').endOf('year');
    }

    // --- New Customers Data ---
    const fiveDaysAgo = moment().subtract(5, 'days').unix();
    const newCustomers = await Customer.findAll({
      where: {
        timed: {
          [Op.between]: [startDate.unix(), endDate.unix()],
          [Op.gte]: fiveDaysAgo,
        },
      },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'new_customers_count'],
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'new_customers_count'],
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']],
    });

    // --- Returning Customers Data ---
    const returningCustomers = await Customer.findAll({
      where: {
        timed: {
          [Op.between]: [startDate.unix(), endDate.unix()],
          [Op.lt]: fiveDaysAgo,
        },
      },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'returning_customers_count'],
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'returning_customers_count'],
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']],
    });

    // --- Date Categories ---
    const dates = [];
    let date = moment(startDate);
    while (date <= endDate) {
      dates.push(month ? date.format('DD') : date.format('MMM'));
      date = date.clone().add(1, month ? 'day' : 'month');
    }

    // --- Data Mapping ---
    const newCustomersData = dates.map((d) => {
      const newCust = newCustomers.find((o) => (month ? o.get('day') : o.get('month')) === d);
      return newCust ? newCust.get('new_customers_count') : 0;
    });

    const returningCustomersData = dates.map((d) => {
      const returningCust = returningCustomers.find((o) => (month ? o.get('day') : o.get('month')) === d);
      return returningCust ? returningCust.get('returning_customers_count') : 0;
    });

    res.json({
      status: true,
      message: 'Sales and Customer Growth Retrieved',
      data: {
        categories: dates,
        newCustomersSeries: newCustomersData,
        returningCustomersSeries: returningCustomersData,
      },
    });
  } catch (error) {
    console.error('graph catch ERROR: ', error.message);
    res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
  }
};


const TransactionGrowthGraph = async (req, res) => {
  try {
    const { year = moment().year(), month } = req.body;
    let startDate, endDate;

    if (month) {
      startDate = moment(`${year}-${month}`, 'YYYY-MM').startOf('month');
      endDate = moment(`${year}-${month}`, 'YYYY-MM').endOf('month');
    } else {
      startDate = moment(`${year}`, 'YYYY').startOf('year');
      endDate = moment(`${year}`, 'YYYY').endOf('year');
    }

    // --- Credit Transactions Data ---
    const creditTransactions = await Payn.findAll({
      where: {
        timed: {
          [Op.between]: [startDate.unix(), endDate.unix()],
        },
        paytype: 'credit', // Filter for credit transactions
        status: 1, // Filter for status 1
      },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('SUM', Sequelize.col('amount')), 'credit_transactions_amount'],
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('SUM', Sequelize.col('amount')), 'credit_transactions_amount'],
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']],
    });

    // --- Debit Transactions Data ---
    const debitTransactions = await Payn.findAll({
      where: {
        timed: {
          [Op.between]: [startDate.unix(), endDate.unix()],
        },
        paytype: 'debit',
        status: 1,
      },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('SUM', Sequelize.col('amount')), 'debit_transactions_amount'],
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('SUM', Sequelize.col('amount')), 'debit_transactions_amount'],
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']],
    });

    // --- Date Categories ---
    const dates = [];
    let date = moment(startDate);
    while (date <= endDate) {
      dates.push(month ? date.format('DD') : date.format('MMM'));
      date = date.clone().add(1, month ? 'day' : 'month');
    }


    // --- Data Mapping ---
    const creditTransactionsData = dates.map((d) => {
      const creditTrans = creditTransactions.find((o) => (month ? o.get('day') : o.get('month')) === d);
      return creditTrans ? creditTrans.get('credit_transactions_amount') : 0;
    });

    const debitTransactionsData = dates.map((d) => {
      const debitTrans = debitTransactions.find((o) => (month ? o.get('day') : o.get('month')) === d);
      return debitTrans ? debitTrans.get('credit_transactions_amount') : 0;
    });

       // --- Summation Transactions Data ---
       const sumTransactions = await Payn.sum('amount', {
        where: {
          timed: {
            [Op.between]: [startDate.unix(), endDate.unix()],
          },
          paytype: 'credit', // Filter for credit transactions
          status: 1, // Filter for status 1
        },
        attributes: month
          ? [
            [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
            [Sequelize.fn('SUM', Sequelize.col('amount')), 'credit_transactions_amount'],
          ]
          : [
            [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
            [Sequelize.fn('SUM', Sequelize.col('amount')), 'credit_transactions_amount'],
          ],
        group: month ? 'day' : 'month',
        order: month
          ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
          : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']],
      });

    res.json({
      status: true,
      message: 'Credit and Debit Transaction Growth Retrieved',
      data: {
        categories: dates,
        creditTransactionsSeries: creditTransactionsData,
        debitTransactionsSeries: debitTransactionsData,
        sumTransactions: sumTransactions,
      },
    });
  } catch (error) {
    console.error('graph catch ERROR: ', error.message);
    res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
  }
};

const TransVolumeGraph = async (req, res) => {
  try {
    const { year = moment().year(), month } = req.body;
    let startDate, endDate;

    if (month) {
      startDate = moment(`${year}-${month}`, 'YYYY-MM').startOf('month');
      endDate = moment(`${year}-${month}`, 'YYYY-MM').endOf('month');
    } else {
      startDate = moment(`${year}`, 'YYYY').startOf('year');
      endDate = moment(`${year}`, 'YYYY').endOf('year');
    }

    // --- Successful Transactions Data ---
    const successTransactions = await Payn.findAll({
      where: { timed: { [Op.between]: [startDate.unix(), endDate.unix()]},
        status: 1, // Filter for status 1
      },
      attributes: month
        ? [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%d'), 'day'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'transvolume'],
        ]
        : [
          [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%b'), 'month'],
          [Sequelize.fn('COUNT', Sequelize.col('id')), 'transvolume'],
        ],
      group: month ? 'day' : 'month',
      order: month
        ? [[Sequelize.literal(`STR_TO_DATE(CONCAT(day, ' ${month} ${year}'), '%d %m %Y')`), 'ASC']]
        : [[Sequelize.literal(`STR_TO_DATE(CONCAT('01 ', month, ' ${year}'), '%d %b %Y')`), 'ASC']],
    });

    // --- Date Categories ---
    const dates = [];
    let date = moment(startDate);
    while (date <= endDate) {
      dates.push(month ? date.format('DD') : date.format('MMM'));
      date = date.clone().add(1, month ? 'day' : 'month');
    }


    // --- Data Mapping ---
    const successfulTransData = dates.map((d) => {
      const theTrans = successTransactions.find((o) => (month ? o.get('day') : o.get('month')) === d);
      return theTrans ? theTrans.get('transvolume') : 0;
    });

    res.json({
      status: true,
      message: 'Transaction Growth Retrieved',
      data: {
        categories: dates,
        successfulTransData: successfulTransData,
      },
    });
  } catch (error) {
    console.error('trans volume graph catch ERROR: ', error.message);
    res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
  }
};

const getTopProductsOld = async (req, res) => {
  const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
  const endOfDay = Math.floor(new Date().setHours(23, 59, 59, 999) / 1000);

  try {
    const totalTransactions = await Payn.count({
      where: {
        status: 1,
        pfor: {[Op.ne]: 'Electronic Money Transfer Levy'},
        timed: { [Op.gte]: startOfDay, [Op.lte]: endOfDay },
      },
    });

    const topProducts = await Payn.findAll({
      attributes: [
        'pfor',
        [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_count'],
        [Sequelize.fn('SUM', Sequelize.col('amount')), 'total_sum'],
      ],
      where: {
        status: 1,
        pfor: {[Op.ne]: 'Electronic Money Transfer Levy'},
        timed: { [Op.gte]: startOfDay, [Op.lte]: endOfDay }
      },
      group: ['pfor'],
      order: [[Sequelize.literal('total_count'), 'DESC']],
      limit: 10
    });

    const prodList = topProducts.map((item) => {
      const totalCount = item.getDataValue('total_count');
      const totalSum = item.getDataValue('total_sum');
      const percentage = totalTransactions > 0 ? (totalCount / totalTransactions) * 100 : 0;

      return {
        product: item.pfor,
        totalcount: totalCount,
        totalsum: formatAmount(totalSum),
        progress: percentage.toFixed(),
      };
    });

    res.json({
      status: true,
      message: 'Top Sales Today',
      data: prodList
    });

  } catch (error) {
    console.error('Error fetching top products:', error);
    res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
  }
}

const getTopProducts = async (req, res) => {
    const { filterby } = req.query;

    let startOfDay, endOfDay;

    if (filterby) {
        // Use the provided date from the filter
        const targetDate = new Date(filterby);
        // Set to the beginning of the day in the server's timezone
        targetDate.setHours(0, 0, 0, 0);
        startOfDay = Math.floor(targetDate.getTime() / 1000);

        // Set to the end of the day
        targetDate.setHours(23, 59, 59, 999);
        endOfDay = Math.floor(targetDate.getTime() / 1000);
    } else {
        // Default to today if no filter is provided
        const today = new Date();
        startOfDay = Math.floor(today.setHours(0, 0, 0, 0) / 1000);
        endOfDay = Math.floor(today.setHours(23, 59, 59, 999) / 1000);
    }

    try {
        const whereClause = {
            status: 1,
            pfor: { [Op.ne]: 'Electronic Money Transfer Levy' },
            timed: { [Op.gte]: startOfDay, [Op.lte]: endOfDay },
        };

        const totalTransactions = await Payn.count({
            where: whereClause,
        });

        const topProducts = await Payn.findAll({
            attributes: [
                'pfor',
                [Sequelize.fn('COUNT', Sequelize.col('id')), 'total_count'],
                [Sequelize.fn('SUM', Sequelize.col('amount')), 'total_sum'],
            ],
            where: whereClause,
            group: ['pfor'],
            order: [[Sequelize.literal('total_count'), 'DESC']],
            limit: 10
        });

        const prodList = topProducts.map((item) => {
            const totalCount = item.getDataValue('total_count');
            const totalSum = item.getDataValue('total_sum');
            const percentage = totalTransactions > 0 ? (totalCount / totalTransactions) * 100 : 0;

            return {
                product: item.pfor,
                totalcount: totalCount,
                totalsum: formatAmount(totalSum),
                progress: percentage.toFixed(),
            };
        });

        res.json({
            status: true,
            message: 'Top Sales for selected date',
            data: prodList
        });

    } catch (error) {
        console.error('Error fetching top products:', error);
        res.status(500).json({ status: false, message: 'An error occurred', error: error.message });
    }
}


const getCustomersByState = async (req, res) => {
  try {
    const totalCustomers = await Customer.count(); // Get the total number of customers

    const customerStats = await Customer.findAll({
      attributes: [
        'state', [fn('COUNT', 'id'), 'customerCount']
      ],
      group: ['state'],
      limit: 5,
      order: [[Sequelize.literal('customerCount'), 'DESC']],
      raw: true,
    });

    // Calculate percentages
    const customerStatsWithPercentages = customerStats.map(stateData => ({
      ...stateData,
      percent: totalCustomers > 0 ? ((stateData.customerCount / totalCustomers) * 100).toFixed(2) : 0,
    }));

    res.json({ status: true, data: customerStatsWithPercentages });
  } catch (error) {
    console.error('Error fetching customer stats:', error);
    res.status(500).json({ status: false, message: 'Internal Server Error' }); //Improved error handling
  }
};


const getActiveDormantStats = async (req, res) => {
  try {
    const oneMonthAgo = moment().subtract(1, 'month').startOf('day').unix();

    const totalCustomers = await Customer.count();
    const activeCount = await Wallets.count({where: {lastupdated: { [Op.gte]: oneMonthAgo.toString()}}});
    const dormantCount = totalCustomers - activeCount;

    const activePercent = ((activeCount / totalCustomers) * 100).toFixed();
    const dormantPercent = ((dormantCount / totalCustomers) * 100).toFixed();


    res.json({
      status: true,
      message: 'Active/Dormant accounts retrieved.',
      data: {
        activeAccount: activeCount,
        dormantAccount: dormantCount,
        activePercent, dormantPercent
      }
    });

  } catch (error) {
    console.error('Error fetching active/dormant wallet stats:', error);
    res.status(500).json({ status: false, message: 'Internal Server Error while fetching wallet activity stats.' });
  }
};

const billsSummary = async (req, res) => {
  try {
    const debitSumsByProduct = await db.payn.findAll({
        attributes: [
            'pfor', // The column to group by
            [fn('SUM', col('amount')), 'totalDebitAmount']
        ],
        where: {
            paytype: 'debit',
            status: 1
        },
        group: ['pfor'],
        order: [['pfor', 'ASC']],
        raw: true // Get plain JSON objects instead of Sequelize model instances
    });

    // You can then use this data in your response or further processing
    res.json({ status: true, message: "Debit sums by product retrieved", data: debitSumsByProduct });

} catch (error) {
    console.error("Error fetching debit sums by product:", error);
    res.status(500).json({ status: false, message: "Failed to retrieve bills payment summary." });
}
  
}

const getTransferStats = async (req, res) => {
    try {
      
  
    //   const totalTransfer = await Payn.sum(amount, {where: {pfor: 'transfer'}});
      const totalTransfer = await Payn.sum('amount', { where: { status: 1, pfor: 'transfer'}});
      const localTransfer = await Payn.count({ where: {status: 1, ntwkid: { [Op.ne]: 'hitchpay' }, paytype: 'debit', pfor: 'transfer'}});
      const hitchpayTransfer = await Payn.count({ where: { status: 1, ntwkid: 'hitchpay', paytype: 'debit', pfor: 'transfer'}});

      console.log('totalTransfer', totalTransfer)
      console.log('hitchpayTransfer', hitchpayTransfer)
      console.log('hitchpayTransfer', localTransfer)

  
      res.json({
        status: true,
        message: 'Transfer Stats.',
        data: {
          totalTransfer: totalTransfer,
          hitchpayTransfer: hitchpayTransfer,
          localTransfer, localTransfer
        }
      });
  
    } catch (error) {
      console.error('Error fetching transfer wallet stats:', error);
      res.status(500).json({ status: false, message: 'Internal Server Error while fetching wallet activity stats.' });
    }
  };

const getTopReferrers = async (req, res) => {
  try {
    const adminid = req.user.id;
    if (!adminid) {
      return res.status(401).json({ status: false, message: 'Unauthorized! Invalid request sent!' });
    }

    const topReferrers = await Customer.findAll({
      attributes: [
        'id',
        'firstname',
        'lastname',
        'email',
        'phoneno',
        'uname',
        'refcode',
        [
          Sequelize.literal(`(
            SELECT COUNT(*)
            FROM customers AS referred
            WHERE referred.referby = \`customers\`.\`uname\` OR referred.referby = \`customers\`.\`refcode\`
          )`),
          'referral_count'
        ]
      ],
      having: Sequelize.literal('referral_count > 0'), // Only include users with at least one referral
      order: [[Sequelize.literal('referral_count'), 'DESC']],
      limit: 50
    });

    if (!topReferrers || topReferrers.length === 0) {
      return res.status(200).json({ status: false, message: 'No users with referrals found.' });
    }

    res.json({
      status: true,
      message: 'Top referrers retrieved successfully.',
      data: topReferrers
    });

  } catch (error) {
    console.error('Error fetching top referrers:', error.message);
    res.status(500).json({ status: false, message: 'An error occurred while fetching top referrers.' });
  }

}

module.exports = {
    yrSalesGraph, UserGrowth, UserGrowthTwoGraph, TransactionGrowthGraph, TransVolumeGraph, 
    getTopProducts, getCustomersByState, getActiveDormantStats, billsSummary, getTransferStats,
    getTopReferrers
    
};