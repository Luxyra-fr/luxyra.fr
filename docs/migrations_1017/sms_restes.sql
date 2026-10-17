-- =====================================================================================================
-- 2026-10-17 — SMS publicitaires : restes à corriger (mode « Depuis mon téléphone » + purge désinscriptions)
-- APPLIQUÉ le 17/10/2026 (base kxdgjtvrkwugbifgppai) — voir le bloc TESTS en fin de fichier.
-- =====================================================================================================
-- Ce que fait ce fichier :
--   1. Mode « Depuis mon téléphone » (sms_mode = 'native' : l'app pro écrit dans public.sms_queue, l'application
--      Android « Luxyra SMS Companion » lit les lignes 'pending' et les envoie avec la SIM du téléphone).
--      Déclencheur BEFORE INSERT (et UPDATE du texte / du contexte) sur sms_queue, pour les SMS PUBLICITAIRES
--      seulement (context marketing / anniversaire / relance — jamais rappel_24h, rappel_2h, confirmation_rdv…) :
--        - hors créneau légal (lundi-samedi 8 h - 21 h 30 heure de Paris, hors jours fériés) : refusé ;
--        - numéro présent dans lx_sms_stop (opposition, tous établissements Luxyra) : refusé ;
--        - ajoute « \nStop SMS: luxyra.fr/s/<code6> » (29 caractères, même fonction que Brevo :
--          lx_code_desinscription_sms(salon, numéro)) ; sans code possible (numéro absent du fichier du salon) : refusé.
--      Refus = exception (aucune ligne écrite) ; le message commence par LX_HORS_CRENEAU / LX_STOP / LX_SANS_LIEN,
--      l'app pro (sendSmsNative) le traduit.
--   2. Garde à l'envoi : tâche pg_cron chaque minute « sms-queue-pub-garde » -> les SMS publicitaires encore
--      'pending' (téléphone hors ligne…) passent en 'cancelled' dès qu'on sort du créneau légal ou si le numéro a fait
--      opposition entre-temps. Ils ne partent donc jamais à 21 h 31 ou un dimanche.
--   3. Purge quotidienne « desinscriptions-purge » (3 h 55) :
--        - 48 h après une désinscription (fin de la réinscription possible) : le lien code <-> motif est effacé
--          (motif_id, avant_email_ok, avant_sms_stop = null) et les dates sont ramenées au jour (codes.utilise_le,
--          motifs.cree_le / annule_le) pour qu'on ne puisse plus relier un motif à un client par l'heure exacte ;
--        - motifs de plus de 3 ans supprimés.
--      lx_sms_stop n'est JAMAIS touché ici (liste d'opposition conservée).
-- =====================================================================================================
set lock_timeout = '8s';

-- 1. Déclencheur sms_queue --------------------------------------------------------------------------------
create or replace function lx_prive.trg_sms_queue_pub()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
-- 2026-10-17 : SMS publicitaires du mode « Depuis mon téléphone » (même règles que Brevo, voir sms_restes.sql)
declare v_code text;
begin
  if coalesce(new.context, '') not in ('marketing', 'anniversaire', 'relance') then return new; end if;
  if tg_op = 'INSERT' then
    if not lx_prive.sms_pub_creneau_ok(now()) then
      raise exception 'LX_HORS_CRENEAU: SMS publicitaires autorisés du lundi au samedi de 8 h à 21 h 30, hors dimanche et jours fériés' using errcode = 'P0001';
    end if;
    if lx_prive.sms_pub_bloque(new.phone) then
      raise exception 'LX_STOP: ce numéro a demandé l''arrêt des SMS publicitaires' using errcode = 'P0001';
    end if;
  end if;
  if coalesce(new.message, '') !~* 'luxyra\.fr/(s|stop)/' then
    v_code := public.lx_code_desinscription_sms(new.salon_id, new.phone);
    if v_code is null or v_code !~ '^[a-z0-9]{6}$' then
      raise exception 'LX_SANS_LIEN: SMS publicitaire non envoyé : lien de désinscription impossible (client absent du fichier du salon)' using errcode = 'P0001';
    end if;
    new.message := coalesce(new.message, '') || E'\nStop SMS: luxyra.fr/s/' || v_code;
  end if;
  return new;
end $function$;
revoke all on function lx_prive.trg_sms_queue_pub() from public;

drop trigger if exists trg_sms_queue_pub on public.sms_queue;
create trigger trg_sms_queue_pub
  before insert or update of message, context on public.sms_queue
  for each row execute function lx_prive.trg_sms_queue_pub();

-- 2. Garde à l'envoi (chaque minute) -----------------------------------------------------------------------
create or replace function lx_prive.sms_queue_pub_garde()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_n int := 0; v_m int := 0;
begin
  if not lx_prive.sms_pub_creneau_ok(now()) then
    update public.sms_queue
       set status = 'cancelled',
           error_message = 'Non envoyé : hors créneau légal des SMS publicitaires (lundi-samedi 8 h - 21 h 30, hors jours fériés)'
     where status = 'pending' and context in ('marketing', 'anniversaire', 'relance');
    get diagnostics v_n = row_count;
  end if;
  update public.sms_queue q
     set status = 'cancelled', error_message = 'Non envoyé : le numéro a demandé l''arrêt des SMS publicitaires (Stop SMS)'
   where q.status = 'pending' and q.context in ('marketing', 'anniversaire', 'relance')
     and exists (select 1 from public.lx_sms_stop s where s.telephone_norm = public.normalize_phone(q.phone));
  get diagnostics v_m = row_count;
  return v_n + v_m;
end $function$;
revoke all on function lx_prive.sms_queue_pub_garde() from public;

select cron.unschedule(jobid) from cron.job where jobname = 'sms-queue-pub-garde';
select cron.schedule('sms-queue-pub-garde', '* * * * *', 'select lx_prive.sms_queue_pub_garde()');

-- 3. Purge des désinscriptions (quotidienne) --------------------------------------------------------------
create or replace function lx_prive.desinscriptions_purge()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
-- 2026-10-17 : après les 48 h de réinscription possible, plus aucun lien entre un code (donc un client) et un motif.
-- lx_sms_stop (liste d'opposition) n'est pas touché.
declare v_liens int := 0; v_dates int := 0; v_vieux int := 0;
begin
  update public.lx_desinscription_codes
     set motif_id = null, avant_email_ok = null, avant_sms_stop = null,
         utilise_le = ((utilise_le at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris'
   where utilise_le is not null and utilise_le < now() - interval '48 hours'
     and (motif_id is not null or avant_email_ok is not null or avant_sms_stop is not null
          or utilise_le <> ((utilise_le at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris');
  get diagnostics v_liens = row_count;
  update public.lx_desinscription_motifs
     set cree_le = ((cree_le at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris',
         annule_le = case when annule_le is null then null
                          else ((annule_le at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris' end
   where cree_le < now() - interval '48 hours'
     and (cree_le <> ((cree_le at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris'
          or annule_le <> ((annule_le at time zone 'Europe/Paris')::date)::timestamp at time zone 'Europe/Paris');
  get diagnostics v_dates = row_count;
  delete from public.lx_desinscription_motifs where cree_le < now() - interval '3 years';
  get diagnostics v_vieux = row_count;
  return jsonb_build_object('liens_effaces', v_liens, 'dates_arrondies', v_dates, 'motifs_supprimes', v_vieux);
end $function$;
revoke all on function lx_prive.desinscriptions_purge() from public;

select cron.unschedule(jobid) from cron.job where jobname = 'desinscriptions-purge';
select cron.schedule('desinscriptions-purge', '55 3 * * *', 'select lx_prive.desinscriptions_purge()');

-- =====================================================================================================
-- TESTS (17/10/2026, transaction annulée : begin; ... rollback;) — résultats consignés plus bas
-- =====================================================================================================
-- Méthode : bloc DO terminé par raise exception (tout est annulé), en tant que propriétaire du Salon Démo
-- (set local role authenticated + request.jwt.claims) pour passer par la RLS de sms_queue ; samedi 17/10 20 h 18.
--  1 marketing (client du salon)            -> « Promo -20% ce mois\nStop SMS: luxyra.fr/s/gv9m7v » (code du client)
--  2 rappel_24h                              -> texte inchangé (aucune mention)
--  3 anniversaire contenant déjà le lien     -> pas de 2e mention
--  4 relance vers un numéro hors fichier     -> LX_SANS_LIEN (refusé)
--  5 UPDATE du texte d'un SMS marketing      -> mention remise
--  6 marketing vers un numéro dans lx_sms_stop -> LX_STOP (refusé) ; 7 rappel_2h vers ce numéro -> accepté
--  8 garde (créneau ouvert, numéro opposé)  -> 2 SMS publicitaires 'pending' passés en 'cancelled'
--  A hors créneau (sms_pub_creneau_ok remplacée par « false » dans la transaction) -> LX_HORS_CRENEAU ;
--  B rappel_24h hors créneau -> accepté ; C garde hors créneau -> SMS publicitaire 'pending' annulé
--  D désinscription par code (motif « autre ») puis vieillie de 3 j 5 h ; motif de 3 ans 2 j ; motif de 2 h
--  E purge -> {"liens_effaces": 1, "dates_arrondies": 2, "motifs_supprimes": 1}
--  F code : motif_id / avant_email_ok / avant_sms_stop = null, utilise_le = 14/10 00:00 (jour seulement)
--  G motif : conservé, cree_le = 14/10 00:00 ; H motif de plus de 3 ans supprimé ; I motif de 2 h intact
--  J lx_sms_stop : opposition conservée (numéro toujours présent)
--  K « me réinscrire » après purge -> trop_tard ; L 2e clic -> deja ; M 2e passage de la purge -> 0 / 0 / 0
-- Vérifié après coup : rien n'est resté en base (lx_sms_stop 0, motifs 0, sms_queue publicitaires 0).

-- 2026-10-17 (APPLIQUÉ) : lx_prive.vers_gsm7(text) — accents hors GSM-7, guillemets typographiques, œ, émojis convertis/retirés ;
-- appliqué dans lx_prive.trg_sms_queue_pub aux SMS publicitaires du mode téléphone (comme le worker pour Brevo).
-- Test : 'Joyeux anniversaire Hélène ! Fête chez l’Atelier « Ô » 🎉 ça' -> 'Joyeux anniversaire Hélène ! Fete chez l'Atelier " O " Ça'
