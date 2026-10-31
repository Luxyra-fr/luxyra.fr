-- 2026-10-31 — Droits de l'éditeur, lot 2 (validé par Alexandre : « ça doit être conforme et passer l'audit NF525 »)
-- Suite du contre-audit du commit 696ecd2. Nature : CONTRÔLE D'ACCÈS et TRAÇABILITÉ uniquement.
-- Aucun calcul, format d'empreinte, chaînage, signature, numérotation ni ligne JET existante modifié.
-- Rejouable. Retour arrière : nf525_admin_sans_ecriture_caisse_avant_2.sql
--
-- I1  factory_reset_salon / reset_ventes_test_salon : plus de passe-droit « OR public.is_caller_admin() »
--     (alias de is_admin()). Restent : propriétaire de l'établissement, rôle service (edge salon-factory-reset,
--     qui vérifie elle-même le propriétaire et l'essai réinitialisable).
--     md5 avant : factory_reset_salon 0a440c07506617601a9cd883e95424c5 ; reset_ventes_test_salon 04d5b5279d61429c4e36c4fe65d6473a
-- I2  Données d'identification de l'assujetti (nom, adresse, CP, ville, SIRET, SIREN, n° TVA, forme juridique,
--     RCS, capital) modifiées par quelqu'un d'AUTRE que le propriétaire (éditeur/admin, rôle service, traitement
--     automatique) : trace serveur obligatoire au JET (événement 410 CONFIG_IDENTITE, ancienne -> nouvelle valeur,
--     auteur) via audit_log -> trg_audit_vers_jet (mécanisme existant, déjà utilisé par l'application pour le
--     propriétaire et par salons_exercice_trace pour l'exercice). Échec de la trace = modification refusée.
-- M1  salon_a_historique_fiscal : couvre aussi bons (mouvements), clôtures d'exercice, corrections de règlement,
--     duplicatas, archives signées, forçages et annotations de Z, passage en réel daté, et JET d'opérations
--     fiscales (20,30,50,60,155,190,420,901). Les JET d'installation d'un essai (80,100,126,250,450…) ne bloquent pas.
--     md5 avant : e4abb6b69dd406bcf842694270a76339
-- M2  Politique salons.salon_delete (is_admin) supprimée : aucune suppression directe d'établissement ;
--     seule voie = admin_delete_salon_cascade (SECURITY DEFINER, refuse tout historique fiscal) ou purge à 6 ans.

-- ---------- I1 ----------
do $$
declare d text;
begin
  d := pg_get_functiondef('public.factory_reset_salon(uuid)'::regprocedure);
  if position('OR public.is_caller_admin()' in d) > 0 then
    execute replace(d, E'        EXISTS (SELECT 1 FROM salons s WHERE s.id = p_salon_id AND s.user_id = auth.uid())\n        OR public.is_caller_admin()\n',
                       E'        EXISTS (SELECT 1 FROM salons s WHERE s.id = p_salon_id AND s.user_id = auth.uid())\n');
    if position('is_caller_admin' in pg_get_functiondef('public.factory_reset_salon(uuid)'::regprocedure)) > 0 then
      raise exception 'factory_reset_salon : motif introuvable, rien changé';
    end if;
  end if;
  d := pg_get_functiondef('public.reset_ventes_test_salon(uuid)'::regprocedure);
  if position('or public.is_caller_admin()' in d) > 0 then
    execute replace(d, 'and s.user_id = auth.uid()) or public.is_caller_admin()) then', 'and s.user_id = auth.uid())) then');
    if position('is_caller_admin' in pg_get_functiondef('public.reset_ventes_test_salon(uuid)'::regprocedure)) > 0 then
      raise exception 'reset_ventes_test_salon : motif introuvable, rien changé';
    end if;
  end if;
end $$;

-- ---------- I2 ----------
create or replace function lx_prive.salons_identite_trace()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp'
as $function$
-- 2026-10-31 : trace serveur (JET 410) des changements d'identification faits par un autre que le propriétaire.
-- Le propriétaire est tracé par l'application (saveSalonInfo -> CONFIG_IDENTITE), on n'en fait pas un doublon.
declare v_ch text[] := '{}'; v_auteur text;
begin
  if auth.uid() is not null and auth.uid() = NEW.user_id then return NEW; end if;
  if NEW.nom is distinct from OLD.nom then v_ch := v_ch || ('nom : « ' || coalesce(OLD.nom,'') || ' » → « ' || coalesce(NEW.nom,'') || ' »'); end if;
  if NEW.adresse is distinct from OLD.adresse then v_ch := v_ch || ('adresse : « ' || coalesce(OLD.adresse,'') || ' » → « ' || coalesce(NEW.adresse,'') || ' »'); end if;
  if NEW.cp is distinct from OLD.cp then v_ch := v_ch || ('cp : « ' || coalesce(OLD.cp,'') || ' » → « ' || coalesce(NEW.cp,'') || ' »'); end if;
  if NEW.ville is distinct from OLD.ville then v_ch := v_ch || ('ville : « ' || coalesce(OLD.ville,'') || ' » → « ' || coalesce(NEW.ville,'') || ' »'); end if;
  if NEW.siret is distinct from OLD.siret then v_ch := v_ch || ('siret : « ' || coalesce(OLD.siret,'') || ' » → « ' || coalesce(NEW.siret,'') || ' »'); end if;
  if NEW.siren is distinct from OLD.siren then v_ch := v_ch || ('siren : « ' || coalesce(OLD.siren,'') || ' » → « ' || coalesce(NEW.siren,'') || ' »'); end if;
  if NEW.tva is distinct from OLD.tva then v_ch := v_ch || ('tva : « ' || coalesce(OLD.tva,'') || ' » → « ' || coalesce(NEW.tva,'') || ' »'); end if;
  if NEW.tva_intra is distinct from OLD.tva_intra then v_ch := v_ch || ('tva_intra : « ' || coalesce(OLD.tva_intra,'') || ' » → « ' || coalesce(NEW.tva_intra,'') || ' »'); end if;
  if NEW.forme_juridique is distinct from OLD.forme_juridique then v_ch := v_ch || ('forme_juridique : « ' || coalesce(OLD.forme_juridique,'') || ' » → « ' || coalesce(NEW.forme_juridique,'') || ' »'); end if;
  if NEW.rcs_ville is distinct from OLD.rcs_ville then v_ch := v_ch || ('rcs : « ' || coalesce(OLD.rcs_ville,'') || ' » → « ' || coalesce(NEW.rcs_ville,'') || ' »'); end if;
  if NEW.capital_social is distinct from OLD.capital_social then v_ch := v_ch || ('capital : « ' || coalesce(OLD.capital_social::text,'') || ' » → « ' || coalesce(NEW.capital_social::text,'') || ' »'); end if;
  if array_length(v_ch, 1) is null then return NEW; end if;
  v_auteur := coalesce((select email from auth.users where id = auth.uid()), 'système (serveur)')
              || case when public.is_admin() then ' (éditeur Luxyra)' else '' end;
  insert into audit_log (salon_id, action, details, operator_name)
  values (NEW.id, 'CONFIG_IDENTITE', left('Modifié côté serveur : ' || array_to_string(v_ch, ' ; '), 900), v_auteur);
  return NEW;
end $function$;
revoke all on function lx_prive.salons_identite_trace() from public, anon, authenticated;
drop trigger if exists trg_salons_identite_trace on public.salons;
create trigger trg_salons_identite_trace after update of nom, adresse, cp, ville, siret, siren, tva, tva_intra, forme_juridique, rcs_ville, capital_social
  on public.salons for each row execute function lx_prive.salons_identite_trace();

-- ---------- M1 ----------
create or replace function public.salon_a_historique_fiscal(p_salon uuid)
 returns boolean language sql stable security definer set search_path to 'public', 'pg_temp'
as $function$
  select case when coalesce((select auth.role()), '') in ('authenticated','anon')
               and not public.is_admin()
               and not exists (select 1 from salons where id = p_salon and user_id = auth.uid())
         then null else (
      exists(select 1 from salons where id = p_salon and (mode_caisse = 'reel' or mode_reel_depuis is not null))
      or exists(select 1 from tickets where salon_id = p_salon)
      or exists(select 1 from clotures where salon_id = p_salon)
      or exists(select 1 from clotures_mensuelles where salon_id = p_salon)
      or exists(select 1 from clotures_annuelles where salon_id = p_salon)
      or exists(select 1 from clotures_exercices where salon_id = p_salon)
      or exists(select 1 from clotures_forcages where salon_id = p_salon)
      or exists(select 1 from clotures_annotations where salon_id = p_salon)
      or exists(select 1 from corrections_reglement where salon_id = p_salon)
      or exists(select 1 from factures_clients where salon_id = p_salon)
      or exists(select 1 from cartes_cadeaux_mouvements where salon_id = p_salon)
      or exists(select 1 from archives where salon_id = p_salon)
      or exists(select 1 from nf525_archives_purge where salon_id = p_salon)
      or exists(select 1 from nf525_archives_signees where salon_id = p_salon)
      or exists(select 1 from nf525_duplicatas where salon_id = p_salon)
      or exists(select 1 from nf525_signatures where salon_id = p_salon)
      or exists(select 1 from nf525_jet where salon_id = p_salon and code in (20,30,50,60,155,190,420,901))) end;
$function$;

-- ---------- M2 ----------
drop policy if exists salon_delete on public.salons;

-- ---------- M3 : repère de révision serveur consultable (n'altère pas la version courante) ----------
insert into luxyra_versions(version, released_at, notes, is_current)
select '6.8.7-s1', now(), 'Révision serveur de la 6.8.7 (31/10/2026), sans changement de l''application ni des fonctions d''inaltérabilité, de sécurisation, de conservation ou d''archivage (BOI-TVA-DECLA-30-10-30 § 340, version mineure) : retrait des droits d''écriture de caisse de l''éditeur (avoir, bons, forfaits, clôtures mois/année/exercice, archive annuelle, factures, capture d''empreinte, réinitialisations d''essai), trace JET 410 des changements d''identification faits par un autre que le propriétaire, garde « historique fiscal » élargie, export NF525 complet. Détail : docs/registre-interventions-nf525.md et docs/dossier-attestation-version-mineure-6.8.7-s1.md.', false
where not exists (select 1 from luxyra_versions where version='6.8.7-s1');

-- md5 APRÈS (31/10/2026) : factory_reset_salon f8a7df037a4c30e64d33b5fa2c6a67d3 ; reset_ventes_test_salon 6e5a2046f092147d9388c0f7b7734a63 ;
-- salon_a_historique_fiscal e47fb8efa6c703bb97de9b02e358cd1d ; lx_prive.salons_identite_trace c87d2f71808c0bd2b7fbfd64dd62333b
