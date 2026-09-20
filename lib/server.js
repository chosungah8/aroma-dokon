const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const https = require('https');
const telegramAgent = new https.Agent({ family: 4 });
const { createClient } = require('@supabase/supabase-js');
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
const ADMIN_PASSWORD = String(process.env.ADMIN_PASSWORD || "").trim();
const ADMIN_TELEGRAM_ID = '362572698';

if (!ADMIN_PASSWORD) {
    console.error('ADMIN_PASSWORD .env faylda topilmadi!');
}
const adminSessions = new Set();

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

console.log("WEB APP DATA:", rawData);

console.log('Telegramdan kelgan data:', rawData);

if (!rawData) {
    throw new Error('Web App data kelmadi');
}

let data;

const orderNumber = 'AR-' + Date.now();

const orderDate = new Date().toLocaleString('uz-UZ', {
    timeZone: 'Asia/Tashkent'
});

if (typeof rawData === 'string') {
    data = JSON.parse(rawData);
} else if (typeof rawData.json === 'function') {
    data = await rawData.json();
} else if (typeof rawData === 'object') {
    data = rawData;
} else {
    throw new Error('Web App data formati noma’lum');
}

console.log('Buyurtma obyekti:', data);

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
        ? `@${customerUsername}`
        : customerName;

    let adminMessage =
        `🔎 <b>YANGI MAHSULOT SO‘ROVI</b>\n\n` +
        `👤 <b>Mijoz:</b> ${customerDisplay}\n\n` +
        `💬 <b>So‘rov:</b>\n${requestText || 'Matn yozilmagan'}\n\n`;

    if (imageUrl) {
        adminMessage += `🖼 <b>Rasm:</b> ${imageUrl}\n\n`;
    }

    adminMessage += `📌 <b>Holat:</b> Yangi`;

    const customerChatUrl = customerUsername
        ? `https://t.me/${customerUsername}`
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


// STOCKNI SUPABASE ORQALI TEKSHIRISH VA KAMAYTIRISH
for (const item of data.items || []) {
    const quantity = Number(item.count) || 0;

    const { data: product, error: productError } = await supabase
        .from('products')
        .select('id, name, stock')
        .eq('name', item.name)
        .single();

    if (productError || !product) {
        throw new Error(`Mahsulot topilmadi: ${item.name}`);
    }

    const stock = Number(product.stock) || 0;

    if (quantity > stock) {
        throw new Error(
            `${product.name} uchun yetarli mahsulot qolmagan`
        );
    }

    const { error: stockError } = await supabase
        .from('products')
        .update({
            stock: stock - quantity
        })
        .eq('id', product.id);

    if (stockError) {
        throw new Error(
            `Stock yangilanmadi: ${stockError.message}`
        );
    }
}

// BUYURTMANI SUPABASE'GA SAQLASH
const orderRecord = {
    id: orderNumber,
    order_date: orderDate,
    customer_id: String(ctx.from?.id || ''),
    customer_name: ctx.from?.first_name || 'Noma',
    customer_username: ctx.from?.username || '',
    items: data.items || [],
    total: Number(data.total) || 0,
    phone: data.phone || '',
    address: data.address || '',
    status: 'Yangi'
};

const { error: orderError } = await supabase
    .from('orders')
    .insert(orderRecord);

if (orderError) {
    throw new Error(
        `Buyurtma Supabase'ga saqlanmadi: ${orderError.message}`
    );
}

if (data.couponCode) {
    const { data: coupon, error: couponError } = await supabase
        .from("coupons")
        .select("id, used_count, usage_limit")
        .eq("code", String(data.couponCode).trim().toUpperCase())
        .maybeSingle();

    if (couponError) {
        console.error("COUPON USED COUNT XATOSI:", couponError);
    } else if (coupon) {
        const currentUsed = Number(coupon.used_count) || 0;

        if (coupon.usage_limit === null || currentUsed < Number(coupon.usage_limit)) {
            const { error: updateCouponError } = await supabase
                .from("coupons")
                .update({
                    used_count: currentUsed + 1
                })
                .eq("id", coupon.id);

            if (updateCouponError) {
                console.error("COUPON USED COUNT UPDATE XATOSI:", updateCouponError);
            }
        }
    }
}

console.log("Buyurtma saqlandi:", orderNumber);

        const items = Array.isArray(data.items) ? data.items : [];

        const itemsList = items.length
            ? items.map(item =>
`• <b>${item.name}</b>${item.variant ? ` — ${item.variant}` : ''} (${item.count} ta) - ${(item.price * item.count).toLocaleString()} so'm`
            ).join('\n')
            : 'Mahsulot kiritilmadi';

const message =
    `🛍 <b>YANGI BUYURTMA</b>\n\n` +
    `🔢 <b>Buyurtma:</b> ${orderNumber}\n` +
    `🕒 <b>Sana:</b> ${orderDate}\n\n` +
    `<b>📦 Mahsulotlar:</b>\n${itemsList}\n\n` +
    `💰 <b>Jami summa:</b> ${(Number(data.total) || 0).toLocaleString()} so'm\n\n` +
    `📞 <b>Telefon:</b> ${data.phone || 'Kiritilmadi'}\n` +
    `📍 <b>Manzil:</b> ${data.address || 'Kiritilmadi'}\n\n` +
    `👤 <b>Mijoz:</b> ${ctx.from?.first_name || 'Noma'}` +
    `${ctx.from?.username ? ` (@${ctx.from.username})` : ''}\n\n` +
    `<i>Tez orada operatorimiz siz bilan bog‘lanadi!</i>`;

        await ctx.replyWithHTML(message);

    } catch (error) {
        console.error('BUYURTMA XATOSI:', error);

        await ctx.reply(
            'Buyurtmani qayta ishlashda xatolik yuz berdi. Iltimos, qaytadan urinib ko‘ring.'
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

            if (data.password !== ADMIN_PASSWORD) {
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

const expectedAdminToken = crypto
    .createHash('sha256')
    .update(ADMIN_PASSWORD)
    .digest('hex');

const isAdmin = token === expectedAdminToken;
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
    stock: Number(product.stock) || 0
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
        const parent_id = data.parent_id
            ? Number(data.parent_id)
            : null;

        const image = String(data.image || "").trim();
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
                parent_id,
                image,
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
        const parent_id = data.parent_id
            ? Number(data.parent_id)
            : null;

        const image = String(data.image || "").trim();
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
                parent_id,
                image,
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

        if (!title) {
            return sendJson(400, {
                success: false,
                message: "Sarlavha kiritilmagan"
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
            variants: Array.isArray(data.variants) ? data.variants : []
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
                stock: Number(savedProduct.stock) || 0
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
            `👤 <b>Mijoz:</b> ${customerName}`;

        if (customerUsername) {
            adminMessage += ` (@${customerUsername})`;
        }

        adminMessage +=
            `\n🆔 <b>Telegram ID:</b> ${customerId || 'Noma’lum'}\n\n` +
            `💬 <b>So‘rov:</b>\n${requestText || 'Matn yozilmagan'}\n\n`;

        if (imageUrl) {
            adminMessage += `🖼 <b>Rasm:</b> ${imageUrl}\n\n`;
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
    const userId = url.searchParams.get('userId');

    if (!userId) {
        return sendJson(400, {
            success: false,
            message: 'User ID topilmadi'
        });
    }

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

        const userId = String(data.userId || "").trim();
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
            variants: Array.isArray(data.variants) ? data.variants : []
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
                stock: Number(product.stock) || 0
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
    filePath = path.join(PROJECT_ROOT, req.url);
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
        '.webp': 'image/webp'
    };

    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Fayl topilmadi');
            return;
        }

        res.writeHead(200, {
            'Content-Type': contentTypes[ext] || 'application/octet-stream'
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
