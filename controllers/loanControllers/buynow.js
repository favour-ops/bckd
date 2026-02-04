const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, LogRequest, logger, Customer, KycDoc, KYC, LogResponse, Faculty, Dept, TuitionFees, Business, AWSFileUpload, cloudinary, AppSett, sharp, getBal, LoanApply, Payn, md5, randomstring, LoanPlans, LoanRepay} = require('./_dependencies');

const { formatAmount, cleanMe, ucFirst, updateBalance, formatPhoneNumber, getFX } = require("../../config/myfunct");


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
            return res.status(200).json({
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

    const { schoolid, facultyId, departmentId, paytypeid } = req.body;

    try {
        const tuition = await TuitionFees.findOne({ where: { paytypeid: paytypeid, facultyid: facultyId, deptid: departmentId } });

        // fetch the tuition with respective faculty and department details
        if (!tuition) {
            return res.status(200).json({ status: false, message: 'Tuition fee not found for the given payment type.' });
        }

        const faculty = await Faculty.findOne({ where: { uuid: facultyId } });
        if (!faculty) {
            return res.status(200).json({ status: false, message: 'Faculty not found.' });
        }

        const department = await Dept.findOne({ where: { uuid: departmentId } });
        if (!department) {
            return res.status(200).json({ status: false, message: 'Department not found.' });
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

        //get loan plans
        const loanPlans = await LoanPlans.findAll({
            attributes: ['id', 'planname', 'days', 'rate']
        });

        const repayment_plan = loanPlans.map(plan => {
            const rate = Number(plan.rate) / 100;
            const months = plan.days / 30;

            const interest = loan_amount * rate;
            const totalToPay = parseFloat(loan_amount) + parseFloat(interest);
            const monthlyRepay = totalToPay / months;

            return {
                id: plan.id,
                duration: plan.planname,
                days: plan.days,
                rate: plan.rate,
                installment: months,
                topay: Number(totalToPay.toFixed(2)),
                monthlyrepay: Number(monthlyRepay.toFixed(2))
            };
        });
        
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
                repayment_plan: repayment_plan, currency: tuition.currency
            }
        });


    } catch (error) {
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

    const { repayplanid, paytypeid, department_id, schoolid, accept_terms, matricno, doctype, paywith } = req.body;

    //validate repayplanid
    if (!repayplanid)
        return res.status(400).json({ status: false, message: 'Loan repayment plan is required.' });


    if (!accept_terms) {
        return res.status(400).json({ status: false, message: 'You must accept the terms and conditions.' });
    }

    if (!matricno)
        return res.status(400).json({ status: false, message: 'Matriculation number is required.' });


    if (!doctype) 
        return res.status(400).json({ status: false, message: 'Oops! Document not specified!' });

    if (!paywith)
        return res.status(400).json({ status: false, message: 'Kindly select your payment method' });

    const fileupload = req.file;
    if (fileupload == '' || (!fileupload))
        return res.status(400).json({ status: false, message: 'Kindly upload your valid school document' });


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

    //get the repayment plans
    const getPlan = await LoanPlans.findOne({ where: { id: repayplanid } });
    if (!getPlan) {
        return res.status(400).json({ status: false, message: 'Invalid repayment plan selected.' });
    }

    const repayrate = parseFloat(getPlan.rate)/100;
    const repay_durations = parseInt(getPlan.days);
    

    // GET THE AMOUNT
    const getTuitions = await TuitionFees.findOne({ where: { paytypeid: paytypeid, deptid: department_id } });
    if (!getTuitions)
        return res.status(400).json({ status: false, message: 'Tuition fee details not found.' });

    const tuitionAmount = parseFloat(getTuitions.amount);
    const portalFee = parseFloat(getTuitions.portalfee);
    const loanType = getTuitions.loan_type;
    const tuitionCurrency = getTuitions.currency;

    // Recalculate loan_amount, downpayment, total_interest based on the stored tuition details
    const loanOfferRate = 0.1; // qualified for 10% offer rate i.e 10% of the tutition

    let calculated_loan_amount = 0;
    let expected_downpayment = 0;
    let calculated_total_interest = 0;
    let installment = repay_durations/30;
    let totalRepayment = 0;

    if (loanType === 'bnpl') {
        calculated_loan_amount = parseFloat(tuitionAmount * loanOfferRate);
        if (calculated_loan_amount > 100000) calculated_loan_amount = 100000;

        expected_downpayment = tuitionAmount - calculated_loan_amount;
        calculated_total_interest = parseFloat(calculated_loan_amount * repayrate).toFixed(2);
        totalRepayment = parseFloat(calculated_loan_amount) + parseFloat(calculated_total_interest);


    } else {
        calculated_loan_amount = tuitionAmount;
        expected_downpayment = 0;
        calculated_total_interest = parseFloat(tuitionAmount * repayrate).toFixed(2);
        totalRepayment = parseFloat(tuitionAmount) + parseFloat(calculated_total_interest);
    }

    // check if the user has enough balance for the downpayment
    const userWalletBalance = await getBal(userid, paywith, {}, 'personal');

    // CONVERT THE TUITION CURRENCY TO HIS PAYWITH
    let toChargeTuition = 0; let expectedDownPayment = 0;
    let calculatedLoanAmount = 0; let fxrate = 1

    if (paywith != tuitionCurrency) {

        const rateData = await getFX(tuitionCurrency, paywith);
        // console.log('rateData', rateData)
        if ((!rateData[0]) && (!rateData[1]))
            return res.status(400).json({ status: false, message: 'Unable to get conversion rate' });

        fxrate = rateData[1];
        toChargeTuition = parseFloat(tuitionAmount) * fxrate;  //in payment mehtod currency
        expectedDownPayment = parseFloat(expected_downpayment) * fxrate;  //in payment mehtod currency
        calculatedLoanAmount = parseFloat(calculated_loan_amount) * fxrate;  //in payment mehtod currency
    } else {
        toChargeTuition = parseFloat(tuitionAmount);
        expectedDownPayment = parseFloat(expected_downpayment);
        calculatedLoanAmount = parseFloat(calculated_loan_amount);
    }

    if (userWalletBalance < expectedDownPayment) {
        return res.status(400).json({ status: false, message: `Insufficient wallet balance for your downpayment. Please fund your ${paywith} wallet with ${paywith} ${expectedDownPayment} to proceed.` });
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


    const debitTransaction = await db.sequelize.transaction();
    try {

        const metedata = {
            matricno: matricno, doctype: doctype, document: thefile, loanid: loanid, paymethod: paywith, fxrate: fxrate, total_tuition: toChargeTuition, expected_downpayment: expectedDownPayment, loan_amount: calculatedLoanAmount, total_interest: calculated_total_interest, repay_durations: repay_durations, repayrate: getPlan.rate,
        }

        // update the user's wallet balance
        const newbalFromUpdate = await updateBalance(userid, expectedDownPayment, paywith, 'debit', 'personal', { transaction: debitTransaction });

        // create the loan application
        const loan = await LoanApply.create({
            userid: userid, amount: tuitionAmount, offeramount: calculated_loan_amount, duration: repay_durations, downpayment: expected_downpayment, loantype: loanType, interest: getPlan.rate, totalint: calculated_total_interest, totalpayback: totalRepayment, reference: txref, status: '1', startdate: dtimed, paybackdate: paybackDate, declinemsg: '', totalpaid: 0, currency: tuitionCurrency, installment: installment,  metedata: JSON.stringify(metedata)
        }, { transaction: debitTransaction });

        if (!loan) {
            await debitTransaction.rollback();
            return res.status(400).json({ status: false, message: 'Error creating loan application' });
        }


        await Payn.create({
            userid: userid, amount: expectedDownPayment, amountval: expectedDownPayment, newbal: newbalFromUpdate, prevbal: userWalletBalance, txref: txref, pfor: 'Loan Downpayment', usertype: 'user', paytype: 'debit', productid: loanid, ntwk: 'BNPL', paidthru: 'Wallet', pay_desc: pay_desc_initial, timed: dtimed, status: 1, recipient: getuser.phoneno, fee: dfee, payroute: env, currency: paywith, revenue: calculatedProfit, providerfee: actualProviderFee, rate: fxrate
        }, { transaction: debitTransaction });

        await debitTransaction.commit();

        // // notify the user via mailSender, notifyMe, pushNotify
        const emailContent = `
            <p>Hello ${getuser.firstname},</p>
            <p>Your loan application has been submitted and approved successfully. We will procced to process your payment.</p>            
            <p>Here are the details of your loan application:</p>
            <ul>

                <li>Loan Type: ${loanType.toUpperCase()}</li>
                <li>Reference: ${txref}</li>
                <li>Amount: N${formatAmount(tuitionAmount)}</li>
                <li>Loan Amount: N${formatAmount(calculated_loan_amount)}</li>
                <li>Down payment: N${formatAmount(expected_downpayment)}</li>
                <li>Total Interest: N${formatAmount(calculated_total_interest)}</li>
                <li>Repayment Plans: ${installment}</li>
                <li>Total Repayment: N${formatAmount(totalRepayment)}</li>
                <li>Repayment Rate: ${getPlan.rate}%</li>
                <li>Portal Fee: N${formatAmount(portalFee)}</li>                
            </ul>
            <p>Thank you for choosing Hitchpay. We look forward to serving you with a seamless and secure payment experience.</p>
        `;

        mailSender(getuser.firstname, 'Loan Application Submitted', getuser.email, emailContent);

        pushNotify(userid, 'Loan Application Submitted', `Your loan application for N${formatAmount(calculated_loan_amount)} has been submitted successfully. We will process your payment shortly.`);

           // break down the repayment count and the dates for each repayments
        const repay_count = installment;        
        const repayment_schedule = [];
        const monthly_amount = parseFloat(totalRepayment) / repay_count;
        
        for (let i = 1; i <= repay_count; i++) {
            repayment_schedule.push({
                installment_no: i,
                amount: Number(monthly_amount.toFixed(2)),
                due_date: moment.unix(loan.startdate).add(i, 'months').format('DD-MM-YYYY'),
                status: 'pending'
            });
        }

        return res.status(200).json({
            status: true,
            message: 'Loan application submitted successfully',
            data: {
                loanid: loanid, txref: txref, amount: tuitionAmount, offeramount: calculated_loan_amount,
                duration: `${repay_durations} days`, downpayment: expected_downpayment, loantype: loanType,
                interest: `${parseInt(getPlan.rate)}%`, totalint: calculated_total_interest, totalpayback: totalRepayment,
                reference: txref, repayment_schedule
            }
        });

    } catch (error) {
        await debitTransaction.rollback();

        logger.error('submitLoanApplication: Error submitting loan application', {
            message: error.message,
            response: error.response ? error.response.data : null
        });

        return res.status(500).json({ status: false, message: error.response?.data?.message });
    }

}

const fetchAllLoanHistory = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    try {
        const loans = await LoanApply.findAll({
            where: { userid: userid },
            attributes: ['id', 'amount', 'offeramount', 'duration', 'downpayment', 'loantype', 'interest', 'totalint', 'totalpayback', 'reference', 'status', 'startdate', 'paybackdate', 'declinemsg', 'metedata', 'currency']
        });
        if (!loans || loans.length === 0) {
            return res.status(400).json({ status: false, message: 'No loan applications found' });
        }

        // only return few details
        const formattedLoans = loans.map(loan => ({
            id: loan.id,
            amount: loan.amount,
            offeramount: loan.offeramount,
            duration: loan.duration,
            downpayment: loan.downpayment,
            loantype: loan.loantype,
            interest: loan.interest,
            totalint: loan.totalint,
            totalpayback: loan.totalpayback,
            reference: loan.reference,
            currency: loan.currency,
            status: loan.status,
            startdate: moment.unix(loan.startdate).format('DD-MM-YYYY'),
            paybackdate: moment.unix(loan.paybackdate).format('DD-MM-YYYY')
            
        }));

        return res.status(200).json({
            status: true,
            message: 'Loan applications retrieved successfully',
            data: formattedLoans
        });

    } catch (error) {
        logger.error('fetch AllLoanHistory: Error fetching loan history', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error fetching loan history' });
    }
}


const fetchLoanDetails = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { reference } = req.params;
    if (!reference) return res.status(400).json({ status: false, message: 'Loan reference is required' });

    try {
        let loan;
        if(reference == 'bnpl'){
            loan = await LoanApply.findOne({ where: { userid: userid, loantype: reference, status: '1'}, order: [['id', 'DESC']] });
        }else{
            loan = await LoanApply.findOne({ where: { userid: userid, reference: reference } });
        }

        if (!loan) {
            return res.status(200).json({ status: true, message: 'Loan application not found', data: {
                active_loan: false,
            } });
        }

        // get loan repayment history
        const loanRepayments = await LoanRepay.findAll({
            where: { userid: userid, loanref: loan.reference },
            attributes: ['amount', 'installment', 'timed', 'status']
        });

        // format the repayment
        
        let formattedLoanRepayments = [];
        if (loanRepayments && loanRepayments.length > 0) {
            formattedLoanRepayments = loanRepayments.map(repayment => ({
                amount: repayment.amount,
                installment: repayment.installment,
                timed: moment.unix(repayment.timed).format('DD-MM-YYYY'),
                status: repayment.status
            }));
            
        }


        // break down the repayment count and the dates for each repayments
        const repay_count = loan.installment;        
        const repayment_schedule = [];
        const monthly_amount = parseFloat(loan.totalpayback) / repay_count;
        
        for (let i = 1; i <= repay_count; i++) {
            repayment_schedule.push({
                installment_no: i,
                amount: Number(monthly_amount.toFixed(2)),
                due_date: moment.unix(loan.startdate).add(i, 'months').format('DD-MM-YYYY'),
                status: 'pending'
            });
        }
        
        // only return few details
        const formattedLoan = {
            amount: loan.amount,
            offeramount: loan.offeramount,
            duration: loan.duration,
            downpayment: loan.downpayment,
            loantype: loan.loantype,
            interest: loan.interest,
            totalint: loan.totalint,
            totalpayback: loan.totalpayback,
            reference: loan.reference,
            installment: loan.installment,
            currency: loan.currency,
            status: loan.status,
            startdate: moment.unix(loan.startdate).format('DD-MM-YYYY'),
            paybackdate: moment.unix(loan.paybackdate).format('DD-MM-YYYY'),
            active_loan: true,
            repayment_schedule: repayment_schedule,
            repayhisory: formattedLoanRepayments

        };

        return res.status(200).json({
            status: true,
            message: 'Loan details retrieved successfully',
            data: formattedLoan
        });


    } catch (error) {
        logger.error('fetchLoanHistory: Error fetching loan history ', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error fetching loan history' });
    }

}


const repayLoan = async(req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { reference, quantity, paywith} = req.body;

    if (!reference) 
        return res.status(400).json({ status: false, message: 'Loan reference is required' });

    if (!paywith) 
        return res.status(400).json({ status: false, message: 'Kindly select your payment method' });

    try{
        const loanInfo = await LoanApply.findOne({ where: { userid: userid, reference: reference } });
        if (!loanInfo) {
            return res.status(200).json({ status: false, message: 'Loan application not found' });
        }

        const repayInterest = loanInfo.totalint;
        const repayAmount = loanInfo.totalpayback;
        const totalInterest = loanInfo.totalint;
        // const totalCurrency = loanInfo.currency;
        const loanCurrency = loanInfo.currency;
        const repay_durations = parseInt(loanInfo.duration);
        const repayrate = parseFloat(loanInfo.interest)/100;
        const repay_count = loanInfo.installment;
        const expected_installment = repayAmount / repay_count;
        let toRepayMethodCurrency = 0;
        const payingInstallement = quantity;


        // get balance
        const userWalletBalance = await getBal(userid, paywith, {}, 'personal');

        // PAY WITH OTHER CURRENCY
        if (paywith != loanCurrency) {
            const rateData = await getFX(loanCurrency, paywith);
            if ((!rateData[0]) && (!rateData[1]))
                return res.status(400).json({ status: false, message: 'Unable to get exchange rate' });

            const fxrate = rateData[1];
                        
            toRepayMethodCurrency = parseFloat(expected_installment) * fxrate; //converted to paying currency
        } else {
            toRepayMethodCurrency = parseFloat(expected_installment); //converted to
        }

        //check how many quantity he's paying at a time
        if(payingInstallement > repay_count)
            return res.status(400).json({ status: false, message: `You cannot pay more than ${repay_count} installments.` });
            
        if(payingInstallement < 1)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid number of installments to repay' });

        const totalPayingNow = payingInstallement * toRepayMethodCurrency;  //payment method
        const expectedInstallment = payingInstallement * expected_installment;  //loan currency


        // check if the user has enough balance for the downpayment
        if(userWalletBalance < totalPayingNow)
            return res.status(400).json({ status: false, message: `Insufficient wallet balance. Please fund your ${paywith} wallet with ${paywith} ${totalPayingNow} to proceed.` });


        const txref = 'LRP' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12);
        const dtimed = Date.parse(new Date()) / 1000;
        const pay_desc = `Loan Repayment for ${reference}`;
        const env = 'app';

        const repayTransaction = await db.sequelize.transaction();

        try {
            // update balance
            const newbal = await updateBalance(userid, totalPayingNow, paywith, 'debit', 'personal', { transaction: repayTransaction });

            // update payment
            await Payn.create({
                userid: userid, amount: totalPayingNow, amountval: totalPayingNow, newbal: newbal, prevbal: userWalletBalance, 
                txref: txref, pfor: 'Loan Repayment', usertype: 'personal', paytype: 'debit', productid: reference, 
                ntwk: 'LOAN', paidthru: 'Wallet', pay_desc: pay_desc, timed: dtimed, status: 1, 
                recipient: '', currency: paywith
            }, { transaction: repayTransaction });


            // update the loan totalpaid
            const totalPaid = parseFloat(loanInfo.totalpaid) + parseFloat(expectedInstallment);
            // const repayCount = parseInt(loanInfo.installment);

            await LoanApply.update({ totalpaid: totalPaid }, { where: { userid: userid, reference: reference }, transaction: repayTransaction });

            // log loan repayment history LoanRepay
            await LoanRepay.create({
                userid: userid, amount: expectedInstallment, loanref: reference, score: 5,
                installment: payingInstallement, paywith: paywith, status: '1', timed: dtimed
            }, { transaction: repayTransaction });


            await repayTransaction.commit();


            return res.status(200).json({
                status: true,
                message: 'Loan repayment successful',
                data: { 
                    reference: txref, 
                    amount: totalPayingNow, 
                    currency: paywith, 
                    installment: payingInstallement, 
                    loanref: reference, 
                    totalpaid: totalPaid, 
                    totalint: repayInterest, 
                    totalpayback: repayAmount, 
                    date: moment.unix(dtimed).format('DD-MM-YYYY') 
                }
            });

        } catch (innerError) {
            await repayTransaction.rollback();
            throw innerError;
        }

    }catch(error){
        logger.error('loan repayment: Error  ', {
            message: error.message,
            response: error.response ? error.response.data : null
        });
        return res.status(500).json({ status: false, message: error.response?.data?.message || 'Error processing repayment' });
    }
}

module.exports = {
    fetchTuitionsLoan, getLoanEligibility, fetchSchools, fetchFaculties,
    submitLoanApplication, fetchAllLoanHistory, fetchLoanDetails, repayLoan
}