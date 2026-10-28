-- =====================================================================================================================
-- 2026-10-28 (-5) — RETOUR ARRIÈRE du contrôle des journées retenues (Z, clôtures mensuelle / annuelle / d'exercice) posé par
-- docs/migrations_1028/recettes_en_ligne.sql (-5). NON APPLIQUÉ. À N'UTILISER QUE si ce contrôle bloquait à tort les clôtures
-- (il retire une protection : une journée incomplète pourrait de nouveau être scellée). Décision et heure à noter au registre NF525.
-- Rétablit EXACTEMENT les définitions relevées en production le 28/10/2026 (md5 vérifiés : /tmp/pgreal/md5chk.cjs) — cloturer_mois :
-- version de docs/migrations_1027/bons_cadeaux_tva.sql (prérequis) — et les horaires des tâches. Ne touche à AUCUNE donnée
-- (Z, clôtures, forçages, tickets restent). Les fonctions ajoutées (lx_z_controle_ventes, lx_z_forcer, lx_caisse_alertes,
-- journees_non_closes…) peuvent rester : sans effet une fois ces définitions rétablies.
-- Variante « verrou conservé » : relancer ensuite seulement le §8 bis de recettes_en_ligne.sql de l'intervention -4 (git 8dbe8f2).
-- =====================================================================================================================
begin;
CREATE OR REPLACE FUNCTION lx_prive.clotures_controle_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_somme numeric; v_nb int; v_bypass text; v_d record; v_auto boolean;
begin
  begin v_bypass := current_setting('luxyra.allow_nf525_unlock', true); exception when others then v_bypass := null; end;
  select coalesce(sum(t.total_ttc), 0), count(*) into v_somme, v_nb from public.tickets t
   where t.salon_id = NEW.salon_id and t.date_ticket = NEW.date_cloture and t.status <> 'cancelled'
     and (t.mode_caisse is null or NEW.mode_caisse is null or t.mode_caisse = NEW.mode_caisse);
  v_auto := coalesce(NEW.raw_data->>'auto', '') = 'true';
  if abs(coalesce(NEW.total_ca, 0) - v_somme) > 0.005 or (not v_auto and coalesce(NEW.nb_tickets, 0) > v_nb) then
    if v_bypass = 'true' then
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (NEW.salon_id, 'NF525_INALTERABILITE_BYPASSEE', 'INSERT clotures Z n°' || NEW.num || ' différente du journal (' || NEW.total_ca || ' vs ' || v_somme || ') user=' || current_user, 'BYPASS_EXPLICITE');
    else
      raise exception 'LX_Z_ECART_JOURNAL : clôture Z n°% du % refusée — % EUR / % ticket(s) déclarés, journal des tickets % EUR / % ticket(s). Recalculez la clôture depuis les tickets enregistrés.',
        NEW.num, to_char(NEW.date_cloture, 'DD/MM/YYYY'), to_char(coalesce(NEW.total_ca, 0), 'FM999999990.00'), coalesce(NEW.nb_tickets, 0), to_char(v_somme, 'FM999999990.00'), v_nb
        using errcode = 'P0001';
    end if;
  end if;
  if coalesce(NEW.raw_data->>'lxAnnotOk', '') <> 'true' and exists (select 1 from public.clotures_annotations a where a.salon_id = NEW.salon_id and a.cloture_date < NEW.date_cloture) then
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('month', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_ca, 0) <> 0 then NEW.cumul_mois_ca := coalesce(NEW.cumul_mois_ca, 0) + v_d.d_ca; end if;
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('year', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_ca, 0) <> 0 then NEW.cumul_annee_ca := coalesce(NEW.cumul_annee_ca, 0) + v_d.d_ca; end if;
  end if;
  return NEW;
end $function$;

CREATE OR REPLACE FUNCTION public.cloturer_mois(p_salon_id uuid, p_annee integer, p_mois integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text; v_nb_jours int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0; v_cloture_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid; v_pay_keys text[]; v_k text; v_sum_pay numeric; v_d record; v_raw jsonb := null;
  v_hc numeric := 0;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = p_salon_id AND user_id = v_user_id) AND NOT is_admin() THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;
  SELECT id INTO v_existing FROM clotures_mensuelles WHERE salon_id = p_salon_id AND annee = p_annee AND mois = p_mois;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing); END IF;
  SELECT siret INTO v_siret FROM salons WHERE id = p_salon_id;
  SELECT COUNT(*), COALESCE(SUM(nb_tickets),0), COALESCE(SUM(nb_annulations),0),
         COALESCE(SUM(total_ca),0), COALESCE(SUM(total_ht),0), array_agg(id ORDER BY date_cloture)
    INTO v_nb_jours, v_nb_tickets, v_nb_annul, v_ca, v_ht, v_cloture_ids
  FROM clotures WHERE salon_id = p_salon_id
    AND EXTRACT(YEAR FROM date_cloture)::int = p_annee
    AND EXTRACT(MONTH FROM date_cloture)::int = p_mois;
  IF v_nb_jours = 0 OR v_nb_jours IS NULL THEN
    RAISE EXCEPTION 'Aucune clôture journalière trouvée pour %-%, mois ne peut pas être clôturé', p_annee, p_mois;
  END IF;
  v_pay_keys := ARRAY(SELECT DISTINCT jsonb_object_keys(c.detail_paiements) FROM clotures c
    WHERE c.salon_id = p_salon_id AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee
      AND EXTRACT(MONTH FROM c.date_cloture)::int = p_mois AND c.detail_paiements IS NOT NULL);
  IF v_pay_keys IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_pay_keys LOOP
      SELECT COALESCE(SUM((c.detail_paiements->>v_k)::numeric), 0) INTO v_sum_pay
      FROM clotures c WHERE c.salon_id = p_salon_id
        AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee
        AND EXTRACT(MONTH FROM c.date_cloture)::int = p_mois
        AND c.detail_paiements ? v_k;
      v_detail_paiements := v_detail_paiements || jsonb_build_object(v_k, v_sum_pay);
    END LOOP;
  END IF;
  -- 2026-10-16 : Z annotées (annotation corrective signée) -> montants corrigés
  SELECT * INTO v_d FROM nf525_z_annotation_delta(p_salon_id, make_date(p_annee, p_mois, 1), (make_date(p_annee, p_mois, 1) + interval '1 month - 1 day')::date);
  IF coalesce(v_d.d_ca,0) <> 0 OR coalesce(v_d.d_nb,0) <> 0 OR coalesce(v_d.d_ht,0) <> 0 THEN
    v_ca := v_ca + v_d.d_ca; v_ht := v_ht + v_d.d_ht; v_nb_tickets := v_nb_tickets + v_d.d_nb;
    FOR v_k IN SELECT jsonb_object_keys(v_d.d_det) LOOP
      v_detail_paiements := v_detail_paiements || jsonb_build_object(v_k, COALESCE((v_detail_paiements->>v_k)::numeric, 0) + (v_d.d_det->>v_k)::numeric);
    END LOOP;
    v_raw := jsonb_build_object('annotations', (SELECT jsonb_agg(jsonb_build_object('num', a.num, 'z', a.cloture_num, 'hash', a.hash, 'ecart_ca', a.correct_total_ca - a.wrong_total_ca))
      FROM clotures_annotations a WHERE a.salon_id = p_salon_id AND EXTRACT(YEAR FROM a.cloture_date)::int = p_annee AND EXTRACT(MONTH FROM a.cloture_date)::int = p_mois));
  END IF;
  -- 2026-10-28 (Luxyra 6.7.0) : ventes de bons à usage multiple (hors CA, TVA 0) comprises dans total_ca -> détaillées à part
  SELECT round(COALESCE(SUM(CASE WHEN jsonb_typeof(c.raw_data->'totalHorsCa') = 'number' THEN (c.raw_data->>'totalHorsCa')::numeric ELSE 0 END), 0), 2) INTO v_hc
    FROM clotures c WHERE c.salon_id = p_salon_id AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee AND EXTRACT(MONTH FROM c.date_cloture)::int = p_mois;
  IF coalesce(v_hc, 0) <> 0 THEN
    v_raw := coalesce(v_raw, '{}'::jsonb) || jsonb_build_object('hors_ca_bum', v_hc, 'ca_hors_bum', round(v_ca - v_hc, 2));
  END IF;
  v_tva := v_ca - v_ht;
  SELECT hash INTO v_hash_prev FROM clotures_mensuelles WHERE salon_id = p_salon_id ORDER BY annee DESC, mois DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    'ZM|' || p_annee || '-' || p_mois || '|' || to_char(v_ca, 'FM9999999.99') || '|' || v_nb_tickets || '|' ||
    COALESCE(v_hash_prev, '') || '|' || COALESCE(v_siret, ''), 'sha256'), 'hex');
  INSERT INTO clotures_mensuelles (salon_id, annee, mois, nb_jours_clotures, nb_tickets, nb_annulations,
    total_ca, total_ht, total_tva, detail_paiements, cloture_ids, hash, hash_algo, hash_prev, operator_name, raw_data)
  VALUES (p_salon_id, p_annee, p_mois, v_nb_jours, v_nb_tickets, v_nb_annul,
    v_ca, v_ht, v_tva, v_detail_paiements, v_cloture_ids, v_hash, 'SHA-256', v_hash_prev, 'auto_cron', v_raw)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_MOIS', p_annee || '-' || LPAD(p_mois::text, 2, '0') || ' : ' || v_nb_jours || ' jours, ' ||
    v_nb_tickets || ' tickets, ' || to_char(v_ca, 'FM9999999.99') || ' EUR' || CASE WHEN v_raw ? 'annotations' THEN ' (Z annotées : montants corrigés)' ELSE '' END ||
    CASE WHEN coalesce(v_hc,0) <> 0 THEN ' (dont ' || to_char(v_hc, 'FM9999999.99') || ' EUR de bons à usage multiple vendus, hors CA)' ELSE '' END, 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'annee', p_annee, 'mois', p_mois,
    'nb_jours', v_nb_jours, 'nb_tickets', v_nb_tickets, 'total_ca', v_ca, 'total_ht', v_ht, 'total_tva', v_tva, 'hash', v_hash,
    'hors_ca_bum', coalesce(v_hc, 0));
END;
$function$;


CREATE OR REPLACE FUNCTION public.run_cloture_mensuelle_pour_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_year int;
  v_target_month int;
  v_salon_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_nb_ok int := 0;
  v_nb_err int := 0;
BEGIN
  -- Si on est en janvier, on clôture décembre de l'année précédente
  v_target_year := EXTRACT(YEAR FROM (NOW() - INTERVAL '1 month'))::int;
  v_target_month := EXTRACT(MONTH FROM (NOW() - INTERVAL '1 month'))::int;

  FOR v_salon_id IN 
    SELECT DISTINCT salon_id FROM clotures 
    WHERE EXTRACT(YEAR FROM date_cloture)::int = v_target_year
      AND EXTRACT(MONTH FROM date_cloture)::int = v_target_month
  LOOP
    BEGIN
      v_one := public.cloturer_mois(v_salon_id, v_target_year, v_target_month);
      v_results := v_results || jsonb_build_object('salon_id', v_salon_id, 'result', v_one);
      v_nb_ok := v_nb_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('salon_id', v_salon_id, 'error', SQLERRM);
      v_nb_err := v_nb_err + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'period', v_target_year || '-' || LPAD(v_target_month::text, 2, '0'),
    'nb_ok', v_nb_ok, 'nb_err', v_nb_err,
    'results', v_results
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.cloturer_annee(p_salon_id uuid, p_annee integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text;
  v_nb_mois int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0;
  v_mens_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid;
  v_pay_keys text[]; v_k text; v_sum_pay numeric;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = p_salon_id AND user_id = v_user_id) AND NOT is_admin() THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;
  SELECT id INTO v_existing FROM clotures_annuelles WHERE salon_id = p_salon_id AND annee = p_annee;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing); END IF;
  SELECT siret INTO v_siret FROM salons WHERE id = p_salon_id;
  SELECT COUNT(*), COALESCE(SUM(nb_tickets),0), COALESCE(SUM(nb_annulations),0),
         COALESCE(SUM(total_ca),0), COALESCE(SUM(total_ht),0), array_agg(id ORDER BY mois)
    INTO v_nb_mois, v_nb_tickets, v_nb_annul, v_ca, v_ht, v_mens_ids
  FROM clotures_mensuelles WHERE salon_id = p_salon_id AND annee = p_annee;
  v_tva := v_ca - v_ht;
  IF v_nb_mois = 0 OR v_nb_mois IS NULL THEN
    RAISE EXCEPTION 'Aucune clôture mensuelle pour %, l''année ne peut être clôturée', p_annee;
  END IF;
  v_pay_keys := ARRAY(SELECT DISTINCT jsonb_object_keys(cm.detail_paiements) FROM clotures_mensuelles cm
    WHERE cm.salon_id = p_salon_id AND cm.annee = p_annee AND cm.detail_paiements IS NOT NULL);
  IF v_pay_keys IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_pay_keys LOOP
      SELECT COALESCE(SUM((cm.detail_paiements->>v_k)::numeric), 0) INTO v_sum_pay
      FROM clotures_mensuelles cm WHERE cm.salon_id = p_salon_id AND cm.annee = p_annee AND cm.detail_paiements ? v_k;
      v_detail_paiements := v_detail_paiements || jsonb_build_object(v_k, v_sum_pay);
    END LOOP;
  END IF;
  SELECT hash INTO v_hash_prev FROM clotures_annuelles WHERE salon_id = p_salon_id ORDER BY annee DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    'ZA|' || p_annee || '|' || to_char(v_ca, 'FM9999999.99') || '|' || v_nb_tickets || '|' ||
    COALESCE(v_hash_prev, '') || '|' || COALESCE(v_siret, ''), 'sha256'), 'hex');
  INSERT INTO clotures_annuelles (salon_id, annee, nb_mois_clotures, nb_tickets, nb_annulations,
    total_ca, total_ht, total_tva, detail_paiements, cloture_mens_ids, hash, hash_algo, hash_prev, operator_name)
  VALUES (p_salon_id, p_annee, v_nb_mois, v_nb_tickets, v_nb_annul,
    v_ca, v_ht, v_tva, v_detail_paiements, v_mens_ids, v_hash, 'SHA-256', v_hash_prev, 'auto_cron')
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_ANNEE', p_annee || ' : ' || v_nb_mois || ' mois, ' || v_nb_tickets || ' tickets, ' ||
    to_char(v_ca, 'FM9999999.99') || ' EUR', 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'annee', p_annee,
    'nb_mois', v_nb_mois, 'nb_tickets', v_nb_tickets, 'total_ca', v_ca, 'hash', v_hash);
END;
$function$
;
CREATE OR REPLACE FUNCTION public.run_cloture_annuelle_pour_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_target_year int;
  v_salon_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
  v_nb_ok int := 0; 
  v_nb_err int := 0;
BEGIN
  v_target_year := EXTRACT(YEAR FROM NOW())::int - 1;

  FOR v_salon_id IN 
    SELECT DISTINCT salon_id FROM clotures_mensuelles WHERE annee = v_target_year
  LOOP
    BEGIN
      v_one := public.cloturer_annee(v_salon_id, v_target_year);
      v_results := v_results || jsonb_build_object('salon_id', v_salon_id, 'result', v_one);
      v_nb_ok := v_nb_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_results := v_results || jsonb_build_object('salon_id', v_salon_id, 'error', SQLERRM);
      v_nb_err := v_nb_err + 1;
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'annee', v_target_year, 'nb_ok', v_nb_ok, 'nb_err', v_nb_err,
    'results', v_results
  );
END;
$function$
;
CREATE OR REPLACE FUNCTION public.cloturer_exercice(p_salon_id uuid, p_date_fin date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_mois int; v_siret text; v_existing uuid;
  v_prev_fin date; v_debut date; v_nb int; v_tk int; v_an int; v_ca numeric; v_ht numeric; v_ids uuid[];
  v_det jsonb := '{}'::jsonb; v_keys text[]; v_k text; v_s numeric;
  v_cp_ca numeric; v_cp_tk int; v_cp_at timestamptz; v_prev text; v_hash text; v_id uuid; v_d record; v_pca numeric; v_ptk int;
BEGIN
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM salons WHERE id = p_salon_id AND user_id = v_uid) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Vous ne gérez pas ce salon';
  END IF;
  SELECT exercice_fin_mois, siret INTO v_mois, v_siret FROM salons WHERE id = p_salon_id;
  IF v_mois IS NULL THEN RAISE EXCEPTION 'Salon introuvable'; END IF;
  IF p_date_fin IS NULL OR p_date_fin <> lx_fin_exercice(extract(year FROM p_date_fin)::int, v_mois) THEN
    RAISE EXCEPTION 'Date de fin d''exercice incohérente avec le réglage (fin du mois %)', v_mois;
  END IF;
  IF p_date_fin >= (now() AT TIME ZONE 'Europe/Paris')::date THEN
    RAISE EXCEPTION 'L''exercice n''est pas encore terminé';
  END IF;
  SELECT id INTO v_existing FROM clotures_exercices WHERE salon_id = p_salon_id AND date_fin = p_date_fin;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing); END IF;
  SELECT max(date_fin) INTO v_prev_fin FROM clotures_exercices WHERE salon_id = p_salon_id AND date_fin < p_date_fin;
  v_debut := coalesce(v_prev_fin + 1, (p_date_fin - interval '1 year' + interval '1 day')::date);
  SELECT count(*), coalesce(sum(nb_tickets),0), coalesce(sum(nb_annulations),0), round(coalesce(sum(total_ca),0),2), round(coalesce(sum(total_ht),0),2),
         array_agg(id ORDER BY date_cloture)
    INTO v_nb, v_tk, v_an, v_ca, v_ht, v_ids
  FROM clotures WHERE salon_id = p_salon_id AND date_cloture BETWEEN v_debut AND p_date_fin;
  IF coalesce(v_nb,0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'aucune clôture journalière sur l''exercice', 'debut', v_debut, 'fin', p_date_fin);
  END IF;
  v_keys := ARRAY(SELECT DISTINCT jsonb_object_keys(c.detail_paiements) FROM clotures c
                  WHERE c.salon_id = p_salon_id AND c.date_cloture BETWEEN v_debut AND p_date_fin
                    AND c.detail_paiements IS NOT NULL AND jsonb_typeof(c.detail_paiements) = 'object');
  IF v_keys IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_keys LOOP
      SELECT coalesce(sum(CASE WHEN jsonb_typeof(c.detail_paiements->v_k) = 'number' THEN (c.detail_paiements->>v_k)::numeric ELSE 0 END),0) INTO v_s
      FROM clotures c WHERE c.salon_id = p_salon_id AND c.date_cloture BETWEEN v_debut AND p_date_fin
        AND jsonb_typeof(c.detail_paiements) = 'object' AND c.detail_paiements ? v_k;
      v_det := v_det || jsonb_build_object(v_k, round(v_s,2));
    END LOOP;
  END IF;
  -- 2026-10-16 : Z annotées -> montants corrigés
  SELECT * INTO v_d FROM nf525_z_annotation_delta(p_salon_id, v_debut, p_date_fin);
  IF coalesce(v_d.d_ca,0) <> 0 OR coalesce(v_d.d_nb,0) <> 0 OR coalesce(v_d.d_ht,0) <> 0 THEN
    v_ca := round(v_ca + v_d.d_ca, 2); v_ht := round(v_ht + v_d.d_ht, 2); v_tk := v_tk + v_d.d_nb;
    FOR v_k IN SELECT jsonb_object_keys(v_d.d_det) LOOP
      v_det := v_det || jsonb_build_object(v_k, round(COALESCE((v_det->>v_k)::numeric, 0) + (v_d.d_det->>v_k)::numeric, 2));
    END LOOP;
  END IF;
  SELECT cumul_perpetuel_ca, cumul_perpetuel_tickets, created_at INTO v_cp_ca, v_cp_tk, v_cp_at
  FROM clotures WHERE salon_id = p_salon_id AND date_cloture BETWEEN v_debut AND p_date_fin
  ORDER BY date_cloture DESC, num DESC LIMIT 1;
  -- grand total : annotations (Z de l'exercice) créées après la dernière Z de l'exercice
  SELECT coalesce(sum(correct_total_ca - wrong_total_ca),0), coalesce(sum(correct_nb_tickets - wrong_nb_tickets),0) INTO v_pca, v_ptk
    FROM clotures_annotations WHERE salon_id = p_salon_id AND cloture_date <= p_date_fin AND created_at > v_cp_at;
  v_cp_ca := v_cp_ca + coalesce(v_pca,0); v_cp_tk := v_cp_tk + coalesce(v_ptk,0);
  SELECT hash INTO v_prev FROM clotures_exercices WHERE salon_id = p_salon_id ORDER BY date_fin DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    'ZE|' || v_debut || '|' || p_date_fin || '|' || to_char(v_ca, 'FM999999990.00') || '|' || v_tk || '|' ||
    coalesce(v_prev, '') || '|' || coalesce(v_siret, ''), 'sha256'), 'hex');
  INSERT INTO clotures_exercices (salon_id, date_debut, date_fin, nb_jours_clotures, nb_tickets, nb_annulations,
    total_ca, total_ht, total_tva, detail_paiements, cloture_ids, cumul_perpetuel_ca, cumul_perpetuel_tickets,
    hash, hash_algo, hash_prev, operator_name)
  VALUES (p_salon_id, v_debut, p_date_fin, v_nb, v_tk, v_an, v_ca, v_ht, v_ca - v_ht, v_det, v_ids, round(v_cp_ca,2), v_cp_tk,
    v_hash, 'SHA-256', v_prev, CASE WHEN v_uid IS NULL THEN 'auto_cron' ELSE 'utilisateur' END)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_EXERCICE', 'Exercice du ' || to_char(v_debut,'DD/MM/YYYY') || ' au ' || to_char(p_date_fin,'DD/MM/YYYY') || ' : ' ||
    v_nb || ' jours, ' || v_tk || ' tickets, ' || to_char(v_ca, 'FM999999990.00') || ' EUR', 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'debut', v_debut, 'fin', p_date_fin, 'nb_jours', v_nb,
    'nb_tickets', v_tk, 'total_ca', v_ca, 'hash', v_hash);
END $function$
;
CREATE OR REPLACE FUNCTION public.run_cloture_exercice_pour_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  r record; v_today date := (now() AT TIME ZONE 'Europe/Paris')::date; v_first date; v_y int; v_fin date;
  v_res jsonb := '[]'::jsonb; v_one jsonb;
BEGIN
  FOR r IN SELECT id, exercice_fin_mois FROM salons WHERE exercice_fin_mois <> 12 LOOP
    SELECT min(date_cloture) INTO v_first FROM clotures WHERE salon_id = r.id;
    IF v_first IS NULL THEN CONTINUE; END IF;
    FOR v_y IN extract(year FROM v_first)::int .. extract(year FROM v_today)::int LOOP
      v_fin := lx_fin_exercice(v_y, r.exercice_fin_mois);
      IF v_fin < v_first OR v_fin >= v_today THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM clotures_exercices WHERE salon_id = r.id AND date_fin = v_fin) THEN CONTINUE; END IF;
      BEGIN
        v_one := cloturer_exercice(r.id, v_fin);
        v_res := v_res || jsonb_build_object('salon_id', r.id, 'fin', v_fin, 'result', v_one);
      EXCEPTION WHEN OTHERS THEN
        v_res := v_res || jsonb_build_object('salon_id', r.id, 'fin', v_fin, 'error', SQLERRM);
      END;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', v_res);
END $function$
;
CREATE OR REPLACE FUNCTION public.lx_fin_exercice(p_annee integer, p_mois integer)
 RETURNS date
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT (make_date(p_annee, p_mois, 1) + interval '1 month' - interval '1 day')::date
$function$
;

do $$ begin
  if exists (select 1 from cron.job where jobname = 'cloture_mensuelle_auto') then perform cron.unschedule('cloture_mensuelle_auto'); end if;
  perform cron.schedule('cloture_mensuelle_auto', '15 3 1 * *', 'SELECT public.run_cloture_mensuelle_pour_tous();');
  if exists (select 1 from cron.job where jobname = 'cloture_annuelle_auto') then perform cron.unschedule('cloture_annuelle_auto'); end if;
  perform cron.schedule('cloture_annuelle_auto', '30 3 1 1 *', 'SELECT public.run_cloture_annuelle_pour_tous();');
end $$;
commit;
-- Contrôle : select md5(pg_get_functiondef('lx_prive.clotures_controle_journal()'::regprocedure)); -- 3688061418cabdbaa209134689196361
