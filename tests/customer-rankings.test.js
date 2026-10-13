'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');
const source=read('lib/server.js');
const sql=read('sql/aroma-mijozlar-reytingi.sql');
const html=read('admin.html');
const start=source.indexOf("if (url.pathname === '/api/admin/customer-rankings'");
const end=source.indexOf('const promotionAdminRoute',start);
assert.ok(start>0 && end>start);
const endpoint = new (Object.getPrototypeOf(async function(){}).constructor)(
    'req','res','url','sendJson','isAdmin','supabase','console',
    source.slice(start,end)
);
async function request({admin=false,days='0',db={data:{customer_count:1,by_orders:[{order_count:2}]},error:null}}={}) {
    const headers={};let dbCall=null;let result=null;
    const supabase={rpc:async(...args)=>{dbCall=args;return db;}};
    const res={setHeader:(k,v)=>{headers[k]=v}};
    const sendJson=(status,body)=>{result={status,body};return result;};
    const url=new URL('https://shop.example/api/admin/customer-rankings?days='+days);
    await endpoint({method:'GET'},res,url,sendJson,admin,supabase,{error:()=>{}});
    return {result,headers,dbCall};
}
test('rankings rejects unauthenticated access without database read',async()=>{
    const r=await request({admin:false});
    assert.equal(r.result.status,401);
    assert.equal(r.dbCall,null);
});
test('rankings checks period values before touching database',async()=>{
    for(const days of ['-1','1','9999','hello','30%20OR%201%3D1']) {
        const r=await request({admin:true,days});
        assert.equal(r.result.status,400);
        assert.equal(r.dbCall,null);
    }
});
test('rankings returns only RPC aggregated data to authorized admin, disables caching',async()=>{
    for(const days of ['0','7','30','90','365']) {
        const r=await request({admin:true,days});
        assert.equal(r.result.status,200);
        assert.deepEqual(r.dbCall,['aroma_customer_rankings_v1',{p_days:Number(days)}]);
        assert.equal(r.headers['Cache-Control'],'no-store, private');
        assert.equal(r.body?.rawOrders,undefined);
    }
});
test('rankings database problems use controlled error messages',async()=>{
    const r=await request({admin:true,db:{data:null,error:{code:'PGRST202'}}});
    assert.equal(r.result.status,503);
    assert.doesNotMatch(JSON.stringify(r.result.body),/PGRST202/);
});
test('SQL ranks distinct Telegram users, counts paid totals, includes archive, excludes canceled',()=>{
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.aroma_customer_rankings_v1/);
    assert.match(sql,/GROUP BY customer_id/);
    assert.match(sql,/COUNT\(\*\)::integer AS order_count/);
    assert.match(sql,/SUM\(amount\)::numeric AS total_spent/);
    assert.match(sql,/MAX\(amount\)::numeric AS biggest_order/);
    assert.match(sql,/ORDER BY order_count DESC/);
    assert.match(sql,/ORDER BY total_spent DESC/);
    assert.match(sql,/ORDER BY biggest_order DESC/);
    assert.match(sql,/COALESCE\(o\.status, ''\) NOT IN/);
    assert.doesNotMatch(sql,/WHERE\s+o\.archived\s*=/);
    assert.match(sql,/LIMIT 50/g);
});
test('SQL restricts private phone and identity data to service_role',()=>{
    assert.match(sql,/REVOKE ALL ON FUNCTION public\.aroma_customer_rankings_v1\(integer\) FROM PUBLIC, anon, authenticated/);
    assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.aroma_customer_rankings_v1\(integer\) TO service_role/);
    assert.doesNotMatch(sql,/SECURITY DEFINER/);
});
test('admin contains time, rank, and protected CSV export interface without HTML insertion',()=>{
    assert.match(html,/id="customerRankingsSection"/);
    assert.match(html,/id="customerRankPeriod"/);
    assert.match(html,/id="customerRankMetric"/);
    assert.match(html,/id="customerRankRows"/);
    const render=html.slice(html.indexOf('function renderCustomerRankings()'),html.indexOf('function downloadCustomerRankings()'));
    assert.match(render,/person\.append\(secondary\)/);
    assert.match(render,/\.textContent\s*=/);
    assert.doesNotMatch(render,/\.innerHTML\s*=/);
    assert.match(html,/Excel\/Sheets formula injection protection/);
    assert.match(html,/\+\+customerRankingLoadSeq;/);
});

test('order_date TEXT is converted safely to Tashkent local time before ranking comparison',()=>{
    assert.match(sql,/CREATE OR REPLACE FUNCTION public\.aroma_customer_order_time_v1/);
    assert.match(sql,/public\.aroma_customer_order_time_v1\(o\.order_date\)/);
    assert.match(sql,/AT TIME ZONE 'Asia\/Tashkent'/);
    assert.doesNotMatch(sql,/o\.order_date\s*>=\s*now\(\)/);
});
