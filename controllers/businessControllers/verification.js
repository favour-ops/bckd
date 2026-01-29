const {
    db, moment, Op, logger, uuidv4, cleanMe, md5, axios, randomstring, bcrypt, mailSender, Business, AppSett, KycDoc, BizKYB, Customer, KYC, otpVer, genCode, sendSMS
} = require('./_dependencies');

const { formatAmount } = require("../../config/myfunct");
const { cloudinary, AWSFileUpload } = require("../../config/imageuploads");
const { where } = require('sequelize');
const qrcode = require('qrcode');
const sharp = require('sharp');
const jwt = require("jsonwebtoken");


const getBizKYCStatus = async (req, res, next) => {
  try {
    const {bizid} = req.params;
    if (!bizid) 
      return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id', 'ownerid']});

    if (!business) {
        return res.status(404).json({ status: false, message: 'Unauthorized request.' });
    }

    const kybRecords = await BizKYB.findAll({
      where: {
        bizid: business.id
      },
      attributes: ['vertype', 'idnumber', 'verfname', 'verlname', 'status', 'timed']
    });

    // get the owner's bvn from the kycver and to the formattedRecords below as bvn
    const ownerKyc = await KYC.findOne({
      where: {
        userid: business.ownerid, vertype: 'BVN', status: 1
      },
      attributes: ['bvv', 'timed']
    });

    if (ownerKyc) {
      kybRecords.push({vertype: 'bvn', idnumber: ownerKyc.bvv, verfname: '', verlname: '', status: 1,
        verifiedAt: moment.unix(ownerKyc.timed).format('YYYY-MM-DD HH:mm:ss')
      });
    }

    if (kybRecords.length > 0) {
      const formattedRecords = kybRecords.map(record => ({
        verificationType: record.vertype.toLowerCase(),
        identificationNumber: record.idnumber,
        firstName: record.verfname,
        lastName: record.verlname,
        status: record.status === 1 ? 'verified' : 'pending',
        verifiedAt: moment.unix(record.timed).format('YYYY-MM-DD HH:mm:ss')
      }));

      // console.log('formattedRecords', formattedRecords)

      return res.status(200).json({ 
        status: true, 
        message: 'Business KYC status retrieved successfully.', 
        data: formattedRecords 
    });
    } else {
      return res.status(200).json({ status: true, message: 'No verified KYC records found for this business.', data: [] });
    }

  } catch (error) {
    logger.error('Error in getBizKYCStatus:', error);
    return res.status(500).json({ status: false, message: 'An error occurred while retrieving business KYC status.' });
  }
};



const validateBVNBiz = async (req, res) => {

    const { bvnno, bizid} = cleanMe(req.body);    
    const vertype = 'BVN';

    if (!bizid) 
      return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

    const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id', 'ownerid']});

    if (!business) {
        return res.status(404).json({ status: false, message: 'Unauthorized request.' });
    }

    //valdiate bvnno
    // if (!vertype || vertype == '') return res.status(400).json({ status: false, message: 'Verification type not supplied!' });
    if (!bvnno || bvnno == '') return res.status(400).json({ status: false, message: `BVN number not supplied!` });

    if (bvnno.length != 11) return res.status(400).json({ status: false, message: `Invalid BVN number supplied!` });

    // console.log('req.body', business.ownerid)
    const userid = business.ownerid;
    
    if (!userid)
        return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const getuser = await Customer.findOne({ where: { id: userid } });

    if (!getuser)
        return res.status(400).json({ status: false, message: `Director's details not found. Kindly reload page` });

    if (getuser.bvverify == 1)
        return res.status(400).json({ status: false, message: 'KYC already processing/awaiting approval' });

    // if customer is NG us the below, else use kyver if he has done bvn or nin
    if(getuser.countrycode == 'NG' && getuser.bvverify == 2){
        return res.status(400).json({ status: false, message: `Director's KYC verification already completed` });

    }else{
        var checkdbvn = await KYC.findOne({order: [['id', 'DESC']], where: {
            userid:userid, tier: 1, vertype: {[Op.in]: ['NIN', 'BVN']}} 
        });

        if(checkdbvn && checkdbvn.status == 1){
            return res.status(400).json({ status: false, message: `Director's KYC completed already` });
        }
    }

    try {
        const checkdbvn = await KYC.findOne({
            order: [['id', 'ASC']], where: { bvv: bvnno, vertype: vertype, status: 1, userid: { [Op.ne]: userid } } 
        });

        if (checkdbvn) {
            return res.status(400).json({ status: false, message: `${vertype} already exists with another account` });
        } 

        if(vertype.toLowerCase() == 'bvn'){
            var endpointPath = `${process.env.DOJAH_URL}/api/v1/kyc/bvn/full?bvn=${bvnno}`;
        }else{
            var endpointPath = `${process.env.DOJAH_URL}/api/v1/kyc/nin?nin=${bvnno}`;
        }

        const options = {
            method: 'GET',
            url: endpointPath,
            headers: {
                AppId: process.env.DOJAH_APPID,
                Authorization: 'prod_sk_OZsmApDiPseK2zv2BeB0k5lfJ',
                accept: 'application/json',
                'content-type': 'application/json'
            }
        };

        const response = await axios.request(options);
        const thedata = response.data;

        // console.log('thedata', thedata)

        if (thedata.entity) {
            const jsonString = JSON.stringify(thedata);

            const entity = thedata.entity;
            const first_name = entity.first_name;
            const last_name = entity.last_name;
            const phone_number = entity.phone_number;
            const middle_name = entity.middle_name;
            const date_of_birth = entity.date_of_birth;
            const gender = entity.gender;
            const custnin = entity.nin ? entity.nin : entity.bvn;
            const photo = entity.photo ? entity.photo : entity.image;

            // Log KYC
            const dtimed = Math.floor(Date.now() / 1000);
            try {
                await KYC.create({
                    userid: userid, otpcode: '', otptoken: '', verid: '', timed: dtimed,
                    verfname: first_name, verlname: last_name, verdob: date_of_birth,
                    gender: gender, veremail: '', bvv: bvnno, avatar: photo,
                    verphone: phone_number, status: 0, jsonresp: jsonString, vertype: vertype.toUpperCase(), 
                    provider: 'dojah', tier: 2
                });

                const hisname = getuser.firstname + ' ' + getuser.lastname;
                const vername = first_name + ' ' + last_name;
                var formattedNumber = await maskPhoneNumber(phone_number)
                const tcode = genCode(6, 'numeric');
                const vertoken = jwt.sign({ regemail: getuser.email, regphn: getuser.phoneno }, process.env.JWT_SECRET, { expiresIn: '2h' });
        
                const msg = `Kindly use this OTP - ${tcode} to complete your account verification. Powered by HitchPay`
                await sendSMS(phone_number, msg);

                await otpVer.create({
                  userid: userid, otpcode: tcode, token: vertoken,
                  usertype: 'user', otptype: 'verotp', status: 0
                }).catch((err) => {
                    console.log('Unable to process your request : ' + err);
                    res.status(400).json({ status: false, message: 'Unable to process your request' });
                });

                 res.json({
                    status: true,
                    message: `We have sent a verification OTP to this phone number - ${formattedNumber} attached with your ${vertype} `
                });

            } catch (err) {
                console.error('bix bvn kyc: ', err);
                return res.status(400).json({ status: false, message: 'Unable to process your request' });
            }
        }


    } catch (error) {
        console.log("Error bvnn init: ", error.message);
        res.status(400).json({ status: false, message: 'Unable to process request' });
    }
}

const maskPhoneNumber = async (phoneNumber) => {
    return phoneNumber.slice(0, 4) + '****' + phoneNumber.slice(-3);
}

// verify business tin & bvn number
const businessTINVerify = async (req, res, next) => {
    try {
      const {tin, bizid} = req.body;

      if (!bizid) 
        return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

      const business = await Business.findOne({ where: { uuid: bizid }, attributes: ['id']});

      if (!business) {
          return res.status(404).json({ status: false, message: 'Unauthorized request.' });
      }

      //valiate the tin
      if (!tin)
        return res.status(400).json({ status: false, message: 'Kindly provide the business TIN to proceed.' });

      // Check if a verification for this TIN already exists and is approved
      const existingKyb = await BizKYB.findOne({
        where: {
          bizid: business.id,
          idnumber: tin,
          status: 1, // Approved
          vertype: 'TIN'
        }
      });

      if (existingKyb) {
        return res.status(200).json({ status: true, message: 'Business TIN already existed.', data: { status: 'verified' } });
      }
      

      //log the tin id to the BizKYB table
      const dtimed = Math.floor(Date.now() / 1000);
      const bizKyb = await BizKYB.create({
        bizid: business.id,
        idnumber: tin,
        status: 0, // Pending
        vertype: 'TIN',
        verid: '',
        otpcode: '',
        verfname: '',
        verlname: '',
        verdob: '',
        verphone: '',
        veremail: '',
        gender: '',
        avatar: '',
        jsonresp: '',
        timed: dtimed
      });

      if(!bizKyb)
        return res.status(400).json({ status: false, message: 'Failed to process TIN verification request.' });
        
        return res.status(200).json({ 
            status: true, 
            message: 'Business TIN submitted successfully.', 
        });


      // Call the external TIN verification service
    //   const [tinVerified, tinData, tinMessage] = await verifyTin(tin);

    //   if (!tinVerified) {
    //     await bizKyb.update({ status: 2, jsonresp: JSON.stringify({ message: tinMessage }) }); // Mark as rejected
    //     return res.status(400).json({ status: false, message: tinMessage });
    //   }

      // Update the BizKYB record with verification details
    //   await bizKyb.update({
    //     status: 1, // Approved
    //     verfname: tinData.company_name,
    //     jsonresp: JSON.stringify(tinData),
    //     timed: dtimed
    //   });

      // Update the Business table with the verified TIN and company name
    //   await Business.update(
    //     {
    //       biztin: tin,
    //       bizname: tinData.company_name,
    //       bizstatus: 1, // Assuming 1 means verified
    //     },
    //     { where: { id: business.id } }
    //   );

        //   return res.status(200).json({ status: true, message: 'Business TIN verified successfully.', data: { status: 'verified', company_name: tinData.company_name } });


    } catch (error) {
        logger.error('Error in business Verify:', error);
        return res.status(500).json({ status: false, message: 'An error occurred during TIN verification.' });
    }
};


const uploadDocs = async (req, res) => {
    try {
        const { bizid, fileno, doctype, docname, idcardno, expirydate, issuance_country } = req.body;
        const tknid = bizid;

        // console.log('req.body', req.body)

        if (!tknid) 
          return res.status(400).json({ status: false, message: 'Eh! Invalid request sent! Business ID is required.' });

        const business = await Business.findOne({ where: { uuid: tknid }, attributes: ['id']});

        if (!business) {
            return res.status(404).json({ status: false, message: 'Unauthorized request.' });
        }

        // validate allow doctype field idcard, utility, cac
        if (!['idcard', 'utility', 'cac'].includes(doctype)) {
            return res.status(400).json({ status: false, message: 'Oops! Invalid document type specified!' });
        }


        if (!doctype || doctype == '') return res.status(400).json({ status: false, message: 'Oops! Document type not specified!' });
        if (!docname || docname == '') return res.status(400).json({ status: false, message: 'Oops! Document name not specified!' });

        const uploadfiles = req.files;
        const fileupload = uploadfiles['fileupload']?.[0];
        const idcardback = uploadfiles['idcardback']?.[0];
        
        const maxCount = 1;

        if (doctype === 'idcard') {
            if (!idcardno) return res.status(400).json({ status: false, message: 'Oops! ID Card number not specified!' });
            if (!expirydate) return res.status(400).json({ status: false, message: 'Oops! Expiry date not specified!' });
            if (!issuance_country) return res.status(400).json({ status: false, message: 'Oops! Issuance country not specified!' });
            if (!idcardback) return res.status(400).json({ status: false, message: 'No ID card back uploaded' });
            // if (!fileno) return res.status(400).json({ status: false, message: 'Oops! Document number not specified!' });
        }

        if (!fileupload)
            return res.status(400).json({ status: false, message: 'No Document front uploaded' });


        if ((uploadfiles['fileupload'].length > maxCount))
            return res.status(400).json({ status: false, message: 'Document can not exceed 1 file per upload' });

        if (doctype === 'idcard') {
            if ((uploadfiles['idcardback'].length > maxCount))
                return res.status(400).json({ status: false, message: 'Document can not exceed 1 file per upload' });
        }


        const { fileTypeFromBuffer } = await import('file-type');
        const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        // Process front image
        const frontTypeResult = await fileTypeFromBuffer(fileupload.buffer);
        if (!frontTypeResult || !allowedMimeTypesForPix.includes(frontTypeResult.mime))
            return res.status(400).json({ status: false, message: "Invalid front file type." });

        const frontExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
        if (frontExtension !== frontTypeResult.ext)
            console.warn(`Warning: Front file extension mismatch. User: ${tknid}`);

        let backExtension = '';
        if (doctype === 'idcard' && idcardback) {
          // Process back image
          const backTypeResult = await fileTypeFromBuffer(idcardback.buffer);
          if (!backTypeResult || !allowedMimeTypesForPix.includes(backTypeResult.mime))
              return res.status(400).json({ status: false, message: "Invalid back file type." });

          backExtension = idcardback.originalname.split('.').pop()?.toLowerCase();
          if (backExtension !== backTypeResult.ext)
              console.warn(`Warning: Back file extension mismatch. User: ${tknid}`);
        }
        // Upload front file
        let thefile = '';
        if (frontExtension === 'pdf') {
            const randomFileName = `biz${tknid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) thefile = doUpload[1];
        } else {
            const processedBuffer = await sharp(fileupload.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `bizfront_${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) return reject(new Error('Cloud upload failed for front.'));
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBuffer);
            });
        }

        // Upload back file
        let thefileBack = '';
        if (doctype === 'idcard' && idcardback) {
            if (backExtension === 'pdf') {
                const randomFileName = `bizback_${tknid}_${uuidv4()}.pdf`;
                const doUploadBack = await AWSFileUpload(idcardback.buffer, randomFileName);
                if (doUploadBack[0]) thefileBack = doUploadBack[1];
            } else {
                const processedBackBuffer = await sharp(idcardback.buffer).toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();
                thefileBack = await new Promise((resolve, reject) => {
                    const randomFileName = `bizback_${tknid}_${uuidv4()}`;
                    const uploadStream = cloudinary.uploader.upload_stream(
                        { public_id: randomFileName, resource_type: "image" },
                        (error, result) => {
                            if (error) return reject(new Error('Cloud upload failed for back.'));
                            resolve(result.secure_url);
                        });
                    uploadStream.end(processedBackBuffer);
                });
            }
        }

        if (!thefile){
            return res.status(400).json({ status: false, message: 'Unable to upload document front. Please try again.' });
        }

        const dtimed = Math.floor(Date.now() / 1000);
        const [bizKybRecord, created] = await BizKYB.findOrCreate({
            where: { bizid: business.id, vertype: doctype},
            defaults: {
                bizid: business.id,
                docurl: thefile,
                docurl_back: thefileBack, // Add this column to your DB model if not present
                idnumber: fileno,
                expirydate: expirydate,
                issuancecountry: issuance_country,
                status: 0,
                vertype: doctype,
                docname: docname,
                timed: dtimed
            }
        });

        if (!created) {
            await bizKybRecord.update({
                docurl: thefile,
                docurl_back: thefileBack,
                idnumber: fileno,
                expirydate: expirydate,
                issuancecountry: issuance_country,
                status: 0,
                vertype: doctype,
                docname: docname,
                timed: dtimed
            });
        }

        return res.json({
            status: true,
            message: 'Great! Document Successfully Submitted, Awaiting Approval!'
        });

    } catch (error) {
        logger.error("KYC Upload Error:", error);
        return res.status(400).json({ status: false, message: 'Unable to process your request at the moment, kindly retry shortly' });
    }
};

module.exports = {
    businessTINVerify, getBizKYCStatus, uploadDocs, validateBVNBiz
}
