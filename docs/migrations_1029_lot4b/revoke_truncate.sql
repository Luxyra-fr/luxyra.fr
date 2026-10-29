-- =====================================================================================================================
-- 2026-10-29 (-9) — LOT 4b, point 4 : droits TRUNCATE / TRIGGER / REFERENCES retirés aux rôles de l'API (anon, authenticated)
-- sur TOUTES les tables et vues du schéma public. NON APPLIQUÉ. Idempotent (rejouable). Éditeur SQL du tableau de bord Supabase.
--
-- POURQUOI : ces droits viennent des privilèges par défaut de Supabase (« arwdDxtm » accordé à anon / authenticated sur toute
-- nouvelle table de public). TRUNCATE vide une table SANS passer par la RLS NI par les déclencheurs de ligne (protections
-- NF525 des tickets, clôtures, bons, factures, journal JET, audit_log…). PostgREST (l'API) n'exécute jamais TRUNCATE, mais le
-- droit reste une porte ouverte si une autre voie SQL apparaissait (fonction SECURITY INVOKER, extension, erreur de configuration).
-- TRIGGER permet de créer un déclencheur sur la table ; REFERENCES de créer une clé étrangère vers elle : inutiles à des rôles qui
-- ne peuvent pas créer de table (has_schema_privilege(..., 'public', 'CREATE') = false pour anon et authenticated).
--
-- RELEVÉ DE PRODUCTION (29/10/2026 au soir, connecteur Supabase, lecture seule) : 139 relations (133 tables, 6 vues), toutes
-- propriété de postgres ; TRUNCATE : anon 87, authenticated 111 ; TRIGGER : anon 90, authenticated 116 ; REFERENCES : anon 90,
-- authenticated 116 (dont tickets, clotures, clotures_mensuelles, clotures_annuelles, cartes_cadeaux, salons, audit_log, nf525_jet,
-- nf525_signatures, nf525_archives_signees, nf525_cles, nf525_hash_seal…) ; factures_clients : TRUNCATE déjà retiré le 29/10 (réserve
-- 4 du lot 4) mais TRIGGER / REFERENCES encore accordés ; service_role : TRUNCATE sur 133 tables (inchangé ici).
-- AUCUN USAGE à préserver : aucune fonction du schéma public ni de lx_prive ne contient TRUNCATE (seule storage.list_objects_with_
-- delimiter, propriété de supabase_storage_admin, mot dans un texte) ; aucune tâche cron ; pg_stat_statements depuis le 12/05/2026 :
-- TRUNCATE exécuté uniquement par postgres (tables temporaires _essai_rappels, _audit_verrous_tmp) et supabase_admin
-- (realtime.subscription), JAMAIS par anon / authenticated ; aucun CREATE TRIGGER par ces rôles ; app.html, luxyra-supabase.js, worker,
-- edge functions du dépôt : aucun TRUNCATE (ils passent par PostgREST / supabase-js, qui ne savent pas l'exécuter).
--
-- CE QUI NE CHANGE PAS : SELECT / INSERT / UPDATE / DELETE (contrôlés en fin de script, à l'identique), RLS, politiques, service_role,
-- postgres. Privilèges par défaut : les FUTURES tables créées par postgres dans public n'accorderont plus TRUNCATE / TRIGGER /
-- REFERENCES à anon / authenticated (les droits par défaut de supabase_admin ne peuvent pas être changés par postgres : signalé).
--
-- RETOUR ARRIÈRE : docs/migrations_1029_lot4b/revoke_truncate_retour_arriere.sql (ré-accorde EXACTEMENT les droits relevés avant,
-- conservés dans lx_prive.privileges_avant_lot4b, et rétablit les privilèges par défaut).
-- =====================================================================================================================

-- 1. État AVANT, conservé une seule fois (première exécution) pour un retour arrière exact
create table if not exists lx_prive.privileges_avant_lot4b (
  relation text not null, role text not null, privilege text not null, releve_le timestamptz not null default now(),
  primary key (relation, role, privilege));
revoke all on lx_prive.privileges_avant_lot4b from public, anon, authenticated;
insert into lx_prive.privileges_avant_lot4b (relation, role, privilege)
select format('%I.%I', n.nspname, c.relname), r.rol, p.priv
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  cross join (values ('anon'), ('authenticated')) r(rol)
  cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) p(priv)
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f')
   and has_table_privilege(r.rol, c.oid, p.priv)
on conflict do nothing;

-- 2. Retrait (toutes les relations de public, y compris celles qui n'avaient pas le droit : sans effet)
do $$
declare x record; v_avant jsonb; v_apres jsonb;
begin
  -- droits de lecture / écriture AVANT (doivent être identiques après)
  select jsonb_object_agg(k, v) into v_avant from (
    select r.rol || ':' || p.priv k, count(*) filter (where has_table_privilege(r.rol, c.oid, p.priv)) v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated'), ('service_role')) r(rol)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') group by 1) z;
  for x in select c.oid::regclass rel from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') order by c.relname loop
    execute format('revoke truncate, trigger, references on table %s from anon, authenticated', x.rel);
  end loop;
  select jsonb_object_agg(k, v) into v_apres from (
    select r.rol || ':' || p.priv k, count(*) filter (where has_table_privilege(r.rol, c.oid, p.priv)) v
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      cross join (values ('anon'), ('authenticated'), ('service_role')) r(rol)
      cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) p(priv)
     where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') group by 1) z;
  if v_avant is distinct from v_apres then
    raise exception 'LOT 4b TRUNCATE : droits SELECT / INSERT / UPDATE / DELETE modifiés (avant %, après %) — annulé', v_avant, v_apres;
  end if;
  if exists (select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
              cross join (values ('anon'), ('authenticated')) r(rol) cross join (values ('TRUNCATE'), ('TRIGGER'), ('REFERENCES')) p(priv)
              where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f') and has_table_privilege(r.rol, c.oid, p.priv)) then
    raise exception 'LOT 4b TRUNCATE : un droit TRUNCATE / TRIGGER / REFERENCES subsiste (accordé via un autre rôle ?) — annulé';
  end if;
end $$;

-- 3. Privilèges par défaut des FUTURES tables / vues créées par postgres dans public (SELECT / INSERT / UPDATE / DELETE inchangés)
alter default privileges for role postgres in schema public revoke truncate, trigger, references on tables from anon, authenticated;
do $$ begin
  execute 'alter default privileges for role supabase_admin in schema public revoke truncate, trigger, references on tables from anon, authenticated';
exception when insufficient_privilege then
  raise notice 'privilèges par défaut de supabase_admin non modifiables par % (attendu sur Supabase) : tables créées par supabase_admin dans public = rares (aucune au 29/10/2026)', current_user;
end $$;

-- 4. CONTRÔLES (lecture) — attendus : 0, 0, 0, 0, 0, 0 ; service_role TRUNCATE inchangé (133) ; relevé conservé
select json_build_object(
  'trunc_anon', count(*) filter (where has_table_privilege('anon', c.oid, 'TRUNCATE')),
  'trunc_auth', count(*) filter (where has_table_privilege('authenticated', c.oid, 'TRUNCATE')),
  'trig_anon', count(*) filter (where has_table_privilege('anon', c.oid, 'TRIGGER')),
  'trig_auth', count(*) filter (where has_table_privilege('authenticated', c.oid, 'TRIGGER')),
  'ref_anon', count(*) filter (where has_table_privilege('anon', c.oid, 'REFERENCES')),
  'ref_auth', count(*) filter (where has_table_privilege('authenticated', c.oid, 'REFERENCES')),
  'service_role_trunc', count(*) filter (where c.relkind = 'r' and has_table_privilege('service_role', c.oid, 'TRUNCATE')),
  'releve_avant', (select count(*) from lx_prive.privileges_avant_lot4b),
  'defaut_postgres', (select defaclacl::text from pg_default_acl where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r'))::text
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f');
