-- Luxyra — 31/10/2026 — audit sécurité admin (C1, complément) : la « source » d'une erreur (choisie librement par
-- l'appelant, y compris anonyme) sert à construire la signature affichée dans le Monitoring de l'admin.
-- On y neutralise < > " ' ` et tous les caractères de contrôle, et on la borne à 120 caractères.
-- Le message reste tel quel (l'admin l'échappe à l'affichage). Hors périmètre fiscal.
do $m$
declare d text;
begin
  d := pg_get_functiondef('public.report_server_error(text,text,text,text,jsonb,uuid,text,text,integer,text)'::regprocedure);
  if position('left(coalesce(p_source, ''inconnu''), 200)' in d) = 0 then
    if position('lx_source_propre' in d) > 0 then raise notice 'déjà appliqué'; return; end if;
    raise exception 'ancre introuvable';
  end if;
  d := replace(d, 'left(coalesce(p_source, ''inconnu''), 200)',
    '/* lx_source_propre 31/10 */ left(regexp_replace(coalesce(nullif(p_source, ''''), ''inconnu''), E''[<>"''''`\\x01-\\x1f\\x7f]'', ''_'', ''g''), 120)');
  execute d;
end $m$;
