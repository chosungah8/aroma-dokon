'use strict';
const crypto = require('crypto');
const path = require('path');

function safeEqual(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

const ADMIN_SESSION_SECONDS = 8 * 60 * 60;
function adminSessionKey(password, secret) {
    if (!String(password || '').trim() || !secret) return null;
    return crypto.createHmac('sha256', secret)
        .update('aroma-admin-session-v1\0' + String(password).trim()).digest();
}
function createAdminToken(password, secret, now = Math.floor(Date.now() / 1000)) {
    const key = adminSessionKey(password, secret);
    if (!key) throw new Error('Admin session configuration missing');
    const payload = Buffer.from(JSON.stringify({ iat: now, exp: now + ADMIN_SESSION_SECONDS,
        nonce: crypto.randomBytes(24).toString('hex') })).toString('base64url');
    const body = 'a1.' + payload;
    return body + '.' + crypto.createHmac('sha256', key).update(body).digest('hex');
}
function adminTokenIsValid(token, password, secret, now = Math.floor(Date.now() / 1000)) {
    try {
        const key = adminSessionKey(password, secret);
        if (!key || typeof token !== 'string' || token.length > 512) return false;
        const parts = token.split('.');
        if (parts.length !== 3 || parts[0] !== 'a1' || !/^[A-Za-z0-9_-]+$/.test(parts[1]) || !/^[a-f0-9]{64}$/.test(parts[2])) return false;
        const expected = crypto.createHmac('sha256', key).update(parts[0] + '.' + parts[1]).digest('hex');
        if (!safeEqual(parts[2], expected)) return false;
        const data = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return Number.isSafeInteger(data.iat) && Number.isSafeInteger(data.exp)
            && data.iat <= now && data.exp > now && data.exp - data.iat === ADMIN_SESSION_SECONDS
            && /^[a-f0-9]{48}$/.test(data.nonce);
    } catch (_) { return false; }
}

function telegramWebhookSecret(botToken) {
    if (!botToken) return '';
    return crypto.createHmac('sha256', botToken).update('aroma-telegram-webhook-v1').digest('hex');
}

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
}

function resolveImagePath(root, rawPath) {
    try {
        const pathname = decodeURIComponent(String(rawPath).split('?')[0]);
        if (!pathname.startsWith('/images/') || /[\\\\\0]/.test(pathname)) return null;
        const parts = pathname.slice('/images/'.length).split('/');
        if (parts.some(part => !part || part === '.' || part === '..')) return null;
        if (!['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(path.extname(pathname).toLowerCase())) return null;
        return path.join(root, 'images', ...parts);
    } catch (_) { return null; }
}

function verifiedMiniAppUser(initData, botToken, now = Math.floor(Date.now() / 1000)) {
    try {
        if (!botToken || typeof initData !== 'string' || initData.length > 16384) return null;
        const params = new URLSearchParams(initData);
        const entries = [...params.entries()];
        if (new Set(entries.map(([key]) => key)).size !== entries.length) return null;
        const hash = params.get('hash');
        if (!/^[0-9a-f]{64}$/i.test(hash || '')) return null;
        params.delete('hash');
        const check = [...params.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, value]) => `${key}=${value}`).join('\n');
        const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
        const expected = crypto.createHmac('sha256', secret).update(check).digest('hex');
        if (!safeEqual(hash.toLowerCase(), expected)) return null;
        const authDate = Number(params.get('auth_date'));
        if (!Number.isSafeInteger(authDate) || authDate <= 0 || now - authDate > 86400 || authDate > now + 60) return null;
        const user = JSON.parse(params.get('user') || 'null');
        if (!Number.isSafeInteger(user?.id) || user.id <= 0) return null;
        return user;
    } catch (_) { return null; }
}

module.exports = { createAdminToken, ADMIN_SESSION_SECONDS, verifiedMiniAppUser, safeEqual, adminTokenIsValid, telegramWebhookSecret, escapeHtml, resolveImagePath };
