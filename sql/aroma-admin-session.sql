BEGIN;
CREATE TABLE IF NOT EXISTS public.aroma_admin_login_limit (
    id integer PRIMARY KEY CHECK (id = 1),
    window_start timestamptz NOT NULL,
    attempts integer NOT NULL CHECK (attempts >= 0)
);
ALTER TABLE public.aroma_admin_login_limit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.aroma_admin_login_limit FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.aroma_admin_login_limit TO service_role;
CREATE OR REPLACE FUNCTION public.aroma_admin_login_attempt_v1()
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER
SET search_path = pg_catalog, public
SET lock_timeout = '3s'
AS $$
DECLARE
    v_row public.aroma_admin_login_limit%ROWTYPE;
    v_now timestamptz;
BEGIN
    INSERT INTO public.aroma_admin_login_limit VALUES (1, clock_timestamp(), 0)
        ON CONFLICT (id) DO NOTHING;
    SELECT * INTO v_row FROM public.aroma_admin_login_limit WHERE id=1 FOR UPDATE;
    v_now := clock_timestamp();
    IF v_now >= v_row.window_start + interval '5 minutes' THEN
        UPDATE public.aroma_admin_login_limit SET window_start=v_now, attempts=1 WHERE id=1;
        RETURN jsonb_build_object('allowed',true,'retry_after',0);
    END IF;
    IF v_row.attempts >= 10 THEN
        RETURN jsonb_build_object('allowed',false,'retry_after',
            greatest(1,ceil(extract(epoch FROM v_row.window_start + interval '5 minutes' - v_now))::integer));
    END IF;
    UPDATE public.aroma_admin_login_limit SET attempts=attempts+1 WHERE id=1;
    RETURN jsonb_build_object('allowed',true,'retry_after',0);
END $$;
REVOKE ALL ON FUNCTION public.aroma_admin_login_attempt_v1() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.aroma_admin_login_attempt_v1() TO service_role;
NOTIFY pgrst, 'reload schema';
COMMIT;
SELECT 'Aroma: admin kirish himoyasi bazasi tayyor' AS result;
