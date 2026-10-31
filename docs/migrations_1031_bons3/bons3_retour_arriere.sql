-- Retour arrière de bons3.sql (partie config publique) : liste de refus d'origine. Les tables/fonctions de quota et de
-- jetons QR peuvent rester (inertes si le worker revient à l'ancienne version).
BEGIN;
CREATE OR REPLACE FUNCTION public.lx_config_publique(c jsonb)
 RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path TO 'pg_catalog' AS $function$
DECLARE
  k text[] := ARRAY['caisse_data','fond_caisse','sms_config','verrouillage_min','pay_active',
                    'migrationStatus','migrationRequestedAt','migrationRequestId','migrationDataScope',
                    'migrationSourceSoftware','migrationRgpdSentAt'];
  o jsonb;
BEGIN
  IF c IS NULL THEN RETURN NULL; END IF;
  IF jsonb_typeof(c) = 'object' THEN RETURN c - k; END IF;
  IF jsonb_typeof(c) = 'string' THEN
    BEGIN
      o := (c #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      RETURN NULL;
    END;
    IF jsonb_typeof(o) = 'object' THEN RETURN to_jsonb((o - k)::text); END IF;
    RETURN NULL;
  END IF;
  RETURN NULL;
END $function$;
UPDATE public.salons_vitrine v SET config_json = public.lx_config_publique(s.config_json)
  FROM public.salons s WHERE s.id = v.id AND v.config_json IS DISTINCT FROM public.lx_config_publique(s.config_json);
COMMIT;
