'use strict';

// All changes require the existing signed administrator session.
function reply(res, code, data) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.writeHead(code, {'Content-Type': 'application/json; charset=utf-8'});
    res.end(JSON.stringify(data));
}

function percent(value, allowNull = false) {
    if (allowNull && value === null) return null;
    if (typeof value !== 'number' || !Number.isFinite(value) ||
        value < 0 || value > 100 ||
        !/^\d{1,3}(?:\.\d{1,2})?$/.test(String(value))) {
        throw new Error('Foiz 0–100 oralig‘ida, ko‘pi bilan ikki xonali bo‘lishi kerak.');
    }
    return value;
}

function money(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) ||
        value < 0 || value > 1000000000 ||
        !/^\d{1,10}(?:\.\d{1,2})?$/.test(String(value))) {
        throw new Error('Minimal xarid summasi noto‘g‘ri.');
    }
    return value;
}

function identifier(value) {
    if (!Number.isSafeInteger(value) || value < 1 || value > 1000000000)
        throw new Error('Mahsulot yoki kategoriya ID noto‘g‘ri.');
    return value;
}

function date(value) {
    if (value === null) return null;
    if (typeof value !== 'string' || value.length > 40 ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value))) {
        throw new Error('Bonus aksiya vaqti noto‘g‘ri.');
    }
    return value;
}

async function readBody(req) {
    // Vercel may supply a parsed body instead of an async request stream.
    if (req.body !== undefined) {
        const raw = typeof req.body === 'string' || Buffer.isBuffer(req.body)
            ? req.body.toString() : JSON.stringify(req.body);
        if (Buffer.byteLength(raw, 'utf8') > 4096) throw new Error('So‘rov hajmi juda katta.');
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('So‘rov noto‘g‘ri.');
        return parsed;
    }
    let length = 0;
    const parts = [];
    for await (const chunk of req) {
        length += chunk.length;
        if (length > 4096) throw new Error('So‘rov hajmi juda katta.');
        parts.push(chunk);
    }
    const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body))
        throw new Error('So‘rov noto‘g‘ri.');
    return body;
}

async function handleBonusAdminRoutes(req, res, url, {supabase, isAdmin}) {
    const base = '/api/admin/bonus/';
    if (!url.pathname.startsWith(base)) return false;
    if (!isAdmin) {
        reply(res, 401, {success:false, message:'Admin ruxsati kerak.'});
        return true;
    }

    const action = url.pathname.slice(base.length);
    if (!['config', 'settings', 'category', 'product'].includes(action)) {
        reply(res, 404, {success:false, message:'Bo‘lim topilmadi.'});
        return true;
    }
    if ((action === 'config' && req.method !== 'GET') ||
        (action !== 'config' && req.method !== 'PUT')) {
        reply(res, 405, {success:false, message:'HTTP usuli noto‘g‘ri.'});
        return true;
    }

    try {
        if (action === 'config') {
            const [s, c, p] = await Promise.all([
                supabase.from('aroma_bonus_settings')
                    .select('enabled,default_percent,min_redeem_order,max_redeem_percent,rollout_mode')
                    .eq('id', 1).single(),
                supabase.from('categories')
                    .select('id,name,bonus_percent_override')
                    .order('id', {ascending:true}).range(0,1999),
                supabase.from('products')
                    .select('id,name,category,bonus_percent_override,bonus_promo_percent,bonus_promo_starts_at,bonus_promo_ends_at')
                    .order('id', {ascending:true}).range(0,1999)
            ]);
            if (s.error || c.error || p.error || !s.data || s.data.rollout_mode !== 'global') throw new Error('Global bonus SQL migratsiyasi tayyor emas.');
            reply(res, 200, {success:true, settings:s.data,
                categories:c.data || [], products:p.data || []});
            return true;
        }

        const body = await readBody(req);
        if (action === 'settings') {
            if (typeof body.enabled !== 'boolean') throw new Error('Bonus yoqish qiymati noto‘g‘ri.');
            // Fail closed if global migration was not committed to the database.
            const {data: rollout, error: rolloutError} = await supabase
                .from('aroma_bonus_settings').select('rollout_mode')
                .eq('id',1).single();
            if (rolloutError || rollout?.rollout_mode !== 'global')
                throw new Error('Global bonus SQL migratsiyasi tayyor emas.');
            const patch = {
                enabled: body.enabled,
                default_percent: percent(body.defaultPercent),
                min_redeem_order: money(body.minRedeemOrder),
                max_redeem_percent: percent(body.maxRedeemPercent),
                updated_at: new Date().toISOString()
            };
            const {data, error} = await supabase.from('aroma_bonus_settings')
                .update(patch).eq('id',1).eq('rollout_mode','global').select('id').single();
            if (error || !data) throw new Error('Bonus sozlamasini saqlab bo‘lmadi.');
        } else if (action === 'category') {
            const id = identifier(body.id);
            const rate = percent(body.percent, true);
            const {data, error} = await supabase.from('categories')
                .update({bonus_percent_override:rate}).eq('id',id).select('id').maybeSingle();
            if (error) throw new Error('Kategoriya bonusini saqlab bo‘lmadi.');
            if (!data) { reply(res,404,{success:false,message:'Kategoriya topilmadi.'}); return true; }
        } else {
            const id = identifier(body.id);
            const rate = percent(body.percent, true);
            const promo = percent(body.promoPercent, true);
            const start = date(body.promoStartsAt);
            const end = date(body.promoEndsAt);
            if ((promo === null) !== (start === null) ||
                (promo === null) !== (end === null) ||
                (promo !== null && Date.parse(start) >= Date.parse(end))) {
                throw new Error('Aksiya foizi va boshlanish/tugash vaqti to‘liq bo‘lishi kerak.');
            }
            const {data, error} = await supabase.from('products')
                .update({bonus_percent_override:rate, bonus_promo_percent:promo,
                    bonus_promo_starts_at:start, bonus_promo_ends_at:end})
                .eq('id',id).select('id').maybeSingle();
            if (error) throw new Error('Mahsulot bonusini saqlab bo‘lmadi.');
            if (!data) {reply(res,404,{success:false,message:'Mahsulot topilmadi.'});return true;}
        }
        reply(res, 200, {success:true});
    } catch (error) {
        if (error instanceof SyntaxError || /^So‘rov|^Foiz|^Minimal|^Bonus yoqish|^Mahsulot yoki|^Bonus aksiya|^Aksiya foizi/.test(error.message)) {
            reply(res,400,{success:false,message:error.message});
        } else {
            console.error('ADMIN BONUS:', error.message);
            reply(res,503,{success:false,message:'Bonus sozlamasini hozircha saqlab yoki yuklab bo‘lmadi.'});
        }
    }
    return true;
}

module.exports = {handleBonusAdminRoutes};
