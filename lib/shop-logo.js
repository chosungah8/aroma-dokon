'use strict';
// A logo can only be a previously uploaded image in this store's own bucket.
// This prevents HTML/JS URL injection and unrelated remote images.
function validateShopLogoUrl(value, supabaseUrl) {
    if (value === '') return '';
    const invalid = () => {
        const error = new Error('Logo noto‘g‘ri. JPG, PNG yoki WEBP rasmni admin paneldan yuklang.');
        error.status = 400;
        error.customerMessage = error.message;
        throw error;
    };
    if (typeof value !== 'string' || value.length > 2048 || !supabaseUrl) return invalid();
    let target, origin;
    try { target = new URL(value); origin = new URL(supabaseUrl); } catch (_) { return invalid(); }
    const prefix = '/storage/v1/object/public/product-images/products/';
    const file = target.pathname.slice(prefix.length);
    if (target.protocol !== 'https:' || target.origin !== origin.origin ||
        target.username || target.password || target.search || target.hash ||
        !target.pathname.startsWith(prefix) ||
        !/^[a-f0-9-]{36}\.(?:jpg|png|webp)$/i.test(file)) return invalid();
    return value;
}
module.exports = { validateShopLogoUrl };
