'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').resolve(__dirname,'../index.html'),'utf8');
const start = html.indexOf('function renderCouponCards() {');
const end = html.indexOf('async function loadAvailableCoupons()',start);
assert.ok(start > 0 && end > start, 'renderCouponCards source available');
function element(){return {style:{},children:[],textContent:'',append(...args){this.children.push(...args)},replaceChildren(){this.children=[];this.textContent=''}}}
function render(active,saved,amount=0){
  const list=element();
  const sandbox={document:{getElementById:() => list,createElement:()=>element()},couponCatalogReady:true,availableCouponsCache:active,verifiedSavedCouponCodes:new Set(saved),calculateCartSubtotal:()=>amount,appliedCoupon:null,Number,Set};
  vm.runInNewContext(html.slice(start,end)+'\nrenderCouponCards();',sandbox);
  return list;
}
function flatten(el){return [el.textContent,...el.children.flatMap(flatten)].join(' ')}
test('saved coupon is shown even when there are no active coupons',()=>{
  const dom=render([],['AROMA20']);
  assert.match(flatten(dom),/AROMA20 — Yuklab olingan/);
  assert.match(flatten(dom),/hozir qo‘llab bo‘lmaydi/);
  assert.doesNotMatch(flatten(dom),/Hozir faol kuponlar mavjud emas/);
});
test('nothing saved and nothing active shows simple no-coupons label',()=>{
  assert.match(flatten(render([],[])),/Hozir faol kuponlar mavjud emas/);
});
test('active coupon and inactive saved coupon both visible',()=>{
  const dom=render([{code:'AROMA10',discountPercent:10,minOrderAmount:100000}],['ESKI20'],120000);
  assert.match(flatten(dom),/ESKI20 — Yuklab olingan/);
  assert.match(flatten(dom),/AROMA10/);
});
test('coupon below minimum is displayed but not labeled applied',()=>{
  const dom=render([{code:'AROMA10',discountPercent:10,minOrderAmount:100000}],['AROMA10'],50000);
  assert.match(flatten(dom),/Yana 50,000 so‘m kerak/);
  assert.doesNotMatch(flatten(dom),/Avtomatik qo‘llandi/);
});
