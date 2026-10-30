-- ============================================================================================================
-- RDV SUR MESURE v2 — « plusieurs options » (lot 1 du plan validé le 30/10/2026)        NON APPLIQUÉ
-- ------------------------------------------------------------------------------------------------------------
-- Ce que fait ce fichier (idempotent, rejouable) :
--   1. Table public.rdv_demande_options : 1 à 3 options par envoi (date, heure, collaborateur, prestations /
--      forfaits, note, acompte aucun / % / €). Durée, temps de pose, prix et acompte CALCULÉS PAR LE SERVEUR
--      depuis le catalogue (services / forfaits) : le navigateur ne fournit jamais un montant.
--   2. Table public.rdv_demande_paiements : sessions de paiement d'acompte payées (confirmée / doublon / remboursée).
--   3. Colonnes ajoutées à public.rdv_demandes (proposal_version 1 = ancien format, 2 = options ; option choisie ;
--      paiement en cours ; consultation ; relance ; rappel ; durée de validité). Statuts INCHANGÉS.
--   4. Contrôle de créneau corrigé : lx_prive.demande_creneau (phases de TRAVAIL seulement — les temps de pose sont
--      libres, comme le planning de l'app — ; « pas de préférence » = au moins UN collaborateur libre pendant toutes
--      les phases de travail) ; public.lx_creneau_libre (signature inchangée, utilisée par l'ancien format) l'appelle.
--   5. Protection : une proposition envoyée n'est plus modifiable par l'établissement (seulement « proposer un autre
--      horaire » = retour « pending », et « annuler ») ; les colonnes de paiement / options sont réservées au serveur.
--   6. RPC serveur (service_role seulement) : lx_demande_proposer, lx_demande_consulter, lx_demande_choisir,
--      lx_demande_paiement_preparer / _enregistrer / _finaliser, lx_demande_refuser_v2.
--   7. Tâche planifiée « rdv-sur-mesure-echeances » (*/15) : expiration, relance client 24 h avant, rappel au salon
--      des demandes sans réponse depuis 24 h. Notifications (cloche + push) côté établissement.
--
-- NF525 : AUCUN nouveau chemin d'encaissement. L'acompte d'une option est payé par Stripe Checkout (compte du salon),
-- puis le serveur crée le rendez-vous EXACTEMENT comme aujourd'hui : INSERT rdv_online « pending_payment » (acompte non
-- payé) puis UPDATE « confirmed » + acompte_paye = true + payment_intent_id -> déclencheurs EXISTANTS
-- trg_rdv_online_acompte_modele + zz_trg_rdv_online_recettes -> ticket « Acompte en ligne » scellé par le serveur.
-- Aucune fonction de ticket, de numérotation, de clôture, de TVA ou de remboursement n'est modifiée.
--
-- Compatibilité : demandes / propositions existantes (proposal_version 1) inchangées et traitées à l'ancienne
-- (edge confirm, worker connect-pay / finalize sans option_id). En base au 30/10/2026 : 1 demande « pending », 0 proposition.
--
-- ORDRE DE DÉPLOIEMENT : ce SQL d'abord (compatible avec l'app, l'edge et le worker actuels), puis les edge functions
-- (docs/edge_1030_surmesure), puis le worker, puis les pages (app.html, proposal.html, luxyra-supabase.js).
-- RETOUR ARRIÈRE : docs/migrations_1030_surmesure/surmesure_v2_retour_arriere.sql (définitions de production à l'octet).
-- ============================================================================================================

begin;

-- ------------------------------------------------------------------------------------------------------------
-- 0. GARDE : définitions de production relues le 30/10/2026 (md5 de pg_get_functiondef). Remplacée : lx_creneau_libre
--    (prod 608615e8… ou version de CE fichier = rejeu). Lues (non modifiées) : rdv_dispo_conflit, rdv_occupations,
--    lx_horaires_effectifs, salon_resa_en_ligne_refus, appel_serveur, lx_notifier_client, cle_service.
-- ------------------------------------------------------------------------------------------------------------
do $garde$
declare
  v_attendu jsonb := jsonb_build_object(
    'public.lx_creneau_libre(p_salon uuid, p_collab integer, p_date date, p_heure time without time zone, p_duree integer)',
        jsonb_build_array('608615e8c8faa8621b0306ff6abec150', 'ca25c283c1223cfbe1d5b15c89d105ee'),
    'lx_prive.rdv_dispo_conflit(p_salon uuid, p_collab integer, p_date date, p_ns integer, p_ne integer)', jsonb_build_array('1e63c78acd111ba52727b9ff62beca74'),
    'lx_prive.rdv_occupations(p_salon uuid, p_date date)', jsonb_build_array('35e458a80d5edc3a464ac4b39a0399f1'),
    'public.lx_horaires_effectifs(p_salon uuid, p_collab integer, p_date date)', jsonb_build_array('dc1ae5267984134a8d897ccb752bcc87'),
    'lx_prive.salon_resa_en_ligne_refus(p_salon uuid)', jsonb_build_array('3d51f604e63170c750a441793fc2b21a'),
    'lx_prive.appel_serveur()', jsonb_build_array('40b6d090d00ed5e25dad8e12f138382c'),
    'public.lx_notifier_client(p_client uuid, p_type text, p_titre text, p_texte text, p_url text)', jsonb_build_array('fbae58176cf4e1e6153226edf9fd0f1d'),
    'public.trg_notif_rdv_demande()', jsonb_build_array('ee99c79d15062783227109b4d6d503b0'),
    'lx_prive.trg_notif_demande_creneau_pris()', jsonb_build_array('f1d52538695b46f27a74bc72a6627a3d'));
  k text; v_md5 text;
begin
  for k in select jsonb_object_keys(v_attendu) loop
    select md5(pg_get_functiondef(p.oid)) into v_md5 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')' = k;
    if v_md5 is null then raise exception 'GARDE surmesure_v2 : fonction absente %', k; end if;
    if not (v_attendu->k) ? v_md5 then
      raise exception 'GARDE surmesure_v2 : % a changé en production (md5 %, attendu %) — relire la définition avant d''appliquer', k, v_md5, v_attendu->k;
    end if;
  end loop;
end $garde$;

-- ------------------------------------------------------------------------------------------------------------
-- 1. Colonnes de rdv_demandes
-- ------------------------------------------------------------------------------------------------------------
alter table public.rdv_demandes add column if not exists proposal_version smallint not null default 1;
alter table public.rdv_demandes add column if not exists envoi integer not null default 0;
alter table public.rdv_demandes add column if not exists expire_heures integer;
alter table public.rdv_demandes add column if not exists option_choisie_id uuid;
alter table public.rdv_demandes add column if not exists checkout_option_id uuid;
alter table public.rdv_demandes add column if not exists checkout_session_id text;
alter table public.rdv_demandes add column if not exists checkout_expires_at timestamptz;
alter table public.rdv_demandes add column if not exists vue_at timestamptz;
alter table public.rdv_demandes add column if not exists relance_at timestamptz;
alter table public.rdv_demandes add column if not exists rappel_salon_at timestamptz;
do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'rdv_demandes_proposal_version_check') then
    alter table public.rdv_demandes add constraint rdv_demandes_proposal_version_check check (proposal_version in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rdv_demandes_expire_heures_check') then
    alter table public.rdv_demandes add constraint rdv_demandes_expire_heures_check check (expire_heures is null or expire_heures between 24 and 168);
  end if;
end $c$;
create index if not exists idx_rdv_demandes_echeances on public.rdv_demandes (status, proposal_expires_at) where status in ('proposed', 'pending');

-- ------------------------------------------------------------------------------------------------------------
-- 2. Table des options (écriture : serveur seulement)
-- ------------------------------------------------------------------------------------------------------------
create table if not exists public.rdv_demande_options (
  id               uuid primary key default gen_random_uuid(),
  demande_id       uuid not null references public.rdv_demandes(id) on delete cascade,
  salon_id         uuid not null references public.salons(id) on delete cascade,
  envoi            integer not null default 1,
  rang             smallint not null check (rang between 1 and 3),
  libelle          text not null check (char_length(libelle) between 1 and 80),
  date_rdv         date not null,
  heure_rdv        time not null,
  collaborateur_id integer references public.collaborateurs(id) on delete set null,
  collaborateur_nom text,
  items            jsonb not null check (jsonb_typeof(items) = 'array' and jsonb_array_length(items) between 1 and 10),
  phases           jsonb not null check (jsonb_typeof(phases) = 'array'),
  duree_minutes    integer not null check (duree_minutes between 1 and 1440),
  pose_minutes     integer not null default 0 check (pose_minutes >= 0),
  prix_total       numeric(10,2) not null check (prix_total >= 0),
  acompte_mode     text not null default 'aucun' check (acompte_mode in ('aucun', 'pct', 'montant')),
  acompte_valeur   numeric(10,2),
  acompte_montant  numeric(10,2) not null default 0 check (acompte_montant >= 0 and acompte_montant <= prix_total),
  note             text check (note is null or char_length(note) <= 500),
  statut           text not null default 'proposee' check (statut in ('proposee', 'choisie', 'liberee', 'creneau_pris', 'remplacee')),
  avertissement    text,
  choisie_at       timestamptz,
  created_at       timestamptz not null default now(),
  unique (demande_id, envoi, rang)
);
create index if not exists idx_rdv_demande_options_demande on public.rdv_demande_options (demande_id, envoi);
create index if not exists idx_rdv_demande_options_salon on public.rdv_demande_options (salon_id, date_rdv);
alter table public.rdv_demande_options enable row level security;
drop policy if exists salon_select_options on public.rdv_demande_options;
create policy salon_select_options on public.rdv_demande_options for select to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = (select auth.uid())));
drop policy if exists admin_lecture_vue on public.rdv_demande_options;
create policy admin_lecture_vue on public.rdv_demande_options for select to authenticated using (public.is_admin());
revoke all on public.rdv_demande_options from public, anon, authenticated;
grant select on public.rdv_demande_options to authenticated;
grant select, insert, update, delete on public.rdv_demande_options to service_role;

do $c$ begin
  if not exists (select 1 from pg_constraint where conname = 'rdv_demandes_option_choisie_fk') then
    alter table public.rdv_demandes add constraint rdv_demandes_option_choisie_fk foreign key (option_choisie_id) references public.rdv_demande_options(id) on delete set null;
  end if;
end $c$;

-- ------------------------------------------------------------------------------------------------------------
-- 3. Paiements d'acompte reçus pour une demande (1 ligne par session Stripe payée) — écriture : serveur seulement
-- ------------------------------------------------------------------------------------------------------------
create table if not exists public.rdv_demande_paiements (
  id             uuid primary key default gen_random_uuid(),
  demande_id     uuid not null references public.rdv_demandes(id) on delete cascade,
  salon_id       uuid not null references public.salons(id) on delete cascade,
  option_id      uuid references public.rdv_demande_options(id) on delete set null,
  session_id     text not null unique,
  payment_intent text,
  compte         text,
  montant        numeric(10,2) not null,
  statut         text not null check (statut in ('confirme', 'doublon', 'rembourse', 'remboursement_echec')),
  refund_id      text,
  rdv_online_id  uuid references public.rdv_online(id) on delete set null,
  detail         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists idx_rdv_demande_paiements_demande on public.rdv_demande_paiements (demande_id);
alter table public.rdv_demande_paiements enable row level security;
drop policy if exists salon_select_paiements on public.rdv_demande_paiements;
create policy salon_select_paiements on public.rdv_demande_paiements for select to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = (select auth.uid())));
drop policy if exists admin_lecture_vue on public.rdv_demande_paiements;
create policy admin_lecture_vue on public.rdv_demande_paiements for select to authenticated using (public.is_admin());
revoke all on public.rdv_demande_paiements from public, anon, authenticated;
grant select on public.rdv_demande_paiements to authenticated;
grant select, insert, update, delete on public.rdv_demande_paiements to service_role;

-- ------------------------------------------------------------------------------------------------------------
-- 4. Outils : erreur métier, phases, minutes, Stripe actif, libellé d'une option
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.sm_erreur(p_code text, p_message text)
 returns void language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  raise exception '%', p_message using errcode = 'P0001', hint = p_code;
end $f$;

-- phases normalisées : [{t:'w'|'p', d:minutes>0, l?}] ; vide -> 30 min de travail
create or replace function lx_prive.sm_phases(p jsonb, p_libelle text default null)
 returns jsonb language plpgsql immutable set search_path to 'public', 'pg_temp' as $f$
declare v jsonb := '[]'::jsonb; e jsonb; d int;
begin
  for e in select value from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) loop
    d := public.lx_int_sur(e->>'d');
    if d is null or d <= 0 then continue; end if;
    v := v || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('t', case when e->>'t' = 'p' then 'p' else 'w' end, 'd', least(d, 720), 'l', nullif(left(coalesce(e->>'l', ''), 80), ''))));
  end loop;
  if jsonb_array_length(v) = 0 then v := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('t', 'w', 'd', 30, 'l', nullif(left(coalesce(p_libelle, ''), 80), '')))); end if;
  return v;
end $f$;

create or replace function lx_prive.sm_minutes(p_heure time)
 returns int language sql immutable as $f$ select extract(hour from p_heure)::int * 60 + extract(minute from p_heure)::int $f$;

create or replace function lx_prive.sm_hhmm(p_min int)
 returns text language sql immutable as $f$ select lpad((p_min / 60)::text, 2, '0') || ':' || lpad((p_min % 60)::text, 2, '0') $f$;

-- même règle que la page de proposition / le worker (compte du salon capable d'encaisser)
create or replace function lx_prive.sm_stripe_actif(p_salon uuid)
 returns boolean language sql stable set search_path to 'public', 'pg_temp' as $f$
  select coalesce((select s.stripe_connect_id is not null and s.stripe_connect_id <> ''
                     and coalesce(s.stripe_connect_status, '') in ('active', 'enabled', 'payouts_pending')
                     from public.salons s where s.id = p_salon), false)
$f$;

create or replace function lx_prive.sm_lettre(p_rang int)
 returns text language sql immutable as $f$ select chr(64 + greatest(1, least(coalesce(p_rang, 1), 26))) $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 5. CONTRÔLE DE CRÉNEAU (aligné sur le planning de l'app : seules les phases de travail occupent le collaborateur)
--    Résultat : {libre, raison, collab (collaborateur libre trouvé), avertissement (horaires, non bloquant)}
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.demande_creneau(p_salon uuid, p_collab integer, p_date date, p_heure time, p_phases jsonb)
 returns jsonb language plpgsql stable set search_path to 'public', 'pg_temp' as $f$
declare
  v_ns int := lx_prive.sm_minutes(p_heure);
  v_ph jsonb := lx_prive.sm_phases(p_phases);
  v_blocs jsonb := '[]'::jsonb; v_off int := 0; e jsonb; d int; v_total int;
  v_b jsonb; v_col record; v_eh jsonb; v_ok boolean; v_presents int := 0; v_nb int := 0; v_hors text;
begin
  for e in select value from jsonb_array_elements(v_ph) loop
    d := (e->>'d')::int;
    if e->>'t' <> 'p' then v_blocs := v_blocs || jsonb_build_array(jsonb_build_array(v_ns + v_off, v_ns + v_off + d)); end if;
    v_off := v_off + d;
  end loop;
  v_total := v_off;
  if jsonb_array_length(v_blocs) = 0 then v_blocs := jsonb_build_array(jsonb_build_array(v_ns, v_ns + v_total)); end if;

  -- collaborateur choisi : aucun chevauchement de ses RDV avec une phase de travail
  if p_collab is not null then
    for v_b in select value from jsonb_array_elements(v_blocs) loop
      if lx_prive.rdv_dispo_conflit(p_salon, p_collab, p_date, (v_b->>0)::int, (v_b->>1)::int) then
        return jsonb_build_object('libre', false, 'collab', p_collab,
          'raison', 'Le collaborateur a déjà un rendez-vous entre ' || lx_prive.sm_hhmm((v_b->>0)::int) || ' et ' || lx_prive.sm_hhmm((v_b->>1)::int));
      end if;
    end loop;
    -- horaires : avertissement seulement (l'établissement peut proposer un rendez-vous exceptionnel)
    v_eh := public.lx_horaires_effectifs(p_salon, p_collab, p_date);
    if v_eh is null then v_hors := 'Jour non travaillé pour ce collaborateur';
    elsif v_ns < public.lx_int_sur(v_eh->>'o') or v_ns + v_total > public.lx_int_sur(v_eh->>'c') then
      v_hors := 'Hors horaires (' || lx_prive.sm_hhmm(public.lx_int_sur(v_eh->>'o')) || ' – ' || lx_prive.sm_hhmm(public.lx_int_sur(v_eh->>'c')) || ')';
    elsif exists (select 1 from jsonb_array_elements(v_blocs) b, jsonb_array_elements(coalesce(v_eh->'b', '[]'::jsonb)) p
                   where (b->>0)::int < public.lx_int_sur(p->>1) and (b->>1)::int > public.lx_int_sur(p->>0)) then
      v_hors := 'Pendant une pause du collaborateur';
    end if;
    return jsonb_strip_nulls(jsonb_build_object('libre', true, 'collab', p_collab, 'avertissement', v_hors));
  end if;

  -- « Pas de préférence » : au moins UN collaborateur présent, libre pendant TOUTES les phases de travail
  for v_col in select c.id from public.collaborateurs c
                where c.salon_id = p_salon and coalesce(c.actif, true) and not coalesce(c.inactif, false)
                  and (c.date_depart is null or c.date_depart > p_date) order by c.id loop
    v_nb := v_nb + 1;
    v_eh := public.lx_horaires_effectifs(p_salon, v_col.id, p_date);
    if v_eh is null or public.lx_int_sur(v_eh->>'o') is null or public.lx_int_sur(v_eh->>'c') is null then continue; end if;
    if v_ns < public.lx_int_sur(v_eh->>'o') or v_ns + v_total > public.lx_int_sur(v_eh->>'c') then continue; end if;
    if exists (select 1 from jsonb_array_elements(v_blocs) b, jsonb_array_elements(coalesce(v_eh->'b', '[]'::jsonb)) p
                where coalesce((b->>0)::int < public.lx_int_sur(p->>1) and (b->>1)::int > public.lx_int_sur(p->>0), true)) then continue; end if;
    v_presents := v_presents + 1;
    v_ok := true;
    for v_b in select value from jsonb_array_elements(v_blocs) loop
      if lx_prive.rdv_dispo_conflit(p_salon, v_col.id, p_date, (v_b->>0)::int, (v_b->>1)::int) then v_ok := false; exit; end if;
    end loop;
    if v_ok then return jsonb_build_object('libre', true, 'collab', v_col.id); end if;
  end loop;

  if v_nb = 0 then
    -- établissement sans collaborateur enregistré : une seule personne
    for v_b in select value from jsonb_array_elements(v_blocs) loop
      if lx_prive.rdv_dispo_conflit(p_salon, null, p_date, (v_b->>0)::int, (v_b->>1)::int) then
        return jsonb_build_object('libre', false, 'raison', 'Un rendez-vous occupe déjà ce créneau');
      end if;
    end loop;
    return jsonb_build_object('libre', true);
  end if;

  if v_presents = 0 then
    -- personne ne travaille à cette heure : rendez-vous exceptionnel -> un collaborateur actif sans rendez-vous suffit
    for v_col in select c.id from public.collaborateurs c
                  where c.salon_id = p_salon and coalesce(c.actif, true) and not coalesce(c.inactif, false)
                    and (c.date_depart is null or c.date_depart > p_date) order by c.id loop
      v_ok := true;
      for v_b in select value from jsonb_array_elements(v_blocs) loop
        if exists (select 1 from lx_prive.rdv_occupations(p_salon, p_date) o
                    where o.debut < (v_b->>1)::int and o.fin > (v_b->>0)::int and (o.collab_id = v_col.id or (o.collab_id is null and not o.termine))) then
          v_ok := false; exit;
        end if;
      end loop;
      if v_ok then return jsonb_build_object('libre', true, 'collab', v_col.id, 'avertissement', 'Hors horaires de l''équipe'); end if;
    end loop;
  end if;
  return jsonb_build_object('libre', false, 'raison', 'Aucun collaborateur n''est libre sur ce créneau');
end $f$;

-- Ancienne signature (ancien format : edge confirm, worker connect-pay) : même contrôle, « pas de préférence » vérifié.
create or replace function public.lx_creneau_libre(p_salon uuid, p_collab integer, p_date date, p_heure time without time zone, p_duree integer)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  -- 2026-10-30 (RDV sur mesure v2) : « pas de préférence » = au moins un collaborateur libre (avant : toujours libre) ;
  -- mêmes occupations que la réservation en ligne (lx_prive.rdv_occupations : temps de pose des RDV internes libres).
  select coalesce((lx_prive.demande_creneau(p_salon, p_collab, p_date, p_heure,
           jsonb_build_array(jsonb_build_object('t', 'w', 'd', greatest(coalesce(p_duree, 30), 1))))->>'libre')::boolean, true);
$function$;

-- ------------------------------------------------------------------------------------------------------------
-- 6. CALCUL D'UNE OPTION depuis le catalogue (aucun montant venu du navigateur)
--    p_opt : {rang, libelle?, date 'AAAA-MM-JJ', heure 'HH:MM', collaborateur_id?, items:[{type:'service'|'forfait', id}],
--             acompte_mode 'aucun'|'pct'|'montant', acompte_valeur?, note?}
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.demande_option_calculer(p_salon uuid, p_opt jsonb)
 returns jsonb language plpgsql stable set search_path to 'public', 'pg_temp' as $f$
declare
  v_rang int := coalesce(public.lx_int_sur(p_opt->>'rang'), 1);
  v_l text := 'Option ' || lx_prive.sm_lettre(coalesce(public.lx_int_sur(p_opt->>'rang'), 1)) || ' : ';
  v_date date; v_heure time; v_collab int; v_cnom text; v_c record;
  v_items jsonb := '[]'::jsonb; v_phases jsonb := '[]'::jsonb; it jsonb; v_s record; v_f record; v_ph jsonb; v_d int; v_p int;
  v_prix numeric := 0; v_duree int := 0; v_pose int := 0; v_noms text[] := '{}'; v_ordre int := 0;
  v_mode text := coalesce(nullif(p_opt->>'acompte_mode', ''), 'aucun'); v_val numeric; v_ac numeric := 0;
  v_libelle text; v_note text; v_now timestamp := (now() at time zone 'Europe/Paris');
begin
  if v_rang not between 1 and 3 then perform lx_prive.sm_erreur('LX_SM_OPTION', 'Trois options au maximum'); end if;
  begin v_date := (p_opt->>'date')::date; exception when others then v_date := null; end;
  if v_date is null then perform lx_prive.sm_erreur('LX_SM_DATE', v_l || 'date manquante ou invalide'); end if;
  if coalesce(p_opt->>'heure', '') !~ '^[0-2]?[0-9]:[0-5][0-9]$' then perform lx_prive.sm_erreur('LX_SM_HEURE', v_l || 'heure manquante ou invalide'); end if;
  v_heure := (p_opt->>'heure')::time;
  if (v_date + v_heure) < v_now + interval '30 minutes' then perform lx_prive.sm_erreur('LX_SM_PASSE', v_l || 'le rendez-vous doit commencer au moins 30 minutes après maintenant'); end if;
  if v_date > v_now::date + 365 then perform lx_prive.sm_erreur('LX_SM_LOIN', v_l || 'date à plus d''un an'); end if;

  -- collaborateur (facultatif = « pas de préférence »)
  v_collab := public.lx_int_sur(p_opt->>'collaborateur_id');
  if v_collab is not null then
    select c.id, c.nom, c.actif, c.inactif, c.date_depart into v_c from public.collaborateurs c where c.id = v_collab and c.salon_id = p_salon;
    if v_c.id is null then perform lx_prive.sm_erreur('LX_SM_COLLAB', v_l || 'collaborateur inconnu dans cet établissement'); end if;
    if not coalesce(v_c.actif, true) or coalesce(v_c.inactif, false) or (v_c.date_depart is not null and v_c.date_depart <= v_date) then
      perform lx_prive.sm_erreur('LX_SM_COLLAB', v_l || v_c.nom || ' ne fait plus partie de l''équipe à cette date');
    end if;
    v_cnom := v_c.nom;
  end if;

  -- prestations / forfaits relus dans le catalogue de l'établissement
  if jsonb_typeof(p_opt->'items') <> 'array' or jsonb_array_length(p_opt->'items') = 0 then
    perform lx_prive.sm_erreur('LX_SM_ITEMS', v_l || 'choisissez au moins une prestation ou un forfait');
  end if;
  if jsonb_array_length(p_opt->'items') > 10 then perform lx_prive.sm_erreur('LX_SM_ITEMS', v_l || '10 prestations au maximum'); end if;
  for it in select value from jsonb_array_elements(p_opt->'items') loop
    v_ordre := v_ordre + 1;
    if coalesce(it->>'type', 'service') = 'forfait' then
      select f.id, f.nom, f.prix, f.phases, coalesce(f.prix_sur_devis, false) devis, coalesce(f.prix_a_partir_de, false) apartir
        into v_f from public.forfaits f where f.id = public.lx_int_sur(it->>'id') and f.salon_id = p_salon;
      if v_f.id is null then perform lx_prive.sm_erreur('LX_SM_ITEM', v_l || 'forfait inconnu dans cet établissement'); end if;
      if v_f.devis then perform lx_prive.sm_erreur('LX_SM_DEVIS', v_l || '« ' || v_f.nom || ' » est sur devis : fixez d''abord son prix dans Prestations'); end if;
      v_ph := lx_prive.sm_phases(v_f.phases, v_f.nom);
      v_d := (select coalesce(sum((x->>'d')::int), 0) from jsonb_array_elements(v_ph) x);
      v_p := (select coalesce(sum((x->>'d')::int), 0) from jsonb_array_elements(v_ph) x where x->>'t' = 'p');
      v_items := v_items || jsonb_build_array(jsonb_build_object('type', 'forfait', 'id', v_f.id, 'nom', v_f.nom, 'prix', round(coalesce(v_f.prix, 0), 2),
                   'duree', v_d, 'pose', v_p, 'phases', v_ph, 'a_partir_de', v_f.apartir, 'ordre', v_ordre));
      v_prix := v_prix + round(coalesce(v_f.prix, 0), 2); v_noms := v_noms || v_f.nom;
    else
      select s.id, s.nom, s.prix, s.phases, coalesce(s.actif, true) actif, coalesce(s.prix_sur_devis, false) devis, coalesce(s.prix_a_partir_de, false) apartir
        into v_s from public.services s where s.id = public.lx_int_sur(it->>'id') and s.salon_id = p_salon;
      if v_s.id is null then perform lx_prive.sm_erreur('LX_SM_ITEM', v_l || 'prestation inconnue dans cet établissement'); end if;
      if not v_s.actif then perform lx_prive.sm_erreur('LX_SM_ITEM', v_l || '« ' || v_s.nom || ' » n''est plus active'); end if;
      if v_s.devis then perform lx_prive.sm_erreur('LX_SM_DEVIS', v_l || '« ' || v_s.nom || ' » est sur devis : fixez d''abord son prix dans Prestations'); end if;
      v_ph := lx_prive.sm_phases(v_s.phases, v_s.nom);
      v_d := (select coalesce(sum((x->>'d')::int), 0) from jsonb_array_elements(v_ph) x);
      v_p := (select coalesce(sum((x->>'d')::int), 0) from jsonb_array_elements(v_ph) x where x->>'t' = 'p');
      v_items := v_items || jsonb_build_array(jsonb_build_object('type', 'service', 'id', v_s.id, 'nom', v_s.nom, 'prix', round(coalesce(v_s.prix, 0), 2),
                   'duree', v_d, 'pose', v_p, 'phases', v_ph, 'a_partir_de', v_s.apartir, 'ordre', v_ordre));
      v_prix := v_prix + round(coalesce(v_s.prix, 0), 2); v_noms := v_noms || v_s.nom;
    end if;
    v_phases := v_phases || v_ph; v_duree := v_duree + v_d; v_pose := v_pose + v_p;
  end loop;
  v_prix := round(v_prix, 2);
  if v_duree > 1440 then perform lx_prive.sm_erreur('LX_SM_DUREE', v_l || 'durée supérieure à 24 h'); end if;

  -- acompte calculé ici (arrondi au centime, ≥ 1 €, ≤ total)
  if v_mode not in ('aucun', 'pct', 'montant') then perform lx_prive.sm_erreur('LX_SM_ACOMPTE', v_l || 'type d''acompte inconnu'); end if;
  if v_mode <> 'aucun' then
    begin v_val := round((p_opt->>'acompte_valeur')::numeric, 2); exception when others then v_val := null; end;
    if v_val is null or v_val <= 0 then perform lx_prive.sm_erreur('LX_SM_ACOMPTE', v_l || 'indiquez la valeur de l''acompte'); end if;
    if v_mode = 'pct' then
      if v_val > 100 then perform lx_prive.sm_erreur('LX_SM_ACOMPTE', v_l || 'l''acompte ne peut pas dépasser 100 %'); end if;
      v_ac := round(v_prix * v_val / 100, 2);
    else
      v_ac := v_val;
      if v_ac > v_prix then perform lx_prive.sm_erreur('LX_SM_ACOMPTE', v_l || 'l''acompte (' || to_char(v_ac, 'FM999990.00') || ' €) dépasse le prix total (' || to_char(v_prix, 'FM999990.00') || ' €)'); end if;
    end if;
    if v_ac < 1 then perform lx_prive.sm_erreur('LX_SM_ACOMPTE', v_l || 'acompte trop faible (1 € minimum)'); end if;
  else
    v_val := null;
  end if;

  v_libelle := nullif(btrim(left(coalesce(p_opt->>'libelle', ''), 60)), '');
  if v_libelle is null then v_libelle := left(array_to_string(v_noms, ' + '), 80); end if;
  v_note := nullif(btrim(left(coalesce(p_opt->>'note', ''), 500)), '');

  return jsonb_build_object('rang', v_rang, 'libelle', v_libelle, 'date_rdv', v_date, 'heure_rdv', to_char(v_heure, 'HH24:MI'),
    'collaborateur_id', v_collab, 'collaborateur_nom', v_cnom, 'items', v_items, 'phases', v_phases,
    'duree_minutes', v_duree, 'pose_minutes', v_pose, 'prix_total', v_prix,
    'acompte_mode', v_mode, 'acompte_valeur', v_val, 'acompte_montant', v_ac, 'note', v_note);
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 7. ENVOI DE LA PROPOSITION (edge rdv-demande-propose v6, rôle service ; propriétaire vérifié ici aussi)
--    p_forcer = false : si un créneau est pris -> rien n'est écrit, la liste des conflits est renvoyée.
-- ------------------------------------------------------------------------------------------------------------
create or replace function public.lx_demande_proposer(p_demande uuid, p_user uuid, p_options jsonb, p_expire_heures integer default 72, p_forcer boolean default false)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare
  v_d public.rdv_demandes; v_salon public.salons; v_refus text; o jsonb; v_calc jsonb; v_calcs jsonb := '[]'::jsonb;
  v_cr jsonb; v_conflits jsonb := '[]'::jsonb; v_avert jsonb := '[]'::jsonb; v_envoi int; v_token text; v_exp timestamptz;
  v_h int := coalesce(p_expire_heures, 72); v_rangs int[] := '{}'; v_stripe boolean; v_out jsonb := '[]'::jsonb; v_id uuid;
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  select * into v_d from public.rdv_demandes where id = p_demande for update;
  if v_d.id is null then perform lx_prive.sm_erreur('LX_SM_INTROUVABLE', 'Demande introuvable'); end if;
  select * into v_salon from public.salons where id = v_d.salon_id;
  if v_salon.user_id is null or v_salon.user_id is distinct from p_user then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Vous n''êtes pas autorisé à traiter cette demande'); end if;
  if v_d.status <> 'pending' then
    perform lx_prive.sm_erreur('LX_SM_STATUT', case v_d.status when 'proposed' then 'Une proposition est déjà envoyée pour cette demande'
      when 'confirmed' then 'Cette demande est déjà confirmée' else 'Cette demande n''est plus active' end);
  end if;
  v_refus := lx_prive.salon_resa_en_ligne_refus(v_d.salon_id);
  if v_refus is not null then perform lx_prive.sm_erreur('LX_SM_RESA', v_refus || ' : le client ne pourrait pas confirmer. Activez la réservation en ligne (Paramètres › Site en ligne).'); end if;
  if jsonb_typeof(p_options) <> 'array' or jsonb_array_length(p_options) not between 1 and 3 then
    perform lx_prive.sm_erreur('LX_SM_OPTION', 'Proposez entre 1 et 3 options');
  end if;
  if v_h not in (24, 48, 72, 168) then v_h := 72; end if;
  v_stripe := lx_prive.sm_stripe_actif(v_d.salon_id);

  for o in select value from jsonb_array_elements(p_options) loop
    v_calc := lx_prive.demande_option_calculer(v_d.salon_id, o);
    if (v_calc->>'rang')::int = any (v_rangs) then perform lx_prive.sm_erreur('LX_SM_OPTION', 'Deux options portent la même lettre'); end if;
    v_rangs := v_rangs || (v_calc->>'rang')::int;
    if (v_calc->>'acompte_montant')::numeric > 0 and not v_stripe then
      perform lx_prive.sm_erreur('LX_SM_STRIPE', 'Option ' || lx_prive.sm_lettre((v_calc->>'rang')::int) || ' : acompte en ligne impossible, les paiements en ligne de l''établissement ne sont pas actifs (Paramètres › Paiements en ligne).');
    end if;
    perform pg_advisory_xact_lock(hashtext('lx_rdv:' || v_d.salon_id::text || ':' || (v_calc->>'date_rdv')));
    v_cr := lx_prive.demande_creneau(v_d.salon_id, (v_calc->>'collaborateur_id')::int, (v_calc->>'date_rdv')::date, (v_calc->>'heure_rdv')::time, v_calc->'phases');
    if not coalesce((v_cr->>'libre')::boolean, true) then
      v_conflits := v_conflits || jsonb_build_array(jsonb_build_object('rang', v_calc->'rang', 'raison', v_cr->>'raison'));
    end if;
    if v_cr ? 'avertissement' then v_avert := v_avert || jsonb_build_array(jsonb_build_object('rang', v_calc->'rang', 'texte', v_cr->>'avertissement')); end if;
    v_calc := v_calc || jsonb_build_object('avertissement', coalesce(case when not coalesce((v_cr->>'libre')::boolean, true) then v_cr->>'raison' end, v_cr->>'avertissement'));
    v_calcs := v_calcs || jsonb_build_array(v_calc);
  end loop;

  if jsonb_array_length(v_conflits) > 0 and not coalesce(p_forcer, false) then
    return jsonb_build_object('ok', false, 'code', 'conflit', 'conflits', v_conflits, 'avertissements', v_avert, 'options', v_calcs);
  end if;

  v_envoi := coalesce(v_d.envoi, 0) + 1;
  update public.rdv_demande_options set statut = 'remplacee' where demande_id = v_d.id and statut in ('proposee', 'creneau_pris');
  for v_calc in select value from jsonb_array_elements(v_calcs) loop
    insert into public.rdv_demande_options (demande_id, salon_id, envoi, rang, libelle, date_rdv, heure_rdv, collaborateur_id, collaborateur_nom,
        items, phases, duree_minutes, pose_minutes, prix_total, acompte_mode, acompte_valeur, acompte_montant, note, statut, avertissement)
      values (v_d.id, v_d.salon_id, v_envoi, (v_calc->>'rang')::int, v_calc->>'libelle', (v_calc->>'date_rdv')::date, (v_calc->>'heure_rdv')::time,
        (v_calc->>'collaborateur_id')::int, v_calc->>'collaborateur_nom', v_calc->'items', v_calc->'phases', (v_calc->>'duree_minutes')::int,
        (v_calc->>'pose_minutes')::int, (v_calc->>'prix_total')::numeric, v_calc->>'acompte_mode', (v_calc->>'acompte_valeur')::numeric,
        (v_calc->>'acompte_montant')::numeric, v_calc->>'note', 'proposee', v_calc->>'avertissement')
      returning id into v_id;
    v_out := v_out || jsonb_build_array(v_calc || jsonb_build_object('id', v_id));
  end loop;

  v_token := encode(extensions.gen_random_bytes(16), 'hex');
  v_exp := now() + make_interval(hours => v_h);
  update public.rdv_demandes set status = 'proposed', proposal_version = 2, envoi = v_envoi, expire_heures = v_h,
      proposal_token = v_token, proposal_expires_at = v_exp, proposed_at = now(), proposed_data = null,
      refuse_reason = null, option_choisie_id = null, checkout_option_id = null, checkout_session_id = null, checkout_expires_at = null,
      confirm_claim_at = null, stripe_session_id = null, vue_at = null, relance_at = null
   where id = v_d.id;

  return jsonb_build_object('ok', true, 'demande_id', v_d.id, 'token', v_token, 'expires_at', v_exp, 'envoi', v_envoi,
    'options', v_out, 'avertissements', v_avert, 'conflits', v_conflits, 'force', jsonb_array_length(v_conflits) > 0,
    'client', jsonb_build_object('prenom', v_d.client_prenom, 'nom', v_d.client_nom, 'email', v_d.client_email, 'tel', v_d.client_tel, 'luxyra_id', v_d.client_luxyra_id),
    'salon_nom', v_salon.nom);
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 8. LECTURE PAR LE CLIENT (lien de la proposition) — marque « vue » ; expiration paresseuse (jamais pendant un paiement)
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.sm_option_json(o public.rdv_demande_options)
 returns jsonb language sql stable set search_path to 'public', 'pg_temp' as $f$
  select jsonb_build_object('id', o.id, 'rang', o.rang, 'lettre', lx_prive.sm_lettre(o.rang), 'libelle', o.libelle,
    'date', o.date_rdv, 'heure', to_char(o.heure_rdv, 'HH24:MI'),
    'heure_fin', lx_prive.sm_hhmm((lx_prive.sm_minutes(o.heure_rdv) + o.duree_minutes) % 1440),
    'collaborateur_nom', o.collaborateur_nom,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('type', i->>'type', 'nom', i->>'nom', 'prix', (i->>'prix')::numeric, 'duree', (i->>'duree')::int,
                     'pose', (i->>'pose')::int, 'a_partir_de', coalesce((i->>'a_partir_de')::boolean, false)) order by (i->>'ordre')::int), '[]'::jsonb)
              from jsonb_array_elements(o.items) i),
    'duree_minutes', o.duree_minutes, 'pose_minutes', o.pose_minutes, 'prix_total', o.prix_total,
    'acompte_montant', o.acompte_montant, 'reste', o.prix_total - o.acompte_montant, 'note', o.note, 'statut', o.statut,
    'passee', (o.date_rdv + o.heure_rdv) <= (now() at time zone 'Europe/Paris'))
$f$;

create or replace function public.lx_demande_consulter(p_token text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_d public.rdv_demandes; v_opts jsonb; v_paye numeric; v_recu integer;
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  if coalesce(length(p_token), 0) < 16 then return jsonb_build_object('ok', false, 'code', 'introuvable'); end if;
  select * into v_d from public.rdv_demandes where proposal_token = p_token for update;
  if v_d.id is null then return jsonb_build_object('ok', false, 'code', 'introuvable'); end if;
  if v_d.status = 'proposed' and v_d.proposal_expires_at < now()
     and coalesce(v_d.checkout_expires_at, '-infinity') < now() and coalesce(v_d.confirm_claim_at, '-infinity') < now() - interval '3 minutes' then
    update public.rdv_demandes set status = 'expired' where id = v_d.id returning * into v_d;
  end if;
  if v_d.status = 'proposed' and v_d.vue_at is null then
    update public.rdv_demandes set vue_at = now() where id = v_d.id returning * into v_d;
  end if;
  select coalesce(jsonb_agg(lx_prive.sm_option_json(o) order by o.rang), '[]'::jsonb) into v_opts
    from public.rdv_demande_options o where o.demande_id = v_d.id and o.envoi = v_d.envoi;
  select coalesce(sum(p.montant), 0) into v_paye from public.rdv_demande_paiements p where p.demande_id = v_d.id and p.statut = 'confirme';
  if v_d.rdv_online_id is not null then select r.acompte_tk_num into v_recu from public.rdv_online r where r.id = v_d.rdv_online_id; end if;
  return jsonb_build_object('ok', true, 'demande', jsonb_build_object(
      'id', v_d.id, 'salon_id', v_d.salon_id, 'status', v_d.status, 'version', v_d.proposal_version, 'expires_at', v_d.proposal_expires_at,
      'proposed_at', v_d.proposed_at, 'confirmed_at', v_d.confirmed_at, 'refused_at', v_d.refused_at, 'rdv_online_id', v_d.rdv_online_id,
      'demande_text', v_d.demande_text, 'option_choisie_id', v_d.option_choisie_id, 'acompte_paye', v_paye, 'recu_acompte', v_recu,
      'paiement_en_cours', v_d.checkout_expires_at is not null and v_d.checkout_expires_at > now(), 'checkout_option_id', v_d.checkout_option_id,
      'proposed_data', v_d.proposed_data,
      'client', jsonb_build_object('prenom', v_d.client_prenom, 'nom', v_d.client_nom, 'email', v_d.client_email, 'tel', v_d.client_tel)),
    'options', v_opts);
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 9. Contrôles communes au choix et au paiement : option de l'envoi en cours, non passée, créneau libre
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.sm_demande_active(p_token text, p_option uuid, out d public.rdv_demandes, out o public.rdv_demande_options)
 language plpgsql set search_path to 'public', 'pg_temp' as $f$
declare v_refus text;
begin
  select * into d from public.rdv_demandes where proposal_token = p_token for update;
  if d.id is null then perform lx_prive.sm_erreur('LX_SM_INTROUVABLE', 'Proposition introuvable'); end if;
  if d.status = 'confirmed' then perform lx_prive.sm_erreur('LX_SM_DEJA', 'Ce rendez-vous est déjà confirmé.'); end if;
  if d.status = 'pending' then perform lx_prive.sm_erreur('LX_SM_REFAIRE', 'L''établissement prépare une nouvelle proposition : vous allez la recevoir. Aucun paiement n''a été effectué.'); end if;
  if d.status <> 'proposed' then perform lx_prive.sm_erreur('LX_SM_INACTIVE', 'Cette proposition n''est plus active.'); end if;
  if d.proposal_expires_at < now() and coalesce(d.checkout_expires_at, '-infinity') < now() then
    perform lx_prive.sm_erreur('LX_SM_EXPIREE', 'Cette proposition a expiré. Contactez l''établissement pour en recevoir une nouvelle.');
  end if;
  if coalesce(d.proposal_version, 1) <> 2 then perform lx_prive.sm_erreur('LX_SM_FORMAT', 'Ancien format de proposition'); end if;
  select * into o from public.rdv_demande_options where id = p_option and demande_id = d.id;
  if o.id is null or o.envoi <> d.envoi then perform lx_prive.sm_erreur('LX_SM_OPTION', 'Cette option ne fait pas partie de la proposition en cours.'); end if;
  if o.statut = 'creneau_pris' then perform lx_prive.sm_erreur('LX_SM_CRENEAU', 'Ce créneau a été pris entre-temps. Choisissez une autre option ou attendez la nouvelle proposition de l''établissement.'); end if;
  if o.statut <> 'proposee' then perform lx_prive.sm_erreur('LX_SM_OPTION', 'Cette option n''est plus disponible.'); end if;
  if (o.date_rdv + o.heure_rdv) <= (now() at time zone 'Europe/Paris') then perform lx_prive.sm_erreur('LX_SM_PASSE', 'Ce créneau est déjà passé.'); end if;
  v_refus := lx_prive.salon_resa_en_ligne_refus(d.salon_id);
  if v_refus is not null then perform lx_prive.sm_erreur('LX_SM_RESA', 'Cet établissement n''accepte pas de réservation en ligne pour le moment.'); end if;
end $f$;

-- créneau revérifié (verrou de la journée partagé avec la réservation en ligne) ; pris -> option « creneau_pris »
create or replace function lx_prive.sm_creneau_ou_pris(o public.rdv_demande_options)
 returns boolean language plpgsql set search_path to 'public', 'pg_temp' as $f$
declare v_cr jsonb;
begin
  perform pg_advisory_xact_lock(hashtext('lx_rdv:' || o.salon_id::text || ':' || o.date_rdv::text));
  v_cr := lx_prive.demande_creneau(o.salon_id, o.collaborateur_id, o.date_rdv, o.heure_rdv, o.phases);
  if coalesce((v_cr->>'libre')::boolean, true) then return true; end if;
  update public.rdv_demande_options set statut = 'creneau_pris', avertissement = v_cr->>'raison' where id = o.id and statut = 'proposee';
  return false;
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 10. Création du RDV (rdv_online) à partir de l'option — MÊME forme que l'ancien format, phases réelles pour le planning
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.sm_proposed_data(o public.rdv_demande_options)
 returns jsonb language sql stable set search_path to 'public', 'pg_temp' as $f$
  select jsonb_build_object('version', 2, 'option_id', o.id, 'rang', o.rang, 'lettre', lx_prive.sm_lettre(o.rang), 'libelle', o.libelle,
    'date', o.date_rdv, 'heure', to_char(o.heure_rdv, 'HH24:MI'), 'collaborateur_id', o.collaborateur_id, 'collaborateur_nom', o.collaborateur_nom,
    'items', (select coalesce(jsonb_agg(jsonb_build_object('service_id', case when i->>'type' = 'service' then (i->>'id')::int end,
                 'forfait_id', case when i->>'type' = 'forfait' then (i->>'id')::int end, 'type', i->>'type', 'nom', i->>'nom',
                 'prix', (i->>'prix')::numeric, 'duree', (i->>'duree')::int, 'ordre', (i->>'ordre')::int) order by (i->>'ordre')::int), '[]'::jsonb)
              from jsonb_array_elements(o.items) i),
    'duree_minutes', o.duree_minutes, 'pose_minutes', o.pose_minutes, 'prix_total', o.prix_total,
    'acompte_mode', o.acompte_mode, 'acompte_valeur', o.acompte_valeur, 'acompte_montant', o.acompte_montant, 'message_salon', o.note)
$f$;

create or replace function lx_prive.sm_creer_rdv(d public.rdv_demandes, o public.rdv_demande_options, p_statut text, p_pi text, p_compte text, p_acompte_salon boolean)
 returns uuid language plpgsql set search_path to 'public', 'pg_temp' as $f$
declare v_id uuid; v_pd jsonb := lx_prive.sm_proposed_data(o); v_items jsonb; v_se_items jsonb; v_premier int; v_noms text;
begin
  v_items := v_pd->'items';
  select (i->>'service_id')::int into v_premier from jsonb_array_elements(v_items) i where i->>'service_id' is not null order by (i->>'ordre')::int limit 1;
  select string_agg(i->>'nom', ' + ' order by (i->>'ordre')::int) into v_noms from jsonb_array_elements(v_items) i;
  -- contenu tel que l'app l'affiche au planning (rdv_online.salon_edit : phases réelles avec temps de pose + lignes de caisse)
  select coalesce(jsonb_agg(jsonb_build_object('sId', case when i->>'type' = 'service' then (i->>'id')::int end, 'name', i->>'nom', 'price', (i->>'prix')::numeric,
           'qty', 1, 'remise', 0, 'isForfait', i->>'type' = 'forfait', 'forfaitId', case when i->>'type' = 'forfait' then (i->>'id')::int end)
           order by (i->>'ordre')::int), '[]'::jsonb) into v_se_items from jsonb_array_elements(o.items) i;
  insert into public.rdv_online (salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, service_id, service_nom, service_prix,
      items, collaborateur_id, collaborateur_nom, date_rdv, heure_rdv, duree_minutes, acompte_montant, acompte_paye, status, message, lieu,
      payment_intent_id, stripe_account, salon_edit)
    values (d.salon_id, coalesce(d.client_nom, ''), coalesce(d.client_prenom, ''), coalesce(d.client_tel, ''), coalesce(d.client_email, ''), d.client_luxyra_id,
      v_premier, left(coalesce(v_noms, o.libelle), 300), o.prix_total, v_items, o.collaborateur_id, o.collaborateur_nom, o.date_rdv, o.heure_rdv,
      o.duree_minutes, o.acompte_montant, false, p_statut,
      'RDV sur mesure (proposition #' || left(d.id::text, 8) || ', option ' || lx_prive.sm_lettre(o.rang) || ')'
        || case when p_acompte_salon and o.acompte_montant > 0 then ' — acompte de ' || to_char(o.acompte_montant, 'FM999990.00') || ' € à régler au salon' else '' end
        || case when o.note is not null then E'\n' || o.note else '' end,
      'salon', p_pi, p_compte,
      jsonb_build_object('phases', o.phases, 'items', v_se_items, 'at', now(), 'source', 'sur_mesure'))
    returning id into v_id;
  return v_id;
end $f$;

create or replace function lx_prive.sm_confirmer(d public.rdv_demandes, o public.rdv_demande_options, p_rdv uuid, p_session text)
 returns void language plpgsql set search_path to 'public', 'pg_temp' as $f$
begin
  update public.rdv_demande_options set statut = 'choisie', choisie_at = now() where id = o.id;
  update public.rdv_demande_options set statut = 'liberee' where demande_id = d.id and envoi = d.envoi and id <> o.id and statut in ('proposee', 'creneau_pris');
  update public.rdv_demandes set status = 'confirmed', confirmed_at = now(), rdv_online_id = p_rdv, option_choisie_id = o.id,
      proposed_data = lx_prive.sm_proposed_data(o), stripe_session_id = coalesce(p_session, stripe_session_id),
      checkout_option_id = null, checkout_session_id = null, checkout_expires_at = null, confirm_claim_at = null
   where id = d.id;
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 11. CHOIX SANS ACOMPTE EN LIGNE (edge rdv-demande-proposal-action v14, action « choose »)
-- ------------------------------------------------------------------------------------------------------------
create or replace function public.lx_demande_choisir(p_token text, p_option uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare r record; v_d public.rdv_demandes; v_o public.rdv_demande_options; v_rdv uuid; v_salon_acompte boolean := false;
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  select * into r from lx_prive.sm_demande_active(p_token, p_option);
  v_d := r.d; v_o := r.o;
  if v_o.acompte_montant > 0 then
    if lx_prive.sm_stripe_actif(v_d.salon_id) then
      return jsonb_build_object('ok', false, 'code', 'paiement', 'error', 'L''acompte de cette option se règle en ligne : utilisez le bouton de paiement.');
    end if;
    v_salon_acompte := true;  -- paiements en ligne désactivés depuis l'envoi : acompte à régler au salon (comme l'ancien format)
  end if;
  if (v_d.checkout_expires_at is not null and v_d.checkout_expires_at > now()) then
    return jsonb_build_object('ok', false, 'code', 'paiement_en_cours', 'error', 'Un paiement est en cours pour une autre option. Terminez-le ou attendez quelques minutes.');
  end if;
  if not lx_prive.sm_creneau_ou_pris(v_o) then
    return jsonb_build_object('ok', false, 'code', 'creneau_pris', 'creneau_pris', true,
      'error', 'Ce créneau vient d''être pris. L''établissement est prévenu ; vous pouvez choisir une autre option.');
  end if;
  v_rdv := lx_prive.sm_creer_rdv(v_d, v_o, 'confirmed', null, null, v_salon_acompte);
  perform lx_prive.sm_confirmer(v_d, v_o, v_rdv, null);
  return jsonb_build_object('ok', true, 'rdv_online_id', v_rdv, 'option_id', v_o.id, 'acompte_au_salon', v_salon_acompte);
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 12. PAIEMENT DE L'ACOMPTE (worker /api/rdv-demande/connect-pay puis /finalize et webhook « comptes connectés »)
-- ------------------------------------------------------------------------------------------------------------
create or replace function public.lx_demande_paiement_preparer(p_token text, p_option uuid)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare r record; v_d public.rdv_demandes; v_o public.rdv_demande_options; v_s public.salons;
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  select * into r from lx_prive.sm_demande_active(p_token, p_option);
  v_d := r.d; v_o := r.o;
  if v_o.acompte_montant <= 0 then return jsonb_build_object('ok', false, 'code', 'sans_acompte', 'error', 'Aucun acompte à régler pour cette option.'); end if;
  if not lx_prive.sm_stripe_actif(v_d.salon_id) then return jsonb_build_object('ok', false, 'code', 'stripe', 'error', 'Les paiements en ligne de l''établissement ne sont pas actifs.'); end if;
  if not lx_prive.sm_creneau_ou_pris(v_o) then
    return jsonb_build_object('ok', false, 'code', 'creneau_pris', 'creneau_pris', true,
      'error', 'Ce créneau vient d''être pris. L''établissement est prévenu. Aucun paiement n''a été effectué.');
  end if;
  select * into v_s from public.salons where id = v_d.salon_id;
  return jsonb_build_object('ok', true, 'demande_id', v_d.id, 'salon_id', v_d.salon_id, 'compte', v_s.stripe_connect_id,
    'option_id', v_o.id, 'lettre', lx_prive.sm_lettre(v_o.rang), 'montant_cents', (round(v_o.acompte_montant * 100))::bigint,
    'description', left('Acompte RDV ' || to_char(v_o.date_rdv, 'DD/MM') || ' ' || to_char(v_o.heure_rdv, 'HH24:MI') || ' — ' || v_o.libelle, 200),
    'email', v_d.client_email, 'nom', btrim(coalesce(v_d.client_prenom, '') || ' ' || coalesce(v_d.client_nom, '')),
    'session_precedente', case when v_d.checkout_expires_at > now() then v_d.checkout_session_id end,
    'expires_at', v_d.proposal_expires_at);
end $f$;

create or replace function public.lx_demande_paiement_enregistrer(p_token text, p_option uuid, p_session text, p_expires_at timestamptz)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_d public.rdv_demandes; v_prec text;
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  select * into v_d from public.rdv_demandes where proposal_token = p_token for update;
  if v_d.id is null or v_d.status <> 'proposed' then return jsonb_build_object('ok', false, 'code', 'inactive'); end if;
  if not exists (select 1 from public.rdv_demande_options where id = p_option and demande_id = v_d.id and envoi = v_d.envoi) then
    return jsonb_build_object('ok', false, 'code', 'option');
  end if;
  v_prec := case when v_d.checkout_session_id is distinct from p_session and v_d.checkout_expires_at > now() then v_d.checkout_session_id end;
  update public.rdv_demandes set checkout_option_id = p_option, checkout_session_id = p_session,
      checkout_expires_at = least(coalesce(p_expires_at, now() + interval '30 minutes'), now() + interval '24 hours')
   where id = v_d.id;
  return jsonb_build_object('ok', true, 'session_precedente', v_prec);
end $f$;

-- Après paiement confirmé par Stripe (relu chez Stripe par le worker). Idempotent par session.
-- Résultat : {ok, rdv_online_id} | {ok, deja} | {ok:false, code:'doublon'|'inactive'|'montant'|'option'} (le worker rembourse / alerte)
create or replace function public.lx_demande_paiement_finaliser(p_token text, p_session text, p_option uuid, p_pi text, p_compte text, p_cents bigint)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_d public.rdv_demandes; v_o public.rdv_demande_options; v_p public.rdv_demande_paiements; v_rdv uuid; v_libre boolean; v_cr jsonb;
  v_montant numeric := round(coalesce(p_cents, 0)::numeric / 100, 2);
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  if coalesce(p_session, '') = '' then return jsonb_build_object('ok', false, 'code', 'parametres'); end if;
  select * into v_d from public.rdv_demandes where proposal_token = p_token for update;
  if v_d.id is null then return jsonb_build_object('ok', false, 'code', 'introuvable'); end if;
  select * into v_p from public.rdv_demande_paiements where session_id = p_session;
  if v_p.id is not null then
    return jsonb_build_object('ok', v_p.statut = 'confirme', 'deja', true, 'statut', v_p.statut, 'rdv_online_id', v_p.rdv_online_id,
      'code', case when v_p.statut <> 'confirme' then 'doublon' end, 'paiement_id', v_p.id, 'refund_id', v_p.refund_id);
  end if;
  select * into v_o from public.rdv_demande_options where id = p_option and demande_id = v_d.id;

  -- paiement en trop : demande déjà confirmée (autre session / autre option), ou plus active, ou option d'un ancien envoi
  if v_d.status <> 'proposed' or v_o.id is null or v_o.envoi <> v_d.envoi or v_o.statut not in ('proposee', 'creneau_pris') then
    insert into public.rdv_demande_paiements (demande_id, salon_id, option_id, session_id, payment_intent, compte, montant, statut, detail)
      values (v_d.id, v_d.salon_id, v_o.id, p_session, p_pi, p_compte, v_montant, 'doublon',
        case when v_d.status = 'confirmed' then 'Demande déjà confirmée (autre paiement ou autre option)' else 'Proposition plus active (' || v_d.status || ')' end)
      returning * into v_p;
    return jsonb_build_object('ok', false, 'code', case when v_d.status = 'confirmed' then 'doublon' else 'inactive' end, 'paiement_id', v_p.id,
      'demande_id', v_d.id, 'salon_id', v_d.salon_id, 'status', v_d.status);
  end if;
  if v_montant + 0.004 < v_o.acompte_montant then
    insert into public.rdv_demande_paiements (demande_id, salon_id, option_id, session_id, payment_intent, compte, montant, statut, detail)
      values (v_d.id, v_d.salon_id, v_o.id, p_session, p_pi, p_compte, v_montant, 'doublon', 'Montant payé inférieur à l''acompte de l''option')
      returning * into v_p;
    return jsonb_build_object('ok', false, 'code', 'montant', 'paiement_id', v_p.id, 'demande_id', v_d.id, 'salon_id', v_d.salon_id);
  end if;

  -- créneau : la règle de l'ancien format est conservée (le paiement est reçu : le RDV est créé quand même), salon prévenu
  perform pg_advisory_xact_lock(hashtext('lx_rdv:' || v_o.salon_id::text || ':' || v_o.date_rdv::text));
  v_cr := lx_prive.demande_creneau(v_o.salon_id, v_o.collaborateur_id, v_o.date_rdv, v_o.heure_rdv, v_o.phases);
  v_libre := coalesce((v_cr->>'libre')::boolean, true);

  -- CHEMIN EXISTANT : INSERT « pending_payment » (acompte non payé) puis UPDATE « confirmed » + acompte_paye -> ticket scellé (déclencheurs)
  select id into v_rdv from public.rdv_online where payment_intent_id = p_pi and salon_id = v_d.salon_id limit 1;
  if v_rdv is null then v_rdv := lx_prive.sm_creer_rdv(v_d, v_o, 'pending_payment', p_pi, p_compte, false); end if;
  update public.rdv_online set status = 'confirmed', acompte_paye = true where id = v_rdv and not coalesce(acompte_paye, false);
  insert into public.rdv_demande_paiements (demande_id, salon_id, option_id, session_id, payment_intent, compte, montant, statut, rdv_online_id)
    values (v_d.id, v_d.salon_id, v_o.id, p_session, p_pi, p_compte, v_montant, 'confirme', v_rdv);
  perform lx_prive.sm_confirmer(v_d, v_o, v_rdv, p_session);
  if not v_libre then
    insert into public.notifications (salon_id, type, title, detail, data, source_table, source_id)
    values (v_d.salon_id, 'rdv_demande_double_reservation', '⚠️ Double réservation possible',
      trim(coalesce(v_d.client_prenom, '') || ' ' || coalesce(v_d.client_nom, '')) || ' a payé l''acompte de l''option ' || lx_prive.sm_lettre(v_o.rang)
        || ' (' || to_char(v_o.date_rdv, 'DD/MM') || ' ' || to_char(v_o.heure_rdv, 'HH24:MI') || ') alors que ce créneau venait d''être pris. Vérifiez votre planning.',
      jsonb_build_object('demande_id', v_d.id, 'rdv_id', v_rdv), 'rdv_demandes_double_resa', v_d.id)
    on conflict (source_table, source_id) do nothing;
  end if;
  return jsonb_build_object('ok', true, 'rdv_online_id', v_rdv, 'option_id', v_o.id, 'creneau_libre', v_libre);
end $f$;

-- paiement en trop remboursé par le worker (ou échec du remboursement)
create or replace function public.lx_demande_paiement_rembourse(p_paiement uuid, p_refund_id text, p_ok boolean, p_detail text default null)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  update public.rdv_demande_paiements set statut = case when p_ok then 'rembourse' else 'remboursement_echec' end, refund_id = coalesce(p_refund_id, refund_id),
      detail = left(coalesce(p_detail, detail), 500), updated_at = now()
   where id = p_paiement and statut in ('doublon', 'remboursement_echec');
end $f$;

-- refus par le client (v2) : avec message
create or replace function public.lx_demande_refuser(p_token text, p_raison text)
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_d public.rdv_demandes;
begin
  if not lx_prive.appel_serveur() then perform lx_prive.sm_erreur('LX_SM_INTERDIT', 'Accès refusé'); end if;
  select * into v_d from public.rdv_demandes where proposal_token = p_token for update;
  if v_d.id is null then return jsonb_build_object('ok', false, 'code', 'introuvable', 'error', 'Proposition introuvable'); end if;
  if v_d.status <> 'proposed' then return jsonb_build_object('ok', false, 'code', 'inactive', 'error', 'Cette proposition n''est plus active'); end if;
  if v_d.checkout_expires_at > now() or v_d.confirm_claim_at > now() - interval '3 minutes' then
    return jsonb_build_object('ok', false, 'code', 'paiement_en_cours', 'error', 'Un paiement est en cours sur cette proposition : réessayez dans quelques minutes.');
  end if;
  update public.rdv_demandes set status = 'refused', refused_at = now(), refuse_reason = nullif(btrim(left(coalesce(p_raison, ''), 500)), '') where id = v_d.id;
  return jsonb_build_object('ok', true);
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 13. PROTECTION : proposition envoyée non modifiable par l'établissement ; colonnes serveur à l'insertion
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.rdv_demandes_garde()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  if lx_prive.appel_serveur() then return NEW; end if;
  if TG_OP = 'INSERT' then
    NEW.proposal_version := 1; NEW.envoi := 0; NEW.expire_heures := null; NEW.option_choisie_id := null; NEW.checkout_option_id := null;
    NEW.checkout_session_id := null; NEW.checkout_expires_at := null; NEW.vue_at := null; NEW.relance_at := null; NEW.rappel_salon_at := null;
    return NEW;
  end if;
  -- l'établissement ne peut changer que le statut (et effacer le motif) : tout le reste est figé
  if (to_jsonb(NEW) - 'status' - 'refuse_reason') is distinct from (to_jsonb(OLD) - 'status' - 'refuse_reason') then
    raise exception 'Une proposition envoyée ne peut plus être modifiée : annulez-la ou proposez un autre horaire.' using errcode = 'P0001', hint = 'LX_DEMANDE_PROTEGEE';
  end if;
  if NEW.refuse_reason is distinct from OLD.refuse_reason and NEW.refuse_reason is not null then
    raise exception 'Motif réservé au client' using errcode = 'P0001', hint = 'LX_DEMANDE_PROTEGEE';
  end if;
  if NEW.status is distinct from OLD.status then
    if not ((OLD.status = 'proposed' and NEW.status in ('pending', 'cancelled_by_salon')) or (OLD.status = 'pending' and NEW.status = 'cancelled_by_salon')) then
      raise exception 'Changement de statut non autorisé (% -> %)', OLD.status, NEW.status using errcode = 'P0001', hint = 'LX_DEMANDE_STATUT';
    end if;
    if OLD.confirm_claim_at > now() - interval '3 minutes' then
      raise exception 'Le client est en train de confirmer : réessayez dans quelques minutes.' using errcode = 'P0001', hint = 'LX_DEMANDE_EN_COURS';
    end if;
  end if;
  return NEW;
end $f$;
drop trigger if exists a_lx_rdv_demandes_garde on public.rdv_demandes;
create trigger a_lx_rdv_demandes_garde before insert or update on public.rdv_demandes for each row execute function lx_prive.rdv_demandes_garde();

-- options de l'envoi en cours selon le statut de la demande (tous les chemins, ancien code compris)
create or replace function lx_prive.trg_rdv_demandes_options_suivi()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_nom text := coalesce(nullif(trim(coalesce(NEW.client_prenom, '') || ' ' || coalesce(NEW.client_nom, '')), ''), 'Client');
begin
  if NEW.status is distinct from OLD.status and OLD.status = 'proposed' then
    if NEW.status = 'pending' then
      update public.rdv_demande_options set statut = 'remplacee' where demande_id = NEW.id and envoi = NEW.envoi and statut in ('proposee', 'creneau_pris');
    elsif NEW.status in ('refused', 'expired', 'cancelled_by_salon') then
      update public.rdv_demande_options set statut = 'liberee' where demande_id = NEW.id and envoi = NEW.envoi and statut in ('proposee', 'creneau_pris');
    end if;
    if NEW.status = 'expired' then
      insert into public.notifications (salon_id, type, title, detail, data, source_table, source_id)
      values (NEW.salon_id, 'rdv_demande_expiree', '⌛ Proposition expirée', v_nom || ' n''a choisi aucune option. Vous pouvez le recontacter.',
              jsonb_build_object('demande_id', NEW.id), 'rdv_demandes_expiree_' || NEW.envoi, NEW.id)
      on conflict (source_table, source_id) do nothing;
    end if;
  end if;
  if NEW.vue_at is not null and OLD.vue_at is null and coalesce(NEW.proposal_version, 1) = 2 then
    insert into public.notifications (salon_id, type, title, detail, data, source_table, source_id)
    values (NEW.salon_id, 'rdv_demande_vue', '👀 Proposition consultée', v_nom || ' a ouvert votre proposition.',
            jsonb_build_object('demande_id', NEW.id), 'rdv_demandes_vue_' || NEW.envoi, NEW.id)
    on conflict (source_table, source_id) do nothing;
  end if;
  return NEW;
exception when others then
  raise warning 'trg_rdv_demandes_options_suivi: %', sqlerrm; return NEW;
end $f$;
drop trigger if exists trg_rdv_demandes_options_suivi on public.rdv_demandes;
create trigger trg_rdv_demandes_options_suivi after update on public.rdv_demandes for each row execute function lx_prive.trg_rdv_demandes_options_suivi();

create or replace function lx_prive.trg_rdv_demande_option_notif()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare v_d public.rdv_demandes;
begin
  if NEW.statut = 'creneau_pris' and OLD.statut is distinct from 'creneau_pris' then
    select * into v_d from public.rdv_demandes where id = NEW.demande_id;
    insert into public.notifications (salon_id, type, title, detail, data, source_table, source_id)
    values (NEW.salon_id, 'demande_creneau_pris', '⚠️ Créneau pris : option ' || lx_prive.sm_lettre(NEW.rang),
      coalesce(nullif(trim(coalesce(v_d.client_prenom, '') || ' ' || coalesce(v_d.client_nom, '')), ''), 'Le client') || ' voulait l''option '
        || lx_prive.sm_lettre(NEW.rang) || ' du ' || to_char(NEW.date_rdv, 'DD/MM') || ' à ' || to_char(NEW.heure_rdv, 'HH24:MI')
        || ', mais ce créneau a été pris entre-temps. Proposez un autre horaire si besoin.',
      jsonb_build_object('demande_id', NEW.demande_id, 'option_id', NEW.id), 'rdv_demande_options_creneau_pris', NEW.id)
    on conflict (source_table, source_id) do nothing;
  end if;
  return NEW;
exception when others then
  raise warning 'trg_rdv_demande_option_notif: %', sqlerrm; return NEW;
end $f$;
drop trigger if exists trg_rdv_demande_option_notif on public.rdv_demande_options;
create trigger trg_rdv_demande_option_notif after update of statut on public.rdv_demande_options for each row execute function lx_prive.trg_rdv_demande_option_notif();

-- ------------------------------------------------------------------------------------------------------------
-- 14. ÉCHÉANCES (tâche planifiée */15) : expiration, relance du client, rappel à l'établissement
--     E-mails au client envoyés par le worker (/api/rdv-demande/notifier, x-lx-internal) — jamais bloquant.
-- ------------------------------------------------------------------------------------------------------------
create or replace function lx_prive.sm_notifier_worker(p_demande uuid, p_type text)
 returns void language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  perform net.http_post(url := 'https://luxyra.fr/api/rdv-demande/notifier',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-lx-internal', lx_prive.cle_service()),
    body := jsonb_build_object('demande_id', p_demande, 'type', p_type), timeout_milliseconds := 30000);
exception when others then
  begin perform public.report_server_error(p_source := 'sql:rdv_sur_mesure', p_message := 'Envoi ' || p_type || ' impossible : ' || left(sqlerrm, 300), p_severity := 'warning',
    p_context := jsonb_build_object('demande_id', p_demande)); exception when others then null; end;
end $f$;

create or replace function lx_prive.demandes_sur_mesure_echeances()
 returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
declare r record; n_exp int := 0; n_rel int := 0; n_rap int := 0;
begin
  -- 1) propositions expirées (jamais pendant un paiement Stripe ou une confirmation en cours)
  for r in select id, proposal_version from public.rdv_demandes
            where status = 'proposed' and proposal_expires_at < now()
              and coalesce(checkout_expires_at, '-infinity') < now() and coalesce(confirm_claim_at, '-infinity') < now() - interval '3 minutes'
            order by proposal_expires_at limit 200 for update skip locked loop
    update public.rdv_demandes set status = 'expired' where id = r.id and status = 'proposed';
    n_exp := n_exp + 1;
    if r.proposal_version = 2 then perform lx_prive.sm_notifier_worker(r.id, 'expiree'); end if;
  end loop;
  -- 2) relance du client, UNE fois, dans les 24 h avant l'expiration (au moins 12 h après l'envoi, rien de choisi)
  for r in select id from public.rdv_demandes
            where status = 'proposed' and proposal_version = 2 and relance_at is null
              and proposal_expires_at between now() + interval '1 hour' and now() + interval '24 hours'
              and proposed_at < now() - interval '12 hours' and coalesce(checkout_expires_at, '-infinity') < now()
            limit 200 for update skip locked loop
    update public.rdv_demandes set relance_at = now() where id = r.id;
    n_rel := n_rel + 1;
    perform lx_prive.sm_notifier_worker(r.id, 'relance');
  end loop;
  -- 3) rappel à l'établissement : demande sans réponse depuis 24 h (une fois, demandes de moins de 30 jours)
  for r in select id, salon_id, client_prenom, client_nom, demande_text from public.rdv_demandes
            where status = 'pending' and rappel_salon_at is null and created_at < now() - interval '24 hours' and created_at > now() - interval '30 days'
            limit 200 for update skip locked loop
    update public.rdv_demandes set rappel_salon_at = now() where id = r.id;
    insert into public.notifications (salon_id, type, title, detail, data, source_table, source_id)
    values (r.salon_id, 'rdv_demande_rappel', '⏰ Demande sur mesure sans réponse',
      coalesce(nullif(trim(coalesce(r.client_prenom, '') || ' ' || coalesce(r.client_nom, '')), ''), 'Un client') || ' attend votre proposition depuis plus de 24 h · '
        || left(coalesce(r.demande_text, ''), 80), jsonb_build_object('demande_id', r.id), 'rdv_demandes_rappel', r.id)
    on conflict (source_table, source_id) do nothing;
    n_rap := n_rap + 1;
  end loop;
  return jsonb_build_object('expirees', n_exp, 'relances', n_rel, 'rappels', n_rap);
end $f$;

-- ------------------------------------------------------------------------------------------------------------
-- 15. DROITS : RPC réservées au rôle service (edge functions, worker) ; fonctions internes : propriétaire seulement
-- ------------------------------------------------------------------------------------------------------------
do $g$
declare f text;
begin
  foreach f in array array[
    'public.lx_demande_proposer(uuid, uuid, jsonb, integer, boolean)', 'public.lx_demande_consulter(text)', 'public.lx_demande_choisir(text, uuid)',
    'public.lx_demande_paiement_preparer(text, uuid)', 'public.lx_demande_paiement_enregistrer(text, uuid, text, timestamptz)',
    'public.lx_demande_paiement_finaliser(text, text, uuid, text, text, bigint)', 'public.lx_demande_paiement_rembourse(uuid, text, boolean, text)',
    'public.lx_demande_refuser(text, text)'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
    execute 'grant execute on function ' || f || ' to service_role';
  end loop;
  foreach f in array array[
    'lx_prive.sm_erreur(text, text)', 'lx_prive.sm_phases(jsonb, text)', 'lx_prive.sm_minutes(time)', 'lx_prive.sm_hhmm(integer)', 'lx_prive.sm_stripe_actif(uuid)',
    'lx_prive.sm_lettre(integer)', 'lx_prive.demande_creneau(uuid, integer, date, time, jsonb)', 'lx_prive.demande_option_calculer(uuid, jsonb)',
    'lx_prive.sm_option_json(public.rdv_demande_options)', 'lx_prive.sm_demande_active(text, uuid)', 'lx_prive.sm_creneau_ou_pris(public.rdv_demande_options)',
    'lx_prive.sm_proposed_data(public.rdv_demande_options)', 'lx_prive.sm_creer_rdv(public.rdv_demandes, public.rdv_demande_options, text, text, text, boolean)',
    'lx_prive.sm_confirmer(public.rdv_demandes, public.rdv_demande_options, uuid, text)', 'lx_prive.rdv_demandes_garde()',
    'lx_prive.trg_rdv_demandes_options_suivi()', 'lx_prive.trg_rdv_demande_option_notif()', 'lx_prive.sm_notifier_worker(uuid, text)',
    'lx_prive.demandes_sur_mesure_echeances()'] loop
    execute 'revoke all on function ' || f || ' from public, anon, authenticated';
  end loop;
end $g$;

-- ------------------------------------------------------------------------------------------------------------
-- 16. TÂCHE PLANIFIÉE
-- ------------------------------------------------------------------------------------------------------------
select cron.schedule('rdv-sur-mesure-echeances', '*/15 * * * *', 'select lx_prive.demandes_sur_mesure_echeances()');

commit;

-- ============================================================================================================
-- CONTRÔLES APRÈS APPLICATION (lecture seule) :
--   select md5(pg_get_functiondef('public.lx_creneau_libre(uuid,integer,date,time,integer)'::regprocedure));  -- = ca25c283c1223cfbe1d5b15c89d105ee
--   select has_function_privilege('anon', 'public.lx_demande_proposer(uuid,uuid,jsonb,integer,boolean)', 'EXECUTE');      -- false
--   select has_function_privilege('authenticated', 'public.lx_demande_choisir(text,uuid)', 'EXECUTE');                    -- false
--   select has_table_privilege('anon', 'public.rdv_demande_options', 'SELECT');                                           -- false
--   select jobname, schedule from cron.job where jobname = 'rdv-sur-mesure-echeances';                                    -- */15
--   select lx_prive.demandes_sur_mesure_echeances();   -- {"expirees":0,"relances":0,"rappels":…} (rappel de la demande en attente)
-- RETOUR ARRIÈRE : surmesure_v2_retour_arriere.sql (remet lx_creneau_libre de production, retire déclencheurs, tâche,
-- fonctions et RPC ; tables et colonnes CONSERVÉES — données des propositions v2 gardées pour l'historique).
-- ============================================================================================================
