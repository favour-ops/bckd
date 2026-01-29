const {
    db, moment, Op, logger, uuidv4, cleanMe, md5, axios, randomstring, bcrypt, mailSender,
    Payn, CheckoutTrans, Business, PayLink, getUserInfo, logBeneficiary, pushNotify, notifyMe, sendSMS, LogRequest,
    getBizInfo, FreeTransfersCount, getFee, TransLimit, getBal, updateBalance, Customer, Product, AppSett, psb9Token, shAcessToken
} = require('./_dependencies');

const { formatAmount } = require("../../config/myfunct");
const { where } = require('sequelize');
const qrcode = require('qrcode');


const getBusinessPaynTransactions = async (req, res, next) => {
    try {
        const { uuid } = req.params;

        if (!uuid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const business = await Business.findOne({
            where: { uuid: uuid },
            attributes: ['id'],
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;
        const { page = 1, limit = 20, status, currency, startDate, endDate } = req.query;

        // The businessAuth and checkBusinessPermission middlewares handle authorization.
        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const whereClause = { userid: busid, usertype: 'business' };

        if (status) whereClause.status = status;
        if (currency) whereClause.currency = currency.toUpperCase();
        if (startDate && endDate) {
            whereClause.timed = {
                [Op.between]: [moment(startDate).startOf('day').unix(), moment(endDate).endOf('day').unix()]
            };
        }

        const { count, rows: transactions } = await Payn.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit, 10),
            offset: offset,
            order: [['id', 'DESC']]
        });

        const formattedTransactions = transactions.map(tx => ({
            id: tx.id,
            reference: tx.txref,
            amount: formatAmount(tx.amount, 2),
            description: tx.pay_desc,
            type: tx.paytype,
            channel: tx.paychannel,
            status: tx.status == 1 ? 'successful' : (tx.status == 0 ? 'pending' : 'failed'),
            currency: tx.currency,
            date: moment.unix(tx.timed).format("Do MMM, YYYY hh:mm A"),
        }));

        return res.status(200).json({
            status: true,
            message: 'Business transactions retrieved successfully.',
            data: {
                totalItems: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page, 10),
                transactions: formattedTransactions
            }
        });

    } catch (error) {
        logger.error('Error in getBusinessPaynTransactions:', error);
        next(error);
    }
};

const getBizTransDetails = async (req, res, next) => {
    try {
        const { uuid, reference } = req.params;

        if (!uuid || !reference) {
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
        }

        const business = await Business.findOne({
            where: { uuid: uuid },
            attributes: ['id'],
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;
        const transaction = await Payn.findOne({
            where: {
                userid: busid,
                usertype: 'business',
                txref: reference
            }
        });

        if (!transaction) {
            return res.status(404).json({ status: false, message: 'Transaction not found.' });
        }

        const formattedTransaction = {
            id: transaction.id,
            reference: transaction.txref,
            amount: formatAmount(transaction.amount, 2),
            amount_val: formatAmount(transaction.amountval, 2),
            fee: formatAmount(transaction.fee, 2),
            description: transaction.pay_desc,
            narration: transaction.narration,
            type: transaction.paytype,
            channel: transaction.paychannel,
            status: transaction.status == 1 ? 'successful' : (transaction.status == 0 ? 'pending' : 'failed'),
            currency: transaction.currency,
            recipient: transaction.recipient,
            network: transaction.ntwk,
            product: transaction.pfor,
            date: moment.unix(transaction.timed).format("Do MMM, YYYY hh:mm A"),
            metadata: transaction.meta ? JSON.parse(transaction.meta) : null,
            new_balance: formatAmount(transaction.newbal, 2),
            previous_balance: formatAmount(transaction.prevbal, 2),
        };

        return res.status(200).json({
            status: true,
            message: 'Transaction details retrieved successfully.',
            data: formattedTransaction
        });

    } catch (error) {
        logger.error('Error in getBusinessPayn TransactionDetails:', error);
        next(error);
    }
};


const getBusinessCheckoutTransactions = async (req, res, next) => {
    try {
        const { uuid } = req.params;

        if (!uuid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const business = await Business.findOne({
            where: { uuid: uuid },
            attributes: ['id'],
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;

        const { page = 1, limit = 20, status, currency, startDate, endDate } = req.query;

        const offset = (parseInt(page, 10) - 1) * parseInt(limit, 10);
        const whereClause = {
            ownerid: busid,
            usertype: 'business'
        };

        if (status) whereClause.status = status;
        if (currency) whereClause.currency = currency.toUpperCase();
        if (startDate && endDate) {
            whereClause.timed = {
                [Op.between]: [moment(startDate).startOf('day').unix(), moment(endDate).endOf('day').unix()]
            };
        }

        const { count, rows: transactions } = await CheckoutTrans.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit, 10),
            offset: offset,
            order: [['id', 'DESC']]
        });

        const formattedTransactions = transactions.map(tx => ({
            id: tx.id,
            reference: tx.reference,
            external_reference: tx.external_reference,
            amount: formatAmount(tx.amount, 2),
            amount_paid: formatAmount(tx.payment_amount, 2),
            fee: formatAmount(tx.fee, 2),
            description: tx.pay_desc,
            channel: tx.paychannel,
            status: tx.status == 1 ? 'successful' : (tx.status == 0 ? 'pending' : 'failed'),
            currency: tx.currency,
            customer_name: tx.customer_name,
            customer_email: tx.customer_email,
            date: moment.unix(tx.timed).format("Do MMM, YYYY hh:mm A"),
        }));

        return res.status(200).json({
            status: true,
            message: 'Business checkout transactions retrieved successfully.',
            data: {
                totalItems: count,
                totalPages: Math.ceil(count / limit),
                currentPage: parseInt(page, 10),
                transactions: formattedTransactions
            }
        });

    } catch (error) {
        logger.error('Error in getBusinessCheckoutTransactions:', error);
        next(error);
    }
};

// get transactions details from CheckoutTrans suing the reference
const getCheckoutTransactionDetails = async (req, res, next) => {
    try {
        const { uuid, reference } = req.params;

        if (!uuid || !reference) {
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
        }

        const business = await Business.findOne({
            where: { uuid: uuid },
            attributes: ['id'],
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;

        const transaction = await CheckoutTrans.findOne({
            where: {
                ownerid: busid,
                usertype: 'business',
                reference: reference
            }
        });

        if (!transaction) {
            return res.status(404).json({ status: false, message: 'Transaction not found.' });
        }

        const formattedTransaction = {
            id: transaction.id,
            reference: transaction.reference,
            external_reference: transaction.external_reference,
            amount: !transaction.amount ? 0 : formatAmount(transaction.amount, 2),
            amount_paid: !transaction.payment_amount ? 0 : formatAmount(transaction.payment_amount, 2),
            fee: !transaction.fee ? 0 : formatAmount(transaction.fee, 2),
            description: transaction.pay_desc,
            channel: transaction.paychannel,
            status: transaction.status == 1 ? 'successful' : (transaction.status == 0 ? 'pending' : 'failed'),
            currency: transaction.currency,
            customer_name: transaction.customer_name,
            customer_email: transaction.customer_email,
            date: moment.unix(transaction.timed).format("Do MMM, YYYY hh:mm A"),
            metadata: transaction.meta ? JSON.parse(transaction.meta) : null,
            payment_method: transaction.paymethod,
            ip_address: transaction.ipaddress,
            user_agent: transaction.useragent,
        };

        return res.status(200).json({
            status: true,
            message: 'Transaction details retrieved successfully.',
            data: formattedTransaction
        });

    } catch (error) {
        logger.error('Error in getBusinessCheckoutTransactionDetails:', error);
        next(error);
    }

}


const createBusinessPayLink = async (req, res, next) => {
    const t = await db.sequelize.transaction();
    try {

        const { bizid, tagname, description, currencies } = cleanMe(req.body);

        if (!bizid || !tagname || !currencies) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Business ID, tag name, and currencies are required.' });
        }

        if (!Array.isArray(currencies) || currencies.length == 0) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Currencies must be a non-empty array.' });
        }

        const business = await Business.findOne({ where: { uuid: bizid }, transaction: t });
        if (!business) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Business not found.' });
        }

        // Generate a unique slug
        const busid = business.id;
        let slug = tagname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '');
        let existingLink = await PayLink.findOne({ where: { slug: slug }, transaction: t });

        let counter = 1;
        while (existingLink) {
            slug = `${tagname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '')}-${counter}`;
            existingLink = await PayLink.findOne({ where: { slug: slug }, transaction: t });
            counter++;
        }

        const envtype = process.env.APPENV === 'production' ? 'live' : 'test';

        const dtimed = Math.floor(Date.now() / 1000);
        const newPayLink = await PayLink.create({
            userid: busid, usertype: 'business', tagname, envtype: envtype,
            slug, description, currencies: currencies, timed: dtimed,
            status: 1, reference: uuidv4()
        }, { transaction: t });

        await t.commit();

        res.status(201).json({
            status: true,
            message: 'Payment link created successfully.',
            data: newPayLink,
        });

    } catch (error) {
        if (t && !t.finished) await t.rollback();
        logger.error('Error in createBusinessPayLink:', error);
        next(error);
    }
};

const getBusinessPayLinks = async (req, res, next) => {
    try {
        const { uuid } = req.params;
        if (!uuid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const business = await Business.findOne({
            where: { uuid: uuid },
            attributes: ['id'],
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const bizid = business.id;

        let payLinks
        if (process.env.APPENV == 'production') {
            payLinks = await PayLink.findAll({
                where: { userid: bizid, usertype: 'business', envtype: 'live' },
                order: [['id', 'DESC']],
            });
        } else {
            payLinks = await PayLink.findAll({
                where: { userid: bizid, usertype: 'business', envtype: 'test' },
                order: [['id', 'DESC']],
            });
        }


        // format the timed field to readable date
        payLinks.forEach(link => {
            const date = new Date(link.timed * 1000);
            link.dataValues.created_at = date.toISOString();
        });

        // status 1 = active, 0 = inactive
        const formattedPayLinks = payLinks.map(link => ({
            id: link.id,
            userid: link.userid,
            usertype: link.usertype,
            tagname: link.tagname,
            slug: link.slug,
            envtype: link.envtype,
            payurl: link.envtype == 'live' ? `https://payment.hitchpay.ng/${link.slug}` : `https://dev-payment.hitchpay.ng/${link.slug}`,
            description: link.description,
            currencies: link.currencies,
            status: link.status,
            statusText: link.status == 1 ? 'Active' : 'Inactive',
            reference: link.reference,
            timed: link.timed,
            created_at: link.dataValues.created_at,
        }));

        return res.status(200).json({
            status: true,
            message: 'Payment links retrieved successfully.',
            data: formattedPayLinks,
        });

    } catch (error) {
        logger.error('Error in getBusinessPayLinks:', error);
        next(error);
    }
};

//function to update business pay link - activate/deactivate
const updateBusinessPayLinkStatus = async (req, res, next) => {
    try {
        const { bizid, paylinkid, status } = cleanMe(req.body);

        if (!bizid || !paylinkid || (status == undefined || status == null)) {
            return res.status(400).json({ status: false, message: 'Business ID, PayLink ID, and status are required.' });
        }

        //get business by uuid
        const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id'] });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;


        if (status !== 'active' && status !== 'disabled') {
            return res.status(400).json({ status: false, message: 'Invalid status. Must be inactive or active.' });
        }

        const payLink = await PayLink.findOne({
            where: { id: paylinkid, userid: busid, usertype: 'business' },
        });

        if (!payLink) {
            return res.status(404).json({ status: false, message: 'Payment link not found for this business.' });
        }

        const thestatus = status == 'active' ? 1 : 0;
        await payLink.update({ status: thestatus }, { where: { id: paylinkid } });

        const statusMessage = status == 'active' ? 'activated' : 'deactivated';

        return res.status(200).json({
            status: true,
            message: `Payment link successfully ${statusMessage}.`,
            data: {
                id: payLink.id,
                tagname: payLink.tagname,
                status: payLink.status,
                statusText: status == 'active' ? 'Active' : 'Inactive',
            },
        });

    } catch (error) {
        logger.error('Error in updateBusinessPayLinkStatus:', error);
        next(error);
    }
};


const deleteBusinessPayLink = async (req, res, next) => {
    try {
        const { bizid, paylinkid } = cleanMe(req.body);

        if (!bizid || !paylinkid) {
            return res.status(400).json({ status: false, message: 'Business ID and PayLink ID are required.' });
        }

        //get business by uuid
        const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id'] });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;

        const payLink = await PayLink.findOne({
            where: { id: paylinkid, userid: busid, usertype: 'business' },
        });

        if (!payLink) {
            return res.status(404).json({ status: false, message: 'Payment link not found for this business.' });
        }

        await payLink.destroy();

        return res.status(200).json({
            status: true,
            message: 'Payment link deleted successfully.',
        });

    } catch (error) {
        logger.error('Error in deleteBusinessPayLink:', error);
        next(error);
    }
};

//edit payment link details - tagname, description, currencies
const editBusinessPayLink = async (req, res, next) => {
    try {
        const { bizid, paylinkid, tagname, description, currencies } = cleanMe(req.body);

        if (!bizid || !paylinkid) {
            return res.status(400).json({ status: false, message: 'Business ID and PayLink ID are required.' });
        }

        //get business by uuid
        const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id'] });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busid = business.id;

        if (!tagname && !description && (!currencies || currencies.length == 0)) {
            return res.status(400).json({ status: false, message: 'At least one field (tagname, description, or currencies) must be provided for update.' });
        }

        if (currencies && (!Array.isArray(currencies) || currencies.length == 0)) {
            return res.status(400).json({ status: false, message: 'Currencies must be a non-empty array if provided.' });
        }

        const payLink = await PayLink.findOne({
            where: { id: paylinkid, userid: busid, usertype: 'business' },
        });

        if (!payLink) {
            return res.status(404).json({ status: false, message: 'Payment link not found for this business.' });
        }

        // Update fields if provided
        if (tagname) {
            // Check for slug uniqueness if tagname changes
            let newSlug = tagname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '');
            let existingLinkWithNewSlug = await PayLink.findOne({ where: { slug: newSlug, id: { [Op.ne]: paylinkid } } });

            let counter = 1;
            while (existingLinkWithNewSlug) {
                newSlug = `${tagname.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-*|-*$/g, '')}-${counter}`;
                existingLinkWithNewSlug = await PayLink.findOne({ where: { slug: newSlug, id: { [Op.ne]: paylinkid } } });
                counter++;
            }
            payLink.tagname = tagname;
            payLink.slug = newSlug;
        }
        if (description) {
            payLink.description = description;
        }
        if (currencies && currencies.length > 0) {
            payLink.currencies = currencies;
        }

        await payLink.save();

        return res.status(200).json({
            status: true,
            message: 'Payment link updated successfully.',
            data: {
                id: payLink.id,
                tagname: payLink.tagname,
                slug: payLink.slug,
                description: payLink.description,
                currencies: payLink.currencies,
            },
        });

    } catch (error) {
        logger.error('Error in editBusinessPayLink:', error);
        next(error);
    }
};


const bizPaymentQRCode = async (req, res, next) => {
    try {

        const { uuid } = req.params;

        if (!uuid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const getuser = await Business.findOne({
            where: { uuid: uuid },
            attributes: ['id', 'business_name', 'business_phoneno'],
        });
        if (!getuser)
            return res.status(400).json({ status: false, message: 'Business details not found. Kindly reload page' });

        // Construct the payment URL
        const paymentUrl = `https://apps.hitchpay.ng/T2JB/qrpay/?bizphone=${getuser.business_phoneno}`;

        // Generate the QR code as a data URI
        const qrCodeDataUri = await qrcode.toDataURL(paymentUrl);

        res.json({
            status: true,
            message: `Payment QR code generated successfully`,
            data: {
                customerName: `${getuser.business_name}`,
                paymentUrl: paymentUrl,
                qrCode: qrCodeDataUri,
            }
        });

    } catch (err) {
        logger.error('Error in generate biz Payment QRCode:', err);
        next(err);
    }
};

const bizTransferPayment = async (req, res, next) => {
    try {

        let { amount, recipientno, bankname, bankcode, accountname, isbeneficiary, narration, enquirytoken, transpin, envroute, currency, bizid } = cleanMe(req.body);
        const teamid = req.user.id;

        // console.log('req.body', req.body)
        // console.log('teamid', teamid)

        const uuid = bizid;
        if (!teamid || (teamid == '')) return res.status(400).json({ status: false, message: 'Invalid request sent' });
        if (!uuid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });
        if (!amount || (amount == '')) return res.status(400).json({ status: false, message: 'Kindly enter amount' });
        if (parseFloat(amount) <= 0) return res.status(400).json({ status: false, message: 'Invalid amount sent.' });
        if (!transpin || (transpin == '')) return res.status(400).json({ status: false, message: 'Kindly enter your transaction PIN' });
        if (!recipientno || (recipientno == '')) return res.status(400).json({ status: false, message: 'Kindly enter recipient phone number' });
        if (!bankname || (bankname == '')) return res.status(400).json({ status: false, message: 'No provider Selected' });
        if (!currency) { currency = 'NGN' }; // Ensure currency has a default value if it's null or undefined

        const getBusiness = await Business.findOne({ where: { uuid: uuid } });

        const txref = 'HTCHB' + md5(randomstring.generate(3) + getBusiness.id).toUpperCase().substring(0, 10);
        let timed = Date.parse(new Date()) / 1000;
        let topay; let prdamnt; let revenue = 0;
        let providerfee = 0;
        let pay_desc_transfer = `Transfer to ${accountname || recipientno}`;

        //check access
        if (teamid) {
            const teamMember = await db.bizteam.findOne({ where: { customerid: teamid, bizid: getBusiness.id } });
            if (!teamMember) {
                return res.status(403).json({ status: false, message: 'Unauthorized: Access Denied to this Business' });
            }

            if (!teamMember.can_debit && teamMember.role != 'owner') {
                return res.status(403).json({ status: false, message: 'Unauthorized: You do not have a debit permission.' });
            }
        }


        const userinfo = await getUserInfo(teamid);
        // const sourcephone = userinfo.phoneno;
        // const sendername = `${userinfo.lastname} ${userinfo.firstname}`;
        const useremail = userinfo.email;
        const authpin = userinfo.authpin;
        const bvverify = userinfo.bvverify;
        const histier = userinfo.accounttier;

        //get biz info
        const bizname = getBusiness.business_name;
        var sendername = getBusiness.business_name;
        const bizemail = getBusiness.business_email;
        const sourcephone = getBusiness.business_phoneno;
        const busid = getBusiness.id;

        if (!authpin) return res.status(400).json({ status: false, message: 'Kindly setup your transaction PIN to proceed.' });
        if (!bcrypt.compareSync(transpin, authpin)) return res.status(400).json({ status: false, message: 'Invalid Transaction PIN.' });

        // if (bvverify != 2) return res.status(400).json({ status: false, message: 'Kindly complete your tier 1 verification to proceed.' });
        // if (!histier) return res.status(400).json({ status: false, message: 'Kindly complete your account KYC to proceed.' });

        // GET LIMIT
        // const accountLimit = await TransLimit(histier);
        // const transferlimit = accountLimit[2];
        // const dailytrans = accountLimit[3];
        // const free_transfer_allowance = accountLimit[4];
        const free_transfer_allowance = 0;

        /* if (parseFloat(amount) > parseFloat(transferlimit)) {
            return res.status(400).json({ status: false, message: `You cannot transfer above your account transfer limit of ${currency}${formatAmount(transferlimit)}.` });
        } */

        /* const transToday = await OutflowToday(teamid);
        if ((parseFloat(transToday) + parseFloat(amount)) > parseFloat(dailytrans)) {
            return res.status(400).json({ status: false, message: `This transaction exceeds your daily limit of ${currency}${formatAmount(dailytrans)}.` });
        } */

        const checkFeeProduct = await Product.findOne({ where: { category: 'transfer', status: 1 } });
        if (!checkFeeProduct) return res.status(400).json({ status: false, message: 'Transfer service is currently unavailable.' });

        if (bankcode.toLowerCase() === 'hitchpay') {
            prdamnt = 0;
        } else {
            const freetransfer_used_count = await FreeTransfersCount(teamid);

            const [feeAmount, prvFee] = await getFee('transfer', amount);
            providerfee = parseFloat(prvFee) || 0;
            prdamnt = parseFloat(feeAmount) || 0;
            revenue = prdamnt - providerfee;

            /*  if (parseInt(freetransfer_used_count) >= parseInt(free_transfer_allowance)) {
                 prdamnt = parseFloat(feeAmount) || 0;
                 revenue = prdamnt - providerfee;
             } else {
                 prdamnt = 0;
                 revenue = prdamnt - providerfee;
             } */
        }

        topay = parseFloat(amount) + prdamnt;
        if (parseFloat(amount) < 50 && currency == 'NGN') return res.status(400).json({ status: false, message: 'You cannot transfer below N50.00.' });

        if (parseFloat(amount) < 1 && currency != 'NGN') return res.status(400).json({ status: false, message: `You cannot transfer below ${currency}1.00` });

        if (userinfo.status != '1') return res.status(400).json({ status: false, message: 'Your account is not active.' });
        if (userinfo.status == '3') return res.status(400).json({ status: false, message: 'Your account is on hold.' });

        const userbal = await getBal(busid, currency, {}, 'business');
        if (userbal < topay)
            return res.status(400).json({ status: false, message: `Insufficient balance for ${currency}${formatAmount(topay)} on you business account.` });

        if (bankcode.toLowerCase() === 'hitchpay') {
            const getreceiver = await Customer.findOne({
                where: { [Op.or]: [{ phoneno: { [Op.like]: `%${recipientno}%` } }, { uname: recipientno }] }
            });
            if (!getreceiver) return res.status(400).json({ status: false, message: 'Invalid HitchPay recipient account.' });

            if (getreceiver.id == teamid) return res.status(400).json({ status: false, message: 'You cannot transfer to yourself.' });
            pay_desc_transfer = `Transfer to ${getreceiver.firstname} ${getreceiver.lastname}`;
        }

        const env = (envroute === 'web') ? 'web' : 'app';

        // --- Stage 1: Debit Sender & Log Initial ---
        const debitSenderTransaction = await db.sequelize.transaction();

        try {
            // charge the sending customer and log the trnsactin
            const newbalSender = await updateBalance(busid, topay, currency, 'debit', { transaction: debitSenderTransaction }, false, 'business');

            const meta_data_sender = JSON.stringify({ sourcename: accountname, sourceaccount: recipientno, sourcebank: bankname });

            await Payn.create({
                userid: busid, amount: topay, amountval: parseFloat(amount), newbal: newbalSender, prevbal: userbal,
                txref: txref, pfor: 'transfer', usertype: 'business', paytype: 'debit', productid: '', ntwk: bankname,
                paidthru: 'Wallet', pay_desc: pay_desc_transfer, timed: timed, status: 0, // Pending
                recipient: recipientno, ntwkid: bankcode, meta: meta_data_sender, fee: prdamnt,
                narration: narration, revenue: revenue, payroute: env, currency: currency, providerfee: 0
            }, { transaction: debitSenderTransaction }
            );

            await debitSenderTransaction.commit();

        } catch (debitError) {

            await debitSenderTransaction.rollback();

            logger.error(`Debit failed for transfer ${txref}:`, debitError);

            return res.status(400).json({ status: false, message: 'Failed to debit your account. Please try again.' });
        }



        // --- Stage 2: Perform Transfer (Internal or External) ---
        if (bankcode.toLowerCase() === 'hitchpay') {

            const internalTransferTransaction = await db.sequelize.transaction();
            let dtxref_receiver, receiverid, receiverName, receivermail, newbalReceiver;

            try {

                const getreceiver = await Customer.findOne({ where: { phoneno: { [Op.like]: `%${recipientno}%` } }, transaction: internalTransferTransaction });

                if (!getreceiver) {
                    throw new Error("Receiver not found");
                }

                receiverid = getreceiver.id;
                receivermail = getreceiver.email;
                receiverName = `${getreceiver.firstname} ${getreceiver.lastname}`;

                // CREDIT THE RECEIVER AND LOG
                const receiverbal_before = await getBal(receiverid, currency, { transaction: internalTransferTransaction });

                newbalReceiver = await updateBalance(receiverid, parseFloat(amount), currency, 'credit', { transaction: internalTransferTransaction }, true);

                dtxref_receiver = 'HTCH' + md5(randomstring.generate(3) + receiverid).toUpperCase().substring(0, 10);
                const meta_data_receiver = JSON.stringify({ sourcename: sendername, sourceaccount: sourcephone, sourcebank: 'HitchPay' });

                // Log for receiver
                await Payn.create({
                    userid: receiverid, recipient: sourcephone, amount: parseFloat(amount), amountval: parseFloat(amount), currency: currency, newbal: newbalReceiver, prevbal: receiverbal_before, txref: dtxref_receiver, pfor: 'wallet',
                    usertype: 'user', paytype: 'credit', productid: txref, paychannel: 'hitchpay',
                    paidthru: 'hitchpay', meta: meta_data_receiver, ntwkid: bankcode, ntwk: 'HitchPay', pay_desc: `Transfer from ${sendername}`, narration: narration, timed: timed, status: 1,
                    payroute: env, fee: 0, revenue: 0, providerfee: 0
                }, { transaction: internalTransferTransaction });


                // Update sender's log
                await Payn.update({
                    status: 1, productid: dtxref_receiver, revenue: revenue, providerfee: 0
                }, { where: { txref: txref, userid: busid }, transaction: internalTransferTransaction }
                );

                if (isbeneficiary) {
                    await logBeneficiary(busid, 'transfer', recipientno, bankname, bankcode, accountname, { transaction: internalTransferTransaction }, 'business');
                }

                await internalTransferTransaction.commit();

                // Notifications
                //notifier the receiver
                pushNotify(receiverid, 'Funding Alert - HitchPay', `You just received ${currency}${formatAmount(amount)} from ${sendername}.`, 'personal');

                mailSender(receiverName, 'Wallet Funding', receivermail, `You have received ${currency}${formatAmount(amount)} from ${sendername} via HitchPay. Ref: ${dtxref_receiver}.`);

                //notifier the sender
                pushNotify(busid, 'Transaction Notice - HitchPay', `Your ${currency}${formatAmount(amount)} transfer to ${receiverName} (${recipientno}) was successful.`, 'business');

                /* CHECK FOR REFERREAL BONUS */
                // await logReferEarn(userid, dtxref_receiver);

                var transtimed = moment.unix(timed).local().format("Do MMM, YYYY hh:mm a")

                var thecontent = `
                <div>
                <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Hello ${getreceiver.firstname} <span style="font-size: 18px;">😍</span></p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        You have just received funds in your wallet through ${recipientno}(HitchPay)
                    </p>

                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> ${currency}${formatAmount(amount)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> HitchPay</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${sourcephone}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${sendername}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${dtxref_receiver}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> ${currency}${formatAmount(0)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Stamp duty:</strong> ${currency}${formatAmount(0)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> ${currency}${formatAmount(newbalReceiver)}</p> <br>
                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                </div>
                `;

                mailSender(getreceiver.firstname, 'Wallet Funding', receivermail, thecontent);

                res.json({
                    status: true, message: 'Transfer Successful.',
                    data: { amount: parseFloat(amount), amountcharged: topay, fee: prdamnt, reference: txref, sessionid: dtxref_receiver, paystatus: 'Successful', transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a") }
                });

            } catch (internalError) {
                await internalTransferTransaction.rollback();
                logger.error(`Internal transfer failed for ${txref}:`, internalError);

                // For now, log and inform user.
                await Payn.update({ status: 5, pay_desc: `${pay_desc_transfer} (Failed - Internal Error)` }, { where: { txref: txref, userid: busid } });

                res.status(400).json({ status: false, message: 'Internal transfer failed. Please contact support.' });
            }

        } else {

            // External Bank Transfer
            let ftApiResponse;

            try {

                // const FTProvider = '9psb';
                const getsett = await AppSett.findOne({ where: { id: 1 } });
                const FTProvider = getsett.ftprovider;

                if (FTProvider.toLowerCase() == 'safehaven') {
                    var provider = 'safehaven';

                    const gettoken = await shAcessToken();
                    if (!gettoken[0]) throw new Error('Service provider unavailable.');
                    const payload = JSON.stringify({
                        saveBeneficiary: false,
                        nameEnquiryReference: enquirytoken, debitAccountNumber: process.env.SH_DEBITACCOUNT,
                        beneficiaryBankCode: bankcode, beneficiaryAccountNumber: recipientno, amount: parseFloat(amount),
                        narration: `${bizname} - ${narration}`,
                        paymentReference: txref
                    });

                    // console.log(payload)

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
                    ftApiResponse = response.data;

                } else {

                    /* 9PSB TRANSDFER */
                    var provider = '9psb';
                    const gettoken = await psb9Token();
                    if (!gettoken[0]) throw new Error('Service provider unavailable.');

                    // hash the payload
                    const tohash = process.env.PSBNK_PRVKEY + process.env.PSBNK_DEBITACCT + recipientno + bankcode + toTwoDecimal(amount) + txref;

                    // console.log('tohash', tohash)
                    const hashed_string = (crypto.createHash('sha512').update(tohash).digest('hex')).toUpperCase();

                    const payload = JSON.stringify({
                        transaction: { reference: txref },
                        order: {
                            amount: toTwoDecimal(amount), //double
                            description: `${bizname} - ${pay_desc_transfer}`,
                            currency: "NGN",
                            country: "NGA"
                        },
                        customer: {
                            account: {
                                number: recipientno,
                                bank: bankcode, name: 'HitchPay',
                                senderaccountnumber: process.env.PSBNK_DEBITACCT,
                                sendername: accountname
                            }
                        },
                        hash: hashed_string
                    });

                    await LogRequest.create({ reference: txref, jsonreq: payload, timed: timed, product: 'transfer', provider: '9psb' });

                    const theHeader = {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        authorization: `Bearer ${gettoken[1]}`
                    };

                    // console.log('theHeader', theHeader)

                    const options = {
                        method: 'POST',
                        url: `${process.env.PSBNK_FTURL}/merchant/account/transfer`,
                        headers: theHeader,
                        data: payload
                    };

                    // console.log('payload', payload)

                    let response = await axios.request(options);
                    ftApiResponse = response.data;
                }

                // console.log('transferApiResponse', ftApiResponse)

                if ((ftApiResponse.statusCode == 200 && ftApiResponse.responseCode == '00') || ftApiResponse.code == '00') {

                    if (provider == '9psb') {
                        var sessID = ftApiResponse['transaction']['externalreference'];
                    } else {
                        var sessID = ftApiResponse.data.sessionId;
                    }

                    await Payn.update({
                        status: 1, paychannel: provider, productid: sessID,
                        jsonresp: JSON.stringify(ftApiResponse), revenue: revenue, providerfee: providerfee
                    }, { where: { txref: txref, userid: busid } });

                    if (isbeneficiary) {
                        await logBeneficiary(busid, 'transfer', recipientno, bankname, bankcode, accountname, {}, 'business');
                    }

                    pushNotify(busid, 'Transaction Notice - HitchPay', `Your NGN${formatAmount(amount)} transfer to ${accountname} (${recipientno}) was successful.`, 'business');

                    /* CHECK FOR REFERREAL BONUS */
                    // await logReferEarn(userid, txref);

                    res.json({
                        status: true, message: 'Transfer Successful.',
                        data: {
                            amount: parseFloat(amount), amountcharged: topay, fee: prdamnt,
                            reference: txref, sessionid: sessID, paystatus: 'Successful',
                            transtimed: moment.unix(timed).format("Do MMM, YYYY hh:mm a")
                        }
                    });

                } else {
                    // throw new Error(ftApiResponse.message || 'Transfer failed with provider.');
                    throw new Error('Unable to process your request, kindly retry shortly');
                }

            } catch (externalError) {
                await Payn.update({ jsonresp: JSON.stringify(ftApiResponse || { error: externalError.message }), pay_desc: `${pay_desc_transfer} (Failed - Provider Error)` }, { where: { txref: txref, userid: busid } });
                logger.error(`External transfer failed for ${txref}:`, externalError);
                if (externalError.response && externalError.response.data) {
                    console.error('usacct detail Error response data:', JSON.stringify(externalError.response.data, null, 2));
                    // return res.status(400).json({ status: false, message: externalError.response.data.message, data: {errortype: ""} });
                    return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
                } else {
                    return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly', data: { errortype: "" } });
                }
            }
        }

    } catch (error) {
        next(error); // Pass the error to the global error handler
    }
}

module.exports = {
    getBusinessPaynTransactions,
    getBusinessCheckoutTransactions,
    createBusinessPayLink,
    getBusinessPayLinks,
    updateBusinessPayLinkStatus,
    deleteBusinessPayLink,
    editBusinessPayLink, bizPaymentQRCode, bizTransferPayment,
    getCheckoutTransactionDetails,
    getBizTransDetails
};                     