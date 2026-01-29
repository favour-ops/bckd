const express = require("express");
const cors = require('cors');
const app = express();
const cron = require('node-cron');
const http = require('http');
const bodyParser = require("body-parser");
const helmet = require("helmet");
const { client: redisClient, connectRedis } = require('./config/redisClient'); // Adjust path
require('newrelic')
require('express-async-errors'); // Must be required before routes
require('dotenv').config()
require("./auth/passport.js");
const fs = require('fs');
const errorHandler = require('./config/errorHandler');
const EncryptResponseMiddleware = require("./auth/encryptRespMiddleware.js")

/* PUBLIC API */
const oauthRoutes = require("./routes/publicAPIRouters/auth.routes.js");
const paymentRoutes = require("./routes/publicAPIRouters/payment.routes.js");
const webhookRoutes = require("./routes/publicAPIRouters/webhook.routes.js");
const walletRoutes = require("./routes/publicAPIRouters/wallets.route.js");
const {pubAPiErrorHandler} = require("./auth/pubApiErrorHandler.js");

// /const pubapi_config = require("./config/pubapi_config.js");

const allowedOrigins = [
  'https://app.hitchpay.ng', // production frontend URL
  'https://hitchpay-webadmx-49d6a8fbfbbe.herokuapp.com',
  'http://localhost:3000',  // Ylocal development frontend URL
  'http://localhost:5000',  // Ylocal development frontend URL
];

// await connectRedis();
const corsOptions = { origin: '*' }

const corsOptions222 = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman, server-to-server)
    if (!origin) {
      // console.log('CORS: Allowing request with no origin (Mobile App / Server?)');
      return callback(null, true);
    }
    // Allow requests from listed web origins
    if (allowedOrigins.indexOf(origin) !== -1) {
      // console.log(`CORS: Allowing origin: ${origin}`);
      return callback(null, true);
    } else {
      // Disallow other origins
      // console.warn(`CORS: Blocking origin: ${origin}`);
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
  },
  methods: 'GET,POST', // Specify allowed methods
  allowedHeaders: 'Origin, X-Requested-With, Content-Type, Accept, Authorization',
}

app.use((req, res, next) => {
  const userAgent = req.headers['user-agent'];
  if (userAgent && userAgent.toLowerCase().includes('curl')) {
    console.log('Blocking curl request');
    return res.status(403).send('Access forbidden for curl');
  }
  next();
});


//middleware
app.use(helmet({
  frameguard: {
    action: "deny", // Explicitly set X-Frame-Options to DENY
  },
  contentSecurityPolicy: false,
}));
app.use(cors(corsOptions))
app.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf.toString();
  }
}))
app.use(express.urlencoded({ extended: true }))
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));


connectRedis().then(() => {
  console.log('✅ Redis connected');
  //router
  const userRouter = require("./routes/userRouters.js");
  const adminRouter = require("./routes/admRouters.js");
  const whatsAppRouter = require("./routes/whatsAppRouter.js");
  const externalRouters = require("./routes/externalRouters.js");
  const userRoutersDebugger = require("./routes/userRoutersDebugger.js");
  const checkoutRouter = require("./routes/checkoutRouter.js");
  const businessRouter = require("./routes/businessRouter.js");
  const rafflesRouter = require("./routes/rafflesRoutes.js");
  const authRouter = require("./routes/authRouter.js");
  const { retryFailedWebhooks } = require("./controllers/checkoutControllers/webhookRetryJob.js");
  const { runInactiveUserNotifier, NotifyInactiveUsers} = require('./controllers/inactiveUserNotifier');
  const { logger } = require('./config/logger');


  const statementController = require("./controllers/statementController.js");


  app.use("/d4vabx3", userRouter) //port
  app.use("/vfyhabxtst", userRoutersDebugger) //port
  app.use("/dx4emsd2d32", adminRouter) //port
  app.use("/hpaywhatsapp", whatsAppRouter) //port
  app.use("/paywpphk", externalRouters) //port
  app.use("/checkout", checkoutRouter) //port
  app.use("/d4vabx3/business", businessRouter) //port
  app.use("/weouwert/raffles", rafflesRouter) //port
  app.use("/auth", authRouter); // Public auth routes

  /* PUBLIC API */
  app.use("/v1/oauth", oauthRoutes);
  app.use("/v1/payments", paymentRoutes);
  app.use("/v1/webhook", webhookRoutes);
  app.use("/v1/wallet", walletRoutes);

  // Health Check Route
  app.use("/health", (req, res) => {

    res.status(200).json({ status: "UP", message: "Service is running" });
  });

  // Schedule the webhook retry job to run every 5 minutes.
  // cron.schedule('*/5 * * * *', () => {
  //   console.log('Running scheduled job: retryFailedWebhooks');
  //   retryFailedWebhooks();
  // }, { timezone: "Africa/Lagos" });

  // Schedule the webhook retry job to run every 2 minutes.
  // cron.schedule('*/3 * * * *', () => {
  //   console.log('Running scheduled job: runInactive User Notifier');
  //   NotifyInactiveUsers();
  // }, { timezone: "Africa/Lagos" });

  // // Schedule to run once every day at 2 AM.
  // cron.schedule('0 2 * * *', () => {
  //   logger.info('[Cron] Running daily inactive user notification job.');
  //   runInactiveUserNotifier();
  // }, {
  //     scheduled: true,
  //     timezone: "Africa/Lagos" // IMPORTANT: Set this to your server's or business's timezone
  // });

  app.use("/", (req, res) => {
    res.status(404)
    res.send('Oops! It seems you are lost. Wetin lost from your hand?')
  }) //port

  // Global error handler should be the last middleware
  app.use(errorHandler);
  // app.use(pubAPiErrorHandler);

  /* Kindly note that you SHOULD NOT
  reverse funds when you receive these
  responseCodes CORALPAY:
  
  00 - Successful, 68 - Awaiting Service
  Provider, 09- pending, 06 - failed, 25 -
  Not found (response to error validating
  Customer) 96 - System malfunction
  
  These are the response codes to look
  out for. Kindly Note that you shouldn't
  treat 68 - Awaiting Service Provider
  and 09- pending as Failed transactions
  but transactions that should be
  requeried at intervals. */
  // const PORT = process.env.PORT || 5000;
  const PORT = process.env.PORT || 5000;


  app.listen(PORT, () => {
    console.log(`App running on Port ${PORT}`);
  });
}).catch(err => {
  console.error("Failed to initialize application due to Redis connection error:", err);
  process.exit(1); // Ensure exit if connection fails
});