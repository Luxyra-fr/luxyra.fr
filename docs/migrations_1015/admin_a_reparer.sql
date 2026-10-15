-- =====================================================================================
-- Admin : « 🔧 À réparer » + « 🧾 NF525 » (15/10/2026, demande d'Alexandre)
-- -------------------------------------------------------------------------------------
-- Objectif : dans le panneau admin, voir TOUS les vrais problèmes qui demandent une
-- réparation (complet, rien d'oublié), sans le bruit (messages normaux montrés à
-- l'utilisateur, coupures réseau, requêtes lentes, refus SMS RGPD, etc.), et un état
-- NF525 clair, global et par établissement.
--
-- Contenu (idempotent, aucune donnée métier modifiée) :
--   1. table admin_acquittements (« Marquer comme traité ») + RLS is_admin + GRANT ;
--   2. lx_prive.lx_try_jsonb / lx_prive.lx_norm_msg (outils) ;
--   3. lx_prive.a_reparer_brut(p_heures)  : toutes les sources, regroupées ;
--   4. public.admin_a_reparer(p_heures)   : is_admin + filtre des acquittements ;
--   5. public.admin_acquitter(p_signature): enregistre « traité » ;
--   6. public.admin_nf525_etat()          : verdicts NF525 global + par établissement.
--
-- LECTURE SEULE : aucune fonction ci-dessous n'écrit dans les tables de caisse.
-- nf525_tests_protections() n'est PAS appelée (elle écrit dans nf525_tests_nuit et
-- tente des modifications dans des blocs protégés) : on lit le dernier résultat stocké.
-- check_data_integrity() / check_fiscal_integrity() / verify_nf525_status() sont en
-- lecture seule (vérifié le 15/10/2026) et sont réutilisées.
-- =====================================================================================

set lock_timeout = '8s';

-- 1. Acquittements ------------------------------------------------------------------
create table if not exists public.admin_acquittements (
  signature  text primary key,
  traite_le  timestamptz not null default now(),
  traite_par text,
  titre      text
);
comment on table public.admin_acquittements is
  'Admin « À réparer » : problème marqué comme traité. Il réapparaît s''il se reproduit APRÈS traite_le.';
alter table public.admin_acquittements enable row level security;
drop policy if exists admin_acquittements_admin on public.admin_acquittements;
create policy admin_acquittements_admin on public.admin_acquittements
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.admin_acquittements from anon, public;
grant select, insert, update, delete on public.admin_acquittements to authenticated;

-- 2. Outils -------------------------------------------------------------------------
create or replace function lx_prive.lx_try_jsonb(p text)
returns jsonb language plpgsql immutable set search_path = pg_catalog, pg_temp as $$
begin
  if p is null or left(ltrim(p),1) not in ('{','[') then return null; end if;
  return p::jsonb;
exception when others then return null;
end $$;

-- Message « normalisé » pour regrouper les occurrences d'une même erreur
-- (identifiants, nombres et dates remplacés).
create or replace function lx_prive.lx_norm_msg(p text)
returns text language sql immutable set search_path = pg_catalog, pg_temp as $$
  select left(regexp_replace(regexp_replace(regexp_replace(lower(coalesce(p,'')),
    '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', '#', 'g'),
    '[0-9]+([.,][0-9]+)?', '0', 'g'),
    '\s+', ' ', 'g'), 120)
$$;

-- 3. Collecte brute -----------------------------------------------------------------
drop function if exists lx_prive.a_reparer_brut(integer);
create or replace function lx_prive.a_reparer_brut(p_heures integer default 72)
returns table(signature text, niveau text, categorie text, titre text, explication text, action text,
              nombre integer, premiere timestamptz, derniere timestamptz, salons text[], exemple text)
language plpgsql stable security definer
set search_path = public, lx_prive, pg_temp
as $fn$
#variable_conflict use_column
declare
  v_depuis timestamptz := now() - make_interval(hours => greatest(1, least(coalesce(p_heures,72), 720)));
  -- Fausse alerte connue du test de nuit (corrigée le 12/10/2026 à 20h, cf. admin.html _lxExpliquerErreur)
  v_coupure_test timestamptz := '2026-10-12 20:00:00+00';
  j record; v_gap interval; v_last timestamptz; v_lastok timestamptz; v_n int;
begin
  ------------------------------------------------------------------------------------
  -- A. Erreurs serveur (server_errors) : error / critical, hors bruit connu
  --    (edge functions edge_fn:*, worker:*, nf525_integrity, public_booking, Brevo…)
  ------------------------------------------------------------------------------------
  return query
  with w as (
    select e.*, s.nom as snom
      from server_errors e left join salons s on s.id = e.salon_id
     where e.reported_at > v_depuis
       and e.severity in ('error','critical')
       and e.source not in ('slow_query','sw_push_recu','synthetic_check','pg_net')
       -- anomalies « métier » traitées plus bas par l'état réel (Z manquant) ou sans gravité
       and not (e.source = 'business_anomaly' and e.message ~* 'cloture_z_missing|tickets_low|tickets_high')
       -- service externe (annuaire SIRET) indisponible, droits insuffisants, réseau, RGPD : normal
       and e.message !~* 'Service officiel momentan|Acc[eè]s refus[eé]|Failed to fetch|NetworkError|Load failed|ERR_INTERNET|refus[ée]?\s*\(RGPD\)'
       -- erreurs injectées par des extensions du navigateur (portefeuilles crypto…) : pas Luxyra
       and e.message !~* 'ethereum|chrome-extension|moz-extension|safari-(web-)?extension'
       and not (e.message ~ 'NF525_TEST_NUIT_KO' and e.reported_at < v_coupure_test)
       -- baisse d'inventaire expliquée par une réinitialisation d'essai archivée (JET 200)
       and not (e.source = 'nf525_inventory_check' and exists (
             select 1 from nf525_archives_purge p
              where p.created_at between e.reported_at - interval '36 hours' and e.reported_at))
       and (s.ferme_le is null or e.reported_at < s.ferme_le)
  ), g as (
    select w.source, lx_norm_msg(w.message) as k,
           bool_or(w.severity = 'critical') as crit, count(*)::int as n, min(w.reported_at) as p, max(w.reported_at) as d,
           array_remove(array_agg(distinct w.snom), null) as sal,
           (array_agg(w.message || coalesce(' | ' || w.http_method || ' ' || w.http_path, '') ||
                      coalesce(' | HTTP ' || w.http_status, '') order by w.reported_at desc))[1] as ex
      from w group by w.source, lx_norm_msg(w.message)
  )
  select md5('srv|' || g.source || '|' || g.k),
         case when g.crit or g.source ~ '^nf525|public_booking' or g.k ~ 'stripe|double paiement|webhook' then 'grave' else 'a_reparer' end,
         case when g.source ~ '^nf525' then 'Caisse (NF525)'
              when g.k ~ 'stripe|webhook|paiement|refund|rembours' then 'Paiements en ligne'
              when g.source ~ 'public_booking|rdv|resa|booking' then 'Réservation en ligne'
              when g.k ~ 'brevo|smtp|e-?mail|mail failed' then 'E-mails'
              when g.k ~ 'sms' then 'SMS'
              when g.source like 'edge_fn:%' then 'Fonctions serveur'
              when g.source like 'worker%' then 'Serveur du site'
              else 'Serveur' end,
         case when g.k ~ 'nf525_test_nuit_ko' then 'Test de nuit : une protection de la caisse ne répond pas'
              when g.k ~ 'nf525_signature_ko' then 'Contrôle des signatures de caisse en échec'
              when g.k ~ 'nf525_seal_trigger_fail|hash_mismatch|nf525_integrite_ko' then 'Scellement de la caisse en échec'
              when g.source = 'nf525_inventory_check' then 'Conservation des données de caisse : baisse anormale'
              when g.source = 'public_booking' then 'Réservation en ligne bloquée sur un site'
              when g.k ~ 'brevo|mail failed' then 'Envoi d''e-mail en échec (Brevo)'
              when g.source like 'edge_fn:%' then 'Fonction serveur « ' || substr(g.source, 9) || ' » en erreur'
              when g.source like 'worker%' then 'Le serveur du site a renvoyé une erreur (' || g.source || ')'
              else 'Erreur serveur (' || g.source || ')' end,
         case when g.source ~ '^nf525' then 'Un contrôle automatique de la caisse a signalé une anomalie. La loi impose des données de caisse inaltérables : à regarder en priorité.'
              when g.source = 'public_booking' then 'Plusieurs visiteurs ont eu la même erreur sur la page de réservation : des clients n''ont peut-être pas pu réserver.'
              when g.k ~ 'stripe|webhook' then 'Un paiement, un acompte ou un remboursement en ligne a pu échouer.'
              else 'Une fonction côté serveur a échoué : la fonctionnalité concernée ne marche peut-être pas pour l''utilisateur.' end,
         case when g.source ~ '^nf525' then 'Prévenir Claude immédiatement (ne rien modifier dans la caisse).'
              when g.k ~ 'stripe|webhook' then 'Vérifier le paiement dans Stripe, puis prévenir Claude.'
              else 'Prévenir Claude avec le détail technique.' end,
         g.n, g.p, g.d, g.sal, left(g.ex, 800)
    from g;

  ------------------------------------------------------------------------------------
  -- B. Appels internes pg_net (cron -> fonctions serveur) en échec, RÉPÉTÉS
  --    Isolé = coupure passagère (bruit). La tâche est retrouvée par son délai.
  ------------------------------------------------------------------------------------
  return query
  with jt as (
    select (regexp_match(c.command, 'timeout_milliseconds\s*:=\s*(\d+)'))[1] as tmo, string_agg(c.jobname, ', ') as jobs
      from cron.job c group by 1
  ), w as (
    select e.*, coalesce(jt.jobs, 'non identifiée') as job
      from server_errors e
      left join jt on jt.tmo = (regexp_match(e.message, 'Timeout of (\d+) ms'))[1]
     where e.source = 'pg_net' and e.reported_at > v_depuis
  ), g as (
    select w.job, count(*)::int as n, count(*) filter (where w.reported_at > now() - interval '24 hours') as n24,
           min(w.reported_at) as p, max(w.reported_at) as d, (array_agg(w.message order by w.reported_at desc))[1] as ex
      from w group by w.job
  )
  select md5('pgnet|' || g.job), 'a_reparer', 'Tâches automatiques',
         'Appels internes sans réponse (tâche : ' || g.job || ')',
         'Une tâche automatique appelle une fonction serveur qui ne répond plus (délai dépassé ou erreur 5xx), plusieurs fois en 24 h.',
         'Vérifier que la tâche fait toujours son travail ; prévenir Claude si cela continue.',
         g.n, g.p, g.d, array[]::text[], left(g.ex, 800)
    from g where g.n24 >= 3;

  ------------------------------------------------------------------------------------
  -- C. Erreurs de l'application pro (audit_log) : DB_ERROR, WAL_ABANDON, JS_ERROR
  ------------------------------------------------------------------------------------
  return query
  with w as (
    select a.*, s.nom as snom, lx_try_jsonb(a.details) as dj
      from audit_log a left join salons s on s.id = a.salon_id
     where a.timestamp_action > v_depuis
       and a.action in ('DB_ERROR','WAL_ABANDON','JS_ERROR','JS_CONSOLE_ERROR')
       and (s.ferme_le is null or a.timestamp_action < s.ferme_le)
  ), f as (
    select w.*, coalesce(w.dj->>'msg', w.dj->>'message', w.details) as msg, coalesce(w.dj->>'fn','') as fn, coalesce(w.dj->>'type','') as typ
      from w
  ), k as (
    select f.* from f
     where not (f.action in ('JS_ERROR','JS_CONSOLE_ERROR') and (
             f.typ = 'resource_error'
          or f.msg ~ '^\s*\{?.{0,12}\[(ALERT|TOAST)\]'                       -- message affiché à l'utilisateur
          or f.msg ~* 'Failed to fetch|NetworkError|Load failed|ERR_INTERNET|ERR_NETWORK|timeout|AbortError|réseau'
          or f.msg ~* 'refus[ée]?\s*\(RGPD\)|inalt[eé]rable|Map container is already|ethereum|chrome-extension|moz-extension|safari-(web-)?extension|Refresh Token|Cam[eé]ra|ResizeObserver|^Script error\.?$'))
       -- refus voulus par la caisse (ticket encaissé non modifiable)
       and not (f.action = 'DB_ERROR' and f.msg ~* 'ticket encaiss[eé] inalt[eé]rable')
       -- ticket refusé puis bien enregistré au rejeu (WAL) : rien à réparer
       and not (f.action = 'DB_ERROR' and f.fn = 'saveTicketToDb' and coalesce(f.dj->>'tk_id','') <> '' and exists (
             select 1 from tickets t where t.salon_id = f.salon_id and (t.id::text = f.dj->>'tk_id' or t.raw_data->>'id' = f.dj->>'tk_id')))
  ), g as (
    select k.action, k.fn, lx_norm_msg(k.msg) as km, count(*)::int as n, min(k.timestamp_action) as p, max(k.timestamp_action) as d,
           array_remove(array_agg(distinct k.snom), null) as sal,
           (array_agg(coalesce(nullif(k.fn,'') || ' : ', '') || k.msg order by k.timestamp_action desc))[1] as ex
      from k group by k.action, k.fn, lx_norm_msg(k.msg)
  )
  select md5('app|' || g.action || '|' || g.fn || '|' || g.km),
         case when g.action = 'WAL_ABANDON' or g.fn ~* 'ticket|clotur' then 'grave' else 'a_reparer' end,
         case when g.action = 'WAL_ABANDON' or g.fn ~* 'ticket|clotur' then 'Caisse (NF525)'
              when g.fn ~* 'salon|site|config|ecriture|reglage|column|collab' then 'Réglages des établissements'
              when g.fn ~* 'appoint|rdv' then 'Rendez-vous'
              else 'Application pro' end,
         case when g.action = 'WAL_ABANDON' then 'Ticket non transmis au serveur (clôture forcée)'
              when g.fn ~* 'clotur' then 'Clôture Z : incohérence à l''enregistrement'
              when g.fn ~* 'ticket' then 'Ticket refusé par le serveur'
              when g.fn ~* 'salon|site|config|ecriture|reglage|column|collab' then 'Réglages non enregistrés (enregistrement refusé ou bloqué)'
              when g.fn ~* 'appoint|rdv' then 'Rendez-vous non enregistré'
              when g.action = 'DB_ERROR' then 'Enregistrement refusé par la base'
              else 'Erreur dans une page de l''application pro' end,
         case when g.action = 'WAL_ABANDON' then 'Un ticket est resté sur l''appareil et n''a jamais été reçu par le serveur ; la clôture a été forcée.'
              when g.action = 'DB_ERROR' then 'L''application a tenté d''enregistrer une donnée et la base a refusé ou l''application a bloqué l''écriture : la modification n''est peut-être pas enregistrée.'
              else 'Un écran ou un bouton de l''application a rencontré une erreur technique.' end,
         case when g.action = 'WAL_ABANDON' or g.fn ~* 'ticket|clotur' then 'Prévenir Claude : vérifier le ticket / la clôture avec l''établissement.'
              when g.fn ~* 'salon|site|config|ecriture|reglage|column|collab' then 'Demander à l''établissement si son réglage est bien pris en compte ; prévenir Claude.'
              else 'Prévenir Claude avec le détail technique.' end,
         g.n, g.p, g.d, g.sal, left(g.ex, 800)
    from g;

  -- C2. Protections de caisse contournées SANS réinitialisation d'essai tracée
  return query
  with w as (
    select a.*, s.nom as snom from audit_log a left join salons s on s.id = a.salon_id
     where a.timestamp_action > v_depuis
       and a.action in ('NF525_INALTERABILITE_BYPASSEE','NF525_AUDIT_LOG_BYPASS','NF525_ARCHIVE_BYPASS')
       and not exists (select 1 from audit_log r where r.salon_id is not distinct from a.salon_id
                         and r.action in ('RESET_VENTES_TEST','FACTORY_RESET')
                         and r.timestamp_action between a.timestamp_action - interval '10 minutes' and a.timestamp_action + interval '10 minutes')
       and not exists (select 1 from nf525_archives_purge p where p.salon_id is not distinct from a.salon_id
                         and p.created_at between a.timestamp_action - interval '10 minutes' and a.timestamp_action + interval '10 minutes')
  )
  select md5('bypass|' || coalesce(w.salon_id::text,'')), 'grave', 'Caisse (NF525)',
         'Protection de la caisse contournée sans réinitialisation tracée',
         'Une donnée de caisse a été modifiée ou supprimée en passant outre la protection, sans réinitialisation d''essai archivée au même moment.',
         'Prévenir Claude immédiatement et vérifier le registre des interventions NF525.',
         count(*)::int, min(w.timestamp_action), max(w.timestamp_action), array_remove(array_agg(distinct w.snom), null),
         left((array_agg(w.action || ' : ' || w.details order by w.timestamp_action desc))[1], 800)
    from w group by w.salon_id;

  ------------------------------------------------------------------------------------
  -- D. Site public (js_errors_public)
  --    « site non chargé » : seulement si répété (>= 3) ; le reste : >= 2, hors bruit.
  ------------------------------------------------------------------------------------
  return query
  with w as (
    select e.*, (e.type = 'boot_failed' or e.message ~ 'SITE JS NON DEMARRE|Script vital NON charg') as boot
      from js_errors_public e
     where e.reported_at > v_depuis
  ), k as (
    select * from w
     where boot or (
           coalesce(w.type,'') not in ('resource_error')
       and w.message !~* 'Failed to fetch|NetworkError|Load failed|ERR_INTERNET|timeout|AbortError|ethereum|chrome-extension|moz-extension|safari-(web-)?extension|Refresh Token|Map container is already|ResizeObserver|^Script error\.?$|\[(ALERT|TOAST)\]')
  ), g as (
    select k.boot, case when k.boot then 'boot' else lx_norm_msg(k.message) end as km, count(*)::int as n,
           min(k.reported_at) as p, max(k.reported_at) as d,
           array_remove(array_agg(distinct nullif(k.salon_slug,'')), null) as sal,
           (array_agg(coalesce(k.page,'') || ' : ' || k.message order by k.reported_at desc))[1] as ex
      from k group by 1, 2
  )
  select md5('pub|' || g.km),
         'a_reparer', 'Site public',
         case when g.boot then 'Page de réservation qui ne se charge pas (plusieurs visiteurs)' else 'Erreur répétée sur le site public' end,
         case when g.boot then 'Le site ne s''est pas chargé chez plusieurs visiteurs : un fichier manque ou une mise à jour est cassée.'
              else 'La même erreur technique est revenue plusieurs fois chez des visiteurs.' end,
         'Ouvrir la page concernée sur un téléphone ; prévenir Claude.',
         g.n, g.p, g.d, g.sal, left(g.ex, 800)
    from g where (g.boot and g.n >= 3) or (not g.boot and g.n >= 2);

  ------------------------------------------------------------------------------------
  -- E. Tâches automatiques (pg_cron) : échecs et exécutions manquées
  ------------------------------------------------------------------------------------
  return query
  select md5('cronko|' || c.jobname),
         case when c.jobname ~* 'nf525|cloture|z_|fiscal|integrity|archiv' then 'grave' else 'a_reparer' end,
         'Tâches automatiques',
         'Tâche automatique en échec : ' || c.jobname,
         'Une tâche qui tourne toute seule (rappels, clôtures, contrôles…) s''est terminée en erreur.',
         'Prévenir Claude avec le message d''erreur.',
         count(*)::int, min(d.start_time), max(d.start_time), array[]::text[],
         left((array_agg(coalesce(d.return_message,'') order by d.start_time desc))[1], 800)
    from cron.job_run_details d join cron.job c on c.jobid = d.jobid
   where d.status = 'failed' and d.start_time > v_depuis
   group by c.jobname;

  for j in select c.jobid, c.jobname, c.schedule from cron.job c where c.active loop
    v_gap := case
      when j.schedule ~ '^\*/[0-9]+ \* \* \* \*$' then make_interval(mins => (substring(j.schedule from '^\*/([0-9]+)'))::int * 3 + 10)
      when j.schedule = '* * * * *' then interval '15 minutes'
      when j.schedule ~ '^[0-9]+ \* \* \* \*$' then interval '2 hours 15 minutes'
      when j.schedule ~ '^[0-9]+ [0-9,/-]+ \* \* \*$' then interval '26 hours'
      else null end;                                   -- mensuel / annuel : non contrôlé ici
    continue when v_gap is null;
    select max(d.start_time), max(d.start_time) filter (where d.status = 'succeeded')
      into v_last, v_lastok from cron.job_run_details d where d.jobid = j.jobid;
    if v_last is null or v_last < now() - v_gap then
      return query select md5('cronmiss|' || j.jobname),
        case when j.jobname ~* 'nf525|cloture|z_|fiscal|integrity|rappel|sms' then 'grave' else 'a_reparer' end,
        'Tâches automatiques', 'Tâche automatique qui ne tourne plus : ' || j.jobname,
        'Cette tâche (programmée « ' || j.schedule || ' ») aurait dû s''exécuter depuis sa dernière fois'
          || coalesce(' (' || to_char(v_last at time zone 'Europe/Paris', 'DD/MM HH24:MI') || ')', ' (aucune exécution sur 7 jours)') || '.',
        'Prévenir Claude : la planification est peut-être arrêtée.',
        1, coalesce(v_last, now() - interval '7 days'), coalesce(v_last, now() - interval '7 days') + v_gap,
        array[]::text[], 'cron ' || j.jobname || ' / ' || j.schedule || ' / dernière exécution : ' || coalesce(v_last::text, 'aucune') || ' / dernier succès : ' || coalesce(v_lastok::text, 'aucun');
    end if;
  end loop;

  -- Battement de cœur de la base (toutes les 5 min)
  return query
  select md5('heartbeat'), 'grave', 'Tâches automatiques', 'Les tâches automatiques sont arrêtées',
         'Le « battement de cœur » de la base n''a pas été mis à jour depuis plus de 15 minutes : plus aucune tâche automatique ne tourne.',
         'Prévenir Claude immédiatement.', 1, h.last_beat, h.last_beat + interval '15 minutes', array[]::text[], 'last_beat=' || h.last_beat
    from monitoring_heartbeat h where h.last_beat < now() - interval '15 minutes';

  ------------------------------------------------------------------------------------
  -- F. Sonde de surveillance (monitoring_synthetic_log, toutes les 10 min)
  ------------------------------------------------------------------------------------
  return query
  with w as (select * from monitoring_synthetic_log m where m.reported_at > v_depuis),
       dern as (select w.ok from w order by w.reported_at desc limit 1)
  select md5('synth|ko'), 'a_reparer', 'Surveillance', 'Contrôle automatique du site en échec',
         'La sonde qui teste le site toutes les 10 minutes a trouvé un problème plusieurs fois (ou au dernier passage).',
         'Ouvrir le site et l''application ; prévenir Claude si une page ne répond pas.',
         count(*)::int, min(w.reported_at), max(w.reported_at), array[]::text[],
         left((array_agg(w.details::text order by w.reported_at desc))[1], 800)
    from w where not w.ok
  having count(*) >= 2 or coalesce((select not dern.ok from dern), false);

  return query
  select md5('synth|arret'), 'a_reparer', 'Surveillance', 'La sonde de surveillance ne tourne plus',
         'Aucun contrôle automatique du site depuis plus de 30 minutes : une panne passerait inaperçue.',
         'Prévenir Claude.', 1, max(m.reported_at), max(m.reported_at) + interval '30 minutes', array[]::text[], 'dernier contrôle : ' || coalesce(max(m.reported_at)::text, 'aucun')
    from monitoring_synthetic_log m
  having coalesce(max(m.reported_at), now() - interval '1 day') < now() - interval '30 minutes';

  ------------------------------------------------------------------------------------
  -- G. SMS / e-mails
  ------------------------------------------------------------------------------------
  -- SMS différés bloqués ou en échec (file traitée toutes les 2 min)
  return query
  select md5('smsdiff|' || x.statut), 'a_reparer', 'SMS',
         case when x.statut ~* 'echec|erreur' then 'SMS différés en échec' else 'SMS différés bloqués dans la file' end,
         'Des SMS programmés (hors horaires) ne sont pas partis.', 'Prévenir Claude.',
         count(*)::int, min(x.cree_le), max(x.cree_le), array_remove(array_agg(distinct s.nom), null),
         left((array_agg(x.statut || ' / ' || coalesce(x.motif,'') || ' / ' || coalesce(x.contexte,'') order by x.cree_le desc))[1], 800)
    from sms_differes x left join salons s on s.id = x.salon_id
   where x.statut not in ('envoye','obsolete','annule')
     and x.cree_le < now() - interval '2 hours'
     and x.cree_le > now() - interval '30 days'
     and (x.statut ~* 'echec|erreur' or coalesce(x.envoi_le, x.cree_le) < now() - interval '2 hours')
   group by x.statut;

  -- SMS refusés par l'opérateur (échec définitif). « softbounce » sans suite = non traité ici.
  return query
  select md5('smsenv|' || coalesce(x.dernier_evenement, x.statut)), 'a_reparer', 'SMS', 'SMS refusés par l''opérateur',
         'Brevo a signalé des SMS non distribués (numéro invalide, refus opérateur…).', 'Vérifier les numéros concernés ; le crédit doit être rendu.',
         count(*)::int, min(x.cree_le), max(x.cree_le), array_remove(array_agg(distinct s.nom), null),
         left((array_agg(x.statut || ' / ' || coalesce(x.dernier_evenement,'') || ' / rendu=' || coalesce(x.rembourse::text,'non') order by x.cree_le desc))[1], 800)
    from sms_envois x left join salons s on s.id = x.salon_id
   where x.cree_le > v_depuis
     and (x.statut ~* 'echec|erreur|refus' or coalesce(x.dernier_evenement,'') ~* 'hard|error|reject|blocked|invalid|unsubscribed')
   group by coalesce(x.dernier_evenement, x.statut);

  return query
  select md5('smsq|' || s.id::text), 'a_reparer', 'SMS', 'SMS en échec (téléphone relais)',
         'Des SMS confiés au téléphone relais de l''établissement ont échoué après plusieurs essais.', 'Vérifier le téléphone relais de l''établissement.',
         count(*)::int, min(q.created_at), max(q.created_at), array_remove(array[s.nom], null),
         left((array_agg(coalesce(q.error_message,'') order by q.created_at desc))[1], 800)
    from sms_queue q left join salons s on s.id = q.salon_id
   where q.created_at > v_depuis and q.status in ('failed','error','echec')
   group by s.id, s.nom;

  ------------------------------------------------------------------------------------
  -- H. Paiements en ligne (Stripe) et acomptes « ticket scellé »
  ------------------------------------------------------------------------------------
  -- Remboursement Stripe en échec (les « skip: … » sont des refus normaux, ex. acompte non payé)
  return query
  select md5('refund|' || r.id::text), 'grave', 'Paiements en ligne', 'Remboursement d''acompte en échec',
         'Le remboursement de l''acompte d''un client n''a pas abouti chez Stripe.', 'Faire le remboursement depuis Stripe, puis prévenir Claude.',
         1, coalesce(r.refund_attempted_at, r.cancelled_at, r.created_at), coalesce(r.refund_attempted_at, r.cancelled_at, r.created_at),
         array_remove(array[s.nom], null), 'rdv_online ' || r.id || ' : ' || r.refund_error
    from rdv_online r join salons s on s.id = r.salon_id
   where coalesce(r.refund_error,'') <> '' and r.refund_error !~* '^skip'
     and not coalesce(r.acompte_rembourse, false) and s.ferme_le is null;

  -- Acompte payé mais RDV resté « en attente de paiement »
  return query
  select md5('paye_attente|' || r.id::text), 'grave', 'Paiements en ligne', 'Acompte payé mais rendez-vous non confirmé',
         'Le client a payé son acompte, mais la réservation est restée « en attente de paiement » (finalisation Stripe manquée).',
         'Confirmer le RDV avec l''établissement ; prévenir Claude.',
         1, coalesce(r.acompte_paye_at, r.created_at), coalesce(r.acompte_paye_at, r.created_at),
         array_remove(array[s.nom], null), 'rdv_online ' || r.id || ' du ' || r.date_rdv || ' ' || coalesce(r.payment_intent_id, '')
    from rdv_online r join salons s on s.id = r.salon_id
   where r.acompte_paye and r.status = 'pending_payment' and r.created_at < now() - interval '1 hour' and s.ferme_le is null;

  -- RDV annulé PAR L'ÉTABLISSEMENT : l'acompte doit toujours être rendu (lot 1c)
  return query
  select md5('annul_salon|' || r.id::text), 'a_reparer', 'Paiements en ligne', 'Acompte non rendu après annulation par l''établissement',
         'L''établissement a annulé un RDV dont l''acompte était payé, et aucun remboursement n''est enregistré.',
         'Vérifier dans Stripe et rembourser le client si besoin.',
         1, r.cancelled_at, r.cancelled_at, array_remove(array[s.nom], null),
         'rdv_online ' || r.id || ' du ' || r.date_rdv || ' — ' || coalesce(r.acompte_montant::text, '?') || ' €'
    from rdv_online r join salons s on s.id = r.salon_id
   where r.status = 'cancelled' and r.cancelled_by = 'salon' and r.acompte_paye
     and not coalesce(r.acompte_rembourse, false) and r.refunded_at is null and r.retenue_tk_num is null
     and r.cancelled_at < now() - interval '1 hour' and s.ferme_le is null;

  -- Empreinte bancaire bloquée depuis plus de 6 jours (l'autorisation expire à 7 jours)
  return query
  select md5('empreinte|' || r.id::text), 'a_reparer', 'Paiements en ligne', 'Empreinte bancaire bientôt expirée',
         'Une empreinte bancaire est retenue depuis plus de 6 jours sans être prélevée ni libérée.', 'Prévenir Claude.',
         1, r.empreinte_held_at, r.empreinte_held_at, array_remove(array[s.nom], null),
         'rdv_online ' || r.id || ' statut empreinte=' || r.empreinte_status
    from rdv_online r join salons s on s.id = r.salon_id
   where coalesce(r.empreinte_status,'none') not in ('none','captured','released','canceled','cancelled','failed')
     and r.empreinte_held_at < now() - interval '6 days' and s.ferme_le is null;

  -- Acompte payé (modèle ticket scellé) sans ticket « Acompte en ligne » après 2 h
  return query
  select md5('acompte_tk|' || s.id::text), 'a_reparer', 'Caisse (NF525)', 'Acompte en ligne payé sans ticket de caisse',
         'Des acomptes payés en ligne n''ont pas encore leur ticket « Acompte en ligne » (créé à l''ouverture de la caisse de l''établissement).',
         'Vérifier que l''établissement a ouvert sa caisse ; si oui, prévenir Claude.',
         count(*)::int, min(coalesce(r.acompte_paye_at, r.created_at)), max(coalesce(r.acompte_paye_at, r.created_at)), array[s.nom],
         left(string_agg('rdv ' || r.id || ' ' || coalesce(r.acompte_montant::text,'?') || ' € payé ' || coalesce(r.acompte_paye_at::text,'?'), ' ; '), 800)
    from rdv_online r join salons s on s.id = r.salon_id
   where r.acompte_modele = 'ticket' and r.acompte_paye and r.acompte_tk_num is null
     and coalesce(r.acompte_montant,0) > 0 and coalesce(r.status,'') <> 'done' and r.ticket_num is null
     and r.retenue_tk_num is null and r.retenue_claim_at is null
     and coalesce(r.acompte_paye_at, r.created_at) < now() - interval '2 hours' and s.ferme_le is null
   group by s.id, s.nom;

  -- Remboursement d'acompte sans ticket négatif après 2 h
  return query
  select md5('remb_tk|' || s.id::text), 'a_reparer', 'Caisse (NF525)', 'Remboursement d''acompte sans ticket de caisse',
         'Un acompte remboursé n''a pas encore son ticket négatif dans la caisse de l''établissement.',
         'Vérifier que l''établissement a ouvert sa caisse ; si oui, prévenir Claude.',
         count(*)::int, min(coalesce(r.refunded_at, r.created_at)), max(coalesce(r.refunded_at, r.created_at)), array[s.nom],
         left(string_agg('rdv ' || r.id, ' ; '), 800)
    from rdv_online r join salons s on s.id = r.salon_id
   where r.acompte_modele = 'ticket' and r.acompte_tk_num is not null
     and exists (select 1 from jsonb_array_elements(coalesce(r.remboursements,'[]'::jsonb)) e
                  where (e->>'tk') is null and coalesce((e->>'montant')::numeric,0) > 0)
     and coalesce(r.refunded_at, r.created_at) < now() - interval '2 hours' and s.ferme_le is null
   group by s.id, s.nom;

  ------------------------------------------------------------------------------------
  -- I. Intégrité des données (fonctions existantes, lecture seule)
  ------------------------------------------------------------------------------------
  return query
  select md5('cdi|' || c.anomaly_type || '|' || coalesce(c.out_salon_id::text,'')),
         case when c.anomaly_type = 'COLLABORATEUR_DOUBLON' then 'a_reparer' else 'grave' end,
         case when c.anomaly_type = 'COLLABORATEUR_DOUBLON' then 'Données' else 'Caisse (NF525)' end,
         case c.anomaly_type
           when 'RDV_DONE_TICKET_NF525_MANQUANT' then 'Encaissement sans ticket au journal de caisse'
           when 'CLOTURE_HASH_VIDE' then 'Clôture Z non scellée'
           when 'TICKET_NUM_DOUBLON' then 'Numéro de ticket en double'
           when 'CUMUL_MOIS_INCOHERENT' then 'Clôture mensuelle différente de la somme des Z'
           when 'CUMUL_ANNEE_INCOHERENT' then 'Clôture annuelle différente de la somme des mois'
           when 'COLLABORATEUR_DOUBLON' then 'Collaborateur en double'
           else 'Anomalie de données : ' || c.anomaly_type end,
         'Le contrôle d''intégrité des données a trouvé une incohérence.',
         case when c.anomaly_type = 'COLLABORATEUR_DOUBLON' then 'Supprimer le doublon avec l''établissement.' else 'Prévenir Claude (ne rien modifier dans la caisse).' end,
         count(*)::int, min(c.detected_at), max(c.detected_at), array_remove(array_agg(distinct c.salon_nom), null),
         left(string_agg(c.detail, ' ; '), 800)
    from public.check_data_integrity() c left join salons s on s.id = c.out_salon_id
   where c.anomaly_type <> 'TICKET_HASH_VIDE'          -- déjà couvert (historique complet) par check_fiscal_integrity
     and (s.id is null or s.ferme_le is null)
   group by c.anomaly_type, c.out_salon_id;

  return query
  select md5('cfi|' || f.anomaly_type || '|' || coalesce(f.salon_id::text,'')),
         case when f.severity = 'critical' then 'grave' else 'a_reparer' end,
         case when f.anomaly_type like 'RDV_ONLINE%' then 'Rendez-vous' else 'Caisse (NF525)' end,
         case f.anomaly_type
           when 'NF525_HASH_MANQUANT' then 'Ticket encaissé non scellé'
           when 'NF525_CHAINE_ROMPUE' then 'Chaîne des tickets rompue'
           when 'NF525_TROU_NUMEROTATION' then 'Trou dans la numérotation des tickets'
           when 'CLOTURE_ECART_JOURNAL' then 'Clôture Z différente du journal des tickets'
           when 'ECART_CAISSE_NON_JUSTIFIE' then 'Écart de caisse sans justification'
           when 'TICKET_NUM_DOUBLON_AFFICHAGE' then 'Numéro de ticket affiché en double'
           when 'ANNULATION_SANS_CONTRE_TICKET' then 'Annulation sans contre-ticket'
           when 'RDV_ONLINE_SANS_COLLABORATEUR' then 'Réservation en ligne sans collaborateur'
           when 'RDV_ONLINE_SUR_ABSENCE' then 'Réservation en ligne sur une absence'
           else 'Contrôle fiscal : ' || f.anomaly_type end,
         case when f.anomaly_type like 'RDV_ONLINE%' then 'Ce rendez-vous risque de ne pas être honoré (invisible au planning ou sur une absence).'
              else 'Le contrôle fiscal automatique a trouvé une incohérence dans la caisse.' end,
         case when f.anomaly_type like 'RDV_ONLINE%' then 'Prévenir l''établissement (affecter le RDV à un collaborateur).'
              when f.anomaly_type = 'ECART_CAISSE_NON_JUSTIFIE' then 'Demander à l''établissement de justifier l''écart.'
              else 'Prévenir Claude (ne rien modifier dans la caisse).' end,
         count(*)::int, min(f.ref_date)::timestamptz, max(f.ref_date)::timestamptz, array_remove(array_agg(distinct f.salon_nom), null),
         left(string_agg(f.detail, ' ; '), 800)
    from public.check_fiscal_integrity() f join salons s on s.id = f.salon_id
   where s.ferme_le is null
   group by f.anomaly_type, f.salon_id, f.severity;

  -- Double scellement (nf525_hash_seal) recalculé : chaîne + empreintes
  return query
  with g as (
    select h.salon_id, h.chain_index, h.chain_prev_hash, h.chain_hash, h.canonical_sha256 as cs, h.row_snapshot_sha256 as ss,
           h.canonical_data, h.row_snapshot, h.sealed_at,
           lag(h.canonical_sha256) over w as pc, lag(h.row_snapshot_sha256) over w as ps
      from nf525_hash_seal h window w as (partition by h.salon_id order by h.chain_index)
  ), ko as (
    select g.* from g
     where g.cs <> upper(encode(extensions.digest(g.canonical_data::bytea, 'sha256'), 'hex'))
        or g.ss <> upper(encode(extensions.digest(g.row_snapshot::text::bytea, 'sha256'), 'hex'))
        or (g.pc is not null and g.chain_prev_hash is distinct from upper(encode(extensions.digest((g.pc || '|' || g.ps)::bytea, 'sha256'), 'hex')))
        or g.chain_hash <> upper(encode(extensions.digest((g.chain_index::text || '|' || g.cs || '|' || g.ss || '|' || coalesce(g.pc,'') || '|' || coalesce(g.ps,''))::bytea, 'sha256'), 'hex'))
  )
  select md5('seal|' || ko.salon_id::text), 'grave', 'Caisse (NF525)', 'Double scellement de la caisse rompu',
         'Le recalcul des empreintes du registre de scellement ne retombe pas sur les valeurs enregistrées.',
         'Prévenir Claude immédiatement (ne rien modifier).',
         count(*)::int, min(ko.sealed_at), max(ko.sealed_at), array_remove(array[max(s.nom)], null),
         'maillons en défaut : ' || string_agg(ko.chain_index::text, ',' order by ko.chain_index)
    from ko join salons s on s.id = ko.salon_id
   where s.ferme_le is null
   group by ko.salon_id;

  -- Ticket modifié après scellement sans trace (correction de règlement tracée = normal)
  return query
  select md5('altere|' || t.salon_id::text), 'grave', 'Caisse (NF525)', 'Ticket modifié après son scellement',
         'Un ticket encaissé ne correspond plus à ce qui a été scellé, et aucune correction tracée ne l''explique.',
         'Prévenir Claude immédiatement.',
         count(*)::int, min(t.created_at), max(t.created_at), array_remove(array[max(s.nom)], null),
         left(string_agg('#' || t.num || ' scellé « ' || h.canonical_data || ' »', ' ; '), 800)
    from tickets t join nf525_hash_seal h on h.source_table = 'tickets' and h.source_id = t.id
    join salons s on s.id = t.salon_id
   where s.ferme_le is null
     and regexp_replace(h.canonical_data, '\|[^|]*$', '') <> 'TK|' || t.num || '|' || to_char(t.date_ticket,'YYYY-MM-DD') || '|' || to_char(t.heure_ticket,'HH24:MI') || '|' || to_char(t.total_ttc,'FM999999990.00') || '|' || coalesce(t.mode_paiement,'') || '|' || coalesce(t.hash_prev,'')
     and not exists (select 1 from audit_log a where a.salon_id = t.salon_id and a.action like 'CORRECTION_REGLEMENT%'
                       and a.details like 'Ticket #' || t.num || ' %')
   group by t.salon_id;

  -- Journées encaissées sans clôture Z (hors aujourd'hui) — la clôture auto de nuit aurait dû la faire
  return query
  with j as (
    select t.salon_id, t.date_ticket, count(*) as nb, sum(t.total_ttc) as ca
      from tickets t join salons s on s.id = t.salon_id
     where s.ferme_le is null and t.date_ticket < (now() at time zone 'Europe/Paris')::date
       and t.date_ticket >= (now() at time zone 'Europe/Paris')::date - 400
       and not exists (select 1 from clotures c where c.salon_id = t.salon_id and c.date_cloture = t.date_ticket)
     group by t.salon_id, t.date_ticket
  )
  select md5('zmanq|' || j.salon_id::text),
         case when max(s.mode_caisse) = 'reel' then 'grave' else 'a_reparer' end,
         'Caisse (NF525)', 'Journée encaissée sans clôture Z',
         'Des ventes existent sur une journée passée qui n''a jamais été clôturée (la clôture automatique de nuit ne l''a pas faite).',
         'Prévenir Claude : la journée doit recevoir sa clôture Z.',
         count(*)::int, min(j.date_ticket)::timestamptz, max(j.date_ticket)::timestamptz, array[max(s.nom)],
         left(string_agg(to_char(j.date_ticket,'DD/MM/YYYY') || ' : ' || j.nb || ' ticket(s), ' || to_char(j.ca,'FM999999990.00') || ' €', ' ; ' order by j.date_ticket), 800)
    from j join salons s on s.id = j.salon_id
   group by j.salon_id;

  -- Numéros de ticket IMPRIMÉS (raw_data.tkNum) en double / sautés sur la période
  return query
  -- (un numéro imprimé absent de raw_data n'est pas un saut : on compare au dernier numéro connu)
  with y0 as (
    select t.salon_id, t.num, t.created_at, (t.raw_data->>'tkNum')::int as tk
      from tickets t where t.raw_data->>'tkNum' ~ '^[0-9]+$'
  ), y as (
    select y0.*, lag(y0.tk) over w as ptk, lag(y0.num) over w as pnum
      from y0 window w as (partition by y0.salon_id order by y0.num)
  )
  select md5('tknum|' || y.salon_id::text), 'a_reparer', 'Caisse (NF525)', 'Numéro de ticket imprimé en double ou sauté',
         'Le numéro imprimé sur le ticket ne suit plus 1, 2, 3… (le numéro fiscal du serveur, lui, reste continu).',
         'Prévenir Claude.',
         count(*)::int, min(y.created_at), max(y.created_at), array[max(s.nom)],
         left(string_agg('ticket serveur #' || y.num || ' : imprimé ' || y.tk || ' après ' || y.ptk || ' (ticket serveur #' || y.pnum || ')', ' ; '), 800)
    from y join salons s on s.id = y.salon_id
   where y.created_at > v_depuis and s.ferme_le is null and y.ptk is not null and y.tk - y.ptk <> y.num - y.pnum
   group by y.salon_id;
end $fn$;
revoke all on function lx_prive.a_reparer_brut(integer) from public, anon, authenticated;

-- 4. RPC « À réparer » ------------------------------------------------------------
drop function if exists public.admin_a_reparer(integer);
create or replace function public.admin_a_reparer(p_heures integer default 72)
returns table(signature text, niveau text, categorie text, titre text, explication text, action text,
              nombre integer, premiere timestamptz, derniere timestamptz, salons text[], exemple text)
language plpgsql stable security definer
set search_path = public, lx_prive, pg_temp
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  return query
    select b.* from lx_prive.a_reparer_brut(p_heures) b
     where not exists (select 1 from public.admin_acquittements a where a.signature = b.signature and a.traite_le >= b.derniere)
     order by case b.niveau when 'grave' then 0 else 1 end, b.derniere desc nulls last;
end $$;
revoke all on function public.admin_a_reparer(integer) from public, anon;
grant execute on function public.admin_a_reparer(integer) to authenticated;

-- 5. « Marquer comme traité » ------------------------------------------------------
create or replace function public.admin_acquitter(p_signature text, p_titre text default null)
returns boolean language plpgsql volatile security definer
set search_path = public, pg_temp
as $$
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  if coalesce(p_signature,'') !~ '^[0-9a-f]{32}$' then raise exception 'Signature invalide'; end if;
  insert into public.admin_acquittements(signature, traite_le, traite_par, titre)
  values (p_signature, now(), (select email from auth.users where id = auth.uid()), left(p_titre, 200))
  on conflict (signature) do update set traite_le = excluded.traite_le, traite_par = excluded.traite_par, titre = coalesce(excluded.titre, admin_acquittements.titre);
  return true;
end $$;
revoke all on function public.admin_acquitter(text, text) from public, anon;
grant execute on function public.admin_acquitter(text, text) to authenticated;

-- 6. État NF525 -------------------------------------------------------------------
create or replace function lx_prive.nf525_ligne(p_code text, p_libelle text, p_verdict text, p_explication text)
returns jsonb language sql immutable set search_path = pg_catalog, pg_temp as $$
  select jsonb_build_object('code', p_code, 'libelle', p_libelle, 'verdict', p_verdict,
    'icone', case p_verdict when 'ok' then '✅' when 'attention' then '⚠️' else '❌' end, 'explication', p_explication)
$$;

create or replace function public.admin_nf525_etat()
returns jsonb
language plpgsql stable security definer
set search_path = public, lx_prive, extensions, pg_temp
as $fn$
declare
  -- Version majeure du logiciel (aligner sur LX_ATT.versionMajeure / LX_VERSION de app.html à chaque version majeure)
  v_majeure constant text := '6';
  v_coupure_test constant timestamptz := '2026-10-12 20:00:00+00';
  v_auj date := (now() at time zone 'Europe/Paris')::date;
  v_glob jsonb := '[]'::jsonb; v_sal jsonb := '[]'::jsonb; l jsonb; v_l jsonb;
  v_vs jsonb; v_t record; v_n int; v_n2 int; v_n3 int; v_txt text; v_ts timestamptz; v_d date; v_num numeric; v_num2 numeric;
  s record; v_pire text; v_glob_pire text := 'ok';
  v_cfi jsonb; v_cdi jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;

  select coalesce(jsonb_agg(to_jsonb(f)), '[]'::jsonb) into v_cfi from public.check_fiscal_integrity() f;
  select coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) into v_cdi from public.check_data_integrity() c;
  v_vs := public.verify_nf525_status();

  ----------------------------------------------------------------- GLOBAL
  -- G1. Tests nocturnes des protections (résultat stocké : la fonction n'est pas relancée ici)
  select * into v_t from nf525_tests_nuit order by run_at desc limit 1;
  if not found then
    l := nf525_ligne('tests_nuit', 'Tests de nuit des protections', 'ko', 'Aucun test de nuit enregistré.');
  elsif not v_t.ok then
    select string_agg(x, ' ; ') into v_txt from jsonb_array_elements_text(v_t.resultats) x where x ~* 'ACCEPT';
    l := nf525_ligne('tests_nuit', 'Tests de nuit des protections', 'ko',
      'Dernier test le ' || to_char(v_t.run_at at time zone 'Europe/Paris','DD/MM à HH24:MI') || ' : une protection a laissé passer une modification (' || coalesce(v_txt,'voir le détail') || ').');
  elsif v_t.run_at < now() - interval '26 hours' then
    l := nf525_ligne('tests_nuit', 'Tests de nuit des protections', 'attention',
      'Dernier test réussi le ' || to_char(v_t.run_at at time zone 'Europe/Paris','DD/MM à HH24:MI') || ', mais le test de cette nuit n''a pas tourné.');
  else
    l := nf525_ligne('tests_nuit', 'Tests de nuit des protections', 'ok',
      'Test du ' || to_char(v_t.run_at at time zone 'Europe/Paris','DD/MM à HH24:MI') || ' : ' || jsonb_array_length(v_t.resultats)
      || ' tentatives de modification/suppression, toutes refusées comme prévu.');
  end if;
  v_glob := v_glob || l;

  -- G2. Déclencheurs d'inaltérabilité (verify_nf525_status)
  v_n := coalesce((v_vs->'inalterabilite'->>'triggers_actifs')::int, 0); v_n2 := coalesce((v_vs->'inalterabilite'->>'triggers_attendus')::int, 9);
  v_glob := v_glob || nf525_ligne('inalterabilite', 'Verrous d''inaltérabilité', case when v_n >= v_n2 then 'ok' else 'ko' end,
    v_n || ' verrou(s) actif(s) sur ' || v_n2 || ' (tickets, clôtures, archives, journal, factures).');

  -- G3. Autocontrôle des signatures (03:40) + alertes de signature
  select max(d.start_time) filter (where d.status = 'succeeded') into v_ts
    from cron.job_run_details d join cron.job c on c.jobid = d.jobid where c.jobname = 'nf525-verif-quotidienne';
  select count(*) into v_n from audit_log a where a.action = 'NF525_SIGNATURE_KO' and a.timestamp_action > greatest(v_coupure_test, now() - interval '7 days');
  v_glob := v_glob || nf525_ligne('autocontrole', 'Autocontrôle des signatures (chaque nuit)',
    case when v_n > 0 then 'ko' when v_ts is null or v_ts < now() - interval '26 hours' then 'attention' else 'ok' end,
    case when v_n > 0 then v_n || ' signature(s) en défaut sur 7 jours : voir « À réparer ».'
         when v_ts is null then 'Le contrôle de nuit n''a pas tourné ces 7 derniers jours.'
         else 'Lancé le ' || to_char(v_ts at time zone 'Europe/Paris','DD/MM à HH24:MI') || ', aucune signature en défaut sur 7 jours.' end);

  -- G4. Clé de signature
  select count(*) into v_n from nf525_cles k where k.active;
  v_glob := v_glob || nf525_ligne('cle', 'Clé de signature électronique', case when v_n = 1 then 'ok' else 'ko' end,
    case when v_n = 1 then 'Une clé active (ECDSA P-256).' else v_n || ' clé(s) active(s) : il en faut exactement une.' end);

  -- G5. Ancrage externe quotidien
  select max(a.jour) into v_d from nf525_ancrages a;
  v_glob := v_glob || nf525_ligne('ancrage', 'Empreinte quotidienne envoyée hors base', case when v_d >= v_auj - 1 then 'ok' else 'attention' end,
    coalesce('Dernière empreinte : ' || to_char(v_d,'DD/MM/YYYY') || '.', 'Aucune empreinte envoyée.'));

  -- G6. Attestation éditeur (volet 1)
  select * into v_t from nf525_attestation_editeur e where e.version_majeure = v_majeure order by e.signe_le desc limit 1;
  v_n := case when found then 1 else 0 end;
  v_glob := v_glob || nf525_ligne('attestation_editeur', 'Attestation éditeur (version ' || v_majeure || ')', case when v_n = 0 then 'ko' else 'ok' end,
    case when v_n = 0 then 'Pas encore signée pour la version majeure ' || v_majeure || ' : à signer dans l''admin.'
         else 'Signée le ' || to_char(v_t.signe_le at time zone 'Europe/Paris','DD/MM/YYYY') || ' par ' || v_t.signataire || '.' end);

  -- G7. Conservation : aucune purge programmée + inventaire quotidien sans baisse inexpliquée
  select count(*) into v_n from (
    select i.snapshot_at, i.nb_tickets, lag(i.nb_tickets) over (order by i.snapshot_at) as p,
           i.nb_clotures, lag(i.nb_clotures) over (order by i.snapshot_at) as pc
      from nf525_inventory_snapshots i where i.snapshot_at > now() - interval '30 days') x
   where (x.nb_tickets < x.p or x.nb_clotures < x.pc)
     and not exists (select 1 from nf525_archives_purge p where p.created_at between x.snapshot_at - interval '36 hours' and x.snapshot_at);
  v_glob := v_glob || nf525_ligne('conservation', 'Conservation des données (6 ans)',
    case when coalesce((v_vs->'conservation'->>'ok')::boolean, false) is not true then 'ko' when v_n > 0 then 'ko' else 'ok' end,
    case when coalesce((v_vs->'conservation'->>'ok')::boolean, false) is not true then 'Une tâche programmée efface des données fiscales !'
         when v_n > 0 then v_n || ' baisse(s) du nombre de tickets/clôtures sur 30 jours sans réinitialisation d''essai archivée.'
         else 'Aucune purge programmée ; l''inventaire de chaque nuit ne baisse jamais (sauf réinitialisations d''essai archivées).' end);

  ----------------------------------------------------------------- PAR ÉTABLISSEMENT
  for s in
    select x.* from salons x
     where x.ferme_le is null or exists (select 1 from tickets t where t.salon_id = x.id)
     order by (x.mode_caisse = 'reel') desc, x.nom
  loop
    v_l := '[]'::jsonb;

    -- S1. Mode de caisse
    v_l := v_l || nf525_ligne('mode', 'Mode de caisse',
      case when s.mode_caisse = 'test' and s.status = 'active' then 'attention' else 'ok' end,
      case when s.mode_caisse = 'reel' then 'Caisse réelle' || coalesce(' depuis le ' || to_char(s.mode_reel_depuis at time zone 'Europe/Paris','DD/MM/YYYY'), '') || '.'
           when s.status = 'active' then 'Abonnement payant mais caisse encore en mode test : le passage en réel aurait dû se faire.'
           else 'Mode test (période d''essai) : tickets marqués TEST, sans valeur fiscale. Normal.' end);

    select count(*) into v_n from tickets t where t.salon_id = s.id;
    if v_n = 0 then
      v_l := v_l || nf525_ligne('ventes', 'Ventes', 'ok', 'Aucune vente enregistrée : rien à contrôler.');
    else
      -- S2. Numérotation fiscale (serveur)
      select count(*) filter (where x.p is not null and x.num > x.p + 1), count(*) filter (where x.num = x.p), min(x.num), max(x.num)
        into v_n, v_n2, v_num, v_num2
        from (select t.num, lag(t.num) over (order by t.num) as p from tickets t where t.salon_id = s.id) x;
      v_l := v_l || nf525_ligne('numerotation', 'Numérotation des tickets', case when v_n + v_n2 = 0 then 'ok' else 'ko' end,
        case when v_n + v_n2 = 0 then 'Continue, sans trou ni doublon (n° ' || v_num || ' à ' || v_num2 || ').'
             else v_n || ' trou(s) et ' || v_n2 || ' doublon(s) dans la numérotation (n° ' || v_num || ' à ' || v_num2 || ').' end);

      -- S2 bis. Numéros imprimés
      select count(*) filter (where y.ptk is not null and y.tk - y.ptk <> y.num - y.pnum),
             count(*) filter (where y.ptk is not null and y.tk - y.ptk <> y.num - y.pnum and y.created_at > now() - interval '30 days')
        into v_n, v_n2
        from (select y0.*, lag(y0.tk) over (order by y0.num) as ptk, lag(y0.num) over (order by y0.num) as pnum
                from (select t.num, t.created_at, (t.raw_data->>'tkNum')::int as tk from tickets t
                       where t.salon_id = s.id and t.raw_data->>'tkNum' ~ '^[0-9]+$') y0) y;
      v_l := v_l || nf525_ligne('numeros_imprimes', 'Numéros imprimés sur les tickets', case when v_n2 > 0 then 'attention' else 'ok' end,
        case when v_n = 0 then 'Se suivent sans saut.'
             when v_n2 > 0 then v_n2 || ' saut(s) ou doublon(s) sur les 30 derniers jours.'
             else 'Se suivent ; ' || v_n || ' irrégularité(s) de plus de 30 jours (déjà connues, non modifiables, sans effet sur le numéro fiscal qui reste continu).' end);

      -- S3. Chaîne des tickets (hash_prev) — check_fiscal_integrity
      select count(*) filter (where e->>'anomaly_type' = 'NF525_CHAINE_ROMPUE'), count(*) filter (where e->>'anomaly_type' = 'NF525_HASH_MANQUANT')
        into v_n, v_n2 from jsonb_array_elements(v_cfi) e where e->>'salon_id' = s.id::text;
      v_l := v_l || nf525_ligne('chaine', 'Chaînage des tickets (empreintes)', case when v_n + v_n2 = 0 then 'ok' else 'ko' end,
        case when v_n + v_n2 = 0 then 'Chaque ticket est scellé et relié au précédent.'
             else v_n || ' rupture(s) de chaîne, ' || v_n2 || ' ticket(s) sans empreinte.' end);

      -- S4. Double scellement recalculé + tickets modifiés après scellement
      select count(*) into v_n from (
        select h.chain_index, h.chain_prev_hash, h.chain_hash, h.canonical_sha256 as cs, h.row_snapshot_sha256 as ss, h.canonical_data, h.row_snapshot,
               lag(h.canonical_sha256) over w as pc, lag(h.row_snapshot_sha256) over w as ps
          from nf525_hash_seal h where h.salon_id = s.id window w as (order by h.chain_index)) g
       where g.cs <> upper(encode(digest(g.canonical_data::bytea, 'sha256'), 'hex'))
          or g.ss <> upper(encode(digest(g.row_snapshot::text::bytea, 'sha256'), 'hex'))
          or (g.pc is not null and g.chain_prev_hash is distinct from upper(encode(digest((g.pc || '|' || g.ps)::bytea, 'sha256'), 'hex')))
          or g.chain_hash <> upper(encode(digest((g.chain_index::text || '|' || g.cs || '|' || g.ss || '|' || coalesce(g.pc,'') || '|' || coalesce(g.ps,''))::bytea, 'sha256'), 'hex'));
      select count(*) filter (where not x.trace), count(*) filter (where x.trace), string_agg(case when x.trace then '#' || x.num end, ', ')
        into v_n2, v_n3, v_txt
        from (select t.num, exists (select 1 from audit_log a where a.salon_id = t.salon_id and a.action like 'CORRECTION_REGLEMENT%'
                                      and a.details like 'Ticket #' || t.num || ' %') as trace
                from tickets t join nf525_hash_seal h on h.source_table = 'tickets' and h.source_id = t.id
               where t.salon_id = s.id
                 and regexp_replace(h.canonical_data, '\|[^|]*$', '') <> 'TK|' || t.num || '|' || to_char(t.date_ticket,'YYYY-MM-DD') || '|' || to_char(t.heure_ticket,'HH24:MI') || '|' || to_char(t.total_ttc,'FM999999990.00') || '|' || coalesce(t.mode_paiement,'') || '|' || coalesce(t.hash_prev,'')) x;
      select count(*) into v_num from tickets t where t.salon_id = s.id and coalesce(t.hash,'') <> ''
         and not exists (select 1 from nf525_hash_seal h where h.source_table = 'tickets' and h.source_id = t.id);
      v_l := v_l || nf525_ligne('scellement', 'Double scellement (recalculé)', case when v_n + v_n2 + v_num = 0 then 'ok' else 'ko' end,
        case when v_n + v_n2 + v_num = 0 then 'Registre de scellement recalculé : intact.'
               || case when v_n3 > 0 then ' ' || v_n3 || ' ticket(s) au moyen de paiement corrigé avant clôture, tracé(s) au journal (' || v_txt || ') : normal.' else '' end
             else v_n || ' maillon(s) en défaut, ' || v_n2 || ' ticket(s) modifié(s) sans trace, ' || v_num || ' ticket(s) non scellé(s).' end);

      -- S5. Signatures électroniques
      select count(*) filter (where x.p is not null and x.seq <> x.p + 1) + count(*) filter (where x.p is not null and coalesce(x.prev_signature,'') <> coalesce(x.psig,''))
        into v_n
        from (select g.seq, g.prev_signature, lag(g.seq) over w as p, lag(g.signature) over w as psig
                from nf525_signatures g where g.salon_id = s.id window w as (partition by g.type order by g.seq)) x;
      select (select count(*) from tickets t where t.salon_id = s.id and t.created_at < now() - interval '15 minutes'
                and not exists (select 1 from nf525_signatures g where g.source_id = t.id and g.type = 'TK'))
           + (select count(*) from clotures c where c.salon_id = s.id and c.created_at < now() - interval '15 minutes'
                and not exists (select 1 from nf525_signatures g where g.source_id = c.id and g.type = 'Z'))
        into v_n2;
      select count(*) into v_n3 from audit_log a where a.salon_id = s.id and a.action = 'NF525_SIGNATURE_KO' and a.timestamp_action > v_coupure_test;
      v_l := v_l || nf525_ligne('signatures', 'Signatures électroniques', case when v_n + v_n3 > 0 then 'ko' when v_n2 > 0 then 'attention' else 'ok' end,
        case when v_n + v_n3 > 0 then v_n || ' rupture(s) de séquence/chaînage, ' || v_n3 || ' signature(s) signalée(s) invalide(s).'
             when v_n2 > 0 then v_n2 || ' ticket(s)/clôture(s) pas encore signé(s) après 15 min (signature toutes les 2 min).'
             else 'Tous les tickets et clôtures sont signés, séquences continues.' end);

      -- S6. JET (journal des événements)
      select count(*) filter (where x.p is not null and x.seq <> x.p + 1) into v_n
        from (select j.seq, lag(j.seq) over (order by j.seq) as p from nf525_jet j where j.salon_id = s.id) x;
      select count(*) into v_n2 from nf525_jet j where j.salon_id = s.id and j.code = 90 and j.horodatage > v_coupure_test;
      v_l := v_l || nf525_ligne('jet', 'Journal des événements (JET)', case when v_n + v_n2 > 0 then 'ko' else 'ok' end,
        case when v_n > 0 then v_n || ' saut(s) dans la séquence du journal.'
             when v_n2 > 0 then v_n2 || ' anomalie(s) d''intégrité inscrite(s) au journal (code 90) depuis le 12/10.'
             else 'Séquence continue, aucune anomalie d''intégrité inscrite depuis le 12/10.' end);

      -- S7. Clôtures Z
      select c.date_cloture, c.num into v_d, v_n from clotures c where c.salon_id = s.id order by c.date_cloture desc, c.num desc limit 1;
      select count(*), string_agg(to_char(x.dt,'DD/MM'), ', ' order by x.dt) into v_n2, v_txt
        from (select distinct t.date_ticket as dt from tickets t where t.salon_id = s.id and t.date_ticket < v_auj
                 and not exists (select 1 from clotures c where c.salon_id = s.id and c.date_cloture = t.date_ticket)) x;
      select count(*) into v_n3 from jsonb_array_elements(v_cfi) e where e->>'salon_id' = s.id::text and e->>'anomaly_type' = 'CLOTURE_ECART_JOURNAL';
      v_l := v_l || nf525_ligne('clotures_z', 'Clôtures Z journalières', case when v_n2 + v_n3 > 0 then 'ko' else 'ok' end,
        coalesce('Dernière Z n°' || v_n || ' du ' || to_char(v_d,'DD/MM/YYYY') || '. ', 'Aucune Z. ')
        || case when v_n2 > 0 then v_n2 || ' journée(s) avec ventes sans Z : ' || left(v_txt, 120) || '. ' else 'Aucune journée avec ventes sans Z. ' end
        || case when v_n3 > 0 then v_n3 || ' Z différente(s) du journal des tickets.' else 'Chaque Z égale la somme de ses tickets.' end);

      -- S8. Clôtures mensuelles / annuelles
      select count(*), string_agg(x.m, ', ' order by x.m) into v_n, v_txt
        from (select distinct to_char(c.date_cloture,'YYYY-MM') as m, extract(year from c.date_cloture)::int as a, extract(month from c.date_cloture)::int as mo
                from clotures c where c.salon_id = s.id and c.date_cloture < date_trunc('month', v_auj)::date) x
       where not exists (select 1 from clotures_mensuelles cm where cm.salon_id = s.id and cm.annee = x.a and cm.mois = x.mo)
         and not (x.m = to_char(v_auj - interval '1 month','YYYY-MM') and extract(day from v_auj) = 1);
      select count(*) into v_n2 from jsonb_array_elements(v_cdi) e where e->>'out_salon_id' = s.id::text and e->>'anomaly_type' like 'CUMUL_%';
      select count(*) into v_n3 from (select distinct cm.annee from clotures_mensuelles cm where cm.salon_id = s.id and cm.annee < extract(year from v_auj)::int) y
       where not exists (select 1 from clotures_annuelles ca where ca.salon_id = s.id and ca.annee = y.annee);
      select max(cm.annee * 100 + cm.mois) into v_num from clotures_mensuelles cm where cm.salon_id = s.id;
      v_l := v_l || nf525_ligne('clotures_periodiques', 'Clôtures mensuelles et annuelles',
        case when v_n2 > 0 then 'ko' when v_n + v_n3 > 0 then 'attention' else 'ok' end,
        coalesce('Dernier mois clôturé : ' || lpad((v_num % 100)::int::text, 2, '0') || '/' || floor(v_num / 100)::int || '. ', 'Aucun mois clôturé pour l''instant. ')
        || case when v_n > 0 then 'Mois sans clôture mensuelle : ' || v_txt || '. ' else '' end
        || case when v_n3 > 0 then v_n3 || ' année(s) sans clôture annuelle. ' else '' end
        || case when v_n2 > 0 then v_n2 || ' cumul(s) incohérent(s) avec les Z.' else 'Cumuls cohérents avec les Z.' end);

      -- S9. Exercice comptable
      v_d := (make_date(extract(year from v_auj)::int, greatest(1, least(coalesce(s.exercice_fin_mois, 12), 12)), 1) + interval '1 month' - interval '1 day')::date;
      if v_d >= v_auj then v_d := (v_d - interval '1 year')::date; end if;
      select min(t.date_ticket) into v_ts from tickets t where t.salon_id = s.id;
      if v_ts::date <= v_d and not exists (select 1 from clotures_exercices e where e.salon_id = s.id and e.date_fin = v_d) and v_auj > v_d + 2 then
        v_l := v_l || nf525_ligne('exercice', 'Clôture d''exercice', 'attention', 'L''exercice terminé le ' || to_char(v_d,'DD/MM/YYYY') || ' n''a pas de clôture d''exercice.');
      else
        v_l := v_l || nf525_ligne('exercice', 'Clôture d''exercice', 'ok',
          'Exercice en cours jusqu''au ' || to_char((case when v_d < v_auj then v_d + interval '1 year' else v_d end)::date, 'DD/MM/YYYY') || ' ; aucune clôture d''exercice en retard.');
      end if;

      -- S10. Grand total perpétuel
      select c.cumul_perpetuel_ca, c.date_cloture, c.num into v_num, v_d, v_n from clotures c where c.salon_id = s.id order by c.date_cloture desc, c.num desc limit 1;
      select coalesce(sum(t.total_ttc), 0) into v_num2 from tickets t where t.salon_id = s.id and t.date_ticket <= v_d;
      v_l := v_l || nf525_ligne('grand_total', 'Grand total perpétuel',
        case when v_d is null then 'ok' when v_num is null then 'attention' when abs(round(v_num, 2) - v_num2) <= 0.01 then 'ok' else 'ko' end,
        case when v_d is null then 'Pas encore de Z : rien à comparer.'
             when v_num is null then 'Grand total absent de la dernière Z.'
             else 'Z n°' || v_n || ' : ' || to_char(round(v_num, 2),'FM999999990.00') || ' € ; somme des tickets : ' || to_char(v_num2,'FM999999990.00') || ' €'
                  || case when abs(round(v_num, 2) - v_num2) <= 0.01 then ' — identiques.' else ' — ÉCART.' end end);

      -- S11. Archives
      select max(a.horodatage) into v_ts from nf525_archives_signees a where a.salon_id = s.id;
      select max(a.annee) into v_n from archives a where a.salon_id = s.id;
      v_l := v_l || nf525_ligne('archives', 'Archives signées', 'ok',
        coalesce('Dernière archive signée le ' || to_char(v_ts at time zone 'Europe/Paris','DD/MM/YYYY') || '. ', 'Aucune archive manuelle. ')
        || coalesce('Archive annuelle ' || v_n || ' faite.', 'Archive annuelle automatique le 1er février.'));
    end if;

    -- S12. Attestation de l'établissement (volet 2)
    select count(*) into v_n from nf525_attestations a where a.salon_id = s.id and a.version_majeure = v_majeure;
    v_l := v_l || nf525_ligne('attestation', 'Attestation de l''établissement',
      case when v_n > 0 then 'ok' when s.mode_caisse = 'reel' then 'attention' else 'ok' end,
      case when v_n > 0 then 'Signée (version ' || v_majeure || ').'
           when s.mode_caisse = 'reel' then 'Pas encore signée dans l''application (Paramètres → Caisse → Conformité → Mon attestation).'
           else 'À signer lors du passage en caisse réelle.' end);

    select case when bool_or(x->>'verdict' = 'ko') then 'ko' when bool_or(x->>'verdict' = 'attention') then 'attention' else 'ok' end
      into v_pire from jsonb_array_elements(v_l) x;
    if v_pire = 'ko' or (v_pire = 'attention' and v_glob_pire = 'ok') then v_glob_pire := v_pire; end if;
    v_sal := v_sal || jsonb_build_object('salon_id', s.id, 'nom', s.nom, 'mode_caisse', s.mode_caisse, 'statut', s.status,
      'ferme', s.ferme_le is not null, 'verdict', v_pire,
      'icone', case v_pire when 'ok' then '✅' when 'attention' then '⚠️' else '❌' end, 'lignes', v_l);
  end loop;

  select case when bool_or(x->>'verdict' = 'ko') or v_glob_pire = 'ko' then 'ko'
              when bool_or(x->>'verdict' = 'attention') or v_glob_pire = 'attention' then 'attention' else 'ok' end
    into v_pire from jsonb_array_elements(v_glob) x;

  return jsonb_build_object('verdict', v_pire, 'icone', case v_pire when 'ok' then '✅' when 'attention' then '⚠️' else '❌' end,
    'global', v_glob, 'salons', v_sal, 'genere_le', now());
end $fn$;
revoke all on function public.admin_nf525_etat() from public, anon;
grant execute on function public.admin_nf525_etat() to authenticated;
