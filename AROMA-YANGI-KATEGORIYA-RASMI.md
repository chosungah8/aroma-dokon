# Aroma Do‘kon — «Yangi mahsulotlar» kategoriyasi rasmini boshqarish

Yangilanish `c69b664` versiyasidan keyingi Aroma Do‘kon kodi uchun tayyorlandi.

## 1. Bazani tayyorlash
Supabase → Aroma Do‘kon → SQL Editor → `sql/aroma-yangi-mahsulotlar-rasmi.sql` ni ishga tushiring.
Bu SQL faqat `public.shop_settings` ga `new_arrivals_image` ustunini qo‘shadi.

## 2. Kodni qo‘shish
Ubuntu terminali:

```bash
cd ~/aroma-dokon
git status --short -- admin.html index.html lib/server.js
unzip -o ~/Downloads/aroma-yangi-kategoriya-rasmi.zip -d .
npm test
```

Agar `git status` yangilanishdan oldin mavjud ishchi o‘zgarishlarni ko‘rsatsa, avval ularni saqlang.

## 3. GitHub va Vercel

```bash
cd ~/aroma-dokon
git add admin.html index.html lib/server.js lib/new-arrivals-image.js sql/aroma-yangi-mahsulotlar-rasmi.sql tests/new-arrivals-image.test.js AROMA-YANGI-KATEGORIYA-RASMI.md
git commit -m "Add editable picture for new arrivals category"
git push origin main
```

Vercel → **aroma-dokon** loyihasi → `Ready` versiyasini kuting.

## 4. Sinov
Admin → 📂 Kategoriyalar → 🆕 Yangi mahsulotlar → Rasmni almashtirish. JPG/PNG/WEBP (3 MB gacha) tanlang.
«Rasmni olib tashlash» tugmasi eski 🆕 emojini qaytaradi.
Telegram Web Appni qayta oching; rasm asosiy kategoriyalar qatorining boshida ko‘rinadi.

**Muhim:** Bu rasm virtual kategoriyaga tegishli. Asosiy kategoriyalar va 7 kunlik avtomatik mahsulotlar saralanishi o‘zgarmaydi. Yangilanish eski mahsulotlarni «Yangi mahsulotlar»ga qo‘shmaydi.
