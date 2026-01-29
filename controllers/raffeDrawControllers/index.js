const rafflecontroller = require('./rafflecontroller');
const payqrcontroller = require('./payqrcontroller');


module.exports = {
  ...rafflecontroller,
  ...payqrcontroller,
};