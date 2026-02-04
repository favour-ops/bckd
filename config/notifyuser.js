const db = require('../models')
const { json } = require('sequelize');
const { Op } = require("sequelize");
const http = require('https');
const Notify = db.notify;
const axios = require('axios');
const qs = require('qs');
// const bcrypt = require('bcryptjs');

const twilio = require('twilio');
const { getAdminInfo, getUserInfo } = require("./userdetails");
const { logger } = require('./logger');

const notifyMe = async (uid, header, usertype, content) => {
    let timed = new Date();
    await Notify.create({
        notetype: header, notecontent: content, usertype: usertype, uid, dated: timed, status: 1
    }).catch((err) => {
        console.log('Unable to process your request : ' + err);
        //res.status(400).json({ status: false, message: 'Unable to process your request' });
    });
}


const formatPhoneNo = async (number) => {
    const prefix = "234";
    // Remove the leading zero if it exists
    let numberStr = number.toString();
    if (numberStr.startsWith("0")) {
        numberStr = numberStr.slice(1);
    }

    // Concatenate the prefix with the number string
    let formattedNumber = prefix + numberStr;
    // console.log(formattedNumber)
    return formattedNumber;
}


const sendSMS = async (phone, msg) => {
    try {
        const intlphn = await formatPhoneNo(phone);

        let data = JSON.stringify({
            "api_key": process.env.SMSTOKEN,
            "to": intlphn,
            "from": "N-Alert",
            "sms": msg,
            "type": "plain",
            "channel": "dnd"
        });

        let config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: 'https://v3.api.termii.com/api/sms/send',
            headers: {
                'Content-Type': 'application/json'
            },
            data: data
        };

        axios.request(config)
            .then((response) => {
                console.log('SMS Sent')
                // console.log(JSON.stringify(response.data));
            })
            .catch((error) => {
                console.log(error);
            });

    } catch (error) {
        console.log('sms catch ERROR: ' + error);
    }
}

// const msg = `Dear Olajide, your Code is 3829. Valid for 15 minutes. Powered by HitchPay`
// sendSMS('07068363556', msg);

// const sendWhatsApp = async (recipient, code) => {
//     const intlphn = await formatPhoneNo(recipient);
//     const accountSid = process.env.TWILIO_ACCOUNT_SID;
//     const authToken = process.env.TWILIO_AUTH_TOKEN;
//     const client = require('twilio')(accountSid, authToken, {logLevel: 'debug'});

//     const message = client.messages.create({
//             from: 'whatsapp:'+process.env.TWILIO_WHATSAPP_NUMBER,
//             contentSid: process.env.TWILIO_CONTENT_SID,
//             contentVariables: '{"1":"'+code+'"}',
//             to: `whatsapp:${intlphn}`
//         });

//         console.log(message)

//         let thedata = message;
//         console.log(thedata)
//         if(thedata.status == 'queued'){
//             return true;
//         }else{
//             return false;
//         }

// }

const sendWhatsApp = async (recipient, code) => {


    /*  
    try{
       var intlphn = await formatPhoneNo(recipient);
    const accountSid = 'AC5f10573c718e39e31f8a5670884db7a6';
    const authToken = '3fe79976cb51580f685220ccc38dacbd';
    const client = require('twilio')(accountSid, authToken, {logLevel: 'debug'});
    
    const message = client.messages.create({
            from: 'whatsapp:'+process.env.TWILIO_WHATSAPP_NUMBER,
            contentSid: 'HX7a24a18cf399cc12403bccbac0407a07',
            contentVariables: '{"1":"'+code+'"}',
            to: `whatsapp:${intlphn}`
        });
        // .then(message => console.log(message))

        let thedata = message;
        // console.log(thedata)
        if(thedata.status == 'queued'){
            // console.log('success')
            return true;
        }else{
            return true;
        }
    }catch(error){
        return false;
    } */

    return false

}

// console.log(process.env.TWILIO_WHATSAPP_NUMBER)

// (async () => {
//     await sendWhatsApp('07068363556', '298939')
// })()

const pushNotifyclode = async (userid, title, msg) => {
    try {
        const userinfo = await getUserInfo(userid);  // get user info                
        const devicetoken = userinfo.apptoken;

        if (devicetoken != '') {
            // Initialize the app with the service account key and the FCM server key
            const admin = require('firebase-admin');
            const serviceAccount = require('./serviceAccountKey.json');

            if (!admin.apps.length) {
                // Initialize the default Firebase app
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            }

            const messaging = admin.messaging();
            const registrationToken = devicetoken;

            const message = {
                notification: {
                    title: title,
                    body: msg,
                    // imageUrl: 'https://res.cloudinary.com/hitchpay/image/upload/v1738015110/hitchpaylogo_jfcosp.png',               
                },
                token: registrationToken
            };

            messaging.send(message)
                .then((response) => {
                    console.log('Successfully sent message:', response);
                })
                .catch((error) => {
                    console.error('Error sending message:', error);
                });

        }
    } catch (error) {
        console.log('fcm catch ERROR: ' + error);
    }
}


const pushNotify = async (userid, title, msg, usertype = 'personal') => {
    try {
        const admin = require('firebase-admin');
        const path = require('path');

        // Set Firebase credentials BEFORE initializing admin SDK
        if (process.env.APPENV === 'development') {
            process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(__dirname, "serviceAccountKey.json");
        }

        // Initialize Firebase Admin SDK only once
        if (!admin.apps.length) {
            if (process.env.APPENV === 'development') {
                admin.initializeApp({
                    credential: admin.credential.applicationDefault(),
                });
            } else {
                const serviceAccount = require('./serviceAccountKey.json');
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            }
        }

        const messaging = admin.messaging();

        const userinfo = await getUserInfo(userid); // Fetch user info              
        const devicetoken = userinfo?.apptoken; // Ensure token exists

        if (devicetoken) {
            const message = {
                notification: {
                    title,
                    body: msg,
                },
                token: devicetoken
            };

            const response = await messaging.send(message);
            console.log('Successfully sent message:', response);
            return response; // Useful if you want to handle response in caller function
        } else {
            console.log('No device token found for user:', userid);
        }
    } catch (error) {
        console.error('FCM send ERROR:', error);
    }
};

// pushNotify(1, 'welcome', 'testing')

const sendWhatsAppOTP = async (phone, otp) => {
    try {
        var intlphn = await formatPhoneNo(phone);

        /*         const payload = {
                    messaging_product: "whatsapp",
                    to: intlphn,
                    type: "template",
                    template: {
                        name: "hitchopt",
                        language: { code: "en_NG" },
                        components: [
                            {
                                type: "body",
                                parameters: [
                                    { type: "text", text: "892819" },
                                    { type: "text", text: "10" }
                                ]
                            }
                        ]
                    }
                }; */

        const payload = {
            messaging_product: "whatsapp",
            to: intlphn,
            type: "template",
            template: {
                name: "hitchopt",
                language: { code: "en" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            { type: "text", text: otp }  // {{1}}
                        ]
                    },
                    {
                        type: "button",
                        sub_type: "url",
                        index: 0
                    }
                ]
            }
        }



        const options = {
            method: 'POST',
            url: `https://graph.facebook.com/v24.0/998362553354777/messages`,
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer EAAM2leDxn8YBQuZCnhfYcsvfkH2WcOO1H9YPxllTtMKPmkqvorBuoCUAiaSei8CDA3zyRj5YC8aUqglJJBAoXq3LXlWsNkKFGOBn894hpaLqcINoNsJzCApYDxQUYILWxM3KfZBeVQDXeYvV1zPTFqJ5dtK4dAqFAGZC04uvSFqXL9nCz9riQ67m4lg5CrnWCG8okyZALEmn6xEpbUBAGPDwsj5zXYvR7VPPgTU0oolDpF1BUkAnuyZCfjL7N3yGT2OGz2rZBXZAuEUWcw82QZDZD`
            },
            data: payload
        };


        // Make API request
        const response = await axios.request(options);
        const responseData = response.data;
        const jsonString = JSON.stringify(responseData);
        // console.log(jsonString);


        //   await axios.post(url, payload, {
        //     headers: {
        //       Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        //       "Content-Type": "application/json"
        //     }
        //   });

    } catch (error) {
        if (error.response?.status === 401) {
            // Token revoked or invalid
            console.log('WhatsApp token is invalid or revoked');

        } else {
            // Handle other errors
            logger.error('sendWhatsAppOTP: Error sending WhatsApp OTP', error)
        }
    }
};


const generateOTP = async () => {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    //   const hash = await bcrypt.hash(otp, 10);

    console.log('OTP:', otp);
    sendWhatsAppOTP('07068363556', otp);
    //   console.log('Hash:', hash);


    //   otpStore.set(phone, {
    //     hash,
    //     expiresAt: Date.now() + 5 * 60 * 1000 // 5 mins
    //   });

    return otp;
};




const sendWhatsAppOTP2 = async(phone, otp) =>{
  const url = `https://graph.facebook.com/v24.0/${process.env.PHONE_NUMBER_ID}/messages`;

  const payload = {
    messaging_product: "whatsapp",
    to: phone,
    type: "template",
    template: {
      name: "hitchopt",           // Exact template name
      language: { code: "en" }, // Must match WABA template language exactly
      components: [
        {
          type: "body",
          parameters: [
            {
              type: "text",
              text: otp        // {{1}} in template
            }
          ]
        },
        {
          type: "button",
          sub_type: "url",
          index: 0,
          parameters: [
            { "type": "text", "text": "123456" }
          ]
        }
      ]
    }
  };

  try {
    const response = await axios.post(url, payload, {
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      }
    });
    console.log("WhatsApp OTP sent successfully:", response.data);
    return response.data;
  } catch (error) {
    console.error("Error sending WhatsApp OTP:", error.response?.data || error.message);
    throw error;
  }
}

// Example usage:


async function getWhatsAppMessageStatus(messageId) {
  try {
    const url = `https://graph.facebook.com/v24.0/${messageId}`;
    const response = await axios.get(url, {
      headers: {
        "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json"
      },
      params: {
        fields: "messages{status}" // get the status field
      }
    });

    const status = response.data?.messages?.[0]?.status;
    if (!status) {
      console.warn("Status not yet available. WhatsApp may still be processing the message.");
      return "unknown";
    }

    console.log(`Message ${messageId} status: ${status}`);
    return status; // accepted, sent, delivered, read
  } catch (error) {
    console.error("Error fetching WhatsApp message status:", error.response?.data || error.message);
    throw error;
  }
}

// Example usage:
/* (async () => {
  const messageId = "wamid.HBgNMjM0NzA2ODM2MzU1NhUCABEYEjk3NUUzQTJDMjE1MEZCMjA0RgA=";
  const status = await getWhatsAppMessageStatus(messageId);
  console.log("Current message status:", status);
})();
 */


/* sendWhatsAppOTP2("2347068363556", "123456")
    .then(result => {
        console.log("API result:", result);
    })
    .catch(err => console.error("Script execution failed:", err))
    .finally(async () => {

    }); */


module.exports = { notifyMe, sendSMS, sendWhatsApp, pushNotify };