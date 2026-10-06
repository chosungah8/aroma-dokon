'use strict';
const crypto = require('crypto');
const path = require('path');

function safeEqual(actual, expected) {
    if (typeof actual !== 'string' || typeof expected !== 'string' || !expected) return false;
    const left = Buffer.from(actual);
    const right = Buffer.from(expected);
    return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function adminTokenIsValid(token, password) {
    const normalized = String(password || '').trim();
    if (!normalized) return false;
    const expected = crypto.createHash('sha256').update(normalized).digest('hex');
    return safeEqual(token, expected);
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

module.exports = { verifiedMiniAppUser, safeEqual, adminTokenIsValid, telegramWebhookSecret, escapeHtml, resolveImagePath };
