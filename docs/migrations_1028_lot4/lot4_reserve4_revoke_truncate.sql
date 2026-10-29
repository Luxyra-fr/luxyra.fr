-- 2026-10-29 — réserve 4 du contre-audit final du lot 4 (« GO avec réserves non bloquantes ») : TRUNCATE (non soumis à la RLS ni
-- aux déclencheurs de ligne, dont factures_clients_inalterable) retiré aux rôles de l'API sur la table des factures clients.
-- APPLIQUÉ le 29/10/2026 à 05:36:14 UTC (migration lot4_reserve4_factures_clients_revoke_truncate), juste après lot4_protections.sql.
-- Contrôle : select has_table_privilege('anon','public.factures_clients','TRUNCATE'), has_table_privilege('authenticated','public.factures_clients','TRUNCATE'); -> false, false
-- Retour arrière (déconseillé) : grant truncate on public.factures_clients to anon, authenticated;
revoke truncate on public.factures_clients from anon, authenticated;
