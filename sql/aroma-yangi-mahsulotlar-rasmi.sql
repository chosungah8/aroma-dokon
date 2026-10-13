-- Aroma Do‘kon / maxsus Yangi mahsulotlar kategoriyasi rasmi.
-- SQL Editor orqali yangi kodni deploy qilishdan avval bajariladi.
-- Mavjud kategoriyalar, mahsulotlar va buyurtmalar saqlanadi.
ALTER TABLE public.shop_settings
    ADD COLUMN IF NOT EXISTS new_arrivals_image text;
