-- Luxyra — 31/10/2026 — Audit sécurité admin, point I2 (validé par Alexandre) :
-- l'administrateur (is_admin()) perd les droits d'ÉCRITURE DIRECTS sur les tables de caisse NF525 des établissements.
-- Durcissement des DROITS uniquement : aucune donnée fiscale lue, modifiée ou supprimée. Lecture admin inchangée.
-- Les écritures de caisse restent faites par l'établissement propriétaire (session du salon), par les fonctions serveur
-- SECURITY DEFINER et par le rôle service (worker, edge functions) : non concernés par ces policies.
-- Inventaire préalable : admin.html n'écrit JAMAIS dans ces tables (lectures seules : audit_log, clotures) ; la vue admin
-- d'un salon est en lecture seule ; les remontées d'erreurs passent par l'edge lx-error-report (rôle service).
-- Rejouable. Retour arrière : i2_retour_arriere.sql.
begin;
drop policy if exists tickets_tenant_insert on public.tickets;
create policy tickets_tenant_insert on public.tickets as permissive for INSERT to authenticated
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists tickets_tenant_update on public.tickets;
create policy tickets_tenant_update on public.tickets as permissive for UPDATE to authenticated
  using (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())))
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists tk_attente_tenant_insert on public.tickets_attente;
create policy tk_attente_tenant_insert on public.tickets_attente as permissive for INSERT to authenticated
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists tk_attente_tenant_update on public.tickets_attente;
create policy tk_attente_tenant_update on public.tickets_attente as permissive for UPDATE to authenticated
  using (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())))
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists tk_attente_tenant_delete on public.tickets_attente;
create policy tk_attente_tenant_delete on public.tickets_attente as permissive for DELETE to authenticated
  using (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists salon_clotures_insert on public.clotures;
create policy salon_clotures_insert on public.clotures as permissive for INSERT to public
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists clotures_mensuelles_insert on public.clotures_mensuelles;
create policy clotures_mensuelles_insert on public.clotures_mensuelles as permissive for INSERT to authenticated
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists clotures_annuelles_insert on public.clotures_annuelles;
create policy clotures_annuelles_insert on public.clotures_annuelles as permissive for INSERT to authenticated
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists archives_insert_own on public.archives;
create policy archives_insert_own on public.archives as permissive for INSERT to authenticated
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists salon_archives_insert on public.archives;
create policy salon_archives_insert on public.archives as permissive for INSERT to public
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
drop policy if exists salon_audit_insert on public.audit_log;
create policy salon_audit_insert on public.audit_log as permissive for INSERT to public
  with check (salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid())));
-- tickets : la seule policy DELETE était « is_admin() » (un ticket encaissé ne se supprime jamais) -> supprimée
drop policy if exists tickets_tenant_delete on public.tickets;

-- Propriétaire d'un établissement (salons.user_id) : plus de changement direct, ni par le salon ni par l'admin.
-- Seule voie : lx_admin_salon_changer_proprietaire() (admin aal2, journalisée) ; les fonctions serveur et le rôle service restent libres.
create or replace function lx_prive.salons_user_id_garde() returns trigger language plpgsql
set search_path = pg_catalog, public as $f$
begin
  if new.user_id is distinct from old.user_id
     and current_user in ('authenticated','anon')
     and coalesce(current_setting('lx.changer_proprietaire', true), '') <> '1' then
    raise exception 'Le compte propriétaire d''un établissement ne se change que par la fonction admin dédiée (journalisée)'
      using errcode = '42501';
  end if;
  return new;
end $f$;
drop trigger if exists trg_salons_user_id_garde on public.salons;
create trigger trg_salons_user_id_garde before update of user_id on public.salons
  for each row execute function lx_prive.salons_user_id_garde();

create or replace function public.lx_admin_salon_changer_proprietaire(p_salon uuid, p_user uuid) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $f$
declare v_ancien uuid; v_email text; v_admin_email text;
begin
  if not public.is_admin() then raise exception 'Réservé à l''administrateur (double authentification)' using errcode = '42501'; end if;
  select email into v_email from auth.users where id = p_user;
  if v_email is null then raise exception 'Aucun compte de connexion avec cet identifiant'; end if;
  select user_id into v_ancien from public.salons where id = p_salon for update;
  if not found then raise exception 'Établissement introuvable'; end if;
  if v_ancien is not distinct from p_user then return jsonb_build_object('ok', true, 'inchange', true); end if;
  perform set_config('lx.changer_proprietaire', '1', true);
  update public.salons set user_id = p_user where id = p_salon;
  perform set_config('lx.changer_proprietaire', '', true);
  select email into v_admin_email from auth.users where id = auth.uid();
  insert into public.admin_log(admin_user_id, admin_email, salon_id, action, cible, details, avant, apres, origine)
  values (auth.uid(), v_admin_email, p_salon, 'CHANGE_USER_ID', 'salons:' || p_salon,
          'Rattachement au compte ' || v_email, jsonb_build_object('user_id', v_ancien), jsonb_build_object('user_id', p_user), 'rpc');
  return jsonb_build_object('ok', true, 'email', v_email);
end $f$;
revoke all on function public.lx_admin_salon_changer_proprietaire(uuid, uuid) from public, anon;
grant execute on function public.lx_admin_salon_changer_proprietaire(uuid, uuid) to authenticated;
commit;
