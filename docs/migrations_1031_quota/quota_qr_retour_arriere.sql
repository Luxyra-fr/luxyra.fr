-- Retour arrière de quota_qr.sql (31/10/2026)
SELECT cron.unschedule('lx_qr_jetons_menage');
BEGIN;
ALTER TABLE lx_prive.qr_jetons DROP CONSTRAINT IF EXISTS qr_jetons_salon_fk;
DROP FUNCTION IF EXISTS public.lx_qr_jetons_menage();
DROP FUNCTION IF EXISTS public.lx_envoi_quota_rendre(uuid, text);
CREATE OR REPLACE FUNCTION public.lx_qr_resoudre(p_jeton text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'lx_prive' AS $$
  SELECT code FROM lx_prive.qr_jetons WHERE p_jeton ~ '^[A-Za-z0-9_-]{24}$' AND jeton = p_jeton
$$;
REVOKE ALL ON FUNCTION public.lx_qr_resoudre(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_qr_resoudre(text) TO service_role;
COMMIT;
