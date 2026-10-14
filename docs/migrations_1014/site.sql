-- =====================================================================
-- 2026-10-14 audit — lot « site public / compte client »
-- Fichier IDEMPOTENT (create or replace / if not exists). NE PAS appliquer
-- avant d'avoir relu ; ordre de déploiement : ce SQL -> edge functions -> worker -> site.
-- Aucune donnée existante n'est modifiée.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Acompte / empreinte calculés PAR LA BASE à l'insertion publique
-- ---------------------------------------------------------------------
-- Avant : le navigateur envoyait acompte_montant (et le montant Stripe) ; un appel direct
-- pouvait réserver « confirmé » sans acompte, ou payer 1 € au lieu de 30 €.
-- Désormais, pour une insertion anon / client (pas le gérant, pas service_role) :
--   * prestations « sur devis » refusées (réservation par demande uniquement) ;
--   * prix recalculé depuis services.prix (+ remise carte d'abonnement valide, + frais de déplacement) ;
--   * acompte requis = même règle que site.html (type fixe/pourcentage, minimum, seuil, réglage client
--     jamais/toujours via get_client_acompte_mode) ; empreinte = site_config.empreinte_montant (30 par défaut) ;
--   * si l'établissement encaisse en ligne (compte Stripe actif) et que le RDV n'est pas à domicile :
--     statut 'pending_payment' OBLIGATOIRE (sinon refus) et montant stocké = montant requis ;
--   * sinon (pas de paiement en ligne / domicile) : acompte_montant = montant dû (réglé au salon / par lien).
-- Le worker (/api/stripe/connect-payment) facture désormais le montant STOCKÉ sur la ligne.
-- Reprend à l'identique le corps existant de lx_prive.rdv_online_insert_public_propre (14/10, acompte en ligne).
CREATE OR REPLACE FUNCTION lx_prive.rdv_online_insert_public_propre()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_role text := coalesce((select auth.role()), '');
  v_cfg  public.site_config%ROWTYPE;
  v_salon public.salons%ROWTYPE;
  v_mode text;
  v_base numeric := 0;
  v_pct  numeric := 0;
  v_remise numeric := 0;
  v_frais numeric := 0;
  v_prix numeric := 0;
  v_req  numeric := 0;
  v_client_mode text := 'defaut';
  v_online boolean := false;
  v_item jsonb;
  v_sid integer;
  v_p numeric;
  v_devis boolean;
BEGIN
  IF v_role NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  IF public.is_admin() OR EXISTS (SELECT 1 FROM salons s WHERE s.id = NEW.salon_id AND s.user_id = auth.uid()) THEN
    RETURN NEW;
  END IF;
  NEW.acompte_paye := false;  NEW.acompte_rembourse := false;
  NEW.stripe_payment_id := NULL;  NEW.payment_intent_id := NULL;  NEW.stripe_token := NULL;  NEW.stripe_account := NULL;
  NEW.refund_id := NULL;  NEW.refunded_at := NULL;
  NEW.empreinte_held_at := NULL;  NEW.empreinte_captured_at := NULL;  NEW.empreinte_released_at := NULL;
  IF coalesce(NEW.empreinte_status,'none') NOT IN ('none','pending') THEN NEW.empreinte_status := 'pending'; END IF;
  IF coalesce(NEW.status,'pending') NOT IN ('pending','pending_payment','confirmed') THEN NEW.status := 'pending'; END IF;
  IF NEW.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM site_config c WHERE c.salon_id = NEW.salon_id AND coalesce(c.confirmation_auto,false) = true) THEN
    NEW.status := 'pending';
  END IF;
  NEW.cancelled_at := NULL;  NEW.cancelled_by := NULL;
  NEW.acompte_modele := NULL;  NEW.acompte_tk_num := NULL;  NEW.acompte_tk_claim_at := NULL;  NEW.acompte_remb_claim_at := NULL;
  NEW.remboursements := '[]'::jsonb;  NEW.acompte_rembourse_montant := 0;
  NEW.retenue_at := NULL;  NEW.retenue_tk_num := NULL;  NEW.retenue_claim_at := NULL;  NEW.ticket_num := NULL;

  -- 2026-10-14 audit : prix recalculé depuis le catalogue ; « sur devis » refusé
  IF NEW.items IS NOT NULL AND jsonb_typeof(NEW.items) = 'array' AND jsonb_array_length(NEW.items) > 0 THEN
    FOR v_item IN SELECT jsonb_array_elements(NEW.items) LOOP
      v_sid := NULLIF(v_item->>'service_id','')::integer;
      v_p := NULL; v_devis := false;
      SELECT s.prix, coalesce(s.prix_sur_devis,false) INTO v_p, v_devis
        FROM public.services s WHERE s.id = v_sid AND s.salon_id = NEW.salon_id;
      IF v_devis THEN RAISE EXCEPTION 'Prestation sur devis : envoyez une demande à l''établissement'; END IF;
      v_base := v_base + coalesce(v_p, 0);
    END LOOP;
  ELSIF NEW.service_id IS NOT NULL THEN
    SELECT s.prix, coalesce(s.prix_sur_devis,false) INTO v_p, v_devis
      FROM public.services s WHERE s.id = NEW.service_id AND s.salon_id = NEW.salon_id;
    IF v_devis THEN RAISE EXCEPTION 'Prestation sur devis : envoyez une demande à l''établissement'; END IF;
    v_base := coalesce(v_p, 0);
  END IF;

  -- Remise carte d'abonnement : seulement une carte ACTIVE de cet établissement, non expirée
  IF NEW.carte_abo_id IS NOT NULL THEN
    SELECT coalesce(c.remise_services,0) INTO v_pct FROM public.cartes_abo_clients c
     WHERE c.id = NEW.carte_abo_id AND c.salon_id = NEW.salon_id AND c.status = 'active'
       AND (c.date_expiration IS NULL OR c.date_expiration >= NEW.date_rdv);
    IF NOT FOUND THEN
      v_pct := 0; NEW.carte_abo_id := NULL; NEW.remise_carte_montant := 0;
    END IF;
  END IF;
  v_remise := round(v_base * coalesce(v_pct,0) / 100, 2);
  IF coalesce(NEW.lieu,'salon') = 'domicile' THEN
    v_frais := greatest(coalesce(NEW.frais_deplacement_montant,0), 0);
  END IF;
  v_prix := round(v_base - v_remise + v_frais, 2);

  SELECT * INTO v_cfg FROM public.site_config WHERE salon_id = NEW.salon_id LIMIT 1;
  SELECT * INTO v_salon FROM public.salons WHERE id = NEW.salon_id;
  v_mode := coalesce(nullif(v_cfg.mode_caution,''), 'aucun');
  v_online := v_salon.stripe_connect_id IS NOT NULL
              AND coalesce(v_salon.stripe_connect_status,'') IN ('active','enabled','payouts_pending')
              AND coalesce(NEW.lieu,'salon') <> 'domicile'
              AND v_mode IN ('acompte','empreinte');

  IF v_online AND v_mode = 'empreinte' THEN
    v_req := coalesce(nullif(v_cfg.empreinte_montant,0), 30);
    IF NEW.status IS DISTINCT FROM 'pending_payment' THEN
      RAISE EXCEPTION 'Une empreinte bancaire de % € est requise pour ce rendez-vous', to_char(v_req,'FM999990.00');
    END IF;
    NEW.empreinte_amount := v_req;  NEW.empreinte_status := 'pending';
    NEW.acompte_montant := 0;
    RETURN NEW;
  END IF;

  -- Acompte (même règle que site.html : bookingTotals + acompteType/Min/Seuil + réglage client)
  IF v_mode = 'acompte' OR coalesce(v_cfg.acompte_obligatoire,false) THEN
    v_req := CASE WHEN v_cfg.acompte_type = 'pourcentage'
                  THEN round(v_prix * coalesce(v_cfg.acompte_montant,0) / 100)
                  ELSE coalesce(v_cfg.acompte_montant,0) END;
    IF coalesce(v_cfg.acompte_min,0) > 0 AND v_req < v_cfg.acompte_min THEN v_req := v_cfg.acompte_min; END IF;
    BEGIN
      v_client_mode := public.get_client_acompte_mode(NEW.salon_id, NEW.client_email, NEW.client_tel, NEW.client_luxyra_id);
    EXCEPTION WHEN OTHERS THEN v_client_mode := 'defaut';
    END;
    IF v_client_mode = 'jamais' THEN v_req := 0;
    ELSIF coalesce(v_cfg.acompte_seuil,0) > 0 AND v_prix < v_cfg.acompte_seuil AND v_client_mode <> 'toujours' THEN v_req := 0;
    END IF;
  END IF;
  v_req := greatest(coalesce(v_req,0), 0);

  IF v_online AND v_mode = 'acompte' THEN
    IF v_req > 0 AND NEW.status IS DISTINCT FROM 'pending_payment' THEN
      RAISE EXCEPTION 'Un acompte de % € est requis pour ce rendez-vous', to_char(v_req,'FM999990.00');
    END IF;
    IF v_req = 0 AND NEW.status = 'pending_payment' THEN NEW.status := 'pending'; END IF;
    NEW.acompte_montant := v_req;
  ELSE
    -- Pas de paiement en ligne (ou domicile : lien de paiement après acceptation) : montant dû mémorisé
    NEW.acompte_montant := CASE WHEN coalesce(v_cfg.acompte_obligatoire,false) THEN v_req ELSE 0 END;
    IF NEW.status = 'pending_payment' THEN NEW.status := 'pending'; END IF;
    NEW.empreinte_amount := NULL;
  END IF;
  RETURN NEW;
END $function$;

-- ---------------------------------------------------------------------
-- 2. RDV sur mesure : verrou de confirmation (plus de RDV en double webhook + retour navigateur)
-- ---------------------------------------------------------------------
-- Le worker (/api/rdv-demande/finalize, aussi appelé par le webhook) et l'edge function
-- rdv-demande-proposal-action (confirm) « prennent » la demande par UPDATE conditionnel
-- (status='proposed' ET confirm_claim_at NULL ou > 3 min) AVANT d'insérer le RDV.
-- Le statut reste 'proposed' pendant la prise (aucun nouveau statut : l'app pro n'en connaît pas d'autre).
ALTER TABLE public.rdv_demandes ADD COLUMN IF NOT EXISTS confirm_claim_at timestamptz;
ALTER TABLE public.rdv_demandes ADD COLUMN IF NOT EXISTS stripe_session_id text;
COMMENT ON COLUMN public.rdv_demandes.confirm_claim_at IS '2026-10-14 audit : verrou de confirmation (worker finalize / proposal-action confirm)';
COMMENT ON COLUMN public.rdv_demandes.stripe_session_id IS '2026-10-14 audit : session Stripe Checkout qui a confirmé la proposition (détection double paiement)';

-- ---------------------------------------------------------------------
-- 4 / 10. Bons cadeaux : rattachement au compte client de l'acheteur
-- ---------------------------------------------------------------------
-- Renseigné par le worker (/api/bons-cadeaux/statut) quand l'acheteur connecté revient de Stripe
-- (preuve : il détient l'identifiant de session Stripe). L'onglet « Bons cadeaux » (worker
-- /api/client/bons-cadeaux) lit par ce lien, et par e-mail uniquement si l'e-mail du compte est vérifié.
ALTER TABLE public.cartes_cadeaux ADD COLUMN IF NOT EXISTS acheteur_luxyra_id uuid REFERENCES public.clients_luxyra(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS cartes_cadeaux_acheteur_luxyra_idx ON public.cartes_cadeaux(acheteur_luxyra_id) WHERE acheteur_luxyra_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cartes_cadeaux_stripe_session_idx ON public.cartes_cadeaux(stripe_session_id) WHERE stripe_session_id IS NOT NULL;
