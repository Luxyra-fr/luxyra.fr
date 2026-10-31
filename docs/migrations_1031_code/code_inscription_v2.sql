-- Luxyra — 31/10/2026 — Code d'inscription client v2 (contre-audit : M1, M2, B1, B3).
-- Hors périmètre fiscal. Idempotent (rejouable). S'applique APRÈS code_inscription.sql.
--   M1 : plafond GLOBAL d'envois de codes par heure (app_config.signup_codes_max_heure, défaut 200) + alerte
--        server_errors une fois par heure (sans donnée nominative). La limite par IP reçoit une empreinte calculée
--        par l'edge sur le bloc /64 en IPv6 (lx-signup v15).
--   M2 : compteur d'échecs GLISSANT 24 h par adresse, indépendant du code (15 échecs -> plus aucun code ni essai 24 h).
--   B1 : un nouveau code n'invalide pas le précédent encore valable (les deux sont acceptés jusqu'à leur expiration ;
--        les 5 essais restent partagés).
--   B3 : ménage planifié (pg_cron, toutes les heures) : adresses et empreintes effacées au plus tard 2 jours après.

BEGIN;

ALTER TABLE public.clients_signup_codes ADD COLUMN IF NOT EXISTS code_hash_prec text;
ALTER TABLE public.clients_signup_codes ADD COLUMN IF NOT EXISTS expires_prec timestamptz;
ALTER TABLE public.clients_signup_codes ADD COLUMN IF NOT EXISTS echecs integer NOT NULL DEFAULT 0;
ALTER TABLE public.clients_signup_codes ADD COLUMN IF NOT EXISTS echecs_debut timestamptz;
ALTER TABLE public.clients_signup_codes ADD COLUMN IF NOT EXISTS bloque_jusqu timestamptz;

CREATE TABLE IF NOT EXISTS public.clients_signup_global (
  id        integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  envois    integer NOT NULL DEFAULT 0,
  fenetre   timestamptz NOT NULL DEFAULT now(),
  alerte_le timestamptz
);
INSERT INTO public.clients_signup_global(id) VALUES (1) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.clients_signup_global ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clients_signup_global FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.clients_signup_global TO service_role;

CREATE OR REPLACE FUNCTION public.lx_signup_code_demander(p_email text, p_code_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.clients_signup_codes; i public.clients_signup_ip; g public.clients_signup_global;
        v_email text := lower(trim(p_email)); v_max int; v_prec_ok boolean;
BEGIN
  IF v_email IS NULL OR v_email = '' OR p_code_hash IS NULL OR length(p_code_hash) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'invalide');
  END IF;
  -- M1 : plafond global (verrou sur la ligne unique)
  SELECT coalesce(nullif((SELECT config->>'signup_codes_max_heure' FROM public.app_config WHERE id = 1), '')::int, 200) INTO v_max;
  SELECT * INTO g FROM public.clients_signup_global WHERE id = 1 FOR UPDATE;
  IF g.fenetre < now() - interval '1 hour' THEN g.envois := 0; g.fenetre := now(); END IF;
  IF g.envois >= v_max THEN
    IF g.alerte_le IS NULL OR g.alerte_le < now() - interval '1 hour' THEN
      UPDATE public.clients_signup_global SET alerte_le = now(), envois = g.envois, fenetre = g.fenetre WHERE id = 1;
      BEGIN
        PERFORM public.report_server_error('signup_code_plafond',
          'Codes d''inscription client : plafond global atteint (' || v_max || ' envois en 1 h). Envois suspendus jusqu''à la fin de l''heure : possible abus.',
          'error', NULL, jsonb_build_object('plafond', v_max), NULL, NULL, NULL, NULL, NULL);
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END IF;
    RETURN jsonb_build_object('ok', false, 'raison', 'plafond');
  END IF;
  -- limite par IP (10 / heure ; empreinte du bloc /64 en IPv6)
  IF coalesce(p_ip_hash, '') <> '' THEN
    INSERT INTO public.clients_signup_ip(ip_hash) VALUES (p_ip_hash) ON CONFLICT (ip_hash) DO NOTHING;
    SELECT * INTO i FROM public.clients_signup_ip WHERE ip_hash = p_ip_hash FOR UPDATE;
    IF i.fenetre < now() - interval '1 hour' THEN i.envois := 0; i.fenetre := now(); END IF;
    IF i.envois >= 10 THEN RETURN jsonb_build_object('ok', false, 'raison', 'trop_ip'); END IF;
  END IF;
  INSERT INTO public.clients_signup_codes(email) VALUES (v_email) ON CONFLICT (email) DO NOTHING;
  SELECT * INTO r FROM public.clients_signup_codes WHERE email = v_email FOR UPDATE;
  -- M2 : adresse bloquée 24 h après 15 échecs
  IF r.bloque_jusqu IS NOT NULL AND r.bloque_jusqu > now() THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'bloque_24h');
  END IF;
  IF r.dernier_envoi IS NOT NULL AND r.dernier_envoi > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'attendre', 'attente_s', ceil(extract(epoch FROM (r.dernier_envoi + interval '60 seconds' - now())))::int);
  END IF;
  IF r.fenetre < now() - interval '1 hour' THEN r.envois := 0; r.fenetre := now(); END IF;
  IF r.envois >= 3 THEN RETURN jsonb_build_object('ok', false, 'raison', 'trop_envois'); END IF;
  -- B1 : le code en cours (encore valable, non utilisé, non bloqué) reste accepté jusqu'à son expiration
  v_prec_ok := r.code_hash IS NOT NULL AND r.utilise_le IS NULL AND r.expires_at > now() AND r.essais < 5;
  UPDATE public.clients_signup_codes
     SET code_hash_prec = CASE WHEN v_prec_ok THEN r.code_hash ELSE NULL END,
         expires_prec   = CASE WHEN v_prec_ok THEN r.expires_at ELSE NULL END,
         code_hash = p_code_hash, expires_at = now() + interval '15 minutes',
         essais = CASE WHEN v_prec_ok THEN r.essais ELSE 0 END,   -- essais partagés tant qu'un code précédent vit
         utilise_le = NULL, envois = r.envois + 1, fenetre = r.fenetre, dernier_envoi = now()
   WHERE email = v_email;
  IF coalesce(p_ip_hash, '') <> '' THEN
    UPDATE public.clients_signup_ip SET envois = i.envois + 1, fenetre = i.fenetre WHERE ip_hash = p_ip_hash;
  END IF;
  UPDATE public.clients_signup_global SET envois = g.envois + 1, fenetre = g.fenetre WHERE id = 1;
  RETURN jsonb_build_object('ok', true);
END $$;

CREATE OR REPLACE FUNCTION public.lx_signup_code_verifier(p_email text, p_code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.clients_signup_codes; v_email text := lower(trim(p_email)); v_bon boolean; v_echecs int; v_debut timestamptz;
BEGIN
  SELECT * INTO r FROM public.clients_signup_codes WHERE email = v_email FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'raison', 'absent'); END IF;
  IF r.bloque_jusqu IS NOT NULL AND r.bloque_jusqu > now() THEN RETURN jsonb_build_object('ok', false, 'raison', 'bloque_24h'); END IF;
  IF r.utilise_le IS NOT NULL OR (r.code_hash IS NULL AND r.code_hash_prec IS NULL) THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'absent');
  END IF;
  IF coalesce(r.expires_at, '-infinity') < now() AND coalesce(r.expires_prec, '-infinity') < now() THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'expire');
  END IF;
  IF r.essais >= 5 THEN RETURN jsonb_build_object('ok', false, 'raison', 'bloque'); END IF;
  v_bon := (r.code_hash IS NOT NULL AND r.expires_at >= now() AND r.code_hash = p_code_hash)
        OR (r.code_hash_prec IS NOT NULL AND r.expires_prec >= now() AND r.code_hash_prec = p_code_hash);
  IF NOT v_bon THEN
    -- M2 : échecs glissants 24 h
    v_debut := CASE WHEN r.echecs_debut IS NULL OR r.echecs_debut < now() - interval '24 hours' THEN now() ELSE r.echecs_debut END;
    v_echecs := CASE WHEN r.echecs_debut IS NULL OR r.echecs_debut < now() - interval '24 hours' THEN 1 ELSE r.echecs + 1 END;
    IF v_echecs >= 15 THEN
      UPDATE public.clients_signup_codes SET essais = r.essais + 1, echecs = v_echecs, echecs_debut = v_debut,
             bloque_jusqu = now() + interval '24 hours', code_hash = NULL, code_hash_prec = NULL, expires_prec = NULL
       WHERE email = v_email;
      RETURN jsonb_build_object('ok', false, 'raison', 'bloque_24h');
    END IF;
    UPDATE public.clients_signup_codes SET essais = r.essais + 1, echecs = v_echecs, echecs_debut = v_debut,
           code_hash      = CASE WHEN r.essais + 1 >= 5 THEN NULL ELSE code_hash END,
           code_hash_prec = CASE WHEN r.essais + 1 >= 5 THEN NULL ELSE code_hash_prec END
     WHERE email = v_email;
    RETURN jsonb_build_object('ok', false, 'raison', CASE WHEN r.essais + 1 >= 5 THEN 'bloque' ELSE 'faux' END, 'reste', greatest(0, 4 - r.essais));
  END IF;
  UPDATE public.clients_signup_codes SET utilise_le = now(), code_hash = NULL, code_hash_prec = NULL, expires_prec = NULL WHERE email = v_email;
  RETURN jsonb_build_object('ok', true);
END $$;

-- B3 : ménage (adresses et empreintes) au plus tard 2 jours après ; une adresse bloquée reste jusqu'à la fin du blocage
CREATE OR REPLACE FUNCTION public.lx_signup_code_menage()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.clients_signup_codes
   WHERE coalesce(dernier_envoi, cree_le) < now() - interval '2 days'
     AND coalesce(echecs_debut, cree_le) < now() - interval '2 days'
     AND (bloque_jusqu IS NULL OR bloque_jusqu < now());
  DELETE FROM public.clients_signup_ip WHERE fenetre < now() - interval '2 days';
$$;

REVOKE ALL ON FUNCTION public.lx_signup_code_demander(text,text,text), public.lx_signup_code_verifier(text,text), public.lx_signup_code_menage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_signup_code_demander(text,text,text), public.lx_signup_code_verifier(text,text), public.lx_signup_code_menage() TO service_role;

COMMIT;

-- B3 : tâche planifiée (hors transaction ; rejouable)
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'lx_signup_code_menage';
SELECT cron.schedule('lx_signup_code_menage', '17 * * * *', $$select public.lx_signup_code_menage()$$);

-- RETOUR ARRIÈRE : rejouer code_inscription.sql (fonctions v1) puis
--   select cron.unschedule('lx_signup_code_menage'); drop table public.clients_signup_global;
--   (les colonnes ajoutées sont sans effet sur les fonctions v1).

-- B4 (appliqué le 31/10 après déploiement : la clé du worker diffère de celle injectée dans les edges) :
-- preuve qu'un jeton est la clé service, exécutable par service_role uniquement (lx-signup v15 estInterne).
create or replace function public.lx_est_role_service() returns boolean language sql stable security invoker set search_path = pg_catalog as $$
  select coalesce(current_setting('request.jwt.claims', true)::jsonb->>'role', '') = 'service_role'
$$;
revoke all on function public.lx_est_role_service() from public, anon, authenticated;
grant execute on function public.lx_est_role_service() to service_role;
