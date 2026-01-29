const {db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify, logBeneficiary,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, logger, genSHAccount, shAcessToken, getFee, getUserInfo, updateBalance, psb9Token, USAccountUpd, getFX, Customer, Business, Wallets, BizTeam, BizInvites, BizKeys, KYC, KycDoc, payWhk, Payn, AppSett, LogRequest, getBal, Bank, CardUser, VCard, CardTrans, AcctRequest } = require('./_dependencies');


const prvdNotify = async(req, res)=>{  
    try {    

        const reqSignature = req.headers["x-auth-signature"];
      
        let dtimed = Date.parse(new Date())/1000;     
        const ClientId = process.env.PRVDS_CLIENT_ID;
        const ClientSecret = process.env.PRVDS_CLIENT_SECRET;
        
        let XAuthSignature = crypto.createHash('sha512')
        .update(`${ClientId}:${ClientSecret}`)
        .digest('hex').toLocaleUpperCase();

        if(process.env.APPENV !== 'production'){
            XAuthSignature = 'BE09BEE831CF262226B426E39BD109f2AF84DC63076D4174FAC78A2261F9A3D6E59744983B8326B69CDF2963FE314DFC89635CFA37A40596508DD6EAAB09402C7';
        }

        const event = req.body;
        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        //sample data
        const accountNumber = resp['accountNumber']; 
        const sessionId = resp['sessionId']; 
        const narration = resp['tranRemarks']; 
        const AmountPaid = resp['transactionAmount']; 
        const settledAmount = resp['settledAmount']; 
        const fees = resp['feeAmount']; 
        const vatAmount = resp['vatAmount']; 
        const currency = resp['currency']; 
        const initiationTranRef = resp['initiationTranRef']; 
        const settlementId = resp['settlementId']; 
        const SourceAcct = resp['sourceAccountNumber']; 
        const SourceName = resp['sourceAccountName']; 
        const sourceBankName = resp['sourceBankName']; 
        const providerChannel = resp['channelId']; 
        const tranDateTime = resp['tranDateTime']; 
        var Reference = sessionId;
        var SourceBank = sourceBankName;
        var bankCode = '';
        var AccountNo = accountNumber;
        var timed = moment().format('YYYY-MM-DD HH:mm:ss');
        var transtimed = moment(tranDateTime).format('YYYY-MM-DD HH:mm:ss');
    
          //vlidate is present
        if (!reqSignature) {
             return res.status(401).json({ 
                requestSuccessful: true,
                sessionId: sessionId,
                responseMessage: "Signature header is missing",
                responseCode: "02"
            });
        }

        
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.status(401).json({ 
                requestSuccessful: true,
                sessionId: sessionId,
                responseMessage: "Request body is empty",
                responseCode: "02"
            });
        }


        //verify signature
        if (reqSignature !== XAuthSignature) {
            logger.error(`prvdNotify Error: Invalid X-Auth-Signature. Received: ${reqSignature}, Expected: ${XAuthSignature}`);

            return res.status(401).json({ 
                requestSuccessful: true,
                sessionId: sessionId,
                responseMessage: "invalid auth signature",
                responseCode: "02"
            });
        }


        // res.status(200).json({ status: true, message: "Webhook received and processing." });

        //process only if settlementId and sessionId are present
        if(settlementId && sessionId){

            //find account
            const checkbank = await Bank.findOne({ where: { accountno: accountNumber, provider: 'providus'} });

            if(!checkbank){
                logger.error(`prvdNotify Error: Bank account not found for account number ${accountNumber}`);

                return res.status(401).json({ 
                    requestSuccessful: true,
                    sessionId: sessionId,
                    responseMessage: "account number not found",
                    responseCode: "02"
                });
            }
  

            const t = await db.sequelize.transaction();
             try {
                var checkhook = await Payn.findAll({ where: { [Op.or]: [{ txref: sessionId }, { provref: settlementId }]}, transaction: t })

                if (checkhook.length > 0){
                    await t.rollback();
                    console.warn(`[Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                    
                     return res.status(401).json({ 
                        requestSuccessful: true,
                        sessionId: sessionId,
                        responseMessage: "duplicate transaction",
                        responseCode: "01"
                    });
                }

                        //log webhook
                await payWhk.create({resp: dbody, txref: settlementId, gateway: 'providus', timed: dtimed, processed: 0}, { transaction: t });


                const userid = checkbank.userid;
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
                    
                    return res.status(401).json({ 
                        requestSuccessful: true,
                        sessionId: sessionId,
                        responseMessage: "rejected transaction",
                        responseCode: "02"
                    });
                }

                // notify Providus as success before processing to avoid reattempts
                res.status(200).json({ 
                    requestSuccessful: true,
                    sessionId: sessionId,
                    responseMessage: "success",
                    responseCode: "00"
                });

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

                const chargefee = await getFee('virtualaccount', AmountPaid, accounttier); //get inflow fee

                const getsett = await AppSett.findOne({ where: { id: 1 } });

                if (!getsett){ 
                    var inflowfee_cap = 1000;
                }else{
                    var inflowfee_cap = parseFloat(getsett.maxamount)
                }
        
                var inflowfee = parseFloat(chargefee[0]); //fee  10
                var prvfee = chargefee[1]

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

                var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                                    
                /* Update wallet */
                const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t }, true, customerType);

                // LOG CREDIT
                await Payn.create({
                    userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: duser_type, paytype: 'credit', productid: AccountNo, paychannel: 'providus', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees, provref: settlementId, settlement_route: 'naira'
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
                        userid: userid, recipient: AccountNo, amount: EMTLFee, amountval: EMTLFee, currency: 'NGN', newbal: newbal2, prevbal: userbal2, txref: dref, pfor: 'Electronic Money Transfer Levy', usertype: 'user', paytype: 'debit', productid: Reference, paychannel: 'providus', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: 'According to the Electronic Money Transfer Levy (EMTL) regulation from 2022, a tax of ₦50 is imposed on all deposits of ₦10,000 or more made into your account', timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: 0, narration: `Electronic Money Transfer Levy (EMTL) applied on ${Reference}`, providerfee: 0, revenue: 0
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
                            You have just received funds in your wallet through ${AccountNo}(Providus Bank)
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
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(Providus Bank)`;

                    await pushNotify(ownerid, 'Funding Alert - HitchPay', thesmg, customerType)

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

            } catch (error) {
                await t.rollback();
                logger.error(`prvdNotify Error during duplicate check: ${error.message}`);
                
                return res.status(401).json({ 
                    requestSuccessful: true,
                    sessionId: sessionId,
                    responseMessage: `Something went wrong! Unable to process request ${error.message}`,
                    responseCode: "02"
                });
            }
                    
        }else{
            console.warn(`[Webhook] Received unknown event type: No session id or settlement id present.`);

            return res.status(401).json({ 
                requestSuccessful: true,
                sessionId: sessionId,
                responseMessage: "rejected transaction",
                responseCode: "02"
            });
        }
    

    } catch (error) {
        logger.error(`prvdNotify Error: ${error.message}`);
        return res.status(401).json({ 
            requestSuccessful: true,
            sessionId: '',
            responseMessage: `Something went wrong! Unable to process request ${error.message}`,
            responseCode: "02"
        });
    }   
}
    
module.exports = {
    prvdNotify
}