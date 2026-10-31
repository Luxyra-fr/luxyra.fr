-- 2026-10-31 — RETOUR ARRIÈRE EXACT du lot 3 (nf525_admin_sans_ecriture_caisse_3.sql).
-- Remplacements inverses : chaque fonction retrouve EXACTEMENT son md5 d'avant (vérifié le 31/10 avant mise en ligne) :
--   lx_prive.salons_identite_trace   c87d2f71808c0bd2b7fbfd64dd62333b
--   public.salon_a_historique_fiscal e47fb8efa6c703bb97de9b02e358cd1d
--   public.admin_salon_cfg_migration 81dc077baacd1b332967a74958ae193b
--   public.factory_reset_salon       f8a7df037a4c30e64d33b5fa2c6a67d3
--   public.reset_ventes_test_salon   6e5a2046f092147d9388c0f7b7734a63
create or replace function pg_temp.lx_inverse(p_fn regprocedure, p_actuel text, p_origine text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_actuel in d) = 0 then return; end if;   -- déjà revenu
  execute replace(d, p_actuel, p_origine);
end $$;

drop trigger if exists trg_salons_tva_trace on public.salons;
drop function if exists lx_prive.salons_tva_trace();
drop trigger if exists trg_salons_config_garde_editeur on public.salons;
drop function if exists lx_prive.salons_config_garde_editeur();
drop trigger if exists trg_salons_proprietaire_non_admin on public.salons;
drop function if exists lx_prive.salons_proprietaire_non_admin();

select pg_temp.lx_inverse('lx_prive.salons_identite_trace()'::regprocedure,
  'declare v_ch text[] := ''{}''; v_auteur text; v_aid bigint;', 'declare v_ch text[] := ''{}''; v_auteur text;');
select pg_temp.lx_inverse('lx_prive.salons_identite_trace()'::regprocedure,
  'auth.uid() = OLD.user_id then return NEW', 'auth.uid() = NEW.user_id then return NEW');
select pg_temp.lx_inverse('lx_prive.salons_identite_trace()'::regprocedure,
  'v_auteur)
  returning id into v_aid;
  -- 2026-10-31 lot 3 : sans ligne JET correspondante, la modification est refusée (trg_audit_vers_jet ne fait qu''avertir)
  if not exists (select 1 from nf525_jet j where j.source_audit_id = v_aid) then
    raise exception ''Trace JET 410 impossible : modification des données d''''identification refusée'' using errcode = ''P0001'';
  end if;
  return NEW;', 'v_auteur);
  return NEW;');
select pg_temp.lx_inverse('public.salon_a_historique_fiscal(uuid)'::regprocedure,
  ' and source_table <> ''nf525_jet'')', ')');
select pg_temp.lx_inverse('public.admin_salon_cfg_migration(uuid,text)'::regprocedure,
  '  perform set_config(''luxyra.cfg_migration'', ''1'', true);  -- 2026-10-31 lot 3 : seul chemin éditeur autorisé (clés migration*)
', '');
select pg_temp.lx_inverse('public.admin_salon_cfg_migration(uuid,text)'::regprocedure,
  '
  perform set_config(''luxyra.cfg_migration'', '''', true);', '');
select pg_temp.lx_inverse('public.factory_reset_salon(uuid)'::regprocedure,
  'propriétaire de l''''établissement.', 'propriétaire du salon ou un administrateur.');
select pg_temp.lx_inverse('public.reset_ventes_test_salon(uuid)'::regprocedure,
  'propriétaire de l''''établissement.', 'propriétaire du salon ou un administrateur.');
