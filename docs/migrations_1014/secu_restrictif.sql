-- ============================================================================
-- LUXYRA — Audit du 14/10/2026 — RETRAITS DE DROITS (à appliquer EN DERNIER)
-- ----------------------------------------------------------------------------
-- 2026-10-14 intégration : extrait de secu.sql. Ces instructions ne font QUE retirer des accès que l'ANCIEN code
-- (branche main : compte.html, site.html, inscription.html, admin.html, luxyra-supabase.js) utilise encore.
-- Les appliquer avant la mise en ligne casserait l'ancien code (fidélité du compte client, abandon de paiement,
-- connexion des opérateurs, inscription, annuaire, cockpit admin).
--
-- PRÉREQUIS (voir ORDRE.md) : fichiers SQL additifs appliqués, edge functions déployées, worker publié, pages
-- publiées (sw.js v23 : les appareils ont rechargé) — et la connexion d'un opérateur vérifiée sur un appareil.
--
-- IDEMPOTENT (drop policy if exists, revoke / grant rejouables). Aucune donnée modifiée.
-- RETOUR ARRIÈRE : voir le bloc en fin de fichier.
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- §4. client_salon : plus de lecture anonyme des fiches des autres, plus d'insertion anonyme
--     (points de fidélité / consentements falsifiables). Lecture et lien : worker /api/client/salons.
--     Ancien code concerné : compte.html (lecture client_salon), site.html (insertion client_salon).
-- ----------------------------------------------------------------------------
drop policy if exists cs_public_select on public.client_salon;
drop policy if exists anon_insert_client_salon on public.client_salon;
revoke all on public.client_salon from anon;
grant select, insert, update, delete on public.client_salon to authenticated; -- policies cs_tenant_* (établissement propriétaire / admin)
grant select, insert, update, delete on public.client_salon to service_role;

-- ----------------------------------------------------------------------------
-- §5. rdv_online : fin de la suppression anonyme (abandon de paiement via le worker /api/rdv/abandon).
--     Ancien code concerné : site.html (suppression du RDV en attente de paiement abandonné).
-- ----------------------------------------------------------------------------
drop policy if exists anon_delete_rdv_online on public.rdv_online;
revoke delete on public.rdv_online from anon;

-- ----------------------------------------------------------------------------
-- §6. salon_operateurs : pin_hash n'est plus lisible ; le verrouillage n'est plus modifiable directement.
--     Ancien code concerné : luxyra-supabase.js (operatorLogin lisait pin_hash, écrivait failed_attempts / locked_until).
--     La nouvelle couche données utilise operateur_verifier_pin / operateur_connexion_bio / operateur_debloquer
--     (secu.sql) et ne retombe sur l'ancienne lecture que si ces RPC sont absentes.
--     ATTENTION : toute NOUVELLE colonne de salon_operateurs devra être ajoutée à ces GRANT.
-- ----------------------------------------------------------------------------
revoke all on public.salon_operateurs from anon;
revoke select, update on public.salon_operateurs from authenticated;
grant select (id, salon_id, prenom, nom, email, avatar_color, avatar_initials, role, pin_length, permissions,
              collab_id, actif, failed_attempts, locked_until, last_login_at, created_at, created_by)
  on public.salon_operateurs to authenticated;
grant update (prenom, nom, email, avatar_color, avatar_initials, role, pin_hash, pin_length, permissions, collab_id, actif)
  on public.salon_operateurs to authenticated;
grant insert, delete on public.salon_operateurs to authenticated;
grant select, insert, update, delete on public.salon_operateurs to service_role;

-- ----------------------------------------------------------------------------
-- §7. ANNUAIRE : les anciennes fonctions (masquage immédiat par n'importe qui) ne sont plus exécutables depuis l'API.
--     Remplacées par annuaire_signaler / annuaire_retrait_demander (secu.sql) via le worker.
-- ----------------------------------------------------------------------------
revoke execute on function public.annuaire_signaler_ferme(text) from public, anon, authenticated;
revoke execute on function public.annuaire_retirer(text, text, text) from public, anon, authenticated;
grant execute on function public.annuaire_signaler_ferme(text) to service_role;
grant execute on function public.annuaire_retirer(text, text, text) to service_role;
-- annuaire_retraits : lecture admin seulement (droits d'écriture anon / authenticated retirés)
revoke insert, update, delete, truncate on public.annuaire_retraits from anon, authenticated;

-- ----------------------------------------------------------------------------
-- §8. Fonctions retirées de l'API publique
-- ----------------------------------------------------------------------------
-- lx_email_deja_inscrit : ancien inscription.html l'appelait directement ; désormais /api/inscription/email-check (worker).
revoke execute on function public.lx_email_deja_inscrit(text) from public, anon, authenticated;
grant execute on function public.lx_email_deja_inscrit(text) to service_role;

-- get_monitoring_status : ancien admin.html l'appelait directement ; désormais admin_monitoring_status() (secu.sql, admin 2FA).
revoke execute on function public.get_monitoring_status() from public, anon, authenticated;
grant execute on function public.get_monitoring_status() to service_role;

-- devis_expire_overdue : ancien luxyra-supabase.js l'appelait au chargement (pour tous les établissements) ;
-- désormais cron « devis_expire_overdue_nuit » (secu.sql).
revoke execute on function public.devis_expire_overdue() from public, anon, authenticated;
grant execute on function public.devis_expire_overdue() to service_role;

commit;

-- ============================================================================
-- CONTRÔLES APRÈS APPLICATION (lecture seule)
-- ============================================================================
-- select policyname, cmd, roles from pg_policies where tablename in ('client_salon','rdv_online');
-- select has_column_privilege('authenticated','public.salon_operateurs','pin_hash','select');   -- attendu : false
-- select has_function_privilege('anon','public.annuaire_retirer(text,text,text)','execute');     -- attendu : false
-- select has_function_privilege('anon','public.lx_email_deja_inscrit(text)','execute');         -- attendu : false
-- select has_function_privilege('anon','public.get_monitoring_status()','execute');            -- attendu : false
-- select has_function_privilege('authenticated','public.devis_expire_overdue()','execute');    -- attendu : false
-- Puis : connexion d'un opérateur (PIN) sur un appareil, Admin > Cockpit, inscription (e-mail déjà utilisé),
-- espace client (onglet fidélité), abandon d'un paiement d'acompte sur le site.
--
-- RETOUR ARRIÈRE (en cas de régression constatée, à adapter) :
--   grant select, update on public.salon_operateurs to authenticated;
--   grant execute on function public.lx_email_deja_inscrit(text), public.get_monitoring_status(),
--         public.devis_expire_overdue() to anon, authenticated;
--   -- policies d'origine (relevées dans pg_policies le 14/10/2026) :
--   create policy cs_public_select on public.client_salon for select to anon, authenticated using (true);
--   create policy anon_insert_client_salon on public.client_salon for insert to anon with check (true);
--   create policy anon_delete_rdv_online on public.rdv_online for delete to anon using (status = any (array['pending_payment','pending']));
--   grant select, insert on public.client_salon to anon;  grant delete on public.rdv_online to anon;
-- ============================================================================
