//IMPORT DEPENDENCIES
const { where } = require('sequelize');
const { bcrypt, db, crypto, ucFirst, logger, BizKeys, Business} = require('./_dependencies');


const createBizKeys = async (req, res, next) => {
  try {
    const { bizid, bizname, name} = req.body;
    const keytype = process.env.APPENV === 'production' ? 'live' : 'test';
    console.log(req.body)

    if (!bizname) 
        return res.status(404).json({ status: false, message: 'Business name is required' });

    // Generate client_id & client_secret
    const client_id = 'hitchpay_client_' + crypto.randomBytes(16).toString('hex');
    const client_secret = 'hitchpay_secret_' + crypto.randomBytes(16).toString('hex');

    // Hash the client_secret for storage
    const client_secret_hash = await bcrypt.hash(client_secret, 12);

    if(!bizid)
      return res.status(400).json({ status: false, message: 'Unauthorized! Invalid request sent!' });

    //validate if the busness id exist
    const business = await Business.findOne({ where: { uuid: bizid } });

    if (!business) {
      return res.status(404).json({ status: false, message: 'Business not found.' });
    }
  
    if(!keytype)
      return res.status(400).json({ status: false, message: `Credential type is required` });

    // keytype can only be test or live
    if (keytype !== 'test' && keytype !== 'live') {
      return res.status(400).json({ status: false, message: 'Invalid key type. Must be "test" or "live".' });
    }
    
    // Check if a key of the same type already exists for the business
    const existingKey = await BizKeys.findOne({where: {bizid: business.id, keymode: keytype}});

    if (existingKey) {
      return res.status(409).json({ status: false, message: `A ${keytype} credential/key already exists for this business.` });
    }
    
    var dtimed = Math.floor(Date.now() / 1000);
    const createClientKey = await BizKeys.create({
      bizid: business.id, bizname: bizname, client_id, client_secret_hash, timed: dtimed, keymode: keytype, status: 1,
      keyname: name || null,
    });

    if (!createClientKey)
        return res.status(404).json({ status: false, message: 'Unable to create API Keys' });

    res.status(201).json({
      status: true,
      message: `${ucFirst(keytype)} API Keys created successfully. Kindly copy and keep your client secret`,
      data: {
        id: createClientKey.id,
        name: createClientKey.bizname,
        key_name: createClientKey.keyname,
        client_id: createClientKey.client_id,
        client_secret, // show only once!
      },
    });

  } catch (err) {
    logger.error(err);
    next(err);
  }
};

//function to get all business API keys
const getBizKeys = async (req, res, next) => {
  try {
    const { uuid } = req.params;

    if (!uuid) {
      return res.status(400).json({ status: false, message: 'Business ID is required.' });
    }

    // Validate if the business ID exists and belongs to the authenticated user
    const business = await Business.findOne({ where: { uuid: uuid} });
    if (!business) {
      return res.status(404).json({ status: false, message: 'Business not found or you do not have permission to view its keys.' });
    }

    const keys = await BizKeys.findAll({
      where: { bizid: business.id },
      attributes: ['id', 'bizid', 'keyname', 'client_id', 'keymode', 'status', 'timed'],
      order: [['timed', 'DESC']],
    });

    //format the timed field to readable date
    keys.forEach(key => {
      const date = new Date(key.timed * 1000); 
      key.dataValues.created_at = date.toISOString();
    });

    if (!keys || keys.length === 0) {
      return res.status(200).json({ status: true, message: 'No API keys found for this business.', data: [] });
    }

    res.status(200).json({
      status: true,
      message: 'API Keys retrieved successfully.',
      data: keys,
    });

  } catch (err) {
    logger.error('Error in getBizKeys:', err);
    next(err);
  }
};

// List all merchants (admin)
const listAllBizKeys = async (req, res, next) => {
  try {
    const listIt = await BizKeys.findAll({
      attributes: ['id', 'bizid', 'bizname', 'client_id', 'status', 'timed'],
      order: [['id', 'DESC']],
    });

    res.status(201).json({
      status: true,
      message: 'API Keys retrieved successfully',
      data: listIt,
    });

  } catch (err) {
    logger.error(err);
    next(err);
  }
};

// rotate secret by key
const rotateSecret = async (req, res, next) => {
  try {
    const { bizid, keyid } = req.body;
    console.log(req.body)

    if (!bizid) {
      return res.status(400).json({ status: false, message: 'Kindly reload and try again.' });
    }

    //check if the user has permission to rotate the key for the business
    const business = await Business.findOne({ where: { uuid: bizid} });
    if (!business) {
      return res.status(404).json({ status: false, message: 'You do not have permission to rotate the keys.' });
    }

    const apiKey = await BizKeys.findOne({ where: { id: keyid, bizid: business.id } });

    if (!apiKey) {
      return res.status(404).json({ status: false, message: 'API Key not found for this business.' });
    }

    // Generate a new client_secret
    const new_client_secret = 'hitchpay_secret_' + crypto.randomBytes(16).toString('hex');
    const new_client_secret_hash = await bcrypt.hash(new_client_secret, 12);

    // Update the client_secret_hash in the database
    apiKey.client_secret_hash = new_client_secret_hash;
    apiKey.timed = Math.floor(Date.now() / 1000); // Update timestamp for rotation
    await apiKey.save();

    return res.status(200).json({
      status: true,
      message: 'Client secret rotated successfully. Please copy the new secret as it will not be shown again.',
      data: {
        client_id: apiKey.client_id,
        client_secret: new_client_secret,
        key_mode: apiKey.keymode,
        key_name: apiKey.keyname,
      },
    });
  } catch (err) {
    logger.error('Error in rotateSecretById:', err);
    next(err);
  }
};

//revoke/delete API key
const revokeApiKey = async (req, res, next) => {
  try {
    const { bizid, keyid } = req.body;

    if (!bizid || !keyid) {
      return res.status(400).json({ status: false, message: 'Business ID and Key ID are required.' });
    }

    // Check if the user has permission to revoke the key for the business
    const business = await Business.findOne({ where: { id: bizid, ownerid: req.user.id } });
    if (!business) {
      return res.status(404).json({ status: false, message: 'You do not have permission to revoke this key.' });
    }

    const apiKey = await BizKeys.findOne({ where: { id: keyid, bizid: bizid } });

    if (!apiKey) {
      return res.status(404).json({ status: false, message: 'API Key not found for this business.' });
    }

    // Delete the API key
    const deletedApiKey = await BizKeys.destroy({where: { id: keyid }});
    if (!deletedApiKey) {
      return res.status(500).json({ status: false, message: 'Failed to delete the API key.' });
    }

    return res.status(200).json({
      status: true,
      message: 'API Key revoked successfully.',
    });

  } catch (err) {
    logger.error('Error in revokeApiKey:', err);
    next(err);
  }
};


module.exports = {
  createBizKeys,
  getBizKeys,
  rotateSecret,
  revokeApiKey,
  listAllBizKeys,
};