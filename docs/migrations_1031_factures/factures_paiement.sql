-- Luxyra — 31/10/2026 — Factures d'abonnement : moyen de paiement figé (marque + 4 derniers chiffres de la carte, référence du paiement Stripe).
-- Posé une seule fois, à la création de l'identité figée de la facture (jamais modifiable ensuite). Aucun numéro de carte complet.
-- Les factures déjà émises (LUX-2026-0001) ne sont pas modifiées.
alter table lx_prive.factures_luxyra_meta add column if not exists paiement jsonb;
create or replace function lx_prive.factures_luxyra_meta_fige() returns trigger language plpgsql set search_path = pg_catalog as $f$
begin
  if tg_op = 'DELETE' then raise exception 'factures_luxyra_meta : suppression interdite'; end if;
  if new.client is distinct from old.client or new.vendeur is distinct from old.vendeur or new.facture_id is distinct from old.facture_id
     or new.cree_le is distinct from old.cree_le or new.paiement is distinct from old.paiement then
    raise exception 'factures_luxyra_meta : identité figée à l''émission';
  end if;
  return new;
end $f$;
create or replace function public.lx_facture_luxyra_meta_poser(p_facture uuid, p_client jsonb, p_vendeur jsonb, p_paiement jsonb) returns jsonb
language plpgsql security definer set search_path = public, lx_prive, pg_temp as $f$
begin
  insert into lx_prive.factures_luxyra_meta(facture_id, client, vendeur, paiement) values (p_facture, p_client, p_vendeur, p_paiement)
  on conflict (facture_id) do nothing;
  return (select to_jsonb(m) from lx_prive.factures_luxyra_meta m where m.facture_id = p_facture);
end $f$;
revoke all on function public.lx_facture_luxyra_meta_poser(uuid, jsonb, jsonb, jsonb) from public, anon, authenticated;
grant execute on function public.lx_facture_luxyra_meta_poser(uuid, jsonb, jsonb, jsonb) to service_role;
