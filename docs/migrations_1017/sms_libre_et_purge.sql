-- =====================================================================================================
-- 2026-10-17 — SMS « libres » (nature information / publicité) + durée maximale de la liste d'opposition
-- APPLIQUÉ le 17/10/2026 (base kxdgjtvrkwugbifgppai) — testé d'abord en transaction annulée (bloc TESTS en fin).
-- =====================================================================================================
-- Contexte légal : art. L34-5 CPCE — toute prospection commerciale par SMS exige le consentement préalable, un moyen
-- d'opposition dans chaque message, et (pratique Luxyra / Brevo) les créneaux lun-sam 8 h - 21 h 30 hors fériés.
--
-- 1. Repérage automatique des SMS publicitaires « libres »
--    lx_prive.sms_texte_publicitaire(texte) : marqueurs évidents (insensible casse / accents) : promo, promotion,
--      offre, réduction, remise, soldes, code promo, gratuit, cadeau offert, black friday, jeu concours, parrainage,
--      profitez, nouveauté, réservez vite, vente privée, bon plan, prix cassé, happy hour, « -20 % »,
--      « 20 % de réduction / remise / rabais ». MÊME LISTE dans app.html (lxSmsMarqueursPub) et dans le worker
--      (lxSmsTextePub).
--    lx_prive.sms_contexte_transactionnel(contexte) : contextes automatiques RÉELS jamais requalifiés :
--      rappel_24h, rappel_2h, rappel (ancien), confirmation_rdv, confirmation_rdv_groupe, validation_rdv,
--      carte_welcome, carte_rappel_30j, carte_rappel_7j, test.
--    lx_prive.sms_contexte_requalifie(contexte, texte) : contexte publicitaire (marketing / anniversaire / relance)
--      ou transactionnel -> inchangé ; sinon (null, '', luxyra_auto, libre_info, manuel, libre, custom, inconnu)
--      -> 'marketing' si le texte contient un marqueur, sinon inchangé.
-- 2. sms_queue (mode « Depuis mon téléphone ») : le déclencheur trg_sms_queue_pub requalifie à l'INSERT, puis applique
--    les règles publicitaires existantes (créneau, opposition, lien Stop SMS) ; + consentement : contexte 'marketing'
--    refusé (LX_SANS_CONSENTEMENT) si la fiche du numéro dans ce salon a « Accepte les SMS » décoché.
-- 3. sms_differes (file serveur Brevo) : nouveau déclencheur BEFORE INSERT, même requalification (traiter_sms_differes
--    applique ensuite créneau, opposition, lien, consentement).
-- 4. lx_sms_campagne_enfiler : nouveau paramètre p_contexte ('marketing' par défaut, ou 'libre_info' = « Message libre »
--    déclaré « Information ») ; 'libre_info' : pas de contrôle d'opposition publicitaire, pertinent 48 h ;
--    la requalification (3) s'applique quand même.
-- 5. Liste d'opposition lx_sms_stop : conservée EXACTEMENT 3 ans après la dernière demande d'arrêt
--    (greatest(stop_le, maj_le)), puis supprimée par la tâche quotidienne existante « desinscriptions-purge » ;
--    les traces de réinscription (lx_sms_stop_levee) de plus de 3 ans aussi. Trace agrégée SANS numéro : admin_log
--    'RGPD_SMS_STOP_PURGE' (nombre de lignes supprimées).
-- Traces : audit_log 'SMS_LIBRE_REQUALIFIE' (salon) à chaque requalification serveur ; 'CAMPAGNE_SMS_EN_FILE' indique
-- la nature.
-- =====================================================================================================
set lock_timeout = '8s';

-- 1. Fonctions de repérage -----------------------------------------------------------------------------
create or replace function lx_prive.sms_texte_publicitaire(p_txt text)
returns boolean
language sql immutable
set search_path to 'pg_catalog'
as $function$
  with t as (
    select ' ' || translate(lower(coalesce(p_txt, '')),
                            'àâäáãéèêëíìîïóòôöõúùûüçñ''’',
                            'aaaaaeeeeiiiiooooouuuucn  ') || ' ' as s
  )
  select s ~ '[^a-z0-9](promos?|promotions?|promotionnel(le)?s?|offres?|reductions?|remises?|soldes?|code promo|gratuite?s?|cadeaux? offerts?|black friday|jeux?[ -]concours|parrainages?|profitez|nouveautes?|reservez vite|ventes? privees?|bons? plans?|prix casses?|happy hour)[^a-z0-9]'
      or s ~ '-\s?[0-9]+\s?%'
      or s ~ '[0-9]+\s?%\s*(de\s+)?(reduction|remise|rabais)'
  from t
$function$;

create or replace function lx_prive.sms_contexte_transactionnel(p_ctx text)
returns boolean
language sql immutable
set search_path to 'pg_catalog'
as $function$
  select coalesce(p_ctx, '') in ('rappel_24h', 'rappel_2h', 'rappel', 'confirmation_rdv', 'confirmation_rdv_groupe',
                                 'validation_rdv', 'carte_welcome', 'carte_rappel_30j', 'carte_rappel_7j', 'test')
$function$;

create or replace function lx_prive.sms_contexte_requalifie(p_ctx text, p_txt text)
returns text
language sql immutable
set search_path to 'pg_catalog'
as $function$
  select case
    when coalesce(p_ctx, '') in ('marketing', 'anniversaire', 'relance') then p_ctx
    when lx_prive.sms_contexte_transactionnel(p_ctx) then p_ctx
    when lx_prive.sms_texte_publicitaire(p_txt) then 'marketing'
    else p_ctx
  end
$function$;

-- 2. Déclencheur sms_queue (mode téléphone) -------------------------------------------------------------
create or replace function lx_prive.trg_sms_queue_pub()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
-- 2026-10-17 : SMS publicitaires du mode « Depuis mon téléphone » (même règles que Brevo, voir sms_restes.sql)
-- 2026-10-17 (sms_libre_et_purge.sql) : SMS libre (sans contexte / luxyra_auto / libre_info…) au texte publicitaire
--   -> requalifié 'marketing' ; 'marketing' refusé sans consentement SMS de la fiche.
declare v_code text; v_avant text;
begin
  if tg_op = 'INSERT' then
    v_avant := new.context;
    new.context := lx_prive.sms_contexte_requalifie(new.context, new.message);
    if new.context is distinct from v_avant then
      begin
        insert into public.audit_log (salon_id, action, details, operator_name)
        values (new.salon_id, 'SMS_LIBRE_REQUALIFIE',
                'SMS vers ...' || right(regexp_replace(coalesce(new.phone, ''), '[^0-9]', '', 'g'), 4)
                || ' (contexte « ' || coalesce(v_avant, 'aucun') || ' ») : texte publicitaire repéré, envoyé comme publicité (mention Stop SMS, horaires autorisés, opposition).',
                'Auto (contrôle serveur)');
      exception when others then null; end;
    end if;
  end if;
  if coalesce(new.context, '') not in ('marketing', 'anniversaire', 'relance') then return new; end if;
  if tg_op = 'INSERT' then
    if not lx_prive.sms_pub_creneau_ok(now()) then
      raise exception 'LX_HORS_CRENEAU: SMS publicitaires autorisés du lundi au samedi de 8 h à 21 h 30, hors dimanche et jours fériés' using errcode = 'P0001';
    end if;
    if lx_prive.sms_pub_bloque(new.phone) then
      raise exception 'LX_STOP: ce numéro a demandé l''arrêt des SMS publicitaires' using errcode = 'P0001';
    end if;
    if new.context = 'marketing' and exists (
         select 1 from public.clients c
          where c.salon_id = new.salon_id and c.telephone_norm = public.normalize_phone(new.phone)
            and c.fusionne_dans is null and c.rgpd_anonymise_le is null and c.sms_ok is false) then
      raise exception 'LX_SANS_CONSENTEMENT: ce client n''a pas accepté les SMS' using errcode = 'P0001';
    end if;
  end if;
  new.message := lx_prive.vers_gsm7(new.message); -- 2026-10-17 : comme Brevo, accents hors GSM-7 et émojis convertis (1 SMS = 160 car.)
  if coalesce(new.message, '') !~* 'luxyra\.fr/(s|stop)/' then
    v_code := public.lx_code_desinscription_sms(new.salon_id, new.phone);
    if v_code is null or v_code !~ '^[a-z0-9]{6}$' then
      raise exception 'LX_SANS_LIEN: SMS publicitaire non envoyé : lien de désinscription impossible (client absent du fichier du salon)' using errcode = 'P0001';
    end if;
    new.message := coalesce(new.message, '') || E'\nStop SMS: luxyra.fr/s/' || v_code;
  end if;
  return new;
end $function$;

-- 3. Déclencheur sms_differes (file serveur) ------------------------------------------------------------
create or replace function lx_prive.trg_sms_differes_requalifie()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare v_avant text := new.contexte;
begin
  new.contexte := lx_prive.sms_contexte_requalifie(new.contexte, new.message);
  if new.contexte is distinct from v_avant then
    -- attente éventuelle du créneau publicitaire non décomptée (comme lx_sms_campagne_enfiler)
    new.pertinent_jusqu_a := greatest(coalesce(new.pertinent_jusqu_a, now()), lx_prive.sms_pub_prochain_creneau(now()) + interval '3 days');
    begin
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (new.salon_id, 'SMS_LIBRE_REQUALIFIE',
              'SMS vers ...' || right(regexp_replace(coalesce(new.telephone, ''), '[^0-9]', '', 'g'), 4)
              || ' (contexte « ' || coalesce(v_avant, 'aucun') || ' ») : texte publicitaire repéré, envoyé comme publicité (mention Stop SMS, horaires autorisés, opposition).',
              'Auto (contrôle serveur)');
    exception when others then null; end;
  end if;
  return new;
end $function$;

drop trigger if exists trg_sms_differes_requalifie on public.sms_differes;
create trigger trg_sms_differes_requalifie before insert on public.sms_differes
  for each row execute function lx_prive.trg_sms_differes_requalifie();

-- 4. Campagne « Message libre » : nature information possible ------------------------------------------
drop function if exists public.lx_sms_campagne_enfiler(uuid, jsonb, text);
create or replace function public.lx_sms_campagne_enfiler(p_salon_id uuid, p_envois jsonb, p_titre text default null::text,
                                                          p_contexte text default 'marketing')
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_uid uuid := auth.uid();
  e jsonb; v_tel text; v_msg text; v_cid uuid; v_nom text;
  v_enfiles int := 0; v_ignores int := 0;
  -- 2026-10-17 (sms_libre_et_purge.sql) : 'libre_info' = « Message libre » déclaré « Information » par le pro.
  -- Un texte publicitaire repasse quand même en 'marketing' (déclencheur trg_sms_differes_requalifie).
  v_ctx text := case when p_contexte = 'libre_info' then 'libre_info' else 'marketing' end;
BEGIN
  IF v_uid IS NULL OR NOT EXISTS (SELECT 1 FROM salons s WHERE s.id = p_salon_id AND s.user_id = v_uid) THEN
    IF NOT public.is_admin() THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Accès refusé'); END IF;
  END IF;
  IF jsonb_typeof(p_envois) <> 'array' THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Liste invalide'); END IF;
  IF jsonb_array_length(p_envois) > 2000 THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Trop de destinataires (2000 au plus par envoi)'); END IF;

  FOR e IN SELECT * FROM jsonb_array_elements(p_envois) LOOP
    v_tel := regexp_replace(coalesce(e->>'telephone', ''), '[\s\.\-]', '', 'g');
    IF left(v_tel, 1) = '0' THEN v_tel := '+33' || substr(v_tel, 2); END IF;
    IF left(v_tel, 1) <> '+' THEN v_tel := '+33' || v_tel; END IF;
    v_msg := left(coalesce(e->>'message', ''), 1000);
    v_nom := left(coalesce(e->>'client_nom', ''), 120);
    v_cid := NULL;
    BEGIN v_cid := (e->>'client_id')::uuid; EXCEPTION WHEN OTHERS THEN v_cid := NULL; END;
    IF length(regexp_replace(v_tel, '[^0-9]', '', 'g')) < 9 OR v_msg = '' THEN v_ignores := v_ignores + 1; CONTINUE; END IF;
    -- consentement de la fiche (si fournie) ; 2026-10-17 audit réglages (#35) : fiche « Client actif » décochée exclue
    IF v_cid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = v_cid AND c.salon_id = p_salon_id
                                           AND c.sms_ok IS TRUE AND c.rgpd_anonymise_le IS NULL
                                           AND coalesce(c.actif, true) = true) THEN
      v_ignores := v_ignores + 1; CONTINUE;
    END IF;
    -- 2026-10-17 : numéro ayant répondu STOP aux SMS publicitaires (le texte requalifié est revérifié à l'envoi)
    IF lx_prive.sms_contexte_requalifie(v_ctx, v_msg) = 'marketing' AND lx_prive.sms_pub_bloque(v_tel) THEN
      v_ignores := v_ignores + 1; CONTINUE;
    END IF;
    -- double appui / double appareil : même numéro + même message récemment
    IF EXISTS (SELECT 1 FROM sms_differes d WHERE d.salon_id = p_salon_id AND d.telephone = v_tel AND d.message = v_msg
                 AND d.statut IN ('en_attente', 'envoi', 'envoye') AND d.cree_le > now() - interval '24 hours') THEN
      v_ignores := v_ignores + 1; CONTINUE;
    END IF;
    INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, client_id, pertinent_jusqu_a)
    VALUES (p_salon_id, v_tel, v_msg, v_ctx, nullif(v_nom, ''), v_cid,
            CASE WHEN v_ctx = 'marketing' THEN lx_prive.sms_pub_prochain_creneau(now()) + interval '3 days'  -- attente du créneau non décomptée
                 ELSE now() + interval '48 hours' END);
    v_enfiles := v_enfiles + 1;
  END LOOP;

  IF v_enfiles > 0 THEN
    BEGIN
      INSERT INTO audit_log (salon_id, action, details, operator_name)
      VALUES (p_salon_id, 'CAMPAGNE_SMS_EN_FILE', coalesce(nullif(p_titre, ''), 'Campagne') || ' : ' || v_enfiles || ' SMS en file, '
              || v_ignores || ' ignoré(s) — nature : '
              || CASE WHEN v_ctx = 'marketing' THEN 'publicité (mention Stop SMS, horaires autorisés)'
                      ELSE 'information (transactionnel ; un texte publicitaire repéré repasse en publicité)' END, 'campagne');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    -- premier lot tout de suite (le reste au passage suivant du cron)
    BEGIN PERFORM public.traiter_sms_differes(p_salon_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN jsonb_build_object('ok', true, 'enfiles', v_enfiles, 'ignores', v_ignores, 'contexte', v_ctx,
                            'creneau_ok', lx_prive.sms_pub_creneau_ok(now()), 'prochain_envoi', lx_prive.sms_pub_prochain_creneau(now()));
END;
$function$;
revoke all on function public.lx_sms_campagne_enfiler(uuid, jsonb, text, text) from public, anon;
grant execute on function public.lx_sms_campagne_enfiler(uuid, jsonb, text, text) to authenticated, service_role;

-- 5. Purge de la liste d'opposition (3 ans après la dernière demande) ------------------------------------
create or replace function lx_prive.desinscriptions_purge()
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
-- 2026-10-17 : après les 48 h de réinscription possible, plus aucun lien entre un code (donc un client) et un motif.
-- 2026-10-17 (sms_libre_et_purge.sql) : liste d'opposition lx_sms_stop conservée exactement 3 ans après la dernière
--   demande d'arrêt (stop_le / maj_le, la plus récente), puis supprimée ; traces de réinscription (lx_sms_stop_levee)
--   de plus de 3 ans supprimées ; trace agrégée sans numéro dans admin_log.
declare v_liens int := 0; v_dates int := 0; v_vieux int := 0; v_stop int := 0; v_levees int := 0;
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
  delete from public.lx_sms_stop where greatest(stop_le, maj_le) < now() - interval '3 years';
  get diagnostics v_stop = row_count;
  delete from public.lx_sms_stop_levee where leve_le < now() - interval '3 years';
  get diagnostics v_levees = row_count;
  if v_stop > 0 or v_levees > 0 then
    begin
      insert into public.admin_log (action, details, origine, apres)
      values ('RGPD_SMS_STOP_PURGE',
              v_stop || ' numéro(s) retiré(s) de la liste d''opposition aux SMS publicitaires (3 ans après la dernière demande d''arrêt), '
              || v_levees || ' trace(s) de réinscription de plus de 3 ans supprimée(s).',
              'cron', jsonb_build_object('stop_supprimes', v_stop, 'levees_supprimees', v_levees));
    exception when others then null; end;
  end if;
  return jsonb_build_object('liens_effaces', v_liens, 'dates_arrondies', v_dates, 'motifs_supprimes', v_vieux,
                            'opposition_supprimes', v_stop, 'levees_supprimees', v_levees);
end $function$;
-- (tâche pg_cron existante « desinscriptions-purge », 55 3 * * * : select lx_prive.desinscriptions_purge() — inchangée)

-- =====================================================================================================
-- TESTS (exécutés dans une transaction ANNULÉE avant l'application) — voir le compte rendu
--   begin;
--   select lx_prive.sms_texte_publicitaire('Profitez de -20 % ce week-end'),           -- true
--          lx_prive.sms_texte_publicitaire('Nouveauté : soin visage'),                -- true
--          lx_prive.sms_texte_publicitaire('20% de RÉDUCTION sur les soins'),         -- true
--          lx_prive.sms_texte_publicitaire('Votre commande est prête, à demain'),     -- false
--          lx_prive.sms_texte_publicitaire('Vous avez oublié votre écharpe'),         -- false
--          lx_prive.sms_texte_publicitaire('Retard de 15 min, désolée');              -- false
--   select lx_prive.sms_contexte_requalifie('rappel_24h', 'promo -20%'),   -- rappel_24h
--          lx_prive.sms_contexte_requalifie(null, 'promo -20%'),           -- marketing
--          lx_prive.sms_contexte_requalifie('libre_info', 'Code promo X'), -- marketing
--          lx_prive.sms_contexte_requalifie('luxyra_auto', 'Retard'),      -- luxyra_auto
--   insert sms_differes (contexte null, texte publicitaire) -> contexte = 'marketing' + audit SMS_LIBRE_REQUALIFIE ;
--   insert lx_sms_stop (stop_le/maj_le = now() - 3 ans - 1 j) + select lx_prive.desinscriptions_purge() -> supprimée,
--   ligne à now() - 3 ans + 1 j conservée ;
--   rollback;
-- =====================================================================================================
-- Résultat des TESTS (transaction annulée, 17/10 22 h 30, hors créneau) :
--   marqueurs pub : true x5 ; textes d'information : false x4 ;
--   requalification : rappel_24h -> rappel_24h, null -> marketing, libre_info + « Code promo » -> marketing,
--   luxyra_auto + « Retard » -> luxyra_auto, test -> test ;
--   sms_differes : null + « Soldes -30 % » -> marketing (pertinent 22/10) + 1 audit SMS_LIBRE_REQUALIFIE ;
--   libre_info info -> libre_info ; rappel_24h « promo » -> rappel_24h ;
--   sms_queue : luxyra_auto « Offre spéciale » -> refus LX_HORS_CRENEAU (requalifié) ; luxyra_auto info -> inséré tel quel ;
--   rappel_24h « promo » -> inséré tel quel ; purge lx_sms_stop : 3 ans + 1 j supprimé, maj_le récent et 2 ans 364 j gardés.
-- Bot (support_bot_kb) mis à jour le 17/10 : desinscription_motifs_1017, sms_tous_clients_1016, sms_stop_creneaux_1017.
