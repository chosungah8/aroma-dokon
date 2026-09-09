const { bot, webServer } = require('./lib/server.js');

function readBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });

        req.on('error', reject);
    });
}

module.exports = async function handler(req, res) {
    if (req.url === '/api/telegram' && req.method === 'POST') {
        try {
            const update = req.body || await readBody(req);

            await bot.handleUpdate(update);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: true }));
        } catch (error) {
            console.error('Telegram webhook error:', error);

            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                ok: false,
                error: error.message
            }));
        }
    }

    return webServer.emit('request', req, res);
};
