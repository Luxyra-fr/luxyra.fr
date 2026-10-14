-- =====================================================================================
-- Luxyra — audit du 14/10/2026 — PLANNING / RÉSERVATION EN LIGNE / RAPPELS
-- Fichier IDEMPOTENT (rejouable) : CREATE OR REPLACE, ADD COLUMN IF NOT EXISTS.
-- À APPLIQUER AVANT le déploiement de l'app (app.html utilise messaging_log.rdv_date ; elle
-- fonctionne aussi sans, mais le rappel de la veille retombe alors sur l'analyse du texte).
-- Chaque fonction est recréée depuis sa définition EXACTE du 14/10/2026 (pg_get_functiondef),
-- modifications minimales repérées par « 2026-10-14 audit ».
-- Ordre : dépendances d'abord (leçon du 07/09 : ne jamais remplacer une validation par une
-- version qui appelle une fonction pas encore créée).
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- 1) messaging_log.rdv_date : date du rendez-vous concerné par un SMS de confirmation
--    (le rappel de la veille n'est plus annulé par la confirmation d'un AUTRE rendez-vous)
-- -------------------------------------------------------------------------------------
ALTER TABLE public.messaging_log ADD COLUMN IF NOT EXISTS rdv_date date;
COMMENT ON COLUMN public.messaging_log.rdv_date IS
  '2026-10-14 audit : date du rendez-vous concerné (confirmation). Le rappel 24 h n''est supprimé que par la confirmation de CE rendez-vous.';

-- -------------------------------------------------------------------------------------
-- 2) Horaires EFFECTIFS d'un collaborateur (ou de l'établissement) à une date
--    Même règle que le site (site.html : _lxSiteEffHrs / isCollabBlocked / lxPlageDuJour) :
--    - fermeture exceptionnelle (établissement ou collaborateur), congé / absence journée -> fermé
--    - horaires personnalisés du jour (collaborateurs.horaires_overrides[date]) : null = absent,
--      {o,c,pause_o,pause_c} = horaires du jour
--    - sinon semaine type du collaborateur s'il en a une, sinon celle de l'établissement
--    - ouverture exceptionnelle : ÉLARGIT la plage (ou ouvre un jour fermé), jamais ne la réduit
--    - plages bloquées 'b' : pause du jour / pause habituelle, absences en heures, pauses déclarées
--    p_collab NULL (« Pas de préférence ») : plage la plus large des collaborateurs présents ;
--    établissement sans collaborateur : horaires de l'établissement.
--    Retour : {"o": minutes, "c": minutes, "b": [[debut,fin],...]} ou NULL si fermé / absent.
-- -------------------------------------------------------------------------------------
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
  elsif v_col.horaires is not null and jsonb_typeof(v_col.horaires) = 'object'
        and exists (select 1 from jsonb_each(v_col.horaires) k where jsonb_typeof(k.value) = 'object' and k.value->>'o' is not null) then
    v_h := v_col.horaires -> v_dow;            -- semaine type du collaborateur (jour absent = repos)
  else
    v_h := v_cfg_h -> v_dow;                   -- semaine type de l'établissement
  end if;
  if jsonb_typeof(v_h) = 'object' and not coalesce((v_h->>'ferme')::boolean, false) then
    v_o := lx_hm(v_h->>'o'); v_c := lx_hm(v_h->>'c');
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

COMMENT ON FUNCTION public.lx_horaires_effectifs(uuid, integer, date) IS
  '2026-10-14 audit : horaires effectifs (personnalisés par date, exceptions, pauses) — source unique pour rdv_online_validate, rdv_online_block_double_booking et fn_salon_next_slots.';
-- Appelée uniquement depuis des fonctions SECURITY DEFINER : pas d'accès direct depuis l'API
REVOKE ALL ON FUNCTION public.lx_horaires_effectifs(uuid, integer, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lx_horaires_effectifs(uuid, integer, date) FROM anon, authenticated;

-- -------------------------------------------------------------------------------------
-- 3) Une confirmation (messaging_log) concerne-t-elle le rendez-vous du jour p_jour ?
--    rdv_date renseignée -> comparaison exacte ; sinon la date figure dans le texte (formats du
--    serveur JJ/MM/AAAA, JJ/MM, et de l'application « 15 oct. 2026 ») ; un texte avec une AUTRE
--    date ne compte pas ; un texte sans aucune date (modèle personnalisé) garde l'ancienne règle.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lx_prive.confirmation_concerne_rdv(p_rdv_date date, p_content text, p_jour date)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_c text := coalesce(p_content,''); v_mois text[] := array['janv.','févr.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];
begin
  if p_rdv_date is not null then return p_rdv_date = p_jour; end if;
  if p_jour is null then return true; end if;
  if strpos(v_c, to_char(p_jour,'DD/MM')) > 0
     or strpos(v_c, extract(day from p_jour)::int::text || ' ' || v_mois[extract(month from p_jour)::int] || ' ' || extract(year from p_jour)::int::text) > 0 then
    return true;
  end if;
  if v_c ~ '\m\d{1,2}/\d{1,2}' or v_c ~* '\m\d{1,2}\s+(janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)' then
    return false;
  end if;
  return true;
end $function$;
REVOKE ALL ON FUNCTION lx_prive.confirmation_concerne_rdv(date, text, date) FROM PUBLIC;

-- -------------------------------------------------------------------------------------
-- 4) rdv_online_validate : horaires effectifs (horaires_overrides, exceptions, pauses) via
--    lx_horaires_effectifs ; « Pas de préférence » = plage des collaborateurs présents (avant :
--    horaires de l'établissement). Corps recopié à l'identique, seul le bloc horaires change.
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rdv_online_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text;
  v_salon_status  text;
  v_svc_salon     uuid;
  v_svc_actif     boolean;
  v_svc_book      boolean;
  v_svc_show      boolean;
  v_col_salon     uuid;
  v_col_actif     boolean;
  v_col_inactif   boolean;
  v_col_depart    date;
  v_col_horaires  jsonb := NULL;
  v_delai_min     integer;
  v_delai_max     integer;
  v_cfg_horaires  jsonb;
  v_absences      jsonb;
  v_rdv_ts        timestamp;
  v_now_plus_min  timestamp;
  v_max_date      date;
  v_dow_str       text;
  v_horaires      jsonb;
  v_open_minutes  integer;
  v_close_minutes integer;
  v_rdv_minutes   integer;
  v_abs           jsonb;
  v_abs_date      text;
  v_abs_type      text;
  v_abs_st        text;
  v_abs_from      text;
  v_abs_to        text;
  v_abs_h_from    integer;
  v_abs_h_to      integer;
  v_ouv_except    jsonb := NULL;
  v_item          jsonb;
  v_item_sid      integer;
  v_items_count   integer := 0;
  v_eff           jsonb;   -- 2026-10-14 audit : horaires effectifs
  v_pl            jsonb;   -- 2026-10-14 audit : plage bloquée (pause)
BEGIN
  v_role := coalesce((select auth.role()), 'anon');
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_salon_status FROM public.salons WHERE id = NEW.salon_id;
  IF v_salon_status IS NULL THEN
    RAISE EXCEPTION 'Salon inexistant';
  END IF;
  IF v_salon_status NOT IN ('active','trial') THEN
    RAISE EXCEPTION 'Ce salon n''accepte plus de réservations en ligne';
  END IF;
  -- 2026-10-08 : réservation en ligne = forfait Pro, ou essai gratuit en cours (non expiré).
  IF NOT EXISTS (SELECT 1 FROM public.salons s WHERE s.id = NEW.salon_id
                  AND public.lx_salon_pro_actif(s.plan, s.status, s.trial_end)) THEN
    RAISE EXCEPTION 'La réservation en ligne n''est pas active pour ce salon';
  END IF;

  IF NEW.items IS NOT NULL AND jsonb_typeof(NEW.items) = 'array'
     AND jsonb_array_length(NEW.items) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(NEW.items)
    LOOP
      v_items_count := v_items_count + 1;
      v_item_sid := NULLIF(v_item->>'service_id', '')::integer;
      IF v_item_sid IS NULL THEN
        RAISE EXCEPTION 'Item % sans service_id', v_items_count;
      END IF;
      SELECT salon_id, actif, book_online, show_site
      INTO v_svc_salon, v_svc_actif, v_svc_book, v_svc_show
      FROM public.services WHERE id = v_item_sid;
      IF v_svc_salon IS NULL THEN
        RAISE EXCEPTION 'Service inexistant (id %)', v_item_sid;
      END IF;
      IF v_svc_salon IS DISTINCT FROM NEW.salon_id THEN
        RAISE EXCEPTION 'Le service "%" n''appartient pas à ce salon', coalesce(v_item->>'nom', v_item_sid::text);
      END IF;
      IF coalesce(v_svc_actif, true) = false THEN
        RAISE EXCEPTION 'Le service "%" n''est plus proposé', coalesce(v_item->>'nom', v_item_sid::text);
      END IF;
      IF coalesce(v_svc_book, true) = false OR coalesce(v_svc_show, true) = false THEN
        RAISE EXCEPTION 'Le service "%" n''est pas réservable en ligne', coalesce(v_item->>'nom', v_item_sid::text);
      END IF;
    END LOOP;
  ELSIF NEW.service_id IS NOT NULL THEN
    SELECT salon_id, actif, book_online, show_site
    INTO v_svc_salon, v_svc_actif, v_svc_book, v_svc_show
    FROM public.services WHERE id = NEW.service_id;
    IF v_svc_salon IS NULL THEN
      RAISE EXCEPTION 'Service inexistant (id %)', NEW.service_id;
    END IF;
    IF v_svc_salon IS DISTINCT FROM NEW.salon_id THEN
      RAISE EXCEPTION 'Ce service n''appartient pas à ce salon';
    END IF;
    IF coalesce(v_svc_actif, true) = false THEN
      RAISE EXCEPTION 'Ce service n''est plus proposé';
    END IF;
    IF coalesce(v_svc_book, true) = false OR coalesce(v_svc_show, true) = false THEN
      RAISE EXCEPTION 'Ce service n''est pas réservable en ligne';
    END IF;
  END IF;

  IF NEW.collaborateur_id IS NOT NULL THEN
    SELECT salon_id, actif, coalesce(inactif,false), date_depart, to_jsonb(horaires)
    INTO v_col_salon, v_col_actif, v_col_inactif, v_col_depart, v_col_horaires
    FROM public.collaborateurs WHERE id = NEW.collaborateur_id;
    IF v_col_salon IS NULL THEN
      RAISE EXCEPTION 'Collaborateur inexistant (id %)', NEW.collaborateur_id;
    END IF;
    IF v_col_salon IS DISTINCT FROM NEW.salon_id THEN
      RAISE EXCEPTION 'Ce collaborateur n''appartient pas à ce salon';
    END IF;
    IF coalesce(v_col_actif, true) = false THEN
      RAISE EXCEPTION 'Ce collaborateur n''est plus disponible';
    END IF;
    -- AJOUT 2026-09-07 : un collaborateur ARCHIVE (inactif, ou parti a cette date)
    -- ne doit plus recevoir de rendez-vous. Ce controle manquait : le site ne le
    -- proposait pas, mais la base l'acceptait.
    IF v_col_inactif = true THEN
      RAISE EXCEPTION 'Ce collaborateur ne fait plus partie de l''équipe';
    END IF;
    IF v_col_depart IS NOT NULL AND v_col_depart <= NEW.date_rdv THEN
      RAISE EXCEPTION 'Ce collaborateur a quitté l''équipe le %', to_char(v_col_depart,'DD/MM/YYYY');
    END IF;
  END IF;

  SELECT delai_min_heures, delai_max_jours, to_jsonb(horaires_salon), to_jsonb(absences)
  INTO v_delai_min, v_delai_max, v_cfg_horaires, v_absences
  FROM public.site_config WHERE salon_id = NEW.salon_id LIMIT 1;

  v_delai_min := coalesce(v_delai_min, 2);
  v_delai_max := coalesce(v_delai_max, 30);

  v_rdv_ts       := (NEW.date_rdv::text || ' ' || NEW.heure_rdv::text)::timestamp;
  v_now_plus_min := ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris') + (v_delai_min || ' hours')::interval);
  v_max_date     := ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date + (v_delai_max || ' days')::interval)::date;

  IF v_rdv_ts < v_now_plus_min THEN
    RAISE EXCEPTION 'Réservation trop proche : délai minimum de % h requis', v_delai_min;
  END IF;
  IF NEW.date_rdv > v_max_date THEN
    RAISE EXCEPTION 'Réservation trop lointaine : maximum % jours à l''avance', v_delai_max;
  END IF;

  IF v_absences IS NOT NULL AND jsonb_typeof(v_absences) = 'array' THEN
    FOR v_abs IN SELECT jsonb_array_elements(v_absences)
    LOOP
      v_abs_type := v_abs->>'type';
      v_abs_date := v_abs->>'date';
      v_abs_st   := v_abs->>'stId';

      IF v_abs_type = 'fermeture_except' AND v_abs_date = NEW.date_rdv::text THEN
        IF v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = '' THEN
          RAISE EXCEPTION 'Salon fermé ce jour-là (%)', coalesce(v_abs->>'motif','fermeture exceptionnelle');
        ELSIF NEW.collaborateur_id IS NOT NULL AND v_abs_st::int = NEW.collaborateur_id THEN
          RAISE EXCEPTION 'Collaborateur indisponible ce jour-là (%)', coalesce(v_abs->>'motif','fermeture exceptionnelle');
        END IF;
      END IF;

      IF v_abs_type = 'ouverture_except' AND v_abs_date = NEW.date_rdv::text THEN
        IF v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = ''
           OR NEW.collaborateur_id IS NULL
           OR v_abs_st::int = NEW.collaborateur_id THEN
          v_ouv_except := v_abs;
        END IF;
      END IF;
    END LOOP;
  END IF;

  v_dow_str := extract(dow FROM NEW.date_rdv)::text;

  -- 2026-10-14 audit : horaires EFFECTIFS (horaires personnalisés du jour, semaine type du collaborateur,
  -- ouverture exceptionnelle qui élargit, pauses) — même règle que le site et la recherche.
  -- Avant : horaires_overrides ignorés, et « Pas de préférence » validé sur les horaires de l'établissement.
  v_eff := public.lx_horaires_effectifs(NEW.salon_id, NEW.collaborateur_id, NEW.date_rdv);
  IF v_eff IS NULL THEN
    RAISE EXCEPTION 'Jour fermé';
  END IF;

  v_open_minutes  := (v_eff->>'o')::int;
  v_close_minutes := (v_eff->>'c')::int;
  v_rdv_minutes   := extract(hour FROM NEW.heure_rdv)::int * 60 + extract(minute FROM NEW.heure_rdv)::int;

  IF v_rdv_minutes < v_open_minutes THEN
    RAISE EXCEPTION 'Horaire trop tôt (ouverture à %)', lpad((v_open_minutes/60)::text,2,'0') || ':' || lpad((v_open_minutes%60)::text,2,'0');
  END IF;
  IF v_rdv_minutes + coalesce(NEW.duree_minutes, 30) > v_close_minutes THEN
    RAISE EXCEPTION 'Horaire trop tard (fermeture à %)', lpad((v_close_minutes/60)::text,2,'0') || ':' || lpad((v_close_minutes%60)::text,2,'0');
  END IF;
  -- 2026-10-14 audit : pause du collaborateur (habituelle ou du jour) — n'était pas contrôlée
  FOR v_pl IN SELECT jsonb_array_elements(coalesce(v_eff->'b','[]'::jsonb))
  LOOP
    IF v_rdv_minutes < (v_pl->>1)::int AND (v_rdv_minutes + coalesce(NEW.duree_minutes, 30)) > (v_pl->>0)::int THEN
      RAISE EXCEPTION 'Collaborateur indisponible sur ce créneau (pause %:% - %:%)',
        lpad(((v_pl->>0)::int/60)::text,2,'0'), lpad(((v_pl->>0)::int%60)::text,2,'0'),
        lpad(((v_pl->>1)::int/60)::text,2,'0'), lpad(((v_pl->>1)::int%60)::text,2,'0');
    END IF;
  END LOOP;

  IF v_absences IS NOT NULL AND jsonb_typeof(v_absences) = 'array' THEN
    FOR v_abs IN SELECT jsonb_array_elements(v_absences)
    LOOP
      v_abs_type := v_abs->>'type';
      v_abs_date := v_abs->>'date';
      v_abs_st   := v_abs->>'stId';
      v_abs_from := coalesce(v_abs->>'from', v_abs->>'dateFrom');
      v_abs_to   := coalesce(v_abs->>'to',   v_abs->>'dateTo');

      IF v_abs_type IN ('conge','absent_jour','absent','maladie','formation')
         AND v_abs_date = NEW.date_rdv::text
         AND v_abs_st IS NOT NULL AND v_abs_st <> 'null' AND v_abs_st <> ''
         AND NEW.collaborateur_id IS NOT NULL
         AND v_abs_st::int = NEW.collaborateur_id
      THEN
        RAISE EXCEPTION 'Collaborateur absent ce jour-là (%)', coalesce(v_abs->>'motif','absence');
      END IF;

      IF v_abs_type IN ('conge','absent_jour','absent','maladie','formation')
         AND v_abs_from IS NOT NULL AND v_abs_to IS NOT NULL
         AND NEW.date_rdv::text >= v_abs_from
         AND NEW.date_rdv::text <= v_abs_to
         AND (v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = ''
              OR (NEW.collaborateur_id IS NOT NULL AND v_abs_st::int = NEW.collaborateur_id))
      THEN
        RAISE EXCEPTION 'Période d''absence (% → %, %)',
          v_abs_from, v_abs_to, coalesce(v_abs->>'motif','congé');
      END IF;

      IF v_abs_type IN ('absent_heures','pause')
         AND v_abs_date = NEW.date_rdv::text
         AND (v_abs->>'from') ~ '^[0-9]{1,2}:[0-9]{2}$'
         AND (v_abs->>'to')   ~ '^[0-9]{1,2}:[0-9]{2}$'
         AND ( (v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = '')
               OR (NEW.collaborateur_id IS NOT NULL AND v_abs_st::int = NEW.collaborateur_id) )
      THEN
        v_abs_h_from := (split_part(v_abs->>'from', ':', 1)::int * 60) + split_part(v_abs->>'from', ':', 2)::int;
        v_abs_h_to   := (split_part(v_abs->>'to',   ':', 1)::int * 60) + split_part(v_abs->>'to',   ':', 2)::int;
        IF v_rdv_minutes < v_abs_h_to
           AND (v_rdv_minutes + coalesce(NEW.duree_minutes, 30)) > v_abs_h_from
        THEN
          RAISE EXCEPTION 'Collaborateur indisponible sur ce créneau (% - %, %)',
            v_abs->>'from', v_abs->>'to', coalesce(v_abs->>'motif','absence');
        END IF;
      END IF;
    END LOOP;
  END IF;

  IF coalesce(NEW.acompte_paye, false) = TRUE
     AND NEW.stripe_payment_id IS NULL
     AND NEW.stripe_token IS NULL THEN
    RAISE EXCEPTION 'Impossible de marquer un acompte payé sans preuve de paiement';
  END IF;

  RETURN NEW;
END;
$function$;

-- -------------------------------------------------------------------------------------
-- 5) rdv_online_block_double_booking
--    - horaires effectifs (horaires_overrides, exceptions, pauses) via lx_horaires_effectifs
--    - une réservation « Pas de préférence » (collaborateur_id NULL) OCCUPE UN collaborateur :
--      nouvelle réservation sans préférence acceptée seulement s'il reste plus de collaborateurs
--      libres que de réservations sans préférence qui chevauchent ; réservation sur un
--      collaborateur précis refusée si elle prend le dernier collaborateur qu'il leur fallait
--    - établissement sans collaborateur : capacité 1 (avant : aucun contrôle)
--    - erreur inattendue -> REFUS (avant : laissait passer)
-- -------------------------------------------------------------------------------------
-- 2026-10-14 intégration : conversion sûre texte -> entier (NULL si illisible), pour les contrôles de
-- disponibilité (phases « d », horaires effectifs) : une donnée mal formée ne fait plus échouer la réservation.
CREATE OR REPLACE FUNCTION public.lx_int_sur(t text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'pg_catalog'
AS $function$
  select case when t ~ '^\s*-?[0-9]{1,9}\s*$' then trim(t)::integer
              when t ~ '^\s*-?[0-9]{1,9}\.[0-9]*\s*$' then round(trim(t)::numeric)::integer
              else null end
$function$;

CREATE OR REPLACE FUNCTION public.rdv_online_block_double_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ns int; v_ne int; v_dur int;
  v_collab_count int := 0; v_free int := 0; v_free_autres int := 0; v_sans_pref int := 0;
  v_col record; v_eh jsonb; v_busy boolean;
begin
  if coalesce((select auth.role()),'anon') = 'service_role' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('lx_rdv:' || new.salon_id::text || ':' || new.date_rdv::text));
  v_dur := coalesce(new.duree_minutes, 30);
  v_ns  := extract(hour from new.heure_rdv)::int*60 + extract(minute from new.heure_rdv)::int;
  v_ne  := v_ns + v_dur;

  -- ===== COLLAB SPÉCIFIQUE : refuser si chevauchement (en ligne OU interne) =====
  if new.collaborateur_id is not null then
    if exists (
      select 1 from rdv_online r
      where r.salon_id=new.salon_id and r.collaborateur_id=new.collaborateur_id and r.date_rdv=new.date_rdv
        and coalesce(r.status,'') not in ('cancelled','cancelled_by_client','refused') and not (coalesce(r.status,'')='pending_payment' and r.created_at < now() - interval '35 minutes')
        and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int) < v_ne
        and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int + coalesce(r.duree_minutes,30)) > v_ns
    ) then raise exception 'Ce créneau vient d''être réservé, merci d''en choisir un autre' using errcode='23P01'; end if;
    if exists (
      select 1 from appointments a
      where a.salon_id=new.salon_id and a.collab_id=new.collaborateur_id and a.date_rdv::text=new.date_rdv::text
        and coalesce(a.cancelled,false)=false and coalesce(a.status,'') not in ('canc','cancelled','annule')
        and a.heure ~ '^[0-9]{1,2}:[0-9]{2}' and not public.lx_appt_sans_duree(a.from_caisse, a.a_phases, a.service_id, a.items)
        and coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000) < v_ne
        and (coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000)
             + greatest((select coalesce(sum(coalesce(public.lx_int_sur(p->>'d'),0)),0) from jsonb_array_elements(coalesce(a.a_phases,'[]'::jsonb)) p),30)) > v_ns
    ) then raise exception 'Ce créneau vient d''être réservé, merci d''en choisir un autre' using errcode='23P01'; end if;
  end if;

  -- 2026-10-14 audit : réservations SANS préférence qui chevauchent (chacune occupe un collaborateur)
  select count(*) into v_sans_pref from rdv_online r
   where r.salon_id=new.salon_id and r.collaborateur_id is null and r.date_rdv=new.date_rdv
     and coalesce(r.status,'') not in ('cancelled','cancelled_by_client','refused','done','no_show')
     and not (coalesce(r.status,'')='pending_payment' and r.created_at < now() - interval '35 minutes')
     and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int) < v_ne
     and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int + coalesce(r.duree_minutes,30)) > v_ns;

  -- Collaborateurs présents ET libres sur le créneau (horaires effectifs, pauses, RDV attribués)
  for v_col in
    select id from collaborateurs
    where salon_id=new.salon_id and coalesce(actif,true)=true and coalesce(inactif,false)=false and (date_depart is null or date_depart > new.date_rdv)
  loop
    v_collab_count := v_collab_count + 1;
    v_eh := public.lx_horaires_effectifs(new.salon_id, v_col.id, new.date_rdv);
    if v_eh is null then continue; end if;
    -- horaires illisibles -> collaborateur considéré indisponible (prudence)
    if public.lx_int_sur(v_eh->>'o') is null or public.lx_int_sur(v_eh->>'c') is null then continue; end if;
    if v_ns < public.lx_int_sur(v_eh->>'o') or v_ne > public.lx_int_sur(v_eh->>'c') then continue; end if;
    if exists (select 1 from jsonb_array_elements(coalesce(v_eh->'b','[]'::jsonb)) b where coalesce(v_ns < public.lx_int_sur(b->>1) and v_ne > public.lx_int_sur(b->>0), true)) then continue; end if;
    v_busy := exists(
        select 1 from rdv_online r
        where r.salon_id=new.salon_id and r.collaborateur_id=v_col.id and r.date_rdv=new.date_rdv
          and coalesce(r.status,'') not in ('cancelled','cancelled_by_client','refused') and not (coalesce(r.status,'')='pending_payment' and r.created_at < now() - interval '35 minutes')
          and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int) < v_ne
          and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int + coalesce(r.duree_minutes,30)) > v_ns
      ) or exists(
        select 1 from appointments a
        where a.salon_id=new.salon_id and a.collab_id=v_col.id and a.date_rdv::text=new.date_rdv::text
          and coalesce(a.cancelled,false)=false and coalesce(a.status,'') not in ('canc','cancelled','annule')
          and a.heure ~ '^[0-9]{1,2}:[0-9]{2}' and not public.lx_appt_sans_duree(a.from_caisse, a.a_phases, a.service_id, a.items)
          and coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000) < v_ne
          and (coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000)
               + greatest((select coalesce(sum(coalesce(public.lx_int_sur(p->>'d'),0)),0) from jsonb_array_elements(coalesce(a.a_phases,'[]'::jsonb)) p),30)) > v_ns
      );
    if not v_busy then
      v_free := v_free + 1;
      if new.collaborateur_id is null or v_col.id <> new.collaborateur_id then v_free_autres := v_free_autres + 1; end if;
    end if;
  end loop;

  if new.collaborateur_id is not null then
    -- le collaborateur choisi est libre (contrôlé ci-dessus) ; il doit en rester assez pour les « sans préférence »
    if v_collab_count > 0 and v_sans_pref > v_free_autres then
      raise exception 'Ce créneau vient d''être réservé, merci d''en choisir un autre' using errcode='23P01';
    end if;
    return new;
  end if;

  -- ===== SANS PRÉFÉRENCE (collaborateur_id NULL) =====
  if v_collab_count = 0 then
    -- établissement sans collaborateur : une seule personne -> tout chevauchement bloque
    if v_sans_pref > 0
       or exists (select 1 from rdv_online r
                   where r.salon_id=new.salon_id and r.collaborateur_id is not null and r.date_rdv=new.date_rdv
                     and coalesce(r.status,'') not in ('cancelled','cancelled_by_client','refused','done','no_show')
                     and not (coalesce(r.status,'')='pending_payment' and r.created_at < now() - interval '35 minutes')
                     and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int) < v_ne
                     and (extract(hour from r.heure_rdv)::int*60+extract(minute from r.heure_rdv)::int + coalesce(r.duree_minutes,30)) > v_ns)
       or exists (select 1 from appointments a
                   where a.salon_id=new.salon_id and a.date_rdv::text=new.date_rdv::text
                     and coalesce(a.cancelled,false)=false and coalesce(a.status,'') not in ('canc','cancelled','annule')
                     and a.heure ~ '^[0-9]{1,2}:[0-9]{2}' and not public.lx_appt_sans_duree(a.from_caisse, a.a_phases, a.service_id, a.items)
                     and coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000) < v_ne
                     and (coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000)
                          + greatest((select coalesce(sum(coalesce(public.lx_int_sur(p->>'d'),0)),0) from jsonb_array_elements(coalesce(a.a_phases,'[]'::jsonb)) p),30)) > v_ns) then
      raise exception 'Ce créneau vient d''être réservé, merci d''en choisir un autre' using errcode='23P01';
    end if;
    return new;
  end if;
  if v_free <= v_sans_pref then
    raise exception 'Ce créneau vient d''être réservé, merci d''en choisir un autre' using errcode='23P01';
  end if;
  return new;

exception
  when sqlstate '23P01' then raise;   -- conflit délibéré -> bloque
  -- 2026-10-14 audit : toute autre erreur -> REFUS (fail closed). Avant : la réservation passait sans contrôle.
  -- 2026-10-14 intégration : l'erreur est tracée avant le refus.
  --   * RAISE WARNING -> journal Postgres (Supabase > Logs), seule trace qui survit au refus ;
  --   * report_server_error est aussi appelé, mais sa ligne server_errors est annulée avec l'insertion refusée
  --     (pas de dblink sur le projet) : la trace durable dans server_errors vient de site.html (_resaFail ->
  --     lx-error-report), qui transmet désormais le « detail » ci-dessous.
  when others then
    declare v_err text := SQLSTATE || ' ' || SQLERRM;
    begin
      raise warning 'rdv_online_block_double_booking salon=% date=% heure=% : %', new.salon_id, new.date_rdv, new.heure_rdv, v_err;
      begin
        perform public.report_server_error('sql:rdv_online_block_double_booking', left(v_err, 800), 'error', null,
          jsonb_build_object('date_rdv', new.date_rdv, 'heure_rdv', new.heure_rdv, 'collaborateur_id', new.collaborateur_id),
          new.salon_id, null, 'rdv_online', null, null);
      exception when others then null;
      end;
      raise exception 'Vérification de disponibilité impossible, merci de réessayer dans un instant'
        using errcode = 'P0001', detail = left(v_err, 500), hint = 'lx_dispo_erreur';
    end;
end;
$function$;

-- -------------------------------------------------------------------------------------
-- 6) fn_salon_next_slots (recherche / annuaire) : horaires effectifs via lx_horaires_effectifs ;
--    une réservation sans collaborateur occupe UN collaborateur (avant : bloquait tout le monde)
-- -------------------------------------------------------------------------------------
-- 2026-10-14 intégration : public.fn_salon_next_slots est redéfinie dans docs/migrations_1014/reglages.sql
-- (définition unique fusionnant les modifications de planning.sql et de reglages.sql ; reglages.sql est appliqué après).
-- Les modifications « planning » de cette fonction y sont reprises à l'identique.

-- -------------------------------------------------------------------------------------
-- 7) Alerte « créneau libéré » : jamais pour un créneau déjà commencé / passé
--    (no-show constaté, annulation après l'heure), ni pour une absence (cancelled_by='no_show')
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lx_prive.creneau_libere_notifier(p_salon uuid, p_date date, p_heure text, p_duree integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_id uuid;
begin
  if p_date is null or p_date < (now() at time zone 'Europe/Paris')::date or p_heure is null then return; end if;
  -- 2026-10-14 audit : créneau du jour déjà commencé -> personne ne peut plus le prendre
  if p_date = (now() at time zone 'Europe/Paris')::date
     and lx_hm(p_heure) is not null
     and lx_hm(p_heure) <= extract(hour from (now() at time zone 'Europe/Paris'))::int*60 + extract(minute from (now() at time zone 'Europe/Paris'))::int then
    return;
  end if;
  if not exists (select 1 from creneau_alertes a where a.salon_id = p_salon and a.actif and p_date between a.date_debut and a.date_fin) then return; end if;
  insert into creneau_liberes (salon_id, date_rdv, heure, duree) values (p_salon, p_date, substr(p_heure,1,5), greatest(coalesce(p_duree,30),30)) returning id into v_id;
  perform net.http_post(url := 'https://luxyra.fr/api/alertes/creneau-libere', headers := jsonb_build_object('Content-Type','application/json'),
                        body := jsonb_build_object('id', v_id), timeout_milliseconds := 20000);
exception when others then null;
end $function$;

CREATE OR REPLACE FUNCTION lx_prive.trg_creneau_libere_rdv_online()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  -- 2026-10-14 audit : client absent (no-show) -> le créneau est passé, pas d'alerte
  if coalesce(new.cancelled_by,'') = 'no_show' or coalesce(new.status,'') = 'no_show' then return new; end if;
  if coalesce(old.status,'') not in ('cancelled','cancelled_by_client','refused') and coalesce(new.status,'') in ('cancelled','cancelled_by_client','refused') then
    perform lx_prive.creneau_libere_notifier(old.salon_id, old.date_rdv, old.heure_rdv::text, old.duree_minutes);
  elsif (new.date_rdv is distinct from old.date_rdv or new.heure_rdv is distinct from old.heure_rdv) and coalesce(old.status,'') in ('confirmed','pending') then
    perform lx_prive.creneau_libere_notifier(old.salon_id, old.date_rdv, old.heure_rdv::text, old.duree_minutes);
  end if;
  -- le client a réservé dans ce salon : ses alertes y sont satisfaites
  if tg_op = 'INSERT' then null; end if;
  return new;
exception when others then return new;
end $function$;

-- -------------------------------------------------------------------------------------
-- 8) Notification client : une demande refusée (statut 'cancelled' + motif « Demande non
--    retenue… », le statut 'refused' n'existe pas en base) n'est plus annoncée comme
--    « Rendez-vous annulé par l'établissement »
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION lx_prive.trg_rdv_online_notif_client()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_salon text; v_quand text; v_motif text;
begin
  if new.client_luxyra_id is null then return new; end if;
  select nom into v_salon from salons where id = new.salon_id;
  v_quand := to_char(new.date_rdv, 'DD/MM') || ' à ' || substr(new.heure_rdv::text,1,5);
  if coalesce(old.status,'') <> coalesce(new.status,'') then
    if new.status = 'confirmed' and old.status in ('pending','pending_payment') then
      perform lx_notifier_client(new.client_luxyra_id, 'rdv_confirme', '✅ Rendez-vous confirmé', coalesce(v_salon,'') || ' — le ' || v_quand, 'https://luxyra.fr/compte.html?tab=rdv');
    elsif new.status = 'refused'
          or (new.status = 'cancelled' and coalesce(new.cancelled_by,'') = 'salon' and coalesce(new.cancel_reason,'') like 'Demande non retenue%') then
      -- 2026-10-14 audit : refus d'une demande (lxRdvRefuser écrit cancelled + « Demande non retenue[ : motif] »)
      v_motif := nullif(trim(regexp_replace(coalesce(new.cancel_reason,''), '^Demande non retenue\s*:?\s*', '')), '');
      perform lx_notifier_client(new.client_luxyra_id, 'rdv_refuse', 'Demande non retenue', coalesce(v_salon,'') || ' ne peut pas vous recevoir le ' || v_quand || coalesce(' (« ' || v_motif || ' »)','') || '. Choisissez un autre créneau.', 'https://luxyra.fr/compte.html?tab=rdv');
    elsif new.status = 'cancelled' and coalesce(new.cancelled_by,'') not in ('client','no_show') then
      perform lx_notifier_client(new.client_luxyra_id, 'rdv_annule', 'Rendez-vous annulé par l''établissement', coalesce(v_salon,'') || ' — ' || v_quand || coalesce(' · ' || nullif(new.cancel_reason,''),''), 'https://luxyra.fr/compte.html?tab=rdv');
    elsif new.status = 'done' then
      perform lx_notifier_client(new.client_luxyra_id, 'avis', '⭐ Comment s''est passé votre rendez-vous ?', 'Donnez votre avis sur ' || coalesce(v_salon,'l''établissement') || ' en 30 secondes.', 'https://luxyra.fr/compte.html?tab=rdv');
    end if;
  elsif new.salon_modified_at is distinct from old.salon_modified_at and new.salon_modified_at is not null then
    perform lx_notifier_client(new.client_luxyra_id, 'rdv_modifie', '✏️ Votre rendez-vous a été modifié', coalesce(v_salon,'') || ' — désormais le ' || v_quand, 'https://luxyra.fr/compte.html?tab=rdv');
  elsif new.modification_status is distinct from old.modification_status and new.modification_status in ('accepted','refused') then
    perform lx_notifier_client(new.client_luxyra_id, 'modif_reponse', case when new.modification_status='accepted' then '✅ Modification acceptée' else 'Modification refusée' end, coalesce(v_salon,'') || ' — ' || v_quand, 'https://luxyra.fr/compte.html?tab=rdv');
  end if;
  return new;
exception when others then return new;
end $function$;

-- -------------------------------------------------------------------------------------
-- 9) Confirmation SMS d'une réservation en ligne : la ligne messaging_log porte la date du RDV
-- -------------------------------------------------------------------------------------
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
BEGIN
  -- Quand envoyer : a la creation (hors attente de paiement), ou au moment ou le
  -- paiement est valide (pending_payment -> pending/confirmed).
  IF TG_OP = 'INSERT' THEN
    v_doit := (coalesce(NEW.status,'') NOT IN ('pending_payment','pending')); -- 2026-10-10 : une demande en attente de validation n'est pas « confirmée » (message envoyé à l'acceptation)
  ELSIF TG_OP = 'UPDATE' THEN
    v_doit := (coalesce(OLD.status,'') = 'pending_payment'
               AND NEW.status IN ('pending','confirmed'));
  END IF;
  IF NOT v_doit THEN RETURN NEW; END IF;

  v_tel := regexp_replace(coalesce(NEW.client_tel,''), '[^0-9+]', '', 'g');
  IF length(v_tel) < 9 THEN RETURN NEW; END IF;

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

-- -------------------------------------------------------------------------------------
-- 10) Rappels 24 h : une confirmation envoyée AUJOURD'HUI ne remplace le rappel que si elle
--     concerne CE rendez-vous (avant : n'importe quelle confirmation du jour au même numéro)
-- -------------------------------------------------------------------------------------
-- 2026-10-14 intégration : public.envoyer_rappels_24h est redéfinie dans docs/migrations_1014/reglages.sql
-- (définition unique fusionnant les modifications de planning.sql et de reglages.sql ; reglages.sql est appliqué après).
-- Les modifications « planning » de cette fonction y sont reprises à l'identique.

COMMIT;

-- =====================================================================================
-- VÉRIFICATIONS (lecture seule, à lancer après application — salon de test UNIQUEMENT,
-- jamais e0cf27c7-…) :
--   select public.lx_horaires_effectifs('<salon test>', <collab>, current_date + 1);
--   select public.lx_horaires_effectifs('<salon test>', null, current_date + 1);
--   select public.fn_salon_next_slots('<salon test>', 5);
--   select lx_prive.confirmation_concerne_rdv(null, 'votre RDV du 16/10/2026 a 10:00', date '2026-10-16'); -- true
--   select lx_prive.confirmation_concerne_rdv(null, 'votre RDV du 22/10/2026 a 10:00', date '2026-10-16'); -- false
--   select lx_prive.confirmation_concerne_rdv(null, 'Merci pour votre confiance', date '2026-10-16');      -- true
-- =====================================================================================
