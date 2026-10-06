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

module.exports = { safeEqual, adminTokenIsValid, telegramWebhookSecret, escapeHtml, resolveImagePath };
