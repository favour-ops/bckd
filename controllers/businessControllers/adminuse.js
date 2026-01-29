const {
    db, moment, Op, logger, uuidv4, cleanMe, md5, axios, randomstring, bcrypt, mailSender,
    Payn, CheckoutTrans, Business, PayLink, getUserInfo, logBeneficiary, pushNotify, notifyMe, sendSMS, LogRequest,
    getBizInfo, FreeTransfersCount, getFee, TransLimit, getBal, updateBalance, Customer, Product, AppSett, psb9Token, shAcessToken, Wallets, genSHBizAccount, Bank
} = require('./_dependencies');

const { formatAmount } = require("../../config/myfunct");
const { where } = require('sequelize');


// get the list of all the business for the admin
const getAllBusinesses = async (req, res) => {
    try {
        const { status, search, page = 1, limit = 100 } = req.query;
        const offset = (page - 1) * limit;

        let whereClause = {};
        if (status) {
            whereClause.status = status;
        }
        if (search) {
            whereClause[Op.or] = [
                { business_name: { [Op.like]: `%${search}%` } },
                { email: { [Op.like]: `%${search}%` } },
                { phone: { [Op.like]: `%${search}%` } },
            ];
        }

        const { count, rows: businesses } = await Business.findAndCountAll({
            where: whereClause,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['regtime', 'DESC']],
        });

        // i only want to return limited info, and status should be formated as active, or inactive
        const formattedBusinesses = businesses.map(business => {
            const statusText = business.status === 1 ? 'Active' : 'Inactive';
            return {
                id: business.id,
                business_name: business.business_name,
                business_email: business.business_email,
                business_phoneno: business.business_phoneno,
                business_type: business.business_type,
                verstatus: statusText,
                status:statusText,
                regtime: moment.unix(business.regtime).format("Do MMM, YYYY hh:mm a"),
                uuid: business.uuid,
            };
        });
        

        return res.status(200).json({
            status: true,
            message: "Businesses retrieved successfully",
            data: formattedBusinesses,
            total: count,
            page: parseInt(page),
            pages: Math.ceil(count / limit),
        });
    } catch (error) {
        logger.error("Error fetching businesses:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to retrieve businesses",
            error: error.message,
        });
    }
};


// get a single business for the admin
const getBusinessAdminDetails = async (req, res) => {
    try {
        const { businessid } = req.params;

        const business = await Business.findOne({ where: { uuid: businessid}});

        if (!business) {
            return res.status(404).json({
                status: false,
                message: "Business not found",
            });
        }

        // owner details
        const businessOwner = await Customer.findOne({ where: { id: business.ownerid } });
        const getacct = await Bank.findOne({ order: [['id', 'DESC']], where: { userid: business.id, usertype: 'business', status: 1 } });

        //gget all the business wallets e.g ngn, usd etc
        const bizWallets = await Wallets.findAll({
            where: { uid: business.id, usertype: 'business' },
            attributes: ['currency', 'wbal', 'ledger', 'status'],
            order: [['currency', 'ASC']]
        });

        const formattedBizWallets = bizWallets.map(wallet => ({
            currency: wallet.currency,
            available_balance: parseFloat(wallet.wbal) || 0,
            ledger_balance: parseFloat(wallet.ledger) || 0,
            status: wallet.status === 1 ? 'active' : 'inactive'
        }));
        
        const formattedBusiness = {
            id: business.id,
            business_name: business.business_name,
            business_email: business.business_email,
            business_phoneno: business.business_phoneno,
            business_type: business.business_type,
            verstatus: business.status === 1 ? 'Active' : 'Inactive',
            status: business.status === 1 ? 'Active' : 'Inactive',
            regtime: moment.unix(business.regtime).format("Do MMM, YYYY hh:mm a"),
            uuid: business.uuid,
            address: business.business_address,
            city: business.business_city,
            state: business.business_state,
            country: business.business_country,
            description: business.business_description,
            website: business.business_website,
            logo: business.business_logo,
            cac_regno:business.cacno,
            cac_regtype:business.cacreg_type,
            cac_certitficate:business.cacreg_cert,
            zip_code: business.postalcode,
            trade_name: business.trade_name,
            business_owner: businessOwner ? {
                id: businessOwner.id,
                firstname: businessOwner.firstname,
                lastname: businessOwner.lastname,
                email: businessOwner.email,
                phone: businessOwner.phoneno,
            } : null,
            wallet: formattedBizWallets.length > 0 ? formattedBizWallets : null,
            accountdetails: {
            bank_name: getacct?.bankname,
            account_number: getacct?.accountno,
            account_name: getacct?.accountname,
            bank_code: getacct?.bankcode,
            account_type: getacct?.accounttype,
            },
        };

        return res.status(200).json({
            status: true,
            message: "Business details retrieved successfully",
            data: formattedBusiness,
        });

    } catch (error) {
        logger.error("Error fetching business:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to retrieve business",
            error: error.message,
        });
    }
};

// update a business status for the admin
const updateBusinessStatus = async (req, res) => {    try {
        const { updstatus, updid } = req.body; 
        // status: 0 for inactive, 1 for active

        if (updstatus === undefined || (updstatus !== 'inactive' && updstatus !== 'active')) {
            return res.status(400).json({
                status: false,
                message: "Invalid status provided. Status must be (inactive) or (active).",
            });
        }

        const business = await Business.findOne({ where: { uuid: updid } });

        if (!business) {
            return res.status(404).json({
                status: false,
                message: "Business not found",
            });
        }

        const theupdstatus = updstatus === 'active' ? 1 : 0;

        await Business.update({ status: theupdstatus }, { where: { uuid: updid } });

        const statusText = updstatus === 'active' ? 'activated' : 'deactivated';

        // generate biz account
        if (updstatus === 'active' && business.business_country == 'NG' && business.cacno) {
            logger.info(`Generating account for business ${business.id} during activation`);
            const shAccountResult = await genSHBizAccount(business.id);

            if (!shAccountResult.status) {
                logger.error(`Failed to generate SH account for business ${business.id} during activation: ${shAccountResult.message}`);
            }
        }
        

        // send email to the business for the status update
        try {
            const subject = `Your Business Account has been ${statusText.charAt(0).toUpperCase() + statusText.slice(1)}`;
            const content = `
                <div>                
                <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                <div style=" background: #FFF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        Dear ${business.business_name},</p>
                        <p style="line-height: 28px; letter-spacing: 0.025em;">
                        We are writing to inform you that your HitchPay business account has been <strong>${statusText}</strong>.
                    </p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        You can ${updstatus === 'active' ? 'now access all features and services' : 'no longer access certain features or services'} associated with your account.
                    </p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;">
                        If you have any questions or require further assistance, please do not hesitate to contact our support team.
                    </p>
                    <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                </div>
                `;
            await mailSender(business.business_name, subject, business.business_email, content);

        } catch (emailError) {
            logger.error(`Error sending email for business status update to ${business.business_email}:`, emailError);
        }
        
        

        return res.status(200).json({
            status: true,
            message: `Business "${business.business_name}" has been successfully ${statusText}.`,
            data: {
                id: business.id,
                business_name: business.business_name,
                new_status: statusText,
            },
        });

    } catch (error) {
        logger.error("Error updating business status:", error);
        return res.status(500).json({
            status: false,
            message: "Failed to update business status",
            error: error.message,
        });
    }
};

module.exports = {
    getAllBusinesses,
    getBusinessAdminDetails,
    updateBusinessStatus
}