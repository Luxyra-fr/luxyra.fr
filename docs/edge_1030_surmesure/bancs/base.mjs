// Banc PostgreSQL (PGlite = PostgreSQL 17) reconstruit depuis la PRODUCTION (/tmp/sm/prod, catalogues relus le 30/10/2026,
// md5 vérifiés) + bouchons Supabase (auth, net, cron, vault, storage). Aucune donnée de production.
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";
import fs from "node:fs";

const P = "/tmp/sm/prod/";
const STUBS = `
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname='supabase_admin') then create role supabase_admin nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator nologin; end if;
  if not exists (select 1 from pg_roles where rolname='dashboard_user') then create role dashboard_user nologin; end if;
end $$;
create schema if not exists extensions;
create extension if not exists pgcrypto schema extensions;
create extension if not exists "uuid-ossp" schema extensions;
create extension if not exists unaccent schema extensions;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}', raw_app_meta_data jsonb default '{}', created_at timestamptz default now(), last_sign_in_at timestamptz, email_confirmed_at timestamptz, deleted_at timestamptz);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
create or replace function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role', true),'') $$;
create or replace function auth.email() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.email', true),'') $$;
create or replace function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true),''),'{}')::jsonb $$;
create schema if not exists net;
create table if not exists net._http_response(id bigserial primary key, status_code int, content_type text, headers jsonb, content text, timed_out bool, error_msg text, created timestamptz default now());
create table if not exists net.lx_appels(id bigserial primary key, url text, body jsonb, headers jsonb, at timestamptz default clock_timestamp());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb, headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds int default 5000) returns bigint language plpgsql as $$ declare i bigint; begin insert into net.lx_appels(url, body, headers) values (url, body, headers) returning id into i; return i; end $$;
create or replace function net.http_get(url text, params jsonb default '{}'::jsonb, headers jsonb default '{}'::jsonb, timeout_milliseconds int default 5000) returns bigint language sql as $$ select 0::bigint $$;
create schema if not exists cron;
create table if not exists cron.job(jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport int default 5432, database text default 'postgres', username text default 'postgres', active bool default true, jobname text unique);
create table if not exists cron.job_run_details(runid bigserial primary key, jobid bigint, job_pid int, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language plpgsql as $$ declare i bigint; begin insert into cron.job(jobname, schedule, command) values (job_name, schedule, command) on conflict (jobname) do update set schedule=excluded.schedule, command=excluded.command returning jobid into i; return i; end $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$ begin delete from cron.job where jobname = job_name; return found; end $$;
create schema if not exists vault;
create table if not exists vault.secrets(id uuid primary key default gen_random_uuid(), name text unique, secret text, description text);
create or replace view vault.decrypted_secrets as select id, name, secret as decrypted_secret, description from vault.secrets;
create or replace function vault.create_secret(new_secret text, new_name text default null, new_description text default '') returns uuid language sql as $$ insert into vault.secrets(name, secret, description) values (new_name, new_secret, new_description) returning id $$;
insert into vault.secrets(name, secret) values ('service_role_key', 'cle-service-de-test') on conflict do nothing;
create schema if not exists storage;
create table if not exists storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid, metadata jsonb, created_at timestamptz default now());
create table if not exists storage.buckets(id text primary key, name text, public bool);
create schema if not exists realtime;
create table if not exists realtime.messages(id bigserial, topic text, extension text, payload jsonb, event text, private bool, inserted_at timestamptz default now());
grant usage on schema public, extensions, auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;
`;

function lire(f) { return fs.readFileSync(P + f, "utf8"); }

export async function creerBase({ trace = false } = {}) {
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, unaccent } });
  await db.exec(STUBS);
  await db.exec("set check_function_bodies = off; set search_path = public, extensions;");
  await db.exec(lire("01_types_seq.sql"));
  const fonctions = lire("04_functions.sql").split(/\n(?=CREATE OR REPLACE (?:FUNCTION|PROCEDURE) )/).filter((x) => /^CREATE OR REPLACE/.test(x.trim()));
  let restantes = [];
  for (const f of fonctions) { try { await db.exec("set check_function_bodies = off; set search_path = public, extensions;\n" + f); } catch (e) { restantes.push(f); } }
  await db.exec("set search_path = public, extensions;");
  await db.exec(lire("02_tables.sql"));
  const echecs = [];
  const jouer = async (f) => {
    for (const s of decouper(lire(f))) {
      try { await db.exec("set search_path = public, extensions; " + s); }
      catch (e) { echecs.push(f + ": " + e.message.split("\n")[0] + " :: " + s.slice(0, 120).replace(/\s+/g, " ")); }
    }
  };
  await jouer("03_constraints.sql"); await jouer("03b_fk_externes.sql"); await jouer("05_views.sql");
  for (let tour = 0; tour < 3 && restantes.length; tour++) {
    const r2 = [];
    for (const f of restantes) { try { await db.exec("set check_function_bodies = off; set search_path = public, extensions;\n" + f); } catch (e) { r2.push(f); if (tour === 2) echecs.push("04_functions: " + e.message.split("\n")[0] + " :: " + f.slice(0, 100)); } }
    restantes = r2;
  }
  for (const f of ["06_indexes.sql", "07_triggers.sql", "08_rls.sql", "09_grants.sql"]) await jouer(f);
  // Supabase : privilèges par défaut sur les séquences (non relevés dans 09_grants.sql)
  await db.exec("grant usage, select on all sequences in schema public to anon, authenticated, service_role;");
  if (trace && echecs.length) console.log("Échecs de chargement:\n" + echecs.join("\n"));
  await db.exec("set search_path = public, extensions;");
  return { db, echecs };
}

// découpe un fichier SQL simple (pas de corps $$ dans ces fichiers sauf vues) sur les « ; » de fin de ligne
export function decouper(txt) {
  const out = []; let cur = ""; let dollar = false;
  for (const ligne of txt.split("\n")) {
    if (/^\s*--/.test(ligne) && !cur.trim()) continue;
    cur += ligne + "\n";
    const n = (ligne.match(/\$\$/g) || []).length; if (n % 2) dollar = !dollar;
    if (!dollar && /;\s*$/.test(ligne)) { out.push(cur); cur = ""; }
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// Exécute fn avec les droits d'un rôle d'API (anon / authenticated / service_role), comme PostgREST.
export async function commeRole(db, role, sub, fn, email) {
  await db.exec(`set role ${role}; select set_config('request.jwt.claim.role','${role}',false), set_config('request.jwt.claim.sub','${sub || ""}',false), set_config('request.jwt.claim.email','${email || ""}',false);`);
  try { return await fn(); }
  finally { await db.exec(`reset role; select set_config('request.jwt.claim.role','',false), set_config('request.jwt.claim.sub','',false);`); }
}
