const { success, error } = require("../../utils/pubapi_response.js");
const { cleanMe } = require("../../config/myfunct.js");
const db = require('../../models/index.js');
const { Op } = require('sequelize'); // Sequelize Operator
const { logger } = require('../../config/logger.js');
const { Business } = require("../businessControllers/_dependencies.js");

const Customer = db.customers;
const Bank = db.bankacct;


const getCustomerNgnAccount = async (req, res, next) => {
  try {
    const { identifier, identifiertype} = cleanMe(req.body);

    if (!identifier) {
      return error(res, "INVALID_REQUEST", "Email or phone number is required.", 400);
    }

    if (!identifiertype) {
      return error(res, "INVALID_REQUEST", "Unable to identify the request", 400);
    }

    let customer;
    if(identifiertype == 'business'){

      // Find the customer by email or phone number
      customer = await Business.findOne({
        where: {
          [Op.or]: [
            { business_email: identifier }, { business_phoneno: identifier }
          ]
        },
        attributes: ['id', 'business_name', 'business_email', 'business_phoneno']      
      });
  
      if (!customer) {
        return error(res, "NOT_FOUND", "Customer not found.", 404);
      }

      var ownerName = `${customer.business_name}`;
      var ownerEmail = customer.business_email;
      var ownerPhone = customer.business_phoneno;
      var usertype = 'business';


    }else{
      // Find the customer by email or phone number
      customer = await Customer.findOne({
        where: {
          [Op.or]: [
            { email: identifier }, { phoneno: identifier }
          ]
        },
        attributes: ['id', 'firstname', 'lastname', 'email', 'phoneno'],
      });
  
      if (!customer) {
        return error(res, "NOT_FOUND", "Customer not found.", 404);
      }

      var ownerName = `${customer.firstname} ${customer.lastname}`;
      var ownerEmail = customer.email;
      var ownerPhone = customer.phoneno;
      var usertype = 'personal';

    }

    // Find the customer's NGN bank account
    const ngnAccount = await Bank.findOne({
      where: { userid: customer.id, currency: 'NGN', usertype: usertype},
      attributes: ['bankname', 'accountno', 'accountname', 'bankcode'],
    });

    if (!ngnAccount) {
      return error(res, "NOT_FOUND", "NGN virtual account not found for this customer.", 404);
    }

    return success(res, {
      customer: {
        name: ownerName,
        email: ownerEmail,
        phoneno: ownerPhone,
      },
      account: {
        bankName: ngnAccount.bankname,
        accountNumber: ngnAccount.accountno,
        accountName: ngnAccount.accountname,
        bankCode: ngnAccount.bankcode,
      }
    }, "Customer NGN account details retrieved successfully.");

  } catch (err) {
    logger.error('Error in get CustomerNgnAccount QR:', err);
    next(err);
  }
};


module.exports = {
  getCustomerNgnAccount
};
