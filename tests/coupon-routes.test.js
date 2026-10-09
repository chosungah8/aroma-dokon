const { test } = require('node:test');
const assert = require('node:assert/strict');
const { handleCouponRoutes, validCoupon } = require('../backend/coupon-routes.js');

const coupon = {code:'AROMA10', discount_percent:10, min_order_amount:150000,active:true,start_at:null,end_at:null,usage_limit:null,used_count:0};
function supabaseStub() {
  const saved = [];
  const db={coupons:[coupon],user_coupons:saved};
  function query(table) {
    let conditions=[], next=[];
    const q={
      select(){return q;},eq(key,val){conditions.push([key,val]);return q;},
      order(){return Promise.resolve({data:db[table].filter(c=>conditions.every(([k,v])=>c[k]===v)),error:null});},
      maybeSingle(){return Promise.resolve({data:db[table].find(c=>conditions.every(([k,v])=>c[k]===v))||null,error:null});},
      upsert(row){if(!db[table].some(c=>c.user_id===row.user_id && c.coupon_code===row.coupon_code)) db[table].push(row);return Promise.resolve({error:null});},
      then(ok,bad){return Promise.resolve({data:db[table].filter(c=>conditions.every(([k,v])=>c[k]===v)),error:null}).then(ok,bad);}
    }; return q;
  }
  return {from:query,saved};
}
function response() {let result={};return Object.assign(result,{headers:{},setHeader(k,v){this.headers[k]=v},writeHead(code){this.status=code;},end(json){this.body=JSON.parse(json)}});}
function request(method,auth,body) {
  return {method,headers:auth?{'x-telegram-init-data':'valid-signature'}:{},body};
}
const deps=db=>({supabase:db,verifiedMiniAppUser:init=>init==='valid-signature'?{id:777}:null,botToken:'dummy'});
async function route(db,url,req) {const res=response();const handled=await handleCouponRoutes(req,res,new URL(url,'http://local'),deps(db));assert.equal(handled,true);return res;}
test('public available list only active positive discount',async()=>{
  const db=supabaseStub();const r=await route(db,'/api/coupons/available',request('GET'));
  assert.equal(r.status,200);assert.deepEqual(r.body.coupons.map(x=>x.code),['AROMA10']);
});
test('download requires verified Telegram session',async()=>{
  const db=supabaseStub();const r=await route(db,'/api/coupons/save',request('POST',false,{code:'AROMA10'}));
  assert.equal(r.status,401);assert.deepEqual(db.saved,[]);
});
test('download persistent and mine returns confirmed codes',async()=>{
  const db=supabaseStub();let r=await route(db,'/api/coupons/save',request('POST',true,{code:'aroma10'}));
  assert.equal(r.status,200);assert.deepEqual(db.saved,[{user_id:'777',coupon_code:'AROMA10'}]);
  r=await route(db,'/api/coupons/mine',request('GET',true));assert.deepEqual(r.body.codes,['AROMA10']);
  r=await route(db,'/api/coupons/save',request('POST',true,{code:'AROMA10'}));
  assert.equal(r.status,200);assert.equal(db.saved.length,1);
});
test('reject unavailable or expired coupon',async()=>{
  const db=supabaseStub();const r=await route(db,'/api/coupons/save',request('POST',true,{code:'BAD'}));
  assert.equal(r.status,400);
  assert.equal(validCoupon({...coupon,end_at:'2000-01-01'}),false);
  assert.equal(validCoupon({...coupon,active:false}),false);
  assert.equal(validCoupon({...coupon,used_count:3,usage_limit:3}),false);
});
test('not a coupon path is unhandled',async()=>{
  const db=supabaseStub(), r=response();const handled=await handleCouponRoutes(request('GET'),r,new URL('http://local/api/products'),deps(db));
  assert.equal(handled,false);
});
