//========================IMPORT DEPENDENCIES======================
const {
    db, uuidv4, moment, Op, sharp, bcrypt,
    cleanMe, validateCacNumber, logger, validatePassword,
    cloudinary, AWSFileUpload, mailSender,
    Customer, Business, Wallets, BizTeam, rfToken, SandboxWallets, Bank, genSHBizAccount,
    randomstring, md5, jwt, otpVer, genCode
} = require('./_dependencies');


const initBusinessAccount = async (req, res) => {
    //REGISTER FOR USER
    try {
        const { email, phone } = cleanMe(req.body);
        
        if (!email || email == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your email address' });
        if (!phone || phone == '') return res.status(400).json({ status: false, message: 'Oops! You forgot to enter your phone number' });

        const checkExistUser = await Customer.findOne({ where: { email } });

        if (checkExistUser){
            return res.status(400).json({ status: false, message: 'Account already exist with email, kindly use another email address' });
        }

        const checkExistPhone = await Customer.findOne({ where: { phoneno: phone } });

        if (checkExistPhone) return res.status(400).json({
            status: false, message: 'Account already exist with phone number, kindly use another phone number'
        });

        let dtimed = Math.floor(Date.now() / 1000);
        /* Cancel any previous code for the phone number or email */
        await otpVer.update({ status: 5 }, { where: { [Op.or]: [{ regemail: email }, { regphone: phone }] } }).catch((err) => { console.log("Unable to process your request : " + err); });

        //SEND OTP            
        const tcode = genCode(6, 'numeric');
        const vertoken = jwt.sign({ regemail: email, regphn: phone }, process.env.JWT_SECRET, { expiresIn: '2h' });

        const logOTP = await otpVer.create({
            userid: '', otpcode: tcode, token: vertoken, timed: dtimed,
            usertype: 'user', otptype: 'regauth', status: 0, regphone: phone, regemail: email
        });

        var thecontent = `
             <div>
               <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1738019510/otpnote_fehcv4.png" alt="HitchPay">
                 <h1>Account Verification</h1>
                 <div class="" style="width: 110.59px; left: 243.24px; top: 412px; border-bottom: 3px solid #000000; margin: auto;"></div>
                 <p>Your ${tcode.length}-digit code is:</p>
                 <div style=" margin: 15px 0; font-style: normal; font-weight: 800; font-size: 32px; line-height: 40px; color: #000000;">${tcode}</div>
                 
                 <div class="greybg" style=" background: #F8F1FF; padding: 30px 20px;">
                     <p style=" font-style: normal; font-weight: 400; font-size: 20px; line-height: 36px; letter-spacing: 0.025em; color: #101010; text-align: left;">
                         Hello <span style="font-size: 18px;">😍</span><br>
                         To complete your account setup, please use the following code for verification:<br>
                         <strong>OTP Token: ${tcode}</strong><br>
                         <strong>The code expires in 5 minutes</strong>
                     </p>
           
                     <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                 </div>
                 
             </div>
         `;

        // //console.log(sendMail)
        mailSender('', 'Account Verification', email, thecontent);

        //send sms
        // const msg = `Welcome to ${process.env.SITENAME}! Kindly use this OTP - ${tcode} to complete your account setup. Powered by HitchPay`
        // if (process.env.APPENV == 'production') {
        //     sendSMS(phone, msg);
        // }

        const currentTime = Date.now(); // Milliseconds
        const fiveMinutesInMs = process.env.OTP_EXPIRES * 1000;
        const expiryTime = currentTime + fiveMinutesInMs;
        res.status(201).json({
            status: true,
            message: 'Account Creation Successfully Initiated',
            data: {
                accessToken: vertoken,
                otpExpiryTimestamp: expiryTime
            }
        })

    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        // console.log("Create account Error: ", error.message);
    }
}

const verifyRegAccount = async (req, res) => {
    try {
        const { otpcode, vertoken } = cleanMe(req.body);

        if (!otpcode || otpcode == '')
            return res.status(400).json({ status: false, message: 'You forgot to enter your OTP' });

        if (!vertoken || vertoken == '')
            return res.status(400).json({ status: false, message: 'Invalid verification token' });

        jwt.verify(vertoken, process.env.JWT_SECRET, async (err, resulted) => {
            if (err) {
                const message = err.name === 'JsonWebTokenError' ? 'Unathourized Verification Token' : err.message;
                return res.status(400).json({ status: false, message: message });
            }

            const verUserEmail = resulted.regemail;
            const verUserPhone = resulted.regphn;

            // Find the OTP record first, regardless of the code match
            const checkvtoken = await otpVer.findOne({
                where: {
                    regphone: verUserPhone,
                    token: vertoken,
                    otptype: 'regauth',
                    regemail: verUserEmail,
                    status: 0 // Only look for active OTPs
                }
            });

            if (!checkvtoken) {
                return res.status(400).json({
                    status: false,
                    message: `Invalid or expired verification session. Please request a new OTP.`,
                });
            }

            const storedTime = parseInt(checkvtoken.timed, 10);
            const currentTime = Math.floor(Date.now() / 1000); // Current UNIX timestamp
            const expiryTime = storedTime + parseInt(process.env.OTP_EXPIRES);

            if (currentTime > expiryTime) {
                await otpVer.update({ status: 3 }, { where: { id: checkvtoken.id } }); // Mark as expired by ID
                return res.status(400).json({ status: false, message: 'OTP has expired. Kindly initiate resend' });
            }

            if (checkvtoken.otpcode === otpcode) {
                // Correct OTP
                await otpVer.update({ status: 1 }, { where: { id: checkvtoken.id } }); // Mark as verified

                res.json({
                    status: true,
                    message: `Account Successfully Verified`,
                    data: {
                        authtoken: vertoken
                    }
                });

            } else {
                // Incorrect OTP
                const currentAttempts = (checkvtoken.attempts || 0) + 1;
                const maxAttempts = parseInt(process.env.OTP_MAX_ATTEMPTS || 3); // e.g., 3 attempts

                if (currentAttempts >= maxAttempts) {
                    // Max attempts reached, invalidate OTP
                    await otpVer.update({ status: 4, attempts: currentAttempts }, { where: { id: checkvtoken.id } }); // Mark as invalid due to attempts
                    return res.status(400).json({
                        status: false,
                        message: `Invalid OTP. Maximum attempts reached. Please request a new OTP.`,
                    });
                } else {
                    // Increment attempts
                    await otpVer.update({ attempts: currentAttempts }, { where: { id: checkvtoken.id } });
                    return res.status(400).json({
                        status: false,
                        message: `Invalid Verification OTP Code. ${maxAttempts - currentAttempts} attempts remaining.`,
                    });
                }
            }

        });
    } catch (error) {
        res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
        console.log("verify account Error: ", error.message);
    }
}


const BusinessSetUp = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const { hascac, cacregtype, cacregno, bizname, bizemail, bizphone, bizaddress, bizcity, bizstate, bizcountry, bizdesc } = cleanMe(req.body);
        const userid = req.user.id;
        const normalizedBizName = bizname.trim().toLowerCase();
        const normalizedBizEmail = bizemail.trim().toLowerCase();
        const normalizedBizPhone = bizphone.trim();

        // --- 1. Initial Validation ---
        if (!userid) {
            return res.status(400).json({ status: false, message: 'Invalid request sent. Please retry again' });
        }

        const requiredFields = { bizname, bizemail, bizphone, bizaddress, bizcity, bizstate, bizdesc };
        for (const [field, value] of Object.entries(requiredFields)) {
            if (!value) return res.status(400).json({ status: false, message: `Business ${field.replace('biz', '')} is required.` });
        }

        if (String(hascac) === '1') {
            if (!cacregtype) return res.status(400).json({ status: false, message: 'Kindly select your CAC registration type' });
            if (!cacregno) return res.status(400).json({ status: false, message: 'Kindly enter your CAC registration number' });
            if (!validateCacNumber(cacregno)) return res.status(400).json({ status: false, message: 'Invalid CAC registration number format. It should be like "RC123456", "BN123456", or "IT123456".' });
        }

        // --- 2. Parallel Database Checks ---
        const getUser = await Customer.findByPk(userid);
        if (!getUser) {
            return res.status(404).json({
                status: false,
                message: 'Unable to locate your account, kindly logout and relogin'
            });
        }


        const existingBusiness = await Business.findOne({
            where: {
                [Op.or]: [
                    db.sequelize.where(
                        db.sequelize.fn('LOWER', db.sequelize.col('business_name')),
                        normalizedBizName
                    ),
                    db.sequelize.where(
                        db.sequelize.fn('LOWER', db.sequelize.col('business_email')),
                        normalizedBizEmail
                    ),
                    { business_phoneno: normalizedBizPhone }
                ]
            }
        })

        if (existingBusiness) {
            // Case-insensitive comparison for business name + remove spaces
            if (existingBusiness.business_name.trim().toLowerCase() === normalizedBizName) {
                return res.status(400).json({ status: false, message: 'A business with this name already exists.' });
            }

            // Case-insensitive comparison for business email
            if (existingBusiness.business_email.trim().toLowerCase() === normalizedBizEmail) {
                return res.status(400).json({ status: false, message: 'A business with this email already exists.' });
            }

            // Exact comparison for phone
            if (existingBusiness.business_phoneno.trim() === normalizedBizPhone) {
                return res.status(400).json({ status: false, message: 'A business with this phone number already exists.' });
            }
        }

        // --- 3. File Uploads ---
        const uploadfiles = req.files;
        const bizlogoUpload = uploadfiles?.['bizlogo']?.[0];
        if (!bizlogoUpload) {
            return res.status(400).json({ status: false, message: 'Kindly upload your business logo' });
        }

        let cacFileUrl = null;
        let cactype = '';

        if (String(hascac) === '1') {
            const cacupload = uploadfiles?.['cacfile']?.[0];
            if (!cacupload) {
                cactype = cacregtype.toLowerCase() === 'bn' ? 'Business Name' : 'Registered Company Name';
                return res.status(400).json({ status: false, message: `Kindly upload your CAC ${cactype} certificate` });
            }
            cacFileUrl = await uploadFile(cacupload, `cac_${uuidv4()}`);
            if (!cacFileUrl) return res.status(500).json({ status: false, message: 'Failed to upload CAC document.' });
        }

        const bizlogoUrl = await uploadFile(bizlogoUpload, `bizlogo_${uuidv4()}`);

        if (!bizlogoUrl) {
            logger.error('Unable to process business logo upload, please try again');
            return res.status(400).json({ status: false, message: 'Unable to process business logo upload, please try again' });
        }

        // --- 4. Create Business and Team Member in a Transaction ---
        const dtimed = Math.floor(Date.now() / 1000);

        if (String(hascac) === '1') {
            cactype = cacregtype.toLowerCase() === 'bn' ? 'Business Name' : 'Registered Company Name';
        }

        const business = await Business.create({
            business_name: bizname,
            business_email: bizemail,
            business_phoneno: bizphone,
            business_address: bizaddress,
            business_city: bizcity,
            business_state: bizstate,
            business_country: bizcountry,
            logo: bizlogoUrl,
            business_description: bizdesc,
            ownerid: userid,
            cacno: String(hascac) === '1' ? cacregno : null,
            cacreg_type: String(hascac) === '1' ? cactype : null,
            cacreg_cert: cacFileUrl,
            isverified: 0,
            status: 0, // Pending approval
            accounttier: 0,
            regtime: dtimed
        }, { transaction: t });

        await BizTeam.create({
            bizid: business.id,
            customerid: userid,
            role: 'owner',
            staffpin: getUser.authpin,
            staffid: '001',
            status: 1,
            timed: dtimed
        }, { transaction: t });

         // Create NGN wallet for the business
        await Wallets.create({
            uid: business.id,
            email: business.business_email,
            currency: 'NGN',
            wbal: 0,
            ledger: 0,
            usertype: 'business',
            timecreated: dtimed,
            lastupdated: dtimed,
            status: 1
        }, { transaction: t });

        await t.commit();

        // Only generate SH account for Nigerian businesses
        if (business.business_country == 'NG' && cacregno) {
            logger.info(`Generating SH account for business ${business.id}`);
            const shAccountResult = await genSHBizAccount(business.id);

            if (!shAccountResult.status) {
                logger.error(`Failed to generate SH account for business ${business.id}: ${shAccountResult.message}`);
            }
        }
        

        return res.status(201).json({
            status: true,
            message: 'Business setup completed successfully',
            data: {
                businessId: business.id,
                businessName: business.business_name,
                businessEmail: business.business_email
            }
        });

    } catch (error) {
        if (t && !t.finished) {
            await t.rollback();
        }
        logger.error('Error in BusinessSetUp:', error);
        return res.status(500).json({ status: false, message: 'Internal server error during business setup' });
    }
};

// genSHBizAccount(6);

const listMyBusinesses = async (req, res) => {
    try {
        const userId = req.user.id;

        // 1. Fetch all team memberships for the user
        const teamMemberships = await BizTeam.findAll({
            where: { customerid: userId },
            include: [{
                model: Business,
                as: 'businessDetails',
                required: true // Ensures we only get memberships for existing businesses
            }],
            order: [['id', 'ASC']]
        });

        if (!teamMemberships || teamMemberships.length === 0) {
            return res.status(200).json({ status: true, message: "You have not set up any businesses yet.", data: [] });
        }

        // 2. Format the data to be more client-friendly
        const formattedBusinesses = teamMemberships.map(membership => {
            const business = membership.businessDetails.toJSON();
            return {
                id: business.id,
                business_name: business.business_name,
                business_email: business.business_email,
                logo: business.logo,
                status: business.status,
                isverified: business.isverified,
                my_role: membership.role,
                my_status: membership.status === 1 ? 'active' : 'suspended'
            };
        });

        // Sort by business ID descending to show newest first
        formattedBusinesses.sort((a, b) => b.id - a.id);

        return res.status(200).json({
            status: true,
            message: 'Businesses retrieved successfully.',
            data: formattedBusinesses
        });

    } catch (error) {
        logger.error('Error in listMyBusinesses:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }

};
const getBusinessDetails = async (req, res) => {
    try {
        const { uuid } = req.params;
    
        const requestingUserId = req.user.id;
    
        if (!uuid) 
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const business = await Business.findOne({
            where: { uuid: uuid },
            include: [{
                model: BizTeam,
                as: 'teamMembers',
                include: [{
                    model: Customer,
                    as: 'customer',
                    attributes: ['id', 'firstname', 'lastname', 'email', 'photo', 'authpin']
                }]
            }],
            order: [
                [{ model: BizTeam, as: 'teamMembers' }, 'id', 'ASC']
            ]
        });

        if (!business) {
            return res.status(404).json({ status: false, message: "Business not found." });
        }

        const isMember = business.teamMembers.some(member => member.customerid == requestingUserId);
        
        if (!isMember) {
            return res.status(403).json({ status: false, message: "Access Denied: You are not a member of this business." });
        }

        return res.status(200).json({ status: true, message: 'Business details retrieved successfully.', data: business });

    } catch (error) {
        logger.error('Error in getBusiness Details:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const getBusinessWallets = async (req, res, next) => {
    try {
        const { uuid } = req.params;

        // get the business with uuid
        const business = await Business.findOne({ where: { uuid: uuid }, 
            attributes: ['id', 'business_email'] 
        });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }
        const busId = business.id;
        const bizEmail = business.business_email;

        // const WalletModel = process.env.APPENV == 'production' ? Wallets : SandboxWallets;
        const WalletModel = Wallets

        let wallets = await WalletModel.findAll({
            where: {
                uid: busId,
                usertype: 'business'
            },
            attributes: ['currency', 'wbal', 'ledger', 'status'],
            order: [['currency', 'ASC']]
        });

        // Check if an NGN wallet exists. If not, create one.
        const hasNgnWallet = wallets.some(wallet => wallet.currency === 'NGN');

        if (!hasNgnWallet) {
            logger.warn(`No NGN wallet found for business ID ${busId}. Creating one.`);
            const business = await Business.findByPk(busId);
            if (business) { 
                const [newNgnWallet] = await Wallets.findOrCreate({
                    where: { uid: busId, usertype: 'business', currency: 'NGN' },
                    defaults: {
                        email: business.business_email,
                        wbal: 0,
                        ledger: 0,
                        status: 1,
                        timecreated: Math.floor(Date.now() / 1000),
                        lastupdated: Math.floor(Date.now() / 1000)
                    }
                });
                // Add the newly created wallet to our list to be returned
                wallets.push(newNgnWallet);
            }
        }

        const formattedWallets = wallets.map(wallet => ({
            currency: wallet.currency,
            available_balance: parseFloat(wallet.wbal) || 0,
            ledger_balance: parseFloat(wallet.ledger) || 0,
            status: wallet.status === 1 ? 'active' : 'inactive'
        }));

        return res.status(200).json({
            status: true,
            message: 'Business wallets retrieved successfully.',
            data: formattedWallets
        });

    } catch (error) {
        logger.error('Error in getBusinessWallets:', error);
        next(error);
    }
};

const BusinessRegistrationWeb = async (req, res, next) => {

    const t = await db.sequelize.transaction();
    try {
        const {
            fname, lname, email, password,
            bizname, bizemail, bizphone, bizaddress, bizcity, bizstate, countrycode, bizdesc,
            hascac, cacregtype, cacregno, countryname
        } = cleanMe(req.body);
        // console.log('req.body', req.body)


        // --- 1. User and Business Field Validation ---
        if (!email || !password || !lname || !fname) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'User name, email, and password are required.' });
        }
        if (!validatePassword(password)) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Password must be at least 8 chars. long, no space, contain a number, an alphabet, and a special character.' });
        }

        const requiredBizFields = { bizname, bizemail, bizphone, bizaddress, bizcity, bizstate, countrycode, bizdesc };
        for (const [field, value] of Object.entries(requiredBizFields)) {
            if (!value) {
                await t.rollback();
                return res.status(400).json({ status: false, message: `Business ${field.replace('biz', '')} is required.` });
            }
        }

        if (String(hascac) === '1') {
            if (!cacregtype || !cacregno){
                await t.rollback();
                 return res.status(400).json({ status: false, message: 'CAC registration type and number are required.' });
            }
            if (!validateCacNumber(cacregno)) {
                await t.rollback();
                return res.status(400).json({ status: false, message: 'Invalid CAC registration number format. It should be like "RC123456", "BN123456", or "IT123456".' });
            }
        }

        // --- 2. Check for Existing User or Business ---

        const existingUser = await Customer.findOne({ where: { email } });
        if (existingUser){
            await t.rollback();
            return res.status(400).json({ status: false, message: 'A user with this email already exists.' });
        }

        const existingBusiness = await Business.findOne({
            where: {
                [Op.or]: [
                    db.sequelize.where(db.sequelize.fn('LOWER', db.sequelize.col('business_name')), db.sequelize.fn('LOWER', bizname)),
                    db.sequelize.where(db.sequelize.fn('LOWER', db.sequelize.col('business_email')), db.sequelize.fn('LOWER', bizemail)),
                    { business_phoneno: bizphone }
                ]
            }
        });

        if (existingBusiness) {
            if (existingBusiness.business_name.toLowerCase() === bizname.toLowerCase()) {
                await t.rollback();
                return res.status(400).json({ status: false, message: 'A business with this name already exists.' });
            }
            if (existingBusiness.business_email.toLowerCase() === bizemail.toLowerCase()){
                await t.rollback();
                return res.status(400).json({ status: false, message: 'A business with this email already exists.' });
            } 
            if (existingBusiness.business_phoneno === bizphone){
                await t.rollback();
                return res.status(400).json({ status: false, message: 'A business with this phone number already exists.' });
            }
        }

        // --- 4. Create User and Business within a Transaction ---
        const dtimed = Math.floor(Date.now() / 1000);
        const salt = bcrypt.genSaltSync(12);
        const hashedPassword = bcrypt.hashSync(password, salt);

        const envv = process.env.APPENV == 'development' ? 'test' : 'live';
        // const refercode = await generateReferralCode(); // Generate referral code here


        // const acessexp = process.env.ACCESSTKTIME
        // const jtiAccess = randomstring.generate(16);
        // const jwtToken = jwt.sign({ email: email, jti: jtiAccess }, process.env.JWT_SECRET, { expiresIn: acessexp });


        const newUser = await Customer.create({
            firstname: fname, lastname: lname, middlename: '', email: email, status: 1, accesstoken: '', phoneno: bizphone, countrycode: countrycode, apptoken: '', authy: hashedPassword, address: '', timed: dtimed, reglevel: 1, refcode: '', referby: '', dialcode: '', countryname: countryname, env: envv
        }, { transaction: t });

        if (!newUser) {
            await t.rollback();
            return res.status(500).json({ status: false, message: 'Failed to create user account.' });
        }

        // Create personal wallets
        const personalWalletCurrency = countrycode === 'NG' ? 'NGN' : 'USD';
        await Wallets.create({ uid: newUser.id, email: newUser.email, currency: personalWalletCurrency, wbal: 0, ledger: 0, timecreated: dtimed, lastupdated: dtimed, status: 1, usertype: 'personal' }, { transaction: t });

        // Create Business
        const newBusiness = await Business.create({
            business_name: bizname,
            business_email: bizemail,
            business_phoneno: bizphone,
            business_address: bizaddress,
            business_city: bizcity,
            business_state: bizstate,
            business_country: countrycode,
            logo: '',
            business_description: bizdesc,
            ownerid: newUser.id,
            cacno: String(hascac) === '1' ? cacregno : null,
            cacreg_type: String(hascac) === '1' ? cactype : null,
            cacreg_cert: '',
            isverified: 0, // Pending verification
            status: 0, // Pending approval
            accounttier: 0,
            regtime: dtimed
        }, { transaction: t });

        // Add owner to the business team
        await BizTeam.create({
            bizid: newBusiness.id,
            customerid: newUser.id,
            role: 'owner',
            staffpin: !newUser.authpin ? '' : newUser.authpin, // Set to null to force PIN setup later
            staffid: '001',
            status: 1,
            can_debit: 1,
            timed: dtimed
        }, { transaction: t });

        // Create NGN wallet for the business
        await Wallets.create({
            uid: newBusiness.id,
            email: newBusiness.business_email,
            currency: 'NGN',
            wbal: 0,
            ledger: 0,
            usertype: 'business',
            timecreated: dtimed,
            lastupdated: dtimed,
            status: 1
        }, { transaction: t });

        await t.commit();

        // --- 5. Post-Creation Actions (Tokens & Welcome Email) ---
        // These are now outside the main database transaction.

        // Generate Refresh Token
        // const rfshtktime = process.env.REFRESTKTIME;
        // const jtiRefresh = randomstring.generate(16);
        // const refreshTok = jwt.sign({ id: newUser.id, email: newUser.email, jti: jtiRefresh }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });

        // Log the refresh token (fire-and-forget, no need to await and block the response)
        // rfToken.update({ status: 0 }, { where: { userid: newUser.id } })
        //     .then(() => {
        //         const d = new Date();
        //         const expired_refresh = d.setMinutes(d.getMinutes() + parseInt(rfshtktime, 10));
        //         rfToken.create({
        //             timed: dtimed, userid: newUser.id, accesstoken: refreshTok, expiredtime: expired_refresh, status: 1, jti: jtiRefresh
        //         });
        //     }).catch(err => logger.error('Failed to manage refresh token for new user:', err));

        // Send Welcome Email
        const emailContent = `
            <div>
                <h1>Welcome, ${bizname}!</h1>
                <p>Your business account has been successfully created. You can now log in to your dashboard to manage your business finances.</p>
                <p>Your account is currently pending review and approval from our team.</p>
                <p>Thank you for choosing HitchPay.</p>
            </div>`;

        mailSender(bizname, 'HitchPay Business', bizemail, emailContent).catch(err => logger.error('Failed to send welcome email:', err));

        res.status(201).json({
            status: true,
            message: 'Business account created successfully. Kindly login to complete account setup.',

        });

    } catch (error) {
        if (t && !t.finished) {
            await t.rollback();
        }
        logger.error('Error in BusinessRegistrationWeb:', error);
        next(error); // Pass to global error handler
    }
};

/**
 * Helper function to upload a file to Cloudinary or AWS S3.
 * @param {object} file - The file object from req.files.
 * @param {string} publicId - A unique public ID for the file.
 * @returns {Promise<string|null>} The URL of the uploaded file or null on failure.
 */
const uploadFile = async (file, publicId) => {
    try {
        const { fileTypeFromBuffer } = await import('file-type');
        const fileTypeResult = await fileTypeFromBuffer(file.buffer);
        const allowedMimeTypes = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        if (!fileTypeResult || !allowedMimeTypes.includes(fileTypeResult.mime)) {
            logger.warn(`Invalid file type uploaded: ${fileTypeResult?.mime}`);
            return null;
        }

        if (fileTypeResult.ext === 'pdf') {
            const [success, url] = await AWSFileUpload(file.buffer, `${publicId}.pdf`);
            return success ? url : null;
        } else {
            const processedBuffer = await sharp(file.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            return new Promise((resolve, reject) => {
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: publicId, resource_type: "image" },
                    (error, result) => {
                        if (error) {
                            logger.error("Cloudinary upload error:", error);
                            return reject(null);
                        }
                        resolve(result.secure_url);
                    }
                );
                uploadStream.end(processedBuffer);
            });
        }
    } catch (error) {
        logger.error(`File upload failed for ${publicId}:`, error);
        return null;
    }
};


async function generateReferralCode() {
    let refercode;
    let isUnique = false;

    while (!isUnique) {
        // Generate a random referral code
        refercode = randomstring.generate({
            length: 5,
            charset: 'alphabetic',
            capitalization: 'uppercase'
        });

        // Check if the generated referral code already exists in the database
        const existingCode = await Customer.findOne({ where: { refcode: refercode } }).catch((err) => {
            console.log("Unable to process your request : " + err);
        });

        if (!existingCode) {
            isUnique = true; // Exit the loop if the code is unique
        }
    }
    return refercode;
}

const authBusinessUser = async (req, res) => {
    try {
        const { email, pword } = cleanMe(req.body);
        // console.log('body', req.body)

        if (!email || !pword) {
            return res.status(400).json({ status: false, message: 'Email and password are required.' });
        }

        // 1. Find the user by email
        const user = await Customer.findOne({ where: { email } });
        if (!user) {
            return res.status(400).json({ status: false, message: 'Invalid credentials.' });
        }

        // 2. Verify the password
        const isPasswordValid = await bcrypt.compare(pword, user.authy);
        if (!isPasswordValid) {
            return res.status(400).json({ status: false, message: 'Invalid credentials.' });
        }

        // 3. Check if the user is part of any business team
        const teamMember = await BizTeam.findOne({ where: { customerid: user.id } });
        if (!teamMember) {
            return res.status(403).json({ status: false, message: 'This account is not associated with a business. Please use the personal login.' });
        }

        // 4. Generate JWT token
        const acessexp = process.env.ACCESSTKTIME;
        const jwtToken = jwt.sign({ id: user.id, email: user.email, bizid: teamMember.bizid, jti: randomstring.generate(16) }, process.env.JWT_SECRET, { expiresIn: acessexp });

        // 5. Update the access token in the database
        await Customer.update({ accesstoken: jwtToken }, { where: { id: user.id } });

        // ================REFRESH TOKEN===========================    
        let rfshtktime = process.env.REFRESTKTIME;
        let jtiToken = randomstring.generate(16);
        const refreshTok = jwt.sign({ id: user.id, email: user.email, jti: jtiToken }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });
        //log refresh token        
        let d = new Date();
        const expired_refresh = d.setMinutes(d.getMinutes() + rfshtktime);

        //clear previous tokenlog
        await rfToken.update({ status: 0 }, { where: { userid: user.id } }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });

        //log new token
        let dtimed = Math.floor(Date.now() / 1000);
        const creatUser = await rfToken.create({
            timed: dtimed, userid: user.id, accesstoken: refreshTok, expiredtime: expired_refresh, status: 1, jti: jtiToken
        }).catch((err) => {
            console.log('Unable to process your request : ' + err);
        });

        // 6. Send response
        return res.status(200).json({
            status: true,
            message: 'Login successful.',
            data: {
                busid: teamMember.bizid,
                accessToken: jwtToken,
                refreshToken: refreshTok,
                acctstatus: 1,
                custemail: user.email,
                reglevel: user.reglevel,
                need2auth: false
            }
        });

    } catch (error) {
        logger.error('Error in authBusinessUser:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};

const listAllAssociatedBusinesses = async (req, res, next) => {
    try {
        const userId = req.user.id;
        if (!userId) {
            return res.status(401).json({ status: false, message: 'Authentication error. Please log in again.' });
        }

        // 1. Fetch businesses the user owns
        const ownedBusinessesPromise = Business.findAll({
            where: { ownerid: userId },
            raw: true // Get plain objects
        });

        // 2. Fetch businesses the user is a team member of
        const teamMembershipsPromise = BizTeam.findAll({
            where: { customerid: userId },
            include: [{
                model: Business,
                as: 'businessDetails',
                required: true
            }],
        });

        const [ownedBusinesses, teamMemberships] = await Promise.all([
            ownedBusinessesPromise,
            teamMembershipsPromise
        ]);

        const allBusinesses = new Map();

        // Add owned businesses to the map first to give them priority
        ownedBusinesses.forEach(business => {
            allBusinesses.set(business.id, {
                ...business,
                my_role: 'owner',
                my_status: 'active' // Owners are always active in their own business
            });
        });

        // Add team memberships, avoiding duplicates
        teamMemberships.forEach(membership => {
            const businessDetails = membership.businessDetails.toJSON();
            if (!allBusinesses.has(businessDetails.id)) {
                allBusinesses.set(businessDetails.id, {
                    ...businessDetails,
                    my_role: membership.role,
                    my_status: membership.status === 1 ? 'active' : 'suspended'
                });
            }
        });

        const finalBusinessList = Array.from(allBusinesses.values());

        if (finalBusinessList.length === 0) {
            return res.status(200).json({ status: true, message: "You are not associated with any businesses yet.", data: [] });
        }

        return res.status(200).json({ status: true, message: 'Associated businesses retrieved successfully.', data: finalBusinessList });

    } catch (error) {
        logger.error('Error in listAllAssociatedBusinesses:', error);
        next(error);
    }
};


const switchBusiness = async (req, res) => {
    try {
        const userId = req.user.id;
        const { uuid } = req.params; //the unique ID

        if (!uuid) {
            return res.status(400).json({ status: false, message: 'Business ID is required.' });
        }

        // get the business with the uniID
        const business = await Business.findOne({ where: { uuid: uuid }, attributes: ['id'] });
        if (!business) {
            return res.status(404).json({ status: false, message: 'Business not found.' });
        }
        const businessId = business.id;
        

        // 1. Find the business by UUID and verify the user is a member
        const teamMembership = await BizTeam.findOne({
            where: {
                customerid: userId,
                bizid: businessId
            },
            include: [{
                model: Business,
                as: 'businessDetails',
                where: { uuid: uuid }, // Find the business by its UUID
                required: true,
                attributes: ['id', 'business_name'] // Only fetch what's needed
            }]
        });

        if (!teamMembership) {
            return res.status(403).json({ status: false, message: 'Access Denied: You are not a member of this business.' });
        }

        if (teamMembership.status !== 1) {
            return res.status(403).json({ status: false, message: 'Your membership for this business is currently suspended.' });
        }

        const user = await Customer.findByPk(userId);
        if (!user) {
            return res.status(404).json({ status: false, message: 'User account not found.' });
        }

        // 2. Generate new tokens
        const acessexp = process.env.ACCESSTKTIME;
         const jwtToken = jwt.sign({ id: user.id, email: user.email, bizid: teamMembership.bizid, jti: randomstring.generate(16) }, process.env.JWT_SECRET, { expiresIn: acessexp });

        const rfshtktime = process.env.REFRESTKTIME;
        const jtiRefresh = randomstring.generate(16);
        const refreshTok = jwt.sign({ id: user.id, email: user.email, jti: jtiRefresh }, process.env.JWT_REFRESH, { expiresIn: rfshtktime });

        // 3. Update tokens in the database
        await Customer.update({ accesstoken: jwtToken }, { where: { id: user.id } });

        const dtimed = Math.floor(Date.now() / 1000);
        const d = new Date();
        const expired_refresh = d.setMinutes(d.getMinutes() + parseInt(rfshtktime, 10));

        await rfToken.update({ status: 0 }, { where: { userid: user.id } });
        await rfToken.create({
            timed: dtimed, userid: user.id, accesstoken: refreshTok, expiredtime: expired_refresh, status: 1, jti: jtiRefresh
        });

        // 4. Return success response with new tokens and business context
        return res.status(200).json({
            status: true,
            message: `Successfully switched to ${teamMembership.businessDetails.business_name}.`,
            data: {
                busid: teamMembership.bizid,
                accessToken: jwtToken,
                refreshToken: refreshTok,
                acctstatus: 1,
                custemail: user.email,
                reglevel: user.reglevel,
                need2auth: false
            }

        });

    } catch (error) {
        logger.error('Error in switch Business:', error);
        return res.status(500).json({ status: false, message: 'An internal server error occurred.' });
    }
};


const bizAccountList = async (req, res) => {
    try {
        const { uuid } = req.params;

        if (!uuid) 
            return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        // get the business with uuid
        const business = await Business.findOne({ where: { uuid: uuid }, attributes: ['id'] });

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        const busId = business.id;

        const getacct = await Bank.findAll({ order: [['id', 'DESC']], where: { userid: busId, status: 1, currency: 'NGN', usertype: 'business' } });

        if (!getacct)
            return res.status(400).json({ status: false, message: 'No account number found for you' });

        const datalist = getacct.map((arrayItem) => ({
            bank_name: arrayItem.bankname,
            account_number: arrayItem.accountno,
            account_name: arrayItem.accountname,
            bank_code: arrayItem.bankcode,
            account_type: arrayItem.accounttype
        }));

        res.json({
            status: true,
            message: 'Business Account number retrieved',
            data: datalist
        });

    } catch (error) {
        console.log('user acct list catch ERROR: ' + error.message)
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

//function to edit and upload business cac registration certificate and no and business logo
const editBusinessInfo = async (req, res) => {
    const t = await db.sequelize.transaction();
    try {
        const { uuid } = req.params;
        const {cacregtype, cacregno, bizaddress, bizcity, bizstate, bizdesc } = cleanMe(req.body);
        const userid = req.user.id;

        if (!uuid) {
            await t.rollback();
            return res.status(400).json({ status: false, message: 'Business ID is required.' });
        }

        const business = await Business.findOne({ where: { uuid: uuid }, transaction: t });
        if (!business) {
            await t.rollback();
            return res.status(404).json({ status: false, message: 'Business not found.' });
        }

        // Ensure the requesting user is the owner of the business
        if (business.ownerid !== userid) {
            await t.rollback();
            return res.status(403).json({ status: false, message: 'Access Denied: You are not the owner of this business.' });
        }

        // --- Initial Validation ---
        const requiredFields = { bizaddress, bizcity, bizstate, bizdesc };
        for (const [field, value] of Object.entries(requiredFields)) {
            if (!value) {
                await t.rollback();
                return res.status(400).json({ status: false, message: `Business ${field.replace('biz', '')} is required.` });
            }
        }



        // --- 3. Handle File Uploads ---
        let cacreg_cert_url = business.cacreg_cert;
        let logo_url = business.logo;

        if (req.files && req.files.cacfile) {
            if (!cacregtype) { await t.rollback(); return res.status(400).json({ status: false, message: 'Kindly select your CAC registration type' }); }
            if (!cacregno) { await t.rollback(); return res.status(400).json({ status: false, message: 'Kindly enter your CAC registration number' }); }
            if (!validateCacNumber(cacregno)) { await t.rollback(); return res.status(400).json({ status: false, message: 'Invalid CAC registration number format. It should be like "RC123456", "BN123456", or "IT123456".' }); }

            // do upload
            const cacFile = req.files.cacfile[0];
            const cacPublicId = `businesss/cac_${business.id}_${Date.now()}`;
            const uploadedCacUrl = await uploadFile(cacFile, cacPublicId);
            if (uploadedCacUrl) {
                cacreg_cert_url = uploadedCacUrl;
            }
            

        }

        if (req.files && req.files.bizlogo) {
            const logoFile = req.files.bizlogo[0];
            const logoPublicId = `businesss/logo_${business.id}_${Date.now()}`;
            const uploadedLogoUrl = await uploadFile(logoFile, logoPublicId);
            if (uploadedLogoUrl) {
                logo_url = uploadedLogoUrl;
            }
        }

        // --- 4. Update Business Information ---
        await Business.update({
            business_address: bizaddress,
            business_city: bizcity,
            business_state: bizstate,
            business_description: bizdesc,
            has_cac_registration: cacregtype && cacregno ? 1 : 0,
            cacreg_type: cacregtype,
            cacno: cacregno,
            cacreg_cert: cacreg_cert_url,
            logo_url: logo_url
        }, {
            where: { id: business.id }
        });

        // --- 5. Return Success Response ---
        return res.status(200).json({
            status: true,
            message: "Business information updated successfully.",
        });
    } catch (error) {
        console.error("Error updating business:", error);
        return res.status(500).json({ status: false, message: "An error occurred while updating the business information." });
    }
};

module.exports = {
    initBusinessAccount,
    verifyRegAccount,
    BusinessSetUp,
    listMyBusinesses,
    getBusinessDetails,
    getBusinessWallets,
    BusinessRegistrationWeb,
    authBusinessUser,
    listAllAssociatedBusinesses,
    switchBusiness, bizAccountList,
    editBusinessInfo
}