-- 2026-10-31 — Suppression d'un établissement SANS AUCUNE VENTE EN CAISSE RÉELLE (validé par Alexandre).
-- Cas visé : établissement de démonstration ou essai abandonné, passé en caisse « réelle » mais qui n'a jamais
-- rien encaissé après ce passage (toutes ses opérations dataient du mode test et ont été archivées/vidées au passage).
-- Aucune fonction NF525 / caisse existante n'est modifiée. La suppression réutilise EXACTEMENT le mécanisme
-- de purge_salon_6ans : drapeau de transaction luxyra.purge_6ans = '1' puis public.admin_delete_salon_cascade.
-- Preuve conservée AVANT suppression (archive JSON complète + SHA-256) dans lx_prive.archives_suppression_editeur
-- (ajout seul) et en copie dans le bucket privé lx-archives-editeur. Script rejouable, sans données.

-- 1. Archives de suppression (ajout seul, jamais lisibles par les rôles connectés)
create table if not exists lx_prive.archives_suppression_editeur (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null,
  nom text,
  motif text not null,
  preuve_aucune_vente jsonb not null,
  contenu jsonb not null,
  sha256 text not null,
  chemin text,
  created_at timestamptz not null default now(),
  supprime_le timestamptz
);
revoke all on lx_prive.archives_suppression_editeur from public, anon, authenticated;

create or replace function lx_prive.archives_suppression_editeur_garde() returns trigger
language plpgsql set search_path to 'pg_catalog' as $$
begin
  if tg_op = 'DELETE' then raise exception 'Archive de suppression : effacement interdit'; end if;
  -- seule évolution permise : poser supprime_le (une fois) et le chemin de la copie en stockage
  if new.salon_id is distinct from old.salon_id or new.contenu is distinct from old.contenu or new.sha256 is distinct from old.sha256
     or new.preuve_aucune_vente is distinct from old.preuve_aucune_vente or new.motif is distinct from old.motif
     or new.nom is distinct from old.nom or new.created_at is distinct from old.created_at
     or (old.supprime_le is not null and new.supprime_le is distinct from old.supprime_le)
     or (old.chemin is not null and new.chemin is distinct from old.chemin) then
    raise exception 'Archive de suppression : modification interdite';
  end if;
  return new;
end $$;
drop trigger if exists archives_suppression_editeur_garde on lx_prive.archives_suppression_editeur;
create trigger archives_suppression_editeur_garde before update or delete on lx_prive.archives_suppression_editeur
  for each row execute function lx_prive.archives_suppression_editeur_garde();

-- 2. Bucket privé (aucune politique : lecture uniquement par la clé service)
insert into storage.buckets (id, name, public) values ('lx-archives-editeur', 'lx-archives-editeur', false)
  on conflict (id) do update set public = false;

-- 3. Preuve « aucune vente en caisse réelle »
create or replace function lx_prive.salon_preuve_aucune_vente_reelle(p_salon uuid) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object(
    'mode_reel_depuis', s.mode_reel_depuis,
    'tickets', (select count(*) from tickets where salon_id = s.id),
    'clotures', (select count(*) from clotures where salon_id = s.id),
    'clotures_periodiques', (select count(*) from clotures_mensuelles where salon_id = s.id)
                          + (select count(*) from clotures_annuelles where salon_id = s.id)
                          + (select count(*) from clotures_exercices where salon_id = s.id),
    'factures_clients', (select count(*) from factures_clients where salon_id = s.id),
    'bons_cadeaux', (select count(*) from cartes_cadeaux where salon_id = s.id),
    'bons_mouvements', (select count(*) from cartes_cadeaux_mouvements where salon_id = s.id),
    'packs_clients', (select count(*) from packs_clients where salon_id = s.id),
    'corrections_reglement', (select count(*) from corrections_reglement where salon_id = s.id),
    'duplicatas', (select count(*) from nf525_duplicatas where salon_id = s.id),
    'archives', (select count(*) from archives where salon_id = s.id),
    'commandes_payees_en_ligne', (select count(*) from commandes_online where salon_id = s.id and (paye or stripe_payment_id is not null or payment_intent_id is not null)),
    'signatures_operations_apres_reel', (select count(*) from nf525_signatures g where g.salon_id = s.id and g.source_table <> 'nf525_jet' and g.signed_at >= coalesce(s.mode_reel_depuis, '-infinity')),
    'scellements_apres_reel', (select count(*) from nf525_hash_seal h where h.salon_id = s.id and h.sealed_at >= coalesce(s.mode_reel_depuis, '-infinity')),
    'jet_fiscal_apres_reel', (select count(*) from nf525_jet j where j.salon_id = s.id and j.code in (20,30,50,60,155,190,420,901) and j.horodatage >= coalesce(s.mode_reel_depuis, '-infinity')),
    'purges_mode_test', (select coalesce(jsonb_agg(jsonb_build_object('le', p.created_at, 'motif', p.motif, 'nb', p.nb, 'empreinte', p.empreinte) order by p.created_at), '[]') from nf525_archives_purge p where p.salon_id = s.id),
    'abonnement_stripe', s.stripe_subscription_id is not null,
    'offert_actif', coalesce(s.is_free, false) and (s.free_until is null or s.free_until > current_date)
  ) from salons s where s.id = p_salon;
$$;
revoke all on function lx_prive.salon_preuve_aucune_vente_reelle(uuid) from public, anon, authenticated;

create or replace function lx_prive.salon_aucune_vente_reelle(p jsonb) returns boolean
language sql immutable as $$
  select p is not null
     and (p->>'tickets')::int = 0 and (p->>'clotures')::int = 0 and (p->>'clotures_periodiques')::int = 0
     and (p->>'factures_clients')::int = 0 and (p->>'bons_cadeaux')::int = 0 and (p->>'bons_mouvements')::int = 0
     and (p->>'packs_clients')::int = 0 and (p->>'corrections_reglement')::int = 0 and (p->>'duplicatas')::int = 0
     and (p->>'archives')::int = 0 and (p->>'commandes_payees_en_ligne')::int = 0
     and (p->>'signatures_operations_apres_reel')::int = 0 and (p->>'scellements_apres_reel')::int = 0
     and (p->>'jet_fiscal_apres_reel')::int = 0
     and not (p->>'abonnement_stripe')::boolean and not (p->>'offert_actif')::boolean;
$$;

-- 4. Archive complète (toutes les tables public / lx_prive portant salon_id + la ligne salons)
create or replace function lx_prive.salon_archiver_avant_suppression(p_salon uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r record; v jsonb := '{}'::jsonb; v_rows jsonb; v_preuve jsonb; v_sha text; v_id uuid; v_nom text;
begin
  if p_salon in ('e0cf27c7-d402-4d76-8e91-9ef5231b3582', '4bb782f4-7dab-49b1-be93-105564e7a5cc') then
    raise exception 'Établissement protégé : archivage pour suppression refusé'; end if;
  if length(coalesce(trim(p_motif), '')) < 15 then raise exception 'Motif obligatoire (15 caractères minimum)'; end if;
  select nom into v_nom from salons where id = p_salon;
  if not found then raise exception 'Établissement introuvable'; end if;
  v_preuve := lx_prive.salon_preuve_aucune_vente_reelle(p_salon);
  if not lx_prive.salon_aucune_vente_reelle(v_preuve) then raise exception 'Ventes ou opérations réelles présentes : archivage pour suppression refusé (%)', v_preuve; end if;
  v := jsonb_build_object('salons', (select jsonb_agg(to_jsonb(s)) from salons s where s.id = p_salon));
  for r in select c.table_schema sch, c.table_name tbl from information_schema.columns c
             join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name and t.table_type = 'BASE TABLE'
            where c.column_name = 'salon_id' and c.table_schema in ('public', 'lx_prive')
              and c.table_name <> 'archives_suppression_editeur' order by 1, 2 loop
    execute format('select jsonb_agg(to_jsonb(x)) from %I.%I x where x.salon_id = $1', r.sch, r.tbl) into v_rows using p_salon;
    if v_rows is not null then v := v || jsonb_build_object(r.sch || '.' || r.tbl, v_rows); end if;
  end loop;
  v := jsonb_build_object('format', 'luxyra-archive-suppression-v1', 'salon_id', p_salon, 'genere_le', now(),
                          'motif', p_motif, 'preuve_aucune_vente', v_preuve, 'donnees', v);
  v_sha := encode(extensions.digest(convert_to(v::text, 'UTF8'), 'sha256'), 'hex');
  insert into lx_prive.archives_suppression_editeur(salon_id, nom, motif, preuve_aucune_vente, contenu, sha256)
    values (p_salon, v_nom, p_motif, v_preuve, v, v_sha) returning id into v_id;
  return jsonb_build_object('archive_id', v_id, 'sha256', v_sha, 'tables', (select count(*) from jsonb_object_keys(v->'donnees')));
end $$;
revoke all on function lx_prive.salon_archiver_avant_suppression(uuid, text) from public, anon, authenticated;

-- 5. Suppression (mécanisme de purge_salon_6ans, inchangé)
create or replace function lx_prive.admin_supprimer_salon_sans_vente_reelle(p_salon uuid, p_motif text) returns jsonb
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare s salons; v_preuve jsonb; v_arch lx_prive.archives_suppression_editeur; r jsonb;
begin
  -- liste noire codée en dur : établissements réels à ne jamais supprimer par cette voie
  if p_salon in ('e0cf27c7-d402-4d76-8e91-9ef5231b3582', '4bb782f4-7dab-49b1-be93-105564e7a5cc') then
    raise exception 'Établissement protégé : suppression refusée'; end if;
  if length(coalesce(trim(p_motif), '')) < 15 then raise exception 'Motif obligatoire (15 caractères minimum)'; end if;
  select * into s from salons where id = p_salon for update;
  if s.id is null then return jsonb_build_object('ok', false, 'err', 'introuvable'); end if;
  if s.stripe_subscription_id is not null or (coalesce(s.is_free, false) and (s.free_until is null or s.free_until > current_date)) then
    raise exception 'Abonnement Stripe ou offre en cours : suppression refusée'; end if;
  v_preuve := lx_prive.salon_preuve_aucune_vente_reelle(p_salon);
  if not lx_prive.salon_aucune_vente_reelle(v_preuve) then raise exception 'Ventes ou opérations réelles présentes : suppression refusée (%)', v_preuve; end if;
  select * into v_arch from lx_prive.archives_suppression_editeur a
   where a.salon_id = p_salon and a.supprime_le is null order by a.created_at desc limit 1;
  if v_arch.id is null then raise exception 'Archive de preuve absente : lancer d''abord lx_prive.salon_archiver_avant_suppression'; end if;
  if v_arch.sha256 <> encode(extensions.digest(convert_to(v_arch.contenu::text, 'UTF8'), 'sha256'), 'hex') then
    raise exception 'Archive de preuve altérée'; end if;
  -- même mécanisme que purge_salon_6ans (aucune fonction NF525 modifiée)
  perform set_config('luxyra.purge_6ans', '1', true);
  r := public.admin_delete_salon_cascade(p_salon);
  perform set_config('luxyra.purge_6ans', '', true);
  if coalesce((r->>'ok')::boolean, false) is not true or coalesce((r->>'orphans_total')::bigint, 0) > 0 then
    raise exception 'suppression échouée : %', r; end if;
  update lx_prive.archives_suppression_editeur set supprime_le = now() where id = v_arch.id;
  insert into admin_log(action, details) values ('SALON_SUPPRIME_SANS_VENTE_REELLE',
    jsonb_build_object('salon_id', p_salon, 'archive_id', v_arch.id, 'sha256', v_arch.sha256, 'lignes', r->>'rows_deleted')::text);
  return jsonb_build_object('ok', true, 'lignes', r->'rows_deleted', 'archive_id', v_arch.id, 'sha256', v_arch.sha256, 'detail', r->'deleted');
end $$;
revoke all on function lx_prive.admin_supprimer_salon_sans_vente_reelle(uuid, text) from public, anon, authenticated;

-- ============================================================================================
-- 6. Durcissement du 31/10/2026 (vérification indépendante après les 2 suppressions)
--    a) refus étendu : établissement actif, déjà abonné, client ou compte Connect Stripe, essai en cours
--    b) contrôles « aucune vente » sûrs face aux valeurs manquantes (clé absente = refus ; `is not true`)
--    c) archive : TRUNCATE refusé ; conservation 6 ans puis purge contrôlée (ligne + copie du bucket)
-- ============================================================================================
create or replace function lx_prive.salon_preuve_aucune_vente_reelle(p_salon uuid) returns jsonb
language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object(
    'mode_reel_depuis', s.mode_reel_depuis,
    'tickets', (select count(*) from tickets where salon_id = s.id),
    'clotures', (select count(*) from clotures where salon_id = s.id),
    'clotures_periodiques', (select count(*) from clotures_mensuelles where salon_id = s.id)
                          + (select count(*) from clotures_annuelles where salon_id = s.id)
                          + (select count(*) from clotures_exercices where salon_id = s.id),
    'factures_clients', (select count(*) from factures_clients where salon_id = s.id),
    'bons_cadeaux', (select count(*) from cartes_cadeaux where salon_id = s.id),
    'bons_mouvements', (select count(*) from cartes_cadeaux_mouvements where salon_id = s.id),
    'packs_clients', (select count(*) from packs_clients where salon_id = s.id),
    'corrections_reglement', (select count(*) from corrections_reglement where salon_id = s.id),
    'duplicatas', (select count(*) from nf525_duplicatas where salon_id = s.id),
    'archives', (select count(*) from archives where salon_id = s.id),
    'commandes_payees_en_ligne', (select count(*) from commandes_online where salon_id = s.id and (paye or stripe_payment_id is not null or payment_intent_id is not null)),
    'signatures_operations_apres_reel', (select count(*) from nf525_signatures g where g.salon_id = s.id and g.source_table <> 'nf525_jet' and g.signed_at >= coalesce(s.mode_reel_depuis, '-infinity')),
    'scellements_apres_reel', (select count(*) from nf525_hash_seal h where h.salon_id = s.id and h.sealed_at >= coalesce(s.mode_reel_depuis, '-infinity')),
    'jet_fiscal_apres_reel', (select count(*) from nf525_jet j where j.salon_id = s.id and j.code in (20,30,50,60,155,190,420,901) and j.horodatage >= coalesce(s.mode_reel_depuis, '-infinity')),
    'purges_mode_test', (select coalesce(jsonb_agg(jsonb_build_object('le', p.created_at, 'motif', p.motif, 'nb', p.nb, 'empreinte', p.empreinte) order by p.created_at), '[]') from nf525_archives_purge p where p.salon_id = s.id),
    'abonnement_stripe', s.stripe_subscription_id is not null,
    'offert_actif', coalesce(s.is_free, false) and (s.free_until is null or s.free_until > current_date),
    'statut_actif', coalesce(s.status, '') = 'active',
    'deja_abonne', s.abonne_depuis is not null,
    'client_stripe', coalesce(s.stripe_customer_id, '') <> '',
    'connect_stripe', coalesce(s.stripe_connect_id, '') <> '',
    'essai_en_cours', s.trial_end is not null and s.trial_end > now()
  ) from salons s where s.id = p_salon;
$$;
revoke all on function lx_prive.salon_preuve_aucune_vente_reelle(uuid) from public, anon, authenticated;

-- clé absente ou illisible = refus (coalesce vers la valeur qui refuse)
create or replace function lx_prive.salon_aucune_vente_reelle(p jsonb) returns boolean
language sql immutable as $$
  select coalesce(p is not null
     and coalesce((p->>'tickets')::int, 1) = 0 and coalesce((p->>'clotures')::int, 1) = 0 and coalesce((p->>'clotures_periodiques')::int, 1) = 0
     and coalesce((p->>'factures_clients')::int, 1) = 0 and coalesce((p->>'bons_cadeaux')::int, 1) = 0 and coalesce((p->>'bons_mouvements')::int, 1) = 0
     and coalesce((p->>'packs_clients')::int, 1) = 0 and coalesce((p->>'corrections_reglement')::int, 1) = 0 and coalesce((p->>'duplicatas')::int, 1) = 0
     and coalesce((p->>'archives')::int, 1) = 0 and coalesce((p->>'commandes_payees_en_ligne')::int, 1) = 0
     and coalesce((p->>'signatures_operations_apres_reel')::int, 1) = 0 and coalesce((p->>'scellements_apres_reel')::int, 1) = 0
     and coalesce((p->>'jet_fiscal_apres_reel')::int, 1) = 0
     and coalesce((p->>'abonnement_stripe')::boolean, true) = false and coalesce((p->>'offert_actif')::boolean, true) = false
     and coalesce((p->>'statut_actif')::boolean, true) = false and coalesce((p->>'deja_abonne')::boolean, true) = false
     and coalesce((p->>'client_stripe')::boolean, true) = false and coalesce((p->>'connect_stripe')::boolean, true) = false
     and coalesce((p->>'essai_en_cours')::boolean, true) = false, false);
$$;

-- garde commune (liste noire + abonnement/offre/actif/Stripe/essai), appelée par l'archivage ET la suppression
create or replace function lx_prive.salon_suppression_garde(p_salon uuid) returns void
language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $$
declare s salons;
begin
  if p_salon in ('e0cf27c7-d402-4d76-8e91-9ef5231b3582', '4bb782f4-7dab-49b1-be93-105564e7a5cc') then
    raise exception 'Établissement protégé : suppression refusée'; end if;
  select * into s from salons where id = p_salon;
  if s.id is null then raise exception 'Établissement introuvable'; end if;
  if s.stripe_subscription_id is not null
     or (coalesce(s.is_free, false) and (s.free_until is null or s.free_until > current_date))
     or coalesce(s.status, '') = 'active' or s.abonne_depuis is not null
     or coalesce(s.stripe_customer_id, '') <> '' or coalesce(s.stripe_connect_id, '') <> ''
     or (s.trial_end is not null and s.trial_end > now()) then
    raise exception 'Établissement actif, abonné, client ou compte Stripe, ou essai en cours : suppression refusée'; end if;
end $$;
revoke all on function lx_prive.salon_suppression_garde(uuid) from public, anon, authenticated;

do $$
declare d text;
begin
  -- archivage : garde commune + contrôle « is not true »
  d := pg_get_functiondef('lx_prive.salon_archiver_avant_suppression(uuid,text)'::regprocedure);
  if position('lx_prive.salon_suppression_garde(p_salon)' in d) = 0 then
    if position('  if length(coalesce(trim(p_motif), '''')) < 15 then raise exception ''Motif obligatoire (15 caractères minimum)''; end if;
  select nom into v_nom' in d) = 0 then raise exception 'motif archivage introuvable'; end if;
    d := replace(d, '  if length(coalesce(trim(p_motif), '''')) < 15 then raise exception ''Motif obligatoire (15 caractères minimum)''; end if;
  select nom into v_nom', '  perform lx_prive.salon_suppression_garde(p_salon);
  if length(coalesce(trim(p_motif), '''')) < 15 then raise exception ''Motif obligatoire (15 caractères minimum)''; end if;
  select nom into v_nom');
  end if;
  d := replace(d, 'if not lx_prive.salon_aucune_vente_reelle(v_preuve) then', 'if lx_prive.salon_aucune_vente_reelle(v_preuve) is not true then');
  execute d;
  -- suppression : garde commune + contrôle « is not true »
  d := pg_get_functiondef('lx_prive.admin_supprimer_salon_sans_vente_reelle(uuid,text)'::regprocedure);
  if position('lx_prive.salon_suppression_garde(p_salon)' in d) = 0 then
    if position('  select * into s from salons where id = p_salon for update;' in d) = 0 then raise exception 'motif suppression introuvable'; end if;
    d := replace(d, '  select * into s from salons where id = p_salon for update;', '  perform lx_prive.salon_suppression_garde(p_salon);
  select * into s from salons where id = p_salon for update;');
  end if;
  d := replace(d, 'if not lx_prive.salon_aucune_vente_reelle(v_preuve) then', 'if lx_prive.salon_aucune_vente_reelle(v_preuve) is not true then');
  execute d;
end $$;

-- archive : effacement seulement par la purge de conservation (drapeau de transaction posé par elle seule)
create or replace function lx_prive.archives_suppression_editeur_garde() returns trigger
language plpgsql set search_path to 'pg_catalog' as $$
begin
  if tg_op = 'TRUNCATE' then raise exception 'Archive de suppression : effacement en bloc interdit'; end if;
  if tg_op = 'DELETE' then
    if coalesce(current_setting('luxyra.purge_archives_editeur', true), '') = '1' and old.created_at < now() - interval '6 years' then
      return old; end if;
    raise exception 'Archive de suppression : effacement interdit (conservation 6 ans)';
  end if;
  if new.salon_id is distinct from old.salon_id or new.contenu is distinct from old.contenu or new.sha256 is distinct from old.sha256
     or new.preuve_aucune_vente is distinct from old.preuve_aucune_vente or new.motif is distinct from old.motif
     or new.nom is distinct from old.nom or new.created_at is distinct from old.created_at
     or (old.supprime_le is not null and new.supprime_le is distinct from old.supprime_le)
     or (old.chemin is not null and new.chemin is distinct from old.chemin) then
    raise exception 'Archive de suppression : modification interdite';
  end if;
  return new;
end $$;
drop trigger if exists archives_suppression_editeur_truncate on lx_prive.archives_suppression_editeur;
create trigger archives_suppression_editeur_truncate before truncate on lx_prive.archives_suppression_editeur
  for each statement execute function lx_prive.archives_suppression_editeur_garde();

-- purge de conservation : lignes de plus de 6 ans + copie du bucket privé (API Storage, la suppression SQL directe y est interdite)
create or replace function lx_prive.archives_suppression_editeur_purger() returns integer
language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare r record; n int := 0; v_key text;
begin
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'service_role_key' limit 1;
  perform set_config('luxyra.purge_archives_editeur', '1', true);
  for r in select id, salon_id, chemin from lx_prive.archives_suppression_editeur where created_at < now() - interval '6 years' loop
    if r.chemin is not null and v_key is not null then
      perform net.http_delete(
        url := 'https://kxdgjtvrkwugbifgppai.supabase.co/storage/v1/object/lx-archives-editeur',
        headers := jsonb_build_object('Authorization', 'Bearer ' || v_key, 'apikey', v_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object('prefixes', jsonb_build_array(r.chemin)));
    end if;
    delete from lx_prive.archives_suppression_editeur where id = r.id;
    insert into admin_log(action, details) values ('ARCHIVE_SUPPRESSION_PURGEE_6ANS', jsonb_build_object('archive_id', r.id, 'salon_id', r.salon_id)::text);
    n := n + 1;
  end loop;
  perform set_config('luxyra.purge_archives_editeur', '', true);
  return n;
end $$;
revoke all on function lx_prive.archives_suppression_editeur_purger() from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'lx_archives_editeur_purge_6ans';
select cron.schedule('lx_archives_editeur_purge_6ans', '25 4 2 * *', 'select lx_prive.archives_suppression_editeur_purger();');
