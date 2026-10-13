'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'lib/server.js'),'utf8');
const sql=fs.readFileSync(path.join(root,'sql/aroma-mijozlar-reytingi-va-royxati.sql'),'utf8');
const html=fs.readFileSync(path.join(root,'admin.html'),'utf8');
const start=source.indexOf("if (url.pathname === '/api/admin/customers'");
const end=source.indexOf('// CUSTOMER RANKINGS:',start);
assert.ok(start>0 && end>start);
const handler=new(Object.getPrototypeOf(async function(){}).constructor)(
    'req','res','url','sendJson','isAdmin','supabase','console',source.slice(start,end));
async function invoke({admin=true,page='1',search='',sort='recent',db={data:{page:1,total:1,rows:[{customer_name:'Ali'}]},error:null}}={}){
    const url=new URL('https://aroma.example/api/admin/customers');
    url.searchParams.set('page',page);url.searchParams.set('search',search);url.searchParams.set('sort',sort);
    let call=null,answer=null;const headers={};
    const supabase={rpc:async(...args)=>{call=args;return db;}};
    const res={setHeader:(key,value)=>{headers[key]=value;}};
    const sendJson=(status,body)=>{answer={status,body};return answer;};
    await handler({method:'GET'},res,url,sendJson,admin,supabase,{error:()=>{}});
    return {call,answer,headers};
}
test('customers requires valid admin token without database access',async()=>{
    const r=await invoke({admin:false});assert.equal(r.answer.status,401);assert.equal(r.call,null);
});
test('customers validates pagination, sort and query length',async()=>{
    for(const page of ['0','-2','10001','3.2','1 OR 1=1']){
        const r=await invoke({page});assert.equal(r.answer.status,400);assert.equal(r.call,null);
    }
    for(const sort of ['bad','recent; DROP TABLE orders','']){
        if(sort==='')continue;
        const r=await invoke({sort});assert.equal(r.answer.status,400);assert.equal(r.call,null);
    }
    const tooLong=await invoke({search:'x'.repeat(81)});
    assert.equal(tooLong.answer.status,400);assert.equal(tooLong.call,null);
});
test('customers is paginated at SQL level, returns data with no-store',async()=>{
    for(const sort of ['recent','orders','spend','name']){
        const r=await invoke({page:'2',sort,search:' Ali '});
        assert.equal(r.answer.status,200);
        assert.deepEqual(r.call,['aroma_customer_list_v1',{p_page:2,p_search:'Ali',p_sort:sort}]);
        assert.equal(r.answer.body.success,true);
        assert.equal(r.headers['Cache-Control'],'no-store, private');
        assert.equal(r.headers['X-Content-Type-Options'],'nosniff');
    }
});
test('customers does not expose database errors',async()=>{
    const r=await invoke({db:{data:null,error:{code:'PGRST999',message:'Secret!'}}});
    assert.equal(r.answer.status,503);
    assert.doesNotMatch(JSON.stringify(r.answer.body),/PGRST999|Secret!/);
});
test('SQL query includes all historical, non-cancelled customers, deduplicates per Telegram ID',()=>{
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.aroma_customer_list_v1/);
    assert.match(sql,/CASE WHEN COALESCE\(i\.customer_id/);
    assert.match(sql,/THEN 'tg:' \|\| i\.customer_id/);
    assert.match(sql,/THEN 'ph:' \|\| i\.phone_digits/);
    assert.match(sql,/count\(\*\)::integer AS order_count/);
    assert.match(sql,/sum\(k\.amount\)::numeric AS total_spent/);
    assert.match(sql,/coalesce\(o\.status,''\) NOT IN/);
    assert.match(sql,/row_number\(\) OVER/);
    assert.match(sql,/s\.seq > \(p_page - 1\) \* 25/);
    assert.doesNotMatch(sql,/WHERE\s+o\.archived\s*=/);
});
test('private customer list SQL restricts to service role only',()=>{
    assert.match(sql,/REVOKE ALL ON FUNCTION public\.aroma_customer_list_v1\(integer,text,text\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.aroma_customer_list_v1\(integer,text,text\) TO service_role/);
    assert.doesNotMatch(sql,/SECURITY DEFINER/);
});
test('admin has search, paginated table, guarded coupon prefill and safe CSV',()=>{
    for(const id of ['customerListSection','customerListSearch','customerListSort','customerListRows','customerListPaging'])
        assert.match(html,new RegExp('id="'+id+'"'));
    assert.match(html,/fetch\('\/api\/admin\/customers\?'/);
    assert.match(html,/customerListPage\+1/);
    assert.match(html,/function openPersonalCouponForCustomer\(id\)/);
    const render=html.slice(html.indexOf('async function loadCustomerList('),html.indexOf('function openPersonalCouponForCustomer('));
    assert.match(render,/\.textContent=/);
    assert.doesNotMatch(render,/\.innerHTML\s*=/);
    assert.match(html,/Formula injection protection: untrusted text/);
});

test('customer list derives latest ordering from parsed date, not TEXT lexical order',()=>{
    assert.match(sql,/public\.aroma_customer_order_time_v1\(o\.order_date\) AS order_ts/);
    assert.match(sql,/max\(k\.order_ts\) AT TIME ZONE 'Asia\/Tashkent'/);
    assert.match(sql,/ORDER BY person_key, order_ts DESC/);
});
