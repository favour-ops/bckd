const dojhnotify = require('./dojhnotify');
const htchpynotify = require('./htchpynotify');
const mplrdnotify = require('./mplrdnotify');
const prvdsnotify = require('./prvdsnotify');
const psb9notify = require('./psb9notify');
const shnotify = require('./shnotify');
const cybdnotify = require('./cybdnotify');
const sqdnotify = require('./sqdnotify');
const stripehook = require('./stripehook');



module.exports = {
    ...dojhnotify,
    ...htchpynotify,
    ...mplrdnotify,
    ...prvdsnotify,
    ...psb9notify,
    ...shnotify,
    ...cybdnotify,
    ...sqdnotify,
    ...stripehook
};
