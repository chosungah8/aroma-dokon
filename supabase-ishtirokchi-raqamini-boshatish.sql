-- AROMA: aksiya ishtirokchilarini alohida o‘chirish + eng kichik bo‘sh raqamni qayta berish.
-- Supabase > SQL Editor > Run. Faqat funksiyalarni yaratadi / yangilaydi;
-- ISHTIROKCHILARNI O‘ZI O‘CHIRMAYDI.
-- Muhim: yangi aksiya nomlari va kupon hisob-kitoblari saqlanishi uchun
-- mavjud onlayn/oflayn SQL funksiyalarini butunlay almashtirmaydi,
-- ularning FAQAT raqam ajratish ifodasini almashtiradi.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Har bir ro‘yxatga olish oqimi aksiya satrini FOR UPDATE bilan qulflaydi.
-- Shu sababli parallel kirgan xaridlarda bitta bo‘sh raqam ikki marta berilmaydi.
CREATE OR REPLACE FUNCTION public.aroma_next_promotion_number_v1(
    p_promotion_id bigint, p_min bigint, p_max bigint
) RETURNS bigint
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $number$
    SELECT COALESCE(
        (SELECT p_min WHERE NOT EXISTS (
            SELECT 1 FROM public.promotion_participants a
            WHERE a.promotion_id = p_promotion_id AND a.participant_number = p_min
        )),
        (SELECT a.participant_number::bigint + 1
            FROM public.promotion_participants a
            WHERE a.promotion_id = p_promotion_id
              AND a.participant_number >= p_min AND a.participant_number < p_max
              AND NOT EXISTS (
                SELECT 1 FROM public.promotion_participants b
                WHERE b.promotion_id = p_promotion_id
                  AND b.participant_number = a.participant_number + 1
              )
            ORDER BY a.participant_number LIMIT 1),
        (SELECT COALESCE(MAX(a.participant_number)::bigint, p_min - 1) + 1
            FROM public.promotion_participants a
            WHERE a.promotion_id = p_promotion_id
              AND a.participant_number BETWEEN p_min AND p_max),
        p_min
    );
$number$;
REVOKE ALL ON FUNCTION public.aroma_next_promotion_number_v1(bigint,bigint,bigint)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_next_promotion_number_v1(bigint,bigint,bigint) TO service_role;

-- Admin so‘rovi bitta ishtirokchini atomik o‘chiradi.
-- Boshqa ishtirokchilarning raqamlari MUTLAQO o‘zgarmaydi.
CREATE OR REPLACE FUNCTION public.aroma_delete_promotion_participant_v1(
    p_promotion_id bigint,
    p_participant_number bigint,
    p_expected_customer_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_catalog, public
SET lock_timeout = '8s'
AS $delete$
DECLARE
    v_game public.promotion_settings%ROWTYPE;
    v_row public.promotion_participants%ROWTYPE;
BEGIN
    IF p_promotion_id IS NULL OR p_promotion_id < 1
      OR p_participant_number IS NULL OR p_participant_number < 1
      OR length(coalesce(p_expected_customer_id,'')) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Ishtirokchi ma’lumotlari noto‘g‘ri' USING ERRCODE = 'P0001';
    END IF;

    -- Ro‘yxatga olish va o‘chirish bir xil aksiya satrini bloklaydi.
    SELECT * INTO v_game FROM public.promotion_settings
      WHERE id = p_promotion_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Aksiya topilmadi' USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_row FROM public.promotion_participants
      WHERE promotion_id = p_promotion_id
        AND participant_number = p_participant_number FOR UPDATE;
    IF NOT FOUND OR v_row.customer_id IS DISTINCT FROM p_expected_customer_id THEN
        RAISE EXCEPTION 'Ishtirokchi topilmadi yoki ro‘yxat o‘zgargan. Ro‘yxatni yangilang.'
          USING ERRCODE = 'P0001';
    END IF;

    -- Tarixdagi BUYURTMANI O‘CHIRMAYMIZ: bu qatnashuv havolasini bekor qiladi.
    UPDATE public.orders SET participant_number = NULL
      WHERE promotion_id = p_promotion_id
        AND participant_number = p_participant_number;

    -- Oflayn botning eski xabari takror yuborilsa, eski natijani qaytarmaslik.
    UPDATE public.promotion_bot_registrations
       SET result = result || jsonb_build_object('deleted', true, 'participant_number', null)
     WHERE result->>'promotion_id' = p_promotion_id::text
       AND result->>'participant_number' = p_participant_number::text;

    DELETE FROM public.promotion_participants
      WHERE promotion_id = p_promotion_id
        AND participant_number = p_participant_number
        AND customer_id = p_expected_customer_id;

    -- excel_revision +1: keyingi Excelda o‘chirilgan qatnashuvchi bo‘lmaydi.
    UPDATE public.promotion_settings
       SET excel_revision = excel_revision + 1
     WHERE id = p_promotion_id;

    RETURN jsonb_build_object('deleted', true,
      'deleted_number',p_participant_number,
      'promotion_id',p_promotion_id);
END;
$delete$;
REVOKE ALL ON FUNCTION public.aroma_delete_promotion_participant_v1(bigint,bigint,text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_delete_promotion_participant_v1(bigint,bigint,text)
  TO service_role;

-- Mavjud DB funksiyalari ba’zida kupon yoki aksiya nomiga oid o‘zgarishlarni
-- ham o‘z ichiga olishi mumkin. Ularni eski SQL bilan almashtirmaymiz.
-- Faqat max(raqam)+1 hisobini eng kichik bo‘sh raqam hisobiga almashtiramiz.
DO $patch$
DECLARE
    v_signature text;
    v_fn regprocedure;
    v_sql text;
    v_pattern text;
    v_count int;
    v_changed text;
BEGIN
    v_pattern := 'SELECT[[:space:]]+greatest[[:space:]]*\([[:space:]]*coalesce[[:space:]]*\([[:space:]]*max[[:space:]]*\([[:space:]]*participant_number[[:space:]]*\)::bigint[[:space:]]*\+[[:space:]]*1[[:space:]]*,[[:space:]]*v_game\.min_number[[:space:]]*\)[[:space:]]*,[[:space:]]*v_game\.min_number[[:space:]]*\)[[:space:]]+INTO[[:space:]]+(v_next_number|v_number)[[:space:]]+FROM[[:space:]]+public\.promotion_participants[[:space:]]+WHERE[[:space:]]+promotion_id[[:space:]]*=[[:space:]]*v_game\.id[[:space:]]*;';

    FOREACH v_signature IN ARRAY ARRAY[
        'public.aroma_place_order_v1(text,text,text,text,text,jsonb,text,text)',
        'public.aroma_register_offline_v1(text,text,text,numeric,text)'
    ] LOOP
        v_fn := to_regprocedure(v_signature);
        IF v_fn IS NULL THEN
            RAISE EXCEPTION 'SQL funksiya topilmadi: %. Oldingi SQL migrationlarni tekshiring.', v_signature;
        END IF;
        SELECT pg_get_functiondef(v_fn) INTO v_sql;
        IF position('public.aroma_next_promotion_number_v1(' IN v_sql) > 0 THEN
            RAISE NOTICE 'Oldin o‘rnatilgan: %', v_signature;
            CONTINUE;
        END IF;
        SELECT count(*) INTO v_count FROM regexp_matches(v_sql, v_pattern, 'gi');
        IF v_count <> 1 THEN
            RAISE EXCEPTION 'Raqam ajratish qismi mos kelmadi: %. O‘zgartirish bekor qilindi.',v_signature;
        END IF;
        v_changed := regexp_replace(v_sql, v_pattern,
            'SELECT public.aroma_next_promotion_number_v1(v_game.id, v_game.min_number, v_game.max_number) INTO \1;', 'i');
        EXECUTE v_changed;
        RAISE NOTICE 'Bo‘sh raqamni ajratish yangilandi: %', v_signature;
    END LOOP;
END;
$patch$;
COMMIT;
