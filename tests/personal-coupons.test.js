'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {normalizeInput,resolveCustomer,isActivePersonal,handlePersonalCouponRoutes}=require('../lib/personal-coupons.js');
const {placeOrder}=require('../lib/orders.js');
const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const sql=fs.readFileSync(path.join(root,'sql','aroma-shaxsiy-kuponlar.sql'),'utf8');
function parts(start,end){
  const i=html.indexOf(start),j=html.indexOf(end,i);
  assert.ok(i>=0 && j>i,`missing ${start} ... ${end}`);
  return html.slice(i,j);
}
const products=[{id:1,price:400000,discountActive:true,discountPercent:10,variants:[]}];
function pricingContext(vouchers,cart={'1':1},regular={code:'SAVE10',discountPercent:10,minOrderAmount:300000}) {
  const context={products,cart,appliedCoupon:regular,personalCoupons:vouchers,Date,Number,Math};
  vm.createContext(context);
  vm.runInContext(parts('function getVariantPrice(', 'function selectVariant(')+'\n'+
    parts('function getDiscountedProductPrice(', '// Catalog requests can fail'),context);
  return context;
}
const coupon={id:10,code:'VIP-AA01',status:'active',active:true,discountType:'fixed',discountValue:20000,
 minOrderAmount:300000,expiresAt:'2099-12-30T00:00:00Z'};
function response(){return {status:0,body:null,setHeader(){},writeHead(code){this.status=code;},end(str){this.body=JSON.parse(str);}};}
const req=(method,init='init')=>({method,headers:{'x-telegram-init-data':init}});
const url=pathname=>({pathname});

test('input validates Telegram ID, phone, percentages and minimum safely',()=>{
  assert.deepEqual(normalizeInput({targetType:'phone',target:'+998 90 123 45 67',discountType:'fixed',discountValue:20000,minOrderAmount:300000,days:10}),
    {kind:'phone',target:'+998 90 123 45 67',discountType:'fixed',discountValue:20000,minOrderAmount:300000,days:10});
  assert.equal(normalizeInput({targetType:'telegram',target:'12345678',discountType:'percent',discountValue:15,minOrderAmount:0,days:1}).kind,'telegram');
  for(const invalid of [
    {targetType:'telegram',target:'-100',discountType:'fixed',discountValue:10,minOrderAmount:0,days:1},
    {targetType:'phone',target:'<script>',discountType:'fixed',discountValue:10,minOrderAmount:0,days:1},
    {targetType:'telegram',target:'123',discountType:'percent',discountValue:101,minOrderAmount:0,days:1},
    {targetType:'telegram',target:'123',discountType:'fixed',discountValue:100,minOrderAmount:-1,days:1},
    {targetType:'telegram',target:'123',discountType:'fixed',discountValue:100,minOrderAmount:0,days:0},
  ]) assert.throws(()=>normalizeInput(invalid));
});

test('phone targets resolve to exactly one account, never silently pick one of multiple',async()=>{
  const input={kind:'phone',target:'+998901234567'};
  let result=[{customer_id:'701'},{customer_id:'701'}];
  const db={rpc:async(name,args)=>{assert.equal(name,'aroma_find_personal_coupon_customer_v1');assert.equal(args.p_phone,input.target);return {data:result,error:null};}};
  assert.equal(await resolveCustomer(db,input),'701');
  result=[{customer_id:'701'},{customer_id:'702'}];
  await assert.rejects(()=>resolveCustomer(db,input),/bir nechta/);
  result=[];
  await assert.rejects(()=>resolveCustomer(db,input),/topilmadi/);
  assert.equal(await resolveCustomer(db,{kind:'telegram',target:'777'}),'777');
});

test('personal vouchers are active only if unused, enabled, and not expired',()=>{
  assert.equal(isActivePersonal({active:true,used_at:null,expires_at:'2099-01-01T00:00:00Z'}),true);
  assert.equal(isActivePersonal({active:true,used_at:'2026-01-01',expires_at:'2099-01-01T00:00:00Z'}),false);
  assert.equal(isActivePersonal({active:false,used_at:null,expires_at:'2099-01-01T00:00:00Z'}),false);
  assert.equal(isActivePersonal({active:true,used_at:null,expires_at:'2020-01-01T00:00:00Z'}),false);
});

test('public GET mine uses ONLY verified Telegram ID, does not trust spoofed query user IDs',async()=>{
  let requestedId=null;
  const db={from(name){assert.equal(name,'personal_coupons');const q={
      select(){return q;},eq(name,id){assert.equal(name,'customer_id');requestedId=id;return q;},order(){return q;},
      limit:async()=>({data:[{id:5,code:'VIP-AAAABBBBCCCCDD',discount_type:'fixed',discount_value:15000,min_order_amount:100000,expires_at:'2099-01-01',active:true,used_at:null}],error:null})};return q;}};
  const res=response();
  await handlePersonalCouponRoutes(req('GET'),res,url('/api/coupons/personal/mine'),{
      supabase:db,isAdmin:false,botToken:'secret',verifiedMiniAppUser:()=>({id:12})});
  assert.equal(requestedId,'12');assert.equal(res.status,200);assert.equal(res.body.coupons[0].discountValue,15000);
  const denied=response();
  await handlePersonalCouponRoutes(req('GET'),denied,url('/api/coupons/personal/mine'),{
      supabase:db,isAdmin:false,botToken:'secret',verifiedMiniAppUser:()=>null});
  assert.equal(denied.status,401);
});

test('admin coupon issuance refuses unauthenticated callers and sends only to selected customer',async()=>{
  const body={targetType:'telegram',target:'701',discountType:'fixed',discountValue:20000,minOrderAmount:300000,days:10};
  const sent=[];let inserted;
  const db={from(table){assert.equal(table,'personal_coupons');return {insert(row){inserted=row;return {select(){return {single:async()=>({data:{id:1,...row},error:null})};}};}};}};
  const bot={telegram:{sendMessage:async(id,message)=>sent.push({id,message})}};
  const denied=response();
  await handlePersonalCouponRoutes({method:'POST',headers:{},body},denied,url('/api/admin/personal-coupons'),{
      supabase:db,isAdmin:false,bot});
  assert.equal(denied.status,401);assert.equal(inserted,undefined);
  const res=response();
  await handlePersonalCouponRoutes({method:'POST',headers:{},body},res,url('/api/admin/personal-coupons'),{
      supabase:db,isAdmin:true,bot});
  assert.equal(res.status,200);assert.equal(res.body.telegramSent,true);assert.equal(inserted.customer_id,'701');
  assert.match(inserted.code,/^VIP-[A-F0-9]{14}$/);assert.deepEqual(sent.map(x=>x.id),['701']);
});

test('failed Telegram delivery does not erase a successfully issued personal coupon',async()=>{
  const row={id:1,customer_id:'701',code:'VIP-AAAABBBBCCCCDD'};
  const db={from(){return {insert(){return {select(){return {single:async()=>({data:row,error:null})};}};}};}};
  const res=response();
  await handlePersonalCouponRoutes({method:'POST',headers:{},body:{targetType:'telegram',target:'701',discountType:'percent',discountValue:15,minOrderAmount:50000,days:2}},res,url('/api/admin/personal-coupons'),{
      supabase:db,isAdmin:true,bot:{telegram:{sendMessage:async()=>{throw Error('not started')}}}});
  assert.equal(res.status,200);assert.equal(res.body.telegramSent,false);
});

test('cart combines product + ordinary + personal discount without negative payables',()=>{
  const c=pricingContext([coupon]);
  const totals=c.getCartTotals();
  assert.equal(totals.originalTotal,400000);
  assert.equal(totals.productDiscountAmount,40000);
  assert.equal(totals.couponDiscountAmount,36000);
  assert.equal(totals.personalDiscountAmount,20000);
  assert.equal(totals.total,304000);
  assert.equal(totals.personalCoupon.id,10);
});

test('personal percent discount is on payable after regular coupon; minimum before both coupons',()=>{
  const pct={...coupon,discountType:'percent',discountValue:20,minOrderAmount:360000};
  const c=pricingContext([pct]);
  assert.equal(c.getCartTotals().personalDiscountAmount,64800);
  assert.equal(c.getCartTotals().total,259200);
  pct.minOrderAmount=360001;
  assert.equal(c.getCartTotals().personalCoupon,null);
  assert.equal(c.getCartTotals().total,324000);
});

test('one use and server-side ownership are enforced in SQL; ordinary v2 remains intact',()=>{
  assert.match(sql,/WHERE id=p_personal_coupon_id FOR UPDATE/);
  assert.match(sql,/v_coupon\.customer_id IS DISTINCT FROM p_customer_id/);
  assert.match(sql,/v_coupon\.used_at IS NOT NULL/);
  assert.match(sql,/v_coupon\.min_order_amount/);
  assert.match(sql,/UPDATE public\.personal_coupons SET used_at=/);
  assert.match(sql,/public\.aroma_place_order_v2\(/);
  assert.match(sql,/rejected.*true/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.aroma_place_order_v3/);
});

test('order RPC uses v3 and verified Telegram identity only with personal id',async()=>{
  const calls=[];
  const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{order:{id:'AR-1020'}},error:null};}};
  await placeOrder(db,{telegramUserId:'999',phone:'+998901234567',address:'Toshkent',items:[{id:1,count:1}],personalCouponId:15},
    {from:{id:701,first_name:'Ada'},update:{update_id:41}});
  assert.equal(calls[0].name,'aroma_place_order_v3');
  assert.equal(calls[0].args.p_customer_id,'701');
  assert.equal(calls[0].args.p_personal_coupon_id,15);
});
