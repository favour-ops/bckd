const {
    Payn, Business, Wallets, BizTeam, 
    Sequelize, Op, moment, logger
} = require('./_dependencies');
const { formatAmount } = require("../../config/myfunct");

const getBusinessDashboardStats = async (req, res, next) => {
    try {
        const { uuid } = req.params;
        const business = await Business.findOne({ where: { uuid }, attributes: ['id', 'currency'] });
        
        if (!business) return res.status(404).json({ status: false, message: 'Business not found.' });
        
        const busid = business.id;
        const currency = business.currency || 'NGN';
        const startOfDay = moment().startOf('day').unix();
        const startOfMonth = moment().startOf('month').unix();

        // 1. Get Wallet Balances
        const wallets = await Wallets.findAll({ where: { userid: busid, usertype: 'business' } });

        // 2. Aggregate Inflow/Outflow (Today & Total)
        const stats = await Payn.findAll({
            where: { userid: busid, usertype: 'business', status: 1 },
            attributes: [
                [Sequelize.fn('SUM', Sequelize.literal("CASE WHEN paytype = 'credit' THEN amountval ELSE 0 END")), 'totalInflow'],
                [Sequelize.fn('SUM', Sequelize.literal("CASE WHEN paytype = 'debit' THEN amountval ELSE 0 END")), 'totalOutflow'],
                [Sequelize.fn('SUM', Sequelize.literal(`CASE WHEN paytype = 'credit' AND timed >= ${startOfDay} THEN amountval ELSE 0 END`)), 'todayInflow'],
                [Sequelize.fn('SUM', Sequelize.literal(`CASE WHEN paytype = 'debit' AND timed >= ${startOfDay} THEN amountval ELSE 0 END`)), 'todayOutflow']
            ],
            raw: true
        });

        // 3. Get 7-Day Revenue Trend
        const sevenDaysAgo = moment().subtract(7, 'days').startOf('day').unix();
        const chartData = await Payn.findAll({
            where: { 
                userid: busid, 
                usertype: 'business', 
                status: 1, 
                paytype: 'credit',
                timed: { [Op.gte]: sevenDaysAgo }
            },
            attributes: [
                [Sequelize.fn('DATE_FORMAT', Sequelize.fn('FROM_UNIXTIME', Sequelize.col('timed')), '%Y-%m-%d'), 'date'],
                [Sequelize.fn('SUM', Sequelize.col('amountval')), 'amount']
            ],
            group: ['date'],
            order: [[Sequelize.literal('date'), 'ASC']],
            raw: true
        });

        return res.status(200).json({
            status: true,
            data: {
                summary: {
                    totalInflow: formatAmount(stats[0].totalInflow || 0),
                    totalOutflow: formatAmount(stats[0].totalOutflow || 0),
                    todayInflow: formatAmount(stats[0].todayInflow || 0),
                    todayOutflow: formatAmount(stats[0].todayOutflow || 0),
                    currency
                },
                wallets: wallets.map(w => ({ currency: w.currency, balance: formatAmount(w.wbal) })),
                revenueChart: chartData
            }
        });
    } catch (error) {
        logger.error('Error in getBusinessDashboardStats:', error);
        next(error);
    }
};

module.exports = { getBusinessDashboardStats };