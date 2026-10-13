# Aroma Do'kon — 👥 Mijozlar ro'yxati va 🏆 mijozlar reytingi

## Nima qo'shildi?

Admin panelda ikkita mustaqil ochilib-yopiladigan bo'lim:

1. **👥 Mijozlar ro'yxati — barcha xaridorlar:** avval buyurtma bergan xaridorlarning ismi, telefon raqami, Telegram ID (mavjud bo'lsa), buyurtma soni, jami to'lov summasi, oxirgi buyurtma sanasi. Telefon, ism, username yoki Telegram ID bilan qidirish; oxirgi buyurtma, buyurtmalar soni, xarid summasi yoki ism bo'yicha tartiblash. Har bir sahifada 25 ta xaridor, oldingi/keyingi tugmalari, joriy sahifani CSVga yuklash.
2. **🏆 Eng yaxshi mijozlar:** buyurtmalar soni, jami xarid, eng katta bitta buyurtma bo'yicha alohida TOP-50, davr tanlash (barcha vaqt / 7 / 30 / 90 / 365 kun), CSV.

Ro'yxatdagi Telegram ID'si ma'lum mijoz uchun **🎁 Kupon berish** tugmasi shaxsiy kupon formasiga o'tadi va faqat mijozning Telegram ID sini oldindan to'ldiradi. Kupon **avtomatik berilmaydi**; admin shartlarni to'ldirib tasdiqlashi kerak.

## Hisoblash qoidasi

- Faqat **buyurtma bergan mijozlar** kiritiladi, oddiy tashrif buyurganlar ro'yxatda yo'q. Tashriflar statistikasi alohida qoladi.
- Arxivdagi buyurtmalar ham hisoblanadi; bekor qilingan buyurtmalar hisobdan chiqariladi.
- Telegram ID mavjud buyurtmalar **ID bo'yicha** bir mijozga jamlanadi.
- Eski Telegram IDsiz buyurtmalar telefon raqami bo'lsa, shu raqam bo'yicha jamlanadi. Telefon raqam bo'lmasa, birlashtirmasdan alohida ko'rinadi. Bu noto'g'ri birlashtirishni oldini oladi, lekin bir kishining eski va yangi buyurtmalari ikki satrda chiqishi mumkin.
- Xarid summasi `orders.total` dan olinadi, ya'ni chegirmalardan keyin saqlangan yakuniy summa.
- Kontaktlar oxirgi buyurtmadan olinadi, umumiy summalar esa barcha tegishli buyurtmalardan.

## O'rnatish

1. Supabase Dashboard → **SQL Editor** → `sql/aroma-mijozlar-reytingi-va-royxati.sql` ni **bir marta Run** qiling. Bu fayl oldingi `aroma-mijozlar-reytingi.sql` funksiyasini ham o'z ichiga oladi. Oldingi reyting SQLi bajarilgan bo'lsa ham, bu birlashtirilgan SQLni ishlatish mumkin.
2. `cd ~/aroma-dokon` va `git status --short -- admin.html lib/server.js lib/personal-coupons.js` buyrug'i bilan lokal o'zgarishlar yo'qligini tekshiring.
3. ZIPni loyiha ichiga `unzip -o ~/Downloads/aroma-mijozlar-reytingi-va-royxati.zip -d .` orqali oching.
4. `npm test` → barcha testlar pass.
5. `git add admin.html lib/server.js lib/personal-coupons.js sql/aroma-mijozlar-reytingi.sql sql/aroma-mijozlar-reytingi-va-royxati.sql tests/customer-rankings.test.js tests/customer-list.test.js tests/personal-coupons.test.js AROMA-MIJOZLAR-REYTINGI.md AROMA-MIJOZLAR-REYTINGI-VA-ROYXATI.md`.
6. `git commit -m 'Add searchable customer list and customer rankings'` va `git push origin main`.
7. Vercel `aroma-dokon` loyihasida yangi commit Ready bo'lsin; admin panelda 👥 Mijozlar ro'yxati va 🏆 reytingni sinang.

## Xavfsizlik

- APIlar: `/api/admin/customers` va `/api/admin/customer-rankings`. Admin Bearer token talab qiladi; admin bo'lmagan foydalanuvchiga telefon raqam yoki mijoz ma'lumotlari qaytarilmaydi.
- SQL funksiyalari `SECURITY INVOKER`, `service_role` uchun `EXECUTE` ruxsati. `anon`, `authenticated`, `PUBLIC` ruxsatlari bekor qilingan.
- Ma'lumotlar serverda agregatsiya qilinadi, klientga faqat sahifalangan natija yuboriladi. Saqlangan Telegram ID va telefon ma'lumotlarini ochiq guruhlarga eksport qilmang.
- Brauzerda `innerHTML` bilan foydalanuvchi qiymatlari joylanmaydi, Excel formulasini ishga tushirmaslik uchun CSV himoyalangan.
- Bu SQL mavjud buyurtmalar yoki kuponlarni o'zgartirmaydi. Jonli bazadagi natijalarni deploymentdan keyin alohida tekshiring.

## SQL sana-format tuzatishi

`orders.order_date` TEXT ekanligi aniqlangani sababli SQL safe sana parseri qo'shildi.
`YYYY-MM-DD HH:MM:SS` va tarixiy `DD/MM/YYYY, HH:MM:SS` qo'llanadi.
Toshkent vaqti bo'yicha filtr va tartib ishlaydi. Noto'g'ri sanali yozuvlar
**barcha vaqt** bo'yicha summaga kiradi, biroq sana-filtriga kira olmaydi.
Bu o'zgarish `orders` jadvalini mutlaqo o'zgartirmaydi.
