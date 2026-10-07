'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {readLimitedJson,decodeRequestImage,validatedProductRequest,uploadImage}=require('../lib/product-requests.js');
const origin='https://example.supabase.co';
const image=origin+'/storage/v1/object/public/product-images/requests/123/12345678-1234-4123-8123-123456789abc.png';
const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
test('request identity comes from verified user; external and other-user images are rejected',()=>{
 const row=validatedProductRequest({text:'Test',imageUrl:image,telegramUserId:999,customerName:'Spoof'}, {id:123,first_name:'Real'},origin);
 assert.equal(row.customer_id,'123');assert.equal(row.customer_name,'Real');
 for(const imageUrl of [image.replace('/123/','/999/'),image.replace(origin,'https://evil.test'),image+'?x=1','javascript:alert(1)']) assert.throws(()=>validatedProductRequest({imageUrl},{id:123},origin));
 assert.throws(()=>validatedProductRequest({text:'x'.repeat(2001)},{id:123},origin));
 assert.throws(()=>validatedProductRequest({},{id:123},origin));
});
test('uploads validate base64, declared format, file signature and byte limit',()=>{
 assert.equal(decodeRequestImage(png).ext,'png');
 for(const input of [null,png.replace('image/png','image/jpeg'),'data:image/svg+xml;base64,PHN2Zz4=','data:image/png;base64,PGh0bWw+','data:image/png;base64,@@@','data:image/png;base64,'+'A'.repeat(4*1024*1024+100)]) assert.throws(()=>decodeRequestImage(input));
});
test('JSON reader bounds pre-parsed and streamed bodies and rejects malformed JSON',async()=>{
 assert.deepEqual(await readLimitedJson({body:{text:'hello'}},100),{text:'hello'});
 for(const body of ['{','[]','null','x'.repeat(101)]) await assert.rejects(readLimitedJson({body},100));
 await assert.rejects(readLimitedJson({async *[Symbol.asyncIterator](){yield Buffer.alloc(101);}},100));
});
test('image writes use a random customer-owned storage path and verified MIME',async()=>{
 let stored;
 const db={storage:{from:()=>({upload:async(name,bytes,opts)=>{stored={name,bytes,opts};return {};},getPublicUrl:name=>({data:{publicUrl:origin+'/'+name}})})}};
 await uploadImage(db,{image:png},123);
 assert.match(stored.name,/^requests\/123\/[0-9a-f-]{36}\.png$/);assert.equal(stored.opts.contentType,'image/png');assert.equal(stored.opts.upsert,false);
});
test('actual request/upload routes reject anonymous callers before reading or writing',async()=>{
 const source=fs.readFileSync(path.join(__dirname,'../lib/server.js'),'utf8');
 const code=source.slice(source.indexOf('// Authenticate before reading upload'),source.indexOf('// MIJOZNING BUYURTMALAR TARIXI'));
 const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
 const run=new AsyncFunction('req','res','url','isAdmin','verifiedMiniAppUser','BOT_TOKEN','sendJson','readLimitedJson','saveProductRequest','uploadImage','supabase',code);
 for(const endpoint of ['/api/upload-request-image','/api/product-requests','/api/admin/upload-image']){
  let reads=0,writes=0;
  const result=await run({method:'POST',headers:{}},{setHeader(){}},{pathname:endpoint},false,()=>null,'token',(status,data)=>({status,data}),async()=>{reads++;},async()=>{writes++;},async()=>{writes++;},{});
  assert.equal(result.status,401);assert.equal(reads,0);assert.equal(writes,0);
 }
 let owner;
 const ok=await run({method:'POST',headers:{}},{setHeader(){}},{pathname:'/api/upload-request-image'},false,()=>({id:123}),'token',(status,data)=>({status,data}),async()=>({image:png}),async()=>{},async(db,data,id)=>{owner=id;return image;},{});
 assert.equal(ok.status,200);assert.equal(owner,123);
 const admin=await run({method:'POST',headers:{}},{setHeader(){}},{pathname:'/api/admin/upload-image'},true,()=>null,'token',(status,data)=>({status,data}),async()=>({image:png}),async()=>{},async(db,data,id)=>{owner=id;return image;},{});
 assert.equal(admin.status,200);assert.equal(owner,null);
});
