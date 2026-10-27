-- =====================================================================================================================
-- 2026-10-28 (-2) — RECETTES ENCAISSÉES EN LIGNE = TICKET DE CAISSE SCELLÉ CRÉÉ PAR LE SERVEUR AU PAIEMENT CONFIRMÉ
-- Luxyra 6.8.0 (version MINEURE) — NON APPLIQUÉ. À passer par Alexandre dans l'éditeur SQL (ordre en bas de fichier).
-- Idempotent (create or replace / if not exists / drop trigger if exists). Ne crée AUCUN ticket tant que
-- app_config.config.recettes_en_ligne_serveur <> true (interrupteur, posé en DERNIER, après publication des pages).
--
-- Constats corrigés (audit indépendant du 27-28/10/2026) : C1 bons cadeaux vendus en ligne sans ticket ; C2 cartes
-- d'abonnement payées en ligne sans ticket ; M7 acomptes en ligne / acomptes conservés / empreintes ticketés seulement
-- quand un appareil ouvre l'application, Click & Collect payé jamais remis = jamais en caisse ; M5 empreinte capturée en
-- partie : ticket au montant autorisé au lieu du montant prélevé.
--
-- Règles (sources : voir docs/registre-interventions-nf525.md, intervention du 28/10/2026 -2) :
--  - toute recette encaissée par le système (paiement en ligne compris) est enregistrée et sécurisée : CGI art. 286-I-3° bis ;
--    BOI-TVA-DECLA-30-10-30 (version du 25/03/2026) § 30, § 35, § 37 (exemple 3 : commandes payées en ligne et retirées en
--    magasin), § 40, § 50 ;
--  - TVA des prestations de services exigible à l'encaissement, acomptes compris : CGI art. 269-2-c ; BOI-TVA-BASE-20-20 § 30, § 70 ;
--  - acomptes sur livraisons de biens : TVA exigible à l'encaissement, à concurrence du montant encaissé, depuis le 1/1/2023
--    (loi n° 2021-1900 du 30/12/2021, art. 30) : CGI art. 269-2-a ; BOI-TVA-BASE-20-10 (version du 21/12/2022) § 10, § 65 ;
--  - bons : CGI art. 256 ter ; BOI-TVA-CHAMP-10-10-40-50 (version du 14/02/2024) § 40, § 60-90 ; BOI-TVA-BASE-20-40 § 270-293 ;
--  - remboursement / annulation : opération « en moins », document rectificatif référençant l'original : CGI art. 272-1 ;
--    BOI-TVA-DED-40-10-20 § 1, § 30, § 60-80 ; BOI-TVA-DECLA-30-10-30 § 90.
--
-- CONCEPTION (la chaîne de scellement est celle de tous les tickets, AUCUN format modifié) :
--  - le serveur INSÈRE dans public.tickets : numéro, chaînage (hash_prev) et empreinte SHA-256 par le déclencheur existant
--    ticket_nf525_insert (verrou pg_advisory_xact_lock par établissement, format num|date|heure|ttc|ht|items|prev|salon) ;
--    refus d'une journée clôturée par tickets_block_post_cloture ; mode test / réel posé par nf525_marquer_mode ; sceau
--    nf525_hash_seal par _nf525_seal_row ; signature ES256 « TK » par la fonction nf525-sign (tâche planifiée existante, qui
--    détecte tout ticket non signé : lx_prive.nf525_signature_en_attente) ;
--  - le même enregistrement est recopié dans public.appointments (même identifiant que raw_data.id), exactement comme
--    l'application le fait pour chacun de ses tickets (saveAppointment + saveTicketToDb) : planning, Z de l'application,
--    exports (FEC, Excel, ZIP, rapport, livre des recettes, URSSAF, EBP, Quadratus, envoi au comptable) le lisent déjà ;
--  - n° imprimé (raw_data.tkNum, appointments.ticket_num) : suite de la numérotation imprimée de l'établissement, calculée
--    sous le même verrou (max des n° imprimés des tickets et des rendez-vous + 1) ;
--  - le ticket est daté du jour (heure de Paris) où il est créé ; journée déjà clôturée (Z faite) -> le ticket attend dans
--    public.recettes_en_ligne et la tâche de rattrapage le crée le lendemain (jamais antidaté), date de règlement conservée
--    (raw_data.datePaiement), comme le faisait l'application ;
--  - DÉCLENCHEMENT : déclencheurs BEFORE UPDATE (nommés « zz_… » : exécutés après les déclencheurs existants) sur
--    rdv_online, commandes_online, cartes_cadeaux, cartes_abo_clients : le ticket est créé DANS LA MÊME TRANSACTION que
--    l'enregistrement du paiement (webhook Stripe, retour de page, capture d'empreinte, remboursement) — quel que soit le
--    chemin (worker, edge function, application), et sans attendre l'ouverture de l'application. Toute erreur est
--    rattrapée : l'enregistrement du paiement n'échoue JAMAIS à cause du ticket (file + tâche de rattrapage + alerte) ;
--  - idempotence : clé unique par événement (raw_data.recetteKey, index unique) + clés historiques de l'application
--    (raw_data.acompteKey, raw_data.retenueKey, index uniques existants) : jamais deux tickets pour un même paiement, y
--    compris avec une ancienne version de l'application encore ouverte sur un appareil.
--
-- TRAITEMENTS (CA = chiffre d'affaires ; « en ligne » = poste de règlement enligne, compte 580100 dans le FEC) :
--  acompte RDV (nouveau modèle)  : ticket « Acompte en ligne » au paiement, TVA prestations ; remboursement = ticket négatif
--  remboursement d'acompte       : un ticket négatif par entrée de rdv_online.remboursements (clé = refund_id)
--  acompte conservé (ancien mod.): ticket « Acompte conservé » à la décision (retenue_at), montant conservé
--  empreinte capturée            : ticket « Empreinte encaissée », montant RÉELLEMENT PRÉLEVÉ (empreinte_captured_amount)
--  bon cadeau vendu en ligne     : modèle bons v2 actif : BUU -> TVA à la vente (taux du bon) ; BUM -> ticket hors champ
--                                  (HT = TTC, TVA 0, taux 0 : TVA à l'utilisation) ; modèle inactif / bon sans qualification ->
--                                  traitement historique de l'application (vente comptée en CA, TVA au taux des prestations,
--                                  déduction à l'utilisation) : TVA déclarée au plus tôt, jamais omise
--  carte d'abonnement            : ticket au paiement, TVA prestations (droit à remise pendant la durée de la carte : prestation
--                                  de services payée d'avance) ; aucune re-taxation à l'usage (la remise réduit le prix taxé)
--  Click & Collect payé en ligne : ticket au paiement (lignes produits, TVA par taux) ; remise au client : AUCUN ticket ;
--                                  annulation remboursée : ticket négatif inverse (mêmes HT / TVA, au centime)
--  remboursement fait hors Luxyra: (tableau de bord Stripe) public.lx_recette_remboursement_externe, appelée par le worker
--                                  sur l'évènement charge.refunded : ticket négatif (ou entrée de remboursement d'acompte)
--
-- CE QUE CE SQL NE FAIT PAS : aucun ticket, clôture, signature, JET existant n'est modifié ; ticket_nf525_insert,
-- tickets_block_post_cloture, nf525_marquer_mode, _nf525_seal_row, clotures_controle_journal, nf525-sign : INCHANGÉS.
-- =====================================================================================================================

begin;

-- ===================================================================================================================== §0
-- Garde : les fonctions de la chaîne de scellement doivent être celles relues le 28/10/2026 (sinon : relire avant d'appliquer)
do $$ begin
  if position('pg_advisory_xact_lock(hashtext(NEW.salon_id::text))' in pg_get_functiondef('public.ticket_nf525_insert()'::regprocedure)) = 0 then
    raise exception 'ticket_nf525_insert : version en base différente de celle relue le 28/10/2026 — relire avant d''appliquer';
  end if;
  if to_regprocedure('public.tickets_block_post_cloture()') is null or to_regprocedure('public.nf525_marquer_mode()') is null then
    raise exception 'chaîne de scellement incomplète (tickets_block_post_cloture / nf525_marquer_mode)';
  end if;
end $$;

-- ===================================================================================================================== §1
-- Colonnes (aucune donnée existante modifiée)
alter table public.rdv_online        add column if not exists empreinte_captured_amount numeric;
comment on column public.rdv_online.empreinte_captured_amount is 'Montant RÉELLEMENT prélevé à la capture de l''empreinte (Stripe amount_received / 100). NULL = capture antérieure au 28/10/2026 (montant = empreinte_amount).';
alter table public.commandes_online  add column if not exists recette_tk_num integer;
alter table public.commandes_online  add column if not exists recette_remb_tk_num integer;
comment on column public.commandes_online.recette_tk_num is 'N° imprimé du ticket scellé créé par le serveur au paiement en ligne (Click & Collect). Remise au client : aucun nouveau ticket.';
comment on column public.commandes_online.recette_remb_tk_num is 'N° imprimé du ticket négatif (annulation remboursée).';
alter table public.cartes_abo_clients add column if not exists recette_tk_num integer;
alter table public.cartes_abo_clients add column if not exists montant_paye numeric;
alter table public.cartes_abo_clients add column if not exists payment_intent_id text;
comment on column public.cartes_abo_clients.recette_tk_num is 'N° imprimé du ticket scellé créé par le serveur au paiement en ligne de la carte.';

-- ===================================================================================================================== §2
-- File / trace des recettes en ligne (hors périmètre de scellement : le ticket, lui, est scellé)
create table if not exists public.recettes_en_ligne (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null,
  source text not null check (source in ('acompte','acompte_remb','retenue','empreinte','bon_cadeau','carte_abo','click_collect','click_collect_annul','remb_externe')),
  objet_id uuid not null,
  cle text not null,
  montant numeric not null,
  paye_at timestamptz,
  payment_intent text,
  refund_id text,
  details jsonb not null default '{}'::jsonb,
  statut text not null default 'a_ticketer' check (statut in ('a_ticketer','tickete','ignore')),
  ticket_id uuid,
  ticket_num integer,
  tk_num integer,
  date_ticket date,
  essais integer not null default 0,
  derniere_erreur text,
  created_at timestamptz not null default now(),
  traite_at timestamptz,
  constraint recettes_en_ligne_cle_unique unique (salon_id, cle)
);
create index if not exists recettes_en_ligne_attente on public.recettes_en_ligne (created_at) where statut = 'a_ticketer';
create index if not exists recettes_en_ligne_pi on public.recettes_en_ligne (payment_intent) where payment_intent is not null;
alter table public.recettes_en_ligne enable row level security;
drop policy if exists recettes_en_ligne_lecture on public.recettes_en_ligne;
create policy recettes_en_ligne_lecture on public.recettes_en_ligne for select to authenticated
  using (exists (select 1 from public.salons s where s.id = recettes_en_ligne.salon_id and s.user_id = auth.uid()) or public.is_admin());
revoke all on public.recettes_en_ligne from anon, authenticated;
grant select on public.recettes_en_ligne to authenticated;
grant select, insert, update, delete on public.recettes_en_ligne to service_role;

-- Clé d'idempotence générique des tickets serveur (en plus de acompteKey / retenueKey existantes)
create unique index if not exists tickets_recette_key_unique on public.tickets (salon_id, (raw_data->>'recetteKey')) where raw_data ? 'recetteKey';

-- ===================================================================================================================== §3
-- Outils
create or replace function lx_prive.recettes_serveur_actif()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (config->>'recettes_en_ligne_serveur')::boolean from public.app_config where id = 1), false)
$$;
-- Arrondi au centime IDENTIQUE à l'application (Math.round(x*100)/100 : demi vers +infini)
create or replace function lx_prive.r2(x numeric)
returns numeric language sql immutable as $$ select floor(coalesce(x,0) * 100 + 0.5) / 100 $$;
create or replace function lx_prive.date_fr(d date)
returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY') $$;

-- Poste de caisse « Serveur (paiements en ligne) » : enregistré une fois par établissement (nf525_postes + JET 126, comme
-- l'enregistrement d'un appareil par public.nf525_poste). Caisse logique C01 inchangée dans les données signées.
create or replace function lx_prive.recette_poste(p_salon uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_n int;
begin
  select code into v_code from public.nf525_postes where salon_id = p_salon and device_id = 'serveur-paiements-en-ligne';
  if v_code is not null then return v_code; end if;
  perform pg_advisory_xact_lock(hashtext('nf525_poste_' || p_salon::text));
  select code into v_code from public.nf525_postes where salon_id = p_salon and device_id = 'serveur-paiements-en-ligne';
  if v_code is not null then return v_code; end if;
  select count(*) into v_n from public.nf525_postes where salon_id = p_salon;
  v_code := 'P' || lpad((v_n + 1)::text, 2, '0');
  insert into public.nf525_postes(salon_id, device_id, code, libelle) values (p_salon, 'serveur-paiements-en-ligne', v_code, 'Serveur (paiements en ligne)');
  perform public.nf525_jet_ajouter(p_salon, 126, 'Ajout du poste ' || v_code || ' (Serveur - paiements en ligne) sur la caisse C01', 'Serveur Luxyra');
  return v_code;
end $$;

-- HT / TVA d'un ticket serveur : MÊMES règles que saveTicketToDb (luxyra-supabase.js) :
--  - taux d'une ligne = taux propre (tvaTaux, hors franchise) sinon produits (isProd) sinon prestations ;
--  - un seul taux -> HT = arrondi(TTC / (1 + t)) ; plusieurs -> TTC réparti par taux (dernier = reste), HT par taux ;
--    ordre des taux = ordre de Object.keys (clés entières croissantes, puis ordre d'apparition) ;
--  - ligne de bon à usage multiple (isBon + bonUsage BUM) : hors CA, HT = TTC, TVA 0 ; ticket de BUM seul -> taux 0.
create or replace function lx_prive.recette_ht_tva(p_salon uuid, p_items jsonb, p_ttc numeric)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_s numeric; v_p numeric; v_hc numeric := 0; v_ca numeric; v_ht numeric := 0; v_tva numeric; v_reste numeric; v_somme numeric := 0;
  r record; v_n int := 0; v_i int := 0; v_ttcr numeric; v_taux_col numeric; v_t1 numeric;
begin
  select coalesce(taux_tva, 20), coalesce(taux_tva_produits, coalesce(taux_tva, 20)) into v_s, v_p from public.salons where id = p_salon;
  v_s := coalesce(v_s, 20); v_p := coalesce(v_p, v_s); if v_s = 0 then v_p := 0; end if;
  -- lignes : montant, ligne de BUM (hors CA), taux de la ligne
  select coalesce(sum(m) filter (where bum), 0), coalesce(sum(m) filter (where not bum), 0), count(distinct t) filter (where not bum), min(t) filter (where not bum)
    into v_hc, v_somme, v_n, v_t1
    from (select coalesce((e.value->>'price')::numeric,0) * coalesce(nullif(e.value->>'qty','')::numeric,1) - coalesce((e.value->>'remise')::numeric,0) m,
                 (coalesce((e.value->>'isBon')::boolean,false) and e.value->>'bonUsage' = 'BUM') bum,
                 case when v_s > 0 and (e.value->>'tvaTaux') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.value->>'tvaTaux')::numeric
                      when coalesce((e.value->>'isProd')::boolean,false) then v_p else v_s end t
            from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) e where not coalesce((e.value->>'isSep')::boolean,false)) l;
  v_hc := lx_prive.r2(v_hc);
  v_ca := lx_prive.r2(coalesce(p_ttc, 0) - v_hc);
  if v_n = 0 then
    v_ht := case when v_s = 0 then v_ca else lx_prive.r2(v_ca / (1 + v_s / 100)) end;
  elsif v_n = 1 then
    v_ht := lx_prive.r2(v_ca / (1 + v_t1 / 100));
  else
    v_reste := v_ca;
    for r in
      select t, trim_scale(t)::text k, sum(m) amt, min(pos) pos from (
        select e.ordinality pos, coalesce((e.value->>'price')::numeric,0) * coalesce(nullif(e.value->>'qty','')::numeric,1) - coalesce((e.value->>'remise')::numeric,0) m,
               case when v_s > 0 and (e.value->>'tvaTaux') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.value->>'tvaTaux')::numeric
                    when coalesce((e.value->>'isProd')::boolean,false) then v_p else v_s end t
          from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality e
         where not coalesce((e.value->>'isSep')::boolean,false) and not (coalesce((e.value->>'isBon')::boolean,false) and e.value->>'bonUsage' = 'BUM')) l
      group by t order by (trim_scale(t)::text ~ '^[0-9]+$') desc, case when trim_scale(t)::text ~ '^[0-9]+$' then t end, min(pos)
    loop
      v_i := v_i + 1;
      v_ttcr := case when v_i = v_n then v_reste else lx_prive.r2(case when abs(v_somme) > 0.004 then r.amt / v_somme * v_ca else 0 end) end;
      v_reste := lx_prive.r2(v_reste - v_ttcr);
      v_ht := v_ht + lx_prive.r2(v_ttcr / (1 + r.t / 100));
    end loop;
    v_ht := lx_prive.r2(v_ht);
  end if;
  v_ht := lx_prive.r2(v_ht + v_hc);
  v_tva := lx_prive.r2(coalesce(p_ttc, 0) - v_ht);
  v_taux_col := case when abs(v_hc) > 0.004 and abs(v_ca) < 0.005 then 0 else v_s end;
  return jsonb_build_object('ht', v_ht, 'tva', v_tva, 'taux', v_taux_col, 'horsCa', v_hc);
end $$;

-- Fiche client de l'établissement liée à un compte Luxyra (une seule, non fusionnée) ; sinon NULL (« passage »)
create or replace function lx_prive.recette_client(p_salon uuid, p_luxyra uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid; v_n int;
begin
  if p_luxyra is null then return null; end if;
  begin
    select count(*), min(id::text)::uuid into v_n, v from public.clients where salon_id = p_salon and client_luxyra_id = p_luxyra and fusionne_dans is null;
  exception when others then return null; end;
  return case when v_n = 1 then v else null end;
end $$;

-- ===================================================================================================================== §4
-- CŒUR : insertion d'un ticket serveur (tickets + appointments). Retourne {ticket_id, num, tk_num, date, hash, deja}.
-- p_cles : clés d'idempotence à poser dans raw_data (recetteKey toujours ; acompteKey / retenueKey pour la compatibilité
-- avec l'application). Lève LX_JOUR_CLOS si la journée du jour (Paris) est déjà clôturée.
create or replace function lx_prive.recette_tk_inserer(
  p_salon uuid, p_cles jsonb, p_items jsonb, p_ttc numeric, p_client uuid, p_client_nom text, p_client_prenom text,
  p_collab integer, p_sid integer, p_comment text, p_extra jsonb, p_ht_tva jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := clock_timestamp(); v_date date; v_heure time; v_hm text; v_tk int; v_id uuid := gen_random_uuid();
  v_t record; v_calc jsonb; v_raw jsonb; v_meta jsonb; v_pay jsonb; v_poste text; v_coll_nom text; v_coll int; k text;
  v_meta_cles text[] := array['operator_name','poste','ts','clientNom','clientPrenom','isAcompte','isAcompteCancel','apptId','isRetenue',
    'retenueKey','retenueRdv','origTkNum','origTkNums','dbNum','isAcompteEnLigne','acompteKey','acompteRdv','datePaiement',
    'dateRemboursement','refundId','serveur','recetteKey','recetteType','ccCommandeId','ccNumero','bonCode','bonId','carteAboId','recetteRef'];
begin
  perform pg_advisory_xact_lock(hashtext(p_salon::text)); -- même verrou que ticket_nf525_insert (réentrant dans la transaction)
  -- idempotence : ticket déjà créé pour cet évènement (serveur ou application)
  for k in select jsonb_object_keys(p_cles) loop
    select id, num, date_ticket, hash, (raw_data->>'tkNum') tkn into v_t from public.tickets
     where salon_id = p_salon and raw_data->>k = p_cles->>k limit 1;
    if found then
      return jsonb_build_object('ticket_id', v_t.id, 'num', v_t.num, 'tk_num', coalesce(nullif(v_t.tkn,'')::int, v_t.num), 'date', v_t.date_ticket, 'hash', v_t.hash, 'deja', true);
    end if;
  end loop;
  v_date := (v_now at time zone 'Europe/Paris')::date;
  v_heure := date_trunc('second', (v_now at time zone 'Europe/Paris')::time);
  v_hm := to_char(v_heure, 'HH24:MI');
  if exists (select 1 from public.clotures where salon_id = p_salon and date_cloture = v_date) then
    raise exception 'LX_JOUR_CLOS : journée du % déjà clôturée, ticket reporté à la journée suivante', v_date using errcode = 'P0001';
  end if;
  -- n° imprimé : suite de la numérotation imprimée de l'établissement (tickets du journal ET rendez-vous encaissés)
  select greatest(
    coalesce((select max((raw_data->>'tkNum')::int) from public.tickets where salon_id = p_salon and (raw_data->>'tkNum') ~ '^[0-9]{1,9}$'), 0),
    coalesce((select max(ticket_num) from public.appointments where salon_id = p_salon), 0),
    coalesce((select max(num) from public.tickets where salon_id = p_salon), 0)) + 1 into v_tk;
  v_calc := coalesce(p_ht_tva, lx_prive.recette_ht_tva(p_salon, p_items, p_ttc));
  v_poste := lx_prive.recette_poste(p_salon);
  select id, nom into v_coll, v_coll_nom from public.collaborateurs where salon_id = p_salon and id = p_collab;
  v_pay := jsonb_build_array(jsonb_build_object('method', 'En ligne (Stripe)', 'amount', p_ttc));
  v_raw := jsonb_build_object('id', v_id, 'cId', coalesce(p_client::text, 'passage'), 'fromCaisse', true, 'sId', p_sid, 'stId', v_coll,
    'date', v_date, 'time', v_hm, 'heureEncaiss', v_hm, 'ts', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'pr', p_ttc, 'brutTotal', p_ttc, 'remise', 0, 'items', p_items, 'st', 'done', 'met', 'En ligne (Stripe)', 'payments', v_pay,
    'tkNum', v_tk, 'clientNom', p_client_nom, 'clientPrenom', p_client_prenom, 'comment', p_comment, 'poste', v_poste,
    'operator_name', 'Paiement en ligne (serveur)', 'serveur', true, 'hashAlgo', 'SHA-256')
    || coalesce(p_extra, '{}'::jsonb) || p_cles;
  v_raw := jsonb_strip_nulls(v_raw);
  insert into public.tickets (salon_id, date_ticket, heure_ticket, client_id, client_nom, client_prenom, collaborateur_id, collaborateur_nom,
      items, total_brut, total_remise, total_ttc, total_ht, total_tva, taux_tva, mode_paiement, detail_paiement, status, notes, raw_data)
    values (p_salon, v_date, v_heure, p_client, p_client_nom, p_client_prenom, v_coll, coalesce(v_coll_nom, 'Paiement en ligne'),
      p_items, p_ttc, 0, p_ttc, (v_calc->>'ht')::numeric, (v_calc->>'tva')::numeric, (v_calc->>'taux')::numeric,
      'enligne', jsonb_build_object('enligne', p_ttc), 'paid', p_comment, v_raw)
    returning id, num, hash, hash_prev into v_t;
  if v_t.num is distinct from v_tk then v_raw := v_raw || jsonb_build_object('dbNum', v_t.num); end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_meta from jsonb_each(v_raw) e
   where e.key = any(v_meta_cles) and e.value not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '[]'::jsonb);
  insert into public.appointments (id, salon_id, client_id, service_id, collab_id, date_rdv, heure, prix, brut_total, remise, status,
      mode_paiement, ticket_num, hash, prev_hash, hash_algo, items, comment, a_phases, cancelled, from_caisse, payments, heure_encaissement,
      collab_name, clients, meta)
    values (v_id, p_salon, p_client, p_sid, v_coll, v_date, v_hm, p_ttc, p_ttc, 0, 'done', 'En ligne (Stripe)', v_tk, v_t.hash, coalesce(v_t.hash_prev, ''),
      'SHA-256', p_items, coalesce(p_comment, ''), '[]'::jsonb, false, true, v_pay, v_hm, v_coll_nom, '[]'::jsonb, v_meta);
  return jsonb_build_object('ticket_id', v_t.id, 'num', v_t.num, 'tk_num', v_tk, 'date', v_date, 'hash', v_t.hash, 'deja', false);
end $$;

-- ===================================================================================================================== §5
-- Construction et création du ticket d'un évènement de la file. p_row = ligne source (to_jsonb, valeurs À JOUR).
-- Retourne {ok, tk_num, ...} ou {ok:false, erreur}. Ne lève jamais d'exception (tout est tracé dans la file).
create or replace function lx_prive.recette_traiter(p_q public.recettes_en_ligne, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res jsonb; v_items jsonb; v_cles jsonb; v_extra jsonb := '{}'::jsonb; v_comment text; v_lib text; v_m numeric := p_q.montant;
  v_quand text; v_svc text; v_cli text; v_client uuid; v_dpaie date; v_orig int; v_bon jsonb; v_usage text; v_scope text; v_tb numeric;
  v_s numeric; v_p numeric; v_httva jsonb := null; v_src record; v_it jsonb; v_lignes jsonb := '[]'::jsonb; v_err text;
begin
  if p_q.statut = 'tickete' then return jsonb_build_object('ok', true, 'tk_num', p_q.tk_num, 'deja', true); end if;
  v_dpaie := (coalesce(p_q.paye_at, now()) at time zone 'Europe/Paris')::date;
  begin
    if p_q.source in ('acompte','acompte_remb','retenue','empreinte') then
      v_quand := lx_prive.date_fr((p_row->>'date_rdv')::date) || coalesce(' ' || left(p_row->>'heure_rdv', 5), '');
      v_svc := coalesce(nullif(p_row->>'service_nom',''), 'Prestation');
      v_cli := trim(coalesce(p_row->>'client_prenom','') || ' ' || coalesce(p_row->>'client_nom',''));
      v_client := lx_prive.recette_client(p_q.salon_id, nullif(p_row->>'client_luxyra_id','')::uuid);
    end if;
    if p_q.source = 'acompte' then
      v_lib := 'Acompte en ligne - ' || v_svc || ' (RDV du ' || v_quand || ', payé le ' || lx_prive.date_fr(v_dpaie) || ')';
      v_items := jsonb_build_array(jsonb_build_object('name', v_lib, 'price', v_m, 'qty', 1, 'remise', 0, 'ci', 0, 'isAcompte', true, 'isAcompteEnLigne', true));
      v_cles := jsonb_build_object('recetteKey', p_q.cle, 'acompteKey', 'acompte:' || p_q.objet_id);
      v_extra := jsonb_build_object('isAcompte', true, 'isAcompteEnLigne', true, 'acompteRdv', p_q.objet_id, 'apptId', 'online_' || p_q.objet_id,
        'datePaiement', v_dpaie, 'recetteType', 'acompte');
      v_comment := 'Acompte payé en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe) pour le RDV du ' || v_quand || ' - ' || v_cli;
    elsif p_q.source = 'acompte_remb' then
      v_orig := nullif(p_row->>'acompte_tk_num','')::int;
      if v_orig is null then raise exception 'LX_ATTENTE : ticket d''acompte pas encore créé'; end if;
      v_lib := 'Remboursement acompte en ligne (ticket #' || v_orig || ') - ' || v_svc || ' (RDV du ' || v_quand || ', remboursé le '
        || lx_prive.date_fr(v_dpaie) || ', ' || case p_q.details->>'par' when 'etablissement' then 'par l’établissement' when 'politique' then 'politique d’annulation'
           when 'trop_percu' then 'trop-perçu rendu avant l’encaissement' when 'externe' then 'remboursement fait sur Stripe' else 'annulation' end || ')';
      v_items := jsonb_build_array(jsonb_build_object('name', v_lib, 'price', -v_m, 'qty', 1, 'remise', 0, 'ci', 0, 'isAcompteCancel', true,
        'isAcompteEnLigne', true, 'origTkNum', v_orig, 'origTkNums', jsonb_build_array(v_orig)));
      v_cles := jsonb_build_object('recetteKey', p_q.cle, 'acompteKey', 'rembacompte:' || p_q.objet_id || ':' || coalesce(p_q.refund_id, p_q.details->>'at'));
      v_extra := jsonb_build_object('isAcompteCancel', true, 'isAcompteEnLigne', true, 'origTkNum', v_orig, 'origTkNums', jsonb_build_array(v_orig),
        'acompteRdv', p_q.objet_id, 'apptId', 'online_' || p_q.objet_id, 'dateRemboursement', v_dpaie, 'refundId', p_q.refund_id, 'recetteType', 'acompte_remb');
      v_comment := 'Remboursement Stripe du ' || lx_prive.date_fr(v_dpaie) || ' de l’acompte en ligne (ticket #' || v_orig || ') - RDV du ' || v_quand || ' - ' || v_cli;
      v_m := -v_m;
    elsif p_q.source in ('retenue','empreinte') then
      v_lib := case when p_q.source = 'retenue'
        then 'Acompte conservé - ' || v_svc || ' (RDV du ' || v_quand || ', ' || case p_row->>'cancelled_by' when 'no_show' then 'client absent' when 'client' then 'annulation hors délai' else 'conditions d’annulation' end || ')'
        else 'Empreinte encaissée - ' || v_svc || ' (RDV du ' || v_quand || ', client absent)' end;
      v_items := jsonb_build_array(jsonb_build_object('name', v_lib, 'price', v_m, 'qty', 1, 'remise', 0, 'ci', 0, 'isRetenue', true));
      v_cles := jsonb_build_object('recetteKey', p_q.cle, 'retenueKey', p_q.source || ':' || p_q.objet_id);
      v_extra := jsonb_build_object('isRetenue', true, 'retenueRdv', p_q.objet_id, 'datePaiement', v_dpaie, 'recetteType', p_q.source);
      v_comment := case when p_q.source = 'retenue' then 'Acompte payé en ligne et conservé' else 'Empreinte bancaire capturée' end || ' - RDV du ' || v_quand || ' - ' || v_cli;
    elsif p_q.source = 'bon_cadeau' then
      v_usage := nullif(p_row->>'usage_tva', ''); v_bon := p_row->'qualif_tva'; v_scope := coalesce(nullif(p_row->>'scope',''), 'tout');
      select coalesce(taux_tva, 20), coalesce(taux_tva_produits, coalesce(taux_tva, 20)) into v_s, v_p from public.salons where id = p_q.salon_id;
      if v_s = 0 then v_p := 0; end if;
      v_it := jsonb_build_object('sId', null, 'name', 'Bon cadeau ' || coalesce(p_row->>'code','') || ' (vente en ligne)', 'price', v_m, 'qty', 1, 'remise', 0, 'isBon', true, 'bonCode', p_row->>'code');
      if v_usage = 'BUM' then
        v_it := v_it || jsonb_build_object('bonUsage', 'BUM', 'bonScope', v_scope);
      elsif v_usage = 'BUU' then
        v_tb := nullif(v_bon->>'tauxBon','')::numeric;
        v_it := v_it || jsonb_build_object('bonUsage', 'BUU', 'bonScope', v_scope, 'bonTaux', v_tb);
        if v_scope = 'produits' then v_it := v_it || '{"isProd":true}'::jsonb; end if;
        if v_s > 0 and v_tb is not null and v_tb <> (case when v_scope = 'produits' then v_p else v_s end) then v_it := v_it || jsonb_build_object('tvaTaux', v_tb); end if;
      end if; -- sans qualification (modèle bons v2 inactif / bon antérieur) : ligne historique de l'application (CA, taux des prestations)
      v_items := jsonb_build_array(v_it);
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('bonCode', p_row->>'code', 'bonId', p_q.objet_id, 'datePaiement', v_dpaie, 'recetteType', 'bon_cadeau');
      v_comment := 'Bon cadeau ' || coalesce(p_row->>'code','') || ' vendu en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe)'
        || coalesce(' - offert par ' || nullif(p_row->>'de',''), '') || case when v_usage = 'BUM' then ' - bon à usage multiple : TVA à l''utilisation (CGI art. 256 ter)' else '' end;
      v_cli := nullif(p_row->>'de','');
      v_client := lx_prive.recette_client(p_q.salon_id, nullif(p_row->>'acheteur_luxyra_id','')::uuid);
    elsif p_q.source = 'carte_abo' then
      v_lib := '💳 Carte: ' || coalesce(p_row->>'carte_nom','Carte d''abonnement') || ' (achat en ligne, jusqu''au ' || coalesce(lx_prive.date_fr(nullif(p_row->>'date_expiration','')::date), '?') || ')';
      v_items := jsonb_build_array(jsonb_build_object('sId', null, 'name', v_lib, 'price', v_m, 'qty', 1, 'remise', 0, 'isCarteAbo', true, 'carteAboId', p_q.objet_id));
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('carteAboId', p_q.objet_id, 'datePaiement', v_dpaie, 'recetteType', 'carte_abo');
      v_cli := nullif(p_row->>'client_nom','');
      v_comment := 'Carte d''abonnement payée en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe)' || coalesce(' - ' || v_cli, '');
    elsif p_q.source = 'click_collect' then
      for v_it in select value from jsonb_array_elements(coalesce(p_row->'items', '[]'::jsonb)) loop
        declare v_pid int := nullif(v_it->>'produit_id','')::int; v_tp numeric;
        begin
          select tva_taux into v_tp from public.produits where id = v_pid and salon_id = p_q.salon_id;
          v_lignes := v_lignes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('sId', null, 'name', v_it->>'nom', 'price', (v_it->>'prix')::numeric,
            'qty', coalesce(nullif(v_it->>'qty','')::numeric, 1), 'remise', 0, 'isProd', true, 'prodId', v_pid, 'tvaTaux', v_tp)));
        end;
      end loop;
      v_items := v_lignes;
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('ccCommandeId', p_q.objet_id, 'ccNumero', nullif(p_row->>'numero','')::int, 'datePaiement', v_dpaie, 'recetteType', 'click_collect');
      v_cli := nullif(p_row->>'client_nom','');
      v_client := lx_prive.recette_client(p_q.salon_id, nullif(p_row->>'client_luxyra_id','')::uuid);
      v_comment := 'Click & Collect n°' || coalesce(p_row->>'numero','') || ' payé en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe) - remise au client sans nouveau ticket';
    elsif p_q.source in ('click_collect_annul','remb_externe') then
      -- ticket négatif : lignes de l'original inversées (au prorata si remboursement partiel), HT / TVA inversés au centime
      select t.* into v_src from public.tickets t where t.salon_id = p_q.salon_id and t.id = (p_q.details->>'ticket_id')::uuid;
      if not found then raise exception 'LX_ATTENTE : ticket d''origine introuvable'; end if;
      v_orig := coalesce(nullif(v_src.raw_data->>'tkNum','')::int, v_src.num);
      declare v_f numeric := case when abs(v_src.total_ttc) > 0.004 then v_m / v_src.total_ttc else 0 end; v_tot numeric := 0; v_n int := 0; v_k int := 0;
      begin
        select count(*) into v_n from jsonb_array_elements(v_src.items) e where not coalesce((e.value->>'isSep')::boolean, false);
        for v_it in select value from jsonb_array_elements(v_src.items) loop
          if coalesce((v_it->>'isSep')::boolean, false) then continue; end if;
          v_k := v_k + 1;
          declare v_l numeric := lx_prive.r2((coalesce((v_it->>'price')::numeric,0) * coalesce(nullif(v_it->>'qty','')::numeric,1) - coalesce((v_it->>'remise')::numeric,0)) * v_f);
          begin
            if v_k = v_n then v_l := lx_prive.r2(v_m - v_tot); end if;
            v_tot := v_tot + v_l;
            v_lignes := v_lignes || jsonb_build_array((v_it - 'remise' - 'qty' - 'price') || jsonb_build_object('name', 'Remboursement : ' || coalesce(v_it->>'name',''), 'price', -v_l, 'qty', 1, 'remise', 0,
              'isRembEnLigne', true, 'origTkNum', v_orig));
          end;
        end loop;
        if abs(v_m - v_src.total_ttc) < 0.005 then
          v_httva := jsonb_build_object('ht', -v_src.total_ht, 'tva', -v_src.total_tva, 'taux', v_src.taux_tva);
        end if;
      end;
      v_items := v_lignes;
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('isRembEnLigne', true, 'origTkNum', v_orig, 'origTkNums', jsonb_build_array(v_orig), 'recetteRef', v_src.id,
        'dateRemboursement', v_dpaie, 'refundId', p_q.refund_id, 'recetteType', p_q.source,
        'ccCommandeId', v_src.raw_data->>'ccCommandeId', 'bonCode', v_src.raw_data->>'bonCode', 'carteAboId', v_src.raw_data->>'carteAboId');
      v_cli := coalesce(v_src.client_nom, '');
      v_client := v_src.client_id;
      v_comment := 'Remboursement Stripe du ' || lx_prive.date_fr(v_dpaie) || ' (ticket d''origine #' || v_orig || ' du ' || lx_prive.date_fr(v_src.date_ticket) || ')'
        || case when p_q.source = 'click_collect_annul' then ' - commande Click & Collect annulée' else ' - remboursement fait sur Stripe' end;
      v_m := -v_m;
    else
      raise exception 'source inconnue %', p_q.source;
    end if;
    v_res := lx_prive.recette_tk_inserer(p_q.salon_id, v_cles, v_items, v_m, v_client,
      case when p_q.source in ('acompte','acompte_remb','retenue','empreinte') then nullif(p_row->>'client_nom','') else v_cli end,
      case when p_q.source in ('acompte','acompte_remb','retenue','empreinte') then nullif(p_row->>'client_prenom','') else null end,
      case when p_q.source in ('acompte','acompte_remb','retenue','empreinte') then nullif(p_row->>'collaborateur_id','')::int else null end,
      case when p_q.source in ('acompte','acompte_remb') then nullif(p_row->>'service_id','')::int else null end,
      v_comment, v_extra, v_httva);
    update public.recettes_en_ligne set statut = 'tickete', ticket_id = (v_res->>'ticket_id')::uuid, ticket_num = (v_res->>'num')::int,
      tk_num = (v_res->>'tk_num')::int, date_ticket = (v_res->>'date')::date, traite_at = now(), essais = essais + 1, derniere_erreur = null
     where id = p_q.id;
    if not coalesce((v_res->>'deja')::boolean, false) then
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (p_q.salon_id, case when v_m < 0 then 'AVOIR_TICKET' else 'RECETTE_EN_LIGNE' end,
        'Ticket #' || (v_res->>'tk_num') || ' (n° serveur ' || (v_res->>'num') || ') - ' || p_q.source || ' - ' || to_char(v_m, 'FM999999990.00') || ' EUR - paiement du '
        || lx_prive.date_fr(v_dpaie) || ' - créé par le serveur au paiement confirmé', 'Paiement en ligne (serveur)');
    end if;
    return jsonb_build_object('ok', true) || v_res;
  exception when others then
    v_err := sqlerrm;
    update public.recettes_en_ligne set essais = essais + 1, derniere_erreur = left(v_err, 500) where id = p_q.id;
    if v_err not like 'LX_JOUR_CLOS%' and v_err not like 'LX_ATTENTE%' then
      begin
        perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('Ticket de recette en ligne non créé : ' || v_err, 800), p_severity := 'critical',
          p_context := jsonb_build_object('recette', p_q.id, 'source', p_q.source, 'cle', p_q.cle, 'salon', p_q.salon_id));
      exception when others then null; end;
    end if;
    return jsonb_build_object('ok', false, 'erreur', v_err);
  end;
end $$;

-- File : ajoute l'évènement (une seule fois par clé) et renvoie la ligne
create or replace function lx_prive.recette_enfiler(p_salon uuid, p_source text, p_objet uuid, p_cle text, p_montant numeric,
  p_paye_at timestamptz, p_pi text, p_refund text, p_details jsonb)
returns public.recettes_en_ligne language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.recettes_en_ligne;
begin
  insert into public.recettes_en_ligne (salon_id, source, objet_id, cle, montant, paye_at, payment_intent, refund_id, details)
  values (p_salon, p_source, p_objet, p_cle, lx_prive.r2(p_montant), p_paye_at, p_pi, p_refund, coalesce(p_details, '{}'::jsonb))
  on conflict (salon_id, cle) do nothing;
  select * into v from public.recettes_en_ligne where salon_id = p_salon and cle = p_cle;
  return v;
end $$;

-- ===================================================================================================================== §6
-- DÉCLENCHEURS (BEFORE UPDATE, exécutés en dernier : « zz_ »). Ne bloquent jamais l'écriture du paiement.
create or replace function lx_prive.zz_rdv_online_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb; e jsonb; v_new jsonb; v_k numeric; v_cle text;
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  begin
    -- 1) acompte payé (nouveau modèle) : ticket « Acompte en ligne »
    if NEW.acompte_modele = 'ticket' and coalesce(NEW.acompte_paye, false) and not coalesce(OLD.acompte_paye, false)
       and NEW.acompte_tk_num is null and coalesce(NEW.acompte_montant, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'acompte', NEW.id, 'acompte:' || NEW.id, NEW.acompte_montant, coalesce(NEW.acompte_paye_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.acompte_tk_num := (r->>'tk_num')::int; NEW.acompte_tk_claim_at := coalesce(NEW.acompte_tk_claim_at, now());
      else NEW.acompte_tk_claim_at := coalesce(NEW.acompte_tk_claim_at, now()); end if; -- verrou serveur : l'application ne le crée pas (rattrapage serveur)
    end if;
    -- 2) remboursements (nouveau modèle) : un ticket négatif par entrée sans « tk »
    if NEW.acompte_modele = 'ticket' and NEW.remboursements is distinct from OLD.remboursements then
      v_new := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(NEW.remboursements, '[]'::jsonb)) loop
        if (e->>'tk') is null and coalesce((e->>'montant')::numeric, 0) > 0 and NEW.acompte_tk_num is not null then
          v_cle := 'rembacompte:' || NEW.id || ':' || coalesce(e->>'refund_id', e->>'at');
          q := lx_prive.recette_enfiler(NEW.salon_id, 'acompte_remb', NEW.id, v_cle, (e->>'montant')::numeric, coalesce((e->>'at')::timestamptz, now()),
                 NEW.payment_intent_id, e->>'refund_id', jsonb_build_object('par', e->>'par', 'at', e->>'at'));
          r := lx_prive.recette_traiter(q, to_jsonb(NEW));
          if coalesce((r->>'ok')::boolean, false) then e := e || jsonb_build_object('tk', (r->>'tk_num')::int); end if;
        end if;
        v_new := v_new || jsonb_build_array(e);
      end loop;
      NEW.remboursements := v_new;
    end if;
    -- 3) acompte conservé (ANCIEN modèle uniquement : le nouveau modèle a déjà son ticket au paiement)
    if OLD.retenue_at is null and NEW.retenue_at is not null and coalesce(NEW.acompte_paye, false) and coalesce(NEW.acompte_modele, '') <> 'ticket'
       and not coalesce(NEW.acompte_rembourse, false) and NEW.retenue_tk_num is null and NEW.retenue_claim_at is null then
      v_k := lx_prive.r2(coalesce(NEW.acompte_montant, 0) - coalesce(NEW.acompte_rembourse_montant, 0));
      if v_k > 0 then
        q := lx_prive.recette_enfiler(NEW.salon_id, 'retenue', NEW.id, 'retenue:acompte:' || NEW.id, v_k, NEW.retenue_at, NEW.payment_intent_id, null, '{}');
        r := lx_prive.recette_traiter(q, to_jsonb(NEW));
        if coalesce((r->>'ok')::boolean, false) then NEW.retenue_tk_num := (r->>'tk_num')::int; end if;
        NEW.retenue_claim_at := coalesce(NEW.retenue_claim_at, now());
      end if;
    end if;
    -- 4) empreinte capturée : montant RÉELLEMENT prélevé
    if coalesce(OLD.empreinte_status, '') <> 'captured' and NEW.empreinte_status = 'captured' and NEW.empreinte_tk_num is null
       and coalesce(NEW.empreinte_captured_amount, NEW.empreinte_amount, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'empreinte', NEW.id, 'empreinte:' || NEW.id, coalesce(NEW.empreinte_captured_amount, NEW.empreinte_amount),
             coalesce(NEW.empreinte_captured_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.empreinte_tk_num := (r->>'tk_num')::int; end if;
      NEW.empreinte_claim_at := coalesce(NEW.empreinte_claim_at, now());
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_rdv_online_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('rdv', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

create or replace function lx_prive.zz_commandes_online_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb; v_q0 public.recettes_en_ligne;
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  begin
    if coalesce(NEW.paye, false) and not coalesce(OLD.paye, false) and NEW.recette_tk_num is null and coalesce(NEW.total, 0) > 0
       and coalesce(NEW.mode_paiement, 'en_ligne') = 'en_ligne' then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'click_collect', NEW.id, 'cc:' || NEW.id, NEW.total, coalesce(NEW.paye_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.recette_tk_num := (r->>'tk_num')::int; NEW.ticket_num := coalesce(NEW.ticket_num, (r->>'tk_num')); end if;
    end if;
    if NEW.status = 'annulee' and coalesce(OLD.status, '') <> 'annulee' and coalesce(NEW.paye, false) and NEW.refund_id is not null and NEW.recette_remb_tk_num is null then
      select * into v_q0 from public.recettes_en_ligne where salon_id = NEW.salon_id and cle = 'cc:' || NEW.id;
      if v_q0.id is not null then
        q := lx_prive.recette_enfiler(NEW.salon_id, 'click_collect_annul', NEW.id, 'cc_annul:' || NEW.id, NEW.total, coalesce(NEW.cancelled_at, now()), NEW.payment_intent_id,
               NEW.refund_id, jsonb_build_object('ticket_id', v_q0.ticket_id));
        if v_q0.statut = 'tickete' then
          r := lx_prive.recette_traiter(q, to_jsonb(NEW));
          if coalesce((r->>'ok')::boolean, false) then NEW.recette_remb_tk_num := (r->>'tk_num')::int; end if;
        end if;
      end if;
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_commandes_online_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('commande', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

create or replace function lx_prive.zz_cartes_cadeaux_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb;
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  begin
    if NEW.source = 'web' and NEW.payment_status = 'paid' and coalesce(OLD.payment_status, '') <> 'paid' and not coalesce(NEW.is_offert, false)
       and NEW.tk_num is null and coalesce(NEW.valeur, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'bon_cadeau', NEW.id, 'bon:' || NEW.id, NEW.valeur, now(), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.tk_num := (r->>'tk_num')::int; end if;
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_cartes_cadeaux_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('bon', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

create or replace function lx_prive.zz_cartes_abo_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb;
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  begin
    if coalesce(OLD.status, '') = 'pending_payment' and NEW.status = 'active' and coalesce(NEW.ticket_num, '') like 'cs\_%' and NEW.recette_tk_num is null
       and coalesce(NEW.montant_paye, NEW.tarif, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'carte_abo', NEW.id, 'carte:' || NEW.id, coalesce(NEW.montant_paye, NEW.tarif), now(), NEW.payment_intent_id, null,
             jsonb_build_object('session', NEW.ticket_num));
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.recette_tk_num := (r->>'tk_num')::int; end if;
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_cartes_abo_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('carte', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

drop trigger if exists zz_trg_rdv_online_recettes on public.rdv_online;
create trigger zz_trg_rdv_online_recettes before update on public.rdv_online for each row execute function lx_prive.zz_rdv_online_recettes();
drop trigger if exists zz_trg_commandes_online_recettes on public.commandes_online;
create trigger zz_trg_commandes_online_recettes before update on public.commandes_online for each row execute function lx_prive.zz_commandes_online_recettes();
drop trigger if exists zz_trg_cartes_cadeaux_recettes on public.cartes_cadeaux;
create trigger zz_trg_cartes_cadeaux_recettes before update on public.cartes_cadeaux for each row execute function lx_prive.zz_cartes_cadeaux_recettes();
drop trigger if exists zz_trg_cartes_abo_recettes on public.cartes_abo_clients;
create trigger zz_trg_cartes_abo_recettes before update on public.cartes_abo_clients for each row execute function lx_prive.zz_cartes_abo_recettes();

-- Garde-fou : une ANCIENNE version de l'application (appareil non rechargé) ne doit jamais sceller une 2e fois une commande
-- Click & Collect déjà en caisse par le serveur (remise « Payé en ligne (Click & Collect) »). Refus définitif LX_CC_DEJA_EN_CAISSE.
create or replace function lx_prive.tickets_cc_doublon_controle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_num int; v_tk int;
begin
  if coalesce(NEW.raw_data->>'serveur', '') = 'true' then return NEW; end if;
  if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(NEW.raw_data->'payments') = 'array' then NEW.raw_data->'payments' else '[]'::jsonb end) p
                  where p.value->>'method' = 'Payé en ligne (Click & Collect)') then return NEW; end if;
  v_num := nullif(substring(coalesce(NEW.raw_data->>'comment', NEW.notes, '') from 'Click & Collect n°([0-9]+)'), '')::int;
  if v_num is null then return NEW; end if;
  select recette_tk_num into v_tk from public.commandes_online where salon_id = NEW.salon_id and numero = v_num;
  if v_tk is not null then
    raise exception 'LX_CC_DEJA_EN_CAISSE : la commande n°% payée en ligne est déjà en caisse (ticket #%) : la remise ne crée pas de ticket. Rechargez l''application.', v_num, v_tk using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_tickets_cc_doublon on public.tickets;
create trigger a_lx_tickets_cc_doublon before insert on public.tickets for each row execute function lx_prive.tickets_cc_doublon_controle();

-- ===================================================================================================================== §7
-- RATTRAPAGE (tâche planifiée toutes les 5 min) : évènements en attente (journée clôturée, ticket d'origine pas encore créé,
-- erreur passagère) + filet : paiements enregistrés après la mise en service sans évènement (aucun chemin oublié).
create or replace function lx_prive.recettes_rattrapage()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb; v_row jsonb; v_ok int := 0; v_ko int := 0; v_depuis timestamptz; x record; e jsonb; v_new jsonb;
begin
  if not lx_prive.recettes_serveur_actif() then return jsonb_build_object('actif', false); end if;
  select coalesce((config->>'recettes_en_ligne_serveur_depuis')::timestamptz, now()) into v_depuis from public.app_config where id = 1;
  perform set_config('lx.recette_en_cours', '1', true);
  -- filet : évènements manquants (créés dans la file, traités ci-dessous)
  for x in select * from public.rdv_online where acompte_modele = 'ticket' and acompte_paye and acompte_tk_num is null and coalesce(acompte_montant,0) > 0
            and coalesce(acompte_paye_at, created_at) >= v_depuis and coalesce(status,'') <> 'done' and ticket_num is null and retenue_tk_num is null limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'acompte', x.id, 'acompte:' || x.id, x.acompte_montant, coalesce(x.acompte_paye_at, now()), x.payment_intent_id, null, '{}');
  end loop;
  for x in select * from public.commandes_online where paye and recette_tk_num is null and coalesce(mode_paiement,'en_ligne') = 'en_ligne' and coalesce(paye_at, created_at) >= v_depuis limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'click_collect', x.id, 'cc:' || x.id, x.total, coalesce(x.paye_at, now()), x.payment_intent_id, null, '{}');
  end loop;
  for x in select * from public.cartes_cadeaux where source = 'web' and payment_status = 'paid' and tk_num is null and not coalesce(is_offert,false) and created_at >= v_depuis limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'bon_cadeau', x.id, 'bon:' || x.id, x.valeur, now(), x.payment_intent_id, null, '{}');
  end loop;
  for x in select * from public.cartes_abo_clients where status = 'active' and coalesce(ticket_num,'') like 'cs\_%' and recette_tk_num is null and created_at >= v_depuis limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'carte_abo', x.id, 'carte:' || x.id, coalesce(x.montant_paye, x.tarif), now(), x.payment_intent_id, null, jsonb_build_object('session', x.ticket_num));
  end loop;
  for x in select * from public.rdv_online where empreinte_status = 'captured' and empreinte_tk_num is null and coalesce(empreinte_captured_amount, empreinte_amount, 0) > 0
            and coalesce(empreinte_captured_at, created_at) >= v_depuis limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'empreinte', x.id, 'empreinte:' || x.id, coalesce(x.empreinte_captured_amount, x.empreinte_amount), coalesce(x.empreinte_captured_at, now()), x.payment_intent_id, null, '{}');
  end loop;
  for x in select r.*, e.value ev from public.rdv_online r, jsonb_array_elements(coalesce(r.remboursements,'[]'::jsonb)) e
            where r.acompte_modele = 'ticket' and r.acompte_tk_num is not null and (e.value->>'tk') is null and coalesce((e.value->>'montant')::numeric,0) > 0
              and coalesce((e.value->>'at')::timestamptz, now()) >= v_depuis limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'acompte_remb', x.id, 'rembacompte:' || x.id || ':' || coalesce(x.ev->>'refund_id', x.ev->>'at'), (x.ev->>'montant')::numeric,
      coalesce((x.ev->>'at')::timestamptz, now()), x.payment_intent_id, x.ev->>'refund_id', jsonb_build_object('par', x.ev->>'par', 'at', x.ev->>'at'));
  end loop;
  -- traitement de la file (ordre de création : un acompte passe avant son remboursement)
  for q in select * from public.recettes_en_ligne where statut = 'a_ticketer' order by created_at limit 100 loop
    v_row := case
      when q.source in ('acompte','acompte_remb','retenue','empreinte') then (select to_jsonb(t) from public.rdv_online t where t.id = q.objet_id)
      when q.source in ('click_collect','click_collect_annul') then (select to_jsonb(t) from public.commandes_online t where t.id = q.objet_id)
      when q.source = 'bon_cadeau' then (select to_jsonb(t) from public.cartes_cadeaux t where t.id = q.objet_id)
      when q.source = 'carte_abo' then (select to_jsonb(t) from public.cartes_abo_clients t where t.id = q.objet_id)
      else '{}'::jsonb end;
    if v_row is null then update public.recettes_en_ligne set statut = 'ignore', derniere_erreur = 'objet introuvable' where id = q.id; continue; end if;
    if q.source = 'click_collect_annul' and (q.details->>'ticket_id') is null then
      update public.recettes_en_ligne set details = details || jsonb_build_object('ticket_id', (select ticket_id from public.recettes_en_ligne where salon_id = q.salon_id and cle = 'cc:' || q.objet_id and statut = 'tickete'))
       where id = q.id returning * into q;
      if (q.details->>'ticket_id') is null then continue; end if;
    end if;
    -- acompte : verrou d'une ancienne application posé il y a moins de 15 min -> on la laisse finir (son ticket sera repris par clé)
    if q.source = 'acompte' and (v_row->>'acompte_tk_claim_at') is not null and (v_row->>'acompte_tk_claim_at')::timestamptz > now() - interval '15 minutes'
       and not exists (select 1 from public.recettes_en_ligne z where z.id = q.id and z.essais > 0) then continue; end if;
    r := lx_prive.recette_traiter(q, v_row);
    if coalesce((r->>'ok')::boolean, false) then
      v_ok := v_ok + 1;
      if q.source = 'acompte' then update public.rdv_online set acompte_tk_num = (r->>'tk_num')::int, acompte_tk_claim_at = coalesce(acompte_tk_claim_at, now()) where id = q.objet_id and acompte_tk_num is null;
      elsif q.source = 'retenue' then update public.rdv_online set retenue_tk_num = (r->>'tk_num')::int, retenue_claim_at = coalesce(retenue_claim_at, now()) where id = q.objet_id and retenue_tk_num is null;
      elsif q.source = 'empreinte' then update public.rdv_online set empreinte_tk_num = (r->>'tk_num')::int, empreinte_claim_at = coalesce(empreinte_claim_at, now()) where id = q.objet_id and empreinte_tk_num is null;
      elsif q.source = 'acompte_remb' then
        select coalesce(jsonb_agg(case when (ee.value->>'tk') is null and 'rembacompte:' || q.objet_id || ':' || coalesce(ee.value->>'refund_id', ee.value->>'at') = q.cle
                                       then ee.value || jsonb_build_object('tk', (r->>'tk_num')::int) else ee.value end order by ee.ordinality), '[]'::jsonb)
          into v_new from public.rdv_online t, jsonb_array_elements(coalesce(t.remboursements,'[]'::jsonb)) with ordinality ee where t.id = q.objet_id;
        update public.rdv_online set remboursements = v_new where id = q.objet_id;
      elsif q.source = 'click_collect' then update public.commandes_online set recette_tk_num = (r->>'tk_num')::int, ticket_num = coalesce(ticket_num, r->>'tk_num') where id = q.objet_id;
      elsif q.source = 'click_collect_annul' then update public.commandes_online set recette_remb_tk_num = (r->>'tk_num')::int where id = q.objet_id;
      elsif q.source = 'bon_cadeau' then update public.cartes_cadeaux set tk_num = (r->>'tk_num')::int where id = q.objet_id and tk_num is null;
      elsif q.source = 'carte_abo' then update public.cartes_abo_clients set recette_tk_num = (r->>'tk_num')::int where id = q.objet_id;
      end if;
    else v_ko := v_ko + 1; end if;
  end loop;
  -- alerte : évènement en attente depuis plus de 26 h (hors simple report de journée clôturée)
  if exists (select 1 from public.recettes_en_ligne where statut = 'a_ticketer' and created_at < now() - interval '26 hours') then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Recette(s) en ligne sans ticket depuis plus de 26 h', p_severity := 'critical',
      p_context := (select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'erreur', derniere_erreur)) from (select * from public.recettes_en_ligne where statut = 'a_ticketer' and created_at < now() - interval '26 hours' limit 10) z));
    exception when others then null; end;
  end if;
  perform set_config('lx.recette_en_cours', '', true);
  return jsonb_build_object('actif', true, 'tickets', v_ok, 'en_attente', v_ko);
end $$;

-- ===================================================================================================================== §8
-- Remboursement fait HORS Luxyra (tableau de bord Stripe, litige perdu…) : appelé par le worker sur charge.refunded
-- (évènement relu chez Stripe au nom du compte). Idempotent par refund_id.
create or replace function public.lx_recette_remboursement_externe(p_pi text, p_refund_id text, p_cents bigint, p_at timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.recettes_en_ligne; q public.recettes_en_ligne; r jsonb; v_m numeric := round(coalesce(p_cents,0)::numeric) / 100; v_rdv public.rdv_online;
begin
  if coalesce(p_pi,'') = '' or coalesce(p_refund_id,'') = '' or v_m <= 0 then return jsonb_build_object('ok', false, 'erreur', 'paramètres'); end if;
  -- déjà connu (remboursement fait par Luxyra : acompte, Click & Collect, ou déjà traité ici)
  if exists (select 1 from public.recettes_en_ligne where refund_id = p_refund_id)
     or exists (select 1 from public.commandes_online where refund_id = p_refund_id)
     or exists (select 1 from public.rdv_online r2, jsonb_array_elements(coalesce(r2.remboursements,'[]'::jsonb)) e where r2.payment_intent_id = p_pi and e.value->>'refund_id' = p_refund_id)
     or exists (select 1 from public.rdv_online where refund_id = p_refund_id) then
    return jsonb_build_object('ok', true, 'deja', true);
  end if;
  select * into v_o from public.recettes_en_ligne where payment_intent = p_pi and source in ('acompte','bon_cadeau','carte_abo','click_collect') and statut = 'tickete' order by created_at limit 1;
  if v_o.id is null then return jsonb_build_object('ok', false, 'inconnu', true); end if;
  if v_o.source = 'acompte' then
    -- remboursement d'acompte : entrée ajoutée à l'historique du RDV -> ticket négatif par le déclencheur (même clé que l'application)
    select * into v_rdv from public.rdv_online where id = v_o.objet_id for update;
    update public.rdv_online set remboursements = coalesce(remboursements,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', p_at, 'montant', v_m, 'refund_id', p_refund_id, 'par', 'externe')),
      acompte_rembourse_montant = least(coalesce(acompte_montant,0), coalesce(acompte_rembourse_montant,0) + v_m),
      acompte_rembourse = (coalesce(acompte_rembourse_montant,0) + v_m) >= coalesce(acompte_montant,0) - 0.004,
      refund_id = p_refund_id, refunded_at = p_at
     where id = v_o.objet_id;
    return jsonb_build_object('ok', true, 'acompte', true);
  end if;
  q := lx_prive.recette_enfiler(v_o.salon_id, 'remb_externe', v_o.objet_id, 'remb:' || p_refund_id, least(v_m, v_o.montant), p_at, p_pi, p_refund_id,
         jsonb_build_object('ticket_id', v_o.ticket_id, 'origine', v_o.source));
  perform set_config('lx.recette_en_cours', '1', true);
  r := lx_prive.recette_traiter(q, '{}'::jsonb);
  if v_o.source = 'bon_cadeau' and coalesce((r->>'ok')::boolean,false) and v_m >= v_o.montant - 0.004 then
    update public.cartes_cadeaux set status = 'voided' where id = v_o.objet_id and coalesce(utilise,0) = 0;
  end if;
  perform set_config('lx.recette_en_cours', '', true);
  return r;
end $$;

-- Lecture pour l'application : plancher de la numérotation imprimée (tickets créés par le serveur depuis l'ouverture)
create or replace function public.lx_tk_num_imprime_max(p_salon uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from public.salons s where s.id = p_salon and (s.user_id = auth.uid() or public.is_admin()))
    then greatest(coalesce((select max((raw_data->>'tkNum')::int) from public.tickets where salon_id = p_salon and (raw_data->>'tkNum') ~ '^[0-9]{1,9}$'), 0),
                  coalesce((select max(ticket_num) from public.appointments where salon_id = p_salon), 0)) else null end
$$;

-- ===================================================================================================================== §9 droits
revoke all on function lx_prive.recettes_serveur_actif() from public, anon, authenticated;
revoke all on function lx_prive.recette_poste(uuid) from public, anon, authenticated;
revoke all on function lx_prive.recette_ht_tva(uuid, jsonb, numeric) from public, anon, authenticated;
revoke all on function lx_prive.recette_client(uuid, uuid) from public, anon, authenticated;
revoke all on function lx_prive.recette_tk_inserer(uuid, jsonb, jsonb, numeric, uuid, text, text, integer, integer, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.recette_traiter(public.recettes_en_ligne, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.recette_enfiler(uuid, text, uuid, text, numeric, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.recettes_rattrapage() from public, anon, authenticated;
revoke all on function lx_prive.tickets_cc_doublon_controle() from public, anon, authenticated;
revoke all on function lx_prive.zz_rdv_online_recettes() from public, anon, authenticated;
revoke all on function lx_prive.zz_commandes_online_recettes() from public, anon, authenticated;
revoke all on function lx_prive.zz_cartes_cadeaux_recettes() from public, anon, authenticated;
revoke all on function lx_prive.zz_cartes_abo_recettes() from public, anon, authenticated;
revoke all on function public.lx_recette_remboursement_externe(text, text, bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.lx_recette_remboursement_externe(text, text, bigint, timestamptz) to service_role;
revoke all on function public.lx_tk_num_imprime_max(uuid) from public, anon;
grant execute on function public.lx_tk_num_imprime_max(uuid) to authenticated, service_role;

-- ===================================================================================================================== §10 tâche planifiée
do $$ begin
  if exists (select 1 from cron.job where jobname = 'recettes-en-ligne-rattrapage') then perform cron.unschedule('recettes-en-ligne-rattrapage'); end if;
  perform cron.schedule('recettes-en-ligne-rattrapage', '*/5 * * * *', 'select lx_prive.recettes_rattrapage()');
end $$;

commit;

-- =====================================================================================================================
-- ORDRE DE MISE EN SERVICE (voir aussi le registre NF525, intervention du 28/10/2026 -2) :
--  0. (prérequis) docs/migrations_1027/bons_cadeaux_tva.sql appliqué (colonnes usage_tva / qualif_tva) — sinon les bons sont
--     traités au modèle historique (CA à la vente), ce qui reste conforme (TVA déclarée au plus tôt).
--  1. CE FICHIER (interrupteur encore éteint : aucun ticket créé).
--  2. Edge functions docs/edge_1028/* (lx-cloture-auto v3 : lancer {"mode":"verify","salon_id":…} AVANT et APRÈS).
--  3. Worker (cp docs/luxyra-router-worker.js /tmp/w.mjs && node --check /tmp/w.mjs), puis cocher « charge.refunded » dans le
--     webhook Stripe « comptes connectés ».
--  4. Pages (app.html + luxyra-supabase.js v=20261028-2, site.html) ; recharger TOUS les appareils (version 6.8.0 affichée).
--  5. Activation (frontière à noter au registre) :
--       update public.app_config set config = config || jsonb_build_object('recettes_en_ligne_serveur', true,
--         'recettes_en_ligne_serveur_depuis', to_char(now() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"')) where id = 1;
--  6. Bot : docs/migrations_1028/bot_recettes_en_ligne.sql ; contrôles : nf525_tests_protections(), check_fiscal_integrity(),
--     admin_nf525_etat(), lx-cloture-auto verify.
--
-- RETOUR ARRIÈRE (les tickets déjà créés restent : ils sont scellés et exacts) :
--  a) arrêt immédiat : update public.app_config set config = config - 'recettes_en_ligne_serveur' where id = 1;
--     (l'application reprend alors son ancien comportement pour les évènements non encore ticketés ; les évènements déjà
--      ticketés portent acompte_tk_num / retenue_tk_num / empreinte_tk_num / recette_tk_num et ne sont jamais refaits)
--  b) retrait complet :
--     select cron.unschedule('recettes-en-ligne-rattrapage');
--     drop trigger if exists zz_trg_rdv_online_recettes on public.rdv_online;
--     drop trigger if exists zz_trg_commandes_online_recettes on public.commandes_online;
--     drop trigger if exists zz_trg_cartes_cadeaux_recettes on public.cartes_cadeaux;
--     drop trigger if exists zz_trg_cartes_abo_recettes on public.cartes_abo_clients;
--     drop trigger if exists a_lx_tickets_cc_doublon on public.tickets;
--     drop function if exists public.lx_recette_remboursement_externe(text, text, bigint, timestamptz);
--     drop function if exists public.lx_tk_num_imprime_max(uuid);
--     -- garder la table public.recettes_en_ligne, l'index tickets_recette_key_unique et les colonnes : trace des tickets créés.
-- =====================================================================================================================
