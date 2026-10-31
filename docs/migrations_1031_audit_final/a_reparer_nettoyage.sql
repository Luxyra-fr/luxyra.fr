-- 2026-10-31 « À réparer » propre (demande d'Alexandre) — surveillance uniquement, rien de la caisse.
-- 1) Une tâche planifiée NOUVELLE (jamais lancée, créée après les tâches déjà actives) n'est plus « qui ne tourne plus »
--    (même règle que admin_taches_nuit, I6). Une ancienne tâche morte reste signalée.
-- 2) « Plusieurs e-mails rejetés » : on compte les vrais rejets (hard_bounce / blocked / adresse invalide) et plus
--    les rebonds temporaires (soft_bounce) ni les adresses de test (*.invalid, example/exemple) : le mot « invalid »
--    du domaine de test était compté à tort.
do $$
declare d text := pg_get_functiondef('lx_prive.a_reparer_brut(integer)'::regprocedure);
  a1 text := '    if v_last is null or v_last < now() - v_gap then';
  b1 text := '    -- 31/10 : tâche nouvelle jamais lancée (jobid plus récent que les tâches déjà actives) = pas encore son heure
    continue when v_last is null and j.jobid >= coalesce((select max(d2.jobid) from cron.job_run_details d2 where d2.start_time < now() - v_gap), 0);
    if v_last is null or v_last < now() - v_gap then';
  a2 text := $q$   where e.source = 'brevo_webhook' and e.message ~* 'hard_bounce|invalid|blocked'$q$;
  b2 text := $q$   where e.source = 'brevo_webhook' and e.message ~* '^Brevo (hard_bounce|blocked|invalid)'
     and e.message !~* '@[^ ]*\.invalid\b|@(example|exemple)\.'$q$;
begin
  if position(b1 in d) = 0 then
    if position(a1 in d) = 0 then raise exception 'motif 1 introuvable'; end if;
    d := replace(d, a1, b1);
  end if;
  if position(b2 in d) = 0 then
    if position(a2 in d) = 0 then raise exception 'motif 2 introuvable'; end if;
    d := replace(d, a2, b2);
  end if;
  execute d;
end $$;

-- Appliqué le 31/10/2026. Les 3 autres éléments de la liste étaient déjà réglés ; acquittés (admin_acquittements) avec la preuve :
--  • Brevo sans clé : nouvelle adresse collée le 31/10, plus aucun appel sans clé depuis 07:42 UTC ;
--  • lx-signup HTTP 502 (10:40 UTC) : nom de destinataire vide refusé par Brevo, corrigé dans le worker à 10:41 UTC (commit 280ba51) ;
--  • Réglages non enregistrés (Luxyra Démo, 26/10) : protection volontaire, un seul cas, rien depuis.
-- Tâche lx_qr_jetons_menage (créée le 31/10) : essai annulé OK, première exécution cette nuit à 04:37 UTC.
-- Résultat : liste « À réparer » vide.
