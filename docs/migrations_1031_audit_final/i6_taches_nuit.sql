-- 2026-10-31 audit final I6 : une tâche planifiée qui n'a encore jamais tourné n'est plus signalée « manquée »
CREATE OR REPLACE FUNCTION public.admin_taches_nuit()
 RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public', 'pg_temp'
AS $function$
declare v jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(x order by x->>'nom'), '[]'::jsonb) into v from (
    select jsonb_build_object(
      'nom', j.jobname, 'horaire', j.schedule, 'active', j.active,
      'derniere', (select max(d.start_time) from cron.job_run_details d where d.jobid = j.jobid),
      'dernier_statut', (select d.status from cron.job_run_details d where d.jobid = j.jobid order by d.start_time desc limit 1),
      'dernier_succes', (select max(d.end_time) from cron.job_run_details d where d.jobid = j.jobid and d.status = 'succeeded'),
      'echecs_24h', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status in ('failed','canceled') and d.start_time > now() - interval '24 hours'),
      'echecs_7j', (select count(*) from cron.job_run_details d where d.jobid = j.jobid and d.status in ('failed','canceled') and d.start_time > now() - interval '7 days'),
      'message', (select left(d.return_message, 300) from cron.job_run_details d where d.jobid = j.jobid and d.status in ('failed','canceled') order by d.start_time desc limit 1),
      'jamais_lancee', not exists (select 1 from cron.job_run_details d where d.jobid = j.jobid)
        and j.jobid >= coalesce((select max(d.jobid) from cron.job_run_details d where d.start_time < now() - interval '26 hours'), 0),
      -- « nouvelle » = jamais lancée ET créée après les tâches déjà actives il y a plus de 26 h (jobid croissant) ;
      -- une ancienne tâche morte depuis plus de 7 jours (historique purgé) reste bien signalée « manquée ».
      'manquee', j.active
        and (exists (select 1 from cron.job_run_details d where d.jobid = j.jobid)
             or j.jobid < coalesce((select max(d.jobid) from cron.job_run_details d where d.start_time < now() - interval '26 hours'), 0))
        and not exists (select 1 from cron.job_run_details d where d.jobid = j.jobid and d.start_time > now() - interval '26 hours')
    ) x
    from cron.job j
    where j.schedule ~ '^[0-9,]+ [0-9,\-]+ \* \* \*$'
  ) t;
  return jsonb_build_object('taches', v,
    'ok', not exists (select 1 from jsonb_array_elements(v) e where (e->>'echecs_24h')::int > 0 or (e->>'manquee')::boolean),
    'genere_le', now());
end $function$;
