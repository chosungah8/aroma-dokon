'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
test('minimum update validates amounts and changes only the selected game threshold',async()=>{
 const s=fs.readFileSync(path.join(__dirname,'../lib/server.js'),'utf8');
 const start=s.indexOf("        if (id && action === 'minimum-purchase'");
 const code=s.slice(start,s.indexOf("        if (!id && req.method === 'GET')",start));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('id','action','req','parseBody','sendJson','supabase',code);
 const writes=[];
 const db={from(table){return {
   update(patch){writes.push({table,patch});return this;},
   eq(key,id){writes.at(-1).id=id;return this;},
   select(){return this;},
   async maybeSingle(){return {data:{id:'7'}};}
 };}};
 for(const amount of [-1,1.5,'100000',null,Infinity,1000000000001]) {
  const r=await run('7','minimum-purchase',{method:'PATCH'},async()=>({minPurchaseAmount:amount}),(status,body)=>({status,body}),db);
  assert.equal(r.status,400);
 }
 assert.equal(writes.length,0);
 for(const amount of [0,100000]) {
  const r=await run('7','minimum-purchase',{method:'PATCH'},async()=>({minPurchaseAmount:amount}),(status,body)=>({status,body}),db);
  assert.equal(r.status,200);assert.deepEqual(writes.at(-1),{table:'promotion_settings',patch:{min_purchase_amount:amount},id:'7'});
 }
});
