'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');

test('shop coupon button is positioned and has a working download handler', () => {
    assert.match(html, /🎟️ Kuponni yuklab olish/);
    assert.match(html, /position:relative;\s*display:block;\s*width:calc\(100% - 20px\)/);
    assert.match(html, /margin:10px auto !important;/);
    assert.match(html, /async function downloadCoupon\(code\)/);
    assert.match(html, /fetch\("\/api\/coupons\/save"/);
    assert.match(html, /"X-Telegram-Init-Data": tg\.initData/);
});

test('shop reports missing Telegram authentication instead of silently failing', () => {
    const start = html.indexOf('async function downloadCoupon(code)');
    const end = html.indexOf('// MIJOZ UCHUN AKSIYALARNI YUKLASH', start);
    const handler = html.slice(start, end);
    assert.match(handler, /if \(!tg\?\.initData\)/);
    assert.match(handler, /Telegram ichidan oching/);
});

test('downloaded coupon is persisted per Telegram user, highlighted in the cart and stays above orders overlay', () => {
    assert.match(html, /aroma_downloaded_coupon:/);
    assert.match(html, /downloadedCouponCode = normalizedCode/);
    assert.match(html, /const isSaved = savedCode && savedCode === coupon\.code/);
    assert.match(html, /top:16px;\s*bottom:auto;\s*z-index:1000000/);
    assert.match(html, /Saqlangan kupon/);
    assert.match(html, /!coupons\.length && savedCode/);
    assert.match(html, /Number\(b\.code === savedCode\) - Number\(a\.code === savedCode\)/);
});
