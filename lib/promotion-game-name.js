'use strict';

function normalizePromotionGameName(value) {
    if (typeof value !== 'string') return null;
    const name = value.trim();
    if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) return null;
    return name;
}
function displayPromotionGameName(value) {
    return normalizePromotionGameName(value) || 'Nomsiz aksiya';
}
module.exports = { normalizePromotionGameName, displayPromotionGameName };
