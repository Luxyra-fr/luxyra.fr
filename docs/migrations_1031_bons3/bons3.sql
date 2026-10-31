-- Luxyra — 31/10/2026 — Bons cadeaux v3 (contre-audit bons v2) : quotas d'envoi persistants, jetons de QR opaques,
-- config publique en LISTE BLANCHE. Hors périmètre fiscal (aucune table/fonction NF525 touchée). Rejouable.
BEGIN;

-- 1. Quotas d'envoi persistants par établissement et par jour (R1) ------------------------------------------------
CREATE TABLE IF NOT EXISTS lx_prive.envois_quota (
  salon_id uuid NOT NULL,
  jour     date NOT NULL DEFAULT ((now() AT TIME ZONE 'Europe/Paris')::date),
  type     text NOT NULL,
  n        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (salon_id, jour, type)
);
REVOKE ALL ON lx_prive.envois_quota FROM PUBLIC, anon, authenticated;

-- Incrémente atomiquement le compteur du jour ; false si le plafond est atteint (rien n'est compté alors).
CREATE OR REPLACE FUNCTION public.lx_envoi_quota(p_salon uuid, p_type text, p_max integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, lx_prive AS $f$
DECLARE v_n integer; v_j date := (now() AT TIME ZONE 'Europe/Paris')::date;
BEGIN
  IF p_salon IS NULL OR p_type IS NULL OR p_type !~ '^[a-z_]{1,30}$' OR coalesce(p_max,0) <= 0 THEN RETURN false; END IF;
  INSERT INTO lx_prive.envois_quota AS q (salon_id, jour, type, n) VALUES (p_salon, v_j, p_type, 1)
  ON CONFLICT (salon_id, jour, type) DO UPDATE SET n = q.n + 1 WHERE q.n < p_max
  RETURNING n INTO v_n;
  DELETE FROM lx_prive.envois_quota WHERE jour < v_j - 7;  -- ménage léger (7 jours d'historique)
  RETURN v_n IS NOT NULL;
END $f$;
REVOKE ALL ON FUNCTION public.lx_envoi_quota(uuid, text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_envoi_quota(uuid, text, integer) TO service_role;

-- 2. Jetons opaques pour le QR des e-cartes (R3) : le code du bon ne passe plus dans l'URL de l'image ---------------
CREATE TABLE IF NOT EXISTS lx_prive.qr_jetons (
  jeton      text PRIMARY KEY,
  code       text NOT NULL,
  salon_id   uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (salon_id, code)
);
REVOKE ALL ON lx_prive.qr_jetons FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lx_qr_jeton(p_code text, p_salon uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, lx_prive, extensions AS $f$
DECLARE v text;
BEGIN
  IF p_code IS NULL OR p_code !~ '^[A-Za-z0-9._-]{1,64}$' THEN RETURN NULL; END IF;
  SELECT jeton INTO v FROM lx_prive.qr_jetons WHERE code = p_code AND salon_id IS NOT DISTINCT FROM p_salon;
  IF v IS NOT NULL THEN RETURN v; END IF;
  v := translate(encode(extensions.gen_random_bytes(18), 'base64'), '+/', '-_');
  INSERT INTO lx_prive.qr_jetons (jeton, code, salon_id) VALUES (v, p_code, p_salon)
  ON CONFLICT (salon_id, code) DO NOTHING;
  SELECT jeton INTO v FROM lx_prive.qr_jetons WHERE code = p_code AND salon_id IS NOT DISTINCT FROM p_salon;
  RETURN v;
END $f$;
REVOKE ALL ON FUNCTION public.lx_qr_jeton(text, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_qr_jeton(text, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.lx_qr_resoudre(p_jeton text)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, lx_prive AS $f$
  SELECT code FROM lx_prive.qr_jetons WHERE p_jeton ~ '^[A-Za-z0-9_-]{24}$' AND jeton = p_jeton
$f$;
REVOKE ALL ON FUNCTION public.lx_qr_resoudre(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lx_qr_resoudre(text) TO service_role;

-- 3. Config publique : LISTE BLANCHE (avant : liste de refus) -------------------------------------------------------
-- Clés réellement lues par les pages publiques (inventaire du 31/10/2026) :
--   site.html : absences, horaires, domicile, modeActivite, facebookUrl, instagramUrl, tiktokUrl, cartes_abo,
--               cartes_abo_config, forfaits, cats_svc, cats_forf, fidconf ; recherche.html : domicile ;
--   compte.html : fidconf ; bons-cadeaux.html + worker /api/bons-cadeaux/statut : bonModele, bonPalette.
-- Toute nouvelle clé utile au public doit être AJOUTÉE ICI (sinon elle n'apparaît pas sur le site).
CREATE OR REPLACE FUNCTION public.lx_config_publique(c jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $f$
DECLARE
  k text[] := ARRAY['absences','horaires','domicile','modeActivite','facebookUrl','instagramUrl','tiktokUrl',
                    'cartes_abo','cartes_abo_config','forfaits','cats_svc','cats_forf','fidconf','bonModele','bonPalette'];
  o jsonb;
  r jsonb;
BEGIN
  IF c IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(c) = 'object' THEN
    SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO r FROM jsonb_each(c) WHERE key = ANY(k);
    RETURN r;
  END IF;
  IF jsonb_typeof(c) = 'string' THEN
    BEGIN o := (c #>> '{}')::jsonb; EXCEPTION WHEN others THEN RETURN NULL; END;
    IF jsonb_typeof(o) = 'object' THEN
      SELECT coalesce(jsonb_object_agg(key, value), '{}'::jsonb) INTO r FROM jsonb_each(o) WHERE key = ANY(k);
      RETURN to_jsonb(r::text);
    END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END $f$;

-- resynchronise la copie publique
UPDATE public.salons_vitrine v SET config_json = public.lx_config_publique(s.config_json)
  FROM public.salons s WHERE s.id = v.id AND v.config_json IS DISTINCT FROM public.lx_config_publique(s.config_json);

COMMIT;
