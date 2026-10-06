'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { verifiedMiniAppUser } = require('../lib/security.js');
const token = 'test-bot-token';
function signed(values = {}, botToken = token) {
    const params = new URLSearchParams({ auth_date: String(Math.floor(Date.now() / 1000)), user: JSON.stringify({ id: 123, first_name: 'User' }), ...values });
    const text = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k,v]) => `${k}=${v}`).join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    params.set('hash', crypto.createHmac('sha256', secret).update(text).digest('hex'));
    return params.toString();
}
test('Open authentication verifies signature, age and unique fields before trusting user ID', () => {
    assert.equal(verifiedMiniAppUser(signed(), token).id, 123);
    assert.equal(verifiedMiniAppUser(signed({ signature: 'extra-field' }), token).id, 123);
    for (const value of ['', signed({}, 'wrong-token'), signed() + '&auth_date=1', signed({auth_date:'1'}),
        signed({auth_date:String(Math.floor(Date.now()/1000)+3600)}), signed({user:'not-json'}), signed({user:'{"id":-1}'}),
        signed().replace('123', '999')]) assert.equal(verifiedMiniAppUser(value, token), null);
    assert.equal(verifiedMiniAppUser(signed(), ''), null);
});
function route() {
    const source = fs.readFileSync(path.join(__dirname, '../lib/server.js'), 'utf8');
    const start = source.indexOf("    if (url.pathname === '/api/orders'");
    const end = source.indexOf("    if (url.pathname === '/api/order-receipt'",start);
    const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
    const run = new AsyncFunction('req','res','url','sendJson','verifiedMiniAppUser','BOT_TOKEN','processOrder','bot',source.slice(start,end));
    return async (body, auth = signed(), stream = null) => {
        const calls = [], messages = [], headers = {};
        const req = stream || { body };
        req.method='POST'; req.headers={'x-telegram-init-data':auth};
        const result = await run(req, {setHeader:(k,v)=>headers[k]=v}, {pathname:'/api/orders'},
            (status,body)=>({status,body}), verifiedMiniAppUser, token,
            async (data,ctx)=>{calls.push({data,user:ctx.from});await ctx.replyWithHTML('Confirmed');return {order:{id:'AR-1003'}};},
            {telegram:{sendMessage:async (id,text)=>messages.push({id,text})}});
        return {result,calls,messages,headers};
    };
}
const body={requestId:'ce03d897-2502-44e8-a86e-7712a2130eb7',items:[{id:1,count:1}],telegramUserId:999};
test('Open endpoint uses signed identity and common checkout instead of client supplied identity',async()=>{
    const r=await route()(body);
    assert.equal(r.result.status,200);assert.equal(r.result.body.orderId,'AR-1003');
    assert.equal(r.calls[0].user.id,123);assert.equal(r.messages[0].id,123);
    assert.equal(r.headers['Cache-Control'],'no-store, private');
});
test('Open endpoint blocks anonymous, malformed and oversized orders before processing',async()=>{
    for(const [input,auth,status] of [[body,'',401],['{',signed(),400],[{...body,requestId:'bad'},signed(),400],[{...body,type:'product_request'},signed(),400],['x'.repeat(65537),signed(),413]]) {
        const r=await route()(input,auth);assert.equal(r.result.status,status);assert.equal(r.calls.length,0);
    }
});
test('Open endpoint accepts JSON streams split inside multibyte Uzbek text',async()=>{
    const data={...body,address:'O‘zbekiston'};
    const bytes=Buffer.from(JSON.stringify(data));const boundary=bytes.indexOf(Buffer.from('‘'))+1;
    const stream={async *[Symbol.asyncIterator](){yield bytes.subarray(0,boundary);yield bytes.subarray(boundary);}};
    const r=await route()(undefined,signed(),stream);
    assert.equal(r.result.status,200);assert.equal(r.calls[0].data.address,data.address);
});
