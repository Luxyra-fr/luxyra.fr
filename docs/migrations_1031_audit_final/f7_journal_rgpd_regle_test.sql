-- 2026-10-31 relecture finale admin (rejouable)
-- 1. RGPD du journal admin : coordonnées du gérant / de l'établissement masquées, nettoyage de l'existant,
--    entrée de purge 6 ans réduite à l'identifiant, rétention 6 ans du journal.
-- 2. Règle « compte test » unique : un essai est en caisse test par nature, il n'est compté test que s'il l'est
--    par son nom (Démo) ou par une offre gratuite en cours.
-- Aucune table ni fonction de caisse / NF525 modifiée. purge_salon_6ans : seul l'INSERT admin_log change.

-- 1a. Déclencheur d'inaltérabilité : exception réservée aux fonctions propriétaires lx_prive
--     (réglage de transaction luxyra.purge_admin_log='1' + session hors API PostgREST). TRUNCATE toujours refusé.
create or replace function lx_prive.admin_log_inalterable()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
begin
  if tg_op = 'UPDATE' and old.salon_id is not null and new.salon_id is null
     and (to_jsonb(old) - 'salon_id') = (to_jsonb(new) - 'salon_id') then
    return new;
  end if;
  if tg_op in ('UPDATE', 'DELETE') and tg_level = 'ROW'
     and coalesce(current_setting('luxyra.purge_admin_log', true), '') = '1'
     and session_user not in ('authenticator', 'anon', 'authenticated') then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Journal admin : ni modifiable ni effaçable' using errcode = '42501';
end $function$;

-- 1b. Traces automatiques : coordonnées de l'établissement / du gérant masquées
do $$
declare d text := pg_get_functiondef('lx_prive.admin_journal_auto'::regproc);
  a text := 'or (k in (''nom'', ''prenom'', ''motif'') and tg_table_name <> ''salons'') then';
  b text := 'or (k in (''nom'', ''prenom'', ''motif'') and tg_table_name <> ''salons'')
         or (tg_table_name = ''salons'' and k in (''gerant_nom'', ''gerant_prenom'', ''email'', ''tel'', ''adresse'', ''siret'', ''siren'')) then';
begin
  if position('''gerant_nom'', ''gerant_prenom''' in d) > 0 then return; end if;  -- déjà appliqué
  if position(a in d) = 0 then raise exception 'motif introuvable (admin_journal_auto)'; end if;
  execute replace(d, a, b);
end $$;

-- 1c. Nettoyage de l'existant (fonction propriétaire, non exposée)
create or replace function lx_prive.admin_log_anonymiser_salons()
 returns int language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare k text; v_n int := 0; v_c int;
begin
  perform set_config('luxyra.purge_admin_log', '1', true);
  foreach k in array array['gerant_nom','gerant_prenom','email','tel','adresse','siret','siren'] loop
    update public.admin_log set
      avant = case when avant ? k then jsonb_set(avant, array[k], case when avant -> k is null or avant -> k = 'null'::jsonb then 'null'::jsonb else to_jsonb('(renseigné)'::text) end) else avant end,
      apres = case when apres ? k then jsonb_set(apres, array[k], case when apres -> k is null or apres -> k = 'null'::jsonb then 'null'::jsonb else to_jsonb('(modifié)'::text) end) else apres end
     where action like 'AUTO\_%\_SALONS' escape '\'
       and ((avant ? k and avant -> k not in ('null'::jsonb, '"(renseigné)"'::jsonb)) or (apres ? k and apres -> k not in ('null'::jsonb, '"(modifié)"'::jsonb)));
    get diagnostics v_c = row_count; v_n := v_n + v_c;
  end loop;
  -- anciennes entrées de purge 6 ans : seulement l'identifiant, la date et le nombre de lignes
  update public.admin_log set details = (details::jsonb - 'nom' - 'siret')::text
   where action = 'SALON_PURGE_6ANS' and details ~ '^\s*\{' and (details::jsonb ? 'nom' or details::jsonb ? 'siret');
  get diagnostics v_c = row_count; v_n := v_n + v_c;
  perform set_config('luxyra.purge_admin_log', '', true);
  return v_n;
end $function$;
revoke all on function lx_prive.admin_log_anonymiser_salons() from public, anon, authenticated;
select lx_prive.admin_log_anonymiser_salons();

-- 1d. purge_salon_6ans : l'entrée du journal admin ne garde que l'identifiant (le reste de la fonction est inchangé)
do $$
declare d text := pg_get_functiondef('public.purge_salon_6ans'::regproc);
  a text := 'jsonb_build_object(''salon_id'', s.id, ''nom'', s.nom, ''siret'', s.siret, ''fin_conservation'', v_fin, ''lignes'', r->>''rows_deleted'')::text);';
  b text := 'jsonb_build_object(''salon_id'', s.id, ''fin_conservation'', v_fin, ''lignes'', r->>''rows_deleted'')::text);  -- 2026-10-31 RGPD : identifiant seul';
begin
  if position('RGPD : identifiant seul' in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'motif introuvable (purge_salon_6ans)'; end if;
  execute replace(d, a, b);
end $$;

-- 1e. Rétention : entrées du journal admin de plus de 6 ans supprimées chaque mois
create or replace function lx_prive.admin_log_retention()
 returns int language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_n int;
begin
  perform set_config('luxyra.purge_admin_log', '1', true);
  delete from public.admin_log where timestamp_action < now() - interval '6 years';
  get diagnostics v_n = row_count;
  perform set_config('luxyra.purge_admin_log', '', true);
  return v_n;
end $function$;
revoke all on function lx_prive.admin_log_retention() from public, anon, authenticated;
select cron.unschedule(jobid) from cron.job where jobname = 'lx_admin_log_retention';
select cron.schedule('lx_admin_log_retention', '23 4 2 * *', 'select lx_prive.admin_log_retention()');

-- 2. Tableau de bord : compteur « tests » avec la règle des essais
do $$
declare d text := pg_get_functiondef('public.admin_tableau_de_bord'::regproc);
  a text := 'count(*) filter (where status <> ''cancelled'' and lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))';
  b text := 'count(*) filter (where status <> ''cancelled'' and case when status = ''trial'' then lx_prive.salon_est_test(null, nom, is_free, free_until) else lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until) end)';
begin
  if position(b in d) > 0 then return; end if;
  if position(a in d) = 0 then raise exception 'motif introuvable (admin_tableau_de_bord)'; end if;
  execute replace(d, a, b);
end $$;

-- 3. Recherche du journal (y compris valeurs avant / après), lecture seule
drop function if exists public.admin_journal_recherche(text, int);
create or replace function public.admin_journal_recherche(p_q text, p_depuis timestamptz default null, p_limite int default 500)
 returns setof public.admin_log language plpgsql stable security definer set search_path to 'public', 'pg_temp'
as $function$
declare v_q text := '%' || replace(replace(replace(coalesce(p_q, ''), '\', '\\'), '%', '\%'), '_', '\_') || '%';
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  return query
    select l.* from public.admin_log l
     where (p_depuis is null or l.timestamp_action >= p_depuis)
       and (l.details ilike v_q or l.cible ilike v_q or l.action ilike v_q or l.admin_email ilike v_q
            or l.avant::text ilike v_q or l.apres::text ilike v_q)
     order by l.timestamp_action desc
     limit least(greatest(coalesce(p_limite, 500), 1), 2000);
end $function$;
revoke all on function public.admin_journal_recherche(text, timestamptz, int) from public, anon;
grant execute on function public.admin_journal_recherche(text, timestamptz, int) to authenticated;
