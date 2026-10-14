-- =====================================================================================
-- 2026-10-14 audit — Réglages (branche fix1014-reglages)
-- Fichier IDEMPOTENT : peut être rejoué. NE PAS appliquer avant relecture.
-- Fonctions recréées à partir des définitions EXACTES lues en base le 14/10 (md5 vérifiés), éditions minimales.
--   1) fn_salon_next_slots     : fenêtre = delai_max_jours du salon (1..365) au lieu d'un plafond de 60 j (item 14)
--   2) envoyer_rappels_24h     : {collab} remplacé (jointure collaborateurs.nom, repli collab_name / collaborateur_nom) (item 5)
--      NOTE MERGE : l'agent « planning » peut aussi modifier cette fonction (comparaison de date). Mes seules
--      modifications : + colonne « collab » dans les 2 SELECT du FOR r, + 2 LEFT JOIN collaborateurs, + 1 ligne
--      replace('{collab}'). Tout le reste est strictement identique à la version en base.
--   3) envoyer_rappels_2h / envoyer_rappels_email_24h : NOUVELLES, rappels côté serveur (item 6), INACTIVES tant que
--      app_config.config->>'rappels_serveur_2h_email' <> true (voir bloc ACTIVATION en fin de fichier).
--   4) support_bot_kb : 2 lignes (reglages_site_1014, rappels_automatiques).
-- Ordre de mise en service : (a) déployer le worker (exemption de limite par IP pour x-lx-internal, statut Connect
-- unifié) et l'app ; (b) appliquer ce fichier ; (c) essai à blanc ; (d) activation.
-- =====================================================================================

BEGIN;

-- ---------- 1) fn_salon_next_slots ----------
CREATE OR REPLACE FUNCTION public.fn_salon_next_slots(p_salon_id uuid, p_n integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cfg record; v_now timestamp; v_min timestamp; v_max date; v_step int; v_dur int; v_n int;
  v_res jsonb := '[]'::jsonb; v_d date; v_dow text; v_off int; v_abs jsonb;
  v_col record; v_cols jsonb := '[]'::jsonb; v_has_cols boolean;
  v_busy jsonb; v_t int; v_open int; v_close int; v_h jsonb; v_o int; v_c int; v_ok boolean;
  v_ce jsonb; v_e jsonb; v_cid text; v_label text;
begin
  select horaires_salon, coalesce(absences,'[]'::jsonb) absences, delai_min_heures, delai_max_jours, creneau_intervalle
    into v_cfg from site_config where salon_id = p_salon_id limit 1;
  if v_cfg is null or v_cfg.horaires_salon is null then return null; end if;
  v_abs := case when jsonb_typeof(v_cfg.absences)='array' then v_cfg.absences else '[]'::jsonb end;
  v_n := least(greatest(coalesce(p_n,3),1),10);
  v_step := case when coalesce(v_cfg.creneau_intervalle,15) between 5 and 240 then v_cfg.creneau_intervalle else 15 end;
  v_now := (now() at time zone 'Europe/Paris')::timestamp;
  v_min := v_now + (coalesce(v_cfg.delai_min_heures,2) || ' hours')::interval;
  -- 2026-10-14 audit : fenetre reglee par le salon (1 a 365 j, comme l'app) ; avant : plafonnee a 60 j
  v_max := (v_now + (least(greatest(coalesce(v_cfg.delai_max_jours,30),1),365) || ' days')::interval)::date;
  -- durée de référence : la plus courte prestation active (30 min par défaut)
  select min(t) into v_dur from (
    select (select sum(coalesce((ph->>'d')::int,0)) from jsonb_array_elements(case when jsonb_typeof(s.phases)='array' then s.phases else '[]'::jsonb end) ph) t
    from services s where s.salon_id = p_salon_id and coalesce(s.actif,true)) x where t >= 5;
  v_dur := coalesce(v_dur, 30);

  for v_off in 0..365 loop -- 2026-10-14 audit : sortie par v_max (avant : 0..60)
    v_d := v_now::date + v_off;
    exit when v_d > v_max or jsonb_array_length(v_res) >= v_n;
    continue when v_d < v_min::date;
    v_dow := extract(dow from v_d)::int::text;
    -- fermeture exceptionnelle de tout l'établissement / absence globale
    continue when exists (select 1 from jsonb_array_elements(v_abs) e where coalesce(e->>'stId','')='' and (
        ((e->>'type')='fermeture_except' and e->>'date'=v_d::text)
     or ((coalesce(e->>'type','absent') in ('conge','absent_jour','absent','maladie','formation')) and (
          (e->>'dateFrom' is not null and e->>'dateFrom'<=v_d::text and e->>'dateTo'>=v_d::text) or (e->>'date'=v_d::text and e->>'from' is null)))));

    -- horaires effectifs de chaque collaborateur présent ce jour
    v_cols := '[]'::jsonb;
    select count(*)>0 into v_has_cols from collaborateurs c where c.salon_id=p_salon_id and c.actif and not coalesce(c.inactif,false) and (c.date_depart is null or c.date_depart > v_d);
    for v_col in select c.id, c.horaires, c.horaires_overrides from collaborateurs c
                 where c.salon_id=p_salon_id and c.actif and not coalesce(c.inactif,false) and (c.date_depart is null or c.date_depart > v_d) loop
      v_cid := v_col.id::text;
      if v_col.horaires_overrides is not null and jsonb_typeof(v_col.horaires_overrides)='object' and v_col.horaires_overrides ? v_d::text then
        v_h := v_col.horaires_overrides -> v_d::text;
      elsif v_col.horaires is not null and jsonb_typeof(v_col.horaires)='object'
            and exists (select 1 from jsonb_each(v_col.horaires) k where jsonb_typeof(k.value)='object' and k.value->>'o' is not null) then
        v_h := v_col.horaires -> v_dow;
      else
        v_h := v_cfg.horaires_salon -> v_dow;
      end if;
      v_o := case when jsonb_typeof(v_h)='object' then lx_hm(v_h->>'o') end;
      v_c := case when jsonb_typeof(v_h)='object' then lx_hm(v_h->>'c') end;
      -- ouverture exceptionnelle (établissement ou ce collaborateur) : élargit
      select min(lx_hm(e->>'horaire_o')), max(lx_hm(e->>'horaire_c')) into v_open, v_close from jsonb_array_elements(v_abs) e
        where e->>'type'='ouverture_except' and e->>'date'=v_d::text and e->>'horaire_o' is not null and e->>'horaire_c' is not null
          and (coalesce(e->>'stId','')='' or e->>'stId'=v_cid);
      if v_open is not null then v_o := least(coalesce(v_o,v_open), v_open); v_c := greatest(coalesce(v_c,v_close), v_close); end if;
      continue when v_o is null or v_c is null;
      -- absent ce jour (fermeture exceptionnelle / congé / absence journée de CE collaborateur)
      continue when exists (select 1 from jsonb_array_elements(v_abs) e where e->>'stId'=v_cid and (
          ((e->>'type')='fermeture_except' and e->>'date'=v_d::text)
       or ((coalesce(e->>'type','absent') in ('conge','absent_jour','absent','maladie','formation')) and (
            (e->>'dateFrom' is not null and e->>'dateFrom'<=v_d::text and e->>'dateTo'>=v_d::text) or (e->>'date'=v_d::text and e->>'from' is null)))));
      -- plages occupées : absences en heures, pause du jour personnalisé, rendez-vous (avec durée)
      select coalesce(jsonb_agg(jsonb_build_array(s, f)), '[]'::jsonb) into v_busy from (
        select lx_hm(e->>'from') s, lx_hm(e->>'to') f from jsonb_array_elements(v_abs) e
          where (e->>'type') in ('pause','absent_heures') and e->>'date'=v_d::text and e->>'from' is not null and e->>'to' is not null
            and (coalesce(e->>'stId','')='' or e->>'stId'=v_cid)
        union all
        select lx_hm(v_h->>'pause_o'), lx_hm(v_h->>'pause_c') where jsonb_typeof(v_h)='object' and v_h->>'pause_o' is not null and v_h->>'pause_c' is not null
        union all
        select lx_hm(substring(r.heure_rdv::text,1,5)), lx_hm(substring(r.heure_rdv::text,1,5)) + coalesce(nullif(r.duree_minutes,0),30)
          from rdv_online r where r.salon_id=p_salon_id and r.date_rdv=v_d
            and (r.status in ('confirmed','pending') or (r.status='pending_payment' and r.created_at > now() - interval '35 minutes'))
            and (r.collaborateur_id is null or r.collaborateur_id::text=v_cid)
        union all
        select lx_hm(a.heure), lx_hm(a.heure) + coalesce(nullif((select sum(coalesce((ph->>'d')::int,0)) from jsonb_array_elements(
                 case when jsonb_typeof(a.a_phases)='array' and jsonb_array_length(a.a_phases)>0 then a.a_phases
                      else coalesce((select s2.phases from services s2 where s2.id=a.service_id),'[]'::jsonb) end) ph),0),30)
          from appointments a where a.salon_id=p_salon_id and a.date_rdv=v_d and a.status in ('conf','wait','done')
            and (a.collab_id is null or a.collab_id::text=v_cid)
      ) z where s is not null and f is not null;
      v_cols := v_cols || jsonb_build_object('o',v_o,'c',v_c,'b',v_busy);
    end loop;

    -- établissement sans collaborateur : horaires de l'établissement, tous les rendez-vous bloquent
    if not v_has_cols then
      v_h := v_cfg.horaires_salon -> v_dow;
      v_o := case when jsonb_typeof(v_h)='object' then lx_hm(v_h->>'o') end;
      v_c := case when jsonb_typeof(v_h)='object' then lx_hm(v_h->>'c') end;
      select min(lx_hm(e->>'horaire_o')), max(lx_hm(e->>'horaire_c')) into v_open, v_close from jsonb_array_elements(v_abs) e
        where e->>'type'='ouverture_except' and e->>'date'=v_d::text and e->>'horaire_o' is not null and e->>'horaire_c' is not null;
      if v_open is not null then v_o := least(coalesce(v_o,v_open), v_open); v_c := greatest(coalesce(v_c,v_close), v_close); end if;
      if v_o is not null and v_c is not null then
        select coalesce(jsonb_agg(jsonb_build_array(s, f)), '[]'::jsonb) into v_busy from (
          select lx_hm(e->>'from') s, lx_hm(e->>'to') f from jsonb_array_elements(v_abs) e
            where (e->>'type') in ('pause','absent_heures') and e->>'date'=v_d::text and e->>'from' is not null and e->>'to' is not null
          union all
          select lx_hm(substring(r.heure_rdv::text,1,5)), lx_hm(substring(r.heure_rdv::text,1,5)) + coalesce(nullif(r.duree_minutes,0),30)
            from rdv_online r where r.salon_id=p_salon_id and r.date_rdv=v_d
              and (r.status in ('confirmed','pending') or (r.status='pending_payment' and r.created_at > now() - interval '35 minutes'))
          union all
          select lx_hm(a.heure), lx_hm(a.heure) + 30 from appointments a where a.salon_id=p_salon_id and a.date_rdv=v_d and a.status in ('conf','wait','done')
        ) z where s is not null and f is not null;
        v_cols := jsonb_build_array(jsonb_build_object('o',v_o,'c',v_c,'b',v_busy));
      end if;
    end if;
    continue when jsonb_array_length(v_cols) = 0;

    -- grille : départ = ouverture la plus tôt du jour, pas = intervalle (comme le site)
    select min((x->>'o')::int), max((x->>'c')::int) into v_open, v_close from jsonb_array_elements(v_cols) x;
    v_t := v_open;
    while v_t + v_dur <= v_close and jsonb_array_length(v_res) < v_n loop
      if (v_d + make_interval(mins => v_t)) >= v_min then
        v_ok := false;
        for v_ce in select * from jsonb_array_elements(v_cols) loop
          if v_t >= (v_ce->>'o')::int and v_t + v_dur <= (v_ce->>'c')::int
             and not exists (select 1 from jsonb_array_elements(v_ce->'b') b where v_t < (b->>1)::int and v_t + v_dur > (b->>0)::int) then
            v_ok := true; exit;
          end if;
        end loop;
        if v_ok then
          v_label := case when v_off = 0 then 'Aujourd''hui' when v_off = 1 then 'Demain' else to_char(v_d, 'TMDay DD/MM') end;
          v_res := v_res || jsonb_build_object('date', v_d::text, 'time', lpad((v_t/60)::text,2,'0')||':'||lpad((v_t%60)::text,2,'0'), 'day_label', v_label);
        end if;
      end if;
      v_t := v_t + v_step * greatest(1, ceil(30.0 / v_step)::int);
    end loop;
  end loop;
  return v_res;
end $function$;

-- ---------- 2) envoyer_rappels_24h ----------
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
  v_envoyes int := 0; v_differes int := 0; v_ignores int := 0; v_echecs int := 0;
BEGIN
  v_demain := ((now() AT TIME ZONE 'Europe/Paris')::date + 1);

  FOR s IN SELECT id, nom, sms_credits, config_json FROM salons WHERE status IN ('active','trial')
  LOOP
    BEGIN v_cfg := (s.config_json #>> '{}')::jsonb -> 'sms_config';
    EXCEPTION WHEN OTHERS THEN v_cfg := NULL; END;
    CONTINUE WHEN v_cfg IS NULL;
    CONTINUE WHEN coalesce((v_cfg->>'rappelActif')::boolean,false) IS NOT TRUE;
    CONTINUE WHEN coalesce((v_cfg->>'rappel24h')::boolean,false) IS NOT TRUE;

    v_modele := coalesce(nullif(v_cfg->>'rappelTexte24h',''),
                'Bonjour {prenom}, nous vous rappelons votre RDV demain a {heure} chez {salon}. A bientot !');
    v_expediteur := coalesce(nullif(v_cfg->>'smsSender',''), s.nom);
    v_credits := coalesce(s.sms_credits,0);

    FOR r IN
      SELECT c.prenom AS prenom, c.nom AS nom, c.telephone AS tel,
             left(coalesce(a.heure,'12:00'),5) AS heure, a.date_rdv AS jour, ''::text AS prestation,
             coalesce(col.nom, a.collab_name, '') AS collab  -- 2026-10-14 audit : {collab}
        FROM appointments a JOIN clients c ON c.id = a.client_id
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
    LOOP
      -- Chaque cliente dans son propre bloc : un echec n'empeche jamais les suivantes
      BEGIN
        v_tel := regexp_replace(coalesce(r.tel,''), '[^0-9+]', '', 'g');
        CONTINUE WHEN length(v_tel) < 9;
        IF left(v_tel,1) = '0' THEN v_tel := '+33' || substr(v_tel,2); END IF;
        v_tail := right(v_tel,4);

        IF EXISTS (SELECT 1 FROM messaging_log m
                    WHERE m.salon_id = s.id AND m.type='sms'
                      AND m.context IN ('rappel_24h','confirmation_rdv','confirmation_rdv_groupe')
                      AND m.recipient = v_tail
                      AND (m.created_at AT TIME ZONE 'Europe/Paris')::date = (now() AT TIME ZONE 'Europe/Paris')::date)
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
        IF v_credits >= v_nb THEN
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
                            'ignores',v_ignores,'echecs',v_echecs);
END;
$function$;

-- ---------- 3) rappels serveur 2 h (SMS) et veille (e-mail) ----------
CREATE OR REPLACE FUNCTION lx_prive.html_esc(p text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  SELECT replace(replace(replace(replace(replace(coalesce(p,''),'&','&amp;'),'<','&lt;'),'>','&gt;'),'"','&quot;'),'''','&#39;')
$function$;
REVOKE ALL ON FUNCTION lx_prive.html_esc(text) FROM PUBLIC, anon, authenticated;

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
DECLARE
  s record; r record;
  v_cfg jsonb; v_modele text; v_msg text; v_tel text; v_tail text;
  v_credits int; v_expediteur text; v_nb int;
  v_now timestamp; v_today date; v_now_min int; v_rdv_min int;
  v_envoyes int := 0; v_differes int := 0; v_ignores int := 0; v_echecs int := 0;
  v_essai jsonb := '[]'::jsonb;
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
    CONTINUE WHEN v_cfg IS NULL;
    CONTINUE WHEN coalesce((v_cfg->>'rappelActif')::boolean,false) IS NOT TRUE;
    CONTINUE WHEN coalesce((v_cfg->>'rappel2h')::boolean,false) IS NOT TRUE;

    v_modele := coalesce(nullif(v_cfg->>'rappelTexte2h',''),
                'Rappel : votre RDV est dans 2h a {heure} chez {salon}. A tout de suite !');
    v_expediteur := coalesce(nullif(v_cfg->>'smsSender',''), s.nom);
    v_credits := coalesce(s.sms_credits,0);

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
                                                   'message', v_msg, 'credits_suffisants', v_credits >= v_nb);
          CONTINUE;
        END IF;

        IF v_credits >= v_nb THEN
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
                            'ignores',v_ignores,'echecs',v_echecs);
END;
$function$;
REVOKE ALL ON FUNCTION public.envoyer_rappels_2h(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.envoyer_rappels_2h(boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.envoyer_rappels_email_24h(p_essai boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
-- 2026-10-14 audit : rappel par E-MAIL la veille, cote serveur (avant : seulement si l'application etait
-- ouverte). Memes regles que l'application : rappelActif + rappelEmail (tous forfaits, comme l'app),
-- RDV de demain non annule, client avec e-mail ET consentement email_ok = true.
-- Anti-doublon : pas d'envoi si un rappel e-mail 24h existe deja pour cette adresse depuis 25 h
-- (y compris envoye par une ancienne version de l'application) ; index unique dedup_key entre passages.
-- INACTIF tant que app_config.config->>'rappels_serveur_2h_email' n'est pas true.
-- p_essai = true : essai a blanc (AUCUNE ecriture, AUCUN envoi).
DECLARE
  s record; r record;
  v_cfg jsonb; v_demain date; v_em text; v_html text; v_sujet text; v_adr text;
  v_envoyes int := 0; v_ignores int := 0; v_echecs int := 0;
  v_essai jsonb := '[]'::jsonb;
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
    CONTINUE WHEN v_cfg IS NULL;
    CONTINUE WHEN coalesce((v_cfg->>'rappelActif')::boolean,false) IS NOT TRUE;
    CONTINUE WHEN coalesce((v_cfg->>'rappelEmail')::boolean,false) IS NOT TRUE;
    v_adr := trim(coalesce(s.adresse,'')||' '||coalesce(s.cp,'')||' '||coalesce(s.ville,''));

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
    LOOP
      BEGIN
        v_em := lower(r.email);
        IF EXISTS (SELECT 1 FROM messaging_log m
                    WHERE m.salon_id = s.id AND m.type = 'email' AND m.context = 'rappel_24h'
                      AND lower(m.recipient) = v_em AND m.created_at > now() - interval '25 hours')
        THEN v_ignores := v_ignores + 1; CONTINUE; END IF;

        v_sujet := 'Rappel : votre rendez-vous demain - ' || coalesce(s.nom,'');
        v_html := '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
          || '<body style="margin:0;padding:0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">'
          || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 16px">'
          || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto">'
          || '<tr><td style="padding:24px 0;text-align:center">'
          || CASE WHEN coalesce(s.logo,'') ~ '^https://' THEN '<img src="'||lx_prive.html_esc(s.logo)||'" alt="" style="height:60px;border-radius:12px;margin-bottom:12px"><br>' ELSE '' END
          || '<div style="font-size:24px;font-weight:800;color:#c8a84e;letter-spacing:2px;font-family:Georgia,serif">'||lx_prive.html_esc(upper(coalesce(s.nom,'')))||'</div></td></tr>'
          || '<tr><td style="padding:8px 24px 20px;text-align:center;font-size:15px;color:rgba(255,255,255,.75);line-height:1.6">'
          || 'Bonjour'||CASE WHEN coalesce(r.prenom,'')<>'' THEN ' <strong style="color:#fff">'||lx_prive.html_esc(r.prenom)||'</strong>' ELSE '' END
          || ',<br>N&#8217;oubliez pas votre rendez-vous demain.</td></tr>'
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
          v_essai := v_essai || jsonb_build_object('salon', s.nom, 'email', v_em, 'heure', r.heure, 'sujet', v_sujet);
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
REVOKE ALL ON FUNCTION public.envoyer_rappels_email_24h(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.envoyer_rappels_email_24h(boolean) TO service_role;

-- Tâches planifiées (sans effet tant que le drapeau n'est pas activé : les fonctions sortent aussitôt)
DO $$
BEGIN
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('rappels-2h-serveur','rappels-email-24h-serveur');
END $$;
SELECT cron.schedule('rappels-2h-serveur',        '*/10 * * * *', 'SELECT public.envoyer_rappels_2h()');
SELECT cron.schedule('rappels-email-24h-serveur', '5 8 * * *',    'SELECT public.envoyer_rappels_email_24h()');

-- ---------- 4) support_bot_kb ----------
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif) VALUES
  ('reglages_site_1014', 'Réglages : acompte, remboursement partiel, délais, horaires, fermeture, adresse, documents, export', 26, 'Paramètres → « Site en ligne » → carte « 💳 Acompte à la réservation » :
- Mode « Aucun » / « Acompte » / « Empreinte » : un seul choix fait foi (la case « Acompte obligatoire » n''existe plus). Sans Stripe capable d''encaisser (non configuré, incomplet, vérification en cours), le mode Acompte ou Empreinte reste enregistré mais il est SUSPENDU : le site prend les réservations sans paiement, un bandeau orange l''indique, tout reprend dès que Stripe est actif.
- Montant de l''acompte : jamais plus que le prix de la prestation réservée (le site plafonne) ; un avertissement s''affiche si le montant fixe ou le « Montant minimum » dépasse le prix d''une prestation réservable. Pourcentage limité à 100 %.
- « Politique d''annulation » + « Remboursement auto » + « Part de l''acompte rendue en cas d''annulation tardive (%) » : quand le client annule après le délai (ou si Remboursement auto est décoché, ou si l''annulation en ligne est « Jamais »), ce pourcentage de l''acompte lui est remboursé automatiquement sur sa carte ; 0 = tout est conservé. Ne s''applique pas à l''absence (« Le client ne s''est pas présenté », choix au cas par cas dans le planning) ni à l''annulation par l''établissement (toujours remboursée). Le pourcentage est affiché au client sur le récapitulatif de réservation.
Carte « 📅 Réservation » : « Délai min (heures) » : 0 = réservable jusqu''au dernier moment (respecté par le site, la recherche et le serveur) ; « Résa max (jours) » : 1 à 365, appliqué au calendrier du site, aux « prochains créneaux » de la recherche Luxyra et au contrôle du serveur.
Photos du site (photo principale, galerie) : réduites automatiquement (1600 px, JPEG) à l''enregistrement.
Paramètres → « Horaires » : la fermeture doit être après l''ouverture, sinon l''horaire n''est pas enregistré (message) ; même règle pour les horaires d''un collaborateur et ses jours personnalisés. « Fermeture exceptionnelle » sur des jours qui ont déjà des RDV : la liste des RDV s''affiche, il faut confirmer « Fermer quand même » ; les RDV ne sont ni annulés ni déplacés ; ensuite une fenêtre « Prévenir les clients ? » propose pour chacun un SMS ou un e-mail PRÉ-REMPLI ouvert sur le téléphone du pro (c''est lui qui l''envoie) ou un appel. Luxyra n''envoie RIEN automatiquement.
Paramètres → « Infos établissement » : changer l''adresse puis « Enregistrer les infos salon » recalcule la position sur la carte (recherche, annuaire). Adresse introuvable : message invitant à placer le repère dans Site en ligne → « Votre emplacement sur la carte ». Les guillemets et apostrophes sont acceptés dans tous les champs.
Paramètres → « Établissement » (domicile) : un forfait de déplacement à 0 € ou un prix à 0 €/km est respecté (avant il redevenait 15 € / 0,50 €).
Paramètres → « Mes documents » : « Remplacer » ouvre le choix du nouveau fichier ; le nouveau document remplace l''ancien en base et repart en vérification. Documents validés : verrouillés, passer par le support.
Paramètres → « NF525 » → « Exporter données » (et « Toutes mes données » en mode archives) : fichier complet (établissement, clients, prestations, forfaits, produits, stock, fournisseurs, équipe, bons cadeaux, packs, cartes d''abonnement, configuration du site, tickets, clôtures, journal). Jamais les codes PIN.
« Se déconnecter » : coupe aussi les notifications push de l''établissement sur CET appareil ; les réactiver après reconnexion (Paramètres → Notifications push).
Changer de forfait / S''abonner : un double appui n''ouvre plus deux paiements ; patienter pendant « Chargement... ».', true),
  ('rappels_automatiques', 'Rappels automatiques (SMS veille, SMS 2 h, e-mail)', 14, 'Rappels automatiques (Paramètres → SMS et Marketing) :
- Rappel SMS de la veille (« Rappel 24h avant ») : envoyé par le serveur chaque jour vers 10 h (heure d''été), même application fermée. Variables : {prenom}, {nom}, {heure}, {date}, {prestation}, {salon}, {collab} (nom du collaborateur du RDV, désormais rempli).
- Rappel SMS « 2h avant » et rappel par e-mail de la veille : envoyés par l''application quand elle est ouverte sur un appareil du salon (entre 8 h et 21 h). Le passage côté serveur est prêt mais pas encore activé.
- Un seul rappel de chaque type par client et par jour (anti-doublon), même avec plusieurs appareils ouverts. Une confirmation envoyée le jour même remplace le rappel de la veille.', true)
ON CONFLICT (cle) DO UPDATE SET titre = EXCLUDED.titre, ordre = EXCLUDED.ordre, contenu = EXCLUDED.contenu, actif = EXCLUDED.actif, maj_le = now();

COMMIT;

-- =====================================================================================
-- ESSAI À BLANC (aucune écriture, aucun envoi) — à lancer après application :
--   SELECT public.envoyer_rappels_2h(true);
--   SELECT public.envoyer_rappels_email_24h(true);
-- Vérifier : {collab} dans un modèle 24h -> SELECT envoyer_rappels_24h() uniquement avec crédits à 0 sur un salon
-- de test (mise en file sms_differes, aucun SMS réel), comme le 07/09.
--
-- ACTIVATION (une fois l'app 2026-10-14 déployée sur les appareils) — l'app cesse alors d'envoyer elle-même
-- les rappels 2 h et e-mail (même drapeau, lu via LX_CONFIG) :
--   UPDATE public.app_config SET config = config || '{"rappels_serveur_2h_email": true}'::jsonb WHERE id = 1;
--   UPDATE public.support_bot_kb SET contenu = replace(contenu,
--     'Rappel SMS « 2h avant » et rappel par e-mail de la veille : envoyés par l''application quand elle est ouverte sur un appareil du salon (entre 8 h et 21 h). Le passage côté serveur est prêt mais pas encore activé.',
--     'Rappel SMS « 2h avant » (toutes les 10 min, entre 8 h et 21 h) et rappel par e-mail de la veille (vers 10 h) : envoyés par le serveur, même application fermée.'), maj_le = now()
--   WHERE cle = 'rappels_automatiques';
--   + aide/sms-et-rappels.html : remplacer « pour l'instant, envoyés par l'application ouverte… » par « envoyés par nos serveurs ».
-- RETOUR ARRIÈRE : UPDATE public.app_config SET config = config - 'rappels_serveur_2h_email' WHERE id = 1;
-- =====================================================================================
