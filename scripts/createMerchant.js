// node scripts/createMerchant.js <name> <client_id> <client_secret>
const bcrypt = require('bcryptjs');
// const models = require('../src/models');
const db = require('../models')
const { Op, fn, col } = require("sequelize");
// const sequelize = db.sequelize;

const BizKeys = db.BizKeys

async function main() {
  const [bizid, bizname, client_id, client_secret] = process.argv.slice(2);
  if (!bizname || !client_id || !client_secret) {
    console.error('Usage: node createMerchant.js <name> <client_id> <client_secret>');
    process.exit(1);
  }

//   await sequelize.authenticate();
//   await sequelize.sync(); // in dev; in prod use migrations

  const saltRounds = 12;
  const client_secret_hash = await bcrypt.hash(client_secret, saltRounds);

  const merchant = await BizKeys.create({
    bizid,
    bizname,
    client_id,
    client_secret_hash
  });

  console.log('Created key:', merchant.id);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
