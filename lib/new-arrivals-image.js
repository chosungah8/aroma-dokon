'use strict';
// Admin faqat shu ilovaning Supabase Storage bucketiga avval yuklagan rasmni tanlashi mumkin.
function validateNewArrivalsImageUrl(value, supabaseUrl) {
    if (value === '') return ''; // Rasmni olib tashlash: emoji qaytadi.
    const invalid = () => {
        const error = new Error('Yangi mahsulotlar rasmi noto‘g‘ri. Rasmni admin paneldan yuklang.');
        error.status = 400;
        error.customerMessage = error.message;
        throw error;
    };
    if (typeof value !== 'string' || value.length > 2048 || !supabaseUrl) return invalid();
    let url, base;
    try { url = new URL(value); base = new URL(supabaseUrl); } catch (_) { return invalid(); }
    const prefix = '/storage/v1/object/public/product-images/products/';
    const filename = url.pathname.slice(prefix.length);
    if (url.protocol !== 'https:' || url.origin !== base.origin || url.username || url.password || url.search || url.hash
        || !url.pathname.startsWith(prefix) || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(filename)) return invalid();
    return value;
}
module.exports = { validateNewArrivalsImageUrl };
