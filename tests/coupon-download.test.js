'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('async function downloadCoupon(code)');
const end = html.indexOf('// MIJOZ UCHUN AKSIYALARNI YUKLASH',start);
assert.ok(start >= 0 && end > start, 'Kuponni yuklab olish funksiyasi topilmadi');
const source = html.slice(start,end);
function scenario({authenticated=true, success=true, status=200}={}) {
  const requests=[], notifications=[], storageWrites=[];
  const headline={textContent:'',style:{}};
  const context={
    tg:authenticated?{initData:'telegram-verified-session'}:null,
    downloadedCouponCode:'', verifiedSavedCouponCodes:new Set(), downloadedCouponStorageKey:'aroma_downloaded_coupon:123',
    localStorage:{setItem:(...args)=>storageWrites.push(args)},
    document:{getElementById:id=>id==='savedCouponsHeadline'?headline:null},
    fetch:async (url, options)=>{requests.push({url,options});return {ok:success,status,json:async()=>({success,message:'Saqlash muvaffaqiyatsiz'})};},
    loadAvailableCoupons:async ()=>true, renderCouponCards(){},
    showCouponNotice:(...args)=>notifications.push(args),console:{error:()=>{}}
  };
  vm.createContext(context);
  vm.runInContext(source,context);
  return {context,requests,notifications,storageWrites,headline};
}
test('kuponni saqlash POST orqali Telegram sessiyasi bilan bajariladi',async()=>{
  const s=scenario();
  await s.context.downloadCoupon(' aroma10 ');
  assert.equal(s.requests.length,1);
  assert.equal(s.requests[0].url,'/api/coupons/save');
  assert.equal(s.requests[0].options.method,'POST');
  assert.equal(s.requests[0].options.headers['X-Telegram-Init-Data'],'telegram-verified-session');
  assert.equal(JSON.parse(s.requests[0].options.body).code,'AROMA10');
  assert.equal(s.context.downloadedCouponCode,'AROMA10');
  assert.equal(s.context.verifiedSavedCouponCodes.has('AROMA10'),true);
  assert.deepEqual(s.storageWrites,[['aroma_downloaded_coupon:123','AROMA10']]);
});
test('Telegram sessiyasiz kupon saqlashga urinish serverga ketmaydi',async()=>{
  const s=scenario({authenticated:false});
  await s.context.downloadCoupon('AROMA10');
  assert.equal(s.requests.length,0);
  assert.equal(s.context.verifiedSavedCouponCodes.size,0);
  assert.match(s.notifications[0][0],/Telegram/);
});
test('server kuponni saqlamasa mahalliy saqlandi deb ko‘rsatilmaydi',async()=>{
  const s=scenario({success:false,status:400});
  await s.context.downloadCoupon('AROMA10');
  assert.equal(s.requests.length,1);
  assert.equal(s.storageWrites.length,0);
  assert.equal(s.context.downloadedCouponCode,'');
  assert.equal(s.context.verifiedSavedCouponCodes.size,0);
  assert.equal(s.notifications.at(-1)[1],false);
});
test('saqlangan kuponlar serverdan qayta yuklanadi va savatda ko‘rinadi',()=>{
  assert.match(html,/fetch\('\/api\/coupons\/mine'/);
  assert.match(html,/verifiedSavedCouponCodes\s*=\s*new Set\(data\.codes/);
  assert.match(html,/const inactiveSavedCodes\s*=\s*\[\.\.\.verifiedSavedCouponCodes\]/);
  assert.match(html,/Yuklab olingan/);
  assert.match(html,/renderCouponCards\(\)/);
});
