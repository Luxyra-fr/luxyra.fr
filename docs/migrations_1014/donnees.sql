-- ============================================================================
-- Luxyra — Audit du 14/10/2026 — lot « DONNÉES / SYNCHRONISATION »
-- Fichier IDEMPOTENT (rejouable sans effet de bord). À appliquer par Alexandre
-- (NE PAS appliquer automatiquement). Aucune ligne existante n'est modifiée :
-- ni ticket, ni clôture, ni signature, ni JET, ni rendez-vous scellé.
-- Les fonctions NF525 sont recréées à l'identique, avec uniquement les ajouts
-- décrits ci-dessous (corps d'origine relu par pg_get_functiondef le 14/10/2026).
-- Registre : docs/registre-interventions-nf525.md (entrée du 2026-10-14).
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. [NF525] Numérotation des tickets : verrou par établissement
-- ----------------------------------------------------------------------------
-- Avant : max(num)+1 sans verrou -> deux postes encaissant au même instant
-- calculaient le même numéro ; le second était refusé (index unique
-- tickets_num_per_salon) et devait être retransmis. Le verrou transactionnel
-- (libéré à la fin de la transaction) sérialise le calcul du numéro et du
-- chaînage (hash_prev) par établissement. Corps de la fonction INCHANGÉ par ailleurs.
CREATE OR REPLACE FUNCTION public.ticket_nf525_insert()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_prev_hash text;
  v_max_num integer;
  v_payload text;
BEGIN
  -- 2026-10-14 audit : verrou par établissement (numérotation + chaînage sans course)
  PERFORM pg_advisory_xact_lock(hashtext(NEW.salon_id::text));

  IF NEW.num IS NULL OR NEW.num <= 0 THEN
    SELECT coalesce(max(num), 0) + 1 INTO v_max_num
    FROM public.tickets WHERE salon_id = NEW.salon_id;
    NEW.num := v_max_num;
  END IF;

  SELECT hash INTO v_prev_hash
  FROM public.tickets
  WHERE salon_id = NEW.salon_id AND num = NEW.num - 1
  LIMIT 1;
  NEW.hash_prev := coalesce(v_prev_hash, '');

  v_payload := NEW.num::text || '|' ||
               NEW.date_ticket::text || '|' ||
               NEW.heure_ticket::text || '|' ||
               to_char(NEW.total_ttc, 'FM999999990.00') || '|' ||
               to_char(NEW.total_ht,  'FM999999990.00') || '|' ||
               coalesce(NEW.items::text, '[]') || '|' ||
               NEW.hash_prev || '|' ||
               NEW.salon_id::text;
  NEW.hash := encode(extensions.digest(v_payload, 'sha256'), 'hex');
  NEW.hash_algo := 'SHA-256';

  IF NEW.ts_created IS NULL THEN NEW.ts_created := now(); END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 2. [NF525] Rendez-vous encaissés (scellés) : statut, annulation, date
--    d'annulation et détail des règlements protégés
-- ----------------------------------------------------------------------------
-- Avant : une fois le RDV encaissé, status / cancelled / cancel_date / payments
-- restaient modifiables (une mémoire périmée d'un autre appareil pouvait remettre
-- cancelled=false sur un ticket annulé, ou réécrire les règlements).
-- Désormais, sur une ligne scellée (status='done' OU hash non vide) :
--   - status   : inchangeable ;
--   - cancelled: seulement false -> true (chemin officiel d'annulation :
--                _cancelSecureTicketDo / annulation d'acompte posent cancelled=true
--                avec cancel_reason et cancel_date ; le contre-ticket est une
--                NOUVELLE ligne). true -> false refusé ;
--   - cancel_date : renseignable une fois (NULL -> valeur, avec cancelled=true),
--                puis figée ;
--   - payments : inchangeable.
-- Les messages contiennent « inalterable » : l'application retombe alors sur la
-- mise à jour des seules colonnes non protégées (comportement existant).
-- Le reste de la fonction est INCHANGÉ.
CREATE OR REPLACE FUNCTION public.appointments_nf525_protect()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_role text;
  v_unlock text;
BEGIN
  v_role := (select auth.role());
  IF v_role IS NULL OR v_role = 'service_role' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- Trappe d'urgence explicite (factory_reset_salon, maintenance encadree)
  BEGIN
    v_unlock := current_setting('luxyra.allow_nf525_unlock', true);
  EXCEPTION WHEN OTHERS THEN v_unlock := NULL; END;
  IF v_unlock = 'true' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;

  -- DELETE strictement interdit sur ticket encaisse (status=done OU hash valide non vide)
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'done' OR (OLD.hash IS NOT NULL AND OLD.hash != '') THEN
      RAISE EXCEPTION 'NF525 : impossible de supprimer un ticket encaisse. Utilisez l''annulation (contre-ticket).';
    END IF;
    RETURN OLD;
  END IF;

  -- UPDATE : champs sensibles bloques pour tickets done OU deja hashes
  IF (OLD.status = 'done' OR (OLD.hash IS NOT NULL AND OLD.hash != '')) THEN
    IF (NEW.items IS DISTINCT FROM OLD.items)
       OR (NEW.prix IS DISTINCT FROM OLD.prix)
       OR (NEW.brut_total IS DISTINCT FROM OLD.brut_total)
       OR (NEW.remise IS DISTINCT FROM OLD.remise)
       OR (NEW.mode_paiement IS DISTINCT FROM OLD.mode_paiement)
       OR (NEW.date_rdv IS DISTINCT FROM OLD.date_rdv)
       OR (NEW.heure IS DISTINCT FROM OLD.heure)
       OR (NEW.ticket_num IS DISTINCT FROM OLD.ticket_num)
       OR (NEW.hash IS DISTINCT FROM OLD.hash)
       OR (NEW.prev_hash IS DISTINCT FROM OLD.prev_hash)
       OR (NEW.hash_algo IS DISTINCT FROM OLD.hash_algo)
       OR (NEW.salon_id IS DISTINCT FROM OLD.salon_id) THEN
      RAISE EXCEPTION 'NF525 : ticket encaisse inalterable. Pour annuler, creez un contre-ticket avec motif.';
    END IF;
    -- 2026-10-14 audit : statut, annulation, date d'annulation et reglements
    IF (NEW.status IS DISTINCT FROM OLD.status)
       OR (NEW.payments IS DISTINCT FROM OLD.payments) THEN
      RAISE EXCEPTION 'NF525 : ticket encaisse inalterable (statut / reglements). Pour annuler, creez un contre-ticket avec motif.';
    END IF;
    IF coalesce(OLD.cancelled, false) = true AND coalesce(NEW.cancelled, false) = false THEN
      RAISE EXCEPTION 'NF525 : ticket encaisse inalterable (une annulation ne peut pas etre retiree).';
    END IF;
    IF (NEW.cancel_date IS DISTINCT FROM OLD.cancel_date)
       AND NOT (OLD.cancel_date IS NULL AND coalesce(NEW.cancelled, false) = true) THEN
      RAISE EXCEPTION 'NF525 : ticket encaisse inalterable (date d''annulation figee).';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- ----------------------------------------------------------------------------
-- 3. Rendez-vous : date de dernière modification (rejeu de la file de secours)
-- ----------------------------------------------------------------------------
-- L'application compare appointments.updated_at à l'heure de l'opération mise en
-- file : une version plus récente en base (autre appareil) n'est plus écrasée par
-- un rejeu. Colonne ajoutée SANS valeur pour les lignes existantes (aucune ligne
-- réécrite) ; valeur par défaut now() pour les nouvelles lignes ; mise à jour par
-- déclencheur à chaque modification (colonne non scellée, hors hash).
ALTER TABLE public.appointments ADD COLUMN IF NOT EXISTS updated_at timestamptz;
ALTER TABLE public.appointments ALTER COLUMN updated_at SET DEFAULT now();
DROP TRIGGER IF EXISTS tr_appointments_updated_at ON public.appointments;
CREATE TRIGGER tr_appointments_updated_at
  BEFORE UPDATE ON public.appointments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ----------------------------------------------------------------------------
-- 4. Rattachement automatique fiche salon <-> compte Luxyra (fn_autolink_clients_luxyra)
-- ----------------------------------------------------------------------------
-- Avant : à la création d'un compte, TOUTES les fiches salon (tous établissements)
-- ayant le même téléphone OU le même e-mail étaient rattachées au compte, et leur
-- consentement SMS / e-mail remplacé : un numéro réattribué, un téléphone ou un
-- e-mail partagé (famille) rattachait la fiche d'une autre personne.
-- Désormais : uniquement si l'e-mail du compte est VÉRIFIÉ (email_verified) ET que
-- l'e-mail ET le nom ET le prénom (normalize_name) de la fiche correspondent.
-- Plus aucune correspondance par téléphone. Déclenché à la création ET au moment
-- où l'e-mail devient vérifié.
-- NB : à ce jour lx-signup crée les comptes avec email_verified=false : le
-- rattachement automatique est donc suspendu tant que la vérification n'est pas
-- enregistrée ; le rattachement lors d'une réservation (application) continue.
ALTER TABLE public.clients_luxyra ADD COLUMN IF NOT EXISTS email_verified_legacy boolean NOT NULL DEFAULT false; -- (créée par secu.sql)
-- 2026-10-14 intégration : définition UNIQUE (secu.sql renvoie ici) — contient les règles du lot sécurité
-- (e-mail vérifié, e-mail seulement, une seule fois au passage à « vérifié ») et celles du lot données.
CREATE OR REPLACE FUNCTION public.fn_autolink_clients_luxyra()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_email text;
  v_sexe  text;
  r record;
BEGIN
  -- 2026-10-14 audit : e-mail vérifié + même e-mail + même nom et prénom, jamais le téléphone
  IF coalesce(NEW.email_verified, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;
  -- 2026-10-14 intégration : compte antérieur repris comme « vérifié » (secu.sql §1 bis) : fiches déjà rattachées
  -- à sa création avec les anciennes règles, la reprise ne crée aucun nouveau lien.
  IF TG_OP = 'UPDATE' AND coalesce(NEW.email_verified_legacy, false) THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND coalesce(OLD.email_verified, false) = true THEN
    RETURN NEW; -- déjà traité lors de la vérification
  END IF;
  v_email := NULLIF(lower(trim(coalesce(NEW.email,''))), '');
  IF v_email IS NULL OR NULLIF(trim(coalesce(NEW.nom,'')), '') IS NULL OR NULLIF(trim(coalesce(NEW.prenom,'')), '') IS NULL THEN
    RETURN NEW;
  END IF;

  FOR r IN
    UPDATE public.clients c
    SET client_luxyra_id = NEW.id,
        email = COALESCE(NULLIF(NEW.email,''), c.email),
        sexe  = COALESCE(NULLIF(c.sexe,''), NULLIF(NEW.genre,'')),
        sms_ok = NEW.sms_ok,
        email_ok = NEW.email_ok
    WHERE c.client_luxyra_id IS NULL
      AND c.fusionne_dans IS NULL
      AND lower(trim(coalesce(c.email,''))) = v_email
      AND public.normalize_name(c.nom) = public.normalize_name(NEW.nom)
      AND public.normalize_name(c.prenom) = public.normalize_name(NEW.prenom)
    RETURNING c.salon_id AS salon_id, c.points_fidelite AS pts, c.sexe AS sexe, c.id AS cid
  LOOP
    IF v_sexe IS NULL AND NULLIF(r.sexe,'') IS NOT NULL THEN v_sexe := r.sexe; END IF;
    IF COALESCE(r.pts,0) <> 0 THEN
      IF EXISTS (SELECT 1 FROM public.fidelite_client f
                 WHERE f.salon_id = r.salon_id AND lower(f.client_luxyra_id) = v_email) THEN
        UPDATE public.fidelite_client
        SET points = r.pts, updated_at = now()
        WHERE salon_id = r.salon_id AND lower(client_luxyra_id) = v_email;
      ELSE
        INSERT INTO public.fidelite_client (client_luxyra_id, salon_id, points, visites, derniere_visite, updated_at)
        VALUES (
          v_email, r.salon_id, r.pts,
          COALESCE((SELECT count(*) FROM public.appointments a
                    WHERE a.client_id = r.cid AND a.salon_id = r.salon_id AND a.status = 'done'), 0),
          (SELECT max(a.date_rdv) FROM public.appointments a
           WHERE a.client_id = r.cid AND a.salon_id = r.salon_id AND a.status = 'done'),
          now()
        );
      END IF;
    END IF;
  END LOOP;

  -- Le compte Luxyra adopte le genre de la fiche salon s'il etait vide
  IF COALESCE(NEW.genre,'') = '' AND v_sexe IS NOT NULL THEN
    UPDATE public.clients_luxyra SET genre = v_sexe WHERE id = NEW.id;
  END IF;

  RETURN NEW;
END;
$function$;

-- 2026-10-14 intégration : UN SEUL déclencheur (avant : trg_autolink_clients_luxyra ici ET dans secu.sql sous un
-- autre nom -> double exécution au passage à « vérifié »). La fonction filtre elle-même : création d'un compte déjà
-- vérifié, ou passage de non vérifié à vérifié (une seule fois).
DROP TRIGGER IF EXISTS trg_autolink_clients_luxyra_verifie ON public.clients_luxyra;
DROP TRIGGER IF EXISTS trg_autolink_clients_luxyra ON public.clients_luxyra;
CREATE TRIGGER trg_autolink_clients_luxyra
  AFTER INSERT OR UPDATE OF email_verified ON public.clients_luxyra
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_autolink_clients_luxyra();

-- ----------------------------------------------------------------------------
-- 5. Consentement d'une fiche créée depuis une réservation en ligne (RGPD)
-- ----------------------------------------------------------------------------
-- L'application crée désormais ces fiches avec sms_ok=false / email_ok=false
-- (avant : true présumé). Quand la fiche est liée à un compte Luxyra dès sa
-- création, le consentement déclaré par la personne sur son compte est recopié.
CREATE OR REPLACE FUNCTION lx_prive.clients_consentement_depuis_compte()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_sms boolean;
  v_mail boolean;
BEGIN
  IF NEW.client_luxyra_id IS NULL THEN RETURN NEW; END IF;
  SELECT cl.sms_ok, cl.email_ok INTO v_sms, v_mail FROM public.clients_luxyra cl WHERE cl.id = NEW.client_luxyra_id;
  IF FOUND THEN
    NEW.sms_ok := coalesce(v_sms, false);
    NEW.email_ok := coalesce(v_mail, false);
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'clients_consentement_depuis_compte : %', SQLERRM;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION lx_prive.clients_consentement_depuis_compte() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_clients_consentement_depuis_compte ON public.clients;
CREATE TRIGGER trg_clients_consentement_depuis_compte
  BEFORE INSERT ON public.clients
  FOR EACH ROW EXECUTE FUNCTION lx_prive.clients_consentement_depuis_compte();

COMMIT;

-- ----------------------------------------------------------------------------
-- Vérifications après application (lecture seule)
-- ----------------------------------------------------------------------------
-- select position('pg_advisory_xact_lock' in pg_get_functiondef('public.ticket_nf525_insert()'::regprocedure)) > 0;
-- select position('payments IS DISTINCT' in pg_get_functiondef('public.appointments_nf525_protect()'::regprocedure)) > 0;
-- select column_name from information_schema.columns where table_name='appointments' and column_name='updated_at';
-- select tgname from pg_trigger where tgname in ('tr_appointments_updated_at','trg_autolink_clients_luxyra','trg_clients_consentement_depuis_compte'); -- trg_autolink_clients_luxyra_verifie : absent
-- Puis relancer les tests de protection NF525 : select * from public.nf525_tests_protections();
