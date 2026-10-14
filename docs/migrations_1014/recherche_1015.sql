-- =====================================================================================
-- 2026-10-15 — Recherche : fn_salon_next_slots alignée sur les contrôles de réservation
-- Fichier IDEMPOTENT : peut être rejoué. À appliquer APRÈS planning.sql, site.sql et reglages.sql (étape A),
-- car il redéfinit rdv_online_validate, rdv_online_block_double_booking et fn_salon_next_slots.
--
-- Constat (revue) : fn_salon_next_slots proposait des créneaux (puces de recherche.html) que la réservation
-- refusait ensuite :
--   * établissements qui ne prennent pas de réservation : fermés / résiliés (Salon Démo), suspendus, essai expiré,
--     forfait sans réservation en ligne, site désactivé (site_actif = false), réservation en ligne désactivée ;
--   * règle « créneau pris » différente de rdv_online_block_double_booking (statuts done / no_show / inconnus,
--     durée 0, RDV internes sans durée, RDV internes sans collaborateur, collaborateurs actif = NULL, …).
--
-- Correction : les règles sont extraites dans des fonctions communes (schéma privé lx_prive, non exposé à l'API),
-- appelées À LA FOIS par les déclencheurs de réservation et par la recherche — elles ne peuvent plus diverger :
--   1) lx_prive.salon_resa_en_ligne_refus(salon)      : statut + forfait (règles de rdv_online_validate)
--   2) lx_prive.rdv_creneau_refus(salon, collab, ...)  : délais, horaires effectifs, pauses, fermetures, absences
--                                                         (règles de rdv_online_validate)
--   3) lx_prive.rdv_occupations(salon, date)          : ce qui « occupe » un créneau (réservations en ligne et RDV
--                                                         internes, mêmes statuts / durées que la vérification)
--   4) lx_prive.rdv_dispo_conflit(salon, collab, ...)  : décision « créneau déjà pris » (règles de
--                                                         rdv_online_block_double_booking)
--   5) rdv_online_validate / rdv_online_block_double_booking : mêmes contrôles et mêmes messages, via 1) à 4)
--   6) fn_salon_next_slots : '[]' si l'établissement ne peut pas recevoir de réservation (1) + site_actif /
--      reservation_active, comme site.html et recherche.html) ; chaque créneau renvoyé passe 2) et 4) pour une
--      réservation « Pas de préférence » de la prestation réservable la plus courte.
-- Signature, SECURITY DEFINER, search_path et droits des fonctions publiques inchangés.
-- =====================================================================================

BEGIN;

-- ---------- 1) Établissement autorisé à recevoir des réservations en ligne ----------
-- NULL = autorisé ; sinon le message d'erreur exact de rdv_online_validate.
CREATE OR REPLACE FUNCTION lx_prive.salon_resa_en_ligne_refus(p_salon uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status text;
  v_pro    boolean;
BEGIN
  SELECT s.status, public.lx_salon_pro_actif(s.plan, s.status, s.trial_end)
    INTO v_status, v_pro
    FROM public.salons s WHERE s.id = p_salon;
  IF v_status IS NULL THEN
    RETURN 'Salon inexistant';
  END IF;
  IF v_status NOT IN ('active','trial') THEN
    RETURN 'Ce salon n''accepte plus de réservations en ligne';
  END IF;
  -- 2026-10-08 : réservation en ligne = forfait Pro, ou essai gratuit en cours (non expiré).
  IF NOT coalesce(v_pro, false) THEN
    RETURN 'La réservation en ligne n''est pas active pour ce salon';
  END IF;
  RETURN NULL;
END;
$function$;

-- ---------- 2) Créneau compatible avec les délais, horaires, pauses, fermetures et absences ----------
-- Partie « créneau » de rdv_online_validate, à l'identique (mêmes tests, même ordre, mêmes messages).
-- NULL = accepté ; sinon le message d'erreur.
CREATE OR REPLACE FUNCTION lx_prive.rdv_creneau_refus(p_salon uuid, p_collab integer, p_date date, p_heure time, p_duree integer)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_delai_min     integer;
  v_delai_max     integer;
  v_cfg_horaires  jsonb;
  v_absences      jsonb;
  v_rdv_ts        timestamp;
  v_now_plus_min  timestamp;
  v_max_date      date;
  v_open_minutes  integer;
  v_close_minutes integer;
  v_rdv_minutes   integer;
  v_duree         integer := coalesce(p_duree, 30);
  v_abs           jsonb;
  v_abs_date      text;
  v_abs_type      text;
  v_abs_st        text;
  v_abs_from      text;
  v_abs_to        text;
  v_abs_h_from    integer;
  v_abs_h_to      integer;
  v_ouv_except    jsonb := NULL;
  v_eff           jsonb;
  v_pl            jsonb;
BEGIN
  SELECT delai_min_heures, delai_max_jours, to_jsonb(horaires_salon), to_jsonb(absences)
  INTO v_delai_min, v_delai_max, v_cfg_horaires, v_absences
  FROM public.site_config WHERE salon_id = p_salon LIMIT 1;

  v_delai_min := coalesce(v_delai_min, 2);
  v_delai_max := coalesce(v_delai_max, 30);

  v_rdv_ts       := (p_date::text || ' ' || p_heure::text)::timestamp;
  v_now_plus_min := ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris') + (v_delai_min || ' hours')::interval);
  v_max_date     := ((CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris')::date + (v_delai_max || ' days')::interval)::date;

  IF v_rdv_ts < v_now_plus_min THEN
    RETURN format('Réservation trop proche : délai minimum de %s h requis', v_delai_min);
  END IF;
  IF p_date > v_max_date THEN
    RETURN format('Réservation trop lointaine : maximum %s jours à l''avance', v_delai_max);
  END IF;

  IF v_absences IS NOT NULL AND jsonb_typeof(v_absences) = 'array' THEN
    FOR v_abs IN SELECT jsonb_array_elements(v_absences)
    LOOP
      v_abs_type := v_abs->>'type';
      v_abs_date := v_abs->>'date';
      v_abs_st   := v_abs->>'stId';

      IF v_abs_type = 'fermeture_except' AND v_abs_date = p_date::text THEN
        IF v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = '' THEN
          RETURN format('Salon fermé ce jour-là (%s)', coalesce(v_abs->>'motif','fermeture exceptionnelle'));
        ELSIF p_collab IS NOT NULL AND v_abs_st::int = p_collab THEN
          RETURN format('Collaborateur indisponible ce jour-là (%s)', coalesce(v_abs->>'motif','fermeture exceptionnelle'));
        END IF;
      END IF;

      -- conservé à l'identique (la conversion stId -> entier peut échouer, comme dans la version d'origine)
      IF v_abs_type = 'ouverture_except' AND v_abs_date = p_date::text THEN
        IF v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = ''
           OR p_collab IS NULL
           OR v_abs_st::int = p_collab THEN
          v_ouv_except := v_abs;
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- 2026-10-14 audit : horaires EFFECTIFS (horaires personnalisés du jour, semaine type du collaborateur,
  -- ouverture exceptionnelle qui élargit, pauses) — même règle que le site et la recherche.
  v_eff := public.lx_horaires_effectifs(p_salon, p_collab, p_date);
  IF v_eff IS NULL THEN
    RETURN 'Jour fermé';
  END IF;

  v_open_minutes  := (v_eff->>'o')::int;
  v_close_minutes := (v_eff->>'c')::int;
  v_rdv_minutes   := extract(hour FROM p_heure)::int * 60 + extract(minute FROM p_heure)::int;

  IF v_rdv_minutes < v_open_minutes THEN
    RETURN format('Horaire trop tôt (ouverture à %s)', lpad((v_open_minutes/60)::text,2,'0') || ':' || lpad((v_open_minutes%60)::text,2,'0'));
  END IF;
  IF v_rdv_minutes + v_duree > v_close_minutes THEN
    RETURN format('Horaire trop tard (fermeture à %s)', lpad((v_close_minutes/60)::text,2,'0') || ':' || lpad((v_close_minutes%60)::text,2,'0'));
  END IF;
  -- 2026-10-14 audit : pause du collaborateur (habituelle ou du jour)
  FOR v_pl IN SELECT jsonb_array_elements(coalesce(v_eff->'b','[]'::jsonb))
  LOOP
    IF v_rdv_minutes < (v_pl->>1)::int AND (v_rdv_minutes + v_duree) > (v_pl->>0)::int THEN
      RETURN format('Collaborateur indisponible sur ce créneau (pause %s:%s - %s:%s)',
        lpad(((v_pl->>0)::int/60)::text,2,'0'), lpad(((v_pl->>0)::int%60)::text,2,'0'),
        lpad(((v_pl->>1)::int/60)::text,2,'0'), lpad(((v_pl->>1)::int%60)::text,2,'0'));
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
         AND v_abs_date = p_date::text
         AND v_abs_st IS NOT NULL AND v_abs_st <> 'null' AND v_abs_st <> ''
         AND p_collab IS NOT NULL
         AND v_abs_st::int = p_collab
      THEN
        RETURN format('Collaborateur absent ce jour-là (%s)', coalesce(v_abs->>'motif','absence'));
      END IF;

      IF v_abs_type IN ('conge','absent_jour','absent','maladie','formation')
         AND v_abs_from IS NOT NULL AND v_abs_to IS NOT NULL
         AND p_date::text >= v_abs_from
         AND p_date::text <= v_abs_to
         AND (v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = ''
              OR (p_collab IS NOT NULL AND v_abs_st::int = p_collab))
      THEN
        RETURN format('Période d''absence (%s → %s, %s)', v_abs_from, v_abs_to, coalesce(v_abs->>'motif','congé'));
      END IF;

      IF v_abs_type IN ('absent_heures','pause')
         AND v_abs_date = p_date::text
         AND (v_abs->>'from') ~ '^[0-9]{1,2}:[0-9]{2}$'
         AND (v_abs->>'to')   ~ '^[0-9]{1,2}:[0-9]{2}$'
         AND ( (v_abs_st IS NULL OR v_abs_st = 'null' OR v_abs_st = '')
               OR (p_collab IS NOT NULL AND v_abs_st::int = p_collab) )
      THEN
        v_abs_h_from := (split_part(v_abs->>'from', ':', 1)::int * 60) + split_part(v_abs->>'from', ':', 2)::int;
        v_abs_h_to   := (split_part(v_abs->>'to',   ':', 1)::int * 60) + split_part(v_abs->>'to',   ':', 2)::int;
        IF v_rdv_minutes < v_abs_h_to AND (v_rdv_minutes + v_duree) > v_abs_h_from THEN
          RETURN format('Collaborateur indisponible sur ce créneau (%s - %s, %s)',
            v_abs->>'from', v_abs->>'to', coalesce(v_abs->>'motif','absence'));
        END IF;
      END IF;
    END LOOP;
  END IF;

  RETURN NULL;
END;
$function$;

-- ---------- 3) Occupations d'une journée (source unique de la règle « créneau pris ») ----------
-- origine 'rdv'     : réservation en ligne non annulée / non refusée, paiement en attente de moins de 35 min ;
--                     termine = terminée ou absence (no_show) : elle bloque encore SON collaborateur, mais ne
--                     consomme plus de place « sans préférence » ni la place unique d'un établissement sans équipe.
-- origine 'interne' : RDV de l'agenda non annulé, heure lisible, avec durée (lx_appt_sans_duree exclus) ;
--                     durée = somme des phases, 30 min minimum.
CREATE OR REPLACE FUNCTION lx_prive.rdv_occupations(p_salon uuid, p_date date)
 RETURNS TABLE(origine text, collab_id integer, debut integer, fin integer, termine boolean)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT 'rdv'::text, r.collaborateur_id,
         extract(hour from r.heure_rdv)::int*60 + extract(minute from r.heure_rdv)::int,
         extract(hour from r.heure_rdv)::int*60 + extract(minute from r.heure_rdv)::int + coalesce(r.duree_minutes,30),
         coalesce(r.status,'') IN ('done','no_show')
    FROM public.rdv_online r
   WHERE r.salon_id = p_salon AND r.date_rdv = p_date
     AND coalesce(r.status,'') NOT IN ('cancelled','cancelled_by_client','refused')
     AND NOT (coalesce(r.status,'') = 'pending_payment' AND r.created_at < now() - interval '35 minutes')
  UNION ALL
  SELECT 'interne'::text, a.collab_id,
         coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000),
         coalesce(public.lx_hm(substring(a.heure from '^[0-9]{1,2}:[0-9]{2}')),-100000)
           + greatest((SELECT coalesce(sum(coalesce(public.lx_int_sur(p->>'d'),0)),0)
                         FROM jsonb_array_elements(coalesce(a.a_phases,'[]'::jsonb)) p), 30),
         false
    FROM public.appointments a
   WHERE a.salon_id = p_salon AND a.date_rdv = p_date
     AND coalesce(a.cancelled,false) = false AND coalesce(a.status,'') NOT IN ('canc','cancelled','annule')
     AND a.heure ~ '^[0-9]{1,2}:[0-9]{2}'
     AND NOT public.lx_appt_sans_duree(a.from_caisse, a.a_phases, a.service_id, a.items)
$function$;

-- ---------- 4) Décision « créneau déjà pris » (règles de rdv_online_block_double_booking) ----------
-- true = conflit (la réservation doit être refusée). p_collab NULL = « Pas de préférence ».
CREATE OR REPLACE FUNCTION lx_prive.rdv_dispo_conflit(p_salon uuid, p_collab integer, p_date date, p_ns integer, p_ne integer)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_occ jsonb;
  v_collab_count int := 0; v_free int := 0; v_free_autres int := 0; v_sans_pref int := 0;
  v_col record; v_eh jsonb; v_busy boolean;
BEGIN
  -- occupations qui chevauchent le créneau demandé
  SELECT coalesce(jsonb_agg(jsonb_build_object('col', o.collab_id, 'orig', o.origine, 'fini', o.termine)), '[]'::jsonb)
    INTO v_occ
    FROM lx_prive.rdv_occupations(p_salon, p_date) o
   WHERE o.debut < p_ne AND o.fin > p_ns;

  -- collaborateur choisi : tout chevauchement (en ligne OU interne) bloque
  IF p_collab IS NOT NULL AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_occ) x WHERE (x->>'col')::int = p_collab) THEN
    RETURN true;
  END IF;

  -- réservations SANS préférence qui chevauchent (chacune occupe un collaborateur)
  SELECT count(*) INTO v_sans_pref FROM jsonb_array_elements(v_occ) x
   WHERE x->>'orig' = 'rdv' AND x->>'col' IS NULL AND NOT (x->>'fini')::boolean;

  -- collaborateurs présents ET libres sur le créneau (horaires effectifs, pauses, RDV attribués)
  FOR v_col IN
    SELECT id FROM public.collaborateurs
     WHERE salon_id = p_salon AND coalesce(actif,true) = true AND coalesce(inactif,false) = false
       AND (date_depart IS NULL OR date_depart > p_date)
  LOOP
    v_collab_count := v_collab_count + 1;
    v_eh := public.lx_horaires_effectifs(p_salon, v_col.id, p_date);
    IF v_eh IS NULL THEN CONTINUE; END IF;
    -- horaires illisibles -> collaborateur considéré indisponible (prudence)
    IF public.lx_int_sur(v_eh->>'o') IS NULL OR public.lx_int_sur(v_eh->>'c') IS NULL THEN CONTINUE; END IF;
    IF p_ns < public.lx_int_sur(v_eh->>'o') OR p_ne > public.lx_int_sur(v_eh->>'c') THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(coalesce(v_eh->'b','[]'::jsonb)) b
                WHERE coalesce(p_ns < public.lx_int_sur(b->>1) AND p_ne > public.lx_int_sur(b->>0), true)) THEN CONTINUE; END IF;
    v_busy := EXISTS (SELECT 1 FROM jsonb_array_elements(v_occ) x WHERE (x->>'col')::int = v_col.id);
    IF NOT v_busy THEN
      v_free := v_free + 1;
      IF p_collab IS NULL OR v_col.id <> p_collab THEN v_free_autres := v_free_autres + 1; END IF;
    END IF;
  END LOOP;

  IF p_collab IS NOT NULL THEN
    -- le collaborateur choisi est libre ; il doit en rester assez pour les « sans préférence »
    RETURN v_collab_count > 0 AND v_sans_pref > v_free_autres;
  END IF;

  -- « Pas de préférence »
  IF v_collab_count = 0 THEN
    -- établissement sans collaborateur : une seule personne -> tout chevauchement bloque
    -- (réservations en ligne non terminées, avec ou sans collaborateur, et RDV internes)
    RETURN EXISTS (SELECT 1 FROM jsonb_array_elements(v_occ) x WHERE NOT (x->>'fini')::boolean);
  END IF;
  RETURN v_free <= v_sans_pref;
END;
$function$;

REVOKE ALL ON FUNCTION lx_prive.salon_resa_en_ligne_refus(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lx_prive.rdv_creneau_refus(uuid, integer, date, time, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lx_prive.rdv_occupations(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION lx_prive.rdv_dispo_conflit(uuid, integer, date, integer, integer) FROM PUBLIC, anon, authenticated;

-- ---------- 5a) rdv_online_validate : mêmes contrôles, via 1) et 2) ----------
CREATE OR REPLACE FUNCTION public.rdv_online_validate()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role          text;
  v_refus         text;    -- 2026-10-15 : message renvoyé par les fonctions communes
  v_svc_salon     uuid;
  v_svc_actif     boolean;
  v_svc_book      boolean;
  v_svc_show      boolean;
  v_col_salon     uuid;
  v_col_actif     boolean;
  v_col_inactif   boolean;
  v_col_depart    date;
  v_col_horaires  jsonb := NULL;
  v_item          jsonb;
  v_item_sid      integer;
  v_items_count   integer := 0;
BEGIN
  v_role := coalesce((select auth.role()), 'anon');
  IF v_role = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- 2026-10-15 : statut + forfait (Pro ou essai en cours) — règle commune avec fn_salon_next_slots
  v_refus := lx_prive.salon_resa_en_ligne_refus(NEW.salon_id);
  IF v_refus IS NOT NULL THEN
    RAISE EXCEPTION '%', v_refus;
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
    -- ne doit plus recevoir de rendez-vous.
    IF v_col_inactif = true THEN
      RAISE EXCEPTION 'Ce collaborateur ne fait plus partie de l''équipe';
    END IF;
    IF v_col_depart IS NOT NULL AND v_col_depart <= NEW.date_rdv THEN
      RAISE EXCEPTION 'Ce collaborateur a quitté l''équipe le %', to_char(v_col_depart,'DD/MM/YYYY');
    END IF;
  END IF;

  -- 2026-10-15 : délais, fermetures, horaires effectifs, pauses, absences — règle commune avec fn_salon_next_slots
  v_refus := lx_prive.rdv_creneau_refus(NEW.salon_id, NEW.collaborateur_id, NEW.date_rdv, NEW.heure_rdv, NEW.duree_minutes);
  IF v_refus IS NOT NULL THEN
    RAISE EXCEPTION '%', v_refus;
  END IF;

  IF coalesce(NEW.acompte_paye, false) = TRUE
     AND NEW.stripe_payment_id IS NULL
     AND NEW.stripe_token IS NULL THEN
    RAISE EXCEPTION 'Impossible de marquer un acompte payé sans preuve de paiement';
  END IF;

  RETURN NEW;
END;
$function$;

-- ---------- 5b) rdv_online_block_double_booking : même décision, via 4) ----------
CREATE OR REPLACE FUNCTION public.rdv_online_block_double_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_ns int; v_ne int; v_dur int;
begin
  if coalesce((select auth.role()),'anon') = 'service_role' then return new; end if;
  perform pg_advisory_xact_lock(hashtext('lx_rdv:' || new.salon_id::text || ':' || new.date_rdv::text));
  v_dur := coalesce(new.duree_minutes, 30);
  v_ns  := extract(hour from new.heure_rdv)::int*60 + extract(minute from new.heure_rdv)::int;
  v_ne  := v_ns + v_dur;

  -- 2026-10-15 : décision commune avec fn_salon_next_slots (lx_prive.rdv_dispo_conflit / rdv_occupations)
  if lx_prive.rdv_dispo_conflit(new.salon_id, new.collaborateur_id, new.date_rdv, v_ns, v_ne) then
    raise exception 'Ce créneau vient d''être réservé, merci d''en choisir un autre' using errcode='23P01';
  end if;
  return new;

exception
  when sqlstate '23P01' then raise;   -- conflit délibéré -> bloque
  -- 2026-10-14 audit : toute autre erreur -> REFUS (fail closed), erreur tracée avant le refus.
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

-- ---------- 6) fn_salon_next_slots ----------
-- Renvoie '[]' (aucune puce) si l'établissement ne peut pas recevoir de réservation en ligne :
--   statut / forfait (lx_prive.salon_resa_en_ligne_refus, comme rdv_online_validate), pas de site_config,
--   site désactivé (site_actif = false, site.html affiche « site indisponible »), réservation en ligne
--   désactivée (reservation_active non vraie : pas de bouton « Réserver »), aucune prestation réservable en ligne.
-- Créneaux : réservation « Pas de préférence » de la prestation réservable la plus courte. Pré-filtre rapide par
-- journée (mêmes occupations lx_prive.rdv_occupations, mêmes horaires effectifs), puis contrôle définitif de
-- chaque créneau par les fonctions des déclencheurs (rdv_creneau_refus + rdv_dispo_conflit).
CREATE OR REPLACE FUNCTION public.fn_salon_next_slots(p_salon_id uuid, p_n integer DEFAULT 3)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_cfg record; v_now timestamp; v_min timestamp; v_max date; v_step int; v_dur int; v_n int;
  v_res jsonb := '[]'::jsonb; v_d date; v_off int; v_eh0 jsonb; v_eh jsonb;
  v_col record; v_cols jsonb; v_nb_cols int; v_occ jsonb;
  v_open int; v_close int; v_t int; v_te int; v_nlib int; v_nsp int; v_o int; v_c int; v_ok boolean;
  v_refus text; v_label text;
begin
  if p_salon_id is null then return '[]'::jsonb; end if;
  -- 2026-10-15 : établissement autorisé (même règle que rdv_online_validate)
  if lx_prive.salon_resa_en_ligne_refus(p_salon_id) is not null then return '[]'::jsonb; end if;
  select site_actif, reservation_active, delai_min_heures, delai_max_jours, creneau_intervalle
    into v_cfg from site_config where salon_id = p_salon_id limit 1;
  if not found then return '[]'::jsonb; end if;
  -- 2026-10-15 : site désactivé / réservation en ligne désactivée (mêmes interrupteurs que site.html et recherche.html)
  if coalesce(v_cfg.site_actif, true) = false or not coalesce(v_cfg.reservation_active, false) then return '[]'::jsonb; end if;

  -- durée de référence : la plus courte prestation RÉSERVABLE EN LIGNE (mêmes critères que rdv_online_validate et
  -- rdv_online_insert_public_propre : active, réservable, visible, pas « sur devis ») ; 30 min si pas de phases
  if not exists (select 1 from services s where s.salon_id = p_salon_id and coalesce(s.actif,true) and coalesce(s.book_online,true)
                   and coalesce(s.show_site,true) and not coalesce(s.prix_sur_devis,false)) then
    return '[]'::jsonb;
  end if;
  select min(t) into v_dur from (
    select (select sum(coalesce(public.lx_int_sur(ph->>'d'),0)) from jsonb_array_elements(case when jsonb_typeof(s.phases)='array' then s.phases else '[]'::jsonb end) ph) t
      from services s where s.salon_id = p_salon_id and coalesce(s.actif,true) and coalesce(s.book_online,true)
       and coalesce(s.show_site,true) and not coalesce(s.prix_sur_devis,false)) x where t >= 5;
  v_dur := coalesce(v_dur, 30);

  v_n := least(greatest(coalesce(p_n,3),1),10);
  v_step := case when coalesce(v_cfg.creneau_intervalle,15) between 5 and 240 then v_cfg.creneau_intervalle else 15 end;
  -- délais : exactement ceux de rdv_online_validate (2 h et 30 j par défaut)
  v_now := (now() at time zone 'Europe/Paris')::timestamp;
  v_min := v_now + (coalesce(v_cfg.delai_min_heures,2) || ' hours')::interval;
  v_max := (v_now::date + (coalesce(v_cfg.delai_max_jours,30) || ' days')::interval)::date;

  for v_off in 0..365 loop
    v_d := v_now::date + v_off;
    exit when v_d > v_max or jsonb_array_length(v_res) >= v_n;
    continue when v_d < v_min::date;
    -- horaires « Pas de préférence » (fermetures, congés globaux) : jour fermé -> refus « Jour fermé »
    v_eh0 := public.lx_horaires_effectifs(p_salon_id, null, v_d);
    continue when v_eh0 is null;

    -- occupations du jour (règle commune avec rdv_online_block_double_booking)
    select coalesce(jsonb_agg(jsonb_build_object('col', o.collab_id, 's', o.debut, 'f', o.fin, 'orig', o.origine, 'fini', o.termine)), '[]'::jsonb)
      into v_occ from lx_prive.rdv_occupations(p_salon_id, v_d) o;

    -- collaborateurs présents : mêmes critères et mêmes horaires que la vérification
    v_cols := '[]'::jsonb; v_nb_cols := 0;
    for v_col in select c.id from collaborateurs c
                  where c.salon_id = p_salon_id and coalesce(c.actif,true) = true and coalesce(c.inactif,false) = false
                    and (c.date_depart is null or c.date_depart > v_d) loop
      v_nb_cols := v_nb_cols + 1;
      v_eh := public.lx_horaires_effectifs(p_salon_id, v_col.id, v_d);
      continue when v_eh is null;
      v_o := public.lx_int_sur(v_eh->>'o'); v_c := public.lx_int_sur(v_eh->>'c');
      continue when v_o is null or v_c is null;
      v_cols := v_cols || jsonb_build_array(jsonb_build_object('id', v_col.id, 'o', v_o, 'c', v_c, 'b', coalesce(v_eh->'b','[]'::jsonb)));
    end loop;
    if v_nb_cols > 0 then
      continue when jsonb_array_length(v_cols) = 0;
      select min((x->>'o')::int), max((x->>'c')::int) into v_open, v_close from jsonb_array_elements(v_cols) x;
    else
      v_open := public.lx_int_sur(v_eh0->>'o'); v_close := public.lx_int_sur(v_eh0->>'c');
      continue when v_open is null or v_close is null;
    end if;

    -- grille : départ = ouverture la plus tôt du jour, pas = intervalle (comme le site)
    v_t := v_open;
    while v_t + v_dur <= v_close and jsonb_array_length(v_res) < v_n loop
      v_te := v_t + v_dur;
      if (v_d + make_interval(mins => v_t)) >= v_min then
        if v_nb_cols > 0 then
          -- collaborateurs libres (horaires, pauses — bornes illisibles = occupé —, RDV attribués) ...
          select count(*) into v_nlib from jsonb_array_elements(v_cols) ce
           where v_t >= (ce->>'o')::int and v_te <= (ce->>'c')::int
             and not exists (select 1 from jsonb_array_elements(ce->'b') b
                              where coalesce(v_t < public.lx_int_sur(b->>1) and v_te > public.lx_int_sur(b->>0), true))
             and not exists (select 1 from jsonb_array_elements(v_occ) o
                              where (o->>'col')::int = (ce->>'id')::int and (o->>'s')::int < v_te and (o->>'f')::int > v_t);
          -- ... plus nombreux que les réservations « sans préférence » qui chevauchent
          select count(*) into v_nsp from jsonb_array_elements(v_occ) o
           where o->>'orig' = 'rdv' and o->>'col' is null and not (o->>'fini')::boolean
             and (o->>'s')::int < v_te and (o->>'f')::int > v_t;
          v_ok := v_nlib > v_nsp;
        else
          -- établissement sans collaborateur : tout chevauchement non terminé bloque
          v_ok := not exists (select 1 from jsonb_array_elements(v_occ) o
                               where not (o->>'fini')::boolean and (o->>'s')::int < v_te and (o->>'f')::int > v_t);
        end if;
        if v_ok then
          -- contrôle définitif : les fonctions mêmes des déclencheurs de réservation
          begin
            v_refus := lx_prive.rdv_creneau_refus(p_salon_id, null, v_d, make_time(v_t/60, v_t%60, 0), v_dur);
            if v_refus is null and lx_prive.rdv_dispo_conflit(p_salon_id, null, v_d, v_t, v_te) then
              v_refus := 'créneau pris';
            end if;
          exception when others then
            v_refus := 'erreur';   -- la réservation échouerait aussi : créneau non proposé
          end;
          if v_refus is null then
            v_label := case when v_off = 0 then 'Aujourd''hui' when v_off = 1 then 'Demain' else to_char(v_d, 'TMDay DD/MM') end;
            v_res := v_res || jsonb_build_object('date', v_d::text, 'time', lpad((v_t/60)::text,2,'0')||':'||lpad((v_t%60)::text,2,'0'), 'day_label', v_label);
          end if;
        end if;
      end if;
      v_t := v_t + v_step * greatest(1, ceil(30.0 / v_step)::int);
    end loop;
  end loop;
  return v_res;
end $function$;

-- Droits inchangés (CREATE OR REPLACE les conserve ; rappel explicite, sans effet s'ils existent déjà)
GRANT EXECUTE ON FUNCTION public.fn_salon_next_slots(uuid, integer) TO anon, authenticated, service_role;

COMMIT;

-- ---------- Contrôles (lecture seule, après application) ----------
--   select public.fn_salon_next_slots('ad3f2257-91a6-4faf-99ba-6ad6a02917be', 3);   -- Salon Démo fermé : []
--   select public.fn_salon_next_slots('<établissement Pro actif>', 5);              -- créneaux réservables
