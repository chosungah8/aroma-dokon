-- BIR MARTA Supabase -> SQL Editor'da bajaring.
-- Mavjud aksiyalar / ishtirokchilar / raqamlar o‘zgarmaydi.
BEGIN;
ALTER TABLE public.promotion_settings
    ADD COLUMN IF NOT EXISTS name text NOT NULL DEFAULT 'Nomsiz aksiya';
UPDATE public.promotion_settings
SET name = 'Nomsiz aksiya'
WHERE name IS NULL OR btrim(name) = '';
ALTER TABLE public.promotion_settings ALTER COLUMN name SET NOT NULL;
ALTER TABLE public.promotion_settings ALTER COLUMN name SET DEFAULT 'Nomsiz aksiya';
DO $$
BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conrelid = 'public.promotion_settings'::regclass
       AND conname = 'promotion_settings_name_valid'
    ) THEN
        ALTER TABLE public.promotion_settings
          ADD CONSTRAINT promotion_settings_name_valid
          CHECK (char_length(btrim(name)) BETWEEN 1 AND 100);
    END IF;
END $$;
COMMIT;
