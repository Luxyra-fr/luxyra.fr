-- Luxyra — 31/10/2026 — Inscription client : code à 6 chiffres envoyé par e-mail AVANT la création du compte.
-- Hors périmètre fiscal (aucune table NF525). Idempotent. Retour arrière en fin de fichier.
-- Le code n'est jamais stocké en clair : empreinte HMAC calculée par l'edge lx-signup (secret serveur + adresse + code).
-- Toute la logique de limitation est atomique en base (verrou de ligne) : 3 envois / heure / adresse, 60 s entre deux envois,
-- 10 envois / heure / adresse IP (empreinte), 5 essais par code, validité 15 min, usage unique.

BEGIN;

CREATE TABLE IF NOT EXISTS public.clients_signup_codes (
  email        text PRIMARY KEY,
  code_hash    text,
  expires_at   timestamptz,
  essais       integer NOT NULL DEFAULT 0,
  utilise_le   timestamptz,
  envois       integer NOT NULL DEFAULT 0,      -- envois dans la fenêtre courante
  fenetre      timestamptz NOT NULL DEFAULT now(),
  dernier_envoi timestamptz,
  cree_le      timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.clients_signup_ip (
  ip_hash  text PRIMARY KEY,
  envois   integer NOT NULL DEFAULT 0,
  fenetre  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.clients_signup_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients_signup_ip ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.clients_signup_codes, public.clients_signup_ip FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clients_signup_codes, public.clients_signup_ip TO service_role;
COMMENT ON TABLE public.clients_signup_codes IS 'Inscription client : code à 6 chiffres (empreinte HMAC), 15 min, 5 essais, 3 envois/h. Écrit uniquement via lx_signup_code_* (service_role).';

-- Demande d'un code : renvoie {ok:true} ou {ok:false, raison:'attendre'|'trop_envois'|'trop_ip', attente_s}
CREATE OR REPLACE FUNCTION public.lx_signup_code_demander(p_email text, p_code_hash text, p_ip_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.clients_signup_codes; i public.clients_signup_ip; v_email text := lower(trim(p_email));
BEGIN
  IF v_email IS NULL OR v_email = '' OR p_code_hash IS NULL OR length(p_code_hash) < 32 THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'invalide');
  END IF;
  -- limite par IP (10 / heure)
  IF coalesce(p_ip_hash, '') <> '' THEN
    INSERT INTO public.clients_signup_ip(ip_hash) VALUES (p_ip_hash) ON CONFLICT (ip_hash) DO NOTHING;
    SELECT * INTO i FROM public.clients_signup_ip WHERE ip_hash = p_ip_hash FOR UPDATE;
    IF i.fenetre < now() - interval '1 hour' THEN i.envois := 0; i.fenetre := now(); END IF;
    IF i.envois >= 10 THEN
      RETURN jsonb_build_object('ok', false, 'raison', 'trop_ip');
    END IF;
  END IF;
  INSERT INTO public.clients_signup_codes(email) VALUES (v_email) ON CONFLICT (email) DO NOTHING;
  SELECT * INTO r FROM public.clients_signup_codes WHERE email = v_email FOR UPDATE;
  IF r.dernier_envoi IS NOT NULL AND r.dernier_envoi > now() - interval '60 seconds' THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'attendre', 'attente_s', ceil(extract(epoch FROM (r.dernier_envoi + interval '60 seconds' - now())))::int);
  END IF;
  IF r.fenetre < now() - interval '1 hour' THEN r.envois := 0; r.fenetre := now(); END IF;
  IF r.envois >= 3 THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'trop_envois');
  END IF;
  UPDATE public.clients_signup_codes
     SET code_hash = p_code_hash, expires_at = now() + interval '15 minutes', essais = 0, utilise_le = NULL,
         envois = r.envois + 1, fenetre = r.fenetre, dernier_envoi = now()
   WHERE email = v_email;
  IF coalesce(p_ip_hash, '') <> '' THEN
    UPDATE public.clients_signup_ip SET envois = i.envois + 1, fenetre = i.fenetre WHERE ip_hash = p_ip_hash;
  END IF;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Vérification (consomme le code si bon) : {ok:true} ou {ok:false, raison:'absent'|'expire'|'bloque'|'faux', reste}
CREATE OR REPLACE FUNCTION public.lx_signup_code_verifier(p_email text, p_code_hash text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r public.clients_signup_codes; v_email text := lower(trim(p_email));
BEGIN
  SELECT * INTO r FROM public.clients_signup_codes WHERE email = v_email FOR UPDATE;
  IF NOT FOUND OR r.code_hash IS NULL OR r.utilise_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'absent');
  END IF;
  IF r.expires_at < now() THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'expire');
  END IF;
  IF r.essais >= 5 THEN
    RETURN jsonb_build_object('ok', false, 'raison', 'bloque');
  END IF;
  IF r.code_hash IS DISTINCT FROM p_code_hash THEN
    UPDATE public.clients_signup_codes SET essais = r.essais + 1,
           code_hash = CASE WHEN r.essais + 1 >= 5 THEN NULL ELSE code_hash END
     WHERE email = v_email;
    RETURN jsonb_build_object('ok', false, 'raison', CASE WHEN r.essais + 1 >= 5 THEN 'bloque' ELSE 'faux' END, 'reste', greatest(0, 4 - r.essais));
  END IF;
  UPDATE public.clients_signup_codes SET utilise_le = now(), code_hash = NULL WHERE email = v_email;
  RETURN jsonb_build_object('ok', true);
END $$;

-- Ménage : lignes de plus de 2 jours (appelé par l'edge à chaque demande, coût négligeable)
CREATE OR REPLACE FUNCTION public.lx_signup_code_menage()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  DELETE FROM public.clients_signup_codes WHERE cree_le < now() - interval '2 days' AND coalesce(dernier_envoi, cree_le) < now() - interval '2 days';
  DELETE FROM public.clients_signup_ip WHERE fenetre < now() - interval '2 days';
$$;

REVOKE ALL ON FUNCTION public.lx_signup_code_demander(text,text,text), public.lx_signup_code_verifier(text,text), public.lx_signup_code_menage() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_signup_code_demander(text,text,text), public.lx_signup_code_verifier(text,text), public.lx_signup_code_menage() TO service_role;

COMMIT;

-- Contrôles (lecture) :
--   select has_table_privilege('anon','public.clients_signup_codes','SELECT');  -- false
--   select has_function_privilege('anon','public.lx_signup_code_verifier(text,text)','EXECUTE'); -- false
-- RETOUR ARRIÈRE (après avoir redéployé lx-signup v13 : docs/edge_1031_code/avant/lx-signup) :
-- BEGIN; DROP FUNCTION IF EXISTS public.lx_signup_code_demander(text,text,text), public.lx_signup_code_verifier(text,text), public.lx_signup_code_menage();
--        DROP TABLE IF EXISTS public.clients_signup_codes, public.clients_signup_ip; COMMIT;
