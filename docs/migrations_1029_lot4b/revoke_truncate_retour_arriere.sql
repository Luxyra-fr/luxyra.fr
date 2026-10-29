-- =====================================================================================================================
-- 2026-10-29 (-9) — RETOUR ARRIÈRE de revoke_truncate.sql (déconseillé : ces droits ne servent à rien et ouvrent TRUNCATE hors RLS).
-- Ré-accorde EXACTEMENT les droits TRUNCATE / TRIGGER / REFERENCES relevés avant le retrait (lx_prive.privileges_avant_lot4b), sur les
-- relations qui existent encore, et rétablit les privilèges par défaut de postgres dans public (arwdDxtm pour anon / authenticated).
-- La réserve 4 du lot 4 (factures_clients : TRUNCATE déjà retiré le 29/10 à 05:36 UTC) n'est PAS annulée : ce droit n'était plus dans
-- le relevé. Idempotent.
-- =====================================================================================================================
do $$
declare x record;
begin
  if to_regclass('lx_prive.privileges_avant_lot4b') is null then
    raise exception 'RETOUR ARRIÈRE LOT 4b TRUNCATE : relevé lx_prive.privileges_avant_lot4b absent — rien à rétablir';
  end if;
  for x in select a.relation, a.role, a.privilege from lx_prive.privileges_avant_lot4b a where to_regclass(a.relation) is not null order by 1, 2, 3 loop
    execute format('grant %s on table %s to %I', x.privilege, x.relation, x.role);
  end loop;
end $$;
alter default privileges for role postgres in schema public grant truncate, trigger, references on tables to anon, authenticated;
-- contrôle : le nombre de droits rétablis = relevé (les relations supprimées depuis exceptées)
select json_build_object(
  'releve', (select count(*) from lx_prive.privileges_avant_lot4b where to_regclass(relation) is not null),
  'retablis', (select count(*) from lx_prive.privileges_avant_lot4b a where to_regclass(a.relation) is not null and has_table_privilege(a.role, a.relation, a.privilege)))::text;
-- (le relevé est conservé : il documente l'état d'avant ; le supprimer à la main seulement après décision)
