const db = require('../models')
const { json } = require('sequelize');
const { Op } = require("sequelize");
const http = require('https');
const Notify = db.notify;
const axios = require('axios');
const qs = require('qs');

const twilio = require('twilio');
const {getAdminInfo, getUserInfo} = require("./userdetails");

const notifyMe = async(uid, header, usertype, content)=>{
    let timed = new Date();
    await Notify.create({
        notetype: header, notecontent: content, usertype: usertype, uid, dated: timed, status: 1
    }).catch((err) => {
        console.log('Unable to process your request : ' + err);
        //res.status(400).json({ status: false, message: 'Unable to process your request' });
    });
}


const formatPhoneNo = async(number)=>{
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


const sendSMS = async(phone, msg) =>{  
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
        data : data
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
        console.log('sms catch ERROR: '+ error);
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

const pushNotifyclode = async(userid, title, msg)=>{
    try {
        const userinfo = await getUserInfo(userid);  // get user info                
        const devicetoken = userinfo.apptoken;                
    
        if(devicetoken != ''){
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
        console.log('fcm catch ERROR: '+ error);  
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

module.exports = {notifyMe, sendSMS, sendWhatsApp, pushNotify};