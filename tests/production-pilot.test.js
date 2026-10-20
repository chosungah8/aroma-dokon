'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { placeOrder } = require('../lib/orders.js');
const { handleBonusRoutes } = require('../lib/bonus-routes.js');

const PILOT = '123456789';
const OTHER = '987654321';
function checkoutData(bonusSpent = 0, extra = {}) {
  return {
    requestId: '550e8400-e29b-41d4-a716-446655440000',
    items: [{id:1,count:1}], phone:'TEST', address:'TEST',
    bonusSpent, ...extra
  };
}
function mockRpc() {
  const calls=[];
  return {calls,supabase:{rpc:async (name,params) => {
    calls.push({name,params});
    return {data:{order:{id:'AR-TEST-1'}},error:null};
  }}};
}
function usingPilot(id,run) {
  const prev=process.env.AROMA_BONUS_PILOT_TELEGRAM_ID;
  if (id===null) delete process.env.AROMA_BONUS_PILOT_TELEGRAM_ID;
  else process.env.AROMA_BONUS_PILOT_TELEGRAM_ID=id;
  return Promise.resolve().then(run).finally(() => {
    if (prev===undefined) delete process.env.AROMA_BONUS_PILOT_TELEGRAM_ID;
    else process.env.AROMA_BONUS_PILOT_TELEGRAM_ID=prev;
  });
}
test('Pilot env yo‘q bo‘lsa bonus sarflash mutlaqo bloklanadi', () => usingPilot(null,async()=> {
  const db=mockRpc();
  await assert.rejects(() => placeOrder(db.supabase,checkoutData(2000),{from:{id:PILOT}}),/faqat sinov/);
  assert.equal(db.calls.length,0);
}));
test('Pilot bo‘lmagan foydalanuvchining bonus RPC chaqiruvi bloklanadi', () => usingPilot(PILOT,async()=> {
  const db=mockRpc();
  await assert.rejects(() => placeOrder(db.supabase,checkoutData(2000,{telegramUserId:PILOT}),{from:{id:OTHER}}),/faqat sinov/);
  assert.equal(db.calls.length,0);
}));
test('Boshqa mijoz oddiy buyurtma bilan v2 RPC ishlatishda davom etadi', () => usingPilot(PILOT,async()=> {
  const db=mockRpc();
  await placeOrder(db.supabase,checkoutData(0),{from:{id:OTHER}});
  assert.equal(db.calls[0].name,'aroma_place_order_v2');
  assert.equal(db.calls[0].params.p_customer_id,OTHER);
}));
test('Pilot mijozning bonusli buyurtmasi bonus RPCga boradi', () => usingPilot(PILOT,async()=> {
  const db=mockRpc();
  await placeOrder(db.supabase,checkoutData(2000),{from:{id:PILOT}});
  assert.equal(db.calls[0].name,'aroma_place_order_with_bonus_v1');
  assert.equal(db.calls[0].params.p_customer_id,PILOT);
  assert.equal(db.calls[0].params.p_spend_points,2000);
}));
async function getBonus({id=PILOT,token='signed',pilot=PILOT,path='/api/bonus/quote?total=100000'}={}) {
  const calls=[];
  const res={code:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(n){this.code=n;},end(v){this.body=JSON.parse(v);}};
  await usingPilot(pilot,() => handleBonusRoutes(
    {method:'GET',headers:{'x-telegram-init-data':token}}, res,
    new URL(path,'https://test.example'), {
      botToken:'test-token', verifiedMiniAppUser:(header)=>header==='signed'?{id}:null,
      supabase:{rpc:async(n,params)=>{calls.push([n,params]);return {data:{enabled:false,balance:2000,max_redeemable:0,min_redeem_order:0,max_redeem_percent:100,reason:'bonus_disabled'},error:null};}}
    }
  ));
  return {res,calls};
}
test('Bonus API Telegram tasdig‘isiz ochilmaydi',async()=> {
  const {res,calls}=await getBonus({token:''});
  assert.equal(res.code,401);
  assert.equal(calls.length,0);
});
test('Pilot bo‘lmagan mijoz uchun bonus quote 0 va bazaga so‘rovsiz',async()=> {
  const {res,calls}=await getBonus({id:OTHER});
  assert.equal(res.code,200);
  assert.equal(res.body.maxRedeemable,0);
  assert.equal(res.body.enabled,false);
  assert.equal(calls.length,0);
});
test('Pilot ID yo‘q bo‘lsa ham quote API yopiq',async()=> {
  const {res,calls}=await getBonus({pilot:null});
  assert.equal(res.body.maxRedeemable,0);
  assert.equal(calls.length,0);
});
test('Haqiqiy pilot quote faqat tasdiqlangan Telegram IDga uzatiladi',async()=> {
  const {res,calls}=await getBonus({path:'/api/bonus/quote?total=100000&customerId=987654321'});
  assert.equal(res.code,200);
  assert.equal(calls.length,1);
  assert.equal(calls[0][1].p_customer_id,PILOT);
});
