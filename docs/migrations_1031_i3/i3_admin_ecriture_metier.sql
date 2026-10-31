-- Lot I3 (31/10/2026) : l'admin Luxyra n'a plus AUCUN droit d'écriture directe sur les données métier des établissements.
-- Inventaire préalable : admin.html n'écrit dans aucune de ces tables (seulement salons via saMaj, admin_*, support_*,
-- claude_demandes, demandes_essai, migration_requests, push_subscriptions) ; la vue admin (?vue_admin=) est en lecture
-- seule (bloquée côté app) ; worker et edge functions écrivent avec la clé service (RLS ignorée) ; les fonctions
-- SECURITY DEFINER ignorent la RLS. Aucune fonction DEFINER admin dédiée n'est donc nécessaire.
-- Lecture admin inchangée (policies SELECT intactes ; 2 policies de lecture ajoutées là où une policy ALL est retirée).
-- Idempotent. Retour arrière exact : i3_retour_arriere.sql.
BEGIN;


DROP POLICY IF EXISTS allow_delete_appointments ON public.appointments;
CREATE POLICY allow_delete_appointments ON public.appointments AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_appointments_insert ON public.appointments;
CREATE POLICY salon_appointments_insert ON public.appointments AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_appointments_update ON public.appointments;
CREATE POLICY salon_appointments_update ON public.appointments AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS cac_tenant_delete ON public.cartes_abo_clients;
CREATE POLICY cac_tenant_delete ON public.cartes_abo_clients AS PERMISSIVE FOR DELETE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS cac_tenant_insert ON public.cartes_abo_clients;
CREATE POLICY cac_tenant_insert ON public.cartes_abo_clients AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS cac_tenant_update ON public.cartes_abo_clients;
CREATE POLICY cac_tenant_update ON public.cartes_abo_clients AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))))
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS allow_delete_cartes_cadeaux ON public.cartes_cadeaux;
CREATE POLICY allow_delete_cartes_cadeaux ON public.cartes_cadeaux AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_gc_insert ON public.cartes_cadeaux;
CREATE POLICY salon_gc_insert ON public.cartes_cadeaux AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_gc_update ON public.cartes_cadeaux;
CREATE POLICY salon_gc_update ON public.cartes_cadeaux AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS cs_tenant_delete ON public.client_salon;
CREATE POLICY cs_tenant_delete ON public.client_salon AS PERMISSIVE FOR DELETE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS cs_tenant_insert ON public.client_salon;
CREATE POLICY cs_tenant_insert ON public.client_salon AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS cs_tenant_update ON public.client_salon;
CREATE POLICY cs_tenant_update ON public.client_salon AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))))
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_clients_delete ON public.clients;
CREATE POLICY salon_clients_delete ON public.clients AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_clients_insert ON public.clients;
CREATE POLICY salon_clients_insert ON public.clients AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_clients_update ON public.clients;
CREATE POLICY salon_clients_update ON public.clients AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS allow_delete_collaborateurs ON public.collaborateurs;
CREATE POLICY allow_delete_collaborateurs ON public.collaborateurs AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_collab_insert ON public.collaborateurs;
CREATE POLICY salon_collab_insert ON public.collaborateurs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_collab_update ON public.collaborateurs;
CREATE POLICY salon_collab_update ON public.collaborateurs AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS devis_tenant_delete ON public.devis;
CREATE POLICY devis_tenant_delete ON public.devis AS PERMISSIVE FOR DELETE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS devis_tenant_insert ON public.devis;
CREATE POLICY devis_tenant_insert ON public.devis AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS devis_tenant_update ON public.devis;
CREATE POLICY devis_tenant_update ON public.devis AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))))
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS fidelite_tenant_delete ON public.fidelite_client;
CREATE POLICY fidelite_tenant_delete ON public.fidelite_client AS PERMISSIVE FOR DELETE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS fidelite_tenant_insert ON public.fidelite_client;
CREATE POLICY fidelite_tenant_insert ON public.fidelite_client AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS fidelite_tenant_update ON public.fidelite_client;
CREATE POLICY fidelite_tenant_update ON public.fidelite_client AS PERMISSIVE FOR UPDATE TO authenticated
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))))
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS allow_delete_produits ON public.produits;
CREATE POLICY allow_delete_produits ON public.produits AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_produits_insert ON public.produits;
CREATE POLICY salon_produits_insert ON public.produits AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_produits_update ON public.produits;
CREATE POLICY salon_produits_update ON public.produits AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_operateurs_delete ON public.salon_operateurs;
CREATE POLICY salon_operateurs_delete ON public.salon_operateurs AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_operateurs_insert ON public.salon_operateurs;
CREATE POLICY salon_operateurs_insert ON public.salon_operateurs AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_operateurs_update ON public.salon_operateurs;
CREATE POLICY salon_operateurs_update ON public.salon_operateurs AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS allow_delete_services ON public.services;
CREATE POLICY allow_delete_services ON public.services AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_services_insert ON public.services;
CREATE POLICY salon_services_insert ON public.services AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_services_update ON public.services;
CREATE POLICY salon_services_update ON public.services AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_site_delete ON public.site_config;
CREATE POLICY salon_site_delete ON public.site_config AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_site_insert ON public.site_config;
CREATE POLICY salon_site_insert ON public.site_config AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_site_update ON public.site_config;
CREATE POLICY salon_site_update ON public.site_config AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS sms_queue_delete ON public.sms_queue;
CREATE POLICY sms_queue_delete ON public.sms_queue AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS sms_queue_insert ON public.sms_queue;
CREATE POLICY sms_queue_insert ON public.sms_queue AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS sms_queue_update ON public.sms_queue;
CREATE POLICY sms_queue_update ON public.sms_queue AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_clients_online_delete ON public.clients_online;
CREATE POLICY salon_clients_online_delete ON public.clients_online AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_clients_online_update ON public.clients_online;
CREATE POLICY salon_clients_online_update ON public.clients_online AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_rdv_delete ON public.rdv_online;
CREATE POLICY salon_rdv_delete ON public.rdv_online AS PERMISSIVE FOR DELETE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_rdv_update ON public.rdv_online;
CREATE POLICY salon_rdv_update ON public.rdv_online AS PERMISSIVE FOR UPDATE TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS messaging_log_insert ON public.messaging_log;
CREATE POLICY messaging_log_insert ON public.messaging_log AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_cmd_insert ON public.commandes_online;
CREATE POLICY salon_cmd_insert ON public.commandes_online AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((salon_id IN (SELECT s.id FROM salons s WHERE (s.user_id = auth.uid()))));

DROP POLICY IF EXISTS prix_historique_insert ON public.produits_prix_historique;
CREATE POLICY prix_historique_insert ON public.produits_prix_historique AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK ((produit_id IN (SELECT p.id FROM produits p WHERE (p.salon_id IN (SELECT s.id FROM salons s WHERE (s.user_id = auth.uid()))))));

DROP POLICY IF EXISTS sms_differes_salon ON public.sms_differes;
CREATE POLICY sms_differes_salon ON public.sms_differes AS PERMISSIVE FOR ALL TO public
  USING ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))))
  WITH CHECK ((salon_id IN (SELECT salons.id FROM salons WHERE (salons.user_id = auth.uid()))));

DROP POLICY IF EXISTS salon_cmd_delete ON public.commandes_online;

DROP POLICY IF EXISTS prix_historique_update ON public.produits_prix_historique;

DROP POLICY IF EXISTS prix_historique_delete ON public.produits_prix_historique;

DROP POLICY IF EXISTS lx_admin_tout ON public.client_duplicate_ignored;

DROP POLICY IF EXISTS migrated_invoices_admin_all ON public.migrated_invoices;

DROP POLICY IF EXISTS sms_differes_admin_lecture ON public.sms_differes;
CREATE POLICY sms_differes_admin_lecture ON public.sms_differes AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());

DROP POLICY IF EXISTS lx_admin_lecture ON public.client_duplicate_ignored;
CREATE POLICY lx_admin_lecture ON public.client_duplicate_ignored AS PERMISSIVE FOR SELECT TO authenticated
  USING (is_admin());

-- Contrôle : plus aucune policy d'écriture avec is_admin() sur ces tables
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM pg_policies WHERE schemaname='public' AND cmd<>'SELECT'
   AND tablename IN ('appointments','cartes_abo_clients','cartes_cadeaux','client_salon','clients','clients_online','collaborateurs','commandes_online','devis','fidelite_client','messaging_log','produits','produits_prix_historique','rdv_online','salon_operateurs','services','site_config','sms_differes','sms_queue','client_duplicate_ignored','migrated_invoices')
   AND (coalesce(qual,'')||coalesce(with_check,'')) ~ 'is_admin';
  IF n<>0 THEN RAISE EXCEPTION 'I3 : % policy(s) d''écriture admin restante(s)', n; END IF;
END $$;
COMMIT;
