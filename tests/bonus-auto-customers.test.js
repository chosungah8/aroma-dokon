'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {productBonusPercent}=require('../lib/bonus-catalog');
const {handleBonusAdminRoutes}=require('../lib/bonus-admin-routes');
const {handleBonusRoutes}=require('../lib/bonus-routes');
const sql=fs.readFileSync(path.join(__dirname,'../sql/aroma-bonus-auto-customers.sql'),'utf8');
const shop=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
const admin=fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');
function response(){return {status:0,body:null,headers:{},setHeader(k,v){this.headers[k]=v;},writeHead(c,h){this.status=c;Object.assign(this.headers,h||{});},end(v){this.body=JSON.parse(v);}};}
function mockAdmin({auth=true,method='GET',endpoint='top',body,rpcData=[]}={}){
  const calls=[];
  const supabase={rpc:async (...args)=>{calls.push(args);return {data:rpcData,error:null};}};
  const url=new URL('/api/admin/bonus/'+endpoint,'https://shop.example');
  const req={method,body,headers:{}};
  return {calls,req,res:response(),url,supabase,auth};
}
test('Tizim o‘chiq bo‘lsa yoki mahsulotda 0% bo‘lsa banner yo‘q',()=>{
 const p={active:true,category:'Cream',bonus_percent_override:null,bonus_promo_percent:null};
 const categories=new Map([['Cream',5]]);
 assert.equal(productBonusPercent(p,categories,{enabled:false,rollout_mode:'global',default_percent:2}),null);
 assert.equal(productBonusPercent({...p,bonus_percent_override:0},categories,{enabled:true,rollout_mode:'global',default_percent:2}),0);
 assert.equal(productBonusPercent(p,categories,{enabled:true,rollout_mode:'global',default_percent:2}),5);
 assert.equal(productBonusPercent({...p,active:false},categories,{enabled:true,rollout_mode:'global',default_percent:2}),null);
});
test('Mahsulot narxi asosida ballgacha banneri yozilgan, eski foiz banneri yo‘q',()=>{
 assert.match(shop,/🎁 \$\{points\.toLocaleString\('en-US'\)\.replace\(\/,\/g, ' '\)\} ballgacha/);
 assert.match(shop,/function bonusPointsForProduct\(/);
 assert.match(shop,/Math\.floor\(unitPrice \* count \* percent \/ 100\)/);
 assert.match(shop,/bonusPointsMarkup\(p, selectedVariant/);
 assert.match(shop,/scheduleBonusCatalogRefresh/);
 assert.doesNotMatch(shop,/\+\$\{Number\(p\.bonusPercent\)/);
});
test('Birinchi kirish faqat Telegram initData bilan bonus balansini yuklaydi',()=>{
 assert.match(shop,/if \(tg\?\.initData\) \{\s*fetch\('\/api\/bonus\/balance'/);
 const api=fs.readFileSync(path.join(__dirname,'../lib/bonus-routes.js'),'utf8');
 assert.match(api,/verifiedMiniAppUser\(/);
 assert.match(api,/aroma_bonus_welcome_v1/);
});
test('Top mijozlar va aksiya berish admin sessiyasiz bloklanadi',async()=>{
 for(const endpoint of ['top','reward-top']){
  const e=mockAdmin({auth:false,endpoint});
  await handleBonusAdminRoutes(e.req,e.res,e.url,{supabase:e.supabase,isAdmin:e.auth});
  assert.equal(e.res.status,401);assert.equal(e.calls.length,0);
 }
});
test('Top tanlov yakunlangan buyurtma bo‘yicha SQLda hisoblanadi, ID kiritish shart emas',async()=>{
 const e=mockAdmin({rpcData:[{customerId:'345',ordersCount:7}]});
 e.url.searchParams.set('limit','10');e.url.searchParams.set('minOrders','2');
 await handleBonusAdminRoutes(e.req,e.res,e.url,{supabase:e.supabase,isAdmin:e.auth});
 assert.equal(e.res.status,200);
 assert.equal(e.calls[0][0],'aroma_bonus_top_customers_v1');
 assert.deepEqual(e.calls[0][1],{p_limit:10,p_min_orders:2});
 assert.match(sql,/o\.status='Yakunlandi'/);
 assert.match(sql,/ORDER BY orders_count DESC,paid_total DESC/);
});
test('Top akciani admin 1–20 mijoz va bir kampaniya kaliti bilan tasdiqlaydi',async()=>{
 const e=mockAdmin({method:'PUT',endpoint:'reward-top',body:{limit:5,minOrders:2,points:1000,campaignKey:'top:fa959889-cbaf-47b2-a6c1-222222222222'},rpcData:{ok:true,duplicate:false,awardedCount:5}});
 await handleBonusAdminRoutes(e.req,e.res,e.url,{supabase:e.supabase,isAdmin:true});
 assert.equal(e.res.status,200);
 assert.equal(e.calls[0][0],'aroma_bonus_reward_top_v1');
 assert.equal(e.calls[0][1].p_points,1000);
});
test('Noto‘g‘ri top buyruq va hajm SQLga yetib bormaydi',async()=>{
 for(const body of [{limit:200,minOrders:1,points:1000,campaignKey:'top:x'},
    {limit:10,minOrders:1,points:-1,campaignKey:'top:fa959889-cbaf-47b2-a6c1-222222222222'},
    {limit:10,minOrders:1,points:1000,campaignKey:'top:bad'}]){
  const e=mockAdmin({method:'PUT',endpoint:'reward-top',body});
  await handleBonusAdminRoutes(e.req,e.res,e.url,{supabase:e.supabase,isAdmin:true});
  assert.equal(e.res.status,400);assert.equal(e.calls.length,0);
 }
});
test('Bir martalik aksiyalar DBda requestKey bilan serializatsiya qilinadi',()=>{
 assert.match(sql,/pg_advisory_xact_lock\(hashtextextended\('bonus:top:'\|\|p_campaign_key,0\)\)/);
 assert.match(sql,/IF FOUND THEN\s*IF v_previous/);
 assert.match(sql,/campaign_key text PRIMARY KEY/);
 assert.match(sql,/request_key,reason/);
 assert.match(sql,/bonus:welcome:/);
 assert.match(sql,/EXISTS\(SELECT 1 FROM public\.orders WHERE customer_id=p_customer_id\)/);
});
test('Migratsiya bonusni yoqmaydi va yangi mijoz uchun default 0',()=>{
 assert.match(sql,/welcome_points bigint NOT NULL DEFAULT 0/);
 assert.doesNotMatch(sql,/SET enabled\s*=\s*true/i);
 for(const rpc of ['aroma_bonus_welcome_v1','aroma_bonus_reward_top_v1','aroma_bonus_top_customers_v1'])
   assert.match(sql,new RegExp('REVOKE ALL ON FUNCTION public\\.'+rpc));
 for(const id of ['bonusWelcomePoints','bonusTopLimit','bonusTopMinOrders','bonusTopPoints','bonusTopAwardBtn'])
   assert.ok(admin.includes('id="'+id+'"'),id);
});
