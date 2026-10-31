-- 2026-10-31 audit final F5 : durée maximale de session admin contrôlée côté SERVEUR (12 h depuis la connexion).
-- is_admin() exige en plus que la session du jeton (claim session_id) existe encore dans auth.sessions,
-- appartienne au compte support et ait moins de 12 h. Une session fermée (« Se déconnecter partout »)
-- ou trop ancienne ne donne plus aucun droit admin, même avec un jeton encore valide.
-- Sans effet sur cron / service_role / établissements : auth.uid() n'y est pas le compte support → false comme avant.
CREATE OR REPLACE FUNCTION public.is_admin()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select exists (select 1 from auth.users where id = auth.uid() and email = 'support@luxyra.fr')
     and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (select 1 from auth.sessions s
                  where s.id::text = coalesce(auth.jwt() ->> 'session_id', '')
                    and s.user_id = auth.uid()
                    and s.created_at > now() - interval '12 hours');
$function$;

-- Temps restant de la session admin (pour que l'admin se déconnecte proprement et prévienne).
-- Ne donne aucun droit : renvoie null pour tout autre compte.
CREATE OR REPLACE FUNCTION public.admin_session_restante()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select case when not exists (select 1 from auth.users where id = auth.uid() and email = 'support@luxyra.fr') then null
    else jsonb_build_object(
      'secondes', coalesce((select greatest(0, extract(epoch from (s.created_at + interval '12 hours' - now())))::int
                              from auth.sessions s
                             where s.id::text = coalesce(auth.jwt() ->> 'session_id', '') and s.user_id = auth.uid()), 0),
      'duree_max_h', 12) end;
$function$;
revoke all on function public.admin_session_restante() from public, anon;
grant execute on function public.admin_session_restante() to authenticated;
