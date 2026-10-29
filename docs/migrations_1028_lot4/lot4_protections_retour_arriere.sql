-- =====================================================================================================================
-- RETOUR ARRIÈRE de lot4_protections.sql (2026-10-28 -8, Luxyra 6.8.6) — NON APPLIQUÉ.
-- Retire les contrôles et fonctions posés par lot4_protections.sql et remet les définitions de PRODUCTION relues le 28/10/2026 de
-- creer_ticket_avoir (md5 cf9b3c1e…), consommer_bon_cadeau (5362a257…), recrediter_bon_cadeau (901a4d8b…) et
-- generer_facture_client (d2e41194…, droit d'exécution du propriétaire rétabli), recopiées à l'octet près (vérifiées en base de test).
-- CONSERVE (pièces justificatives, ne jamais supprimer) : public.cartes_cadeaux_mouvements, public.stripe_versements(_lignes),
-- les colonnes ajoutées à public.factures_clients et toutes leurs lignes ; la fonction public.lx_facture_emettre est retirée
-- (plus aucune facture émise) mais les factures déjà émises restent consultables, inaltérables (déclencheur existant).
-- La politique d'insertion directe des factures (factures_clients_insert_own) N'EST PAS recréée : sans fonction de numérotation,
-- aucune facture ne doit être créée.
-- Rejouable. Après le retour arrière, l'application 6.8.6 reste utilisable (le bouton « Facture » affiche l'erreur de la base).
-- =====================================================================================================================
drop trigger if exists a_lx_tickets_colonnes_figees on public.tickets;
drop trigger if exists a_lx_tickets_0_statut on public.tickets;
drop function if exists lx_prive.tickets_colonnes_figees();
drop function if exists lx_prive.tickets_statut_insertion();
drop trigger if exists a1_lx_cartes_cadeaux_garde_fiscale on public.cartes_cadeaux;
drop trigger if exists a_lx_cartes_cadeaux_suppression on public.cartes_cadeaux;
drop trigger if exists zzz_lx_cartes_cadeaux_journal on public.cartes_cadeaux;
drop function if exists lx_prive.cartes_cadeaux_garde_fiscale();
drop function if exists lx_prive.cartes_cadeaux_suppression();
drop function if exists lx_prive.cartes_cadeaux_journal();
drop function if exists lx_prive.bon_mouvement_ecrire(uuid, uuid, text, text, jsonb, jsonb, text);
drop function if exists public.lx_bons_etat(uuid, date);
drop trigger if exists a0_lx_clotures_arrondi on public.clotures;
drop trigger if exists zz_lx_clotures_arrondi_cumul on public.clotures;
drop trigger if exists b_nf525_z_cumul_tickets on public.clotures;
drop function if exists lx_prive.clotures_arrondi();
drop function if exists lx_prive.clotures_arrondi_cumul();
drop function if exists lx_prive.clotures_cumul_tickets_annotations();
drop function if exists public.lx_facture_emettre(uuid, jsonb, text);
drop function if exists lx_prive.facture_lignes(jsonb, jsonb, numeric, numeric);
drop function if exists lx_prive.forme_libelle(text);
drop function if exists lx_prive.forme_societe(text);
-- CONSERVÉ volontairement (révision du 29/10/2026) : déclencheur a_lx_factures_clients_pas_de_test (aucune facture en caisse de
-- TEST, toutes voies) — il protège aussi la fonction de production generer_facture_client remise ci-dessous (une facture de test
-- bloquerait la réinitialisation d'essai et le passage en caisse réelle) ; colonnes salons.rcs_ville / capital_social et colonnes
-- ajoutées à factures_clients (données saisies, sans effet sur les pages 6.8.5).
-- le journal des bons reste inaltérable (son déclencheur et lx_prive.bon_fiscal / arrondi_bruit sont conservés : inoffensifs)

-- creer_ticket_avoir : définition de PRODUCTION du 28/10/2026 (à l'identique)
CREATE OR REPLACE FUNCTION public.creer_ticket_avoir(p_ticket_origine_id uuid, p_motif text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_role text;
  v_origine tickets%ROWTYPE;
  v_avoir_id uuid;
  v_next_num int;
  v_now timestamptz := NOW();
  v_existing_avoir uuid;
  v_collab_nom text;
BEGIN
  v_user_id := auth.uid();
  BEGIN
    v_role := auth.role();
  EXCEPTION WHEN OTHERS THEN v_role := NULL; END;

  -- === AUTHENTIFICATION OBLIGATOIRE (NF525) ===
  -- Un avoir est un document fiscal : il ne peut pas etre cree anonymement.
  IF v_user_id IS NULL AND COALESCE(v_role, 'anon') <> 'service_role' THEN
    RAISE EXCEPTION 'Authentification requise : la creation d''un ticket d''avoir est interdite en acces anonyme.';
  END IF;

  -- Charge le ticket origine
  SELECT * INTO v_origine FROM tickets WHERE id = p_ticket_origine_id;
  IF v_origine.id IS NULL THEN
    RAISE EXCEPTION 'Ticket origine introuvable : %', p_ticket_origine_id;
  END IF;

  -- Vérifie que le caller gère le salon
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = v_origine.salon_id AND user_id = v_user_id)
       AND NOT is_admin() THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;

  -- Vérifie qu'il n'y a pas déjà un avoir pour ce ticket
  SELECT id INTO v_existing_avoir FROM tickets
   WHERE parent_ticket_id = p_ticket_origine_id AND is_avoir = true LIMIT 1;
  IF v_existing_avoir IS NOT NULL THEN
    RAISE EXCEPTION 'Un avoir existe déjà pour ce ticket (id=%)', v_existing_avoir;
  END IF;

  -- Le ticket origine doit être 'paid' (pas déjà cancelled)
  IF v_origine.status <> 'paid' THEN
    RAISE EXCEPTION 'Seul un ticket paid peut être annulé. Status actuel: %', v_origine.status;
  END IF;

  IF p_motif IS NULL OR LENGTH(TRIM(p_motif)) < 3 THEN
    RAISE EXCEPTION 'Motif d''annulation obligatoire (min 3 caractères)';
  END IF;

  -- Identification de l'operateur sur le nouvel avoir : si le ticket d'origine
  -- n'a pas de nom fige, on le derive du lien collaborateur (jamais NULL en sortie
  -- si le lien existe). Le nouveau ticket est cree ici, rien d'existant n'est touche.
  v_collab_nom := v_origine.collaborateur_nom;
  IF v_collab_nom IS NULL AND v_origine.collaborateur_id IS NOT NULL THEN
    SELECT nom INTO v_collab_nom FROM collaborateurs WHERE id = v_origine.collaborateur_id;
  END IF;

  -- Numérotation continue : prochain num pour ce salon
  SELECT COALESCE(MAX(num), 0) + 1 INTO v_next_num
  FROM tickets WHERE salon_id = v_origine.salon_id;

  -- INSERT du ticket d'avoir (montants négatifs, chaîné via parent_ticket_id)
  INSERT INTO tickets (
    salon_id, num, date_ticket, heure_ticket, ts_created,
    client_id, client_nom, client_prenom,
    collaborateur_id, collaborateur_nom,
    items, total_brut, total_remise, total_ttc, total_ht, total_tva, taux_tva,
    mode_paiement, status,
    parent_ticket_id, is_avoir, cancel_reason
  ) VALUES (
    v_origine.salon_id, v_next_num, CURRENT_DATE, CURRENT_TIME, v_now,
    v_origine.client_id, v_origine.client_nom, v_origine.client_prenom,
    v_origine.collaborateur_id, v_collab_nom,
    v_origine.items,
    -COALESCE(v_origine.total_brut, 0), -COALESCE(v_origine.total_remise, 0),
    -v_origine.total_ttc, -v_origine.total_ht, -v_origine.total_tva,
    v_origine.taux_tva,
    v_origine.mode_paiement, 'paid',
    p_ticket_origine_id, true, p_motif
  ) RETURNING id INTO v_avoir_id;

  -- Marque le ticket origine en cancelled (via les triggers NF525, status='cancelled' est autorisé post-paid)
  SET LOCAL luxyra.allow_nf525_unlock = 'true';
  UPDATE tickets SET status = 'cancelled', cancelled_at = v_now, cancel_reason = p_motif
    WHERE id = p_ticket_origine_id;
  -- Reset bypass (defensive)
  RESET luxyra.allow_nf525_unlock;

  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (v_origine.salon_id, 'TICKET_AVOIR_CREE',
    'Ticket #' || v_origine.num || ' annulé par avoir #' || v_next_num ||
    ' (montant -' || to_char(v_origine.total_ttc, 'FM9999999.99') ||
    ' EUR). Motif: ' || LEFT(p_motif, 200),
    'creer_ticket_avoir');

  RETURN jsonb_build_object(
    'ok', true,
    'avoir_id', v_avoir_id,
    'avoir_num', v_next_num,
    'origine_id', p_ticket_origine_id,
    'origine_num', v_origine.num,
    'montant_avoir', -v_origine.total_ttc
  );
END;
$function$;
do $$ begin
  if md5(pg_get_functiondef('public.creer_ticket_avoir(uuid,text)'::regprocedure)) <> 'cf9b3c1e00e45e84f5e40d48fd41f64a' then
    raise exception 'Retour arrière lot 4 : creer_ticket_avoir différente de la définition de production attendue';
  end if;
end $$;

-- consommer_bon_cadeau : définition de PRODUCTION du 28/10/2026 (à l'identique, md5 5362a2575acb47ad41b79b6e5b99a75a)
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
do $$ begin
  if md5(pg_get_functiondef('public.consommer_bon_cadeau(uuid,numeric,text)'::regprocedure)) <> '5362a2575acb47ad41b79b6e5b99a75a' then
    raise exception 'Retour arrière lot 4 : consommer_bon_cadeau différente de la définition de production attendue';
  end if;
end $$;

-- recrediter_bon_cadeau : définition de PRODUCTION du 28/10/2026 (à l'identique, md5 901a4d8b3ef76ea13683cae00d8d32ca)
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
do $$ begin
  if md5(pg_get_functiondef('public.recrediter_bon_cadeau(uuid,numeric,text,text)'::regprocedure)) <> '901a4d8b3ef76ea13683cae00d8d32ca' then
    raise exception 'Retour arrière lot 4 : recrediter_bon_cadeau différente de la définition de production attendue';
  end if;
end $$;

-- generer_facture_client : définition de PRODUCTION du 28/10/2026 (à l'identique, md5 d2e41194b825d224acd2a979a55665ab)
CREATE OR REPLACE FUNCTION public.generer_facture_client(p_ticket_id uuid, p_client_nom text DEFAULT NULL::text, p_client_prenom text DEFAULT NULL::text, p_client_adresse text DEFAULT NULL::text, p_client_cp text DEFAULT NULL::text, p_client_ville text DEFAULT NULL::text, p_client_email text DEFAULT NULL::text, p_client_telephone text DEFAULT NULL::text, p_client_siret text DEFAULT NULL::text, p_client_tva_intracom text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid;
  v_ticket tickets%ROWTYPE;
  v_salon salons%ROWTYPE;
  v_client clients%ROWTYPE;
  v_existing uuid;
  v_next_num int;
  v_hash_prev text;
  v_hash text;
  v_id uuid;
  v_operator_name text;
BEGIN
  v_user_id := auth.uid();
  SELECT * INTO v_ticket FROM tickets WHERE id = p_ticket_id;
  IF v_ticket.id IS NULL THEN RAISE EXCEPTION 'Ticket introuvable: %', p_ticket_id; END IF;
  SELECT * INTO v_salon FROM salons WHERE id = v_ticket.salon_id;
  
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = v_ticket.salon_id AND user_id = v_user_id)
       AND NOT is_admin() THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;
  
  -- Idempotent : si déjà facturé, retourne l'existant
  SELECT id INTO v_existing FROM factures_clients WHERE ticket_id = p_ticket_id;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing);
  END IF;
  
  -- Récupère le client (fiche salon) pour défauts
  IF v_ticket.client_id IS NOT NULL THEN
    SELECT * INTO v_client FROM clients WHERE id = v_ticket.client_id;
  END IF;
  
  -- Numéro séquentiel
  SELECT COALESCE(MAX(num), 0) + 1 INTO v_next_num FROM factures_clients WHERE salon_id = v_ticket.salon_id;
  
  -- Hash prev = dernière facture du salon
  SELECT hash INTO v_hash_prev FROM factures_clients 
   WHERE salon_id = v_ticket.salon_id ORDER BY num DESC LIMIT 1;
  
  -- Hash SHA-256
  v_hash := encode(extensions.digest(
    'FC|' || v_next_num || '|' || v_ticket.id::text || '|' ||
    to_char(v_ticket.total_ttc, 'FM9999999.99') || '|' ||
    COALESCE(v_hash_prev, '') || '|' || COALESCE(v_salon.siret, ''),
    'sha256'
  ), 'hex');
  
  v_operator_name := COALESCE(v_ticket.collaborateur_nom, 'system');
  
  INSERT INTO factures_clients (
    salon_id, num, ticket_id,
    client_nom, client_prenom, client_adresse, client_cp, client_ville,
    client_email, client_telephone, client_siret, client_tva_intracom,
    salon_nom, salon_siret, salon_adresse,
    items, total_ht, total_tva, total_ttc, taux_tva, mode_paiement,
    hash, hash_algo, hash_prev,
    operator_id, operator_name
  ) VALUES (
    v_ticket.salon_id, v_next_num, p_ticket_id,
    COALESCE(p_client_nom, v_client.nom, v_ticket.client_nom, 'Client passage'),
    COALESCE(p_client_prenom, v_client.prenom, v_ticket.client_prenom),
    COALESCE(p_client_adresse, v_client.adresse),
    COALESCE(p_client_cp, v_client.cp),
    COALESCE(p_client_ville, v_client.ville),
    COALESCE(p_client_email, v_client.email),
    COALESCE(p_client_telephone, v_client.telephone),
    p_client_siret, p_client_tva_intracom,
    v_salon.nom, v_salon.siret, NULL,
    v_ticket.items, v_ticket.total_ht, v_ticket.total_tva, 
    v_ticket.total_ttc, v_ticket.taux_tva, v_ticket.mode_paiement,
    v_hash, 'SHA-256', v_hash_prev,
    v_ticket.collaborateur_id, v_operator_name
  ) RETURNING id INTO v_id;
  
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (v_ticket.salon_id, 'FACTURE_CLIENT_GENEREE',
    'Facture #' || v_next_num || ' pour ticket #' || v_ticket.num || ' (' ||
    to_char(v_ticket.total_ttc, 'FM9999999.99') || ' EUR)', v_operator_name);
  
  RETURN jsonb_build_object(
    'ok', true, 'id', v_id, 'num', v_next_num, 'hash', v_hash,
    'total_ttc', v_ticket.total_ttc
  );
END;
$function$;
grant execute on function public.generer_facture_client(uuid, text, text, text, text, text, text, text, text, text) to authenticated, service_role;
do $$ begin
  if md5(pg_get_functiondef('public.generer_facture_client(uuid,text,text,text,text,text,text,text,text,text)'::regprocedure)) <> 'd2e41194b825d224acd2a979a55665ab' then
    raise exception 'Retour arrière lot 4 : generer_facture_client différente de la définition de production attendue';
  end if;
end $$;
