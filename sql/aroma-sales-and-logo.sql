-- AROMA DO'KON: sales dashboard and admin-configurable logo.
-- Run in the REAL Aroma Do'kon Supabase project's SQL Editor before deploying new code.
-- Safe to run twice. Does not update orders, bonus accounts, coupons or products.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

ALTER TABLE public.shop_settings
    ADD COLUMN IF NOT EXISTS logo_url text NOT NULL DEFAULT '';

-- Only completed (paid) orders count as sales. Uses the original local
-- order_date (text, ISO YYYY-MM-DD) for reporting, NOT a completion timestamp.
-- Revenue is net of coupons and spent Bonus Ball, excluding delivery fees.
CREATE OR REPLACE FUNCTION public.aroma_sales_summary_v1(p_period text DEFAULT 'month')
RETURNS jsonb
LANGUAGE sql STABLE
SET search_path = ''
AS $function$
WITH bounds AS (
    SELECT (now() AT TIME ZONE 'Asia/Tashkent')::date AS today
),
sales AS (
    SELECT o.id, left(o.order_date,10) AS d,
           greatest(0, coalesce(o.total,0) - coalesce(o.bonus_spent,0)) AS revenue,
           CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END AS items
    FROM public.orders o
    WHERE o.status = 'Yakunlandi'
      AND o.order_date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
),
order_units AS (
    SELECT s.id, s.d, s.revenue,
        coalesce((
          SELECT sum(CASE WHEN item->>'count' ~ '^[0-9]{1,8}$'
               THEN least((item->>'count')::bigint, 1000000) ELSE 0 END)
          FROM jsonb_array_elements(s.items) AS line(item)
        ), 0) AS units
    FROM sales s
),
period_rows AS (
    SELECT 'today' AS period, u.* FROM order_units u, bounds b WHERE u.d = b.today::text
    UNION ALL
    SELECT 'month', u.* FROM order_units u, bounds b WHERE left(u.d,7) = to_char(b.today,'YYYY-MM')
    UNION ALL
    SELECT 'year', u.* FROM order_units u, bounds b WHERE left(u.d,4) = to_char(b.today,'YYYY')
    UNION ALL
    SELECT 'all', u.* FROM order_units u
),
period_totals AS (
    SELECT period, count(*) AS orders,
           coalesce(sum(revenue),0) AS revenue,
           coalesce(sum(units),0) AS units
    FROM period_rows GROUP BY period
),
selected_orders AS (
    SELECT s.* FROM sales s, bounds b
    WHERE p_period IN ('today','month','year','all')
      AND (p_period = 'all'
        OR (p_period = 'today' AND s.d = b.today::text)
        OR (p_period = 'month' AND left(s.d,7) = to_char(b.today,'YYYY-MM'))
        OR (p_period = 'year' AND left(s.d,4) = to_char(b.today,'YYYY')))
),
item_rows AS (
    SELECT s.id AS order_id,
           coalesce(nullif(item->>'id',''), nullif(item->>'name',''), 'unknown') AS product_key,
           left(coalesce(nullif(item->>'name',''),'Noma’lum mahsulot'),180) AS product_name,
           CASE WHEN item->>'count' ~ '^[0-9]{1,8}$'
                THEN least((item->>'count')::bigint,1000000) ELSE 0 END AS units
    FROM selected_orders s CROSS JOIN LATERAL jsonb_array_elements(s.items) AS line(item)
),
top_products AS (
    SELECT product_key, max(product_name) AS name, sum(units) AS units,
           count(DISTINCT order_id) AS orders
    FROM item_rows WHERE units > 0
    GROUP BY product_key ORDER BY sum(units) DESC, product_key LIMIT 10
)
SELECT jsonb_build_object(
    'timezone','Asia/Tashkent', 'period',p_period,
    'today',jsonb_build_object(
        'orders',coalesce((SELECT orders FROM period_totals WHERE period='today'),0),
        'revenue',coalesce((SELECT revenue FROM period_totals WHERE period='today'),0),
        'units',coalesce((SELECT units FROM period_totals WHERE period='today'),0)),
    'month',jsonb_build_object(
        'orders',coalesce((SELECT orders FROM period_totals WHERE period='month'),0),
        'revenue',coalesce((SELECT revenue FROM period_totals WHERE period='month'),0),
        'units',coalesce((SELECT units FROM period_totals WHERE period='month'),0)),
    'year',jsonb_build_object(
        'orders',coalesce((SELECT orders FROM period_totals WHERE period='year'),0),
        'revenue',coalesce((SELECT revenue FROM period_totals WHERE period='year'),0),
        'units',coalesce((SELECT units FROM period_totals WHERE period='year'),0)),
    'all',jsonb_build_object(
        'orders',coalesce((SELECT orders FROM period_totals WHERE period='all'),0),
        'revenue',coalesce((SELECT revenue FROM period_totals WHERE period='all'),0),
        'units',coalesce((SELECT units FROM period_totals WHERE period='all'),0)),
    'top_products',coalesce((SELECT jsonb_agg(jsonb_build_object(
        'id',p.product_key,'name',p.name,'units',p.units,'orders',p.orders)
        ORDER BY p.units DESC, p.product_key) FROM top_products p),'[]'::jsonb)
);
$function$;

-- PostgreSQL grants EXECUTE on newly-created functions to PUBLIC by default.
-- Only the server's service_role may invoke this RPC.
REVOKE ALL ON FUNCTION public.aroma_sales_summary_v1(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_sales_summary_v1(text) TO service_role;
-- Check both objects *inside* the transaction: errors roll everything back.
SELECT column_name FROM information_schema.columns
 WHERE table_schema='public' AND table_name='shop_settings' AND column_name='logo_url';
SELECT public.aroma_sales_summary_v1('month') AS safe_aggregate_only;
COMMIT;
