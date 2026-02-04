const db = require('../models')
const jwt = require("jsonwebtoken");
const bcrypt = require('bcryptjs');
const { json } = require('sequelize');
const { Op } = require("sequelize");
const fs = require('fs').promises;
const sgMail = require('@sendgrid/mail');
const { logger } = require('../config/logger');

// Set your API key
sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Function to send an email
const mailSender = async (username, subject, to, content, attachments = null) => {
    const currentYear = new Date().getFullYear();

    const template = `<!DOCTYPE html>
<html>
<head>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link
        href="https://fonts.googleapis.com/css2?family=Mulish:ital,wght@0,200..1000;1,200..1000&family=Ropa+Sans:ital@0;1&family=Source+Sans+3:ital,wght@0,200..900;1,200..900&display=swap"
        rel="stylesheet">
    <style>
        .container {
            max-width: 600px;
            margin: auto;
            background-color: #ffffff;
            border-radius: 0px;
            overflow: hidden;
            box-shadow: 0 2px 5px rgba(0, 0, 0, 0.1);
        }

        .header img {
            max-width: 150px;
        }

        .content img {
            max-width: 100%;
            height: auto;
        }

        .content h1 {
            font-style: normal;
            font-weight: 800;
            font-size: 28.5405px;
            line-height: 36px;
            color: #000000;
        }
        .content p {
            font-style: normal;
            font-weight: 400;
            font-size: 18px;
            line-height: 23px;
            color: #000000;
        }

        .footer .logo img {
            height: 80px;
        }

        .socials img {
            margin-right: 10px;
        }

        .footer a {
            color: #6A2AB5;
            text-decoration: none;
        }

        @media (max-width: 420px) {
            .container {
                max-width: 100% !important;
            }
        }
        
    </style>
</head>

<body style="font-family: 'Mulish', Arial, sans-serif;margin: 0;padding: 0; background-color: #f4f4f9;">
    <div class="container">
        <!-- <div class="toptext" style="padding: 5px 10px;">
                <h2 style=" font-style: normal;font-weight: 800; font-size: 25.5405px; line-height: 20px; color: #000000;">${subject}</h2>
            </div> -->
        <div class="header" style="background-color: #6A2AB5; height: 91px;">
            <img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/hitchlogo_white_lsfgnx.png"
                alt="Hitchpay Logo">
        </div>
        <div class="content" style="text-align: left;">
            <div style="text-align: left; background: #fff;">
                <h3 style="font-weight: 500; font-size: 27px; text-align: center; color: #6A2AB5; padding-top: 35px; margin-top: 0px;">${subject}</h3>
                <div style=" padding: 10px 20px; font-weight: 400; font-size: 20px; color: #101010; text-align: left;">
                    ${content}
                </div>
            </div>
           <div>
           <img src="https://res.cloudinary.com/hitchpay/image/upload/v1761322975/hitchpayemail_pvwv7p.png">
           </div>
        </div>

        <div class="footer" style=" background-color: #fff; padding: 20px; font-size: 14px; color: #888888; text-align: left;">
            <div class="logo">
                <img src="https://res.cloudinary.com/hitchpay/image/upload/v1761417932/hitchpay_logo_tkhi3c.png" style="height: 50px;" alt="Hitchpay Logo">
            </div>
            <div>
            <p class="socials" style="margin-left: 15px;">
               <a href="https://www.linkedin.com/company/hitchpay/"><img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/linkedin_tb03jy.png"
                    alt="hitchpay LinkedIn"></a>
                <a href="https://www.facebook.com/profile.php?id=61562864042925">
                    <img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/facebook_ecllmu.png"
                    alt="hitchpay Facebook">
                </a>
                <a href="https://x.com/hitchpay_">
                    <img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011127/twitte_u01ub9.png"
                    alt="hitchpay X">
                </a>
                <a href="https://www.instagram.com/hitchpay">
                    <img src="https://res.cloudinary.com/hitchpay/image/upload/v1738011128/instagram_in0pzj.png"
                    alt="hitchpay Instagram">
                </a>
            </p>
            <p style="font-style: normal; font-weight: 400; font-size: 14px; line-height: 18px; color: #000000;margin-left: 15px;">
                © ${currentYear} HitchAfrica Technologies LTD (RC Number - 7022647)<br>
                All rights reserved.<br>
                If you have any questions or inquiries, please reach us via our email or social media platforms.
            </p>
            </div>
        </div>
    </div>
</body>

</html>`;

    const msg = {
        to,
        from: {
            email: 'support@hitchpay.ng',
            name: 'HitchPay',
        },
        subject,
        html: template,
    };

    if (attachments) {
        msg.attachments = attachments;
    }

    try {
        const response = await sgMail.send(msg);
        logger.info(`Email sent successfully to ${to}`, { response: response[0].statusCode });
        return true;
    } catch (error) {
        // Log the detailed error from SendGrid
        const errorMessage = error.response ? error.response.body.errors : error.message;
        logger.error(`SendGrid failed to send email to ${to}`, { error: errorMessage });

        // Re-throw the error so the calling function knows something went wrong
        throw error;
    }
};

const callmail = async () => {
    await mailSender('Olajidde', 'Welcome to HitchPay', 'olajideolatunji@hitchpay.ng', 'Welcome to HitchPay. This is the email footer');
}

// callmail()


 
    //  @media only screen and (max-width: 600px) {
    //         table[role="presentation"] td[width="55%"],
    //         table[role="presentation"] td[width="45%"] {
    //         display: block !important;
    //         width: 100% !important;
    //         text-align: center !important;
    //         }
    //         table[role="presentation"] img[alt="Hitchpay Globe"] {
    //         margin-top: 20px !important;
    //         width: 200px !important;
    //         opacity: 0.4 !important;
    //         }
    //     }
// <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background: linear-gradient(135deg,#6a11cb 0%,#6A2AB5 100%); font-family:'Mulish',Arial,sans-serif;">
//   <tr>
//     <td align="center" style="">
//       <table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px; background:linear-gradient(135deg,#6a11cb 0%,#6A2AB5 100%); border-radius:10px; overflow:hidden;">
//         <tr>
          
//           <td width="55%" valign="middle" style="padding:15px 18px; color:#ffffff;">
//             <div style="display:inline-block; background:rgba(255,255,255,0.15); border-radius:20px; padding:5px 12px; font-size:10px; margin-bottom:7px;">
//               ✅ Safe and Secure · Rated <strong>4.5⭐</strong>
//             </div>

//              <h2 style="font-weight: 800; font-size: 26px; line-height: 38px; margin: 0 0 10px 0;">
//             Instant Payment,<br>
//             Anywhere, Anytime
//             </h2>

//             <p style="font-size: 16px; line-height: 26px; margin: 10px 0 25px 0; color: #ffffff;">
//             Download the Hitchpay app on Google Play and App Store.
//             </p>

//             <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin-top:10px;">
//               <tr>
//                 <td>
//                   <a href="https://play.google.com/store/apps/details?id=com.app.hitchpay&hl=en" target="_blank">
//                     <img src="https://res.cloudinary.com/hitchpay/image/upload/v1761317409/Android_xvv8pb.png" alt="Get on Android"  style="border:0; display:block; height: 40px">
//                   </a>
//                 </td>
//                 <td width="10"></td>
//                 <td>
//                   <a href="https://apps.apple.com/us/app/hitchpay/id6739216953" target="_blank">
//                     <img src="https://res.cloudinary.com/hitchpay/image/upload/v1761317409/Apple_ysoukh.png" alt="Get on iPhone" style="border:0; display:block;  height: 40px">
//                   </a>
//                 </td>
//               </tr>
//             </table>
//           </td>

          
//           <td width="45%" valign="middle" align="right" style="padding:0; text-align:right;">
//             <img src="https://res.cloudinary.com/hitchpay/image/upload/v1761318555/hitchpayemail2-removebg-preview_ygeb18.png" 
//                  alt="Hitchpay Globe" 
//                  width="260" 
//                  style="display:block; max-width:100%; height:auto;">
//           </td>
//         </tr>
//       </table>
//     </td>
//   </tr>
// </table>


module.exports = {
    mailSender
};