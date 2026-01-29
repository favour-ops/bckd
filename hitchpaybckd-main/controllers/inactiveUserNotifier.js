const db = require('../models');
const { Op, Sequelize } = require("sequelize");
const moment = require('moment');
const { mailSender } = require("../config/mailsender");
const { pushNotify } = require("../config/notifyuser");
const { logger } = require('../config/logger');

const Customer = db.customers;
const Payn = db.payn;
const bonusCoupon = db.bonusCoupon;

// Define different messages for different inactivity periods
const messages = {
    3: {
        subject: "We Miss You at HitchPay!",
        body: (name) => `
            <p>Hi ${name || 'Valued Customer'},</p>
            <p>It's been a little while since we last saw you. We're constantly adding new features to make your experience better.</p>
            <p>Come back and check out what's new! As a special welcome back, we have a bonus waiting for you on your next transaction.</p>
            <p>Best,</p>
            <p>The HitchPay Team</p>
        `,
        push: "We miss you at HitchPay! Come back to check out new offers and get a welcome back bonus."
    },
    7: {
        subject: "Don't Miss Out on New Offers at HitchPay!",
        body: (name) => `
            <p>Hi ${name || 'Valued Customer'},</p>
            <p>Just a friendly check-in. You've been away for a week, and we've rolled out some exciting new offers and bill payment options you might love.</p>
            <p>Log in today and get a special <strong>welcome back bonus</strong> on us!</p>
            <p>See you soon,</p>
            <p>The HitchPay Team</p>
        `,
        push: "New offers are waiting for you at HitchPay! Log in to claim your welcome back bonus."
    },
    30: {
        subject: "A Special Welcome Back Bonus Just For You!",
        body: (name) => `
            <p>Hi ${name || 'Valued Customer'},</p>
            <p>We haven't seen you in a month and we'd love to welcome you back. A lot has changed, and we're sure you'll love the improvements.</p>
            <p>To show how much we miss you, we've credited a special bonus to your account, valid on your next transaction. Come back and see what's new!</p>
            <p>Warmly,</p>
            <p>The HitchPay Team</p>
        `,
        push: "It's been a while! We have a special welcome back bonus waiting for you at HitchPay."
    }
};

const newUserMessages = {
    3: {
        subject: "Getting Started with HitchPay!",
        body: (name) => `
            <p>Hi ${name || 'Valued Customer'},</p>
            <p>Welcome to HitchPay! We noticed you haven't made your first transaction yet. Need help getting started?</p>
            <p>You can easily pay bills, buy airtime, and much more. Your first transaction comes with a special bonus!</p>
            <p>Best,</p>
            <p>The HitchPay Team</p>
        `,
        push: "Welcome to HitchPay! Make your first transaction today and get a special bonus."
    },
    7: {
        subject: "Your HitchPay Welcome Bonus is Waiting!",
        body: (name) => `
            <p>Hi ${name || 'Valued Customer'},</p>
            <p>It's been a week since you joined us, and we're excited for you to experience the convenience of HitchPay.</p>
            <p>Don't forget, a special bonus is waiting for you on your very first transaction. Why not give it a try today?</p>
            <p>See you soon,</p>
            <p>The HitchPay Team</p>
        `,
        push: "Your welcome bonus is waiting! Make your first transaction on HitchPay to claim it."
    }
};

const findAndNotifyInactiveUsers = async (days) => {
    logger.info(`[Cron] Starting job to find users inactive for ${days} days.`);

    // Calculate the start and end of the target day 'days' ago.
    const startOfTargetDay = moment().subtract(days, 'days').startOf('day').unix();
    const endOfTargetDay = moment().subtract(days, 'days').endOf('day').unix();

    try {
        // Find customers whose last transaction was on the target day.
        // This is based on their last purchase activity.
        const customers = await Customer.findAll({
            include: [{
                model: Payn,
                as: 'payn',
                attributes: [],
                required: true // INNER JOIN to only get customers with transactions
            }],
            where: { status: 1 }, // Only active customers
            group: ['customers.id'],
            having: Sequelize.literal(`MAX(\`payn\`.\`timed\`) >= ${startOfTargetDay} AND MAX(\`payn\`.\`timed\`) <= ${endOfTargetDay}`)
        });

        if (!customers || customers.length === 0) {
            logger.info(`[Cron] No users found with last activity exactly ${days} days ago.`);
            return;
        }

        logger.info(`[Cron] Found ${customers.length} users inactive for ${days} days. Sending notifications...`);

        const messageTemplate = messages[days];
        if (!messageTemplate) {
            logger.warn(`[Cron] No message template defined for ${days} days of inactivity.`);
            return;
        }

        for (const customer of customers) {
            const customerName = customer.firstname || 'Valued Customer';
            
            if (customer.email) {
                mailSender(customerName, messageTemplate.subject, customer.email, messageTemplate.body(customerName))
                    .catch(err => logger.error(`[Cron] Failed to send email to ${customer.email}: ${err.message}`));
            }

            pushNotify(customer.id, messageTemplate.subject, messageTemplate.push)
                .catch(err => logger.error(`[Cron] Failed to send push notification to user ${customer.id}: ${err.message}`));
        }

        logger.info(`[Cron] Finished sending notifications for ${days}-day inactive users.`);
    } catch (error) {
        logger.error(`[Cron] Error in findAndNotifyInactiveUsers for ${days} days: ${error.message}`);
    }
};

const NotifyInactiveUsers = async (req, res) => {
    // const cronSecret = req.params.secret;
    
    // if (cronSecret !== process.env.CRON_SECRET) {
    // logger.warn('Unauthorized attempt to run inactive user notify cron job.');
    // return res.status(403).json({ status: false, message: 'Forbidden' });
    // }

    try {
        // Find customers who registered and have no transactions.
        const customers = await Customer.findAll({
            include: [{
                model: Payn,
                as: 'payn',
                attributes: [],
                required: false // LEFT JOIN
            }],
            where: {
                status: 1, // Only active customers
                cronupd: { [Op.or]: [0, null] },
                [Op.and]: Sequelize.literal('`payn`.`id` IS NULL') // The condition for no transactions
                // '$payn.id$': { [Op.is]: null } // The condition for no transactions
            },
            group: ['customers.id'], // Group by customer to avoid duplicates
            limit: 50,
            subQuery: false
        });

        if (!customers || customers.length === 0) {
            logger.info(`[Cron] No new users with zero transactions found.`);
            return res.status(400).json({ status: true, message: `[Cron] No new users with zero transactions found`});
        }

        logger.info(`[Cron] Found ${customers.length} new inactive users. Sending notifications...`);

        const userIdsToAssign = customers.map(c => c.id);

        // Update Coupon Assignment for all found users at once
        const couponid = 6;
        const coupon = await bonusCoupon.findByPk(couponid);
        if (coupon) {
            let currentAssigned = { type: 'specific', users: [] };
            try {
                if (coupon.assigned) currentAssigned = JSON.parse(coupon.assigned);
            } catch (e) { logger.error(`[Cron] Error parsing coupon: ${e.message}`); }
            
            const existingUsers = Array.isArray(currentAssigned.users) ? currentAssigned.users : [];
            const uniqueUsers = [...new Set([...existingUsers, ...userIdsToAssign])];
            
            await coupon.update({ assigned: JSON.stringify({ type: 'specific', users: uniqueUsers }) });
        }

        // Update cronupd to 1 for the users
        await Customer.update({ cronupd: 1 }, { where: { id: userIdsToAssign } });

        for (const customer of customers) {
            const customerName = customer.firstname || 'Valued Customer';
            var messageSubject = `We saved a little Christmas gift for you 🎄`;

            if (customer.email) {
                var messageBody = `
                    <p>Hi ${customerName},</p>
                    <p>We noticed you haven't completed your first transaction on HitchPay yet, so we wanted to check in.</p>
                    <p>To welcome you back this holiday season, we've added ₦200 airtime coupon to your account - on us. You can redeem it anytime between now and December 25.</p>
                    <p>Whether you're sending money to friends, shopping online for loved ones, or exploring global payments, HitchPay makes it simple and seamless.</p>
                    <p>Just log in to your HitchPay app, go to the reward page to claim your coupon and enjoy your gift.</p>
                    <p>Wishing you a joyful Christmas✨</p>
                    <p>— The HitchPay Team</p>
                `;

                
                mailSender(customerName, messageSubject, customer.email, messageBody)
                    .catch(err => logger.error(`[Cron] Failed to send email to ${customer.email}: ${err.message}`));
            }

            var messagePush = `Your ₦200 airtime coupon expires soon 🎁. Log in to HitchPay and redeem your Christmas gift before Dec 25.`;

            pushNotify(customer.id, messageSubject, messagePush)
                .catch(err => logger.error(`[Cron] Failed to send push notification to user ${customer.id}: ${err.message}`));
        }

        logger.info(`[Cron] Finished sending notifications inactive users.`);
        return res.status(200).json({ status: true, message: `[Cron] Finished sending notifications inactive users.`});
    } catch (error) {
        logger.error(`[Cron] Error in findAndNotify NewInactiveUsers: ${error.message}`);
        return res.status(400).json({ status: true, message: `[Cron] Error in findAndNotify NewInactiveUsers: ${error.message}`});
    }
};


const runInactiveUserNotifier = async () => {
    logger.info('[Cron] Starting inactive user notification cycle.');
    // For users who have transacted before but are now inactive
    await findAndNotifyInactiveUsers(3);
    await findAndNotifyInactiveUsers(7);
    await findAndNotifyInactiveUsers(30);

    // For new users who have never transacted
    // await findAndNotifyNewInactiveUsers(3);
    // await findAndNotifyNewInactiveUsers(7);

    logger.info('[Cron] Inactive user notification cycle finished.');
};

module.exports = { runInactiveUserNotifier, NotifyInactiveUsers};