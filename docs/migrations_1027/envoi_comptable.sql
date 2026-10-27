-- Luxyra — 2026-10-27 — Envoi automatique des documents comptables au comptable de l'établissement (option A)
-- APPLIQUÉ le 27/10/2026 (dashboard SQL, vérifié : anon sans accès, authenticated lecture seule, index unique présent).
-- Idempotent (peut être rejoué). Rollback commenté en fin de fichier.
-- 2026-10-27 (-2, décision d'Alexandre) : documents par défaut = FEC + pack Excel (doc_excel, nouveau) + rapport ;
-- pack ZIP (doc_pack) en option, décoché par défaut. Rejouable sur une version antérieure de ce script (ADD COLUMN IF
-- NOT EXISTS, SET DEFAULT, contrainte actif recréée) ; les lignes déjà enregistrées gardent leurs choix.
--
-- NF525 : AUCUNE table, fonction ni déclencheur fiscal n'est créé ou modifié (tickets, clotures*, nf525_*, jet,
-- audit_log, corrections_reglement… intacts). Ces deux tables ne contiennent ni ticket ni montant de caisse saisi :
--   - compta_envoi_config : réglage de l'établissement (e-mail du comptable, documents à joindre) ;
--   - compta_envois       : journal des envois (mois, destinataire, statut, horodatage, taille, empreintes SHA-256 des
--                           pièces jointes, copie des chiffres de la clôture mensuelle utilisés dans l'e-mail).
-- Pourquoi une table dédiée plutôt que salons.config_json (convention des réglages) : config_json est en partie
-- exposé au public (vue salons_public -> lx_config_publique(), qui retire une liste de clés connues) ; une adresse
-- e-mail de comptable n'a rien à y faire, et le DESTINATAIRE doit être écrit uniquement par le serveur après
-- validation (le worker relit ce réglage à chaque envoi : jamais d'adresse prise dans la requête).
-- Écritures : rôle service uniquement (worker /api/compta/envoi). Lecture : propriétaire de l'établissement + admin.
-- GRANT explicites (règle du 30/10/2026 : Supabase n'en donne plus automatiquement).

BEGIN;

-- 1. Réglage --------------------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compta_envoi_config (
  salon_id    uuid PRIMARY KEY REFERENCES public.salons(id) ON DELETE CASCADE,
  actif       boolean NOT NULL DEFAULT false,
  cabinet     text,
  email       text,
  doc_pack    boolean NOT NULL DEFAULT false,  -- pack ZIP (CSV séparés) : option
  doc_fec     boolean NOT NULL DEFAULT true,
  doc_excel   boolean NOT NULL DEFAULT true,   -- pack Excel (bouton « Documents comptables »)
  doc_rapport boolean NOT NULL DEFAULT true,   -- rapport du mois (page HTML, imprimable en PDF)
  copie       boolean NOT NULL DEFAULT true,
  maj_le      timestamptz NOT NULL DEFAULT now(),
  maj_par     text
);
-- version antérieure du script déjà appliquée : mise à niveau
ALTER TABLE public.compta_envoi_config ADD COLUMN IF NOT EXISTS doc_excel boolean NOT NULL DEFAULT true;
ALTER TABLE public.compta_envoi_config ALTER COLUMN doc_pack SET DEFAULT false;
DO $$ BEGIN
  ALTER TABLE public.compta_envoi_config ADD CONSTRAINT compta_envoi_config_cabinet_ck CHECK (cabinet IS NULL OR char_length(cabinet) <= 120);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.compta_envoi_config ADD CONSTRAINT compta_envoi_config_email_ck -- contrôle de forme minimal ; le worker applique un contrôle plus strict
    CHECK (email IS NULL OR (char_length(email) <= 254 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+[.][A-Za-z]{2,}$'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- contrainte recréée à chaque passage (elle inclut doc_excel depuis -2)
ALTER TABLE public.compta_envoi_config DROP CONSTRAINT IF EXISTS compta_envoi_config_actif_ck;
ALTER TABLE public.compta_envoi_config ADD CONSTRAINT compta_envoi_config_actif_ck
  CHECK (NOT actif OR (email IS NOT NULL AND (doc_pack OR doc_fec OR doc_excel OR doc_rapport)));

ALTER TABLE public.compta_envoi_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compta_envoi_config_lecture ON public.compta_envoi_config;
CREATE POLICY compta_envoi_config_lecture ON public.compta_envoi_config FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.salons s WHERE s.id = compta_envoi_config.salon_id AND s.user_id = auth.uid()) OR public.is_admin());
REVOKE ALL ON public.compta_envoi_config FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.compta_envoi_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compta_envoi_config TO service_role;

-- 2. Journal des envois ---------------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compta_envois (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  salon_id      uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  mois          text NOT NULL,
  type          text NOT NULL,
  statut        text NOT NULL,
  destinataire  text,
  copie_a       text,
  cabinet       text,
  fichiers      jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{nom, taille, sha256}]
  taille_totale integer NOT NULL DEFAULT 0,
  chiffres      jsonb,                                -- copie des chiffres de la clôture mensuelle (dont son empreinte)
  mode_caisse   text,
  declenche_par text,
  message_id    text,
  erreur        text,
  cree_le       timestamptz NOT NULL DEFAULT now(),
  envoye_le     timestamptz
);
DO $$ BEGIN
  ALTER TABLE public.compta_envois ADD CONSTRAINT compta_envois_mois_ck CHECK (mois ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.compta_envois ADD CONSTRAINT compta_envois_type_ck CHECK (type IN ('auto','test'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.compta_envois ADD CONSTRAINT compta_envois_statut_ck CHECK (statut IN ('reserve','envoye','echec','ecart'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- UN seul envoi réel par établissement et par mois, tous appareils confondus : la ligne « reserve » est posée AVANT
-- l'appel à Brevo ; un 2e appareil reçoit une violation d'unicité (HTTP 409) -> « déjà envoyé ». Un échec (statut
-- echec) libère le mois pour un nouvel essai ; une réservation de plus de 15 min est requalifiée en échec par le worker.
CREATE UNIQUE INDEX IF NOT EXISTS compta_envois_un_par_mois ON public.compta_envois (salon_id, mois)
  WHERE type = 'auto' AND statut IN ('reserve','envoye');
CREATE INDEX IF NOT EXISTS compta_envois_salon_date ON public.compta_envois (salon_id, cree_le DESC);

ALTER TABLE public.compta_envois ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS compta_envois_lecture ON public.compta_envois;
CREATE POLICY compta_envois_lecture ON public.compta_envois FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.salons s WHERE s.id = compta_envois.salon_id AND s.user_id = auth.uid()) OR public.is_admin());
REVOKE ALL ON public.compta_envois FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.compta_envois TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compta_envois TO service_role;

COMMENT ON TABLE public.compta_envoi_config IS 'Envoi automatique au comptable : réglage par établissement (écrit par le worker /api/compta/envoi, rôle service). Hors périmètre fiscal.';
COMMENT ON TABLE public.compta_envois IS 'Envoi automatique au comptable : journal (1 envoi réel par mois, index compta_envois_un_par_mois). Hors périmètre fiscal.';

COMMIT;

-- Vérifications après application (lecture seule) :
--   select has_table_privilege('anon','public.compta_envois','SELECT');            -- attendu : false
--   select has_table_privilege('authenticated','public.compta_envois','INSERT');   -- attendu : false
--   select indexdef from pg_indexes where indexname = 'compta_envois_un_par_mois';
--   select column_name, column_default from information_schema.columns where table_name='compta_envoi_config' and column_name like 'doc_%';
--     attendu : doc_pack false, doc_fec true, doc_excel true, doc_rapport true
--   Test du verrou (transaction annulée) :
--   begin; insert into compta_envois(salon_id,mois,type,statut) values ('<salon>','2026-09','auto','reserve');
--          insert into compta_envois(salon_id,mois,type,statut) values ('<salon>','2026-09','auto','reserve'); -- doit échouer (23505)
--   rollback;

-- ROLLBACK (à n'exécuter que pour retirer la fonction ; supprime le réglage et le journal des envois) :
-- BEGIN;
--   DROP TABLE IF EXISTS public.compta_envois;
--   DROP TABLE IF EXISTS public.compta_envoi_config;
-- COMMIT;
