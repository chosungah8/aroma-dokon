'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const security = require('../lib/security.js');
const root = path.join(__dirname, '..');

function entry(environment = {}) {
    const events = [];
    const env = { BOT_TOKEN: 'test-bot-token', ADMIN_PASSWORD: 'test-password', WEB_APP_URL: 'https://shop.example.test', ...environment };
    const bot = {
        handleUpdate: async update => events.push({ type: 'update', update }),
        telegram: {
            setWebhook: async (url, options) => events.push({ type: 'setup', url, options }),
            getWebhookInfo: async () => ({ url: 'https://shop.example.test/api/telegram', pending_update_count: 0 })
        }
    };
    const context = { module: { exports: {} }, URL, Buffer, process: { env }, console: { error() {} },
        require: name => name === './lib/security.js' ? security : {
            bot, webServer: { emit: () => events.push({ type: 'delegate' }) }
        }
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'index.js'), 'utf8'), context);
    return { events, env, async request(url, method = 'POST', headers = {}, body = { update_id: 10 }) {
        const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
        await context.module.exports({ url, method, headers, body }, res);
        return res;
    } };
}
const adminHeader = { authorization: 'Bearer ' + security.createAdminToken('test-password', 'test-bot-token') };

test('webhook rejects absent, invalid or multiple secret headers before handling data', async () => {
    const app = entry();
    for (const value of [undefined, '', 'wrong', ['wrong']]) {
        const result = await app.request('/api/telegram', 'POST', { 'x-telegram-bot-api-secret-token': value });
        assert.equal(result.statusCode, 403);
    }
    assert.equal(app.events.length, 0);
});

test('webhook accepts signed JSON and query parameters; malformed updates are rejected', async () => {
    const app = entry();
    const header = { 'x-telegram-bot-api-secret-token': security.telegramWebhookSecret(app.env.BOT_TOKEN) };
    assert.equal((await app.request('/api/telegram?test=1', 'POST', header, '{"update_id":10}')).statusCode, 200);
    assert.equal(app.events.length, 1);
    assert.equal((await app.request('/api/telegram', 'POST', header, {})).statusCode, 400);
    assert.equal(app.events.length, 1);
});

test('missing configuration fails closed for webhook and admin access', async () => {
    const app = entry({ BOT_TOKEN: '', ADMIN_PASSWORD: '' });
    assert.equal((await app.request('/api/telegram')).statusCode, 503);
    assert.equal((await app.request('/api/admin/telegram-webhook', 'POST', adminHeader)).statusCode, 401);
    assert.equal(security.adminTokenIsValid(crypto.createHash('sha256').update('').digest('hex'), ''), false);
});

test('only authenticated POST configures the secret, without discarding pending updates or exposing it', async () => {
    const app = entry();
    assert.equal((await app.request('/api/admin/telegram-webhook')).statusCode, 401);
    assert.equal((await app.request('/api/setup-webhook', 'GET', adminHeader)).statusCode, 405);
    assert.equal(app.events.length, 0);
    const result = await app.request('/api/admin/telegram-webhook', 'POST', adminHeader);
    assert.equal(result.statusCode, 200);
    const event = app.events[0];
    assert.equal(event.url, 'https://shop.example.test/api/telegram');
    assert.equal(event.options.secret_token, security.telegramWebhookSecret(app.env.BOT_TOKEN));
    assert.equal(event.options.drop_pending_updates, undefined);
    assert.ok(!result.body.includes(event.options.secret_token));
});

test('setup rejects non-HTTPS target and protected info does not allow anonymous access', async () => {
    const app = entry({ WEB_APP_URL: 'http://shop.example.test' });
    assert.equal((await app.request('/api/admin/telegram-webhook', 'POST', adminHeader)).statusCode, 502);
    assert.equal((await app.request('/api/webhook-info', 'GET')).statusCode, 401);
    assert.equal(app.events.length, 0);
});

test('both catalog URL forms use the same server routes', async () => {
    const app = entry();
    for (const route of ['/api/products', '/api/products?ts=1', '/api/categories', '/api/categories?ts=1']) {
        await app.request(route, 'GET');
    }
    assert.equal(app.events.filter(event => event.type === 'delegate').length, 4);
});

test('image resolver rejects traversal, encoded traversal, backslashes and non-image files', () => {
    for (const candidate of ['/images/../lib/server.js', '/images/%2e%2e/.env', '/images/foo/../../secret.png', '/images/%2f../secret.png', '/images/..\\secret.png', '/images/file.html', '/images/%00.png', '/images/%']) {
        assert.equal(security.resolveImagePath('/project', candidate), null, candidate);
    }
    assert.equal(security.resolveImagePath('/project', '/images/sub/photo.png?ts=1'), '/project/images/sub/photo.png');
});

test('customer address renders as escaped text in the actual admin order template', () => {
    const source = fs.readFileSync(path.join(root, 'admin.html'), 'utf8');
    const start = source.indexOf('            item.innerHTML = `', source.indexOf('filteredOrders.forEach(order =>'));
    const stop = source.indexOf('`;', start);
    const item = {};
    const address = '<img src="x" onerror="void(0)">';
    new Function('item', 'order', 'itemsText', 'escapeHtml', source.slice(start, stop + 2))(
        item, { id: 'test', phone: '<b>phone</b>', address, customer: { name: '<svg onload="void(0)">' }, items: [], total: 1 }, 'test', security.escapeHtml
    );
    assert.ok(!item.innerHTML.includes('<img'));
    assert.ok(!item.innerHTML.includes('<svg'));
    assert.ok(item.innerHTML.includes('&lt;img'));
    assert.ok(!item.innerHTML.includes('onclick='));
});
