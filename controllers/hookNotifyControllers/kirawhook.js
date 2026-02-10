const {db, md5, randomstring, uuidv4, axios, moment, bcrypt, Op, fn, col, crypto, sharp,
    mailSender, notifyMe, sendSMS, pushNotify, logBeneficiary,
    formatAmount, cleanMe, ucFirst, giveWelcomeBonus, referralUplineDownlineBonus, validateCacNumber, logger, genSHAccount, shAcessToken, getFee, getUserInfo, updateBalance, psb9Token, USAccountUpd, getFX, Customer, Business, Wallets, BizTeam, BizInvites, BizKeys, KYC, KycDoc, payWhk, Payn, AppSett, LogRequest, getBal, Bank, CardUser, VCard, CardTrans, AcctRequest } = require('./_dependencies');


const KraWhkNotify = async(req, res)=>{  
    try {
        
        const event = req.body;
        const dbody =JSON.stringify(event); 
        var resp = JSON.parse(dbody);
        var dtimed = Date.parse(new Date()) / 1000;

        if (!event) {
            console.error('[Webhook Error] kira WebHook Notify: Invalid or empty event body received.');
            return res.status(400).json({ 
                response_code: 400,
                response_description: "Invalid or empty event body received",
            });
        }

        const signature = req.headers['x-signature-sha256'];
        if (!signature) {
            console.error('[Webhook Error] kira WebHook Notify: Missing signature header.');

            return res.status(401).json({ 
                response_code: 401,
                response_description: "Missing signature header",
            });
        }

        // Verify webhook signature (if configured)
        if (signature) {
            const isValid = verifyWebhookSignature(req.body, signature);

            if (!isValid) {
            console.error('kira Invalid webhook signature');
            return res.status(401).send('Invalid signature');
            }
        }

        // Process the webhook
        // await handleWebhookEvent(event);       

        res.status(200).json({ 
            response_code: 200,
            response_description: "success",
        });

        //log webhook
        await payWhk.create({resp: dbody, txref: '', gateway: 'kira', timed: dtimed, processed: 0});



    } catch (error) {
        console.log('KIRA webhook error', error);
       return
    }
}


const verifyWebhookSignature = async(payload, signature)=>{
  const secret = process.env.KIRA_WBHSECRET;

  const computedSignature = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(computedSignature)
  );
}

async function handleWebhookEvent(event) {
  console.log(`Received event: ${event.event}`);

  switch (event.event) {
    case 'user.created':
      await handleUserCreatedEvent(event.data);
      break;

    case 'user.verification.accepted':
      await handleVerificationAcceptedEvent(event.data);
      break;

    case 'user.verification.failed':
      await handleVerificationFailedEvent(event.data);
      break;

    case 'virtual_account.deposit_funds_received':
      await handleDepositReceivedEvent(event.data);
      break;

    case 'virtual_account.deposit_funds_in_transit':
      await handleDepositInTransitEvent(event.data);
      break;

    case 'virtual_account.deposit_funds_in_destination':
      await handleDepositInDestinationEvent(event.data);
      break;

    case 'virtual_account.deposit_funds_refunded':
      await handleDepositRefundedEvent(event.data);
      break;

    case 'card_payment':
      await handleCardPaymentEvent(event.data);
      break;

    case 'transaction_update':
      await handleTransactionUpdateEvent(event.data);
      break;

    default:
      console.log(`Unhandled event type: ${event.event}`);
  }
}

    
module.exports = {
    KraWhkNotify
}