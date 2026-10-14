-- ============================================================================
-- LUXYRA — Correctifs de sécurité de l'audit du 14/10/2026 (branche fix1014-secu)
-- ----------------------------------------------------------------------------
-- Fichier UNIQUE, IDEMPOTENT (rejouable sans risque) : create or replace, if not exists,
-- drop policy if exists + create, cron désinscrit puis réinscrit.
-- AUCUNE donnée n'est supprimée ; aucune ligne de l'établissement e0cf27c7-d402-4d76-8e91-9ef5231b3582
-- n'est modifiée. Aucune logique de scellement NF525 (tickets, clôtures, signatures, JET) n'est touchée.
--
-- ORDRE DE DÉPLOIEMENT : 1) ce fichier  2) edge functions (docs/edge_1014/*)  3) worker  4) pages (git push).
-- Le fichier est compatible avec l'ANCIEN code pendant la transition, SAUF :
--   * §4 client_salon : compte.html / site.html doivent passer par /api/client/salons (worker) ;
--   * §5 rdv_online   : la suppression anonyme disparaît (elle échouait déjà silencieusement) ;
--   * §6 opérateurs   : l'ancien luxyra-supabase.js lisait pin_hash -> à publier dans la foulée ;
--   * §8 lx_email_deja_inscrit : inscription.html doit passer par /api/inscription/email-check.
-- => appliquer ce fichier, puis publier IMMÉDIATEMENT edge functions + worker + pages.
-- ============================================================================

begin;

-- ============================================================================
-- §1-2. COMPTES CLIENTS : vérification de l'email + version de session
-- ============================================================================
alter table public.clients_luxyra add column if not exists session_version integer not null default 0;
alter table public.clients_luxyra add column if not exists verification_expires_at timestamptz;
alter table public.clients_luxyra add column if not exists verification_sent_at timestamptz;
alter table public.clients_luxyra add column if not exists verification_envois integer not null default 0;
alter table public.clients_luxyra add column if not exists verification_jour date;
create index if not exists clients_luxyra_verification_code_idx on public.clients_luxyra (verification_code) where verification_code is not null;

-- Incrémente la version de session (changement / réinitialisation du mot de passe, « déconnecter partout »).
-- Les jetons signés avec l'ancienne version sont refusés par lx-profile, avis-create, client-mes-photos, rdv-demande-create.
create or replace function public.lx_client_session_bump(p_id uuid)
returns integer language sql security definer set search_path = public, pg_temp as $$
  update public.clients_luxyra set session_version = coalesce(session_version, 0) + 1, updated_at = now()
   where id = p_id returning session_version;
$$;
revoke all on function public.lx_client_session_bump(uuid) from public, anon, authenticated;
grant execute on function public.lx_client_session_bump(uuid) to service_role;

-- Colonnes sensibles : modifiables uniquement par le rôle service (edge functions).
-- Ajout : email_verified, verification_*, session_version (avant : un compte Supabase Auth de même email
-- pouvait se déclarer « vérifié » par l'API).
create or replace function public.bp_protect_sensitive()
returns trigger language plpgsql set search_path = public as $$
declare role_name text;
begin
  role_name := coalesce((select auth.role()), 'anon');
  if role_name is distinct from 'service_role' then
    if new.password_hash is distinct from old.password_hash then
      raise exception 'password_hash modifiable uniquement via edge function (service_role)';
    end if;
    if new.email is distinct from old.email then
      raise exception 'email modifiable uniquement via edge function (service_role)';
    end if;
    if new.stripe_customer_id is distinct from old.stripe_customer_id
       or new.stripe_pm is distinct from old.stripe_pm
       or new.card_last4 is distinct from old.card_last4
       or new.card_exp is distinct from old.card_exp then
      raise exception 'Donnees Stripe modifiables uniquement via edge function (service_role)';
    end if;
    -- 2026-10-14
    if new.email_verified is distinct from old.email_verified
       or new.verification_code is distinct from old.verification_code
       or new.verification_expires_at is distinct from old.verification_expires_at
       or new.session_version is distinct from old.session_version then
      raise exception 'Verification email / session modifiables uniquement via edge function (service_role)';
    end if;
  end if;
  return new;
end;
$$;

-- Rattachement automatique des fiches des établissements à un compte client :
-- AVANT : dès l'inscription, par email OU téléphone NON vérifiés (un compte créé avec l'adresse ou le numéro
-- d'une autre personne récupérait ses fiches, RDV, tickets, photos, fidélité).
-- MAINTENANT : seulement quand l'email est VÉRIFIÉ, et seulement par l'email (le téléphone n'est jamais vérifié).
-- 2026-10-14 intégration : public.fn_autolink_clients_luxyra est redéfinie dans docs/migrations_1014/donnees.sql
-- (appliqué après secu.sql) : définition unique qui reprend les règles ci-dessus (e-mail vérifié, e-mail seulement,
-- jamais le téléphone, une seule fois au passage à « vérifié ») et ajoute celles du lot données (même nom et prénom,
-- fiches fusionnées exclues). Le déclencheur ci-dessous utilise cette définition.

drop trigger if exists trg_autolink_clients_luxyra on public.clients_luxyra;
create trigger trg_autolink_clients_luxyra
  after insert or update of email_verified on public.clients_luxyra
  for each row execute function public.fn_autolink_clients_luxyra();

-- Rattachement d'une fiche EXISTANTE à un compte client depuis l'application de l'établissement
-- (syncClientFromOnlineRdv : fiche retrouvée par email / téléphone) : accepté seulement si le compte a un email
-- vérifié identique à celui de la fiche, ou si l'établissement a déjà une fiche liée à ce compte (fusion de doublons).
-- Sinon le lien est ignoré (pas d'erreur : la synchronisation de l'application continue).
create or replace function lx_prive.clients_lien_compte_verifie()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_role text := coalesce((select auth.role()), '');
begin
  if v_role not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin() then return new; end if;
  if new.client_luxyra_id is null or new.client_luxyra_id is not distinct from old.client_luxyra_id then return new; end if;
  if old.client_luxyra_id is not null then
    -- changement d'un lien existant vers un autre compte : jamais depuis l'application
    new.client_luxyra_id := old.client_luxyra_id; return new;
  end if;
  if exists (select 1 from public.clients_luxyra l
              where l.id = new.client_luxyra_id and l.email_verified = true
                and lower(trim(coalesce(l.email, ''))) = lower(trim(coalesce(old.email, new.email, ''))) and coalesce(old.email, new.email, '') <> '')
     or exists (select 1 from public.clients c2
                 where c2.salon_id = new.salon_id and c2.client_luxyra_id = new.client_luxyra_id and c2.id <> new.id) then
    return new;
  end if;
  new.client_luxyra_id := null;
  return new;
end;
$$;
revoke all on function lx_prive.clients_lien_compte_verifie() from public, anon, authenticated;
drop trigger if exists trg_clients_lien_compte_verifie on public.clients;
create trigger trg_clients_lien_compte_verifie
  before update of client_luxyra_id on public.clients
  for each row execute function lx_prive.clients_lien_compte_verifie();

-- ============================================================================
-- §4. client_salon : plus de lecture anonyme des fiches des autres, plus d'insertion anonyme
--     (points de fidélité / consentements falsifiables). Lecture et lien : worker /api/client/salons.
-- ============================================================================
drop policy if exists cs_public_select on public.client_salon;
drop policy if exists anon_insert_client_salon on public.client_salon;
revoke all on public.client_salon from anon;
grant select, insert, update, delete on public.client_salon to authenticated; -- policies cs_tenant_* (établissement propriétaire / admin)
grant select, insert, update, delete on public.client_salon to service_role;

-- ============================================================================
-- §5. rdv_online : fin de la suppression anonyme ; abandon de paiement via le worker /api/rdv/abandon
-- ============================================================================
alter table public.rdv_online add column if not exists abandon_hash text; -- SHA-256 du secret gardé par le navigateur
drop policy if exists anon_delete_rdv_online on public.rdv_online;
revoke delete on public.rdv_online from anon;

-- ============================================================================
-- §6. OPÉRATEURS (code PIN) : vérification côté serveur, verrouillage côté serveur, pin_hash jamais lisible
-- ============================================================================
alter table public.salon_operateurs add column if not exists deblocages integer not null default 0;
alter table public.salon_operateurs add column if not exists deblocage_depuis timestamptz;

create or replace function public._lx_operateur_public(o public.salon_operateurs)
returns jsonb language sql immutable set search_path = public, pg_temp as $$
  select to_jsonb(o) - 'pin_hash' - 'deblocages' - 'deblocage_depuis';
$$;
revoke all on function public._lx_operateur_public(public.salon_operateurs) from public, anon;
grant execute on function public._lx_operateur_public(public.salon_operateurs) to authenticated, service_role;

-- Vérifie le PIN d'un opérateur du salon de l'appelant. 5 erreurs => verrou 30 min (compté en base).
-- Ne renvoie JAMAIS pin_hash. Même empreinte que l'application : sha256(pin || ':luxyra_op_' || salon_id).
create or replace function public.operateur_verifier_pin(p_operateur_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare o public.salon_operateurs; v_fails integer; v_lock timestamptz;
begin
  select * into o from public.salon_operateurs where id = p_operateur_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Opérateur introuvable'); end if;
  if not (public.is_admin() or exists (select 1 from public.salons s where s.id = o.salon_id and s.user_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'Accès refusé');
  end if;
  if not coalesce(o.actif, false) then return jsonb_build_object('ok', false, 'error', 'Compte désactivé'); end if;
  if o.locked_until is not null and o.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Compte verrouillé (trop d''erreurs)', 'locked', true, 'remaining', 0, 'max', 5, 'lockedUntil', o.locked_until);
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{4,8}$' or o.pin_hash is null
     or encode(extensions.digest(p_pin || ':luxyra_op_' || o.salon_id::text, 'sha256'), 'hex') <> o.pin_hash then
    v_fails := case when o.locked_until is not null and o.locked_until <= now() then 1 else coalesce(o.failed_attempts, 0) + 1 end;
    v_lock := case when v_fails >= 5 then now() + interval '30 minutes' else null end;
    update public.salon_operateurs set failed_attempts = v_fails, locked_until = v_lock where id = o.id;
    return jsonb_build_object('ok', false, 'error', 'PIN incorrect (' || v_fails || '/5)', 'locked', v_fails >= 5, 'fails', v_fails,
                              'remaining', greatest(0, 5 - v_fails), 'max', 5, 'lockedUntil', v_lock);
  end if;
  update public.salon_operateurs set failed_attempts = 0, locked_until = null, last_login_at = now() where id = o.id
    returning * into o;
  return jsonb_build_object('ok', true, 'op', public._lx_operateur_public(o));
end;
$$;
revoke all on function public.operateur_verifier_pin(uuid, text) from public, anon;
grant execute on function public.operateur_verifier_pin(uuid, text) to authenticated, service_role;

-- Connexion après déverrouillage biométrique de l'appareil (WebAuthn local) : mêmes contrôles, sans PIN.
create or replace function public.operateur_connexion_bio(p_operateur_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.salon_operateurs;
begin
  select * into o from public.salon_operateurs where id = p_operateur_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Opérateur introuvable'); end if;
  if not (public.is_admin() or exists (select 1 from public.salons s where s.id = o.salon_id and s.user_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'Accès refusé');
  end if;
  if not coalesce(o.actif, false) then return jsonb_build_object('ok', false, 'error', 'Compte désactivé'); end if;
  if o.locked_until is not null and o.locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'Compte verrouillé (trop d''erreurs)', 'locked', true);
  end if;
  update public.salon_operateurs set failed_attempts = 0, last_login_at = now() where id = o.id returning * into o;
  return jsonb_build_object('ok', true, 'op', public._lx_operateur_public(o));
end;
$$;
revoke all on function public.operateur_connexion_bio(uuid) from public, anon;
grant execute on function public.operateur_connexion_bio(uuid) to authenticated, service_role;

-- Déblocage manuel (Paramètres > Équipe) : 3 déblocages max par opérateur et par heure
-- (sinon « débloquer » entre deux séries d'essais annulait le verrouillage).
create or replace function public.operateur_debloquer(p_operateur_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare o public.salon_operateurs; v_n integer;
begin
  select * into o from public.salon_operateurs where id = p_operateur_id for update;
  if not found then return jsonb_build_object('ok', false, 'error', 'Opérateur introuvable'); end if;
  if not (public.is_admin() or exists (select 1 from public.salons s where s.id = o.salon_id and s.user_id = auth.uid())) then
    return jsonb_build_object('ok', false, 'error', 'Accès refusé');
  end if;
  v_n := case when o.deblocage_depuis is not null and o.deblocage_depuis > now() - interval '1 hour' then coalesce(o.deblocages, 0) else 0 end;
  if v_n >= 3 then
    return jsonb_build_object('ok', false, 'error', 'Trop de déblocages en une heure : réessayez plus tard.');
  end if;
  update public.salon_operateurs
     set failed_attempts = 0, locked_until = null,
         deblocages = v_n + 1, deblocage_depuis = case when v_n = 0 then now() else o.deblocage_depuis end
   where id = o.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.operateur_debloquer(uuid) from public, anon;
grant execute on function public.operateur_debloquer(uuid) to authenticated, service_role;

-- Nouveau PIN => compteur d'erreurs remis à zéro (l'application n'écrit plus failed_attempts / locked_until).
create or replace function lx_prive.salon_operateurs_pin_change()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if new.pin_hash is distinct from old.pin_hash then
    new.failed_attempts := 0; new.locked_until := null;
  end if;
  return new;
end;
$$;
revoke all on function lx_prive.salon_operateurs_pin_change() from public, anon, authenticated;
drop trigger if exists trg_salon_operateurs_pin_change on public.salon_operateurs;
create trigger trg_salon_operateurs_pin_change before update of pin_hash on public.salon_operateurs
  for each row execute function lx_prive.salon_operateurs_pin_change();

-- Droits par colonne : pin_hash n'est plus lisible ; le verrouillage n'est plus modifiable directement.
-- (ATTENTION : toute NOUVELLE colonne de salon_operateurs devra être ajoutée à ces GRANT.)
revoke all on public.salon_operateurs from anon;
revoke select, update on public.salon_operateurs from authenticated;
grant select (id, salon_id, prenom, nom, email, avatar_color, avatar_initials, role, pin_length, permissions,
              collab_id, actif, failed_attempts, locked_until, last_login_at, created_at, created_by)
  on public.salon_operateurs to authenticated;
grant update (prenom, nom, email, avatar_color, avatar_initials, role, pin_hash, pin_length, permissions, collab_id, actif)
  on public.salon_operateurs to authenticated;
grant insert, delete on public.salon_operateurs to authenticated;
grant select, insert, update, delete on public.salon_operateurs to service_role;

-- ============================================================================
-- §7. ANNUAIRE : signalements EN ATTENTE (plus de masquage immédiat par un anonyme)
-- ============================================================================
create table if not exists public.annuaire_signalements (
  id bigserial primary key,
  siret text not null,
  type text not null check (type in ('ferme', 'retrait')),
  ip_hash text,
  email text,
  email_dest text,
  motif text,
  statut text not null default 'en_attente'
    check (statut in ('en_attente', 'email_a_confirmer', 'a_valider', 'valide', 'rejete', 'restaure', 'auto')),
  token_hash text,
  token_expire timestamptz,
  confirme_le timestamptz,
  created_at timestamptz not null default now(),
  traite_le timestamptz,
  traite_par text
);
create unique index if not exists annuaire_signalements_ferme_ip_uniq on public.annuaire_signalements (siret, ip_hash) where type = 'ferme';
create index if not exists annuaire_signalements_statut_idx on public.annuaire_signalements (statut, created_at desc);
create index if not exists annuaire_signalements_token_idx on public.annuaire_signalements (token_hash) where token_hash is not null;
alter table public.annuaire_signalements enable row level security;
drop policy if exists annuaire_signalements_admin on public.annuaire_signalements;
create policy annuaire_signalements_admin on public.annuaire_signalements for select to authenticated using (public.is_admin());
revoke all on public.annuaire_signalements from anon, authenticated;
grant select on public.annuaire_signalements to authenticated;
grant select, insert, update, delete on public.annuaire_signalements to service_role;
grant usage, select on sequence public.annuaire_signalements_id_seq to service_role;

-- Les anciennes fonctions (masquage immédiat par n'importe qui) ne sont plus exécutables depuis l'API.
revoke execute on function public.annuaire_signaler_ferme(text) from public, anon, authenticated;
revoke execute on function public.annuaire_retirer(text, text, text) from public, anon, authenticated;
grant execute on function public.annuaire_signaler_ferme(text) to service_role;
grant execute on function public.annuaire_retirer(text, text, text) to service_role;
-- annuaire_retraits : lecture admin seulement (droits d'écriture anon / authenticated retirés)
revoke insert, update, delete, truncate on public.annuaire_retraits from anon, authenticated;

-- « Établissement fermé » (worker, empreinte IP) : masqué après 3 signalements d'adresses différentes en 90 jours,
-- jamais pour un établissement lié à Luxyra ; sinon en attente de l'admin.
create or replace function public.annuaire_signaler(p_siret text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare e record; v_n integer; v_nouveau boolean := false;
begin
  if p_siret !~ '^[0-9]{14}$' or coalesce(p_ip_hash, '') = '' then return jsonb_build_object('ok', false); end if;
  select siret, nom, salon_id, masque into e from public.annuaire_etablissements where siret = p_siret;
  if not found then return jsonb_build_object('ok', false); end if;
  if e.masque then return jsonb_build_object('ok', true, 'masque', true); end if;
  if (select count(*) from public.annuaire_signalements where ip_hash = p_ip_hash and created_at > now() - interval '1 day') >= 10 then
    return jsonb_build_object('ok', false, 'error', 'Trop de signalements');
  end if;
  insert into public.annuaire_signalements (siret, type, ip_hash, motif)
  values (p_siret, 'ferme', p_ip_hash, 'signalé fermé par un visiteur')
  on conflict do nothing;
  get diagnostics v_n = row_count; v_nouveau := v_n > 0;
  if e.salon_id is null then
    select count(distinct ip_hash) into v_n from public.annuaire_signalements
     where siret = p_siret and type = 'ferme' and statut = 'en_attente' and created_at > now() - interval '90 days';
    if v_n >= 3 then
      update public.annuaire_etablissements set masque = true where siret = p_siret and salon_id is null;
      insert into public.annuaire_retraits (siret, motif) values (p_siret, 'signalé fermé par 3 visiteurs') on conflict (siret) do nothing;
      update public.annuaire_signalements set statut = 'auto', traite_le = now(), traite_par = 'automatique (3 signalements)'
       where siret = p_siret and type = 'ferme' and statut = 'en_attente';
      begin perform public.notify_admins('admin_reply', '🗂 Annuaire : établissement masqué (3 signalements)', coalesce(e.nom, '') || ' (SIRET ' || p_siret || ') — à vérifier dans Admin > Annuaire', 'https://luxyra.fr/admin', '{}'::jsonb); exception when others then null; end;
      return jsonb_build_object('ok', true, 'masque', true);
    end if;
  end if;
  if v_nouveau then
    begin perform public.notify_admins('admin_reply', '🗂 Annuaire : signalement « fermé »', coalesce(e.nom, '') || ' (SIRET ' || p_siret || ') — en attente dans Admin > Annuaire', 'https://luxyra.fr/admin', '{}'::jsonb); exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'masque', false);
end;
$$;
revoke all on function public.annuaire_signaler(text, text) from public, anon, authenticated;
grant execute on function public.annuaire_signaler(text, text) to service_role;

-- Demande de retrait : lien de confirmation par email (48 h). Établissement lié à Luxyra : le lien part à l'adresse
-- du GÉRANT (compte de l'établissement), jamais à l'adresse saisie. Renvoie le jeton en clair au worker (seul son
-- SHA-256 est stocké).
create or replace function public.annuaire_retrait_demander(p_siret text, p_email text, p_motif text, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare e record; v_token text; v_dest text;
begin
  if p_siret !~ '^[0-9]{14}$' then return jsonb_build_object('ok', false, 'err', 'SIRET invalide (14 chiffres)'); end if;
  if coalesce(p_email, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return jsonb_build_object('ok', false, 'err', 'Email invalide'); end if;
  select siret, nom, salon_id, masque into e from public.annuaire_etablissements where siret = p_siret;
  if not found then return jsonb_build_object('ok', false, 'err', 'Établissement introuvable dans l''annuaire'); end if;
  if (select count(*) from public.annuaire_signalements where type = 'retrait' and created_at > now() - interval '1 day'
        and (ip_hash = p_ip_hash or siret = p_siret)) >= 3 then
    return jsonb_build_object('ok', false, 'err', 'Trop de demandes aujourd''hui. Écrivez-nous à contact@luxyra.fr.');
  end if;
  if e.salon_id is not null then
    select coalesce(nullif(trim(s.email), ''), u.email) into v_dest
      from public.salons s left join auth.users u on u.id = s.user_id where s.id = e.salon_id;
  else
    v_dest := lower(trim(p_email));
  end if;
  if coalesce(v_dest, '') = '' then return jsonb_build_object('ok', false, 'err', 'Demande impossible : écrivez-nous à contact@luxyra.fr.'); end if;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  insert into public.annuaire_signalements (siret, type, ip_hash, email, email_dest, motif, statut, token_hash, token_expire)
  values (p_siret, 'retrait', p_ip_hash, lower(trim(p_email)), v_dest, left(nullif(trim(p_motif), ''), 300), 'email_a_confirmer',
          encode(extensions.digest(v_token, 'sha256'), 'hex'), now() + interval '48 hours');
  return jsonb_build_object('ok', true, 'token', v_token, 'email_dest', v_dest, 'salon_lie', e.salon_id is not null, 'nom', e.nom);
end;
$$;
revoke all on function public.annuaire_retrait_demander(text, text, text, text) from public, anon, authenticated;
grant execute on function public.annuaire_retrait_demander(text, text, text, text) to service_role;

create or replace function public.annuaire_retrait_confirmer(p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare g public.annuaire_signalements; e record;
begin
  if coalesce(p_token, '') !~ '^[0-9a-f]{64}$' then return jsonb_build_object('ok', false, 'err', 'Lien invalide ou expiré.'); end if;
  select * into g from public.annuaire_signalements
   where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') and type = 'retrait' for update;
  if not found or g.token_expire < now() then return jsonb_build_object('ok', false, 'err', 'Lien invalide ou expiré.'); end if;
  if g.statut <> 'email_a_confirmer' then return jsonb_build_object('ok', true, 'masque', g.statut = 'valide', 'deja', true); end if;
  select siret, nom, salon_id into e from public.annuaire_etablissements where siret = g.siret;
  if e.salon_id is not null then
    -- confirmé par le gérant lui-même (lien envoyé à l'adresse de son compte)
    update public.annuaire_etablissements set masque = true where siret = g.siret;
    insert into public.annuaire_retraits (siret, email, motif) values (g.siret, g.email, coalesce(g.motif, 'retrait confirmé par le gérant'))
      on conflict (siret) do update set demande_le = now();
    update public.annuaire_signalements set statut = 'valide', confirme_le = now(), traite_le = now(), traite_par = 'gérant (email confirmé)', token_hash = null where id = g.id;
    return jsonb_build_object('ok', true, 'masque', true);
  end if;
  update public.annuaire_signalements set statut = 'a_valider', confirme_le = now(), token_hash = null where id = g.id;
  begin perform public.notify_admins('admin_reply', '🗂 Annuaire : demande de retrait à valider', coalesce(e.nom, '') || ' (SIRET ' || g.siret || ') — email confirmé', 'https://luxyra.fr/admin', '{}'::jsonb); exception when others then null; end;
  return jsonb_build_object('ok', true, 'masque', false);
end;
$$;
revoke all on function public.annuaire_retrait_confirmer(text) from public, anon, authenticated;
grant execute on function public.annuaire_retrait_confirmer(text) to service_role;

-- Modération (Admin > Annuaire) : liste + valider / rejeter / restaurer. Admin (2FA) uniquement.
create or replace function public.annuaire_moderation_liste()
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return jsonb_build_object(
    'signalements', coalesce((select jsonb_agg(x order by x.created_at desc) from (
        select g.id, g.siret, g.type, g.statut, g.email, g.motif, g.created_at, g.confirme_le, g.traite_le, g.traite_par,
               a.nom, a.ville, a.salon_id, a.masque,
               (select count(distinct g2.ip_hash) from public.annuaire_signalements g2 where g2.siret = g.siret and g2.type = 'ferme') as nb_ferme
          from public.annuaire_signalements g left join public.annuaire_etablissements a on a.siret = g.siret
         where g.created_at > now() - interval '180 days'
         order by g.created_at desc limit 300) x), '[]'::jsonb),
    'masques', coalesce((select jsonb_agg(y order by y.demande_le desc nulls last) from (
        select a.siret, a.nom, a.ville, a.salon_id, r.demande_le, r.motif
          from public.annuaire_etablissements a left join public.annuaire_retraits r on r.siret = a.siret
         where a.masque order by r.demande_le desc nulls last limit 500) y), '[]'::jsonb));
end;
$$;
revoke all on function public.annuaire_moderation_liste() from public, anon;
grant execute on function public.annuaire_moderation_liste() to authenticated;

create or replace function public.annuaire_moderation_action(p_action text, p_id bigint default null, p_siret text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare g public.annuaire_signalements; v_n integer := 0; v_siret text;
begin
  if not public.is_admin() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  if p_action in ('valider', 'rejeter') then
    select * into g from public.annuaire_signalements where id = p_id for update;
    if not found then return jsonb_build_object('ok', false, 'error', 'Signalement introuvable'); end if;
    v_siret := g.siret;
    if p_action = 'valider' then
      update public.annuaire_etablissements set masque = true where siret = g.siret;
      get diagnostics v_n = row_count;
      insert into public.annuaire_retraits (siret, email, motif) values (g.siret, g.email, coalesce(g.motif, 'validé par l''admin'))
        on conflict (siret) do update set demande_le = now();
      update public.annuaire_signalements set statut = 'valide', traite_le = now(), traite_par = 'admin'
       where siret = g.siret and type = g.type and statut in ('en_attente', 'a_valider', 'email_a_confirmer');
    else
      update public.annuaire_signalements set statut = 'rejete', traite_le = now(), traite_par = 'admin'
       where siret = g.siret and type = g.type and statut in ('en_attente', 'a_valider', 'email_a_confirmer');
      get diagnostics v_n = row_count;
    end if;
  elsif p_action = 'restaurer' then
    v_siret := coalesce(p_siret, (select siret from public.annuaire_signalements where id = p_id));
    if coalesce(v_siret, '') !~ '^[0-9]{14}$' then return jsonb_build_object('ok', false, 'error', 'SIRET invalide'); end if;
    update public.annuaire_etablissements set masque = false where siret = v_siret;
    get diagnostics v_n = row_count;
    delete from public.annuaire_retraits where siret = v_siret;
    update public.annuaire_signalements set statut = 'restaure', traite_le = now(), traite_par = 'admin'
     where siret = v_siret and statut in ('valide', 'auto', 'en_attente', 'a_valider');
  else
    return jsonb_build_object('ok', false, 'error', 'Action inconnue');
  end if;
  return jsonb_build_object('ok', v_n > 0, 'lignes', v_n, 'siret', v_siret);
end;
$$;
revoke all on function public.annuaire_moderation_action(text, bigint, text) from public, anon;
grant execute on function public.annuaire_moderation_action(text, bigint, text) to authenticated;

-- ============================================================================
-- §8. Fonctions publiques : report_server_error plafonné, lx_email_deja_inscrit / get_monitoring_status /
--     devis_expire_overdue retirés de l'API publique
-- ============================================================================
create index if not exists server_errors_ip_hash_idx on public.server_errors (ip_hash, reported_at desc) where ip_hash is not null;

create or replace function public.report_server_error(
  p_source text, p_message text, p_severity text default 'error'::text, p_stack text default null::text,
  p_context jsonb default null::jsonb, p_salon_id uuid default null::uuid, p_http_method text default null::text,
  p_http_path text default null::text, p_http_status integer default null::integer, p_user_email text default null::text)
returns bigint language plpgsql security definer set search_path = public, pg_catalog, pg_temp as $$
declare
  v_id bigint;
  v_role text := coalesce((select auth.role()), '');
  v_sev text := lower(coalesce(p_severity, 'error'));
  v_ip text; v_hash text := null; v_hdr json;
begin
  if v_sev not in ('warning', 'error', 'critical') then v_sev := 'error'; end if;
  -- 2026-10-14 : gravité plafonnée selon l'appelant (« critical » déclenche des emails d'alerte)
  if v_role = 'anon' then
    v_sev := 'warning';
  elsif v_role = 'authenticated' and v_sev = 'critical' then
    v_sev := 'error';
  end if;
  if v_role in ('anon', 'authenticated') then
    begin
      v_hdr := nullif(current_setting('request.headers', true), '')::json;
      v_ip := coalesce(v_hdr ->> 'cf-connecting-ip', split_part(coalesce(v_hdr ->> 'x-forwarded-for', ''), ',', 1));
    exception when others then v_ip := null; end;
    v_hash := left(encode(extensions.digest('lx-err|' || coalesce(nullif(trim(v_ip), ''), 'inconnue'), 'sha256'), 'hex'), 32);
    -- 30 rapports / 10 min par adresse (empreinte)
    if (select count(*) from public.server_errors where ip_hash = v_hash and reported_at > now() - interval '10 minutes') >= 30 then
      return null;
    end if;
    if p_context is not null and pg_column_size(p_context) > 8000 then p_context := null; end if;
  end if;
  insert into public.server_errors (source, severity, message, stack, context, salon_id, http_method, http_path, http_status, user_email, ip_hash)
  values (left(coalesce(p_source, 'inconnu'), 200), v_sev, left(p_message, 4000), left(p_stack, 6000), p_context, p_salon_id,
          left(p_http_method, 20), left(p_http_path, 500), p_http_status, left(p_user_email, 200), v_hash)
  returning id into v_id;
  return v_id;
exception when others then
  raise warning '[report_server_error] failed to log: %', sqlerrm;
  return null;
end;
$$;
grant execute on function public.report_server_error(text, text, text, text, jsonb, uuid, text, text, integer, text) to anon, authenticated, service_role;

-- Utilisé par inscription.html via le worker (/api/inscription/email-check, limité par IP)
revoke execute on function public.lx_email_deja_inscrit(text) from public, anon, authenticated;
grant execute on function public.lx_email_deja_inscrit(text) to service_role;

-- Monitoring : plus d'exécution anonyme ; le panneau admin passe par admin_monitoring_status() (admin 2FA)
create or replace function public.admin_monitoring_status()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not public.is_admin() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  return to_jsonb(public.get_monitoring_status());
end;
$$;
revoke execute on function public.get_monitoring_status() from public, anon, authenticated;
grant execute on function public.get_monitoring_status() to service_role;
revoke all on function public.admin_monitoring_status() from public, anon;
grant execute on function public.admin_monitoring_status() to authenticated;

-- Expiration des devis (tous les établissements) : réservée au cron / rôle service (l'application l'appelait
-- au chargement, pour tout le monde).
revoke execute on function public.devis_expire_overdue() from public, anon, authenticated;
grant execute on function public.devis_expire_overdue() to service_role;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'devis_expire_overdue_nuit') then
    perform cron.unschedule('devis_expire_overdue_nuit');
  end if;
  perform cron.schedule('devis_expire_overdue_nuit', '10 2 * * *', 'select public.devis_expire_overdue();');
end $$;

-- ============================================================================
-- §9. SUPPORT : l'établissement ne réécrit plus les conversations ni les messages
-- ============================================================================
drop policy if exists support_conv_salon_own on public.support_conversations;
drop policy if exists support_conv_salon_select on public.support_conversations;
drop policy if exists support_conv_salon_insert on public.support_conversations;
drop policy if exists support_conv_salon_update on public.support_conversations;
create policy support_conv_salon_select on public.support_conversations for select to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()));
create policy support_conv_salon_insert on public.support_conversations for insert to authenticated
  with check (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()));
create policy support_conv_salon_update on public.support_conversations for update to authenticated
  using (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()))
  with check (salon_id in (select s.id from public.salons s where s.user_id = auth.uid()));
-- (aucune policy DELETE pour l'établissement)

-- Garde : depuis l'API (rôle authenticated, hors admin), seuls « lu » (unread_count_client) et « résolu » changent.
-- Les fonctions internes (SECURITY DEFINER : compteurs, réouverture) ne sont pas concernées (current_user = propriétaire).
create or replace function lx_prive.support_conv_garde()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'open'; new.resolved_at := null; new.resolved_by := null;
    new.unread_count_admin := 0; new.unread_count_client := 0; new.bot_active := true;
    new.created_at := now(); new.updated_at := now(); new.last_message_at := now();
    new.subject := left(new.subject, 120);
    return new;
  end if;
  new.id := old.id; new.salon_id := old.salon_id; new.subject := old.subject; new.bot_active := old.bot_active;
  new.unread_count_admin := old.unread_count_admin; new.last_message_at := old.last_message_at; new.created_at := old.created_at;
  new.unread_count_client := least(coalesce(old.unread_count_client, 0), greatest(coalesce(new.unread_count_client, 0), 0));
  if new.status is distinct from old.status and new.status = 'resolved' then
    new.resolved_at := now(); new.resolved_by := 'salon';
  else
    new.status := old.status; new.resolved_at := old.resolved_at; new.resolved_by := old.resolved_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function lx_prive.support_conv_garde() from public, anon, authenticated;
drop trigger if exists trg_support_conv_garde on public.support_conversations;
create trigger trg_support_conv_garde before insert or update on public.support_conversations
  for each row execute function lx_prive.support_conv_garde();

-- Messages : la conversation doit appartenir au même établissement (tous rôles) ; depuis l'API (hors admin),
-- un message ne peut plus être réécrit : seul read_by_client change.
create or replace function lx_prive.support_msg_garde()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare v_salon uuid;
begin
  if tg_op = 'INSERT' and new.conversation_id is not null then
    select c.salon_id into v_salon from public.support_conversations c where c.id = new.conversation_id;
    if found and v_salon is distinct from new.salon_id then
      raise exception 'Conversation de support inconnue pour cet établissement' using errcode = '42501';
    end if;
  end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.read_by_admin := false; new.created_at := now();
    return new;
  end if;
  new.id := old.id; new.salon_id := old.salon_id; new.conversation_id := old.conversation_id; new.sender := old.sender;
  new.message := old.message; new.read_by_admin := old.read_by_admin; new.created_at := old.created_at;
  return new;
end;
$$;
revoke all on function lx_prive.support_msg_garde() from public, anon, authenticated;
drop trigger if exists a_trg_support_msg_garde on public.support_messages;
create trigger a_trg_support_msg_garde before insert or update on public.support_messages
  for each row execute function lx_prive.support_msg_garde();

-- fn_touch_support_conv : ne crée / ne rouvre QUE la conversation du même établissement
create or replace function public.fn_touch_support_conv()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_salon uuid;
begin
  if new.conversation_id is not null then
    select c.salon_id into v_salon from public.support_conversations c where c.id = new.conversation_id;
    if found and v_salon is distinct from new.salon_id then
      raise exception 'Conversation de support inconnue pour cet établissement' using errcode = '42501';
    end if;
    insert into public.support_conversations (id, salon_id, status, last_message_at, updated_at)
    values (new.conversation_id, new.salon_id, 'open', new.created_at, new.created_at)
    on conflict (id) do update
      set last_message_at = excluded.last_message_at,
          updated_at = excluded.last_message_at,
          status = 'open',
          resolved_at = null,
          resolved_by = null
      where public.support_conversations.salon_id = excluded.salon_id;
  end if;
  return new;
end;
$$;
revoke all on function public.fn_touch_support_conv() from public, anon, authenticated;

-- ============================================================================
-- §10. ADMIN « intouchable »
-- ============================================================================
-- is_admin() : double authentification (aal2) EXIGÉE dans tous les cas (avant : aal1 accepté tant qu'aucun
-- facteur n'était enregistré). Le facteur TOTP de support@luxyra.fr est actif (vérifié le 14/10).
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (select 1 from auth.users where id = auth.uid() and email = 'support@luxyra.fr')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2';
$$;

-- admin_users : la policy ALL (with check implicite user_id = auth.uid()) permettait à N'IMPORTE QUEL compte
-- de s'y inscrire lui-même (accès à l'écran admin, compte protégé de la purge à 6 ans). Lecture seule de sa ligne.
drop policy if exists admin_users_all on public.admin_users;
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete, truncate on public.admin_users from anon, authenticated;

-- Base de connaissances du bot : éditable depuis Admin > Bot (admin 2FA)
drop policy if exists support_bot_kb_admin_select on public.support_bot_kb;
drop policy if exists support_bot_kb_admin_insert on public.support_bot_kb;
drop policy if exists support_bot_kb_admin_update on public.support_bot_kb;
create policy support_bot_kb_admin_select on public.support_bot_kb for select to authenticated using (public.is_admin());
create policy support_bot_kb_admin_insert on public.support_bot_kb for insert to authenticated with check (public.is_admin());
create policy support_bot_kb_admin_update on public.support_bot_kb for update to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update on public.support_bot_kb to authenticated;
grant select, insert, update, delete on public.support_bot_kb to service_role;

-- Vérification d'un compte avant de changer salons.user_id (Admin > fiche > User ID)
create or replace function public.admin_compte_info(p_uid uuid)
returns jsonb language plpgsql stable security definer set search_path = public, auth, pg_temp as $$
declare u record;
begin
  if not public.is_admin() then raise exception 'Accès refusé' using errcode = '42501'; end if;
  select id, email, created_at, last_sign_in_at into u from auth.users where id = p_uid;
  if not found then return jsonb_build_object('existe', false); end if;
  return jsonb_build_object('existe', true, 'email', u.email, 'cree_le', u.created_at, 'derniere_connexion', u.last_sign_in_at,
    'autres_salons', (select count(*) from public.salons s where s.user_id = p_uid));
end;
$$;
revoke all on function public.admin_compte_info(uuid) from public, anon;
grant execute on function public.admin_compte_info(uuid) to authenticated;

-- ============================================================================
-- §11. Base du bot de support (règle permanente : mise à jour dans la même intervention)
-- ============================================================================
insert into public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le)
values ('securite_1014', 'Code PIN hors ligne, déblocage, annuaire (14/10/2026)', 95,
$kb$Code PIN des opérateurs : il est vérifié par le serveur ; 5 codes faux = profil verrouillé 30 minutes.
Bouton « 🔓 Débloquer » (réglages de l'équipe) : 3 déblocages au maximum par profil et par heure ; au-delà, attendre ou laisser passer les 30 minutes.
Sans Internet : la caisse accepte le DERNIER code PIN validé sur CET appareil, si ce profil s'y est connecté avec Internet depuis moins de 30 jours (compteur de 5 erreurs propre à l'appareil). Après un changement de code PIN, se connecter une fois avec Internet pour pouvoir l'utiliser hors ligne. Face ID / empreinte marche aussi hors ligne pour un profil déjà connecté sur l'appareil.
Profil jamais connecté sur l'appareil + pas d'Internet : impossible de l'ouvrir hors ligne (message « Hors ligne : ce profil ne s'est jamais connecté sur cet appareil »). Se reconnecter à Internet.
Annuaire public « Coiffeur à … » : un visiteur qui signale « établissement fermé » ne le retire plus immédiatement (vérification par l'équipe Luxyra, ou retrait après 3 signalements de personnes différentes ; jamais un établissement qui utilise Luxyra). Une demande de retrait est confirmée par email ; pour un établissement Luxyra, l'email part à l'adresse du compte du gérant.
Problème de verrouillage persistant ou profil bloqué malgré le bon code : <ESCALATE/>$kb$, true, now())
on conflict (cle) do update set titre = excluded.titre, ordre = excluded.ordre, contenu = excluded.contenu, actif = true, maj_le = now();

commit;

-- ============================================================================
-- CONTRÔLES APRÈS APPLICATION (lecture seule)
-- ============================================================================
-- select policyname, cmd, roles from pg_policies where tablename in ('client_salon','rdv_online','support_conversations','support_messages','admin_users','support_bot_kb');
-- select has_column_privilege('authenticated','public.salon_operateurs','pin_hash','select');   -- attendu : false
-- select has_function_privilege('anon','public.annuaire_retirer(text,text,text)','execute');     -- attendu : false
-- select has_function_privilege('anon','public.lx_email_deja_inscrit(text)','execute');         -- attendu : false
-- select has_function_privilege('anon','public.get_monitoring_status()','execute');            -- attendu : false
-- select has_function_privilege('authenticated','public.devis_expire_overdue()','execute');    -- attendu : false
-- select jobname, schedule from cron.job where jobname = 'devis_expire_overdue_nuit';
