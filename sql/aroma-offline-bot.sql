BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.promotion_bot_admins (
 telegram_id text PRIMARY KEY CHECK (telegram_id ~ '^[1-9][0-9]{0,15}$'),
 label text NOT NULL DEFAULT '', active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.promotion_bot_registrations (
 request_key text PRIMARY KEY, admin_id text NOT NULL, phone text NOT NULL,
 purchase_amount numeric NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.promotion_bot_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promotion_bot_registrations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.promotion_bot_admins, public.promotion_bot_registrations FROM PUBLIC, anon, authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.promotion_bot_admins TO service_role;
GRANT SELECT,INSERT ON public.promotion_bot_registrations TO service_role;
CREATE OR REPLACE FUNCTION public.aroma_normalize_phone(p_phone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
 SELECT CASE WHEN length(d)=9 THEN '998'||d WHEN length(d)=12 AND left(d,3)='998' THEN d ELSE NULL END
 FROM (SELECT regexp_replace(coalesce(p_phone,''),'[^0-9]','','g') d) x;
$$;
CREATE INDEX IF NOT EXISTS aroma_participants_phone_lookup ON public.promotion_participants(promotion_id,public.aroma_normalize_phone(phone));
CREATE OR REPLACE FUNCTION public.aroma_register_offline_v1(p_admin_id text,p_request_key text,p_phone text,p_amount numeric,p_name text)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog,public SET lock_timeout='8s' AS $$
DECLARE v_game public.promotion_settings%ROWTYPE; v_phone text; v_number integer; v_result jsonb; v_existing record; v_new boolean:=false;
BEGIN
 PERFORM 1 FROM public.promotion_bot_admins WHERE telegram_id=p_admin_id AND active FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Bu botdan foydalanishga ruxsatingiz yo‘q'; END IF;
 IF p_request_key IS NULL OR p_request_key !~ '^offline:[0-9]+$' THEN RAISE EXCEPTION 'So‘rov kaliti noto‘g‘ri'; END IF;
 v_phone:=public.aroma_normalize_phone(p_phone);
 IF v_phone IS NULL THEN RAISE EXCEPTION 'O‘zbekiston telefon raqamini kiriting: +998901234567'; END IF;
 IF p_amount IS NULL OR p_amount<=100000 OR p_amount>1000000000000 OR p_amount<>trunc(p_amount) THEN
  RAISE EXCEPTION 'Tashqi xarid summasi 100 000 so‘mdan ko‘p bo‘lishi kerak'; END IF;
 IF length(coalesce(p_name,''))>200 THEN RAISE EXCEPTION 'Ism juda uzun'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_key,1));
 SELECT * INTO v_existing FROM public.promotion_bot_registrations WHERE request_key=p_request_key;
 IF FOUND THEN
  IF v_existing.admin_id<>p_admin_id OR v_existing.phone<>v_phone OR v_existing.purchase_amount<>p_amount THEN RAISE EXCEPTION 'So‘rov ma’lumoti mos emas'; END IF;
  RETURN v_existing.result;
 END IF;
 -- The online order function locks this exact same row before allocating numbers.
 SELECT * INTO v_game FROM public.promotion_settings ORDER BY updated_at DESC NULLS LAST,id DESC LIMIT 1 FOR UPDATE;
 IF v_game.id IS NULL OR v_game.enabled IS NOT TRUE OR (v_game.start_at IS NOT NULL AND clock_timestamp()<v_game.start_at)
    OR (v_game.end_at IS NOT NULL AND clock_timestamp()>v_game.end_at) THEN RAISE EXCEPTION 'Hozir faol aksiya yo‘q'; END IF;
 IF p_amount<v_game.min_purchase_amount THEN RAISE EXCEPTION 'Ushbu aksiya uchun minimal xarid: % so‘m',v_game.min_purchase_amount; END IF;
 SELECT participant_number INTO v_number FROM public.promotion_participants
 WHERE promotion_id=v_game.id AND public.aroma_normalize_phone(phone)=v_phone ORDER BY participant_number LIMIT 1;
 IF NOT FOUND THEN
  IF v_game.min_number<1 OR v_game.max_number<v_game.min_number THEN RAISE EXCEPTION 'Aksiya raqamlari sozlamasi noto‘g‘ri'; END IF;
  SELECT greatest(coalesce(max(participant_number)::bigint+1,v_game.min_number),v_game.min_number) INTO v_number
   FROM public.promotion_participants WHERE promotion_id=v_game.id;
  IF v_number>v_game.max_number THEN RAISE EXCEPTION 'Aksiya raqamlari tugagan'; END IF;
  INSERT INTO public.promotion_participants(promotion_id,customer_id,participant_number,phone,customer_name,customer_username)
  VALUES(v_game.id,'offline:'||v_phone,v_number,'+'||v_phone,left(coalesce(p_name,''),200),'');
  UPDATE public.promotion_settings SET excel_revision=excel_revision+1 WHERE id=v_game.id;
  v_new:=true;
 END IF;
 v_result:=jsonb_build_object('promotion_id',v_game.id,'participant_number',v_number,'phone','+'||v_phone,'new_participant',v_new);
 INSERT INTO public.promotion_bot_registrations(request_key,admin_id,phone,purchase_amount,result)
 VALUES(p_request_key,p_admin_id,v_phone,p_amount,v_result);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.aroma_register_offline_v1(text,text,text,numeric,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_register_offline_v1(text,text,text,numeric,text) TO service_role;
CREATE OR REPLACE FUNCTION public.aroma_place_order_v1(
    p_customer_id text,
    p_customer_name text,
    p_customer_username text,
    p_phone text,
    p_address text,
    p_items jsonb,
    p_coupon_code text,
    p_request_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '8s'
AS $$
DECLARE
    v_item jsonb;
    v_line record;
    v_product public.products%ROWTYPE;
    v_category public.categories%ROWTYPE;
    v_coupon public.coupons%ROWTYPE;
    v_game public.promotion_settings%ROWTYPE;
    v_settings public.shop_settings%ROWTYPE;
    v_order public.orders%ROWTYPE;
    v_normalized jsonb := '[]'::jsonb;
    v_server_items jsonb := '[]'::jsonb;
    v_variant jsonb;
    v_variant_name text;
    v_id bigint;
    v_qty bigint;
    v_original_price numeric;
    v_final_price numeric;
    v_percent numeric;
    v_original_total numeric := 0;
    v_product_discount numeric := 0;
    v_coupon_discount numeric := 0;
    v_total numeric;
    v_free_delivery boolean := false;
    v_participant integer;
    v_next_number bigint;
    v_promotion_id bigint;
    v_new_participant boolean := false;
    v_fingerprint text;
    v_coupon_code text := nullif(upper(btrim(coalesce(p_coupon_code,''))), '');
    v_now timestamptz;
BEGIN
    IF p_customer_id IS NULL OR p_customer_id !~ '^[1-9][0-9]{0,19}$' THEN
        RAISE EXCEPTION 'Mijoz aniqlanmadi' USING ERRCODE='P0001';
    END IF;
    IF p_request_key IS NULL OR p_request_key !~ '^[A-Za-z0-9:_-]{1,160}$' THEN
        RAISE EXCEPTION 'Buyurtma kaliti noto‘g‘ri' USING ERRCODE='P0001';
    END IF;
    IF length(btrim(coalesce(p_phone,''))) NOT BETWEEN 3 AND 40
        OR length(btrim(coalesce(p_address,''))) NOT BETWEEN 3 AND 1000 THEN
        RAISE EXCEPTION 'Telefon yoki manzilni to‘g‘ri kiriting' USING ERRCODE='P0001';
    END IF;
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Buyurtma mahsulotlari noto‘g‘ri' USING ERRCODE='P0001';
    END IF;
    IF jsonb_array_length(p_items) NOT BETWEEN 1 AND 100 THEN
        RAISE EXCEPTION 'Buyurtmada 1–100 qator mahsulot bo‘lishi kerak' USING ERRCODE='P0001';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
        IF coalesce(v_item->>'id','') !~ '^[1-9][0-9]{0,17}$'
            OR coalesce(v_item->>'count','') !~ '^[1-9][0-9]{0,8}$'
            OR length(coalesce(v_item->>'variant','')) > 200 THEN
            RAISE EXCEPTION 'Mahsulot yoki miqdor noto‘g‘ri' USING ERRCODE='P0001';
        END IF;
        v_normalized := v_normalized || jsonb_build_array(jsonb_build_object(
            'id', (v_item->>'id')::bigint, 'count', (v_item->>'count')::bigint,
            'variant', btrim(coalesce(v_item->>'variant',''))));
    END LOOP;
    SELECT jsonb_agg(jsonb_build_object('id', x.id, 'variant', x.variant, 'count', x.qty) ORDER BY x.id, x.variant)
      INTO v_normalized
      FROM (SELECT (a->>'id')::bigint id, a->>'variant' variant, sum((a->>'count')::bigint) qty
            FROM jsonb_array_elements(v_normalized) a GROUP BY 1,2) x;
    v_fingerprint := md5(jsonb_build_object('items',v_normalized,'coupon',v_coupon_code,
        'phone',btrim(p_phone),'address',btrim(p_address))::text);

    -- Identical request keys serialize before checking for an already saved order.
    PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id || ':' || p_request_key, 0));
    SELECT * INTO v_order FROM public.orders
        WHERE customer_id=p_customer_id AND request_key=p_request_key;
    IF FOUND THEN
        IF v_order.request_fingerprint IS DISTINCT FROM v_fingerprint THEN
            RAISE EXCEPTION 'Bu buyurtma kaliti boshqa ma’lumot uchun ishlatilgan' USING ERRCODE='P0001';
        END IF;
        RETURN jsonb_build_object('order',to_jsonb(v_order),'duplicate',true,'new_participant',false);
    END IF;

    -- All product locks use the same order, including purchases with multiple variants.
    FOR v_line IN
        SELECT (a->>'id')::bigint id, sum((a->>'count')::bigint) qty
        FROM jsonb_array_elements(v_normalized) a GROUP BY 1 ORDER BY 1
    LOOP
        SELECT * INTO v_product FROM public.products WHERE id=v_line.id FOR UPDATE;
        IF NOT FOUND OR v_product.active IS NOT TRUE THEN
            RAISE EXCEPTION 'Mahsulot #% hozir sotuvda emas', v_line.id USING ERRCODE='P0001';
        END IF;
        IF v_product.stock < v_line.qty THEN
            RAISE EXCEPTION '%: yetarli mahsulot qolmagan', v_product.name USING ERRCODE='P0001';
        END IF;
    END LOOP;

    FOR v_item IN SELECT value FROM jsonb_array_elements(v_normalized) LOOP
        v_id := (v_item->>'id')::bigint;
        v_qty := (v_item->>'count')::bigint;
        v_variant_name := v_item->>'variant';
        SELECT * INTO STRICT v_product FROM public.products WHERE id=v_id;
        v_variant := NULL;
        IF jsonb_typeof(v_product.variants) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION '%: variant sozlamasini tekshirish kerak', v_product.name USING ERRCODE='P0001';
        END IF;
        IF jsonb_array_length(v_product.variants) > 0 THEN
            SELECT a INTO v_variant FROM jsonb_array_elements(v_product.variants) a
            WHERE (CASE WHEN jsonb_typeof(a)='string' THEN a#>>'{}' ELSE a->>'name' END)=v_variant_name LIMIT 1;
            IF v_variant_name='' OR v_variant IS NULL THEN
                RAISE EXCEPTION '%: variantni to‘g‘ri tanlang', v_product.name USING ERRCODE='P0001';
            END IF;
        ELSIF v_variant_name<>'' THEN
            RAISE EXCEPTION '%: tanlangan variant mavjud emas', v_product.name USING ERRCODE='P0001';
        END IF;
        v_original_price := v_product.price;
        IF jsonb_typeof(v_variant)='object' AND nullif(v_variant->>'price','') IS NOT NULL THEN
            IF (v_variant->>'price')::numeric > 0 THEN
                v_original_price := (v_variant->>'price')::numeric;
            END IF;
        END IF;
        IF v_original_price <= 0 OR v_original_price::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION '%: narx noto‘g‘ri', v_product.name USING ERRCODE='P0001';
        END IF;
        SELECT * INTO v_category FROM public.categories WHERE btrim(name)=btrim(v_product.category) ORDER BY id LIMIT 1;
        v_percent := CASE
            WHEN v_product.discount_active IS TRUE AND coalesce(v_product.discount_percent,0)>0 THEN v_product.discount_percent
            WHEN v_category.discount_active IS TRUE THEN coalesce(v_category.discount_percent,0)
            ELSE 0 END;
        IF v_percent < 0 OR v_percent > 100 OR v_percent::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Chegirma sozlamasi noto‘g‘ri' USING ERRCODE='P0001';
        END IF;
        v_final_price := CASE WHEN v_percent>0 THEN round(v_original_price*(1-v_percent/100)) ELSE v_original_price END;
        v_original_total := v_original_total + v_original_price*v_qty;
        v_product_discount := v_product_discount + (v_original_price-v_final_price)*v_qty;
        v_server_items := v_server_items || jsonb_build_array(jsonb_build_object(
            'id',v_id,'name',v_product.name,'variant',v_variant_name,'count',v_qty,'price',v_final_price));
    END LOOP;
    v_total := v_original_total-v_product_discount;
    IF v_coupon_code IS NOT NULL THEN
        SELECT * INTO v_coupon FROM public.coupons WHERE code=v_coupon_code FOR UPDATE;
        v_now := clock_timestamp();
        IF NOT FOUND OR v_coupon.active IS NOT TRUE THEN
            RAISE EXCEPTION 'Kupon topilmadi yoki faol emas' USING ERRCODE='P0001';
        END IF;
        IF (v_coupon.start_at IS NOT NULL AND v_now<v_coupon.start_at)
           OR (v_coupon.end_at IS NOT NULL AND v_now>v_coupon.end_at) THEN
            RAISE EXCEPTION 'Kupon hozir amal qilmaydi' USING ERRCODE='P0001';
        END IF;
        IF v_coupon.usage_limit IS NOT NULL AND v_coupon.used_count>=v_coupon.usage_limit THEN
            RAISE EXCEPTION 'Kupondan foydalanish limiti tugagan' USING ERRCODE='P0001';
        END IF;
        IF v_total<v_coupon.min_order_amount THEN
            RAISE EXCEPTION 'Kupon uchun buyurtma summasi yetarli emas' USING ERRCODE='P0001';
        END IF;
        IF v_coupon.discount_percent NOT BETWEEN 0 AND 100 OR v_coupon.discount_percent::text IN ('NaN','Infinity','-Infinity') THEN
            RAISE EXCEPTION 'Kupon chegirmasi noto‘g‘ri' USING ERRCODE='P0001';
        END IF;
        v_coupon_discount := round(v_total*v_coupon.discount_percent/100);
        v_total := v_total-v_coupon_discount;
    END IF;
    SELECT * INTO v_settings FROM public.shop_settings ORDER BY id LIMIT 1;
    v_free_delivery := coalesce(v_settings.free_delivery_enabled AND v_total>=v_settings.free_delivery_min_amount, false);

    -- Lock the selected game before finding/allocating a participant number.
    SELECT * INTO v_game FROM public.promotion_settings
        ORDER BY updated_at DESC NULLS LAST, id DESC LIMIT 1 FOR UPDATE;
    v_now := clock_timestamp();
    IF v_game.enabled IS TRUE
       AND (v_game.start_at IS NULL OR v_now>=v_game.start_at)
       AND (v_game.end_at IS NULL OR v_now<=v_game.end_at) THEN
        v_promotion_id := v_game.id;
        SELECT participant_number INTO v_participant FROM public.promotion_participants
            WHERE promotion_id=v_game.id AND (customer_id=p_customer_id OR
                public.aroma_normalize_phone(phone)=public.aroma_normalize_phone(p_phone))
            ORDER BY (customer_id=p_customer_id) DESC, participant_number LIMIT 1;
        IF NOT FOUND AND v_total >= v_game.min_purchase_amount THEN
            IF v_game.min_number < 1 OR v_game.max_number < v_game.min_number THEN
                RAISE EXCEPTION 'Aksiya raqamlari sozlamasi noto‘g‘ri' USING ERRCODE='P0001';
            END IF;
            SELECT greatest(coalesce(max(participant_number)::bigint+1,v_game.min_number),v_game.min_number)
                INTO v_next_number FROM public.promotion_participants WHERE promotion_id=v_game.id;
            IF v_next_number>v_game.max_number THEN
                RAISE EXCEPTION 'Aksiya ishtirok raqamlari tugagan' USING ERRCODE='P0001';
            END IF;
            INSERT INTO public.promotion_participants(promotion_id,customer_id,participant_number,phone,customer_name,customer_username)
            VALUES(v_game.id,p_customer_id,v_next_number,btrim(p_phone),left(coalesce(p_customer_name,''),200),left(coalesce(p_customer_username,''),100))
            RETURNING participant_number INTO v_participant;
            v_new_participant := true;
            UPDATE public.promotion_settings SET excel_revision=excel_revision+1 WHERE id=v_game.id;
        END IF;
    END IF;

    FOR v_line IN
        SELECT (a->>'id')::bigint id, sum((a->>'count')::bigint) qty
        FROM jsonb_array_elements(v_normalized) a GROUP BY 1 ORDER BY 1
    LOOP
        UPDATE public.products SET stock=stock-v_line.qty::integer WHERE id=v_line.id;
    END LOOP;
    IF v_coupon_code IS NOT NULL THEN
        UPDATE public.coupons SET used_count=used_count+1 WHERE id=v_coupon.id;
    END IF;
    INSERT INTO public.orders(id,order_date,customer_id,customer_name,customer_username,
        items,total,free_delivery,participant_number,phone,address,status,request_key,request_fingerprint,
        promotion_id,coupon_code,original_total,product_discount_amount,coupon_discount_amount)
    VALUES('AR-'||nextval('public.aroma_order_number_seq')::text,
        to_char(clock_timestamp() AT TIME ZONE 'Asia/Tashkent','YYYY-MM-DD HH24:MI:SS'),
        p_customer_id,left(coalesce(p_customer_name,''),200),left(coalesce(p_customer_username,''),100),
        v_server_items,v_total,v_free_delivery,v_participant,btrim(p_phone),btrim(p_address),'Yangi',
        p_request_key,v_fingerprint,v_promotion_id,v_coupon_code,v_original_total,v_product_discount,v_coupon_discount)
    RETURNING * INTO v_order;
    RETURN jsonb_build_object('order',to_jsonb(v_order),'duplicate',false,'new_participant',v_new_participant);
END $$;

-- Only the trusted server (service_role) can call this write operation.
REVOKE ALL ON FUNCTION public.aroma_place_order_v1(text,text,text,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_place_order_v1(text,text,text,text,text,jsonb,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';

COMMIT;
SELECT 'Aroma: alohida aksiya boti bazasi tayyor' AS result;
