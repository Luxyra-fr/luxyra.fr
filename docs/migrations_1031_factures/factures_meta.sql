-- Luxyra — 31/10/2026 — Factures d'abonnement Luxyra (factures_luxyra) : identité du client et du vendeur FIGÉES à
-- l'émission + suivi de l'envoi par e-mail. factures_luxyra est inaltérable (trg_factures_luxyra_inalterable) :
-- ces informations vont dans une table annexe, une ligne par facture, écrite par le worker (rôle service) seulement.
-- Hors périmètre fiscal NF525 des établissements (ce sont les factures de Luxyra à ses abonnés).
create table if not exists lx_prive.factures_luxyra_meta (
  facture_id   uuid primary key references public.factures_luxyra(id) on delete restrict,
  client       jsonb not null,          -- dénomination, nom légal, adresse, SIREN/SIRET, TVA intracom., e-mail (au jour de la facture)
  vendeur      jsonb not null,          -- identité Luxyra au jour de la facture
  cree_le      timestamptz not null default now(),
  envoye_le    timestamptz,
  envoi_ref    text
);
revoke all on lx_prive.factures_luxyra_meta from public, anon, authenticated;
grant select, insert, update on lx_prive.factures_luxyra_meta to service_role;
-- le client et le vendeur ne changent jamais après création (seuls envoye_le / envoi_ref évoluent)
create or replace function lx_prive.factures_luxyra_meta_fige() returns trigger language plpgsql set search_path = pg_catalog as $f$
begin
  if tg_op = 'DELETE' then raise exception 'factures_luxyra_meta : suppression interdite'; end if;
  if new.client is distinct from old.client or new.vendeur is distinct from old.vendeur or new.facture_id is distinct from old.facture_id
     or new.cree_le is distinct from old.cree_le then
    raise exception 'factures_luxyra_meta : identité figée à l''émission';
  end if;
  return new;
end $f$;
drop trigger if exists trg_factures_luxyra_meta_fige on lx_prive.factures_luxyra_meta;
create trigger trg_factures_luxyra_meta_fige before update or delete on lx_prive.factures_luxyra_meta
  for each row execute function lx_prive.factures_luxyra_meta_fige();
-- accès REST pour le worker (schéma lx_prive non exposé) : deux fonctions SECURITY DEFINER réservées au rôle service
create or replace function public.lx_facture_luxyra_meta_lire(p_facture uuid) returns jsonb
language sql stable security definer set search_path = public, lx_prive, pg_temp as $f$
  select to_jsonb(m) from lx_prive.factures_luxyra_meta m where m.facture_id = p_facture
$f$;
create or replace function public.lx_facture_luxyra_meta_poser(p_facture uuid, p_client jsonb, p_vendeur jsonb) returns jsonb
language plpgsql security definer set search_path = public, lx_prive, pg_temp as $f$
begin
  insert into lx_prive.factures_luxyra_meta(facture_id, client, vendeur) values (p_facture, p_client, p_vendeur)
  on conflict (facture_id) do nothing;
  return (select to_jsonb(m) from lx_prive.factures_luxyra_meta m where m.facture_id = p_facture);
end $f$;
create or replace function public.lx_facture_luxyra_envoi_marquer(p_facture uuid, p_ref text) returns boolean
language sql security definer set search_path = public, lx_prive, pg_temp as $f$
  update lx_prive.factures_luxyra_meta set envoye_le = now(), envoi_ref = left(p_ref, 200)
   where facture_id = p_facture and envoye_le is null returning true
$f$;
create or replace function public.lx_facture_luxyra_envoi_liberer(p_facture uuid, p_ref text) returns boolean
language sql security definer set search_path = public, lx_prive, pg_temp as $f$
  -- échec d'envoi : la réservation est libérée (p_ref = null) ou complétée (p_ref = identifiant Brevo)
  update lx_prive.factures_luxyra_meta set envoye_le = case when p_ref is null then null else envoye_le end,
         envoi_ref = case when p_ref is null then null else left(p_ref, 200) end
   where facture_id = p_facture and envoye_le is not null returning true
$f$;
revoke all on function public.lx_facture_luxyra_envoi_liberer(uuid, text) from public, anon, authenticated;
grant execute on function public.lx_facture_luxyra_envoi_liberer(uuid, text) to service_role;
revoke all on function public.lx_facture_luxyra_meta_lire(uuid), public.lx_facture_luxyra_meta_poser(uuid, jsonb, jsonb),
  public.lx_facture_luxyra_envoi_marquer(uuid, text) from public, anon, authenticated;
grant execute on function public.lx_facture_luxyra_meta_lire(uuid), public.lx_facture_luxyra_meta_poser(uuid, jsonb, jsonb),
  public.lx_facture_luxyra_envoi_marquer(uuid, text) to service_role;
-- Reprise : identité figée pour les factures déjà émises (au jour de la mise en service ; une seule à ce jour, LUX-2026-0001)
insert into lx_prive.factures_luxyra_meta(facture_id, client, vendeur)
select f.id,
  jsonb_build_object(
    'denomination', coalesce(s.nom,''),
    'nom_legal', case when coalesce(s.gerant_prenom,'')||coalesce(s.gerant_nom,'') = '' then ''
                      else trim(coalesce(s.gerant_prenom,'')||' '||upper(coalesce(s.gerant_nom,'')))
                           || case when coalesce(s.forme_juridique,'') ~* 'entrepreneur individuel|entreprise individuelle|micro' then ' EI' else '' end end,
    'forme', coalesce(s.forme_juridique,''), 'adresse', coalesce(s.adresse,''), 'cp', coalesce(s.cp,''), 'ville', coalesce(s.ville,''),
    'siret', regexp_replace(coalesce(s.siret,''),'\D','','g'),
    'siren', coalesce(nullif(regexp_replace(coalesce(s.siren,''),'\D','','g'),''), left(regexp_replace(coalesce(s.siret,''),'\D','','g'),9)),
    'tva_intra', coalesce(nullif(s.tva_intra,''), s.tva, ''), 'email', coalesce(s.email,'')),
  jsonb_build_object('nom','Alexandre JENSEN','ei',true,'marque','Luxyra',
    'forme', coalesce(c.config->>'luxyra_forme_juridique','Entreprise individuelle (micro-entrepreneur)'),
    'adresse', coalesce(c.config->>'luxyra_adresse','29 rue de l''Abbé Alexandre Pax, 57200 Sarreguemines'),
    'siret', coalesce(c.config->>'luxyra_siret_editeur','91092846400023'),
    'tva_intra', coalesce(c.config->>'luxyra_tva_intra',''), 'tva_pct', coalesce((c.config->>'luxyra_tva_pct')::numeric,0),
    'email','contact@luxyra.fr','site','luxyra.fr')
from public.factures_luxyra f join public.salons s on s.id = f.salon_id cross join (select config from public.app_config where id = 1) c
on conflict (facture_id) do nothing;
