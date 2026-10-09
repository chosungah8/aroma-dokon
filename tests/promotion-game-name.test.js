'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {normalizePromotionGameName, displayPromotionGameName} = require('../lib/promotion-game-name.js');
const {configurePromotionBot} = require('../lib/promotion-bot.js');
const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');
function gameRoute() {
  const s=read('lib/server.js');
  const from=s.indexOf('const gameRoute = url.pathname.match(');
  const to=s.indexOf('// AKSIYA SOZLAMASINI OLISH',from);
  assert.ok(from>-1 && to>from);
  return vm.runInNewContext('(async ({req, url, supabase, isAdmin})=>{'+
    'const res={setHeader(){}};'+
    'const parseBody=async req=>req.body;'+
    'const sendJson=(status,data)=>({status,data});'+
    s.slice(from,to)+
    'return {status:404}; })',{Date,Number,URL,console,Error,normalizePromotionGameName});
}
function createRoute() {
  const s=read('lib/server.js');
  const from=s.indexOf("if (url.pathname === '/api/admin/promotion-settings' && req.method === 'PUT')");
  const to=s.indexOf('// PUBLIC BEPUL YETKAZIB BERISH',from);
  assert.ok(from>-1 && to>from);
  return vm.runInNewContext('(async ({req, url, supabase, isAdmin,createPromotionExcel})=>{'+
    'const parseBody=async req=>req.body;'+
    'const sendJson=(status,data)=>({status,data});'+
    s.slice(from,to)+
    'return {status:404}; })',{Date,Number,URL,console,Error,normalizePromotionGameName});
}
function gameURL(path='/api/admin/promotion-games/17/name') {return new URL(path,'https://example.org');}
function mockGameDb(data={id:17,name:'Kuzgi sovg‘alar'}) {
  const updates=[];
  const db={from(table){assert.equal(table,'promotion_settings');return {
    update(value){updates.push(value);return this;},eq(key,val){assert.equal(key,'id');assert.equal(val,'17');return this;},
    select(){return this;},async maybeSingle(){return {data,error:null}}};}};
  return {db,updates};
}
test('names are trimmed, bounded and cannot contain control characters',()=>{
  assert.equal(normalizePromotionGameName('  Kuzgi o‘yin  '),'Kuzgi o‘yin');
  for (const val of ['', '   ', null,42,'a'.repeat(101),'A\nB','A\u0000B']) assert.equal(normalizePromotionGameName(val),null);
  assert.equal(displayPromotionGameName(null),'Nomsiz aksiya');
});
test('rename requires an admin and does not touch updated_at or IDs',async()=>{
  const route=gameRoute();
  const {db,updates}=mockGameDb();
  const req={method:'PATCH',body:{name:'  Kuzgi sovg‘alar  '}};
  const denied=await route({req,url:gameURL(),supabase:db,isAdmin:false});
  assert.equal(denied.status,401); assert.equal(updates.length,0);
  const result=await route({req,url:gameURL(),supabase:db,isAdmin:true});
  assert.equal(result.status,200); assert.equal(result.data.game.name,'Kuzgi sovg‘alar');
  assert.equal(JSON.stringify(updates),JSON.stringify([{name:'Kuzgi sovg‘alar'}]));
});
test('invalid name is rejected without a database write',async()=>{
  const {db,updates}=mockGameDb();
  const result=await gameRoute()({req:{method:'PATCH',body:{name:'\n'}},url:gameURL(),supabase:db,isAdmin:true});
  assert.equal(result.status,400);assert.equal(updates.length,0);
});
test('editing a deleted promotion returns 404',async()=>{
  const {db}=mockGameDb(null);
  const result=await gameRoute()({req:{method:'PATCH',body:{name:'Yangi nom'}},url:gameURL(),supabase:db,isAdmin:true});
  assert.equal(result.status,404);
});
test('create promotion requires and saves the user-provided name',async()=>{
  const route=createRoute();let inserted=null,excelMade=0;
  const db={from(table){assert.equal(table,'promotion_settings');return {
    insert(value){inserted=value;return this;},
    select(){return this;},
    async single(){return {data:{...inserted,id:123,created_at:'2026-10-10T00:00:00Z'},error:null}},
    update(value){return {eq:async()=>({error:null})}}
  }}};
  const base={method:'PUT',body:{name:'Bahor sovg‘alari',enabled:true,minPurchaseAmount:100000,minNumber:1000,maxNumber:2000}};
  const unauthorized=await route({req:base,url:gameURL('/api/admin/promotion-settings'),supabase:db,isAdmin:false});
  assert.equal(unauthorized.status,401);
  const invalid=await route({req:{...base,body:{...base.body,name:''}},url:gameURL('/api/admin/promotion-settings'),supabase:db,isAdmin:true});
  assert.equal(invalid.status,400);assert.equal(inserted,null);
  const result=await route({req:base,url:gameURL('/api/admin/promotion-settings'),supabase:db,isAdmin:true,
    createPromotionExcel:async()=>{excelMade++;return 'safe.xlsx';}});
  assert.equal(result.status,200); assert.equal(inserted.name,'Bahor sovg‘alari');
  assert.equal(excelMade,1);assert.equal(result.data.settings.name,'Bahor sovg‘alari');
});
test('promotion bot announces the stored promotion name instead of internal id',async()=>{
  let handler, message;
  const db={from(table){return {
    select(){return this;},eq(){return this;},
    async maybeSingle(){return {data:table==='promotion_bot_admins'?{telegram_id:'7',active:true}:{name:'Kuzgi omad o‘yini'}};}
  };},async rpc(){return {data:{promotion_id:17,participant_number:1001,phone:'+998901234567',new_participant:true}};}};
  configurePromotionBot({on:(_,cb)=>handler=cb},db,async()=>{});
  await handler({chat:{type:'private'},from:{id:7},update:{update_id:3},message:{text:'+998901234567 150000 Ali'},reply:async text=>message=text});
  assert.match(message,/Kuzgi omad o‘yini/);assert.match(message,/1001/);
  assert.doesNotMatch(message,/Aksiya #17/);
});
test('admin page has both new game name and an editable list name',()=>{
  const html=read('admin.html');
  assert.match(html,/id="promotionGameName"/);
  assert.match(html,/savePromotionGameName\(game.id, nameInput.value\)/);
  assert.match(html,/promotionGameLabel\(game\)/);
  assert.doesNotMatch(html,/`Aksiya #\$\{game.id\}/);
});
