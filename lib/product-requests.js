'use strict';
const crypto = require('crypto');
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
function requestError(message, status = 400) {
    const error = new Error(message); error.status = status; error.customerMessage = message; return error;
}
async function readLimitedJson(req, limit) {
    let raw;
    if (req.body !== undefined) {
        raw = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? Buffer.from(req.body) : Buffer.from(JSON.stringify(req.body));
    } else {
        const chunks = []; let size = 0;
        for await (const chunk of req) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += bytes.length;
            if (size > limit) throw requestError('Yuborilgan ma’lumot hajmi katta.', 413);
            chunks.push(bytes);
        }
        raw = Buffer.concat(chunks);
    }
    if (raw.length > limit) throw requestError('Yuborilgan ma’lumot hajmi katta.', 413);
    try {
        const data = JSON.parse(raw.toString('utf8'));
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw Error();
        return data;
    } catch (_) { throw requestError('Ma’lumot formati noto‘g‘ri.'); }
}
function decodeRequestImage(image) {
    if (typeof image !== 'string') throw requestError('Rasm yuborilmadi.');
    if (image.length > 4 * 1024 * 1024 + 64) throw requestError('Rasm 3 MB dan oshmasin.', 413);
    const match = /^data:image\/(jpeg|jpg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if (!match) throw requestError('Faqat JPG, PNG yoki WEBP rasm qabul qilinadi.');
    const bytes = Buffer.from(match[2], 'base64');
    if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw requestError('Rasm 3 MB dan oshmasin.', 413);
    if (bytes.toString('base64') !== match[2]) throw requestError('Rasm kodlanishi noto‘g‘ri.');
    const ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    const png = bytes.length >= 24 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])) && bytes.toString('ascii',12,16) === 'IHDR';
    const jpg = bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217;
    const webp = bytes.length >= 16 && bytes.toString('ascii',0,4) === 'RIFF' && bytes.toString('ascii',8,12) === 'WEBP' && bytes.readUInt32LE(4) + 8 === bytes.length;
    if (!(ext === 'png' && png || ext === 'jpg' && jpg || ext === 'webp' && webp)) throw requestError('Rasm tarkibi uning formatiga mos emas.');
    return { bytes, ext, contentType: 'image/' + (ext === 'jpg' ? 'jpeg' : ext) };
}
function validatedProductRequest(data, user, supabaseUrl) {
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) throw requestError('Telegram tasdig‘i kerak.', 401);
    if (data.text !== undefined && typeof data.text !== 'string') throw requestError('So‘rov matni noto‘g‘ri.');
    const text = (data.text || '').trim();
    if (text.length > 2000) throw requestError('So‘rov matni 2000 belgidan oshmasin.');
    const imageUrl = data.imageUrl || '';
    if (typeof imageUrl !== 'string' || imageUrl.length > 2048) throw requestError('Rasm manzili noto‘g‘ri.');
    if (imageUrl) {
        const base = new URL(supabaseUrl);
        let url; try { url = new URL(imageUrl); } catch (_) { throw requestError('Rasm manzili noto‘g‘ri.'); }
        const prefix = '/storage/v1/object/public/product-images/requests/' + user.id + '/';
        if (url.origin !== base.origin || url.username || url.password || url.search || url.hash || !url.pathname.startsWith(prefix)
            || !/^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(url.pathname.slice(prefix.length))) {
            throw requestError('Rasmni shu so‘rov oynasidan qayta yuklang.');
        }
    }
    if (!text && !imageUrl) throw requestError('Mahsulot nomini yozing yoki rasm yuboring.');
    return { customer_id: String(user.id), customer_name: String(user.first_name || 'Noma’lum').slice(0,200),
        customer_username: String(user.username || '').slice(0,100), message: text, image_url: imageUrl, status: 'Yangi' };
}
async function uploadImage(supabase, data, userId = null) {
    const image = decodeRequestImage(data.image);
    const name = (userId ? 'requests/' + userId + '/' : 'products/') + crypto.randomUUID() + '.' + image.ext;
    const bucket = supabase.storage.from('product-images');
    const { error } = await bucket.upload(name, image.bytes, {contentType: image.contentType, upsert: false});
    if (error) throw Error('Image storage failed');
    return bucket.getPublicUrl(name).data.publicUrl;
}
module.exports = { readLimitedJson, decodeRequestImage, validatedProductRequest, uploadImage };
