-- 2026-10-31 — Panneau admin « pro » (I12)
-- Statut de migration d'un établissement : modifie UNIQUEMENT les clés migration* de salons.config_json,
-- de façon atomique (verrou de ligne), sans relire/réécrire tout l'objet depuis le navigateur.
-- Avant : l'admin relisait config_json puis réécrivait tout -> une modification faite au même moment dans
-- l'app de l'établissement pouvait être écrasée. Le format de stockage est conservé (chaîne JSON encodée,
-- comme l'écrit l'app ; un objet JSON est aussi accepté et gardé tel quel). config_version est incrémenté
-- par le déclencheur existant (trg_salons_config_version), l'app détecte donc le changement.
-- p_statut : 'requested' | 'completed' | null (= retire les clés migration*).
create or replace function public.admin_salon_cfg_migration(p_salon_id uuid, p_statut text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_raw jsonb; v_cfg jsonb; v_chaine boolean;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  if p_statut is not null and p_statut not in ('requested','completed') then
    raise exception 'Statut de migration invalide' using errcode = '22023';
  end if;
  select config_json into v_raw from public.salons where id = p_salon_id for update;
  if not found then return jsonb_build_object('ok', true, 'note', 'établissement introuvable'); end if;
  v_chaine := jsonb_typeof(v_raw) = 'string';
  begin
    v_cfg := case when v_raw is null then '{}'::jsonb
                  when v_chaine then (v_raw #>> '{}')::jsonb
                  else v_raw end;
    if jsonb_typeof(v_cfg) = 'string' then v_cfg := (v_cfg #>> '{}')::jsonb; end if;
  exception when others then
    raise exception 'Configuration de l''établissement illisible : rien n''a été modifié' using errcode = '22P02';
  end;
  if v_cfg is null or jsonb_typeof(v_cfg) <> 'object' then
    if v_raw is null then v_cfg := '{}'::jsonb; v_chaine := true;
    else raise exception 'Configuration de l''établissement illisible : rien n''a été modifié' using errcode = '22P02'; end if;
  end if;
  if p_statut is null then
    v_cfg := v_cfg - 'migrationStatus' - 'migrationRequestedAt' - 'migrationRequestId' - 'migrationCompletedAt';
  else
    v_cfg := v_cfg || jsonb_build_object('migrationStatus', p_statut);
    if p_statut = 'completed' then
      v_cfg := v_cfg || jsonb_build_object('migrationCompletedAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
    end if;
  end if;
  update public.salons
     set config_json = case when v_chaine then to_jsonb(v_cfg::text) else v_cfg end
   where id = p_salon_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.admin_salon_cfg_migration(uuid, text) from public, anon;
grant execute on function public.admin_salon_cfg_migration(uuid, text) to authenticated;
