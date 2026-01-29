const { db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, logger,
    genSHAccount, shAcessToken, getFee, getUserInfo, updateBalance, psb9Token, USAccountUpd, getFX, Customer, payWhk, Payn, AppSett, LogRequest, getBal, Bank, CardUser, VCard, CardTrans, AcctRequest} = require('./_dependencies');

const maplHkNotify = async(req, res)=>{  
     try {    
        const event = req.body;
        if (!event || typeof event !== 'object' || Object.keys(event).length === 0) {
            return res.json({ status: false, message: 'Invalid event: Request body is empty or not an object' });
        }

        const svixId = req.headers["svix-id"]
        const svixTimestamp = req.headers["svix-timestamp"]
        const svixSignature = req.headers["svix-signature"]
        const signature = await getWebhookSignature(svixId, svixTimestamp, event);

        // console.log('svixId', svixId)
        // console.log('svixTimestamp', svixTimestamp)
        // console.log('svixSignature', svixSignature)
        // console.log('signature', signature)
        // console.log('event', event)

         // Check if the signature is valid
        // if (signature !== svixSignature) {        
        //     return res.json({ status: false, message: 'Unathourized notification' });
        // }

        const dbody =JSON.stringify(event);    
        var resp = JSON.parse(dbody);
        const eventtype = resp['event'];  

        let dtimed = Date.parse(new Date())/1000; 
        // console.log('mlphk', resp)

        payWhk.create({resp: dbody, txref: resp['reference'], gateway: 'mpld', timed: dtimed, processed: 0});

        res.status(200).json({ status: true, message: "Webhook received and processing." });

        
        if(eventtype == 'issuing.created.successful'){
            const reference = resp['reference'];  
            const data = resp['card'];
            const card_id = data['id'];
            const cardstatus = data['status'];
            const cardtype = data['type'];

            /* get the card */
            const checkkad = await VCard.findOne({where: {custref: reference} });
            if(checkkad){
                const userid = checkkad.userid; 
                const custid = checkkad.trackingid;
                const tofund_amount = checkkad.prefund;
                let timed = Date.parse(new Date())/1000;
                var transtimed = moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")

                /* GET CARD DETAILS */
                let config = {
                    method: 'get',
                    url: `${process.env.MPLDURL}/issuing/${card_id}`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    }
                };

                let response = await axios.request(config);
                let thedata = response.data;    

                // console.log('thedata', thedata)

                if(thedata['status']){
                    const kaddata = thedata['data']
                    const kadid = kaddata['id'];
                    const kadname = kaddata['name'];
                    const masked_pan = kaddata['masked_pan'];
                    const expiry = kaddata['expiry'];
                    const cvv = kaddata['cvv'];
                    const status = kaddata['status'];
                    const issuer = kaddata['issuer'];  //mastercard or visa
                    const address = JSON.stringify(kaddata['address']);
                    const balance = kaddata['balance']/100;  //cent to dola

                    // console.log('masked_pan', masked_pan)
                    // console.log('expiry', expiry)

                    const kadUpdat = await VCard.update({
                        provider: 'MPLD', cardbrand: issuer, cardtype: 'virtual', prefund: balance, 
                        expirydate: expiry, expirymonth: '', cardname: kadname, cardno: masked_pan, 
                        address: address, cardid: card_id, cvv: cvv, timed: timed, status: 1, jsonresp: '' }, 
                        { where: {custref: reference }
                    } );


                    if(!kadUpdat)
                        return res.status(400).json({
                            status: false,
                            message: 'Unable to complete update'
                        });

                    const notedesc = `Congratulation! Your ${issuer} virtual card issuance is successfully processed`
                    await pushNotify(userid, 'Card Issuance - HitchPay', notedesc);
        
                    await notifyMe(userid, 'Card Issuance', 'user', notedesc)

                     var mailcontent = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">Congratulations! Your ${issuer} virtual card issuance verification on ${process.env.SITENAME} has been processed successfully.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Brand:</strong> ${issuer}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Name:</strong> ${kadname}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${reference}</p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;
        
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    //send email                
                    await mailSender('', 'Card Issuance', useremail, mailcontent);

                    //UPDATE HOOK
                    await payWhk.update({ processed: 1 }, { where: { txref: reference} });

                    //log the transaction
                    await CardTrans.create({
                        userid: userid, amount: balance, provider: 'MPLD', transtype: 'ISSUANCE',
                        mode: 'CREDIT', cardid: card_id, currency: 'USD', timed: timed, status: 'SUCCESS',
                        reference: reference, description: 'Virtual card issuance', merchant: 'HitchPay', merchantdesc: ''
                    });

                    res.json({
                        status: true,
                        message: 'Notification Processed'
                    });
                }else{
                    return res.status(400).json({
                        status: false,
                        message: thedata
                    });
                }
            }else{
                return res.status(400).json({
                    status: false,
                    message: 'Unable to process request'
                });
            }

        }else if(eventtype == 'issuing.transaction'){
            
            const reference = resp['reference'];  
            const card_id = resp['card_id'];
            const transstatus = resp['status'];
            const transtype = resp['type'];
            const amount = parseFloat(resp['amount']) / 100; //frm cent to dola
            const currency = resp['currency'];
            const description = resp['description'];
            const fee = resp['fee'];
            const merchant =  JSON.stringify(resp['merchant']);
            const authorization_amount = resp['authorization_amount'];
            const authorization_currency = resp['authorization_currency'];
            const card_acceptor_mcc = resp['card_acceptor_mcc'] ?? '';
            const card_acceptor_mid = resp['card_acceptor_mid'] ?? '';
            const card_acceptor_state = resp['card_acceptor_state'] ?? '';            
            const is_termination = resp['is_termination'];
            const mode = resp['mode'];
            const settled = resp['settled'];

            const merchantdesc = `${card_acceptor_mcc}  ${card_acceptor_mid} ${card_acceptor_state}`;
 
            /* get the card */
            const checkkad = await VCard.findOne({where: {cardid: card_id} });
            if(checkkad){
                
                if(transtype && transtype.toLowerCase() == 'withdrawal' && is_termination == true){
                    // console.log('na here')
                    const withdrwTransaction = await db.sequelize.transaction();

                    var checkhook = await Payn.findAll({ where: { txref: reference }, transaction: withdrwTransaction })

                    if (checkhook.length > 0){
                        await withdrwTransaction.rollback();
                        console.warn(`[Webhook] Duplicate transaction detected for reference: ${reference}. Ignoring.`);
                        
                        return res.status(400).json({
                            status: false,
                            message: `Duplicate transaction detected for reference: ${reference}`
                        });
                    }

                    var provref = reference;
                    var userid = checkkad.userid;
                    var tocredit = amount;
                    var themerchant = '';

                    const userbal = await getBal(userid, 'USD', { transaction: withdrwTransaction });
                    // const revenue = (tocharge * rate) - tocredit;
                    const newbal = await updateBalance(userid, tocredit, 'USD', 'credit', { transaction: withdrwTransaction }, true);

                    // Define your replacement map (all lowercase keys for consistency)
                    const replacements = {
                    "maplerad": "Hitchpay",
                    }

                    // Get the merchant name (default to empty string if missing)
                    let merchantName = resp?.merchant?.name || ""
                    // Normalize to lowercase and check replacement
                    merchantName = replacements[merchantName.toLowerCase()] || merchantName
                    const pay_desc = `${description} - ${merchantName} ${resp['merchant']['country']}`;

                    await Payn.create({
                        userid: userid, amount: tocredit, amountval: tocredit, newbal: newbal, prevbal: userbal, currency: 'USD', paychannel: 'MPLD',
                        txref: reference, pfor: 'cardwithdraw', usertype: 'user', paytype: 'credit', productid: '', ntwk: checkkad.cardbrand,
                        paidthru: 'Card', pay_desc: pay_desc, timed: dtimed, status: 1, recipient: '', fee: '0', revenue: '0', jsonresp: ''
                    }, { transaction: withdrwTransaction });

                    await withdrwTransaction.commit();

                     //send notification
                    var notedescrpt = `$${formatAmount(tocredit)} balance on your terminated card - ${checkkad.cardno} has been credited your USD wallet`;
    
                    await notifyMe(userid, 'Card Terminated Balance', 'user', notedescrpt)
                    await pushNotify(userid, 'Card Terminated Alert - HitchPay', notedescrpt)

                     // send email to the customer for the card termination
                    var mailbody = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">Your virtual card has been terminated and the balance of $${formatAmount(tocredit)} on the terminated card - ${checkkad.cardno} has been credited to your USD wallet.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Number:</strong> ${checkkad.cardno}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount Credited:</strong> $${formatAmount(tocredit)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${reference}</p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;
                          
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    //send email                
                    await mailSender('', 'Card Terminated Balance Credited', useremail, mailbody);

                }else{
                    var themerchant = merchant;
                }

                //log the transaction
                await CardTrans.create({
                    userid: checkkad.userid, amount: amount, provider: 'MPLD', transtype: transtype,
                    mode: mode, cardid: card_id, currency: currency, timed: dtimed, status: transstatus,
                    reference: reference, description: description, merchant: themerchant, merchantdesc: merchantdesc
                });

                // Send notification to the user
                const notedesc = `Your virtual card (${checkkad.cardno}) transaction for ${description} of ${currency}${formatAmount(amount)} was ${transstatus}.`;
                await pushNotify(checkkad.userid, 'Virtual Card Transaction', notedesc);
                await notifyMe(checkkad.userid, 'Virtual Card Transaction', 'user', notedesc);

                // Send email to the user
                const userinfo = await getUserInfo(checkkad.userid);
                const useremail = userinfo.email;
                const mailcontent = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">A transaction occurred on your virtual card.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Card Number:</strong> ${checkkad.cardno}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Description:</strong> ${description}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> ${currency}${formatAmount(amount)}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Status:</strong> ${transstatus}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${moment.unix(dtimed).format("Do MMM, YYYY hh:mm a")}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${reference}</p>
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                `;
                await mailSender('', 'Virtual Card Transaction Alert', useremail, mailcontent);

                res.json({
                    status: true,
                    message: 'Notification Processed'
                });

            }else{
                return res.status(400).json({
                    status: false,
                    message: 'Card not found'
                });
            }

        }else if(eventtype == 'account.creation.failed'){
            const decline_reason = resp['decline_reason'];  //loop
            const txref = resp['reference'];
            const id = resp['id'];

            const uniqueCombined = formatDeclineReasons(decline_reason);

            const listItems  = reasonsStringToEmailList(uniqueCombined);


            const checkkad = await AcctRequest.findOne({where: {reference: txref} });
            if(checkkad){
                const userid = checkkad.userid;
                await AcctRequest.update({ status: 3, decline_reason: uniqueCombined }, { where: { reference: txref }});

                 const notedesc = `Oops! Your USD virtual account request has been declined. Kindly check your email for more details`
                    await pushNotify(userid, 'USD Account Request - HitchPay', notedesc);
        
                    await notifyMe(userid, 'USD Account Request', 'user', notedesc)

                     var mailcontent = `
                    <p style="line-height: 30px; letter-spacing: 0.025em;">Oops! Your USD virtual account request has been declined by our partner bank.</p>
                    ${listItems }
                    <p style="line-height: 20px; letter-spacing: 0.025em;">Kindly login to your account to rectify the issue(s) above</p>
        
                    <p>For further enquiry, please call ${process.env.SITEPHONE}</p>
                    `;
        
                    const userinfo = await getUserInfo(userid);
                    const useremail = userinfo.email;
                    //send email                
                    await mailSender('', 'USD Account Request', useremail, mailcontent);

                    //UPDATE HOOK
                    await payWhk.update({ processed: 1 }, { where: { txref: txref} });

                    res.json({
                        status: true,
                        message: 'Notification Processed'
                    });
            }else{
                res.json({
                    status: true,
                    message: 'Request not found'
                });
            }

        }else if(eventtype == 'account.creation.successful'){
            const txref = resp['reference'];
            const id = resp['id'];

            const checkkad = await AcctRequest.findOne({where: {reference: txref} });
            if(checkkad){
                const userid = checkkad.userid;

                await USAccountUpd(txref, userid);  //check if account updated
                
                //UPDATE HOOK
                await payWhk.update({ processed: 1 }, { where: { txref: txref} });

                res.json({
                    status: true,
                    message: 'Notification Processed'
                });
            }else{
                res.json({
                    status: true,
                    message: 'Request not found'
                });
            }
            
        }else if(eventtype == 'collection.successful'){
            const txref = resp['reference'];
            const transid = resp['id'];

            // get the transaction details
            try {
                let config = {
                    method: 'GET',
                    url: `${process.env.MPLDURL}/transactions/${transid}`,
                    headers: {
                        accept: 'application/json',
                        'content-type': 'application/json',
                        'Authorization': `Bearer ${process.env.MPLSKEY}`
                    },
                };

                let response = await axios.request(config);
                let thedata = response.data;

                console.log('thedata', thedata);

                if (thedata.status && thedata.data.status == 'SUCCESS' && thedata.data.type == 'COLLECTION') {
                    const data = thedata['data'];
                    const transId = data['id'];
                    const transtype = data['entry'].toLowerCase(); //credit
                    const amount = data['amount'] > 0 ? data['amount']/100 : 0; //cent;
                    const fee = data['fee'] > 0 ? data['fee']/100 : 0; //cent;
                    const currency = data['currency'];
                    const channel = data['channel'];  // e.g fedwire
                    const narration = data['summary'];
                    const reason = data['reason'];
                    const sessionId = data['reference'];
                    const trackingId = data['account_id'];
                    const AmountPaid = amount;

                    var Reference = transId;

                    const receiver_info = data['customer'];
                    const receiverId = receiver_info['id'];
                    const receiverName = receiver_info['name'];
                    const receiverEmail = receiver_info['email'];
                    const receiverPhone = receiver_info['phone_number'];

                    
                    const sender_info = data['source'];
                    const SourceBank = sender_info['bank_name'];
                    const bankCode = sender_info['bank_code'];
                    const SourceName = sender_info['account_name'];
                    const SourceAcct = sender_info['account_number'];

                    // primary merchnat 
                    const ledger_info = data['ledger'];
                    const creditAmount = ledger_info['credit'];
                    const debitAmount = ledger_info['debit'];
                    const balance_type = ledger_info['balance_type']; //e.g available
                    const reversal = ledger_info['reversal'];

                    const t = await db.sequelize.transaction();

                    try {
                        var checkhook = await Payn.findAll({ where: { txref: Reference }, transaction: t })

                        if (checkhook.length > 0){
                            await t.rollback();
                            console.warn(`[Mpld Webhook] Duplicate transaction detected for reference: ${Reference}. Ignoring.`);
                            return;
                        }

                        //log the hook
                        let timed = Date.parse(new Date()) / 1000;
                        var transtimed = moment.unix(timed).format("Do MMM, YYYY hh:mm a")

                        var checkbank = await Bank.findOne({ where: { trackid: trackingId, currency: 'USD' }, transaction: t })
                        
                        if (checkbank) {
                            
                            var userid = checkbank.userid;
                            var AccountNo = checkbank.accountno;
                            var receivingBank = checkbank.bankname;
                            const getuser = await Customer.findOne({ where: { id: userid }, transaction: t }).catch((err) => { console.log("Unable to process your request : " + err); });
                            if (!getuser) {
                                await t.rollback();
                                console.warn(`[Mpld Webhook] Account owner not found for reference: ${Reference}. Ignoring.`);
                                return;
                            }

                            var fname = getuser.firstname;
                            var useremail = getuser.email;
                            var accounttier = getuser.accounttier;
                            var userbal = await getBal(userid, currency, { transaction: t });

                            // var newbal = parseFloat(userbal) + parseFloat(SettledAmount)
                            const chargefee = await getFee('usdcollection', AmountPaid, accounttier); //get inflow fee
                           
            
                            var inflowfee_cap = 500;
                            var inflowfee = parseFloat(chargefee[0]); //fee  10
                            var prvfee = chargefee[1]  //provider charg  40
                            // var tocharge = inflowfee;
                            // var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                            // var revenue = parseFloat(tocharge) - parseFloat(fee);
                            
                            var tocharge = inflowfee;
                            var getrate = await getFX('USD', 'NGN'); //echange rate
                            var rate = getrate[1];

                            var ourfee = inflowfee * rate;
                            var amountcharged = tocharge > inflowfee_cap ? inflowfee_cap : tocharge
                            var revenue = (parseFloat(tocharge) - parseFloat(fee)) * parseFloat(rate);

                            var tosettle = parseFloat(AmountPaid) - parseFloat(amountcharged);

                            // var meta_data = JSON.stringify({ "sourcename": SourceName, "sourceaccount": SourceAcct, "sourcebank": SourceBank });


                            // const revenue = parseFloat(profit);
                            const meta_data = JSON.stringify({ rate: parseFloat(rate), amount: AmountPaid, ourfee: ourfee, revenuengn: revenue, sourcename: SourceName, sourceaccount: SourceAcct, sourcebank: SourceBank});

                                
                            /* Update wallet */
                            const newbal = await updateBalance(userid, tosettle, currency, 'credit', { transaction: t }, true);

                            // LOG CREDIT
                            await Payn.create({
                                userid: userid, recipient: AccountNo, amount: tosettle, amountval: AmountPaid, currency: currency, newbal: newbal, prevbal: userbal, txref: Reference, pfor: 'wallet', usertype: 'user', paytype: transtype, productid: AccountNo, paychannel: 'mpld', paidthru: '', meta: meta_data, ntwk: SourceBank, pay_desc: narration, timed: timed, status: 1, name: SourceName, ntwkid: bankCode, fee: amountcharged, narration: narration, revenue: revenue, providerfee: fee, settlement_route: 'dollar'
                            }, { transaction: t });
                            
                                await payWhk.update({ processed: 1 }, { where: { txref: txref }, transaction: t });
                
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
                                        You have just received ${currency} collection in your ${currency} account - ${AccountNo}
                                    </p>
                
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount:</strong> $${formatAmount(AmountPaid)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Amount Settled:</strong> $${formatAmount(tosettle)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Fee:</strong> $${formatAmount(amountcharged)}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Bank:</strong> ${SourceBank == '' ? 'HitchPay' : SourceBank}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Source Account:</strong> ${SourceAcct}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Sender Name:</strong> ${SourceName}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Time:</strong> ${transtimed}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>Reference:</strong> ${Reference}</p>
                                    <p style="line-height: 20px; letter-spacing: 0.025em;"><strong>New Balance:</strong> $${formatAmount(dnewbal)}</p> <br>
                                    <p style="font-weight: 700; text-align: left">Love,<br> HitchPay Team</p>
                                </div>
                                `;
                
                                await mailSender(fname, `${currency} Collection Alert`, useremail, thecontent);
                                await mailSender(fname, `${currency} Collection Alert`, 'ojidex17@gmail.com', thecontent);
                
                                //send notification
                                var notedesc = `Account successfully credited with ${currency}${(tosettle).toFixed(2)} through ${AccountNo}- ${receivingBank}`;
                
                                await notifyMe(userid, `${currency} Collection Alert`, 'user', notedesc)
                
                                var thesmg = `You have just received a credit of ${currency}${(tosettle).toFixed(2)} to your wallet from ${SourceName} through ${AccountNo} - (${receivingBank})`;

                                await pushNotify(userid, `${currency} Collection Alert - HitchPay`, thesmg)
                                await pushNotify(4, `${currency} Collection Alert - HitchPay`, thesmg)

                                // return res.status(200).json({
                                //     status: true, message: 'Processed'
                                // })

                                console.log(`[Mpld Webhook] Successfully processed credit notification for user ${userid}, reference ${Reference}.`);

                            } else {
                                await t.rollback();
                                console.error(`[Mpld Webhook Error] Bank account not found for account number: ${AccountNo}. Transaction rolled back.`);
                            }

                        } catch (error) {
                            if (t.finished !== 'commit' && t.finished !== 'rollback') {
                                await t.rollback();
                            }
                            console.error(`[Mpld Webhook Error] Error during transaction processing for reference ${Reference}: `, error.message);
                        }

                } else {
                
                }

            } catch (error) {
                console.log(error)
                // return res.status(400).json({
                //     status: false,
                //     message: 'adm Card details could not retrieved ' + error.message,
                //     data: []
                // });
            }


            const checkkad = await AcctRequest.findOne({where: {reference: txref} });
            if(checkkad){
                const userid = checkkad.userid;

                await USAccountUpd(txref, userid);  //check if account updated
                
                //UPDATE HOOK
                await payWhk.update({ processed: 1 }, { where: { txref: txref} });

                res.json({
                    status: true,
                    message: 'Notification Processed'
                });
            }else{
                res.json({
                    status: true,
                    message: 'Request not found'
                });
            }
            
        }else{
            return res.status(400).json({
                status: false,
                message: 'Unexpected event type'
            });
        }
        
    }catch (error) {
        console.log("mpl hook ERROE: ", error.message);
        res.json({ status: false, message: `Something went wrong! Unable to process request ${error.message}` });
    }
}


module.exports = {
    maplHkNotify
}