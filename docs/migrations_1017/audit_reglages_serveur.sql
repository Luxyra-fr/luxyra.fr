-- =====================================================================================================
-- 2026-10-17 audit réglages : corrections CÔTÉ SERVEUR (SQL) — docs/audit_reglages_1017.md
-- Toutes les instructions sont idempotentes (CREATE OR REPLACE / IF NOT EXISTS).
-- Aucune fonction / table / déclencheur NF525 n'est modifié.
-- Chaque bloc porte la mention « APPLIQUÉ le … » une fois exécuté en production (projet kxdgjtvrkwugbifgppai).
-- =====================================================================================================


-- =====================================================================================================
-- BLOC 1 — Outils communs + codes de désinscription courts (#2, #4, #18)
-- APPLIQUÉ le 2026-10-17
-- =====================================================================================================
set lock_timeout = '8s';

-- #2 : valeurs par défaut affichées par l'application (lxSmsConfigDefaut, app.html) quand le salon n'a jamais
-- enregistré l'écran SMS : rappels cochés. Les clés enregistrées par le salon priment toujours.
create or replace function lx_prive.sms_cfg_defaut(p_cfg jsonb)
returns jsonb language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#2)
  select '{"rappelActif":true,"rappel24h":true,"rappel2h":true,"rappelEmail":true}'::jsonb
         || case when jsonb_typeof(p_cfg) = 'object' then p_cfg else '{}'::jsonb end
$$;

-- #18 : mode « Depuis mon téléphone » : appareil lié du salon (NULL = pas de mode téléphone utilisable -> Brevo)
create or replace function lx_prive.sms_appareil_natif(p_salon uuid)
returns text language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#18)
  select nullif(s.sms_native_device_id, '') from public.salons s
   where s.id = p_salon and coalesce(s.sms_mode, 'brevo') = 'native'
$$;

-- #4 : code de désinscription court (SMS : « STOP SMS : luxyra.fr/stop/<code> », e-mails : lien de pied de page).
-- Un code par fiche client et par canal, réutilisé. Lu uniquement par le worker (clé service) : RLS sans politique.
create table if not exists public.lx_desinscription_codes (
  code        text primary key,
  client_id   uuid not null references public.clients(id) on delete cascade,
  canal       text not null check (canal in ('sms', 'email', 'all')),
  cree_le     timestamptz not null default now(),
  utilise_le  timestamptz,
  unique (client_id, canal)
);
alter table public.lx_desinscription_codes enable row level security;
revoke all on public.lx_desinscription_codes from anon, authenticated;
comment on table public.lx_desinscription_codes is
  '2026-10-17 audit réglages (#4) : codes courts des liens de désinscription (luxyra.fr/stop/<code>), lus par le worker.';

create or replace function lx_prive.code_desinscription(p_client uuid, p_canal text)
returns text language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
-- 2026-10-17 audit réglages (#4) : code existant, sinon nouveau code de 10 caractères (hexadécimal, ~10^12 valeurs)
declare v_code text; v_i int := 0;
begin
  if p_client is null or p_canal not in ('sms', 'email', 'all') then return null; end if;
  select code into v_code from public.lx_desinscription_codes where client_id = p_client and canal = p_canal;
  if v_code is not null then return v_code; end if;
  loop
    v_i := v_i + 1;
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    begin
      insert into public.lx_desinscription_codes (code, client_id, canal) values (v_code, p_client, p_canal);
      return v_code;
    exception when unique_violation then
      -- code déjà pris, ou code créé en parallèle pour ce client/canal
      select code into v_code from public.lx_desinscription_codes where client_id = p_client and canal = p_canal;
      if v_code is not null then return v_code; end if;
      if v_i >= 5 then return null; end if;
    end;
  end loop;
end $$;
revoke all on function lx_prive.code_desinscription(uuid, text) from public, anon, authenticated;

-- Interrupteur : liens courts luxyra.fr/stop/<code> (SMS « STOP ») + e-mails marketing du serveur (#27).
-- A passer à true UNIQUEMENT après publication du worker (route /stop/<code>) :
--   update app_config set config = config || '{"desinscription_courte":true}'::jsonb where id = 1;
create or replace function lx_prive.desinscription_active()
returns boolean language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#4, #27)
  select coalesce((select (config->>'desinscription_courte')::boolean from public.app_config where id = 1), false)
$$;


-- =====================================================================================================
-- BLOC 2 — Rappel SMS de la veille : envoyer_rappels_24h (#2, #18, #42, #43)
-- APPLIQUÉ le 2026-10-17
--   #2  : salon sans configuration SMS enregistrée -> valeurs par défaut de l'application (avant : salon ignoré)
--   #18 : mode « Depuis mon téléphone » avec un téléphone lié -> file du téléphone (sms_queue), sans crédit Brevo
--   #42 : {prestation} renseignée pour les RDV pris au salon (jointure services)
--   #43 : RDV en ligne : opposition aux SMS (fiche du salon sms_ok = false, même numéro) respectée
--   + forfait Pro et envoi non suspendu requis (comme le rappel 2 h : sinon SMS mis en attente pour rien)
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.envoyer_rappels_24h()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s record; r record;
  v_cfg jsonb; v_modele text; v_msg text; v_tel text; v_tail text;
  v_credits int; v_expediteur text; v_demain date; v_nb int;
  v_appareil text;  -- 2026-10-17 audit réglages (#18)
  v_envoyes int := 0; v_differes int := 0; v_ignores int := 0; v_echecs int := 0; v_tel_natif int := 0;
BEGIN
  v_demain := ((now() AT TIME ZONE 'Europe/Paris')::date + 1);

  -- 2026-10-17 audit réglages : forfait Pro + envoi non suspendu (comme envoyer_rappels_2h)
  FOR s IN SELECT id, nom, sms_credits, config_json FROM salons
            WHERE status IN ('active','trial') AND plan = 'pro' AND coalesce(sms_bloque,false) = false
  LOOP
    BEGIN v_cfg := (s.config_json #>> '{}')::jsonb -> 'sms_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    -- 2026-10-17 audit réglages (#2) : pas de configuration enregistrée -> valeurs par défaut affichées par l'app
    v_cfg := lx_prive.sms_cfg_defaut(v_cfg);
    CONTINUE WHEN coalesce((v_cfg->>'rappelActif')::boolean,false) IS NOT TRUE;
    CONTINUE WHEN coalesce((v_cfg->>'rappel24h')::boolean,false) IS NOT TRUE;

    v_modele := coalesce(nullif(v_cfg->>'rappelTexte24h',''),
                'Bonjour {prenom}, nous vous rappelons votre RDV demain a {heure} chez {salon}. A bientot !');
    v_expediteur := coalesce(nullif(v_cfg->>'smsSender',''), s.nom);
    v_credits := coalesce(s.sms_credits,0);
    v_appareil := lx_prive.sms_appareil_natif(s.id);  -- 2026-10-17 audit réglages (#18)

    FOR r IN
      SELECT c.prenom AS prenom, c.nom AS nom, c.telephone AS tel,
             left(coalesce(a.heure,'12:00'),5) AS heure, a.date_rdv AS jour,
             coalesce(sv.nom,'')::text AS prestation,  -- 2026-10-17 audit réglages (#42) : avant ''
             coalesce(col.nom, a.collab_name, '') AS collab  -- 2026-10-14 audit : {collab}
        FROM appointments a JOIN clients c ON c.id = a.client_id
        LEFT JOIN services sv ON sv.id = a.service_id AND sv.salon_id = a.salon_id
        LEFT JOIN collaborateurs col ON col.id = a.collab_id AND col.salon_id = a.salon_id
       WHERE a.salon_id = s.id AND a.date_rdv = v_demain
         AND coalesce(a.cancelled,false) = false AND a.status IN ('conf','wait')
         AND c.telephone IS NOT NULL AND coalesce(c.sms_ok,true) = true
      UNION ALL
      SELECT ro.client_prenom, ro.client_nom, ro.client_tel,
             left(ro.heure_rdv::text,5), ro.date_rdv, coalesce(ro.service_nom,''),
             coalesce(colo.nom, ro.collaborateur_nom, '')  -- 2026-10-14 audit : {collab}
        FROM rdv_online ro
        LEFT JOIN collaborateurs colo ON colo.id = ro.collaborateur_id AND colo.salon_id = ro.salon_id
       WHERE ro.salon_id = s.id AND ro.date_rdv = v_demain
         AND ro.status IN ('confirmed','pending')
         AND ro.client_tel IS NOT NULL
         -- 2026-10-17 audit réglages (#43) : même règles que envoyer_rappels_2h (déjà rappelé via le RDV du salon,
         -- opposition aux SMS sur la fiche du salon pour ce numéro)
         AND NOT EXISTS (SELECT 1 FROM appointments a2 WHERE a2.id = ro.id)
         AND NOT EXISTS (SELECT 1 FROM clients c2 WHERE c2.salon_id = ro.salon_id AND c2.sms_ok = false
                           AND right(regexp_replace(coalesce(c2.telephone,''), '[^0-9]', '', 'g'), 9)
                             = right(regexp_replace(ro.client_tel, '[^0-9]', '', 'g'), 9))
    LOOP
      -- Chaque cliente dans son propre bloc : un echec n'empeche jamais les suivantes
      BEGIN
        v_tel := regexp_replace(coalesce(r.tel,''), '[^0-9+]', '', 'g');
        CONTINUE WHEN length(v_tel) < 9;
        IF left(v_tel,1) = '0' THEN v_tel := '+33' || substr(v_tel,2); END IF;
        v_tail := right(v_tel,4);

        -- 2026-10-14 audit planning : rappel déjà parti aujourd'hui à ce numéro -> rien ; confirmation du jour -> seulement
        -- si elle concerne CE rendez-vous (rdv_date, sinon date lue dans le texte)
        IF EXISTS (SELECT 1 FROM messaging_log m
                    WHERE m.salon_id = s.id AND m.type='sms'
                      AND m.recipient = v_tail
                      AND (m.created_at AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date
                      AND (m.context = 'rappel_24h'
                           OR (m.context IN ('confirmation_rdv','confirmation_rdv_groupe')
                               AND lx_prive.confirmation_concerne_rdv(m.rdv_date, m.content, r.jour))))
        THEN v_ignores := v_ignores + 1; CONTINUE; END IF;

        v_msg := v_modele;
        v_msg := replace(v_msg, '{prenom}',     coalesce(r.prenom,''));
        v_msg := replace(v_msg, '{nom}',        coalesce(r.nom,''));
        v_msg := replace(v_msg, '{heure}',      coalesce(r.heure,''));
        v_msg := replace(v_msg, '{date}',       to_char(r.jour,'DD/MM/YYYY'));
        v_msg := replace(v_msg, '{prestation}', coalesce(r.prestation,''));
        v_msg := replace(v_msg, '{salon}',      coalesce(s.nom,''));
        v_msg := replace(v_msg, '{collab}',     coalesce(r.collab,''));  -- 2026-10-14 audit

        v_nb := lx_prive.sms_nb(v_msg);
        IF v_appareil IS NOT NULL THEN
          -- 2026-10-17 audit réglages (#18) : « Depuis mon téléphone » -> file du téléphone lié (gratuit)
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom)
          VALUES (s.id, 'sms', v_tail, left(v_msg,300), 'native', 'rappel_24h',
                  trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')));
          INSERT INTO sms_queue (salon_id, phone, message, status, context, client_nom, device_id)
          VALUES (s.id, v_tel, v_msg, 'pending', 'rappel_24h',
                  nullif(trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')),''), v_appareil);
          v_tel_natif := v_tel_natif + 1;
        ELSIF v_credits >= v_nb THEN
          -- On RESERVE d'abord dans le journal : si le verrou refuse, aucun SMS ne part.
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom)
          VALUES (s.id, 'sms', v_tail, left(v_msg,300), 'brevo', 'rappel_24h',
                  trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')));
          PERFORM net.http_post(
            url := 'https://luxyra.fr/api/sms/custom',
            headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
            body := jsonb_build_object('telephone', v_tel, 'message', v_msg,
                                       'salonName', v_expediteur, 'salon_id', s.id),
            timeout_milliseconds := 30000);
          v_credits := v_credits - v_nb;
          v_envoyes := v_envoyes + 1;
        ELSE
          INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, pertinent_jusqu_a)
          VALUES (s.id, v_tel, v_msg, 'rappel_24h',
                  trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')),
                  ((r.jour::text || ' ' || coalesce(r.heure,'12:00'))::timestamp AT TIME ZONE 'Europe/Paris'));
          v_differes := v_differes + 1;
        END IF;

      EXCEPTION
        WHEN unique_violation THEN
          v_ignores := v_ignores + 1;   -- deja envoye par l'application : normal
        WHEN OTHERS THEN
          v_echecs := v_echecs + 1;
          BEGIN
            INSERT INTO audit_log (salon_id, action, details, operator_name)
            VALUES (s.id, 'RAPPEL_24H_ECHEC',
                    'Rappel non envoye pour '||trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,''))
                    ||' ('||coalesce(v_tail,'?')||') : '||SQLERRM, 'traitement_automatique');
          EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object('ok',true,'envoyes',v_envoyes,'differes',v_differes,
                            'ignores',v_ignores,'echecs',v_echecs,'telephone',v_tel_natif);
END;
$function$;


-- =====================================================================================================
-- BLOC 3 — Rappel SMS « 2 h avant » : envoyer_rappels_2h (#2, #18)
-- APPLIQUÉ le 2026-10-17
--   #2  : salon sans configuration SMS enregistrée -> valeurs par défaut (rappels cochés)
--   #18 : mode « Depuis mon téléphone » avec un téléphone lié -> file du téléphone (sms_queue)
-- (seules modifications : lignes marquées « 2026-10-17 audit réglages »)
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.envoyer_rappels_2h(p_essai boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 2026-10-14 audit : rappel SMS « 2 h avant » cote serveur (avant : seulement si un appareil du salon avait
-- l'application ouverte). Memes regles que l'application (checkSmsReminders) : rappelActif + rappel2h,
-- forfait Pro, client avec telephone et sms_ok, RDV du jour qui commence dans les 120 minutes,
-- heures de silence 21h-8h, un seul rappel_2h par numero et par jour (index messaging_log.dedup_key).
-- INACTIF tant que app_config.config->>'rappels_serveur_2h_email' n'est pas true.
-- p_essai = true : essai a blanc (AUCUNE ecriture, AUCUN envoi) -> liste de ce qui partirait.
-- 2026-10-15 : + reservations en ligne (rdv_online confirmed/pending, memes regles que envoyer_rappels_24h).
-- 2026-10-17 audit réglages : valeurs par défaut (#2) + mode « Depuis mon téléphone » (#18).
DECLARE
  s record; r record;
  v_cfg jsonb; v_modele text; v_msg text; v_tel text; v_tail text;
  v_credits int; v_expediteur text; v_nb int;
  v_now timestamp; v_today date; v_now_min int; v_rdv_min int;
  v_envoyes int := 0; v_differes int := 0; v_ignores int := 0; v_echecs int := 0;
  v_essai jsonb := '[]'::jsonb;
  v_vus text[] := '{}';
  v_appareil text; v_tel_natif int := 0;  -- 2026-10-17 audit réglages (#18)
BEGIN
  IF NOT coalesce(p_essai,false)
     AND coalesce((SELECT (config->>'rappels_serveur_2h_email')::boolean FROM app_config WHERE id = 1), false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',true,'inactif',true);
  END IF;
  v_now := (now() AT TIME ZONE 'Europe/Paris');
  v_today := v_now::date;
  IF extract(hour FROM v_now) < 8 OR extract(hour FROM v_now) >= 21 THEN
    RETURN jsonb_build_object('ok',true,'silence',true);
  END IF;
  v_now_min := extract(hour FROM v_now)::int * 60 + extract(minute FROM v_now)::int;

  FOR s IN SELECT id, nom, sms_credits, config_json FROM salons
            WHERE status IN ('active','trial') AND plan = 'pro' AND coalesce(sms_bloque,false) = false
  LOOP
    BEGIN v_cfg := (s.config_json #>> '{}')::jsonb -> 'sms_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    v_cfg := lx_prive.sms_cfg_defaut(v_cfg);  -- 2026-10-17 audit réglages (#2) : avant « CONTINUE WHEN v_cfg IS NULL »
    CONTINUE WHEN coalesce((v_cfg->>'rappelActif')::boolean,false) IS NOT TRUE;
    CONTINUE WHEN coalesce((v_cfg->>'rappel2h')::boolean,false) IS NOT TRUE;

    v_modele := coalesce(nullif(v_cfg->>'rappelTexte2h',''),
                'Rappel : votre RDV est dans 2h a {heure} chez {salon}. A tout de suite !');
    v_expediteur := coalesce(nullif(v_cfg->>'smsSender',''), s.nom);
    v_credits := coalesce(s.sms_credits,0);
    v_appareil := lx_prive.sms_appareil_natif(s.id);  -- 2026-10-17 audit réglages (#18)

    FOR r IN
      SELECT c.prenom AS prenom, c.nom AS nom, c.telephone AS tel,
             left(a.heure,5) AS heure, a.date_rdv AS jour,
             coalesce(sv.nom,'') AS prestation, coalesce(col.nom, a.collab_name, '') AS collab
        FROM appointments a JOIN clients c ON c.id = a.client_id
        LEFT JOIN services sv ON sv.id = a.service_id AND sv.salon_id = a.salon_id
        LEFT JOIN collaborateurs col ON col.id = a.collab_id AND col.salon_id = a.salon_id
       WHERE a.salon_id = s.id AND a.date_rdv = v_today
         AND coalesce(a.cancelled,false) = false AND a.status IN ('conf','wait')
         AND c.telephone IS NOT NULL AND coalesce(c.sms_ok,true) = true
         AND a.heure ~ '^[0-9]{1,2}:[0-9]{2}'
      UNION ALL
      -- 2026-10-15 : reservations en ligne (regles de envoyer_rappels_24h)
      SELECT ro.client_prenom, ro.client_nom, ro.client_tel,
             left(ro.heure_rdv::text,5), ro.date_rdv,
             coalesce(ro.service_nom,''), coalesce(colo.nom, ro.collaborateur_nom, '')
        FROM rdv_online ro
        LEFT JOIN collaborateurs colo ON colo.id = ro.collaborateur_id AND colo.salon_id = ro.salon_id
       WHERE ro.salon_id = s.id AND ro.date_rdv = v_today
         AND ro.status IN ('confirmed','pending')
         AND ro.client_tel IS NOT NULL AND ro.heure_rdv IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM appointments a2 WHERE a2.id = ro.id)
         AND NOT EXISTS (SELECT 1 FROM clients c2 WHERE c2.salon_id = ro.salon_id AND c2.sms_ok = false
                           AND right(regexp_replace(coalesce(c2.telephone,''), '[^0-9]', '', 'g'), 9)
                             = right(regexp_replace(ro.client_tel, '[^0-9]', '', 'g'), 9))
    LOOP
      BEGIN
        v_rdv_min := split_part(r.heure,':',1)::int * 60 + left(split_part(r.heure,':',2),2)::int;
        CONTINUE WHEN v_rdv_min - v_now_min <= 0 OR v_rdv_min - v_now_min > 120;
        v_tel := regexp_replace(coalesce(r.tel,''), '[^0-9+]', '', 'g');
        CONTINUE WHEN length(v_tel) < 9;
        IF left(v_tel,1) = '0' THEN v_tel := '+33' || substr(v_tel,2); END IF;
        v_tail := right(v_tel,4);

        IF EXISTS (SELECT 1 FROM messaging_log m
                    WHERE m.salon_id = s.id AND m.type = 'sms' AND m.context = 'rappel_2h'
                      AND m.recipient = v_tail
                      AND (m.created_at AT TIME ZONE 'Europe/Paris')::date = v_today)
           OR EXISTS (SELECT 1 FROM sms_differes d
                    WHERE d.salon_id = s.id AND d.contexte = 'rappel_2h' AND d.telephone = v_tel
                      AND (d.cree_le AT TIME ZONE 'Europe/Paris')::date = v_today)
        THEN v_ignores := v_ignores + 1; CONTINUE; END IF;
        -- 2026-10-15 : meme numero deja traite dans ce passage (RDV salon + RDV en ligne) -> un seul rappel
        IF (s.id::text || '|' || v_tail) = ANY (v_vus) THEN v_ignores := v_ignores + 1; CONTINUE; END IF;
        v_vus := v_vus || (s.id::text || '|' || v_tail);

        v_msg := v_modele;
        v_msg := replace(v_msg, '{prenom}',     coalesce(r.prenom,''));
        v_msg := replace(v_msg, '{nom}',        coalesce(r.nom,''));
        v_msg := replace(v_msg, '{heure}',      coalesce(r.heure,''));
        v_msg := replace(v_msg, '{date}',       to_char(r.jour,'DD/MM/YYYY'));
        v_msg := replace(v_msg, '{prestation}', coalesce(r.prestation,''));
        v_msg := replace(v_msg, '{salon}',      coalesce(s.nom,''));
        v_msg := replace(v_msg, '{collab}',     coalesce(r.collab,''));
        v_nb := lx_prive.sms_nb(v_msg);

        IF coalesce(p_essai,false) THEN
          v_essai := v_essai || jsonb_build_object('salon', s.nom, 'tel', v_tail, 'heure', r.heure,
                                                   'message', v_msg, 'credits_suffisants', v_credits >= v_nb,
                                                   'telephone_du_salon', v_appareil IS NOT NULL);
          CONTINUE;
        END IF;

        IF v_appareil IS NOT NULL THEN
          -- 2026-10-17 audit réglages (#18) : « Depuis mon téléphone » -> file du téléphone lié (gratuit)
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom)
          VALUES (s.id, 'sms', v_tail, left(v_msg,300), 'native', 'rappel_2h',
                  trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')));
          INSERT INTO sms_queue (salon_id, phone, message, status, context, client_nom, device_id)
          VALUES (s.id, v_tel, v_msg, 'pending', 'rappel_2h',
                  nullif(trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')),''), v_appareil);
          v_tel_natif := v_tel_natif + 1;
        ELSIF v_credits >= v_nb THEN
          -- reservation dans le journal d'abord : si le verrou refuse (deja envoye), aucun SMS ne part
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom)
          VALUES (s.id, 'sms', v_tail, left(v_msg,300), 'brevo', 'rappel_2h',
                  trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')));
          PERFORM net.http_post(
            url := 'https://luxyra.fr/api/sms/custom',
            headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
            body := jsonb_build_object('telephone', v_tel, 'message', v_msg,
                                       'salonName', v_expediteur, 'salon_id', s.id),
            timeout_milliseconds := 30000);
          v_credits := v_credits - v_nb;
          v_envoyes := v_envoyes + 1;
        ELSE
          INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, pertinent_jusqu_a)
          VALUES (s.id, v_tel, v_msg, 'rappel_2h',
                  trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')),
                  ((r.jour::text || ' ' || r.heure)::timestamp AT TIME ZONE 'Europe/Paris'));
          v_differes := v_differes + 1;
        END IF;
      EXCEPTION
        WHEN unique_violation THEN
          v_ignores := v_ignores + 1;   -- deja envoye (application ou passage precedent)
        WHEN OTHERS THEN
          v_echecs := v_echecs + 1;
          BEGIN
            INSERT INTO audit_log (salon_id, action, details, operator_name)
            VALUES (s.id, 'RAPPEL_2H_ECHEC',
                    'Rappel 2h non envoye pour '||trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,''))
                    ||' ('||coalesce(v_tail,'?')||') : '||SQLERRM, 'traitement_automatique');
          EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END LOOP;
  END LOOP;

  IF coalesce(p_essai,false) THEN
    RETURN jsonb_build_object('ok',true,'essai',true,'a_envoyer',v_essai,'ignores',v_ignores,'echecs',v_echecs);
  END IF;
  RETURN jsonb_build_object('ok',true,'envoyes',v_envoyes,'differes',v_differes,
                            'ignores',v_ignores,'echecs',v_echecs,'telephone',v_tel_natif);
END;
$function$;


-- =====================================================================================================
-- BLOC 4 — Rappel E-MAIL de la veille : envoyer_rappels_email_24h (#2, #17 côté serveur, #40)
-- APPLIQUÉ le 2026-10-17
--   #2  : salon sans configuration enregistrée -> valeurs par défaut (rappel e-mail coché)
--   #40 : « Rappels SMS actifs » ne coupe plus les rappels e-mail : seul « Rappels Email actifs » compte
--   #17 : « Message email de rappel » (rappelEmailTexte) repris dans l'e-mail (avant : texte fixe)
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.envoyer_rappels_email_24h(p_essai boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 2026-10-14 audit : rappel par E-MAIL la veille, cote serveur (avant : seulement si l'application etait
-- ouverte). Regles : rappelEmail (tous forfaits, comme l'app),
-- RDV de demain non annule, client avec e-mail ET consentement email_ok = true.
-- Anti-doublon : pas d'envoi si un rappel e-mail 24h existe deja pour cette adresse depuis 25 h
-- (y compris envoye par une ancienne version de l'application) ; index unique dedup_key entre passages.
-- INACTIF tant que app_config.config->>'rappels_serveur_2h_email' n'est pas true.
-- p_essai = true : essai a blanc (AUCUNE ecriture, AUCUN envoi).
-- 2026-10-15 : + reservations en ligne (rdv_online confirmed/pending, memes regles que envoyer_rappels_24h).
-- 2026-10-17 audit réglages : valeurs par défaut (#2), « Rappels SMS actifs » ne coupe plus l'e-mail (#40),
--   message personnalisé « rappelEmailTexte » utilisé (#17).
DECLARE
  s record; r record;
  v_cfg jsonb; v_demain date; v_em text; v_html text; v_sujet text; v_adr text;
  v_envoyes int := 0; v_ignores int := 0; v_echecs int := 0;
  v_essai jsonb := '[]'::jsonb;
  v_vus text[] := '{}';
  v_txt text; v_t text; v_intro text;  -- 2026-10-17 audit réglages (#17)
BEGIN
  IF NOT coalesce(p_essai,false)
     AND coalesce((SELECT (config->>'rappels_serveur_2h_email')::boolean FROM app_config WHERE id = 1), false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok',true,'inactif',true);
  END IF;
  v_demain := ((now() AT TIME ZONE 'Europe/Paris')::date + 1);

  FOR s IN SELECT id, nom, adresse, cp, ville, tel, email, logo, config_json FROM salons
            WHERE status IN ('active','trial')
  LOOP
    BEGIN v_cfg := (s.config_json #>> '{}')::jsonb -> 'sms_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    v_cfg := lx_prive.sms_cfg_defaut(v_cfg);  -- 2026-10-17 audit réglages (#2)
    -- 2026-10-17 audit réglages (#40) : plus de condition sur rappelActif (interrupteur des SMS)
    CONTINUE WHEN coalesce((v_cfg->>'rappelEmail')::boolean,false) IS NOT TRUE;
    v_adr := trim(coalesce(s.adresse,'')||' '||coalesce(s.cp,'')||' '||coalesce(s.ville,''));
    v_txt := nullif(trim(coalesce(v_cfg->>'rappelEmailTexte','')),'');  -- 2026-10-17 audit réglages (#17)

    FOR r IN
      SELECT c.prenom AS prenom, c.nom AS nom, trim(c.email) AS email,
             left(coalesce(a.heure,''),5) AS heure, a.date_rdv AS jour, coalesce(a.lieu,'') AS lieu,
             coalesce(sv.nom,'') AS prestation, coalesce(col.nom, a.collab_name, '') AS collab
        FROM appointments a JOIN clients c ON c.id = a.client_id
        LEFT JOIN services sv ON sv.id = a.service_id AND sv.salon_id = a.salon_id
        LEFT JOIN collaborateurs col ON col.id = a.collab_id AND col.salon_id = a.salon_id
       WHERE a.salon_id = s.id AND a.date_rdv = v_demain
         AND coalesce(a.cancelled,false) = false AND a.status IN ('conf','wait')
         AND c.email_ok = true AND c.email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
      UNION ALL
      -- 2026-10-15 : reservations en ligne (regles de envoyer_rappels_24h)
      SELECT ro.client_prenom, ro.client_nom, trim(ro.client_email),
             left(ro.heure_rdv::text,5), ro.date_rdv, coalesce(ro.lieu,''),
             coalesce(ro.service_nom,''), coalesce(colo.nom, ro.collaborateur_nom, '')
        FROM rdv_online ro
        LEFT JOIN collaborateurs colo ON colo.id = ro.collaborateur_id AND colo.salon_id = ro.salon_id
       WHERE ro.salon_id = s.id AND ro.date_rdv = v_demain
         AND ro.status IN ('confirmed','pending')
         AND ro.client_email ~ '^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$'
         AND NOT EXISTS (SELECT 1 FROM appointments a2 WHERE a2.id = ro.id)
         AND NOT EXISTS (SELECT 1 FROM clients c2 WHERE c2.salon_id = ro.salon_id
                           AND lower(trim(c2.email)) = lower(trim(ro.client_email)) AND c2.email_ok = false)
    LOOP
      BEGIN
        v_em := lower(r.email);
        IF EXISTS (SELECT 1 FROM messaging_log m
                    WHERE m.salon_id = s.id AND m.type = 'email' AND m.context = 'rappel_24h'
                      AND lower(m.recipient) = v_em AND m.created_at > now() - interval '25 hours')
        THEN v_ignores := v_ignores + 1; CONTINUE; END IF;
        -- 2026-10-15 : meme adresse deja traitee dans ce passage (RDV salon + RDV en ligne) -> un seul rappel
        IF (s.id::text || '|' || v_em) = ANY (v_vus) THEN v_ignores := v_ignores + 1; CONTINUE; END IF;
        v_vus := v_vus || (s.id::text || '|' || v_em);

        -- 2026-10-17 audit réglages (#17) : texte du salon (variables remplacées, échappé) sinon phrase d'origine
        --   (« \n » saisi en toutes lettres = retour à la ligne ; « pour {prestation} » retiré si la prestation est inconnue)
        IF v_txt IS NOT NULL THEN
          v_t := replace(v_txt, '\n', E'\n');
          IF coalesce(r.prestation,'') = '' THEN v_t := replace(v_t, ' pour {prestation}', ''); END IF;
          v_intro := replace(lx_prive.html_esc(
                       replace(replace(replace(replace(replace(replace(replace(v_t,
                         '{prenom}', coalesce(r.prenom,'')), '{nom}', coalesce(r.nom,'')),
                         '{heure}', coalesce(r.heure,'')), '{date}', to_char(r.jour,'DD/MM/YYYY')),
                         '{prestation}', coalesce(r.prestation,'')), '{salon}', coalesce(s.nom,'')),
                         '{collab}', coalesce(r.collab,''))), E'\n', '<br>');
        ELSE
          v_intro := 'Bonjour'||CASE WHEN coalesce(r.prenom,'')<>'' THEN ' <strong style="color:#fff">'||lx_prive.html_esc(r.prenom)||'</strong>' ELSE '' END
                     || ',<br>N&#8217;oubliez pas votre rendez-vous demain.';
        END IF;

        v_sujet := 'Rappel : votre rendez-vous demain - ' || coalesce(s.nom,'');
        v_html := '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
          || '<body style="margin:0;padding:0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">'
          || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 16px">'
          || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto">'
          || '<tr><td style="padding:24px 0;text-align:center">'
          || CASE WHEN coalesce(s.logo,'') ~ '^https://' THEN '<img src="'||lx_prive.html_esc(s.logo)||'" alt="" style="height:60px;border-radius:12px;margin-bottom:12px"><br>' ELSE '' END
          || '<div style="font-size:24px;font-weight:800;color:#c8a84e;letter-spacing:2px;font-family:Georgia,serif">'||lx_prive.html_esc(upper(coalesce(s.nom,'')))||'</div></td></tr>'
          || '<tr><td style="padding:8px 24px 20px;text-align:center;font-size:15px;color:rgba(255,255,255,.75);line-height:1.6">'
          || v_intro || '</td></tr>'
          || '<tr><td style="padding:0 20px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#141418;border:1px solid #2a2a30;border-radius:16px">'
          || '<tr><td style="padding:18px 24px;color:#fff;font-size:15px;line-height:1.7">'
          || '<div><span style="color:#c8a84e;font-weight:700">Date :</span> '||to_char(r.jour,'DD/MM/YYYY')||'</div>'
          || '<div><span style="color:#c8a84e;font-weight:700">Heure :</span> '||lx_prive.html_esc(r.heure)||'</div>'
          || CASE WHEN r.prestation<>'' THEN '<div><span style="color:#c8a84e;font-weight:700">Prestation :</span> '||lx_prive.html_esc(r.prestation)||'</div>' ELSE '' END
          || CASE WHEN r.collab<>'' THEN '<div><span style="color:#c8a84e;font-weight:700">Avec :</span> '||lx_prive.html_esc(r.collab)||'</div>' ELSE '' END
          || CASE WHEN r.lieu='domicile' THEN '<div><span style="color:#c8a84e;font-weight:700">Lieu :</span> &#192; votre domicile</div>'
                  WHEN v_adr<>'' THEN '<div><span style="color:#c8a84e;font-weight:700">Adresse :</span> '||lx_prive.html_esc(v_adr)||'</div>' ELSE '' END
          || '</td></tr></table></td></tr>'
          || '<tr><td style="padding:20px 24px;text-align:center;font-size:13px;color:rgba(255,255,255,.5);line-height:1.5">En cas d&#8217;emp&#234;chement, merci de nous pr&#233;venir le plus t&#244;t possible.'
          || CASE WHEN coalesce(s.tel,'')<>'' THEN '<br>'||lx_prive.html_esc(s.tel) ELSE '' END
          || '</td></tr></table></td></tr></table></body></html>';

        IF coalesce(p_essai,false) THEN
          v_essai := v_essai || jsonb_build_object('salon', s.nom, 'email', v_em, 'heure', r.heure, 'sujet', v_sujet,
                                                   'texte_personnalise', v_txt IS NOT NULL);
          CONTINUE;
        END IF;

        INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom, dedup_key)
        VALUES (s.id, 'email', v_em, 'Rappel 24h', 'brevo', 'rappel_24h',
                trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')),
                s.id::text || '|rappel_24h_email|' || v_em || '|' || v_demain::text);
        PERFORM net.http_post(
          url := 'https://luxyra.fr/api/email/custom',
          headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
          body := jsonb_build_object('to', r.email, 'toName', trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,'')),
                                     'salonName', coalesce(s.nom,'Luxyra'), 'salonEmail', coalesce(nullif(s.email,''),'contact@luxyra.fr'),
                                     'subject', v_sujet, 'htmlContent', v_html),
          timeout_milliseconds := 30000);
        v_envoyes := v_envoyes + 1;
      EXCEPTION
        WHEN unique_violation THEN
          v_ignores := v_ignores + 1;
        WHEN OTHERS THEN
          v_echecs := v_echecs + 1;
          BEGIN
            INSERT INTO audit_log (salon_id, action, details, operator_name)
            VALUES (s.id, 'RAPPEL_EMAIL_ECHEC',
                    'Rappel e-mail non envoye pour '||trim(coalesce(r.prenom,'')||' '||coalesce(r.nom,''))||' : '||SQLERRM,
                    'traitement_automatique');
          EXCEPTION WHEN OTHERS THEN NULL; END;
      END;
    END LOOP;
  END LOOP;

  IF coalesce(p_essai,false) THEN
    RETURN jsonb_build_object('ok',true,'essai',true,'a_envoyer',v_essai,'ignores',v_ignores,'echecs',v_echecs);
  END IF;
  RETURN jsonb_build_object('ok',true,'envoyes',v_envoyes,'ignores',v_ignores,'echecs',v_echecs);
END;
$function$;


-- =====================================================================================================
-- BLOC 5 — SMS automatique de réservation en ligne : fn_sms_confirmation_resa_online (#18, #44)
-- APPLIQUÉ le 2026-10-17
--   #44 : une demande « en attente » ACCEPTÉE par le salon (pending -> confirmed) déclenche aussi le SMS
--         « SMS auto sur réservation en ligne ». Pour ne jamais doubler avec l'application (lxRdvAccepter prévient
--         le client par e-mail, et par SMS SEULEMENT s'il n'a pas d'e-mail) : le serveur n'envoie à l'acceptation
--         que si le client a une adresse e-mail valide (sinon c'est l'application qui envoie le SMS, avec le lien
--         d'acompte éventuel). Anti-doublon existant : un SMS de confirmation par numéro et par 12 h.
--   #18 : mode « Depuis mon téléphone » avec un téléphone lié -> file du téléphone (sms_queue).
--   (la valeur par défaut de confirmResaOnline reste « non » : c'est aussi le défaut affiché par l'application)
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.fn_sms_confirmation_resa_online()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_cfg      jsonb;
  v_salon    record;
  v_tel      text;
  v_tail     text;
  v_msg      text;
  v_expediteur text;
  v_deja     boolean;
  v_doit     boolean := false;
  v_credits  int;
  v_appareil text;  -- 2026-10-17 audit réglages (#18)
BEGIN
  -- Quand envoyer : a la creation (hors attente de paiement), ou au moment ou le
  -- paiement est valide (pending_payment -> pending/confirmed).
  IF TG_OP = 'INSERT' THEN
    v_doit := (coalesce(NEW.status,'') NOT IN ('pending_payment','pending')); -- 2026-10-10 : une demande en attente de validation n'est pas « confirmée » (message envoyé à l'acceptation)
  ELSIF TG_OP = 'UPDATE' THEN
    v_doit := (coalesce(OLD.status,'') = 'pending_payment'
               AND NEW.status IN ('pending','confirmed'));
    -- 2026-10-17 audit réglages (#44) : demande acceptée par le salon (pending -> confirmed). Seulement si le client
    -- a un e-mail : sans e-mail, l'application (lxRdvAccepter) lui envoie elle-même un SMS -> pas de doublon.
    IF NOT v_doit AND coalesce(OLD.status,'') = 'pending' AND NEW.status = 'confirmed'
       AND coalesce(NEW.client_email,'') ~ '^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$' THEN
      v_doit := true;
    END IF;
  END IF;
  IF NOT v_doit THEN RETURN NEW; END IF;

  v_tel := regexp_replace(coalesce(NEW.client_tel,''), '[^0-9+]', '', 'g');
  IF length(v_tel) < 9 THEN RETURN NEW; END IF;
  IF left(v_tel,1) = '0' THEN v_tel := '+33' || substr(v_tel,2); END IF;  -- 2026-10-17 : format international (file du téléphone)

  SELECT s.nom, s.config_json INTO v_salon FROM salons s WHERE s.id = NEW.salon_id;
  IF v_salon IS NULL THEN RETURN NEW; END IF;

  BEGIN
    v_cfg := (v_salon.config_json #>> '{}')::jsonb -> 'sms_config';
  EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
  IF v_cfg IS NULL THEN RETURN NEW; END IF;

  -- Interrupteur : desactive par defaut
  IF coalesce((v_cfg ->> 'confirmResaOnline')::boolean, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  -- 2026-10-17 audit réglages (#44) : opposition aux SMS sur la fiche du salon (même numéro) respectée
  IF EXISTS (SELECT 1 FROM clients c2 WHERE c2.salon_id = NEW.salon_id AND c2.sms_ok = false
               AND right(regexp_replace(coalesce(c2.telephone,''), '[^0-9]', '', 'g'), 9)
                 = right(regexp_replace(v_tel, '[^0-9]', '', 'g'), 9)) THEN
    RETURN NEW;
  END IF;

  -- Anti-doublon : un seul SMS de confirmation par numero et par jour
  v_tail := right(v_tel, 4);
  SELECT EXISTS(
    SELECT 1 FROM messaging_log
    WHERE salon_id = NEW.salon_id AND type = 'sms'
      AND context = 'confirmation_rdv' AND recipient = v_tail
      AND created_at > now() - interval '12 hours'
  ) INTO v_deja;
  IF v_deja THEN RETURN NEW; END IF;

  v_msg := coalesce(nullif(v_cfg ->> 'confirmResaTexte',''),
                    'Bonjour {prenom}, votre RDV du {date} a {heure} chez {salon} est confirme. A bientot !');
  v_msg := replace(v_msg, '{prenom}',     coalesce(NEW.client_prenom,''));
  v_msg := replace(v_msg, '{nom}',        coalesce(NEW.client_nom,''));
  v_msg := replace(v_msg, '{date}',       to_char(NEW.date_rdv, 'DD/MM/YYYY'));
  v_msg := replace(v_msg, '{heure}',      to_char(NEW.heure_rdv, 'HH24:MI'));
  v_msg := replace(v_msg, '{prestation}', coalesce(NEW.service_nom,''));
  v_msg := replace(v_msg, '{salon}',      coalesce(v_salon.nom,''));

  -- 2026-10-17 audit réglages (#18) : « Depuis mon téléphone » (téléphone lié) -> file du téléphone, gratuit
  v_appareil := lx_prive.sms_appareil_natif(NEW.salon_id);
  IF v_appareil IS NOT NULL THEN
    INSERT INTO sms_queue (salon_id, phone, message, status, context, client_nom, device_id)
    VALUES (NEW.salon_id, v_tel, v_msg, 'pending', 'confirmation_rdv',
            nullif(trim(coalesce(NEW.client_prenom,'') || ' ' || coalesce(NEW.client_nom,'')),''), v_appareil);
    INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom, rdv_date)
    VALUES (NEW.salon_id, 'sms', v_tail, left(v_msg, 300), 'native', 'confirmation_rdv',
            trim(coalesce(NEW.client_prenom,'') || ' ' || coalesce(NEW.client_nom,'')), NEW.date_rdv);
    RETURN NEW;
  END IF;

  v_expediteur := coalesce(nullif(v_cfg ->> 'smsSender',''), v_salon.nom);
  SELECT coalesce(sms_credits,0) INTO v_credits FROM salons WHERE id = NEW.salon_id;
  IF v_credits < lx_prive.sms_nb(v_msg) THEN
    INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, pertinent_jusqu_a)
    VALUES (NEW.salon_id, v_tel, v_msg, 'confirmation_rdv', trim(coalesce(NEW.client_prenom,'') || ' ' || coalesce(NEW.client_nom,'')),
            ((NEW.date_rdv::text || ' ' || to_char(NEW.heure_rdv,'HH24:MI'))::timestamp AT TIME ZONE 'Europe/Paris'));
    RETURN NEW;
  END IF;

  PERFORM net.http_post(
    url := 'https://luxyra.fr/api/sms/custom',
    headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
    body := jsonb_build_object(
      'telephone', v_tel,
      'message',   v_msg,
      'salonName', v_expediteur,
      'salon_id',  NEW.salon_id
    ),
    timeout_milliseconds := 30000
  );

  -- Trace, avec le meme format de destinataire que l'application (4 derniers chiffres)
  -- 2026-10-14 audit : + date du RDV (rdv_date) pour le rappel de la veille
  INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom, rdv_date)
  VALUES (NEW.salon_id, 'sms', v_tail, left(v_msg, 300), 'brevo', 'confirmation_rdv',
          trim(coalesce(NEW.client_prenom,'') || ' ' || coalesce(NEW.client_nom,'')), NEW.date_rdv);

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_sms_confirmation_resa_online failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;


-- =====================================================================================================
-- BLOC 6 — Mention « STOP » des SMS marketing (#4) + « Client actif » dans les campagnes (#35)
-- APPLIQUÉ le 2026-10-17
--   traiter_sms_differes : au moment de l'envoi, les SMS de prospection (contextes marketing, anniversaire,
--   relance) reçoivent « STOP SMS : luxyra.fr/stop/<code> » (lien court de désinscription propre au client et
--   au salon, traité par le worker). Jamais sur les rappels / confirmations (transactionnels).
--   Fiche introuvable (campagne sans client_id ni numéro connu) -> pas de lien (rien n'est inventé).
--   lx_sms_campagne_enfiler : une fiche « Client actif » décochée n'est plus mise en file.
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.traiter_sms_differes(p_salon_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r            record;
  v_resp       record;
  v_credits    int;
  v_envoyes    int := 0;
  v_confirmes  int := 0;
  v_echecs     int := 0;
  v_ignores    int := 0;
  v_obsoletes  int := 0;
  v_expediteur text;
  v_nom        text;
  v_nb         int;
  v_req        bigint;
  v_ml         bigint;
  v_ok         boolean;
  v_h          int;
  v_json       jsonb;
  v_envoi      text;   -- 2026-10-17 audit réglages (#4) : texte réellement envoyé (avec mention STOP)
  v_cid        uuid;
  v_code       text;
BEGIN
  SELECT sms_credits, nom,
         coalesce(nullif((config_json #>> '{}')::jsonb->'sms_config'->>'smsSender',''), nom)
    INTO v_credits, v_nom, v_expediteur
    FROM salons WHERE id = p_salon_id;
  IF v_credits IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Salon introuvable');
  END IF;

  -- un seul traitement à la fois pour ce salon (cron + recharge simultanés)
  IF NOT pg_try_advisory_xact_lock(hashtext('traiter_sms_differes:' || p_salon_id::text)) THEN
    RETURN jsonb_build_object('ok', true, 'occupe', true);
  END IF;

  -- 0) Rapprochement des envois précédents avec la réponse du worker
  FOR r IN SELECT id, net_request_id, ml_id, essais, envoi_le FROM sms_differes
            WHERE salon_id = p_salon_id AND statut = 'envoi' ORDER BY envoi_le LIMIT 500
  LOOP
    SELECT status_code, content, timed_out, error_msg INTO v_resp FROM net._http_response WHERE id = r.net_request_id;
    IF NOT FOUND THEN
      IF r.net_request_id IS NULL OR r.envoi_le < now() - interval '30 minutes' THEN
        UPDATE sms_differes SET statut = 'echec', traite_le = clock_timestamp(),
               motif = 'Aucune réponse du serveur d''envoi : envoi incertain, pas de nouvel essai (évite un doublon)'
         WHERE id = r.id;
        v_echecs := v_echecs + 1;
      END IF;
      CONTINUE;   -- réponse pas encore arrivée
    END IF;
    v_json := NULL;
    BEGIN v_json := v_resp.content::jsonb; EXCEPTION WHEN OTHERS THEN v_json := NULL; END;
    v_ok := (v_resp.status_code = 200 AND coalesce((v_json->>'success')::boolean, false));
    IF v_ok THEN
      UPDATE sms_differes SET statut = 'envoye', traite_le = clock_timestamp(), motif = NULL WHERE id = r.id;
      v_confirmes := v_confirmes + 1;
    ELSIF coalesce(v_resp.timed_out, false) THEN
      UPDATE sms_differes SET statut = 'echec', traite_le = clock_timestamp(),
             motif = 'Délai dépassé : envoi incertain, pas de nouvel essai (évite un doublon)'
       WHERE id = r.id;
      v_echecs := v_echecs + 1;
    ELSE
      -- échec certain : la réservation anti-doublon est libérée
      IF r.ml_id IS NOT NULL THEN DELETE FROM messaging_log WHERE id = r.ml_id; END IF;
      IF v_resp.status_code IN (402, 429) THEN
        UPDATE sms_differes SET statut = 'en_attente', net_request_id = NULL, ml_id = NULL,
               motif = CASE WHEN v_resp.status_code = 402 THEN 'Crédits insuffisants au moment de l''envoi' ELSE 'Limite d''envoi atteinte, nouvel essai' END
         WHERE id = r.id;
      ELSIF r.essais + 1 >= 3 OR v_resp.status_code IN (400, 403, 404) THEN
        UPDATE sms_differes SET statut = 'echec', traite_le = clock_timestamp(), essais = r.essais + 1,
               net_request_id = NULL, ml_id = NULL,
               motif = left('Refus du serveur d''envoi (' || coalesce(v_resp.status_code::text, '?') || ') : '
                            || coalesce(v_json->>'error', v_resp.error_msg, left(v_resp.content, 200), ''), 300)
         WHERE id = r.id;
        v_echecs := v_echecs + 1;
      ELSE
        UPDATE sms_differes SET statut = 'en_attente', essais = r.essais + 1, net_request_id = NULL, ml_id = NULL,
               motif = left('Essai ' || (r.essais + 1) || ' échoué (' || coalesce(v_resp.status_code::text, '?') || ')', 300)
         WHERE id = r.id;
      END IF;
    END IF;
  END LOOP;

  -- 1) Tout ce qui n'a plus d'objet est ecarte, quel que soit l'etat des credits
  WITH perimes AS (
    UPDATE sms_differes
       SET statut='obsolete', traite_le=clock_timestamp(),
           motif='Le rendez-vous concerne est passe : envoi sans objet'
     WHERE salon_id = p_salon_id AND statut='en_attente'
       AND pertinent_jusqu_a IS NOT NULL AND pertinent_jusqu_a < now()
     RETURNING 1
  )
  SELECT count(*) INTO v_obsoletes FROM perimes;

  -- 2) Puis on envoie ce qui reste, tant qu'il y a des credits (jamais la nuit ; 25 au plus par passage)
  v_h := extract(hour FROM (now() AT TIME ZONE 'Europe/Paris'))::int;
  IF v_h >= 8 AND v_h < 21 THEN
    FOR r IN
      SELECT * FROM sms_differes
       WHERE salon_id = p_salon_id AND statut='en_attente'
       ORDER BY cree_le
       LIMIT 200
    LOOP
      EXIT WHEN v_credits <= 0 OR v_envoyes >= 25;
      -- consentement revérifié au moment de l'envoi
      IF r.client_id IS NOT NULL THEN
        IF NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = r.client_id AND c.salon_id = p_salon_id
                         AND coalesce(c.sms_ok, true) = true AND c.rgpd_anonymise_le IS NULL AND c.fusionne_dans IS NULL) THEN
          UPDATE sms_differes SET statut='obsolete', traite_le=clock_timestamp(),
                 motif='Consentement SMS retiré ou fiche effacée' WHERE id = r.id;
          v_ignores := v_ignores + 1; CONTINUE;
        END IF;
      ELSIF EXISTS (SELECT 1 FROM clients c WHERE c.salon_id = p_salon_id
                      AND c.telephone_norm = public.normalize_phone(r.telephone) AND c.sms_ok = false) THEN
        UPDATE sms_differes SET statut='obsolete', traite_le=clock_timestamp(),
               motif='Consentement SMS retiré' WHERE id = r.id;
        v_ignores := v_ignores + 1; CONTINUE;
      END IF;

      -- 2026-10-17 audit réglages (#4) : SMS de prospection -> lien de désinscription « STOP SMS » (fiche du salon)
      v_envoi := r.message;
      IF lx_prive.desinscription_active() AND r.contexte IN ('marketing','anniversaire','relance') AND r.message !~* '(^|[^a-z])stop([^a-z]|$)' THEN
        v_cid := r.client_id;
        IF v_cid IS NULL THEN
          SELECT c.id INTO v_cid FROM clients c
           WHERE c.salon_id = p_salon_id AND c.telephone_norm = public.normalize_phone(r.telephone)
             AND c.fusionne_dans IS NULL AND c.rgpd_anonymise_le IS NULL
           ORDER BY c.created_at LIMIT 1;
        END IF;
        v_code := NULL;
        IF v_cid IS NOT NULL THEN
          BEGIN v_code := lx_prive.code_desinscription(v_cid, 'sms'); EXCEPTION WHEN OTHERS THEN v_code := NULL; END;
        END IF;
        IF v_code IS NOT NULL THEN v_envoi := rtrim(r.message) || E'\nSTOP SMS : luxyra.fr/stop/' || v_code; END IF;
      END IF;

      v_nb := lx_prive.sms_nb(v_envoi);
      CONTINUE WHEN v_credits < v_nb;

      -- réservation anti-doublon (contextes automatiques et campagnes)
      v_ml := NULL;
      IF r.contexte IN ('rappel_24h','rappel_2h','confirmation_rdv','confirmation_rdv_groupe','anniversaire','relance','marketing') THEN
        BEGIN
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom)
          VALUES (p_salon_id, 'sms', right(regexp_replace(coalesce(r.telephone,''), '[^0-9]', '', 'g'), 4),
                  left(r.message, 320), 'brevo', r.contexte, r.client_nom)
          RETURNING id INTO v_ml;
        EXCEPTION WHEN unique_violation THEN
          UPDATE sms_differes SET statut='obsolete', traite_le=clock_timestamp(),
                 motif='Déjà envoyé aujourd''hui à ce destinataire (doublon évité)' WHERE id = r.id;
          v_ignores := v_ignores + 1; CONTINUE;
        END;
      END IF;

      v_req := net.http_post(
        url := 'https://luxyra.fr/api/sms/custom',
        headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
        body := jsonb_build_object('telephone', r.telephone, 'message', v_envoi,
                                   'salonName', v_expediteur, 'salon_id', p_salon_id),
        timeout_milliseconds := 30000
      );
      UPDATE sms_differes SET statut='envoi', envoi_le=clock_timestamp(), net_request_id = v_req, ml_id = v_ml
       WHERE id = r.id;
      v_credits := v_credits - v_nb;
      v_envoyes := v_envoyes + 1;
    END LOOP;
  END IF;

  IF v_envoyes > 0 OR v_obsoletes > 0 OR v_echecs > 0 OR v_ignores > 0 THEN
    BEGIN
      INSERT INTO audit_log (salon_id, action, details, operator_name)
      VALUES (p_salon_id, 'SMS_DIFFERES_TRAITES',
              v_envoyes::text || ' SMS en attente envoye(s), ' || v_confirmes::text || ' confirme(s), '
              || v_echecs::text || ' echec(s), ' || v_ignores::text || ' ignore(s) (consentement / doublon), '
              || v_obsoletes::text || ' devenu(s) sans objet (rendez-vous passe).', 'traitement_automatique');
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  RETURN jsonb_build_object('ok', true, 'envoyes', v_envoyes, 'confirmes', v_confirmes, 'echecs', v_echecs,
                            'ignores', v_ignores, 'obsoletes', v_obsoletes,
                            'restants', (SELECT count(*) FROM sms_differes
                                          WHERE salon_id=p_salon_id AND statut IN ('en_attente','envoi')));
END;
$function$;

CREATE OR REPLACE FUNCTION public.lx_sms_campagne_enfiler(p_salon_id uuid, p_envois jsonb, p_titre text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  e jsonb; v_tel text; v_msg text; v_cid uuid; v_nom text;
  v_enfiles int := 0; v_ignores int := 0;
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
    -- double appui / double appareil : même numéro + même message récemment
    IF EXISTS (SELECT 1 FROM sms_differes d WHERE d.salon_id = p_salon_id AND d.telephone = v_tel AND d.message = v_msg
                 AND d.statut IN ('en_attente', 'envoi', 'envoye') AND d.cree_le > now() - interval '24 hours') THEN
      v_ignores := v_ignores + 1; CONTINUE;
    END IF;
    INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, client_id, pertinent_jusqu_a)
    VALUES (p_salon_id, v_tel, v_msg, 'marketing', nullif(v_nom, ''), v_cid, now() + interval '3 days');
    v_enfiles := v_enfiles + 1;
  END LOOP;

  IF v_enfiles > 0 THEN
    BEGIN
      INSERT INTO audit_log (salon_id, action, details, operator_name)
      VALUES (p_salon_id, 'CAMPAGNE_SMS_EN_FILE', coalesce(nullif(p_titre, ''), 'Campagne') || ' : ' || v_enfiles || ' SMS en file, '
              || v_ignores || ' ignoré(s)', 'campagne');
    EXCEPTION WHEN OTHERS THEN NULL; END;
    -- premier lot tout de suite (le reste au passage suivant du cron)
    BEGIN PERFORM public.traiter_sms_differes(p_salon_id); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN jsonb_build_object('ok', true, 'enfiles', v_enfiles, 'ignores', v_ignores);
END;
$function$;


-- =====================================================================================================
-- BLOC 7 — E-mails d'anniversaire et de relance envoyés par le serveur (#27) avec lien de désinscription (#4)
-- APPLIQUÉ le 2026-10-17
--   Avant : seuls les SMS partaient du serveur ; les e-mails ne partaient que si l'application était ouverte,
--   alors que l'écran les annonce « automatiques ».
--   Maintenant (même drapeau app_config.sms_auto_serveur, même cron 8 h 30) :
--     - e-mail d'anniversaire si « Anniversaire actif » + client avec e-mail et « Accepte les e-mails » ;
--     - e-mail de relance si « Relance inactifs » (même délai, mêmes exclusions que le SMS : RDV prévu, fiche
--       inactive, fusionnée, effacée) et pas d'e-mail de relance à cette adresse depuis la dernière visite / 6 mois ;
--     - tous forfaits et tous modes SMS (comme l'application) ; 100 relances e-mail au plus par salon et par jour.
--   Anti-doublon avec l'application : MÊME clé que l'application (sendEmailViaWorker dedupKey) :
--     <salon>|anniversaire_email|<email>|<jour> et <salon>|relance_email|<email>|<jour> (index unique messaging_log).
--   Chaque e-mail porte un lien « Se désinscrire » (luxyra.fr/stop/<code>, canal e-mail, fiche de ce salon).
-- =====================================================================================================
set lock_timeout = '8s';

create or replace function lx_prive.email_marketing_html(p_salon text, p_logo text, p_titre text, p_texte text, p_lien_stop text)
returns text language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#4, #27) : gabarit des e-mails de prospection envoyés par le serveur
  select '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
      || '<body style="margin:0;padding:0;background:#f4f1ea;font-family:Helvetica,Arial,sans-serif">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f1ea"><tr><td align="center" style="padding:24px 12px">'
      || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e6dcc3;border-radius:14px;overflow:hidden">'
      || '<tr><td style="background:#0b0b0b;padding:22px 20px;text-align:center;border-bottom:3px solid #c8a84e">'
      || case when coalesce(p_logo,'') ~ '^https://' then '<img src="'||lx_prive.html_esc(p_logo)||'" alt="" style="height:56px;border-radius:10px;margin-bottom:8px"><br>' else '' end
      || '<div style="color:#d4a843;font-family:Georgia,serif;font-size:22px;letter-spacing:3px">'||lx_prive.html_esc(upper(coalesce(p_salon,'')))||'</div></td></tr>'
      || '<tr><td style="padding:26px 26px 8px;color:#1a1a1a;font-size:15px;line-height:1.6">'
      || '<h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:21px;font-weight:400">'||lx_prive.html_esc(coalesce(p_titre,''))||'</h1>'
      || replace(lx_prive.html_esc(coalesce(p_texte,'')), E'\n', '<br>')
      || '</td></tr>'
      || '<tr><td style="padding:18px 26px 22px;font-size:11px;color:#8a8a8a;border-top:1px solid #eee;line-height:1.5;text-align:center">'
      || 'Vous recevez cet e-mail en tant que client de '||lx_prive.html_esc(coalesce(p_salon,''))||'.'
      || case when coalesce(p_lien_stop,'') <> '' then '<br><a href="'||lx_prive.html_esc(p_lien_stop)||'" style="color:#8a8a8a;text-decoration:underline">Se d&#233;sinscrire de ces e-mails</a>' else '' end
      || '<br>Envoy&#233; via Luxyra</td></tr></table></td></tr></table></body></html>'
$$;

CREATE OR REPLACE FUNCTION public.envoyer_sms_anniv_relance()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  s record; c record;
  v_cfg jsonb; v_modele text; v_msg text; v_tel text;
  v_jour date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_md text; v_bissex boolean; v_jours int; v_fin_jour timestamptz;
  v_anniv int := 0; v_rel int := 0; v_n int;
  -- 2026-10-17 audit réglages (#27) : e-mails
  v_em text; v_code text; v_lien text; v_html text; v_sujet text; v_titre text;
  v_anniv_em int := 0; v_rel_em int := 0; v_echecs_em int := 0;
BEGIN
  -- 2026-10-14 intégration : INACTIF tant que app_config.config->>'sms_auto_serveur' n'est pas true.
  -- Le même drapeau coupe l'envoi par l'application (app.html _lxSmsServeurConfirme) : un seul expéditeur à la fois.
  -- À activer seulement après publication des pages (ORDRE.md, bloc ACTIVATION en fin de fichier).
  IF coalesce((SELECT (config->>'sms_auto_serveur')::boolean FROM app_config WHERE id = 1), false) IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', true, 'inactif', true);
  END IF;
  v_md := to_char(v_jour, 'MM-DD');
  v_bissex := (extract(year FROM v_jour)::int % 4 = 0 AND (extract(year FROM v_jour)::int % 100 <> 0 OR extract(year FROM v_jour)::int % 400 = 0));
  v_fin_jour := ((v_jour + 1)::timestamp AT TIME ZONE 'Europe/Paris');

  FOR s IN SELECT id, nom, config_json FROM salons
            WHERE plan = 'pro' AND coalesce(status, '') NOT IN ('suspended', 'cancelled')
              AND coalesce(sms_bloque, false) = false AND coalesce(sms_mode, 'brevo') <> 'native'
  LOOP
    BEGIN v_cfg := (s.config_json #>> '{}')::jsonb -> 'sms_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    CONTINUE WHEN v_cfg IS NULL;

    -- === Anniversaires ===
    IF coalesce((v_cfg->>'anniActif')::boolean, false) THEN
      v_modele := coalesce(nullif(v_cfg->>'anniSms', ''),
                  'Joyeux anniversaire {prenom} ! {salon} vous souhaite une merveilleuse journee. Profitez de -10% sur votre prochaine visite !');
      FOR c IN
        SELECT id, prenom, nom, telephone FROM clients
         WHERE salon_id = s.id AND coalesce(actif, true) AND fusionne_dans IS NULL AND rgpd_anonymise_le IS NULL
           AND sms_ok IS TRUE AND coalesce(telephone, '') <> ''
           AND date_naissance ~ '^\d{4}-\d{2}-\d{2}'
           AND (substr(date_naissance, 6, 5) = v_md
                OR (NOT v_bissex AND v_md = '02-28' AND substr(date_naissance, 6, 5) = '02-29'))
      LOOP
        INSERT INTO sms_auto_envois (salon_id, client_id, type, jour) VALUES (s.id, c.id, 'anniversaire', v_jour)
          ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        CONTINUE WHEN v_n = 0;
        v_msg := replace(replace(replace(v_modele, '{prenom}', coalesce(c.prenom, '')), '{nom}', coalesce(c.nom, '')), '{salon}', coalesce(s.nom, ''));
        INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, client_id, pertinent_jusqu_a)
        VALUES (s.id, c.telephone, v_msg, 'anniversaire', trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), c.id, v_fin_jour);
        v_anniv := v_anniv + 1;
      END LOOP;
    END IF;

    -- === Relances des clients inactifs (100 au plus par salon et par jour : le reste les jours suivants) ===
    v_jours := NULL;
    BEGIN v_jours := (v_cfg->>'relanceJours')::int; EXCEPTION WHEN OTHERS THEN v_jours := NULL; END;
    IF coalesce((v_cfg->>'relanceActif')::boolean, false) AND coalesce(v_jours, 0) >= 30 THEN
      v_modele := coalesce(nullif(v_cfg->>'relanceSms', ''),
                  '{prenom}, vous nous manquez ! {salon} serait ravi de vous revoir. Prenez RDV quand vous voulez !');
      FOR c IN
        SELECT cl.id, cl.prenom, cl.nom, cl.telephone, v.derniere, coalesce(v.derniere, cl.created_at::date) AS reference
          FROM clients cl
          LEFT JOIN LATERAL (SELECT max(a.date_rdv) AS derniere FROM appointments a
                              WHERE a.salon_id = s.id AND a.client_id = cl.id AND a.status = 'done'
                                AND coalesce(a.cancelled, false) = false) v ON true
         WHERE cl.salon_id = s.id AND coalesce(cl.actif, true) AND cl.fusionne_dans IS NULL AND cl.rgpd_anonymise_le IS NULL
           AND cl.sms_ok IS TRUE AND coalesce(cl.telephone, '') <> ''
           AND coalesce(v.derniere, cl.created_at::date) <= v_jour - v_jours
           -- jamais si un RDV est prévu
           AND NOT EXISTS (SELECT 1 FROM appointments a2 WHERE a2.salon_id = s.id AND a2.client_id = cl.id
                             AND a2.date_rdv >= v_jour AND coalesce(a2.cancelled, false) = false AND a2.status IN ('conf', 'wait'))
           -- une seule relance automatique par période d'inactivité, et 6 mois minimum entre deux relances
           AND NOT EXISTS (SELECT 1 FROM sms_auto_envois e WHERE e.salon_id = s.id AND e.client_id = cl.id AND e.type = 'relance'
                             AND (e.jour > coalesce(v.derniere, '-infinity'::date) OR e.jour > v_jour - 182))
           -- relances manuelles notées sur la fiche (fiche_tech.relances[].d)
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cl.fiche_tech->'relances') = 'array'
                                                                    THEN cl.fiche_tech->'relances' ELSE '[]'::jsonb END) rl
                             WHERE (rl->>'d') ~ '^\d{4}-\d{2}-\d{2}' AND (rl->>'d')::date > v_jour - 182)
           -- relance déjà envoyée par l'application depuis la dernière visite (même fin de numéro)
           AND NOT EXISTS (SELECT 1 FROM messaging_log m WHERE m.salon_id = s.id AND m.type = 'sms' AND m.context = 'relance'
                             AND m.recipient = right(regexp_replace(cl.telephone, '[^0-9]', '', 'g'), 4)
                             AND m.created_at > greatest(coalesce(v.derniere, cl.created_at::date)::timestamptz, now() - interval '182 days'))
         ORDER BY coalesce(v.derniere, cl.created_at::date)
         LIMIT 100
      LOOP
        INSERT INTO sms_auto_envois (salon_id, client_id, type, jour) VALUES (s.id, c.id, 'relance', v_jour)
          ON CONFLICT DO NOTHING;
        GET DIAGNOSTICS v_n = ROW_COUNT;
        CONTINUE WHEN v_n = 0;
        v_msg := replace(replace(replace(replace(v_modele, '{prenom}', coalesce(c.prenom, '')), '{nom}', coalesce(c.nom, '')),
                         '{salon}', coalesce(s.nom, '')), '{jours}', (v_jour - c.reference)::text);
        INSERT INTO sms_differes (salon_id, telephone, message, contexte, client_nom, client_id, pertinent_jusqu_a)
        VALUES (s.id, c.telephone, v_msg, 'relance', trim(coalesce(c.prenom, '') || ' ' || coalesce(c.nom, '')), c.id, now() + interval '3 days');
        v_rel := v_rel + 1;
      END LOOP;
    END IF;
  END LOOP;

  -- =====================================================================================================
  -- 2026-10-17 audit réglages (#27) : E-MAILS d'anniversaire et de relance (tous forfaits, tous modes SMS)
  -- =====================================================================================================
  -- (actif seulement quand le lien de désinscription est publié : lx_prive.desinscription_active())
  FOR s IN SELECT id, nom, email, logo, config_json FROM salons
            WHERE coalesce(status, '') NOT IN ('suspended', 'cancelled') AND ferme_le IS NULL
              AND lx_prive.desinscription_active()
  LOOP
    BEGIN v_cfg := (s.config_json #>> '{}')::jsonb -> 'sms_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    CONTINUE WHEN v_cfg IS NULL OR jsonb_typeof(v_cfg) <> 'object';

    -- --- Anniversaire (e-mail) ---
    IF coalesce((v_cfg->>'anniActif')::boolean, false) THEN
      v_modele := replace(coalesce(nullif(v_cfg->>'anniEmail', ''),
                  'Joyeux anniversaire {prenom} !' || E'\n\n' || 'Toute l''équipe de {salon} vous souhaite un très bon anniversaire !'
                  || E'\n\n' || 'Pour célébrer, nous vous offrons -10% sur votre prochaine prestation.' || E'\n\n' || 'À très bientôt !' || E'\n' || '{salon}'),
                  '\n', E'\n');
      FOR c IN
        SELECT id, prenom, nom, lower(trim(email)) AS email FROM clients
         WHERE salon_id = s.id AND coalesce(actif, true) AND fusionne_dans IS NULL AND rgpd_anonymise_le IS NULL
           AND email_ok IS TRUE AND email ~ '^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$'
           AND date_naissance ~ '^\d{4}-\d{2}-\d{2}'
           AND (substr(date_naissance, 6, 5) = v_md
                OR (NOT v_bissex AND v_md = '02-28' AND substr(date_naissance, 6, 5) = '02-29'))
      LOOP
        BEGIN
          v_em := c.email;
          -- réservation (même clé que l'application) : déjà envoyé aujourd'hui -> unique_violation -> rien
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom, dedup_key)
          VALUES (s.id, 'email', v_em, 'Anniversaire', 'brevo', 'anniversaire', trim(coalesce(c.prenom,'')||' '||coalesce(c.nom,'')),
                  s.id::text || '|anniversaire_email|' || v_em || '|' || v_jour::text);
          v_code := lx_prive.code_desinscription(c.id, 'email');
          v_lien := CASE WHEN v_code IS NOT NULL THEN 'https://luxyra.fr/stop/' || v_code ELSE NULL END;
          v_msg := replace(replace(replace(v_modele, '{prenom}', coalesce(c.prenom,'')), '{nom}', coalesce(c.nom,'')), '{salon}', coalesce(s.nom,''));
          v_titre := 'Joyeux anniversaire !';
          v_sujet := 'Joyeux anniversaire ! - ' || coalesce(s.nom,'');
          v_html := lx_prive.email_marketing_html(s.nom, s.logo, v_titre, v_msg, v_lien);
          PERFORM net.http_post(
            url := 'https://luxyra.fr/api/email/custom',
            headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
            body := jsonb_build_object('to', v_em, 'toName', trim(coalesce(c.prenom,'')||' '||coalesce(c.nom,'')),
                                       'salonName', coalesce(s.nom,'Luxyra'), 'salonEmail', coalesce(nullif(s.email,''),'contact@luxyra.fr'),
                                       'subject', v_sujet, 'htmlContent', v_html, 'textContent', v_msg || coalesce(E'\n\nSe désinscrire : ' || v_lien, ''),
                                       'context', 'anniversaire', 'salon_id', s.id, 'unsubscribeUrl', v_lien),
            timeout_milliseconds := 30000);
          v_anniv_em := v_anniv_em + 1;
        EXCEPTION
          WHEN unique_violation THEN NULL;  -- déjà envoyé (application ou passage précédent)
          WHEN OTHERS THEN
            v_echecs_em := v_echecs_em + 1;
            BEGIN
              INSERT INTO audit_log (salon_id, action, details, operator_name)
              VALUES (s.id, 'EMAIL_AUTO_ECHEC', 'E-mail d''anniversaire non envoyé : ' || SQLERRM, 'traitement_automatique');
            EXCEPTION WHEN OTHERS THEN NULL; END;
        END;
      END LOOP;
    END IF;

    -- --- Relance des clients inactifs (e-mail) ---
    v_jours := NULL;
    BEGIN v_jours := (v_cfg->>'relanceJours')::int; EXCEPTION WHEN OTHERS THEN v_jours := NULL; END;
    IF coalesce((v_cfg->>'relanceActif')::boolean, false) AND coalesce(v_jours, 0) >= 30 THEN
      v_modele := replace(coalesce(nullif(v_cfg->>'relanceEmail', ''),
                  'Bonjour {prenom},' || E'\n\n' || 'Cela fait un moment que nous n''avons pas eu le plaisir de vous accueillir chez {salon} !'
                  || E'\n\n' || 'Votre dernière visite remonte à plus de {jours} jours. N''hésitez pas à prendre rendez-vous, nous serons ravis de vous retrouver.'
                  || E'\n\n' || 'À bientôt !' || E'\n' || '{salon}'),
                  '\n', E'\n');
      FOR c IN
        SELECT cl.id, cl.prenom, cl.nom, lower(trim(cl.email)) AS email, coalesce(v.derniere, cl.created_at::date) AS reference
          FROM clients cl
          LEFT JOIN LATERAL (SELECT max(a.date_rdv) AS derniere FROM appointments a
                              WHERE a.salon_id = s.id AND a.client_id = cl.id AND a.status = 'done'
                                AND coalesce(a.cancelled, false) = false) v ON true
         WHERE cl.salon_id = s.id AND coalesce(cl.actif, true) AND cl.fusionne_dans IS NULL AND cl.rgpd_anonymise_le IS NULL
           AND cl.email_ok IS TRUE AND cl.email ~ '^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$'
           AND coalesce(v.derniere, cl.created_at::date) <= v_jour - v_jours
           AND NOT EXISTS (SELECT 1 FROM appointments a2 WHERE a2.salon_id = s.id AND a2.client_id = cl.id
                             AND a2.date_rdv >= v_jour AND coalesce(a2.cancelled, false) = false AND a2.status IN ('conf', 'wait'))
           AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(CASE WHEN jsonb_typeof(cl.fiche_tech->'relances') = 'array'
                                                                    THEN cl.fiche_tech->'relances' ELSE '[]'::jsonb END) rl
                             WHERE (rl->>'d') ~ '^\d{4}-\d{2}-\d{2}' AND (rl->>'d')::date > v_jour - 182)
           -- une seule relance e-mail par période d'inactivité (et 6 mois minimum), y compris envoyée par l'application
           AND NOT EXISTS (SELECT 1 FROM messaging_log m WHERE m.salon_id = s.id AND m.type = 'email' AND m.context = 'relance'
                             AND lower(trim(m.recipient)) = lower(trim(cl.email))
                             AND m.created_at > greatest(coalesce(v.derniere, cl.created_at::date)::timestamptz, now() - interval '182 days'))
         ORDER BY coalesce(v.derniere, cl.created_at::date)
         LIMIT 100
      LOOP
        BEGIN
          v_em := c.email;
          INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, client_nom, dedup_key)
          VALUES (s.id, 'email', v_em, 'Relance', 'brevo', 'relance', trim(coalesce(c.prenom,'')||' '||coalesce(c.nom,'')),
                  s.id::text || '|relance_email|' || v_em || '|' || v_jour::text);
          v_code := lx_prive.code_desinscription(c.id, 'email');
          v_lien := CASE WHEN v_code IS NOT NULL THEN 'https://luxyra.fr/stop/' || v_code ELSE NULL END;
          v_msg := replace(replace(replace(replace(v_modele, '{prenom}', coalesce(c.prenom,'')), '{nom}', coalesce(c.nom,'')),
                           '{salon}', coalesce(s.nom,'')), '{jours}', (v_jour - c.reference)::text);
          v_titre := 'Vous nous manquez !';
          v_sujet := 'Vous nous manquez ! - ' || coalesce(s.nom,'');
          v_html := lx_prive.email_marketing_html(s.nom, s.logo, v_titre, v_msg, v_lien);
          PERFORM net.http_post(
            url := 'https://luxyra.fr/api/email/custom',
            headers := jsonb_build_object('Content-Type','application/json','x-lx-internal', lx_prive.cle_service()),
            body := jsonb_build_object('to', v_em, 'toName', trim(coalesce(c.prenom,'')||' '||coalesce(c.nom,'')),
                                       'salonName', coalesce(s.nom,'Luxyra'), 'salonEmail', coalesce(nullif(s.email,''),'contact@luxyra.fr'),
                                       'subject', v_sujet, 'htmlContent', v_html, 'textContent', v_msg || coalesce(E'\n\nSe désinscrire : ' || v_lien, ''),
                                       'context', 'relance', 'salon_id', s.id, 'unsubscribeUrl', v_lien),
            timeout_milliseconds := 30000);
          v_rel_em := v_rel_em + 1;
        EXCEPTION
          WHEN unique_violation THEN NULL;
          WHEN OTHERS THEN
            v_echecs_em := v_echecs_em + 1;
            BEGIN
              INSERT INTO audit_log (salon_id, action, details, operator_name)
              VALUES (s.id, 'EMAIL_AUTO_ECHEC', 'E-mail de relance non envoyé : ' || SQLERRM, 'traitement_automatique');
            EXCEPTION WHEN OTHERS THEN NULL; END;
        END;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'anniversaires', v_anniv, 'relances', v_rel,
                            'anniversaires_email', v_anniv_em, 'relances_email', v_rel_em, 'echecs_email', v_echecs_em);
END;
$function$;


-- =====================================================================================================
-- BLOC 8 — Désabonnement depuis l'espace client (#3)
-- APPLIQUÉ le 2026-10-17
--   Constat : le déclencheur trg_sync_consent_lx_to_salon (clients_luxyra -> clients) existait déjà et recopie
--   sms_ok / email_ok sur les fiches LIÉES (clients.client_luxyra_id). L'edge lx-profile (toggle_notif / update)
--   écrit bien clients_luxyra -> le désabonnement était déjà répercuté sur les fiches liées.
--   Trou restant : fiches de salon NON liées au compte mais portant la même adresse e-mail.
--   Correction : un RETRAIT de consentement (true -> false) est aussi appliqué aux fiches non liées de même
--   e-mail, seulement si l'adresse du compte est vérifiée (jamais de réactivation par e-mail).
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.fn_sync_consent_lx_to_salon()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  UPDATE public.clients
     SET sms_ok   = NEW.sms_ok,
         email_ok = NEW.email_ok,
         updated_at = now()
   WHERE client_luxyra_id = NEW.id
     AND (sms_ok IS DISTINCT FROM NEW.sms_ok OR email_ok IS DISTINCT FROM NEW.email_ok);

  -- 2026-10-17 audit réglages (#3) : retrait du consentement -> aussi les fiches non liées de même e-mail (vérifié)
  IF coalesce(NEW.email_verified, false) AND coalesce(NEW.email, '') <> ''
     AND ((OLD.sms_ok IS DISTINCT FROM false AND NEW.sms_ok = false)
          OR (OLD.email_ok IS DISTINCT FROM false AND NEW.email_ok = false)) THEN
    UPDATE public.clients
       SET sms_ok   = CASE WHEN NEW.sms_ok = false THEN false ELSE sms_ok END,
           email_ok = CASE WHEN NEW.email_ok = false THEN false ELSE email_ok END,
           updated_at = now()
     WHERE client_luxyra_id IS NULL
       AND lower(trim(email)) = lower(trim(NEW.email))
       AND ((NEW.sms_ok = false AND sms_ok IS DISTINCT FROM false)
            OR (NEW.email_ok = false AND email_ok IS DISTINCT FROM false));
  END IF;
  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_sync_consent_lx_to_salon failed: %', SQLERRM;
  RETURN NEW;
END;
$function$;


-- =====================================================================================================
-- BLOC 9 — Horaires effectifs : lx_horaires_effectifs (#5, #37) — même règle que site.html (_lxSiteEffHrs)
-- APPLIQUÉ le 2026-10-17
--   #37 : un collaborateur dont la semaine type existe (au moins un jour renseigné, même à « Repos ») suit SA
--         semaine : 7 jours en « Repos » = jamais réservable (avant : retombait sur les horaires du salon).
--         Semaine absente ou vide ({}) -> horaires de l'établissement (inchangé).
--   #5  : les horaires de l'ÉTABLISSEMENT (jour fermé, ouverture/fermeture) limitent toujours ceux du
--         collaborateur, sauf horaire personnalisé posé pour CE jour (choix explicite) ; les ouvertures
--         exceptionnelles élargissent ensuite comme avant. Établissement sans aucun horaire saisi -> pas de limite.
--   Utilisée par rdv_creneau_refus (validation des réservations en ligne), rdv_dispo_conflit et fn_salon_next_slots.
-- =====================================================================================================
set lock_timeout = '8s';
CREATE OR REPLACE FUNCTION public.lx_horaires_effectifs(p_salon uuid, p_collab integer, p_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cfg_h jsonb; v_abs jsonb; v_dow text; v_col record; v_h jsonb; v_ov jsonb;
  v_o int; v_c int; v_eo int; v_ec int; v_b jsonb := '[]'::jsonb; v_r jsonb; v_n int := 0;
  v_cid text;
  v_perso boolean := false;     -- 2026-10-17 audit réglages (#5) : semaine type du collaborateur utilisée
  v_hs jsonb; v_sal_def boolean; -- horaires de l'établissement du jour / au moins un jour saisi
begin
  if p_salon is null or p_date is null then return null; end if;
  v_dow := extract(dow from p_date)::int::text;
  select to_jsonb(sc.horaires_salon), to_jsonb(sc.absences) into v_cfg_h, v_abs
    from site_config sc where sc.salon_id = p_salon limit 1;
  v_abs := case when jsonb_typeof(v_abs) = 'array' then v_abs else '[]'::jsonb end;

  -- Établissement entièrement fermé ce jour (fermeture exceptionnelle / absence globale à la journée)
  if exists (select 1 from jsonb_array_elements(v_abs) e
              where coalesce(e->>'stId','') in ('','null') and (
                   ((e->>'type') = 'fermeture_except' and e->>'date' = p_date::text)
                or (coalesce(e->>'type','absent') in ('conge','absent_jour','absent','maladie','formation') and (
                      (coalesce(e->>'dateFrom', e->>'from') ~ '^\d{4}-\d{2}-\d{2}' and coalesce(e->>'dateFrom', e->>'from') <= p_date::text
                       and coalesce(e->>'dateTo', e->>'to') >= p_date::text)
                   or (e->>'date' = p_date::text and (e->>'from') is null))))) then
    return null;
  end if;

  -- « Pas de préférence » : plage la plus large des collaborateurs présents ce jour
  if p_collab is null then
    for v_col in select c.id from collaborateurs c
                  where c.salon_id = p_salon and coalesce(c.actif,true) = true and coalesce(c.inactif,false) = false
                    and (c.date_depart is null or c.date_depart > p_date) loop
      v_n := v_n + 1;
      v_r := public.lx_horaires_effectifs(p_salon, v_col.id, p_date);
      continue when v_r is null;
      v_o := least(coalesce(v_o, (v_r->>'o')::int), (v_r->>'o')::int);
      v_c := greatest(coalesce(v_c, (v_r->>'c')::int), (v_r->>'c')::int);
    end loop;
    if v_n > 0 then
      if v_o is null or v_c is null then return null; end if;
      return jsonb_build_object('o', v_o, 'c', v_c, 'b', '[]'::jsonb);
    end if;
    -- Établissement sans collaborateur : horaires de l'établissement + ouverture exceptionnelle
    v_h := v_cfg_h -> v_dow;
    if jsonb_typeof(v_h) = 'object' and not coalesce((v_h->>'ferme')::boolean, false) then
      v_o := lx_hm(v_h->>'o'); v_c := lx_hm(v_h->>'c');
    end if;
    select min(lx_hm(e->>'horaire_o')), max(lx_hm(e->>'horaire_c')) into v_eo, v_ec from jsonb_array_elements(v_abs) e
     where e->>'type' = 'ouverture_except' and e->>'date' = p_date::text and e->>'horaire_o' is not null and e->>'horaire_c' is not null
       and coalesce(e->>'stId','') in ('','null');
    if v_eo is not null then v_o := least(coalesce(v_o, v_eo), v_eo); v_c := greatest(coalesce(v_c, v_ec), v_ec); end if;
    if v_o is null or v_c is null then return null; end if;
    select coalesce(jsonb_agg(jsonb_build_array(lx_hm(e->>'from'), lx_hm(e->>'to'))), '[]'::jsonb) into v_b
      from jsonb_array_elements(v_abs) e
     where (e->>'type') in ('pause','absent_heures') and e->>'date' = p_date::text
       and lx_hm(e->>'from') is not null and lx_hm(e->>'to') is not null and coalesce(e->>'stId','') in ('','null');
    return jsonb_build_object('o', v_o, 'c', v_c, 'b', v_b);
  end if;

  -- Collaborateur précis
  select c.id, c.horaires, c.horaires_overrides, c.pause, c.actif, c.inactif, c.date_depart into v_col
    from collaborateurs c where c.id = p_collab and c.salon_id = p_salon;
  if not found then return null; end if;
  if coalesce(v_col.actif,true) = false or coalesce(v_col.inactif,false) = true
     or (v_col.date_depart is not null and v_col.date_depart <= p_date) then return null; end if;
  v_cid := p_collab::text;

  -- Fermeture exceptionnelle / congé / absence journée de CE collaborateur
  if exists (select 1 from jsonb_array_elements(v_abs) e
              where e->>'stId' = v_cid and (
                   ((e->>'type') = 'fermeture_except' and e->>'date' = p_date::text)
                or (coalesce(e->>'type','absent') in ('conge','absent_jour','absent','maladie','formation') and (
                      (coalesce(e->>'dateFrom', e->>'from') ~ '^\d{4}-\d{2}-\d{2}' and coalesce(e->>'dateFrom', e->>'from') <= p_date::text
                       and coalesce(e->>'dateTo', e->>'to') >= p_date::text)
                   or (e->>'date' = p_date::text and (e->>'from') is null))))) then
    return null;
  end if;

  -- Horaires personnalisés du jour (mode « Personnalisés »)
  if v_col.horaires_overrides is not null and jsonb_typeof(v_col.horaires_overrides) = 'object'
     and v_col.horaires_overrides ? p_date::text then
    v_ov := v_col.horaires_overrides -> p_date::text;
    if v_ov is null or jsonb_typeof(v_ov) <> 'object' then return null; end if;  -- null = absent ce jour
    v_h := v_ov;
  -- 2026-10-17 audit réglages (#37) : semaine type PRÉSENTE (au moins une clé) -> elle s'applique, même 7 jours
  -- en « Repos » (avant : sans aucun jour travaillé, retour aux horaires de l'établissement)
  elsif v_col.horaires is not null and jsonb_typeof(v_col.horaires) = 'object'
        and v_col.horaires <> '{}'::jsonb then
    v_h := v_col.horaires -> v_dow;            -- semaine type du collaborateur (jour absent / null = repos)
    v_perso := true;
  else
    v_h := v_cfg_h -> v_dow;                   -- semaine type de l'établissement
  end if;
  if jsonb_typeof(v_h) = 'object' and not coalesce((v_h->>'ferme')::boolean, false) then
    v_o := lx_hm(v_h->>'o'); v_c := lx_hm(v_h->>'c');
  end if;

  -- 2026-10-17 audit réglages (#5) : limite des horaires de l'établissement (jour fermé, ouverture, fermeture)
  if v_perso and v_o is not null and v_c is not null then
    select exists (select 1 from jsonb_each(case when jsonb_typeof(v_cfg_h) = 'object' then v_cfg_h else '{}'::jsonb end) k
                    where jsonb_typeof(k.value) = 'object' and lx_hm(k.value->>'o') is not null and lx_hm(k.value->>'c') is not null)
      into v_sal_def;
    if v_sal_def then
      v_hs := v_cfg_h -> v_dow;
      if jsonb_typeof(v_hs) = 'object' and not coalesce((v_hs->>'ferme')::boolean, false)
         and lx_hm(v_hs->>'o') is not null and lx_hm(v_hs->>'c') is not null then
        v_o := greatest(v_o, lx_hm(v_hs->>'o'));
        v_c := least(v_c, lx_hm(v_hs->>'c'));
        if v_o >= v_c then v_o := null; v_c := null; end if;
      else
        v_o := null; v_c := null;              -- établissement fermé ce jour-là
      end if;
    end if;
  end if;

  -- Ouverture exceptionnelle (établissement ou ce collaborateur) : élargit / ouvre
  select min(lx_hm(e->>'horaire_o')), max(lx_hm(e->>'horaire_c')) into v_eo, v_ec from jsonb_array_elements(v_abs) e
   where e->>'type' = 'ouverture_except' and e->>'date' = p_date::text and e->>'horaire_o' is not null and e->>'horaire_c' is not null
     and (coalesce(e->>'stId','') in ('','null') or e->>'stId' = v_cid);
  if v_eo is not null then v_o := least(coalesce(v_o, v_eo), v_eo); v_c := greatest(coalesce(v_c, v_ec), v_ec); end if;
  if v_o is null or v_c is null then return null; end if;

  -- Plages bloquées : pause du jour (personnalisée) sinon pause habituelle, absences en heures / pauses déclarées
  select coalesce(jsonb_agg(jsonb_build_array(s, f)), '[]'::jsonb) into v_b from (
    select lx_hm(v_h->>'pause_o') s, lx_hm(v_h->>'pause_c') f
     where jsonb_typeof(v_h) = 'object' and v_h->>'pause_o' is not null and v_h->>'pause_c' is not null
    union all
    select lx_hm(v_col.pause->>'o'), lx_hm(v_col.pause->>'c')
     where jsonb_typeof(v_col.pause) = 'object'
       and not (jsonb_typeof(v_h) = 'object' and v_h->>'pause_o' is not null and v_h->>'pause_c' is not null)
    union all
    select lx_hm(e->>'from'), lx_hm(e->>'to') from jsonb_array_elements(v_abs) e
     where (e->>'type') in ('pause','absent_heures') and e->>'date' = p_date::text
       and (coalesce(e->>'stId','') in ('','null') or e->>'stId' = v_cid)
  ) z where s is not null and f is not null and f > s;
  return jsonb_build_object('o', v_o, 'c', v_c, 'b', v_b);
end $function$;


-- =====================================================================================================
-- BLOC 10 — Réservation en ligne : durée (#33), ancienne case « acompte obligatoire » (#24),
--           compétences (#6), « Bloquer la création de nouveaux comptes » (#25)
-- APPLIQUÉ le 2026-10-17
--   Modifications ciblées (remplacement de texte vérifié, idempotent : rien n'est refait si la marque existe).
--   Ne touche ni aux tickets ni aux acomptes scellés (NF525) : seulement le calcul du montant DÛ à la réservation.
-- =====================================================================================================
set lock_timeout = '8s';

-- Durée d'une prestation = somme des étapes (travail + temps de pose), comme le site (s.phases[].d)
create or replace function lx_prive.service_duree(p_sid integer, p_salon uuid)
returns integer language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#33)
  select coalesce(round(sum((ph->>'d')::numeric)), 0)::int
    from public.services s,
         jsonb_array_elements(case when jsonb_typeof(s.phases) = 'array' then s.phases else '[]'::jsonb end) ph
   where s.id = p_sid and s.salon_id = p_salon and (ph->>'d') ~ '^\s*\d+(\.\d+)?\s*$'
$$;

-- Habilitation d'un collaborateur (même règle que site.html _lxCollabHabilite / app canCollabDoService) :
-- compétences absentes ou all=true -> habilité ; sinon la prestation doit figurer dans « services ».
create or replace function lx_prive.collab_habilite(p_comp jsonb, p_sid integer)
returns boolean language sql immutable
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#6)
  select p_sid is null or p_comp is null or jsonb_typeof(p_comp) <> 'object'
      or coalesce(p_comp->>'all', '') = 'true'
      or (jsonb_typeof(p_comp->'services') = 'array'
          and (p_comp->'services' @> to_jsonb(p_sid) or p_comp->'services' @> to_jsonb(p_sid::text)))
$$;

-- #33 + #24 : lx_prive.rdv_online_insert_public_propre (BEFORE INSERT, premier déclencheur : la durée recalculée
-- sert ensuite à rdv_online_validate et à rdv_online_block_double_booking)
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('lx_prive.rdv_online_insert_public_propre'::regproc);
  if position('2026-10-17 audit réglages (#33)' in d) > 0 then raise notice 'déjà appliqué'; return; end if;
  n := d;
  n := replace(n, $x$  v_items jsonb := '[]'::jsonb;          -- 2026-10-15 : items recopiés avec le drapeau du catalogue$x$,
                  $x$  v_items jsonb := '[]'::jsonb;          -- 2026-10-15 : items recopiés avec le drapeau du catalogue
  v_dur integer := 0;                    -- 2026-10-17 audit réglages (#33) : durée recalculée depuis le catalogue$x$);
  n := replace(n, $x$      v_base := v_base + coalesce(v_p, 0);$x$,
                  $x$      v_base := v_base + coalesce(v_p, 0);
      v_dur := v_dur + lx_prive.service_duree(v_sid, NEW.salon_id);  -- 2026-10-17 audit réglages (#33)$x$);
  n := replace(n, $x$    v_base := coalesce(v_p, 0);$x$,
                  $x$    v_base := coalesce(v_p, 0);
    v_dur := lx_prive.service_duree(NEW.service_id, NEW.salon_id);  -- 2026-10-17 audit réglages (#33)$x$);
  n := replace(n, $x$  -- Remise carte d'abonnement : seulement une carte ACTIVE de cet établissement, non expirée$x$,
                  $x$  -- 2026-10-17 audit réglages (#33) : la durée envoyée par le navigateur ne peut pas être plus courte que
  -- celle des prestations du catalogue (somme des étapes) -> créneau, chevauchements et fermeture contrôlés sur la vraie durée
  IF v_dur > 0 THEN NEW.duree_minutes := greatest(coalesce(NEW.duree_minutes, 0), v_dur); END IF;

  -- Remise carte d'abonnement : seulement une carte ACTIVE de cet établissement, non expirée$x$);
  -- #24 : l'ancienne case « acompte obligatoire » ne déclenche plus d'acompte : seul le mode « acompte » compte
  n := replace(n, $x$  IF v_mode = 'acompte' OR coalesce(v_cfg.acompte_obligatoire,false) THEN$x$,
                  $x$  IF v_mode = 'acompte' THEN  -- 2026-10-17 audit réglages (#24) : avant « OR acompte_obligatoire »$x$);
  n := replace(n, $x$    NEW.acompte_montant := CASE WHEN coalesce(v_cfg.acompte_obligatoire,false) THEN v_req ELSE 0 END;$x$,
                  $x$    NEW.acompte_montant := CASE WHEN v_mode = 'acompte' THEN v_req ELSE 0 END;  -- 2026-10-17 audit réglages (#24)$x$);
  if (length(n) - length(replace(n, '2026-10-17 audit réglages', ''))) / length('2026-10-17 audit réglages') <> 6 then
    raise exception 'rdv_online_insert_public_propre : remplacement incomplet';
  end if;
  execute n;
end $do$;

-- #6 + #25 : public.rdv_online_validate
do $do$
declare d text; n text;
begin
  d := pg_get_functiondef('public.rdv_online_validate'::regproc);
  if position('2026-10-17 audit réglages (#6' in d) > 0 then raise notice 'déjà appliqué'; return; end if;
  n := d;
  n := replace(n, $x$  v_items_count   integer := 0;$x$,
                  $x$  v_items_count   integer := 0;
  -- 2026-10-17 audit réglages (#6, #25)
  v_col_comp      jsonb := NULL;
  v_sids          integer[] := '{}';
  v_ns            integer;
  v_ne            integer;
  v_ok            boolean;
  v_c             record;
  v_eh            jsonb;
  v_bloque        boolean;$x$);
  n := replace(n, $x$      IF coalesce(v_svc_book, true) = false OR coalesce(v_svc_show, true) = false THEN
        RAISE EXCEPTION 'Le service "%" n''est pas réservable en ligne', coalesce(v_item->>'nom', v_item_sid::text);
      END IF;$x$,
                  $x$      IF coalesce(v_svc_book, true) = false OR coalesce(v_svc_show, true) = false THEN
        RAISE EXCEPTION 'Le service "%" n''est pas réservable en ligne', coalesce(v_item->>'nom', v_item_sid::text);
      END IF;
      v_sids := v_sids || v_item_sid;  -- 2026-10-17 audit réglages (#6)$x$);
  n := replace(n, $x$    IF coalesce(v_svc_book, true) = false OR coalesce(v_svc_show, true) = false THEN
      RAISE EXCEPTION 'Ce service n''est pas réservable en ligne';
    END IF;$x$,
                  $x$    IF coalesce(v_svc_book, true) = false OR coalesce(v_svc_show, true) = false THEN
      RAISE EXCEPTION 'Ce service n''est pas réservable en ligne';
    END IF;
    v_sids := ARRAY[NEW.service_id];  -- 2026-10-17 audit réglages (#6)$x$);
  n := replace(n, $x$    SELECT salon_id, actif, coalesce(inactif,false), date_depart, to_jsonb(horaires)
    INTO v_col_salon, v_col_actif, v_col_inactif, v_col_depart, v_col_horaires$x$,
                  $x$    SELECT salon_id, actif, coalesce(inactif,false), date_depart, to_jsonb(horaires), to_jsonb(competences)
    INTO v_col_salon, v_col_actif, v_col_inactif, v_col_depart, v_col_horaires, v_col_comp$x$);
  n := replace(n, $x$  -- 2026-10-15 : délais, fermetures, horaires effectifs, pauses, absences — règle commune avec fn_salon_next_slots$x$,
                  $x$  -- 2026-10-17 audit réglages (#6, #25) : contrôles des réservations faites par le PUBLIC (pas par le salon)
  IF NOT (public.is_admin() OR EXISTS (SELECT 1 FROM public.salons s WHERE s.id = NEW.salon_id AND s.user_id = auth.uid())) THEN
    -- #25 « Bloquer la création de nouveaux comptes » : seuls les clients déjà connus de l'établissement réservent
    SELECT coalesce(sc.bloquer_nouveaux_comptes, false) INTO v_bloque FROM public.site_config sc WHERE sc.salon_id = NEW.salon_id LIMIT 1;
    IF coalesce(v_bloque, false) THEN
      IF NOT EXISTS (SELECT 1 FROM public.clients c
                      WHERE c.salon_id = NEW.salon_id AND c.fusionne_dans IS NULL AND c.rgpd_anonymise_le IS NULL
                        AND ((NEW.client_luxyra_id IS NOT NULL AND c.client_luxyra_id = NEW.client_luxyra_id)
                          OR (coalesce(NEW.client_email,'') <> '' AND lower(trim(c.email)) = lower(trim(NEW.client_email)))
                          OR (coalesce(NEW.client_tel,'') <> '' AND c.telephone_norm = public.normalize_phone(NEW.client_tel))))
         AND NOT EXISTS (SELECT 1 FROM public.rdv_online r
                          WHERE r.salon_id = NEW.salon_id AND r.status IN ('confirmed','done','completed')
                            AND ((NEW.client_luxyra_id IS NOT NULL AND r.client_luxyra_id = NEW.client_luxyra_id)
                              OR (coalesce(NEW.client_email,'') <> '' AND lower(trim(r.client_email)) = lower(trim(NEW.client_email))))) THEN
        RAISE EXCEPTION 'Cet établissement n''accepte plus de nouveaux clients en ligne pour le moment : contactez-le directement pour réserver';
      END IF;
    END IF;

    -- #6 compétences : collaborateur choisi habilité pour CHAQUE prestation
    IF NEW.collaborateur_id IS NOT NULL AND array_length(v_sids, 1) > 0 THEN
      IF EXISTS (SELECT 1 FROM unnest(v_sids) x(sid) WHERE NOT lx_prive.collab_habilite(v_col_comp, x.sid)) THEN
        RAISE EXCEPTION 'Ce collaborateur ne réalise pas cette prestation : choisissez un autre collaborateur ou « Pas de préférence »';
      END IF;
    -- « Pas de préférence » : au moins un collaborateur habilité pour toutes les prestations, présent et libre
    ELSIF NEW.collaborateur_id IS NULL AND array_length(v_sids, 1) > 0 AND NEW.heure_rdv IS NOT NULL
          AND EXISTS (SELECT 1 FROM public.collaborateurs c0
                       WHERE c0.salon_id = NEW.salon_id AND coalesce(c0.actif,true) AND NOT coalesce(c0.inactif,false)
                         AND (c0.date_depart IS NULL OR c0.date_depart > NEW.date_rdv)) THEN
      v_ns := extract(hour FROM NEW.heure_rdv)::int * 60 + extract(minute FROM NEW.heure_rdv)::int;
      v_ne := v_ns + coalesce(NEW.duree_minutes, 30);
      v_ok := false;
      FOR v_c IN SELECT c.id, to_jsonb(c.competences) AS comp FROM public.collaborateurs c
                  WHERE c.salon_id = NEW.salon_id AND coalesce(c.actif,true) AND NOT coalesce(c.inactif,false)
                    AND (c.date_depart IS NULL OR c.date_depart > NEW.date_rdv)
      LOOP
        CONTINUE WHEN EXISTS (SELECT 1 FROM unnest(v_sids) x(sid) WHERE NOT lx_prive.collab_habilite(v_c.comp, x.sid));
        v_eh := public.lx_horaires_effectifs(NEW.salon_id, v_c.id, NEW.date_rdv);
        CONTINUE WHEN v_eh IS NULL OR public.lx_int_sur(v_eh->>'o') IS NULL OR public.lx_int_sur(v_eh->>'c') IS NULL;
        CONTINUE WHEN v_ns < public.lx_int_sur(v_eh->>'o') OR v_ne > public.lx_int_sur(v_eh->>'c');
        CONTINUE WHEN EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_eh->'b','[]'::jsonb)) b
                               WHERE coalesce(v_ns < public.lx_int_sur(b->>1) AND v_ne > public.lx_int_sur(b->>0), true));
        CONTINUE WHEN EXISTS (SELECT 1 FROM lx_prive.rdv_occupations(NEW.salon_id, NEW.date_rdv) o
                               WHERE o.collab_id = v_c.id AND o.debut < v_ne AND o.fin > v_ns);
        v_ok := true; EXIT;
      END LOOP;
      IF NOT v_ok THEN
        RAISE EXCEPTION 'Aucun collaborateur réalisant cette prestation n''est disponible sur ce créneau : choisissez un autre horaire';
      END IF;
    END IF;
  END IF;

  -- 2026-10-15 : délais, fermetures, horaires effectifs, pauses, absences — règle commune avec fn_salon_next_slots$x$);
  if (length(n) - length(replace(n, '2026-10-17 audit réglages', ''))) / length('2026-10-17 audit réglages') <> 4
     or position('to_jsonb(competences)' in n) = 0 then
    raise exception 'rdv_online_validate : remplacement incomplet';
  end if;
  execute n;
end $do$;


-- =====================================================================================================
-- BLOC 11 — Site / réservation coupés par le forfait (#1, utilisé par le worker)
-- APPLIQUÉ le 2026-10-17
--   site_config.coupe_par_forfait : état AVANT la coupure automatique du worker (passage en Essentiel ou
--   résiliation), ex. {"site_actif":true,"reservation_active":false}. Au retour en Pro, le worker restaure
--   exactement cet état (et jamais plus). Si le pro modifie lui-même site_actif / reservation_active entre-temps,
--   la mémoire est effacée (son choix prime). Le worker ne réactive plus rien au renouvellement mensuel.
-- =====================================================================================================
set lock_timeout = '8s';
alter table public.site_config add column if not exists coupe_par_forfait jsonb;
comment on column public.site_config.coupe_par_forfait is
  '2026-10-17 audit réglages (#1) : état site_actif / reservation_active avant coupure automatique par le forfait (restauré au retour en Pro).';

create or replace function lx_prive.site_config_choix_pro()
returns trigger language plpgsql
set search_path to 'public', 'pg_temp'
as $$
-- 2026-10-17 audit réglages (#1) : un changement fait par le pro (pas par le serveur) efface la mémoire de coupure
begin
  if coalesce((select auth.role()), '') <> 'service_role'
     and (NEW.site_actif is distinct from OLD.site_actif or NEW.reservation_active is distinct from OLD.reservation_active) then
    NEW.coupe_par_forfait := null;
  end if;
  return NEW;
end $$;
drop trigger if exists trg_site_config_choix_pro on public.site_config;
create trigger trg_site_config_choix_pro before update of site_actif, reservation_active on public.site_config
  for each row execute function lx_prive.site_config_choix_pro();


-- =====================================================================================================
-- BLOC 12 — Désinscription : fonctions appelées par le worker (clé service uniquement) (#4)
-- APPLIQUÉ le 2026-10-17
--   lx_lien_desinscription(salon, email, canal) : code court de la fiche de CE salon portant cet e-mail (ou NULL)
--   lx_desinscrire_code(code)                   : retire le consentement (sms_ok / email_ok = false) + journal RGPD
-- =====================================================================================================
set lock_timeout = '8s';
create or replace function public.lx_lien_desinscription(p_salon uuid, p_email text, p_canal text default 'email')
returns text language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
-- 2026-10-17 audit réglages (#4)
declare v_cid uuid;
begin
  if p_salon is null or coalesce(trim(p_email), '') = '' then return null; end if;
  select c.id into v_cid from public.clients c
   where c.salon_id = p_salon and lower(trim(c.email)) = lower(trim(p_email))
     and c.fusionne_dans is null and c.rgpd_anonymise_le is null
   order by c.created_at limit 1;
  if v_cid is null then return null; end if;
  return lx_prive.code_desinscription(v_cid, coalesce(nullif(p_canal, ''), 'email'));
end $$;
revoke all on function public.lx_lien_desinscription(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lx_lien_desinscription(uuid, text, text) to service_role;

create or replace function public.lx_desinscrire_code(p_code text)
returns jsonb language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $$
-- 2026-10-17 audit réglages (#4) : lien « STOP SMS » / « Se désinscrire » (luxyra.fr/stop/<code>)
declare v record; v_salon text;
begin
  if coalesce(p_code, '') !~ '^[0-9a-f]{10}$' then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide'); end if;
  select d.code, d.canal, d.client_id, c.salon_id, c.prenom, c.nom into v
    from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
   where d.code = p_code;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide ou expiré'); end if;
  update public.clients
     set sms_ok   = case when v.canal in ('sms','all') then false else sms_ok end,
         email_ok = case when v.canal in ('email','all') then false else email_ok end,
         updated_at = now()
   where id = v.client_id;
  update public.lx_desinscription_codes set utilise_le = coalesce(utilise_le, now()) where code = p_code;
  select s.nom into v_salon from public.salons s where s.id = v.salon_id;
  begin
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (v.salon_id, 'RGPD_UNSUBSCRIBE',
            'Client ' || trim(coalesce(v.prenom,'') || ' ' || coalesce(v.nom,'')) || ' désabonné (' || v.canal || ') via le lien de désinscription',
            'Auto (lien de désinscription)');
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'canal', v.canal, 'salon', coalesce(v_salon, ''));
end $$;
revoke all on function public.lx_desinscrire_code(text) from public, anon, authenticated;
grant execute on function public.lx_desinscrire_code(text) to service_role;

-- Nom du salon pour la page de confirmation (lecture seule, sans effet)
create or replace function public.lx_desinscription_info(p_code text)
returns jsonb language sql stable security definer
set search_path to 'public', 'pg_temp'
as $$
  -- 2026-10-17 audit réglages (#4)
  select coalesce((select jsonb_build_object('ok', true, 'canal', d.canal, 'salon', coalesce(s.nom, ''), 'deja', d.utilise_le is not null)
                     from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
                     left join public.salons s on s.id = c.salon_id
                    where d.code = p_code), jsonb_build_object('ok', false))
$$;
revoke all on function public.lx_desinscription_info(text) from public, anon, authenticated;
grant execute on function public.lx_desinscription_info(text) to service_role;


-- =====================================================================================================
-- BLOC 13 — Bot d'assistance (support_bot_kb)
-- APPLIQUÉ le 2026-10-17
--   UPDATE rappels_automatiques : « Rappels SMS actifs » ne coupe plus l'e-mail ; mode téléphone = téléphone lié.
--   INSERT (on conflict do update) : rappels_reglages_1017, reservation_en_ligne_regles_1017,
--     site_forfait_renouvellement_1017, empreinte_capture_1017 (actifs) ;
--     desinscription_marketing_1017, anniv_relance_email_serveur_1017 (actif = false : à activer avec le drapeau
--     desinscription_courte, voir ACTIVATION ci-dessous).
--   (texte complet : voir la requête exécutée le 17/10 ; contenu relisible par
--    select cle, contenu from support_bot_kb where cle like '%_1017';)
-- =====================================================================================================


-- =====================================================================================================
-- EDGE FUNCTION redéployée (copie : docs/edge_1017/cron-empreinte-auto-capture/)
--   cron-empreinte-auto-capture v8 (avant : v7, copie index.v7.avant.ts) — #8 : délai 0 = pas de capture auto ;
--   heure du RDV lue à l'heure de Paris. Testée le 17/10 (appel pg_net, réponse 200, aucune empreinte en cours).
-- =====================================================================================================


-- =====================================================================================================
-- ACTIVATION (À FAIRE APRÈS LA PUBLICATION DU WORKER : push -> GitHub Action -> route /stop/<code> en ligne)
--   Tant que ce drapeau est faux : pas de mention « STOP SMS » ajoutée et pas d'e-mails d'anniversaire / relance
--   envoyés par le serveur (l'application continue de les envoyer quand elle est ouverte, comme avant).
--   Vérifier d'abord que https://luxyra.fr/stop/0000000000 répond « Lien invalide ou expiré » (et pas la page 404 du site).
-- =====================================================================================================
-- update app_config set config = config || '{"desinscription_courte":true}'::jsonb where id = 1;
-- update support_bot_kb set actif = true, maj_le = now() where cle in ('desinscription_marketing_1017','anniv_relance_email_serveur_1017');
