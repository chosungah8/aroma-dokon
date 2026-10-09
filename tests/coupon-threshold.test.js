'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('function chooseCouponForAmount(');
const end = html.indexOf('let availableCouponsCache =', start);
assert.ok(start >= 0 && end > start, 'Kupon tanlash funksiyasi topilmadi');
const context = {verifiedSavedCouponCodes: new Set()};
vm.createContext(context);
vm.runInContext(html.slice(start, end), context);
const choose = context.chooseCouponForAmount;
const coupons = [
  {code:'SAVE10', minOrderAmount:300000, discountPercent:10},
  {code:'SAVE5', minOrderAmount:100000, discountPercent:5}
];

test('minimal summa 299999 da kupon ishlamaydi, 300000 da ishlaydi', () => {
  assert.equal(choose([coupons[0]], 299999), null);
  assert.equal(choose(coupons, 300000)?.code, 'SAVE10');
  assert.equal(Math.round(300000 * 10/100), 30000);
});
test('server tasdiqlagan saqlangan kupon yuqori foizlidan oldin tanlanadi', () => {
  const offers = [
    {code:'SAVE20', minOrderAmount:200000, discountPercent:20},
    {code:'SAVE10', minOrderAmount:100000, discountPercent:10}
  ];
  assert.equal(choose(offers, 250000, 'SAVE10', new Set(['SAVE10']))?.code, 'SAVE10');
});
test('server tasdiqlamagan localStorage kodi ustuvorlik bermaydi', () => {
  const offers = [
    {code:'SAVE20', minOrderAmount:200000, discountPercent:20},
    {code:'SAVE10', minOrderAmount:100000, discountPercent:10}
  ];
  assert.equal(choose(offers, 250000, 'SAVE10', new Set())?.code, 'SAVE20');
});
test('bo‘sh savatga, noto‘g‘ri va mos kelmaydigan kuponlarga chegirma yo‘q', () => {
  assert.equal(choose(coupons, 0), null);
  assert.equal(choose([{code:'BAD',discountPercent:150,minOrderAmount:0}], 200000), null);
  assert.equal(choose([{code:'FUTURE',discountPercent:10,minOrderAmount:300000}], 250000), null);
});
