'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');
const vm=require('node:vm');
const root=path.resolve(__dirname,'..');
const backend=fs.readFileSync(path.join(root,'lib/server.js'),'utf8');
const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');

const beginning=backend.indexOf('const promotionAdminRoute = url.pathname.match');
const ending=backend.indexOf('    // MAHSULOTLARNI OLISH',beginning);
assert.ok(beginning>-1 && ending>beginning,'Aksiya admin route topilmadi');
const AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const run=new AsyncFunction('url','req','res','supabase','isAdmin','readLimitedJson','sendJson','promotionBot',backend.slice(beginning,ending));

async function api(method,id,body,authorized=true,exists=true) {
 const operations={updates:[],eqs:[],selects:[],queries:[]};
 const query={
  update(record){operations.updates.push(record);return this;},
  eq(field,value){operations.eqs.push([field,value]);return this;},
  select(fields){operations.selects.push(fields);return this;},
  async maybeSingle(){return {data:exists?{telegram_id:id}:null,error:null};},
 };
 const db={from(table){operations.queries.push(table);return query;}};
 const res={headers:{},setHeader(k,v){this.headers[k]=v;}};
 const result=await run(new URL('https://example.test/api/admin/promotion-bot-admins/'+id),{method,body},res,db,authorized,async(req)=>req.body,(status,json)=>({status,json}),{});
 return {result,operations,res};
}
test('admin rename requires the protected admin session',async()=>{
 const r=await api('PATCH','123',{label:'Ali'},false);
 assert.equal(r.result.status,401);
 assert.equal(r.operations.updates.length,0);
});
test('admin rename only updates label of the exact active account',async()=>{
 const r=await api('PATCH','123',{label:'  Yangi ism  '});
 assert.deepEqual(r.result,{status:200,json:{success:true,message:'Admin ismi yangilandi.'}});
 assert.deepEqual(r.operations.updates,[{label:'Yangi ism'}]);
 assert.deepEqual(r.operations.eqs,[['telegram_id','123'],['active',true]]);
 assert.deepEqual(r.operations.selects,['telegram_id']);
 assert.equal(r.operations.queries[0],'promotion_bot_admins');
 assert.equal(r.res.headers['Cache-Control'],'no-store');
});
test('blank/invalid name cannot be saved and no reactivation occurs',async()=>{
 for(const label of ['','  ', '\n', 'a'.repeat(101), '\0hi',13,null,undefined]){
  const r=await api('PATCH','123',{label});
  assert.equal(r.result.status,400);
  assert.equal(r.operations.updates.length,0);
 }
});
test('missing or revoked admin is not created by rename',async()=>{
 const r=await api('PATCH','123',{label:'Ali'},true,false);
 assert.equal(r.result.status,404);
 assert.deepEqual(r.operations.updates,[{label:'Ali'}]);
 assert.equal(r.operations.eqs[1][0],'active');
});
test('non-PATCH method cannot rename',async()=>{
 const r=await api('PUT','123',{label:'Ali'});
 assert.equal(r.result.status,405);
 assert.equal(r.operations.updates.length,0);
});

class Element {
 constructor(tag){this.tagName=tag;this.children=[];this.style={};this.textContent='';this.value='';this.disabled=false;this.attrs={};}
 append(...items){this.children.push(...items);}
 replaceChildren(...items){this.children=[...items];}
 setAttribute(key,value){this.attrs[key]=value;}
 focus(){this.focused=true;}
}
const scriptStart=html.indexOf('async function promotionBotApi(');
const scriptEnd=html.indexOf('async function setupPromotionBot(',scriptStart);
assert.ok(scriptStart>-1 && scriptEnd>scriptStart,'Adminlar interfeysi topilmadi');
const frontend=html.slice(scriptStart,scriptEnd);
function ui(){
 const elements={promotionBotMessage:new Element('p'),promotionBotAdmins:new Element('div'),promotionBotAdminId:new Element('input'),promotionBotAdminLabel:new Element('input')};
 let admins=[{telegram_id:'123',label:'Eski ism',active:true},{telegram_id:'456',label:'Yopiq',active:false}];
 const calls=[];
 const context={adminToken:'session',document:{createElement:tag=>new Element(tag),getElementById:id=>elements[id]},
  fetch:async (url,options)=>{
    calls.push({url,options});
    if(options.method==='PATCH'){
      const body=JSON.parse(options.body);
      admins=admins.map(a=>a.telegram_id===url.split('/').pop()?{...a,label:body.label}:a);
      return {ok:true,status:200,json:async()=>({success:true})};
    }
    if(options.method==='DELETE'){
      admins=admins.map(a=>a.telegram_id===url.split('/').pop()?{...a,active:false}:a);
      return {ok:true,status:200,json:async()=>({success:true})};
    }
    return {ok:true,status:200,json:async()=>({success:true,configured:true,admins})};
  },logout(){throw Error('Unauthorized');}};
 vm.createContext(context);vm.runInContext(frontend,context);
 return {context,elements,calls};
}
test('authorized admins show edit name, not inactive admins',async()=>{
 const {context,elements}=ui();
 await context.loadPromotionBotAdmins();
 const rows=elements.promotionBotAdmins.children;
 assert.equal(rows.length,1);
 assert.match(rows[0].children[0].textContent,/Eski ism — 123/);
 assert.equal(rows[0].children[1].textContent,'Ismini o‘zgartirish');
 assert.equal(rows[0].children[2].textContent,'Ruxsatni bekor qilish');
});
test('edit, validate and save admin name without revoking or reauthorizing',async()=>{
 const {context,elements,calls}=ui();
 await context.loadPromotionBotAdmins();
 const row=elements.promotionBotAdmins.children[0];
 row.children[1].onclick();
 let [input,save,cancel]=row.children;
 assert.equal(input.value,'Eski ism');
 assert.equal(cancel.textContent,'Bekor qilish');
 input.value='    ';await save.onclick();
 assert.equal(calls.filter(c=>c.options.method==='PATCH').length,0);
 input.value='Yangi Ism';await save.onclick();
 const requests=calls.filter(c=>c.options.method==='PATCH');
 assert.equal(requests.length,1);
 assert.equal(requests[0].url,'/api/admin/promotion-bot-admins/123');
 assert.equal(JSON.parse(requests[0].options.body).label,'Yangi Ism');
 assert.equal(calls.filter(c=>c.options.method==='DELETE').length,0);
 assert.match(elements.promotionBotAdmins.children[0].children[0].textContent,/Yangi Ism/);
 assert.match(elements.promotionBotMessage.textContent,/muvaffaqiyatli/);
});
test('cancel edits without API call',async()=>{
 const {context,elements,calls}=ui();
 await context.loadPromotionBotAdmins();
 const row=elements.promotionBotAdmins.children[0];
 row.children[1].onclick();
 row.children[0].value='Tahrir';
 row.children[2].onclick();
 assert.match(row.children[0].textContent,/Eski ism/);
 assert.equal(calls.filter(c=>c.options.method==='PATCH').length,0);
});
