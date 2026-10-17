-- =====================================================================================================
-- 2026-10-17 (soir) — STOP SMS : l'opposition reste chez Luxyra, les rappels de RDV continuent
-- APPLIQUÉ le 17/10/2026 (base kxdgjtvrkwugbifgppai). Complète docs/migrations_1017/sms_stop_creneaux.sql.
-- =====================================================================================================
-- Constat réel du 17/10/2026 19 h (numéro de test ...6172, salon e0cf27c7) :
--   17:16 SMS publicitaire « STOP au [STOP_CODE] » (message 8746405761196172) livré ;
--   17:17 réponse STOP -> accusé Brevo « unsubscribed » -> lx_sms_stop (source brevo_accuse) ;
--   17:19 rappel transactionnel (message 6058006860145686) : Brevo répond 201 + messageId, puis son accusé
--         arrive 3 s plus tard avec msg_status = "bl" (événement « Blacklisted » des webhooks SMS Brevo) :
--         le SMS n'est jamais parti. sms_envois.dernier_evenement = 'bl', statut resté 'envoye', non remboursé.
-- Sources Brevo :
--   help.brevo.com 209458705 (types de blocklist) : un contact qui se désinscrit « en répondant à vos SMS
--     transactionnels » est blocklisté des SMS transactionnels -> « won't receive any of your transactional SMS ».
--     Nos SMS publicitaires partent par l'API transactionnelle (/v3/transactionalSMS/send) : le STOP tombe donc
--     dans la blocklist « SMS transactionnels » du compte unique Luxyra -> plus aucun rappel, tous salons.
--   help.brevo.com 5311015528594 : cette liste se trouve dans Paramètres > SMS transactionnels > Contacts bloqués.
--   help.brevo.com 5317448358034 : déblocage manuel contact par contact (fiche contact > Préférences >
--     « SMS transactionnels : Approuvé / Bloqué ») ; pas de déblocage en masse ; débloquer quelqu'un qui a
--     demandé à ne plus être contacté est « illégal » et peut entraîner la suspension du compte.
--   developers.brevo.com update-contact : PUT /v3/contacts/{SMS}?identifierType=phone_id {"smsBlacklisted":false}
--     (seul déblocage SMS documenté ; get-contact-info décrit smsBlacklisted comme le statut des « SMS campaigns »).
--     DELETE /v3/smtp/blockedContacts/{email} ne concerne que les e-mails. AUCUNE API documentée pour la liste
--     « SMS transactionnels > Contacts bloqués ».
--   developers.brevo.com transactional-webhooks : événement « Blacklisted » (msg_status "bl").
--
-- Notre position (documentée dans l'aide et le bot) :
--   * le STOP vaut opposition à la PROSPECTION par SMS : Luxyra le garde dans lx_sms_stop et refuse tout SMS
--     publicitaire vers ce numéro, de tous les salons (worker /api/sms/custom 409 « stop », file SQL « obsolete »),
--     sans limite de durée, tant que le client ne répond pas START. Le STOP est donc respecté pour ce qu'il vise ;
--   * les SMS strictement transactionnels (rappel, confirmation, modification, annulation d'un RDV pris par le
--     client) ne sont pas de la prospection : le worker lève le blocage Brevo (déblocage documenté ci-dessus)
--     pour qu'ils continuent. Pour couper aussi les rappels : case « Accepte les SMS » de la fiche (sms_ok) ;
--   * si Brevo bloque malgré tout un rappel (accusé "bl") pour un numéro en lx_sms_stop, le SMS est remboursé
--     au salon et l'admin est alerté avec la marche à suivre (déblocage manuel dans Brevo) ;
--   * solution de fond, sans aucun déblocage : variable worker BREVO_API_KEY_MARKETING = clé d'un compte (ou
--     sous-compte) Brevo dédié aux SMS publicitaires -> les STOP n'atteignent plus le compte des rappels.
-- =====================================================================================================
set lock_timeout = '8s';

-- 1. Suivi du déblocage Brevo par numéro
alter table public.lx_sms_stop add column if not exists brevo_debloque_le timestamptz;
alter table public.lx_sms_stop add column if not exists brevo_resultat text;
comment on column public.lx_sms_stop.brevo_debloque_le is
  '2026-10-17 : date à laquelle le worker a levé le blocage SMS chez Brevo (pour que les rappels de RDV continuent). '
  'L''opposition aux SMS publicitaires reste active tant que la ligne existe.';

-- 2. Levées d'opposition (START, réinscription admin) : empêche le rattrapage quotidien (événements Brevo des
--    2 derniers jours) de recréer un STOP antérieur à la réinscription.
create table if not exists public.lx_sms_stop_levee (
  telephone_norm text primary key,
  leve_le        timestamptz not null default now(),
  source         text,
  details        text
);
alter table public.lx_sms_stop_levee enable row level security;
revoke all on public.lx_sms_stop_levee from anon, authenticated;
comment on table public.lx_sms_stop_levee is
  '2026-10-17 : dernière levée d''opposition STOP par numéro (START du client ou réinscription admin). '
  'Un événement STOP daté d''avant leve_le est ignoré.';

-- 3. lx_sms_stop_enregistrer : + date de l'événement Brevo, + trace pour le salon émetteur, + admin_log
drop function if exists public.lx_sms_stop_enregistrer(text, text, text, uuid, text);
create or replace function public.lx_sms_stop_enregistrer(p_tel text, p_action text, p_source text default null,
                                                          p_salon uuid default null, p_details text default null,
                                                          p_evenement_le timestamptz default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_tel text := public.normalize_phone(p_tel); v_n int := 0; v_nouveau boolean := false; s record;
        v_quand timestamptz := coalesce(p_evenement_le, now()); v_admin boolean := coalesce(p_source, '') like 'admin%';
        v_a_debloquer boolean := false;
begin
  if v_tel is null then return jsonb_build_object('ok', false, 'erreur', 'Numéro invalide'); end if;
  if p_action = 'stop' then
    -- STOP rejoué (rattrapage) mais antérieur à une réinscription : ignoré
    if exists (select 1 from public.lx_sms_stop_levee l where l.telephone_norm = v_tel and l.leve_le >= v_quand) then
      return jsonb_build_object('ok', true, 'action', p_action, 'changement', false, 'ignore', 'anterieur_a_reinscription');
    end if;
    insert into public.lx_sms_stop (telephone_norm, source, salon_id, details)
    values (v_tel, left(p_source, 60), p_salon, left(p_details, 300))
    on conflict (telephone_norm) do nothing;
    get diagnostics v_n = row_count; v_nouveau := v_n > 0;
    if not v_nouveau then
      update public.lx_sms_stop set maj_le = now() where telephone_norm = v_tel;
    end if;
    select (s2.brevo_debloque_le is null) into v_a_debloquer from public.lx_sms_stop s2 where s2.telephone_norm = v_tel;
  elsif p_action = 'start' then
    delete from public.lx_sms_stop where telephone_norm = v_tel;
    get diagnostics v_n = row_count; v_nouveau := v_n > 0;
    insert into public.lx_sms_stop_levee (telephone_norm, leve_le, source, details)
    values (v_tel, greatest(v_quand, now()), left(p_source, 60), left(p_details, 300))
    on conflict (telephone_norm) do update set leve_le = greatest(excluded.leve_le, public.lx_sms_stop_levee.leve_le),
                                               source = excluded.source, details = excluded.details;
  else
    return jsonb_build_object('ok', false, 'erreur', 'Action inconnue');
  end if;
  -- trace dans le journal de chaque salon concerné (fiche avec ce numéro + salon émetteur), une fois par changement
  if v_nouveau then
    for s in select distinct x.salon_id from (
               select c.salon_id from public.clients c
                where c.telephone_norm = v_tel and c.fusionne_dans is null and c.rgpd_anonymise_le is null
               union select p_salon where p_salon is not null) x
              where x.salon_id is not null and exists (select 1 from public.salons z where z.id = x.salon_id) loop
      begin
        insert into public.audit_log (salon_id, action, details, operator_name)
        values (s.salon_id, case when p_action = 'stop' then 'RGPD_SMS_STOP' else 'RGPD_SMS_START' end,
                case when p_action = 'stop'
                     then 'Le numéro ...' || right(v_tel, 4) || ' a répondu STOP : plus aucun SMS publicitaire (campagnes, anniversaire, relance), de tous les établissements Luxyra. Les rappels et confirmations de rendez-vous continuent.'
                     when v_admin
                     then 'Le numéro ...' || right(v_tel, 4) || ' a été réinscrit à sa demande par le support Luxyra : SMS publicitaires de nouveau possibles.'
                     else 'Le numéro ...' || right(v_tel, 4) || ' a répondu START : SMS publicitaires de nouveau possibles.' end,
                case when v_admin then 'Support Luxyra' else 'Auto (réponse SMS Brevo)' end);
      exception when others then null; end;
    end loop;
  end if;
  if v_admin then
    begin
      insert into public.admin_log (action, details, cible, origine, apres)
      values ('SMS_STOP_' || upper(p_action), coalesce(left(p_details, 300), ''), '...' || right(v_tel, 4), 'api',
              jsonb_build_object('changement', v_nouveau, 'source', p_source));
    exception when others then null; end;
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'changement', v_nouveau, 'brevo_a_debloquer', coalesce(v_a_debloquer, false));
end $$;
revoke all on function public.lx_sms_stop_enregistrer(text, text, text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.lx_sms_stop_enregistrer(text, text, text, uuid, text, timestamptz) to service_role;

-- 4. Résultat du déblocage Brevo (appelé par le worker) : colonnes + journal des salons concernés + admin_log
create or replace function public.lx_sms_stop_brevo_resultat(p_tel text, p_ok boolean, p_resultat text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_tel text := public.normalize_phone(p_tel); s record; v_sal uuid;
begin
  if v_tel is null then return jsonb_build_object('ok', false, 'erreur', 'Numéro invalide'); end if;
  update public.lx_sms_stop
     set brevo_debloque_le = case when p_ok then now() else brevo_debloque_le end,
         brevo_resultat = left(p_resultat, 300), maj_le = now()
   where telephone_norm = v_tel
  returning salon_id into v_sal;
  for s in select distinct x.salon_id from (
             select c.salon_id from public.clients c
              where c.telephone_norm = v_tel and c.fusionne_dans is null and c.rgpd_anonymise_le is null
             union select v_sal where v_sal is not null) x
            where x.salon_id is not null and exists (select 1 from public.salons z where z.id = x.salon_id) loop
    begin
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (s.salon_id, case when p_ok then 'SMS_RAPPELS_MAINTENUS' else 'SMS_RAPPELS_A_VERIFIER' end,
              case when p_ok
                   then 'Numéro ...' || right(v_tel, 4) || ' : blocage levé chez l''opérateur SMS pour que les rappels et confirmations de rendez-vous continuent. L''opposition aux SMS publicitaires reste active.'
                   else 'Numéro ...' || right(v_tel, 4) || ' : blocage chez l''opérateur SMS non levé automatiquement (' || coalesce(left(p_resultat, 120), '?') || ') ; le support Luxyra est prévenu.' end,
              'Auto (Luxyra)');
    exception when others then null; end;
  end loop;
  begin
    insert into public.admin_log (action, details, cible, origine, apres)
    values (case when p_ok then 'SMS_BREVO_DEBLOQUE' else 'SMS_BREVO_DEBLOCAGE_ECHEC' end, coalesce(left(p_resultat, 300), ''),
            '...' || right(v_tel, 4), 'api', jsonb_build_object('ok', p_ok));
  exception when others then null; end;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.lx_sms_stop_brevo_resultat(text, boolean, text) from public, anon, authenticated;
grant execute on function public.lx_sms_stop_brevo_resultat(text, boolean, text) to service_role;

comment on table public.lx_sms_stop is
  '2026-10-17 : numéros ayant répondu STOP à un SMS publicitaire Brevo (accusé / webhook / rattrapage quotidien du worker). '
  'Exclus de tous les SMS publicitaires (campagnes, anniversaires, relances) de tous les salons : c''est NOTRE filtre légal. '
  'Le blocage Brevo est levé (brevo_debloque_le) pour que les rappels de RDV (transactionnels) continuent.';

-- -----------------------------------------------------------------------------------------------------
-- 5. Après déploiement du worker — réinscrire le numéro de test (+33631986172) :
--   select net.http_post(url := 'https://luxyra.fr/api/admin/sms-stop',
--     headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
--     body := jsonb_build_object('op','reinscrire','telephone','+33631986172','motif','Propriétaire : fin du test STOP du 17/10/2026'));
--   puis : select status_code, content from net._http_response order by id desc limit 1;
-- -----------------------------------------------------------------------------------------------------
