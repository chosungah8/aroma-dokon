'use strict';

const crypto = require('node:crypto');

const ALLOWED_EVENTS = new Set(['visit', 'product_view', 'cart_add', 'order']);

function visitorKey(telegramId, botToken) {
    if (!Number.isSafeInteger(Number(telegramId)) || Number(telegramId) <= 0 || !botToken) return null;
    // Pseudonym: do not save raw Telegram IDs, names, phone numbers or IP addresses.
    return crypto.createHmac('sha256', String(botToken))
        .update('aroma-analytics-v1\0' + String(telegramId)).digest('hex');
}

function normalizeEvent(event, productId) {
    if (!ALLOWED_EVENTS.has(event)) return null;
    if (event === 'order' || event === 'visit') {
        if (productId !== undefined && productId !== null) return null;
        return { event_type: event, product_id: 0 };
    }
    if (!Number.isSafeInteger(productId) || productId < 1 || productId > 2147483647) return null;
    return { event_type: event, product_id: productId };
}

async function storeAnalyticsEvent(supabase, telegramId, botToken, event, productId) {
    const key = visitorKey(telegramId, botToken);
    const data = normalizeEvent(event, productId);
    if (!key || !data) return { ok: false, invalid: true };
    // One row per visitor / event / product / Tashkent day. Duplicates are ignored.
    const { error } = await supabase.from('aroma_visitor_events')
        .upsert({ visitor_key: key, ...data }, {
            onConflict: 'visitor_key,event_type,event_day,product_id',
            ignoreDuplicates: true
        });
    if (error) return { ok: false, error: true };
    return { ok: true };
}

module.exports = { visitorKey, normalizeEvent, storeAnalyticsEvent };
