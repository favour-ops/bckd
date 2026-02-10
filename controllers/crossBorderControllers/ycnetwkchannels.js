//========================IMPORT DEPENDENCIES======================
// const { Pay } = require('twilio/lib/twiml/VoiceResponse');
const { axios, moment, Customer, bcrypt, md5, randomstring, Payn, AppSett, LogRequest, payWhk, KYC, KycDoc, RemittancePay, RemittanceAccounts } = require('./dependencies');
const { ycRequest } = require('./ycauth');
const crypto = require("crypto");
// const { getCybridAccessToken } = require('../remittanceControllers/cybridauth');
const { doCybridBankDeposit } = require('../remittanceControllers/customers');
const { createPaymentIntent } = require('../remittanceControllers/stripe_remittance');
const yccoverage = require('./yccoverage.json');


const { mailSender } = require('../../config/mailsender');
const { notifyMe, sendSMS, pushNotify } = require("../../config/notifyuser");
const { formatAmount, cleanMe, ucFirst, updateBalance, formatPhoneNumber, checkTransAuth, getFX, getYCFX} = require("../../config/myfunct");
const { logger } = require('../../config/logger');
const { getBal, logBeneficiary, getUserInfo} = require("../../config/userdetails");
const { cloudinary, firebaseUpload, AWSFileUpload } = require("../../config/imageuploads");


const getUniqueCountries = () => {
    const allCountries = [...yccoverage.coverage.collections, ...yccoverage.coverage.disbursements];
    const uniqueCountriesMap = new Map();

    allCountries.forEach(country => {
        if (!uniqueCountriesMap.has(country.iso)) {
            uniqueCountriesMap.set(country.iso, {
                name: country.country,
                iso_code: country.iso,
                currency: country.currency,
                bank_transfer: country.bank_transfer,
                mobile_money: country.mobile_money,
                dial_code: country.dial_code
            });
        }
    });

    return Array.from(uniqueCountriesMap.values());
};

const cachedCountries = getUniqueCountries();

// --- In-memory cache for exchange rates ---
let rateCache = {
    data: null,
    timestamp: 0,
};

const RATE_CACHE_DURATION = 1 * 60 * 1000;

const supportedCountries = async (req, res) => {
    try {

        const countries = cachedCountries;

        return res.status(200).json({
            status: true,
            message: 'Supported countries retrieved successfully.',
            data: countries
        });
    } catch (error) {
        logger.error('Error in supportedCountries:', error);
        return res.status(500).json({ status: false, message: 'Unble to process request at the moment.' });
    }
};


// === STEP 1: Get Available Channels ===
const getChannels = async (req, res) => {
    try {
        console.log('req.query', req.query)
        const { countrycode, ramptype } = cleanMe(req.query);

        if (!countrycode) {
            return res.status(400).json({ status: false, message: 'Country code is required.' });
        }

        if (!ramptype) {
            return res.status(400).json({ status: false, message: 'Ramp type (deposit or withdraw) is required.' });
        }

        const ycchannel = await ycRequest("GET", `/business/channels?country=${countrycode}`);

        if (ycchannel && ycchannel.channels) {
            // Filter for active 'momo' channels matching the specified ramptype
            const activeChannels = ycchannel.channels.filter(channel =>
                channel.status === 'active' &&
                channel.rampType === ramptype
            );

            // Map the filtered channels to the desired response format
            const formattedChannels = activeChannels.map(channel => {
                let title, logo, value, channeltype;

                if (channel.channelType === 'momo') {
                    title = 'Mobile Money';
                    value = 'mobilemoney';
                    channeltype = 'mobilemoney';
                } else if (channel.channelType === 'bank') {
                    title = 'Bank Transfer';
                    value = 'bank';
                    channeltype = 'bank';
                } else {
                    title = ucFirst(channel.channelType);
                    value = channel.channelType.toLowerCase();
                    channeltype = channel.channelType.toLowerCase();
                }

                return {
                    maxpay: channel.max,
                    currency: channel.currency,
                    countryCurrency: channel.countryCurrency,
                    // minpay: channel.min,
                    minpay: 100,
                    title: title,
                    dstatus: 1,
                    value: value,
                    channelid: channel.id,
                    channeltype: channeltype,
                };
            });

            return res.status(200).json({
                status: true,
                message: 'Channels successfully retrieved',
                data: formattedChannels
            });
        } else {
            return res.status(404).json({ status: false, message: 'Channels not found for the specified country.' });
        }
    } catch (error) {
        logger.error('Error in getChannels:', error);
        return res.status(500).json({ status: false, message: 'Unble to process request at the moment.' });
    }
};


// === STEP 2: Get Bank or Mobile Networks ===
const getNetworks = async (req, res) => {
    try {
        const { countrycode, channeltype } = cleanMe(req.query);
        // console.log('req.query', req.query)

        if (!countrycode || !channeltype) {
            return res.status(400).json({ status: false, message: '`countrycode` and `channeltype` are required query parameters.' });
        }

        // The API endpoint requires the channel type to be in uppercase.
        const endpoint = `/business/networks?country=${countrycode}`;
        const networkData = await ycRequest("GET", endpoint);

        // console.log('networkData', networkData)

        if (networkData && networkData.networks && networkData.networks.length > 0) {
            const filterType = channeltype.toLowerCase() === 'mobilemoney' ? 'phone' : 'bank';

            // Filter the networks to only include active ones of the correct type.
            const activeNetworks = networkData.networks.filter(network =>
                network.status === 'active' && network.accountNumberType === filterType
            );

            // Map the filtered networks to the desired response format.
            const formattedNetworks = activeNetworks.map(ntwk => ({
                network_id: ntwk.id,
                country: ntwk.country,
                name: ntwk.name,
                code: ntwk.code,
                channelIds: ntwk.channelIds,
                accountNumberType: ntwk.accountNumberType,
                status: ntwk.status,
                countryAccountNumberType: ntwk.countryAccountNumberType,
            }));

            // console.log('formattedNetworks', {
            //     status: true,
            //     message: 'Networks retrieved successfully.',
            //     data: formattedNetworks
            // })

            return res.status(200).json({
                status: true,
                message: 'Networks retrieved successfully.',
                data: formattedNetworks
            });
        }

        return res.status(404).json({ status: false, message: 'No networks found for the specified country and channel type.' });

    } catch (error) {
        logger.error('Error in getNetworks:', error);
        return res.status(500).json({ status: false, message: 'Unble to process request at the moment.' });
    }
};


const fetchExchangeRate = async (sourceCurrency, destinationCurrency) => {
    try {
        // const sourceCurrency = ';
        if (!sourceCurrency || !destinationCurrency) {
            return { status: false, message: 'Source and destination currencies are required.' };
        }

        // console.log('sourceCurrency', sourceCurrency)
        // console.log('destinationCurrency', destinationCurrency)

        let rateData; let crossRate = 0; let sourcePerUsd = 0; let destPerUsd = 0; let last_updated = '';
        const now = Date.now();

        // if (sourceCurrency == 'USD') {
        //     // use the cdn rate
            
            rateData = await getFX(sourceCurrency, destinationCurrency); 
            // rateData = await getYCFX(sourceCurrency, destinationCurrency); 
            if (rateData[0]) {
                crossRate = rateData[1];
                sourcePerUsd = 0;
                destPerUsd = 0;
            }

        // } else {
            
           /*  logger.info('Fetching fresh exchange rates from API.');
            const freshRateData = await ycRequest("GET", `/business/rates`);
            if (freshRateData && freshRateData.rates) {
                rateData = freshRateData;
                // console.log('rateData2', rateData)
                rateCache = { data: rateData, timestamp: now }; // Update cache
            }

            if (!rateData || !rateData.rates) {
                return { status: false, message: 'Could not retrieve exchange rates from the provider.' };
            }

             let sourceRateInfo;
        let destRateInfo;
        // let crossRate = 0;

        if(sourceCurrency.toUpperCase() == 'USD'){
            
            destRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === destinationCurrency.toUpperCase());  //extract
            if (!destRateInfo) return [false, 0, `Exchange rate for destination currency '${destinationCurrency}' not found.`];
            // console.log('freshRateData1', destRateInfo)

            sourcePerUsd = 1;
            destPerUsd = destRateInfo.buy;
            crossRate = destPerUsd / sourcePerUsd;
            
        }else if(destinationCurrency.toUpperCase() == 'USD'){
            sourceRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === sourceCurrency.toUpperCase());  //exrtact
            if (!sourceRateInfo) return [false, 0, `Exchange rate for sourcecurrency '${sourceCurrency}' not found.`];
            // console.log('freshRateData2', sourceRateInfo)

            sourcePerUsd = sourceRateInfo.buy;
            destPerUsd = 1;
            crossRate = destPerUsd / sourcePerUsd;
            
        }else{
            sourceRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === sourceCurrency.toUpperCase());  //exrtact
            destRateInfo = freshRateData.rates.find(r => r.code.toUpperCase() === destinationCurrency.toUpperCase());  //extract

            if (!sourceRateInfo) return [false, 0, `Exchange rate for fiat source currency '${sourceCurrency}' not found.`];
            if (!destRateInfo) return [false, 0, `Exchange rate for destination currency '${destinationCurrency}' not found.`];

            sourcePerUsd = sourceRateInfo.buy;
            destPerUsd = destRateInfo.buy;
            crossRate = destPerUsd / sourcePerUsd;
        } */

            // const sourceRateInfo = rateData.rates.find(r => r.code.toUpperCase() === sourceCurrency.toUpperCase());
            // const destRateInfo = rateData.rates.find(r => r.code.toUpperCase() === destinationCurrency.toUpperCase());

            // if (!sourceRateInfo) return { status: false, message: `Exchangerate for source currency '${sourceCurrency}' not found.` };
            // if (!destRateInfo) return { status: false, message: `Exchange rate for destination currency '${destinationCurrency}' not found.` };

            // sourcePerUsd = sourceRateInfo.buy;
            // destPerUsd = destRateInfo.sell;
            // crossRate = destPerUsd / sourcePerUsd;
            // last_updated = sourceRateInfo.updatedAt;
        // }

        return {
            status: true,
            message: 'Exchange rate retrieved successfully.',
            data: {
                source: sourceCurrency,
                destination: destinationCurrency,
                rate: crossRate,
                provider_rates: {
                    source_vs_usd: sourcePerUsd,
                    destination_vs_usd: destPerUsd
                },
                last_updated: last_updated
            }
        };

    } catch (error) {
        logger.error('Error in fetch ExchangeRate:', error);
        return { status: false, message: 'An internal error occurred while fetching the exchange rate.' };
    }
};

// debug fetchExchangeRate using usd and ngn
/* fetchExchangeRate('USD', 'NGN')
  .then(result => {     console.log("USD to NGN Rate:", result);
  })
  .catch(err => console.error("Script execution failed:", err))
  .finally(async () => {
      // Optional: Close database connection if this is a standalone script
      // await db.sequelize.close();
  }); */


// === STEP 3: Get Exchange Rate ===
const getRate = async (req, res) => {
    try {
        const { source_currency: sourceCurrency, destination_currency: destinationCurrency } = cleanMe(req.query);

        if (!sourceCurrency || !destinationCurrency) {
            return res.status(400).json({
                status: false,
                message: '`sourceCurrency` and `destinationCurrency` query parameters are required.',
            });
        }

        const result = await fetchExchangeRate(sourceCurrency, destinationCurrency);

        if (!result.status) {
            return res.status(404).json(result);
        }

        const responseData = { ...result.data, source: sourceCurrency.toUpperCase(), destination: destinationCurrency.toUpperCase() };

        return res.status(200).json({
            status: true,
            message: 'Exchange rate retrieved successfully.',
            data: responseData,
        });

    } catch (error) {
        logger.error('Error in getRate endpoint:', error);
        return res.status(500).json({ status: false, message: 'Unble to process request at the moment.' });
    }
};


const getCrossBorderOptions = async (req, res) => {
    try {
        const { countryCode, sourceCurrency, destinationCurrency, amount } = cleanMe(req.body);

        if (!countryCode || !sourceCurrency || !destinationCurrency || !amount) {
            return res.status(400).json({
                status: false,
                message: 'countryCode, sourceCurrency, destinationCurrency, and amount are required query parameters.'
            });
        }

        // We need to import the helper functions from ycauth.js
        const { getChannels, getNetworkData, getRate } = require('./ycauth');

        // Fetch all required data in parallel for efficiency
        const [channels, rate] = await Promise.all([
            getChannels(countryCode),
            getRate(sourceCurrency, destinationCurrency, parseFloat(amount))
        ]);

        if (!rate) {
            return res.status(400).json({ status: false, message: 'Could not retrieve exchange rate. The currency pair may not be supported.' });
        }

        const networks = {};
        if (channels && channels.length > 0) {
            // Fetch network data for each available channel
            for (const channel of channels) {
                const networkData = await getNetworkData(countryCode, channel.channel);
                if (networkData) {
                    networks[channel.channel.toLowerCase()] = networkData;
                }
            }
        }

        const responseData = {
            rate,
            channels,
            networks
        };

        return res.status(200).json({
            status: true,
            message: 'Payment options retrieved successfully.',
            data: responseData
        });

    } catch (error) {
        logger.error('Error in getCrossBorderOptions:', error);
        return res.status(500).json({ status: false, message: 'Unble to process request at the moment.' });
    }
};

const initiatePayment = async (req, res) => {

    try {
        const userid = req.user.id;

        if (!userid)
            return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        let { account_type, account_number, network_id, channel_id, account_name, localamount, reason, transpin, countrycode, currency, dialcode, isbeneficiary, paywith, paymenttype, authtoken } = cleanMe(req.body);
        const baseCurrencyAmount = localamount;
        console.log('paymntreqbody', req.body)


        // localamount/baseCurrencyAmount - the entered(basecurrency) amount (e.g 1000)
        //paywith - basecurrency OR accountid for linked account (e.g NGN or USD)
        //currency - destination currency (e.g KES)
        //paymenttype - linked account, link card, wallet

        // Basic validation
        if (!account_type || !account_number || !network_id || !channel_id || !account_name || !baseCurrencyAmount || !reason || !transpin || !countrycode || !currency || !paywith) {
            return res.status(400).json({
                status: false,
                message: 'One or more required fields are missing. Please check your input.'
            });
        }

        if (!paymenttype) { paymenttype = 'wallet' };

        if (paymenttype === 'linked_account') {
            //validate 2fa token
            const [isTokenValid, tokenMessage] = await checkTransAuth(userid, authtoken);
            if (!isTokenValid) {
                return res.status(400).json({ status: false, message: tokenMessage });
            }

            // check the stat of the account id
            const RemittanceAccountState = await RemittanceAccounts.findOne({ where: { external_bank_guid: paywith, userid: userid } });
            
            if (!RemittanceAccountState)
            return res.status(400).json({ status: false, message: 'Your linked bank account not found. Kindly reload the page and try again.' });

            if (RemittanceAccountState && RemittanceAccountState.verification_state != 'completed') {
                return res.status(400).json({ status: false, message: 'Your linked bank account not in active state. Kindly contact our support.'});
            }
        }


        // dialcode is compulsory for mobilemoney/mono
        if (account_type != 'bank' && !dialcode) {
            return res.status(400).json({ status: false, message: 'Dial code is required for mobile money payments.' });
        }

        //validate paymenttype can only be linked_account, linked_card, wallet
        const allowedPaymentTypes = ['linked_account', 'linked_card', 'wallet'];
        if (!allowedPaymentTypes.includes(paymenttype)) {
            return res.status(400).json({ status: false, message: 'Invalid payment type provided.' });
        }


        /* CHECK FOR EXISTENCE */
        const getUser = await Customer.findOne({ where: { id: userid } });
        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });

        const authpin = getUser.authpin;
        if (!authpin || authpin == '')
            return res.status(400).json({ status: false, message: 'You have not set a transaction PIN, kindly set it up from your dashboard' });

        if (!transpin || (transpin == ''))
            return res.status(400).json({ status: false, message: 'Invalid Transaction PIN' });

        const checkwithHashPwd = bcrypt.compareSync(transpin, authpin); // true

        if (!checkwithHashPwd)
            return res.status(400).json({ status: false, message: 'Invalid Transaction PIN' });

        if (!baseCurrencyAmount || baseCurrencyAmount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (baseCurrencyAmount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        // if paymenttype is linked_account, linked_card only allow countrycode US
        if (paymenttype === 'linked_account' || paymenttype === 'linked_card') {
            if (getUser.countrycode !== 'US') {
                return res.status(400).json({ status: false, message: 'Linked accounts and cards only supported for US customers.' });
            }
        }

        if (getUser.countrycode == 'NG') {
            var getkyc = await KYC.findOne({ where: { userid: userid, status: 1, vertype: 'BVN' }, order: [['id', 'DESC']] });

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your BVN verification to proceed', data: { errortype: "verificaton" } });

            var userphoneno = formatPhoneNumber(getUser.phoneno);

            var getninkyc = await KYC.findOne({ where: { userid: userid, status: 1, vertype: 'NIN' }, order: [['id', 'DESC']] });

            if (!getninkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your NIN verification in order to proceed', data: { errortype: "verificaton" } });

            // NIN for addition id
            var ninNumber = getninkyc.bvv;
            var ninType = getninkyc.vertype;

        } else {
            var getkyc = await KYC.findOne({ where: { userid: userid, status: 1, provider: 'veriff' }, order: [['id', 'DESC']] });

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your tier 2 verification to proceed', data: { errortype: "verificaton" } });

            var userphoneno = `${!getUser.dialcode ? '+1' : getUser.dialcode}${getUser.phoneno}`;

            var ninType = '';
            var ninNumber = '';
        }

        const verfname = getkyc.verfname;
        const verlname = getkyc.verlname;
        const verphone = getkyc.verphone;
        const verdob = getkyc.verdob;
        var identityNumber = getkyc.bvv;
        var identityType = getkyc.vertype;
        const momentDate = moment(verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');

        // our refercence 
        const txref = 'HTC' + md5(randomstring.generate(5) + userid).toUpperCase().substring(0, 12);

        let initialPayLog; let fee = 0;
        const getsett = await AppSett.findOne({ where: { id: 1 } });
        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

        if (getsett.crosstransfer <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get processing fee. Kindly contact our support' });

        // Use the new helper function to get the exchange rate
        if (paymenttype === 'linked_account' || paymenttype === 'linked_card') {
            var baseurrency = 'USD';
        } else {
            var baseurrency = paywith;
        }

        // GET EXCHANGE
        const getRateData = await fetchExchangeRate(baseurrency, currency);
        if (!getRateData.status) {
            return res.status(400).json({ status: false, message: getRateData.message || 'Unable to get exchange rate. Kindly retry' });
        }

        // GET EACH PAYMENT FEE
        if (paymenttype === 'linked_account') {
            fee = getsett.remittance_bank ? parseFloat(getsett.remittance_bank) : 0; //feepercent
        } else if (paymenttype === 'linked_card') {
            fee = getsett.remittance_card ? parseFloat(getsett.remittance_card) : 0; //feepercent
        } else {
            fee = getsett.crosstransfer ? parseFloat(getsett.crosstransfer) : 0; //feepercent
        }

        const ourfee = (parseFloat(fee) * baseCurrencyAmount) / 100; //fee percentage
        const dfee = parseFloat(ourfee.toFixed(2)); //our fee

        const tocharge = baseCurrencyAmount + dfee; //total to debit from user wallet/acconunt
        const totalFee = tocharge - baseCurrencyAmount;

        //CONVERT TO DESTINATION AMOUNT 
        const exchangeRate = getRateData.data.rate; // e.g., KES to XOF rate
        // console.log('exchangeRate', exchangeRate)
        const topay = parseFloat(tocharge) * parseFloat(exchangeRate).toFixed(2);  //to pay with destination currency
        const feeconvert = parseFloat(dfee) * parseFloat(exchangeRate).toFixed(2);  //fee to pay with destination currency
        const totalAmount = parseFloat(topay.toFixed(2)); //destination currency amount

        const destinationCurrencyAmount = totalAmount - feeconvert; //main transaction amount in destination

        const pay_desc_initial = `Transfer of ${baseurrency}${baseCurrencyAmount.toFixed(2)} (${currency}${destinationCurrencyAmount.toFixed(2)}) to ${account_name} - (${account_number}) in ${countrycode}`;
        const modifyprd = 'globaltransfer';
        const timed = Math.floor(Date.now() / 1000);
        const ntwk = countrycode;
        const recipientno = account_number;

        //calculate profit
        const providerfeepercent = getsett.providerfee ? parseFloat(getsett.providerfee) : 0;
        const actualProviderFee = (providerfeepercent * baseCurrencyAmount) / 100;
        const calculatedProfit = dfee - actualProviderFee;
        const env = process.env.APPENV == 'production' ? 'live' : 'test';

        // Construct payload for YC payment after successful deposit initiation
        const payload = {
            sender: {
                name: `${verfname} ${verlname}`, country: getUser.countrycode, phone: userphoneno, address: getUser.address,
                dob: dateOfBirth, email: getUser.email, idNumber: identityNumber, idType: getUser.countrycode == 'NG' ? identityType : "license", additionalIdType: ninType, sadditionalIdNumber: ninNumber,
            },
            destination: {
                accountType: account_type == 'mobilemoney' ? 'momo' : account_type,  //or momo
                accountNumber: `${dialcode}${account_number}`, networkId: network_id, accountName: account_name, country: countrycode
            },
            forceAccept: true,
            customerType: 'retail',
            customerUID: userid.toString(),
            channelId: channel_id,
            sequenceId: txref,
            localAmount: parseFloat(destinationCurrencyAmount), //this is converted sending amount e.g KES
            reason: reason
        };

        if (paymenttype === 'linked_account') {
            // call the deposit
            // Log the deposit initiation
            initialPayLog = await Payn.create({
                userid: userid, amount: tocharge, amountval: baseCurrencyAmount, newbal: 0, prevbal: 0,
                txref: txref, pfor: modifyprd, usertype: 'user', paytype: 'debit', productid: '',
                ntwk: ntwk, paidthru: 'Linked Account', pay_desc: pay_desc_initial, timed: timed, status: 0,
                recipient: recipientno, fee: totalFee, payroute: env, currency: baseurrency, revenue: totalFee,
                providerfee: actualProviderFee, rate: exchangeRate, meta: JSON.stringify(payload),
            });

            if (!initialPayLog) {
                return res.status(500).json({ status: false, message: 'Failed to initiate transaction.' });
            }

            const InitDeposit = await doCybridBankDeposit(tocharge, paywith, userid, baseCurrencyAmount, txref);  //charge the amount from the customer bank account
            if (!InitDeposit[0]) {
                return res.status(500).json({ status: false, message: InitDeposit[1] || 'Failed to initiate deposit to the account.' });
            }

            const depositData = InitDeposit[2];
            const depositId = depositData.transfer_guid;
            const customerGuid = depositData.customerGuid;
            const bankGuid = depositData.bankGuid;
            const depositState = depositData.transfer_state;
            const estimatedAmount = depositData.estimated_amount / 100;
            const paymentRail = depositData.payment_rail;
            const holdDuration = depositData.hold_duration;
            const holdStarted_at = depositData.hold_started_at;
            const hold_applicable_types = depositData.hold_applicable_types;

            // update transaction log
            await Payn.update({
                provref: depositId, status: 0, paychannel: 'YC',
                jsonresp: JSON.stringify(depositData)
            }, { where: { id: initialPayLog.id, txref: txref } });


            return res.status(200).json({
                status: true,
                message: 'Transfer successfully initiated. Payment processing...',
                data: {
                    reference: txref, paymentid: depositId, amount: localamount, currency: baseurrency, rate: exchangeRate,
                    attempt: 1, prevbal: 0, newbal: 0, customerGuid: customerGuid, bankGuid: bankGuid, depositState: depositState,
                    estimatedAmount: estimatedAmount, paymentRail: paymentRail, holdDuration: holdDuration, holdStarted_at: holdStarted_at,
                    hold_applicable_types: hold_applicable_types
                }
            });


        } else if (paymenttype === 'linked_card') {
            // Log the deposit initiation

            const paynarration = `Debit Purchase`

            initialPayLog = await Payn.create({
                userid: userid, amount: tocharge, amountval: baseCurrencyAmount, newbal: 0, prevbal: 0,
                txref: txref, pfor: modifyprd, usertype: 'user', paytype: 'debit', productid: paywith,
                ntwk: ntwk, paidthru: 'Linked Card', pay_desc: paynarration, timed: timed, status: 0,
                recipient: recipientno, fee: totalFee, payroute: env, currency: baseurrency, revenue: totalFee,
                providerfee: actualProviderFee, rate: exchangeRate, meta: JSON.stringify(payload),
            });

            if (!initialPayLog) {
                return res.status(500).json({ status: false, message: 'Failed to initiate payment.' });
            }
            // create a payment intent
            const paymethod_id = paywith;
            const paymentIntent = await createPaymentIntent(userid, paymethod_id, baseCurrencyAmount, tocharge, txref);

            if (paymentIntent && paymentIntent[0] && paymentIntent[3]) {
                const intentData = paymentIntent[2];
                var paymentStatus = intentData.pay_status == 'succeeded' ? 1 : 0;
                // update record
                await Payn.update({ provref: intentData.payintent_id }, { where: { id: initialPayLog.id, txref: txref } });

                return res.status(200).json({
                    status: false,
                    message: 'Payment requires confirmation.',
                    data: {
                        reference: txref,
                        paymentid: intentData.payintent_id,
                        bankGuid: intentData.clientSecret,
                        paymentRail: intentData.clientSecret,
                        require_auth: paymentIntent[3]
                    }
                });

            } else if (paymentIntent && paymentIntent[0]) {
                const intentData = paymentIntent[2];

                const paymentIntentId = intentData.payintent_id;
                const paymentIntentStatus = intentData.pay_status;
                const paymentIntentClientSecret = intentData.clientSecret;
                const payment_method = intentData.payment_method;
                const application_fee_amount = intentData.application_fee_amount;
                const customerid = intentData.customerid;

                var paymentStatus = paymentIntentStatus == 'succeeded' ? 1 : 0;

                await Payn.update({
                    provref: paymentIntentId, status: paymentStatus, paychannel: 'YC',
                    jsonresp: JSON.stringify(intentData)
                }, { where: { id: initialPayLog.id, txref: txref } });

                return res.status(200).json({
                    status: true,
                    message: 'Payment successfully initiated. Payment processing...',
                    data: {
                        reference: txref,
                        paymentid: paymentIntentId,
                        amount: localamount,
                        currency: baseurrency,
                        rate: exchangeRate,
                        attempt: 1, prevbal: 0, newbal: 0,
                        customerGuid: customerid,
                        bankGuid: paymentIntentClientSecret,
                        depositState: paymentIntentStatus,
                        estimatedAmount: 0,
                        paymentRail: paymentIntentClientSecret,
                        holdDuration: '',
                        holdStarted_at: '',
                        hold_applicable_types: '',
                        require_auth: paymentIntent[3]
                    }
                });


            } else {
                return res.status(400).json({ status: false, message: 'Failed to initiate payment.' });
            }


        } else {
            //========================= payment with wallet====================//

            const userbal = await getBal(userid, baseurrency, {}, 'personal');

            if (userbal < baseCurrencyAmount) {
                return res.status(400).json({ status: false, message: `Insufficient wallet balance to complete this transaction. Please fund your ${baseurrency} wallet and try again.` });
            }

            const newbalFromUpdate = await updateBalance(userid, baseCurrencyAmount, baseurrency, 'debit', {}, false, 'personal');

            initialPayLog = await Payn.create({
                userid: userid, amount: tocharge, amountval: baseCurrencyAmount, newbal: newbalFromUpdate, prevbal: userbal,
                txref: txref, pfor: modifyprd, usertype: 'user', paytype: 'debit', productid: channel_id, ntwk: ntwk, paidthru: 'Wallet',
                pay_desc: pay_desc_initial, timed: timed, status: 0, recipient: recipientno, fee: feeconvert, payroute: env,
                currency: baseurrency, revenue: feeconvert, providerfee: actualProviderFee, rate: exchangeRate
            });

            if (!initialPayLog) {
                return res.status(500).json({ status: false, message: 'Failed to log payment' });
            }

            // console.log('payload', payload)

            // log request payload
            const data = JSON.stringify(payload);
            await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'globaltransfer', provider: 'yc' });

            // call the payment function
            const paymentResponse = await YCPayment(payload);

            // console.log('paymentResponse', paymentResponse)

            if (!paymentResponse || (paymentResponse.status !== 'created' && paymentResponse.status !== 'processing')) {
                // Use the provider's message if available, otherwise a default failure message.
                throw new Error(paymentResponse?.message || 'Failed to initiate payment with the provider.');
            }

            const jsonString2 = JSON.stringify(paymentResponse);
            if (paymentResponse && paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process') {
                const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
                const api_convertedAmount = paymentResponse.convertedAmount;
                const api_rate = paymentResponse.rate;
                const api_amount = paymentResponse.amount;
                const networkName = paymentResponse.destination?.networkName;
                const api_currency = paymentResponse?.currency;
                const attempt = paymentResponse.attempt;

                // prepare meta data
                const meta_data = JSON.stringify({
                    account_type, account_number, network_id, channel_id, account_name,
                    localamount, reason, countrycode, network_name: networkName, rate: exchangeRate,
                    converted_paycurrency: topay, main_amount_converted: destinationCurrencyAmount, feeconvert
                });

                // update the log with provider reference
                await Payn.update({
                    status: 1, paidthru: 'wallet', paychannel: 'YC', productid: provref,
                    jsonresp: jsonString2, meta: meta_data, settlement_route: ''
                }, { where: { id: initialPayLog.id, txref: txref } });

                //log beneficiary if isbeneficiary
                if (isbeneficiary) {
                    await logBeneficiary(userid, modifyprd, recipientno, networkName, network_id, account_name);
                }

                return res.status(200).json({
                    status: true,
                    message: 'Payment initiated successfully.',
                    data: {
                        reference: txref,
                        paymentid: provref,
                        amount: api_convertedAmount,
                        currency: api_currency,
                        rate: api_rate,
                        attempt: attempt,
                        prevbal: userbal,
                        newbal: newbalFromUpdate
                    }
                });
            } else {
                // update payn log
                await Payn.update({
                    status: 5, paidthru: 'wallet', paychannel: 'YC', productid: '',
                    jsonresp: jsonString2, meta: '', settlement_route: '', narration: paymentResponse?.message || 'Failed to initiate payment with the provider.'
                }, { where: { id: initialPayLog.id, txref: txref } });

                return res.status(400).json({
                    status: false,
                    message: paymentResponse?.message || 'Failed to initiate payment with the provider.',
                    data: paymentResponse
                });

            }

        }


    } catch (error) {
        // return res.status(500).json({ status: false, message: 'Unable to process your request at moment.' });
        logger.error('Error in initiatePayment:', { message: error.message, providerResponse: error.providerResponse, stack: error.stack });

        const errorMessage = error.providerResponse?.message || error.message || 'Unable to process your request at the moment.';

        const statusCode = error.providerResponse ? 400 : 500;
        return res.status(statusCode).json({ status: false, message: errorMessage });
    }
};


// create YC payment fnction
const YCPayment = async (payload) => {
    console.log('payload', payload)
    try {
        const paymentResponse = await ycRequest("POST", "/business/payments", payload);
        // console.log('paymentResponse', paymentResponse)
        return paymentResponse;
    } catch (error) {
        logger.error('Error in YC Payment:', error);
        throw error;
    }
};

const initiateCollections = async (req, res) => {

    try {
        // if (process.env.APPENV !== 'development') {
        //     return res.status(403).json({ status: false, message: 'This feature is temporarily not available' });
        // }

        const userid = req.user.id;

        if (!userid) return res.status(400).json({ status: false, message: 'Oops! Invalid request sent!' });

        const { account_type, account_number, network_id, channel_id, account_name, localamount, reason, countrycode, currency, dialcode } = cleanMe(req.body);

        // Basic validation
        if (!account_type || !network_id || !channel_id || !account_name || !localamount || !reason || !countrycode || !currency) {
            return res.status(400).json({
                status: false,
                message: 'One or more required fields are missing. Please check your input.'
            });
        }

        // dialcode is compulsory for mobilemoney / mono
        if (account_type != 'bank' && !dialcode) {
            return res.status(400).json({ status: false, message: 'Dial code is required for mobile money payments.' });
        }

        /* CHECK FOR EXISTENCE */
        const getUser = await Customer.findOne({ where: { id: userid } });

        if (!getUser)
            return res.status(400).json({ status: false, message: 'Unable to locate your account, kindly logout and relogin' });

        if (!localamount || localamount == '')
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        if (localamount <= 0)
            return res.status(400).json({ status: false, message: 'Kindly enter a valid amount' });

        // our refercence 
        const txref = 'HTC' + md5(randomstring.generate(3) + userid).toUpperCase().substring(0, 10);

        let initialPayLog;
        const getsett = await AppSett.findOne({ where: { id: 1 } });
        if (!getsett)
            return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

        if (getsett.crosscollectfee <= 0)
            return res.status(400).json({ status: false, message: 'Unable to get processing fee. Kindly contact our support' });

        var fee = getsett.crosscollectfee;
        const ourfee = (parseFloat(fee) * localamount) / 100; //fee percentage
        const dfee = parseFloat(ourfee.toFixed(2)); //our fee

        const topay = localamount + dfee; //total to debit from user
        const pay_desc_initial = `Remittance of ${currency}${localamount} to ${account_name} - (${account_number}) in ${countrycode}`;
        const modifyprd = 'crosscollection';
        const timed = Math.floor(Date.now() / 1000);
        const ntwk = countrycode;
        const recipientno = account_number;

        //calculate profit
        const providerfeepercent = getsett.providerfee ? parseFloat(getsett.providerfee) : 0;
        const actualProviderFee = (providerfeepercent * localamount) / 100;
        const calculatedProfit = dfee - actualProviderFee;

        const env = 'test';

        initialPayLog = await Payn.create({
            userid: userid, amount: localamount, amountval: localamount, newbal: 0, prevbal: 0,
            txref: txref, pfor: modifyprd, usertype: 'user', paytype: 'credit', productid: channel_id, ntwk: ntwk, paidthru: 'Wallet',
            pay_desc: pay_desc_initial, timed: timed, status: 0, recipient: recipientno, fee: dfee, payroute: env, currency: currency,
            revenue: calculatedProfit, providerfee: actualProviderFee
        });

        if (!initialPayLog) {
            return res.status(500).json({ status: false, message: 'Failed to log payment' });
        }

        if (getUser.countrycode == 'NG') {
            var getkyc = await KYC.findOne({ where: { userid: userid, status: 1, vertype: 'BVN' }, order: [['id', 'DESC']] });

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your BVN verification to proceed', data: { errortype: "verificaton" } });

            var userphoneno = formatPhoneNumber(getUser.phoneno);

            var getninkyc = await KYC.findOne({ where: { userid: userid, status: 1, vertype: 'NIN' }, order: [['id', 'DESC']] });

            if (!getninkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your NIN verification in order to proceed', data: { errortype: "verificaton" } });

            // NIN for addition id
            var ninNumber = getninkyc.bvv;
            var ninType = getninkyc.vertype;

        } else {
            var getkyc = await KYC.findOne({ where: { userid: userid, status: 1, provider: 'veriff' }, order: [['id', 'DESC']] });

            if (!getkyc)
                return res.status(400).json({ status: false, message: 'Kindly complete your tier 2 verification to proceed', data: { errortype: "verificaton" } });

            var userphoneno = `${!getUser.dialcode ? '+1' : getUser.dialcode}${getUser.phoneno}`;

            var ninType = '';
            var ninNumber = '';
        }

        const verfname = getkyc.verfname;
        const verlname = getkyc.verlname;
        const verphone = getkyc.verphone;
        const verdob = getkyc.verdob;
        var identityNumber = getkyc.bvv;
        var identityType = getkyc.vertype;
        const momentDate = moment(verdob, 'YYYY-MM-DD');
        var dateOfBirth = momentDate.format('DD-MM-YYYY');


        const payload = {
            recipient: {
                name: `${verfname} ${verlname}`,
                country: countrycode,
                phone: userphoneno,
                address: getUser.address,
                dob: dateOfBirth,
                email: getUser.email,
                idNumber: identityNumber,
                idType: countrycode == 'NG' ? identityType : "license",
                additionalIdType: countrycode == 'NG' ? ninType : "",
                additionalIdNumber: countrycode == 'NG' ? ninNumber : "",
            },
            source: {
                accountNumber: `${dialcode}${account_number}`,
                // accountNumber: `254712345678`, //dummy for collection source
                accountType: account_type,
                networkId: network_id,
            },
            forceAccept: true,
            channelId: channel_id,
            sequenceId: txref,
            localAmount: parseFloat(localamount),
            reason: reason,
            fee: 0,
            redirectUrl: "https://dev-payment.hitchpay.ng/vercrossborder",
            customerType: 'retail',
            customerUID: userid.toString(),
        };

        // log request payload
        const data = JSON.stringify(payload);
        await LogRequest.create({ reference: txref, jsonreq: data, timed: timed, product: 'crosscollections', provider: 'yc' });

        // call the provider
        const paymentResponse = await ycRequest("POST", "/business/collections", payload);

        const jsonString2 = JSON.stringify(paymentResponse);

        // console.log('paymentResponse', paymentResponse)

        if (paymentResponse && (paymentResponse.status == 'created' || paymentResponse.status == 'processing' || paymentResponse.status == 'process')) {
            const provref = paymentResponse && paymentResponse.id ? paymentResponse.id : '';
            const api_convertedAmount = paymentResponse.convertedAmount;
            const api_rate = paymentResponse.rate;
            const api_amount = paymentResponse.amount;
            const networkName = paymentResponse.destination?.networkName;
            const api_currency = paymentResponse?.currency;
            const attempt = paymentResponse.attempt;
            const service_fee_local = paymentResponse.serviceFeeAmountLocal;
            const service_fee_usd = paymentResponse.serviceFeeAmountUSD;
            const deposit_id = paymentResponse.depositId;
            const bank_info = paymentResponse.bankInfo;

            // prepare meta data
            const meta_data = JSON.stringify({
                account_type: account_type, account_number, network_id, channel_id, account_name,
                localamount, reason, countrycode, network_name: networkName, depositid: deposit_id,
                service_fee_local: service_fee_local, service_fee_usd: service_fee_usd, bank_info: bank_info
            });

            // update the log with provider reference
            await Payn.update({
                paidthru: '', paychannel: 'YC', productid: provref,
                jsonresp: jsonString2, meta: meta_data, revenue: 0, settlement_route: ''
            }, { where: { id: initialPayLog.id, txref: txref } });

            return res.status(200).json({
                status: true,
                message: 'Payment initiated successfully.',
                data: {
                    reference: txref,
                    paymentid: provref,
                    amount: api_convertedAmount,
                    currency: api_currency,
                    rate: api_rate,
                    bankInfo: paymentResponse.bankInfo
                }
            });

        } else {
            return res.status(400).json({
                status: false,
                message: paymentResponse?.message || 'Failed to initiate payment with the provider.',
                data: paymentResponse
            });
        }


    } catch (error) {
        logger.error('Error in initiateCollections:', error);
        return res.status(500).json({ status: false, message: 'Unable to completely process your request.' });
    }
};


// funtion to do collection look up
const getCollectionLookup = async (req, res) => {
    // if (process.env.APPENV !== 'development') {
    //     return res.status(403).json({ status: false, message: 'This feature is temporarily not available' });
    // }

    try {
        const { reference } = cleanMe(req.params);

        if (!reference) {
            return res.status(400).json({ status: false, message: 'Payment reference is required.' });
        }

        // check if the reference exist and get the provider trasnaction id from productid column
        const transaction = await Payn.findOne({
            where: { txref: reference, usertype: 'user', pfor: 'crosscollection' }
        });

        if (!transaction) {
            return res.status(404).json({ status: false, message: 'Payment not found.' });
        }

        // validate if trasnaction alread marked as completed
        if (transaction.status == 1)
            return res.status(200).json({ status: true, message: 'Payment already processed successfully.', data: [] });

        const collectionId = transaction.productid;
        if (!collectionId) {
            return res.status(404).json({ status: false, message: 'Provider Payment ID not found for this transaction.' });
        }

        const lookupResponse = await ycRequest("GET", `/business/collections/${collectionId}`);

        if (lookupResponse && lookupResponse.id && lookupResponse.status == 'complete') {
            const currency = lookupResponse.currency; //e.g KES
            const convertedAmount = parseFloat(lookupResponse.convertedAmount);
            const serviceFeeAmountLocal = lookupResponse.serviceFeeAmountLocal;
            const serviceFeeAmountUSD = lookupResponse.serviceFeeAmountUSD;
            const sessionId = lookupResponse.sessionId;
            const serviceFeeId = lookupResponse.serviceFeeId;
            const rate = lookupResponse.rate;

            // calculte the our fee, update the payn for the trasction and credit the customer
            const getsett = await AppSett.findOne({ where: { id: 1 } });
            if (!getsett)
                return res.status(400).json({ status: false, message: 'Unable to process request. Kindly retry' });

            if (!getsett.crosscollectfee || getsett.crosscollectfee <= 0)
                return res.status(400).json({ status: false, message: 'Unable to get processing fee. Kindly contact our support' });

            const ourProfit = getsett.crosscollectfee; // This is a percentage
            const calculatedOurFee = (parseFloat(ourProfit) * convertedAmount) / 100;

            const ourRevenue = calculatedOurFee - serviceFeeAmountLocal;

            // get balance
            const userbal = await getBal(transaction.userid, currency, {}, 'personal');
            const prevbal = !userbal ? 0 : userbal;


            // Credit the user's wallet with the collected amount minus our fee
            const amountToCredit = convertedAmount - calculatedOurFee;

            const newbalFromUpdate = await updateBalance(transaction.userid, amountToCredit, currency, 'credit', {}, true, 'personal');

            // Update the Payn record
            await Payn.update({
                status: 1, prevbal, newbal: newbalFromUpdate,
                amount: convertedAmount,
                fee: calculatedOurFee,
                revenue: ourRevenue,
                jsonresp: JSON.stringify(lookupResponse),
                settlement_route: '',
                paychannel: 'YC'
            }, { where: { id: transaction.id, txref: transaction.txref } });

            // Notify the user about the successful Payment
            await notifyMe(transaction.userid, 'Payment Successful', `Your global collections of ${currency} ${amountToCredit} has been successfully processed and credited to your wallet.`, 'success');

            // Log the transaction for audit
            logger.info(`Global collections for ${reference} completed. User ${transaction.userid} credited ${currency} ${amountToCredit}.`);


            return res.status(200).json({
                status: true,
                message: 'Payment Successfully Processed',
                data: {
                    amountcredited: amountToCredit,
                    newbal: newbalFromUpdate,
                }
            });

        } else {
            return res.status(404).json({
                status: false,
                message: !lookupResponse.status ? 'Unable to retrieve payment details at the moment' : lookupResponse.status,
                data: lookupResponse
            });
        }

    } catch (error) {
        // Log the full error for debugging purposes.
        logger.error('Error in initiatCollections looup:', { message: error.message, providerResponse: error.providerResponse, stack: error.stack });

        const errorMessage = error.providerResponse?.message || error.message || 'Unable to process your request at the moment.';

        const statusCode = error.providerResponse ? 400 : 500;
        return res.status(statusCode).json({ status: false, message: errorMessage });
    }
};

const setupWebhook = async (state, url) => {
    try {

        // validate inputs
        if (!state || !url) {
            logger.error('State and URL are required to create a webhook.')

        }

        let payload = {
            url: url,
            state: ``
            // state: `${state}.complete`
        }

        const paymentResponse = await ycRequest("POST", "/business/webhooks", payload);
        logger.info('paymentResponse', paymentResponse);
        // const jsonString2 = JSON.stringify(paymentResponse);

        /* if (paymentResponse && paymentResponse.status == 'created') {
            return {
                status: true,
                message: 'Webhook created successfully.',
                data: paymentResponse
            };
        }else{
            return {
                status: false,
                message: paymentResponse?.message || 'Failed to create webhook with the provider.',
                data: paymentResponse
            };
        } */


    } catch (error) {
        logger.error('Error in CreateWebhook:', error);
        // return res.status(500).json({ status: false, message: 'Unable to create webhook at the moment.' });
    }
}

// setupWebhook('collection', 'https://dev.hitchpay.ng/paywpphk/xbodwhgkyc44');

// lisstent to webhook events

const theYcWebhook = async (req, res) => {
    try {
        res.status(200).json({ status: true, message: "Webhook received and queued for processing." });

        const event = cleanMe(req.body);

        if (!event) {
            console.error('[YC Webhook Error] ycWebhook: Invalid or empty event body received.');
            return;
        }

        const dbody = JSON.stringify(event);
        var resp = JSON.parse(dbody);

        var event_type = resp['event'].toLowerCase();
        var provider_ref = resp['id'];

        // console.log('event', event)

        //log the hook
        let timed = Date.parse(new Date()) / 1000;
        await payWhk.create({ resp: dbody, txref: provider_ref, gateway: 'yc', timed: timed, processed: 0 });

        await LogRequest.create({ reference: provider_ref, jsonreq: dbody, timed: timed, product: 'globaltransfer_webhook', provider: 'yc' }).catch((err) => {
            console.error("Unable to log YC webhook: " + err);
        });

    
        if (event_type === 'payment.complete' || event_type === 'collection.complete' || event_type === 'payment.failed') {
            const txref = resp['sequenceId'];
            const status = resp['status'];
            const failureReason = resp['failureReason'];
            const amount = resp['localAmount'];
            const currency = resp['currency'];
            const convertedAmount = resp['convertedAmount'];
            const rate = resp['rate'];
            const networkName = resp['destination']?.networkName || resp['source']?.networkName; // For payments, destination; for collections, source.

            const transaction = await Payn.findOne({ where: { txref: txref } });
            if (!transaction) {
                console.warn(`[YC Webhook] Transaction with txref ${txref} not found. Ignoring.`);
                return;
            }

            // Prevent reprocessing if already completed
            if (transaction.status === 2) {
                console.info(`[YC Webhook] Transaction with txref ${txref} is already completed. Ignoring duplicate webhook.`);
                return;
            }

            // get the remittance pay with the reference
            const remittancePay = await RemittancePay.findOne({ where: { reference: txref } });

            if (remittancePay) {
                if (status === 'complete') {
                    await RemittancePay.update({ status: 'completed' }, { where: { reference: txref } });
                    console.info(`[YC Webhook] RemittancePay with txref ${txref} marked as completed.`);

                } else if (status === 'failed') {
                    await RemittancePay.update({ status: 'failed' }, { where: { reference: txref } });
                    console.info(`[YC Webhook] RemittancePay with txref ${txref} marked as failed`);
                }
            }

            if (status === 'complete') {
                // LUPDATE PROVIDER REVENUE
                const getDetails = await getPaymentDetails(txref, transaction.pfor);
                if (getDetails[0]) {

                    const theData = getDetails[1];
                    const loacalCurrency = theData.localCurrency;
                    const localAmount = theData.localAmount;
                    const serviceFeeAmountLocal = theData.serviceFeeAmountLocal;
                    const amountUSD = theData.amountUSD;
                    const serviceFeeAmountUSD = theData.serviceFeeAmountUSD;
                    const rate = theData.rate;

                    const profit = transaction.revenue - serviceFeeAmountUSD;

                    await Payn.update({ status: 1, revenue: profit, providerfee: serviceFeeAmountUSD }, { where: { txref: txref } });
                } else {
                    await Payn.update({ status: 1 }, { where: { txref: txref } });

                }

                // Update transaction as successful                
                console.info(`[YC Webhook] Transaction with txref ${txref} marked as completed.`);

            } else if (status === 'failed') {
                // Update transaction as failed with reason
                await Payn.update({ status: 5 }, { where: { txref: txref } });
                console.info(`[YC Webhook] Transaction with txref ${txref} marked as failed. Reason: ${failureReason}`);

                const getCustomer = await getUserInfo(transaction.userid);
                const fname = getCustomer.firstname;
                const useremail = getCustomer.email;
                const mailcontent = `
                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">Dear ${fname},</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">We regret to inform you that your global transfer of ${transaction.currency}${transaction.amountval} to ${transaction.ntwk} - ${transaction.recipient} has failed.</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Transaction Reference:</strong> ${transaction.txref}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;"><strong>Date:</strong> ${moment.unix(transaction.timed).format("Do MMM, YYYY hh:mm a")}</p>
                    <p style="line-height: 20px; letter-spacing: 0.025em; font-size: 15px;">You can view the details of this transaction in your HitchPay account.</p>
                    <p style="font-weight: 700; text-align: left">Sincerely,<br> The HitchPay Team</p>
                `;

                await mailSender(fname, 'Global Transfer Failed', useremail, mailcontent);

            } else {
                console.info(`[YC Webhook] Transaction with txref ${txref} has unhandled status: ${status}. No action taken.`);
            }

        } else {
            console.info(`[YC Webhook] Unhandled event type: ${event_type}. No action taken.`);
        }

    } catch (error) {
        console.error('[YC Webhook Error]', error);
        // Note: Response already sent at the start of the function.
    }
}


const getPaymentDetails = async (txref, type) => {
    let PaymentDetails;

    if (type == 'globaltransfer') {
        PaymentDetails = await ycRequest("GET", `/business/payments/sequence-id/${txref}`);
    } else {
        PaymentDetails = await ycRequest("GET", `/business/collections/sequence-id/${txref}`);
    }

    if (PaymentDetails && PaymentDetails.id && PaymentDetails.status == 'complete') {
        const localCurrency = PaymentDetails.currency;
        const localAmount = parseFloat(PaymentDetails.convertedAmount);
        const serviceFeeAmountLocal = parseFloat(PaymentDetails.serviceFeeAmountLocal);
        const amountUSD = PaymentDetails.amount;
        const serviceFeeAmountUSD = PaymentDetails.serviceFeeAmountUSD;
        const rate = PaymentDetails.rate;

        const data = {
            localCurrency, localAmount, serviceFeeAmountLocal, amountUSD, serviceFeeAmountUSD, rate
        }

        return [true, data];

    } else {
        return [false, null];
    }

    // return ycchannel;

}

/* getPaymentDetails('HTC29AE25BF039E')
.then(result => {
    console.log("Aresult:", result);
})
.catch(err => console.error("Script execution failed:", err))
.finally(async () => {
    // Optional: Close database connection if this is a standalone script
    // await db.sequelize.close();
});
 */


// ========================EXPORT MODULES======================

module.exports = {
    supportedCountries, getChannels, getNetworks, getRate, fetchExchangeRate,
    getCrossBorderOptions, initiatePayment, initiateCollections, theYcWebhook,
    getCollectionLookup, YCPayment
}