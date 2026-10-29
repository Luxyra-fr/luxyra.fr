-- =====================================================================================================================
-- 2026-10-28 (-8) — LOT 4 DE L'AUDIT INDÉPENDANT : PROTECTIONS DES DONNÉES FISCALES APRÈS ENREGISTREMENT
-- Luxyra 6.8.6 (version MINEURE) — NON APPLIQUÉ. À passer par Alexandre dans l'éditeur SQL du tableau de bord Supabase, dans
-- l'ordre de déploiement du registre NF525 (intervention -8 du 28/10/2026). Idempotent (create or replace, drop trigger if exists,
-- create table if not exists) ; garde de tête : arrêt si une fonction remplacée diffère de la version relue en production.
--
-- SOURCES : CGI art. 286, I-3° bis ; BOI-TVA-DECLA-30-10-30 (version du 25/03/2026) § 80 à 120 (inaltérabilité : « les données
-- d'origine ne peuvent être modifiées » ; toute correction = opération nouvelle, en plus ou en moins), § 130 à 150 (sécurisation),
-- § 170 à 210 (conservation des données élémentaires et récapitulatives) ; CGI art. 256 ter et BOI-TVA-CHAMP-10-10-40-50 § 90
-- (solde non utilisé d'un bon à usage multiple) ; CGI art. 289 et ann. II art. 242 nonies A (factures) ; C. com. art. L123-22
-- (conservation 10 ans des pièces comptables), LPF art. L102 B (6 ans).
--
-- CE QUE FAIT CE FICHIER (AUCUNE LIGNE EXISTANTE MODIFIÉE : tickets, Z, clôtures, signatures, JET, bons intacts ; aucun format
-- d'empreinte modifié ; les contrôles nouveaux ne s'appliquent qu'aux écritures FUTURES) :
--  §1  tickets — colonnes figées après l'enregistrement (constat M4). Le propriétaire pouvait encore modifier status, notes,
--      locked (true -> false), cloture_id, cancelled_at, cancel_reason, client_nom, collaborateur_nom, parent_ticket_id, is_avoir…
--      (RLS tickets_tenant_update ; les déclencheurs existants ne bloquent que les montants des tickets « paid » / verrouillés).
--      Un ticket passé en « cancelled » sortait du journal de la Z (tous les contrôles excluent status = 'cancelled') et le FEC
--      ne gardait que son écriture d'annulation. Désormais (déclencheur a_lx_tickets_colonnes_figees, tous rôles) :
--        * toute colonne est figée, sauf : locked (false -> true seulement, et seulement si une clôture Z de cette journée existe),
--          cloture_id (vide -> identifiant d'une Z de CETTE journée et de CET établissement, une seule fois), updated_at ;
--        * cancelled_at / cancel_reason : posés UNE fois, et seulement par la fonction serveur d'annulation (creer_ticket_avoir)
--          dans la transaction qui crée le contre-ticket ;
--        * status : JAMAIS modifié. L'annulation est un NOUVEAU ticket (contre-ticket négatif, numéro suivant) ; le ticket d'origine
--          reste au journal (« paid »), la paire s'annule au centime (même modèle que l'application depuis le 09/07/2026) ;
--        * seul contournement : luxyra.allow_nf525_unlock = 'true' (existant), tracé dans audit_log.
--      À l'insertion (a_lx_tickets_0_statut) : status normalisé à 'paid' (une version de l'application pouvait transmettre plus
--      tard, avec status 'cancelled', un ticket annulé hors connexion : il sortait du journal alors que son contre-ticket y était,
--      ce qui faussait la Z) ; cancelled_at / cancel_reason / is_avoir / parent_ticket_id ne sont acceptés que du serveur.
--      creer_ticket_avoir (fonction serveur, non utilisée par l'application) : ne passe plus le ticket d'origine en « cancelled »
--      (sinon double déduction : origine exclue du journal ET contre-ticket compté) ; contre-ticket numéroté par la base, lignes
--      et règlements en négatif, marques d'annulation dans raw_data (isCancel, cancelRef, contraSameDay).
--  §2  bons cadeaux (constat M10) : garde des colonnes fiscales (montant, code, périmètre, qualification, HT/TVA, n° de ticket de
--      vente, date d'expiration : prolongation seulement), solde / utilisé / statut / historique modifiables seulement par une
--      utilisation tracée (entrée d'historique du même montant), une annulation (solde à 0) ou le serveur ; SUPPRESSION INTERDITE
--      (sauf déverrouillage tracé — réinitialisation d'essai, suppression d'un établissement — ou bon en ligne jamais payé) ;
--      JOURNAL DES MOUVEMENTS SCELLÉ (public.cartes_cadeaux_mouvements : chaque création / utilisation / recrédit / annulation /
--      expiration / prolongation / suppression, chaîné SHA-256, inaltérable) ; état fiscal DÉRIVÉ DES TICKETS SCELLÉS
--      (public.lx_bons_etat : vente et utilisations relues dans le journal des tickets, jamais dans le solde du bon).
--  §3  arrondis à l'écriture : montants des clôtures Z (bruit de calcul flottant : 380.79999999999995, cumuls 25728.09999…) et
--      des bons arrondis au centime quand l'écart est un bruit (< 0,000001) — la valeur au centime est celle de l'empreinte
--      (toFixed(2)), rien d'autre ne change ; cumul de tickets du mois / de l'année des Z suivant une Z annotée (annotation
--      corrective signée) : même ajustement que le CA (déjà fait par le serveur pour les cumuls de CA).
--  §4  Stripe : versements reçus et frais (tables stripe_versements / stripe_versements_lignes, alimentées par le worker à la
--      réception de payout.paid — webhook « comptes connectés » existant) -> rapprochement du compte 580100 dans les exports.
--  §5  factures clients (CGI art. 289 ; ann. II art. 242 nonies A) : public.lx_facture_emettre — facture (ou facture d'avoir)
--      établie À PARTIR D'UN TICKET SCELLÉ, numérotation continue par établissement, données recopiées du ticket (aucune nouvelle
--      recette), lignes calculées par la base (remise globale = ligne « Remise » par taux), empreinte chaînée ; table
--      factures_clients déjà inaltérable (déclencheur existant). AUCUNE facture en caisse de TEST (fonction + déclencheur) ;
--      ancienne fonction generer_facture_client retirée ; mentions du vendeur (n° de TVA, RCS, capital) exigées.
-- Révision du 29/10/2026 (contre-audit NO GO) : §5 réécrit (voir son en-tête), creer_ticket_avoir reprend les règlements par bon
-- à usage multiple en négatif, consommer_bon_cadeau / recrediter_bon_cadeau : montant au centime. Version jamais appliquée en
-- production : la garde n'accepte que les md5 de production et ceux de CETTE révision.
--
-- RETOUR ARRIÈRE : docs/migrations_1028_lot4/lot4_protections_retour_arriere.sql (suppression des contrôles et fonctions, définition
-- de PRODUCTION de creer_ticket_avoir à l'identique). Les tables créées (journal des bons, versements Stripe, colonnes des factures)
-- et leurs lignes sont CONSERVÉES (pièces justificatives : ne jamais les supprimer).
-- =====================================================================================================================

-- ===================================================================================================================== §0
-- Garde : md5(pg_get_functiondef(oid)) relevé en PRODUCTION le 28/10/2026 (lecture seule, connecteur Supabase) OU empreinte de la
-- définition posée par CE fichier (seconde exécution). Toute autre valeur arrête le script.
do $$
declare
  v_attendu constant jsonb := jsonb_build_object(
    -- fonctions REMPLACÉES : md5 de production OU md5 posé par ce fichier (seconde exécution)
    'public.creer_ticket_avoir(uuid,text)',          jsonb_build_array('cf9b3c1e00e45e84f5e40d48fd41f64a', 'a4b3134a35a4799a4df2a56dd9a2879c'),
    'public.consommer_bon_cadeau(uuid,numeric,text)', jsonb_build_array('5362a2575acb47ad41b79b6e5b99a75a', 'd887fdccfcdbfcc0c88df8ab308bccad'),
    'public.recrediter_bon_cadeau(uuid,numeric,text,text)', jsonb_build_array('901a4d8b3ef76ea13683cae00d8d32ca', 'b785b85e4a80c414e0cb676283a4b01b'),
    'public.generer_facture_client(uuid,text,text,text,text,text,text,text,text,text)', jsonb_build_array('d2e41194b825d224acd2a979a55665ab', '25e27c4d8076f82e1e556b8d709cb527'),
    -- fonctions lues (non remplacées) dont le comportement est supposé par ce fichier
    'public.ticket_nf525_update()',                  jsonb_build_array('2efe40f4b0fa84256af05674f52c0d2f'),
    'public.tickets_nf525_protect()',                jsonb_build_array('91f7a2c1fa04b784fba7224f18bbf779'),
    'lx_prive.tickets_raw_data_fige()',              jsonb_build_array('9273bd3dea161baf7041eaf385c0f5ea'),
    'lx_prive.garde_paiements_cartes_cadeaux()',     jsonb_build_array('3420d7d3c3376546b9bab1d9b259d3f3'),
    'public.clotures_set_cumul_perpetuel()',         jsonb_build_array('f2a2530f3a8ad1824381d0dd7003f981'),
    'lx_prive.clotures_controle_journal()',          jsonb_build_array('f60dd43a409593d75f31f229ae4e0994'),
    'public.factures_clients_inalterable()',         jsonb_build_array('34ecf21db5aa72638064719a04428a47'));
  k text; v_md5 text;
begin
  for k in select jsonb_object_keys(v_attendu) loop
    if to_regprocedure(k) is null then raise exception 'Garde lot 4 (28/10/2026) : fonction % absente en base — relire avant d''appliquer', k; end if;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(k)));
    if not (v_attendu->k) ? v_md5 then
      raise exception 'Garde lot 4 (28/10/2026) : % différente de la version relue en production (md5 %, attendu %) — relire avant d''appliquer', k, v_md5, v_attendu->k;
    end if;
  end loop;
  if to_regprocedure('lx_prive.appel_serveur()') is null or to_regprocedure('public.is_admin()') is null
     or to_regprocedure('lx_prive.garde_signaler(text,uuid,text[])') is null or to_regprocedure('lx_prive.tva_ticket_lignes(jsonb,numeric,numeric,numeric,jsonb,numeric,jsonb)') is null then
    raise exception 'Garde lot 4 (28/10/2026) : appel_serveur / is_admin / garde_signaler / tva_ticket_lignes absentes (appliquer d''abord recettes_en_ligne.sql et tva_unique.sql)';
  end if;
  if to_regclass('public.factures_clients') is null or to_regclass('public.cartes_cadeaux') is null or to_regclass('public.clotures_annotations') is null then
    raise exception 'Garde lot 4 (28/10/2026) : tables factures_clients / cartes_cadeaux / clotures_annotations absentes';
  end if;
end $$;

-- ===================================================================================================================== §1
-- TICKETS : colonnes figées après l'enregistrement.
-- Écritures LÉGITIMES relevées le 28/10/2026 (app.html, luxyra-supabase.js, lx-cloture-auto v3.5, fonctions de la base) :
--   * verrouillage par la clôture : UPDATE tickets SET locked = true, cloture_id = <Z> WHERE date_ticket = <jour de la Z>
--     (lockTicketsForCloture de l'application, juste après l'enregistrement de la Z ; lx-cloture-auto après son insertion) ;
--   * annulation par la fonction serveur creer_ticket_avoir (cancelled_at, cancel_reason du ticket d'origine) ;
--   * fusion de fiches clients (merge_client_duplicates : client_id) — déjà refusée par tickets_nf525_protect pour tout ticket
--     encaissé, inchangé ;
--   * réinitialisation d'essai / suppression d'un établissement : déverrouillage tracé (luxyra.allow_nf525_unlock), inchangé.
-- L'application n'écrit JAMAIS status, notes, cancelled_at ni cancel_reason d'un ticket existant (cancelTicketDb n'a aucun appel).
create or replace function lx_prive.tickets_colonnes_figees()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_bypass text; v_cols text[]; v_ok boolean;
  -- colonnes dont la modification est encadrée ci-dessous ; raw_data : déclencheur a_lx_tickets_raw_data_fige (lot 3)
  c_encadrees constant text[] := array['locked','cloture_id','cancelled_at','cancel_reason','updated_at','raw_data'];
begin
  begin v_bypass := current_setting('luxyra.allow_nf525_unlock', true); exception when others then v_bypass := null; end;
  select coalesce(array_agg(o.key order by o.key), '{}') into v_cols
    from jsonb_each(to_jsonb(OLD)) o
   where o.key <> all (c_encadrees) and (to_jsonb(NEW) -> o.key) is distinct from o.value;
  -- verrouillage : false -> true seulement, quand une Z de la journée du ticket existe pour cet établissement
  if NEW.locked is distinct from OLD.locked then
    if coalesce(OLD.locked, false) = true or coalesce(NEW.locked, false) = false then
      v_cols := v_cols || 'locked (déverrouillage)'::text;
    elsif not exists (select 1 from public.clotures z where z.salon_id = OLD.salon_id and z.date_cloture = OLD.date_ticket) then
      v_cols := v_cols || 'locked (aucune clôture Z de cette journée)'::text;
    end if;
  end if;
  -- rattachement à la Z : une seule fois, vers une Z de CETTE journée et de CET établissement
  if NEW.cloture_id is distinct from OLD.cloture_id then
    if OLD.cloture_id is not null or NEW.cloture_id is null
       or not exists (select 1 from public.clotures z where z.id = NEW.cloture_id and z.salon_id = OLD.salon_id and z.date_cloture = OLD.date_ticket) then
      v_cols := v_cols || 'cloture_id'::text;
    end if;
  end if;
  -- marques d'annulation : une fois, par la fonction serveur d'annulation, dans la transaction qui crée le contre-ticket
  if NEW.cancelled_at is distinct from OLD.cancelled_at or NEW.cancel_reason is distinct from OLD.cancel_reason then
    v_ok := OLD.cancelled_at is null and OLD.cancel_reason is null and NEW.cancelled_at is not null
      and coalesce(current_setting('lx.annulation_ticket', true), '') = OLD.id::text
      and exists (select 1 from public.tickets a where a.parent_ticket_id = OLD.id and a.is_avoir = true and a.salon_id = OLD.salon_id
                    and a.created_at = now() and a.total_ttc = -OLD.total_ttc);
    if not v_ok then v_cols := v_cols || 'cancelled_at / cancel_reason'::text; end if;
  end if;
  if coalesce(array_length(v_cols, 1), 0) = 0 then return NEW; end if;
  if v_bypass = 'true' then
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (OLD.salon_id, 'NF525_INALTERABILITE_BYPASSEE', left('UPDATE tickets n°' || coalesce(OLD.num::text, '?') || ' (id ' || OLD.id || ') colonnes : ' || array_to_string(v_cols, ', ') || ' user=' || current_user, 1900), 'BYPASS_EXPLICITE');
    return NEW;
  end if;
  raise exception 'LX_TICKET_COLONNES_FIGEES : ticket n°% — % ne peu(ven)t pas être modifié(es) après l''enregistrement du ticket. Pour annuler un ticket : contre-ticket (bouton « Annuler » de l''application).',
    coalesce(OLD.num::text, '?'), left(array_to_string(v_cols, ', '), 300) using errcode = 'P0001';
end $$;
drop trigger if exists a_lx_tickets_colonnes_figees on public.tickets;
create trigger a_lx_tickets_colonnes_figees before update on public.tickets for each row execute function lx_prive.tickets_colonnes_figees();

-- À l'insertion : un ticket entre au journal comme ticket ENCAISSÉ ('paid'). Le statut 'cancelled' transmis par une version de
-- l'application pour un ticket annulé hors connexion (son contre-ticket est un ticket à part) est normalisé et tracé.
-- Exécuté le PREMIER des déclencheurs d'insertion (nom « a_lx_tickets_0… » < « a_lx_tickets_a_version »).
create or replace function lx_prive.tickets_statut_insertion()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[] := '{}';
begin
  if coalesce(NEW.status, 'paid') <> 'paid' then v := v || ('status ' || NEW.status); NEW.status := 'paid'; end if;
  if not lx_prive.appel_serveur() and coalesce(current_setting('lx.annulation_ticket', true), '') = '' then
    if NEW.cancelled_at is not null or NEW.cancel_reason is not null then v := v || 'cancelled_at / cancel_reason'::text; NEW.cancelled_at := null; NEW.cancel_reason := null; end if;
    if coalesce(NEW.is_avoir, false) or NEW.parent_ticket_id is not null then v := v || 'is_avoir / parent_ticket_id'::text; NEW.is_avoir := false; NEW.parent_ticket_id := null; end if;
    if NEW.locked = true or NEW.cloture_id is not null then v := v || 'locked / cloture_id'::text; NEW.locked := false; NEW.cloture_id := null; end if;
  end if;
  if coalesce(array_length(v, 1), 0) > 0 then
    begin
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (NEW.salon_id, 'TICKET_ENREGISTRE_NORMALISE', left('Ticket n°' || coalesce(NEW.raw_data->>'tkNum', '?') || ' (id ' || coalesce(NEW.raw_data->>'id', '?') ||
        ') enregistré comme ticket encaissé : ' || array_to_string(v, ', ') || ' non repris (une annulation est un contre-ticket distinct).', 1900), 'Luxyra (contrôle)');
    exception when others then null; end;
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_tickets_0_statut on public.tickets;
create trigger a_lx_tickets_0_statut before insert on public.tickets for each row execute function lx_prive.tickets_statut_insertion();

-- creer_ticket_avoir : fonction SERVEUR d'annulation (non appelée par l'application, qui crée elle-même son contre-ticket).
-- Production (md5 cf9b3c1e…) : origine passée en 'cancelled' -> sortie du journal ET contre-ticket négatif compté (double
-- déduction dans la Z, le FEC en « annulation seule ») ; n° = max + 1 calculé hors verrou. Désormais : contre-ticket numéroté par
-- la base (ticket_nf525_insert, sous verrou), lignes et règlements en négatif, raw_data {isCancel, cancelRef, contraSameDay} (paire
-- reconnue par la Z / lx_prive.z_journal_tickets) ; l'origine reste 'paid' ; ses cancelled_at / cancel_reason sont posés dans la
-- MÊME transaction (seul chemin autorisé par §1).
create or replace function public.creer_ticket_avoir(p_ticket_origine_id uuid, p_motif text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  v_user_id uuid; v_role text; o tickets%rowtype; v_avoir_id uuid; v_avoir_num int; v_now timestamptz := now();
  v_collab_nom text; v_jour date := (now() at time zone 'Europe/Paris')::date; v_items jsonb; v_det jsonb; v_ref text;
  v_bons jsonb; b jsonb; v_rc jsonb;
begin
  v_user_id := auth.uid();
  begin v_role := auth.role(); exception when others then v_role := null; end;
  if v_user_id is null and coalesce(v_role, 'anon') <> 'service_role' then
    raise exception 'Authentification requise : la création d''un ticket d''avoir est interdite en accès anonyme.';
  end if;
  select * into o from tickets where id = p_ticket_origine_id for update;
  if o.id is null then raise exception 'Ticket origine introuvable : %', p_ticket_origine_id; end if;
  if v_user_id is not null and not exists (select 1 from salons where id = o.salon_id and user_id = v_user_id) and not is_admin() then
    raise exception 'Vous ne gérez pas ce salon';
  end if;
  if exists (select 1 from tickets where parent_ticket_id = p_ticket_origine_id and is_avoir = true) or o.cancelled_at is not null then
    raise exception 'Un avoir existe déjà pour ce ticket';
  end if;
  if exists (select 1 from tickets t where t.salon_id = o.salon_id and coalesce(t.raw_data->>'isCancel', '') = 'true'
               and (t.raw_data->>'cancelRef') in (coalesce(o.raw_data->>'tkNum', '#'), coalesce(o.raw_data->>'id', '#'), o.num::text)) then
    raise exception 'Ce ticket a déjà un contre-ticket d''annulation';
  end if;
  if o.status <> 'paid' or coalesce(o.total_ttc, 0) <= 0 or coalesce(o.is_avoir, false) or coalesce(o.raw_data->>'isCancel', '') = 'true' then
    raise exception 'Seul un ticket de vente encaissé (montant positif) peut être annulé.';
  end if;
  if p_motif is null or length(trim(p_motif)) < 3 then raise exception 'Motif d''annulation obligatoire (min 3 caractères)'; end if;
  v_collab_nom := o.collaborateur_nom;
  if v_collab_nom is null and o.collaborateur_id is not null then select nom into v_collab_nom from collaborateurs where id = o.collaborateur_id; end if;
  v_ref := coalesce(o.raw_data->>'tkNum', o.num::text);
  select coalesce(jsonb_agg(case when jsonb_typeof(e) = 'object' and lx_prive.tva_num(e->'price') is not null
                              then e || jsonb_build_object('price', -lx_prive.tva_num(e->'price')) else e end), '[]'::jsonb)
    into v_items from jsonb_array_elements(case when jsonb_typeof(o.items) = 'array' then o.items else '[]'::jsonb end) e;
  select coalesce(jsonb_object_agg(d.key, case when jsonb_typeof(d.value) = 'number' then to_jsonb(-(d.value #>> '{}')::numeric) else d.value end), '{}'::jsonb)
    into v_det from jsonb_each(case when jsonb_typeof(o.detail_paiement) = 'object' then o.detail_paiement else '{}'::jsonb end) d;
  -- 2026-10-29 (contre-audit) : règlements de l'origine par bon à usage multiple repris EN NÉGATIF sur le contre-ticket (même
  -- modèle que l'application : entrée bonsUtil BUM négative) -> l'utilisation du bon est annulée dans lx_bons_etat (journal des
  -- tickets) ; le solde du bon est recrédité par recrediter_bon_cadeau (utilisation tracée, journal des bons).
  select coalesce(jsonb_agg(jsonb_build_object('id', u->'id', 'code', u->'code', 'usage', 'BUM', 'scope', u->'scope',
                                               'montant', -round(lx_prive.tva_num(u->'montant'), 2))), '[]'::jsonb)
    into v_bons from jsonb_array_elements(case when jsonb_typeof(o.raw_data->'bonsUtil') = 'array' then o.raw_data->'bonsUtil' else '[]'::jsonb end) u
   where jsonb_typeof(u) = 'object' and u->>'usage' = 'BUM' and coalesce(lx_prive.tva_num(u->'montant'), 0) <> 0;
  perform set_config('lx.annulation_ticket', p_ticket_origine_id::text, true);  -- contre-ticket accepté par a_lx_tickets_0_statut (is_avoir, parent)
  insert into tickets (salon_id, num, date_ticket, heure_ticket, ts_created, client_id, client_nom, client_prenom, collaborateur_id, collaborateur_nom,
                       items, total_brut, total_remise, total_ttc, total_ht, total_tva, taux_tva, mode_paiement, detail_paiement, status,
                       parent_ticket_id, is_avoir, raw_data)
  values (o.salon_id, null, v_jour, (now() at time zone 'Europe/Paris')::time, v_now, o.client_id, o.client_nom, o.client_prenom, o.collaborateur_id, coalesce(v_collab_nom, 'Serveur'),
          v_items, -coalesce(o.total_brut, 0), -coalesce(o.total_remise, 0), -o.total_ttc, -o.total_ht, -o.total_tva, o.taux_tva, o.mode_paiement, v_det, 'paid',
          p_ticket_origine_id, true,
          jsonb_build_object('id', gen_random_uuid()::text, 'isCancel', true, 'cancelRef', v_ref, 'cancelMotif', left(p_motif, 200),
                             'contraSameDay', (o.date_ticket = v_jour), 'origine', 'creer_ticket_avoir', 'lxVersion', '6.8.6')
          || case when jsonb_array_length(v_bons) > 0 then jsonb_build_object('bonsUtil', v_bons) else '{}'::jsonb end)
  returning id, num into v_avoir_id, v_avoir_num;
  for b in select x from jsonb_array_elements(v_bons) x loop
    v_rc := null;
    if coalesce(b->>'id', '') ~ '^[0-9a-fA-F-]{36}$' then
      v_rc := public.recrediter_bon_cadeau((b->>'id')::uuid, -lx_prive.tva_num(b->'montant'), v_avoir_num::text, 'Annulation du ticket n° ' || v_ref);
    end if;
    if v_rc is null or coalesce(v_rc->>'ok', '') <> 'true' then
      insert into audit_log (salon_id, action, details, operator_name)
      values (o.salon_id, 'BON_RECREDIT_A_FAIRE', 'Contre-ticket n° ' || v_avoir_num || ' : bon ' || coalesce(b->>'code', b->>'id', '?') || ' à recréditer de ' ||
              to_char(-lx_prive.tva_num(b->'montant'), 'FM9999999.00') || ' EUR (' || coalesce(v_rc->>'erreur', 'bon introuvable') || ')', 'creer_ticket_avoir');
    end if;
  end loop;
  update tickets set cancelled_at = v_now, cancel_reason = left(p_motif, 500) where id = p_ticket_origine_id;
  perform set_config('lx.annulation_ticket', '', true);
  insert into audit_log (salon_id, action, details, operator_name)
  values (o.salon_id, 'TICKET_AVOIR_CREE', 'Ticket #' || v_ref || ' (n° ' || o.num || ') annulé par contre-ticket n° ' || v_avoir_num ||
          ' (montant -' || to_char(o.total_ttc, 'FM9999999.99') || ' EUR). Motif: ' || left(p_motif, 200), 'creer_ticket_avoir');
  return jsonb_build_object('ok', true, 'avoir_id', v_avoir_id, 'avoir_num', v_avoir_num, 'origine_id', p_ticket_origine_id,
                            'origine_num', o.num, 'montant_avoir', -o.total_ttc);
end $$;

-- ===================================================================================================================== §2
-- BONS CADEAUX : journal des mouvements scellé, garde des colonnes fiscales, suppression interdite, état dérivé des tickets.
create table if not exists public.cartes_cadeaux_mouvements (
  id bigserial primary key,
  salon_id uuid not null,
  seq integer not null,
  bon_id uuid not null,
  code text,
  at timestamptz not null default clock_timestamp(),
  nature text not null,           -- creation | utilisation | recredit | annulation | expiration | prolongation | paiement | lien_ticket | suppression | autre
  avant jsonb,                    -- colonnes fiscales AVANT (valeur, utilise, restant, status, date_expiration, tk_num, usage_tva, payment_status)
  apres jsonb,                    -- colonnes fiscales APRÈS (aucune donnée personnelle : ni acheteur, ni bénéficiaire, ni message)
  ticket text,                    -- n° de ticket de la dernière entrée d'historique, s'il y en a une
  role text,                      -- rôle de l'appel (authenticated = application, service_role = serveur, postgres = tâche / administration)
  hash_prev text,
  hash text not null,
  unique (salon_id, seq)
);
comment on table public.cartes_cadeaux_mouvements is 'Journal SCELLÉ des mouvements des bons cadeaux (2026-10-28, Luxyra 6.8.6, constat M10 de l''audit) : rempli par déclencheur, chaîné SHA-256 par établissement, inaltérable. Ne contient aucune donnée personnelle.';
create index if not exists cartes_cadeaux_mouvements_bon on public.cartes_cadeaux_mouvements (bon_id, seq);
alter table public.cartes_cadeaux_mouvements enable row level security;
drop policy if exists cartes_cadeaux_mouvements_select on public.cartes_cadeaux_mouvements;
create policy cartes_cadeaux_mouvements_select on public.cartes_cadeaux_mouvements for select to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()) or public.is_admin());
revoke all on public.cartes_cadeaux_mouvements from anon, authenticated;
grant select on public.cartes_cadeaux_mouvements to authenticated;
grant select, insert, update, delete on public.cartes_cadeaux_mouvements to service_role;
revoke all on sequence public.cartes_cadeaux_mouvements_id_seq from anon, authenticated;
grant usage on sequence public.cartes_cadeaux_mouvements_id_seq to service_role;

create or replace function lx_prive.bon_fiscal(r public.cartes_cadeaux) returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select jsonb_build_object('valeur', r.valeur, 'utilise', r.utilise, 'restant', r.restant, 'status', r.status, 'date_expiration', r.date_expiration,
                            'tk_num', r.tk_num, 'usage_tva', r.usage_tva, 'is_offert', r.is_offert, 'scope', r.scope, 'payment_status', r.payment_status)
$$;

-- inaltérabilité du journal
create or replace function lx_prive.cartes_cadeaux_mouvements_inalterable()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('luxyra.allow_nf525_unlock', true), '') = 'true' then
    begin insert into public.audit_log (salon_id, action, details, operator_name)
      values (OLD.salon_id, 'NF525_INALTERABILITE_BYPASSEE', left(TG_OP || ' cartes_cadeaux_mouvements seq ' || OLD.seq || ' user=' || current_user, 1900), 'BYPASS_EXPLICITE');
    exception when others then null; end;
    if TG_OP = 'DELETE' then return OLD; end if; return NEW;
  end if;
  raise exception 'LX_BONS_JOURNAL_INALTERABLE : le journal des mouvements des bons cadeaux ne peut être ni modifié ni supprimé.' using errcode = 'P0001';
end $$;
drop trigger if exists cartes_cadeaux_mouvements_inalterable on public.cartes_cadeaux_mouvements;
create trigger cartes_cadeaux_mouvements_inalterable before update or delete on public.cartes_cadeaux_mouvements
  for each row execute function lx_prive.cartes_cadeaux_mouvements_inalterable();

-- écriture d'un mouvement (chaînage par établissement, sous verrou)
create or replace function lx_prive.bon_mouvement_ecrire(p_salon uuid, p_bon uuid, p_code text, p_nature text, p_avant jsonb, p_apres jsonb, p_ticket text)
returns void language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_seq int; v_prev text; v_at timestamptz := clock_timestamp(); v_role text := coalesce((select auth.role()), current_user);
begin
  perform pg_advisory_xact_lock(hashtext('bons_mouvements_' || p_salon::text));
  select seq, hash into v_seq, v_prev from public.cartes_cadeaux_mouvements where salon_id = p_salon order by seq desc limit 1;
  v_seq := coalesce(v_seq, 0) + 1;
  insert into public.cartes_cadeaux_mouvements (salon_id, seq, bon_id, code, at, nature, avant, apres, ticket, role, hash_prev, hash)
  values (p_salon, v_seq, p_bon, p_code, v_at, p_nature, p_avant, p_apres, p_ticket, v_role, coalesce(v_prev, ''),
          encode(extensions.digest('BM|' || v_seq || '|' || p_bon || '|' || coalesce(p_code, '') || '|' || p_nature || '|' || coalesce(p_avant::text, '') || '|' ||
                 coalesce(p_apres::text, '') || '|' || coalesce(p_ticket, '') || '|' || to_char(v_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') || '|' || coalesce(v_prev, ''), 'sha256'), 'hex'));
end $$;

create or replace function lx_prive.cartes_cadeaux_journal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare a jsonb; n jsonb; v_nat text; v_tk text;
begin
  if TG_OP = 'DELETE' then
    -- suppression déverrouillée (réinitialisation d'essai, suppression d'un établissement : archivées et tracées par ces fonctions) :
    -- rien n'est écrit. Ces fonctions NE purgent PAS ce journal : après une réinitialisation d'essai, les mouvements des bons de
    -- l'essai y restent (sans donnée personnelle, chaîne intacte) ; seule la suppression définitive de l'établissement
    -- (admin_delete_salon_cascade, purge par salon_id) les efface. Suppression serveur d'un bon en ligne jamais payé : tracée.
    if coalesce(current_setting('luxyra.allow_nf525_unlock', true), '') <> 'true' then
      perform lx_prive.bon_mouvement_ecrire(OLD.salon_id, OLD.id, OLD.code, 'suppression', lx_prive.bon_fiscal(OLD), null, null);
    end if;
    return OLD;
  end if;
  n := lx_prive.bon_fiscal(NEW);
  if jsonb_typeof(NEW.history) = 'array' and jsonb_array_length(NEW.history) > 0 then v_tk := nullif(NEW.history -> -1 ->> 'tkNum', ''); end if;
  if TG_OP = 'INSERT' then
    perform lx_prive.bon_mouvement_ecrire(NEW.salon_id, NEW.id, NEW.code, 'creation', null, n, NEW.tk_num::text);
    return NEW;
  end if;
  a := lx_prive.bon_fiscal(OLD);
  if a = n then return NEW; end if;
  v_nat := case
    when NEW.status = 'voided' and coalesce(OLD.status, '') <> 'voided' then 'annulation'
    when NEW.status = 'expired' and coalesce(OLD.status, '') <> 'expired' then 'expiration'
    when coalesce(NEW.utilise, 0) > coalesce(OLD.utilise, 0) then 'utilisation'
    when coalesce(NEW.utilise, 0) < coalesce(OLD.utilise, 0) then 'recredit'
    when NEW.payment_status is distinct from OLD.payment_status then 'paiement'
    when NEW.date_expiration is distinct from OLD.date_expiration then 'prolongation'
    when NEW.tk_num is distinct from OLD.tk_num then 'lien_ticket'
    else 'autre' end;
  perform lx_prive.bon_mouvement_ecrire(NEW.salon_id, NEW.id, NEW.code, v_nat, a, n, case when v_nat in ('utilisation','recredit') then v_tk else NEW.tk_num::text end);
  return NEW;
end $$;
drop trigger if exists zzz_lx_cartes_cadeaux_journal on public.cartes_cadeaux;
create trigger zzz_lx_cartes_cadeaux_journal after insert or update or delete on public.cartes_cadeaux
  for each row execute function lx_prive.cartes_cadeaux_journal();

-- garde des colonnes fiscales (même principe que a0_lx_garde_paiements : valeur d'origine REMISE, écriture du reste de la ligne
-- conservée, tentative signalée — l'application enregistre des lignes entières par upsert, un refus casserait l'encaissement).
-- Exécutée après a0_lx_garde_paiements et avant la qualification (a_cartes_cadeaux_qualifier).
create or replace function lx_prive.cartes_cadeaux_garde_fiscale()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[] := '{}'; v_srv boolean := lx_prive.appel_serveur(); v_delta numeric; v_h jsonb; v_hn int; v_ho int; v_util_ok boolean := false;
begin
  -- arrondi au centime à l'écriture (bruit de calcul : HT = valeur / (1 + taux) non arrondi par d'anciennes versions)
  if NEW.valeur is not null then NEW.valeur := round(NEW.valeur, 2); end if;
  if NEW.utilise is not null then NEW.utilise := round(NEW.utilise, 2); end if;
  if NEW.restant is not null then NEW.restant := round(NEW.restant, 2); end if;
  if NEW.ht is not null and NEW.ht <> round(NEW.ht, 2) then
    NEW.ht := round(NEW.ht, 2);
    if NEW.valeur is not null and NEW.tva is not null and abs(NEW.valeur - NEW.ht - NEW.tva) < 0.01 then NEW.tva := NEW.valeur - NEW.ht; end if;
  end if;
  if NEW.tva is not null then NEW.tva := round(NEW.tva, 2); end if;
  if TG_OP = 'INSERT' then return NEW; end if;
  if coalesce(current_setting('luxyra.allow_nf525_unlock', true), '') = 'true' then return NEW; end if;
  -- colonnes fiscales figées
  if NEW.salon_id is distinct from OLD.salon_id then v := v || 'salon_id'::text; NEW.salon_id := OLD.salon_id; end if;
  if NEW.code is distinct from OLD.code then v := v || 'code'::text; NEW.code := OLD.code; end if;
  if round(NEW.valeur, 2) is not distinct from round(OLD.valeur, 2) then NEW.valeur := OLD.valeur; end if;
  if round(NEW.ht, 2) is not distinct from round(OLD.ht, 2) then NEW.ht := OLD.ht; end if;
  if round(NEW.tva, 2) is not distinct from round(OLD.tva, 2) then NEW.tva := OLD.tva; end if;
  if round(NEW.utilise, 2) is not distinct from round(OLD.utilise, 2) then NEW.utilise := OLD.utilise; end if;
  if round(NEW.restant, 2) is not distinct from round(OLD.restant, 2) then NEW.restant := OLD.restant; end if;
  if NEW.valeur is distinct from OLD.valeur and not (v_srv and coalesce(OLD.payment_status, 'paid') = 'pending') then v := v || 'valeur'::text; NEW.valeur := OLD.valeur; end if;
  if NEW.is_offert is distinct from OLD.is_offert and not (v_srv and coalesce(OLD.payment_status, 'paid') = 'pending') then v := v || 'is_offert'::text; NEW.is_offert := OLD.is_offert; end if;
  if NEW.scope is distinct from OLD.scope then v := v || 'scope'::text; NEW.scope := OLD.scope; end if;
  if NEW.date_creation is distinct from OLD.date_creation and OLD.date_creation is not null then v := v || 'date_creation'::text; NEW.date_creation := OLD.date_creation; end if;
  if NEW.gc_num is distinct from OLD.gc_num and OLD.gc_num is not null then v := v || 'gc_num'::text; NEW.gc_num := OLD.gc_num; end if;
  if NEW.ht is distinct from OLD.ht and not v_srv then v := v || 'ht'::text; NEW.ht := OLD.ht; end if;
  if NEW.tva is distinct from OLD.tva and not v_srv then v := v || 'tva'::text; NEW.tva := OLD.tva; end if;
  if NEW.tva_rate is distinct from OLD.tva_rate and not v_srv then v := v || 'tva_rate'::text; NEW.tva_rate := OLD.tva_rate; end if;
  if NEW.created_at is distinct from OLD.created_at then NEW.created_at := OLD.created_at; end if;
  if NEW.pay_method is distinct from OLD.pay_method and OLD.pay_method is not null then v := v || 'pay_method'::text; NEW.pay_method := OLD.pay_method; end if;
  if OLD.usage_tva is not null and (NEW.usage_tva is distinct from OLD.usage_tva or NEW.qualif_tva is distinct from OLD.qualif_tva) then
    v := v || 'usage_tva / qualif_tva'::text; NEW.usage_tva := OLD.usage_tva; NEW.qualif_tva := OLD.qualif_tva;   -- même règle que a_cartes_cadeaux_qualifier
  end if;
  if NEW.tk_num is distinct from OLD.tk_num and OLD.tk_num is not null then
    if NEW.tk_num is not null then v := v || 'tk_num'::text; end if; -- upsert sans le n° : sans alerte
    NEW.tk_num := OLD.tk_num;
  end if;
  -- date d'expiration : prolongation seulement (une date plus proche avancerait le passage en produit du solde)
  if NEW.date_expiration is distinct from OLD.date_expiration
     and (NEW.date_expiration is not null and (OLD.date_expiration is null or NEW.date_expiration < OLD.date_expiration)) then
    v := v || 'date_expiration (raccourcie)'::text; NEW.date_expiration := OLD.date_expiration;
  end if;
  -- solde : utilisation / recrédit tracés (une entrée d'historique ajoutée, du même montant), annulation (solde à 0), serveur
  if not v_srv then
    v_ho := case when jsonb_typeof(OLD.history) = 'array' then jsonb_array_length(OLD.history) else 0 end;
    v_hn := case when jsonb_typeof(NEW.history) = 'array' then jsonb_array_length(NEW.history) else 0 end;
    v_delta := round(coalesce(NEW.utilise, 0) - coalesce(OLD.utilise, 0), 2);
    if v_delta <> 0 then
      if v_hn = v_ho + 1 and (v_ho = 0 or (NEW.history -> 0) = (OLD.history -> 0)) and (v_ho = 0 or (NEW.history -> (v_ho - 1)) = (OLD.history -> (v_ho - 1)))
         and lx_prive.tva_num(NEW.history -> -1 -> 'amount') = v_delta
         and round(coalesce(NEW.restant, 0), 2) = round(coalesce(OLD.restant, 0) - v_delta, 2)
         and coalesce(NEW.utilise, 0) >= 0 and coalesce(NEW.restant, 0) >= 0 then
        v_util_ok := true;
      else
        v := v || 'utilise'::text; NEW.utilise := OLD.utilise;
      end if;
    end if;
    if NEW.restant is distinct from OLD.restant and not v_util_ok
       and not (NEW.status = 'voided' and coalesce(NEW.restant, 0) = 0) then
      v := v || 'restant'::text; NEW.restant := OLD.restant;
    end if;
    if NEW.status is distinct from OLD.status then
      if OLD.status = 'voided' then v := v || 'status (bon annulé)'::text; NEW.status := OLD.status;
      elsif NEW.status = 'voided' then NEW.restant := 0;                                       -- annulation : solde à 0, tracée au journal
      elsif v_util_ok and NEW.status in ('active', 'used', 'partial') then null;               -- conséquence d'une utilisation tracée
      else v := v || ('status ' || coalesce(NEW.status, '?'))::text; NEW.status := OLD.status; end if;
    end if;
    -- historique : ajout seulement (jamais d'entrée retirée ni réécrite)
    if NEW.history is distinct from OLD.history and not v_util_ok then
      if not (v_hn >= v_ho and (v_ho = 0 or (select bool_and((NEW.history -> (i - 1)) = (OLD.history -> (i - 1))) from generate_series(1, v_ho) i))) then
        NEW.history := OLD.history;  -- copie périmée de l'appareil : la base fait foi (sans alerte)
      end if;
    end if;
  end if;
  perform lx_prive.garde_signaler('cartes_cadeaux', NEW.id, v);
  return NEW;
end $$;
drop trigger if exists a1_lx_cartes_cadeaux_garde_fiscale on public.cartes_cadeaux;
create trigger a1_lx_cartes_cadeaux_garde_fiscale before insert or update on public.cartes_cadeaux
  for each row execute function lx_prive.cartes_cadeaux_garde_fiscale();

-- suppression interdite (la politique RLS allow_delete_cartes_cadeaux reste : l'erreur est explicite au lieu de « 0 ligne »)
create or replace function lx_prive.cartes_cadeaux_suppression()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(current_setting('luxyra.allow_nf525_unlock', true), '') = 'true' then return OLD; end if; -- réinitialisation d'essai, suppression d'établissement (tracées)
  if lx_prive.appel_serveur() and coalesce(OLD.payment_status, '') = 'pending' and OLD.tk_num is null then return OLD; end if; -- vente en ligne abandonnée (gc-create-checkout)
  raise exception 'LX_BON_SUPPRESSION_INTERDITE : le bon cadeau % ne peut pas être supprimé (pièce de caisse). Pour le retirer : « Annuler le bon » (il est conservé dans l''historique).', coalesce(OLD.code, '?') using errcode = 'P0001';
end $$;
drop trigger if exists a_lx_cartes_cadeaux_suppression on public.cartes_cadeaux;
create trigger a_lx_cartes_cadeaux_suppression before delete on public.cartes_cadeaux for each row execute function lx_prive.cartes_cadeaux_suppression();

-- ÉTAT FISCAL D'UN BON À USAGE MULTIPLE, DÉRIVÉ DES TICKETS SCELLÉS (jamais du solde de cartes_cadeaux, modifiable).
--   vente       = lignes « bon à usage multiple » (items[].isBon, bonUsage = 'BUM', bonCode) des tickets du journal jusqu'à la date
--                 (contre-ticket d'annulation de la vente : ligne négative -> vente nette 0) ;
--   utilisations = règlements par ce bon (raw_data.bonsUtil[] usage 'BUM', id ou code ; contre-ticket : montant négatif) ;
--   solde       = vente − utilisations ; date d'expiration = date de la ligne de vente (items[].bonExp, scellée à partir de 6.8.6),
--                 prolongée si la date du bon est postérieure (prolongation tracée au journal des mouvements) ;
--   produit     = solde à la date d'effet (lendemain de l'expiration, ou date de l'annulation d'un bon dont la vente n'a pas été
--                 annulée) : produit hors TVA (BOI-TVA-CHAMP-10-10-40-50 § 90).
create or replace function public.lx_bons_etat(p_salon uuid, p_date date default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_date date := coalesce(p_date, (now() at time zone 'Europe/Paris')::date); r jsonb;
begin
  if not (lx_prive.appel_serveur() or public.is_admin() or exists (select 1 from public.salons s where s.id = p_salon and s.user_id = auth.uid())) then
    raise exception 'LX_REFUS : établissement non autorisé' using errcode = '42501';
  end if;
  with b as (
    select g.id, g.code, g.gc_num, g.valeur, g.restant, g.utilise, g.status, g.date_expiration, g.date_creation, g.tk_num
      from public.cartes_cadeaux g
     where g.salon_id = p_salon and (g.usage_tva = 'BUM' or coalesce(g.qualif_tva->>'usage', '') = 'BUM')
  ), lv as (   -- lignes de vente / d'annulation de vente de bons à usage multiple (journal des tickets jusqu'à la date)
    select t.date_ticket, t.num, e from public.tickets t
     cross join lateral jsonb_array_elements(case when jsonb_typeof(t.items) = 'array' then t.items else '[]'::jsonb end) e
     where t.salon_id = p_salon and t.date_ticket <= v_date and t.status <> 'cancelled' and coalesce(e->>'isBon', '') = 'true' and e->>'bonUsage' = 'BUM'
  ), lu as (    -- règlements par bon à usage multiple (raw_data.bonsUtil, figé dès l'enregistrement)
    select t.date_ticket, t.num, u from public.tickets t
     cross join lateral jsonb_array_elements(case when jsonb_typeof(t.raw_data->'bonsUtil') = 'array' then t.raw_data->'bonsUtil' else '[]'::jsonb end) u
     where t.salon_id = p_salon and t.date_ticket <= v_date and t.status <> 'cancelled' and u->>'usage' = 'BUM'
  ), ventes as (
    select b.id, round(sum(lx_prive.tva_item_montant(lv.e)), 2) vente, min(lv.date_ticket) filter (where lx_prive.tva_item_montant(lv.e) > 0) date_vente,
           min(lv.num) filter (where lx_prive.tva_item_montant(lv.e) > 0) num_vente, max(nullif(lv.e->>'bonExp', '')) exp_scellee
      from b join lv on (lv.e->>'bonCode' = b.code or b.code = any (string_to_array(coalesce(lv.e->>'bonCode', ''), ', ')))
     group by b.id
  ), utils as (
    select b.id, round(sum(lx_prive.tva_num(lu.u->'montant')), 2) utilise,
           jsonb_agg(jsonb_build_object('date', lu.date_ticket, 'ticket', lu.num, 'montant', round(lx_prive.tva_num(lu.u->'montant'), 2)) order by lu.date_ticket, lu.num) liste
      from b join lu on (lu.u->>'id' = b.id::text or (coalesce(lu.u->>'id', '') = '' and lu.u->>'code' = b.code))
     group by b.id
  ), annul as (
    select m.bon_id, min(m.at) at from public.cartes_cadeaux_mouvements m where m.salon_id = p_salon and m.nature = 'annulation' group by m.bon_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', b.id, 'code', b.code, 'gc_num', b.gc_num, 'valeur', b.valeur,
           'vente', coalesce(v.vente, 0), 'date_vente', v.date_vente, 'ticket_vente', v.num_vente,
           'utilise_tickets', coalesce(u.utilise, 0), 'utilisations', coalesce(u.liste, '[]'::jsonb), 'solde_tickets', round(coalesce(v.vente, 0) - coalesce(u.utilise, 0), 2),
           'restant_bon', b.restant, 'ecart_bon', round(coalesce(b.restant, 0) - (coalesce(v.vente, 0) - coalesce(u.utilise, 0)), 2),
           'status', b.status,
           'date_expiration', greatest(nullif(v.exp_scellee, '')::date, b.date_expiration),
           'expiration_scellee', nullif(v.exp_scellee, '')::date,
           'date_annulation', (an.at at time zone 'Europe/Paris')::date,
           'effet', case when b.status = 'voided' and an.at is not null then (an.at at time zone 'Europe/Paris')::date
                         when greatest(nullif(v.exp_scellee, '')::date, b.date_expiration) is not null then greatest(nullif(v.exp_scellee, '')::date, b.date_expiration) + 1 end
         ) order by b.gc_num nulls last, b.code), '[]'::jsonb)
    into r
    from b left join ventes v on v.id = b.id left join utils u on u.id = b.id left join annul an on an.bon_id = b.id;
  return jsonb_build_object('date', v_date, 'bons', r);
end $$;
revoke all on function public.lx_bons_etat(uuid, date) from public, anon;
grant execute on function public.lx_bons_etat(uuid, date) to authenticated, service_role;


-- 2026-10-29 (contre-audit lot 4, mineur) : consommer_bon_cadeau / recrediter_bon_cadeau — définitions de PRODUCTION (md5 5362a257… /
-- 901a4d8b…) à l'identique, plus le contrôle du montant au centime (seule modification).
create or replace function public.consommer_bon_cadeau(p_bon_id uuid, p_montant numeric, p_ticket text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bon   record;
  v_uid   uuid;
  v_reste numeric;
  v_hist  jsonb;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant invalide');
  END IF;
  -- 2026-10-29 (contre-audit lot 4) : montant au centime. Bruit de calcul (< 0,000001) arrondi ; 3 décimales ou plus refusées
  -- (le solde et l'utilisé sont des numeric(10,2) : 10,005 était répondu « restant 69,995 » mais enregistré 70,00 / 30,01).
  IF abs(p_montant - round(p_montant, 2)) >= 0.000001 THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant invalide : deux decimales au plus (centimes)');
  END IF;
  p_montant := round(p_montant, 2);

  SELECT * INTO v_bon FROM cartes_cadeaux WHERE id = p_bon_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Bon cadeau introuvable');
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL
     AND NOT (EXISTS (SELECT 1 FROM salons s WHERE s.id = v_bon.salon_id AND s.user_id = v_uid)
              OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Acces refuse');
  END IF;

  -- 2026-10-14 audit : paiement en ligne non confirmé -> bon inutilisable
  IF v_bon.payment_status IS NOT NULL AND v_bon.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Paiement en ligne de ce bon non confirme');
  END IF;
  IF coalesce(v_bon.status,'') = 'voided' THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Ce bon a ete annule');
  END IF;
  IF v_bon.date_expiration IS NOT NULL AND v_bon.date_expiration < current_date THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Ce bon est expire');
  END IF;
  IF coalesce(v_bon.restant,0) < p_montant THEN
    RETURN jsonb_build_object('ok', false, 'erreur',
      'Solde insuffisant : ' || coalesce(v_bon.restant,0)::text || ' EUR disponibles',
      'restant', coalesce(v_bon.restant,0));
  END IF;

  v_reste := coalesce(v_bon.restant,0) - p_montant;
  v_hist  := coalesce(v_bon.history, '[]'::jsonb) || jsonb_build_object(
               'date', to_char(now() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD'),
               'time', to_char(now() AT TIME ZONE 'Europe/Paris','HH24:MI'),
               'amount', p_montant,
               'tkNum', coalesce(p_ticket,'')
             );

  UPDATE cartes_cadeaux
     SET restant = v_reste,
         utilise = coalesce(utilise,0) + p_montant,
         status  = CASE WHEN v_reste <= 0 THEN 'used' ELSE status END,
         history = v_hist
   WHERE id = p_bon_id;

  RETURN jsonb_build_object('ok', true, 'restant', v_reste,
                            'utilise', coalesce(v_bon.utilise,0) + p_montant,
                            'status', CASE WHEN v_reste <= 0 THEN 'used' ELSE v_bon.status END);
END;
$function$;
create or replace function public.recrediter_bon_cadeau(p_bon_id uuid, p_montant numeric, p_ticket text DEFAULT NULL::text, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bon record; v_uid uuid; v_reste numeric; v_util numeric; v_hist jsonb;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant invalide');
  END IF;
  -- 2026-10-29 (contre-audit lot 4) : montant au centime. Bruit de calcul (< 0,000001) arrondi ; 3 décimales ou plus refusées
  -- (le solde et l'utilisé sont des numeric(10,2) : 10,005 était répondu « restant 69,995 » mais enregistré 70,00 / 30,01).
  IF abs(p_montant - round(p_montant, 2)) >= 0.000001 THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant invalide : deux decimales au plus (centimes)');
  END IF;
  p_montant := round(p_montant, 2);
  SELECT * INTO v_bon FROM cartes_cadeaux WHERE id = p_bon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Bon cadeau introuvable'); END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT (EXISTS (SELECT 1 FROM salons s WHERE s.id = v_bon.salon_id AND s.user_id = v_uid) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Acces refuse');
  END IF;
  IF coalesce(v_bon.status,'') = 'voided' THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Ce bon a ete annule'); END IF;
  IF coalesce(v_bon.utilise,0) + 0.004 < p_montant THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant superieur au montant utilise (' || coalesce(v_bon.utilise,0)::text || ' EUR)');
  END IF;
  v_reste := round(coalesce(v_bon.restant,0) + p_montant, 2);
  v_util  := greatest(0, round(coalesce(v_bon.utilise,0) - p_montant, 2));
  v_hist  := coalesce(v_bon.history, '[]'::jsonb) || jsonb_build_object(
               'date', to_char(now() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD'),
               'time', to_char(now() AT TIME ZONE 'Europe/Paris','HH24:MI'),
               'amount', -p_montant, 'tkNum', coalesce(p_ticket,''), 'motif', left(coalesce(p_motif,'recredit'),200));
  UPDATE cartes_cadeaux
     SET restant = v_reste, utilise = v_util,
         status  = CASE WHEN status = 'used' AND v_reste > 0 THEN 'active' ELSE status END,
         history = v_hist
   WHERE id = p_bon_id;
  INSERT INTO audit_log(salon_id, action, details, operator_name)
  VALUES (v_bon.salon_id, 'BON_CADEAU_RECREDIT', 'Bon ' || coalesce(v_bon.code,'?') || ' recrédité de ' || p_montant || ' EUR (ticket ' || coalesce(p_ticket,'') || ') — ' || left(coalesce(p_motif,''),200), NULL);
  RETURN jsonb_build_object('ok', true, 'restant', v_reste, 'utilise', v_util,
                            'status', CASE WHEN v_bon.status = 'used' AND v_reste > 0 THEN 'active' ELSE v_bon.status END);
END;
$function$;

-- ===================================================================================================================== §3
-- ARRONDIS À L'ÉCRITURE DES CLÔTURES Z (bruit de calcul flottant de l'application : 380.79999999999995, 59.400000000000006).
-- Seulement quand l'écart avec le centime est un BRUIT (< 0,000001) : la valeur au centime est exactement celle de l'empreinte
-- de la Z (toFixed(2) de l'application). Exécuté le premier (« a0_ » < « a_nf525_marquer_mode »), avant les contrôles et le cumul.
create or replace function lx_prive.arrondi_bruit(x numeric) returns numeric language sql immutable set search_path = pg_catalog as $$
  select case when x is null then null when abs(x - round(x, 2)) < 0.000001 then round(x, 2) else x end
$$;
create or replace function lx_prive.clotures_arrondi()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  NEW.total_ca := lx_prive.arrondi_bruit(NEW.total_ca);
  NEW.total_ht := lx_prive.arrondi_bruit(NEW.total_ht);
  NEW.cumul_mois_ca := lx_prive.arrondi_bruit(NEW.cumul_mois_ca);
  NEW.cumul_annee_ca := lx_prive.arrondi_bruit(NEW.cumul_annee_ca);
  NEW.cumul_perpetuel_ca := lx_prive.arrondi_bruit(NEW.cumul_perpetuel_ca);
  if jsonb_typeof(NEW.detail_paiements) = 'object' then
    select coalesce(jsonb_object_agg(d.key, case when jsonb_typeof(d.value) = 'number' then to_jsonb(lx_prive.arrondi_bruit((d.value #>> '{}')::numeric)) else d.value end), '{}'::jsonb)
      into NEW.detail_paiements from jsonb_each(NEW.detail_paiements) d;
  end if;
  return NEW;
end $$;
drop trigger if exists a0_lx_clotures_arrondi on public.clotures;
create trigger a0_lx_clotures_arrondi before insert on public.clotures for each row execute function lx_prive.clotures_arrondi();
-- grand total perpétuel : calculé par trg_clotures_set_cumul_perpetuel (dernier total enregistré, parfois bruité, + total de la Z)
-- -> arrondi du bruit APRÈS ce calcul (« zz_ » > « trg_ »)
create or replace function lx_prive.clotures_arrondi_cumul()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  NEW.cumul_perpetuel_ca := lx_prive.arrondi_bruit(NEW.cumul_perpetuel_ca);
  NEW.cumul_mois_ca := lx_prive.arrondi_bruit(NEW.cumul_mois_ca);
  NEW.cumul_annee_ca := lx_prive.arrondi_bruit(NEW.cumul_annee_ca);
  return NEW;
end $$;
drop trigger if exists zz_lx_clotures_arrondi_cumul on public.clotures;
create trigger zz_lx_clotures_arrondi_cumul before insert on public.clotures for each row execute function lx_prive.clotures_arrondi_cumul();

-- Cumul de TICKETS du mois / de l'année d'une Z qui suit une Z annotée (annotation corrective signée : nombre corrigé) : même
-- ajustement que les cumuls de CA (faits par b_nf525_z_controle_journal) — seulement si l'appareil ne l'a pas déjà appliqué
-- (raw_data.lxAnnotTk = 'true', application 6.8.6). Après b_nf525_z_controle_journal / _tva (ordre alphabétique : « cu » > « co »).
create or replace function lx_prive.clotures_cumul_tickets_annotations()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_d record;
begin
  if coalesce(NEW.raw_data->>'lxAnnotTk', '') = 'true' then return NEW; end if;
  if not exists (select 1 from public.clotures_annotations a where a.salon_id = NEW.salon_id and a.cloture_date < NEW.date_cloture) then return NEW; end if;
  if coalesce(NEW.cumul_mois_tickets, 0) > 0 then
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('month', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_nb, 0) <> 0 then NEW.cumul_mois_tickets := NEW.cumul_mois_tickets + v_d.d_nb; end if;
  end if;
  if coalesce(NEW.cumul_annee_tickets, 0) > 0 then
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('year', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_nb, 0) <> 0 then NEW.cumul_annee_tickets := NEW.cumul_annee_tickets + v_d.d_nb; end if;
  end if;
  return NEW;
end $$;
drop trigger if exists b_nf525_z_cumul_tickets on public.clotures;
create trigger b_nf525_z_cumul_tickets before insert on public.clotures for each row execute function lx_prive.clotures_cumul_tickets_annotations();

-- ===================================================================================================================== §4
-- STRIPE : versements reçus sur le compte bancaire du salon (payout.paid) et détail des opérations comprises (frais Stripe).
-- Alimentées UNIQUEMENT par le worker (rôle service), à la réception de l'évènement payout.paid du webhook « comptes connectés »
-- (les données sont relues chez Stripe au nom du compte : /v1/balance_transactions?payout=…). Lecture : l'établissement.
create table if not exists public.stripe_versements (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null,
  compte text not null,                 -- acct_… (compte Stripe du salon)
  payout_id text not null unique,       -- po_…
  date_versement date not null,         -- arrival_date (Europe/Paris)
  montant numeric(12,2) not null,       -- montant viré sur le compte bancaire (net)
  brut numeric(12,2) not null default 0,  -- encaissements compris (paiements − remboursements)
  frais numeric(12,2) not null default 0, -- frais Stripe (commission) compris dans le versement
  autres numeric(12,2) not null default 0, -- autres mouvements (litiges, ajustements)
  devise text not null default 'eur',
  statut text not null default 'paid',
  nb_operations integer not null default 0,
  recu_le timestamptz not null default now(),
  details jsonb
);
create index if not exists stripe_versements_salon on public.stripe_versements (salon_id, date_versement);
create table if not exists public.stripe_versements_lignes (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null,
  payout_id text not null,
  bt_id text not null unique,           -- txn_… (balance transaction)
  type text,                            -- charge | refund | adjustment | stripe_fee | …
  source text,                          -- ch_… / re_… / py_…
  payment_intent text,                  -- pi_… (rapprochement avec recettes_en_ligne.payment_intent)
  date_operation date,
  brut numeric(12,2) not null default 0,
  frais numeric(12,2) not null default 0,
  net numeric(12,2) not null default 0,
  description text
);
create index if not exists stripe_versements_lignes_payout on public.stripe_versements_lignes (payout_id);
alter table public.stripe_versements enable row level security;
alter table public.stripe_versements_lignes enable row level security;
drop policy if exists stripe_versements_select on public.stripe_versements;
create policy stripe_versements_select on public.stripe_versements for select to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()) or public.is_admin());
drop policy if exists stripe_versements_lignes_select on public.stripe_versements_lignes;
create policy stripe_versements_lignes_select on public.stripe_versements_lignes for select to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()) or public.is_admin());
revoke all on public.stripe_versements, public.stripe_versements_lignes from anon, authenticated;
grant select on public.stripe_versements, public.stripe_versements_lignes to authenticated;
grant select, insert, update, delete on public.stripe_versements, public.stripe_versements_lignes to service_role;
comment on table public.stripe_versements is 'Versements Stripe (payout.paid) reçus par le salon, avec brut / frais / net (2026-10-28, Luxyra 6.8.6) : rapprochement du compte 580100 et frais 627 dans les exports. Écrit par le worker uniquement.';

-- ===================================================================================================================== §5
-- FACTURES CLIENTS établies À PARTIR D'UN TICKET SCELLÉ (CGI art. 289 ; ann. II art. 242 nonies A ; arrêté n° 83-50/A du
-- 03/10/1983 : note obligatoire pour une prestation de services d'au moins 25 € TTC, ou à la demande du client ; client
-- professionnel : facture obligatoire, CGI art. 289, I-1-a). La facture d'un ticket déjà encaissé N'EST PAS une nouvelle recette :
-- montants recopiés du ticket (aucun calcul nouveau, aucune écriture comptable), mention « Facture acquittée ».
-- 2026-10-29 (contre-audit du lot 4, NO GO levé) :
--   * BLOQUANT — AUCUNE facture en caisse de TEST (LX_FACTURE_TEST) : factures_clients.ticket_id référence le ticket SANS
--     cascade ; une facture de test bloquait la réinitialisation d'essai (factory_reset_salon), l'effacement des ventes de test
--     (reset_ventes_test_salon), le passage en caisse réelle et le passage automatique à l'abonnement (resté en test, seule trace
--     NF525_INTEGRITE_KO). Refus dans lx_facture_emettre ET déclencheur a_lx_factures_clients_pas_de_test (toute insertion, tous
--     rôles) ; l'ancienne fonction de production generer_facture_client (sans contrôle, exécutable par le propriétaire) est retirée ;
--   * lignes de la facture calculées par la base (colonne lignes) : remise globale du ticket = ligne « Remise » négative PAR TAUX,
--     somme des lignes = total du ticket au centime ;
--   * n° de TVA du vendeur obligatoire hors franchise (ann. II art. 242 nonies A, I-2°) ; adresse du vendeur complète (I-1°) ;
--   * société (SAS, SASU, SARL, EURL, SA, SNC…) : ville du greffe (mention « RCS ») et capital social obligatoires (C. com.
--     art. R123-237, 1° et 2°, et R123-238) ; colonnes salons.rcs_ville / salons.capital_social (Paramètres › Infos établissement) ;
--   * avoir sans facture d'origine refusé ; un avoir reprend le client de la facture qu'il rectifie ;
--   * vente d'un bon à usage multiple (hors champ de la TVA, CGI art. 256 ter) : pas de facture de vente (voir lx_facture_emettre).
alter table public.factures_clients add column if not exists type text not null default 'facture';         -- facture | avoir
alter table public.factures_clients add column if not exists numero text;                                   -- n° affiché (F-000001 / A-000001 : même série)
alter table public.factures_clients add column if not exists facture_origine_id uuid;                       -- facture rectifiée (avoir)
alter table public.factures_clients add column if not exists ticket_num text;                               -- n° imprimé du ticket
alter table public.factures_clients add column if not exists date_operation date;                           -- date de la vente / prestation
alter table public.factures_clients add column if not exists client_type text;                              -- particulier | professionnel
alter table public.factures_clients add column if not exists client_siren text;
alter table public.factures_clients add column if not exists par_taux jsonb;                                -- [{taux, ht, tva, ttc}]
alter table public.factures_clients add column if not exists mentions jsonb;                                -- mentions légales imprimées
alter table public.factures_clients add column if not exists salon_forme text;
alter table public.factures_clients add column if not exists mode_caisse text;                              -- toujours 'reel' (aucune facture en caisse de test)
alter table public.factures_clients add column if not exists lignes jsonb;                                  -- [{nom, qte, ttc, ht, taux, remise}] calculées par la base
alter table public.factures_clients add column if not exists salon_rue text;                                -- adresse du vendeur découpée (XML EN 16931)
alter table public.factures_clients add column if not exists salon_cp text;
alter table public.factures_clients add column if not exists salon_ville text;
alter table public.factures_clients add column if not exists salon_pays text;
alter table public.factures_clients add column if not exists salon_rcs text;                                -- « RCS <ville du greffe> <SIREN> »
alter table public.factures_clients add column if not exists salon_capital numeric(14,2);
create unique index if not exists factures_clients_num_unique on public.factures_clients (salon_id, num);
create unique index if not exists factures_clients_ticket_unique on public.factures_clients (salon_id, ticket_id) where ticket_id is not null;
-- l'insertion ne passe plus que par la fonction (la politique d'insertion directe ne permettait pas de garantir la numérotation)
drop policy if exists factures_clients_insert_own on public.factures_clients;
revoke insert, update, delete on public.factures_clients from anon, authenticated;
grant select on public.factures_clients to authenticated;
grant select, insert on public.factures_clients to service_role;

-- Mentions légales du vendeur (Paramètres › Infos établissement), à côté de siret / tva / forme_juridique (même convention : colonnes)
alter table public.salons add column if not exists rcs_ville text;                                          -- ville du greffe (mention « RCS Metz »)
alter table public.salons add column if not exists capital_social numeric(14,2);                            -- capital social (sociétés)
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'salons_capital_social_positif') then
    alter table public.salons add constraint salons_capital_social_positif check (capital_social is null or capital_social >= 0);
  end if;
end $$;
comment on column public.salons.rcs_ville is 'Ville du greffe du RCS (mention « RCS <ville> » des factures et devis, C. com. art. R123-237, 2°). 2026-10-29, Luxyra 6.8.6.';
comment on column public.salons.capital_social is 'Capital social en euros (sociétés, C. com. art. R123-238). 2026-10-29, Luxyra 6.8.6.';

-- forme juridique d'une SOCIÉTÉ (codes de l'inscription : sas, sasu, sarl, eurl, sa… ; valeurs libres « SASU », « Société … »)
create or replace function lx_prive.forme_societe(p text) returns boolean language sql immutable set search_path = pg_catalog as $$
  select coalesce(lower(btrim(p)) ~ '^(sas|sasu|sarl|sarlu|eurl|sa|snc|scs|sca|selarl|selas|selasu|selafa|selca|scop|sci)([^a-z]|$)'
                  or lower(btrim(p)) ~ '^soci[eé]t[eé]', false)
$$;
create or replace function lx_prive.forme_libelle(p text) returns text language sql immutable set search_path = pg_catalog as $$
  select case when nullif(btrim(coalesce(p, '')), '') is null then null
              when lower(btrim(p)) = 'micro' then 'Micro-entreprise'
              when lower(btrim(p)) = 'ei' then 'Entreprise individuelle'
              when lower(btrim(p)) = 'eirl' then 'EIRL'
              when lx_prive.forme_societe(p) and btrim(p) !~ ' ' then upper(btrim(p))
              else btrim(p) end
$$;

-- Lignes d'une facture : lignes du ticket au taux de chaque ligne (même règle que lx_prive.tva_ticket_lignes : taux propre si
-- l'établissement facture la TVA, sinon produits / prestations), HT de chaque ligne = TTC / (1 + taux), puis, PAR TAUX, écart avec
-- la ventilation enregistrée (p_par = valeurs de la Z et du FEC) : remise globale du ticket (hors lignes) -> ligne « Remise »
-- négative ; écart d'arrondi du HT (≤ 0,02) -> porté sur la ligne la plus importante. Somme des lignes = ventilation = ticket.
create or replace function lx_prive.facture_lignes(p_items jsonb, p_par jsonb, p_s numeric, p_p numeric)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  v_out jsonb := '[]'::jsonb; p jsonb; v_t numeric; v_l jsonb; v_sttc numeric; v_sht numeric; d_ttc numeric; d_ht numeric;
  v_s numeric := coalesce(p_s, 0); v_p numeric; v_imax int; v_max numeric; i int; v_ptaux numeric[];
begin
  v_p := case when v_s > 0 then coalesce(p_p, v_s) else 0 end;
  select coalesce(array_agg(lx_prive.tva_num(x->'taux')), '{}') into v_ptaux from jsonb_array_elements(coalesce(p_par, '[]'::jsonb)) x;
  if exists (select 1 from jsonb_array_elements(v_items) e
              where jsonb_typeof(e) = 'object' and not lx_prive.tva_vrai(e->'isSep') and not lx_prive.tva_vrai(e->'isAcompteData')
                and round(lx_prive.tva_item_montant(e), 2) <> 0
                and not (case when v_s > 0 and lx_prive.tva_num(e->'tvaTaux') is not null then lx_prive.tva_num(e->'tvaTaux')
                              when lx_prive.tva_vrai(e->'isProd') then v_p else v_s end = any (v_ptaux))) then
    raise exception 'LX_FACTURE_VENTILATION : le taux d''une ligne du ticket ne figure pas dans la ventilation enregistrée — facture impossible, écrivez au support (support@luxyra.fr)' using errcode = 'P0001';
  end if;
  for p in select x from jsonb_array_elements(coalesce(p_par, '[]'::jsonb)) x order by lx_prive.tva_num(x->'taux') desc loop
    v_t := lx_prive.tva_num(p->'taux');
    select coalesce(jsonb_agg(jsonb_build_object('nom', coalesce(nullif(btrim(e->>'name'), ''), 'Article'),
                                                 'qte', coalesce(nullif(lx_prive.tva_num(e->'qty'), 0), 1),
                                                 'ttc', round(lx_prive.tva_item_montant(e), 2),
                                                 'ht', case when v_t > 0 then round(round(lx_prive.tva_item_montant(e), 2) / (1 + v_t / 100), 2) else round(lx_prive.tva_item_montant(e), 2) end,
                                                 'taux', v_t, 'remise', false) order by o), '[]'::jsonb)
      into v_l
      from jsonb_array_elements(v_items) with ordinality as z(e, o)
     where jsonb_typeof(e) = 'object' and not lx_prive.tva_vrai(e->'isSep') and not lx_prive.tva_vrai(e->'isAcompteData')
       and case when v_s > 0 and lx_prive.tva_num(e->'tvaTaux') is not null then lx_prive.tva_num(e->'tvaTaux')
                when lx_prive.tva_vrai(e->'isProd') then v_p else v_s end = v_t;
    select coalesce(sum((x->>'ttc')::numeric), 0), coalesce(sum((x->>'ht')::numeric), 0) into v_sttc, v_sht from jsonb_array_elements(v_l) x;
    d_ttc := round(lx_prive.tva_num(p->'ttc') - v_sttc, 2);
    d_ht := round(lx_prive.tva_num(p->'ht') - v_sht, 2);
    if abs(d_ttc) >= 0.005 then
      v_l := v_l || jsonb_build_array(jsonb_build_object(
        'nom', case when sign(d_ttc) <> sign(lx_prive.tva_num(p->'ttc')) or lx_prive.tva_num(p->'ttc') = 0 then 'Remise' else 'Ajustement' end
               || case when array_length(v_ptaux, 1) > 1 then ' (TVA ' || replace(trim_scale(v_t)::text, '.', ',') || ' %)' else '' end,
        'qte', 1, 'ttc', d_ttc, 'ht', d_ht, 'taux', v_t, 'remise', true));
    elsif abs(d_ht) >= 0.005 then
      if abs(d_ht) > 0.025 or jsonb_array_length(v_l) = 0 then
        raise exception 'LX_FACTURE_VENTILATION : HT des lignes (taux % %%) différent de la ventilation enregistrée de % — écrivez au support', v_t, d_ht using errcode = 'P0001';
      end if;
      v_max := null; v_imax := 0;
      for i in 0 .. jsonb_array_length(v_l) - 1 loop
        if v_max is null or abs((v_l->i->>'ttc')::numeric) > v_max then v_max := abs((v_l->i->>'ttc')::numeric); v_imax := i; end if;
      end loop;
      v_l := jsonb_set(v_l, array[v_imax::text, 'ht'], to_jsonb(round((v_l->v_imax->>'ht')::numeric + d_ht, 2)));
    end if;
    v_out := v_out || v_l;
  end loop;
  return v_out;
end $$;

-- AUCUNE facture (de vente ou d'avoir) pour un ticket de caisse de TEST ni pour un établissement en caisse de TEST, quelle que soit la
-- voie d'insertion (fonction, rôle serveur, administration) : une facture est une pièce inaltérable rattachée au ticket (clé
-- étrangère sans cascade) — elle empêcherait l'effacement des ventes de test et le passage en caisse réelle.
create or replace function lx_prive.factures_clients_pas_de_test()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if exists (select 1 from public.salons s where s.id = NEW.salon_id and s.mode_caisse = 'test')
     or exists (select 1 from public.tickets t where t.id = NEW.ticket_id and t.mode_caisse = 'test') then
    raise exception 'LX_FACTURE_TEST : aucune facture en caisse de TEST (ventes sans valeur, effacées au passage en caisse réelle). Les factures se font une fois la caisse réelle activée.' using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_factures_clients_pas_de_test on public.factures_clients;
create trigger a_lx_factures_clients_pas_de_test before insert on public.factures_clients for each row execute function lx_prive.factures_clients_pas_de_test();

-- Ancienne fonction de PRODUCTION (md5 d2e41194…) : numérotation hors verrou, aucune mention, aucun contrôle (caisse de test
-- comprise), exécutable par le propriétaire -> retirée (seule voie : lx_facture_emettre). Définition d'origine dans le retour arrière.
create or replace function public.generer_facture_client(p_ticket_id uuid, p_client_nom text default null, p_client_prenom text default null,
  p_client_adresse text default null, p_client_cp text default null, p_client_ville text default null, p_client_email text default null,
  p_client_telephone text default null, p_client_siret text default null, p_client_tva_intracom text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  raise exception 'LX_FACTURE_VOIE_RETIREE : generer_facture_client est remplacée par lx_facture_emettre (Luxyra 6.8.6)' using errcode = 'P0001';
end $$;
revoke all on function public.generer_facture_client(uuid, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;

create or replace function public.lx_facture_emettre(p_ticket uuid, p_client jsonb, p_operateur text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  t public.tickets%rowtype; s public.salons%rowtype; v_num int; v_prev text; v_hash text; v_id uuid; v_type text; v_orig public.factures_clients%rowtype;
  v_l jsonb; v_par jsonb; v_items jsonb; v_lignes jsonb; v_nom text; v_prenom text; v_adr text; v_cp text; v_ville text; v_email text; v_tel text;
  v_siren text; v_siret text; v_tvacli text; v_pro boolean; v_franchise boolean; v_mentions jsonb; v_numero text;
  v_jour date := (now() at time zone 'Europe/Paris')::date; v_ref text; v_tva_v text; v_siren_v text; v_soc boolean; v_rcs text; v_forme text; v_vendeur text;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null then raise exception 'LX_FACTURE : ticket introuvable' using errcode = 'P0001'; end if;
  if not (lx_prive.appel_serveur() or public.is_admin() or exists (select 1 from public.salons x where x.id = t.salon_id and x.user_id = auth.uid())) then
    raise exception 'LX_REFUS : établissement non autorisé' using errcode = '42501';
  end if;
  select * into s from public.salons where id = t.salon_id;
  -- caisse de TEST : aucune facture (voir l'en-tête du §5 et le déclencheur a_lx_factures_clients_pas_de_test)
  if coalesce(t.mode_caisse, s.mode_caisse, 'reel') = 'test' or coalesce(s.mode_caisse, 'reel') = 'test' then
    raise exception 'LX_FACTURE_TEST : aucune facture en caisse de TEST (ventes sans valeur, effacées au passage en caisse réelle). Les factures se font une fois la caisse réelle activée.' using errcode = 'P0001';
  end if;
  if coalesce(t.total_ttc, 0) = 0 then raise exception 'LX_FACTURE : ticket à 0 €, aucune facture' using errcode = 'P0001'; end if;
  if exists (select 1 from public.factures_clients f where f.salon_id = t.salon_id and f.ticket_id = t.id) then
    raise exception 'LX_FACTURE_DEJA : une facture existe déjà pour ce ticket (réimprimez-la)' using errcode = 'P0001';
  end if;
  -- vendeur (ann. II art. 242 nonies A, I-1° et 2° ; C. com. art. R123-237 et R123-238)
  v_siren_v := left(regexp_replace(coalesce(s.siret, ''), '\D', '', 'g'), 9);
  if length(v_siren_v) <> 9 then
    raise exception 'LX_FACTURE_VENDEUR : SIRET de l''établissement non renseigné (Paramètres › Infos établissement)' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(s.adresse, '')), '') is null or nullif(btrim(coalesce(s.cp, '')), '') is null or nullif(btrim(coalesce(s.ville, '')), '') is null then
    raise exception 'LX_FACTURE_VENDEUR : adresse de l''établissement incomplète (Paramètres › Infos établissement : Adresse, CP, Ville)' using errcode = 'P0001';
  end if;
  v_franchise := coalesce(t.taux_tva, 0) = 0 and coalesce(s.taux_tva, 0) = 0;
  v_tva_v := nullif(upper(regexp_replace(coalesce(nullif(s.tva_intra, ''), s.tva, ''), '\s', '', 'g')), '');
  if not v_franchise and v_tva_v is null then
    raise exception 'LX_FACTURE_VENDEUR_TVA : n° de TVA intracommunautaire de l''établissement non renseigné — obligatoire sur une facture avec TVA (CGI, ann. II, art. 242 nonies A, I-2°). À saisir dans Paramètres › Infos établissement › « N° TVA intracommunautaire ».' using errcode = 'P0001';
  end if;
  v_soc := lx_prive.forme_societe(s.forme_juridique);
  if v_soc and (nullif(btrim(coalesce(s.rcs_ville, '')), '') is null or s.capital_social is null) then
    raise exception 'LX_FACTURE_VENDEUR_RCS : société (%) — ville du greffe (mention « RCS ») et capital social obligatoires sur une facture (C. com. art. R123-237 et R123-238). À saisir dans Paramètres › Infos établissement › « Mentions légales de la société ».', s.forme_juridique using errcode = 'P0001';
  end if;
  v_rcs := case when nullif(btrim(coalesce(s.rcs_ville, '')), '') is not null then 'RCS ' || btrim(s.rcs_ville) || ' ' || v_siren_v end;
  v_forme := lx_prive.forme_libelle(s.forme_juridique);
  v_vendeur := nullif(concat_ws(' — ',
                 case when v_forme is not null then v_forme || case when s.capital_social is not null then ' au capital de ' || replace(to_char(s.capital_social, 'FM999999999990.00'), '.', ',') || ' €' else '' end end,
                 v_rcs, 'SIREN ' || v_siren_v), '');
  -- ventilation par taux = valeurs ENREGISTRÉES du ticket (même règle que la Z et le FEC : lx_prive.tva_ticket_lignes)
  v_l := lx_prive.tva_ticket_lignes(t.items, t.total_ttc, t.total_ht, t.taux_tva, t.raw_data->'lxTva',
           case when coalesce(s.taux_tva, 20) > 0 then coalesce(s.taux_tva_produits, s.taux_tva, 20) else 0 end, t.raw_data->'bonsUtil');
  -- vente (ou annulation de vente) d'un bon à usage multiple : opération HORS CHAMP de la TVA (CGI art. 256 ter ; directive
  -- 2016/1065 : la TVA est due à l'utilisation du bon) -> ni livraison ni prestation à facturer (CGI art. 289, I) ; un document
  -- mêlant une catégorie hors champ (« O ») et une catégorie taxée est en outre invalide en EN 16931 (règles BR-O-11 à BR-O-14).
  -- La facture se fait sur le ticket d'UTILISATION du bon (prestation / produit, TVA à cette date).
  if coalesce(lx_prive.tva_num(v_l->'hc'), 0) <> 0 then
    raise exception 'LX_FACTURE_BON_MULTIPLE : ce ticket contient la vente d''un bon cadeau à usage multiple, hors champ de la TVA (CGI art. 256 ter) — pas de facture pour cette vente. La facture s''établit sur le ticket où le bon est utilisé. Pour un bon vendu avec une prestation, encaissez-les sur deux tickets.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('taux', x->'t', 'ht', x->'ht', 'tva', x->'tva', 'ttc', x->'ttc') order by (x->>'t')::numeric desc), '[]'::jsonb)
    into v_par from jsonb_array_elements(coalesce(v_l->'l', '[]'::jsonb)) x;
  v_items := case when jsonb_typeof(t.items) = 'array' then t.items else '[]'::jsonb end;
  v_lignes := lx_prive.facture_lignes(v_items, v_par, t.taux_tva,
                case when coalesce(s.taux_tva, 20) > 0 then coalesce(s.taux_tva_produits, s.taux_tva, 20) else 0 end);
  -- facture d'avoir : contre-ticket (montant négatif) d'un ticket déjà facturé -> rectifie cette facture ; sans facture d'origine :
  -- refus (le contre-ticket suffit, un avoir ne rectifie qu'une facture)
  v_type := case when t.total_ttc < 0 then 'avoir' else 'facture' end;
  if v_type = 'avoir' then
    v_ref := coalesce(t.raw_data->>'cancelRef', t.raw_data->>'retourRefTk', '');
    select f.* into v_orig from public.factures_clients f join public.tickets o on o.id = f.ticket_id
     where f.salon_id = t.salon_id and f.type = 'facture'
       and (o.id = t.parent_ticket_id or (v_ref <> '' and (o.raw_data->>'tkNum' = v_ref or o.raw_data->>'id' = v_ref or o.num::text = v_ref)))
     order by f.num limit 1;
    if v_orig.id is null then
      raise exception 'LX_FACTURE_AVOIR_SANS_ORIGINE : aucune facture n''a été émise pour le ticket d''origine — une facture d''avoir ne rectifie qu''une facture. Le contre-ticket d''annulation suffit.' using errcode = 'P0001';
    end if;
    -- ventilation de l'avoir : taux compris dans ceux de la facture rectifiée (sinon : taux des produits changé entre la vente et
    -- une annulation par la fonction serveur creer_ticket_avoir -> avoir incohérent avec la facture : refus, support)
    if exists (select 1 from jsonb_array_elements(v_par) x
                where not exists (select 1 from jsonb_array_elements(coalesce(v_orig.par_taux, '[]'::jsonb)) y where lx_prive.tva_num(y->'taux') = lx_prive.tva_num(x->'taux'))) then
      raise exception 'LX_FACTURE_AVOIR_VENTILATION : les taux de TVA du contre-ticket ne correspondent pas à ceux de la facture % — écrivez au support (support@luxyra.fr)', coalesce(v_orig.numero, v_orig.num::text) using errcode = 'P0001';
    end if;
    -- même client que la facture rectifiée
    v_nom := v_orig.client_nom; v_prenom := v_orig.client_prenom; v_adr := v_orig.client_adresse; v_cp := v_orig.client_cp; v_ville := v_orig.client_ville;
    v_email := v_orig.client_email; v_tel := v_orig.client_telephone; v_siren := v_orig.client_siren; v_siret := v_orig.client_siret;
    v_tvacli := v_orig.client_tva_intracom; v_pro := coalesce(v_orig.client_type, '') = 'professionnel';
  else
    v_nom := nullif(btrim(coalesce(p_client->>'nom', '')), ''); v_prenom := nullif(btrim(coalesce(p_client->>'prenom', '')), '');
    v_adr := nullif(btrim(coalesce(p_client->>'adresse', '')), ''); v_cp := nullif(btrim(coalesce(p_client->>'cp', '')), ''); v_ville := nullif(btrim(coalesce(p_client->>'ville', '')), '');
    v_email := nullif(btrim(coalesce(p_client->>'email', '')), ''); v_tel := nullif(btrim(coalesce(p_client->>'telephone', '')), '');
    v_siren := nullif(regexp_replace(coalesce(p_client->>'siren', ''), '\s', '', 'g'), ''); v_siret := nullif(regexp_replace(coalesce(p_client->>'siret', ''), '\s', '', 'g'), '');
    v_tvacli := nullif(upper(regexp_replace(coalesce(p_client->>'tva_intracom', ''), '\s', '', 'g')), '');
    v_pro := coalesce(p_client->>'type', '') = 'professionnel';
    if v_nom is null or v_adr is null or v_cp is null or v_ville is null then
      raise exception 'LX_FACTURE_CLIENT : nom et adresse complète du client obligatoires (CGI, ann. II, art. 242 nonies A, I-1°)' using errcode = 'P0001';
    end if;
    if v_pro and v_siren is null then
      raise exception 'LX_FACTURE_CLIENT : SIREN (ou SIRET) du client professionnel obligatoire' using errcode = 'P0001';
    end if;
  end if;
  v_mentions := jsonb_build_object(
    'acquittee', case when v_type = 'facture' then 'Facture acquittée le ' || to_char(t.date_ticket, 'DD/MM/YYYY') || ' (ticket de caisse n° ' || coalesce(t.raw_data->>'tkNum', t.num::text) || ', règlement : ' || coalesce(t.mode_paiement, '') || ')'
                      else 'Avoir remboursé le ' || to_char(t.date_ticket, 'DD/MM/YYYY') || ' (ticket n° ' || coalesce(t.raw_data->>'tkNum', t.num::text) || ')' end,
    'recette', 'Facture établie à partir d''un ticket de caisse déjà enregistré : elle ne constitue pas une nouvelle recette.',
    'tva', case when v_franchise then 'TVA non applicable, art. 293 B du CGI' else null end,
    'vendeur', v_vendeur,
    'escompte', case when v_pro then 'Escompte pour paiement anticipé : néant.' else null end,
    'penalites', case when v_pro then 'En cas de retard de paiement : pénalités au taux d''intérêt de la BCE majoré de 10 points et indemnité forfaitaire pour frais de recouvrement de 40 € (C. com. art. L441-10 et D441-5) — sans objet pour une facture acquittée.' else null end,
    'categorie', case when exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'isProd', '') = 'true')
                       and exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'isProd', '') <> 'true' and coalesce(e->>'isSep', '') <> 'true' and coalesce(e->>'isAcompteData', '') <> 'true')
                      then 'Prestations de services et livraisons de biens'
                      when exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'isProd', '') = 'true') then 'Livraisons de biens'
                      else 'Prestations de services' end,
    'rectifie', case when v_orig.id is not null then 'Avoir rectifiant la facture ' || coalesce(v_orig.numero, v_orig.num::text) || ' du ' || to_char(v_orig.date_facture, 'DD/MM/YYYY') else null end,
    'origine_numero', case when v_orig.id is not null then coalesce(v_orig.numero, v_orig.num::text) else null end);
  -- numérotation continue par établissement (une seule série F- / A-, sous verrou), chaînage de l'empreinte
  perform pg_advisory_xact_lock(hashtext('factures_clients_' || t.salon_id::text));
  select coalesce(max(num), 0) + 1 into v_num from public.factures_clients where salon_id = t.salon_id;
  select hash into v_prev from public.factures_clients where salon_id = t.salon_id order by num desc limit 1;
  v_numero := (case when v_type = 'avoir' then 'A-' else 'F-' end) || lpad(v_num::text, 6, '0');
  v_hash := upper(encode(extensions.digest('FC|' || v_num || '|' || v_type || '|' || to_char(v_jour, 'YYYY-MM-DD') || '|' || coalesce(t.raw_data->>'tkNum', t.num::text) || '|' ||
            to_char(t.total_ttc, 'FM999999990.00') || '|' || to_char(t.total_ht, 'FM999999990.00') || '|' || coalesce(t.hash, '') || '|' || v_nom || '|' ||
            coalesce(v_prev, '') || '|' || coalesce(s.siret, ''), 'sha256'), 'hex'));
  insert into public.factures_clients (salon_id, num, numero, type, ticket_id, ticket_num, facture_origine_id, date_operation,
      client_nom, client_prenom, client_adresse, client_cp, client_ville, client_email, client_telephone, client_siret, client_siren, client_tva_intracom, client_type,
      salon_nom, salon_siret, salon_adresse, salon_tva_intracom, salon_forme, salon_rue, salon_cp, salon_ville, salon_pays, salon_rcs, salon_capital,
      date_facture, heure_facture, ts_created,
      items, lignes, total_ht, total_tva, total_ttc, taux_tva, par_taux, mode_paiement, mentions, hash, hash_algo, hash_prev, operator_name, mode_caisse)
  values (t.salon_id, v_num, v_numero, v_type, t.id, coalesce(t.raw_data->>'tkNum', t.num::text), v_orig.id, t.date_ticket,
      v_nom, v_prenom, v_adr, v_cp, v_ville, v_email, v_tel, v_siret, v_siren, v_tvacli, case when v_pro then 'professionnel' else 'particulier' end,
      s.nom, s.siret, concat_ws(', ', nullif(btrim(s.adresse), ''), nullif(concat_ws(' ', nullif(btrim(s.cp), ''), nullif(btrim(s.ville), '')), '')),
      case when v_franchise then null else v_tva_v end, v_forme, btrim(s.adresse), btrim(s.cp), btrim(s.ville), 'FR', v_rcs, s.capital_social,
      v_jour, (now() at time zone 'Europe/Paris')::time, now(),
      v_items, v_lignes, t.total_ht, t.total_tva, t.total_ttc, t.taux_tva, v_par, t.mode_paiement, v_mentions, v_hash, 'SHA-256', coalesce(v_prev, ''), left(p_operateur, 120),
      'reel')
  returning id into v_id;
  insert into public.audit_log (salon_id, action, details, operator_name)
  values (t.salon_id, case when v_type = 'avoir' then 'FACTURE_AVOIR_EMISE' else 'FACTURE_EMISE' end,
          v_numero || ' pour le ticket n° ' || coalesce(t.raw_data->>'tkNum', t.num::text) || ' (' || to_char(t.total_ttc, 'FM999999990.00') || ' EUR TTC). Empreinte ' || v_hash, coalesce(left(p_operateur, 120), 'Luxyra'));
  return jsonb_build_object('ok', true, 'id', v_id, 'num', v_num, 'numero', v_numero, 'type', v_type, 'hash', v_hash);
end $$;
revoke all on function public.lx_facture_emettre(uuid, jsonb, text) from public, anon;
grant execute on function public.lx_facture_emettre(uuid, jsonb, text) to authenticated, service_role;
