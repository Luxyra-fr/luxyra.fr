-- Retour arrière exact de i2_admin_ecriture_caisse.sql (policies d'origine, telles que relevées le 31/10/2026).
begin;
drop policy if exists tickets_tenant_insert on public.tickets;
create policy tickets_tenant_insert on public.tickets as permissive for INSERT to authenticated
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists tickets_tenant_update on public.tickets;
create policy tickets_tenant_update on public.tickets as permissive for UPDATE to authenticated
  using ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin())
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists tk_attente_tenant_insert on public.tickets_attente;
create policy tk_attente_tenant_insert on public.tickets_attente as permissive for INSERT to authenticated
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists tk_attente_tenant_update on public.tickets_attente;
create policy tk_attente_tenant_update on public.tickets_attente as permissive for UPDATE to authenticated
  using ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin())
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists tk_attente_tenant_delete on public.tickets_attente;
create policy tk_attente_tenant_delete on public.tickets_attente as permissive for DELETE to authenticated
  using ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists salon_clotures_insert on public.clotures;
create policy salon_clotures_insert on public.clotures as permissive for INSERT to public
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists clotures_mensuelles_insert on public.clotures_mensuelles;
create policy clotures_mensuelles_insert on public.clotures_mensuelles as permissive for INSERT to authenticated
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists clotures_annuelles_insert on public.clotures_annuelles;
create policy clotures_annuelles_insert on public.clotures_annuelles as permissive for INSERT to authenticated
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists archives_insert_own on public.archives;
create policy archives_insert_own on public.archives as permissive for INSERT to authenticated
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists salon_archives_insert on public.archives;
create policy salon_archives_insert on public.archives as permissive for INSERT to public
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists salon_audit_insert on public.audit_log;
create policy salon_audit_insert on public.audit_log as permissive for INSERT to public
  with check ((salon_id IN ( SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))) OR is_admin());
drop policy if exists tickets_tenant_delete on public.tickets;
create policy tickets_tenant_delete on public.tickets as permissive for delete to authenticated using (is_admin());
drop trigger if exists trg_salons_user_id_garde on public.salons;
drop function if exists lx_prive.salons_user_id_garde();
drop function if exists public.lx_admin_salon_changer_proprietaire(uuid, uuid);
commit;
