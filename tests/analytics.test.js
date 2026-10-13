'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { visitorKey, normalizeEvent, storeAnalyticsEvent } = require('../lib/analytics.js');

test('analytics hashes verified Telegram identities without saving IDs or other PII', () => {
    const key = visitorKey(1234567, 'private-secret');
    assert.match(key, /^[a-f0-9]{64}$/);
    assert.equal(key, visitorKey(1234567, 'private-secret'));
    assert.notEqual(key, visitorKey(1234568, 'private-secret'));
    assert.notEqual(key, visitorKey(1234567, 'another-secret'));
    for (const id of [null, 0, -1, 'nonsense', {}, 1.9]) assert.equal(visitorKey(id, 'secret'), null);
});
test('analytics event type and product IDs are strictly validated', () => {
    assert.deepEqual(normalizeEvent('visit'), {event_type:'visit',product_id:0});
    assert.deepEqual(normalizeEvent('order'), {event_type:'order',product_id:0});
    assert.deepEqual(normalizeEvent('product_view',123),{event_type:'product_view',product_id:123});
    for (const id of [null,undefined,0,-1,1.5,'123',{},2147483648]) assert.equal(normalizeEvent('cart_add',id),null);
    for (const event of ['delete', 'admin', '', 1234]) assert.equal(normalizeEvent(event),null);
    assert.equal(normalizeEvent('visit', 1), null);
});
test('analytics uses idempotent upsert keyed by visitor, event, local day, product', async () => {
    const calls = [];
    const supabase = { from(table) { assert.equal(table,'aroma_visitor_events');return {async upsert(data, options) {
        calls.push({data,options});return {error:null};
    }};}};
    assert.deepEqual(await storeAnalyticsEvent(supabase,4321,'secret','visit'),{ok:true});
    assert.equal(calls[0].data.event_type,'visit');
    assert.equal(calls[0].data.product_id,0);
    assert.equal(calls[0].options.onConflict,'visitor_key,event_type,event_day,product_id');
    assert.equal(calls[0].options.ignoreDuplicates,true);
    assert.ok(!JSON.stringify(calls[0].data).includes('4321'));
    assert.equal((await storeAnalyticsEvent(supabase,4321,'secret','cart_add','1')).invalid,true);
    assert.equal(calls.length,1);
});
test('server separates signed visitor events and protected admin analytics', () => {
    const source=fs.readFileSync(path.join(__dirname,'../lib/server.js'),'utf8');
    const event=source.slice(source.indexOf("if (url.pathname === '/api/analytics/event'"), source.indexOf('// Persistent Telegram coupon routes'));
    assert.match(event,/verifiedMiniAppUser\(req\.headers\['x-telegram-init-data'\], BOT_TOKEN\)/);
    assert.match(event,/readLimitedJson\(req, 1024\)/);
    assert.match(event,/storeAnalyticsEvent/);
    assert.doesNotMatch(event,/event\.type === 'order'/);
    const admin=source.slice(source.indexOf("if (url.pathname === '/api/admin/analytics'"), source.indexOf('const promotionAdminRoute'));
    assert.match(admin,/if \(!isAdmin\) return sendJson\(401/);
    assert.match(admin,/supabase\.rpc\('aroma_analytics_summary_v1'\)/);
    assert.match(admin,/Cache-Control/);
    const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
    assert.match(html,/trackStoreEvent\('visit'\)/);
    assert.match(html,/trackStoreEvent\('cart_add'/);
    assert.match(html,/trackStoreEvent\('product_view'/);
});
