'use strict';
// Old production pilot tests were deliberately replaced for GLOBAL rollout.
const test = require('node:test');
const assert = require('node:assert/strict');
const {placeOrder} = require('../lib/orders.js');
const {handleBonusRoutes} = require('../lib/bonus-routes.js');
const fs = require('node:fs');
const path = require('node:path');
const sql = fs.readFileSync(path.join(__dirname, '../sql/aroma-bonus-global-migration.sql'), 'utf8');
const OTHER = '987654321';
const DATA = {requestId:'550e8400-e29b-41d4-a716-446655440000',
  items:[{id:1,count:1}],phone:'TEST',address:'TEST'};
function database(reply={data:{order:{id:'AR-TEST-1'}},error:null}) {
  const calls=[];
  return {calls, supabase:{rpc:async(name,params)=>{calls.push({name,params});return reply;}}};
}
test('Oddiy mijoz bonus sarflamasa avvalgi v2 buyurtma ishlaydi',async()=>{
  const db=database();await placeOrder(db.supabase,{...DATA,bonusSpent:0},{from:{id:OTHER}});
  assert.equal(db.calls[0].name,'aroma_place_order_v2');
});
test('Hamma tasdiqlangan mijozlar bonus RPCga o‘ta oladi; SQL balansni tekshiradi',async()=>{
  const db=database(); await placeOrder(db.supabase,{...DATA,bonusSpent:2000,telegramUserId:'999999999'},{from:{id:OTHER}});
  assert.equal(db.calls[0].name,'aroma_place_order_with_bonus_v1');
  assert.equal(db.calls[0].params.p_customer_id,OTHER);
  assert.equal(db.calls[0].params.p_spend_points,2000);
});
test('SQL bonus disabled yoki balans yetmaganda buyurtma rad qilinadi',async()=>{
  const db=database({data:null,error:{code:'P0001',message:'Sarflanadigan ball belgilangan limitdan oshgan'}});
  await assert.rejects(()=>placeOrder(db.supabase,{...DATA,bonusSpent:2000},{from:{id:OTHER}}),/Sarflanadigan ball/);
});
test('Noto‘g‘ri bonus miqdori SQLga bormaydi',async()=>{
  for(const bonusSpent of [-5,1.5, '5',null,1000000001]){
    const db=database();await assert.rejects(()=>placeOrder(db.supabase,{...DATA,bonusSpent},{from:{id:OTHER}}));
    assert.equal(db.calls.length,0);
  }
});
async function quote({initData='signed',customer=OTHER}={}) {
  const calls=[];
  const res={code:null,body:null,setHeader(){},writeHead(n){this.code=n;},end(v){this.body=JSON.parse(v);}};
  await handleBonusRoutes({method:'GET',headers:{'x-telegram-init-data':initData}},res,
    new URL('/api/bonus/quote?total=100000&customerId=1234','https://example.test'),{
      botToken:'x',verifiedMiniAppUser:value=>value==='signed'?{id:customer}:null,
      supabase:{rpc:async(name,params)=>{
        calls.push({name,params});return {data:{enabled:false,balance:0,max_redeemable:0,
          min_redeem_order:0,max_redeem_percent:100,reason:'bonus_disabled'},error:null};
      }}
    });return {calls,res};
}
test('Telegram seansisiz bonus balansiga ruxsat berilmaydi',async()=>{
  const r=await quote({initData:''});assert.equal(r.res.code,401);assert.equal(r.calls.length,0);
});
test('Bonus quote mijoz IDni URLdan emas imzolangan Telegram seansidan oladi',async()=>{
  const r=await quote();assert.equal(r.res.code,200);
  assert.equal(r.calls.length,1);assert.equal(r.calls[0].params.p_customer_id,OTHER);
});
test('SQL migratsiyasi avval tizimni o‘chiq saqlaydi va pilot cheklovini olib tashlaydi',()=>{
  assert.match(sql,/enabled=false/);
  assert.match(sql,/rollout_mode='global'/);
  assert.doesNotMatch(sql,/IF NOT public\.aroma_bonus_pilot_allowed_v1/);
  assert.doesNotMatch(sql,/IF NOT public\.aroma_bonus_pilot_allowed_v1/);
  assert.match(sql,/COMMIT;/);
});
test('Global SQL funksiyalari service_role uchungina mavjud',()=>{
  assert.match(sql,/REVOKE ALL ON FUNCTION .*FROM PUBLIC, anon, authenticated/);
  assert.match(sql,/GRANT EXECUTE ON FUNCTION .*TO service_role/);
});
