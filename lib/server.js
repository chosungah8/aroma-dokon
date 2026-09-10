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
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

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
const orders = JSON.parse(
    await fs.promises.readFile(ordersFile, 'utf8')
);

// STOCKNI TEKSHIRISH VA KAMAYTIRISH
const productsFile = path.join(PROJECT_ROOT, 'products.json');

const productsData = await fs.promises.readFile(
    productsFile,
    'utf8'
);

const products = JSON.parse(productsData);

for (const item of data.items || []) {
    const product = products.find(
        p => String(p.name) === String(item.name)
    );

    if (!product) {
        throw new Error(`Mahsulot topilmadi: ${item.name}`);
    }

    const quantity = Number(item.count) || 0;
    const stock = Number(product.stock) || 0;

    if (quantity > stock) {
        throw new Error(
            `${product.name} uchun yetarli mahsulot qolmagan`
        );
    }

    product.stock = stock - quantity;
}

await fs.promises.writeFile(
    productsFile,
    JSON.stringify(products, null, 2),
    'utf8'
);

const newOrder = {
    id: orderNumber,
    date: orderDate,
    customer: {
        id: ctx.from?.id || null,
        name: ctx.from?.first_name || 'Noma',
        username: ctx.from?.username || ''
    },
    items: data.items || [],
    total: Number(data.total) || 0,
    phone: data.phone || '',
    address: data.address || '',
    status: 'Yangi'
};

orders.push(newOrder);

await fs.promises.writeFile(
    ordersFile,
    JSON.stringify(orders, null, 2),
    'utf8'
);

console.log('Buyurtma saqlandi:', newOrder.id);
        const items = Array.isArray(data.items) ? data.items : [];

        const itemsList = items.length
            ? items.map(item =>
                `• <b>${item.name}</b> (${item.count} ta) - ${(item.price * item.count).toLocaleString()} so'm`
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
const PROJECT_ROOT = path.join(PROJECT_ROOT, '..');
const ordersFile = path.join(PROJECT_ROOT, 'orders.json');
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

            const token = crypto.randomBytes(32).toString('hex');
            adminSessions.add(token);

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

    const isAdmin = adminSessions.has(token);

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

            const filePath = path.join(PROJECT_ROOT, 'products.json');

            const file = await fs.promises.readFile(
                filePath,
                'utf8'
            );

            const products = JSON.parse(file);

            const newId = products.length
                ? Math.max(...products.map(p => Number(p.id) || 0)) + 1
                : 1;

const newProduct = {
    id: newId,
    name: String(data.name).trim(),
    category: String(data.category).trim(),
    desc: String(data.desc || '').trim(),
    price: Number(data.price),
    img: String(data.img || '').trim(),
    active: true,
    stock: Math.max(0, Number(data.stock) || 0)
};

            products.push(newProduct);

            await fs.promises.writeFile(
                filePath,
                JSON.stringify(products, null, 2),
                'utf8'
            );

            return sendJson(200, {
                success: true,
                product: newProduct
            });

        } catch (error) {
            console.error('PRODUCT ADD XATOSI:', error);

            return sendJson(500, {
                success: false,
                message: 'Mahsulotni saqlab bo‘lmadi'
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

        const imagesDir = path.join(PROJECT_ROOT, 'images');

        await fs.promises.mkdir(imagesDir, {
            recursive: true
        });

        const filename =
            `product-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${extension}`;

        await fs.promises.writeFile(
            path.join(imagesDir, filename),
            imageBuffer
        );

        return sendJson(200, {
            success: true,
            path: `images/${filename}`
        });

    } catch (error) {
        console.error('IMAGE UPLOAD XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Rasmni saqlab bo‘lmadi'
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
        const file = await fs.promises.readFile(
            ordersFile,
            'utf8'
        );

        const orders = JSON.parse(file);

        const myOrders = orders.filter(order =>
            String(order.customer?.id) === String(userId)
        );

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
        const file = await fs.promises.readFile(
            ordersFile,
            'utf8'
        );

        const orders = JSON.parse(file);

        return sendJson(200, orders);

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

        const file = await fs.promises.readFile(
            ordersFile,
            'utf8'
        );

        const orders = JSON.parse(file);

        const order = orders.find(
            item => item.id === orderId
        );

        if (!order) {
            return sendJson(404, {
                success: false,
                message: 'Buyurtma topilmadi'
            });
        }

        order.status = data.status;

try {
    if (order.customer && order.customer.id) {
        await bot.telegram.sendMessage(
            order.customer.id,
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

        await fs.promises.writeFile(
            ordersFile,
            JSON.stringify(orders, null, 2),
            'utf8'
        );

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

        const filePath = path.join(
            PROJECT_ROOT,
            'products.json'
        );

        const file = await fs.promises.readFile(
            filePath,
            'utf8'
        );

        const products = JSON.parse(file);

        const product = products.find(
            p => Number(p.id) === id
        );

        if (!product) {
            return sendJson(404, {
                success: false,
                message: 'Mahsulot topilmadi'
            });
        }

        product.name = String(data.name).trim();
        product.category = String(data.category).trim();
        product.desc = String(data.desc || '').trim();
        product.price = Number(data.price);
        product.img = String(data.img || '').trim();
product.stock = Math.max(0, Number(data.stock) || 0);
        await fs.promises.writeFile(
            filePath,
            JSON.stringify(products, null, 2),
            'utf8'
        );

        return sendJson(200, {
            success: true,
            product: product
        });

    } catch (error) {
        console.error('PRODUCT EDIT XATOSI:', error);

        return sendJson(500, {
            success: false,
            message: 'Mahsulotni yangilab bo‘lmadi'
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

            const filePath = path.join(
                PROJECT_ROOT,
                'products.json'
            );

            const file = await fs.promises.readFile(
                filePath,
                'utf8'
            );

            let products = JSON.parse(file);

            const exists = products.some(
                product => Number(product.id) === id
            );

            if (!exists) {
                return sendJson(404, {
                    success: false,
                    message: 'Mahsulot topilmadi'
                });
            }

            products = products.filter(
                product => Number(product.id) !== id
            );

            await fs.promises.writeFile(
                filePath,
                JSON.stringify(products, null, 2),
                'utf8'
            );

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
