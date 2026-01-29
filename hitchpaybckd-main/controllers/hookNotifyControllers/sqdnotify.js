const {db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify, logBeneficiary,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, logger, genSHAccount, shAcessToken, getFee, getUserInfo, updateBalance, psb9Token, USAccountUpd, getFX, Customer, Business, Wallets, BizTeam, BizInvites, BizKeys, KYC, KycDoc, payWhk, Payn, AppSett, LogRequest, getBal, Bank, CardUser, VCard, CardTrans, AcctRequest } = require('./_dependencies');


const SqdTransNotify = async(req, res)=>{  
    try {
        
        const event = req.body;
        const dbody =JSON.stringify(event); 
        var resp = JSON.parse(dbody);
        const sessionId = resp.transaction_reference;
        var dtimed = Date.parse(new Date()) / 1000;

        if (!event) {
            console.error('[Webhook Error] Sqd WebHook Notify: Invalid or empty event body received.');
            return res.status(400).json({ 
                response_code: 400,
                transaction_reference: Reference,
                response_description: "Invalid or empty event body received",
            });
        }
 
        const signature = req.headers['x-squad-signature'];
        if (!signature) {
            console.error('[Webhook Error] Sqd WebHook Notify: Missing signature header.');

            return res.status(400).json({ 
                response_code: 400,
                transaction_reference: Reference,
                response_description: "Missing signature header",
            });
        }

        const sqdSkey = process.env.SQD_SKEY;
        const sqdPkey = process.env.SQD_PKEY;
    
        const computedSignature = crypto.createHmac('sha512', sqdSkey).update(dbody).digest('hex');
        // console.log('computedSignature', computedSignature)
        // console.log('signature', signature)

        if (signature !== computedSignature) {
            console.error('[Webhook Error] Sqd WebHook Notify: Invalid signature. Possible tampering detected.');
            return res.status(400).json({ 
                response_code: 400,
                transaction_reference: Reference,
                response_description: "Invalid signature",
            });
        }
    
        
        const AccountNo = resp.virtual_account_number;
        const AmountPaid = resp.principal_amount;
        const settled_amount = resp.settled_amount;
        const fee_charged = resp.fee_charged;
        const transaction_date = resp.transaction_date;
        const customer_identifier = resp.customer_identifier;
        const transaction_indicator = resp.transaction_indicator;
        const narration = resp.remarks;
        const currency = resp.currency;
        const channel = resp.channel;
        const sender_name = resp.sender_name;
        const meta = resp.meta;
        const encrypted_body = resp.encrypted_body;
        var fees = parseFloat(AmountPaid) - parseFloat(settled_amount);
        var Reference = sessionId;
        var SourceBank = '';
        var SourceName = '';
        var SourceAcct = '';
        var bankCode = '';

        // check if encrypted_body exists
        if (!encrypted_body) {
            console.error('[Webhook Error] Sqd WebHook Notify: Missing encrypted_body in the payload.');
            return res.status(400).json({ 
                response_code: 400,
                transaction_reference: Reference,
                response_description: "Missing encrypted_body in the payload",
            });
        }

        // V3 hashing and decryption
        // String with pipe separators
       /*  const dataToHash = `${Reference}|${AccountNo}|${currency}|${AmountPaid}|${settled_amount}|${customer_identifier}`;
        console.log('dataToHash', dataToHash)
        // Hash the string using SHA256
        const hash = crypto.createHmac('sha256', sqdSkey).update(dataToHash).digest('hex');
        const hashsha512 = crypto.createHmac('sha512', sqdSkey).update(dataToHash).digest('hex');

        console.log('hash', hash)
        console.log('meta.hash', meta.hash)
        console.log('hashsha512', hashsha512) */


       /*  if (hash !== meta.hash) {
            console.error('[Webhook Error] Sqd WebHook Notify: Invalid hash. Possible tampering detected.');
            return res.status(400).json({ 
                response_code: 400,
                transaction_reference: Reference,
                response_description: "Invalid hash",
            });
        } */

        // vaidate the body with encrypted body if needed
       /*  let key = crypto.createHash('sha256').update(String(sqdSkey)).digest('base64').substr(0, 32);
        let IV = crypto.createHash('sha256').update(String(sqdPkey)).digest('base64').substr(0, 16);

        const decipher = crypto.createDecipheriv('aes256', key, IV);
        let decrypted = decipher.update(encrypted_body, 'base64', 'utf8');
            decrypted += decipher.final('utf8');
            console.log('decrypted', decrypted)
            console.log('respresp', JSON.stringify(resp))

        
        // resp = JSON.parse(decrypted);

        if (JSON.stringify(resp) != decrypted) {
            console.error('[Webhook Error] Sqd WebHook Notify: Decrypted body does not match original body. Possible tampering detected.');
            return res.status(400).json({
                response_code: 400,
                transaction_reference: Reference,
                response_description: "Decrypted body does not match original body",
            });
        } */

        res.status(200).json({ 
            response_code: 200,
            transaction_reference: Reference,
            response_description: "success",
        });

        const t = await db.sequelize.transaction();
        try {
            //process the transaction here
            const checkhook = await payWhk.findAll({ where: { txref: Reference, gateway: 'gtb' }, transaction: t });
        
            if (checkhook.length > 0) {
                console.log('Duplicate webhook received for transaction reference:', Reference);
                return;
            }

            let timed = Date.parse(new Date()) / 1000;
            var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a");

            //log webhook
            await payWhk.create({resp: dbody, txref: Reference, gateway: 'gtb', timed: dtimed, processed: 0}, { transaction: t });

            if(channel == 'virtual-account'){
                var checkbank = await Bank.findOne({ where: { accountno: AccountNo }, transaction: t })
    
                if (checkbank) {
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
                        console.warn(`[GTB Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
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
    
                    // get current balance
                    var userbal = await getBal(userid, 'NGN', { transaction: t }, customerType);

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

                    var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });
                    
                    /* Update wallet */
                    const newbal = await updateBalance(userid, tosettle, 'NGN', 'credit', { transaction: t }, true, customerType);

                    // LOG CREDIT
                    await Payn.create({
                        userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: 'NGN', newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: duser_type, paytype: 'credit', productid: AccountNo, paychannel: 'gtbank', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fees
                    }, { transaction: t });
                
                    await payWhk.update({ processed: 1 }, { where: { txref: Reference }, transaction: t });

                    await t.commit();  //commit transaction

                    const dnewbal = parseFloat(newbal);
                            
                    var thecontent = `
                    <div>
                    <h3 style="font-weight: 500; font-size: 27px; line-height: 10px; text-align: center; color: #40196D;">You've Got An Alert</h3>
                    <img style="margin: 20px 0;" src="https://res.cloudinary.com/hitchpay/image/upload/v1761323382/welcomee_email_zgcdvd.png" alt="HitchPay">
                    <div style=" background: #F8F1FF; padding: 30px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                        <p style="line-height: 20px; letter-spacing: 0.025em;">
                            Hello ${fname} <span style="font-size: 18px;">😍</span></p>
                            <p style="line-height: 28px; letter-spacing: 0.025em;">
                            You have just received funds in your wallet through ${AccountNo}(GT Bank). Below are the transaction details:
                        </p>
    
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> N${formatAmount(tosettle)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? '' : SourceBank}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference/Session ID:</strong> ${Reference}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> N${formatAmount(amountcharged)}</p>
                        <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> N${formatAmount(dnewbal)}</p> <br>
                        <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                    </div>
                    `;
    
                    await mailSender(fname, 'Wallet Funding', useremail, thecontent);
    
                    //send notification
                    var notedesc = `Wallet successfully credited with NGN${(tosettle).toFixed(2)} through ${AccountNo}`;
    
                    await notifyMe(userid, 'Wallet Funding', duser_type, notedesc)
    
                    var thesmg = `You have just received a credit of NGN${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo}(GT Bank). Your new wallet balance is NGN${(dnewbal).toFixed(2)}. Ref: ${Reference}`;

                    await pushNotify(ownerid, 'Funding Alert - HitchPay', thesmg, customerType)

                    console.log(`[Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);
    
                }else{
                    await t.rollback();
                    console.error(`[Gtb Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                }
            }else{
                await t.rollback();
                console.error(`[Gtb Webhook Error] Unsupported channel: ${channel} for reference: ${Reference}. Transaction rolled back.`);
            }
    
        } catch (error) {
            if (t.finished !== 'commit' && t.finished !== 'rollback') {
                    await t.rollback();
            }
            logger.error(`[GTBank Webhook Error] Transaction processing failed for reference ${Reference}: ${error}`);
            console.error(`[GTBank Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
            return;
        }

    } catch (error) {
        console.log('GT Bank webhook error', error);
       return
    }
}
    
module.exports = {
    SqdTransNotify
}