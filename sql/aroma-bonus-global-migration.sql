-- AROMA DO'KON: Bonus Ball pilot -> global, admin-managed.
-- IMPORTANT: Production schema has already been installed and tested.
-- Run only when settings.enabled=false.  Does NOT enable bonus automatically.
-- Transactional migration.  Existing balances and order ledger are retained.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='90s';

DO $check$
BEGIN
 IF to_regclass('public.aroma_bonus_settings') IS NULL
    OR to_regclass('public.aroma_bonus_accounts') IS NULL
    OR to_regclass('public.aroma_bonus_ledger') IS NULL
    OR to_regclass('public.aroma_bonus_pilot_allowlist') IS NULL
 THEN RAISE EXCEPTION 'STOP: production pilot schema absent'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.aroma_bonus_settings WHERE id=1 AND enabled=false)
 THEN RAISE EXCEPTION 'STOP: disable Bonus Ball before global migration'; END IF;
 IF EXISTS(SELECT 1 FROM public.aroma_bonus_ledger WHERE kind='redeemed')
 THEN RAISE EXCEPTION 'STOP: inspect past redemptions before global migration'; END IF;
 IF EXISTS(SELECT 1 FROM public.orders WHERE bonus_spent<>0 OR bonus_awarded<>0 OR bonus_expected<>0)
 THEN RAISE EXCEPTION 'STOP: inspect existing bonus orders before global migration'; END IF;
END;
$check$;

ALTER TABLE public.aroma_bonus_settings
  ADD COLUMN rollout_mode text NOT NULL DEFAULT 'pilot'
  CONSTRAINT aroma_bonus_rollout_mode_check CHECK(rollout_mode IN ('pilot','global'));

CREATE OR REPLACE FUNCTION public.aroma_bonus_redeem_quote_v1(p_customer_id text, p_total_after_coupons numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_settings public.aroma_bonus_settings%ROWTYPE;
    v_balance bigint := 0;
    v_max bigint := 0;
    v_reason text;
BEGIN
    IF p_customer_id IS NULL
       OR p_customer_id !~ '^[1-9][0-9]{0,19}$' THEN
        RAISE EXCEPTION 'Mijoz ID noto‘g‘ri' USING ERRCODE = 'P0001';
    END IF;
    IF p_total_after_coupons IS NULL
       OR p_total_after_coupons::text IN ('NaN', 'Infinity', '-Infinity')
       OR p_total_after_coupons < 0
       OR p_total_after_coupons > 1000000000000 THEN
        RAISE EXCEPTION 'Buyurtmaning mahsulot summasi noto‘g‘ri'
            USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_settings
      FROM public.aroma_bonus_settings WHERE id = 1;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Bonus sozlamasi topilmadi' USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(balance,0) INTO v_balance
      FROM public.aroma_bonus_accounts
     WHERE customer_id = p_customer_id;
    v_balance := coalesce(v_balance,0);

    IF v_settings.enabled IS DISTINCT FROM true THEN
        v_reason := 'bonus_disabled';
    ELSIF p_total_after_coupons < v_settings.min_redeem_order THEN
        v_reason := 'below_minimum_order';
    ELSIF v_balance <= 0 THEN
        v_reason := 'no_points';
    ELSE
        -- 1 ball = 1 so'm. Ruxsat etilgan foiz va real balansdan oshirmaymiz.
        v_max := least(
            v_balance,
            floor(p_total_after_coupons)::bigint,
            floor(p_total_after_coupons * v_settings.max_redeem_percent / 100)::bigint
        );
        v_reason := CASE WHEN v_max > 0 THEN 'available' ELSE 'limit_zero' END;
    END IF;

    RETURN jsonb_build_object(
        'enabled', v_settings.enabled,
        'balance', v_balance,
        'max_redeemable', v_max,
        'min_redeem_order', v_settings.min_redeem_order,
        'max_redeem_percent', v_settings.max_redeem_percent,
        'reason', v_reason,
        'spends_points', false
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aroma_bonus_snapshot_order_v1()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
    v_eligible numeric;
BEGIN
    -- Tamomlangan / bekor qilingan / jarayondagi buyurtmalarning tarixiy ballini
    -- qayta hisoblamaymiz; eski buyurtmalarni avtomatik ravishda ballga o'tkazmaymiz.
    IF NEW.status IS DISTINCT FROM 'Yangi' OR NEW.bonus_awarded <> 0 THEN
        RETURN NEW;
    END IF;

    -- All future verified Telegram orders use snapshotted percentages.
    -- Offline/anonymous orders cannot accrue points into invalid accounts.
    IF NEW.customer_id IS NULL OR
       NEW.customer_id !~ '^[1-9][0-9]{0,19}$' THEN
        NEW.bonus_expected := 0;
        RETURN NEW;
    END IF;

    -- Boshqa ustun (masalan, updated status) o'zgargan bo'lsa avvalgi snapshot turadi.
    IF TG_OP = 'UPDATE' THEN
        IF NEW.items IS NOT DISTINCT FROM OLD.items
           AND NEW.total IS NOT DISTINCT FROM OLD.total
           AND NEW.bonus_spent IS NOT DISTINCT FROM OLD.bonus_spent THEN
            RETURN NEW;
        END IF;
    END IF;

    -- Buyurtma summasi mahsulot va kupon chegirmalaridan keyingi summa.
    -- Keyinchalik ball SARFLASH yoqilganda sarflangan ball shu summadan ayriladi.
    -- Kupon minimumi va bepul yetkazish hisobini bu yerda o'zgartirmaymiz.
    v_eligible := greatest(0, NEW.total - NEW.bonus_spent);
    NEW.bonus_expected := public.aroma_bonus_preview_v1(NEW.items, v_eligible, clock_timestamp());
    RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aroma_bonus_complete_order_v1(p_order_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '8s'
AS $function$
DECLARE
    v_order public.orders%ROWTYPE;
    v_amount bigint;
    v_balance bigint;
    v_earned_exists boolean;
BEGIN
    IF p_order_id IS NULL OR length(p_order_id) NOT BETWEEN 1 AND 150 THEN
        RAISE EXCEPTION 'Buyurtma ID noto‘g‘ri' USING ERRCODE='P0001';
    END IF;

    -- Bir xil buyurtmani parallel yakunlashlar bu yerda navbat kutadi.
    SELECT * INTO v_order
      FROM public.orders WHERE id = p_order_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Buyurtma topilmadi' USING ERRCODE='P0001';
    END IF;

    -- Only orders with an actual snapshotted bonus obligation arrive here.
    -- Existing orders without bonus remain on the legacy admin status route.

    -- Never use this special RPC on ordinary historical orders.
    IF v_order.bonus_expected = 0 AND v_order.bonus_spent = 0 THEN
        RAISE EXCEPTION 'Bu buyurtmada bonus majburiyati yo‘q' USING ERRCODE='P0001';
    END IF;

    v_amount := v_order.bonus_expected;
    IF v_amount IS NULL OR v_amount < 0 OR v_amount > 1000000000 THEN
        RAISE EXCEPTION 'Buyurtma balli tekshirishni talab qiladi' USING ERRCODE='P0001';
    END IF;
    -- Xaridda sarflangan ball tarixda aniq qayd etilgan bo'lishi kerak.
    IF (v_order.bonus_spent > 0 AND NOT EXISTS (
         SELECT 1 FROM public.aroma_bonus_ledger
         WHERE order_id = v_order.id AND customer_id = v_order.customer_id
           AND kind = 'redeemed' AND amount = -v_order.bonus_spent
       )) OR (v_order.bonus_spent = 0 AND EXISTS (
         SELECT 1 FROM public.aroma_bonus_ledger
         WHERE order_id = v_order.id AND kind = 'redeemed'
       )) THEN
        RAISE EXCEPTION 'Sarflangan ball tarixi buyurtmaga mos emas' USING ERRCODE='P0001';
    END IF;
    IF v_order.bonus_spent < 0 THEN
        RAISE EXCEPTION 'Sarflangan ball noto‘g‘ri' USING ERRCODE='P0001';
    END IF;

    SELECT EXISTS (
      SELECT 1 FROM public.aroma_bonus_ledger
       WHERE order_id = v_order.id AND kind = 'earned'
    ) INTO v_earned_exists;

    -- Takror so'rov xavfsiz va balansni ikkinchi marta o'zgartirmaydi.
    IF v_order.status = 'Yakunlandi' THEN
        IF v_order.bonus_awarded IS DISTINCT FROM v_amount
           OR (v_amount > 0 AND NOT EXISTS (
               SELECT 1 FROM public.aroma_bonus_ledger
                WHERE order_id = v_order.id AND kind = 'earned'
                  AND customer_id = v_order.customer_id
                  AND amount = v_amount
           ))
           OR (v_amount = 0 AND v_earned_exists) THEN
            RAISE EXCEPTION 'Yakunlangan buyurtmaning ball tarixida nomuvofiqlik bor'
                USING ERRCODE='P0001';
        END IF;
        RETURN jsonb_build_object(
            'ok',true,'status','Yakunlandi',
            'bonus_berildi',0,'oldin_berilgan',v_order.bonus_awarded,
            'takroriy',true);
    END IF;

    IF v_order.status <> 'Yetkazilmoqda' THEN
        RAISE EXCEPTION 'Avval buyurtmani Yetkazilmoqda bosqichiga o‘tkazing'
            USING ERRCODE='P0001';
    END IF;
    IF v_order.bonus_awarded <> 0 OR v_earned_exists THEN
        RAISE EXCEPTION 'Bu buyurtmada oldin ball harakati qayd etilgan'
            USING ERRCODE='P0001';
    END IF;

    IF v_amount > 0 THEN
        IF coalesce(v_order.customer_id,'') !~ '^[1-9][0-9]{0,19}$' THEN
            RAISE EXCEPTION 'Mijoz ID noto‘g‘ri: ball berib bo‘lmaydi'
                USING ERRCODE='P0001';
        END IF;

        INSERT INTO public.aroma_bonus_accounts(customer_id,balance)
          VALUES(v_order.customer_id,0)
          ON CONFLICT (customer_id) DO NOTHING;

        UPDATE public.aroma_bonus_accounts
           SET balance = balance + v_amount, updated_at = now()
         WHERE customer_id = v_order.customer_id
         RETURNING balance INTO v_balance;

        INSERT INTO public.aroma_bonus_ledger
            (customer_id, order_id, kind, amount, request_key)
          VALUES (v_order.customer_id, v_order.id, 'earned', v_amount,
                  'order:earned:' || v_order.id);
    END IF;

    -- Account, ledger va buyurtma statusi yagona tranzaksiyada saqlanadi.
    UPDATE public.orders
       SET status = 'Yakunlandi', bonus_awarded = v_amount
     WHERE id = v_order.id;

    RETURN jsonb_build_object(
        'ok',true,'status','Yakunlandi',
        'bonus_berildi',v_amount,'takroriy',false,
        'balans',v_balance);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aroma_bonus_cancel_order_v1(p_order_id text, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '8s'
AS $function$
DECLARE
  v_order public.orders%ROWTYPE;
  v_reason text := btrim(coalesce(p_reason,''));
  v_item jsonb;
  v_row record;
  v_count integer;
  v_balance bigint;
  v_n integer;
BEGIN
  IF p_order_id IS NULL OR length(p_order_id) NOT BETWEEN 1 AND 150 THEN
    RAISE EXCEPTION 'Buyurtma ID noto‘g‘ri' USING ERRCODE='P0001';
  END IF;

  -- Qayta so'rov yoki ikkita parallel so'rov buyurtma qatori bo'yicha ketma-ket ishlaydi.
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Buyurtma topilmadi' USING ERRCODE='P0001';
  END IF;
  -- Global bonus order cancellation verifies ledger and refunds atomically.
  IF v_order.bonus_expected = 0 AND v_order.bonus_spent = 0 AND v_order.bonus_awarded = 0 THEN
    RAISE EXCEPTION 'Bu buyurtmada bonus majburiyati yo‘q' USING ERRCODE='P0001';
  END IF;
  IF v_order.status = 'Bekor qilindi' THEN
    IF v_order.cancelled_at IS NULL OR v_order.cancel_reason IS NULL THEN
      RAISE EXCEPTION 'Eski bekor qilingan buyurtmani qo‘lda tekshiring' USING ERRCODE='P0001';
    END IF;
    RETURN jsonb_build_object('ok',true,'status','Bekor qilindi',
      'takroriy',true,'qaytarilgan_ball',0);
  END IF;

  IF v_order.status NOT IN
     ('Yangi','Qabul qilindi','Tayyorlanmoqda','Yetkazilmoqda','Yakunlandi') THEN
    RAISE EXCEPTION 'Ushbu buyurtma holatini bekor qilib bo‘lmaydi' USING ERRCODE='P0001';
  END IF;
  IF length(v_reason) NOT BETWEEN 5 AND 500 THEN
    RAISE EXCEPTION 'Bekor qilish sababini 5–500 belgida kiriting' USING ERRCODE='P0001';
  END IF;
  IF v_order.request_key IS NULL OR btrim(v_order.request_key) = '' THEN
    RAISE EXCEPTION 'Buyurtma rezerv manbasi noma’lum: avval qo‘lda tekshiring' USING ERRCODE='P0001';
  END IF;
  IF v_order.bonus_spent < 0 OR v_order.bonus_spent > 1000000000 THEN
    RAISE EXCEPTION 'Sarflangan ball noto‘g‘ri' USING ERRCODE='P0001';
  END IF;
  -- Xarid uchun yechilgan ball faqat bitta haqiqiy ledger yozuviga mos bo'lishi shart.
  IF (v_order.bonus_spent > 0 AND NOT EXISTS (
       SELECT 1 FROM public.aroma_bonus_ledger
       WHERE order_id=v_order.id AND customer_id=v_order.customer_id
         AND kind='redeemed' AND amount=-v_order.bonus_spent
     )) OR (v_order.bonus_spent = 0 AND EXISTS (
       SELECT 1 FROM public.aroma_bonus_ledger
       WHERE order_id=v_order.id AND kind='redeemed'
     )) OR EXISTS (
       SELECT 1 FROM public.aroma_bonus_ledger
       WHERE order_id=v_order.id AND kind='redeem_refund'
     ) THEN
    RAISE EXCEPTION 'Sarflangan ball qaytarish tarixi tekshirishni talab qiladi' USING ERRCODE='P0001';
  END IF;
  IF v_order.promotion_id IS NOT NULL AND v_order.participant_number IS NOT NULL THEN
    RAISE EXCEPTION 'Aksiya ishtirokchisi bor: raqam taqsimotini admin tekshirishi kerak' USING ERRCODE='P0001';
  END IF;
  IF v_order.status = 'Yakunlandi' AND v_order.bonus_awarded IS DISTINCT FROM v_order.bonus_expected THEN
    RAISE EXCEPTION 'Yakunlangan buyurtmadagi ball summalari mos emas' USING ERRCODE='P0001';
  END IF;
  IF v_order.status <> 'Yakunlandi' AND v_order.bonus_awarded <> 0 THEN
    RAISE EXCEPTION 'Ball va buyurtma holatida nomuvofiqlik bor' USING ERRCODE='P0001';
  END IF;
  IF v_order.bonus_awarded < 0 OR v_order.bonus_awarded > 1000000000 THEN
    RAISE EXCEPTION 'Buyurtmadagi berilgan ball noto‘g‘ri' USING ERRCODE='P0001';
  END IF;

  SELECT count(*) INTO v_n FROM public.aroma_bonus_ledger
    WHERE order_id = v_order.id AND kind='earned';
  IF (v_order.bonus_awarded > 0 AND v_n <> 1)
     OR (v_order.bonus_awarded = 0 AND v_n <> 0) THEN
    RAISE EXCEPTION 'Bonus tarixini tekshirish kerak' USING ERRCODE='P0001';
  END IF;
  IF v_order.bonus_awarded > 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.aroma_bonus_ledger
      WHERE order_id=v_order.id AND customer_id=v_order.customer_id
        AND kind='earned' AND amount=v_order.bonus_awarded
    ) THEN
      RAISE EXCEPTION 'Berilgan ball tarixi buyurtmaga mos emas' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF v_order.bonus_awarded > 0 OR v_order.bonus_spent > 0 THEN
    SELECT balance INTO v_balance FROM public.aroma_bonus_accounts
      WHERE customer_id=v_order.customer_id FOR UPDATE;
    IF v_balance IS NULL OR v_balance + v_order.bonus_spent < v_order.bonus_awarded THEN
      RAISE EXCEPTION 'Qaytariladigan ball yetarli emas: admin tekshiruvi kerak' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Eski yoki noto'g'ri yozilgan order.items bo'lsa, taxminiy restock QILMAYMIZ.
  IF jsonb_typeof(v_order.items) IS DISTINCT FROM 'array'
     OR jsonb_array_length(v_order.items) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'Buyurtma mahsulotlari tekshirishni talab qiladi' USING ERRCODE='P0001';
  END IF;
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_order.items) LOOP
    IF jsonb_typeof(v_item) <> 'object'
       OR coalesce(v_item->>'id','') !~ '^[1-9][0-9]{0,17}$'
       OR coalesce(v_item->>'count','') !~ '^[1-9][0-9]{0,8}$' THEN
      RAISE EXCEPTION 'Buyurtmadagi mahsulot ID/soni noto‘g‘ri' USING ERRCODE='P0001';
    END IF;
  END LOOP;

  -- Mahsulot ID bo'yicha tartiblangan locklar deadlock ehtimolini pasaytiradi.
  FOR v_row IN
    SELECT (e.elem->>'id')::bigint AS product_id,
           sum((e.elem->>'count')::bigint) AS qty
      FROM jsonb_array_elements(v_order.items) AS e(elem)
     GROUP BY (e.elem->>'id')::bigint
     ORDER BY (e.elem->>'id')::bigint
  LOOP
    IF v_row.qty > 2147483647 THEN
      RAISE EXCEPTION 'Mahsulot soni juda katta: %', v_row.product_id USING ERRCODE='P0001';
    END IF;
    UPDATE public.products
       SET stock = stock + v_row.qty::integer
     WHERE id=v_row.product_id
       AND stock <= 2147483647 - v_row.qty::integer;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mahsulot topilmadi yoki qoldiqni tekshirish kerak: %', v_row.product_id
        USING ERRCODE='P0001';
    END IF;
  END LOOP;

  IF nullif(btrim(coalesce(v_order.coupon_code,'')), '') IS NOT NULL THEN
    UPDATE public.coupons SET used_count=used_count-1
      WHERE code=v_order.coupon_code AND used_count > 0;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Oddiy kupon tarixida nomuvofiqlik bor' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF v_order.personal_coupon_id IS NOT NULL THEN
    UPDATE public.personal_coupons
       SET used_at=NULL, used_order_id=NULL
     WHERE id=v_order.personal_coupon_id
       AND used_order_id=v_order.id AND used_at IS NOT NULL;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shaxsiy kupon tarixida nomuvofiqlik bor' USING ERRCODE='P0001';
    END IF;
  END IF;

  -- Bir tranzaksiyada: sarflangan ballni qaytarish va berilgan ballni qaytarib olish.
  IF v_order.bonus_awarded > 0 OR v_order.bonus_spent > 0 THEN
    UPDATE public.aroma_bonus_accounts
       SET balance=balance+v_order.bonus_spent-v_order.bonus_awarded, updated_at=now()
     WHERE customer_id=v_order.customer_id
       AND balance+v_order.bonus_spent >= v_order.bonus_awarded;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Ball balansida nomuvofiqlik' USING ERRCODE='P0001';
    END IF;
  END IF;
  IF v_order.bonus_spent > 0 THEN
    INSERT INTO public.aroma_bonus_ledger
      (customer_id,order_id,kind,amount,request_key,reason)
    VALUES (v_order.customer_id,v_order.id,'redeem_refund',
      v_order.bonus_spent,'order:redeem-refund:'||v_order.id,v_reason);
  END IF;
  IF v_order.bonus_awarded > 0 THEN
    INSERT INTO public.aroma_bonus_ledger
      (customer_id,order_id,kind,amount,request_key,reason)
    VALUES (v_order.customer_id,v_order.id,'cancel_reversal',
      -v_order.bonus_awarded,'order:cancel:'||v_order.id,v_reason);
  END IF;

  UPDATE public.orders
     SET status='Bekor qilindi', cancel_reason=v_reason,
         cancelled_at=clock_timestamp(), bonus_expected=0, bonus_awarded=0
   WHERE id=v_order.id;

  RETURN jsonb_build_object('ok',true,'status','Bekor qilindi',
    'takroriy',false,'qaytarib_olingan_bonus',v_order.bonus_awarded,
    'qaytarilgan_sarflangan_ball',v_order.bonus_spent,
    'sabab',v_reason);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.aroma_place_order_with_bonus_v1(p_customer_id text, p_customer_name text, p_customer_username text, p_phone text, p_address text, p_items jsonb, p_coupon_code text, p_request_key text, p_spend_points bigint, p_personal_coupon_id bigint DEFAULT NULL::bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
 SET lock_timeout TO '8s'
AS $function$
DECLARE
    v_existing public.orders%ROWTYPE;
    v_result jsonb;
    v_new public.orders%ROWTYPE;
    v_account_balance bigint;
    v_quote jsonb;
    v_allowed bigint;
    v_bonus_enabled boolean;
BEGIN
    IF coalesce(p_customer_id,'') !~ '^[1-9][0-9]{0,19}$'
       OR coalesce(p_request_key,'') !~ '^[A-Za-z0-9:_-]{1,160}$'
       OR p_spend_points IS NULL OR p_spend_points < 0 OR p_spend_points > 1000000000
       OR (p_personal_coupon_id IS NOT NULL AND p_personal_coupon_id <= 0)
    THEN
      RAISE EXCEPTION 'Bonusli buyurtma parametrlari noto‘g‘ri' USING ERRCODE='P0001';
    END IF;

    -- Signed customer ID is verified by HTTP before this service-role RPC.
    -- Redemption is gated by live settings inside aroma_bonus_redeem_quote_v1.

    -- Asl v1/v2/v3 da ishlatiladigan idempotency lock bilan bir xil.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id||':'||p_request_key,0));
    SELECT * INTO v_existing FROM public.orders
      WHERE customer_id=p_customer_id AND request_key=p_request_key;

    -- Oldin mavjud buyurtmada yangi sarflashni boshlash TAQIQLANADI.
    -- Mavjud RPC qayta yuborilgan items/coupon/phone ni fingerprint bilan tekshiradi.
    IF FOUND THEN
      IF v_existing.bonus_spent <> p_spend_points
         OR v_existing.personal_coupon_id IS DISTINCT FROM p_personal_coupon_id THEN
        RAISE EXCEPTION 'Bu buyurtma kaliti boshqa ball/kupon miqdori uchun ishlatilgan' USING ERRCODE='P0001';
      END IF;
      IF p_personal_coupon_id IS NULL THEN
        v_result := public.aroma_place_order_v2(p_customer_id,p_customer_name,
          p_customer_username,p_phone,p_address,p_items,p_coupon_code,p_request_key);
      ELSE
        v_result := public.aroma_place_order_v3(p_customer_id,p_customer_name,
          p_customer_username,p_phone,p_address,p_items,p_coupon_code,p_request_key,
          p_personal_coupon_id);
      END IF;
      RETURN v_result;
    END IF;

    IF p_spend_points > 0 THEN
      -- Mijoz ballari barcha parallel xarid va admin o'zgartirishlarida satr bilan lock qilinadi.
      SELECT balance INTO v_account_balance FROM public.aroma_bonus_accounts
        WHERE customer_id=p_customer_id FOR UPDATE;
      IF v_account_balance IS NULL OR v_account_balance < p_spend_points THEN
        RAISE EXCEPTION 'Balansda yetarli ball yo‘q' USING ERRCODE='P0001';
      END IF;
    END IF;

    -- Asl order RPC summani, chegirmalarni va kuponni o'zi tekshiradi.
    IF p_personal_coupon_id IS NULL THEN
      v_result := public.aroma_place_order_v2(p_customer_id,p_customer_name,
        p_customer_username,p_phone,p_address,p_items,p_coupon_code,p_request_key);
    ELSE
      v_result := public.aroma_place_order_v3(p_customer_id,p_customer_name,
        p_customer_username,p_phone,p_address,p_items,p_coupon_code,p_request_key,
        p_personal_coupon_id);
    END IF;
    IF coalesce(v_result->>'rejected','false')='true' THEN RETURN v_result; END IF;
    IF coalesce(v_result->>'duplicate','false')='true' THEN
      RAISE EXCEPTION 'Takror buyurtma holati tekshirishni talab qiladi' USING ERRCODE='P0001';
    END IF;
    IF v_result->'order'->>'id' IS NULL THEN
      RAISE EXCEPTION 'Yangi buyurtma qaytarilmadi' USING ERRCODE='P0001';
    END IF;
    SELECT * INTO v_new FROM public.orders
      WHERE id=v_result->'order'->>'id' AND customer_id=p_customer_id FOR UPDATE;
    IF NOT FOUND OR v_new.status <> 'Yangi' OR v_new.bonus_spent <> 0
      OR v_new.request_key IS DISTINCT FROM p_request_key THEN
      RAISE EXCEPTION 'Yangi buyurtma ma’lumotlari mos kelmadi' USING ERRCODE='P0001';
    END IF;

    IF p_spend_points > 0 THEN
      -- Bu quote aynan server hisoblagan, kuponlardan keyingi order.total bo'yicha.
      SELECT public.aroma_bonus_redeem_quote_v1(p_customer_id,v_new.total)
        INTO v_quote;
      v_allowed := coalesce((v_quote->>'max_redeemable')::bigint,0);
      IF (v_quote->>'enabled') IS DISTINCT FROM 'true' OR p_spend_points > v_allowed THEN
        RAISE EXCEPTION 'Sarflanadigan ball belgilangan limitdan oshgan' USING ERRCODE='P0001';
      END IF;
      -- Aynan shu balans satri FOR UPDATE bilan oldindan qulflangan.
      UPDATE public.aroma_bonus_accounts
         SET balance=balance-p_spend_points, updated_at=now()
       WHERE customer_id=p_customer_id AND balance>=p_spend_points;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Ball balansi o‘zgardi, qayta urinib ko‘ring' USING ERRCODE='P0001';
      END IF;
      INSERT INTO public.aroma_bonus_ledger
        (customer_id,order_id,kind,amount,request_key)
      VALUES (p_customer_id,v_new.id,'redeemed',-p_spend_points,
              'order:redeemed:'||v_new.id);
      -- Snapshot trigger endi expected bonusni faqat to'lanadigan mahsulot summasidan hisoblaydi.
      UPDATE public.orders SET bonus_spent=p_spend_points
        WHERE id=v_new.id RETURNING * INTO v_new;
    END IF;

    RETURN jsonb_set(v_result,'{order}',to_jsonb(v_new));
END;
$function$
;

-- Keep current pilot account and 2,000-point ledger unchanged;
-- pilot allowlist remains as historical metadata only, never queried by logic.
UPDATE public.aroma_bonus_settings
   SET rollout_mode='global', enabled=false, updated_at=now()
 WHERE id=1 AND enabled=false;

DO $privileges$
DECLARE r record;
BEGIN
 FOR r IN SELECT p.oid::regprocedure AS signature FROM pg_proc p
 JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname IN
 ('aroma_bonus_redeem_quote_v1','aroma_bonus_snapshot_order_v1',
  'aroma_bonus_complete_order_v1','aroma_bonus_cancel_order_v1',
  'aroma_place_order_with_bonus_v1')
 LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated',r.signature);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role',r.signature);
 END LOOP;
END;
$privileges$;

DO $verify$
DECLARE q jsonb;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.aroma_bonus_settings
   WHERE id=1 AND enabled=false AND rollout_mode='global')
 THEN RAISE EXCEPTION 'STOP: global rollout marker or disabled setting missing'; END IF;
 q:=public.aroma_bonus_redeem_quote_v1('900000000000000002', 100000);
 IF (q->>'reason') IS DISTINCT FROM 'bonus_disabled'
    OR (q->>'enabled') IS DISTINCT FROM 'false'
    OR (q->>'max_redeemable')::bigint<>0
 THEN RAISE EXCEPTION 'STOP: global quote disabled-state check failed'; END IF;
END;
$verify$;
COMMIT;

-- Verify after migration: settings.enabled=false and rollout_mode='global'.
SELECT id, enabled, rollout_mode, default_percent, min_redeem_order,
 max_redeem_percent FROM public.aroma_bonus_settings WHERE id=1;
