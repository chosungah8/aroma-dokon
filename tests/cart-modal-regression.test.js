'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
function between(start,end){const a=html.indexOf(start), b=html.indexOf(end,a+start.length);assert.ok(a>=0&&b>a);return html.slice(a,b)}
test('empty-cart total refresh must not auto close the cart',()=>{
 const update=between('function updateCartBar() {','function openCartModal() {');
 assert.doesNotMatch(update,/closeCartModal\s*\(/);
});
test('opening cart happens before coupon loading and remains open',()=>{
 const open=between('function openCartModal() {','function closeCartModal() {');
 const opened=open.indexOf("modal.style.display = 'flex'");
 const fetched=open.indexOf('loadAvailableCoupons()');
 assert.ok(opened>=0&&fetched>opened);
 assert.doesNotMatch(open,/closeCartModal\s*\(/);
});
test('coupon cards are visible above cart items and checkout summary',()=>{
 const modal=between('<div class="modal" id="cartModal">','<div class="form-group" id="phoneForm">');
 assert.ok(modal.indexOf('id="cartCouponsSection"')<modal.indexOf('id="cartItemsList"'));
 assert.ok(modal.indexOf('id="cartCouponsList"')<modal.indexOf('id="cartItemsList"'));
 assert.match(modal,/id="couponResult"/);
});
test('coupon unavailable errors do not blank or close cart',()=>{
 const load=between('async function loadAvailableCoupons() {','// Barcha savat hisoblari');
 assert.match(load,/list\.textContent = error\.message/);
 assert.doesNotMatch(load,/closeCartModal\(/);
});
