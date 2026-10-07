'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),crypto=require('node:crypto');
const {parseRegistration,configurePromotionBot}=require('../lib/promotion-bot.js');
const security=require('../lib/security.js');
test('registration input requires phone and verified purchase amount',()=>{
 assert.deepEqual(parseRegistration('+998901234567 150000 Ali'),{phone:'+998901234567',amount:150000,name:'Ali'});
 assert.equal(parseRegistration('/raqam 901234567 100001 Ali').amount,100001);
 for(const text of ['+998901234567 100000 Ali','wrong 150000','901234567 -1','901234567 150000.5','901234567 Infinity'])assert.equal(parseRegistration(text),null);
});
function fixture(allowed=true,failExcel=false){
 let handler;const calls=[],messages=[];
 const db={from:()=>({select(){return this;},eq(){return this;},async maybeSingle(){return {data:allowed?{telegram_id:'7'}:null};}}),
 rpc:async(name,args)=>{calls.push(args);return {data:{promotion_id:1,participant_number:1001,phone:'+998901234567',new_participant:true}};}};
 configurePromotionBot({on:(event,fn)=>handler=fn},db,async()=>{if(failExcel)throw Error('storage');});
 return {calls,messages,run:(type='private')=>handler({chat:{type},from:{id:7},update:{update_id:55},message:{text:'+998901234567 150000 Ali'},reply:async text=>messages.push(text)})};
}
test('unauthorized users and group chats cannot allocate numbers',async()=>{
 const f=fixture(false);await f.run();assert.equal(f.calls.length,0);assert.match(f.messages[0],/Ruxsat yo‘q/);
 const g=fixture();await g.run('group');assert.equal(g.calls.length,0);
});
test('bot uses sender identity and stable update key; Excel error preserves issued number',async()=>{
 const f=fixture(true,true);await f.run();await f.run();
 assert.equal(f.calls[0].p_admin_id,'7');assert.equal(f.calls[0].p_request_key,f.calls[1].p_request_key);
 assert.match(f.messages[0],/1001/);assert.match(f.messages[0],/bazada saqlandi/);
});
test('new bot webhook has separate secret and requires admin authentication for setup',async()=>{
 const events=[];const env={BOT_TOKEN:'shop',PROMOTION_BOT_TOKEN:'promotion',ADMIN_PASSWORD:'secret',WEB_APP_URL:'https://shop.example'};
 const makeBot=name=>({handleUpdate:async()=>events.push(name),telegram:{setWebhook:async(url,opts)=>events.push({name,url,opts})}});
 const ctx={module:{exports:{}},URL,Buffer,process:{env},console:{error(){}},require:name=>name==='./lib/security.js'?security:{bot:makeBot('shop'),promotionBot:makeBot('promotion'),webServer:{emit(){}}}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../index.js'),'utf8'),ctx);
 const request=async(url,headers={})=>{const res={setHeader(){},end(){}};await ctx.module.exports({url,method:'POST',headers,body:{update_id:5}},res);return res;};
 assert.equal((await request('/api/promotion-telegram',{'x-telegram-bot-api-secret-token':security.telegramWebhookSecret('shop')})).statusCode,403);
 assert.equal(events.length,0);
 assert.equal((await request('/api/promotion-telegram',{'x-telegram-bot-api-secret-token':security.telegramWebhookSecret('promotion')})).statusCode,200);
 assert.equal(events[0],'promotion');
 assert.equal((await request('/api/admin/promotion-bot-webhook')).statusCode,401);
 await request('/api/admin/promotion-bot-webhook',{authorization:'Bearer '+crypto.createHash('sha256').update('secret').digest('hex')});
 assert.equal(events[1].name,'promotion');assert.equal(events[1].url,'https://shop.example/api/promotion-telegram');assert.equal(events[1].opts.secret_token,security.telegramWebhookSecret('promotion'));
});
