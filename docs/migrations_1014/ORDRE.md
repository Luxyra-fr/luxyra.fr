# Audit du 14/10/2026 — ordre d'application des scripts SQL (branche integ1014)

Aucun de ces fichiers n'est appliqué à la date de l'intégration. Les appliquer **dans cet ordre, sans en sauter**
(les fichiers suivants s'appuient sur les précédents) :

| # | Fichier | Remarque |
|---|---|---|
| 1 | `secu.sql` | idempotent ; colonnes `clients_luxyra.email_verified` / `session_version`, RPC PIN opérateurs, déclencheur `trg_autolink_clients_luxyra` |
| 2 | `donnees.sql` | contient la définition UNIQUE de `public.fn_autolink_clients_luxyra` (règles sécurité + données) ; `secu.sql` y renvoie |
| 3 | `planning.sql` | `lx_horaires_effectifs`, `lx_prive.confirmation_concerne_rdv`, `messaging_log.rdv_date` ; `fn_salon_next_slots` et `envoyer_rappels_24h` ne sont plus définies ici (voir 7) |
| 4 | `clients.sql` | |
| 5 | `caisse.sql` | |
| 6 | `site.sql` | `lx_prive.rdv_online_insert_public_propre` (seule définition) |
| 7 | `reglages.sql` | contient les définitions UNIQUES de `public.fn_salon_next_slots` (planning + fenêtre 1..365 j) et `public.envoyer_rappels_24h` (confirmation liée au RDV + `{collab}`) ; nécessite `planning.sql` |

Fonctions définies dans deux fichiers avant l'intégration, désormais fusionnées dans le fichier appliqué en dernier :

- `public.fn_autolink_clients_luxyra` : `secu.sql` -> `donnees.sql`
- `public.fn_salon_next_slots` : `planning.sql` -> `reglages.sql`
- `public.envoyer_rappels_24h` : `planning.sql` -> `reglages.sql`

Edge functions (`docs/edge_1014/*`) : une seule source par fonction ; `lx-signup` v10, `lx-profile` v9 et
`avis-create` v10 réunissent les modifications des lots « secu » et « site ». À déployer après les scripts SQL,
puis le worker (`docs/luxyra-router-worker.js`), puis les pages (couche données `luxyra-supabase.js` v=20261014-7).

Points d'attention :
- `reglages.sql` : les rappels serveur 2 h / e-mail restent inactifs tant que `app_config.config->>'rappels_serveur_2h_email'`
  n'est pas `true` (bloc ACTIVATION en fin de fichier).
- Après application : relancer les tests de protection NF525 (`nf525_tests_protections`) et les vérifications en lecture
  seule indiquées en fin de chaque fichier.
