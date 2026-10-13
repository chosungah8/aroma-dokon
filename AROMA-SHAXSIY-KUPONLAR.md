# Aroma Do‘kon — shaxsiy kuponlar

## O‘rnatish tartibi
1. Avval Supabase SQL Editor'da `sql/aroma-shaxsiy-kuponlar.sql` ni `Run` qiling.
2. So‘ng ZIPdagi fayllarni `~/aroma-dokon` ildiziga oching.
3. `npm test` muvaffaqiyatli tugashini tekshiring.
4. `git add admin.html index.html lib/orders.js lib/server.js lib/personal-coupons.js sql/aroma-shaxsiy-kuponlar.sql tests/personal-coupons.test.js AROMA-SHAXSIY-KUPONLAR.md`
5. `git commit -m "Add personal coupons for individual customers" && git push origin main`
6. Vercel'da **aroma-dokon** loyihasi Ready ekanini tekshiring. Bu `aroma-social-bot` emas!

## Ishlash tartibi
- Admin panel → 🎟️ Kuponlar → 🎁 Shaxsiy kupon.
- Mijozni **telefon** yoki **Telegram ID** bilan tanlaysiz. Telefon izlash faqat ilgari buyurtma bergan mijozlarning `orders.phone` raqamida ishlaydi. Telefon bir nechta akkauntga bog‘langan bo‘lsa tizim foydalanuvchini *taxmin qilmaydi*, Telegram ID so‘raydi.
- Kupon chegirmasi **so‘m** yoki **foiz** bo‘lishi mumkin, minimal summa va 1–365 kunlik muddatni admin belgilaydi.
- Yaratilgan kupon faqat o‘sha tasdiqlangan Telegram akkauntida ishlaydi; kodni boshqalar ishlata olmaydi.
- Bot mijoz bilan avval /start orqali suhbat boshlagan bo‘lsa Telegram orqali xabar yuboradi; aks holda kupon bazada saqlanib qoladi va mijoz do‘konni ochganda ko‘rinadi.
- Oddiy kupon + shaxsiy kupon qo‘shilib ishlaydi. Minimal summa mahsulot/kategoriya chegirmasidan keyingi qiymat asosida, **ikkala kupondan oldin** tekshiriladi. Shaxsiy foiz oddiy kupondan keyin qolgan summadan hisoblanadi. To‘lov manfiy bo‘lmaydi.
- Har bir shaxsiy kupon **faqat bir marta**, buyurtma DB'da muvaffaqiyatli saqlanganda atomik ishlatiladi. Savatdagi shaxsiy kuponni faqat tekshirilgan Telegram identity orqali olish mumkin.
- Boshqa buyurtma bilan ayni kupondan foydalanish yoki qasddan buyurtmani qayta yuborish ikkinchi chegirmaga olib kelmaydi.
- Vaqti tugagan va bekor qilingan kuponlar qo‘llanmaydi. Admin ishlatilmagan kuponni bekor qila oladi.
- **Aksiya/o‘yin minimal summasi** va ishtirokchi berilishi mavjud v2 ichida shaxsiy kupondan *oldin* hisoblanadi. Buni boshqa qoida bo‘yicha qilish kerak bo‘lsa, alohida o‘zgartirish lozim.

## Cheklov va tekshiruv
- Hozirgi migration asosiy `aroma_place_order_v1` yoki `v2` funksiyasini o‘zgartirmaydi, yangi `v3` faqat shaxsiy kuponli xarid uchun ishlatiladi.
- SQL va Node testlar kompyuterda tekshirilgan; jonli DBda buyurtma sinovi alohida bajarilishi shart.
- Agar telefon orqali qidiruv topmasa, Telegram ID bilan bering. Hech kimning telefon raqamini yoki Telegram ID sini ommaviy ravishda chiqarmang.
- SQL o'tmaguncha yangi kodni deploy qilmang.
