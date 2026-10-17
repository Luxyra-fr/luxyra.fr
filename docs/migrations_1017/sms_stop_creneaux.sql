-- =====================================================================================================
-- 2026-10-17 — SMS publicitaires : mention officielle Brevo « STOP au 36xxx », opposition STOP,
--              créneaux légaux (lun-sam, 8 h - 21 h 30 heure de Paris, jamais dimanche ni jour férié)
-- APPLIQUÉ le 17/10/2026 (base kxdgjtvrkwugbifgppai), interrupteur sms_stop_brevo laissé à false.
-- =====================================================================================================
-- Ce que dit Brevo (sources : developers.brevo.com/docs/transactional-sms-endpoints,
-- help.brevo.com articles 11884482521234, 115001945670, 208723209, 209452025) :
--   * via /v3/transactionalSMS/send, mettre « STOP au [STOP_CODE] » à la fin du contenu : Brevo remplace
--     [STOP_CODE] par son numéro court à l'envoi, et un contenu avec code STOP passe AUTOMATIQUEMENT en
--     type « marketing » (on envoie aussi type:"marketing").
--   * un client qui répond STOP est désinscrit et mis en blocklist SMS du COMPTE Brevo (un seul compte Luxyra
--     pour tous les salons -> l'opposition vaut pour tous les établissements Luxyra).
--   * Brevo bloque les SMS marketing vers la France hors 8 h - 21 h 30 et les renvoie « au prochain créneau
--     autorisé » (tous les jours chez Brevo). D'où notre fin de créneau à 21 h 30 (et non 22 h) : un SMS parti
--     à 21 h 45 serait retenu par Brevo puis distribué le lendemain à 8 h, éventuellement un dimanche.
--
-- Répartition des rôles :
--   SQL (ce fichier) : créneau + jours fériés, file des campagnes / anniversaires / relances, table des STOP.
--   Worker (docs/luxyra-router-worker.js) : ajoute « \nSTOP au [STOP_CODE] » + type marketing aux SMS dont le
--     contexte est marketing / anniversaire / relance, refuse hors créneau (409 hors_creneau) et les numéros
--     ayant répondu STOP (409 stop), reçoit les événements Brevo (STOP / START) et rattrape chaque jour les
--     désinscriptions via l'API d'événements SMS de Brevo.
--
-- Interrupteur app_config.config.sms_stop_brevo (absent = false) :
--   false : la file envoie comme avant (lien « STOP SMS : luxyra.fr/stop/<code> » si desinscription_courte).
--   true  : la file n'ajoute plus le lien ; elle transmet le contexte au worker, qui ajoute « STOP au 36xxx ».
--   => à passer à true UNIQUEMENT après publication du worker (sinon SMS publicitaires sans aucune mention STOP).
--
-- Les créneaux et le filtre STOP s'appliquent dès maintenant (indépendants de l'interrupteur).
-- Les SMS transactionnels (rappels 24 h / 2 h, confirmations, modifications, annulations) ne sont pas touchés.
-- =====================================================================================================
set lock_timeout = '8s';

-- -----------------------------------------------------------------------------------------------------
-- 1. Jours fériés français et créneau des SMS publicitaires
-- -----------------------------------------------------------------------------------------------------
-- Dimanche de Pâques (algorithme grégorien anonyme, Meeus/Jones/Butcher)
create or replace function lx_prive.paques(p_annee int)
returns date language plpgsql immutable set search_path to 'pg_catalog' as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int; mois int; jour int;
begin
  a := p_annee % 19; b := p_annee / 100; c := p_annee % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3; h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4; l := (32 + 2 * e + 2 * i - h - k) % 7; m := (a + 11 * h + 22 * l) / 451;
  mois := (h + l - 7 * m + 114) / 31; jour := ((h + l - 7 * m + 114) % 31) + 1;
  return make_date(p_annee, mois, jour);
end $$;

-- 11 jours fériés légaux (métropole) : 1er janv, lundi de Pâques, 1er mai, 8 mai, Ascension, lundi de Pentecôte,
-- 14 juillet, 15 août, 1er nov, 11 nov, 25 déc.
create or replace function lx_prive.est_jour_ferie_fr(p_jour date)
returns boolean language plpgsql immutable set search_path to 'pg_catalog' as $$
declare v_p date; v_md text;
begin
  if p_jour is null then return false; end if;
  v_md := to_char(p_jour, 'MM-DD');
  if v_md in ('01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25') then return true; end if;
  v_p := lx_prive.paques(extract(year from p_jour)::int);
  return p_jour in (v_p + 1, v_p + 39, v_p + 50);  -- lundi de Pâques, Ascension, lundi de Pentecôte
end $$;

-- Jour où un SMS publicitaire peut partir : lundi au samedi, hors jour férié
create or replace function lx_prive.jour_pub_ok(p_jour date)
returns boolean language sql immutable set search_path to 'pg_catalog' as $$
  select p_jour is not null and extract(isodow from p_jour) <> 7 and not lx_prive.est_jour_ferie_fr(p_jour)
$$;

-- Créneau publicitaire (heure de Paris) : jour autorisé, de 8 h 00 à 21 h 29
create or replace function lx_prive.sms_pub_creneau_ok(p_ts timestamptz default now())
returns boolean language sql stable set search_path to 'pg_catalog' as $$
  select lx_prive.jour_pub_ok((p_ts at time zone 'Europe/Paris')::date)
     and (p_ts at time zone 'Europe/Paris')::time >= time '08:00'
     and (p_ts at time zone 'Europe/Paris')::time <  time '21:30'
$$;

-- Prochain instant autorisé (p_ts lui-même s'il est dans le créneau, sinon le prochain jour autorisé à 8 h)
create or replace function lx_prive.sms_pub_prochain_creneau(p_ts timestamptz default now())
returns timestamptz language plpgsql stable set search_path to 'pg_catalog' as $$
declare v_t timestamp := p_ts at time zone 'Europe/Paris'; v_d date := (p_ts at time zone 'Europe/Paris')::date; v_i int := 0;
begin
  if lx_prive.sms_pub_creneau_ok(p_ts) then return p_ts; end if;
  if lx_prive.jour_pub_ok(v_d) and v_t::time < time '08:00' then
    return (v_d + time '08:00') at time zone 'Europe/Paris';
  end if;
  loop
    v_d := v_d + 1; v_i := v_i + 1;
    exit when lx_prive.jour_pub_ok(v_d) or v_i > 10;
  end loop;
  return (v_d + time '08:00') at time zone 'Europe/Paris';
end $$;

-- Interrupteur de la mention officielle Brevo (voir en-tête)
create or replace function lx_prive.sms_stop_brevo_actif()
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select coalesce((select (config->>'sms_stop_brevo')::boolean from public.app_config where id = 1), false)
$$;

-- Lecture du créneau par l'application (bandeau / message de campagne)
create or replace function public.lx_sms_pub_creneau()
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select jsonb_build_object('ok', lx_prive.sms_pub_creneau_ok(now()), 'prochain', lx_prive.sms_pub_prochain_creneau(now()),
                            'mention_brevo', lx_prive.sms_stop_brevo_actif())
$$;
revoke all on function public.lx_sms_pub_creneau() from public, anon;
grant execute on function public.lx_sms_pub_creneau() to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 2. Opposition « STOP » aux SMS publicitaires (par numéro, tous salons : la blocklist Brevo est celle du
--    compte Luxyra). clients.sms_ok n'est PAS modifié : il commande aussi les rappels de RDV (transactionnels).
-- -----------------------------------------------------------------------------------------------------
create table if not exists public.lx_sms_stop (
  telephone_norm text primary key,
  stop_le        timestamptz not null default now(),
  source         text,
  salon_id       uuid,          -- salon dont le SMS a reçu la réponse STOP (information)
  details        text,
  maj_le         timestamptz not null default now()
);
alter table public.lx_sms_stop enable row level security;
revoke all on public.lx_sms_stop from anon, authenticated;
comment on table public.lx_sms_stop is
  '2026-10-17 : numéros ayant répondu STOP à un SMS publicitaire Brevo (webhook / rattrapage quotidien du worker). '
  'Exclus de tous les SMS publicitaires (campagnes, anniversaires, relances) de tous les salons ; rappels de RDV non concernés.';

create or replace function lx_prive.sms_pub_bloque(p_tel text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select exists (select 1 from public.lx_sms_stop s where s.telephone_norm = public.normalize_phone(p_tel))
$$;
revoke all on function lx_prive.sms_pub_bloque(text) from public, anon, authenticated;

-- Appelée par le worker (clé service) : p_action 'stop' (STOP, désinscription) ou 'start' (START, réinscription)
create or replace function public.lx_sms_stop_enregistrer(p_tel text, p_action text, p_source text default null,
                                                          p_salon uuid default null, p_details text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare v_tel text := public.normalize_phone(p_tel); v_n int := 0; v_nouveau boolean := false; s record;
begin
  if v_tel is null then return jsonb_build_object('ok', false, 'erreur', 'Numéro invalide'); end if;
  if p_action = 'stop' then
    insert into public.lx_sms_stop (telephone_norm, source, salon_id, details)
    values (v_tel, left(p_source, 60), p_salon, left(p_details, 300))
    on conflict (telephone_norm) do nothing;
    get diagnostics v_n = row_count; v_nouveau := v_n > 0;
    if not v_nouveau then
      update public.lx_sms_stop set maj_le = now() where telephone_norm = v_tel;
    end if;
  elsif p_action = 'start' then
    delete from public.lx_sms_stop where telephone_norm = v_tel;
    get diagnostics v_n = row_count; v_nouveau := v_n > 0;
  else
    return jsonb_build_object('ok', false, 'erreur', 'Action inconnue');
  end if;
  -- trace dans le journal de chaque salon ayant une fiche avec ce numéro (une fois par changement réel)
  if v_nouveau then
    for s in select distinct c.salon_id from public.clients c
              where c.telephone_norm = v_tel and c.fusionne_dans is null and c.rgpd_anonymise_le is null loop
      begin
        insert into public.audit_log (salon_id, action, details, operator_name)
        values (s.salon_id, case when p_action = 'stop' then 'RGPD_SMS_STOP' else 'RGPD_SMS_START' end,
                case when p_action = 'stop'
                     then 'Le numéro ...' || right(v_tel, 4) || ' a répondu STOP : plus aucun SMS publicitaire (campagnes, anniversaire, relance). Les rappels de rendez-vous continuent.'
                     else 'Le numéro ...' || right(v_tel, 4) || ' a répondu START : SMS publicitaires de nouveau possibles.' end,
                'Auto (réponse SMS Brevo)');
      exception when others then null; end;
    end loop;
  end if;
  return jsonb_build_object('ok', true, 'action', p_action, 'changement', v_nouveau);
end $$;
revoke all on function public.lx_sms_stop_enregistrer(text, text, text, uuid, text) from public, anon, authenticated;
grant execute on function public.lx_sms_stop_enregistrer(text, text, text, uuid, text) to service_role;

-- Le worker vérifie un numéro avant un SMS publicitaire (clé service)
create or replace function public.lx_sms_pub_bloque(p_tel text)
returns boolean language sql stable security definer set search_path to 'public', 'pg_temp' as $$
  select lx_prive.sms_pub_bloque(p_tel)
$$;
revoke all on function public.lx_sms_pub_bloque(text) from public, anon, authenticated;
grant execute on function public.lx_sms_pub_bloque(text) to service_role;

-- -----------------------------------------------------------------------------------------------------
-- 3. Modifications des fonctions existantes (remplacements exacts sur la définition en base, chaque motif
--    devant être trouvé UNE fois — sinon tout est annulé)
-- -----------------------------------------------------------------------------------------------------
create or replace function pg_temp.lx_remplacer(p_src text, p_avant text, p_apres text)
returns text language plpgsql as $$
declare n int := (length(p_src) - length(replace(p_src, p_avant, ''))) / greatest(length(p_avant), 1);
begin
  if n <> 1 then raise exception 'motif trouvé % fois : %', n, left(p_avant, 120); end if;
  return replace(p_src, p_avant, p_apres);
end $$;

do $migr$
declare d text;
begin
  -- ===== 3a. traiter_sms_differes : créneau publicitaire, filtre STOP, mention Brevo (interrupteur) =====
  d := pg_get_functiondef('public.traiter_sms_differes(uuid)'::regprocedure);
  d := pg_temp.lx_remplacer(d, E'  v_code       text;\nBEGIN',
E'  v_code       text;\n'
'  -- 2026-10-17 SMS STOP / créneaux : SMS publicitaires (marketing, anniversaire, relance) seulement du lundi au samedi,\n'
'  -- 8 h - 21 h 30 (Paris), hors jours fériés ; numéros ayant répondu STOP exclus ; mention Brevo si sms_stop_brevo\n'
'  v_pub_ok     boolean := lx_prive.sms_pub_creneau_ok(now());\n'
'  v_stop_brevo boolean := lx_prive.sms_stop_brevo_actif();\n'
'  v_pub        boolean;\n'
'BEGIN');
  d := pg_temp.lx_remplacer(d, E'      IF v_resp.status_code IN (402, 429) THEN',
E'      -- 2026-10-17 : refus du worker propres aux SMS publicitaires\n'
'      IF v_resp.status_code = 409 AND coalesce(v_json->>''code'', '''') = ''stop'' THEN\n'
'        UPDATE sms_differes SET statut = ''obsolete'', traite_le = clock_timestamp(), net_request_id = NULL, ml_id = NULL,\n'
'               motif = ''Le client a répondu STOP aux SMS publicitaires'' WHERE id = r.id;\n'
'      ELSIF v_resp.status_code = 409 AND coalesce(v_json->>''code'', '''') = ''hors_creneau'' THEN\n'
'        UPDATE sms_differes SET statut = ''en_attente'', net_request_id = NULL, ml_id = NULL,\n'
'               motif = ''Hors créneau des SMS publicitaires : reporté au prochain créneau autorisé'' WHERE id = r.id;\n'
'      ELSIF v_resp.status_code IN (402, 429) THEN');
  d := pg_temp.lx_remplacer(d, E'  IF v_h >= 8 AND v_h < 21 THEN\n    FOR r IN\n      SELECT * FROM sms_differes\n       WHERE salon_id = p_salon_id AND statut=''en_attente''\n',
E'  IF (v_h >= 8 AND v_h < 21) OR v_pub_ok THEN\n    FOR r IN\n      SELECT * FROM sms_differes\n       WHERE salon_id = p_salon_id AND statut=''en_attente''\n'
'         -- 2026-10-17 : publicitaires dans leur créneau (lun-sam 8 h - 21 h 30, hors fériés) ; les autres comme avant (8 h - 21 h)\n'
'         AND CASE WHEN coalesce(contexte, '''') IN (''marketing'', ''anniversaire'', ''relance'') THEN v_pub_ok\n'
'                  ELSE (v_h >= 8 AND v_h < 21) END\n');
  d := pg_temp.lx_remplacer(d, E'      -- 2026-10-17 audit réglages (#4) : SMS de prospection -> lien de désinscription « STOP SMS » (fiche du salon)\n      v_envoi := r.message;\n      IF lx_prive.desinscription_active() AND',
E'      -- 2026-10-17 : numéro ayant répondu STOP -> plus aucun SMS publicitaire\n'
'      v_pub := coalesce(r.contexte, '''') IN (''marketing'', ''anniversaire'', ''relance'');\n'
'      IF v_pub AND lx_prive.sms_pub_bloque(r.telephone) THEN\n'
'        UPDATE sms_differes SET statut=''obsolete'', traite_le=clock_timestamp(),\n'
'               motif=''Le client a répondu STOP aux SMS publicitaires'' WHERE id = r.id;\n'
'        v_ignores := v_ignores + 1; CONTINUE;\n'
'      END IF;\n\n'
'      -- 2026-10-17 audit réglages (#4) : SMS de prospection -> lien de désinscription « STOP SMS » (fiche du salon)\n'
'      -- (remplacé par la mention officielle Brevo « STOP au 36xxx », ajoutée par le worker, quand sms_stop_brevo = true)\n'
'      v_envoi := r.message;\n'
'      IF NOT v_stop_brevo AND lx_prive.desinscription_active() AND');
  d := pg_temp.lx_remplacer(d, E'      v_nb := lx_prive.sms_nb(v_envoi);',
E'      -- 2026-10-17 : la mention Brevo « \\nSTOP au 36xxx » (14 caractères) est comptée dans le coût\n'
'      v_nb := lx_prive.sms_nb(CASE WHEN v_pub AND v_stop_brevo THEN rtrim(v_envoi) || E''\\nSTOP au 36XXX'' ELSE v_envoi END);');
  d := pg_temp.lx_remplacer(d, E'                                   ''salonName'', v_expediteur, ''salon_id'', p_salon_id),',
E'                                   ''salonName'', v_expediteur, ''salon_id'', p_salon_id)\n'
'                || CASE WHEN v_pub AND v_stop_brevo THEN jsonb_build_object(''context'', r.contexte) ELSE ''{}''::jsonb END,');
  execute d;

  -- ===== 3b. lx_sms_campagne_enfiler : STOP exclus, validité comptée depuis le prochain créneau =====
  d := pg_get_functiondef('public.lx_sms_campagne_enfiler(uuid, jsonb, text)'::regprocedure);
  d := pg_temp.lx_remplacer(d, E'    -- double appui / double appareil',
E'    -- 2026-10-17 : numéro ayant répondu STOP aux SMS publicitaires\n'
'    IF lx_prive.sms_pub_bloque(v_tel) THEN v_ignores := v_ignores + 1; CONTINUE; END IF;\n'
'    -- double appui / double appareil');
  d := pg_temp.lx_remplacer(d, E'''marketing'', nullif(v_nom, ''''), v_cid, now() + interval ''3 days'');',
E'''marketing'', nullif(v_nom, ''''), v_cid,\n'
'            lx_prive.sms_pub_prochain_creneau(now()) + interval ''3 days'');  -- 2026-10-17 : attente du créneau non décomptée');
  d := pg_temp.lx_remplacer(d, E'RETURN jsonb_build_object(''ok'', true, ''enfiles'', v_enfiles, ''ignores'', v_ignores);',
E'RETURN jsonb_build_object(''ok'', true, ''enfiles'', v_enfiles, ''ignores'', v_ignores,\n'
'                            ''creneau_ok'', lx_prive.sms_pub_creneau_ok(now()), ''prochain_envoi'', lx_prive.sms_pub_prochain_creneau(now()));');
  execute d;

  -- ===== 3c. envoyer_sms_anniv_relance : SMS seulement les jours autorisés ; anniversaires des jours =====
  --            interdits (dimanche, férié) envoyés le jour autorisé suivant ; STOP exclus. E-mails inchangés.
  d := pg_get_functiondef('public.envoyer_sms_anniv_relance()'::regprocedure);
  d := pg_temp.lx_remplacer(d, E'  v_anniv_em int := 0; v_rel_em int := 0; v_echecs_em int := 0;\nBEGIN',
E'  v_anniv_em int := 0; v_rel_em int := 0; v_echecs_em int := 0;\n'
'  -- 2026-10-17 créneaux SMS publicitaires\n'
'  v_sms_jour_ok boolean; v_mds text[]; v_d date;\n'
'BEGIN');
  d := pg_temp.lx_remplacer(d, E'  v_fin_jour := ((v_jour + 1)::timestamp AT TIME ZONE ''Europe/Paris'');\n',
E'  v_fin_jour := ((v_jour + 1)::timestamp AT TIME ZONE ''Europe/Paris'');\n'
'  -- 2026-10-17 : SMS d''anniversaire / relance seulement du lundi au samedi hors jours fériés. Un jour autorisé\n'
'  -- traite aussi les anniversaires des jours interdits qui le précèdent (dimanche, férié) : envoi le lendemain.\n'
'  v_sms_jour_ok := lx_prive.jour_pub_ok(v_jour);\n'
'  v_d := v_jour - 1;\n'
'  WHILE NOT lx_prive.jour_pub_ok(v_d) AND v_d > v_jour - 10 LOOP v_d := v_d - 1; END LOOP;\n'
'  SELECT array_agg(to_char(g, ''MM-DD'')) INTO v_mds FROM generate_series((v_d + 1)::timestamp, v_jour::timestamp, interval ''1 day'') g;\n'
'  IF NOT v_bissex AND ''02-28'' = ANY (v_mds) THEN v_mds := v_mds || ''02-29''::text; END IF;\n');
  d := pg_temp.lx_remplacer(d, E'AND coalesce(sms_bloque, false) = false AND coalesce(sms_mode, ''brevo'') <> ''native''\n',
E'AND coalesce(sms_bloque, false) = false AND coalesce(sms_mode, ''brevo'') <> ''native''\n'
'              AND v_sms_jour_ok  -- 2026-10-17 : jamais le dimanche ni un jour férié\n');
  d := pg_temp.lx_remplacer(d, E'           AND (substr(date_naissance, 6, 5) = v_md\n                OR (NOT v_bissex AND v_md = ''02-28'' AND substr(date_naissance, 6, 5) = ''02-29''))\n      LOOP\n        INSERT INTO sms_auto_envois',
E'           AND substr(date_naissance, 6, 5) = ANY (v_mds)  -- 2026-10-17 : aujourd''hui + jours interdits précédents\n'
'           AND NOT lx_prive.sms_pub_bloque(telephone)\n'
'      LOOP\n        INSERT INTO sms_auto_envois');
  d := pg_temp.lx_remplacer(d, E'           AND cl.sms_ok IS TRUE AND coalesce(cl.telephone, '''') <> ''''\n',
E'           AND cl.sms_ok IS TRUE AND coalesce(cl.telephone, '''') <> ''''\n'
'           AND NOT lx_prive.sms_pub_bloque(cl.telephone)  -- 2026-10-17 : a répondu STOP\n');
  d := pg_temp.lx_remplacer(d, E'RETURN jsonb_build_object(''ok'', true, ''anniversaires'', v_anniv, ''relances'', v_rel,',
E'RETURN jsonb_build_object(''ok'', true, ''sms_jour_autorise'', v_sms_jour_ok, ''anniversaires'', v_anniv, ''relances'', v_rel,');
  execute d;
end $migr$;

-- -----------------------------------------------------------------------------------------------------
-- 4. ACTIVATION (NE PAS LANCER AVANT la publication du worker qui ajoute « STOP au [STOP_CODE] ») :
--   update app_config set config = config || '{"sms_stop_brevo":true}'::jsonb where id = 1;
-- Retour arrière immédiat (lien long luxyra.fr/stop/<code> de nouveau ajouté par la file) :
--   update app_config set config = config || '{"sms_stop_brevo":false}'::jsonb where id = 1;
-- -----------------------------------------------------------------------------------------------------

-- -----------------------------------------------------------------------------------------------------
-- 5. Bot de support (APPLIQUÉ le 17/10/2026) : upsert de desinscription_marketing_1017 (texte mis à jour :
--    « STOP au 36xxx » remplace le lien long dans les SMS) et nouvelle entrée sms_stop_creneaux_1017
--    (mention STOP, compteur, jours/heures, client qui répond STOP). Texte complet : voir support_bot_kb.
--   insert into support_bot_kb (cle, titre, ordre, contenu, actif, maj_le) values (...), (...)
--   on conflict (cle) do update set titre = excluded.titre, ordre = excluded.ordre, contenu = excluded.contenu,
--                                   actif = true, maj_le = now();
-- -----------------------------------------------------------------------------------------------------

-- -----------------------------------------------------------------------------------------------------
-- 6. Tests faits le 17/10/2026 (transactions annulées)
--   * jours fériés 2026 : 01/01, 06/04, 01/05, 08/05, 14/05, 25/05, 14/07, 15/08, 01/11, 11/11, 25/12 ;
--     2027 : 01/01, 29/03, 01/05, 06/05, 08/05, 17/05, 14/07, 15/08, 01/11, 11/11, 25/12 (Pâques 2024-2028 justes).
--   * créneau : sam 21:29 oui, 21:30 non, 07:59 non ; dim non ; lun 8:00 oui.
--     prochain créneau : sam 22:00 -> lun 8:00 ; sam 31/10/2026 21:45 -> lun 02/11 (1er nov = dim + férié) ;
--     ven 24/12/2027 21:45 -> lun 27/12 ; sam 23/05/2026 21:45 -> mar 26/05 (lundi de Pentecôte).
--   * traiter_sms_differes (salon e0cf27c7, 3 lignes fictives) : la nuit rien ne part ; créneau simulé ouvert +
--     sms_stop_brevo=true -> la campagne part avec 'context':'marketing' et SANS lien long, le numéro ayant
--     répondu STOP passe « obsolete / Le client a répondu STOP aux SMS publicitaires », le rappel 24 h reste
--     soumis à la règle habituelle (8 h - 21 h) ; lx_sms_stop_enregistrer idempotent (2e STOP : changement=false).
--   * envoyer_sms_anniv_relance() exécutée puis annulée : ok, sms_jour_autorise=true (samedi).
-- -----------------------------------------------------------------------------------------------------
