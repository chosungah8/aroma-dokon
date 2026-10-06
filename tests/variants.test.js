'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');
const helpers = html.slice(html.indexOf('function formatProductVariants('), html.indexOf('async function addProduct('));
function fixture(products = []) {
    const nodes = {}, calls = [];
    const ctx = { document: {getElementById: id => nodes[id] ||= { value: '', checked: false, classList: {remove() {}} }},
        window: {scrollTo() {}}, console, adminToken: 'test', alert: message => { throw Error(message); },
        loadProducts() {}, setTimeout() {},
        fetch: async (url, opts) => { calls.push({url,opts}); return {ok:true, json: async () => opts.method === 'PUT' ? {success:true} : products}; }
    };
    vm.createContext(ctx);
    const edit = html.slice(html.indexOf('async function editProduct('), html.indexOf('function closeEdit('));
    const saveStart = html.indexOf('async function saveEdit(');
    // Extract the complete function with the next function boundary.
    const saveEnd = html.indexOf('\nasync function ', saveStart + 10);
    vm.runInContext(helpers + edit + html.slice(saveStart, saveEnd),ctx);
    return {ctx,nodes,calls};
}
test('priced, unpriced and zero-price variants survive a text round trip', () => {
    const ctx = {};vm.createContext(ctx);vm.runInContext(helpers,ctx);
    const variants = ['Ko‘k',{name:'Qizil',price:25000},{name:'Pushti',price:28000},{name:'Asosiy',price:0}];
    const text=ctx.formatProductVariants(variants);
    assert.ok(!text.includes('[object Object]'));
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parseProductVariants(text))), variants);
    assert.deepEqual(JSON.parse(JSON.stringify(ctx.parseProductVariants('Qizil | 25 000\r\n\nKo‘k'))),[{name:'Qizil',price:25000},'Ko‘k']);
    assert.equal(ctx.formatProductVariants([]),'');
});
test('invalid variant prices are rejected instead of silently becoming zero', () => {
    const ctx={};vm.createContext(ctx);vm.runInContext(helpers,ctx);
    for(const text of ['Qizil | abc','Qizil | -10','Qizil | Infinity','Qizil |','| 25000','[object Object]','Qizil | 20 | 30']) assert.throws(()=>ctx.parseProductVariants(text));
});
test('actual edit/save flow preserves variants and updates only the selected product', async () => {
    const variants=[{name:'Qizil',price:25000},'Ko‘k'];
    const product={id:7,name:'Test',category:'Kosmetika',price:20000,stock:4,variants};
    const other={...product,id:8,variants:['Other']};
    const f=fixture([product,other]);
    await f.ctx.editProduct(7);
    assert.equal(f.nodes.editVariants.value,'Qizil | 25000\nKo‘k');
    await f.ctx.saveEdit();
    assert.equal(f.calls.length,2);
    assert.equal(f.calls[1].url,'/api/admin/products/7');
    assert.deepEqual(JSON.parse(f.calls[1].opts.body).variants,variants);
    assert.deepEqual(other.variants,['Other']);
    f.nodes.editVariants.value='Qizil | abc';
    await f.ctx.saveEdit();
    assert.equal(f.calls.length,2);
    assert.equal(f.nodes.editMessage.className,'error');
});
