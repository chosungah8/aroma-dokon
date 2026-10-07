'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../lib/server.js'),'utf8');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const start=source.indexOf('// BUYURTMANI ARXIVLASH / TIKLASH');
const run=new AsyncFunction('url','req','isAdmin','supabase','sendJson','console',source.slice(start,source.indexOf('// KUPONNI TEKSHIRISH',start)));
function fixture(found=true){const writes=[];return {writes,from(table){assert.equal(table,'orders');return {select(){return this},eq(key,id){assert.equal(key,'id');assert.equal(id,'AR-1001');return this},async maybeSingle(){return {data:found?{id:'AR-1001'}:null}},update(patch){writes.push(patch);return this},then(resolve){resolve({error:null})},delete(){assert.fail('Order rows must be preserved')}}}};}
const url=new URL('https://example.test/api/admin/orders/AR-1001');
const sendJson=(status,body)=>({status,body});
test('archive and restore preserve order rows; anonymous calls cannot write',async()=>{
 for(const method of ['DELETE','PATCH']){
  const db=fixture();let r=await run(url,{method},false,db,sendJson,console);assert.equal(r.status,401);assert.equal(db.writes.length,0);
  r=await run(url,{method},true,db,sendJson,console);assert.equal(r.status,200);assert.deepEqual(db.writes,[{archived:method==='DELETE'}]);
 }
 const db=fixture(false);assert.equal((await run(url,{method:'DELETE'},true,db,sendJson,console)).status,404);assert.equal(db.writes.length,0);
});
test('admin lists select active or archived orders explicitly',async()=>{
 const begin=source.indexOf('// BUYURTMALARNI OLISH');
 const list=new AsyncFunction('url','req','isAdmin','supabase','sendJson','console',source.slice(begin,source.indexOf('// BUYURTMA STATUSINI',begin)>0?source.indexOf('// BUYURTMA STATUSINI',begin):source.indexOf("if (\n    url.pathname.startsWith('/api/admin/orders/')",begin)));
 for(const archived of [false,true]){
  const filters=[];const db={from(){return this},select(){return this},eq(k,v){filters.push([k,v]);return this},async order(){return {data:[]}}};
  const r=await list(new URL('https://example.test/api/admin/orders'+(archived?'?archived=1':'')),{method:'GET'},true,db,sendJson,console);
  assert.equal(r.status,200);assert.deepEqual(filters,[['archived',archived]]);
 }
});

test('archive button belongs to order cards only',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../admin.html'),'utf8');
 const marker="${order.archived ? '↩️ Tiklash' : '🗃 Arxivlash'}";
 assert.equal(html.split(marker).length,2);
 assert.ok(html.indexOf(marker)>html.indexOf('filteredOrders.forEach(order =>'));
 assert.match(html,/data-delete-order\s*>\s*\$\{order.archived/);
});
