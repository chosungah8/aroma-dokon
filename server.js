const { Telegraf, Markup } = require('telegraf');

// 1. BotFather bergan tokeningiz
const BOT_TOKEN = '8650363671:AAFkkX62y8CHVO5ZgMGbrJukcwvWw7yiG7w'; 

// 2. GitHub Pages havolangiz
const WEB_APP_URL = 'https://chosungah8.github.io/aroma-dokon/'; 

const bot = new Telegraf(BOT_TOKEN);

// /start buyrug'i yuborilganda
bot.start((ctx) => {
    ctx.reply(
        `Xush kelibsiz, ${ctx.from.first_name}! Do'konimizdan xarid qilish uchun tugmani bosing:`,
        Markup.keyboard([
            [Markup.button.webApp('🛒 Do\'konni ochish', WEB_APP_URL)]
        ]).resize()
    );
});

// Web App'dan buyurtma ma'lumotlarini qabul qilish
bot.on('web_app_data', async (ctx) => {
    try {
        let rawData = ctx.webAppData.data;
        let data;

        // Ma'lumot string bo'lsa parse qilamiz, aks holda tayyor obyektni olamiz
        if (typeof rawData === 'string') {
            data = JSON.parse(rawData);
        } else {
            data = rawData;
        }

        // Buyurtma qilingan mahsulotlar ro'yxati
        let itemsList = (data.items || []).map(item => 
            `• <b>${item.name}</b> (${item.count} ta) - ${(item.price * item.count).toLocaleString()} so'm`
        ).join('\n');

        // Mijozga yuboriladigan xabar
        const message = `🛍 <b>Yangi buyurtma qabul qilindi!</b>\n\n` +
                        `<b>Mahsulotlar:</b>\n${itemsList}\n\n` +
                        `💰 <b>Jami summa:</b> ${(data.total || 0).toLocaleString()} so'm\n\n` +
                        `📞 <b>Telefon:</b> ${data.phone || 'Kiritilmadi'}\n` +
                        `📍 <b>Manzil:</b> ${data.address || 'Kiritilmadi'}\n\n` +
                        `<i>Tez orada operatorimiz siz bilan bog'lanadi!</i>`;

        await ctx.replyWithHTML(message);
    } catch (e) {
        console.error('Buyurtma saqlashda xatolik:', e);
        ctx.reply('Buyurtmani qayta ishlashda xatolik yuz berdi. Iltimos, qaytadan urinib ko\'ring.');
    }
});

bot.launch();
console.log('aroma-dokon serveri muvaffaqiyatli ishga tushdi!');
