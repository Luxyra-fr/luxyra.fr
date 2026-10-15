-- 2026-10-15 : rappels serveur (e-mail veille + SMS 2 h) etendus aux reservations EN LIGNE (rdv_online).
-- Depuis que l'application n'envoie plus les rappels (app_config.config.rappels_serveur_2h_email = true),
-- envoyer_rappels_email_24h et envoyer_rappels_2h ne lisaient que appointments : une reservation en ligne
-- (que l'application ne recopie PAS dans appointments, sauf une fois encaissee) ne recevait aucun rappel.
-- Ajout d'une branche UNION ALL rdv_online reprenant les regles de envoyer_rappels_24h (SMS veille) :
--   status IN ('confirmed','pending') (exclut cancelled / done / no_show / pending_payment), client_tel / client_email.
-- Anti-doublon : (1) une rdv_online deja presente dans appointments (meme id) n'est pas reprise ;
-- (2) meme destinataire deja traite dans ce passage -> ignore (vaut aussi pour l'essai a blanc) ;
-- (3) cles dedup_key / controles messaging_log inchanges.
-- Opposition : si une fiche client du salon avec ce numero / cet e-mail a sms_ok / email_ok = false -> pas de rappel.
-- Signatures, SECURITY DEFINER, search_path, droits : inchanges.

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
-- 2026-10-15 : + reservations en ligne (rdv_online confirmed/pending, memes regles que envoyer_rappels_24h).
DECLARE
  s record; r record;
  v_cfg jsonb; v_demain date; v_em text; v_html text; v_sujet text; v_adr text;
  v_envoyes int := 0; v_ignores int := 0; v_echecs int := 0;
  v_essai jsonb := '[]'::jsonb;
  v_vus text[] := '{}';
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
DECLARE
  s record; r record;
  v_cfg jsonb; v_modele text; v_msg text; v_tel text; v_tail text;
  v_credits int; v_expediteur text; v_nb int;
  v_now timestamp; v_today date; v_now_min int; v_rdv_min int;
  v_envoyes int := 0; v_differes int := 0; v_ignores int := 0; v_echecs int := 0;
  v_essai jsonb := '[]'::jsonb;
  v_vus text[] := '{}';
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

REVOKE ALL ON FUNCTION public.envoyer_rappels_email_24h(boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.envoyer_rappels_2h(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.envoyer_rappels_email_24h(boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.envoyer_rappels_2h(boolean) TO service_role;
