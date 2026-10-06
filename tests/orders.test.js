'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { orderRequestKey, placeOrder } = require('../lib/orders.js');
const { escapeHtml } = require('../lib/security.js');
const root = path.join(__dirname, '..');

test('request key uses client UUID or Telegram delivery identity, never a new random value on retry', () => {
    const id = 'ce03d897-2502-44e8-a86e-7712a2130eb7';
    assert.equal(orderRequestKey({ requestId: id }, {}), 'client:' + id);
    assert.equal(orderRequestKey({}, { update: { update_id: 42 } }), 'telegram:42');
    assert.equal(orderRequestKey({}, { message: { message_id: 9 }, chat: { id: 5 } }), 'message:5:9');
    assert.throws(() => orderRequestKey({ requestId: 'bad' }, {}));
    assert.throws(() => orderRequestKey({}, {}));
});

test('order creation is one RPC and uses verified Telegram identity rather than client identity', async () => {
    const calls = [];
    const db = { rpc: async (name, args) => { calls.push({ name, args }); return { data: { order: { id: 'AR-test' } }, error: null }; } };
    await placeOrder(db, { telegramUserId: '999', items: [{ id: 1, count: 2 }], phone: '010', address: 'Test' },
        { from: { id: 123, first_name: 'User' }, update: { update_id: 42 } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'aroma_place_order_v2');
    assert.equal(calls[0].args.p_customer_id, '123');
    assert.equal(calls[0].args.p_request_key, 'telegram:42');
});

test('database business errors are shown without leaking internal database errors', async () => {
    const ctx = { from: { id: 1 }, update: { update_id: 1 } };
    await assert.rejects(placeOrder({ rpc: async () => ({ error: { code: 'P0001', message: 'Qoldiq yetmaydi' } }) }, {}, ctx), /Qoldiq yetmaydi/);
    await assert.rejects(placeOrder({ rpc: async () => ({ error: { code: '42P01', message: 'internal table details' } }) }, {}, ctx), error => !error.message.includes('internal table'));
});

function handlerFixture() {
    const source = fs.readFileSync(path.join(root, 'lib/server.js'), 'utf8');
    const marker = "bot.on('web_app_data', async (ctx) => {";
    const body = source.slice(source.indexOf(marker) + marker.length, source.indexOf("const http = require('http');")).trim().replace(/\}\);$/, '');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const shared = source.slice(source.indexOf('async function processOrder('), source.indexOf("// Web App'dan buyurtma"));
    return new AsyncFunction('ctx', 'supabase', 'bot', 'updatePromotionExcel', 'ADMIN_TELEGRAM_ID', 'console', 'placeOrder', 'escapeHtml', shared + '\n' + body);
}
const saved = { order: { id: 'AR-confirmed', order_date: '2026-10-07', items: [{ id: 1, name: 'Actual product', price: 90000, count: 1 }], total: 90000,
    original_total: 100000, product_discount_amount: 10000, coupon_discount_amount: 0, participant_number: 1000, promotion_id: 1, phone: '010', address: 'Test' }, new_participant: true };

test('Excel failure after commit does not reject the order; notifications use database prices', async () => {
    const texts = [], replies = [];
    const ctx = { webAppData: { data: JSON.stringify({ items: [{ name: 'Spoofed product', price: 1 }] }) }, from: { id: 123, first_name: 'User' },
        reply: async text => replies.push(text), replyWithHTML: async text => texts.push(text) };
    await handlerFixture()(ctx, {}, { telegram: { sendMessage: async (_, text) => texts.push(text) } }, async () => { throw Error('Storage unavailable'); },
        'admin', { log() {}, error() {} }, async () => saved, escapeHtml);
    assert.equal(replies.length, 0);
    assert.ok(texts.some(text => text.includes('AR-confirmed') && text.includes('Actual product')));
    assert.ok(texts.every(text => !text.includes('Spoofed product')));
});

test('a duplicate order does not export Excel or send a second new-order notification', async () => {
    let exports = 0, notifications = 0;
    const replies = [];
    const ctx = { webAppData: { data: '{}' }, from: { id: 123 }, reply: async text => replies.push(text) };
    await handlerFixture()(ctx, {}, { telegram: { sendMessage: async () => notifications++ } }, async () => exports++, 'admin',
        { log() {}, error() {} }, async () => ({ ...saved, duplicate: true }), escapeHtml);
    assert.equal(exports, 0); assert.equal(notifications, 0);
    assert.match(replies[0], /avval qabul qilingan/);
});

test('a stale Excel export cannot replace the newest promotion file', async () => {
    const vm = require('node:vm');
    const source = fs.readFileSync(path.join(root, 'lib/server.js'), 'utf8');
    const start = source.indexOf('async function updatePromotionExcel');
    const code = source.slice(start, source.indexOf('const ADMIN_PASSWORD', start));
    const game = { id: 1, created_at: '2026-10-07', excel_revision: 1, excel_path: 'shared-legacy.xlsx' };
    const removed = [], uploaded = [];
    const db = {
        from(table) {
            let changes, revision;
            const query = { select() { return query; }, eq(key, value) { if (key === 'excel_revision') revision = value; return query; },
                maybeSingle() { return query; }, order() { return query; }, range() { return query; }, update(value) { changes = value; return query; },
                then(resolve, reject) {
                    let data;
                    if (changes) { data = revision === game.excel_revision ? [{ id: 1 }] : []; if (data.length) Object.assign(game, changes); }
                    else data = table === 'promotion_settings' ? { ...game } : [{ participant_number: 1000 }];
                    return Promise.resolve({ data, error: null }).then(resolve, reject);
                } };
            return query;
        },
        storage: { from() { return {
            async upload(file) {
                uploaded.push(file);
                game.excel_revision = 2;
                game.excel_path = 'Aksiyalar/2026-10-07/aksiya-2026-10-07-1-v2.xlsx';
                return { error: null };
            },
            async remove(files) { removed.push(...files); return { error: null }; }
        }; } }
    };
    const context = { supabase: db, Date, Buffer, XLSX: { utils: { book_new: () => ({}), aoa_to_sheet: rows => rows, book_append_sheet() {} }, write: () => Buffer.from('export') } };
    vm.createContext(context); vm.runInContext(code, context);
    await context.updatePromotionExcel(1);
    assert.match(uploaded[0], /-v1\.xlsx$/);
    assert.match(game.excel_path, /-v2\.xlsx$/);
    assert.equal(removed.length, 0);
});
