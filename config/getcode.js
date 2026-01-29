const db = require('../models')
const { json } = require('sequelize');
const { Op } = require("sequelize");
const randomstring = require("randomstring");

function genCode(str, type) {
    //alphanumeric
    return randomstring.generate({
        length: str,
        charset: type,
        capitalization: 'lowercase'
    }).toLocaleUpperCase();
}

module.exports = {
    genCode
};