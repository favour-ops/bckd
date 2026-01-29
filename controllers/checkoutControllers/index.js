const merchants = require('./merchants');
const stripe_setup = require('./stripesetup');
const dynamic_account = require('./dynamic_account');
const custompay = require('./custompay');
const webhookretry = require('./webhookRetryJob');

module.exports = {
  ...merchants,
  ...stripe_setup,
  ...dynamic_account,
  ...custompay,
  ...webhookretry
};
