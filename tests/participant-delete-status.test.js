'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const src = file => fs.readFileSync(path.join(root,file), 'utf8');
const server = src('lib/server.js');
const html = src('admin.html');
function route(){
  const start = server.indexOf('const promotionParticipantRoute = url.pathname.match(');
  const end = server.indexOf('const gameRoute = url.pathname.match(', start);
  assert.ok(start >= 0 && end > start);
  return vm.runInNewContext(
    '(async ({url,req,isAdmin,supabase,updatePromotionExcel,parseBody}) => {\n' +
    'const res={setHeader(){}}; const sendJson=(status,data)=>({status,data});\n' +
    server.slice(start,end) +
    '\nreturn {status:404};})',
    {console: {error(){},log(){}}, Number, String, JSON, Error}
  );
}
const url = new URL('https://example.org/api/admin/promotion-games/2/participants/3');
const deleted = {deleted:true,deleted_number:3,promotion_id:2};
function input(overrides={}){
  return {url, req:{method:'DELETE',body:{customerId:'offline:998901234567'}},
    isAdmin:true, parseBody:async req=>req.body,
    updatePromotionExcel:async()=>{},
    supabase:{rpc:async()=>({data:deleted,error:null})},...overrides};
}
test('server: aniq o‘chirilganlik tasdiqlanganda 200', async()=>{
  let updated=false;
  const r=await route()(input({updatePromotionExcel:async()=>{updated=true;}}));
  assert.equal(r.status,200);assert.equal(r.data.success,true);assert.equal(r.data.deletedNumber,3);
  assert.equal(updated,true);
});
test('server: data null yoki boshqa raqamda bo‘lsa 200 deb xabar bermaydi',async()=>{
  for(const wrong of [null,{deleted:false},{deleted:true},{deleted:true,deleted_number:4,promotion_id:2},{deleted:true,deleted_number:3,promotion_id:4}]){
    let excel=false;
    const r=await route()(input({supabase:{rpc:async()=>({data:wrong,error:null})},updatePromotionExcel:async()=>{excel=true;}}));
    assert.equal(r.status,502);assert.equal(r.data.success,false);assert.equal(excel,false);
  }
});
test('server: SQL o‘rnatilmagan bo‘lsa foydali xabar',async()=>{
  const r=await route()(input({supabase:{rpc:async()=>({error:{code:'PGRST202'}})}}));
  assert.equal(r.status,503);assert.match(r.data.message,/SQL Editor/);
});
test('server: eski ro‘yxat xatosi 409 bo‘ladi',async()=>{
  const r=await route()(input({supabase:{rpc:async()=>({error:{code:'P0001',message:'Ro‘yxat o‘zgargan'}})}}));
  assert.equal(r.status,409);
});
function deleteUI(options={}){
  const start=html.indexOf('async function deletePromotionParticipant(');
  const end=html.indexOf('async function downloadGameExcel(id) {',start);
  assert.ok(start>0 && end>start);
  const messages = {textContent:'',style:{}};
  const ctx={
    document:{getElementById(id){assert.equal(id,'gameParticipantsFeedback');return messages;}},
    selectedGameId:'2', confirm:()=>true, Number, JSON, Error,
    promotionGameLabelForId:()=> 'Bahor aksiyasi',
    gameFetch:async()=>({json:async()=>({success:true,deletedNumber:3,message:'3-raqam o‘chirildi.'})}),
    loadGameParticipants:async()=>({participants:[],total:0}),
    ...options
  };
  vm.runInNewContext(html.slice(start,end),ctx);
  return {del:ctx.deletePromotionParticipant,messages};
}
const p={participant_number:3,customer_id:'offline:998901234567',customer_name:'Hasan'};
test('admin: muvaffaqiyatli o‘chirilganda ichki panelda xabar ko‘rinadi',async()=>{
  const {del,messages}=deleteUI();
  await del(2,p,1,1);
  assert.match(messages.textContent,/3-raqam o‘chirildi/);
});
test('admin: noto‘g‘ri server javobida o‘chirildi demaydi',async()=>{
  const {del,messages}=deleteUI({gameFetch:async()=>({json:async()=>({success:true})})});
  await del(2,p,1,1);
  assert.match(messages.textContent,/tasdiqlamadi/);assert.match(messages.style.color,/#b42318/);
});
test('admin: o‘chirish xatosini ishtirokchilar panelida ko‘rsatadi',async()=>{
  const {del,messages}=deleteUI({gameFetch:async()=>{throw new Error('Supabase SQL funksiyasi topilmadi');}});
  await del(2,p,1,1);
  assert.match(messages.textContent,/SQL funksiyasi topilmadi/);
});
test('admin: qayta yuklashda eski ishtirokchi qolsa ogohlantiradi',async()=>{
  const {del,messages}=deleteUI({loadGameParticipants:async()=>({participants:[p]})});
  await del(2,p,1,1);
  assert.match(messages.textContent,/ro‘yxatda hali bor/);
});
test('admin: xabar panel ichida joylashgan va kodni qayta yozmasdan yuklash mumkin',()=>{
  assert.match(html,/id="gameParticipantsFeedback"/);
  assert.match(src('patch-ishtirokchi-ochirish-xabar.py'),/DELETE_STATUS_V2/);
});
