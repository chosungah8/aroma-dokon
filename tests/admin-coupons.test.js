'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '../admin.html'), 'utf8');

test('admin panel clears legacy or expired sessions before loading coupons', () => {
    assert.match(html, /function adminSessionLooksCurrent\(token\)/);
    assert.match(html, /parts\[0\] !== "a1"/);
    assert.match(html, /sessionStorage\.removeItem\("aroma_admin_token"\)/);
    assert.match(html, /if \(response\.status === 401\) \{\s*logout\(\);\s*return;\s*\}/s);
});

test('coupon load errors are escaped and show the server message', () => {
    assert.match(html, /escapeHtml\(result\.message \|\| "Kuponlarni yuklab bo‘lmadi"\)/);
    assert.match(html, /escapeHtml\(error\.message \|\| "Server bilan bog‘lanishda xatolik"\)/);
});
