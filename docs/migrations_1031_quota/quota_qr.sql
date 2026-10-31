-- Luxyra — 31/10/2026 — contre-audit bons v3 : R2a/R3a (rendre une unité de quota quand l'envoi échoue) et R4a (QR par jeton :
-- seulement pour un bon actif non expiré, purge des jetons, suppression avec l'établissement). Hors périmètre fiscal :
-- aucune table NF525, aucun bon, ticket, montant ni code n'est modifié (lecture seule de cartes_cadeaux).
-- Idempotent. Retour arrière : quota_qr_retour_arriere.sql.
BEGIN;

-- R2a / R3a : rend une unité (jamais en dessous de 0) — appelé par le worker quand Brevo refuse l'envoi
CREATE OR REPLACE FUNCTION public.lx_envoi_quota_rendre(p_salon uuid, p_type text)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path TO 'pg_catalog', 'lx_prive' AS $$
  UPDATE lx_prive.envois_quota SET n = n - 1
   WHERE salon_id = p_salon AND type = p_type AND jour = (now() AT TIME ZONE 'Europe/Paris')::date AND n > 0;
$$;
REVOKE ALL ON FUNCTION public.lx_envoi_quota_rendre(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_envoi_quota_rendre(uuid, text) TO service_role;

-- R4a : le QR n'est servi que pour un bon EXISTANT, actif, avec un solde, non expiré (sinon NULL -> 404 côté worker)
CREATE OR REPLACE FUNCTION public.lx_qr_resoudre(p_jeton text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'pg_catalog', 'lx_prive', 'public' AS $$
  SELECT j.code FROM lx_prive.qr_jetons j
   WHERE p_jeton ~ '^[A-Za-z0-9_-]{24}$' AND j.jeton = p_jeton
     AND EXISTS (SELECT 1 FROM public.cartes_cadeaux c
                  WHERE c.salon_id = j.salon_id AND c.code = j.code AND c.status = 'active'
                    AND coalesce(c.restant, 0) > 0.004
                    AND (c.date_expiration IS NULL OR c.date_expiration >= (now() AT TIME ZONE 'Europe/Paris')::date))
$$;
REVOKE ALL ON FUNCTION public.lx_qr_resoudre(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_qr_resoudre(text) TO service_role;

-- R4a : purge — on garde un jeton tant que son bon existe, est actif avec un solde, et n'est pas expiré depuis plus de
-- 30 jours (délai de grâce d'1 jour après création, pour les créations concurrentes)
CREATE OR REPLACE FUNCTION public.lx_qr_jetons_menage()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'pg_catalog', 'lx_prive', 'public' AS $$
DECLARE v_n integer;
BEGIN
  DELETE FROM lx_prive.qr_jetons j
   WHERE j.created_at < now() - interval '1 day'
     AND NOT EXISTS (SELECT 1 FROM public.cartes_cadeaux c
                      WHERE c.salon_id = j.salon_id AND c.code = j.code AND c.status = 'active'
                        AND coalesce(c.restant, 0) > 0.004
                        AND (c.date_expiration IS NULL OR c.date_expiration >= (now() AT TIME ZONE 'Europe/Paris')::date - 30));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.lx_qr_jetons_menage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_qr_jetons_menage() TO service_role;

-- R4a : suppression de l'établissement (purge à 6 ans) -> ses jetons partent avec lui. La fermeture et la
-- réinitialisation d'essai suppriment / désactivent les bons : la purge quotidienne retire alors les jetons.
DELETE FROM lx_prive.qr_jetons j WHERE j.salon_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.salons s WHERE s.id = j.salon_id);
DO $$ BEGIN
  ALTER TABLE lx_prive.qr_jetons ADD CONSTRAINT qr_jetons_salon_fk FOREIGN KEY (salon_id) REFERENCES public.salons(id) ON DELETE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMIT;

-- tâche planifiée quotidienne (hors transaction : cron.schedule est idempotent par nom)
SELECT cron.schedule('lx_qr_jetons_menage', '37 4 * * *', 'select public.lx_qr_jetons_menage()');
