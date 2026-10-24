'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {validateShopLogoUrl} = require('../lib/shop-logo.js');
const server = fs.readFileSync(require.resolve('../lib/server.js'),'utf8');
const admin = fs.readFileSync(require('path').join(__dirname,'../admin.html'),'utf8');
const shop = fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const sql = fs.readFileSync(require('path').join(__dirname,'../sql/aroma-sales-and-logo.sql'),'utf8');
const base='https://abcdefghijklm.supabase.co';
const valid=base+'/storage/v1/object/public/product-images/products/123e4567-e89b-42d3-a456-426614174000.png';
test('Logo accepts own-bucket uploaded images and empty default',()=>{
 assert.equal(validateShopLogoUrl(valid,base),valid);
 assert.equal(validateShopLogoUrl('',base),'');
});
test('Logo rejects outside hosts, scripts, data urls, arbitrary paths or queries',()=>{
 for(const candidate of ['javascript:alert(1)','data:image/svg+xml;base64,PHN2Zz4=',
  valid.replace('abcdefghijklm','otherproject'),valid+'?token=1',
  base+'/storage/v1/object/public/product-images/other/123e4567-e89b-42d3-a456-426614174000.png',
  base+'/storage/v1/object/public/product-images/products/evil.svg',
  'http://abcdefghijklm.supabase.co/storage/v1/object/public/product-images/products/123e4567-e89b-42d3-a456-426614174000.png'])
  assert.throws(()=>validateShopLogoUrl(candidate,base));
});
test('Sales RPC is admin-only and validates period',()=>{
 assert.match(server,/url\.pathname === '\/api\/admin\/sales-summary'/);
 assert.match(server,/if \(!isAdmin\) return sendJson\(401/);
 assert.match(server,/\['today','month','year','all'\]\.includes\(period\)/);
 assert.match(server,/supabase\.rpc\('aroma_sales_summary_v1'/);
 assert.match(sql,/o\.status = 'Yakunlandi'/);
 assert.match(sql,/coalesce\(o\.total,0\) - coalesce\(o\.bonus_spent,0\)/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.aroma_sales_summary_v1\(text\) FROM PUBLIC, anon, authenticated/);
});
test('Admin has sales panel and logo upload; shop preserves query when logo is tapped',()=>{
 assert.match(admin,/id="salesSummarySection"/);
 assert.match(admin,/id="salesTopProducts"/);
 assert.match(admin,/id="shopLogoFile"/);
 assert.match(admin,/\/api\/admin\/upload-image/);
 assert.match(shop,/id="shopLogoImage"/);
 assert.match(shop,/onclick="return openShopHome\(event\)"/);
 assert.match(shop,/window\.location\.pathname \+ window\.location\.search/);
 assert.match(server,/\.select\('free_delivery_enabled, free_delivery_min_amount, logo_url'\)/);
});
