-- Retour arrière EXACT de nf525_admin_sans_ecriture_caisse_2.sql (à n'utiliser qu'en cas de besoin, avec trace au registre).
-- Après exécution, md5(pg_get_functiondef) doit redonner : factory_reset_salon 0a440c07506617601a9cd883e95424c5,
-- reset_ventes_test_salon 04d5b5279d61429c4e36c4fe65d6473a, salon_a_historique_fiscal e4abb6b69dd406bcf842694270a76339.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.factory_reset_salon(uuid)'::regprocedure);
  if position('is_caller_admin' in d) = 0 then
    execute replace(d, E'        EXISTS (SELECT 1 FROM salons s WHERE s.id = p_salon_id AND s.user_id = auth.uid())\n',
                       E'        EXISTS (SELECT 1 FROM salons s WHERE s.id = p_salon_id AND s.user_id = auth.uid())\n        OR public.is_caller_admin()\n');
  end if;
  d := pg_get_functiondef('public.reset_ventes_test_salon(uuid)'::regprocedure);
  if position('is_caller_admin' in d) = 0 then
    execute replace(d, 'and s.user_id = auth.uid())) then', 'and s.user_id = auth.uid()) or public.is_caller_admin()) then');
  end if;
end $$;
drop trigger if exists trg_salons_identite_trace on public.salons;
drop function if exists lx_prive.salons_identite_trace();
CREATE OR REPLACE FUNCTION public.salon_a_historique_fiscal(p_salon uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when coalesce((select auth.role()), '') in ('authenticated','anon')
               and not public.is_admin()
               and not exists (select 1 from salons where id = p_salon and user_id = auth.uid())
         then null else (
      exists(select 1 from salons where id = p_salon and mode_caisse = 'reel')
      or exists(select 1 from tickets where salon_id = p_salon)
      or exists(select 1 from clotures where salon_id = p_salon)
      or exists(select 1 from clotures_mensuelles where salon_id = p_salon)
      or exists(select 1 from clotures_annuelles where salon_id = p_salon)
      or exists(select 1 from factures_clients where salon_id = p_salon)
      or exists(select 1 from archives where salon_id = p_salon)
      or exists(select 1 from nf525_archives_purge where salon_id = p_salon)
      or exists(select 1 from nf525_signatures where salon_id = p_salon)) end;
$function$
;
create policy salon_delete on public.salons for delete to public using (is_admin());
delete from luxyra_versions where version = '6.8.7-s1' and is_current = false;
