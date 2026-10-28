-- =====================================================================================================================
-- RETOUR ARRIÈRE de lot4_protections.sql (2026-10-28 -8, Luxyra 6.8.6) — NON APPLIQUÉ.
-- Retire les contrôles et fonctions posés par lot4_protections.sql et remet la définition de PRODUCTION de creer_ticket_avoir
-- relue le 28/10/2026 (md5 cf9b3c1e00e45e84f5e40d48fd41f64a, recopiée à l'octet près : vérifiée en base de test).
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
