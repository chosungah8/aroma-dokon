'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { handlePersonalCouponRoutes } = require('../lib/personal-coupons');

const html = fs.readFileSync('index.html', 'utf8');
const start = html.indexOf('function bonusPointsForProduct(');
const end = html.indexOf('function renderProducts()', start);
assert.ok(start >= 0 && end > start, 'bonus helper is present');
const context = vm.createContext({
  getVariantPrice: (p, variant) => p.variants?.[variant] || p.price,
  getDiscountedProductPrice: (p, price) => p.discountActive
    ? Math.round(price * (1 - p.discountPercent / 100)) : price
});
vm.runInContext(html.slice(start, end), context);

function amount(product, variant='', qty=1) {return context.bonusPointsForProduct(product, variant, qty);}

test('bonus card, detail and cart use one shared after-discount formula', () => {
  const p = { price:170000, stock:6, bonusPercent:1.5 };
  assert.equal(amount(p), 2550);
  assert.equal(amount(p, '', 3), 7650);
  assert.match(context.bonusPointsMarkup(p), /2 550 ballgacha/);
  assert.equal(amount({...p, discountActive:true, discountPercent:25}), 1912);
  assert.equal(amount({...p, variants:{big:210000}}, 'big'), 3150);
});

test('bonus badge is not visible if disabled, zero, out of stock', () => {
  const p = { price:170000, stock:4, bonusPercent:1.5 };
  assert.equal(amount({...p, bonusPercent:null}), 0);
  assert.equal(amount({...p, bonusPercent:0}), 0);
  assert.equal(amount({...p, stock:0}), 0);
  assert.equal(context.bonusPointsMarkup({...p, bonusPercent:null}), '');
  assert.equal(amount({...p, bonusPercent:150}), 0);
});

test('checkout has compact coupons and bonus while retaining existing IDs', () => {
  for (const id of ['cartCouponsSection','cartCouponsList','personalCouponCards','couponResult',
    'cartBonusSection','cartBonusSpendInput','cartBonusNotice','cartCouponCompactStatus',
    'cartFinalTotal','cartPersonalDiscount']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /<div id="cartCouponsSection" class="cart-compact-box">/);
  assert.match(html, /class="cart-compact-header"/);
  assert.doesNotMatch(html, /<details[^>]*id="cartCouponsSection"/);
  assert.doesNotMatch(html, /id="cartCouponsList"[^>]*max-height:/);
  assert.match(html, /bonusPointsMarkup\(product, window\.selectedVariants/);
  assert.match(html, /bonusPointsMarkup\(p, variant, quantity\)/);
  assert.match(html, /personalCoupons=data\.coupons\.filter\(c => c && c\.status !== 'used'\)/);
});

test('used personal vouchers do not reach customer API; admin listing is untouched', async () => {
  const called=[];
  const query = {
    select:()=>query,
    eq:(...args)=>{called.push(['eq',...args]);return query;},
    is:(...args)=>{called.push(['is',...args]);return query;},
    order:()=>query,
    limit:async()=>({data:[],error:null})
  };
  const supabase={from:(table)=>{assert.equal(table,'personal_coupons');return query;}};
  let text='';let status;
  const res={setHeader:()=>{},writeHead:s=>{status=s;},end:b=>{text=b;}};
  const handled=await handlePersonalCouponRoutes({method:'GET',headers:{'x-telegram-init-data':'mock'}},res,
    {pathname:'/api/coupons/personal/mine'},
    {supabase,verifiedMiniAppUser:()=>({id:'1234567'}),botToken:'test',isAdmin:false});
  assert.equal(handled,true);
  assert.equal(status,200);
  assert.deepEqual(JSON.parse(text),{success:true,coupons:[]});
  assert.ok(called.some(c=>c[0]==='is'&&c[1]==='used_at'&&c[2]===null));
});
