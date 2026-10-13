-- AROMA Do'kon: xaridorlar reytingi. Mavjud buyurtmalarni o'zgartirmaydi.
-- SQL Editor'da bir marta bajaring. Faqat service_role uchun ruxsat.
BEGIN;
SET LOCAL lock_timeout = '8s';

-- Buyurtmaning order_date ustuni TEXT. SQL uni Toshkent mahalliy vaqti sifatida o'qiydi.
-- Joriy buyurtmalar: YYYY-MM-DD HH24:MI:SS; eski importlar: DD/MM/YYYY, HH24:MI:SS.
-- Xato sana matnlari tufayli butun reyting yiqilmasligi uchun NULL qaytariladi.
CREATE OR REPLACE FUNCTION public.aroma_customer_order_time_v1(p_date text)
RETURNS timestamp without time zone
LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $order_time$
DECLARE
    v_text text := btrim(coalesce(p_date, ''));
BEGIN
    IF v_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}([ T][0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?)?$' THEN
        RETURN replace(v_text, 'T', ' ')::timestamp without time zone;
    ELSIF v_text ~ '^[0-9]{2}/[0-9]{2}/[0-9]{4},? ?[0-9]{2}:[0-9]{2}:[0-9]{2}$' THEN
        -- DD/MM/YYYY, HH24:MI:SS -> YYYY-MM-DD HH24:MI:SS
        RETURN (substr(v_text, 7, 4) || '-' || substr(v_text, 4, 2) || '-'
                || substr(v_text, 1, 2) || ' ' || btrim(substr(v_text, 11), ', '))
                ::timestamp without time zone;
    END IF;
    RETURN NULL;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RETURN NULL;
END;
$order_time$;
REVOKE ALL ON FUNCTION public.aroma_customer_order_time_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_customer_order_time_v1(text) TO service_role;


CREATE OR REPLACE FUNCTION public.aroma_customer_rankings_v1(p_days integer DEFAULT 0)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $rankings$
WITH valid_orders AS MATERIALIZED (
    SELECT o.id, o.customer_id, o.customer_name, o.customer_username, o.phone,
           o.order_date, public.aroma_customer_order_time_v1(o.order_date) AS order_ts,
           GREATEST(COALESCE(o.total, 0), 0)::numeric AS amount
    FROM public.orders o
    WHERE p_days IN (0, 7, 30, 90, 365)
      AND COALESCE(o.customer_id, '') ~ '^[1-9][0-9]{0,19}$'
      -- 'archived' intentionally included: archived is not cancelled.
      AND COALESCE(o.status, '') NOT IN ('Bekor qilindi', 'Bekor qilingan', 'Cancelled', 'Canceled')
      AND (p_days = 0 OR public.aroma_customer_order_time_v1(o.order_date)
           >= (now() AT TIME ZONE 'Asia/Tashkent') - make_interval(days => p_days))
),
per_customer AS (
    SELECT customer_id,
           COUNT(*)::integer AS order_count,
           SUM(amount)::numeric AS total_spent,
           MAX(amount)::numeric AS biggest_order,
           MAX(order_ts) AT TIME ZONE 'Asia/Tashkent' AS last_order_at
    FROM valid_orders
    GROUP BY customer_id
),
latest_contacts AS (
    SELECT DISTINCT ON (customer_id) customer_id,
        COALESCE(NULLIF(BTRIM(customer_name),''), 'Noma’lum') AS customer_name,
        COALESCE(customer_username, '') AS customer_username,
        COALESCE(phone, '') AS phone
    FROM valid_orders
    ORDER BY customer_id, order_ts DESC NULLS LAST, id DESC
),
ranked AS MATERIALIZED (
    SELECT p.customer_id, l.customer_name, l.customer_username, l.phone,
           p.order_count, p.total_spent, p.biggest_order, p.last_order_at
    FROM per_customer p
    INNER JOIN latest_contacts l USING (customer_id)
)
SELECT jsonb_build_object(
    'period_days', p_days,
    'customer_count', (SELECT COUNT(*) FROM ranked),
    'order_count', (SELECT COALESCE(SUM(order_count),0) FROM ranked),
    'total_spent', (SELECT COALESCE(SUM(total_spent),0) FROM ranked),
    'by_orders', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.order_count DESC, r.total_spent DESC, r.customer_id),'[]'::jsonb)
       FROM (SELECT * FROM ranked
             ORDER BY order_count DESC, total_spent DESC, customer_id
             LIMIT 50) r),
    'by_spending', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.total_spent DESC, r.order_count DESC, r.customer_id),'[]'::jsonb)
       FROM (SELECT * FROM ranked
             ORDER BY total_spent DESC, order_count DESC, customer_id
             LIMIT 50) r),
    'by_biggest_order', (SELECT COALESCE(jsonb_agg(to_jsonb(r) ORDER BY r.biggest_order DESC, r.total_spent DESC, r.customer_id),'[]'::jsonb)
       FROM (SELECT * FROM ranked
             ORDER BY biggest_order DESC, total_spent DESC, customer_id
             LIMIT 50) r)
)
FROM (SELECT 1) singleton;
$rankings$;

REVOKE ALL ON FUNCTION public.aroma_customer_rankings_v1(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_customer_rankings_v1(integer) TO service_role;
-- Xarid qilgan mijozlarning to'liq ro'yxati. Admin-only, 25 tadan sahifalash.
-- Telegram ID borlar ID bo'yicha, eski ID sizlar telefon bo'yicha guruhlanadi.
-- Buyurtma ID va telefon bir-biriga noto'g'ri bog'lanmasligi uchun telefonli yozuv
-- Telegram ID li yozuv bilan avtomatik birlashtirilmaydi.
CREATE OR REPLACE FUNCTION public.aroma_customer_list_v1(
    p_page integer DEFAULT 1,
    p_search text DEFAULT '',
    p_sort text DEFAULT 'recent'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = pg_catalog, public
AS $customers$
DECLARE
    v_result jsonb;
    v_search text := lower(btrim(coalesce(p_search, '')));
    v_digits text := regexp_replace(coalesce(p_search,''), '[^0-9]', '', 'g');
BEGIN
    IF p_page IS NULL OR p_page < 1 OR p_page > 10000
       OR p_sort NOT IN ('recent','orders','spend','name') OR p_sort IS NULL
       OR length(coalesce(p_search,'')) > 80 THEN
       RAISE EXCEPTION 'Noto‘g‘ri sahifa yoki saralash parametri' USING ERRCODE='22023';
    END IF;

    WITH input_orders AS MATERIALIZED (
        SELECT o.id, nullif(btrim(o.customer_id),'') AS customer_id,
            COALESCE(NULLIF(btrim(o.customer_name),''), 'Noma’lum') AS customer_name,
            COALESCE(o.customer_username,'') AS customer_username,
            COALESCE(o.phone,'') AS phone,
            regexp_replace(coalesce(o.phone,''), '[^0-9]', '', 'g') AS phone_digits,
            o.order_date, public.aroma_customer_order_time_v1(o.order_date) AS order_ts,
            greatest(coalesce(o.total,0),0)::numeric AS amount
        FROM public.orders o
        -- Arxiv buyurtma sifatida saqlanadi; faqat bekor qilinganlar chiqariladi.
        WHERE coalesce(o.status,'') NOT IN ('Bekor qilindi','Bekor qilingan','Cancelled','Canceled')
    ),
    keyed AS MATERIALIZED (
        SELECT i.*,
          CASE WHEN COALESCE(i.customer_id,'') ~ '^[1-9][0-9]{0,19}$'
              THEN 'tg:' || i.customer_id
              WHEN length(i.phone_digits) BETWEEN 9 AND 15
              THEN 'ph:' || i.phone_digits
              ELSE 'old:' || i.id::text END AS person_key
        FROM input_orders i
    ),
    totals AS MATERIALIZED (
        SELECT k.person_key, count(*)::integer AS order_count,
            sum(k.amount)::numeric AS total_spent,
            max(k.amount)::numeric AS biggest_order,
            max(k.order_ts) AT TIME ZONE 'Asia/Tashkent' AS last_order_at
        FROM keyed k GROUP BY k.person_key
    ),
    latest AS MATERIALIZED (
        SELECT DISTINCT ON (person_key) person_key,
            customer_id, customer_name, customer_username, phone
        FROM keyed
        ORDER BY person_key, order_ts DESC NULLS LAST, id DESC
    ),
    buyers AS MATERIALIZED (
        SELECT t.person_key, CASE WHEN l.person_key LIKE 'tg:%' THEN l.customer_id ELSE NULL END AS customer_id,
            l.customer_name, l.customer_username, l.phone,
            t.order_count, t.total_spent, t.biggest_order, t.last_order_at
        FROM totals t JOIN latest l USING (person_key)
    ),
    matched AS MATERIALIZED (
        SELECT b.* FROM buyers b
        WHERE v_search = ''
          OR strpos(lower(b.customer_name),v_search)>0
          OR strpos(lower(b.customer_username),v_search)>0
          OR strpos(lower(coalesce(b.customer_id,'')),v_search)>0
          OR strpos(lower(b.phone),v_search)>0
          OR (length(v_digits)>=3 AND strpos(regexp_replace(b.phone,'[^0-9]','','g'),v_digits)>0)
    ),
    sorted AS MATERIALIZED (
        SELECT m.*, row_number() OVER (
            ORDER BY
                CASE WHEN p_sort='recent' THEN m.last_order_at END DESC NULLS LAST,
                CASE WHEN p_sort='orders' THEN m.order_count END DESC NULLS LAST,
                CASE WHEN p_sort='spend' THEN m.total_spent END DESC NULLS LAST,
                CASE WHEN p_sort='name' THEN lower(m.customer_name) END ASC NULLS LAST,
                m.last_order_at DESC NULLS LAST, m.person_key
        ) AS seq
        FROM matched m
    )
    SELECT jsonb_build_object(
       'page', p_page,
       'page_size', 25,
       'total', (SELECT count(*) FROM matched),
       'rows', coalesce((
           SELECT jsonb_agg(to_jsonb(s) - 'person_key' - 'seq' ORDER BY s.seq)
           FROM sorted s WHERE s.seq > (p_page - 1) * 25 AND s.seq <= p_page * 25
       ),'[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
END;
$customers$;

REVOKE ALL ON FUNCTION public.aroma_customer_list_v1(integer,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_customer_list_v1(integer,text,text) TO service_role;

NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Aroma: mijozlar reytingi va ro‘yxati tayyor' AS result;
