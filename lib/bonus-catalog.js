'use strict';
function productBonusPercent(product, categoryOverrides, settings, now=Date.now()) {
    if (settings?.enabled !== true || settings.rollout_mode !== 'global' || product?.active !== true) return null;
    const start=Date.parse(product.bonus_promo_starts_at);
    const end=Date.parse(product.bonus_promo_ends_at);
    let value;
    if (product.bonus_promo_percent != null && Number.isFinite(start) &&
        Number.isFinite(end) && now >= start && now < end) value=product.bonus_promo_percent;
    else if (product.bonus_percent_override != null) value=product.bonus_percent_override;
    else if (categoryOverrides.has(String(product.category || '').trim()) &&
        categoryOverrides.get(String(product.category || '').trim()) != null)
        value=categoryOverrides.get(String(product.category || '').trim());
    else value=settings.default_percent;
    const rate=Number(value);
    return Number.isFinite(rate) && rate >= 0 && rate <= 100 ? rate : null;
}
module.exports={productBonusPercent};
