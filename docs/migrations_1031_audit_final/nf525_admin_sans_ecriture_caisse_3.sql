-- 2026-10-31 — Droits de l'éditeur, lot 3 (contre-audit NF525 n°2). Validé par Alexandre.
-- Nature : CONTRÔLE D'ACCÈS et TRAÇABILITÉ uniquement. Aucun format d'empreinte, chaînage, signature,
-- numérotation ni JET existant modifié (codes JET réutilisés : 410 CONFIG_IDENTITE, 270 CONFIG_TVA).
-- Rejouable : chaque remplacement est sauté s'il est déjà appliqué. Retour arrière : *_avant_3.sql.
--
-- md5(pg_get_functiondef) AVANT :
--   lx_prive.salons_identite_trace        c87d2f71808c0bd2b7fbfd64dd62333b
--   public.salon_a_historique_fiscal      e47fb8efa6c703bb97de9b02e358cd1d
--   public.admin_salon_cfg_migration      81dc077baacd1b332967a74958ae193b
--   public.factory_reset_salon            f8a7df037a4c30e64d33b5fa2c6a67d3
--   public.reset_ventes_test_salon        6e5a2046f092147d9388c0f7b7734a63
-- md5 APRÈS : voir docs/registre-interventions-nf525.md (entrée « lot 3 »).

-- Remplacement ciblé, contrôlé, rejouable
create or replace function pg_temp.lx_remplacer(p_fn regprocedure, p_avant text, p_apres text)
returns void language plpgsql as $$
declare d text := pg_get_functiondef(p_fn);
begin
  if position(p_apres in d) > 0 then return; end if;            -- déjà appliqué
  if position(p_avant in d) = 0 then raise exception 'motif introuvable dans %', p_fn; end if;
  execute replace(d, p_avant, p_apres);
end $$;

-- 1. JET 410 : la ligne JET doit exister, sinon modification refusée ; propriétaire = OLD.user_id
select pg_temp.lx_remplacer('lx_prive.salons_identite_trace()'::regprocedure,
  'declare v_ch text[] := ''{}''; v_auteur text;',
  'declare v_ch text[] := ''{}''; v_auteur text; v_aid bigint;');
select pg_temp.lx_remplacer('lx_prive.salons_identite_trace()'::regprocedure,
  'if auth.uid() is not null and auth.uid() = NEW.user_id then return NEW; end if;',
  'if auth.uid() is not null and auth.uid() = OLD.user_id then return NEW; end if;');
select pg_temp.lx_remplacer('lx_prive.salons_identite_trace()'::regprocedure,
  'values (NEW.id, ''CONFIG_IDENTITE'', left(''Modifié côté serveur : '' || array_to_string(v_ch, '' ; ''), 900), v_auteur);
  return NEW;',
  'values (NEW.id, ''CONFIG_IDENTITE'', left(''Modifié côté serveur : '' || array_to_string(v_ch, '' ; ''), 900), v_auteur)
  returning id into v_aid;
  -- 2026-10-31 lot 3 : sans ligne JET correspondante, la modification est refusée (trg_audit_vers_jet ne fait qu''avertir)
  if not exists (select 1 from nf525_jet j where j.source_audit_id = v_aid) then
    raise exception ''Trace JET 410 impossible : modification des données d''''identification refusée'' using errcode = ''P0001'';
  end if;
  return NEW;');

-- 2. Historique fiscal : les signatures des lignes JET d'installation ne comptent pas (les JET fiscaux sont couverts par la liste de codes)
select pg_temp.lx_remplacer('public.salon_a_historique_fiscal(uuid)'::regprocedure,
  'or exists(select 1 from nf525_signatures where salon_id = p_salon)',
  'or exists(select 1 from nf525_signatures where salon_id = p_salon and source_table <> ''nf525_jet'')');

-- 3a. Paramètres TVA modifiés par un autre que le propriétaire -> JET 270 (CONFIG_TVA), refus si la trace échoue
create or replace function lx_prive.salons_tva_trace()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
-- 2026-10-31 lot 3 : trace serveur (JET 270) des paramètres de TVA changés par un autre que le propriétaire
-- (le propriétaire est tracé par l'application : CONFIG_TVA). Refus si la ligne JET n'est pas créée.
declare v_ch text[] := '{}'; v_auteur text; v_aid bigint;
begin
  if auth.uid() is not null and auth.uid() = OLD.user_id then return NEW; end if;
  if NEW.taux_tva is distinct from OLD.taux_tva then v_ch := v_ch || ('taux_tva : ' || coalesce(OLD.taux_tva::text,'∅') || ' → ' || coalesce(NEW.taux_tva::text,'∅')); end if;
  if NEW.taux_tva_produits is distinct from OLD.taux_tva_produits then v_ch := v_ch || ('taux_tva_produits : ' || coalesce(OLD.taux_tva_produits::text,'∅') || ' → ' || coalesce(NEW.taux_tva_produits::text,'∅')); end if;
  if NEW.show_tva_ticket is distinct from OLD.show_tva_ticket then v_ch := v_ch || ('show_tva_ticket : ' || coalesce(OLD.show_tva_ticket::text,'∅') || ' → ' || coalesce(NEW.show_tva_ticket::text,'∅')); end if;
  if array_length(v_ch, 1) is null then return NEW; end if;
  v_auteur := coalesce((select email from auth.users where id = auth.uid()), 'système (serveur)')
              || case when public.is_admin() then ' (éditeur Luxyra)' else '' end;
  insert into audit_log (salon_id, action, details, operator_name)
  values (NEW.id, 'CONFIG_TVA', left('Modifié côté serveur : ' || array_to_string(v_ch, ' ; '), 900), v_auteur)
  returning id into v_aid;
  if not exists (select 1 from nf525_jet j where j.source_audit_id = v_aid) then
    raise exception 'Trace JET 270 impossible : modification des paramètres de TVA refusée' using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_salons_tva_trace on public.salons;
create trigger trg_salons_tva_trace after update of taux_tva, taux_tva_produits, show_tva_ticket on public.salons
  for each row execute function lx_prive.salons_tva_trace();

-- 3b. config_json (contient caisse_data, TVA, mentions du ticket) : un compte connecté autre que le propriétaire
-- ne peut plus le modifier, sauf par la fonction dédiée admin_salon_cfg_migration (clés migration* seulement, drapeau local).
-- Les traitements serveur (rôle service, cron : auth.uid() nul) et le propriétaire ne sont pas concernés.
create or replace function lx_prive.salons_config_garde_editeur()
returns trigger language plpgsql set search_path to 'pg_catalog', 'public' as $$
begin
  if NEW.config_json is not distinct from OLD.config_json then return NEW; end if;
  if auth.uid() is null or auth.uid() = OLD.user_id then return NEW; end if;
  if coalesce(current_setting('luxyra.cfg_migration', true), '') = '1' then return NEW; end if;
  raise exception 'La configuration de caisse d''un établissement ne peut être modifiée que par l''établissement lui-même' using errcode = '42501';
end $$;
drop trigger if exists trg_salons_config_garde_editeur on public.salons;
create trigger trg_salons_config_garde_editeur before update of config_json on public.salons
  for each row execute function lx_prive.salons_config_garde_editeur();

select pg_temp.lx_remplacer('public.admin_salon_cfg_migration(uuid,text)'::regprocedure,
  '  update public.salons
     set config_json = case when v_chaine then to_jsonb(v_cfg::text) else v_cfg end
   where id = p_salon_id;',
  '  perform set_config(''luxyra.cfg_migration'', ''1'', true);  -- 2026-10-31 lot 3 : seul chemin éditeur autorisé (clés migration*)
  update public.salons
     set config_json = case when v_chaine then to_jsonb(v_cfg::text) else v_cfg end
   where id = p_salon_id;
  perform set_config(''luxyra.cfg_migration'', '''', true);');

-- 4. Jamais un compte administrateur propriétaire d'un établissement (création comme changement)
create or replace function lx_prive.salons_proprietaire_non_admin()
returns trigger language plpgsql security definer set search_path to 'pg_catalog', 'public' as $$
begin
  if NEW.user_id is null then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.user_id is not distinct from OLD.user_id then return NEW; end if;
  if exists (select 1 from public.admin_users a where a.user_id = NEW.user_id)
     or exists (select 1 from auth.users u where u.id = NEW.user_id and lower(u.email) = 'support@luxyra.fr') then
    raise exception 'Un compte administrateur Luxyra ne peut pas être propriétaire d''un établissement' using errcode = '42501';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_salons_proprietaire_non_admin on public.salons;
create trigger trg_salons_proprietaire_non_admin before insert or update of user_id on public.salons
  for each row execute function lx_prive.salons_proprietaire_non_admin();

-- Mineurs : messages de refus des réinitialisations (texte seulement)
select pg_temp.lx_remplacer('public.factory_reset_salon(uuid)'::regprocedure,
  'réinitialisation autorisée uniquement pour le propriétaire du salon ou un administrateur.',
  'réinitialisation autorisée uniquement pour le propriétaire de l''''établissement.');
select pg_temp.lx_remplacer('public.reset_ventes_test_salon(uuid)'::regprocedure,
  'réinitialisation autorisée uniquement pour le propriétaire du salon ou un administrateur.',
  'réinitialisation autorisée uniquement pour le propriétaire de l''''établissement.');
