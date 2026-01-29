const crypto = require("crypto");
const config = require("../../config/pubapi_config.js");
const { success, error } = require("../../utils/pubapi_response.js");

exports.handleWebhook = (req, res, next) => {
  try {
    const signature = req.headers["x-hitchpay-signature"];
    const payload = JSON.stringify(req.body);

    const computed = crypto
      .createHmac("sha256", config.webhookSecret)
      .update(payload)
      .digest("hex");

    if (computed !== signature)
      return error(res, "INVALID_SIGNATURE", "Invalid webhook signature", 401);

    console.log("Webhook received:", req.body);
    res.status(200).json({ status: "ok" });
  } catch (err) {
    next(err);
  }
};
