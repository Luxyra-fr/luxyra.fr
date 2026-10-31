-- Luxyra — 2026-10-31 — Comptes clients : réserves du contre-audit 3 (hors périmètre fiscal NF525).
-- Idempotent. Aucune table de caisse touchée.
--   m3  : sync_clients_luxyra_from_salon ne modifie plus un compte par simple égalité d'e-mail : seulement les comptes
--         RELIÉS à une fiche de l'établissement appelant (clients.client_luxyra_id = clients_luxyra.id) ; admin inchangé.
--   m5  : anon n'a plus aucun droit sur clients_luxyra / client_invites ; authenticated : client_invites retiré, clients_luxyra
--         limité par colonne (jamais password_hash, codes, version de session) ; bp_protect_sensitive étendu.
--   Brevo : clé secrète du webhook (coffre Supabase) + état « clé déjà vue » + contrôle par une fonction réservée au serveur.

begin;

-- ---------------------------------------------------------------- m3
create or replace function public.sync_clients_luxyra_from_salon(p_email text, p_nom text DEFAULT NULL::text, p_prenom text DEFAULT NULL::text, p_telephone text DEFAULT NULL::text, p_genre text DEFAULT NULL::text, p_adresse text DEFAULT NULL::text, p_cp text DEFAULT NULL::text, p_ville text DEFAULT NULL::text, p_date_naissance date DEFAULT NULL::date, p_sms_ok boolean DEFAULT NULL::boolean, p_email_ok boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_is_salon boolean;
  v_nb_updated int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentification requise';
  END IF;
  SELECT EXISTS(SELECT 1 FROM salons WHERE user_id = v_user_id) INTO v_is_salon;
  IF NOT v_is_salon AND NOT is_admin() THEN
    RAISE EXCEPTION 'Réservé aux salons et admins';
  END IF;
  IF p_email IS NULL OR p_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'email vide');
  END IF;
  -- Champs sensibles (password_hash, email, stripe_*) jamais touchés.
  -- 2026-10-31 (contre-audit 3, m3) : un établissement ne met à jour QUE le compte relié à SA fiche
  -- (clients.client_luxyra_id, posé seulement pour un compte confirmé) — plus jamais par simple égalité d'e-mail.
  UPDATE clients_luxyra cl SET
    nom = COALESCE(p_nom, nom),
    prenom = COALESCE(p_prenom, prenom),
    telephone = COALESCE(p_telephone, telephone),
    genre = COALESCE(p_genre, genre),
    adresse = COALESCE(p_adresse, adresse),
    cp = COALESCE(p_cp, cp),
    ville = COALESCE(p_ville, ville),
    date_naissance = COALESCE(p_date_naissance, date_naissance),
    sms_ok = COALESCE(p_sms_ok, sms_ok),
    email_ok = COALESCE(p_email_ok, email_ok),
    updated_at = NOW()
  WHERE LOWER(cl.email) = LOWER(p_email)
    AND (public.is_admin() OR EXISTS (SELECT 1 FROM public.clients c JOIN public.salons s ON s.id = c.salon_id
                                      WHERE s.user_id = auth.uid() AND c.client_luxyra_id = cl.id));
  GET DIAGNOSTICS v_nb_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_nb_updated, 'email', p_email);
END;
$function$;

-- ---------------------------------------------------------------- m5 : droits
revoke all on public.clients_luxyra from anon;
revoke all on public.client_invites from anon, authenticated;
revoke all on public.clients_luxyra from authenticated;
-- droits par colonne (les politiques RLS restent : sa propre ligne ou admin)
grant select (id, email, nom, prenom, telephone, date_naissance, genre, sms_ok, email_ok, email_verified, avatar_url, last_login,
              created_at, updated_at, card_last4, card_exp, adresse, cp, ville, pays, email_rejete_at)
  on public.clients_luxyra to authenticated;
grant update (nom, prenom, telephone, date_naissance, genre, sms_ok, email_ok, avatar_url, adresse, cp, ville, pays, updated_at)
  on public.clients_luxyra to authenticated;
grant all on public.clients_luxyra to service_role;
grant all on public.client_invites to service_role;

-- bp_protect_sensitive : + email_verified_legacy, verification_envois, verification_jour, verification_sent_at
create or replace function public.bp_protect_sensitive()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare role_name text;
begin
  role_name := coalesce((select auth.role()), 'anon');
  -- les scripts de migration (rôle postgres) ne passent pas par l'API ; les appels API sont anon / authenticated / service_role.
  if role_name is distinct from 'service_role' and current_user not in ('postgres', 'supabase_admin') then
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
    if new.email_rejete_at is distinct from old.email_rejete_at or new.email_rejet_motif is distinct from old.email_rejet_motif then
      raise exception 'email_rejete_at modifiable uniquement via edge function (service_role)';
    end if;
    if new.email_verified is distinct from old.email_verified
       or new.email_verified_legacy is distinct from old.email_verified_legacy
       or new.verification_code is distinct from old.verification_code
       or new.verification_email is distinct from old.verification_email
       or new.verification_expires_at is distinct from old.verification_expires_at
       or new.verification_sent_at is distinct from old.verification_sent_at
       or new.verification_envois is distinct from old.verification_envois
       or new.verification_jour is distinct from old.verification_jour
       or new.session_version is distinct from old.session_version then
      raise exception 'Verification email / session modifiables uniquement via edge function (service_role)';
    end if;
  end if;
  return new;
end;
$function$;

-- ---------------------------------------------------------------- Webhook Brevo : clé secrète
create table if not exists lx_prive.brevo_webhook_etat (
  id int primary key default 1 check (id = 1),
  cle_vue_le timestamptz,
  alerte_sans_cle_le timestamptz
);
insert into lx_prive.brevo_webhook_etat (id) values (1) on conflict do nothing;
revoke all on lx_prive.brevo_webhook_etat from public, anon, authenticated;

do $$ begin
  if not exists (select 1 from vault.secrets where name = 'brevo_webhook_cle') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'brevo_webhook_cle', 'Clé du webhook Brevo (paramètre k de l''URL)');
  end if;
end $$;

-- 'ok' : bonne clé (et la clé est désormais exigée) ; 'transition' : pas de clé mais la nouvelle URL n'a encore jamais servi
-- (ancienne URL tolérée, alerte une fois par jour dans la surveillance) ; 'refus' : clé absente ou fausse alors qu'elle a déjà servi ;
-- 'trop' : plus de 300 événements Brevo enregistrés dans la dernière minute.
create or replace function public.lx_brevo_webhook_controle(p_cle text)
 returns text
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_cle text; v_etat lx_prive.brevo_webhook_etat%rowtype; v_n int;
begin
  select decrypted_secret into v_cle from vault.decrypted_secrets where name = 'brevo_webhook_cle';
  select count(*) into v_n from public.server_errors where source = 'brevo_webhook' and reported_at > now() - interval '1 minute';
  if v_n > 300 then return 'trop'; end if;
  select * into v_etat from lx_prive.brevo_webhook_etat where id = 1 for update;
  if v_cle is not null and p_cle is not null and length(p_cle) = length(v_cle)
     and extensions.digest(p_cle, 'sha256') = extensions.digest(v_cle, 'sha256') then
    update lx_prive.brevo_webhook_etat set cle_vue_le = coalesce(cle_vue_le, now()) where id = 1;
    return 'ok';
  end if;
  if v_etat.cle_vue_le is not null then return 'refus'; end if;
  if v_etat.alerte_sans_cle_le is null or v_etat.alerte_sans_cle_le < now() - interval '24 hours' then
    update lx_prive.brevo_webhook_etat set alerte_sans_cle_le = now() where id = 1;
    insert into public.server_errors (source, severity, message, http_path)
    values ('brevo_webhook_config', 'error', 'Brevo appelle encore l''ancienne adresse de notification, sans clé : coller la nouvelle adresse dans Brevo (voir CLAUDE.md, rubrique Brevo)', '/brevo/sans-cle');
  end if;
  return 'transition';
end $function$;
revoke all on function public.lx_brevo_webhook_controle(text) from public, anon, authenticated;
grant execute on function public.lx_brevo_webhook_controle(text) to service_role;

-- Surveillance : titre explicite pour l'alerte « ancienne adresse Brevo » (niveau « à réparer », pas « grave »)
do $m$
declare d text; a1 text;
begin
  d := pg_get_functiondef('lx_prive.a_reparer_brut'::regproc);
  if position('brevo_webhook_config' in d) > 0 then return; end if;
  a1 := $a$              when g.k ~ 'brevo|mail failed' then 'Envoi d''e-mail en échec (Brevo)'$a$;
  if position(a1 in d) = 0 then raise exception 'ancre surveillance introuvable'; end if;
  d := replace(d, a1, $b$              when g.source = 'brevo_webhook_config' then 'Brevo : coller la nouvelle adresse de notification (avec clé)'
$b$ || a1);
  execute d;
end $m$;

commit;

-- Vérifications (lecture seule) :
--   select has_table_privilege('anon','public.clients_luxyra','SELECT');                 -- false
--   select has_column_privilege('authenticated','public.clients_luxyra','password_hash','SELECT'); -- false
--   select has_column_privilege('authenticated','public.clients_luxyra','prenom','SELECT');        -- true
--   select has_function_privilege('anon','public.lx_brevo_webhook_controle(text)','EXECUTE');      -- false
-- Retour arrière : docs/migrations_1031_comptes/comptes_securite_retour_arriere.sql
