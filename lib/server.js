const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const https = require('https');
const telegramAgent = new https.Agent({ family: 4 });
const { createClient } = require('@supabase/supabase-js');
const XLSX = require('xlsx');
const { placeOrder } = require('./orders.js');
const { escapeHtml, adminTokenIsValid, resolveImagePath } = require('./security.js');
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
);

// 1. BotFather bergan tokeningiz
const BOT_TOKEN = process.env.BOT_TOKEN;
// 2. GitHub Pages havolangiz
const WEB_APP_URL = process.env.WEB_APP_URL;
const bot = new Telegraf(BOT_TOKEN, {
    telegram: {
        agent: telegramAgent
    }
});
function parseBody(req) {
    return new Promise((resolve, reject) => {
        let body = '';

        req.on('data', chunk => {
            body += chunk;
        });

        req.on('end', () => {
            try {
                resolve(body ? JSON.parse(body) : {});
            } catch (error) {
                reject(error);
            }
        });

        req.on('error', reject);
    });
}

async function createPromotionExcel(promotionId, createdAt) {
    const date = new Date(createdAt).toISOString().slice(0, 10);
    const folder = `Aksiyalar/${date}`;
    const filePath = `${folder}/aksiya-${date}-${promotionId}.xlsx`;

    const workbook = XLSX.utils.book_new();

    const worksheet = XLSX.utils.aoa_to_sheet([
        ['Ishtirok raqami', 'Telefon', 'Ism', 'Username', 'Qo‘shilgan sana']
    ]);

    XLSX.utils.book_append_sheet(workbook, worksheet, 'Ishtirokchilar');

    const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
    });

    const { error } = await supabase.storage
        .from('aksiyalar')
        .upload(filePath, buffer, {
            contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: true
        });

    if (error) throw error;

    return filePath;
}

async function updatePromotionExcel(promotionId, excelPath) {
    const { data: game, error: gameError } = await supabase
        .from('promotion_settings').select('id, created_at, excel_path, excel_revision')
        .eq('id', promotionId).maybeSingle();
    if (gameError) throw gameError;
    if (!game) throw new Error('Aksiya topilmadi');
    const date = new Date(game.created_at).toISOString().slice(0, 10);
    const revision = Number(game.excel_revision) || 0;
    excelPath = `Aksiyalar/${date}/aksiya-${date}-${promotionId}-v${revision}.xlsx`;
    // Supabase returns a limited number of rows per request; export every page.
    const participants = [];
    for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
            .from('promotion_participants')
            .select('participant_number, phone, customer_name, customer_username, created_at')
            .eq('promotion_id', promotionId)
            .order('participant_number', { ascending: true })
            .range(offset, offset + 499);
        if (error) throw error;
        participants.push(...(data || []));
        if (!data || data.length < 500) break;
    }

    const rows = [
        ['Ishtirok raqami', 'Telefon', 'Ism', 'Username', 'Qo‘shilgan sana'],
        ...(participants || []).map(item => [
            item.participant_number,
            item.phone || '',
            item.customer_name || '',
            item.customer_username || '',
            item.created_at || ''
        ])
    ];

    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.aoa_to_sheet(rows);

    XLSX.utils.book_append_sheet(
        workbook,
        worksheet,
        'Ishtirokchilar'
    );

    const buffer = XLSX.write(workbook, {
        type: 'buffer',
        bookType: 'xlsx'
    });

    const { error: uploadError } = await supabase.storage
        .from('aksiyalar')
        .upload(excelPath, buffer, {
            contentType:
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            upsert: true
        });

    if (uploadError) throw uploadError;
    const { data: published, error: pathError } = await supabase.from('promotion_settings')
        .update({ excel_path: excelPath }).eq('id', promotionId).eq('excel_revision', revision).select('id');
    if (pathError) throw pathError;
    // Only delete a previous file owned by this game. Date-only legacy paths can be shared.
    if (published?.length && game.excel_path && game.excel_path !== excelPath
        && game.excel_path.startsWith(`Aksiyalar/${date}/aksiya-${date}-${promotionId}`)
        && new RegExp(`-${promotionId}(?:-v[0-9]+)?\\.xlsx$`).test(game.excel_path)) {
        try { await supabase.storage.from('aksiyalar').remove([game.excel_path]); }
        catch (_) { /* A leftover old export must not fail a download/order. */ }
    }
    return buffer;
}

const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_TELEGRAM_ID = String(process.env.ADMIN_TELEGRAM_ID || '').trim();

if (!ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD .env faylda topilmadi!');
}

function validateTelegramInitData(initData) {
    const params = new URLSearchParams(initData || "");
    const hash = params.get("hash");
    if (!hash) return null;
    params.delete("hash");
    const dataCheckString = [...params.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join("\n");
    const secretKey = crypto.createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
    const calculatedHash = crypto.createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (hash !== calculatedHash) return null;

    const authDate = Number(params.get("auth_date"));
    if (!authDate || Math.floor(Date.now() / 1000) - authDate > 86400) return null;

    const user = params.get("user");
    try {
        return user ? JSON.parse(user) : null;
    } catch {
        return null;
    }
}

// /start buyrug'i yuborilganda
bot.start(async (ctx) => {
    console.log('VERCEL WEB_APP_URL:', process.env.WEB_APP_URL);

    await ctx.reply(
        `Xush kelibsiz, ${ctx.from.first_name}! Do'konimizdan xarid qilish uchun tugmani bosing:`,
        Markup.keyboard([
            [
                Markup.button.webApp(
                    '🛒 Do\'konni ochish',
                    WEB_APP_URL + '?userId=' + ctx.from.id
                )
            ]
        ]).resize()
    );
});

// Web App'dan buyurtma ma'lumotlarini qabul qilish
bot.on('web_app_data', async (ctx) => {
    try {
const rawData = ctx.webAppData?.data;





if (!rawData) {
    throw new Error('Web App data kelmadi');
}

let data;



if (typeof rawData === 'string') {
    data = JSON.parse(rawData);
} else if (typeof rawData.json === 'function') {
    data = await rawData.json();
} else if (typeof rawData === 'object') {
    data = rawData;
} else {
    throw new Error('Web App data formati noma’lum');
}



// MAHSULOT TOPISH SO‘ROVI
if (data.type === 'product_request') {
    const customerId = String(ctx.from?.id || '');
    const customerName = ctx.from?.first_name || 'Noma’lum';
    const customerUsername = ctx.from?.username || '';
    const requestText = data.text || '';
    const imageUrl = data.imageUrl || '';

    const { error: requestError } = await supabase
        .from('product_requests')
        .insert({
            customer_id: customerId,
            customer_name: customerName,
            customer_username: customerUsername,
            message: requestText,
            image_url: imageUrl,
            status: 'Yangi'
        });

    if (requestError) {
        throw requestError;
    }

    let customerDisplay = customerUsername
        ? `@${escapeHtml(customerUsername)}`
        : customerName;

    let adminMessage =
        `🔎 <b>YANGI MAHSULOT SO‘ROVI</b>\n\n` +
        `👤 <b>Mijoz:</b> ${escapeHtml(customerDisplay)}\n\n` +
        `💬 <b>So‘rov:</b>\n${escapeHtml(requestText || 'Matn yozilmagan')}\n\n`;

    if (imageUrl) {
        adminMessage += `🖼 <b>Rasm:</b> ${escapeHtml(imageUrl)}\n\n`;
    }

    adminMessage += `📌 <b>Holat:</b> Yangi`;

    const customerChatUrl = customerUsername
        ? `https://t.me/${escapeHtml(customerUsername)}`
        : `tg://user?id=${customerId}`;

    await bot.telegram.sendMessage(
        ADMIN_TELEGRAM_ID,
        adminMessage,
        {
            parse_mode: 'HTML',
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: '💬 Mijozga yozish',
                            url: customerChatUrl
                        }
                    ]
                ]
            }
        }
    );

    await ctx.reply('✅ Mahsulot so‘rovingiz adminga yuborildi!');

    return;
}


// Database RPC commits the order, inventory, coupon and participant together.
const saved = await placeOrder(supabase, data, ctx);
const orderRecord = saved.order;
const orderNumber = orderRecord.id;
const orderDate = orderRecord.order_date;
const serverItems = orderRecord.items;
const serverOriginalTotal = Number(orderRecord.original_total);
const serverProductDiscountAmount = Number(orderRecord.product_discount_amount);
const serverCouponDiscountAmount = Number(orderRecord.coupon_discount_amount);
const serverTotal = Number(orderRecord.total);
const participantNumber = orderRecord.participant_number;
const newParticipant = saved.new_participant === true;

if (saved.duplicate) {
    await ctx.reply(`Bu buyurtma avval qabul qilingan: ${orderNumber}. Takroran saqlanmadi.`);
    return;
}

// Export failure must never turn a committed order into a reported order failure.
if (newParticipant && orderRecord.promotion_id) {
    try { await updatePromotionExcel(orderRecord.promotion_id); }
    catch (error) { console.error('BUYURTMA SAQLANDI, EXCEL YANGILANMADI:', orderRecord.promotion_id, error.message); }
}

console.log("Buyurtma saqlandi:", orderNumber);

        const items = serverItems;

        const itemsList = items.length
            ? items.map(item =>
`• <b>${escapeHtml(item.name)}</b>${item.variant ? ` — ${escapeHtml(item.variant)}` : ''} (${item.count} ta) - ${(item.price * item.count).toLocaleString()} so'm`
            ).join('\n')
            : 'Mahsulot kiritilmadi';

const message =
    `🛍 <b>YANGI BUYURTMA</b>\n\n` +
    `🔢 <b>Buyurtma:</b> ${orderNumber}\n` +
    `🕒 <b>Sana:</b> ${orderDate}\n\n` +
    `<b>📦 Mahsulotlar:</b>\n${itemsList}\n\n` +
    `${Number(serverProductDiscountAmount) > 0 ? `💵 <b>Asl summa:</b> ${(Number(serverOriginalTotal) || 0).toLocaleString()} so'm\n` : ""}` +
    `${Number(serverProductDiscountAmount) > 0 ? `🏷 <b>Mahsulot chegirmasi:</b> -${Number(serverProductDiscountAmount).toLocaleString()} so'm\n` : ""}` +
    `${Number(serverCouponDiscountAmount) > 0 ? `🎟 <b>Kupon chegirmasi:</b> -${Number(serverCouponDiscountAmount).toLocaleString()} so'm\n` : ""}` +
    `💰 <b>Jami summa:</b> ${(Number(serverTotal) || 0).toLocaleString()} so'm\n\n` +
    `📞 <b>Telefon:</b> ${escapeHtml(orderRecord.phone || 'Kiritilmadi')}\n` +
    `📍 <b>Manzil:</b> ${escapeHtml(orderRecord.address || 'Kiritilmadi')}\n\n` +
    `👤 <b>Mijoz:</b> ${escapeHtml(ctx.from?.first_name || 'Noma')}` +
    `${ctx.from?.username ? ` (@${ctx.from.username})` : ''}\n\n` +
    `<i>Tez orada operatorimiz siz bilan bog‘lanadi!</i>`;

        try {
            const customerId = String(ctx.from?.id || '');
            const customerUsername = ctx.from?.username || '';

            const customerChatUrl = customerUsername
                ? `https://t.me/${escapeHtml(customerUsername)}`
                : `tg://user?id=${customerId}`;

            await bot.telegram.sendMessage(
                ADMIN_TELEGRAM_ID,
                message,
                {
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                {
                                    text: '💬 Mijozga yozish',
                                    url: customerChatUrl
                                }
                            ]
                        ]
                    }
                }
            );
            console.log("ADMIN XABARI YUBORILDI");
        } catch (adminError) {
            console.error("ADMIN XABAR XATOSI:", adminError);
        }

        try {
            await ctx.replyWithHTML(message);
            console.log("MIJOZ XABARI YUBORILDI");

            if (newParticipant && participantNumber !== null) {
                try {
                    await ctx.replyWithHTML(
                        `🎉 <b>Siz aksiya yoki o‘yin ishtirokchisiga aylandingiz!</b>\n\n` +
                        `🎟 <b>Sizning ishtirok raqamingiz:</b> ${participantNumber}\n\n` +
                        `Bu raqam sizga aksiya davomida bir marta beriladi. ` +
                        `Keyingi buyurtmalaringizda yangi raqam berilmaydi.`
                    );
                    console.log("AKSIYA RAQAMI MIJOZGA YUBORILDI");
                } catch (promotionError) {
                    console.error("AKSIYA XABARI XATOSI:", promotionError);
                }
            }
        } catch (customerError) {
            console.error("MIJOZ XABAR XATOSI:", customerError);
        }

    } catch (error) {
        console.error('BUYURTMA XATOSI:', error);

        await ctx.reply(
            error.customerMessage || 'Buyurtmani qayta ishlashda xatolik yuz berdi. Iltimos, qaytadan urinib ko‘ring.'
        );
    }
});
const http = require('http');
const fs = require('fs');
const path = require('path');
const PROJECT_ROOT = path.join(__dirname, '..');
const crypto = require('crypto');
const PORT = 3000;
const webServer = http.createServer(async (req, res) => {

    const url = new URL(req.url, 'http://localhost');

    const sendJson = (status, data) => {
        res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8'
        });
        res.end(JSON.stringify(data));
    };

    // ADMIN LOGIN
    if (url.pathname === '/api/admin/login' && req.method === 'POST') {
        try {
            const data = await parseBody(req);

            if (!ADMIN_PASSWORD || data.password !== ADMIN_PASSWORD) {
                return sendJson(401, {
                    success: false,
                    message: 'Parol noto‘g‘ri'
                });
            }

const token = crypto
    .createHash('sha256')
    .update(ADMIN_PASSWORD)
    .digest('hex');

return sendJson(200, {
    success: true,
    token: token
});
        } catch (error) {
            console.error('LOGIN XATOSI:', error);

            return sendJson(400, {
                success: false,
                message: 'Noto‘g‘ri ma’lumot'
            });
        }
    }

    // ADMIN AUTH
    const authorization = req.headers.authorization || '';
    const token = authorization.startsWith('Bearer ')
        ? authorization.slice(7)
        : '';

const isAdmin = adminTokenIsValid(token, ADMIN_PASSWORD);
    // MAHSULOTLARNI OLISH
    if (url.pathname === '/api/admin/products' && req.method === 'GET') {
        if (!isAdmin) {
            return sendJson(401, {
                success: false,
                message: 'Ruxsat yo‘q'
            });
        }

        try {

const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('id', { ascending: true });

if (error) {
    console.error('SUPABASE PRODUCT GET XATOSI:', error);

    return sendJson(500, {
        success: false,
        message: 'Mahsulotlarni Supabase dan o‘qib bo‘lmadi'
    });
}

const products = data.map(product => ({
    id: product.id,
    name: product.name,
    category: product.category,
    desc: product.description || '',
    price: Number(product.price) || 0,
    img: product.image || '',
    active: product.active !== false,
    stock: Number(product.stock) || 0,
                size: product.size || "",
                variants: Array.isArray(product.variants) ? product.variants : [],
                country_id: product.country_id || null,
}));

return sendJson(200, products);

        } catch (error) {
            console.error('PRODUCT GET XATOSI:', error);

            return sendJson(500, {
                success: false,
                message: 'Mahsulotlarni o‘qib bo‘lmadi'
            });
        }
    }


// BEPUL YETKAZIB BERISH SOZLAMASINI OLISH
if (url.pathname === '/api/admin/shop-settings' && req.method === 'GET') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const { data, error } = await supabase
            .from('shop_settings')
            .select('id, free_delivery_enabled, free_delivery_min_amount')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return sendJson(200, {
            success: true,
            settings: data || {
                free_delivery_enabled: false,
                free_delivery_min_amount: 0
            }
        });

    } catch (error) {
        console.error('SHOP SETTINGS GET XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Yetkazib berish sozlamasini o‘qib bo‘lmadi'
        });
    }
}


// BEPUL YETKAZIB BERISH SOZLAMASINI SAQLASH
if (url.pathname === '/api/admin/shop-settings' && req.method === 'PUT') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const data = await parseBody(req);

        const freeDeliveryEnabled =
            data.freeDeliveryEnabled === true;

        const freeDeliveryMinAmount = Math.max(
            0,
            Math.round(Number(data.freeDeliveryMinAmount) || 0)
        );

        const { data: existing, error: findError } = await supabase
            .from('shop_settings')
            .select('id')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (findError) {
            throw findError;
        }

        let result;

        if (existing) {
            result = await supabase
                .from('shop_settings')
                .update({
                    free_delivery_enabled: freeDeliveryEnabled,
                    free_delivery_min_amount: freeDeliveryMinAmount,
                    updated_at: new Date().toISOString()
                })
                .eq('id', existing.id)
                .select('id, free_delivery_enabled, free_delivery_min_amount')
                .single();
        } else {
            result = await supabase
                .from('shop_settings')
                .insert({
                    free_delivery_enabled: freeDeliveryEnabled,
                    free_delivery_min_amount: freeDeliveryMinAmount
                })
                .select('id, free_delivery_enabled, free_delivery_min_amount')
                .single();
        }

        if (result.error) {
            throw result.error;
        }

        return sendJson(200, {
            success: true,
            settings: result.data
        });

    } catch (error) {
        console.error('SHOP SETTINGS SAVE XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Yetkazib berish sozlamasini saqlab bo‘lmadi'
        });
    }
}


// Aksiya / O‘yin history. Banner promotions use separate /promotions routes.
const gameRoute = url.pathname.match(/^\/api\/admin\/promotion-games(?:\/([1-9]\d*)(?:\/(participants|excel|toggle))?)?$/);
if (gameRoute) {
    if (!isAdmin) return sendJson(401, { success: false, message: 'Ruxsat yo‘q' });
    res.setHeader('Cache-Control', 'no-store');
    const id = gameRoute[1];
    const action = gameRoute[2];
    const page = Number(url.searchParams.get('page') || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
        return sendJson(400, { success: false, message: 'Sahifa raqami noto‘g‘ri' });
    }
    try {
        if (!id && req.method === 'GET') {
            const pageSize = 20;
            const { data, error, count } = await supabase.from('promotion_settings')
                .select('id, enabled, start_at, end_at, min_number, max_number, created_at, excel_path', { count: 'exact' })
                .order('id', { ascending: false })
                .range((page - 1) * pageSize, page * pageSize - 1);
            if (error) throw error;
            const { data: latest, error: latestError } = await supabase.from('promotion_settings')
                .select('id').order('updated_at', { ascending: false, nullsFirst: false })
                .order('id', { ascending: false }).limit(1).maybeSingle();
            if (latestError) throw latestError;
            return sendJson(200, { success: true, games: data || [], total: count || 0,
                page, pageSize, latestId: latest?.id || null });
        }
        if (!id || !((req.method === 'GET' && ['participants', 'excel'].includes(action))
            || (req.method === 'PATCH' && action === 'toggle')
            || (req.method === 'DELETE' && !action))) {
            return sendJson(405, { success: false, message: 'Bu amal qo‘llab-quvvatlanmaydi' });
        }
        const { data: game, error: findError } = await supabase.from('promotion_settings')
            .select('id, enabled, start_at, end_at, created_at, excel_path').eq('id', id).maybeSingle();
        if (findError) throw findError;
        if (!game) return sendJson(404, { success: false, message: 'Aksiya topilmadi' });
        if (action === 'toggle') {
            let body;
            try { body = await parseBody(req); }
            catch (_) { return sendJson(400, { success: false, message: 'So‘rov formati noto‘g‘ri' }); }
            if (!body || typeof body.enabled !== 'boolean') {
                return sendJson(400, { success: false, message: 'enabled true yoki false bo‘lishi kerak' });
            }
            if (body.enabled && game.end_at && new Date(game.end_at).getTime() <= Date.now()) {
                return sendJson(400, { success: false, message: 'Bu aksiyaning muddati tugagan. Uni qayta yoqib bo‘lmaydi.' });
            }
            // Activating an existing game selects it without creating a new ID.
            // Pausing keeps that selection, so a previous game cannot resume by itself.
            const changes = { enabled: body.enabled };
            if (body.enabled) changes.updated_at = new Date().toISOString();
            const { data: settings, error } = await supabase.from('promotion_settings')
                .update(changes).eq('id', id)
                .select('id, enabled, start_at, end_at, min_number, max_number, created_at, excel_path')
                .maybeSingle();
            if (error) throw error;
            if (!settings) return sendJson(404, { success: false, message: 'Aksiya topilmadi' });
            const scheduled = body.enabled && game.start_at && new Date(game.start_at).getTime() > Date.now();
            return sendJson(200, { success: true, settings, message: !body.enabled
                ? 'Aksiya to‘xtatildi.' : scheduled
                ? 'Aksiya yoqildi. Belgilangan boshlanish sanasida ishga tushadi.' : 'Aksiya yoqildi.' });
        }
        if (action === 'participants') {
            const pageSize = 50;
            const { data, error, count } = await supabase.from('promotion_participants')
                .select('participant_number, phone, customer_name, customer_username, created_at', { count: 'exact' })
                .eq('promotion_id', id).order('participant_number', { ascending: true })
                .range((page - 1) * pageSize, page * pageSize - 1);
            if (error) throw error;
            return sendJson(200, { success: true, participants: data || [], total: count || 0, page, pageSize });
        }
        if (action === 'excel') {
            // Rebuild from this promotion's participants before downloading.
            const buffer = await updatePromotionExcel(id, game.excel_path);
            res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="aksiya-${id}.xlsx"`
            });
            return res.end(buffer);
        }
        // Preserve a shared legacy Excel file if another promotion references it.
        let shared = false;
        if (game.excel_path) {
            const { count, error } = await supabase.from('promotion_settings')
                .select('id', { count: 'exact', head: true }).eq('excel_path', game.excel_path).neq('id', id);
            if (error) throw error;
            shared = count > 0;
        }
        const { error: stopError } = await supabase.from('promotion_settings')
            .update({ enabled: false }).eq('id', id);
        if (stopError) throw stopError;
        const { error: participantsError } = await supabase.from('promotion_participants')
            .delete().eq('promotion_id', id);
        if (participantsError) throw participantsError;
        const { error: deleteError } = await supabase.from('promotion_settings').delete().eq('id', id);
        if (deleteError) throw deleteError;
        let warning = '';
        if (game.excel_path && !shared) {
            try {
                const { error } = await supabase.storage.from('aksiyalar').remove([game.excel_path]);
                if (error) throw error;
            } catch (error) {
                console.error('AKSIYA EXCEL DELETE:', error);
                warning = 'Aksiya o‘chirildi, ammo saqlangan Excel faylini tozalab bo‘lmadi.';
            }
        }
        return sendJson(200, { success: true, warning });
    } catch (error) {
        console.error('AKSIYA O‘YIN ADMIN:', error);
        return sendJson(500, { success: false, message: req.method === 'DELETE'
            ? 'O‘chirish to‘liq tugamadi. Ro‘yxatni yangilang va qayta urinib ko‘ring.'
            : 'Aksiya ma’lumotlarini yuklab bo‘lmadi. Qayta urinib ko‘ring.' });
    }
}

// AKSIYA SOZLAMASINI OLISH
if (url.pathname === '/api/admin/promotion-settings' && req.method === 'GET') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const { data, error } = await supabase
            .from('promotion_settings')
            .select('id, enabled, start_at, end_at, min_number, max_number, created_at, excel_path')
            .order('updated_at', { ascending: false, nullsFirst: false })
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (error) throw error;

        return sendJson(200, {
            success: true,
            settings: data || {
                enabled: false,
                start_at: null,
                end_at: null,
                min_number: 1000,
                max_number: 9999
            }
        });

    } catch (error) {
        console.error('PROMOTION SETTINGS GET XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Aksiya sozlamasini o‘qib bo‘lmadi'
        });
    }
}


// AKSIYA SOZLAMASINI SAQLASH
if (url.pathname === '/api/admin/promotion-settings' && req.method === 'PUT') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const data = await parseBody(req);

        const enabled = data.enabled === true;
        const startAt = data.startAt ? new Date(data.startAt).toISOString() : null;
        const endAt = data.endAt ? new Date(data.endAt).toISOString() : null;

        const minNumber = Math.max(
            1,
            Math.round(Number(data.minNumber) || 1)
        );

        const maxNumber = Math.max(
            minNumber,
            Math.round(Number(data.maxNumber) || minNumber)
        );

        if (startAt && endAt && new Date(startAt) >= new Date(endAt)) {
            return sendJson(400, {
                success: false,
                message: 'Boshlanish sanasi tugash sanasidan oldin bo‘lishi kerak'
            });
        }


        let result;

        const settings = {
            enabled,
            start_at: startAt,
            end_at: endAt,
            min_number: minNumber,
            max_number: maxNumber,
            updated_at: new Date().toISOString()
        };

result = await supabase
    .from('promotion_settings')
    .insert(settings)
    .select('id, enabled, start_at, end_at, min_number, max_number, created_at')
    .single();

if (result.error) throw result.error;

const excelPath = await createPromotionExcel(
    result.data.id,
    result.data.created_at
);

const { error: excelPathError } = await supabase
    .from('promotion_settings')
    .update({
        excel_path: excelPath
    })
    .eq('id', result.data.id);

if (excelPathError) throw excelPathError;

result.data.excel_path = excelPath;


        return sendJson(200, {
            success: true,
            settings: result.data
        });

    } catch (error) {
        console.error('PROMOTION SETTINGS PUT XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Aksiya sozlamasini saqlab bo‘lmadi'
        });
    }
}


// PUBLIC BEPUL YETKAZIB BERISH SOZLAMASI
if (url.pathname === '/api/shop-settings' && req.method === 'GET') {
    try {
        const { data, error } = await supabase
            .from('shop_settings')
            .select('free_delivery_enabled, free_delivery_min_amount')
            .order('id', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (error) {
            throw error;
        }

        return sendJson(200, {
            success: true,
            settings: data || {
                free_delivery_enabled: false,
                free_delivery_min_amount: 0
            }
        });

    } catch (error) {
        console.error('PUBLIC SHOP SETTINGS XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Yetkazib berish sozlamasini o‘qib bo‘lmadi'
        });
    }
}


// PUBLIC DAVLATLARNI OLISH
if (url.pathname === '/api/countries' && req.method === 'GET') {
    try {
        const { data, error } = await supabase
            .from('countries')
            .select('id, name, flag')
            .order('id', { ascending: true });

        if (error) {
            throw error;
        }

        return sendJson(200, data || []);
    } catch (error) {
        console.error('COUNTRIES GET XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Davlatlarni o‘qib bo‘lmadi'
        });
    }
}

// PUBLIC KATEGORIYALARNI OLISH
if (url.pathname === '/api/categories' && req.method === 'GET') {
    try {
        const { data, error } = await supabase
            .from('categories')
            .select('id, name, parent_id, image')
            .order('id', { ascending: true });

        if (error) {
            throw error;
        }

        return sendJson(200, data || []);
    } catch (error) {
        console.error('PUBLIC CATEGORIES XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Kategoriyalarni yuklab bo‘lmadi'
        });
    }
}


// KATEGORIYALARNI OLISH
if (url.pathname === '/api/admin/categories' && req.method === 'GET') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const { data, error } = await supabase
            .from('categories')
            .select('*')
            .order('id', { ascending: true });

        if (error) {
            throw error;
        }

        return sendJson(200, data);
    } catch (error) {
        console.error('CATEGORY GET XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Kategoriyalarni o‘qib bo‘lmadi'
        });
    }
}

// YANGI KATEGORIYA QO‘SHISH
if (url.pathname === '/api/admin/categories' && req.method === 'POST') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const data = await parseBody(req);
        const name = String(data.name || '').trim();
        const parent_id = data.parent_id !== undefined
            ? (data.parent_id ? Number(data.parent_id) : null)
            : undefined;

        const image = data.image !== undefined ? String(data.image || "").trim() : undefined;
        const discountPercent = Math.min(100, Math.max(0, Number(data.discountPercent) || 0));
        const discountActive = Boolean(data.discountActive);


        if (!name) {
            return sendJson(400, {
                success: false,
                message: 'Kategoriya nomini kiriting'
            });
        }

        const { data: savedCategory, error } = await supabase
            .from('categories')
            .insert({
                name,
                ...(parent_id !== undefined ? { parent_id } : {}),
                ...(image !== undefined ? { image } : {}),
                discount_percent: discountPercent,
                discount_active: discountActive
            })
            .select('*')
            .single();

        if (error) {
            if (error.code === '23505') {
                return sendJson(400, {
                    success: false,
                    message: 'Bu kategoriya allaqachon mavjud'
                });
            }

            throw error;
        }

        return sendJson(200, {
            success: true,
            category: savedCategory
        });
    } catch (error) {
        console.error('CATEGORY ADD XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Kategoriyani qo‘shib bo‘lmadi'
        });
    }
}


// KATEGORIYA NOMINI O‘ZGARTIRISH
if (url.pathname.startsWith('/api/admin/categories/') && req.method === 'PUT') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const id = Number(url.pathname.split('/').pop());
        const data = await parseBody(req);
        const name = String(data.name || '').trim();
        const parent_id = data.parent_id !== undefined
            ? (data.parent_id ? Number(data.parent_id) : null)
            : undefined;

        const image = data.image !== undefined
            ? String(data.image || "").trim()
            : undefined;
        const discountPercent = Math.min(100, Math.max(0, Number(data.discountPercent) || 0));
        const discountActive = Boolean(data.discountActive);

        if (!id || !name) {
            return sendJson(400, {
                success: false,
                message: 'Kategoriya ID va nomi majburiy'
            });
        }

        const { data: updatedCategory, error } = await supabase
            .from('categories')
            .update({
                name,
                ...(parent_id !== undefined ? { parent_id } : {}),
                ...(image !== undefined ? { image } : {}),
                discount_percent: discountPercent,
                discount_active: discountActive
            })
            .eq('id', id)
            .select('*')
            .single();

        if (error) {
            if (error.code === '23505') {
                return sendJson(400, {
                    success: false,
                    message: 'Bu kategoriya allaqachon mavjud'
                });
            }

            throw error;
        }

        return sendJson(200, {
            success: true,
            category: updatedCategory
        });
    } catch (error) {
        console.error('CATEGORY UPDATE XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Kategoriyani o‘zgartirib bo‘lmadi'
        });
    }
}

// KATEGORIYANI O‘CHIRISH
if (url.pathname.startsWith('/api/admin/categories/') && req.method === 'DELETE') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const id = Number(url.pathname.split('/').pop());

        if (!id) {
            return sendJson(400, {
                success: false,
                message: 'Kategoriya ID noto‘g‘ri'
            });
        }

        const { error } = await supabase
            .from('categories')
            .delete()
            .eq('id', id);

        if (error) {
            throw error;
        }

        return sendJson(200, {
            success: true,
            message: 'Kategoriya o‘chirildi'
        });
    } catch (error) {
        console.error('CATEGORY DELETE XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Kategoriyani o‘chirib bo‘lmadi'
        });
    }
}


// KUPONLARNI OLISH
if (url.pathname === "/api/admin/coupons" && req.method === "GET") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const { data: coupons, error } = await supabase
            .from("coupons")
            .select("*")
            .order("id", { ascending: false });

        if (error) {
            throw error;
        }

        return sendJson(200, {
            success: true,
            coupons: coupons || []
        });

    } catch (error) {
        console.error("COUPON GET XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kuponlarni olib bo‘lmadi"
        });
    }
}


// KUPON YARATISH
if (url.pathname === "/api/admin/coupons" && req.method === "POST") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const data = await parseBody(req);

        const code = String(data.code || "").trim().toUpperCase();
        const discountPercent = Math.min(100, Math.max(0, Number(data.discountPercent) || 0));
        const minOrderAmount = Math.max(0, Number(data.minOrderAmount) || 0);
        const usageLimit = data.usageLimit ? Math.max(1, Number(data.usageLimit)) : null;
        const startAt = data.startAt || null;
        const endAt = data.endAt || null;
        const active = data.active !== false;

        if (!code) {
            return sendJson(400, {
                success: false,
                message: "Kupon kodi kiritilmagan"
            });
        }

        if (discountPercent <= 0) {
            return sendJson(400, {
                success: false,
                message: "Chegirma foizi 0 dan katta bo‘lishi kerak"
            });
        }

        const { data: coupon, error } = await supabase
            .from("coupons")
            .insert({
                code,
                discount_percent: discountPercent,
                min_order_amount: minOrderAmount,
                usage_limit: usageLimit,
                used_count: 0,
                start_at: startAt,
                end_at: endAt,
                active
            })
            .select()
            .single();

        if (error) {
            console.error("COUPON CREATE XATOSI:", error);

            return sendJson(400, {
                success: false,
                message: error.code === "23505"
                    ? "Bu kupon kodi allaqachon mavjud"
                    : "Kupon yaratib bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            coupon
        });

    } catch (error) {
        console.error("COUPON CREATE XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kupon yaratishda xatolik"
        });
    }
}


// KUPONNI FAOLLASHTIRISH / O‘CHIRISH
if (url.pathname === "/api/admin/coupons/toggle" && req.method === "PATCH") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const data = await parseBody(req);
        const couponId = Number(data.id);

        if (!couponId) {
            return sendJson(400, {
                success: false,
                message: "Kupon ID kiritilmagan"
            });
        }

        const active = Boolean(data.active);

        const { data: coupon, error } = await supabase
            .from("coupons")
            .update({ active })
            .eq("id", couponId)
            .select()
            .single();

        if (error) {
            console.error("COUPON TOGGLE XATOSI:", error);

            return sendJson(400, {
                success: false,
                message: "Kupon holatini o‘zgartirib bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            coupon
        });

    } catch (error) {
        console.error("COUPON TOGGLE XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kupon holatini o‘zgartirishda xatolik"
        });
    }
}


// KUPONNI O‘CHIRISH
if (url.pathname === "/api/admin/coupons/delete" && req.method === "POST") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const data = await parseBody(req);
        const couponId = Number(data.id);

        if (!couponId) {
            return sendJson(400, {
                success: false,
                message: "Kupon ID kiritilmagan"
            });
        }

        const { error } = await supabase
            .from("coupons")
            .delete()
            .eq("id", couponId);

        if (error) {
            console.error("COUPON DELETE XATOSI:", error);

            return sendJson(400, {
                success: false,
                message: "Kuponni o‘chirib bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            message: "Kupon o‘chirildi"
        });

    } catch (error) {
        console.error("COUPON DELETE XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kuponni o‘chirishda xatolik"
        });
    }
}


// AKSIYA VA MAXSUS TAKLIFLAR
if (url.pathname === "/api/admin/promotions" && req.method === "GET") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const { data, error } = await supabase
            .from("promotions")
            .select("*")
            .order("id", { ascending: true });

        if (error) {
            console.error("PROMOTIONS GET XATOSI:", error);
            return sendJson(400, {
                success: false,
                message: "Aksiyalarni olishda xatolik"
            });
        }

        return sendJson(200, {
            success: true,
            promotions: data || []
        });

    } catch (error) {
        console.error("PROMOTIONS GET XATOSI:", error);
        return sendJson(500, {
            success: false,
            message: "Aksiyalarni olishda xatolik"
        });
    }
}


// AKSIYANI SAQLASH / YANGILASH
if (url.pathname === "/api/admin/promotions" && req.method === "POST") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const data = await parseBody(req);

        const type = String(data.type || "").trim();
        const title = String(data.title || "").trim();
        const description = String(data.description || "").trim();
        const imageUrl = data.imageUrl
            ? String(data.imageUrl).trim()
            : null;
        const couponCode = data.couponCode
            ? String(data.couponCode).trim().toUpperCase()
            : null;
        const active = data.active !== false;

        if (!["daily_offer", "special_offer"].includes(type)) {
            return sendJson(400, {
                success: false,
                message: "Aksiya turi noto‘g‘ri"
            });
        }


        const { data: promotion, error } = await supabase
            .from("promotions")
            .upsert({
                type,
                title,
                description,
                image_url: imageUrl,
                coupon_code: couponCode,
                active,
                updated_at: new Date().toISOString()
            }, {
                onConflict: "type"
            })
            .select()
            .single();

        if (error) {
            console.error("PROMOTION SAVE XATOSI:", error);
            return sendJson(400, {
                success: false,
                message: "Aksiyani saqlab bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            message: "Aksiya saqlandi",
            promotion
        });

    } catch (error) {
        console.error("PROMOTION SAVE XATOSI:", error);
        return sendJson(500, {
            success: false,
            message: "Aksiyani saqlashda xatolik"
        });
    }
}


// AKSIYA RASMINI O‘CHIRISH
if (url.pathname === "/api/admin/promotions/image-delete" && req.method === "POST") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const data = await parseBody(req);

        const promotionId = Number(data.id);

        if (!promotionId) {
            return sendJson(400, {
                success: false,
                message: "Aksiya ID kiritilmagan"
            });
        }

        const { data: promotion, error: findError } = await supabase
            .from("promotions")
            .select("id, image_url")
            .eq("id", promotionId)
            .single();

        if (findError || !promotion) {
            return sendJson(404, {
                success: false,
                message: "Aksiya topilmadi"
            });
        }

        const { data: updatedPromotion, error: updateError } = await supabase
            .from("promotions")
            .update({
                image_url: null,
                updated_at: new Date().toISOString()
            })
            .eq("id", promotionId)
            .select()
            .single();

        if (updateError) {
            console.error("PROMOTION IMAGE DELETE XATOSI:", updateError);

            return sendJson(500, {
                success: false,
                message: "Rasmni o‘chirib bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            message: "Rasm o‘chirildi",
            promotion: updatedPromotion
        });

    } catch (error) {
        console.error("PROMOTION IMAGE DELETE XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Rasmni o‘chirishda xatolik"
        });
    }
}


// AKSIYANI YOQISH / O‘CHIRISH
if (url.pathname === "/api/admin/promotions/toggle" && req.method === "PATCH") {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: "Ruxsat yo‘q"
        });
    }

    try {
        const data = await parseBody(req);
        const promotionId = Number(data.id);

        if (!promotionId) {
            return sendJson(400, {
                success: false,
                message: "Aksiya ID kiritilmagan"
            });
        }

        const active = Boolean(data.active);

        const { data: promotion, error } = await supabase
            .from("promotions")
            .update({ active })
            .eq("id", promotionId)
            .select()
            .single();

        if (error) {
            console.error("PROMOTION TOGGLE XATOSI:", error);
            return sendJson(400, {
                success: false,
                message: "Aksiya holatini o‘zgartirib bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            promotion
        });

    } catch (error) {
        console.error("PROMOTION TOGGLE XATOSI:", error);
        return sendJson(500, {
            success: false,
            message: "Aksiya holatini o‘zgartirishda xatolik"
        });
    }
}



// MIJOZ UCHUN FAOL AKSIYALAR
if (url.pathname === "/api/promotions" && req.method === "GET") {
    try {
        const { data, error } = await supabase
            .from("promotions")
            .select("id, type, title, description, image_url, coupon_code, active")
            .eq("active", true)
            .order("id", { ascending: true });

        if (error) {
            console.error("PUBLIC PROMOTIONS XATOSI:", error);

            return sendJson(500, {
                success: false,
                message: "Aksiyalarni olishda xatolik"
            });
        }

        return sendJson(200, {
            success: true,
            promotions: data || []
        });

    } catch (error) {
        console.error("PUBLIC PROMOTIONS XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Aksiyalarni olishda xatolik"
        });
    }
}


// YANGI MAHSULOT QO‘SHISH
if (url.pathname === '/api/admin/products' && req.method === 'POST') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const data = await parseBody(req);

        if (!data.name || !data.category || !data.price) {
            return sendJson(400, {
                success: false,
                message: 'Nom, kategoriya va narx majburiy'
            });
        }

        const { data: lastProduct, error: lastProductError } = await supabase
            .from('products')
            .select('id')
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastProductError) {
            throw lastProductError;
        }

        const newId = lastProduct
            ? Number(lastProduct.id) + 1
            : 1;

        const productRecord = {
            id: newId,
            name: String(data.name).trim(),
            category: String(data.category).trim(),
            description: String(data.desc || '').trim(),
            price: Number(data.price),
            image: String(data.img || '').trim(),
            active: true,
            stock: Math.max(0, Number(data.stock) || 0),
            discount_percent: Math.min(100, Math.max(0, Number(data.discountPercent) || 0)),
            discount_active: Boolean(data.discountActive),
            variants: Array.isArray(data.variants) ? data.variants : [],
            size: String(data.size || '').trim(),
            country_id: data.countryId ? Number(data.countryId) : null,
        };

        const { data: savedProduct, error: insertError } = await supabase
            .from('products')
            .insert(productRecord)
            .select('*')
            .single();

        if (insertError) {
            throw insertError;
        }

        return sendJson(200, {
            success: true,
            product: {
                id: savedProduct.id,
                name: savedProduct.name,
                category: savedProduct.category,
                desc: savedProduct.description || '',
                price: Number(savedProduct.price) || 0,
                img: savedProduct.image || '',
                active: savedProduct.active !== false,
                stock: Number(savedProduct.stock) || 0,
                country_id: savedProduct.country_id || null,
            }
        });

    } catch (error) {
        console.error('PRODUCT ADD XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Mahsulotni saqlab bo‘lmadi'
        });
    }
}

// FOYDALANUVCHI SO‘ROVI UCHUN RASM YUKLASH
if (url.pathname === '/api/upload-request-image' && req.method === 'POST') {
    try {
        const data = await parseBody(req);

        if (!data.image) {
            return sendJson(400, {
                success: false,
                message: 'Rasm yuborilmadi'
            });
        }

        if (data.image.length > 7 * 1024 * 1024) {
            return sendJson(400, {
                success: false,
                message: 'Rasm hajmi juda katta. 5 MB gacha rasm tanlang.'
            });
        }

        const match = data.image.match(
            /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/
        );

        if (!match) {
            return sendJson(400, {
                success: false,
                message: 'Rasm formati noto‘g‘ri'
            });
        }

        const ext = match[1] === 'jpeg' || match[1] === 'jpg'
            ? 'jpg'
            : match[1];

        const buffer = Buffer.from(match[2], 'base64');

        const fileName =
            `request-${Date.now()}-${Math.random().toString(16).slice(2)}.${ext}`;

        const { error: uploadError } = await supabase.storage
            .from('product-images')
            .upload(fileName, buffer, {
                contentType: `image/${ext === 'jpg' ? 'jpeg' : ext}`,
                upsert: false
            });

        if (uploadError) {
            throw uploadError;
        }

        const { data: publicUrlData } = supabase.storage
            .from('product-images')
            .getPublicUrl(fileName);

        return sendJson(200, {
            success: true,
            url: publicUrlData.publicUrl
        });

    } catch (error) {
        console.error('REQUEST IMAGE XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Rasmni saqlab bo‘lmadi'
        });
    }
}



// RASM YUKLASH
if (url.pathname === '/api/admin/upload-image' && req.method === 'POST') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const data = await parseBody(req);

        if (!data.image) {
            return sendJson(400, {
                success: false,
                message: 'Rasm yuborilmadi'
            });
        }

        if (data.image.length > 7 * 1024 * 1024) {
            return sendJson(400, {
                success: false,
                message: 'Rasm hajmi juda katta. 5 MB gacha rasm tanlang.'
            });
        }

        const match = data.image.match(
            /^data:image\/(jpeg|jpg|png|webp);base64,(.+)$/
        );

        if (!match) {
            return sendJson(400, {
                success: false,
                message: 'Faqat JPG, PNG yoki WEBP rasm qabul qilinadi'
            });
        }

        const extension =
            match[1] === 'jpeg' || match[1] === 'jpg'
                ? 'jpg'
                : match[1];

        const imageBuffer = Buffer.from(match[2], 'base64');

        const filename =
            `product-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;

        const { error: uploadError } = await supabase
            .storage
            .from('product-images')
            .upload(filename, imageBuffer, {
                contentType: `image/${extension === 'jpg' ? 'jpeg' : extension}`,
                upsert: false
            });

        if (uploadError) {
            throw uploadError;
        }

        const { data: publicUrlData } = supabase
            .storage
            .from('product-images')
            .getPublicUrl(filename);

        return sendJson(200, {
            success: true,
            path: publicUrlData.publicUrl
        });

    } catch (error) {
        console.error('IMAGE UPLOAD XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Rasmni saqlab bo‘lmadi'
        });
    }
}

// MAHSULOT TOPISH SO‘ROVI
if (url.pathname === '/api/product-requests' && req.method === 'POST') {
    try {
        const data = await parseBody(req);

        const customerId =
            data.telegramUserId
                ? String(data.telegramUserId)
                : '';

        const customerName = data.customerName || 'Noma’lum';
        const customerUsername = data.customerUsername || '';
        const requestText = data.text || '';
        const imageUrl = data.imageUrl || '';

        // 1. Supabase'ga saqlash
        const { error } = await supabase
            .from('product_requests')
            .insert({
                customer_id: customerId,
                customer_name: customerName,
                customer_username: customerUsername,
                message: requestText,
                image_url: imageUrl,
                status: 'Yangi'
            });

        if (error) {
            throw error;
        }

        // 2. Adminga Telegram xabar yuborish
        let adminMessage =
            `🔎 <b>YANGI MAHSULOT SO‘ROVI</b>\n\n` +
            `👤 <b>Mijoz:</b> ${escapeHtml(customerName)}`;

        if (customerUsername) {
            adminMessage += ` (@${escapeHtml(customerUsername)})`;
        }

        adminMessage +=
            `\n🆔 <b>Telegram ID:</b> ${customerId || 'Noma’lum'}\n\n` +
            `💬 <b>So‘rov:</b>\n${escapeHtml(requestText || 'Matn yozilmagan')}\n\n`;

        if (imageUrl) {
            adminMessage += `🖼 <b>Rasm:</b> ${escapeHtml(imageUrl)}\n\n`;
        }

        adminMessage += `📌 <b>Holat:</b> Yangi`;

        await bot.telegram.sendMessage(
            ADMIN_TELEGRAM_ID,
            adminMessage,
            { parse_mode: 'HTML' }
        );

        // 3. Mijozga muvaffaqiyatli javob
        return sendJson(200, {
            success: true,
            message: 'So‘rov yuborildi'
        });

    } catch (error) {
        console.error('PRODUCT REQUEST XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'So‘rovni saqlab yoki adminga yuborib bo‘lmadi'
        });
    }
}

// MIJOZNING BUYURTMALAR TARIXI
if (url.pathname === '/api/my-orders' && req.method === 'GET') {
    const initData = req.headers["x-telegram-init-data"] || "";
    const telegramUser = validateTelegramInitData(initData);

    if (!telegramUser?.id) {
        return sendJson(401, {
            success: false,
            message: "Telegram foydalanuvchisi aniqlanmadi"
        });
    }

    const userId = String(telegramUser.id);

    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .eq('customer_id', String(userId))
            .order('order_date', { ascending: false });

        if (error) {
            throw error;
        }

        const myOrders = (orders || []).map(order => ({
            id: order.id,
            date: order.order_date,
            customer: {
                id: order.customer_id || null,
                name: order.customer_name || 'Noma',
                username: order.customer_username || ''
            },
            items: order.items || [],
            total: Number(order.total) || 0,
            phone: order.phone || '',
            address: order.address || '',
            status: order.status || 'Yangi'
        }));

        return sendJson(200, myOrders);

    } catch (error) {
        console.error('MY ORDERS XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Buyurtmalarni o‘qib bo‘lmadi'
        });
    }
}

// BUYURTMALARNI OLISH
if (url.pathname === '/api/admin/orders' && req.method === 'GET') {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('order_date', { ascending: false });

        if (error) {
            throw error;
        }

        const formattedOrders = (orders || []).map(order => ({
            id: order.id,
            date: order.order_date,
            customer: {
                id: order.customer_id || null,
                name: order.customer_name || 'Noma',
                username: order.customer_username || ''
            },
            items: order.items || [],
            total: Number(order.total) || 0,
            phone: order.phone || '',
            address: order.address || '',
            status: order.status || 'Yangi'
        }));

        return sendJson(200, formattedOrders);

    } catch (error) {
        console.error('ORDERS GET XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Buyurtmalarni o‘qib bo‘lmadi'
        });
    }
}

// BUYURTMA HOLATINI O'ZGARTIRISH
if (
    url.pathname.startsWith('/api/admin/orders/') &&
    req.method === 'PUT'
) {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
const orderId = decodeURIComponent(
    url.pathname.split('/').pop()
);

const data = await parseBody(req);

const allowedStatuses = [
    'Yangi',
    'Qabul qilindi',
    'Tayyorlanmoqda',
    'Yetkazilmoqda',
    'Yakunlandi'
];

if (!allowedStatuses.includes(data.status)) {
    return sendJson(400, {
        success: false,
        message: 'Noto‘g‘ri status'
    });
}

const { data: order, error: orderError } = await supabase
    .from('orders')
    .select('*')
    .eq('id', orderId)
    .single();

if (orderError || !order) {
    return sendJson(404, {
        success: false,
        message: 'Buyurtma topilmadi'
    });
}

const { error: updateError } = await supabase
    .from('orders')
    .update({
        status: data.status
    })
    .eq('id', orderId);

if (updateError) {
    throw updateError;
}

order.status = data.status;

try {
    if (order.customer_id) {
        await bot.telegram.sendMessage(
            Number(order.customer_id),
            `📦 <b>Buyurtmangiz yangilandi!</b>\n\n` +
            `🔢 Buyurtma: <b>${order.id}</b>\n` +
            `📌 Holat: <b>${order.status}</b>\n\n` +
            `Aro'ma Do'kon sizga yaxshi xizmat ko‘rsatishdan mamnun!`,
            {
                parse_mode: 'HTML'
            }
        );
    }
} catch (error) {
    console.error(
        'MIJOZGA STATUS XABARI YUBORILMADI:',
        error.message
    );
}


        return sendJson(200, {
            success: true,
            order: order
        });

    } catch (error) {
        console.error('ORDER STATUS XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Buyurtma holatini saqlab bo‘lmadi'
        });
    }
}

// BUYURTMANI O‘CHIRISH
if (
    url.pathname.startsWith('/api/admin/orders/') &&
    req.method === 'DELETE'
) {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const orderId = decodeURIComponent(
            url.pathname.split('/').pop()
        );

        const { data: order, error: findError } = await supabase
            .from('orders')
            .select('id')
            .eq('id', orderId)
            .maybeSingle();

        if (findError) {
            throw findError;
        }

        if (!order) {
            return sendJson(404, {
                success: false,
                message: 'Buyurtma topilmadi'
            });
        }

        const { error: deleteError } = await supabase
            .from('orders')
            .delete()
            .eq('id', orderId);

        if (deleteError) {
            throw deleteError;
        }

        return sendJson(200, {
            success: true,
            message: 'Buyurtma o‘chirildi'
        });

    } catch (error) {
        console.error('ORDER DELETE XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Buyurtmani o‘chirib bo‘lmadi'
        });
    }
}

// KUPONNI TEKSHIRISH
if (url.pathname === "/api/coupons/validate" && req.method === "POST") {
    try {
        const data = await parseBody(req);

        const code = String(data.code || "").trim().toUpperCase();
        const orderAmount = Math.max(0, Number(data.orderAmount) || 0);

        if (!code) {
            return sendJson(400, {
                success: false,
                message: "Kupon kodi kiritilmagan"
            });
        }

        const { data: coupon, error } = await supabase
            .from("coupons")
            .select("*")
            .eq("code", code)
            .maybeSingle();

        if (error) {
            console.error("COUPON VALIDATE XATOSI:", error);
            return sendJson(500, {
                success: false,
                message: "Kuponni tekshirishda xatolik"
            });
        }

        if (!coupon) {
            return sendJson(404, {
                success: false,
                message: "Kupon topilmadi"
            });
        }

        if (!coupon.active) {
            return sendJson(400, {
                success: false,
                message: "Bu kupon hozir faol emas"
            });
        }

        const now = new Date();

        if (coupon.start_at && now < new Date(coupon.start_at)) {
            return sendJson(400, {
                success: false,
                message: "Bu kupon hali kuchga kirmagan"
            });
        }

        if (coupon.end_at && now > new Date(coupon.end_at)) {
            return sendJson(400, {
                success: false,
                message: "Bu kuponning amal qilish muddati tugagan"
            });
        }

        if (coupon.usage_limit !== null && coupon.used_count >= coupon.usage_limit) {
            return sendJson(400, {
                success: false,
                message: "Bu kupondan foydalanish limiti tugagan"
            });
        }

        const minOrderAmount = Number(coupon.min_order_amount) || 0;

        if (orderAmount < minOrderAmount) {
            return sendJson(400, {
                success: false,
                message: "Kupon uchun minimal buyurtma summasi " + minOrderAmount.toLocaleString() + " so‘m"
            });
        }

        return sendJson(200, {
            success: true,
            coupon: {
                code: coupon.code,
                discountPercent: Number(coupon.discount_percent) || 0,
                minOrderAmount
            }
        });

    } catch (error) {
        console.error("COUPON VALIDATE XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kuponni tekshirishda xatolik"
        });
    }
}

// MIJOZ KUPONINI SAQLASH
if (url.pathname === "/api/coupons/save" && req.method === "POST") {
    try {
        const data = await parseBody(req);

        const initData = req.headers["x-telegram-init-data"] || "";
        const telegramUser = validateTelegramInitData(initData);

        if (!telegramUser?.id) {
            return sendJson(401, {
                success: false,
                message: "Telegram foydalanuvchisi aniqlanmadi"
            });
        }

        const userId = String(telegramUser.id);
        const code = String(data.code || "").trim().toUpperCase();

        if (!userId) {
            return sendJson(400, {
                success: false,
                message: "Telegram foydalanuvchisi aniqlanmadi"
            });
        }

        if (!code) {
            return sendJson(400, {
                success: false,
                message: "Kupon kodi kiritilmagan"
            });
        }

        const { data: coupon, error: couponError } = await supabase
            .from("coupons")
            .select("*")
            .eq("code", code)
            .eq("active", true)
            .maybeSingle();

        if (couponError) {
            console.error("COUPON SAVE VALIDATE XATOSI:", couponError);

            return sendJson(500, {
                success: false,
                message: "Kuponni tekshirishda xatolik"
            });
        }

        if (!coupon) {
            return sendJson(404, {
                success: false,
                message: "Kupon topilmadi yoki faol emas"
            });
        }

        const { data: savedCoupon, error: saveError } = await supabase
            .from("user_coupons")
            .upsert({
                user_id: userId,
                coupon_code: code
            }, {
                onConflict: "user_id,coupon_code"
            })
            .select()
            .single();

        if (saveError) {
            console.error("USER COUPON SAVE XATOSI:", saveError);

            return sendJson(500, {
                success: false,
                message: "Kuponni saqlab bo‘lmadi"
            });
        }

        return sendJson(200, {
            success: true,
            message: "Kupon saqlandi",
            coupon: savedCoupon
        });

    } catch (error) {
        console.error("COUPON SAVE XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kuponni saqlashda xatolik"
        });
    }
}


// MIJOZLAR UCHUN MAVJUD KUPONLARNI OLISH
if (url.pathname === "/api/coupons/available" && req.method === "GET") {
    try {
        const { data: coupons, error } = await supabase
            .from("coupons")
            .select("*")
            .eq("active", true)
            .order("id", { ascending: false });

        if (error) {
            console.error("AVAILABLE COUPONS XATOSI:", error);

            return sendJson(500, {
                success: false,
                message: "Kuponlarni olishda xatolik"
            });
        }

        const now = new Date();

        const availableCoupons = (coupons || [])
            .filter(coupon => {
                if (coupon.start_at && now < new Date(coupon.start_at)) {
                    return false;
                }

                if (coupon.end_at && now > new Date(coupon.end_at)) {
                    return false;
                }

                if (
                    coupon.usage_limit !== null &&
                    Number(coupon.used_count || 0) >= Number(coupon.usage_limit)
                ) {
                    return false;
                }

                return true;
            })
            .map(coupon => ({
                code: coupon.code,
                discountPercent: Number(coupon.discount_percent) || 0,
                minOrderAmount: Number(coupon.min_order_amount) || 0,
                usageLimit: coupon.usage_limit,
                usedCount: Number(coupon.used_count || 0),
                startAt: coupon.start_at,
                endAt: coupon.end_at
            }));

        return sendJson(200, {
            success: true,
            coupons: availableCoupons
        });

    } catch (error) {
        console.error("AVAILABLE COUPONS XATOSI:", error);

        return sendJson(500, {
            success: false,
            message: "Kuponlarni olishda xatolik"
        });
    }
}


// MIJOZLAR UCHUN MAHSULOTLARNI OLISH
if (url.pathname === '/api/products' && req.method === 'GET') {
    try {
        const { data, error } = await supabase
            .from('products')
            .select('*')
            .eq('active', true)
            .order('id', { ascending: true });

        if (error) {
            console.error('SUPABASE PUBLIC PRODUCT GET XATOSI:', error);

            return sendJson(500, {
                success: false,
                message: 'Mahsulotlarni yuklab bo‘lmadi'
            });
        }

        const { data: categories, error: categoryError } = await supabase
            .from("categories")
            .select("name, discount_percent, discount_active");

        if (categoryError) {
            console.error("SUPABASE CATEGORY DISCOUNT GET XATOSI:", categoryError);
        }

        const categoryDiscounts = new Map(
            (categories || []).map(category => [
                String(category.name).trim(),
                {
                    percent: Number(category.discount_percent) || 0,
                    active: category.discount_active === true
                }
            ])
        );

        const products = data.map(product => {
            const categoryDiscount = categoryDiscounts.get(String(product.category).trim());

            const productDiscountActive = product.discount_active === true;
            const productDiscountPercent = Number(product.discount_percent) || 0;

            const discountActive = productDiscountActive
                ? true
                : categoryDiscount?.active === true;

            const discountPercent = productDiscountActive && productDiscountPercent > 0
                ? productDiscountPercent
                : (categoryDiscount?.active === true ? categoryDiscount.percent : 0);

            return {
                id: product.id,
                name: product.name,
                category: product.category,
                desc: product.description || "",
                price: Number(product.price) || 0,
                img: product.image || "",
                active: product.active !== false,
                stock: Number(product.stock) || 0,
                size: product.size || "",
                variants: Array.isArray(product.variants) ? product.variants : [],
                country_id: product.country_id || null,
                discountPercent,
                discountActive
            };
        });

        return sendJson(200, products);

    } catch (error) {
        console.error('PUBLIC PRODUCT GET XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Mahsulotlarni yuklab bo‘lmadi'
        });
    }
}

// MAHSULOTNI TAHRIRLASH
if (
    url.pathname.startsWith('/api/admin/products/') &&
    req.method === 'PUT'
) {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const id = Number(
            url.pathname.split('/').pop()
        );

        const data = await parseBody(req);

        if (!data.name || !data.category || !data.price) {
            return sendJson(400, {
                success: false,
                message: 'Nom, kategoriya va narx majburiy'
            });
        }

        const productRecord = {
            name: String(data.name).trim(),
            category: String(data.category).trim(),
            description: String(data.desc || '').trim(),
            price: Number(data.price),
            image: String(data.img || '').trim(),
            stock: Math.max(0, Number(data.stock) || 0),
            discount_percent: Math.min(100, Math.max(0, Number(data.discountPercent) || 0)),
            discount_active: Boolean(data.discountActive),
            variants: Array.isArray(data.variants) ? data.variants : [],
            size: String(data.size || '').trim(),
            country_id: data.countryId ? Number(data.countryId) : null,
        };

        const { data: product, error } = await supabase
            .from('products')
            .update(productRecord)
            .eq('id', id)
            .select('*')
            .single();

        if (error) {
            throw error;
        }

        if (!product) {
            return sendJson(404, {
                success: false,
                message: 'Mahsulot topilmadi'
            });
        }

        return sendJson(200, {
            success: true,
            product: {
                id: product.id,
                name: product.name,
                category: product.category,
                desc: product.description || '',
                price: Number(product.price) || 0,
                img: product.image || '',
                active: product.active !== false,
                stock: Number(product.stock) || 0,
                size: product.size || "",
                variants: Array.isArray(product.variants) ? product.variants : [],
            }
        });

    } catch (error) {
        console.error('PRODUCT EDIT XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Mahsulotni saqlab bo‘lmadi'
        });
    }
}

// MAHSULOTNI O‘CHIRISH
if (
    url.pathname.startsWith('/api/admin/products/') &&
    req.method === 'DELETE'
) {
    if (!isAdmin) {
        return sendJson(401, {
            success: false,
            message: 'Ruxsat yo‘q'
        });
    }

    try {
        const id = Number(
            url.pathname.split('/').pop()
        );

        const { data: product, error: findError } = await supabase
            .from('products')
            .select('id')
            .eq('id', id)
            .maybeSingle();

        if (findError) {
            throw findError;
        }

        if (!product) {
            return sendJson(404, {
                success: false,
                message: 'Mahsulot topilmadi'
            });
        }

        const { error: deleteError } = await supabase
            .from('products')
            .delete()
            .eq('id', id);

        if (deleteError) {
            throw deleteError;
        }

        return sendJson(200, {
            success: true
        });

    } catch (error) {
        console.error('PRODUCT DELETE XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Mahsulotni o‘chirib bo‘lmadi'
        });
    }
}

    let filePath;

if (req.url === '/products.json') {
    filePath = path.join(PROJECT_ROOT, 'products.json');
} else if (req.url === '/admin' || req.url === '/admin.html') {
    filePath = path.join(PROJECT_ROOT, 'admin.html');
} else if (req.url.startsWith('/images/')) {
    filePath = resolveImagePath(PROJECT_ROOT, req.url);
    if (!filePath) return sendJson(404, { success: false, message: 'Fayl topilmadi' });
} else {
    filePath = path.join(PROJECT_ROOT, 'index.html');
}
    const ext = path.extname(filePath);

    const contentTypes = {
        '.html': 'text/html; charset=utf-8',
        '.json': 'application/json; charset=utf-8',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/jpeg',
        '.png': 'image/png',
        '.webp': 'image/webp',
        '.gif': 'image/gif'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Fayl topilmadi');
            return;
        }

        res.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff'
        });
        res.end(data);
    });
});


if (require.main === module) {
    webServer.listen(PORT, () => {
        console.log(`Aroma Do'kon web sayti: http://localhost:${PORT}`);
    });

    bot.launch();
    console.log("Aroma-dokon Telegram boti muvaffaqiyatli ishga tushdi!");
}

module.exports = {
    bot,
    webServer
};
