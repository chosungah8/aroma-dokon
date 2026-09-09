const { webServer } = require('./lib/server.js');

module.exports = function handler(req, res) {
    webServer.emit('request', req, res);
};
