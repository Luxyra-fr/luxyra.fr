-- Luxyra — 2026-10-27 — Alerte Supabase « Disk IO Budget » (offre FREE, machine Nano)
-- Causes mesurées (Query Performance) : scan_pg_net_failures (28,8 %) relisait toute la table net._http_response
-- (35 Mo gonflée, aucun index sur id) ; get_monitoring_status (15,6 %) relisait tout cron.job_run_details (32 000 lignes,
-- 7,4 milliards de lignes lues au total). Correctifs sans effet sur la caisse, NF525, SMS ni rappels.
-- Appliqué via l'éditeur SQL du tableau de bord (MCP indisponible).

-- 1) Scan des échecs pg_net : uniquement les réponses des 2 dernières heures (index sur created)
CREATE OR REPLACE FUNCTION public.scan_pg_net_failures()
 RETURNS TABLE(nb_inserted integer, max_seen_id bigint)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'net'
AS $function$
DECLARE v_last_id bigint; v_max_id bigint; v_inserted int := 0;
BEGIN
  SELECT c.last_id INTO v_last_id FROM public._pg_net_scan_cursor c WHERE c.id = 1;
  SELECT COALESCE(MAX(r.id), v_last_id) INTO v_max_id FROM net._http_response r WHERE r.created > now() - interval '2 hours';
  IF v_max_id <= v_last_id THEN RETURN QUERY SELECT 0, v_last_id; RETURN; END IF;
  WITH inserted AS (
    INSERT INTO public.server_errors (source, severity, message, http_path, http_status, salon_id, reported_at)
    SELECT 'pg_net',
           CASE WHEN r.status_code >= 500 OR r.timed_out THEN 'error' WHEN r.error_msg IS NOT NULL THEN 'error' ELSE 'warning' END,
           LEFT(COALESCE(r.error_msg, CASE WHEN r.timed_out THEN 'pg_net timeout' ELSE 'HTTP '||r.status_code END) || COALESCE(' | '||LEFT(r.content, 300), ''), 500),
           NULL, r.status_code, NULL, r.created
      FROM net._http_response r
     WHERE r.created > now() - interval '2 hours'
       AND r.id > v_last_id AND r.id <= v_max_id
       AND (r.status_code >= 500 OR r.timed_out OR r.error_msg IS NOT NULL)
    RETURNING 1)
  SELECT COUNT(*) INTO v_inserted FROM inserted;
  UPDATE public._pg_net_scan_cursor c SET last_id = v_max_id, updated_at = NOW() WHERE c.id = 1;
  RETURN QUERY SELECT v_inserted, v_max_id;
END; $function$;

-- 2) État de surveillance : échecs cron des 24 h lus via la clé primaire (runid) et non plus toute la table
CREATE OR REPLACE FUNCTION public.get_monitoring_status()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_last_beat timestamptz; v_age_seconds int; v_alive boolean; v_recent_critical int; v_recent_db_error int; v_cron_failures_24h int; v_max_run bigint;
BEGIN
  SELECT last_beat INTO v_last_beat FROM monitoring_heartbeat WHERE id = 1;
  v_age_seconds := EXTRACT(EPOCH FROM (NOW() - v_last_beat))::int;
  v_alive := v_age_seconds < 900;
  SELECT COUNT(*) INTO v_recent_critical FROM server_errors WHERE severity = 'critical' AND reported_at > NOW() - INTERVAL '1 hour';
  SELECT COUNT(*) INTO v_recent_db_error FROM audit_log WHERE action IN ('DB_ERROR','NF525_SEAL_TRIGGER_FAIL') AND timestamp_action > NOW() - INTERVAL '1 hour';
  SELECT MAX(runid) INTO v_max_run FROM cron.job_run_details;
  SELECT COUNT(*) INTO v_cron_failures_24h FROM cron.job_run_details
   WHERE runid > COALESCE(v_max_run,0) - 8000 AND status IN ('failed','canceled') AND start_time > NOW() - INTERVAL '24 hours';
  RETURN jsonb_build_object('status', CASE WHEN v_alive THEN 'ok' ELSE 'stale' END, 'alive', v_alive, 'last_beat', v_last_beat,
    'age_seconds', v_age_seconds, 'recent_critical_1h', v_recent_critical, 'recent_db_errors_1h', v_recent_db_error,
    'cron_failures_24h', v_cron_failures_24h, 'timestamp', NOW());
END; $function$;

-- 3) Fréquences (tâches sans urgence) — caisse/NF525, SMS et rappels inchangés
SELECT cron.alter_job(13, schedule := '*/15 * * * *');  -- pg-net-scan-failures (5 -> 15 min, fenêtre 2 h)
SELECT cron.alter_job(41, schedule := '*/30 * * * *');  -- annuaire-import (import terminé ; 2 -> 30 min)
SELECT cron.alter_job(15, schedule := '*/30 * * * *');  -- synthetic-monitoring (10 -> 30 min)
