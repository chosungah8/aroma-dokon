# Aroma Do‘kon — statistika va yagona admin dizayni

## Nima qo‘shildi?

- Admin panelning boshida ochilib-yopiladigan **📊 Do‘kon statistikasi**.
- Bugun, oxirgi 7 va 30 kun, jami noyob tashrif buyuruvchilar.
- 30 kunda mahsulot ko‘rgan/savatga qo‘shgan/buyurtma bergan noyob foydalanuvchilar.
- 7 kunlik tashriflar diagrammasi va 30 kun ichida eng ko‘p ko‘rilgan 5 mahsulot.
- Barcha admin `<details>` bo‘limlariga yagona kartochka ko‘rinishi, tugma va forma uslubi, mobil moslashuv.
- Tashriflar Telegram `initData` imzosi serverda tekshirilgandan keyingina yoziladi.

## 1. Bazani tayyorlash (BIRINCHI)

Supabase loyihasi > SQL Editor > New query.
`sql/aroma-analytics.sql` faylini ochib, kodni SQL Editor'da ishga tushiring.
Alohida boshqa SQL kerak emas. Mavjud jadval ma'lumotlarini o‘zgartirmaydi.

## 2. ZIP yangilanishini loyihaga qo‘llash

Loyiha papkasi (`~/aroma-dokon`) ichida Git holatini oldin tekshiring:

```bash
cd ~/aroma-dokon
git status --short
```

Agar kutilmagan mahalliy o‘zgarishlar bo‘lsa, avval ularni saqlang.
**Faqat ushbu ZIPdagi fayllar** mavjud kodga mos o‘rnatiladi.

```bash
unzip -o ~/Downloads/aroma-dokon-statistika-dizayn.zip -d .
npm test
```

`118` yoki undan ko‘p testning hammasi muvaffaqiyatli bo‘lishi kerak.

```bash
git add admin.html index.html lib/server.js lib/analytics.js sql/aroma-analytics.sql tests/analytics.test.js AROMA-STATISTIKA-ORNATISH.md
git commit -m "Add shop visitor analytics and consistent admin layout"
git push origin main
```

Vercel'da loyiha Deployment `Ready` bo‘lishini kuting. Eski do‘kon botini yoki `aroma-social-bot`ni almashtirmang.

## 3. Sinov

1. Do‘konni Telegram botidagi **Open** tugmasidan oching, mahsulotni ko‘ring va savatga qo‘shing.
2. `admin.html` ga kiring, admin sifatida tizimga kiring.
3. **📊 Do‘kon statistikasi** > **↻ Yangilash** ni bosing.
4. Bugungi tashrif ko‘rsatkichlari yangi kirishdan keyin oshganini tekshiring.

**Muhim:** faqat yangi versiya ishga tushgandan keyin sodir bo‘lgan Telegram Web App kirishlar hisoblanadi. Brauzerda Telegram `initData` bo‘lmagan kirishlar sanalmaydi. Bitta odam bir kunda qayta kirsa, kunlik ko‘rsatkichda bir marta sanaladi. 7 va 30 kunlik metrikalarda ham odamlar davr davomida bittadan sanaladi. Eski tashriflarni avtomatik tiklab bo‘lmaydi.

Statistikada Telegram ID, telefon, ism va IP saqlanmaydi. Telegram ID serverda HMAC-SHA256 orqali maxfiylashtiriladi. Statistikani faqat admin sessiya orqali ko‘ra oladi. SQLni ishga tushirmasangiz, boshqa do‘kon funksiyalari davom etadi, lekin statistika bo‘limida xatolik ko‘rsatiladi.
