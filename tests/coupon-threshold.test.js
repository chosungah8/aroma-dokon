'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function chooseCouponForAmount');
const end = html.indexOf('async function loadAvailableCoupons', start);
const couponContext = {};
vm.runInNewContext(`${html.slice(start, end)}; this.chooseCouponForAmount = chooseCouponForAmount;`, couponContext);
const chooseCouponForAmount = couponContext.chooseCouponForAmount;

const coupons = [
    { code: 'SAVE10', minOrderAmount: 300000, discountPercent: 10 },
    { code: 'SAVE5', minOrderAmount: 100000, discountPercent: 5 }
];

test('coupon threshold excludes 299999 and applies SAVE10 at exactly 300000', () => {
    assert.equal(chooseCouponForAmount([coupons[0]], 299999), null);
    assert.equal(chooseCouponForAmount(coupons, 300000)?.code, 'SAVE10');
    assert.equal(Math.round(300000 * 10 / 100), 30000);
});

test('downloaded eligible coupon is preferred over a larger unrelated coupon', () => {
    assert.equal(chooseCouponForAmount([
        { code: 'SAVE20', minOrderAmount: 200000, discountPercent: 20 },
        { code: 'SAVE10', minOrderAmount: 100000, discountPercent: 10 }
    ], 250000, 'SAVE10').code, 'SAVE10');
});
