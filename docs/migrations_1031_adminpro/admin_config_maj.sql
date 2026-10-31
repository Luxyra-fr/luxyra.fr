-- 2026-10-31 — Panneau admin « pro » (I7 / I12)
-- Écriture ATOMIQUE de clés de app_config.config (id = 1) : seules les clés passées sont modifiées,
-- tout le reste est conservé (plus de « relire puis réécrire tout l'objet » côté navigateur,
-- qui pouvait effacer la configuration si la relecture échouait).
-- Réservé à l'administrateur (is_admin() = session 2FA). Renvoie les anciennes valeurs des clés modifiées.
drop function if exists public.admin_config_maj(jsonb);
create or replace function public.admin_config_maj(p_cles jsonb, p_auteur text default 'admin')
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_avant jsonb; v_old jsonb; k text;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  if p_cles is null or jsonb_typeof(p_cles) <> 'object' or p_cles = '{}'::jsonb then
    raise exception 'Aucune clé à enregistrer' using errcode = '22023';
  end if;
  select config into v_old from public.app_config where id = 1 for update;
  if not found then raise exception 'Configuration introuvable (app_config id 1)' using errcode = 'P0002'; end if;
  v_old := coalesce(v_old, '{}'::jsonb);
  v_avant := '{}'::jsonb;
  for k in select jsonb_object_keys(p_cles) loop
    v_avant := v_avant || jsonb_build_object(k, v_old -> k);
  end loop;
  update public.app_config set config = v_old || p_cles, updated_at = now(), updated_by = left(coalesce(nullif(p_auteur, ''), 'admin'), 80) where id = 1;
  return jsonb_build_object('avant', v_avant, 'apres', p_cles);
end $$;
revoke all on function public.admin_config_maj(jsonb, text) from public, anon;
grant execute on function public.admin_config_maj(jsonb, text) to authenticated;
