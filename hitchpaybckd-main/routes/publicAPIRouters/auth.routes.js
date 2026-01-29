const express = require("express");
const router = express.Router();
const { generateToken } = require("../../controllers/publicAPIControllers/authcontroller.js");

// Accept application/json and x-www-form-urlencoded (OAuth2 clients)
router.post('/token', express.json(), generateToken);

module.exports = router;
