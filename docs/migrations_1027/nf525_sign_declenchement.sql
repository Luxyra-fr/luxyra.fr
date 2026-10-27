-- Luxyra — 2026-10-27 — Déclenchement du robot de signature NF525 (accord d'Alexandre le 27/10 : « fais ces points 1 puis 2 »)
-- Problème : la tâche nf525-sign-2min appelait la fonction nf525-sign toutes les 2 min pour tous les établissements, même sans
-- rien à signer (~200 requêtes par passage, ~70 000 lectures de nf525_signatures/jour, 98 % du trafic sortant, quota FREE dépassé).
-- Correctif : la fonction nf525-sign N'EST PAS MODIFIÉE (mêmes données signées, même clé, même chaînage). Seul son déclenchement change :
--   * toutes les 2 min, appel UNIQUEMENT si lx_prive.nf525_signature_en_attente() trouve un enregistrement sans signature
--     (mêmes 11 sources, mêmes statuts d'établissement que la fonction ; tickets : scellés uniquement) ou un établissement sans
--     signature avec la clé active (JET 450) ;
--   * filet de sécurité : passage complet toutes les heures (minute 7) quoi qu'il arrive.
-- Étapes du 27/10 : 18h50 fréquence 2 -> 10 min (point 1, provisoire) ; puis ce script ; fréquence remise à 2 min.
-- Vérifié : fonction 6-7 ms à chaud ; détection testée (simulation en excluant la dernière signature TK puis JET : 1 détectée chacune).

create or replace function lx_prive.nf525_signature_en_attente(p_detail boolean default false)
returns jsonb language plpgsql stable security definer set search_path to 'public','pg_temp' as $f$
-- v2 (revue experte 27/10) : exists au lieu de count (coût constant) ; toute erreur => a_signer = true (on appelle, jamais de signature oubliée)
declare r jsonb := '{}'::jsonb; t text; n int; b boolean; v_key text; n_cle int; v_total int := 0;
begin
  foreach t in array array['tickets','clotures','clotures_mensuelles','clotures_annuelles','clotures_exercices','corrections_reglement','nf525_duplicatas','nf525_jet','factures_clients','nf525_archives_signees','clotures_annotations'] loop
    if p_detail then
      execute format($q$select count(*) from public.%I x join public.salons s on s.id = x.salon_id
        where s.status in ('active','trial','past_due','cancelled','archived')
          and not exists (select 1 from public.nf525_signatures g where g.source_table = %L and g.source_id = x.id) %s $q$,
        t, t, case when t = 'tickets' then 'and x.hash is not null' else '' end) into n;
      if n > 0 then r := r || jsonb_build_object(t, n); v_total := v_total + n; end if;
    else
      execute format($q$select exists (select 1 from public.%I x join public.salons s on s.id = x.salon_id
        where s.status in ('active','trial','past_due','cancelled','archived')
          and not exists (select 1 from public.nf525_signatures g where g.source_table = %L and g.source_id = x.id) %s) $q$,
        t, t, case when t = 'tickets' then 'and x.hash is not null' else '' end) into b;
      if b then return jsonb_build_object('a_signer', true, 'detail', jsonb_build_object(t, 1)); end if;
    end if;
  end loop;
  select key_id into v_key from public.nf525_cles where active order by created_at desc limit 1;
  select count(*) into n_cle from public.salons s where s.status in ('active','trial','past_due','cancelled','archived')
     and not exists (select 1 from public.nf525_signatures g where g.salon_id = s.id and g.key_id = v_key);
  if n_cle > 0 then r := r || jsonb_build_object('salons_sans_cle', n_cle); v_total := v_total + n_cle; end if;
  return jsonb_build_object('a_signer', v_total > 0, 'detail', r);
exception when others then
  return jsonb_build_object('a_signer', true, 'erreur', SQLERRM);
end $f$;
revoke all on function lx_prive.nf525_signature_en_attente(boolean) from public, anon, authenticated;

select cron.alter_job(37, schedule := '*/2 * * * *', command := $c$
  SELECT net.http_post(
    url := 'https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/nf525-sign',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='avis_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000)
  WHERE (lx_prive.nf525_signature_en_attente(false)->>'a_signer')::boolean;$c$);
select cron.schedule('nf525-sign-filet-horaire', '7 * * * *', $c$
  SELECT net.http_post(
    url := 'https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/nf525-sign',
    headers := jsonb_build_object('Content-Type','application/json','x-cron-secret',(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='avis_cron_secret')),
    body := '{}'::jsonb, timeout_milliseconds := 120000);$c$);
-- Retour arrière (1 commande) : remettre la commande d'origine sans la clause WHERE dans cron.alter_job(37, command := ...).
