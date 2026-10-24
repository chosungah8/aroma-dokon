const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
test('compact header includes bounded logo height without stretching', () => {
  assert.match(html, /\.header \{[^}]*height:\s*56px;/s);
  assert.match(html, /\.header \.shop-logo \{[^}]*max-height:\s*52px;/s);
  assert.match(html, /\.header \.shop-logo \{[^}]*object-fit:\s*contain;/s);
});
test('banner is closer and floating buttons retain usable 44px target', () => {
  assert.match(html, /\.header \+ #topPromo \{\s*margin-top:\s*2px !important;/);
  assert.match(html, /body \.cart-bar-btn,\s*body \.search-top-btn \{\s*width:\s*44px;\s*height:\s*44px;/);
});
test('logo still returns to home; cart and search actions remain connected', () => {
  assert.match(html, /class="shop-logo-link"[^>]*onclick="return openShopHome\(event\)"/);
  assert.match(html, /class="search-top-btn"[^>]*onclick="openSearchModal\(\)"/);
  assert.match(html, /class="cart-bar-btn"[^>]*onclick="openCartModal\(\)"/);
});
