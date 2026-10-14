-- =====================================================================================================
-- « Prix à partir de » (prestations ET forfaits) + « Prix sur devis » sur les forfaits — 15/10/2026
-- Idempotent : peut être rejoué. À appliquer AVANT de publier app.html / luxyra-supabase.js (v=20261015-1),
-- site.html et le worker (l'app fonctionne aussi sans ce SQL : les nouvelles colonnes ne sont écrites que si
-- elles existent en base).
--
-- Rappel du modèle (vérifié en base le 15/10) :
--  * Les FORFAITS de l'onglet « Services et Forfaits › Forfaits » sont des lignes de public.services à plusieurs
--    étapes (phases > 1) : « sur devis » (services.prix_sur_devis, déjà en base) et « à partir de »
--    (services.prix_a_partir_de, ci-dessous) s'appliquent donc à eux comme aux prestations simples, y compris le
--    refus serveur des réservations en ligne « sur devis » (demande sur mesure à la place).
--  * La table public.forfaits (ancien format, recopiée dans config_json.forfaits) reçoit les deux mêmes drapeaux
--    pour rester cohérente ; elle n'est jamais réservable en ligne.
--  * « À partir de » : le prix de la fiche est un MINIMUM. Réservable en ligne ; durée = durée configurée ;
--    acompte calculé sur ce minimum (comme lxCalcAcompte dans site.html) ; drapeau "a_partir_de": true recopié par
--    le serveur dans rdv_online.items (valeur du catalogue, jamais celle du navigateur) pour la caisse et l'espace client.
--  * Caisse : le ticket enregistre seulement le prix final (aucun changement de format, de scellement ni d'empreinte).
-- =====================================================================================================
BEGIN;

-- ---------------------------------------------------------------- 1) Colonnes
ALTER TABLE public.services ADD COLUMN IF NOT EXISTS prix_a_partir_de boolean NOT NULL DEFAULT false;
ALTER TABLE public.forfaits ADD COLUMN IF NOT EXISTS prix_sur_devis   boolean NOT NULL DEFAULT false;
ALTER TABLE public.forfaits ADD COLUMN IF NOT EXISTS prix_a_partir_de boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.services.prix_a_partir_de IS '2026-10-15 : prix = minimum (« à partir de »), prix final fixé à l''encaissement';
COMMENT ON COLUMN public.forfaits.prix_sur_devis   IS '2026-10-15 : forfait sur devis (prix saisi à l''encaissement)';
COMMENT ON COLUMN public.forfaits.prix_a_partir_de IS '2026-10-15 : prix = minimum (« à partir de »)';

-- Les deux options sont exclusives (l'app décoche l'une quand on coche l'autre)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'services_prix_mode_exclusif') THEN
    ALTER TABLE public.services ADD CONSTRAINT services_prix_mode_exclusif
      CHECK (NOT (coalesce(prix_sur_devis,false) AND prix_a_partir_de));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'forfaits_prix_mode_exclusif') THEN
    ALTER TABLE public.forfaits ADD CONSTRAINT forfaits_prix_mode_exclusif
      CHECK (NOT (prix_sur_devis AND prix_a_partir_de));
  END IF;
END $$;

-- ---------------------------------------------------------------- 2) Réservation en ligne (anon / compte client)
-- Recréée depuis la définition EN BASE du 15/10 (pg_get_functiondef, md5 1096251c12b28f54085d4dc8f446fdc8).
-- Seuls ajouts (repérés « 2026-10-15 ») : lecture de prix_a_partir_de et réécriture de NEW.items avec le drapeau
-- "a_partir_de" du catalogue. Le prix de base reste services.prix (= minimum) -> acompte calculé sur le minimum,
-- toujours plafonné au prix. Aucune autre règle modifiée.
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
  v_apd boolean;                         -- 2026-10-15 : prestation « à partir de »
  v_items jsonb := '[]'::jsonb;          -- 2026-10-15 : items recopiés avec le drapeau du catalogue
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
      v_p := NULL; v_devis := false; v_apd := false;
      SELECT s.prix, coalesce(s.prix_sur_devis,false), coalesce(s.prix_a_partir_de,false) INTO v_p, v_devis, v_apd
        FROM public.services s WHERE s.id = v_sid AND s.salon_id = NEW.salon_id;
      IF v_devis THEN RAISE EXCEPTION 'Prestation sur devis : envoyez une demande à l''établissement'; END IF;
      v_base := v_base + coalesce(v_p, 0);
      -- 2026-10-15 : drapeau « à partir de » = valeur du catalogue (posé ou retiré, jamais celui du navigateur)
      IF jsonb_typeof(v_item) = 'object' THEN
        v_items := v_items || jsonb_build_array(CASE WHEN coalesce(v_apd,false)
                                                     THEN v_item || jsonb_build_object('a_partir_de', true)
                                                     ELSE v_item - 'a_partir_de' END);
      ELSE
        v_items := v_items || jsonb_build_array(v_item);
      END IF;
    END LOOP;
    NEW.items := v_items;  -- 2026-10-15
  ELSIF NEW.service_id IS NOT NULL THEN
    v_apd := false;
    SELECT s.prix, coalesce(s.prix_sur_devis,false), coalesce(s.prix_a_partir_de,false) INTO v_p, v_devis, v_apd
      FROM public.services s WHERE s.id = NEW.service_id AND s.salon_id = NEW.salon_id;
    IF v_devis THEN RAISE EXCEPTION 'Prestation sur devis : envoyez une demande à l''établissement'; END IF;
    v_base := coalesce(v_p, 0);
    -- 2026-10-15 : réservation sans liste d'items -> une ligne portant le drapeau (lue par la caisse et l'espace client)
    IF coalesce(v_apd,false) THEN
      NEW.items := jsonb_build_array(jsonb_build_object('service_id', NEW.service_id, 'nom', NEW.service_nom,
                     'prix', coalesce(v_p,0), 'duree', coalesce(NEW.duree_minutes,0), 'ordre', 0, 'a_partir_de', true));
    END IF;
  END IF;

  -- Remise carte d'abonnement : seulement une carte ACTIVE de cet établissement, non expirée
  IF NEW.carte_abo_id IS NOT NULL THEN
    SELECT coalesce(c.remise_services,0) INTO v_pct FROM public.cartes_abo_clients c
     WHERE c.id = NEW.carte_abo_id AND c.salon_id = NEW.salon_id AND c.status = 'active'
       AND (c.date_expiration IS NULL OR c.date_expiration >= NEW.date_rdv);
    IF NOT FOUND THEN
      v_pct := 0; NEW.carte_abo_id := NULL; NEW.remise_carte_montant := 0;
    END IF;
  ELSE
    NEW.remise_carte_montant := 0;  -- pas de carte : pas de remise déclarée par le navigateur
  END IF;
  v_remise := round(v_base * coalesce(v_pct,0) / 100, 2);
  IF NEW.carte_abo_id IS NOT NULL THEN NEW.remise_carte_montant := v_remise; END IF;  -- remise = celle du serveur
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
  -- 2026-10-15 : prestation « à partir de » -> v_prix part du MINIMUM (services.prix), comme lxCalcAcompte
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
  -- 2026-10-14 intégration : comme lxCalcAcompte (site.html) : jamais plus que le prix, arrondi au centime
  IF v_prix > 0 AND v_req > v_prix THEN v_req := v_prix; END IF;
  v_req := round(greatest(coalesce(v_req,0), 0), 2);

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

-- ---------------------------------------------------------------- 3) Bot support (support_bot_kb, upsert sur cle)
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le) VALUES
('prix_a_partir_de_1015', 'Prix « à partir de » (prix minimum, comme Planity)', 906, $kb$À quoi ça sert : afficher un PRIX MINIMUM au lieu d'un prix fixe quand le prix dépend de la longueur, de la technique ou du temps (balayage, chignon, extension de cils…). Le client voit « à partir de 45,00 € » et peut quand même RÉSERVER EN LIGNE.
Régler : Services et Forfaits → ouvrir la prestation (crayon ✏️) ou « + Nouvelle prestation » → saisir le prix minimum dans « Prix (€) » (obligatoire, > 0) → cocher « ↗️ Prix « à partir de » » → « Enregistrer ». Pour un forfait : onglet Forfaits → compositeur → même case (le champ devient « Prix minimum (€) »). « Prix sur devis » et « Prix « à partir de » » sont exclusifs : cocher l'un décoche l'autre.
Listes de l'app : le prix est précédé de « à partir de ».
Site / réservation : « à partir de 45.00 € » sur les tarifs, dans le panier et le récapitulatif, avec la mention « Prix final fixé à l'établissement selon la prestation réalisée ». Durée bloquée = durée configurée de la prestation. ACOMPTE calculé sur le prix minimum (jamais plus que ce prix), même calcul sur la page et sur le serveur. Le RDV enregistre le prix minimum + l'indication « à partir de ». Espace client : « à partir de 45€ » sur le RDV ; e-mail de confirmation : « Prix : à partir de … ». Pages Google : prix minimum publié (jamais un faux prix fixe).
Caisse : la ligne arrive au prix minimum avec un badge doré « à partir de » et un prix souligné « ✎ 45.00 ». Toucher le prix (ou le badge) → fenêtre « ↗️ Prix « à partir de » » (rappel du minimum) → saisir le prix final TTC → « Valider le prix ». Prix inférieur au minimum → confirmation « Appliquer quand même ce prix ? » (Confirmer / Annuler). Une remise de carte d'abonnement en % est recalculée. Le ticket ne garde que le prix final (aucun changement pour la clôture, les archives, la conformité caisse) ; statistiques et exports = prix réellement encaissé. Changement noté au journal (PRIX_A_PARTIR_DE).
Guides : luxyra.fr/aide/prestations-et-forfaits (section Prix « à partir de »), luxyra.fr/aide/encaisser (Prix « à partir de » : fixer le prix final), luxyra.fr/aide/site-et-reservation-en-ligne.$kb$, true, now()),
('forfait_sur_devis_1015', 'Forfait « sur devis »', 907, $kb$Un FORFAIT (prestation en plusieurs étapes, onglet Forfaits de « Services et Forfaits ») peut être « sur devis », exactement comme une prestation : compositeur de forfait (« + Nouveau forfait » ou crayon ✏️) → cocher « 📝 Prix sur devis » (le prix devient facultatif) → « Créer le forfait » / « Enregistrer ».
Effets identiques aux prestations sur devis : le site affiche « Sur devis » avec un bouton « Demander » (demande de RDV sur mesure, pas de réservation directe ; une réservation directe est refusée par le serveur). À l'encaissement, la fenêtre « 📝 Prix sur devis » demande le prix convenu dès l'ajout au ticket, et un ticket ne peut pas être validé avec un forfait sur devis à 0 € (contrôle au paiement).
Ne pas confondre avec « Prix « à partir de » » : prix minimum affiché, réservation en ligne possible, prix final ajusté en caisse.
Guide : luxyra.fr/aide/prestations-et-forfaits (sections Prestation sur devis et Forfait sur devis).$kb$, true, now())
ON CONFLICT (cle) DO UPDATE SET titre = EXCLUDED.titre, ordre = EXCLUDED.ordre, contenu = EXCLUDED.contenu,
                                actif = EXCLUDED.actif, maj_le = now();

-- ---------------------------------------------------------------- 4) Contrôles (lecture seule)
SELECT table_name, column_name, data_type, column_default FROM information_schema.columns
 WHERE table_schema = 'public' AND column_name IN ('prix_a_partir_de','prix_sur_devis') ORDER BY 1, 2;
SELECT cle, ordre, length(contenu) AS taille FROM public.support_bot_kb
 WHERE cle IN ('prix_a_partir_de_1015','forfait_sur_devis_1015');

COMMIT;
