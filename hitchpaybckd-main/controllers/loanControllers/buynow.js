const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, LogRequest, ucFirst, logger, Customer, KycDoc, KYC, formatPhoneNumber, LogResponse, Faculty, Dept, TuitionFees, Business, AWSFileUpload, cloudinary, AppSett, sharp, getBal, LoanApply, updateBalance, Payn, md5, randomstring, publicCDN_Fx, getYCFX, mapleradFxc} = require('./_dependencies');


// create a method to return list of avaailble schhools enrolled
const fetchSchools = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    try {

    // fetch enableb BNPL business
    const schools = await Business.findAll({
            where: {
                bnpl_enabled: true,
                status: '1'
            },
            attributes: ['uuid', 'business_name', 'logo', 'business_city', 'business_state', 'business_country', 'status']
        });

        if (!schools || schools.length === 0) {
            return res.status(404).json({
                status: false,
                message: 'No BNPL enabled schools found.'
            });
        }

        const formattedSchools = schools.map(school => ({
            id: school.uuid,
            name: school.business_name,
            logo: school.logo,
            location: `${school.business_city}, ${school.business_state}, ${school.business_country}`, 
            status: school.status == 1 ? 'Active' : 'Inactive'
        }));

        return res.status(200).json({
            status: true,
            message: 'Schools retrieved successfully',
            data: formattedSchools
        });
        

    } catch (error) {
        logger.error('fetchSchools: Error fetching schools', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error fetching eligible schools' });
    }
};


const fetchFaculties = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { schoolid } = req.params;
    if (!schoolid) return res.status(400).json({ status: false, message: 'School ID is required' });
    
    try {
    
        // fetch data from faculties and departments
        const facultiesData = await Faculty.findAll({ where: { bizid: schoolid } });
        if (!facultiesData || facultiesData.length === 0) {
            return res.status(400).json({ status: false, message: 'No faculties found under this school' });
        }

        const facultiesWithDepartments = await Promise.all(facultiesData.map(async (faculty) => {
            const departmentsData = await Dept.findAll({ where: { faculty_id: faculty.uuid } });

            const departmentsWithPaytypes = await Promise.all(departmentsData.map(async (department) => {

                // TuitionFees get the paytypes from the TuitionFees
                const paytypesData = await TuitionFees.findAll({ where: { deptid: department.uuid } });
                const paytypes = paytypesData.map(paytype => ({
                    id: paytype.paytypeid,
                    name: paytype.paytype,
                    amount: paytype.amount,
                    status: paytype.status == 1 ? 'active' : 'inactive'
                }));

                return {
                    id: department.uuid,
                    name: department.name,
                    status: department.status,
                    paytypes: paytypes
                };
            }));

            return {
                id: faculty.uuid,
                name: faculty.name,
                status: faculty.status,
                departments: departmentsWithPaytypes
            };
        }));

        return res.status(200).json({
            status: true,
            message: 'Faculties retrieved successfully',
            data: facultiesWithDepartments
        });

    } catch (error) {
        logger.error('fetchFaculties: Error fetching faculties', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error fetching faculties' });
    }

};

const fetchTuitionsLoan = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const {schoolid, facultyId, departmentId, paytypeid} = req.body;

    try {
        const tuition = await TuitionFees.findOne({ where: { paytypeid: paytypeid, facultyid: facultyId, deptid: departmentId } });

        // fetch the tuition with respective faculty and department details
        if (!tuition) {
            return res.status(404).json({ status: false, message: 'Tuition fee not found for the given payment type.' });
        }

        const faculty = await Faculty.findOne({ where: { uuid: facultyId } });
        if (!faculty) {
            return res.status(404).json({ status: false, message: 'Faculty not found.' });
        }

        const department = await Dept.findOne({ where: { uuid: departmentId } });
        if (!department) {
            return res.status(404).json({ status: false, message: 'Department not found.' });
        }

        // Calculate loan_amount, downpayment, total_interest, and portal_fee based on tuition.amount
        const tuitionAmount = parseFloat(tuition.amount);
        const portalFee = parseFloat(tuition.portalfee);
        const loanType = tuition.loan_type;
        const bnplInterestRate = 0.05; // 5% interest for BNPL
        const loanOfferRate = 0.1; // 10% offer rate
        const installmentInterestRate = 0.1; // 10% interest for Installment

        let loan_amount = 0;
        let downpayment = 0;
        let total_interest = 0;

        if (loanType === 'bnpl') {
            // Example: 50% loan, 50% downpayment
            loan_amount = tuitionAmount * loanOfferRate;  //we will pay 10% of the tuition amount

            // capped at 100,000
            if (loan_amount > 100000) loan_amount = 100000;

            downpayment = tuitionAmount - loan_amount;
            total_interest = loan_amount * bnplInterestRate; // 5% interest on loan amount
            
        } else {
            // Default or other loan types
            loan_amount = tuitionAmount;
            downpayment = 0;
            total_interest = tuitionAmount * installmentInterestRate; // 10% interest on full amount
        }

        // Example repayment plans (these would also come from business logic/settings)
        const repayment_plan = [
            { durations: '30 days', days: '30', rate: '0.5', topay: (loan_amount * 0.5).toFixed(2) },
            { durations: '3 Month', days: '90', rate: '0.7', topay: (loan_amount * 0.7).toFixed(2) },
            { durations: '6 Month', days: '180', rate: '1.0', topay: (loan_amount * 1).toFixed(2) },
        ];

        // return the details like dummy data below
        return res.status(200).json({
            status: true,
            message: 'Fee details fetched successfully',
            data: {
                tuition: tuitionAmount, faculty: faculty.name,
                department: department.name, paytype: tuition.paytype,
                schoolname: '', schoolid: schoolid, loan_type: loanType,
                loan_amount: loan_amount, downpayment: downpayment,
                total_interest: total_interest, portal_fee: portalFee,
                repayment_plan: repayment_plan, currency: 'XOF'
            }
        });

    }catch (error){
        logger.error('fetchCustomerTuitions: Error fetching customer tuitions', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error fetching customer tuitions' });

    }
}


// get loan eleigibility
const getLoanEligibility = async (req, res) => {
    const userid = req.user.id;

}


// submit the loan application
const submitLoanApplication = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

    const {repayrate, repay_durations, paytypeid, amount, loan_offer, downpayment, portal_fee, department_id, schoolid, accept_terms, matricno, doctype, paywith} = req.body;

    // valdiate all fields
    // if (!repayrate || !repay_durations || !paytypeid || !amount || !loan_offer || !downpayment || !portal_fee || !department_id || !schoolid || !matricno || !doctype) {
    //     return res.status(400).json({ status: false, message: 'All fields are required.' });
    // }

    if (!accept_terms) {
        return res.status(400).json({ status: false, message: 'You must accept the terms and conditions.' });
    }

    if (doctype == '') return res.status(400).json({ status: false, message: 'Oops! Document not specified!' });
    if (paywith == '') return res.status(400).json({ status: false, message: 'Kindly select your payment method' });
    
    const fileupload = req.file; 
    if (fileupload == '' || (!fileupload))
        return res.status(400).json({ status: false, message: 'Kindly upload a valid schoole document' });


    try {
        const { fileTypeFromBuffer } = await import('file-type'); // Dynamic import
        const fileTypeResult = await fileTypeFromBuffer(fileupload.buffer); // Use the buffer
        const allowedMimeTypesForPix = ["image/png", "image/jpeg", "image/jpg", "application/pdf"];

        if (!fileTypeResult || !allowedMimeTypesForPix.includes(fileTypeResult.mime)) {
            return res.status(400).json({ status: false, message: "Invalid file detected. Only images and pdf allowed." });
        }

        const originalExtension = fileupload.originalname.split('.').pop()?.toLowerCase();
        if (originalExtension !== fileTypeResult.ext) {
            logger.warn(`Warning: File extension mismatch post-multer. User: ${userid}. Original: .${originalExtension}, Detected: .${fileTypeResult.ext}`);
        }

    } catch (fileTypeError) {
        logger.error("Error during file type check in controller:", fileTypeError);
        return res.status(500).json({ status: false, message: "Error verifying file content." });
    }


    // GET THE AMOUNT
    const getTuitions = await TuitionFees.findOne({ where: { paytypeid: paytypeid, deptid: department_id } });
    if (!getTuitions)
        return res.status(400).json({ status: false, message: 'Tuition fee details not found.' });

        const tuitionAmount = parseFloat(getTuitions.amount);
        const portalFee = parseFloat(getTuitions.portalfee);
        const loanType = getTuitions.loan_type;
        const tuitionCurrency = getTuitions.currency;

        // Recalculate loan_amount, downpayment, total_interest based on the stored tuition details
        const bnplInterestRate = 0.05; // 5% interest for BNPL
        const loanOfferRate = 0.1; // 10% offer rate i.e 10% of the tutition
        const installmentInterestRate = 0.1; // 10% interest for Installment

        let calculated_loan_amount = 0;
        let expected_downpayment = 0;
        let calculated_total_interest = 0;

        if (loanType === 'bnpl') {
            calculated_loan_amount = tuitionAmount * loanOfferRate;
            if (calculated_loan_amount > 100000) calculated_loan_amount = 100000;
            expected_downpayment = tuitionAmount - calculated_loan_amount;
            calculated_total_interest = calculated_loan_amount * repayrate;
        } else {
            calculated_loan_amount = tuitionAmount;
            expected_downpayment = 0;
            calculated_total_interest = tuitionAmount * installmentInterestRate;
        }

        // Validate if the provided amounts match the calculated amounts to prevent tampering
        if (parseFloat(loan_offer) !== calculated_loan_amount ||
            parseFloat(downpayment) !== expected_downpayment ||
            parseFloat(portal_fee) !== portalFee) {
            return res.status(400).json({ status: false, message: 'Loan amount, downpayment, or portal fee mismatch. Please refresh and try again.' });
        }

        // check if the user has enough balance for the downpayment
        const userWalletBalance = await getBal(userid, paywith, {}, 'personal');

        if (paywith != tuitionCurrency) {
            // CONVERT THE TUITION CURRENCY TO HIS PAYWITH
            get

        }


        if (userWalletBalance < expected_downpayment) {
            return res.status(400).json({ status: false, message: `Insufficient wallet balance for downpayment. Please fund your ${paywith} wallet with ${expected_downpayment} to proceed.` });
        }


        /* UPLOAD THE DOCUMENT */
        const tknid = userid;
        let thefile = ''; 
        const file_extension = fileupload.originalname.split('.').pop().toLowerCase();

        if (file_extension === 'pdf') {
            const randomFileName = `bnpldoc${tknid}_${uuidv4()}.pdf`;
            const doUpload = await AWSFileUpload(fileupload.buffer, randomFileName);
            if (doUpload[0]) {
                thefile = doUpload[1];
            }

        } else {
            let processedBuffer;
            try {
                processedBuffer = await sharp(fileupload.buffer)
                    .toFormat('jpeg').jpeg({ quality: 80 }).toBuffer();

            } catch (sharpError) {
                logger.error("Image processing error:", sharpError);
                return res.status(400).json({ status: false, message: "Error processing document file." });
            }

            thefile = await new Promise((resolve, reject) => {
                const randomFileName = `bnpldoc${tknid}_${uuidv4()}`;
                const uploadStream = cloudinary.uploader.upload_stream(
                    { public_id: randomFileName, resource_type: "image" },
                    (error, result) => {
                        if (error) {
                            console.error("Cloud upload error:", error);
                            return reject(new Error('Cloud upload failed.'));
                        }
                        resolve(result.secure_url);
                    });
                uploadStream.end(processedBuffer);
            });
        }

        if (!thefile) {
            return res.status(400).json({ status: false, message: 'Unable to process upload request, please try again' });
        }

        const loanid = uuidv4();
        const txref = 'HTCH' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12);
        let dtimed = Date.parse(new Date()) / 1000;
        const env = 'app';
        const paybackDate = moment().add(repay_durations, 'days').unix();
        const pay_desc_initial = ucFirst(loanType == 'bnpl' ? 'BNPL Loan downpament' : 'Installment Loan');
        const dfee = 0;
        const actualProviderFee = 0;
        const calculatedProfit = 0;

        const metedata = {
            matricno: matricno,
            doctype: doctype,
            document: thefile,
            loanid: loanid
        }

    try{
        let initialLog;
        const debitTransaction = await db.sequelize.transaction();
        
        // create the loan application
        const loan = await LoanApply.create({
            userid: userid, amount: amount, 
            offeramount: loan_offer, duration: repay_durations,
            downpayment: expected_downpayment,
            loantype: loanType,
            interest: repayrate,
            totalint: calculated_total_interest,
            totalpayback: calculated_loan_amount,
            reference: txref,
            status: 'processing',
            startdate: dtimed,
            paybackdate: paybackDate,
            declinemsg: '',
            metedata: JSON.stringify(metedata)
        }, { transaction: debitTransaction });

        if (!loan) {
            return res.status(400).json({ status: false, message: 'Error creating loan application' });
        }

        // update the user's wallet balance
        const newbalFromUpdate = await updateBalance(userid, expected_downpayment, paywith, 'debit', 'personal', { transaction: debitTransaction });

        initialLog = await Payn.create({
            userid: userid, amount: expected_downpayment, amountval: expected_downpayment, newbal: newbalFromUpdate, prevbal: userWalletBalance, txref: txref, pfor: 'Loan Downpayment', usertype: 'user', paytype: 'debit', productid: loanid, ntwk: 'BNPL', paidthru: 'Wallet', pay_desc: pay_desc_initial, timed: dtimed, status: 0, recipient: getuser.phoneno, fee: dfee, payroute: env, currency: paywith, revenue: calculatedProfit, providerfee: actualProviderFee
        }, { transaction: debitTransaction });

        await debitTransaction.commit();

        // // notify the user via mailSender, notifyMe, pushNotify

        const emailContent = `
            <p>Hello ${getuser.firstname},</p>
            <p>Your loan application has been submitted and approved successfully. We will procced to process your payment.</p>
            
            <p>Here are the details of your loan application:</p>
            <ul>

                <li>Loan Type: ${loanType}</li>
                <li>Amount: N${formatAmount(tuitionAmount)}</li>
                <li>Loan Amount: N${formatAmount(calculated_loan_amount)}</li>
                <li>Downpayment: N${formatAmount(expected_downpayment)}</li>
                <li>Total Interest: N${formatAmount(calculated_total_interest)}</li>
                <li>Repayment Duration: ${repay_durations} days</li>
                <li>Repayment Rate: ${repayrate}%</li>
                <li>Department: ${department_id}</li>
                <li>School: ${schoolid}</li>
                <li>Portal Fee: N${formatAmount(portalFee)}</li>                
            </ul>
            <p>Thank you for choosing Hitchpay. We look forward to serving you with a seamless and secure payment experience.</p>
        
        `;

        mailSender(getuser.firstname, 'Loan Application Submitted', getuser.email, emailContent);

        pushNotify(userid, 'Loan Application Submitted', `Your loan application for N${formatAmount(calculated_loan_amount)} has been submitted successfully. We will process your payment shortly.`);

        return res.status(200).json({
            status: true,
            message: 'Loan application submitted successfully',
            data: {
                loanid: loanid,
                txref: txref,
                amount: amount,
                offeramount: loan_offer,
                duration: repay_durations,
                downpayment: expected_downpayment,
                loantype: loanType,
                interest: repayrate,
                totalint: calculated_total_interest,
                totalpayback: calculated_loan_amount,
                reference: txref
            }
        });

    } catch (error) {
        logger.error('submitLoanApplication: Error submitting loan application', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
    }

}


module.exports = {
    fetchTuitionsLoan, getLoanEligibility, fetchSchools, fetchFaculties, submitLoanApplication

}