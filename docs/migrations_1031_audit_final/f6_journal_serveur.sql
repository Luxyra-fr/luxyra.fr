-- 2026-10-31 audit final F6 : journal serveur des actions admin — on comble les trous de l'existant (admin_log).
-- Déjà couvert : déclencheurs automatiques (salons, app_config, demandes_essai, migration_requests, modèles e-mail,
-- base du bot, suivi, parrainages, appareils de notification), journal manuel (admin_journal), routes worker
-- (Stripe, mois offert, SMS STOP, connexion, purge manuelle). Ajouté ici :
--  1) acquittements d'alertes, modération annuaire, déblocage d'opérateur, doublons réaffichés : déclencheur auto ;
--     le déclencheur ne s'exécute QUE pour le compte admin (clause WHEN) : aucun coût pour les établissements ni les imports ;
--  2) masquage renforcé (empreinte de code PIN, IP hachée, jetons, e-mails des demandeurs de l'annuaire) ;
--  3) journal en ajout seul : plus aucun droit UPDATE/DELETE pour anon / authenticated (les politiques le refusaient déjà).
-- Aucune table de caisse / NF525 concernée.
do $$
declare d text := pg_get_functiondef('lx_prive.admin_journal_auto'::regproc);
  a1 text := $q$'p256dh','auth','endpoint','password_hash','contenu','corps'];$q$;
  b1 text := $q$'p256dh','auth','endpoint','password_hash','contenu','corps','pin_hash','ip_hash','token_hash','email_dest'];$q$;
  a2 text := $q$if k = any(v_lourds) or k ~* '(secret|token|password)' then$q$;
  b2 text := $q$if k = any(v_lourds) or k ~* '(secret|token|password)' or (k = 'email' and tg_table_name like 'annuaire_%') then$q$;
  a3 text := $q$coalesce(v_new, v_old) ->> 'cle', coalesce(v_new, v_old) ->> 'salon_id');$q$;
  b3 text := $q$coalesce(v_new, v_old) ->> 'cle', coalesce(v_new, v_old) ->> 'siret', coalesce(v_new, v_old) ->> 'signature', coalesce(v_new, v_old) ->> 'salon_id');$q$;
begin
  if position(b1 in d) > 0 then return; end if;  -- déjà appliqué : script rejouable
  if position(a1 in d)=0 or position(a2 in d)=0 or position(a3 in d)=0 then raise exception 'motif introuvable'; end if;
  d := replace(replace(replace(d, a1, b1), a2, b2), a3, b3);
  execute d;
end $$;

do $$
declare t text;
begin
  foreach t in array array['admin_acquittements','annuaire_etablissements','annuaire_retraits','annuaire_signalements','salon_operateurs','client_duplicate_ignored'] loop
    execute format('drop trigger if exists trg_admin_journal_auto on public.%I', t);
    execute format($f$create trigger trg_admin_journal_auto after insert or update or delete on public.%I
      for each row when (coalesce(auth.jwt() ->> 'email', '') = 'support@luxyra.fr')
      execute function lx_prive.admin_journal_auto()$f$, t);
  end loop;
end $$;

revoke update, delete, truncate on public.admin_log from anon, authenticated;
