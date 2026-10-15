-- =====================================================================================
-- Admin : nouvelle organisation du panneau (15/10/2026, audit docs/admin-audit-1015.md)
-- -------------------------------------------------------------------------------------
-- Contenu (idempotent, à appliquer AVANT de publier le nouvel admin.html) :
--   1. Journal admin : colonnes admin_email / cible / avant / apres / origine sur admin_log,
--      remplissage automatique de l'auteur, index, RPC public.admin_journal(...) (écriture),
--      traces automatiques avant / après sur les tables modifiées depuis l'admin ;
--   2. public.admin_salons_compteurs()  : clients / collaborateurs de TOUS les salons en une
--      requête (remplace les 2 requêtes par salon au chargement du panneau) ;
--   3. public.admin_tableau_de_bord()   : les 10 chiffres du tableau de bord + alertes du jour,
--      calculés côté serveur en un seul appel ;
--   4. public.admin_rgpd_etat()         : purges RGPD J+60, suppressions à 6 ans, comptes
--      clients inactifs, avec les dates prévues ;
--   5. public.admin_taches_nuit()       : état des tâches planifiées de nuit (cron.job_run_details),
--      solution de repli quand GitHub n'est pas connecté ;
--   6. cartes d'abonnement : les 3 tâches de nuit identiques fusionnées en une seule.
--
-- Toutes les fonctions exigent public.is_admin() (support@luxyra.fr + double authentification aal2).
-- Aucune donnée métier n'est modifiée. La table de notes en double (salon_admin_notes) est LAISSÉE :
-- elle est encore citée par admin_delete_salon_cascade (voir le compte rendu).
-- =====================================================================================

begin;

set local lock_timeout = '8s';

-- 1. JOURNAL ADMIN ------------------------------------------------------------------

-- 1a. Colonnes : qui (email), quoi (action, déjà là), cible, avant / après, origine (manuel / auto)
alter table public.admin_log add column if not exists admin_email text;
alter table public.admin_log add column if not exists cible       text;
alter table public.admin_log add column if not exists avant       jsonb;
alter table public.admin_log add column if not exists apres       jsonb;
alter table public.admin_log add column if not exists origine     text not null default 'manuel';
create index if not exists idx_admin_log_ts     on public.admin_log (timestamp_action desc);
create index if not exists idx_admin_log_action on public.admin_log (action);

-- 1b. L'auteur est toujours complété côté serveur (jamais confié au navigateur)
create or replace function lx_prive.admin_log_map_user()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.admin_user_id is not null and not exists (select 1 from public.admin_users where id = new.admin_user_id) then
    new.admin_user_id := (select id from public.admin_users where user_id = new.admin_user_id limit 1);
  end if;
  if new.admin_user_id is null then
    new.admin_user_id := (select id from public.admin_users where user_id = (select auth.uid()) limit 1);
  end if;
  -- email de l'auteur : celui de la session (ou du compte admin rattaché)
  if new.admin_email is null then
    new.admin_email := coalesce(
      (select u.email from auth.users u where u.id = (select auth.uid())),
      (select a.email from public.admin_users a where a.id = new.admin_user_id));
  end if;
  if new.timestamp_action is null then new.timestamp_action := now(); end if;
  return new;
end $fn$;
-- (le déclencheur trg_admin_log_map_user existe déjà et appelle cette fonction)
do $do$ begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_admin_log_map_user' and tgrelid = 'public.admin_log'::regclass) then
    create trigger trg_admin_log_map_user before insert on public.admin_log
      for each row execute function lx_prive.admin_log_map_user();
  end if;
end $do$;

-- 1c. RPC d'écriture utilisée partout par le panneau (helper lxJournal)
create or replace function public.admin_journal(
  p_action  text,
  p_salon   uuid  default null,
  p_cible   text  default null,
  p_details text  default null,
  p_avant   jsonb default null,
  p_apres   jsonb default null)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_id bigint;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  if coalesce(trim(p_action), '') = '' then raise exception 'Action obligatoire'; end if;
  insert into public.admin_log (salon_id, action, details, cible, avant, apres, origine)
  values (case when p_salon is not null and exists (select 1 from public.salons where id = p_salon) then p_salon end,
          upper(left(regexp_replace(trim(p_action), '[^A-Za-z0-9_]+', '_', 'g'), 80)),
          left(coalesce(p_details, ''), 4000), left(p_cible, 200), p_avant, p_apres, 'manuel')
  returning id into v_id;
  return v_id;
end $fn$;
revoke all on function public.admin_journal(text, uuid, text, text, jsonb, jsonb) from public, anon;
grant execute on function public.admin_journal(text, uuid, text, text, jsonb, jsonb) to authenticated;

-- 1d. Traces automatiques avant / après : toute écriture faite par l'ADMIN (session 2FA) sur les
--     tables gérées depuis le panneau est journalisée, même si le code oublie de le faire.
--     Jamais bloquant : une erreur de journalisation n'annule pas l'écriture.
create or replace function lx_prive.admin_journal_auto()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_old jsonb; v_new jsonb; v_av jsonb := '{}'::jsonb; v_ap jsonb := '{}'::jsonb; k text; kk text;
  v_salon uuid; v_id text; v_nb int := 0;
  -- colonnes volumineuses ou sensibles : on note seulement « modifié »
  v_lourds constant text[] := array['config_json','logo','contrat_signature','documents_kbis','documents_id','documents_id_verso',
                                     'p256dh','auth','endpoint','password_hash','contenu','corps'];
  -- colonnes techniques sans intérêt pour le journal
  v_bruit constant text[] := array['updated_at','config_version','last_login','maj_le','last_used_at','updated_by'];
begin
  -- filtre rapide (évite tout coût pour les écritures des établissements), puis contrôle complet
  if coalesce(auth.jwt() ->> 'email', '') <> 'support@luxyra.fr' then return null; end if;
  if not public.is_admin() then return null; end if;
  begin
    if tg_op in ('UPDATE', 'DELETE') then v_old := to_jsonb(old); end if;
    if tg_op in ('UPDATE', 'INSERT') then v_new := to_jsonb(new); end if;
    for k in select jsonb_object_keys(coalesce(v_new, v_old)) loop
      continue when k = any(v_bruit);
      continue when tg_op = 'UPDATE' and (v_old -> k) is not distinct from (v_new -> k);
      if tg_table_name = 'app_config' and k = 'config' then
        -- réglages : seulement les clés modifiées, secrets masqués
        for kk in select jsonb_object_keys(coalesce(v_old -> 'config', '{}'::jsonb) || coalesce(v_new -> 'config', '{}'::jsonb)) loop
          continue when (v_old -> 'config' -> kk) is not distinct from (v_new -> 'config' -> kk);
          if kk ~* '(secret|token|password|api_?key|^cle_|_cle$)' then
            v_av := v_av || jsonb_build_object('config.' || kk, '(masqué)'); v_ap := v_ap || jsonb_build_object('config.' || kk, '(masqué)');
          else
            v_av := v_av || jsonb_build_object('config.' || kk, v_old -> 'config' -> kk);
            v_ap := v_ap || jsonb_build_object('config.' || kk, v_new -> 'config' -> kk);
          end if;
          v_nb := v_nb + 1;
        end loop;
        continue;
      end if;
      if k = any(v_lourds) or k ~* '(secret|token|password)' then
        if v_old is not null then v_av := v_av || jsonb_build_object(k, case when v_old -> k is null or v_old -> k = 'null'::jsonb then null else to_jsonb('(renseigné)'::text) end); end if;
        if v_new is not null then v_ap := v_ap || jsonb_build_object(k, case when v_new -> k is null or v_new -> k = 'null'::jsonb then null else to_jsonb('(modifié)'::text) end); end if;
      else
        if v_old is not null then v_av := v_av || jsonb_build_object(k, v_old -> k); end if;
        if v_new is not null then v_ap := v_ap || jsonb_build_object(k, v_new -> k); end if;
      end if;
      v_nb := v_nb + 1;
    end loop;
    if v_nb = 0 then return null; end if;
    v_id := coalesce(coalesce(v_new, v_old) ->> 'id', coalesce(v_new, v_old) ->> 'cle', coalesce(v_new, v_old) ->> 'salon_id');
    v_salon := case when tg_table_name = 'salons' then nullif(coalesce(v_new, v_old) ->> 'id', '')::uuid
                    when coalesce(v_new, v_old) ? 'salon_id' then nullif(coalesce(v_new, v_old) ->> 'salon_id', '')::uuid end;
    -- un salon supprimé n'existe plus : la cible garde son identifiant
    if v_salon is not null and not exists (select 1 from public.salons where id = v_salon) then v_salon := null; end if;
    insert into public.admin_log (salon_id, action, details, cible, avant, apres, origine)
    values (v_salon,
            'AUTO_' || case tg_op when 'INSERT' then 'AJOUT' when 'UPDATE' then 'MODIF' else 'SUPPR' end || '_' || upper(tg_table_name),
            v_nb || ' champ(s)', tg_table_name || ':' || coalesce(v_id, '?'),
            case when tg_op = 'INSERT' then null else v_av end,
            case when tg_op = 'DELETE' then null else v_ap end,
            'auto');
  exception when others then
    -- le journal ne doit jamais empêcher l'action elle-même
    raise warning 'admin_journal_auto % : %', tg_table_name, sqlerrm;
  end;
  return null;
end $fn$;

do $do$
declare t text;
begin
  foreach t in array array['salons','app_config','demandes_essai','migration_requests','admin_email_modeles',
                           'support_bot_kb','admin_suivi_salons','parrainages','push_subscriptions'] loop
    if to_regclass('public.' || t) is not null and not exists (
         select 1 from pg_trigger where tgname = 'trg_admin_journal_auto' and tgrelid = ('public.' || t)::regclass) then
      execute format('create trigger trg_admin_journal_auto after insert or update or delete on public.%I
                      for each row execute function lx_prive.admin_journal_auto()', t);
    end if;
  end loop;
end $do$;

-- 2. COMPTEURS PAR SALON (une seule requête) ------------------------------------------
create or replace function public.admin_salons_compteurs()
returns table(salon_id uuid, clients bigint, collaborateurs bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  return query
    select s.id, coalesce(c.n, 0)::bigint, coalesce(k.n, 0)::bigint
      from public.salons s
      left join (select x.salon_id sid, count(*) n from public.clients x group by x.salon_id) c on c.sid = s.id
      left join (select x.salon_id sid, count(*) n from public.collaborateurs x group by x.salon_id) k on k.sid = s.id;
end $fn$;
revoke all on function public.admin_salons_compteurs() from public, anon;
grant execute on function public.admin_salons_compteurs() to authenticated;

-- 3. TÂCHES DE NUIT (repli sans GitHub) -------------------------------------------------
-- Tâches quotidiennes (heure fixe) : dernière exécution, dernier succès, échecs 24 h / 7 j,
-- « manquée » si aucune exécution depuis 26 h.
create or replace function public.admin_taches_nuit()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'nom'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'nom', j.jobname, 'horaire', j.schedule, 'active', j.active,
      'derniere', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
      'dernier_statut', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
      'dernier_succes', (select max(d.end_time) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded'),
      'echecs_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status in ('failed','canceled') and d.start_time > now() - interval '24 hours'),
      'echecs_7j', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status in ('failed','canceled') and d.start_time > now() - interval '7 days'),
      'message', (select left(d.return_message, 300) from cron.job_run_details d where d.jobid = j.jobid and d.status in ('failed','canceled') order by d.start_time desc limit 1),
      'manquee', j.active and not exists (select 1 from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '26 hours')
    ) x
    from cron.job j
    where j.schedule ~ '^[0-9,]+ [0-9,\-]+ \* \* \*$'
  ) t;
  return jsonb_build_object('taches', v,
    'ok', not exists (select 1 from jsonb_array_elements(v) e where (e->>'echecs_24h')::int > 0 or (e->>'manquee')::boolean),
    'genere_le', now());
end $fn$;
revoke all on function public.admin_taches_nuit() from public, anon;
grant execute on function public.admin_taches_nuit() to authenticated;

-- 4. TABLEAU DE BORD (un seul appel) ---------------------------------------------------
create or replace function public.admin_tableau_de_bord()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'lx_prive', 'pg_temp'
as $fn$
declare
  v_cfg jsonb := coalesce((select config from public.app_config where id = 1), '{}'::jsonb);
  v_ess numeric; v_pro numeric; v_fond numeric;
  v_mrr numeric := 0; v_payants int := 0; v_essais int := 0; v_actifs int := 0;
  v_ref_mois date; v_ref_mrr numeric;
  v_essais7 jsonb; v_impayes jsonb;
  v_unread int := 0; v_vieux jsonb; v_escal jsonb;
  v_ar_graves int; v_ar_total int; v_ar_err text;
  v_nf jsonb; v_nf_err text; v_nf_pb int := 0;
  v_nuit jsonb;
  v_dem int; v_mig int; v_mig_new int; v_insc7 int; v_docs int; v_rappels jsonb;
  v_alertes jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;

  -- tarifs (mêmes règles que mrrOf() du panneau : offert, prix personnalisé, Pro Fondateur)
  begin v_ess  := coalesce(nullif(v_cfg->>'plan_essential_eur', '')::numeric, 14.99); exception when others then v_ess := 14.99; end;
  begin v_pro  := coalesce(nullif(v_cfg->>'plan_pro_eur', '')::numeric, 24.99); exception when others then v_pro := 24.99; end;
  begin v_fond := coalesce(nullif(v_cfg->>'plan_pro_founder_eur', '')::numeric, 14.99); exception when others then v_fond := 14.99; end;

  -- 1. revenu mensuel + 2. payants / essais
  select coalesce(sum(m), 0), count(*) filter (where m > 0) into v_mrr, v_payants from (
    select case
      when s.status not in ('active','past_due') then 0
      when s.is_free and (s.free_until is null or s.free_until > current_date) then 0
      when s.custom_price_amount is not null then s.custom_price_amount
      when s.plan = 'pro' and s.is_founder then v_fond
      when s.plan = 'pro' then v_pro
      else v_ess end m
    from public.salons s) x;
  select count(*) filter (where status = 'trial' and ferme_le is null),
         count(*) filter (where status = 'active' and ferme_le is null)
    into v_essais, v_actifs from public.salons;
  -- référence ~30 jours : dernier relevé mensuel (mrr_snapshots) datant d'au moins 30 jours
  select snapshot_month, mrr_total into v_ref_mois, v_ref_mrr
    from public.mrr_snapshots where snapshot_month <= current_date - 30 order by snapshot_month desc limit 1;

  -- 3. essais qui finissent dans moins de 7 jours
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'fin', trial_end,
           'jours', greatest(0, ceil(extract(epoch from (trial_end - now())) / 86400))::int) order by trial_end), '[]'::jsonb)
    into v_essais7 from public.salons
   where status = 'trial' and ferme_le is null and trial_end is not null and trial_end >= now() and trial_end < now() + interval '7 days';

  -- 4. paiements échoués / impayés
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'depuis', past_due_since, 'stripe_customer', stripe_customer_id) order by past_due_since nulls last), '[]'::jsonb)
    into v_impayes from public.salons where status = 'past_due' and ferme_le is null;

  -- 5. support : non lus + plus ancien message non lu
  select coalesce(sum(unread_count_admin), 0) into v_unread from public.support_conversations where status = 'open';
  select jsonb_build_object('le', m.created_at, 'salon_id', m.salon_id, 'conversation_id', m.conversation_id,
           'heures', floor(extract(epoch from (now() - m.created_at)) / 3600)::int)
    into v_vieux
    from public.support_messages m join public.support_conversations c on c.id = m.conversation_id
   where m.sender = 'client' and coalesce(m.read_by_admin, false) = false and c.status = 'open'
   order by m.created_at limit 1;

  -- 6. questions que le bot a transmises à un humain (30 j) et restées sans réponse humaine
  select jsonb_build_object(
      'total_30j', count(*),
      'sans_reponse', count(*) filter (where not exists (
          select 1 from public.support_messages a where a.conversation_id = b.conversation_id and a.sender = 'admin' and a.created_at > b.created_at)),
      'liste', coalesce(jsonb_agg(jsonb_build_object('le', b.created_at, 'salon_id', b.salon_id, 'conversation_id', b.conversation_id))
                 filter (where not exists (
          select 1 from public.support_messages a where a.conversation_id = b.conversation_id and a.sender = 'admin' and a.created_at > b.created_at)), '[]'::jsonb))
    into v_escal
    from public.support_messages b
   where b.sender = 'bot' and b.created_at > now() - interval '30 days'
     and (b.message like '🙋%' or b.message ilike '%transmets votre demande à un humain%');

  -- 7. « À réparer » graves (mêmes règles que admin_a_reparer : acquittements respectés)
  begin
    select count(*) filter (where b.niveau = 'grave'), count(*) into v_ar_graves, v_ar_total
      from lx_prive.a_reparer_brut(72) b
     where not exists (select 1 from public.admin_acquittements a where a.signature = b.signature and a.traite_le >= b.derniere);
  exception when others then v_ar_err := sqlerrm; end;

  -- 8. NF525 (source unique : admin_nf525_etat)
  begin
    v_nf := public.admin_nf525_etat();
    select count(*) into v_nf_pb from jsonb_array_elements(coalesce(v_nf->'global', '[]'::jsonb)) g where g->>'verdict' <> 'ok';
    v_nf_pb := v_nf_pb + (select count(*) from jsonb_array_elements(coalesce(v_nf->'salons', '[]'::jsonb)) s where s->>'verdict' <> 'ok');
  exception when others then v_nf_err := sqlerrm; end;

  -- 9. tâches de nuit (repli ; l'état GitHub de la sauvegarde est lu par le worker)
  begin v_nuit := public.admin_taches_nuit(); exception when others then v_nuit := jsonb_build_object('erreur', sqlerrm); end;

  -- autres compteurs (pastilles + alertes)
  select count(*) into v_dem from public.demandes_essai where status = 'new';
  select count(*) filter (where status in ('new','contacted','in_progress')), count(*) filter (where status = 'new')
    into v_mig, v_mig_new from public.migration_requests;
  select count(*) into v_insc7 from public.salons where created_at > now() - interval '7 days';
  select count(*) into v_docs from public.salons where verification_status = 'pending_review' and ferme_le is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nom', s.nom, 'note', a.rappel_note)), '[]'::jsonb) into v_rappels
    from public.admin_suivi_salons a join public.salons s on s.id = a.salon_id
   where a.rappel_le is not null and a.rappel_le <= current_date and s.ferme_le is null;

  -- ALERTES DU JOUR (ordre : grave d'abord)
  if coalesce(v_ar_graves, 0) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','grave','texte', v_ar_graves || ' problème(s) grave(s) à réparer','page','qualite/areparer'); end if;
  if v_nf is not null and v_nf->>'verdict' = 'ko' then v_alertes := v_alertes || jsonb_build_object('niveau','grave','texte','NF525 : au moins un contrôle en échec','page','qualite/nf525'); end if;
  if jsonb_array_length(v_impayes) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','grave','texte', jsonb_array_length(v_impayes) || ' établissement(s) en impayé','page','revenus/impayes'); end if;
  if v_nuit ? 'ok' and not (v_nuit->>'ok')::boolean then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte','Une tâche de nuit a échoué ou n''a pas tourné','page','qualite/sauvegardes'); end if;
  if v_vieux is not null and (v_vieux->>'heures')::int >= 24 then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte','Message support non lu depuis ' || (v_vieux->>'heures') || ' h','page','communication/chat'); end if;
  if coalesce((v_escal->>'sans_reponse')::int, 0) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte', (v_escal->>'sans_reponse') || ' question(s) transmise(s) par le bot sans réponse','page','communication/chat'); end if;
  if (select count(*) from jsonb_array_elements(v_essais7) e where (e->>'jours')::int <= 3) > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte', (select count(*) from jsonb_array_elements(v_essais7) e where (e->>'jours')::int <= 3) || ' essai(s) finissent dans 3 jours ou moins','page','revenus/impayes'); end if;
  if v_nf is not null and v_nf->>'verdict' = 'attention' then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte','NF525 : point(s) à surveiller','page','qualite/nf525'); end if;
  if v_mig_new > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', v_mig_new || ' nouvelle(s) demande(s) de migration','page','salons/migrations'); end if;
  if v_dem > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', v_dem || ' demande(s) d''essai à traiter','page','salons/demandes'); end if;
  if v_docs > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', v_docs || ' justificatif(s) à vérifier','page','salons/inscriptions'); end if;
  if jsonb_array_length(v_rappels) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', jsonb_array_length(v_rappels) || ' rappel(s) prévu(s) aujourd''hui','page','salons/liste'); end if;

  return jsonb_build_object(
    'mrr', jsonb_build_object('total', round(v_mrr, 2), 'ref_mois', v_ref_mois, 'ref_total', v_ref_mrr,
            'variation', case when v_ref_mrr is null then null else round(v_mrr - v_ref_mrr, 2) end),
    'abonnes', jsonb_build_object('payants', v_payants, 'essais', v_essais, 'actifs', v_actifs),
    'essais_7j', v_essais7,
    'impayes', v_impayes,
    'support', jsonb_build_object('non_lus', v_unread, 'plus_ancien', v_vieux),
    'bot', v_escal,
    'a_reparer', jsonb_build_object('graves', v_ar_graves, 'total', v_ar_total, 'erreur', v_ar_err),
    'nf525', case when v_nf is null then jsonb_build_object('erreur', v_nf_err)
                  else jsonb_build_object('verdict', v_nf->>'verdict', 'icone', v_nf->>'icone', 'problemes', v_nf_pb, 'genere_le', v_nf->>'genere_le') end,
    'nuit', v_nuit,
    'compteurs', jsonb_build_object('demandes', v_dem, 'migrations', v_mig, 'migrations_nouvelles', v_mig_new,
                   'inscriptions_7j', v_insc7, 'documents', v_docs, 'rappels', jsonb_array_length(v_rappels)),
    'rappels', v_rappels,
    'alertes', v_alertes,
    'genere_le', now());
end $fn$;
revoke all on function public.admin_tableau_de_bord() from public, anon;
grant execute on function public.admin_tableau_de_bord() to authenticated;

-- 5. RGPD & PURGES (lecture seule, avec les dates prévues) ------------------------------
-- Règles reprises des tâches existantes :
--   J+60 (rgpd_purge_candidats) : préavis à fin de service + 53 j, purge à fin + 60 j et préavis + 7 j ;
--   6 ans (retention_6ans_candidats) : préavis 30 j avant lx_prive.salon_fin_conservation, puis suppression ;
--   comptes clients (comptes_inactifs_candidats) : 3 ans sans activité, préavis 30 j avant.
create or replace function public.admin_rgpd_etat()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'lx_prive', 'pg_temp'
as $fn$
declare v_j60 jsonb; v_j60_faites jsonb; v_6ans jsonb; v_6ans_faites jsonb; v_clients jsonb; v_nb_clients int;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(x order by x->>'purge_prevue'), '[]'::jsonb) into v_j60 from (
    select jsonb_build_object('id', s.id, 'nom', s.nom, 'statut', s.status, 'fin_service', f.fin,
             'preavis_prevu', f.fin + interval '53 days', 'preavis_le', s.rgpd_preavis_le,
             'purge_prevue', greatest(f.fin + interval '60 days', coalesce(s.rgpd_preavis_le + interval '7 days', f.fin + interval '60 days'))) x
      from public.salons s cross join lateral (select lx_prive.salon_fin_service(s) fin) f
     where s.rgpd_purge_le is null and f.fin is not null) t;
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'purge_le', rgpd_purge_le) order by rgpd_purge_le desc), '[]'::jsonb)
    into v_j60_faites from public.salons where rgpd_purge_le is not null;

  select coalesce(jsonb_agg(x order by x->>'suppression_prevue'), '[]'::jsonb) into v_6ans from (
    select jsonb_build_object('id', s.id, 'nom', s.nom, 'ferme_le', s.ferme_le, 'resilie_le', s.cancelled_at,
             'suppression_prevue', c.fin, 'preavis_prevu', c.fin - interval '30 days', 'preavis_le', s.retention_warned_at) x
      from public.salons s cross join lateral (select lx_prive.salon_fin_conservation(s.id) fin) c
     where s.status = 'cancelled' and coalesce(s.is_free, false) = false) t;
  select coalesce(jsonb_agg(jsonb_build_object('nom', nom, 'fin_service', fin_service, 'fin_conservation', fin_conservation,
           'preavis_le', preavis_le, 'supprime_le', supprime_le, 'lignes', lignes) order by supprime_le desc), '[]'::jsonb)
    into v_6ans_faites from (select * from public.salons_purges order by supprime_le desc nulls last limit 50) p;

  -- comptes clients dont la suppression est prévue dans les 90 jours (ou déjà prévenus) ; e-mail masqué
  select count(*) into v_nb_clients from public.clients_luxyra;
  select coalesce(jsonb_agg(x order by x->>'suppression_prevue'), '[]'::jsonb) into v_clients from (
    select jsonb_build_object('id', c.id, 'prenom', c.prenom,
             'email', regexp_replace(coalesce(c.email, ''), '^(.).*(@.*)$', '\1***\2'),
             'derniere_activite', a.act, 'preavis_le', c.inactivite_preavis_le,
             'suppression_prevue', case when c.inactivite_preavis_le is null then a.act + interval '3 years'
                                        else greatest(c.inactivite_preavis_le + interval '30 days', a.act + interval '3 years') end) x
      from public.clients_luxyra c cross join lateral (select lx_prive.client_derniere_activite(c.id) act) a
     where c.inactivite_preavis_le is not null or a.act < now() - interval '3 years' + interval '90 days'
     limit 200) t;

  return jsonb_build_object('j60', v_j60, 'j60_faites', v_j60_faites, 'six_ans', v_6ans, 'six_ans_faites', v_6ans_faites,
    'clients', v_clients, 'nb_comptes_clients', v_nb_clients, 'genere_le', now());
end $fn$;
revoke all on function public.admin_rgpd_etat() from public, anon;
grant execute on function public.admin_rgpd_etat() to authenticated;

-- 6. CARTES D'ABONNEMENT : 3 tâches de nuit identiques -> 1 seule ------------------------
-- expire-cartes-abo (02:00, UPDATE direct), luxyra-expire-cartes-abo (02:15, fn_expire_cartes_abo) et
-- expire-cartes-abo-daily (03:00, expire_cartes_abo) faisaient la même chose. On garde la seule qui
-- journalise (expire_cartes_abo), à 02:00. (fn_auto_expire_all, 02:30, repasse aussi dessus : sans effet.)
create or replace function public.expire_cartes_abo()
returns table(expired_count integer, expired_ids uuid[])
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_count int; v_ids uuid[];
begin
  with updated as (
    update public.cartes_abo_clients set status = 'expired'
     where status = 'active' and date_expiration is not null and date_expiration < current_date
    returning id)
  select count(*)::int, coalesce(array_agg(id), array[]::uuid[]) into v_count, v_ids from updated;
  if v_count > 0 then
    begin
      -- (avant : colonne created_at inexistante -> trace jamais écrite)
      insert into public.admin_log (action, details, origine)
      values ('CRON_EXPIRE_CARTES_ABO', 'Expiration automatique de ' || v_count || ' carte(s) d''abonnement. IDs : ' || array_to_string(v_ids, ','), 'auto');
    exception when others then null;
    end;
  end if;
  return query select v_count, v_ids;
end $fn$;

do $do$
begin
  if exists (select 1 from cron.job where jobname = 'expire-cartes-abo') then perform cron.unschedule('expire-cartes-abo'); end if;
  if exists (select 1 from cron.job where jobname = 'luxyra-expire-cartes-abo') then perform cron.unschedule('luxyra-expire-cartes-abo'); end if;
  -- la tâche gardée conserve son identifiant et son historique (pas de fausse alerte « n'a pas tourné »)
  if exists (select 1 from cron.job where jobname = 'expire-cartes-abo-daily') then
    perform cron.alter_job(jobid, schedule := '0 2 * * *', command := 'select public.expire_cartes_abo()')
       from cron.job where jobname = 'expire-cartes-abo-daily';
  else
    perform cron.schedule('expire-cartes-abo-daily', '0 2 * * *', 'select public.expire_cartes_abo()');
  end if;
end $do$;

commit;
