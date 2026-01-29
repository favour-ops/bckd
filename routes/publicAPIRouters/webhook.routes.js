const express = require("express");
const router = express.Router();
const { handleWebhook } = require("../../controllers/publicAPIControllers/webhookcontroller.js");

router.post("/", express.json({ type: "application/json" }), handleWebhook);
module.exports = router;
