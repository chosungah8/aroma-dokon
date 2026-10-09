'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname,'..');
const src = p => fs.readFileSync(path.join(root,p),'utf8');
const sql = src('supabase-ishtirokchi-raqamini-boshatish.sql');
const server = src('lib/server.js');
const html = src('admin.html');
const bot = require('../lib/promotion-bot.js');
const marker = '// AROMA_PROMOTION_PARTICIPANT_REUSE_V1';
function route(){
  const a = server.indexOf(marker);
  const b = server.indexOf('const gameRoute = url.pathname.match(',a);
  assert.ok(a>0 && b>a,'server route mavjud');
  return vm.runInNewContext('(async ({url,req,isAdmin,supabase,updatePromotionExcel, parseBody}) => {\n'+
    "const res={setHeader(){}}; const sendJson=(status,data)=>({status,data});\n"+
    server.slice(a,b)+
    "return {status:404};})", {console:{...console,error(){}},Number,String,JSON,Error});
}
const url = new URL('https://example.org/api/admin/promotion-games/2/participants/3');
function input(opts={}){ return {url,req:{method:'DELETE',body:{customerId:'offline:998901234567'}},isAdmin:true,parseBody:async req=>req.body,updatePromotionExcel:async()=>{},supabase:{rpc:async()=>({data:{deleted:true},error:null})},...opts}; }
test('admin bo‘lmasa DELETE qilinmaydi',async()=>{
 let called=false;
 const r=await route()(input({isAdmin:false,supabase:{rpc:async()=>{called=true;return {}}}}));
 assert.equal(r.status,401);assert.equal(called,false);
});
test('DELETE o‘rniga boshqa method rad etiladi',async()=>{
 const r=await route()(input({req:{method:'POST',body:{customerId:'x'}}})); assert.equal(r.status,405);
});
test('maqsad ishtirokchi ID va raqami tasdiqlanadi',async()=>{
 let params, excel;
 const r=await route()(input({
  supabase:{rpc:async(name,arg)=>{assert.equal(name,'aroma_delete_promotion_participant_v1');params=arg;return {data:{deleted:true},error:null};}},
  updatePromotionExcel:async id=>{excel=id;}
 }));
 assert.equal(r.status,200);assert.equal(params.p_promotion_id,2);
 assert.equal(params.p_participant_number,3);
 assert.equal(params.p_expected_customer_id,'offline:998901234567');assert.equal(excel,2);
 assert.match(r.data.message,/Boshqa ishtirokchilarning raqami saqlandi/);
});
test('eski ro‘yxat bilan o‘chirish 409 qaytaradi',async()=>{
 const r=await route()(input({supabase:{rpc:async()=>({error:{code:'P0001',message:'Ro‘yxat o‘zgargan'}})}}));
 assert.equal(r.status,409);
});
test('Excel yangilanishi muvaffaqiyatsiz bo‘lsa ham o‘chirish tasdiqlanadi',async()=>{
 const r=await route()(input({updatePromotionExcel:async()=>{throw Error('storage down')}}));
 assert.equal(r.status,200);assert.match(r.data.warning,/Excel/);
});
test('admin jadvalida o‘chirish tugmasi va old raqamlarni saqlash izohi bor',()=>{
 assert.match(html,/deletePromotionParticipant\(id, p, page, result.total\)/);
 assert.match(html,/Qolgan ishtirokchilarning raqamlari o‘zgarmaydi/);
 assert.match(server,/\.select\('participant_number, customer_id, phone/);
});
test('aksiya botida o‘chirilgan so‘rov eski raqamni tasdiqlamaydi', async()=>{
 let handler,reply='';
 const db={from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:{telegram_id:'123'}}}}},rpc:async()=>({data:{deleted:true,participant_number:null}})};
 bot.configurePromotionBot({on:(_,fn)=>handler=fn},db,async()=>{throw Error('should not export')});
 await handler({from:{id:123},chat:{type:'private'},update:{update_id:4},message:{text:'+998901234567 150000 Ali'},reply:async msg=>reply=msg});
 assert.match(reply,/o‘chirilgan/);assert.doesNotMatch(reply,/Ishtirokchi raqami: null/);
});
test('ikkala onlayn va oflayn ajratish funksiyasi SQL’da yangilanadi',()=>{
 assert.match(sql,/public\.aroma_place_order_v1\(text,text,text,text,text,jsonb,text,text\)/);
 assert.match(sql,/public\.aroma_register_offline_v1\(text,text,text,numeric,text\)/);
 assert.match(sql,/regexp_replace\(v_sql, v_pattern/);
 assert.match(sql,/v_game\.min_number, v_game\.max_number/);
 assert.match(sql,/WHERE.*participant_number = p_participant_number/s);
 assert.doesNotMatch(sql,/UPDATE public\.promotion_participants\s+SET participant_number/i);
});
test('bo‘sh raqam ustuvorligi: 1,2,4,5 dan keyingi = 3; to‘la ro‘yxatdan keyin 6',()=>{
  // SQL helperdagi uch bosqich: p_min bo‘sh, keyingi raqamda bo‘shliq, oxirgi+1.
  function model(values,min,max){
    const s=new Set(values);
    if(!s.has(min))return min;
    for(const n of [...s].filter(n=>n>=min&&n<max).sort((a,b)=>a-b))if(!s.has(n+1))return n+1;
    return Math.max(min-1,...[...s].filter(n=>n>=min&&n<=max))+1;
  }
  assert.equal(model([1,2,4,5],1,10),3);
  assert.equal(model([1,2,3,4,5],1,10),6);
  assert.equal(model([3,4],1,10),1);
  assert.equal(model([500,501,503],500,510),502);
  assert.equal(model([1,2,3],1,3),4); // MAX chegarasidan oshsa caller rad etadi
  assert.match(sql,/NOT EXISTS/);
  assert.match(sql,/ORDER BY a\.participant_number LIMIT 1/);
});
