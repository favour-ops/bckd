const {db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify, logBeneficiary,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, logger, genSHAccount, shAcessToken, getFee, getUserInfo, updateBalance, psb9Token, USAccountUpd, getFX, Customer, Business, Wallets, BizTeam, BizInvites, BizKeys, KYC, KycDoc, payWhk, Payn, AppSett, LogRequest, getBal, Bank, CardUser, VCard, CardTrans, AcctRequest } = require('./_dependencies');

const verifyStatus = async(sessionId)=>{
    try{
        const gettoken = await shAcessToken();
        if (gettoken[0]) {
            var access_token = gettoken[1]
            var ibs_client_id = gettoken[2]
            var ibs_user_id = gettoken[3]

        const options = {
            method: 'POST',
            url: `${process.env.SH_BASEURL}/transfers/status`,
            headers: {
            accept: 'application/json',
            ClientID: ibs_client_id,
            'content-type': 'application/json',
            authorization: `Bearer ${access_token}`
        },
        data: {sessionId: sessionId}
        };

        let response = await axios.request(options); 
        let thedata = response.data;
        
        if (thedata.statusCode == 200 && (thedata.data['status'] == 'Completed')) {
            return true
        }else{
            return false
        }

        }else{
            return false    
        }
    } catch (error) {
        console.log("sh transfer status: ", error.message);
        return false    
    }
}


const shHookNotify = async (req, res) => {
    try {

        // Immediately acknowledge the webhook to prevent timeouts from the provider.
        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });

        const event = cleanMe(req.body);

        if (!event) {
            console.error('[Webhook Error] shHookNotify: Invalid or empty event body received.');
            return; // Stop processing, response already sent.
        }

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);
        // console.log('resp', resp)
        var event_type = resp['eventType'];
        
        if ((event_type == 'account.credit' || event_type == 'virtualAccount.transfer' || resp['type'] == 'transfer') && (resp['data']['type'] == 'Inwards') ) {
            var type = resp['type'];
            var noteid = resp['data']['_id'];
            var notetype = resp['data']['type']; // Inwards/Outwards
            var sessionId = resp['data']['sessionId'];
            var provider = resp['data']['provider'];
            var providerChannel = resp['data']['providerChannel'];
            var AccountNo = resp['data']['creditAccountNumber'];
            var SourceName = resp['data']['debitAccountName'];
            var SourceAcct = resp['data']['debitAccountNumber'];
            var AmountPaid = resp['data']['amount'];
            var bankCode = resp['data']['destinationInstitutionCode'];
            var narration = resp['data']['narration'];
            var responseCode = resp['data']['responseCode']; //00 successful
            var status = resp['data']['status']; //Completed
            var isDeleted = resp['data']['isDeleted'];
            var isReversed = resp['data']['isReversed'];
            var fees = resp['data']['fees'];
            var Reference = sessionId;
            var SourceBank = provider;

        const t = await db.sequelize.transaction();
        
        try {
            var checkhook = await Payn.findAll({ where: { txref: Reference }, transaction: t })

            if (checkhook.length > 0){
                await t.rollback();
                console.warn(`[Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                return;
            }

            //log the hook
            let timed = Date.parse(new Date()) / 1000;
            var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")
            await payWhk.create({ resp: dbody, txref: Reference, gateway: 'safehaven', 
                timed: timed, processed: 0 }, { transaction: t }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

            var checkbank = await Bank.findOne({ where: { accountno: AccountNo }, transaction: t })
            
            if (checkbank) {
                    /* call the verify endpoint */
                var validateHook = await verifyStatus(sessionId);

                if (validateHook) {
                    var userid = checkbank.userid;
                    var usertype = !checkbank.usertype ? 'personal' : checkbank.usertype;
                    
                    let getuser; let customerType = ''; let duser_type; let ownerid;
                    if(usertype == 'business'){
                        //get business 
                        getuser = await Business.findOne({ where: { id: userid }, transaction: t });
                        customerType = 'business';
                        duser_type = 'business';
                        ownerid = getuser.ownerid;

                    }else{
                        getuser = await Customer.findOne({ where: { id: userid }, transaction: t });
                        customerType = 'personal';
                        duser_type = 'user';
                        ownerid = userid;
                    }

                    if (!getuser) {
                        await t.rollback();
                        console.warn(`[Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                        return;
                    }
                    
                    let fname; let useremail; let accounttier;
                    if(customerType == 'business'){
                        fname = getuser.business_name;
                        useremail = getuser.business_email;
                        accounttier = 2;
                    }else{
                        fname = getuser.firstname;
                        useremail = getuser.email;
                        accounttier = getuser.accounttier;
                    }

                    var userbal = await getBal(userid, 'NGN', { transaction: t }, customerType);
    
                    // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                    const chargefee = await getFee('virtualaccount', AmountPaid, accounttier); //get inflow fee
                    const getsett = await AppSett.findOne({ where: { id: 1 } });

                    if (!getsett){ 
                        var inflowfee_cap = 1000;
                    }else{
                        var inflowfee_cap = parseFloat(getsett.maxamount)
                    }
            
                    var inflowfee = parseFloat(chargefee[0]); //fee  10
                    var prvfee = chargefee[1]  //provider charg  40
                        
                    if(fees == 0){  //if provider fees is 0, it means its SH to SH
                        var tocharge = 0;
                        var amountcharged = 0;
                        var revenue = 0;
                    }else{
                        var tocharge = inflowfee;
                        var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                        var revenue = parseFloat(tocharge) - parseFloat(fees);
                    }

                    var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);
                    // var newbal = parseFloat(userbal) + parseFloat(tosettle)
                    var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                    
                    /* Update wallet */
                    const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t }, true, customerType);

                    // console.log('thenewbal', newbal)
    
                    // LOG CREDIT
                    await Payn.create({
                        userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: duser_type, paytype: 'credit', productid: AccountNo, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees
                    }, { transaction: t });
                
                    await payWhk.update({ processed: 1 }, { where: { txref: Reference }, transaction: t });
    
                    /* CALCULATE EMTLFee */
                    var EMTLFee = 0;
                    var EMTLFee_Max = parseFloat('10000000000000000');  //amount to apply the emtl on

                    if (AmountPaid >= EMTLFee_Max) {
                        var userbal2 = await getBal(userid, 'NGN', { transaction: t }, customerType);

                        var newbal2 = parseFloat(userbal2) - parseFloat(EMTLFee)
                        var dref = `${Reference}_EMTL`;
    
                        var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
    
                        // LOG CREDIT
                        await Payn.create({
                            userid: userid, recipient: AccountNo, amount: EMTLFee, amountval: EMTLFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Electronic Money Transfer Levy', usertype: 'user', paytype: 'debit', productid: Reference, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: 'According to the Electronic Money Transfer Levy (EMTL) regulation from 2022, a tax of ₦50 is imposed on all deposits of ₦10,000 or more made into your account', timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: 0, narration: `Electronic Money Transfer Levy (EMTL) applied on ${Reference}`, providerfee: 0, revenue: 0
                        }, { transaction: t });
    
                        //DEBIT HIM
                        /* Update wallet */
                        await updateBalance(userid, EMTLFee, 'NGN', 'debit', { transaction: t }, false, customerType);
                    } else {
                        var EMTLFee = 0;
                    }

                    await t.commit();  //commit transaction

                    const dnewbal = parseFloat(newbal) - parseFloat(EMTLFee);
        
                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${AccountNo}(Safe Haven MFB)
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> N${formatAmount(tosettle)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? '' : SourceBank}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> N${formatAmount(amountcharged)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Electronic Money Transfer Levy (EMTL):</strong> N${formatAmount(EMTLFee)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> N${formatAmount(dnewbal)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;
    
                    await mailSender(fname, 'Wallet Funding', useremail, thecontent);
    
                    //send notification
                    var notedesc = `Wallet successfully credited with NGN${(tosettle).toFixed(2)} through ${AccountNo}`;
    
                    await notifyMe(userid, 'Wallet Funding', duser_type, notedesc)
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(Safe Haven MFB)`;

                    await pushNotify(ownerid, 'Funding Alert - HitchPay', thesmg, customerType)

                    // return res.status(200).json({
                    //     status: true, message: 'Processed'
                    // })

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                }else{
                    await t.rollback();
                    console.error(`[Webhook Error] Could not validate hook via verifyStatus for session ID: ${sessionId}. Transaction rolled back.`);
                }

                } else {
                    await t.rollback();
                    console.error(`[Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                }

            } catch (error) {
                if (t.finished !== 'commit' && t.finished !== 'rollback') {
                    await t.rollback();
                }
                console.error(`[Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
            }

        } else {
            console.warn(`[Webhook] Received unknown event type: ${event_type}`);
        }

    } catch (error) {
        console.error("[Webhook Error] Top-level catch block in shHookNotify: ", error.message);
    }
}

const shHookDynamicNotify = async (req, res) => {
    try {

        // Immediately acknowledge the webhook to prevent timeouts from the provider.
        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });

        const event = cleanMe(req.body);

        if (!event) {
            console.error('[Webhook Error] shHookNotify: Invalid or empty event body received.');
            return; // Stop processing, response already sent.
        }

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);
        var event_type = resp['eventType'];
        
        if ((event_type == 'virtualAccount.transfer') ) {
            var type = resp['type'];
            var noteid = resp['data']['_id'];
            var notetype = resp['data']['type']; // Inwards/Outwards
            var sessionId = resp['data']['sessionId'];
            var externalReference = resp['data']['externalReference'];  //our reference
            var provider = resp['data']['provider'];
            var providerChannel = resp['data']['providerChannel'];
            var AccountNo = resp['data']['creditAccountNumber'];
            var SourceName = resp['data']['debitAccountName'];
            var SourceAcct = resp['data']['debitAccountNumber'];
            var AmountPaid = resp['data']['amount'];
            var bankCode = resp['data']['destinationInstitutionCode'];
            var narration = resp['data']['narration'];
            var responseCode = resp['data']['responseCode']; //00 successful
            var status = resp['data']['status']; //Completed
            var isDeleted = resp['data']['isDeleted'];
            var isReversed = resp['data']['isReversed'];
            var fees = resp['data']['fees'];
            var Reference = sessionId;
            var SourceBank = provider;

        const t = await db.sequelize.transaction();
        
        try {
            var checkhook = await Payn.findAll({ where: { reference: externalReference }, transaction: t })

            if (checkhook.length > 0){
                await t.rollback();
                console.warn(`[Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                return;
            }

            //log the hook
            let timed = Date.parse(new Date()) / 1000;
            var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")
            await payWhk.create({ resp: dbody, txref: Reference, gateway: 'safehaven', 
                timed: timed, processed: 0 }, { transaction: t }).catch((err) => {
                console.log("Unable to process your request : " + err);
            });

            var checkbank = await Bank.findOne({ where: { accountno: AccountNo }, transaction: t })
            
            if (checkbank) {
                    /* call the verify endpoint */
                var validateHook = await verifyStatus(sessionId);

                if (validateHook) {
                    var userid = checkbank.userid;
                    const getuser = await Customer.findOne({ where: { id: userid }, transaction: t }).catch((err) => { console.log("Unable to process your request : " + err); });
                    if (!getuser) {
                        await t.rollback();
                        console.warn(`[Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                        return;
                    }

                    var fname = getuser.firstname;
                    var useremail = getuser.email;
                    var accounttier = getuser.accounttier;
                    var userbal = await getBal(userid, 'NGN', { transaction: t });
    
                    // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                    const chargefee = await getFee('virtualaccount', AmountPaid, accounttier); //get inflow fee
                    const getsett = await AppSett.findOne({ where: { id: 1 } });

                    if (!getsett){ 
                        var inflowfee_cap = 1000;
                    }else{
                        var inflowfee_cap = parseFloat(getsett.maxamount)
                    }
            
                    var inflowfee = parseFloat(chargefee[0]); //fee  10
                    var prvfee = chargefee[1]  //provider charg  40
                        
                    if(fees == 0){  //if provider fees is 0, it means its SH to SH
                        var tocharge = 0;
                        var amountcharged = 0;
                        var revenue = 0;
                    }else{
                        var tocharge = inflowfee;
                        var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                        var revenue = parseFloat(tocharge) - parseFloat(fees);
                    }

                    var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);
                    // var newbal = parseFloat(userbal) + parseFloat(tosettle)
                    var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                    
                    /* Update wallet */
                    const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t });

                    // console.log('thenewbal', newbal)
    
                    // LOG CREDIT
                    await Payn.create({
                        userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: 'user', paytype: 'credit', productid: AccountNo, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees
                    }, { transaction: t });
                
                    await payWhk.update({ processed: 1 }, { where: { txref: Reference }, transaction: t });
    
                    /* CALCULATE EMTLFee */
                    var EMTLFee = 0;
                    var EMTLFee_Max = parseFloat('10000000000000000');  //amount to apply the emtl on

                    if (AmountPaid >= EMTLFee_Max) {
                        var userbal2 = await getBal(userid, 'NGN', { transaction: t });

                        var newbal2 = parseFloat(userbal2) - parseFloat(EMTLFee)
                        var dref = `${Reference}_EMTL`;
    
                        var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
    
                        // LOG CREDIT
                        await Payn.create({
                            userid: userid, recipient: AccountNo, amount: EMTLFee, amountval: EMTLFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Electronic Money Transfer Levy', usertype: 'user', paytype: 'debit', productid: Reference, paychannel: 'safehaven', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: 'According to the Electronic Money Transfer Levy (EMTL) regulation from 2022, a tax of ₦50 is imposed on all deposits of ₦10,000 or more made into your account', timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: 0, narration: `Electronic Money Transfer Levy (EMTL) applied on ${Reference}`, providerfee: 0, revenue: 0
                        }, { transaction: t });
    
                        //DEBIT HIM
                        /* Update wallet */
                        await updateBalance(userid, EMTLFee, 'NGN', 'debit', { transaction: t });
                    } else {
                        var EMTLFee = 0;
                    }

                    await t.commit();  //commit transaction

                    const dnewbal = parseFloat(newbal) - parseFloat(EMTLFee);
        
                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${AccountNo}(Safe Haven MFB)
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> N${formatAmount(tosettle)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? '' : SourceBank}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> N${formatAmount(amountcharged)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Electronic Money Transfer Levy (EMTL):</strong> N${formatAmount(EMTLFee)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> N${formatAmount(dnewbal)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;
    
                    await mailSender(fname, 'Wallet Funding', useremail, thecontent);
    
                    //send notification
                    var notedesc = `Wallet successfully credited with NGN${(tosettle).toFixed(2)} through ${AccountNo}`;
    
                    await notifyMe(userid, 'Wallet Funding', 'user', notedesc)
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(Safe Haven MFB)`;

                    await pushNotify(userid, 'Funding Alert - HitchPay', thesmg)

                    // return res.status(200).json({
                    //     status: true, message: 'Processed'
                    // })

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                }else{
                    await t.rollback();
                    console.error(`[Webhook Error] Could not validate hook via verifyStatus for session ID: ${sessionId}. Transaction rolled back.`);
                }

                } else {
                    await t.rollback();
                    console.error(`[Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                }

            } catch (error) {
                if (t.finished !== 'commit' && t.finished !== 'rollback') {
                    await t.rollback();
                }
                console.error(`[Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
            }

        } else {
            console.warn(`[Webhook] Received unknown event type: ${event_type}`);
        }

    } catch (error) {
        console.error("[Webhook Error] Top-level catch block in shHookNotify: ", error.message);
    }
}


module.exports = { shHookNotify, shHookDynamicNotify };