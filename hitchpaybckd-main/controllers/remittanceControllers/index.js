const cybridauth = require('./cybridauth');
const cybcustomers = require('./customers');
const stripe_remittance = require('./stripe_remittance');


module.exports = {
  ...cybridauth,
  ...cybcustomers,
  ...stripe_remittance
};
