const { db, uuidv4, moment, bcrypt, mailSender, notifyMe, pushNotify, cleanMe, ucFirst, logger, Customer,formatPhoneNumber, LogResponse, sharp, getBal, updateBalance, Payn, md5, randomstring, LockPlans, Savings, formatAmount, SaveHistory} = require('./_dependencies');



// Admin create LockPlans
const createLockPlans = async (req, res) => {
    const { planname, days, interest} = req.body;
    if (!planname || !days || !interest)
        return res.status(400).json({
            status: false,
            message: "All fields are required"
        });
    
    try {
        const dtimed = moment().unix();

        const newLockPlan = await LockPlans.create({ 
            planname, days, interest, 
            timed: dtimed, status: 0 
        });
        
        return res.status(200).json({
            status: true,
            message: "Savings plan created successfully",
            data: newLockPlan
        });

    } catch (error) {
        logger.error(`Error creating savings plan: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: "Internal server error"
        });
    }
}

// get all LockPlans for user
const getLockPlans = async (req, res) => {
    try {
        const lockPlans = await LockPlans.findAll();
        return res.status(200).json({
            status: true,
            message: "Savings plans retrieved successfully",
            data: lockPlans
        });
        
    } catch (error) {
        logger.error(`Error retrieving savings plans: ${error.message}`);
        return res.status(500).json({
            status: false,
            message: "Internal server error"
        });
    }
}


//create savings using amount, planid,title, withdrawdate, fundingsource, planid, currency
const createSavings = async (req, res) => {
    try{
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });


    const { amount, planid, title, withdrawdate, fundingsource, currency, savingstype} = req.body;

    if (!amount || !planid || !title || !withdrawdate || !fundingsource || !currency)
        return res.status(400).json({ status: false, message: "All fields are required"});

    //validate amount 
    if (amount <= 1)
        return res.status(400).json({ status: false, message: `Saving amount must be greater than ${currency}1.00`});

    // make the title to be unique incase already exist for this customer
    const checkTitle = await Savings.findOne({ where: { userid: userid, title: title } });
    if (checkTitle) {
        return res.status(400).json({ status: false, message: `A savings plan with the title '${title}' already exists for this user.` });
    }

    const plan = await LockPlans.findOne({ where: { id: planid, status: 1 } });
        if (!plan)
            return res.status(400).json({ status: false, message: "Invalid savings plan selected"});

        const planname = plan.planname;
        const days = plan.days;  ///e.g 60
        const interest = plan.interest;  //in  %
        const dtimed = moment().unix();
        const status = 0;

        
        let amountDeductable = amount;
        let fxrate = 1;

        // calculate withdraw date to be days from now e,g 60 days from now
        const calculatedWithdrawDate = moment.unix(dtimed).add(days, 'days');
        const withdrawdateUnix = moment(calculatedWithdrawDate, 'DD-MM-YYYY').unix();

        //calculate the totalpayback
        const totalpayback = amount * (1 + (parseFloat(interest) / 100));
        const totalpaybackFormatted = (parseFloat(amount) + totalpayback).toFixed(2);

        
        //e.g deposit USD300 but pay with in NGN ==> 300000
        // check if the user has enough balance for the savings
        const userWalletBalance = await getBal(userid, fundingsource, {}, 'personal');

        //if funding sorce not currency convert to currency
        if(fundingsource !== currency){
            const rateData = await getFX(currency, fundingsource);  //convert USD to NGN
            if ((!rateData[0]) && (!rateData[1])) 
                return res.status(400).json({ status: false, message: 'Unable to get conversion rate for the savings amount and funding source currency at the moment. Please try again later' });
            
            fxrate = rateData[1];
            amountDeductable = parseFloat(amount) * fxrate; //in funding source
            
        }

        if (userWalletBalance < amountDeductable) {
            return res.status(400).json({ status: false, message: `Insufficient wallet balance for your savings. Please fund your ${fundingsource} wallet with ${fundingsource} ${amountDeductable} to proceed.` });
        }

        // if sufficient, charge the fundingsoruce wallet
        const debitTransaction = await db.sequelize.transaction();

        try{

            const txref = 'HTCH' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12)
            const savingid = uuidv4();

            // update the user's wallet balance
            const newbalFromUpdate = await updateBalance(userid, amountDeductable, fundingsource, 'debit', 'personal', { transaction: debitTransaction });

            const prevbal = newbalFromUpdate + amountDeductable;

            // log the payment
            await Payn.create({
                userid: userid, amount: amountDeductable, amountval: amountDeductable, newbal: newbalFromUpdate, prevbal: prevbal, txref: txref, pfor: 'savingsdeposit', usertype: 'user', paytype: 'debit', productid: savingid, ntwk: savingstype, paidthru: 'Wallet', pay_desc: 'Savings Deposit', timed: dtimed, status: 0, recipient: '', fee: 0, payroute: 'app', currency: fundingsource, revenue: 0, providerfee: 0, rate: fxrate
            }, { transaction: debitTransaction });

            // log the savings
            await Savings.create({
                userid: userid, amount: amount, totalpayback : totalpaybackFormatted, planid: planid, planname: planname, lockid: savingid, days: days, interest: interest, fundingsource: fundingsource, type: savingstype, currency: currency, withdrawdate: withdrawdateUnix, depositdate: dtimed, rate: fxrate, title: title, reference: txref, status: 1, timed: dtimed, timedupdated: dtimed
            }, { transaction: debitTransaction });

            // update the status

            await debitTransaction.commit();
            

            // send email for the deposit
            const emailContent = `
                <p>Hello ${getuser.firstname},</p>
                <p>Your savings deposit has been successful. We will process your payment shortly.</p>
                <p>Here are the details of your savings deposit:</p>
                <ul>
                    <li>Savings Type: ${savingstype}</li>
                    <li>Reference: ${txref}</li>
                    <li>Amount: N${formatAmount(amount)}</li>
                    <li>Plan: ${planname}</li>
                    <li>Payback Amount: N${formatAmount(totalpayback)}</li>
                    <li>Duration: ${days}</li>
                    <li>Interest: ${interest}%</li>
                    <li>Funding Source: ${fundingsource}</li>
                    <li>Currency: ${currency}</li>
                    <li>Withdraw Date: ${withdrawdate}</li>
                </ul>
                <p>Thank you for choosing Hitchpay. We look forward to serving you with a seamless and secure payment experience.</p>
            `;

            mailSender(getuser.firstname, 'Savings Deposit Successful', getuser.email, emailContent);

            pushNotify(userid, 'Savings Deposit Successful', `Your savings deposit of N${formatAmount(amount)} has been successful. We will process your payment shortly.`);
            

            return res.status(200).json({
                status: true,
                message: 'Savings created successfully',
                data: {
                    savingid: savingid, txref: txref, 
                    amount: amount, planid: planid, planname: planname
                }
            });

        }catch(error){

            await debitTransaction.rollback();

            logger.warn(`Error creating savings: ${error}`);
            logger.error(`Error creating savings: ${error.message}`);


            return res.status(500).json({ status: false, message: error.response?.data?.message });
        }

    }catch(error){
        logger.error(`Error creating savings: ${error.message}`);
        return res.status(400).json({ status: false, message: 'Unable to complete request.' });
    }
}

//get all my savings
const getSavings = async (req, res) => {
    const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const mySavings = await Savings.findAll({ where: { userid: userid } });
    if (!mySavings || mySavings.length === 0) {
        return res.status(400).json({ status: false, message: 'No savings found' });
    }

    // map the data
    const formattedSavings = mySavings.map(saving => ({
        id: saving.id,
        title: saving.title,
        amount: saving.amount,
        totalpayback: saving.totalpayback,
        currency: saving.currency,
        planid: saving.planid,
        planname: saving.planname,
        lockid: saving.lockid,
        interest: saving.interest,
        type: saving.type,
        withdrawdate: saving.withdrawdate, // convert the date from unix 
        withdrawdate_formatted: moment.unix(saving.withdrawdate).format('DD-MM-YYYY'),
        depositdate: moment.unix(saving.depositdate).format('DD-MM-YYYY'),
        rate: saving.rate,
        reference: saving.reference,
        status: saving.status,
        statustext: saving.status == 1 ? 'Active' : saving.status == 2 ? 'Matured' : saving.status == 3 ? 'Withdrawn' : 'Inactive',

    }));

    return res.status(200).json({
        status: true,
        message: 'Savings retrieved successfully',
        data: formattedSavings
    });
}

//get a specific savings
const getSavingsDetails = async (req, res) => {
        const userid = req.user.id;
        if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

        const { savingsid } = req.params;
        if (!savingsid) return res.status(400).json({ status: false, message: 'Savings ID is required' });
    
        try {
            const saving = await Savings.findOne({ where: { lockid: savingsid, userid: userid } });
            if (!saving) {
                return res.status(400).json({ status: false, message: 'Savings not found' });
            }

            //Calc current interest
            const currentAmount = parseFloat(saving.amount);
            const interestRate = parseFloat(saving.interest);
            const totalPayback = currentAmount * (1 + (interestRate / 100));

            // get the savings history
            let History = [];
            const saveHistory = await SaveHistory.findAll({ where: { lockref: savingsid } });
            if (!saveHistory || saveHistory.length === 0) {
                History = [];
            } else {
                History = saveHistory.map(history => ({
                    amount: formatAmount(history.amount),
                    currency: history.currency,
                    txref: history.txref,
                    prevbal: formatAmount(history.prevbal),
                    newbal: formatAmount(history.newbal),
                    type: history.type,
                    status: history.status == '1' ? 'Success' : 'Failed',
                    timed: moment.unix(history.timed).format('DD-MM-YYYY'),
                }));
            }

            const interest = (totalPayback - currentAmount).toFixed(2);
    
            const formattedSaving = {
                id: saving.id,
                title: saving.title,
                amount: formatAmount(saving.amount),
                totalpayback: formatAmount(totalPayback),
                currency: saving.currency,
                planid: saving.planid,
                planname: saving.planname,
                lockid: saving.lockid,
                roi: interest,
                interest_rate: `${interestRate}%`,
                type: saving.type,
                withdrawdate: saving.withdrawdate, // convert the date from unix 
                withdrawdate_formatted: moment.unix(saving.withdrawdate).format('DD-MM-YYYY'),
                depositdate: moment.unix(saving.depositdate).format('DD-MM-YYYY'),
                rate: saving.rate,
                reference: saving.reference,
                status: saving.status,
                statustext: saving.status == 1 ? 'Active' : saving.status == 2 ? 'Matured' : saving.status == 3 ? 'Withdrawn' : 'Inactive',
                historyData: History
            }

            return res.status(200).json({
                status: true,
                message: 'Savings retrieved successfully',
                data: formattedSaving
            });
        } catch (error) {
            logger.error(`Error retrieving savings: ${error.message}`);
            return res.status(500).json({ status: false, message: 'Unable to retrieve savings details' });
        }
}

//top up a savings
const topUpSavings = async (req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { savingsid, amount, fundingsource, currency } = req.body;
    if (!savingsid || !amount || !fundingsource || !currency)
        return res.status(400).json({ status: false, message: 'All fields are required' });

    try {
        const getuser = await Customer.findOne({ where: { id: userid } });
        if (!getuser)
            return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

        const saving = await Savings.findOne({ where: { lockid: savingsid, userid: userid } });
        if (!saving) {
            return res.status(400).json({ status: false, message: 'Savings not found' });
        }

        let amountDeductable = amount;
        let fxrate = 1;

         const userWalletBalance = await getBal(userid, fundingsource, {}, 'personal');

        //if funding sorce not currency convert to currency
        if(fundingsource !== currency){
            const rateData = await getFX(currency, fundingsource);  //convert USD to NGN
            if ((!rateData[0]) && (!rateData[1])) 
                return res.status(400).json({ status: false, message: 'Unable to get conversion rate for the deposit amount and funding source currency at the moment. Please try again later' });
            
            fxrate = rateData[1];
            amountDeductable = parseFloat(amount) * fxrate; //in funding source
        }

        
        if (userWalletBalance < amountDeductable) {
            return res.status(400).json({ status: false, message: `Insufficient wallet balance for your savings deposit. Please fund your ${fundingsource} wallet with ${fundingsource} ${amountDeductable} to proceed.` });
        }

        const debitTransaction = await db.sequelize.transaction();

        try{

        const txref = 'HTCH' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12)
        const dtimed = moment().unix();

        // update the user's wallet balance
        const newbalFromUpdate = await updateBalance(userid, amountDeductable, fundingsource, 'debit', 'personal', { transaction: debitTransaction });

        const prevbal = newbalFromUpdate + amountDeductable;

        // log the payment
        await Payn.create({
            userid: userid, amount: amountDeductable, amountval: amountDeductable, newbal: newbalFromUpdate, prevbal: prevbal, txref: txref, pfor: 'savingstopup', usertype: 'user', paytype: 'debit', productid: savingsid, ntwk: '', paidthru: 'Wallet', pay_desc: 'Savings Deposit', timed: dtimed, status: 0, recipient: '', fee: 0, payroute: 'app', currency: fundingsource, revenue: 0, providerfee: 0, rate: fxrate
        }, { transaction: debitTransaction });

        // log savings history
        const saveBal = saving.amount;
        const saveNewBal = parseFloat(saveBal) + parseFloat(amount);

        await SaveHistory.create({
            userid: userid, lockref: savingsid, amount: amount, currency: currency, txref: txref, prevbal: saveBal, newbal: saveNewBal,
            type: 'deposit', status: 1, timed: dtimed
        }, { transaction: debitTransaction });
        
        // udpate the savings
        await Savings.update({
            amount: saveNewBal
        }, { where: { lockid: savingsid, userid: userid }, transaction: debitTransaction });

         await debitTransaction.commit();

         return res.status(200).json({
            status: true,
            message: 'Savings deposit completed',
            data: {
                savingid: savingsid, txref: txref, 
                amount: amount, prevbal: saveBal, newbal: saveNewBal
            }
        });
     }catch(err){

        await debitTransaction.rollback();

        logger.error(`Error creating savings: ${err.message}`);
        return res.status(400).json({ status: false, message: 'Unable to process deposit.' });
     }

    }catch(error){
        logger.error(`Error creating savings: ${error.message}`);
        return res.status(400).json({ status: false, message: 'Unable to complete request.' });
    }
}


// withdraw save
const withdrawSavings = async(req, res) => {
    const userid = req.user.id;
    if (!userid) return res.status(400).json({ status: false, message: 'Eh! Invalid request sent!' });

    const { savingsid} = req.body;

    const getuser = await Customer.findOne({ where: { id: userid } });
    if (!getuser)
        return res.status(400).json({ status: false, message: 'Customer details not found. Kindly reload page' });

     try {
            const saving = await Savings.findOne({ where: { lockid: savingsid, userid: userid } });
            if (!saving) {
                return res.status(400).json({ status: false, message: 'Savings not found' });
            }

            // check if withdrawal date has reached
            const withdrawDate = moment.unix(saving.withdrawdate).format('DD-MM-YYYY');
            const currentDate = moment().format('DD-MM-YYYY');

            if (withdrawDate > currentDate) {
                return res.status(400).json({ status: false, message: 'Savings withdrawal is not allowed yet.' });
            }

            // update the status

            const withdrawdate = moment().unix();
            const status = 3;

            await Savings.update({
                withdrawdate: withdrawdate,
                status: status
            }, { where: { lockid: savingsid, userid: userid } });

            // credit the customer wallet
            const creditTransaction = await db.sequelize.transaction();

            try{
                const amountToCredit = parseFloat(saving.totalpayback);
                const currency = saving.currency;
            }catch(error){
                logger.error(`Error retrieving savings: ${error.message}`);

                
            }

        } catch (error) {
            logger.error(`Error retrieving savings: ${error.message}`);

            return res.status(500).json({ status: false, message: 'Unable to process savings withdrawal' });
        }



}

module.exports = {
    createLockPlans, getLockPlans, createSavings, getSavings, 
    getSavingsDetails, topUpSavings, withdrawSavings
}