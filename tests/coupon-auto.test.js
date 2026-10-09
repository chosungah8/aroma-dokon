'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
function part(start, end) {
    const i = html.indexOf(start), j = html.indexOf(end, i);
    assert.ok(i >= 0 && j >= 0, 'Missing section '+start);
    return html.slice(i, j);
}
function element(tag = '') {
    return { tag, style: {}, textContent: '', children: [], append(...nodes) {this.children.push(...nodes)},
        replaceChildren(...nodes){this.children = [...nodes]}, setAttribute(){} };
}
function setup(cart, coupons, options = {}) {
    const nodes = {cartCouponsList: element(), couponResult: element()};
    const context = {
        products: [
            {id:1, price:100000, variants:[], discountActive:true, discountPercent:20},
            {id:2, price:80000, variants:[{name:'Katta',price:120000}], discountActive:false, discountPercent:0}
        ],
        cart, appliedCoupon: null, couponDiscountAmount:0,
        downloadedCouponCode: options.downloadedCouponCode || '',
        document:{getElementById:id=>nodes[id] || null, createElement:tag=>element(tag)},
        fetch: options.fetch || (async () => ({ok:true,status:200,json:async()=>({success:true,coupons})})),
        console, Number, Math, localStorage:{setItem(){}}, tg:{initData:'valid'},
        showCouponNotice: ()=>{}
    };
    vm.createContext(context);
    const script =
        part('function getVariantPrice(', 'function selectVariant(') + '\n' +
        part('function chooseCouponForAmount(', '// Catalog requests can fail');
    vm.runInContext(script, context);
    // The real cart updates price every time selection is synchronized.
    context.updateCartBar = () => {
        context.syncAutomaticCoupon();
        context.currentTotals = context.getCartTotals();
    };
    return {context,nodes};
}
const coupons = [
    {code:'SAVE10', discountPercent:10,minOrderAmount:160000},
    {code:'SAVE25', discountPercent:25,minOrderAmount:200000},
    {code:'SAVE5', discountPercent:5,minOrderAmount:80000}
];

test('coupon is automatically selected exactly at discounted threshold and reduces total', async ()=>{
    const {context,nodes} = setup({'1':2}, coupons);
    assert.equal(await context.loadAvailableCoupons(), true);
    assert.equal(context.appliedCoupon.code,'SAVE10');
    assert.equal(context.currentTotals.originalTotal, 200000);
    assert.equal(context.currentTotals.productDiscountAmount, 40000);
    assert.equal(context.currentTotals.couponDiscountAmount,16000);
    assert.equal(context.currentTotals.total,144000);
    assert.match(nodes.couponResult.textContent,/avtomatik qo‘llandi/);
});

test('saved eligible coupon is preferred and recovers after quantity reaches its minimum',async()=>{
    const {context} = setup({'1':1}, coupons,{downloadedCouponCode:'SAVE10'});
    await context.loadAvailableCoupons();
    assert.equal(context.appliedCoupon.code,'SAVE5');
    context.cart['1'] = 2;
    context.updateCartBar();
    assert.equal(context.appliedCoupon.code,'SAVE10');
    context.cart['1'] = 1;
    context.updateCartBar();
    assert.equal(context.appliedCoupon.code,'SAVE5');
});

test('variant and product discount counted before deciding best coupon',async()=>{
    const {context} = setup({'1':1,'2__Katta':1},coupons);
    await context.loadAvailableCoupons();
    assert.equal(context.getCartPricing().discountedSubtotal,200000);
    assert.equal(context.appliedCoupon.code,'SAVE25');
    assert.equal(context.getCartTotals().couponDiscountAmount,50000);
    assert.equal(context.getCartTotals().total,150000);
});

test('no coupon applies to empty cart or under minimum and server errors fail closed',async()=>{
    const {context,nodes} = setup({},coupons);
    await context.loadAvailableCoupons();
    assert.equal(context.appliedCoupon,null);
    context.cart['1']=1;
    context.updateCartBar();
    assert.equal(context.appliedCoupon.code,'SAVE5');
    context.fetch = async () => ({ok:false,status:500,json:async()=>({success:false,message:'Server xatosi'})});
    assert.equal(await context.loadAvailableCoupons(),false);
    assert.equal(context.appliedCoupon,null);
    assert.equal(context.getCartTotals().total,80000);
    assert.match(nodes.couponResult.textContent,/serveri/);
});

test('stale coupon requests cannot override newer results', async()=>{
    let resolveOld;
    let call=0;
    const fetch=()=> {
        call++;
        if(call===1) return new Promise(r=>resolveOld=r);
        return Promise.resolve({ok:true,status:200,json:async()=>({success:true,coupons:[coupons[2]]})});
    };
    const {context} = setup({'1':2},coupons,{fetch});
    const old = context.loadAvailableCoupons();
    assert.equal(await context.loadAvailableCoupons(),true);
    resolveOld({ok:true,status:200,json:async()=>({success:true,coupons:[coupons[1]]})});
    assert.equal(await old,false);
    assert.equal(context.appliedCoupon.code,'SAVE5');
});

test('checkout requires live coupon refresh before composing order and transmits chosen code',()=>{
    const src=part('async function sendOrder()', 'function escapeOrderText(');
    assert.match(src,/await loadAvailableCoupons\(\)/);
    assert.match(src,/couponCode: appliedCoupon\?\.code \|\| null/);
    assert.match(html,/function updateCartBar\(\) \{\s*syncAutomaticCoupon\(\)/);
    assert.match(html,/async function downloadCoupon\(code\)/);
});
