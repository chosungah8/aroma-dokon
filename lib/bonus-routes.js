'use strict';

function sendJson(res, status, body) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.writeHead(status, {
        'Content-Type': 'application/json; charset=utf-8'
    });
    res.end(JSON.stringify(body));
}

async function handleBonusRoutes(
    req,
    res,
    url,
    { supabase, verifiedMiniAppUser, botToken }
) {
    if (url.pathname !== '/api/bonus/balance' &&
        url.pathname !== '/api/bonus/quote') {
        return false;
    }

    if (req.method !== 'GET') {
        sendJson(res, 405, {
            success: false,
            message: 'Bu amal qo‘llab-quvvatlanmaydi.'
        });
        return true;
    }

    // Telegram shaxsini serverda tasdiqlaymiz.
    const user = verifiedMiniAppUser(
        req.headers['x-telegram-init-data'],
        botToken
    );

    if (!user?.id) {
        sendJson(res, 401, {
            success: false,
            message: 'Telegram seansi eskirgan. Do‘konni botdan qayta oching.'
        });
        return true;
    }

    // ID mijoz yuborgan parametrdan EMAS, tasdiqlangan seansdan olinadi.
    const customerId = String(user.id);

    if (!/^[1-9][0-9]{0,19}$/.test(customerId)) {
        sendJson(res, 401, {
            success: false,
            message: 'Telegram foydalanuvchisini aniqlab bo‘lmadi.'
        });
        return true;
    }

    // Production pilot is opt-in: unset/mismatched ID gets a disabled view.
    // The SQL allowlist independently enforces every write/quote.
    const pilotId = String(process.env.AROMA_BONUS_PILOT_TELEGRAM_ID || '').trim();
    if (!/^[1-9][0-9]{0,19}$/.test(pilotId) || customerId !== pilotId) {
        if (url.pathname === '/api/bonus/quote') {
            sendJson(res, 200, {
                success: true, enabled: false, balance: 0, maxRedeemable: 0,
                minRedeemOrder: 0, maxRedeemPercent: 0, reason: 'pilot_only'
            });
        } else {
            sendJson(res, 200, {
                success: true, enabled: false, balance: 0,
                defaultPercent: 0, minRedeemOrder: 0, maxRedeemPercent: 0
            });
        }
        return true;
    }

    // BONUS QUOTE: faqat o'qish, bonus sarflanmaydi.
    if (url.pathname === '/api/bonus/quote') {
        const values = url.searchParams.getAll('total');

        // Takroriy, manfiy, kasr yoki haddan tashqari
        // katta summalarni qabul qilmaymiz.
        if (values.length !== 1 ||
            !/^(0|[1-9][0-9]{0,12})$/.test(values[0]) ||
            !Number.isSafeInteger(Number(values[0])) ||
            Number(values[0]) > 1000000000000) {
            sendJson(res, 400, {
                success: false,
                message: 'Buyurtma summasi noto‘g‘ri.'
            });
            return true;
        }

        const total = Number(values[0]);

        try {
            // Mijoz ID faqat tasdiqlangan Telegram
            // foydalanuvchisidan olinadi.
            const { data: quote, error } = await supabase.rpc(
                'aroma_bonus_redeem_quote_v1',
                {
                    p_customer_id: customerId,
                    p_total_after_coupons: total
                }
            );

            if (error || !quote ||
                typeof quote !== 'object' ||
                Array.isArray(quote)) {
                throw error || new Error('Bonus quote olinmadi');
            }

            const balance = Number(quote.balance);
            const allowed = Number(quote.max_redeemable);
            const minimum = Number(quote.min_redeem_order);
            const percent = Number(quote.max_redeem_percent);

            if (typeof quote.enabled !== 'boolean' ||
                !Number.isSafeInteger(balance) ||
                balance < 0 ||
                !Number.isSafeInteger(allowed) ||
                allowed < 0 ||
                allowed > balance ||
                allowed > total ||
                (!quote.enabled && allowed !== 0) ||
                !Number.isFinite(minimum) ||
                minimum < 0 ||
                !Number.isFinite(percent) ||
                percent < 0 ||
                percent > 100) {
                throw new Error('Bonus quote ma’lumoti noto‘g‘ri');
            }

            sendJson(res, 200, {
                success: true,
                enabled: quote.enabled,
                balance: balance,
                // Buyurtma SQL funksiyasida 1 milliard
                // ball chegarasi mavjud.
                maxRedeemable: Math.min(allowed, 1000000000),
                minRedeemOrder: minimum,
                maxRedeemPercent: percent,
                reason: typeof quote.reason === 'string'
                    ? quote.reason
                    : 'unknown'
            });

        } catch (error) {
            console.error('BONUS QUOTE API ERROR:', {
                code: error?.code || null,
                message: error?.message || String(error)
            });

            sendJson(res, 503, {
                success: false,
                message: 'Bonus limitini hozircha hisoblab bo‘lmadi.'
            });
        }

        return true;
    }

    try {
        const { data: settings, error: settingsError } = await supabase
            .from('aroma_bonus_settings')
            .select(
                'enabled,default_percent,min_redeem_order,max_redeem_percent'
            )
            .eq('id', 1)
            .single();

        if (settingsError || !settings) {
            throw settingsError || new Error('Bonus sozlamasi topilmadi');
        }

        const { data: account, error: accountError } = await supabase
            .from('aroma_bonus_accounts')
            .select('balance')
            .eq('customer_id', customerId)
            .maybeSingle();

        if (accountError) {
            throw accountError;
        }

        sendJson(res, 200, {
            success: true,
            balance: Number(account?.balance ?? 0),
            enabled: settings.enabled === true,
            defaultPercent: Number(settings.default_percent),
            minRedeemOrder: Number(settings.min_redeem_order),
            maxRedeemPercent: Number(settings.max_redeem_percent)
        });

    } catch (error) {
        console.error('BONUS BALANCE API ERROR:', {
            code: error?.code || null,
            message: error?.message || String(error)
        });

        sendJson(res, 503, {
            success: false,
            message: 'Bonus balansini hozircha yuklab bo‘lmadi.'
        });
    }

    return true;
}

module.exports = { handleBonusRoutes };
