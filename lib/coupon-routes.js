'use strict';

// Keep coupon ownership on the server, keyed only by VERIFIED Telegram initData.
// This file does not trust a query-string userId, coupon price, or client subtotal.
const MAX_BODY_BYTES = 8192;

function validCoupon(c, now = Date.now()) {
    if (!c || c.active !== true) return false;
    const pct = Number(c.discount_percent);
    const min = Number(c.min_order_amount);
    const used = Number(c.used_count || 0);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return false;
    if (!Number.isFinite(min) || min < 0) return false;
    if (c.start_at && new Date(c.start_at).getTime() > now) return false;
    if (c.end_at && new Date(c.end_at).getTime() < now) return false;
    if (c.usage_limit != null && used >= Number(c.usage_limit)) return false;
    return true;
}

function sendJson(res, code, obj) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
}

async function bodyJson(req) {
    if (req.body !== undefined) {
        const value = req.body;
        const raw = typeof value === 'string' || Buffer.isBuffer(value)
            ? value.toString() : JSON.stringify(value);
        if (Buffer.byteLength(raw) > MAX_BODY_BYTES) throw Object.assign(new Error('Juda katta so‘rov'), { status: 413 });
        return JSON.parse(raw);
    }
    const chunks = [];
    let length = 0;
    for await (const chunk of req) {
        const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        length += data.length;
        if (length > MAX_BODY_BYTES) throw Object.assign(new Error('Juda katta so‘rov'), { status: 413 });
        chunks.push(data);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

async function handleCouponRoutes(req, res, url, { supabase, verifiedMiniAppUser, botToken }) {
    const pathname = url.pathname;
    const available = pathname === '/api/coupons/available' && req.method === 'GET';
    const mine = pathname === '/api/coupons/mine' && req.method === 'GET';
    const save = pathname === '/api/coupons/save' && req.method === 'POST';
    if (!available && !mine && !save) return false;
    try {
        let user = null;
        if (mine || save) {
            user = verifiedMiniAppUser(req.headers['x-telegram-init-data'], botToken);
            if (!user || !user.id) {
                sendJson(res, 401, {success:false, message:'Telegram seansi topilmadi yoki eskirgan. Do‘konni botdagi tugmadan qayta oching.'});
                return true;
            }
        }

        if (available) {
            const { data, error } = await supabase.from('coupons').select('*').eq('active', true).order('id', { ascending: false });
            if (error) throw error;
            const coupons = (data || []).filter(c => validCoupon(c)).map(c => ({
                code: c.code, discountPercent: Number(c.discount_percent),
                minOrderAmount: Number(c.min_order_amount) || 0,
                startAt: c.start_at, endAt: c.end_at
            }));
            sendJson(res, 200, { success:true, coupons });
            return true;
        }

        if (mine) {
            const {data, error} = await supabase.from('user_coupons').select('coupon_code')
                .eq('user_id', String(user.id));
            if (error) throw error;
            const codes = [...new Set((data || []).map(c => String(c.coupon_code || '').trim().toUpperCase()).filter(Boolean))];
            sendJson(res, 200, {success:true, codes});
            return true;
        }

        // Saving is intentionally authenticated and persistent: no "saved" confirmation without DB success.
        const payload = await bodyJson(req);
        const code = String(payload?.code || '').trim().toUpperCase();
        if (!/^[A-Z0-9_-]{1,64}$/.test(code)) {
            sendJson(res, 400, {success:false, message:'Kupon kodi noto‘g‘ri.'});
            return true;
        }
        const { data: coupon, error: findError } = await supabase.from('coupons')
            .select('*').eq('code', code).maybeSingle();
        if (findError) throw findError;
        if (!validCoupon(coupon)) {
            sendJson(res, 400, {success:false, message:'Kupon faol emas, muddati tugagan yoki limiti qolmagan.'});
            return true;
        }
        const {error: saveError} = await supabase.from('user_coupons').upsert({
            user_id: String(user.id), coupon_code: code
        }, { onConflict: 'user_id,coupon_code' });
        if (saveError) throw saveError;
        sendJson(res, 200, { success:true, code, message:'Kupon Telegram profilingizga saqlandi.' });
    } catch (error) {
        console.error('COUPON ROUTE ERROR:', { pathname, code: error?.code || null, message: error?.message || String(error) });
        if (error instanceof SyntaxError) {
            sendJson(res, 400, {success:false, message:'So‘rov noto‘g‘ri.'});
        } else {
            const noTable = error?.code === '42P01' || /user_coupons.*(does not exist|not found)/i.test(error?.message || '');
            sendJson(res, error?.status || 500, {success:false, message: noTable
                ? 'Kuponlar bazasi hali sozlanmagan. Supabase’da user_coupons SQL migratsiyasini bajaring.'
                : 'Kuponlarni serverda qayta ishlashda xatolik yuz berdi.' });
        }
    }
    return true;
}

module.exports = { handleCouponRoutes, validCoupon };
