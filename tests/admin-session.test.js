'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
const {createAdminToken,adminTokenIsValid,safeEqual}=require('../lib/security.js');
const {readLimitedJson}=require('../lib/product-requests.js');
test('admin sessions expire after eight hours and reject legacy, altered and rotated credentials',()=>{
 const now=1700000000, token=createAdminToken('password','bot-secret',now);
 assert.equal(adminTokenIsValid(token,'password','bot-secret',now),true);
 assert.equal(adminTokenIsValid(token,'password','bot-secret',now+28799),true);
 assert.equal(adminTokenIsValid(token,'password','bot-secret',now+28800),false);
 assert.equal(adminTokenIsValid(token,'password','bot-secret',now-1),false);
 assert.equal(adminTokenIsValid(token,'new-password','bot-secret',now),false);
 assert.equal(adminTokenIsValid(token,'password','new-secret',now),false);
 assert.equal(adminTokenIsValid(token,'password','',now),false);
 assert.equal(adminTokenIsValid(token,'','bot-secret',now),false);
 assert.notEqual(token,createAdminToken('password','bot-secret',now));
 for(const bad of [null,[],{},'x'.repeat(1000),crypto.createHash('sha256').update('password').digest('hex'),token+'a',token.replace('a1.','a2.')])assert.equal(adminTokenIsValid(bad,'password','bot-secret',now),false);
 const parts=token.split('.');const payload=JSON.parse(Buffer.from(parts[1],'base64url'));payload.exp+=86400;parts[1]=Buffer.from(JSON.stringify(payload)).toString('base64url');
 assert.equal(adminTokenIsValid(parts.join('.'),'password','bot-secret',now),false);
});
const src=fs.readFileSync(path.join(__dirname,'../lib/server.js'),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('url','req','res','supabase','ADMIN_PASSWORD','BOT_TOKEN','sendJson','readLimitedJson','safeEqual','createAdminToken',src.slice(src.indexOf('    // ADMIN LOGIN'),src.indexOf('    // ADMIN AUTH')));
async function login(body,dbResult={data:{allowed:true}},password='password'){
 const headers={},calls=[];const result=await run(new URL('https://example.test/api/admin/login'),{method:'POST',body},{setHeader(k,v){headers[k]=v}},
 {async rpc(name){calls.push(name);return dbResult}},password,'bot-secret',(status,body)=>({status,body}),readLimitedJson,safeEqual,createAdminToken);
 return {result,headers,calls};
}
test('login issues signed session only with correct password and successful shared limiter',async()=>{
 const ok=await login({password:'password'});assert.equal(ok.result.status,200);assert.equal(adminTokenIsValid(ok.result.body.token,'password','bot-secret'),true);
 assert.deepEqual(ok.calls,['aroma_admin_login_attempt_v1']);assert.equal(ok.headers['Cache-Control'],'no-store');
 for(const password of ['wrong',null,{},['password']])assert.equal((await login({password})).result.status,401);
 const absent=await login({password:''},undefined,'');assert.equal(absent.result.status,503);assert.equal(absent.calls.length,0);
 for(const db of [{error:{message:'private database details'}},{data:null},{data:{}}]){
  const r=await login({password:'password'},db);assert.equal(r.result.status,503);assert.equal(JSON.stringify(r.result).includes('private database'),false);
 }
});
test('login blocks rate-limited attempts before password parsing and bounds input size',async()=>{
 const blocked=await login('bad json',{data:{allowed:false,retry_after:123}});
 assert.equal(blocked.result.status,429);assert.equal(blocked.headers['Retry-After'],'123');assert.match(blocked.result.body.message,/123/);
 assert.equal((await login('bad json')).result.status,400);
 assert.equal((await login({password:'x'.repeat(5000)})).result.status,413);
});
