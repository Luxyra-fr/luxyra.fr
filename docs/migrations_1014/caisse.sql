-- =====================================================================================================
-- Luxyra — migration « caisse » du 14/10/2026 (audit NF525, accord de l'éditeur du 14/10/2026)
-- Script IDEMPOTENT (CREATE OR REPLACE), à appliquer en UNE fois. NON APPLIQUÉ à la date de rédaction.
-- Aucune ligne existante n'est lue en écriture : ni ticket, ni clôture, ni correction, ni duplicata, ni JET.
-- Formats des données hachées / signées (tickets, clôtures, pièces de correction) : INCHANGÉS.
-- Registre : docs/registre-interventions-nf525.md, entrée du 2026-10-14 (audit caisse).
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1) corriger_reglement_rdv — correction du mode de règlement LE JOUR MÊME (avant clôture Z)
--    Définition actuelle reprise À L'IDENTIQUE, deux modifications seulement :
--    (a) la part payée EN LIGNE (acompte de l'ancien modèle, poste « enligne » du détail de paiement scellé) et la part
--        réglée par BON CADEAU (poste « bon ») restent sur leur poste : seul le SOLDE (prix − en ligne − bon) change de mode.
--        Avant : {mode: prix} -> la pièce de correction transférait aussi l'acompte en ligne vers espèces / CB, et le rendez-vous
--        recevait payments=[{prix}] alors que l'acompte restait compté à part -> double comptage dans la Z du jour.
--    (b) le rendez-vous (donnée de gestion) reçoit payments=[{solde}] (même règle que l'application).
--    La pièce reste une opération de « plus » et de « moins » (BOI-TVA-DECLA-30-10-30 §90), total = total du ticket.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.corriger_reglement_rdv(p_appt_id uuid, p_new_method text, p_operateur text DEFAULT NULL::text, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  a appointments%rowtype; v_old text; v_short text; v_tk_id uuid; v_motif text; v_res jsonb;
  v_dp jsonb; v_enligne numeric := 0; v_bon numeric := 0; v_solde numeric; v_apres jsonb; -- 2026-10-14 audit
begin
  select * into a from appointments where id = p_appt_id;
  if not found then raise exception 'RDV introuvable'; end if;
  if not exists (select 1 from salons s where s.id = a.salon_id and s.user_id = auth.uid()) then raise exception 'Accès refusé'; end if;
  if a.status not in ('done','paid') or coalesce(a.cancelled,false) then raise exception 'Ce ticket n''est pas encaissé.'; end if;
  if exists (select 1 from clotures where salon_id = a.salon_id and date_cloture = a.date_rdv) then
    raise exception 'Journée clôturée (Z) : utilisez « Corriger le moyen de paiement (pièce tracée) ».';
  end if;
  if a.payments is not null and jsonb_array_length(a.payments) > 1 then
    raise exception 'Règlement mixte : correction via avoir + ré-encaissement.';
  end if;
  if p_new_method not in ('Espèces','CB','Chèque','Virement') then raise exception 'Mode invalide : %', p_new_method; end if;
  v_old := a.mode_paiement;
  if v_old = p_new_method then return jsonb_build_object('ok', true, 'unchanged', true); end if;
  v_short := case p_new_method when 'Espèces' then 'esp' when 'CB' then 'cb' when 'Chèque' then 'chq' when 'Virement' then 'vir' end;

  select id, detail_paiement into v_tk_id, v_dp from tickets where salon_id = a.salon_id and raw_data->>'id' = p_appt_id::text and coalesce(is_avoir,false) = false limit 1;
  if v_tk_id is null then raise exception 'Ticket pas encore enregistré sur le serveur : réessayez dans un instant.'; end if;

  -- 2026-10-14 audit : parts « en ligne » et « bon cadeau » conservées sur leur poste (détail de paiement scellé du ticket)
  if v_dp is not null and jsonb_typeof(v_dp) = 'object' then
    if jsonb_typeof(v_dp->'enligne') = 'number' then v_enligne := round((v_dp->>'enligne')::numeric, 2); end if;
    if jsonb_typeof(v_dp->'bon') = 'number' then v_bon := round((v_dp->>'bon')::numeric, 2); end if;
  end if;
  v_solde := round(coalesce(a.prix,0) - v_enligne - v_bon, 2);
  if v_solde <= 0 then raise exception 'Rien à corriger : le ticket est réglé en ligne / par bon cadeau.'; end if;
  v_apres := jsonb_build_object(v_short, v_solde);
  if v_enligne <> 0 then v_apres := v_apres || jsonb_build_object('enligne', v_enligne); end if;
  if v_bon <> 0 then v_apres := v_apres || jsonb_build_object('bon', v_bon); end if;

  v_motif := coalesce(nullif(btrim(coalesce(p_motif,'')), ''), 'Correction du mode de règlement le jour même, avant clôture');
  if length(v_motif) < 5 then v_motif := 'Correction du mode de règlement : ' || v_motif; end if;
  perform set_config('luxyra.corr_avant_cloture', 'on', true);
  v_res := public.corriger_reglement(v_tk_id, v_apres, v_motif, coalesce(p_operateur,'caisse'));
  perform set_config('luxyra.corr_avant_cloture', 'off', true);

  -- donnée de gestion (rendez-vous) : reflète le mode réellement encaissé pour la caisse du jour
  perform set_config('luxyra.allow_nf525_unlock', 'true', true);
  update appointments set mode_paiement = p_new_method,
         payments = jsonb_build_array(jsonb_build_object('amount', v_solde, 'method', p_new_method))
   where id = p_appt_id;
  perform set_config('luxyra.allow_nf525_unlock', 'false', true);

  return jsonb_build_object('ok', true, 'old', v_old, 'new', p_new_method, 'piece', v_res->'num', 'nf525_maj', false, 'solde', v_solde, 'enligne', v_enligne);
end $function$;
-- droits inchangés (identiques à la définition actuelle)
REVOKE ALL ON FUNCTION public.corriger_reglement_rdv(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.corriger_reglement_rdv(uuid, text, text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 2) recrediter_bon_cadeau — opération INVERSE de consommer_bon_cadeau (donnée de gestion, hors fiscal)
--    Utilisée par l'application (a) quand un ticket ayant utilisé un bon cadeau est ANNULÉ (contre-ticket scellé), (b) quand
--    un encaissement est interrompu après le débit d'un bon (autre bon refusé). Même contrôles d'accès que la consommation.
--    Ne recrédite jamais plus que le montant déjà utilisé ; un bon annulé (voided) n'est jamais recrédité. Historique tracé
--    (montant négatif + motif) et journal d'audit BON_CADEAU_RECREDIT.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.recrediter_bon_cadeau(p_bon_id uuid, p_montant numeric, p_ticket text DEFAULT NULL::text, p_motif text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bon record; v_uid uuid; v_reste numeric; v_util numeric; v_hist jsonb;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant invalide');
  END IF;
  SELECT * INTO v_bon FROM cartes_cadeaux WHERE id = p_bon_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Bon cadeau introuvable'); END IF;
  v_uid := auth.uid();
  IF v_uid IS NULL OR NOT (EXISTS (SELECT 1 FROM salons s WHERE s.id = v_bon.salon_id AND s.user_id = v_uid) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Acces refuse');
  END IF;
  IF coalesce(v_bon.status,'') = 'voided' THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Ce bon a ete annule'); END IF;
  IF coalesce(v_bon.utilise,0) + 0.004 < p_montant THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant superieur au montant utilise (' || coalesce(v_bon.utilise,0)::text || ' EUR)');
  END IF;
  v_reste := round(coalesce(v_bon.restant,0) + p_montant, 2);
  v_util  := greatest(0, round(coalesce(v_bon.utilise,0) - p_montant, 2));
  v_hist  := coalesce(v_bon.history, '[]'::jsonb) || jsonb_build_object(
               'date', to_char(now() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD'),
               'time', to_char(now() AT TIME ZONE 'Europe/Paris','HH24:MI'),
               'amount', -p_montant, 'tkNum', coalesce(p_ticket,''), 'motif', left(coalesce(p_motif,'recredit'),200));
  UPDATE cartes_cadeaux
     SET restant = v_reste, utilise = v_util,
         status  = CASE WHEN status = 'used' AND v_reste > 0 THEN 'active' ELSE status END,
         history = v_hist
   WHERE id = p_bon_id;
  INSERT INTO audit_log(salon_id, action, details, operator_name)
  VALUES (v_bon.salon_id, 'BON_CADEAU_RECREDIT', 'Bon ' || coalesce(v_bon.code,'?') || ' recrédité de ' || p_montant || ' EUR (ticket ' || coalesce(p_ticket,'') || ') — ' || left(coalesce(p_motif,''),200), NULL);
  RETURN jsonb_build_object('ok', true, 'restant', v_reste, 'utilise', v_util,
                            'status', CASE WHEN v_bon.status = 'used' AND v_reste > 0 THEN 'active' ELSE v_bon.status END);
END;
$function$;
REVOKE ALL ON FUNCTION public.recrediter_bon_cadeau(uuid, numeric, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recrediter_bon_cadeau(uuid, numeric, text, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- 3) nf525_duplicata_z — enregistrement d'un DUPLICATA de clôture Z AVANT sa réimpression
--    Inscrit l'événement au journal d'audit (action DUPLICATA_CLOTURE_Z, déjà associée au code JET 901 par nf525_jet_code :
--    il est donc reporté au JET par le déclencheur existant) et renvoie le n° de copie de cette Z. Aucune table nouvelle,
--    aucune donnée existante modifiée. Verrou consultatif par établissement : numéros de copie sans doublon.
-- -----------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.nf525_duplicata_z(p_salon uuid, p_cloture_num integer, p_date date DEFAULT NULL::date, p_operateur text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare c record; v_copie int; v_motif text;
begin
  if not exists (select 1 from public.salons where id = p_salon and user_id = auth.uid()) then raise exception 'Accès refusé'; end if;
  select id, num, date_cloture into c from public.clotures where salon_id = p_salon and num = p_cloture_num limit 1;
  if c.id is null then raise exception 'Clôture Z introuvable'; end if;
  if p_date is not null and c.date_cloture is distinct from p_date then raise exception 'Clôture Z incohérente (date)'; end if;
  perform pg_advisory_xact_lock(hashtext('nf525_dupz_' || p_salon::text));
  v_motif := 'Duplicata clôture Z #' || c.num || ' du ' || to_char(c.date_cloture,'YYYY-MM-DD');
  select count(*) + 1 into v_copie from public.audit_log
   where salon_id = p_salon and action = 'DUPLICATA_CLOTURE_Z' and details like v_motif || '%';
  insert into public.audit_log(salon_id, action, details, operator_name)
  values (p_salon, 'DUPLICATA_CLOTURE_Z', v_motif || ' (copie n°' || v_copie || ')', left(p_operateur,120));
  return jsonb_build_object('copie', v_copie, 'cloture_num', c.num, 'horodatage', now());
end $function$;
REVOKE ALL ON FUNCTION public.nf525_duplicata_z(uuid, integer, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nf525_duplicata_z(uuid, integer, date, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------------------------------
-- Contrôles après application (lecture seule)
-- -----------------------------------------------------------------------------------------------------
-- select proname, proacl from pg_proc where proname in ('corriger_reglement_rdv','recrediter_bon_cadeau','nf525_duplicata_z');
-- select public.nf525_jet_code('DUPLICATA_CLOTURE_Z');  -- attendu : 901
-- Essai en transaction annulée sur le Salon Démo (BEGIN ... ROLLBACK) : correction le jour même d'un ticket avec acompte en
-- ligne (ancien modèle) -> pièce {cb:-solde, esp:+solde}, poste « enligne » inchangé.
