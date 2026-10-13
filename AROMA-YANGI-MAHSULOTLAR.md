# Aroma Do'kon — 🆕 Yangi mahsulotlar

Bu yangilanish oldingi `4ad18ee` (statistika + dizayn) versiyasi ustiga qo'yiladi.
`aroma-social-bot` loyihasiga tegmaydi.

## Ishlash tartibi

- Do'konning eng birinchi kategoriya kartasi: **🆕 Yangi mahsulotlar**.
- Mahsulot haqiqiy kategoriyasida ham qoladi, takrorlangan yangi kategoriya bazada yaratmaymiz.
- So'nggi **7 × 24 soat** ichida qo'shilganlar ko'rsatiladi.
- Yangi bo'limda **eng avval qo'shilgani yuqorida**, keyin qo'shilganlari undan keyin turadi.
- Oldingi mahsulotga 7 kun to'lganda faqat yangi bo'limdan avtomatik chiqadi; qolganlari bir pog'ona yuqoriga ko'tariladi.
- Mahsulotni tahrirlash uni qayta "yangi" qilmaydi.
- Agar eski `products` jadvalida `created_at` vaqti mavjud bo'lsa, oxirgi 7 kundagi mavjud mahsulotlar ham qo'shiladi. Bunday vaqt bo'lmasa, yangi ro'yxat yangilanishdan so'ng qo'shiladigan mahsulotlardan boshlanadi.
- Mavjud savat, kupon, chegirma, kategoriya va buyurtmalar o'zgarmaydi.

## O'rnatish

1. **Supabase** → Aroma Do'kon → SQL Editor → `sql/aroma-yangi-mahsulotlar.sql` kodini bajarish. SQL mavjud ma'lumotlarni o'chirmaydi. Uni kodni chiqarishdan OLDIN bajaring.
2. Ubuntu terminal:

   ```bash
   cd ~/aroma-dokon
   git status --short -- index.html lib/server.js
   unzip -o ~/Downloads/aroma-yangi-mahsulotlar.zip -d .
   npm test
   git add index.html lib/server.js sql/aroma-yangi-mahsulotlar.sql tests/new-arrivals.test.js AROMA-YANGI-MAHSULOTLAR.md
   git commit -m "Add automatic 7-day new products category"
   git push origin main
   ```

   **Agar dastlabki `git status` o'zgarish ko'rsatsa, yozilgan kodni bosib yubormasdan avval tekshiring.**

3. Vercel'dagi **aroma-dokon** deploy `Ready` bo'lishini kuting. Telegram'da do'konni qayta oching. `🆕 Yangi mahsulotlar` kartasi birinchi bo'lishi kerak.
4. Sinash uchun admin paneldan yangi mahsulot qo'shing; u yangi bo'limda ko'rinishi, asl kategoriyada ham qolishi kerak.

Yangi bo'limni ko'rsatish uchun Supabase'ga qo'shimcha kategoriya yaratish shart emas.
