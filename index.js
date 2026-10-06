const { bot, webServer } = require('./lib/server.js');
const { safeEqual, adminTokenIsValid, telegramWebhookSecret } = require('./lib/security.js');

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

    const pathname = new URL(req.url, 'http://localhost').pathname;
    const setupToken = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const isSetupAdmin = adminTokenIsValid(setupToken, process.env.ADMIN_PASSWORD);
    res.setHeader('Cache-Control', 'no-store');

    if (pathname === '/api/webhook-info' && req.method === 'GET') {
        if (!isSetupAdmin) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ ok: false, message: 'Ruxsat yo‘q' }));
        }
        try {
            const info = await bot.telegram.getWebhookInfo();
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: true, url: info.url,
                pending_update_count: info.pending_update_count,
                last_error_message: info.last_error_message || null }));
        } catch (error) {
            res.statusCode = 502;
            return res.end(JSON.stringify({ ok: false, message: 'Telegram holatini tekshirib bo‘lmadi' }));
        }
    }

    if ((pathname === '/api/admin/telegram-webhook' || pathname === '/api/setup-webhook') && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        if (!isSetupAdmin) {
            res.statusCode = 401;
            return res.end(JSON.stringify({ ok: false, message: 'Ruxsat yo‘q' }));
        }
        try {
            const secret = telegramWebhookSecret(process.env.BOT_TOKEN);
            if (!secret) throw new Error('BOT_TOKEN missing');
            const webhookUrl = new URL('/api/telegram', process.env.WEB_APP_URL);
            if (webhookUrl.protocol !== 'https:') throw new Error('HTTPS required');
            await bot.telegram.setWebhook(webhookUrl.toString(), { secret_token: secret });
            return res.end(JSON.stringify({ ok: true, message: 'Telegram himoyalangan ulanishi sozlandi.' }));
        } catch (error) {
            res.statusCode = 502;
            return res.end(JSON.stringify({ ok: false, message: 'Ulanish sozlanmadi. BOT_TOKEN va WEB_APP_URL sozlamalarini tekshiring.' }));
        }
    }
    if (pathname === '/api/setup-webhook' || pathname === '/api/admin/telegram-webhook') {
        res.statusCode = 405;
        res.setHeader('Allow', 'POST');
        return res.end(JSON.stringify({ ok: false, message: 'POST so‘rovi kerak' }));
    }

    if (pathname === '/api/telegram' && req.method === 'POST') {
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        const secret = telegramWebhookSecret(process.env.BOT_TOKEN);
        if (!secret) {
            res.statusCode = 503;
            return res.end(JSON.stringify({ ok: false }));
        }
        if (!safeEqual(req.headers['x-telegram-bot-api-secret-token'], secret)) {
            res.statusCode = 403;
            return res.end(JSON.stringify({ ok: false }));
        }
        try {
            const rawUpdate = req.body !== undefined ? req.body : await readBody(req);
            const update = typeof rawUpdate === 'string' || Buffer.isBuffer(rawUpdate)
                ? JSON.parse(rawUpdate.toString()) : rawUpdate;
            if (!update || !Number.isSafeInteger(update.update_id)) {
                res.statusCode = 400;
                return res.end(JSON.stringify({ ok: false }));
            }

            await bot.handleUpdate(update);

            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({ ok: true }));
        } catch (error) {
            console.error('Telegram webhook update failed');

            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            return res.end(JSON.stringify({
                ok: false,
                error: 'Telegram so‘rovini qayta ishlashda xatolik'
            }));
        }
    }

    return webServer.emit('request', req, res);
};
