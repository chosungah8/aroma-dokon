'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { orderReceipt, placeOrder } = require('../lib/orders.js');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('const pendingCheckoutKey'), html.indexOf('async function sendOrder()'));
const id = 'ce03d897-2502-44e8-a86e-7712a2130eb7';
const attempt = { id, payload: { requestId: id, items: [{ id: 1, count: 2 }] }, cart: { 1: 2 } };
function fixture(state = 'pending', pending = true) {
    const store = new Map([['cart', JSON.stringify({ 1: 2 })]]);
    if (pending) store.set('cart:pending', JSON.stringify(attempt));
    const alerts = [], sent = [], nodes = {};
    const ctx = { cartStorageKey: 'cart', cart: { 1: 2 }, appliedCoupon: null, couponDiscountAmount: 0,
        localStorage: { getItem: key => store.get(key) || null, setItem: (key, val) => store.set(key, val), removeItem: key => store.delete(key) },
        document: { visibilityState: 'hidden', getElementById: id => nodes[id] ||= {} },
        alert: msg => alerts.push(msg), setTimeout: () => 1, clearTimeout() {}, AbortController, TextEncoder,
        updateCartBar() {}, renderCartItems() {}, renderProducts() {},
        restoreSavedCart: () => JSON.parse(store.get('cart') || '{}'),
        fetch: async () => ({ ok: true, json: async () => ({ state, orderId: 'AR-1002', message: 'Qoldiq yetmaydi' }) }),
        tg: { platform: 'tdesktop' },
    };
    ctx.Telegram = { WebApp: { sendData: payload => { assert.ok(store.has('cart:pending')); sent.push(payload); } } };
    ctx.window = { Telegram: ctx.Telegram };
    vm.createContext(ctx); vm.runInContext(source, ctx);
    return { ctx, store, alerts, sent };
}
test('send saves the receipt before Telegram closes the app and keeps the cart', () => {
    const f = fixture('pending', false);
    f.ctx.transmitCheckout(attempt);
    assert.equal(f.sent.length, 1);
    assert.equal(f.store.get('cart'), JSON.stringify(attempt.cart));
    assert.equal(JSON.parse(f.store.get('cart:pending')).id, id);
});
test('reopening clears cart only after an accepted database receipt', async () => {
    const f = fixture('accepted');
    assert.equal(await f.ctx.checkCheckoutReceipt(), 'accepted');
    assert.equal(f.store.has('cart'), false);
    assert.equal(f.store.has('cart:pending'), false);
    assert.match(f.alerts[0], /AR-1002/);
});
test('pending, rejection, network error and invalid replies never clear cart', async () => {
    for (const state of ['pending', 'rejected', 'unknown', 'offline']) {
        const f = fixture(state);
        if (state === 'offline') f.ctx.fetch = async () => { throw Error('offline'); };
        await f.ctx.checkCheckoutReceipt();
        assert.equal(f.store.get('cart'), JSON.stringify(attempt.cart), state);
        assert.equal(f.store.has('cart:pending'), state !== 'rejected', state);
    }
});
test('accepted receipt preserves cart changed in another window', async () => {
    const f = fixture('accepted');
    f.store.set('cart', JSON.stringify({ 1: 3, 2: 1 }));
    await f.ctx.checkCheckoutReceipt();
    assert.equal(f.store.get('cart'), JSON.stringify({ 1: 3, 2: 1 }));
});
test('storage failure prevents sending and a retry keeps the original request ID', () => {
    const f = fixture();
    f.ctx.transmitCheckout(attempt); f.ctx.transmitCheckout(attempt);
    assert.equal(f.sent[0], f.sent[1]);
    f.ctx.localStorage.setItem = () => { throw Error('full'); };
    f.ctx.transmitCheckout(attempt);
    assert.equal(f.sent.length, 2);
});
test('pending checkout guards cart mutations and ordinary browser sends are blocked', () => {
    const f = fixture();
    assert.equal(f.ctx.checkoutCartLocked(), true);
    f.ctx.tg.platform = 'unknown';
    f.ctx.transmitCheckout(attempt);
    assert.equal(f.sent.length, 0);
});
function dbFixture(order, rejected, error = null) {
    const calls = [];
    return { calls, from(table) { calls.push(table); return {
        select(fields) { calls.push(fields); return this; }, eq(field, value) { calls.push([field, value]); return this; },
        limit() { return this; }, async maybeSingle() { return { data: table === 'orders' ? order : rejected, error }; }
    }; } };
}
test('receipt requires random UUID and returns only receipt state, order ID or rejection', async () => {
    const db = dbFixture({ id: 'AR-1002' });
    assert.equal((await orderReceipt(db, 'AR-1002')).status, 400);
    assert.equal(db.calls.length, 0);
    assert.deepEqual((await orderReceipt(db, id)).body, { state: 'accepted', orderId: 'AR-1002' });
    assert.ok(!db.calls.includes('order_receipt_failures'));
    assert.deepEqual((await orderReceipt(dbFixture(null, null), id)).body, { state: 'pending' });
    assert.deepEqual((await orderReceipt(dbFixture(null, { reason: 'Sold out' }), id)).body, { state: 'rejected', message: 'Sold out' });
    await assert.rejects(orderReceipt(dbFixture(null, null, { code: 'db error' }), id));
});
test('durably rejected RPC outcome is sent as a customer error, not a successful order', async () => {
    await assert.rejects(placeOrder({ rpc: async () => ({ data: { rejected: true, message: 'Qoldiq yetmaydi' } }) }, {},
        { from: { id: 1 }, update: { update_id: 1 } }), err => err.customerMessage === 'Qoldiq yetmaydi');
});
