-- Luxyra — 30/10/2026 — Adresse e-mail client mal saisie
-- 1. clients_luxyra.email_rejete_at / email_rejet_motif : posés par le worker (/api/email/rejet-signale) après un
--    rejet Brevo VÉRIFIÉ (hard bounce / adresse invalide) ; effacés par lx-profile au changement d'adresse ou à la
--    confirmation. Utilisés pour le bandeau « adresse incorrecte » de l'espace client et pour écrire par SMS (sur mesure).
-- 2. bp_protect_sensitive : ces deux colonnes ne sont modifiables que par le serveur (service_role), comme l'e-mail.
-- Idempotent. Hors périmètre fiscal (aucune table / fonction NF525). Retour arrière en fin de fichier.
begin;
alter table public.clients_luxyra add column if not exists email_rejete_at timestamptz;
alter table public.clients_luxyra add column if not exists email_rejet_motif text;
do $$ begin
  alter table public.clients_luxyra add constraint clients_luxyra_email_rejet_motif_ck check (email_rejet_motif is null or char_length(email_rejet_motif) <= 200);
exception when duplicate_object then null; end $$;
comment on column public.clients_luxyra.email_rejete_at is 'Rejet Brevo vérifié de l''adresse (faute de frappe probable). Écrit par le worker, effacé par lx-profile (changement / confirmation).';

do $m$
declare d text; a text;
begin
  d := pg_get_functiondef('public.bp_protect_sensitive'::regproc);
  if position('email_rejete_at' in d) > 0 then raise notice 'bp_protect_sensitive déjà à jour'; return; end if;
  a := $a$    -- 2026-10-14
    if new.email_verified is distinct from old.email_verified$a$;
  if position(a in d) = 0 then raise exception 'bp_protect_sensitive : ancre introuvable (fonction modifiée entre-temps)'; end if;
  d := replace(d, a, $b$    -- 2026-10-30 : marquage « adresse rejetée » réservé au serveur
    if new.email_rejete_at is distinct from old.email_rejete_at or new.email_rejet_motif is distinct from old.email_rejet_motif then
      raise exception 'email_rejete_at modifiable uniquement via edge function (service_role)';
    end if;
    -- 2026-10-14
    if new.email_verified is distinct from old.email_verified$b$);
  execute d;
end $m$;

-- GRANT explicites (règle du 30/10) : colonnes couvertes par les droits existants de la table ; rien à ouvrir à anon.
grant select, insert, update, delete on public.clients_luxyra to service_role;
commit;

-- Vérifications :
--   select column_name from information_schema.columns where table_name='clients_luxyra' and column_name like 'email_rejet%';
--   select position('email_rejete_at' in pg_get_functiondef('public.bp_protect_sensitive'::regproc)) > 0;
-- Retour arrière (après avoir remis les edge functions « avant ») :
--   begin; alter table public.clients_luxyra drop constraint if exists clients_luxyra_email_rejet_motif_ck;
--   alter table public.clients_luxyra drop column if exists email_rejet_motif; alter table public.clients_luxyra drop column if exists email_rejete_at;
--   -- puis recréer bp_protect_sensitive sans le bloc « 2026-10-30 » (pg_get_functiondef + replace inverse).
--   commit;
