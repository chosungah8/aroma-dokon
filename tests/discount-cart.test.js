'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function part(start, end) {
    const i = html.indexOf(start);
    const j = html.indexOf(end, i);
    assert.ok(i !== -1 && j !== -1, `missing ${start}`);
    return html.slice(i, j);
}
function ctx(products, cart, coupon = null) {
    const context = {products, cart, appliedCoupon: coupon, Math, Number};
    vm.createContext(context);
    vm.runInContext(part('function getVariantPrice(', 'function selectVariant(') + '\n' +
        part('function getDiscountedProductPrice(', '// Catalog requests can fail'), context);
    return context;
}
const products = [
    {id: 1, price: 100000, discountActive:true, discountPercent:20, variants:[]},
    {id: 2, price: 110000, discountActive:true, discountPercent:10,
        variants: [{name:'Katta hajm', price:200000}]},
    {id: 3, price: 50000, discountActive:false, discountPercent:20, variants:[]}
];

test('product and effective category discounts plus variants and quantities', () => {
    const c = ctx(products, {'1':2, '2__Katta%20hajm':1, '3':1});
    const sum = c.getCartPricing();
    assert.equal(sum.originalTotal, 450000);
    assert.equal(sum.productDiscountAmount, 60000);
    assert.equal(sum.discountedSubtotal, 390000);
    assert.equal(sum.count, 4);
    assert.equal(c.calculateCartSubtotal(), 390000);
});

test('coupon minimum is evaluated after product/category discounts', () => {
    const coupon = {code:'SAVE10', minOrderAmount:400000, discountPercent:10};
    const c = ctx(products, {'1':2, '2__Katta%20hajm':1, '3':1}, coupon);
    assert.equal(c.getCartTotals().coupon, null);
    assert.equal(c.getCartTotals().total, 390000);
    const eligible = {code:'SAVE10', minOrderAmount:390000, discountPercent:10};
    const totals = c.getCartTotals(eligible);
    assert.equal(totals.couponDiscountAmount, 39000);
    assert.equal(totals.total, 351000);
    assert.equal(totals.originalTotal - totals.productDiscountAmount - totals.couponDiscountAmount, totals.total);
});

test('threshold changes with cart contents and coupon cannot discount an empty cart', () => {
    const c = ctx(products, {'1':1}, {code:'SAVE10', minOrderAmount:100000, discountPercent:10});
    assert.equal(c.getCartTotals().total, 80000);
    c.cart['1'] = 2;
    assert.equal(c.getCartTotals().total, 144000);
    c.cart = {};
    assert.equal(c.getCartTotals().total, 0);
});

test('manual coupon validation sends variant-inclusive discounted cart subtotal', async () => {
    const c = ctx(products, {'2__Katta%20hajm':1}, null);
    const el = {value:'save10', textContent:'', style:{}};
    const response = {
        ok:true,
        json:async () => ({success:true,coupon:{code:'SAVE10',discountPercent:10,minOrderAmount:180000}})
    };
    let request;
    c.document = {getElementById:() => el};
    c.fetch = async (url, opts) => {request = {url, opts}; return response;};
    c.updateCartBar = () => {};
    c.console = console;
    vm.runInContext(part('async function applyCoupon()', 'function showCouponNotice('), c);
    await c.applyCoupon();
    assert.equal(request.url, '/api/coupons/validate');
    assert.equal(JSON.parse(request.opts.body).orderAmount, 180000);
    assert.equal(c.couponDiscountAmount, 18000);
});

test('cart summary shows combined reductions and payable balance', () => {
    assert.ok(html.includes('id="cartTotalDiscount"'));
    assert.ok(html.includes('Mahsulot/kategoriya chegirmasi:'));
    assert.ok(html.includes('const totals = getCartTotals();'));
    assert.ok(html.includes('getDiscountedProductPrice(p, variantPrice)'));
});
