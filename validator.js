const {check, validationResult} = require('express-validator');

exports.validateUser = [
  check('email').trim().normalizeEmail({ gmail_remove_dots: false }).not().isEmpty().isEmail().withMessage('Please enter a valid email address!').bail(),
  check('phone').trim().not().isEmpty().withMessage("Phone number is required").isLength({min: 8, max: 12}).withMessage('Please enter a valid phone number').isNumeric().withMessage("Phone number can only be in number format"),
  (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty())
      //return res.status(400).json({errors: errors.array()});
      return res.status(400).json({status: false, message: errors.array()[0]['msg']});     
    next();
  },
];

exports.Subscribers = [  
  check('email').trim().normalizeEmail().not().isEmpty().isEmail().withMessage('Invalid email address!').bail(),  
  (req, res, next) => {
    const errors = validationResult(req);    
    if (!errors.isEmpty())
      //return res.status(400).json({errors: errors.array()});
      return res.status(400).json({status: false, message: errors.array()[0]['msg']});     
    next();
  },
];


exports.validatePassword = [
  check('pword', 'Password is required').trim().not().isEmpty().isLength({ min: 6 }).withMessage('Password must be at least 6 chars long').matches(/\d/).withMessage('Password must contain a number').isAlphanumeric(),(req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({status: false, message: errors.array()[0]['msg']});      
    next();
  },
];


exports.validateBusiness = [
  check('bizemail').trim().normalizeEmail({ gmail_remove_dots: false }).not().isEmpty().isEmail().withMessage('Please enter a valid business email address!').bail(),
  check('bizphone').trim().not().isEmpty().withMessage("Business phone number is required").isLength({min: 8, max: 12}).withMessage('Please enter a valid business phone number').isNumeric().withMessage("Business phone number can only be in number format"),
  (req, res, next) => {
    const errors = validationResult(req);
    
    if (!errors.isEmpty())
      //return res.status(400).json({errors: errors.array()});
      return res.status(400).json({status: false, message: errors.array()[0]['msg']});     
    next();
  },
];

exports.validateAddMember = [
  check('bizid').not().isEmpty().withMessage('A valid Business is required.'),
  check('member_email').trim().normalizeEmail().not().isEmpty().isEmail().withMessage('A valid member email address is required.'),
  check('member_name').trim().not().isEmpty().withMessage("The member's full name is required."),
  check('role').trim().not().isEmpty().withMessage("A role must be assigned to the team member."),
  // check('transpin').trim().not().isEmpty().isLength({ min: 4, max: 4 }).withMessage('Your 4-digit transaction PIN is required.'),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty())
      return res.status(400).json({ status: false, message: errors.array()[0]['msg'] });
    next();
  },
];