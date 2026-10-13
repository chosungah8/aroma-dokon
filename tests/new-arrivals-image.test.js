'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {validateNewArrivalsImageUrl} = require('../lib/new-arrivals-image.js');
const root = path.join(__dirname,'..');
const src = fs.readFileSync(path.join(root, 'lib/server.js'),'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'),'utf8');
const admin = fs.readFileSync(path.join(root, 'admin.html'),'utf8');
const sql = fs.readFileSync(path.join(root, 'sql/aroma-yangi-mahsulotlar-rasmi.sql'),'utf8');
const base = 'https://example.supabase.co';
const filename = '8f0aa310-7c0b-4aca-b20c-1d310f928c22.webp';
const image = base+'/storage/v1/object/public/product-images/products/'+filename;

test('only uploaded images from same Supabase origin are saved; reset works', () => {
  assert.equal(validateNewArrivalsImageUrl(image,base), image);
  assert.equal(validateNewArrivalsImageUrl('',base),'');
  const invalid = [null,1,{}, 'javascript:alert(1)',
    'https://evil.com/storage/v1/object/public/product-images/products/'+filename,
    'http://example.supabase.co/storage/v1/object/public/product-images/products/'+filename,
    image+'?redirect=evil',image+'#fragment',image.replace('/products/','/requests/'),
    image.replace('.webp','.svg'), image.replace(filename,'img.webp'),
    image.replace('/storage/','/st0rage/')];
  for (const bad of invalid) assert.throws(()=>validateNewArrivalsImageUrl(bad,base),{status:400});
});

test('SQL is idempotent and does not alter categories or products',()=>{
  assert.match(sql,/ALTER TABLE public\.shop_settings/);
  assert.match(sql,/ADD COLUMN IF NOT EXISTS new_arrivals_image text/);
  assert.doesNotMatch(sql, /\bDELETE\b|\bDROP\b/i);
});

test('customer card stays first; has saved picture and emoji fallback; time window stays 7 days',()=>{
  assert.match(index,/const NEW_ARRIVALS_WINDOW_MS = 7 \* 24 \* 60 \* 60 \* 1000/);
  const virtualCard=index.slice(index.indexOf('// Bu maxsus karta doim birinchi turadi'),index.indexOf('mainCategories.forEach(mainCategory =>'));
  assert.match(virtualCard, /newArrivalsCategoryPicture\(\)/);
  const helper=index.slice(index.indexOf("const NEW_ARRIVALS_CATEGORY ="),index.indexOf('function loadProducts()'));
  const ctx=vm.createContext({});
  vm.runInContext(helper,ctx);
  assert.match(vm.runInContext('newArrivalsCategoryPicture()',ctx), /🆕/);
  ctx.testImage=image;
  vm.runInContext('newArrivalsImage = testImage',ctx);
  assert.match(vm.runInContext('newArrivalsCategoryPicture()',ctx), new RegExp(filename.replaceAll('.','\\.')));
  assert.match(vm.runInContext('newArrivalsCategoryPicture()',ctx),/onerror=.*nextElementSibling/);
  ctx.testImage='https://foo.com/" onload="alert(1)';
  vm.runInContext('newArrivalsImage = testImage',ctx);
  assert.doesNotMatch(vm.runInContext('newArrivalsCategoryPicture()',ctx),/" onload="alert/);
  assert.match(index,/loadNewArrivalsImage\(\);[\s\S]*loadProducts\(\);/);
});

test('admin form has file upload, remove action and feedback; no real category id',()=>{
  assert.match(admin,/onchange="changeNewArrivalsImage\(this\)"/);
  assert.match(admin,/onclick="clearNewArrivalsImage\(\)"/);
  assert.match(admin,/id="newArrivalsImagePreview"/);
  assert.match(admin,/id="newArrivalsImageStatus"/);
  assert.match(admin,/fetch\('\/api\/admin\/new-arrivals-image'/);
  assert.match(admin,/fetch\('\/api\/admin\/upload-image'/);
  assert.match(admin,/renderNewArrivalsImageControl\(list\)/);
});

const block=src.slice(src.indexOf('// MAXSUS "YANGI MAHSULOTLAR"'),src.indexOf('// PUBLIC DAVLATLARNI OLISH'));
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const handler=new AsyncFunction('url','req','res','supabase','isAdmin','sendJson','readLimitedJson','process','require','console',block);
function db(initialRow={id:1,new_arrivals_image:''}){
 const calls=[];
 let row=initialRow;
 const supabase={from(table){assert.equal(table,'shop_settings');return {
  select(cols){calls.push(['select',cols]);return {order(col){return {limit(n){return {async maybeSingle(){return {data:row,error:null};}};}};}};},
  update(changes){calls.push(['update',changes]); return {async eq(col,id){assert.equal(col,'id');assert.equal(id,row.id);row={...row,...changes};return {error:null};}};},
  async insert(changes){calls.push(['insert',changes]);row={id:1,...changes};return {error:null};}
 };}};
 return {supabase,calls,get row(){return row}};
}
async function send(route,method,authenticated,body,data=db()){
 const headers={};
 const result=await handler(new URL('https://shop.test'+route),{method,body},
  {setHeader(k,v){headers[k]=v}},data.supabase,authenticated,(status,body)=>({status,body}),
  async(req,limit)=>{assert.equal(limit,4096);return req.body},
  {env:{SUPABASE_URL:base}},()=>({validateNewArrivalsImageUrl}),{error(){}});
 return {result,headers,data};
}
test('public image fetch requires no admin and exposes only image',async()=>{
 const d=db({id:1,new_arrivals_image:image,free_delivery_enabled:true});
 const {result,headers}=await send('/api/new-arrivals-image','GET',false,undefined,d);
 assert.equal(result.status,200);assert.deepEqual(result.body,{success:true,image});
 assert.equal(headers['Cache-Control'],'no-store');
});
test('unauthenticated change is forbidden; valid admin upload changes only image',async()=>{
 const d=db({id:1,new_arrivals_image:'',free_delivery_enabled:true,free_delivery_min_amount:50000});
 assert.equal((await send('/api/admin/new-arrivals-image','PUT',false,{image},d)).result.status,401);
 assert.deepEqual(d.calls,[]);
 const {result}=await send('/api/admin/new-arrivals-image','PUT',true,{image},d);
 assert.equal(result.status,200);assert.equal(result.body.image,image);
 assert.equal(d.row.free_delivery_enabled,true);assert.equal(d.row.free_delivery_min_amount,50000);
 const rejected=await send('/api/admin/new-arrivals-image','PUT',true,{image:'https://bad.test/a.jpg'},d);
 assert.equal(rejected.result.status,400);assert.equal(d.row.new_arrivals_image,image);
 const cleared=await send('/api/admin/new-arrivals-image','PUT',true,{image:''},d);
 assert.equal(cleared.result.status,200);assert.equal(d.row.new_arrivals_image,'');
});
test('first image save creates default shop settings without disabling new features',async()=>{
 const d=db(null);
 const {result}=await send('/api/admin/new-arrivals-image','PUT',true,{image},d);
 assert.equal(result.status,200); assert.equal(d.row.free_delivery_enabled,false);
 assert.equal(d.row.free_delivery_min_amount,0);
});
