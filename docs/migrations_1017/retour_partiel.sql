-- =====================================================================================================
-- Luxyra — 2026-10-17 retour partiel — RETOUR / REMBOURSEMENT PARTIEL D'UN TICKET VALIDÉ (NF525)
-- Accord de l'éditeur (Alexandre) : « dans les règles de l'art, sans erreur ni oubli ».
-- Script IDEMPOTENT (CREATE OR REPLACE / IF NOT EXISTS / remplacements gardés), transaction unique. NON APPLIQUÉ à la date de
-- rédaction.
--
-- Principe (BOI-TVA-DECLA-30-10-30 §90) : un retour partiel est un NOUVEAU ticket NÉGATIF de la table public.tickets,
-- inséré par le chemin habituel (application -> saveTicketToDb) : numéro, chaînage (hash_prev) et empreinte calculés par le
-- déclencheur existant ticket_nf525_insert, scellement nf525_hash_seal et signature ES256 « TK » (nf525-sign, type R pour un
-- montant négatif) INCHANGÉS. Le ticket d'origine n'est jamais modifié.
-- Marqueurs portés par le ticket de retour (raw_data, et chaque ligne de items) :
--   raw_data.isRetour = true, raw_data.retourRefId = raw_data.id EXACT du ticket d'origine au journal, raw_data.retourRefTk = n°
--   imprimé du ticket d'origine, raw_data.retourRefDate, raw_data.retourMotif ; items[k].isRetour / retourRefId / retourIdx (n° de
--   ligne d'origine) / retourQty (produits).
--
-- CE SCRIPT AJOUTE / ADAPTE :
--   1) un déclencheur de CONTRÔLE (lecture seule sur les données existantes) avant insertion dans public.tickets, qui REFUSE
--      (message LX_RETOUR_REFUSE, errcode P0001) :
--        a) un ticket de retour incohérent : sans ticket d'origine, sans motif, montant non négatif, ligne non marquée « retour »,
--           lignes dont la somme diffère du total, règlement positif, ticket d'origine introuvable / annulé / négatif / de retour /
--           contre-ticket / acompte / annulation d'acompte / retenue, n° d'origine imprimé différent, ticket d'origine déjà annulé
--           par un contre-ticket, mode de caisse (test / réel) différent, retour daté avant le ticket d'origine, CUMUL des retours
--           supérieur au montant du ticket d'origine, quantité retournée d'une ligne supérieure à la quantité achetée ;
--        b) un contre-ticket d'annulation (avoir total) visant un ticket de retour, ou un ticket qui a déjà un retour partiel
--           (le remboursement total dépasserait le payé).
--      Le déclencheur prend le MÊME verrou transactionnel par établissement que ticket_nf525_insert
--      (pg_advisory_xact_lock(hashtext(salon_id))) : deux appareils ne peuvent pas rembourser en même temps au-delà du payé.
--      Un rejeu du même ticket (même raw_data->>'id') est exclu du cumul : il reste traité par l'idempotence existante.
--      2026-10-17 retour partiel (audit) : identifiant du ticket d'origine accepté sous ses deux formes « <uuid> » / « online_<uuid> »
--      (54 tickets de réservation en ligne ont raw_data.id = « online_<uuid> » alors que l'application les recharge sous « <uuid> »).
--   2) des index de lecture (retours d'un ticket d'origine ; n° imprimé ; contre-tickets par référence) : les contrôles du
--      déclencheur n'analysent jamais toute la table (raw_data contient le HTML du ticket, ~4,4 Ko par ligne).
--   3) nf525_jet_code : l'action d'audit TICKET_RETOUR_PARTIEL est reportée au JET (code 190, famille des annulations / avoirs ;
--      le libellé JET porte le nom de l'action, « TICKET_RETOUR_PARTIEL — … »). Remplacement gardé de la définition RÉELLE.
--   4) check_fiscal_integrity (règle 5 « ANNULATION_SANS_CONTRE_TICKET ») : un ticket de RETOUR n'est plus accepté comme
--      contre-ticket d'une annulation (il masquait une annulation sans contre-ticket de même montant), et une ligne de rendez-vous
--      annulée de montant NÉGATIF (ticket de retour écarté localement après un refus définitif du serveur) n'est plus signalée
--      comme « CA surévalué ». Remplacement gardé de la définition RÉELLE.
-- AUCUNE ligne existante n'est modifiée : ni ticket, ni clôture, ni signature, ni JET. AUCUN format de données hachées / signées
-- n'est modifié. Les tickets existants ne portent aucun marqueur isRetour (vérifié le 17/10/2026 : 0 sur 792).
--
-- RIEN À CHANGER (définitions RÉELLES relues en base le 17/10/2026) :
--   - lx_prive.clotures_controle_journal (déclencheur b_nf525_z_controle_journal) et lx_prive.z_journal_tickets : une Z est
--     comparée à la somme des tickets status <> 'cancelled' du jour. Le ticket de retour (status 'paid', total négatif) y entre
--     UNE fois, comme dans cloturerJournee et _lxZControleJournal ; il n'est jamais exclu comme « paire annulée le même jour ».
--   - lx-cloture-auto (clôture de nuit, calcul sur appointments) : le retour (status done, non annulé, prix négatif) entre dans le
--     total et le nombre -> Z égale au journal, acceptée par le déclencheur. (Écart connu et ANTÉRIEUR : sa copie de
--     _splitPrestProd date d'avant le 11/10 et range tout montant négatif en « prestations » ; sans effet sur total_ca / nb, ni
--     sur total_ht en taux unique ; en double taux, ventilation prestations / produits de la Z de nuit à réaligner -> à faire.)
--   - clotures_set_cumul_perpetuel / cloturer_mois / cloturer_exercice / nf525_grands_totaux : bâtis sur les Z / tickets.
--   - check_data_integrity(uuid) / check_data_integrity() / admin_nf525_etat : aucune règle ne vise un ticket négatif non
--     contre-ticket ; numérotation, chaînage, scellement, signatures inchangés pour le retour.
--   - nf525_infos_z : le retour est compté dans « retours » (total < 0), comme un contre-ticket.
--   - nf525-sign (TK) : signe tout ticket ; type « R » si total < 0. nf525_tests_protections : insère un ticket sans raw_data
--     (jamais vu comme un retour ni un contre-ticket par ce déclencheur).
--
-- ORDRE DE DÉPLOIEMENT : 1) ce script (compatible avec l'application actuelle : aucun ticket existant ni aucun chemin actuel ne
-- porte isRetour ; un avoir n'est refusé que si un retour existe, ce qui ne peut arriver qu'avec la nouvelle version) ;
-- 2) publier app.html + luxyra-supabase.js?v=20261017-1 ; 3) bot : retour_partiel_bot.sql ; 4) essais en caisse TEST.
-- L'application fonctionne aussi si ce script n'est pas encore appliqué (mêmes contrôles côté application), mais sans le
-- verrou serveur contre deux retours simultanés depuis deux appareils : NE PAS publier l'application avant ce script.
-- Registre : docs/registre-interventions-nf525.md, entrée du 2026-10-17.
-- =====================================================================================================

BEGIN;

CREATE OR REPLACE FUNCTION lx_prive.tickets_retour_controle()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  o           record;      -- ticket d'origine
  v_ref       text;
  v_nu        text;
  v_refs      text[];
  v_mode      text;
  v_deja      numeric;
  v_new_id    text;
  v_items     jsonb;
  v_orig_its  jsonb;
  v_somme     numeric;
  r           record;
  v_cible     record;
  v_cref      text;
  v_cnu       text;
BEGIN
  v_items := CASE WHEN jsonb_typeof(to_jsonb(NEW.items)) = 'array' THEN to_jsonb(NEW.items) ELSE '[]'::jsonb END;
  -- ------------------------------------------------------------------ A) ticket de RETOUR / REMBOURSEMENT PARTIEL
  -- 2026-10-17 retour partiel (audit) : une ligne marquée « retour » suffit à déclencher le contrôle (même règle que _lxEstRetour)
  IF coalesce(NEW.raw_data->>'isRetour', '') = 'true'
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE coalesce(e->>'isRetour', '') = 'true') THEN
    -- même verrou que ticket_nf525_insert (réentrant dans la transaction) : contrôle du cumul et numérotation sérialisés
    PERFORM pg_advisory_xact_lock(hashtext(NEW.salon_id::text));
    v_ref    := nullif(btrim(coalesce(NEW.raw_data->>'retourRefId', '')), '');
    v_new_id := coalesce(NEW.raw_data->>'id', '#');
    IF coalesce(NEW.raw_data->>'isRetour', '') <> 'true' OR v_ref IS NULL THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : ticket de retour sans référence au ticket d''origine' USING errcode = 'P0001';
    END IF;
    v_nu   := regexp_replace(v_ref, '^online_', '');
    v_refs := ARRAY[v_nu, 'online_' || v_nu];
    IF nullif(btrim(coalesce(NEW.raw_data->>'retourMotif', '')), '') IS NULL THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : motif du retour obligatoire' USING errcode = 'P0001';
    END IF;
    IF coalesce(NEW.total_ttc, 0) >= 0 THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : le montant d''un ticket de retour doit être négatif' USING errcode = 'P0001';
    END IF;
    IF coalesce(NEW.status, '') = 'cancelled' THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : un ticket de retour ne peut pas être enregistré annulé' USING errcode = 'P0001';
    END IF;
    IF jsonb_array_length(v_items) = 0
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                   WHERE coalesce(e->>'isSep', '') <> 'true'
                     AND (coalesce(e->>'isRetour', '') <> 'true' OR coalesce(e->>'retourRefId', '') <> v_ref)) THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : toutes les lignes d''un ticket de retour doivent référencer le ticket d''origine' USING errcode = 'P0001';
    END IF;
    -- 2026-10-17 retour partiel (audit) : lignes = total (aucune ligne positive cachée) ; aucun règlement positif
    SELECT coalesce(sum(coalesce(nullif(e->>'price', '')::numeric, 0) * coalesce(nullif(e->>'qty', '')::numeric, 1)
                        - coalesce(nullif(e->>'remise', '')::numeric, 0)), 0)
      INTO v_somme FROM jsonb_array_elements(v_items) e WHERE coalesce(e->>'isSep', '') <> 'true';
    IF abs(v_somme - NEW.total_ttc) > 0.01
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e
                   WHERE coalesce(e->>'isSep', '') <> 'true'
                     AND coalesce(nullif(e->>'price', '')::numeric, 0) * coalesce(nullif(e->>'qty', '')::numeric, 1) - coalesce(nullif(e->>'remise', '')::numeric, 0) > 0.004) THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : lignes du ticket de retour incohérentes avec son total' USING errcode = 'P0001';
    END IF;
    IF jsonb_typeof(NEW.detail_paiement) = 'object'
       AND EXISTS (SELECT 1 FROM jsonb_each_text(NEW.detail_paiement) d
                    WHERE d.value ~ '^-?[0-9]+(\.[0-9]+)?$' AND d.value::numeric > 0.004) THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : un ticket de retour ne peut pas comporter d''encaissement' USING errcode = 'P0001';
    END IF;

    SELECT * INTO o FROM public.tickets
     WHERE salon_id = NEW.salon_id AND raw_data->>'id' = ANY (v_refs)
     ORDER BY num LIMIT 1;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : ticket d''origine introuvable dans le journal (non transmis ?)' USING errcode = 'P0001';
    END IF;
    IF coalesce(o.status, '') = 'cancelled' OR coalesce(o.total_ttc, 0) <= 0 THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : ticket d''origine n°% annulé ou sans montant encaissé', o.num USING errcode = 'P0001';
    END IF;
    v_orig_its := CASE WHEN jsonb_typeof(to_jsonb(o.items)) = 'array' THEN to_jsonb(o.items) ELSE '[]'::jsonb END;
    IF coalesce(o.raw_data->>'isRetour', '') = 'true' OR coalesce(o.raw_data->>'isCancel', '') = 'true'
       OR coalesce(o.raw_data->>'contraSameDay', '') = 'true'
       OR coalesce(o.raw_data->>'isAcompte', '') = 'true' OR coalesce(o.raw_data->>'isAcompteCancel', '') = 'true'
       OR coalesce(o.raw_data->>'isRetenue', '') = 'true'
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(v_orig_its) e
                   WHERE e->>'isAcompte' = 'true' OR e->>'isAcompteCancel' = 'true' OR e->>'isRetenue' = 'true' OR e->>'isRetour' = 'true') THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : le ticket n°% (retour, contre-ticket, acompte ou retenue) ne peut pas faire l''objet d''un retour', o.num USING errcode = 'P0001';
    END IF;
    -- 2026-10-17 retour partiel (audit) : le n° d'origine imprimé sur le ticket de retour est celui du journal
    IF nullif(o.raw_data->>'tkNum', '') IS NOT NULL AND coalesce(NEW.raw_data->>'retourRefTk', '') <> o.raw_data->>'tkNum' THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : n° du ticket d''origine (%) différent du journal (%)', coalesce(NEW.raw_data->>'retourRefTk', '?'), o.raw_data->>'tkNum' USING errcode = 'P0001';
    END IF;
    -- ticket d'origine déjà annulé en totalité par un contre-ticket (référence = n° imprimé ou identifiant)
    IF EXISTS (SELECT 1 FROM public.tickets c
                WHERE c.salon_id = NEW.salon_id AND c.raw_data->>'isCancel' = 'true'
                  AND c.raw_data->>'cancelRef' = ANY (array_remove(ARRAY[o.raw_data->>'id', o.raw_data->>'tkNum', v_nu, 'online_' || v_nu], NULL))) THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : le ticket n°% a déjà un contre-ticket d''annulation', o.num USING errcode = 'P0001';
    END IF;
    -- même mode de caisse (test / réel) que le ticket d'origine
    SELECT mode_caisse INTO v_mode FROM public.salons WHERE id = NEW.salon_id;
    IF o.mode_caisse IS NOT NULL AND v_mode IS NOT NULL AND o.mode_caisse <> v_mode THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : ticket d''origine en caisse %, caisse actuellement en %', o.mode_caisse, v_mode USING errcode = 'P0001';
    END IF;
    IF NEW.date_ticket IS NOT NULL AND o.date_ticket IS NOT NULL AND NEW.date_ticket < o.date_ticket THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : un retour ne peut pas être daté avant le ticket d''origine' USING errcode = 'P0001';
    END IF;
    -- cumul des retours (hors rejeu de ce même ticket) <= montant du ticket d'origine
    SELECT coalesce(sum(-t.total_ttc), 0) INTO v_deja FROM public.tickets t
     WHERE t.salon_id = NEW.salon_id AND t.raw_data->>'isRetour' = 'true'
       AND t.raw_data->>'retourRefId' = ANY (v_refs) AND coalesce(t.status, '') <> 'cancelled'
       AND coalesce(t.raw_data->>'id', '') <> v_new_id;
    IF v_deja + (-NEW.total_ttc) > o.total_ttc + 0.005 THEN
      RAISE EXCEPTION 'LX_RETOUR_REFUSE : remboursement total % EUR supérieur au ticket n°% (% EUR, déjà remboursé % EUR)',
        to_char(v_deja - NEW.total_ttc, 'FM999999990.00'), o.num, to_char(o.total_ttc, 'FM999999990.00'), to_char(v_deja, 'FM999999990.00')
        USING errcode = 'P0001';
    END IF;
    -- quantités retournées par ligne d'origine (produits) <= quantité achetée
    FOR r IN
      SELECT (e->>'retourIdx') AS idx, sum(coalesce(nullif(e->>'retourQty', '')::numeric, 0)) AS q
        FROM (SELECT jsonb_array_elements(v_items) e
              UNION ALL
              SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(to_jsonb(t.items)) = 'array' THEN to_jsonb(t.items) ELSE '[]'::jsonb END)
                FROM public.tickets t
               WHERE t.salon_id = NEW.salon_id AND t.raw_data->>'isRetour' = 'true'
                 AND t.raw_data->>'retourRefId' = ANY (v_refs) AND coalesce(t.status, '') <> 'cancelled'
                 AND coalesce(t.raw_data->>'id', '') <> v_new_id) x
       WHERE coalesce(e->>'isRetour', '') = 'true' AND (e->>'retourIdx') ~ '^\d+$'
       GROUP BY (e->>'retourIdx')
    LOOP
      IF r.q > 0 AND (r.idx::int >= jsonb_array_length(v_orig_its)
          OR r.q > coalesce(nullif(v_orig_its->(r.idx::int)->>'qty', '')::numeric, 1)) THEN
        RAISE EXCEPTION 'LX_RETOUR_REFUSE : quantité retournée (%) supérieure à la quantité achetée sur la ligne % du ticket n°%', r.q, r.idx, o.num USING errcode = 'P0001';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;

  -- ------------------------------------------------------------------ B) CONTRE-TICKET D'ANNULATION (avoir total)
  IF coalesce(NEW.raw_data->>'isCancel', '') = 'true' AND nullif(NEW.raw_data->>'cancelRef', '') IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(NEW.salon_id::text));
    v_cref := NEW.raw_data->>'cancelRef';
    v_cnu  := regexp_replace(v_cref, '^online_', '');
    -- 2026-10-17 retour partiel (audit) : deux recherches indexées (identifiant / n° imprimé) au lieu d'un OR sur toute la table
    FOR v_cible IN
      SELECT t.num, t.raw_data->>'id' AS rid, coalesce(t.raw_data->>'isRetour', '') AS est_retour
        FROM public.tickets t
       WHERE t.salon_id = NEW.salon_id AND t.raw_data->>'id' = ANY (ARRAY[v_cnu, 'online_' || v_cnu])
      UNION
      SELECT t.num, t.raw_data->>'id', coalesce(t.raw_data->>'isRetour', '')
        FROM public.tickets t
       WHERE t.salon_id = NEW.salon_id AND t.raw_data->>'tkNum' = v_cref
    LOOP
      IF v_cible.est_retour = 'true' THEN
        RAISE EXCEPTION 'LX_RETOUR_REFUSE : un ticket de retour (n°%) ne peut pas être annulé', v_cible.num USING errcode = 'P0001';
      END IF;
      IF EXISTS (SELECT 1 FROM public.tickets t2
                  WHERE t2.salon_id = NEW.salon_id AND t2.raw_data->>'isRetour' = 'true'
                    AND t2.raw_data->>'retourRefId' = ANY (ARRAY[regexp_replace(coalesce(v_cible.rid, '#'), '^online_', ''), 'online_' || regexp_replace(coalesce(v_cible.rid, '#'), '^online_', '')])
                    AND coalesce(t2.status, '') <> 'cancelled') THEN
        RAISE EXCEPTION 'LX_RETOUR_REFUSE : le ticket n°% a déjà un retour partiel : avoir total impossible (rembourser le reste par un retour partiel)', v_cible.num USING errcode = 'P0001';
      END IF;
    END LOOP;
  END IF;
  RETURN NEW;
END
$function$;

COMMENT ON FUNCTION lx_prive.tickets_retour_controle() IS
  'NF525 2026-10-17 : contrôle avant insertion des tickets de retour / remboursement partiel (cumul <= payé, quantités, lignes = total, ticket d''origine valide et de même n°, même mode de caisse, motif) et refus d''un avoir total sur un ticket déjà remboursé en partie ou sur un ticket de retour. Lecture seule, refus LX_RETOUR_REFUSE.';
REVOKE ALL ON FUNCTION lx_prive.tickets_retour_controle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS a_lx_tickets_retour_controle ON public.tickets;
CREATE TRIGGER a_lx_tickets_retour_controle
  BEFORE INSERT ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION lx_prive.tickets_retour_controle();

-- index de lecture : retours d'un ticket d'origine (contrôle ci-dessus et relecture par l'application)
CREATE INDEX IF NOT EXISTS tickets_retour_ref_idx
  ON public.tickets (salon_id, (raw_data->>'retourRefId'))
  WHERE raw_data->>'isRetour' = 'true';
-- 2026-10-17 retour partiel (audit) : n° imprimé (avoir visant un n°) et contre-tickets par référence (contrôle du retour)
CREATE INDEX IF NOT EXISTS tickets_tknum_idx
  ON public.tickets (salon_id, (raw_data->>'tkNum'));
CREATE INDEX IF NOT EXISTS tickets_cancel_ref_idx
  ON public.tickets (salon_id, (raw_data->>'cancelRef'))
  WHERE raw_data->>'isCancel' = 'true';

-- -----------------------------------------------------------------------------------------------------
-- 3) 2026-10-17 retour partiel (audit) : JET — TICKET_RETOUR_PARTIEL reporté au journal des événements (code 190).
--    Remplacement gardé dans la définition RÉELLE (pg_get_functiondef) : sans effet si déjà fait ; erreur si le texte attendu a changé.
-- -----------------------------------------------------------------------------------------------------
DO $do$
DECLARE d text; a text := $a$when p_action in ('TICKET_ANNULATION','AVOIR_TICKET') then 190$a$;
             b text := $b$when p_action in ('TICKET_ANNULATION','AVOIR_TICKET','TICKET_RETOUR_PARTIEL') then 190$b$;
BEGIN
  d := pg_get_functiondef('public.nf525_jet_code(text)'::regprocedure);
  IF position(b in d) > 0 THEN RAISE NOTICE 'nf525_jet_code : déjà à jour'; RETURN; END IF;
  IF (length(d) - length(replace(d, a, ''))) / length(a) <> 1 THEN
    RAISE EXCEPTION 'nf525_jet_code : texte attendu introuvable (définition modifiée depuis le 17/10/2026) — relire avant d''appliquer';
  END IF;
  EXECUTE replace(d, a, b);
END
$do$;

-- -----------------------------------------------------------------------------------------------------
-- 4) 2026-10-17 retour partiel (audit) : check_fiscal_integrity, règle 5 (ANNULATION_SANS_CONTRE_TICKET). Remplacements gardés.
-- -----------------------------------------------------------------------------------------------------
DO $do$
DECLARE d text;
  a1 text := $a$AND COALESCE(a.prix,0) <> 0$a$;
  b1 text := $b$AND COALESCE(a.prix,0) > 0 /* 2026-10-17 retour partiel : un montant négatif annulé n'est jamais un CA surévalué */$b$;
  a2 text := $a$AND ABS(t.total_ttc + a.prix) < 0.005$a$;
  b2 text := $b$AND ABS(t.total_ttc + a.prix) < 0.005
          AND COALESCE(t.raw_data->>'isRetour','') <> 'true' /* 2026-10-17 retour partiel : un ticket de retour n'est pas un contre-ticket */$b$;
BEGIN
  d := pg_get_functiondef('public.check_fiscal_integrity()'::regprocedure);
  IF position('2026-10-17 retour partiel' in d) > 0 THEN RAISE NOTICE 'check_fiscal_integrity : déjà à jour'; RETURN; END IF;
  IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 OR (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN
    RAISE EXCEPTION 'check_fiscal_integrity : texte attendu introuvable (définition modifiée depuis le 17/10/2026) — relire avant d''appliquer';
  END IF;
  EXECUTE replace(replace(d, a1, b1), a2, b2);
END
$do$;

COMMIT;

-- =====================================================================================================
-- CONTRÔLES (lecture seule) — à exécuter AVANT puis APRÈS application, et après les essais en caisse TEST
-- =====================================================================================================
-- 0) Avant application : aucun ticket existant ne porte le marqueur (attendu : 0 ; relevé le 17/10/2026 : 0 sur 792)
-- select count(*) from public.tickets where raw_data->>'isRetour' = 'true' or raw_data ? 'retourRefId';
--
-- 1) Déclencheur installé (attendu : 1 ligne, tgenabled = 'O') et index
-- select tgname, tgenabled from pg_trigger where tgrelid = 'public.tickets'::regclass and tgname = 'a_lx_tickets_retour_controle';
-- select indexname from pg_indexes where tablename = 'tickets' and indexname in ('tickets_retour_ref_idx','tickets_tknum_idx','tickets_cancel_ref_idx');
--
-- 2) Ordre des déclencheurs BEFORE INSERT sur tickets (le contrôle ne modifie pas NEW : l'ordre n'a pas d'effet sur les données)
-- select tgname from pg_trigger where tgrelid = 'public.tickets'::regclass and not tgisinternal order by tgname;
--
-- 3) JET et contrôle fiscal adaptés (attendu : 190 / 190 ; 1)
-- select public.nf525_jet_code('TICKET_RETOUR_PARTIEL'), public.nf525_jet_code('TICKET_ANNULATION');
-- select position('2026-10-17 retour partiel' in pg_get_functiondef('public.check_fiscal_integrity()'::regprocedure)) > 0;
--
-- 4) Après un essai (Salon de test) : retours et cumul par ticket d'origine
-- select o.num as origine, o.total_ttc, coalesce(sum(-r.total_ttc),0) as rembourse
--   from public.tickets o left join public.tickets r
--     on r.salon_id = o.salon_id and r.raw_data->>'isRetour'='true' and r.raw_data->>'retourRefId' = o.raw_data->>'id'
--  where o.salon_id = '<salon>' and exists (select 1 from public.tickets x where x.salon_id=o.salon_id and x.raw_data->>'retourRefId'=o.raw_data->>'id')
--  group by o.num, o.total_ttc;   -- attendu : rembourse <= total_ttc
--
-- 5) Le ticket de retour est scellé et signé comme les autres (hash, hash_prev, sceau, signature TK de type R)
-- select t.num, t.total_ttc, t.hash is not null as hash, t.hash_prev, s.signature is not null as signe
--   from public.tickets t left join public.nf525_signatures s on s.source_table='tickets' and s.source_id=t.id
--  where t.salon_id = '<salon>' and t.raw_data->>'isRetour'='true';
--
-- 6) La Z du jour du retour est égale au journal (attendu : 0 ligne d'écart)
-- select * from public.check_fiscal_integrity() where salon_id = '<salon>';
-- select * from public.check_data_integrity('<salon>');
-- select public.admin_nf525_etat();
--
-- 7) Essais des refus (BEGIN ... ROLLBACK sur le Salon de test) : retour qui dépasse le payé -> refus LX_RETOUR_REFUSE ;
--    NB : un ticket inséré à la main doit porter collaborateur_id ou collaborateur_nom (contrainte tickets_operator_required) ;
--    contre-ticket (isCancel) sur un ticket ayant un retour -> refus ; retour exact -> accepté. Fait le 17/10/2026 sur le
--    « Salon Démo » (fermé, sans ticket) en transaction annulée (script complet + 16 cas) : voir le registre.
--
-- RETOUR ARRIÈRE (si nécessaire, sans effet sur les données ; les adaptations 3) et 4) se défont par le remplacement inverse,
-- même méthode : pg_get_functiondef puis replace(b, a)) :
-- BEGIN; DROP TRIGGER IF EXISTS a_lx_tickets_retour_controle ON public.tickets; DROP FUNCTION IF EXISTS lx_prive.tickets_retour_controle(); COMMIT;
