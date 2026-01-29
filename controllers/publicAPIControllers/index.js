const authcontroller = require('./authcontroller');
const paymentcontroller = require('./paymentcontroller');
const webhookcontroller = require('./webhookcontroller');
const walletcontroller = require('./walletcontroller');


module.exports = {
  ...authcontroller,
  ...paymentcontroller,
  ...webhookcontroller,
  ...walletcontroller
};