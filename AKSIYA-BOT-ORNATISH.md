# Alohida aksiya botini o‘rnatish

1. Supabase SQL Editor’da sql/aroma-offline-bot.sql faylini to‘liq bajaring.
2. Telegram’da rasmiy @BotFather orqali /newbot yuborib, yangi bot yarating.
3. Yangi bot tokenini Vercel → loyiha → Settings → Environment Variables’da PROMOTION_BOT_TOKEN nomi bilan Production muhitiga kiriting. Mavjud BOT_TOKEN do‘kon botiniki; uni almashtirmang. Tokenni chatga yoki GitHub’ga joylamang.
4. ZIP faylini loyiha ichiga oching, npm test bajaring, o‘zgargan fayllarni commit va push qiling. Yangi deploy Ready bo‘lsin. WEB_APP_URL do‘konning doimiy production HTTPS manzili bo‘lishi kerak.
5. Admin panel → “Alohida aksiya boti — adminlar” → “Yangi botni ulash” tugmasini bosing.
6. Yangi botga shaxsiy chatda /start yuboring. U Telegram ID’ingizni ko‘rsatadi. Uni do‘kon admin panelida ismingiz bilan qo‘shib, “Ruxsat berish”ni bosing. Boshqa adminlarni ham alohida qo‘shing.
7. Admin huquqi berilgach, botga shu shaklda xabar yuboring:

    +998901234567 150000 Ali

Telefonni bo‘shliqsiz yozing; 9 xonali mahalliy raqam ham qabul qilinadi. Summani bo‘shliqsiz, so‘mda yozing. Ism ixtiyoriy.

## Qoidalar

- Bot faqat ruxsatli adminning shaxsiy chatida ishlaydi.
- Admin tashqi xarid haqiqatan bo‘lganini tekshiradi. Bot kassani tekshirmaydi.
- Tashqi xarid 100 000 so‘mdan qat’iy ko‘p va aksiya minimumidan kam bo‘lmasligi kerak.
- Bot do‘kon tanlagan joriy aksiyaga yozadi. Faol yoki muddati mos aksiya bo‘lmasa, raqam ajratmaydi.
- Do‘kon va bot bitta bazada, bir aksiya uchun umumiy navbatdan raqam oladi.
- Telefon bir aksiyada avval qayd etilgan bo‘lsa, mavjud raqam qaytariladi. Eski ishtirokchilar o‘zgartirilmaydi.
- Ikki manbadan kelgan ishtirokchilar bir Excel’da raqam bo‘yicha tartiblanadi.
- Excel yuklash vaqtincha ishlamasa, raqam bazada saqlanadi va bot ogohlantiradi. Admin panelning Excel tugmasi faylni qayta yaratadi.
- “Ruxsatni bekor qilish” keyingi murojaatlardanoq kuchga kiradi.

## Jonli tekshiruv

Sinov aksiyasi va sinov telefonlaridan foydalaning. Avval onlayn xarid, keyin botdan boshqa telefon, so‘ng yana onlayn xarid yuborib, navbatni tekshiring. Bir telefonni ikki yo‘ldan yuborganda yangi raqam chiqmasligini, ruxsatsiz hisob ro‘yxatdan o‘tkaza olmasligini va Excel ikkala manbani ko‘rsatishini tekshiring.

41 ta avtomatik test va PostgreSQL-mos mahalliy bazada funksional tekshiruv o‘tdi. Mahalliy baza bitta ulanishda ishlaydi; mustaqil ulanishlardan bir vaqtda yozish jonli sinovda tekshiriladi.
