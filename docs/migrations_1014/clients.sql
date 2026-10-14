-- ============================================================================
-- Audit 14/10/2026 — domaine « clients » (branche fix1014-clients)
-- Fichier IDEMPOTENT : peut être rejoué sans effet de bord.
-- À appliquer AVANT la mise en ligne de l'app (app.html / luxyra-supabase.js) et du worker de cette branche.
-- Aucune donnée de caisse (tickets scellés, NF525) n'est modifiée par ce fichier.
--
-- Sommaire
--   1. Effacement RGPD = anonymisation sur place (rgpd_delete_client_atomic) + verrou anti-réécriture
--   2. Fusion de doublons : fiche technique, liens famille, questionnaire santé conservés (merge_client_duplicates)
--   3. Bons cadeaux : jamais utilisables tant que le paiement en ligne n'est pas confirmé + code unique par salon
--   4. Packs : décompte atomique d'une séance au paiement (lx_pack_consommer)
--   5. SMS : file d'envoi fiable (traiter_sms_differes), campagnes en file, anniversaires / relances côté serveur
-- ============================================================================


-- ============================================================================
-- 1. EFFACEMENT RGPD = ANONYMISATION SUR PLACE
-- Constat : DELETE FROM clients -> la clé étrangère tickets.client_id (ON DELETE SET NULL) modifie les tickets,
-- ce que ticket_nf525_update_trg refuse pour un ticket d'une journée clôturée -> effacement impossible.
-- Désormais la fiche garde son identifiant (les tickets pointent vers une fiche anonyme) et tout ce qui
-- identifie la personne est effacé : identité, contact, adresse, notes, fiche technique (photos comprises),
-- questionnaire santé, liens famille, commentaires / adresse des RDV, réservations en ligne, fidélité.
-- ============================================================================

ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS rgpd_anonymise_le timestamptz;
COMMENT ON COLUMN public.clients.rgpd_anonymise_le IS
  'Date de l''anonymisation RGPD (droit à l''effacement). Fiche conservée vide pour les tickets fiscaux ; masquée dans l''app.';

-- Verrou : une fiche anonymisée ne peut plus être réécrite (un appareil resté hors ligne qui renverrait
-- l'ancienne fiche par upsert ne doit pas faire revenir les données). La mise à jour est ignorée sans erreur.
CREATE OR REPLACE FUNCTION lx_prive.clients_rgpd_verrou()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF OLD.rgpd_anonymise_le IS NOT NULL THEN
    RETURN OLD;   -- fiche anonymisée : rien ne change
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS zz_clients_rgpd_verrou ON public.clients;
CREATE TRIGGER zz_clients_rgpd_verrou BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION lx_prive.clients_rgpd_verrou();

CREATE OR REPLACE FUNCTION public.rgpd_delete_client_atomic(p_client_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid;
  v_client clients%ROWTYPE;
  v_email text;
  v_tel9 text;
  v_nom text;
  v_photos jsonb := '[]'::jsonb;
  v_nb_appointments int := 0;
  v_nb_fidelite int := 0;
  v_nb_rdv_online int := 0;
BEGIN
  v_user_id := auth.uid();

  -- Charge le client (verrouillé le temps de l'opération)
  SELECT * INTO v_client FROM clients WHERE id = p_client_id FOR UPDATE;
  IF v_client.id IS NULL THEN
    RAISE EXCEPTION 'Client introuvable: %', p_client_id;
  END IF;

  -- Vérifie que le caller gère bien ce salon (sauf service_role qui bypass)
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = v_client.salon_id AND user_id = v_user_id) THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;

  -- Déjà anonymisée : rien à refaire (rejouable)
  IF v_client.rgpd_anonymise_le IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'client_id', p_client_id, 'deja_anonymise', true, 'photos', '[]'::jsonb);
  END IF;

  v_email := lower(trim(COALESCE(v_client.email, '')));
  v_tel9  := right(regexp_replace(COALESCE(v_client.telephone, ''), '[^0-9]', '', 'g'), 9);
  v_nom   := trim(COALESCE(v_client.prenom, '') || ' ' || COALESCE(v_client.nom, ''));

  -- Chemins des photos (bucket client-photos) : renvoyés à l'app qui supprime les fichiers
  -- (le stockage Supabase ne se supprime pas en SQL).
  IF jsonb_typeof(v_client.fiche_tech -> 'photos') = 'array' THEN
    SELECT COALESCE(jsonb_agg(p ->> 'path') FILTER (WHERE COALESCE(p ->> 'path', '') <> ''), '[]'::jsonb)
      INTO v_photos
      FROM jsonb_array_elements(v_client.fiche_tech -> 'photos') p;
  END IF;

  -- 1. Rendez-vous : le lien vers la fiche (anonyme) reste ; commentaire, e-mail et adresse effacés.
  --    (champs hors périmètre NF525 : appointments_nf525_protect ne les bloque pas)
  BEGIN
    UPDATE appointments
       SET comment = '', client_email = NULL, adresse_domicile = NULL
     WHERE client_id = p_client_id
       AND (COALESCE(comment, '') <> '' OR client_email IS NOT NULL OR adresse_domicile IS NOT NULL);
    GET DIAGNOSTICS v_nb_appointments = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_nb_appointments := -1; END;

  -- 2. Fidélité de CE salon (clé = id du compte Luxyra, e-mail ou id de fiche selon l'historique)
  BEGIN
    DELETE FROM fidelite_client
     WHERE salon_id = v_client.salon_id
       AND client_luxyra_id IN (NULLIF(v_email, ''), p_client_id::text, v_client.client_luxyra_id::text);
    GET DIAGNOSTICS v_nb_fidelite = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_nb_fidelite := -1; END;

  -- 3. Réservations en ligne de ce salon (par e-mail ou par compte Luxyra)
  BEGIN
    UPDATE rdv_online
       SET client_nom = 'Anonyme', client_prenom = '', client_tel = '', client_email = '',
           message = NULL, client_adresse = NULL, client_adresse_cp = NULL, client_adresse_ville = NULL,
           adresse_complement = NULL, client_lat = NULL, client_lng = NULL
     WHERE salon_id = v_client.salon_id
       AND ((v_email <> '' AND lower(trim(client_email)) = v_email)
            OR (v_client.client_luxyra_id IS NOT NULL AND client_luxyra_id = v_client.client_luxyra_id));
    GET DIAGNOSTICS v_nb_rdv_online = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN v_nb_rdv_online := -1; END;

  -- 4. Questionnaire santé, doublons ignorés, lien compte <-> salon (notes / fiche du salon)
  DELETE FROM clients_sante WHERE client_id = p_client_id;
  BEGIN DELETE FROM client_duplicate_ignored WHERE client_a_id = p_client_id OR client_b_id = p_client_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  IF v_client.client_luxyra_id IS NOT NULL THEN
    BEGIN DELETE FROM client_salon WHERE salon_id = v_client.salon_id AND client_id = v_client.client_luxyra_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- 5. Noms recopiés ailleurs (tickets en attente, packs, cartes, devis) ; jamais les tickets scellés
  BEGIN UPDATE tickets_attente SET client_nom = 'Anonyme', client_prenom = NULL WHERE client_id = p_client_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN UPDATE packs_clients SET client_nom = 'Anonyme' WHERE client_id = p_client_id::text; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN UPDATE cartes_abo_clients SET client_nom = 'Anonyme', client_luxyra_id = NULL WHERE client_id = p_client_id::text; EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN UPDATE devis SET client_nom = 'Anonyme', client_prenom = NULL, client_tel = NULL, client_email = NULL WHERE client_id = p_client_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  -- SMS encore en attente pour ce numéro : ils ne partiront pas
  IF length(v_tel9) = 9 THEN
    BEGIN
      UPDATE sms_differes SET statut = 'obsolete', traite_le = clock_timestamp(), motif = 'Client anonymisé (RGPD)'
       WHERE salon_id = v_client.salon_id AND statut = 'en_attente'
         AND right(regexp_replace(COALESCE(telephone, ''), '[^0-9]', '', 'g'), 9) = v_tel9;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  IF v_nom <> '' THEN
    BEGIN UPDATE messaging_log SET client_nom = NULL WHERE salon_id = v_client.salon_id AND client_nom = v_nom; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;

  -- 6. Les autres fiches ne référencent plus celle-ci comme membre de famille
  BEGIN
    UPDATE clients SET famille_ids = famille_ids - p_client_id::text
     WHERE salon_id = v_client.salon_id AND id <> p_client_id AND famille_ids ? p_client_id::text;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 7. La fiche elle-même : vidée, gardée (même id) pour les tickets fiscaux
  UPDATE clients SET
    nom = 'Client anonymisé', prenom = '', sexe = NULL,
    telephone = '', telephone2 = '', email = NULL,
    adresse = '', cp = '', ville = '', date_naissance = '', notes = '',
    nature_cheveux = '', type_cheveux = '', details_cheveux = '',
    fiches = '[]'::jsonb, fiche_tech = '{}'::jsonb, famille_ids = '[]'::jsonb,
    client_luxyra_id = NULL, user_id = NULL,
    acquisition_source = NULL, acquisition_parrain = NULL, collab_pref = NULL,
    sms_ok = false, email_ok = false, actif = false, points_fidelite = 0,
    rgpd_anonymise_le = now()
  WHERE id = p_client_id;

  -- 8. Trace (identifiant seulement : aucune donnée personnelle dans le journal)
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (
    v_client.salon_id,
    'RGPD_EFFACEMENT',
    'Client ID:' || p_client_id::text || ' anonymisé (droit à l''effacement). ' ||
      'Tickets fiscaux conservés et rattachés à la fiche anonyme (NF525). ' ||
      'RDV nettoyés (' || v_nb_appointments || '), fidélité (' || v_nb_fidelite || '), ' ||
      'réservations en ligne (' || v_nb_rdv_online || '), photos (' || jsonb_array_length(v_photos) || ').',
    'rgpd_atomic'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'client_id', p_client_id,
    'anonymise', true,
    'appointments_anonymized', v_nb_appointments,
    'fidelite_deleted', v_nb_fidelite,
    'rdv_online_anonymized', v_nb_rdv_online,
    'photos', v_photos,
    'tickets_note', 'Conservés conformément NF525 (6 ans), rattachés à une fiche anonyme.'
  );
END;
$function$;


-- ============================================================================
-- 2. FUSION DE DOUBLONS : fiche technique, liens famille et questionnaire santé de la fiche retirée
--    n'étaient pas repris. Recréée à l'identique sauf : refus si une fiche est anonymisée ; fusion de
--    fiche_tech (listes concaténées, soldes cagnotte / CA additionnés, le reste complété si vide) ;
--    famille_ids réunis (et les autres fiches pointent vers la fiche gardée) ; questionnaire santé fusionné.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.merge_client_duplicates(p_keep_id uuid, p_remove_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_user_id uuid := auth.uid();
  k clients%ROWTYPE; r clients%ROWTYPE;
  v_app int := 0; v_tk int := 0; v_app_reste int := 0; v_tk_reste int := 0;
  v_att int := 0; v_dev int := 0; v_mig int := 0; v_cab int := 0; v_sante int := 0;
  x record; v_garde boolean := false;
  v_ft jsonb; v_cle text; v_fam jsonb; sk record; sr record;
BEGIN
  SELECT * INTO k FROM clients WHERE id = p_keep_id;
  SELECT * INTO r FROM clients WHERE id = p_remove_id;
  IF k.id IS NULL THEN RAISE EXCEPTION 'Client à garder introuvable'; END IF;
  IF r.id IS NULL THEN RAISE EXCEPTION 'Client à supprimer introuvable'; END IF;
  IF p_keep_id = p_remove_id THEN RAISE EXCEPTION 'Même fiche'; END IF;
  IF k.salon_id <> r.salon_id THEN RAISE EXCEPTION 'Les 2 fiches doivent être du même salon'; END IF;
  IF k.fusionne_dans IS NOT NULL THEN RAISE EXCEPTION 'La fiche à garder a déjà été fusionnée'; END IF;
  -- 2026-10-14 audit : une fiche anonymisée (RGPD) ne se fusionne pas
  IF k.rgpd_anonymise_le IS NOT NULL OR r.rgpd_anonymise_le IS NOT NULL THEN RAISE EXCEPTION 'Fiche anonymisée (RGPD) : fusion impossible'; END IF;
  IF v_user_id IS NOT NULL AND NOT public.is_admin() THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = k.salon_id AND user_id = v_user_id) THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;

  -- RDV : ligne par ligne (les RDV encaissés et clôturés restent sur l'ancienne fiche, intacts)
  FOR x IN SELECT id FROM appointments WHERE client_id = p_remove_id LOOP
    BEGIN UPDATE appointments SET client_id = p_keep_id WHERE id = x.id; v_app := v_app + 1;
    EXCEPTION WHEN OTHERS THEN v_app_reste := v_app_reste + 1; END;
  END LOOP;
  -- Tickets : idem (un ticket d'une journée clôturée ne bouge jamais)
  FOR x IN SELECT id FROM tickets WHERE client_id::text = p_remove_id::text LOOP
    BEGIN UPDATE tickets SET client_id = p_keep_id WHERE id = x.id; v_tk := v_tk + 1;
    EXCEPTION WHEN OTHERS THEN v_tk_reste := v_tk_reste + 1; END;
  END LOOP;
  BEGIN UPDATE tickets_attente SET client_id = p_keep_id WHERE client_id = p_remove_id; GET DIAGNOSTICS v_att = ROW_COUNT; EXCEPTION WHEN OTHERS THEN v_att := -1; END;
  BEGIN UPDATE devis SET client_id = p_keep_id WHERE client_id = p_remove_id; GET DIAGNOSTICS v_dev = ROW_COUNT; EXCEPTION WHEN OTHERS THEN v_dev := -1; END;
  BEGIN UPDATE migrated_invoices SET client_id = p_keep_id WHERE client_id = p_remove_id; GET DIAGNOSTICS v_mig = ROW_COUNT; EXCEPTION WHEN OTHERS THEN v_mig := -1; END;
  BEGIN UPDATE cartes_abo_clients SET client_id = p_keep_id WHERE client_id = p_remove_id; GET DIAGNOSTICS v_cab = ROW_COUNT; EXCEPTION WHEN OTHERS THEN v_cab := -1; END;
  BEGIN UPDATE packs_clients SET client_id = p_keep_id WHERE client_id = p_remove_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  -- 2026-10-14 audit : questionnaire santé — déplacé si la fiche gardée n'en a pas, sinon FUSIONNÉ
  -- (allergies / contre-indications réunies, réponses de la fiche gardée prioritaires), puis l'autre supprimé.
  BEGIN
    SELECT * INTO sk FROM clients_sante WHERE client_id = p_keep_id;
    SELECT * INTO sr FROM clients_sante WHERE client_id = p_remove_id;
    IF sr.client_id IS NOT NULL THEN
      IF sk.client_id IS NULL THEN
        UPDATE clients_sante SET client_id = p_keep_id WHERE client_id = p_remove_id; GET DIAGNOSTICS v_sante = ROW_COUNT;
      ELSE
        UPDATE clients_sante SET
          donnees = (COALESCE(sr.donnees, '{}'::jsonb) || COALESCE(sk.donnees, '{}'::jsonb))
                    || jsonb_build_object(
                         'allergies',  (SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM (
                                          SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(sk.donnees->'allergies')='array' THEN sk.donnees->'allergies' ELSE '[]'::jsonb END) v
                                          UNION SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(sr.donnees->'allergies')='array' THEN sr.donnees->'allergies' ELSE '[]'::jsonb END)) a),
                         'conditions', (SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) FROM (
                                          SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(sk.donnees->'conditions')='array' THEN sk.donnees->'conditions' ELSE '[]'::jsonb END) v
                                          UNION SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(sr.donnees->'conditions')='array' THEN sr.donnees->'conditions' ELSE '[]'::jsonb END)) c)),
          updated_at = now()
        WHERE client_id = p_keep_id;
        DELETE FROM clients_sante WHERE client_id = p_remove_id;
        v_sante := 1;
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  BEGIN DELETE FROM client_duplicate_ignored WHERE client_a_id = p_remove_id OR client_b_id = p_remove_id; EXCEPTION WHEN OTHERS THEN NULL; END;

  -- 2026-10-14 audit : fiche technique fusionnée (clés de la fiche gardée prioritaires, complétées par l'autre)
  v_ft := COALESCE(r.fiche_tech, '{}'::jsonb) || COALESCE(k.fiche_tech, '{}'::jsonb);
  FOREACH v_cle IN ARRAY ARRAY['photos','formules','histoMetier','relances'] LOOP
    IF jsonb_typeof(k.fiche_tech -> v_cle) = 'array' AND jsonb_typeof(r.fiche_tech -> v_cle) = 'array' THEN
      v_ft := v_ft || jsonb_build_object(v_cle, (k.fiche_tech -> v_cle) || (r.fiche_tech -> v_cle));
    END IF;
  END LOOP;
  FOREACH v_cle IN ARRAY ARRAY['cagnotte','caTotal'] LOOP
    IF jsonb_typeof(k.fiche_tech -> v_cle) = 'number' AND jsonb_typeof(r.fiche_tech -> v_cle) = 'number' THEN
      v_ft := v_ft || jsonb_build_object(v_cle, round(((k.fiche_tech ->> v_cle)::numeric + (r.fiche_tech ->> v_cle)::numeric), 2));
    END IF;
  END LOOP;
  -- liens famille réunis (sans les deux fiches elles-mêmes)
  SELECT COALESCE(jsonb_agg(DISTINCT v), '[]'::jsonb) INTO v_fam FROM (
    SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(k.famille_ids)='array' THEN k.famille_ids ELSE '[]'::jsonb END) v
    UNION SELECT jsonb_array_elements(CASE WHEN jsonb_typeof(r.famille_ids)='array' THEN r.famille_ids ELSE '[]'::jsonb END)
  ) f WHERE v NOT IN (to_jsonb(p_keep_id::text), to_jsonb(p_remove_id::text));

  -- Données : la fiche gardée garde les siennes, complétées par l'autre si vides
  UPDATE clients SET
    telephone = CASE WHEN coalesce(telephone,'') = '' THEN r.telephone ELSE telephone END,
    telephone2 = CASE WHEN coalesce(telephone2,'') = '' THEN coalesce(nullif(r.telephone2,''), CASE WHEN coalesce(r.telephone,'') <> '' AND r.telephone <> telephone THEN r.telephone END) ELSE telephone2 END,
    email = CASE WHEN coalesce(email,'') = '' THEN r.email ELSE email END,
    client_luxyra_id = coalesce(client_luxyra_id, r.client_luxyra_id),
    adresse = CASE WHEN coalesce(adresse,'') = '' THEN r.adresse ELSE adresse END,
    cp = CASE WHEN coalesce(adresse,'') = '' THEN r.cp ELSE cp END,
    ville = CASE WHEN coalesce(adresse,'') = '' THEN r.ville ELSE ville END,
    date_naissance = CASE WHEN coalesce(date_naissance,'') = '' THEN r.date_naissance ELSE date_naissance END,
    notes = CASE WHEN coalesce(r.notes,'') = '' THEN notes
                 ELSE coalesce(nullif(notes,'') || E'\n--- Fusion ' || now()::date || E' ---\n', '') || r.notes END,
    fiches = CASE WHEN r.fiches IS NOT NULL AND jsonb_typeof(r.fiches) = 'array' AND jsonb_array_length(r.fiches) > 0
                  THEN coalesce(fiches, '[]'::jsonb) || r.fiches ELSE fiches END,
    fiche_tech = v_ft,
    famille_ids = v_fam,
    points_fidelite = coalesce(points_fidelite,0) + coalesce(r.points_fidelite,0)
  WHERE id = p_keep_id;
  -- les autres fiches liées à la fiche retirée sont liées à la fiche gardée
  BEGIN
    UPDATE clients SET famille_ids = CASE WHEN famille_ids ? p_keep_id::text THEN famille_ids - p_remove_id::text
                                          ELSE (famille_ids - p_remove_id::text) || to_jsonb(p_keep_id::text) END
     WHERE salon_id = k.salon_id AND id NOT IN (p_keep_id, p_remove_id) AND famille_ids ? p_remove_id::text;
  EXCEPTION WHEN OTHERS THEN NULL; END;

  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (k.salon_id, 'CLIENT_MERGED',
    'Fusion client ' || r.nom || ' ' || coalesce(r.prenom,'') || ' (' || p_remove_id::text || ') → ' || k.nom || ' ' || coalesce(k.prenom,'') || ' (' || p_keep_id::text || ')'
    || CASE WHEN v_tk_reste + v_app_reste > 0 THEN ' — ' || v_tk_reste || ' ticket(s) et ' || v_app_reste || ' RDV clôturés restent sur l''ancienne fiche (caisse inaltérable), regroupés à l''affichage' ELSE '' END,
    'admin_merge');

  -- Plus rien ne la référence -> suppression ; sinon fiche « fusionnée », cachée
  IF v_tk_reste + v_app_reste = 0 THEN
    BEGIN DELETE FROM clients WHERE id = p_remove_id;
    EXCEPTION WHEN OTHERS THEN v_garde := true; END;
  ELSE v_garde := true; END IF;
  IF v_garde THEN
    UPDATE clients SET fusionne_dans = p_keep_id, actif = false, points_fidelite = 0,
           email = NULL, client_luxyra_id = NULL
     WHERE id = p_remove_id;
    -- les fiches déjà fusionnées dans celle-ci pointent maintenant vers la fiche gardée
    UPDATE clients SET fusionne_dans = p_keep_id WHERE fusionne_dans = p_remove_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'kept_id', p_keep_id, 'removed_id', p_remove_id, 'fiche_conservee_cachee', v_garde,
    'appointments_moved', v_app, 'appointments_restants', v_app_reste, 'tickets_moved', v_tk, 'tickets_restants', v_tk_reste,
    'tickets_attente_moved', v_att, 'devis_moved', v_dev, 'migrated_invoices_moved', v_mig, 'cartes_abo_moved', v_cab,
    'sante_fusionnee', v_sante);
END;
$function$;


-- ============================================================================
-- 3. BONS CADEAUX
-- Un bon acheté en ligne est créé « active » avec payment_status = 'pending' tant que Stripe n'a pas confirmé :
-- il ne doit JAMAIS être utilisable avant confirmation. Recréée à l'identique + contrôle payment_status.
-- ============================================================================
CREATE OR REPLACE FUNCTION public.consommer_bon_cadeau(p_bon_id uuid, p_montant numeric, p_ticket text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bon   record;
  v_uid   uuid;
  v_reste numeric;
  v_hist  jsonb;
BEGIN
  IF p_montant IS NULL OR p_montant <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Montant invalide');
  END IF;

  SELECT * INTO v_bon FROM cartes_cadeaux WHERE id = p_bon_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Bon cadeau introuvable');
  END IF;

  v_uid := auth.uid();
  IF v_uid IS NOT NULL
     AND NOT (EXISTS (SELECT 1 FROM salons s WHERE s.id = v_bon.salon_id AND s.user_id = v_uid)
              OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Acces refuse');
  END IF;

  -- 2026-10-14 audit : paiement en ligne non confirmé -> bon inutilisable
  IF v_bon.payment_status IS NOT NULL AND v_bon.payment_status <> 'paid' THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Paiement en ligne de ce bon non confirme');
  END IF;
  IF coalesce(v_bon.status,'') = 'voided' THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Ce bon a ete annule');
  END IF;
  IF v_bon.date_expiration IS NOT NULL AND v_bon.date_expiration < current_date THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Ce bon est expire');
  END IF;
  IF coalesce(v_bon.restant,0) < p_montant THEN
    RETURN jsonb_build_object('ok', false, 'erreur',
      'Solde insuffisant : ' || coalesce(v_bon.restant,0)::text || ' EUR disponibles',
      'restant', coalesce(v_bon.restant,0));
  END IF;

  v_reste := coalesce(v_bon.restant,0) - p_montant;
  v_hist  := coalesce(v_bon.history, '[]'::jsonb) || jsonb_build_object(
               'date', to_char(now() AT TIME ZONE 'Europe/Paris','YYYY-MM-DD'),
               'time', to_char(now() AT TIME ZONE 'Europe/Paris','HH24:MI'),
               'amount', p_montant,
               'tkNum', coalesce(p_ticket,'')
             );

  UPDATE cartes_cadeaux
     SET restant = v_reste,
         utilise = coalesce(utilise,0) + p_montant,
         status  = CASE WHEN v_reste <= 0 THEN 'used' ELSE status END,
         history = v_hist
   WHERE id = p_bon_id;

  RETURN jsonb_build_object('ok', true, 'restant', v_reste,
                            'utilise', coalesce(v_bon.utilise,0) + p_montant,
                            'status', CASE WHEN v_reste <= 0 THEN 'used' ELSE v_bon.status END);
END;
$function$;

-- Code unique par salon (insensible à la casse, comme la recherche en caisse).
-- Vérifié le 14/10/2026 : aucun doublon (SELECT salon_id, upper(code) ... HAVING count(*) > 1 -> 0 ligne).
-- Par sécurité, l'index n'est créé que s'il n'existe toujours aucun doublon au moment de l'application.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cartes_cadeaux WHERE code IS NOT NULL
              GROUP BY salon_id, upper(code) HAVING count(*) > 1) THEN
    RAISE NOTICE 'cartes_cadeaux : codes en double, index unique NON créé (à traiter à la main)';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS cartes_cadeaux_salon_code_unique
      ON public.cartes_cadeaux (salon_id, upper(code)) WHERE code IS NOT NULL;
  END IF;
END $$;


-- ============================================================================
-- 4. PACKS : une séance n'est décomptée qu'au PAIEMENT du ticket (avant : dès l'ajout de la ligne),
--    de façon atomique (jamais au-delà du total, jamais un pack expiré ou non actif).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.lx_pack_consommer(p_pack_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v record; v_uid uuid := auth.uid();
  v_jour date := (now() AT TIME ZONE 'Europe/Paris')::date;
  v_util int; v_status text;
BEGIN
  SELECT * INTO v FROM packs_clients WHERE id = p_pack_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'erreur', 'Pack introuvable'); END IF;
  IF v_uid IS NOT NULL
     AND NOT (EXISTS (SELECT 1 FROM salons s WHERE s.id = v.salon_id AND s.user_id = v_uid) OR public.is_admin()) THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Accès refusé');
  END IF;
  IF coalesce(v.status, 'active') <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Pack non actif (' || coalesce(v.status, '?') || ')');
  END IF;
  IF v.date_expiration IS NOT NULL AND v.date_expiration < v_jour THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Pack expiré le ' || to_char(v.date_expiration, 'DD/MM/YYYY'));
  END IF;
  IF coalesce(v.seances_utilisees, 0) >= coalesce(v.total_seances, 0) THEN
    RETURN jsonb_build_object('ok', false, 'erreur', 'Toutes les séances ont déjà été utilisées');
  END IF;
  UPDATE packs_clients
     SET seances_utilisees = coalesce(seances_utilisees, 0) + 1,
         status = CASE WHEN coalesce(seances_utilisees, 0) + 1 >= coalesce(total_seances, 0) THEN 'completed' ELSE status END
   WHERE id = p_pack_id
   RETURNING seances_utilisees, status INTO v_util, v_status;
  RETURN jsonb_build_object('ok', true, 'utilisees', v_util, 'total', v.total_seances, 'status', v_status);
END;
$function$;
REVOKE ALL ON FUNCTION public.lx_pack_consommer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lx_pack_consommer(uuid) TO authenticated, service_role;


-- ============================================================================
-- 5. SMS
-- 5a. File sms_differes : colonnes de suivi
--     client_id      : fiche concernée (consentement revérifié au moment de l'envoi)
--     net_request_id : requête pg_net de l'envoi -> statut « envoye » seulement après réponse OK du worker
--     ml_id          : ligne messaging_log réservée (anti-doublon), libérée si l'envoi échoue
--     essais / envoi_le
--     Statuts : en_attente -> envoi -> envoye | en_attente (nouvel essai) | echec | obsolete
-- ============================================================================
ALTER TABLE public.sms_differes ADD COLUMN IF NOT EXISTS client_id uuid;
ALTER TABLE public.sms_differes ADD COLUMN IF NOT EXISTS net_request_id bigint;
ALTER TABLE public.sms_differes ADD COLUMN IF NOT EXISTS ml_id bigint;
ALTER TABLE public.sms_differes ADD COLUMN IF NOT EXISTS essais int NOT NULL DEFAULT 0;
ALTER TABLE public.sms_differes ADD COLUMN IF NOT EXISTS envoi_le timestamptz;
CREATE INDEX IF NOT EXISTS idx_sms_differes_envoi ON public.sms_differes (salon_id) WHERE statut = 'envoi';

-- 5b. Anti-doublon messaging_log : + campagnes (« marketing »). La clé inclut l'empreinte du contenu :
--     deux clients différents dont le numéro finit par les mêmes 4 chiffres ne se bloquent pas
--     (messages personnalisés), mais la même campagne envoyée deux fois au même numéro le même jour, oui.
CREATE OR REPLACE FUNCTION public.fn_messaging_log_dedup_key()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
BEGIN
  IF NEW.type = 'sms'
     AND NEW.context IN ('rappel_24h','rappel_2h','confirmation_rdv','confirmation_rdv_groupe',
                         'anniversaire','relance')
     AND NEW.recipient IS NOT NULL THEN
    NEW.dedup_key := NEW.salon_id::text || '|' || NEW.context || '|' || NEW.recipient || '|'
                     || to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
  -- 2026-10-14 audit : campagnes
  ELSIF NEW.type = 'sms' AND NEW.context = 'marketing' AND NEW.recipient IS NOT NULL THEN
    NEW.dedup_key := NEW.salon_id::text || '|marketing|' || NEW.recipient || '|' || md5(coalesce(NEW.content, '')) || '|'
                     || to_char(coalesce(NEW.created_at, now()) AT TIME ZONE 'Europe/Paris', 'YYYY-MM-DD');
  END IF;
  RETURN NEW;
END; $function$;

-- 5c. Traitement de la file (recréée depuis la définition actuelle) :
--     - un seul traitement à la fois par salon (verrou) ; lots de 25 SMS au plus par passage ;
--     - jamais entre 21h et 8h (heure de Paris) : la file attend le matin ;
--     - consentement revérifié (fiche : sms_ok, non anonymisée ; sinon numéro d'une fiche ayant refusé) ;
--     - réservation anti-doublon dans messaging_log AVANT l'envoi (comme envoyer_rappels_24h) ;
--     - statut « envoye » seulement quand le worker a répondu succès (rapprochement net._http_response au
--       passage suivant) ; refus de crédits / limite -> nouvel essai sans compter ; autre erreur -> 3 essais ;
--       délai dépassé ou réponse perdue -> « echec » SANS nouvel essai (on ne sait pas si le SMS est parti).
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

      v_nb := lx_prive.sms_nb(r.message);
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
        body := jsonb_build_object('telephone', r.telephone, 'message', r.message,
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
REVOKE ALL ON FUNCTION public.traiter_sms_differes(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traiter_sms_differes(uuid) TO service_role;

-- 5d. Passage régulier sur toutes les files (cron toutes les 2 minutes) : uniquement les salons qui ont
--     quelque chose en attente / en cours (requête sur index, coût négligeable sinon).
CREATE OR REPLACE FUNCTION public.traiter_sms_differes_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE s record; v_nb int := 0;
BEGIN
  FOR s IN SELECT DISTINCT salon_id FROM sms_differes WHERE statut IN ('en_attente', 'envoi') LOOP
    BEGIN
      PERFORM public.traiter_sms_differes(s.salon_id);
      v_nb := v_nb + 1;
    EXCEPTION WHEN OTHERS THEN
      BEGIN
        INSERT INTO audit_log (salon_id, action, details, operator_name)
        VALUES (s.salon_id, 'DB_ERROR', 'traiter_sms_differes : ' || SQLERRM, 'traitement_automatique');
      EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'salons', v_nb);
END;
$function$;
REVOKE ALL ON FUNCTION public.traiter_sms_differes_tous() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.traiter_sms_differes_tous() TO service_role;

-- 5e. Campagnes : l'app met les SMS en file (au lieu d'un appel par client depuis l'appareil, coupé par la limite
--     de 15/minute du worker). Contrôles : gérant du salon, consentement de la fiche, doublon (même numéro + même
--     message déjà en file ou envoyé dans les 24 h -> ignoré, protège du double appui). 2000 destinataires au plus.
CREATE OR REPLACE FUNCTION public.lx_sms_campagne_enfiler(p_salon_id uuid, p_envois jsonb, p_titre text DEFAULT NULL)
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
    -- consentement de la fiche (si fournie)
    IF v_cid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clients c WHERE c.id = v_cid AND c.salon_id = p_salon_id
                                           AND c.sms_ok IS TRUE AND c.rgpd_anonymise_le IS NULL) THEN
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
REVOKE ALL ON FUNCTION public.lx_sms_campagne_enfiler(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.lx_sms_campagne_enfiler(uuid, jsonb, text) TO authenticated, service_role;

-- 5f. Anniversaires et relances côté SERVEUR (avant : seulement si un appareil était ouvert, et coupés par
--     l'interrupteur « Rappels SMS actifs »). Chaque jour, pour les salons Pro en mode Brevo (le mode natif
--     reste géré par le téléphone) : interrupteurs anniActif / relanceActif de sms_config, consentement
--     sms_ok strict, fiches actives non fusionnées / non anonymisées. Les SMS sont mis en file
--     (traiter_sms_differes : heures 8h-21h, crédits, anti-doublon, confirmation de l'envoi).
--     Journal sms_auto_envois : un anniversaire par an et par client ; une relance automatique par période
--     d'inactivité (et jamais moins de 6 mois après une relance manuelle ou automatique, jamais si un RDV est prévu).
CREATE TABLE IF NOT EXISTS public.sms_auto_envois (
  salon_id  uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  client_id uuid NOT NULL,
  type      text NOT NULL CHECK (type IN ('anniversaire', 'relance')),
  jour      date NOT NULL,
  cree_le   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (salon_id, client_id, type, jour)
);
ALTER TABLE public.sms_auto_envois ENABLE ROW LEVEL SECURITY;
-- table interne, lue uniquement par les fonctions serveur (règle GRANT explicites du 30/10/2026)
REVOKE ALL ON public.sms_auto_envois FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sms_auto_envois TO service_role;

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
BEGIN
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

  RETURN jsonb_build_object('ok', true, 'anniversaires', v_anniv, 'relances', v_rel);
END;
$function$;
REVOKE ALL ON FUNCTION public.envoyer_sms_anniv_relance() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.envoyer_sms_anniv_relance() TO service_role;

-- 5g. Planification (pg_cron : cron.schedule avec un nom = création ou mise à jour, donc rejouable)
--     - file SMS : toutes les 2 minutes (rien n'est fait s'il n'y a rien en attente)
--     - anniversaires / relances : 08:30 UTC (10h30 Paris l'été, 9h30 l'hiver), après les rappels 24h de 08:00
SELECT cron.schedule('sms-differes-file', '*/2 * * * *', $cron$SELECT public.traiter_sms_differes_tous();$cron$);
SELECT cron.schedule('sms-anniv-relance-serveur', '30 8 * * *', $cron$SELECT public.envoyer_sms_anniv_relance();$cron$);

-- ============================================================================
-- Vérifications après application (lecture seule) :
--   SELECT column_name FROM information_schema.columns WHERE table_name='clients' AND column_name='rgpd_anonymise_le';
--   SELECT jobname, schedule FROM cron.job WHERE jobname IN ('sms-differes-file','sms-anniv-relance-serveur');
--   SELECT indexname FROM pg_indexes WHERE indexname='cartes_cadeaux_salon_code_unique';
-- Essai à blanc des SMS (règle du 07/09) : salon de test avec crédits à 0 -> les SMS restent « en_attente », aucun envoi.
-- ============================================================================
