# Luxyra — Mémoire projet pour Claude

> À lire en premier à chaque session. Ce fichier résume tout ce que tu dois savoir pour reprendre le travail rapidement. Garde-le à jour.

## Owner
- **Alexandre** — mobz57@hotmail.fr (compte Claude/Cowork)
- **contact@luxyra.fr** — compte Cloudflare / email opérationnel du projet

## Produit

Luxyra est un **logiciel SaaS de gestion pour salons de coiffure, barbiers, instituts de beauté, ongleries et bien-être**. Pitch commercial (tiré de `index.html`) : « Caisse NF525, agenda, réservation en ligne, fidélité, site vitrine. Dès 14,99€/mois. Sans commission. »

**Fonctionnalités principales identifiées dans le code :**
- Caisse (clôtures journalières, audit log)
- Agenda / rendez-vous (appointments)
- Réservation en ligne (rdv_online)
- Gestion clients + fidélité (points)
- Services + forfaits + packs clients (séances)
- Stock produits + mouvements de stock + fournisseurs
- Cartes cadeaux
- Collaborateurs + opérateurs avec login PIN
- Multi-tenant : 1 salon = 1 tenant isolé par `salon_id`
- PWA installable (mobile-first)
- Marketplace (intégration "BeautyPro" — à confirmer avec Alexandre)
- Crédits SMS
- Pages légales complètes (CGV, DPA, mentions, confidentialité, suppression de données)

## Stack technique

- **Frontend** : HTML/CSS/JS **vanilla** pur — pas de framework, pas de bundler, pas de build step
- **Backend** : **Supabase** (Postgres + Auth + Storage)
  - Projet : `kxdgjtvrkwugbifgppai.supabase.co`
  - La anon key est publique dans `luxyra-supabase.js` (normal pour Supabase — la sécurité repose sur RLS)
- **Hébergement** : **Cloudflare** (Pages probablement) sur `luxyra.fr` — géré manuellement par Alexandre
- **PWA** : service workers `sw.js` (app) et `admin/sw-admin.js` (admin)
- **Polices** : Google Fonts (Playfair Display, DM Sans, Cormorant Garamond, Nunito)
- **Style visuel** : noir + or (`#c8a84e`/`#d4a843`) — positionnement premium

## Arborescence clé

```
luxyra.fr/
├── index.html                  # Landing page (marketing)
├── site.html                   # Page site vitrine additionnelle (~1844 lignes)
├── app.html                    # ⚠ Appli principale (~17k lignes, 1.1 MB)
├── admin.html                  # Interface admin superuser (~1735 lignes)
├── admin/
│   └── sw-admin.js            # Service worker admin
├── inscription.html            # Flow signup salons (~528 lignes)
├── compte.html                 # Gestion compte utilisateur
├── marketplace.html            # Marketplace (701 lignes)
├── reset-password.html         # Reset mot de passe
├── clear.html                  # Utilitaire (probablement clear cache)
├── preview-email-confirmation.html
├── luxyra-supabase.js          # ⚠ Couche data (1334 lignes — auth + CRUD toutes tables)
├── supabase.min.js             # SDK Supabase vendored (à confirmer)
├── sw.js                       # Service worker app principal
├── manifest.json / manifest-app.json / manifest-admin.json
├── cgv.html, dpa.html, mentions-legales.html, politique-confidentialite.html, suppression-donnees.html
└── icon-*.png, luxyra-logo.png
```

## Schéma Supabase (tables utilisées dans `luxyra-supabase.js`)

| Table | Rôle |
|---|---|
| `salons` | Tenant racine (plan, status, is_free, sms_credits, config_json, user_id) |
| `collaborateurs` | Staff du salon |
| `services` | Services proposés |
| `forfaits` | Forfaits multi-séances |
| `packs_clients` | Packs achetés par clients (seances_utilisees, status) |
| `clients` | Clients du salon |
| `clients_beautypro` | Clients partagés plateforme BeautyPro (id = email) |
| `fidelite_client` | Points fidélité (lié à client_beautypro_id + salon_id) |
| `appointments` | Rendez-vous |
| `rdv_online` | Demandes de RDV via réservation en ligne |
| `produits` | Catalogue produits (stock) |
| `fournisseurs` | Fournisseurs |
| `mouvements_stock` | Historique mouvements stock |
| `cartes_cadeaux` | Cartes cadeaux |
| `clotures` | Clôtures caisse (numérotées) |
| `audit_log` | Log des actions (timestamp_action, salon_id) |
| `salon_operateurs` | Opérateurs avec PIN hashé par salon |

**Isolation tenant** : toutes les queries filtrent par `salon_id = _salonId` (cf. pattern dans `loadSalonData`). La sécurité **dépend des policies RLS Postgres** — à auditer (voir Todo).

## Auth flow

1. `checkSession()` au chargement → si session → `loadSalonData()`
2. Sinon → `showLoginScreen()` → `doLogin()` via `_sb.auth.signInWithPassword`
3. `_userId` → requête `salons` où `user_id = _userId` → `_salonId`
4. Gestion statuts : suspended → `showSuspendedScreen`, trial expired → `showTrialExpiredScreen`
5. Niveau 2 : opérateur avec PIN hashé (fonction `operatorLogin`)

## Point de vigilance sécurité

Commentaire trouvé dans `luxyra-supabase.js` :
```js
// Old vulnerable code removed: _sb.from("salons").update({plan, status}).eq("id", salon.id)
```
→ Le client ne doit JAMAIS pouvoir écrire `plan` ou `status` directement. À vérifier que les **policies RLS bloquent bien** ces champs (soit via edge function admin, soit via policy restrictive). Voir Todo.

## Comment développer / tester

**Pas de build**. Pour lancer en local :
```bash
cd luxyra.fr
python3 -m http.server 8080
# Ouvrir http://localhost:8080/index.html, app.html, etc.
```

**Tests** : aucun test unitaire. Tests = navigateur manuel + Supabase dashboard + vérif RLS.

## Commandes utiles

```bash
# Clone (repo public)
git clone https://github.com/Luxyra-fr/luxyra.fr.git

# Serveur local
python3 -m http.server 8080

# Lint JS (à installer si besoin)
npx eslint luxyra-supabase.js

# Compter les lignes par page
wc -l *.html *.js

# Chercher une table Supabase
grep -nE '\.from\("(nom_table)"\)' luxyra-supabase.js

# Voir l'historique récent
git log --oneline -20
```

## Déploiement

**Architecture réelle (important à ne PAS oublier)** :

```
utilisateur → luxyra.fr
               │
               ▼
     Cloudflare Worker "luxyra-router" (compte Contact@luxyra.fr)
               │ fetch depuis…
               ▼
     GitHub Pages → https://luxyra-fr.github.io/...
               │ hébergé par…
               ▼
     Repo GitHub Luxyra-fr/luxyra.fr (branche main)
```

**⚠️ GitHub Pages DOIT rester activé** (Settings → Pages → Deploy from a branch → main / root).
Le Worker Cloudflare `luxyra-router` fetch ses fichiers depuis l'URL GitHub Pages
(`luxyra-fr.github.io`). Si tu désactives GitHub Pages → le Worker renvoie 404
sur tout luxyra.fr.

**`.nojekyll` à la racine du repo** : empêche GitHub Pages de lancer Jekyll
(qui plantait sur `CLAUDE.md` et les mails d'erreur). Le site est servi tel quel.

**Pour les modifs Cloudflare Worker** : Claude donne les instructions précises,
Alexandre applique dans `dash.cloudflare.com → Workers & Pages → luxyra-router`.

## Connecteurs MCP

- **GitHub** : pas de connecteur officiel — utiliser `git` + `gh` CLI dans le sandbox. Repo public = pas d'auth requise pour lire.
- **Supabase** : connecteur disponible mais à reconnecter (cf. notes sessions précédentes).
- **Cloudflare** : pas de connecteur (conflit OAuth dans Edge). Alexandre gère manuellement.
- **Chrome** : disponible pour tests visuels live sur luxyra.fr.

## État courant / Todo

### ✅ Fait (sessions 2026-04-22 et 2026-04-23)
- [x] Audit RLS complet via connecteur Supabase
- [x] **Lot 1 RLS** : `admin_log`, `admin_shortcuts`, `salon_promotions`, `salon_admin_notes` durcis avec `is_admin()`
- [x] **Lot 2 RLS** : 8 tables tenant-scoped (`client_salon`, `fidelite_client`, `cartes_abo_clients`, `clients`, `clients_online`, `collaborateurs`, `rdv_online`, `demandes_essai`)
- [x] **Hotfixes Lot 2** : anon SELECT restauré sur `fidelite_client`/`cartes_abo_clients`/`client_salon` (lectures publiques du site vitrine) + anon UPDATE/DELETE restauré sur `rdv_online` (cancel/paiement par le client online) + anon INSERT sur `client_salon` (ensureClientSalon)
- [x] **Lot 3 — Edge Functions BeautyPro** :
  - `bp-signup`, `bp-login`, `bp-profile` déployées (verify_jwt: false)
  - Hashing passé de SHA-256 côté client à **PBKDF2 (120k itérations, salt aléatoire) côté serveur**
  - Tokens de session JWT HS256 signés (fallback sur `SUPABASE_SERVICE_ROLE_KEY` comme secret)
  - Migration automatique des hashes legacy (SHA-256 salted/unsalted → PBKDF2 au 1er login)
  - `bp-profile` actions supportées : `get`, `update`, `change_password`, `delete`, `remove_payment`, `toggle_notif`
  - Helper client : `bp-client.js` à la racine, window.BP.* API
  - Refactor `site.html`, `marketplace.html`, `compte.html` pour utiliser `BP.*` à la place des fetch directs
  - RLS `clients_beautypro` verrouillée : SELECT/UPDATE authenticated + trigger bloquant `password_hash`/`email`/`stripe_*` hors service_role
  - **Failles fermées** : plus moyen pour anon de dump les password_hashes ou modifier quoi que ce soit

### ✅ Fait (session 2026-04-23 suite)

- [x] **11 fonctions Postgres** : `SET search_path = public, pg_temp` sur `is_admin`, `trg_notif_rdv_online`, `notify_salon`, `expire_cartes_abo`, `fn_push_admin_reply`, `fn_touch_support_conv`, `notify_admins`, `trg_push_support_msg`, `escalate_to_human`, `trg_push_inscription`, `fn_trigger_bot_reply`
- [x] **Bucket `salon-documents`** : lockdown complet. Plus de listing public. SELECT/INSERT uniquement pour le salon owner sur sa sous-arborescence `documents/{salon_id}/*` ou admin. Les URLs publiques (`getPublicUrl()`) marchent toujours — c'est le bucket qui est public au niveau storage.buckets, pas les policies.
- [x] **Lockdown `salons`** : drop des 3 policies SELECT `USING true` (anon, authenticated, public). Anon lit maintenant via la vue `salons_public` qui expose uniquement les colonnes publiques (pas `user_id`, `plan`, `sms_credits`, `stripe_customer_id`, `documents_*`, `notes_admin`, etc.). Vue passée en `security_invoker = off` pour bypass RLS proprement. Refactor `site.html`, `inscription.html`, `compte.html` pour utiliser `salons_public`.
- [x] **Policies INSERT dupliquées nettoyées** : `factures_luxyra` (Service can insert → drop), `salons` (anon_insert_salons → drop, salon_insert suffit)

### ✅ Lot 4 — Hardening flow réservation en ligne (session 2026-04-23 fin)

**Failles observées côté client** (avant fix) : 10 attaques sur 11 passaient en anon via INSERT direct sur `rdv_online` :
- RDV dans le passé ❌ / beyond delai_max ❌ / hors horaires ❌ / dimanche fermé ❌
- Collab qui ne travaille pas ce jour ❌ / collab inexistant ❌ / service inexistant ❌
- `acompte_paye=true` sans paiement ❌ / double booking même slot ❌

**Défense en profondeur mise en place :**

1. **FK ajoutées** sur `rdv_online.collaborateur_id → collaborateurs(id)` et `rdv_online.service_id → services(id)` avec `ON DELETE SET NULL`.
2. **Index UNIQUE partial** `rdv_online_no_double_booking` sur `(salon_id, collaborateur_id, date_rdv, heure_rdv)` WHERE status ∉ ('cancelled','cancelled_by_client','done','completed','refused'). Bloque le double booking au niveau DB (race-safe).
3. **Trigger `rdv_online_validate()`** `BEFORE INSERT` SECURITY DEFINER qui valide :
   - Salon existe + status IN ('active','trial')
   - Service (si fourni) : appartient au salon, actif, book_online=true, show_site=true
   - Collaborateur (si fourni) : appartient au salon, actif=true
   - Date + heure respecte `delai_min_heures` et `delai_max_jours` de site_config
   - Jour ouvré selon horaires du collab (priorité) puis horaires du salon
   - Heure dans la plage ouverture/fermeture, durée ne dépasse pas la fermeture
   - Pas d'absence du salon (`fermeture_except`) ni du collab (`conge`/`absent_jour`/`absent`/`maladie`/`formation`) à cette date
   - `acompte_paye=true` nécessite au moins `stripe_payment_id` ou `stripe_token` (prévient le bypass naïf)
   - Bypass pour `service_role` (edge functions + admin via API)
4. **UX côté client** : `site.html` a maintenant une fonction `rdvErrorMessage()` qui traduit les erreurs Postgres/trigger en messages user-friendly. Après échec d'INSERT, `refreshRDV()` est appelé pour re-synchroniser et le calendrier rerender.

**Tests après fix** : 10/10 attaques bloquées avec messages clairs. Le cas légitime (RDV dans les horaires, futur, collab actif) passe bien.

### 🟠 Reste à faire (non bloquant)

- [ ] (long terme) Migrer BP vers Supabase Auth pour avoir reset-password natif + email verif + OAuth
- [x] **Stripe test-mode** : edge function `rdv-charge-acompte` déployée + configurée avec `STRIPE_SECRET_KEY` dans Supabase. Testée OK avec `tok_visa` → charge réel `ch_test_...` sur Stripe.

### 💰 Architecture paiement (à NE PAS oublier)

**Intention business** : les acomptes doivent arriver **directement sur le compte Stripe du salon** via Stripe Connect. Tant qu'un salon n'a pas `stripe_connect_status='active'`, ses acomptes tombent sur le compte Luxyra (flow Path B dégradé).

- **Path A** — salon avec Connect active → Cloudflare Worker `/api/stripe/connect-payment` → $$ direct salon
- **Path B** — salon sans Connect (ou `pending_verification`) → Supabase edge function `rdv-charge-acompte` → $$ sur compte Luxyra (temporaire)

Le choix Path A vs B est fait automatiquement dans `site.html` (ligne ~1347 vs ~1395) en fonction de `SALON.connectStatus`.

**Exemple actuel** : Excellence Coiffure (`e0cf27c7-...`) est en `pending_verification` → ses acomptes clients tombent sur le compte Luxyra. Alexandre doit soit (1) les reverser manuellement, (2) bloquer l'acompte online tant que Connect pas active.

### 📘 Documentation passage live

Fichier **`docs/PASSAGE_LIVE.md`** à la racine du repo : checklist complet des 3 valeurs à changer (Supabase secret, Cloudflare Worker secret, `pk_` dans site.html/marketplace.html), procédure, gestion Excellence Coiffure et autres salons pending, recommandations webhooks Stripe.
- [ ] Extension : appliquer la même logique sur `appointments` (table RDV internes au salon) via un trigger similaire si des salons saisissent des RDV en double par erreur.

### ✅ HIBP (HaveIBeenPwned) — implémenté côté edge functions

La feature Leaked Password Protection de Supabase est **payante (Pro plan $25/mois)**.
On l'a implémentée **gratuitement nous-mêmes** dans les edge functions :

- `bp-signup` v3 : check HIBP via k-anonymity API (5 premiers chars du SHA-1 seulement envoyés)
- `bp-profile` v3 (action=change_password) : même check sur le nouveau mdp

Si le mot de passe est dans la base HIBP, l'edge function retourne 400 avec message user-friendly.
Fail-open : si l'API HIBP est down, on laisse passer le signup (ne bloque pas l'app).

**Cela couvre les clients BeautyPro.** Les salon owners utilisent Supabase Auth natif (inscription.html via sb.auth.signUp) → eux sont protégés uniquement si tu upgrade en Pro.

### ⚠️ Warnings Postgres perf restants (non-bloquants, dette technique acceptée)

- **`auth_rls_initplan`** (~90) : les policies utilisent `auth.uid()` au lieu de `(select auth.uid())`. Optimisation mineure qui cache la valeur par-requête au lieu de par-ligne. À petite échelle (< 1000 lignes par table) l'impact est négligeable. Refactoring risqué (touche toutes les policies). À faire si perf devient un problème à l'échelle.
- **`multiple_permissive_policies`** (~53) : plusieurs policies permissives pour le même role/action sont OR-combinées par Postgres, évaluées toutes. Perf mineure. La plupart viennent du système admin + des rôles Supabase internes (`authenticator`, `dashboard_user`) qu'on ne peut pas toucher.
- **`unused_index`** (~28) : INFO only. Certains index existent mais sont peu utilisés actuellement. Peuvent devenir utiles quand le volume grandit.

**Conclusion** : `get_advisors security` ne retourne que **2 warnings "réels"** (SECURITY DEFINER view salons_public intentionnel + leaked_password qu'on a contourné via HIBP côté edge function). Tout le reste est soit légitime (INSERT publics pour formulaires) soit micro-optimisation acceptable à cette échelle.

### ⚠️ Warnings qui restent dans get_advisors mais légitimes

- **`salons_public` SECURITY DEFINER (ERROR)** : **INTENTIONNEL**. La vue ne sert que des colonnes publiques et filtre aux salons `status IN ('active','trial')`. C'est le bon pattern pour une vue publique anon-safe.
- **WARNINGS USING/WITH CHECK true sur INSERT publics** : tous légitimes — formulaires de signup ou booking où l'utilisateur n'est pas encore authentifié (`avis_salon`, `client_salon`, `clients_online`, `commandes_online`, `demandes_essai`, `inscriptions_log`, `rdv_online`, `salon_operateurs`, `salons.salon_insert`).
- **`clients_beautypro.bp_auth_update` USING true** : les champs sensibles (password_hash, email, stripe_*) sont bloqués par le trigger `bp_protect_sensitive`. Les champs non-sensibles (nom, prenom, telephone) peuvent être syncés par n'importe quel salon (pour la cohérence cross-salon) — acceptable.
- **`rdv_online.anon_update_rdv_online`** : permet au client public de modifier son RDV (annulation, demande de modification) — nécessaire pour la UX booking online.
- **`produits_prix_historique`, `factures_luxyra`** : INSERT via trigger SECURITY DEFINER ou service_role, donc la permissivité apparente est compensée.

### 📦 Edge Functions déployées

| Function | verify_jwt | Endpoints |
|---|---|---|
| `bp-signup` v3 | false | POST { email, password, ... } → { user, session_token } + **check HIBP** |
| `bp-login` v2 | false | POST { email, password } → { user, session_token } |
| `bp-profile` v3 | false | POST { session_token, action, ... } — action=change_password **check HIBP** |
| `rdv-charge-acompte` v1 | false | POST { salon_id, stripe_token, amount_eur, rdv_data } → charge Stripe + insert rdv. Requires `STRIPE_SECRET_KEY` env. |
| `send-push` | false | (existant) |
| `bot-reply` | true | (existant) |

### 📁 bp-client.js API (window.BP)

- `BP.signup(fields)` — create account + set session
- `BP.login(email, password)` — auth + set session
- `BP.get()` — refresh user profile
- `BP.update(patch)` — partial profile update
- `BP.changePassword(old, new)` — password change
- `BP.delete(password?)` — delete account
- `BP.removePayment()` — clear Stripe card
- `BP.toggleNotif(field, value)` — sms_ok/email_ok toggle
- `BP.logout()` — clear session + user
- `BP.hasSession()`, `BP.getUser()`, `BP.getToken()` — helpers

### À investiguer
- `marketplace.html` / intégration BeautyPro → système de clients cross-salon (email, password_hash, Stripe) — auth custom à refondre (cf. Lot 3)
- Taille de `app.html` (17k lignes monolithe) → éventuel split futur ?

## Migration SQL réutilisable

Historique migrations appliquées via MCP Supabase (ordre chronologique) :
1. `rls_lot1_admin_tables_tighten` (2026-04-22) — durcissement tables admin
2. `rls_lot2_tenant_hardening` (2026-04-22) — 8 tables tenant-scoped
3. `rls_lot2_hotfix_restore_anon_select` (2026-04-23) — hotfix régression (fidelite/cartes_abo/client_salon)
4. `rls_lot2_hotfix_rdv_online` (2026-04-23) — restaurer anon UPDATE/DELETE rdv_online
5. `rls_lot2_hotfix_client_salon_anon_insert` (2026-04-23) — restaurer anon INSERT client_salon
6. `rls_lot3_lock_clients_beautypro_v2` (2026-04-23) — lockdown BP + trigger protection champs sensibles
7. `fix_function_search_path_v2` (2026-04-23) — search_path fixé sur 11 fonctions
8. `lockdown_storage_salon_documents` (2026-04-23) — bucket docs lockdown tenant-scoped
9. `salons_public_expand_and_lockdown_v2` (2026-04-23) — expand view + drop 3 SELECT USING true on salons
10. `cleanup_duplicate_insert_policies` (2026-04-23) — nettoyage doublons factures_luxyra + salons
11. `rdv_online_hardening_fks_and_unique` (2026-04-23) — FK collab/service + index unique anti double-booking
12. `rdv_online_validation_trigger` + `rdv_online_validate_security_definer` + `rdv_online_validate_fix_nullcollab` (2026-04-23) — trigger BEFORE INSERT validant salon/service/collab/horaires/absences/délais
13. `perf_cleanup_fk_indexes_and_duplicates` (2026-04-23) — 21 index sur colonnes FK (admin_log, appointments, archives, avis_salon, cartes_cadeaux, collaborateurs, commandes_online, forfaits, inscriptions_log, packs_clients, produits, rdv_online, salon_admin_notes, salon_promotions, salons, services, sms_link_tokens, support_messages) + drop duplicate `idx_cbp_email`.
14. `clotures_add_raw_data` + `create_tickets_table_nf525` + `tickets_trigger_nf525` + `create_devis_table_nf525` + `create_tickets_attente_table` (2026-04-24/25) — système NF525 complet (tickets+devis+attente).
15. `rdv_online_validate_v2_exceptions` (2026-04-25) — refonte trigger validation booking : gère `ouverture_except` (override horaires d'un jour normalement fermé), `fermeture_except` salon vs collab spécifique, lecture `dateFrom/dateTo` ET `from/to` (compat camelCase frontend), coalesce(acompte_paye). 11 scenarios e2e validés.
16. `collaborateurs_anon_select_via_salons_public` (2026-04-25) — autorise anon SELECT sur collaborateurs ACTIFS des salons en `salons_public` (active/trial). Sans ça l'étape 2 du booking online n'affichait que "Pas de préférence" car la RLS originale exigeait `auth.uid() = salons.user_id`.

Commande utile pour re-auditer :
```sql
-- Trouver les policies restantes "USING true" problématiques
SELECT tablename, policyname, cmd, roles, qual, with_check
FROM pg_policies
WHERE schemaname='public'
  AND (qual='true' OR with_check='true')
  AND cmd IN ('UPDATE','DELETE','ALL');
```

## Historique des sessions

### Session 2026-04-22 (première session Luxyra dans Cowork)
- Alexandre veut avancer plus simplement en Cowork, avec tests autonomes
- Tentative connecteur Cloudflare → échec (conflit comptes Claude contact@luxyra.fr vs mobz57@hotmail.fr, puis erreur OAuth Cloudflare). **Plan B retenu** : Cloudflare géré manuellement par Alexandre.
- Repo cloné, architecture analysée, ce CLAUDE.md rédigé
- Lots 1 et 2 RLS appliqués

### Session 2026-04-23
- Connecteur Supabase enfin connecté → audit complet
- Lot 3 BeautyPro terminé : 3 edge functions + refactor 3 HTML + RLS lockdown + trigger protection
- Tests end-to-end via pg_net : signup / login / profile / change_password / legacy hash migration / erreurs → tous verts
- CLAUDE.md mis à jour
- Prochaine étape : commit + push, tests navigateur par Alexandre
