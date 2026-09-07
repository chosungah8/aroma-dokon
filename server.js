const { Telegraf, Markup } = require('telegraf');

// 1. BotFather bergan tokeningiz
const BOT_TOKEN = '8650363671:AAFkkX62y8CHVO5ZgMGbrJukcwvWw7yiG7w'; 

// 2. GitHub Pages havolangiz (aroma-dokon deb yozilgan)
const WEB_APP_URL = 'https://github.com/chosungah8/aroma-dokon.git'; 

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
        const data = JSON.parse(ctx.webAppData.data);
        let itemsList = data.items.map(item => `- ${item.name}: ${item.price.toLocaleString()} so'm`).join('\n');

        const message = `🛍 <b>Yangi buyurtma!</b>\n\n<b>Mahsulotlar:</b>\n${itemsList}\n\n<b>Jami:</b> ${data.total.toLocaleString()} so'm`;
        
        await ctx.replyWithHTML(message);
    } catch (e) {
        console.error(e);
        ctx.reply('Buyurtmani qayta ishlashda xatolik yuz berdi.');
    }
});

bot.launch();
console.log('aroma-dokon serveri ishga tushdi!');
