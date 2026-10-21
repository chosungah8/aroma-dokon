-- Aroma Do‘kon: welcome-on-first-verified-visit + one-shot top customer campaign.
-- Additive production migration. Does NOT toggle global bonus, change old balances or orders.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';
DO $guard$
BEGIN
 IF to_regclass('public.aroma_bonus_settings') IS NULL OR
    to_regclass('public.aroma_bonus_ledger') IS NULL OR
    to_regclass('public.aroma_bonus_accounts') IS NULL OR
    to_regclass('public.orders') IS NULL OR
    NOT EXISTS(SELECT 1 FROM public.aroma_bonus_settings WHERE id=1 AND rollout_mode='global')
 THEN RAISE EXCEPTION 'STOP: global bonus schema missing'; END IF;
END;
$guard$;

ALTER TABLE public.aroma_bonus_settings
  ADD COLUMN welcome_points bigint NOT NULL DEFAULT 0
    CONSTRAINT aroma_bonus_welcome_points_range CHECK (welcome_points BETWEEN 0 AND 10000);

CREATE TABLE public.aroma_bonus_top_campaigns (
  campaign_key text PRIMARY KEY,
  recipient_limit integer NOT NULL CHECK(recipient_limit BETWEEN 1 AND 20),
  min_orders integer NOT NULL CHECK(min_orders BETWEEN 1 AND 100),
  points bigint NOT NULL CHECK(points BETWEEN 1 AND 100000),
  awarded_count integer NOT NULL DEFAULT 0 CHECK(awarded_count BETWEEN 0 AND 20),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON public.aroma_bonus_top_campaigns FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.aroma_bonus_top_campaigns TO service_role;

-- Called ONLY from /api/bonus/balance after server validates Telegram initData.
-- No Telegram IDs supplied from browser query params; idempotent per customer.
CREATE OR REPLACE FUNCTION public.aroma_bonus_welcome_v1(p_customer_id text)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog','public'
SET lock_timeout TO '8s'
AS $function$
DECLARE
  v_settings public.aroma_bonus_settings%ROWTYPE;
  v_balance bigint;
BEGIN
  IF coalesce(p_customer_id,'') !~ '^[1-9][0-9]{0,19}$'
  THEN RAISE EXCEPTION 'STOP: invalid Telegram customer identity'; END IF;
  SELECT * INTO v_settings FROM public.aroma_bonus_settings WHERE id=1 FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'STOP: bonus settings absent'; END IF;
  IF v_settings.rollout_mode<>'global' OR NOT v_settings.enabled OR v_settings.welcome_points=0
  THEN RETURN jsonb_build_object('ok',true,'granted',false,'reason','disabled'); END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('bonus:welcome:'||p_customer_id,0));
  -- Existing customers (including historical/cancelled orders or pilot accounts)
  -- cannot be relabeled new. This is a first BONUS-account acquisition award.
  IF EXISTS(SELECT 1 FROM public.aroma_bonus_accounts WHERE customer_id=p_customer_id) OR
     EXISTS(SELECT 1 FROM public.orders WHERE customer_id=p_customer_id)
  THEN RETURN jsonb_build_object('ok',true,'granted',false,'reason','existing'); END IF;

  INSERT INTO public.aroma_bonus_accounts(customer_id,balance)
     VALUES(p_customer_id,v_settings.welcome_points)
     RETURNING balance INTO v_balance;
  INSERT INTO public.aroma_bonus_ledger
     (customer_id,kind,amount,request_key,reason)
     VALUES(p_customer_id,'admin_grant',v_settings.welcome_points,
         'welcome:v1:'||p_customer_id,'Yangi mijoz uchun bir martalik sovg‘a');
  RETURN jsonb_build_object('ok',true,'granted',true,'balance',v_balance);
END;
$function$;

-- Top buyers are selected by COMPLETED order count, then paid turnover.
-- Old orders are not modified; only CRM-derived read-only counts are returned.
CREATE OR REPLACE FUNCTION public.aroma_bonus_top_customers_v1(
    p_limit integer DEFAULT 10, p_min_orders integer DEFAULT 1)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path TO 'pg_catalog','public'
AS $function$
DECLARE v_results jsonb;
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR
     p_min_orders IS NULL OR p_min_orders NOT BETWEEN 1 AND 100
  THEN RAISE EXCEPTION 'STOP: top customer parameters invalid'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
        'customerId',s.customer_id,'customerName',s.customer_name,
        'ordersCount',s.orders_count,'paidTotal',s.paid_total)
        ORDER BY s.orders_count DESC,s.paid_total DESC,s.customer_id ASC),'[]'::jsonb)
  INTO v_results
  FROM (
    SELECT o.customer_id,max(nullif(btrim(o.customer_name),'')) AS customer_name,
           count(*)::integer AS orders_count,
           coalesce(sum(greatest(0,o.total-o.bonus_spent)),0) AS paid_total
      FROM public.orders o
     WHERE o.status='Yakunlandi' AND o.customer_id ~ '^[1-9][0-9]{0,19}$'
     GROUP BY o.customer_id
     HAVING count(*)>=p_min_orders
     ORDER BY orders_count DESC,paid_total DESC,o.customer_id ASC
     LIMIT p_limit
  ) s;
  RETURN v_results;
END;
$function$;

-- One admin-approved campaign; reusing the same UUID NEVER awards twice.
CREATE OR REPLACE FUNCTION public.aroma_bonus_reward_top_v1(
    p_campaign_key text, p_limit integer, p_min_orders integer, p_points bigint)
RETURNS jsonb LANGUAGE plpgsql SET search_path TO 'pg_catalog','public'
SET lock_timeout TO '8s'
AS $function$
DECLARE
 v_previous public.aroma_bonus_top_campaigns%ROWTYPE;
 v_rec record;
 v_balance bigint;
 v_awarded integer:=0;
 v_settings public.aroma_bonus_settings%ROWTYPE;
BEGIN
 IF coalesce(p_campaign_key,'') !~
    '^top:[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' OR
    p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 20 OR
    p_min_orders IS NULL OR p_min_orders NOT BETWEEN 1 AND 100 OR
    p_points IS NULL OR p_points NOT BETWEEN 1 AND 100000
 THEN RAISE EXCEPTION 'STOP: top gift parameters invalid'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('bonus:top:'||p_campaign_key,0));
 SELECT * INTO v_previous FROM public.aroma_bonus_top_campaigns WHERE campaign_key=p_campaign_key;
 IF FOUND THEN
   IF v_previous.recipient_limit<>p_limit OR v_previous.min_orders<>p_min_orders OR
      v_previous.points<>p_points THEN RAISE EXCEPTION 'STOP: campaign key reused with changes'; END IF;
   RETURN jsonb_build_object('ok',true,'duplicate',true,'awardedCount',v_previous.awarded_count);
 END IF;
 SELECT * INTO v_settings FROM public.aroma_bonus_settings WHERE id=1 FOR SHARE;
 IF NOT FOUND OR v_settings.rollout_mode<>'global' OR NOT v_settings.enabled
 THEN RAISE EXCEPTION 'STOP: global bonus must be active before top reward'; END IF;

 FOR v_rec IN
   SELECT o.customer_id,count(*)::integer AS orders_count,
      coalesce(sum(greatest(0,o.total-o.bonus_spent)),0) AS paid_total
   FROM public.orders o
   WHERE o.status='Yakunlandi' AND o.customer_id ~ '^[1-9][0-9]{0,19}$'
   GROUP BY o.customer_id HAVING count(*)>=p_min_orders
   ORDER BY orders_count DESC,paid_total DESC,o.customer_id ASC
   LIMIT p_limit
 LOOP
   INSERT INTO public.aroma_bonus_accounts(customer_id,balance)
     VALUES(v_rec.customer_id,0) ON CONFLICT(customer_id) DO NOTHING;
   UPDATE public.aroma_bonus_accounts SET balance=balance+p_points,updated_at=now()
    WHERE customer_id=v_rec.customer_id AND balance<=1000000000-p_points
    RETURNING balance INTO v_balance;
   IF NOT FOUND THEN RAISE EXCEPTION 'STOP: customer balance limit exceeded'; END IF;
   INSERT INTO public.aroma_bonus_ledger (customer_id,kind,amount,request_key,reason)
    VALUES(v_rec.customer_id,'admin_grant',p_points,
       'top:'||p_campaign_key||':'||v_rec.customer_id,
       'Eng faol xaridorlar uchun bir martalik aksiya');
   v_awarded:=v_awarded+1;
 END LOOP;
 IF v_awarded=0 THEN RAISE EXCEPTION 'STOP: no completed-order customers matched'; END IF;
 INSERT INTO public.aroma_bonus_top_campaigns
    (campaign_key,recipient_limit,min_orders,points,awarded_count)
    VALUES (p_campaign_key,p_limit,p_min_orders,p_points,v_awarded);
 RETURN jsonb_build_object('ok',true,'duplicate',false,'awardedCount',v_awarded);
END;
$function$;

REVOKE ALL ON FUNCTION public.aroma_bonus_welcome_v1(text)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_bonus_welcome_v1(text) TO service_role;
REVOKE ALL ON FUNCTION public.aroma_bonus_top_customers_v1(integer,integer)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_bonus_top_customers_v1(integer,integer) TO service_role;
REVOKE ALL ON FUNCTION public.aroma_bonus_reward_top_v1(text,integer,integer,bigint)
 FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_bonus_reward_top_v1(text,integer,integer,bigint)
 TO service_role;

DO $verify$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.aroma_bonus_settings WHERE id=1 AND welcome_points=0)
 THEN RAISE EXCEPTION 'STOP: welcome is not OFF by default'; END IF;
END;
$verify$;
COMMIT;
-- READ-ONLY check: no points added and current global enabled value remains unchanged.
SELECT id,enabled,rollout_mode,welcome_points
FROM public.aroma_bonus_settings WHERE id=1;
NOTIFY pgrst, 'reload schema';
