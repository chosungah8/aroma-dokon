# Aroma Do‘kon — 🏆 Eng yaxshi mijozlar

## Nimani hisoblaydi?

Buyurtmalarni `orders.customer_id` (tasdiqlangan Telegram foydalanuvchisi) orqali birlashtiradi.

- 📦 **Eng ko‘p buyurtma** — mijoz bergan buyurtmalar soni (kamayish tartibida).
- 💰 **Eng katta jami xarid** — mijozning barcha buyurtmalari uchun chegirmalardan keyingi `orders.total` summasi.
- 💎 **Eng qimmat bitta buyurtma** — mijozning eng katta bitta buyurtmasi (`MAX(orders.total)`).

Davr: barcha vaqt, oxirgi 7 / 30 / 90 / 365 kun. Har bir ro‘yxatdagi dastlabki 50 ta mijoz chiqadi. Umumiy ko‘rsatkichlar **barcha** mos mijozlar asosida hisoblanadi, 50 ta bilan cheklanmaydi. Ro‘yxatni CSV sifatida yuklash mumkin.

Kontaktlar (telefon, ism, Telegram ID va username) faqat admin panelida ko‘rsatiladi; ular tashriflar statistikasi uchun saqlanmaydi. Oxirgi buyurtmadagi kontakt ma’lumotlari ishlatiladi. Shaxsiy ma’lumotlar borligi sababli CSV faylni ochiq joyda ulashmang.

Arxivlangan buyurtmalar ham hisoblanadi. `Bekor qilindi`, `Bekor qilingan`, `Cancelled`, `Canceled` statuslari reytingga kirmaydi. Telegram ID'siz eski buyurtmalar to‘g‘ri mijozga biriktirib bo‘lmagani uchun kiritilmaydi. Yangi buyurtma yoki sotuv qiymati 0 bo‘lsa, bu buyurtma buyurtmalar soniga kiradi, sarfga 0 qo‘shadi.

## O‘rnatish

1. Supabase **SQL Editor** da `sql/aroma-mijozlar-reytingi.sql` ni bir marta bajaring. Bu mavjud `orders` jadvalini o‘zgartirmaydi va **faqat `service_role`** uchun reyting RPC funksiyasiga huquq beradi.
2. ZIP faylni `~/aroma-dokon` loyihasiga oching, so‘ng `npm test` bajaring.
3. Yangilangan `admin.html`, `lib/server.js`, `lib/personal-coupons.js`, `sql/aroma-mijozlar-reytingi.sql`, testlar va shu hujjatni GitHubga commit/push qiling.
4. `aroma-dokon` Vercel Deploy **Ready** bo‘lgach, admin paneldan **🏆 Eng yaxshi mijozlar — buyurtmalar reytingi** bo‘limini oching.
5. Bir necha davr va reyting turlarini tekshiring; kerak bo‘lsa CSV eksport qiling.

**Muhim:** ZIP ichida oldingi **Mijozni tekshirish** tugmasining ham tuzatishi mavjud; agar avvalgi kichik ZIP o‘rnatilmagan bo‘lsa, uning vazifasini ham bajaradi. Boshqa loyihaga ta’sir qilmaydi. Supabase SQL yangi funksiyani qo‘shadi, mavjud kupon va buyurtma RPC'larini o‘zgartirmaydi.

## Xavfsizlik

- `/api/admin/customer-rankings` marshruti faqat haqiqiy admin tokenini qabul qiladi, `Cache-Control: no-store, private` sozlangan.
- Reyting serverda SQL agregatsiya orqali chiqadi; Supabase REST'dagi 1000 qatorlik limit umumiy reytingni noto‘g‘ri cheklamaydi.
- CSV kataklari Excel/Sheets formulasi sifatida ishga tushmasligi uchun zararsizlantiriladi.
- Testlar mahalliy mock yordamida bajarilgan; jonli Supabase SQL natijasini birinchi ishga tushirishda tekshirish kerak.
