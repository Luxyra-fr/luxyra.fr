# Audit du 14/10/2026 — ordre de mise en production (branche integ1014)

Aucun de ces fichiers n'est appliqué à la date de l'intégration. Suivre **exactement** cet ordre, sans sauter d'étape.
Principe : d'abord tout ce qui AJOUTE (compatible avec le code actuellement en ligne, branche `main`), puis le
nouveau code, et seulement à la fin ce qui RETIRE des droits utilisés par l'ancien code.
Chaque fichier SQL est une transaction unique (`BEGIN` … `COMMIT`) et peut être rejoué sans effet de bord.

## Étape A — SQL additif (compatible avec `main`)

| # | Fichier | Remarque |
|---|---|---|
| 1 | `secu.sql` | colonnes `clients_luxyra.session_version` / `verification_*` / `email_verified_legacy` ; **reprise des comptes existants** (créés avant le 15/10/2026 00:00 Paris) en `email_verified = true` + `email_verified_legacy = true` ; RPC PIN opérateurs ; lien fiche ↔ compte vérifié à la création ET à la modification (`trg_clients_a_lien_compte_verifie`) ; annuaire (nouvelles fonctions), support, `is_admin` 2FA |
| 2 | `donnees.sql` | définition UNIQUE de `public.fn_autolink_clients_luxyra` et du déclencheur UNIQUE `trg_autolink_clients_luxyra` (après création + au passage à « vérifié » ; jamais rejoué pour les comptes repris) |
| 3 | `planning.sql` | `lx_horaires_effectifs`, `lx_int_sur`, `rdv_online_block_double_booking` (conversions sûres, erreur tracée puis refus), `messaging_log.rdv_date` |
| 4 | `clients.sql` | anniversaires / relances serveur **inactifs** tant que `app_config.config->>'sms_auto_serveur'` n'est pas `true` (étape F) |
| 5 | `caisse.sql` | + entrée bot `integration_1014` |
| 6 | `site.sql` | `lx_prive.rdv_online_insert_public_propre` : acompte plafonné au prix et arrondi au centime, remise carte d'abonnement recalculée (même calcul que `lxCalcAcompte`) |
| 7 | `reglages.sql` | définitions UNIQUES de `fn_salon_next_slots` et `envoyer_rappels_24h` ; rappels 2 h / e-mail inactifs tant que `rappels_serveur_2h_email` n'est pas `true` |

Après l'étape A : `select * from public.nf525_tests_protections();` et les contrôles en lecture seule de fin de chaque fichier.

## Étape B — Edge functions (`docs/edge_1014/*`)

1. `lx-profile` (v9) **en premier** (vérification d'e-mail, session ; utilisé par le worker et les pages) ;
2. puis `lx-signup` (v10), `lx-login`, `lx-password-reset`, `avis-create` (v10), `client-mes-photos`,
   `rdv-demande-create`, `rdv-demande-proposal-action` (v13), `lx-error-report`.

## Étape C — Worker

`docs/luxyra-router-worker.js` (nécessite `site.sql` : colonnes `rdv_demandes.confirm_claim_at` / `stripe_session_id`).

## Étape D — Pages

`git push` des pages (`luxyra-supabase.js?v=20261014-8`, `lx-client.js?v=20261014-3`, `sw.js` cache
`luxyra-sw-shell-v23-2026-10-14`). Attendre que les appareils du parc aient rechargé (le service worker v23 remplace
l'ancien au prochain chargement) et vérifier une connexion opérateur (PIN) sur un appareil.

## Étape E — SQL restrictif (EN DERNIER)

| # | Fichier | Remarque |
|---|---|---|
| 8 | `secu_restrictif.sql` | retire : accès anonyme à `client_salon`, suppression anonyme de `rdv_online`, lecture de `salon_operateurs.pin_hash` (droits par colonne), exécution publique de `annuaire_signaler_ferme` / `annuaire_retirer` / `lx_email_deja_inscrit` / `get_monitoring_status` / `devis_expire_overdue`. Retour arrière documenté en fin de fichier. |

Les autres fichiers ne contiennent rien qui casse le code de `main` (vérifié : `donnees.sql`, `planning.sql`,
`clients.sql`, `caisse.sql`, `site.sql`, `reglages.sql` ne retirent aucun droit utilisé par l'ancien code).

## Étape F — Activations (facultatives, après l'étape D, de préférence le soir après 21 h)

- Anniversaires / relances SMS par le serveur (l'application cesse alors de les envoyer, même drapeau) :
  `UPDATE public.app_config SET config = config || '{"sms_auto_serveur": true}'::jsonb WHERE id = 1;`
- Rappels 2 h / e-mail par le serveur : bloc ACTIVATION en fin de `reglages.sql`.

## Historique de l'intégration

Fonctions définies dans deux fichiers avant l'intégration, désormais fusionnées dans le fichier appliqué en dernier :

- `public.fn_autolink_clients_luxyra` (+ déclencheur) : `secu.sql` -> `donnees.sql`
- `public.fn_salon_next_slots` : `planning.sql` -> `reglages.sql`
- `public.envoyer_rappels_24h` : `planning.sql` -> `reglages.sql`
- Retraits de droits de `secu.sql` -> `secu_restrictif.sql`

## Bot support (15/10/2026)
`bot_aide_1015.sql` : base du bot (`support_bot_kb`) alignée sur les changements des 13-14/10 et l'activation des rappels / SMS serveur. Indépendant des autres fichiers, sans effet sur la caisse ; à appliquer après la mise en production des pages, puis banc `lx-bot-eval`.
