const onboarding = require('./onboarding');
const teams = require('./teams');
const apikeymgt = require('./apikeymgt');
const transactions = require('./transactions');
const webhooks = require('./webhooks');
const adminuse = require('./adminuse');
const compliance = require('./verification');
// const { BusinessRegistrationWeb } = require('./onboarding');

module.exports = {
  ...onboarding,
  ...teams,
  ...apikeymgt,
  ...transactions,
  ...webhooks,
  ...adminuse,
  ...compliance
};
