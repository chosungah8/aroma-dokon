'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {handleBonusAdminRoutes} = require('../lib/bonus-admin-routes.js');
const html = fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');

function make({auth=true,method='GET',endpoint='config',body,rollout='global',settingsError=false}={}) {
  const calls=[];
  const req={method,body,headers:{}};
  const res={status:null,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},
    writeHead(n,h){this.status=n;Object.assign(this.headers,h||{});},end(v){this.body=JSON.parse(v);}};
  const supabase={from(table){
    const q={table,params:{}};
    const api={
      select(columns){q.params.select=columns;return this;},
      order(){return this;},range(){return Promise.resolve({data:table==='categories'?[{id:1,name:'TEST',bonus_percent_override:null}]:[{id:1,name:'TEST',category:'TEST'}],error:null});},
      eq(field,value){q.params[field]=value;return this;},
      update(value){q.params.update=value;return this;},
      single(){calls.push(q);if(table==='aroma_bonus_settings'){
        if(settingsError)return Promise.resolve({error:new Error('fail')});
        return Promise.resolve({data: q.params.select==='rollout_mode'?{rollout_mode:rollout}:
          {id:1,enabled:false,rollout_mode:rollout,default_percent:2,min_redeem_order:0,max_redeem_percent:100},error:null});
      }return Promise.resolve({data:{id:1},error:null});},
      maybeSingle(){calls.push(q);return Promise.resolve({data:{id:1},error:null});}
    };
    return api;
  }};
  return {calls,req,res,supabase,auth,url:new URL('/api/admin/bonus/'+endpoint,'https://test.example')};
}
async function run(opts){const e=make(opts);e.handled=await handleBonusAdminRoutes(e.req,e.res,e.url,{supabase:e.supabase,isAdmin:e.auth});return e;}

test('Admin autentifikatsiyasiz so‘rov rad etiladi',async()=>{
  const e=await run({auth:false});assert.equal(e.res.status,401);assert.equal(e.calls.length,0);
});
test('Noto‘g‘ri HTTP usuli va noma’lum ruta bloklanadi',async()=>{
  assert.equal((await run({method:'POST'})).res.status,405);
  assert.equal((await run({endpoint:'settings',method:'GET'})).res.status,405);
  assert.equal((await run({endpoint:'missing'})).res.status,404);
});
test('Global SQL migratsiyasiz admin boshqaruvi bloklanadi',async()=>{
  assert.equal((await run({rollout:'pilot'})).res.status,503);
  const x=await run({endpoint:'settings',method:'PUT',rollout:'pilot',body:{enabled:true,defaultPercent:2,minRedeemOrder:0,maxRedeemPercent:100,welcomePoints:0}});
  assert.equal(x.res.status,503);
  assert.equal(x.calls.filter(c=>c.params.update).length,0);
});
test('Admin sozlamalarni o‘qiydi (faqat himoyalangan API)',async()=>{
  const e=await run();assert.equal(e.res.status,200);assert.equal(e.res.body.success,true);
  assert.equal(e.res.body.settings.rollout_mode,'global');
  assert.equal(e.res.body.categories[0].id,1);assert.equal(e.res.body.products[0].id,1);
});
test('Admin global yoqish va foizlarni saqlaydi',async()=>{
  const e=await run({endpoint:'settings',method:'PUT',body:{enabled:true,defaultPercent:2.5,minRedeemOrder:100000,maxRedeemPercent:50,welcomePoints:0}});
  assert.equal(e.res.status,200);
  const update=e.calls.find(c=>c.params.update);
  assert.equal(update.params.update.enabled,true);
  assert.equal(update.params.update.default_percent,2.5);
  assert.equal(update.params.rollout_mode,'global');
});
test('Noto‘g‘ri foiz va enabled rad etiladi',async()=>{
  for(const body of [{enabled:'true',defaultPercent:2,minRedeemOrder:0,maxRedeemPercent:100},
      {enabled:true,defaultPercent:101,minRedeemOrder:0,maxRedeemPercent:100},
      {enabled:true,defaultPercent:2.123,minRedeemOrder:0,maxRedeemPercent:100},
      {enabled:true,defaultPercent:2,minRedeemOrder:-1,maxRedeemPercent:100}]){
    const e=await run({endpoint:'settings',method:'PUT',body});
    assert.equal(e.res.status,400);
    assert.equal(e.calls.filter(c=>c.params.update).length,0);
  }
});
test('Kategoriya foizi 0 yoki null qilib saqlanadi',async()=>{
  for(const percent of [0,null,5.5]){
    const e=await run({endpoint:'category',method:'PUT',body:{id:1,percent}});
    assert.equal(e.res.status,200);
    assert.equal(e.calls.find(c=>c.params.update).params.update.bonus_percent_override,percent);
  }
});
test('Mahsulot va vaqtli bonus aksiyasi saqlanadi',async()=>{
  const e=await run({endpoint:'product',method:'PUT',body:{id:1,percent:10,promoPercent:15,
    promoStartsAt:'2026-10-22T01:00:00.000Z',promoEndsAt:'2026-10-25T01:00:00.000Z'}});
  assert.equal(e.res.status,200);
  const patch=e.calls.find(c=>c.params.update).params.update;
  assert.equal(patch.bonus_percent_override,10);
  assert.equal(patch.bonus_promo_percent,15);
});
test('Tugash vaqti boshlanishdan oldin bo‘lsa bloklanadi',async()=>{
  const e=await run({endpoint:'product',method:'PUT',body:{id:1,percent:10,promoPercent:15,
    promoStartsAt:'2026-10-25T01:00:00.000Z',promoEndsAt:'2026-10-22T01:00:00.000Z'}});
  assert.equal(e.res.status,400);
});
test('Admin HTMLda umumiy, kategoriya va mahsulot boshqaruvi mavjud',()=>{
  for(const id of ['bonusGlobalEnabled','bonusGlobalPercent','bonusMinOrder',
    'bonusMaxRedeemPercent','bonusCategorySelect','bonusCategoryPercent',
    'bonusProductSelect','bonusProductPercent','bonusProductPromoPercent',
    'bonusProductPromoStart','bonusProductPromoEnd']) assert.ok(html.includes('id="'+id+'"'),id);
  assert.match(html,/function saveBonusGlobal\(/);
  assert.match(html,/function saveBonusCategory\(/);
  assert.match(html,/function saveBonusProduct\(/);
});
