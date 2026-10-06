-- Run before deploying the cart confirmation update. Keeps existing order IDs.
BEGIN;
SET LOCAL lock_timeout = '5s';
CREATE TABLE IF NOT EXISTS public.order_receipt_failures (
    request_key text PRIMARY KEY,
    customer_id text NOT NULL,
    reason text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.order_receipt_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.order_receipt_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.order_receipt_failures TO service_role;
CREATE OR REPLACE FUNCTION public.aroma_place_order_v2(
    p_customer_id text, p_customer_name text, p_customer_username text,
    p_phone text, p_address text, p_items jsonb, p_coupon_code text, p_request_key text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '8s'
AS $$
DECLARE
    v_reason text;
    v_result jsonb;
BEGIN
    IF p_customer_id IS NULL OR p_customer_id !~ '^[0-9]+$'
       OR p_request_key IS NULL OR length(p_request_key) NOT BETWEEN 1 AND 160 THEN
        RAISE EXCEPTION 'Buyurtma kaliti noto‘g‘ri';
    END IF;
    PERFORM pg_advisory_xact_lock(hashtextextended(p_customer_id || ':' || p_request_key, 0));
    SELECT reason INTO v_reason FROM public.order_receipt_failures
        WHERE request_key=p_request_key AND customer_id=p_customer_id;
    IF FOUND THEN
        RETURN jsonb_build_object('rejected',true,'message',v_reason);
    END IF;
    BEGIN
        v_result := public.aroma_place_order_v1(p_customer_id,p_customer_name,p_customer_username,
            p_phone,p_address,p_items,p_coupon_code,p_request_key);
        RETURN v_result;
    EXCEPTION WHEN SQLSTATE 'P0001' THEN
        -- The inner block rolls back all order effects before recording rejection.
        GET STACKED DIAGNOSTICS v_reason = MESSAGE_TEXT;
        -- Never turn an already accepted request into a failed receipt.
        IF NOT EXISTS (SELECT 1 FROM public.orders WHERE customer_id=p_customer_id AND request_key=p_request_key) THEN
            INSERT INTO public.order_receipt_failures(request_key,customer_id,reason)
                VALUES(p_request_key,p_customer_id,left(v_reason,500)) ON CONFLICT DO NOTHING;
        END IF;
        RETURN jsonb_build_object('rejected',true,'message',v_reason);
    END;
END $$;
REVOKE ALL ON FUNCTION public.aroma_place_order_v2(text,text,text,text,text,jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_place_order_v2(text,text,text,text,text,jsonb,text,text) TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Aroma: savat tasdig‘i tayyor' AS result;
