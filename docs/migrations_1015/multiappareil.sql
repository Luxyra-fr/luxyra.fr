-- =====================================================================================================
-- Multi-appareils : plus aucune « mise à jour perdue » sur les réglages + plus aucun e-mail en double
-- 15/10/2026 — branche fix-multiappareil. Idempotent : peut être rejoué sans effet de bord.
--
-- Ordre : ce SQL peut être appliqué AVANT ou APRÈS la publication de app.html / luxyra-supabase.js
-- (v=20261015-3) et du worker :
--   * sans ce SQL, l'app détecte l'absence de la colonne config_version (erreur 42703) et garde le
--     comportement actuel (fusion par clé, sans contrôle de version) ;
--   * avec ce SQL et une ANCIENNE app, rien ne change pour elle (elle n'envoie pas la version ; le
--     déclencheur incrémente quand même le compteur, ce qui fait échouer proprement le contrôle de
--     version des appareils déjà à jour → ils relisent, refusionnent et réessaient).
--
-- 1) salons.config_version / site_config.config_version : compteur entier incrémenté PAR LA BASE
--    (déclencheur BEFORE UPDATE) à chaque changement réel de config_json (salons) ou de n'importe quelle
--    colonne (site_config, hors updated_at). La valeur envoyée par un client est toujours ignorée.
--    L'app écrit avec « .eq('config_version', v) » : si un autre appareil a écrit entre-temps, 0 ligne
--    est modifiée, l'app relit la dernière version, ré-applique UNIQUEMENT les clés modifiées sur
--    l'appareil et réessaie (3 fois au plus), sinon message d'erreur (jamais de perte silencieuse).
-- 2) messaging_log : rappels e-mail de la veille enregistrés par une ancienne version de l'app (journal
--    écrit sans clé) reçoivent la MÊME clé que celle du serveur (envoyer_rappels_email_24h), pour que
--    l'index unique uniq_messaging_log_dedup les voie. Les autres e-mails reçoivent leur clé du worker
--    (/api/email/*, réservation AVANT l'envoi) — rien à créer ici : l'index unique existe déjà.
-- =====================================================================================================
BEGIN;

-- ---------------------------------------------------------------- 1) Colonnes de version
ALTER TABLE public.salons      ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 0;
ALTER TABLE public.site_config ADD COLUMN IF NOT EXISTS config_version integer NOT NULL DEFAULT 0;
COMMENT ON COLUMN public.salons.config_version IS
  '2026-10-15 : version de config_json, incrémentée par la base (trg_salons_config_version). Contrôle de concurrence optimiste entre appareils.';
COMMENT ON COLUMN public.site_config.config_version IS
  '2026-10-15 : version de la ligne, incrémentée par la base (trg_site_config_version) à chaque changement réel. Contrôle de concurrence optimiste entre appareils.';

-- Droits explicites (règle du 10/10 : jamais de dépendance implicite aux droits par défaut)
GRANT SELECT (config_version) ON public.salons      TO authenticated;
GRANT SELECT (config_version) ON public.site_config TO anon, authenticated;

-- ---------------------------------------------------------------- 2) Déclencheurs de version
CREATE OR REPLACE FUNCTION lx_prive.salons_config_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  -- Le compteur ne se règle jamais depuis un client : on repart TOUJOURS de l'ancienne valeur.
  IF NEW.config_json IS DISTINCT FROM OLD.config_json THEN
    NEW.config_version := coalesce(OLD.config_version, 0) + 1;
  ELSE
    NEW.config_version := coalesce(OLD.config_version, 0);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION lx_prive.salons_config_version() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION lx_prive.site_config_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN
  -- Toute colonne compte, sauf l'horodatage et le compteur lui-même.
  IF (to_jsonb(NEW) - 'updated_at' - 'config_version') IS DISTINCT FROM (to_jsonb(OLD) - 'updated_at' - 'config_version') THEN
    NEW.config_version := coalesce(OLD.config_version, 0) + 1;
  ELSE
    NEW.config_version := coalesce(OLD.config_version, 0);
  END IF;
  RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION lx_prive.site_config_version() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_salons_config_version ON public.salons;
CREATE TRIGGER trg_salons_config_version BEFORE UPDATE ON public.salons
  FOR EACH ROW EXECUTE FUNCTION lx_prive.salons_config_version();

DROP TRIGGER IF EXISTS trg_site_config_version ON public.site_config;
CREATE TRIGGER trg_site_config_version BEFORE UPDATE ON public.site_config
  FOR EACH ROW EXECUTE FUNCTION lx_prive.site_config_version();

-- Une ligne créée par un client démarre toujours à 0
CREATE OR REPLACE FUNCTION lx_prive.config_version_zero()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $fn$
BEGIN NEW.config_version := 0; RETURN NEW; END $fn$;
REVOKE ALL ON FUNCTION lx_prive.config_version_zero() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_site_config_version_ins ON public.site_config;
CREATE TRIGGER trg_site_config_version_ins BEFORE INSERT ON public.site_config
  FOR EACH ROW EXECUTE FUNCTION lx_prive.config_version_zero();

-- ---------------------------------------------------------------- 3) Clé anti-doublon des rappels e-mail
-- Reprise de fn_messaging_log_dedup_key (définition en base au 15/10) + 1 cas :
-- e-mail « rappel_24h » sans clé (ancienne app) -> même clé que envoyer_rappels_email_24h :
--   <salon>|rappel_24h_email|<adresse en minuscules>|<date du RDV = lendemain, heure de Paris>
CREATE OR REPLACE FUNCTION public.fn_messaging_log_dedup_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.type = 'sms'
     AND NEW.context IN ('rappel_24h','rappel_2h','confirmation_rdv','confirmation_rdv_groupe',
                         'anniversaire','relance')
     AND NEW.recipient IS NOT NULL THEN
    NEW.dedup_key := NEW.salon_id::text || '|' || NEW.context || '|' || NEW.recipient || '|'
                     || to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
  -- 2026-10-14 audit : campagnes
  ELSIF NEW.type = 'sms' AND NEW.context = 'marketing' AND NEW.recipient IS NOT NULL THEN
    NEW.dedup_key := NEW.salon_id::text || '|marketing|' || NEW.recipient || '|' || md5(coalesce(NEW.content, '')) || '|'
                     || to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
  -- 2026-10-15 multi-appareils : rappel e-mail de la veille journalisé sans clé par une ancienne app
  ELSIF NEW.type = 'email' AND NEW.context = 'rappel_24h' AND NEW.dedup_key IS NULL AND NEW.recipient IS NOT NULL THEN
    NEW.dedup_key := NEW.salon_id::text || '|rappel_24h_email|' || lower(trim(NEW.recipient)) || '|'
                     || (((coalesce(NEW.created_at, now()) AT TIME ZONE 'Europe/Paris')::date) + 1)::text;
  END IF;
  RETURN NEW;
END; $function$;

-- ---------------------------------------------------------------- 4) Bot support (support_bot_kb, upsert sur cle)
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le) VALUES
('multiappareil_1015', 'Plusieurs appareils : réglages modifiés en même temps', 908, $kb$Plusieurs appareils (tablette de caisse, téléphone, ordinateur) peuvent modifier les réglages en même temps : chaque enregistrement n'envoie que ce qui a été modifié SUR CET APPAREIL ; si un autre appareil a enregistré juste avant, l'application relit la dernière version, y ajoute ses propres changements et réessaie automatiquement. Rien n'est écrasé en silence : en cas d'échec, le message « ⚠️ Non enregistré — … Réessayez. » s'affiche.
Bandeau « Mis à jour sur un autre appareil » : il apparaît quand un réglage a changé ailleurs pendant qu'un formulaire est ouvert ou en cours de saisie sur cet appareil. Le formulaire n'est pas remplacé pour ne pas perdre la saisie : enregistrer (les deux modifications sont gardées) ou quitter la page pour voir la nouvelle version (bouton « Afficher »). Sans saisie en cours, l'écran se met à jour tout seul (vérification toutes les minutes et au retour sur l'application).
Prestation, forfait, produit ou collaborateur supprimé sur un autre appareil puis modifié ici : il n'est plus recréé ; message « … a été supprimé(e) sur un autre appareil » et la liste est mise à jour.
Rappels : les rappels de la veille (SMS et e-mail) et les rappels 2 h avant sont envoyés par le serveur Luxyra, même appareils éteints ; l'application ne les envoie plus (plus de doublon quand deux appareils sont ouverts). Un même e-mail (confirmation, modification, annulation, invitation à laisser un avis, ticket…) n'est jamais envoyé deux fois au même client en moins de 10 minutes : un second envoi identique est ignoré (message « Déjà envoyé il y a moins de 10 minutes »).$kb$, true, now())
ON CONFLICT (cle) DO UPDATE SET titre = EXCLUDED.titre, ordre = EXCLUDED.ordre, contenu = EXCLUDED.contenu,
                                actif = EXCLUDED.actif, maj_le = now();

-- ---------------------------------------------------------------- 5) Contrôles (lecture seule)
SELECT table_name, column_name, data_type, column_default, is_nullable FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name = 'config_version' ORDER BY 1;
SELECT c.relname, t.tgname FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
 WHERE t.tgname IN ('trg_salons_config_version','trg_site_config_version','trg_site_config_version_ins');

COMMIT;
