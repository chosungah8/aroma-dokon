-- Aroma Do'kon: avtomatik "Yangi mahsulotlar" virtual bo'limi.
-- Eski mahsulotlar, buyurtmalar va kategoriyalarni o'chirmaydi/o'zgartirmaydi.
-- SQL Editor orqali YANGI KODNI deploy qilishdan OLDIN ishga tushiring.

ALTER TABLE public.products
    ADD COLUMN IF NOT EXISTS new_arrival_at timestamptz;

-- Endi kiritiladigan mahsulotlar uchun avtomatik vaqt (barcha qo'shish yo'llarida).
-- Avval mavjud qatorlar NULL bo'lib qoladi, demak eski mahsulotlar avtomatik yangi bo'lmaydi.
ALTER TABLE public.products
    ALTER COLUMN new_arrival_at SET DEFAULT now();

-- Agar mavjud jadvalda mahsulot qo'shilgan vaqt created_at ustunida saqlangan bo'lsa,
-- faqat oxirgi 7 kundagi mahsulotlarni o'tkazib beramiz.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'created_at'
          AND data_type IN ('timestamp with time zone', 'timestamp without time zone')
    ) THEN
        EXECUTE $q$
            UPDATE public.products
               SET new_arrival_at = created_at::timestamptz
             WHERE new_arrival_at IS NULL
               AND created_at <= now()
               AND created_at > now() - interval '7 days'
        $q$;
    END IF;
END
$$;
