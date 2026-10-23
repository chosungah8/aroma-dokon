'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const server = fs.readFileSync(path.join(root, 'lib/server.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'sql/aroma-yangi-mahsulotlar.sql'), 'utf8');

function domNode(tag='div') {
    const classes = new Set();
    const node = {
        tagName: tag.toUpperCase(), style: {removeProperty() {}}, children: [], onclick: null,
        classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name) },
        appendChild(child) { this.children.push(child); },
        setAttribute(name,value) { this[name] = value; },
    };
    Object.defineProperty(node, 'innerHTML', { get() { return this.html || ''; }, set(value) {
        this.html = value;
        if (value === '') this.children = [];
    }});
    return node;
}

function fixture() {
    const categories = domNode();
    const grid = domNode();
    const ctx = vm.createContext({
        document: {
            getElementById(id) { return ({ categories, productGrid: grid, searchModalInput: {value:''} })[id]; },
            createElement: tag => domNode(tag),
            querySelectorAll: () => categories.children,
        },
        allCategories: [], products: [], selectedCategory: null,
        getCategoryVisual: () => '<span>📦</span>',
        getProductCartQty: () => 0,
        getVariantPrice: p => p.price,
        getDiscountedProductPrice: (_product, price) => price,
        catalogMessage: () => { throw Error('No catalog message expected'); },
        loadCategories: () => {}, renderProducts: () => {},
        window: {}, console: {log() {},error() {}},
        setTimeout: () => 1, clearTimeout: () => {},
    });
    const freshHelper = html.slice(html.indexOf('const NEW_ARRIVALS_CATEGORY ='), html.indexOf('function loadProducts()'));
    const categoryCode = html.slice(html.indexOf('function renderCategories('), html.indexOf('function selectCategory('));
    const bonusHelpers = html.slice(html.indexOf('function bonusPointsForProduct('), html.indexOf('function renderProducts()'));
    const productsCode = html.slice(html.indexOf('function renderProducts()'), html.indexOf('function getVariantPrice('));
    assert.ok(freshHelper.startsWith('const NEW_ARRIVALS_CATEGORY ='));
    assert.ok(bonusHelpers.startsWith('function bonusPointsForProduct('));
    vm.runInContext(freshHelper+'\n'+categoryCode+'\n'+bonusHelpers+'\n'+productsCode, ctx);
    return { ctx, categories, grid };
}

function p(id, daysAgo, now=Date.now()) {
    return {id, name:'Mahsulot '+id, category:'Yuz', price:1000, stock:10,
        newArrivalAt: new Date(now - daysAgo * 86400000).toISOString()};
}

test('7-day boundary: new products stay visible for less than 168 hours', () => {
    const {ctx} = fixture();
    const now = Date.parse('2026-10-13T12:00:00Z');
    ctx.item = p(1, 6.99, now); ctx.now = now;
    assert.equal(vm.runInContext('isNewArrival(item, now)',ctx),true);
    ctx.item = p(1,7,now);
    assert.equal(vm.runInContext('isNewArrival(item, now)',ctx),false);
    ctx.item = p(1,7.01,now);
    assert.equal(vm.runInContext('isNewArrival(item, now)',ctx),false);
    ctx.item = {...p(1,1,now), newArrivalAt:null};
    assert.equal(vm.runInContext('isNewArrival(item, now)',ctx),false);
    ctx.item = {...p(1,1,now), newArrivalAt:'bad timestamp'};
    assert.equal(vm.runInContext('isNewArrival(item, now)',ctx),false);
    ctx.item = {...p(1,1,now), newArrivalAt:new Date(now+60000).toISOString()};
    assert.equal(vm.runInContext('isNewArrival(item, now)',ctx),false);
});

test('earliest added product appears first; expired item vanishes without renumbering', () => {
    const {ctx} = fixture();
    const now = Date.parse('2026-10-13T12:00:00Z');
    ctx.products = [p(3,1,now),p(2,6,now),p(1,8,now),p(4,2,now)];
    ctx.now=now;
    assert.deepEqual(Array.from(vm.runInContext('orderNewArrivals(products.filter(p => isNewArrival(p, now))).map(p=>p.id)',ctx)),[2,4,3]);
    ctx.now=now+86400000;
    assert.deepEqual(Array.from(vm.runInContext('orderNewArrivals(products.filter(p => isNewArrival(p, now))).map(p=>p.id)',ctx)),[4,3]);
});

test('new arrivals virtual category is the first card even with no real categories', () => {
    const {ctx,categories} = fixture();
    vm.runInContext('renderCategories(null)',ctx);
    assert.equal(categories.children.length,1);
    assert.match(categories.children[0].innerHTML,/Yangi<br>mahsulotlar/);
    ctx.allCategories = [
        {id:1,name:'Yuz',parent_id:null},
        {id:2,name:'Soch',parent_id:null},
        {id:3,name:'Shampun',parent_id:2},
    ];
    vm.runInContext('renderCategories(null)',ctx);
    assert.equal(categories.children.length,3);
    assert.match(categories.children[0].innerHTML,/Yangi<br>mahsulotlar/);
    assert.match(categories.children[1].innerHTML,/Yuz/);
    assert.match(categories.children[2].innerHTML,/Soch/);
    categories.children[0].onclick();
    assert.equal(vm.runInContext('selectedCategory === NEW_ARRIVALS_CATEGORY',ctx),true);
    assert.equal(categories.children[0].classList.contains('active'),true);
    // Back to regular category works.
    categories.children[1].onclick();
    assert.equal(ctx.selectedCategory,'Yuz');
});

test('product grid filters and orders fresh products only for virtual category', () => {
    const {ctx,grid} = fixture();
    ctx.products = [p(4,1), p(2,6), p(7,8), p(3,3)];
    vm.runInContext('selectedCategory=NEW_ARRIVALS_CATEGORY; renderProducts()',ctx);
    assert.deepEqual(grid.children.map(node => [...node.innerHTML.matchAll(/alt="Mahsulot (\d+)"/g)][0][1]),['2','3','4']);
    vm.runInContext('selectedCategory=null; renderProducts()',ctx);
    assert.deepEqual(grid.children.map(node => [...node.innerHTML.matchAll(/alt="Mahsulot (\d+)"/g)][0][1]),['4','2','7','3']);
});

test('public products API returns insertion time; admin edit never refreshes it', () => {
    const publicRoute = server.slice(server.indexOf("if (url.pathname === '/api/products'"),server.indexOf('// MAHSULOTNI TAHRIRLASH'));
    assert.match(publicRoute,/newArrivalAt:\s*product\.new_arrival_at\s*\|\|\s*null/);
    const editRoute = server.slice(server.indexOf('// MAHSULOTNI TAHRIRLASH'), server.indexOf('// MAHSULOTNI O‘CHIRISH'));
    assert.doesNotMatch(editRoute,/new_arrival_at/);
    assert.match(sql,/ADD COLUMN IF NOT EXISTS new_arrival_at timestamptz/i);
    assert.match(sql,/ALTER COLUMN new_arrival_at SET DEFAULT now\(\)/i);
    assert.match(sql,/SET new_arrival_at = created_at::timestamptz/i);
});
