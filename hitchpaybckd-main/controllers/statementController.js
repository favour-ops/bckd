const db = require('../models');
const { Op } = require("sequelize");
const moment = require('moment');
const { default: PQueue } = require('p-queue');
const puppeteer = require('puppeteer');
const fs = require('fs').promises;
const path = require('path');
const { logger } = require('../config/logger');
const { mailSender } = require("../config/mailsender");
const { notifyMe } = require("../config/notifyuser");
const { formatAmount, ucFirst } = require("../config/myfunct");

const Customer = db.customers;
const Payn = db.payn;
const Wallets = db.wallets;


const generateStatementHTML = (data) => {
    const logoUrl = 'https://res.cloudinary.com/hitchpay/image/upload/v1761417932/hitchpay_logo_tkhi3c.png';

    const transactionRows = data.records.map(tx => `
        <tr>
            <td>${tx.date}</td> 
            <td>${tx.description}</td>
            <td>${tx.reference}</td>
            <td class="currency">${tx.debit > 0 ? formatAmount(tx.debit, 2) : '-'}</td>
            <td class="currency">${tx.credit > 0 ? formatAmount(tx.credit, 2) : '-'}</td>
            <td class="currency">${tx.balance}</td>
        </tr>
    `).join('');

    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8" />
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
            <link href="https://fonts.googleapis.com/css2?family=Mulish:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Mulish', sans-serif; margin: 0; padding: 0; background-color: #f9f9f9; }
                .statement-card { background-color: white; max-width: 800px; margin: auto; border: 1px solid #e0e0e0; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); }
                .statement-header { background-color: #6A2AB5; background-image: url('https://res.cloudinary.com/hitchpay/image/upload/v1762301934/statementheader_pbbkym.png'); background-size: cover; position: relative; min-height: 180px; color: #ffffff; padding: 20px 24px; }
                .statement-header img { height: 40px; }
                .inner-card-container { padding: 0 24px; }
                .inner-card { position: relative; background: #fff; top: -85px; border: 1px solid #eee; border-radius: 8px; }
                .top-header { display: flex; justify-content: space-between; align-items: center; height: 64px; background: #F4EAFF; padding: 0 12px; border-top-left-radius: 8px; border-top-right-radius: 8px; }
                .top-header h2 { font-style: normal; font-weight: 600; font-size: 20px; color: #101010; }
                .top-header p { font-style: normal; font-weight: 500; font-size: 14px; color: #101010; }
                .account-info { padding: 20px; }
                .cust-info .row { display: flex; flex-wrap: wrap; margin: -12px; }
                .cust-info .col { padding: 12px; box-sizing: border-box; }
                .cust-info .col-6 { width: 50%; }
                .cust-info p { font-weight: 300; font-size: 14px; line-height: 1.5; color: #101010; opacity: 0.7; margin: 0 0 4px 0; }
                .cust-info h4 { font-style: normal; font-weight: 600; font-size: 22px; line-height: 1.5; color: #370D66; margin: 0; }
                .cust-info h5 { font-style: normal; font-weight: 400; font-size: 16px; line-height: 1.5; color: #1E1E1E; margin: 0; }
                .cust-info h2 { font-style: normal; font-weight: 600; font-size: 20px; line-height: 1.5; color: #370D66; margin-top: 20px; }
                .cust-info .addr { max-width: 310px; }
                .boda { border-width: 1.87px 0; border-style: dashed; border-color: #C4C0C0; margin-top: 20px; padding-top: 20px; }
                .transaction-table-container { padding: 5px 24px; }
                .transaction-table { border: 1.088px solid #C4C0C0; border-radius: 2px; overflow: hidden; }
                .transaction-table table { width: 100%; border-collapse: collapse; }
                .transaction-table th, .transaction-table td { padding: 12px; font-size: 11px; text-align: left; }
                .transaction-table thead { background: #370D66; color: white; }
                .transaction-table th { font-weight: bold; }
                .transaction-table tbody tr:nth-child(even) { background-color: #f9f9f9; }
                .transaction-table .currency { text-align: right; }
                .debit-amount { color: #FF0000; font-weight: 600; }
                .credit-amount { color: #008000; font-weight: 600; }
                .balance-amount { color: #1e1e1e; font-weight: 600; }
                .statement-footer { padding: 24px; }
                .statement-footer h3 { font-size: 16px; font-weight: 700; color: #370D66; }
                .statement-footer p { font-weight: 400; font-size: 12px; color: #1E1E1E; opacity: 0.8; line-height: 1.6; }
                .statement-footer .footer-logo { height: 40px; }
                .social-media img { margin: 5px; height: 28px; width: 28px; border-radius: 50%; }
            </style>
        </head>
        <body>
            <div class="statement-card">
                <div class="statement-header">
                    <img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/hitchlogo_white_lsfgnx.png" alt="HitchPay Logo">
                </div>

                <div class="inner-card-container">
                    <div class="inner-card">
                        <div class="top-header">
                            <h2>Account Statement</h2>
                            <p>Statement Date: ${moment().format('MMM DD, YYYY')}</p>
                        </div>
                        <div class="account-info">
                            <div class="cust-info">
                                <div class="row">
                                    <div class="col col-6">
                                        <p>Name</p>
                                        <h4 style="color: #370D66;">${data.customerName}</h4>
                                    </div>
                                    <div class="col col-6">
                                        <p>Email Address</p>
                                        <h5>${data.customerEmail}</h5>
                                    </div>
                                </div>
                                <div class="row" style="margin-top: 28px;">
                                    <div class="col col-6">
                                        <p>Home Address</p>
                                        <h5 class="addr">${data.customerAddress}</h5>
                                    </div>
                                    <div class="col col-6">
                                        <div class="row">
                                            <div class="col col-6">
                                                <p>Account Type</p>
                                                <h5>Personal</h5>
                                            </div>
                                            <div class="col col-6">
                                                <p>Account Number</p>
                                                <h5>${data.accountNumber}</h5>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="row">
                                    <div class="col col-6">
                                        <h2>Account Summary</h2>
                                    </div>
                                    <div class="col col-6">
                                        <div class="row">
                                            <div class="col col-6">
                                                <p>Opening Balance</p>
                                                <h5>${data.currency} ${data.openingBalance}</h5>
                                            </div>
                                            <div class="col col-6">
                                                <p>Closing Balance</p>
                                                <h5>${data.currency} ${data.closingBalance}</h5>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div class="row boda">
                                    <div class="col col-6">
                                        <div class="row">
                                            <div class="col col-6">
                                                <p>Total Inflow</p>
                                                <h5>${data.currency} ${data.totalInflow}</h5>
                                            </div>
                                            <div class="col col-6">
                                                <p>Total Outflow</p>
                                                <h5>${data.currency} ${data.totalOutflow}</h5>
                                            </div>
                                        </div>
                                    </div>
                                    <div class="col col-6">
                                        <div class="row">
                                            <div class="col col-6">
                                                <p>Start Date</p>
                                                <h5>${data.startdate}</h5>
                                            </div>
                                            <div class="col col-6">
                                                <p>End Date</p>
                                                <h5>${data.enddate}</h5>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <div class="transaction-table-container">
                    <div class="transaction-table">
                        <table>
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Description</th>
                                    <th>Reference</th>
                                    <th class="currency">Debit (${data.currency})</th>
                                    <th class="currency">Credit (${data.currency})</th>
                                    <th class="currency">Balance (${data.currency})</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${transactionRows}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div class="statement-footer">
                    <div>
                        <h3>DISCLAIMER</h3>
                        <p>This is a computer generated statement requiring no signature and it represents our records of the customer transactions with us.<br>
                        Any exceptions must be advised to us immediately. Please address all enquiries to our support on our social media or send an email to hi@hitchpay.ng</p>
                    </div>
                    <div style="margin-top: 24px;">
                        <img class="footer-logo" src="${logoUrl}" alt="HitchPay Logo">
                    </div>
                    <div class="social-media" style="margin-top: 8px;">
                        <a href="https://www.linkedin.com/company/hitchpay/"><img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/linkedin_tb03jy.png" alt="LinkedIn"></a>
                        <a href="https://www.facebook.com/profile.php?id=61562864042925"><img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/facebook_ecllmu.png" alt="Facebook"></a>
                        <a href="https://x.com/hitchpay"><img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/twitte_u01ub9.png" alt="Twitter"></a>
                        <a href="https://www.instagram.com/hitchpay"><img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011128/instagram_in0pzj.png" alt="Instagram"></a>
                    </div>
                    <div style="margin-top: 8px;">
                        <p>© ${new Date().getFullYear()} HitchPay Technologies Ltd.<br>
                        All rights reserved.<br>
                        If you have questions or enquiries, please reach us via our email or social media platforms.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;
};



const processUserStatement = async (user, browser) => {
    const previousMonth = moment().subtract(1, 'month');
    const startOfMonth = previousMonth.startOf('month').unix();
    const endOfMonth = previousMonth.endOf('month').unix();
    const period = previousMonth.format('MMMM YYYY');
    const startdate = previousMonth.startOf('month').format('MMM DD, YYYY');
    const enddate = previousMonth.endOf('month').format('MMM DD, YYYY');

    try {
        const transactions = await Payn.findAll({
            where: { userid: user.id, currency: 'NGN', status: 1, timed: { [Op.between]: [startOfMonth, endOfMonth] } },
            order: [['timed', 'ASC']]
        });

        if (transactions.length === 0) {
            logger.info(`No transactions for user ${user.id} in ${period}. Skipping statement.`);
            return { status: 'skipped' };
        }

        const openingBalanceResult = await Payn.findOne({ where: { userid: user.id, currency: 'NGN', status: 1, timed: { [Op.lt]: startOfMonth } }, order: [['timed', 'DESC']] });
        const openingBalance = openingBalanceResult ? openingBalanceResult.newbal : 0;

        const closingBalanceResult = await Payn.findOne({ where: { userid: user.id, currency: 'NGN', status: 1, timed: { [Op.lte]: endOfMonth } }, order: [['timed', 'DESC']] });
        const closingBalance = closingBalanceResult ? closingBalanceResult.newbal : openingBalance;

        const statementRecords = transactions.map(tx => ({
            date: moment.unix(tx.timed).format('YYYY-MM-DD HH:mm'),
            description: (tx.narration || tx.pay_desc),
            reference: tx.txref,
            debit: tx.paytype === 'debit' ? tx.amount : 0,
            credit: tx.paytype === 'credit' ? tx.amount : 0,
            balance: formatAmount(tx.newbal, 2)
        }));

        const totalInflow = statementRecords.reduce((sum, r) => sum + r.credit, 0);
        const totalOutflow = statementRecords.reduce((sum, r) => sum + r.debit, 0);

        const statementData = {
            customerName: `${user.firstname} ${user.lastname}`,
            accountNumber: user.phoneno,
            customerEmail: user.email,
            customerAddress: user.address || 'N/A',
            period: period,
            currency: 'NGN',
            openingBalance: formatAmount(openingBalance, 2),
            totalInflow: formatAmount(totalInflow, 2),
            totalOutflow: formatAmount(totalOutflow, 2),
            closingBalance: formatAmount(closingBalance, 2),
            startdate: startdate,
            enddate: enddate,
            records: statementRecords
        };

        // console.log('statementData', statementData)

        const htmlContent = generateStatementHTML(statementData);
        const page = await browser.newPage();
        await page.setContent(htmlContent, { waitUntil: 'networkidle0', timeout: 60000 });
        const pdfBuffer = await page.pdf({ format: 'A4', printBackground: true });
        await page.close();

        if (!pdfBuffer || pdfBuffer.length === 0) {
            logger.warn(`Generated PDF for user ${user.id} is empty. Skipping email.`);
            return { status: 'skipped' };
        }

        const mailContent = `<p>Hello ${user.firstname},</p><p>Your account statement for ${period} is attached. Thank you for using HitchPay!</p>`;
        logger.info(`Sending statement to ${user.email} for user ID ${user.id}.`);

        const attachments = [{
            content: Buffer.from(pdfBuffer).toString('base64'),
            filename: `HitchPay-Statement-${period}.pdf`,
            type: 'application/pdf',
            disposition: 'attachment'
        }];
        await mailSender(user.firstname, `Your HitchPay Statement for ${period}`, user.email, mailContent, attachments);
        // await mailSender(user.firstname, `Your HitchPay Statement for ${period}`, 'ojidex17@gmail.com', mailContent, attachments);

        await notifyMe(user.id, 'Monthly Statement', 'user', `Your account statement for ${period} has been sent to your email.`);
        logger.info(`Successfully generated and sent statement to user ${user.id}.`);
        return { status: 'success' };

    } catch (error) {
        logger.error(`Failed to process statement for user ${user.id}: ${error.message}`);
        return { status: 'failed', error: error };
    }
};

/**
 * Main function to generate and send monthly statements.
 */

const generateMonthlyStatements = async () => {
    const { secret } = req.params;
    if (secret !== process.env.CRON_SECRET) {
        return res.status(403).json({ status: false, message: 'Unauthorized' });
    }

    logger.info('Starting monthly statement generation job.');
    let browser;
    try {
        const previousMonth = moment().subtract(1, 'month');
        const startOfMonth = previousMonth.startOf('month').unix();
        const endOfMonth = previousMonth.endOf('month').unix();

        // 1. Find users who actually had transactions in the period. This is more efficient.
        const usersWithTransactions = await Payn.findAll({
            attributes: [[db.sequelize.fn('DISTINCT', db.sequelize.col('userid')), 'userid']],
            where: {
                status: 1,
                timed: { [Op.between]: [startOfMonth, endOfMonth] }
            },
            raw: true
        });

        const userIds = usersWithTransactions.map(u => u.userid);

        if (userIds.length === 0) {
            logger.info('No users with transactions in the last month. Statement job finished.');
            return;
        }

        // 2. Fetch full details for only the relevant users.
        const users = await Customer.findAll({
            where: {
                id: { [Op.in]: userIds },
                status: 1, // Active users
                email: { [Op.ne]: null }, // Must have an email
                bvverify: 2, // Must be verified
            }
        });

        if (!users.length) {
            logger.info('No active, verified users with transactions found to send statements to.');
            return;
        }

        logger.info(`Found ${users.length} users to process for statements.`);

        // Set concurrency to a reasonable number based on server resources
        const queue = new PQueue({ concurrency: 4 });
        let successCount = 0;
        let failureCount = 0;
        let skippedCount = 0; // Fixed: Declare skippedCount

        browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });

        // Add each user processing task to the queue
        users.forEach(user => {
            queue.add(async () => {
                const result = await processUserStatement(user, browser);
                if (result.status === 'success') {
                    // show email of user that got it 
                    logger.info(`Statement sent to: ${user.email}`);
                    successCount++;
                } else if (result.status === 'failed') {
                    logger.error(`Failed statement for ${user.email} (User ID: ${user.id}). Reason: ${result.error.message}`);
                    failureCount++;
                } else {
                    skippedCount++;
                }
            });
        });

        // Wait for all tasks in the queue to complete
        await queue.onIdle();

        logger.info(`Monthly statement job finished. Success: ${successCount}, Failed: ${failureCount}, Skipped: ${skippedCount}.`);

    } catch (error) {
        logger.error(`[CRITICAL] The 'generateMonthlyStatements' job failed: ${error.message}`, error);
    } finally {
        if (browser) {
            await browser.close();
            logger.info('Puppeteer browser closed.');
        }
    }
};

module.exports = {
    generateMonthlyStatements
};
