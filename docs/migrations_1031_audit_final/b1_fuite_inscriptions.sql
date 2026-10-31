-- 2026-10-31 audit final B1 : journal d'inscriptions et demandes d'essai lisibles par l'admin seulement (plus par tout compte connecté)
drop policy if exists "Allow select for authenticated" on public.inscriptions_log;
drop policy if exists auth_select on public.demandes_essai;
create policy inscriptions_log_admin_select on public.inscriptions_log for select to authenticated using (public.is_admin());
create policy demandes_essai_admin_select on public.demandes_essai for select to authenticated using (public.is_admin());
