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
- Annuaire de salons partenaires (cross-tenant)
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
| `clients_luxyra` | Clients partagés plateforme Luxyra (legacy: BeautyPro) (id = email) |
| `fidelite_client` | Points fidélité (lié à client_luxyra_id + salon_id) |
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
  - Helper client : `lx-client.js` à la racine, window.LX.* API
  - Refactor `site.html`, `compte.html` pour utiliser `LX.*` à la place des fetch directs
  - RLS `clients_luxyra` verrouillée : SELECT/UPDATE authenticated + trigger bloquant `password_hash`/`email`/`stripe_*` hors service_role
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

Fichier **`docs/PASSAGE_LIVE.md`** à la racine du repo : checklist complet des 3 valeurs à changer (Supabase secret, Cloudflare Worker secret, `pk_` dans site.html/proposal.html), procédure, gestion Excellence Coiffure et autres salons pending, recommandations webhooks Stripe.
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
- **`clients_luxyra.bp_auth_update` USING true** : les champs sensibles (password_hash, email, stripe_*) sont bloqués par le trigger `bp_protect_sensitive`. Les champs non-sensibles (nom, prenom, telephone) peuvent être syncés par n'importe quel salon (pour la cohérence cross-salon) — acceptable.
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

### 📁 lx-client.js API (window.LX)

- `LX.signup(fields)` — create account + set session
- `LX.login(email, password)` — auth + set session
- `LX.get()` — refresh user profile
- `LX.update(patch)` — partial profile update
- `LX.changePassword(old, new)` — password change
- `LX.delete(password?)` — delete account
- `LX.removePayment()` — clear Stripe card
- `LX.toggleNotif(field, value)` — sms_ok/email_ok toggle
- `LX.logout()` — clear session + user
- `LX.hasSession()`, `LX.getUser()`, `LX.getToken()` — helpers

### À investiguer
- Intégration BeautyPro → système de clients cross-salon (email, password_hash, Stripe) — auth custom à refondre (cf. Lot 3)
- Taille de `app.html` (17k lignes monolithe) → éventuel split futur ?

## Migration SQL réutilisable

Historique migrations appliquées via MCP Supabase (ordre chronologique) :
1. `rls_lot1_admin_tables_tighten` (2026-04-22) — durcissement tables admin
2. `rls_lot2_tenant_hardening` (2026-04-22) — 8 tables tenant-scoped
3. `rls_lot2_hotfix_restore_anon_select` (2026-04-23) — hotfix régression (fidelite/cartes_abo/client_salon)
4. `rls_lot2_hotfix_rdv_online` (2026-04-23) — restaurer anon UPDATE/DELETE rdv_online
5. `rls_lot2_hotfix_client_salon_anon_insert` (2026-04-23) — restaurer anon INSERT client_salon
6. `rls_lot3_lock_clients_luxyra_v2` (2026-04-23) — lockdown BP + trigger protection champs sensibles
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

### Session 2026-04-27 — Multi-prestations chaînées en booking online (Planity-killer)
**Objectif** : permettre au client de réserver 2-3 prestations dans le même RDV (ex: Coupe + Couleur + Soin) sans avoir à prendre 3 RDV séparés. Dépasse Planity sur ce volet : nous avons aussi multi-services LIBRES en plus des forfaits prédéfinis.

**Changements DB** :
- Migration `rdv_online_add_items_jsonb` : nouvelle colonne `items JSONB` sur `rdv_online`. Format `[{service_id,nom,prix,duree,ordre}]`. Index GIN pour requêtes futures.
- Migration `rdv_online_validate_v3_multi_items` : trigger v3 qui boucle sur items[] si présent, valide chaque service (existence, salon, actif, book_online, show_site). Compat totale avec mono (items=null garde l'ancien comportement).

**Changements front (`site.html`)** :
- `booking.items[]` ajouté + helpers `bookingTotals()`, `bookingPrimaryNom()`, `bookingItemsPayload()`
- Step 1 refondu : checkbox + mini-cart sticky en bas avec récap (durée/prix totaux) + CTA "Continuer"
- Step 4 récap multi-aware : liste détaillée si plusieurs prestations
- 3 fonctions submit (submitBooking, submitWithStripe, processStripePayment) envoient `items` et calculent acompte sur le total
- Compat : si client coche 1 seule presta, UX strictement identique à avant
- CSS : `.book-cart` (sticky bottom), `.svc-card .chk` (checkbox visuelle)

**Changements front (`app.html`)** :
- SELECT polling rdv_online inclut maintenant `items`
- RDV_ONLINE map exposé `items` + `duree` aux consommateurs
- `service_nom` reste le combo concaténé "X + Y + Z" donc tout l'affichage existant marche sans refactor
- Bump cache-busting `v=20260427-01`

**Tests e2e** (5 scénarios via SET ROLE anon) :
1. ✅ Mono insert (régression) — items=null OK
2. ✅ Multi 2 services valides — items[] bien stocké en JSONB
3. ✅ Service d'un autre salon → rejeté ("Service inexistant id X")
4. ✅ Service inexistant → rejeté
5. ✅ Durée totale dépassant fermeture (17h45 + 30min vs fermeture 18h) → rejeté

**Reste à faire (futur)** :
- Optionnel : trigger Postgres qui copie auto rdv_online → appointments avec phases dérivées (pour intégration cabine totale)
- Optionnel : multi-collab chainé (la coloriste fait la couleur, le coiffeur fait la coupe)
- Optionnel : suggestions de combos populaires côté client ("Les clients ont souvent ajouté…")

### Session 2026-04-27 (suite) — RDV sur mesure (Planity-killer #2)
**Objectif** : pour les prestations qui ne peuvent pas être proposées en booking auto (combo soin pendant shampoing, demandes complexes), permettre à la cliente d'envoyer une demande libre que le salon traite à la main, puis envoyer une proposition payable d'un clic. Déclenche un workflow asynchrone qui débloque tous les cas où la femme d'Alexandre devait gérer manuellement sur LS Coiffure.

**Architecture** : nouvelle table `rdv_demandes` totalement séparée de `rdv_online`. Pas de touche au flow booking actuel. Quand cliente paie l'acompte, on crée un `rdv_online` final (réutilise le trigger v3 multi-items existant).

**Migrations DB** :
- `create_rdv_demandes_table` : table avec status (pending → proposed → confirmed/refused/expired/cancelled_by_salon), proposed_data JSONB, proposal_token unique, FK rdv_online_id, RLS verrouillée (anon INSERT only en pending, salon SELECT/UPDATE par auth.uid()), flag `site_config.accept_rdv_sur_mesure boolean default false`
- `trg_notif_rdv_demande` : trigger AFTER INSERT/UPDATE qui crée des notifs salon (pattern de trg_notif_rdv_online)
- `fix_sync_client_to_salon_genre_column` : correction d'un bug pré-existant qui cassait l'INSERT rdv_online avec client_luxyra_id (référence colonne `genre` qui avait été renommée `sexe`). Ajouté EXCEPTION handler fail-soft.

**Edge functions déployées** :
- `rdv-demande-create` v1 (verify_jwt: false, auth via session_token Luxyra) : POST { session_token, salon_id, demande_text, dispo_text } → INSERT en pending. Anti-spam 5 demandes pending/24h. Vérifie accept_rdv_sur_mesure activé.
- `rdv-demande-propose` v1 (verify_jwt: true, auth via JWT salon owner) : POST { demande_id, proposed_data } → UPDATE rdv_demandes status='proposed' + génère proposal_token (32 hex) + expires_at +72h → return proposal_url
- `rdv-demande-proposal-action` v3 (verify_jwt: false, auth par token) : POST { token, action: get|confirm|refuse } → expose la proposition par token, gère refus, gère paiement Stripe Charges API (Path B compte Luxyra) puis crée le rdv_online final.

**Front site.html (cliente)** :
- Bouton "✨ Demander un RDV sur mesure" sur step 1 booking si SITE_CFG.acceptRdvSurMesure
- Modal avec form (texte demande + dispos), gate auth Luxyra, hook post-login (rouvre modal si interrompu)
- Submit → fetch rdv-demande-create → confirmation "sous 24-48h"

**Front app.html (salon)** :
- Cartouche home "✨ X demandes sur mesure" si pending > 0
- Notif type `rdv_demande_new` avec bouton "Voir la demande"
- Modal détail avec composer (date/heure, multi-services à cocher, collab, %acompte, message libre)
- Auto-calcul durée totale + prix total + acompte
- Submit → fetch rdv-demande-propose → envoi email Brevo via /api/email/custom (Cloudflare worker) avec récap + lien proposal.html
- Bouton "Annuler la proposition" (status → cancelled_by_salon)
- Toggle dans Paramètres → Site → "Activer les RDV sur mesure" (default OFF)
- Realtime listener sur table rdv_demandes + polling 60s

**Nouvelle page** :
- `proposal.html` : standalone, lit le token depuis ?t=, affiche récap (salon + RDV + prestations + acompte + message), 2 actions principales (payer & confirmer / refuser). Stripe Elements intégré pour la saisie carte. Path B : débit sur compte Luxyra via Charges API (V1.5 = Connect).

**Email Brevo** : template HTML noir+or signature Luxyra, récap RDV + items + total + acompte, gros bouton "Voir et accepter cette proposition".

**Tests e2e validés via SQL/pg_net** :
1. ✅ INSERT anon en pending OK ; tentative status='confirmed' ou proposed_data direct = rejetées par RLS
2. ✅ Trigger notif crée bien "✨ Demande de RDV sur mesure" + "❌ Proposition refusée"
3. ✅ proposal-action GET (200) avec salon+demande+items
4. ✅ proposal-action REFUSE (200) → status='refused', refuse_reason stocké, notif refus créée
5. ✅ proposal-action CONFIRM sans acompte (200) → rdv_online créé via service_role bypass + items[] + status='confirmed' + rdv_demandes lié via rdv_online_id
6. ✅ Sécurité : propose sans JWT → 401, GET avec faux token → 404
7. ⚠️ CONFIRM avec acompte > 0 et token Stripe : non testé en DB (nécessite vrai navigateur + Stripe Elements). À tester par Alexandre avec sa carte test.

**Limites V1 documentées** :
- Stripe Connect non géré (V1.5) : tous les paiements vont sur compte Luxyra (Path B). À reverser manuellement aux salons.
- Pas d'envoi SMS rappel (V1.5)
- Photo d'inspiration cliente : champ DB existe (`photo_url`) mais upload UI à faire (V1.5)
- Pas de relance auto si cliente ne paie pas en 72h (V1.5)
- Pas de modification de proposition par la cliente (juste accepter/refuser)

**Cache-busting** : `v=20260427-02`

### Session 2026-04-27 (suite 2) — Phase 1 rebrand BeautyPro → Luxyra (cosmétique safe)
**Pourquoi** : le nom "BeautyPro" traîne dans le code (table `clients_luxyra`, edge functions `bp-*`, helper `lx-client.js`, `window.LX.*`) — c'est un legacy interne, l'utilisateur final voit toujours "Compte Luxyra" dans les UI. Alexandre veut nettoyer.

**Approche safe en 2 phases** (zéro casse pour les sessions actives, zéro impact production) :

#### Phase 1 — fait dans cette session
- DB : `CREATE VIEW clients_luxyra AS SELECT * FROM clients_luxyra` avec `security_invoker=on` (la RLS de la table source s'applique). La table physique n'est PAS touchée. FK / triggers / policies de la table inchangés.
- JS : ajout de `window.LX = window.LX` à la fin de `lx-client.js`. Ce sont les mêmes fonctions (pas une copie) : sessions, tokens, localStorage continuent de marcher exactement comme avant.
- Tout nouveau code peut utiliser `LX.signup()` et `clients_luxyra` sans risque.

#### Phase 2 — à faire dans une future session dédiée
- Migrer les call-sites JS : remplacer `LX.*` → `LX.*` dans `site.html`, `app.html`, `compte.html` (search-replace ciblé + tests Chrome bout-à-bout)
- Renommer la table physique : `ALTER TABLE clients_luxyra RENAME TO clients_luxyra` + drop de la vue alias (la table prend sa place). Risque modéré : à faire avec rollback préparé.
- Renommer les 3 edge functions : déployer `lx-signup`, `lx-login`, `lx-profile` (copies), migrer le code client puis supprimer les `bp-*`. Garder un délai de 24-48h entre les deux pour que les sessions JWT en cours expirent.
- Drop des références `BP` (alias JS) une fois toutes les migrations confirmées.

**Aucune action utilisateur requise** pour la Phase 1. Les sessions BP continuent de marcher tel quel. La phase 2 sera planifiée plus tard.

**Migrations DB de cette phase** :
- `create_clients_luxyra_view_alias` — vue lecture/écriture qui pointe vers `clients_luxyra`

### Session 2026-04-27 (suite 3) — Phase 2 rebrand BeautyPro → Luxyra (call-sites + edge functions)
**Phase 2A** — Migration cosmétique des call-sites HTML
- 30 occurrences `LX.*` migrées vers `LX.*` dans site.html (13), compte.html (14), inscription.html (1)
- Cosmétique pur, l'alias window.LX === window.LX étant déjà en place. Zéro impact fonctionnel.
- app.html non concerné (utilise Supabase Auth standard).

**Phase 2B** — Edge functions lx-* en miroir des bp-*
- Déployé `lx-signup`, `lx-login`, `lx-profile` v1 avec **exactement le même code** que les bp-* et le même `LX_SESSION_SECRET (legacy: BP_SESSION_SECRET accepté)`. Conséquence : les tokens JWT créés par lx-* sont vérifiables par bp-* et inversement.
- `lx-client.js` modifié : pointe maintenant sur les URLs `lx-*`. Les fonctions internes gardent les noms `bpSignup`, `bpLogin`, etc. (l'API publique window.LX / window.LX est inchangée).
- Les anciennes `bp-*` restent ACTIVES en parallèle pour rétro-compat (sessions JWT existantes, versions cachées de lx-client.js).

**Tests bout-en-bout Chrome (réels en prod)** :
1. ✅ Session existante créée par `bp-signup` survit après bascule vers `lx-profile`
2. ✅ `LX.get()` retourne le profil via `lx-profile` avec un JWT issu de `bp-signup` (interopérabilité confirmée)
3. ✅ `LX.signup()` crée un nouveau compte via `lx-signup`, retourne user + token
4. ✅ Aucune nouvelle exception console
5. ✅ Migration zéro-downtime, zéro-déconnexion

**Phase 3 — à faire dans une future session dédiée** (non urgent, après vérif que tout marche en prod plusieurs jours)
- Renommer la table physique : `ALTER TABLE clients_luxyra RENAME TO clients_luxyra` + drop la vue alias actuelle. Penser à la rétro-compat via une vue `clients_luxyra` qui pointe vers la nouvelle table le temps que toutes les références au nom legacy disparaissent.
- Supprimer les edge functions `bp-signup`, `bp-login`, `bp-profile` (après confirmation que plus rien ne les appelle).
- Renommer `lx-client.js` → `lx-client.js` + bump cache-busting.
- Supprimer l'alias `window.LX` (= window.LX seul).
- Renommer la variable interne `lx_id` dans le JWT payload en `lx_id` (avec migration douce : verifySession accepte les deux pour les sessions en cours).

**Migrations / déploiements de cette phase** :
- Edge functions ajoutées : `lx-signup`, `lx-login`, `lx-profile`
- Pas de migration DB (les noms physiques ne bougent pas en Phase 2)

**Build** : aucune des autres features n'a été touchée. Ce rebrand est strictement additif et cosmétique pour cette phase.

### Session 2026-04-27 (suite 4) — Inversion home + extraction page pro (refonte UX cliente-first)
**Constat** : la home `index.html` était une page commerciale dédiée aux pros — l'annuaire cliente était caché. Inversion à la Planity, mais avec touche Luxyra (pas de copie).

**Décisions produit** :
- Pas de comparatif vs concurrents (Alexandre : "on vend Luxyra, on est la nouveauté")
- Slogan "Réservez votre instant beauté" (court, premium, mémorable)
- Section "Pourquoi Luxyra" avec atouts uniques (multi-prestations, RDV sur mesure, paiement sécurisé, hébergé en France)

**NOUVEAU `index.html`** (annuaire cliente, ~430 lignes) :
- Hero noir+or avec slogan + barre de recherche premium glassmorphism (prestation/salon + ville)
- 5 chips métiers en quick filters
- Section "Découvrir" : 5 cards métier cliquables (icônes, descriptions courtes)
- Section "Pourquoi Luxyra" : 4 atouts uniques sans comparatif
- Section "Salons du moment" : chargement dynamique via `salons_public` (max 6)
- Bandeau pro en bas → /pro
- Footer avec liens légaux
- Recherche redirige vers `/recherche?q=&ville=` (Phase B finalisée avec carte Leaflet).

**NOUVEAU `pro.html`** (ex-index rafraîchi, ~445 lignes) :
- Title "Luxyra Pro — La solution tout-en-un"
- Hero "L'élégance au service de votre métier"
- 2 nouvelles fonctionnalités phares en tête de grille :
  • Multi-prestations en un seul RDV
  • RDV sur mesure
- **Section comparatif vs concurrents SUPPRIMÉE** (volonté Alexandre)
- Remplacée par "L'engagement Luxyra" : sans commission, France, tout intégré, mis à jour en continu
- Lien "Espace client" dans la nav vers `/`
- Reste : tarifs (Essentiel 14,99€ / Pro 24,99€), CTA, formulaire essai, FAQ

**Page legacy SUPPRIMÉE** (cleanup 28 avr 2026).

**Bug fixé en cours** : le SELECT `salons_public` avait un `.in('status', ['active','trial'])` superflu qui renvoyait 0 lignes silencieusement (la vue n'expose pas `status`, elle filtre déjà).

**Tests Chrome bout-en-bout (réels en prod)** :
- `/` charge bien l'annuaire cliente
- 1 salon affiché correctement (Excellence Coiffure, Sarreguemines, lien vers site.html)
- Search bar fonctionnelle, chips cliquables, redirections OK
- `/pro` charge bien le pitch pro avec 17 features cards (11 originaux + 2 phares + 4 atouts engagement)
- Pas de comparatif (vérifié)
- Multi-prestations + RDV sur mesure visibles
- Pricing, FAQ, formulaire inscription tous OK
- 0 erreur console JS
- Lien "Je suis un pro" dans nav home → /pro ✓
- Lien "Espace client" dans nav pro → / ✓

**Phase B (à faire dans une future session)** :
- Page `/recherche?metier=...&ville=...` dédiée avec **carte Mapbox interactive**
- Géocodage des salons (lat/lng) via Nominatim ou Mapbox Geocoding
- Filtres avancés (note, distance, ouvert maintenant, métier, prix)
- URL SEO `/coiffeur/paris-75` pour pages catégorie/ville (avec sitemap)

**Phase C** (encore plus tard) :
- Autocomplete temps réel dans la search bar (services + noms salons + villes)
- Booking inline depuis la fiche salon (sans changer de page)
- Avis clientes + scoring

### Session 2026-04-27 (suite 5) — Phase B annuaire : page /recherche avec carte Leaflet
**Objectif** : page de résultats dédiée avec carte interactive, filtres, URL params SEO-friendly.

**Migrations DB** :
- `salons_add_lat_lng_extend_public_view` : colonnes `salons.latitude`, `longitude`, `geocoded_at` + index spatial partial GIN sur (lat,lng) + extension de `salons_public` pour exposer lat/lng
- `salons_public_alter_security_invoker_off` : HOTFIX. Ma migration précédente avait basculé la vue en `security_invoker=on` ce qui cassait l'accès anon (la table salons est lockée). Remise en `=off` (la vue filtre déjà aux active/trial et n'expose pas les colonnes sensibles, donc anon-safe).

**Géocodage** :
- Excellence Coiffure géocodée via Nominatim OSM (gratuit, pas de clé API) → 49.1111370, 7.0668880

**Nouvelle page `/recherche.html`** :
- Layout split desktop (liste à gauche, carte à droite) + responsive mobile (toggle liste/carte avec bouton flottant)
- **Carte Leaflet** + tiles **CARTO Dark Matter** (gratuit, style sombre cohérent Luxyra)
- Markers SVG personnalisés noir+or par métier (emoji différent par catégorie)
- Cards salons avec thumbnail logo, métier, nom, adresse, CTA "Voir le salon"
- Hover card → highlight marker (transform scale + glow)
- Click marker → popup Leaflet stylé Luxyra avec récap + bouton réservation
- 6 pills filtres métier + filtre actif visuel + count résultats
- Search bar header (nom/prestation + ville)
- URL params persistés `?metier=&q=&ville=` (replaceState pour ne pas polluer l'historique)
- Auto-fit bounds sur les markers visibles, zoom 14 si 1 seul, vue France si vide
- Fallback message "Aucun salon" engageant

**Mise à jour `index.html`** :
- `doSearch()` et `quickSearch()` redirigent vers `/recherche.html`
- Page legacy reste accessible (rétro-compat)

**Tests Chrome bout-en-bout (réels en prod)** :
1. ✅ `/recherche.html` charge, carte Leaflet visible, header + filtres présents
2. ✅ `?metier=coiffure` filtre actif et 1 résultat (Excellence Coiffure)
3. ✅ Card affichée correctement (logo, métier, nom, adresse complète, CTA)
4. ✅ Marker visible sur la carte avec auto-zoom niveau 18 sur le salon unique
5. ✅ Filtre "Barbier" → 0 résultat, message empty engageant affiché
6. ✅ Filtre "Tous" → 1 résultat retrouvé, URL nettoyée
7. ✅ `highlightSalon()` → card.highlight visible + popup Leaflet ouvert
8. ✅ Hover card synchronise marker.active

**Phase C (à faire dans une session future)** :
- URL SEO `/coiffeur/paris-75` via Cloudflare Worker (pattern `/{metier}/{ville}-{cp}`)
- Cluster markers quand beaucoup de salons (Leaflet.markercluster)
- Filtres avancés (note, distance, ouvert maintenant, prix)
- Autocomplete temps réel dans la search bar
- Géocodage automatique des nouveaux salons à l'inscription (trigger Postgres ou edge function)
- Fiche salon avec mini-map intégrée (la lat/lng est désormais dispo)

### Session 2026-04-27 (suite 6) — Hotfixes UX page recherche (logos + carte FR)
**Retours visuels Alexandre après test** :
- Logo Excellence Coiffure cropé dans la card (cover qui rogne)
- Régions affichées en anglais sur la carte (London, Brittany, etc.)
- Position du salon imprécise (mauvais côté de la rue)

**Fixes** :
1. `.salon-thumb img` : `object-fit: cover` → `contain` + `max-width/height` + padding 6px. Logos désormais affichés ENTIERS quel que soit leur ratio.
2. Tile layer : CARTO Dark Matter (anglais) → **OSM France** (`https://tile.openstreetmap.fr/osmfr/{z}/{x}/{y}.png`) qui a les labels en français natif. Pour conserver le rendu sombre cohérent Luxyra : filter CSS sur `.leaflet-tile-pane` (les markers sont sur `.leaflet-marker-pane` séparé donc PAS affectés). Filter testé : `invert(0.94) hue-rotate(180deg) saturate(0.55) brightness(0.92) contrast(0.92)`.
3. Position : vérifié via **BAN (api.adresse.data.gouv.fr)** — score 0.96, mêmes coordonnées que Nominatim. C'est la donnée publique correcte mais le marker pointe au centre du tronçon de rue, pas du côté précis du numéro. Solution propre : Phase D = UI ajustement manuel.

### Phase D (à faire dans une session future) — UI géolocalisation salon
- Dans Paramètres → Site (app.html), afficher une mini-map Leaflet centrée sur les coordonnées actuelles du salon
- Marker draggable : le salon ajuste sa position au pixel près
- Champ texte adresse + bouton "Re-géocoder via BAN" pour recalculer auto si l'adresse change
- À l'inscription d'un nouveau salon (`inscription.html`) : géocodage automatique via BAN dès la saisie de l'adresse
- Optionnel : trigger Postgres `BEFORE UPDATE` qui re-géocode si `adresse/cp/ville` changent (via pg_net + BAN)

### Session 2026-04-27 (suite 7) — Phase D : géocodage automatique salon (commercialisation)
**Objectif** : zéro intervention salon pour la localisation. Il s'inscrit, sa position apparaît automatiquement sur la carte de recherche.

**Phase D-1** : géocodage auto à l'inscription (`inscription.html`)
- Fonction `geocodeBANSafe(adresse, cp, ville)` : appelle BAN api.adresse.data.gouv.fr (gratuit, public, sans clé). Timeout 5s, fallback gracieux si BAN down → salon créé sans coords (rattrapable plus tard via Paramètres).
- Au submit final (étape contrat signé), le frontend géocode AVANT l'INSERT salon. lat/lng/geocoded_at sont enregistrés directement.
- Test live confirmé : "1 rue de la Paix 75002 Paris" → lat 48.868546, lng 2.33031, score 0.96.

**Phase D-2** : UI ajustement marker dans Paramètres (`app.html` rSettings)
- Nouvelle section "📍 Votre emplacement sur la carte" sous "RDV sur mesure"
- Mini-map Leaflet **lazy-loaded** (CSS+JS chargés à la demande, pas de coût initial sur les autres pages de l'app)
- Tiles OSM France (labels FR) — pas de clé API
- Marker **draggable** : drag end → save lat/lng en DB direct
- Click sur la carte = pose le marker à cet endroit (pour les salons sans coords)
- Bouton "🔄 Recalculer depuis mon adresse" qui re-appelle BAN
- Status visuel : détecte/enregistre/erreur, score précision affiché en %
- Coords affichées (debug visuel) en bas
- Auto-géocodage si pas de coords initiales lors du premier accès aux Paramètres
- Si pas d'adresse renseignée OU BAN down : vue France, instructions pour cliquer la carte

**Helper réutilisé** : `geocodeBANSafe` est dupliquée dans inscription.html ET app.html (15 lignes chacune). Pas de fichier util.js partagé pour rester simple — à factoriser plus tard si la fonction grossit.

**Cache-busting** : `v=20260427-03`

**Pour Excellence Coiffure** (déjà géocodé au centre de la rue) : Alexandre/sa femme peut maintenant aller dans Paramètres → "📍 Votre emplacement sur la carte" et glisser le marker du côté correct de la rue Nationale. Le drag end sauvegarde immédiatement.

### Session 2026-04-27 — Récap final commits poussés ce soir
1. `381d11d` — feat(booking): multi-prestations chaînées
2. `0ab01f7` — feat(rdv-sur-mesure): demande libre + proposition + paiement
3. `d536f4e` + `6c7c27d` — fix(proposal): échappement apostrophes JS
4. `d897d22` — chore(rebrand) Phase 1 : alias window.LX + view clients_luxyra
5. `5b25cdf` — chore(rebrand) Phase 2A : 30 call-sites BP→LX dans HTML
6. `5d37595` — chore(rebrand) Phase 2B : lx-client.js → lx-* edge functions
7. `c030047` — docs(rebrand): trace Phase 2
8. `fa22979` — feat(home): inversion home → annuaire cliente, pitch pro déplacé sur /pro
9. `62a75ce` — fix(home): retirer filtre status superflu sur salons_public
10. `e2701c5` — docs: trace inversion home + extraction pro
11. `562109e` — feat(search): page /recherche avec carte Leaflet + filtres + redirection
12. `9d22647` — docs: Phase B annuaire + carte Leaflet
13. `ca70596` — fix(search): logo entier + carte FR (OSM France) + filter sombre
14. `a0f43e7` — docs: hotfixes UX recherche + Phase D
15. `0925626` — feat(geo): géocodage auto inscription + UI ajustement marker dans Paramètres

Total : 15 commits, ~3000 lignes de code, 5 nouvelles features majeures, 2 hotfixes, doc complète.

### Session 2026-04-27 (suite 8) — Refonte fiche salon site.html (pages séparées pro)
**Demande Alexandre** : "rien d'ordonné par section c'est pas top". Mais aussi : "j'aime pas les longues pages comme LS Coiffure, je préfère plusieurs sections".

**Décisions produit** :
- Garder le système multi-pages (Accueil / Tarifs / Boutique / Réserver / Compte)
- Améliorer chaque page individuellement
- Sticky chips catégories sur Tarifs validé
- Pas de description par prestation (juste nom + durée + prix)
- Nom "Tarifs" gardé

**Refonte Page Accueil** :
- Hero clean : métier · ville en label, nom big serif, sous-titre/slogan, adresse, étoiles+avis si dispo
- Bloc "Le salon" : description courte
- Bloc "L'équipe" : grid avatars + noms
- Bloc "Le salon en images" : grid photos (1, 2 ou N colonnes selon nb)
- Bloc "Comment nous trouver" : split mini-map Leaflet (lazy-loaded) + horaires (jour actuel surligné gold) + contact (tél/email cliquables)
- 2 CTAs hero : "Voir les tarifs" (outline) + "Prendre rendez-vous" (gold)

**Refonte Page Tarifs** :
- Sticky chips catégories en haut (z-index 30, backdrop-blur)
  → cliquer une chip scroll smooth vers la section avec offset sticky
  → IntersectionObserver met à jour la chip active selon scroll
- Compteur en sous-titre : X prestations · Y catégories
- Liste organisée par catégorie : titre + lignes
  Chaque ligne : nom + durée (⏱ X min) + prix gold + bouton "Réserver"
- Bouton "Réserver" appelle goToBookingWithService(id) qui :
  1. Reset booking, ajoute la presta via toggleService
  2. Affiche page booking step 1 avec presta déjà cochée

**Bugs trouvés et fixés en cours** :
1. Apostrophe non échappée dans `'L'équipe'` (string JS) → `'`
2. Apostrophe dupliquée dans `'aujourd'hui':''` → fix ciblé
3. `loadSalon()` mappait `s.telephone` mais la vue expose `s.tel` → fallback sur les deux
4. `loadSalon()` ne mappait PAS latitude/longitude/note_moyenne/nb_avis depuis salons_public
5. `initSalonMiniMap` se déclenchait avant que SALON soit peuplé → déplacé à la fin de renderSite()

**Tests Chrome bout-en-bout (en prod)** :
- ✅ Hero "Excellence Coiffure" + 2 CTAs (Voir tarifs + Prendre RDV)
- ✅ 3 blocks accueil : Le salon / L'équipe / Comment nous trouver
- ✅ 2 équipiers visibles
- ✅ Mini-map Leaflet : 6 tiles affichées + marker visible + coords correctes
- ✅ Page Tarifs : 2 chips (Brushing, Soins), 6 lignes prestations, 6 boutons "Réserver"
- ✅ Sample row : "Brushing court / ⏱ 20 min / 22.00 €"

**Helpers JS ajoutés** :
- `escapeHtmlSimple` / `escapeAttrSimple`
- `goToBooking()` / `goToBookingWithService(svcId)`
- `scrollToTarifCat(cat)` / `initTarifsScrollSpy()`
- `initSalonMiniMap()` / `_renderSalonMiniMap(lat, lng)`
- `adrFromSalon(s)`

### Session 2026-04-27 (suite 9) — Hotfixes critiques + validation nouveau salon
**Bugs critiques découverts en testant** :

1. **Whitelist `services_en_ligne` obsolète** masquait des prestations actives :
   - site.html chargeait toutes les prestations puis filtrait via `SITE_CFG.svcOnline` (= `site_config.services_en_ligne`)
   - Excellence Coiffure avait 9 ids whitelistés sur 38 services actifs → 29 prestations cachées
   - **Fix** : SELECT côté DB avec `actif=true AND book_online=true AND show_site=true`. La whitelist legacy n'est plus appliquée. Defaults DB sont à `true` sur les 3 flags donc tout nouveau service apparaît automatiquement.

2. **Bug bloquant inscription nouveau salon** :
   - `inscription.html` envoyait `telephone:DATA.tel.trim()` à l'INSERT salon
   - Mais la table `salons` a la colonne `tel`, pas `telephone`
   - **Toute tentative de signup échouait** avec `42703: column "telephone" does not exist`
   - **Fix** : `telephone` → `tel` dans le payload INSERT salon (ligne 374). La colonne `telephone` reste dans inscriptions_log car cette table-là a bien `telephone`.

**Test bout-en-bout nouveau salon** (créé via INSERT direct DB simulant post-inscription) :
- ✅ Salon "Test Beauté Paris" créé avec lat/lng pré-géocodées
- ✅ Hero affiché : "Test Beauté Paris" + "Institut de beauté · Paris"
- ✅ 2 CTAs visibles
- ✅ 3 blocs Le salon / L'équipe / Comment nous trouver
- ✅ Mini-map Leaflet affichée avec marker
- ✅ 1 collaborateur (Sophie) visible dans Équipe
- ✅ 3 services visibles (Épilation, Corps, Visage)
- ✅ Page Tarifs : 3 chips sticky + 3 catégories + 3 lignes prestations + 3 boutons Réserver
- ✅ Téléphone 0140000000 affiché correctement
- ✅ 0 erreur console

**Defaults DB confirmés** sur la table services : `actif`, `book_online`, `show_site` sont tous à `true` par défaut. Donc tout pro qui crée une nouvelle prestation dans son app la voit automatiquement sur le site cliente.

**Pour la commercialisation** : un pro qui s'inscrit aujourd'hui obtient automatiquement :
- Sa fiche site.html?s=ID accessible
- Hero pro avec ses infos
- Mini-map à sa position (via géocodage BAN au signup)
- Page Tarifs vide tant qu'il n'a pas créé de service, puis chaque service apparaît auto avec bouton Réserver
- Booking flow fonctionnel

### Session 2026-05-22 — Liaison comptes Luxyra ↔ salon, points/factures, RDV bidirectionnels, fixes

Travail fait via Cowork (accès Supabase MCP + GitHub push + auto-deploy Worker).

**0. Astuce — session Cowork qui plante**
Si l'app Claude crashe à l'ouverture d'une session lourde : le fichier `audit.jsonl` (à la racine du dossier de session) peut atteindre plusieurs Go et saturer la RAM. Le renommer (`audit.jsonl` → `audit.jsonl.bak`) débloque l'ouverture sans rien perdre (ce n'est qu'un journal d'audit, pas la conversation). Réversible.

**1. Bug fuseau horaire — règle des 2h (corrigé en base)**
`rdv_online_validate()` comparait l'heure du RDV (heure de Paris) à `CURRENT_TIMESTAMP` en **UTC** → la règle du délai min (`delai_min_heures`) n'était pas réellement appliquée. Migration `fix_rdv_online_validate_timezone_paris` : "maintenant" calculé via `CURRENT_TIMESTAMP AT TIME ZONE 'Europe/Paris'`.

**2. Alerte monitoring trompeuse (corrigé en base)**
`check_quotas()` flaguait les salons Pro avec Connect `payouts_pending` et affichait "réservations en ligne désactivées" (FAUX — rien n'est désactivé, le site accepte `payouts_pending`). Migration `fix_check_quotas_stripe_connect_misleading_alert` : `payouts_pending` ajouté aux statuts OK + message corrigé ("encaissement acomptes en ligne indisponible, les réservations fonctionnent normalement").

**3. Liaison automatique comptes Luxyra ↔ fiches salon**
Avant : `lx-signup` créait un compte `clients_luxyra` SANS le relier à la fiche salon existante (`clients`). Résultat : pas de points/factures/historique côté client.
- **Schéma** : `clients.client_luxyra_id` (uuid) relie une fiche salon à un compte Luxyra. Colonnes normalisées générées : `telephone_norm`, `email_norm`, `nom_norm`, `prenom_norm` (NE PAS écrire `*_norm` directement, elles sont GENERATED).
- **Trigger** `fn_autolink_clients_luxyra` (AFTER INSERT ON clients_luxyra) — migrations `autolink_clients_luxyra_to_salon_clients` puis `autolink_v3_fix_generated_email_norm` :
  - relie par **téléphone normalisé** (chiffres uniquement) OU **email** (insensible casse)
  - la fiche salon **adopte l'email du compte Luxyra** (le plus récent)
  - recopie `clients.points_fidelite` → `fidelite_client` sous l'email de connexion Luxyra
- **Backfill** des comptes existants : migration `backfill_linked_clients_email_and_points_v2`.

**4. Points fidélité en ligne — GOTCHA important**
`fidelite_client.client_luxyra_id` est un **TEXT contenant l'EMAIL** (pas l'uuid). Le Worker `handleClientFidelite` cherche les points par **l'email de connexion Luxyra**. Si l'email salon ≠ email Luxyra, les points ne remontaient pas. Fix = synchro email (point 3) + re-clé des lignes `fidelite_client` vers l'email de connexion. Source de vérité = `clients.points_fidelite` (salon) ; `fidelite_client` est le miroir en ligne.

**5. Factures en salon en ligne** : `/api/client/tickets` cherche par email → la synchro d'email (point 3) les fait remonter automatiquement. Pas de modif Worker nécessaire pour ça.

**6. RDV bidirectionnels**
- **Sens B (RDV en ligne → fiche client salon)** : `app.html`, fonction `rDetail` — `_nextRdvs` inclut désormais les `RDV_ONLINE` du client (match tél/email). Aussi : le statut "perdu/risque" d'un NOUVEAU client tient compte des RDV en ligne (`hasFuture`).
- **Sens A (RDV salon → compte en ligne)** : Worker `handleClientRdvs` renvoie aussi les `appointments` (RDV salon à venir) des fiches reliées, avec drapeau `_salon_rdv:true`. `compte.html` affiche ces RDV en **lecture seule** (pas de bouton Modifier/Annuler qui taperait sur rdv_online).

**7. Pipeline auto-deploy Worker (IMPORTANT)**
`.github/workflows/deploy-worker.yml` déploie automatiquement le Worker `luxyra-router` à chaque push de `docs/luxyra-router-worker.js` (ou `wrangler.toml`). Secrets requis dans GitHub : `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (configurés). `wrangler.toml` ne touche NI aux routes NI aux secrets (déploie juste le code). → **Pour modifier le Worker : éditer `docs/luxyra-router-worker.js` + push, ça se déploie tout seul.** Plus besoin de manip manuelle Cloudflare.

**Note réseau** : depuis le sandbox Cowork, `api.cloudflare.com` et `api.github.com` sont bloqués (proxy 403). On ne peut donc pas déployer Cloudflare ni lire l'API GitHub Actions directement — mais `git push` sur github.com fonctionne, et l'auto-deploy prend le relais.

**Limite connue restante** : les RDV à venir pris EN SALON (table appointments) n'apparaissaient pas dans le compte en ligne avant le sens A. Maintenant ✅. Les RDV salon y sont en lecture seule (modif/annulation à faire par le salon).

### Session 2026-05-22 (suite) — VRAI bug réservation résolu + planning live + UX inscription

**🔴 CAUSE RACINE des échecs de réservation des clientes (enfin trouvée, reproduite en live) :**
Le site faisait `sb.from("rdv_online").insert(data).select()`. Le `.select()` = INSERT avec **RETURNING** → PostgREST doit **relire la ligne insérée**. Or la policy RLS de lecture (`salon_rdv_select`) n'autorise que le propriétaire du salon (`auth.uid()`), PAS le rôle `anon`. Une cliente sur le site = `anon` → la relecture échoue → `new row violates row-level security policy for table "rdv_online"`.
- L'INSERT seul (with_check=true) passe ; c'est la **relecture** qui cassait.
- Marchait pour Alexandre car il testait connecté à son compte propriétaire (rôle `authenticated`, autorisé à lire). Les clientes = `anon`.
- ⚠️⚠️ **NE JAMAIS remettre `.select()` (ni `return=representation`) sur un INSERT fait en rôle `anon`** sur rdv_online (ou toute table sans policy SELECT anon). Sinon le bug revient.

**FIX appliqué (site.html)** : id de la réservation **généré côté navigateur** (`_lxNewId()` = crypto.randomUUID) + suppression du `.select()` sur les 2 inserts (submitBooking + submitWithStripe). Plus de RETURNING → plus de relecture → anon peut réserver. Vérifié en live (réservation anon en navigation privée → OK).

**Méthode de debug (pour la prochaine fois)** : tester l'insert en **rôle anon réel** : `DO $$ BEGIN SET LOCAL role anon; INSERT ... RETURNING id INTO x; ... END $$;`. Tester en service_role (le défaut du MCP) **bypasse la RLS** et masque le bug.

**Monitoring** : les échecs de réservation sont maintenant loggés dans `server_errors` via `lx-error-report` (helper `_resaFail` dans site.html, appelé sur échec d'insert + échec paiement). Avant, un échec de résa ne laissait AUCUNE trace (le monitoring ne capte que les erreurs JS/serveur, pas les rejets applicatifs).

**Trigger durci** : `auto_link_client_salon` est passé en **SECURITY DEFINER** (migration `harden_auto_link_client_salon_security_definer`). Avant, il s'exécutait en `anon` et dépendait d'une policy RLS anon sur `client_salon` → fragile au durcissement RLS.

**Planning en direct (app.html)** : le poll des RDV en ligne (toutes les 30s) ajoute désormais les nouveaux RDV à `AP` (`_lxOnlineToAP(rdv)`) + appelle `refreshCurrentView()` → le RDV en ligne apparaît sur le planning sans recharger (≤30s). NB : `loadSalonData` (luxyra-supabase.js) fusionne déjà rdv_online pending/confirmed dans AP au chargement complet.

**UX inscription (compte.html)** : options du `<select>` genre lisibles sur fond sombre (`.fg select option{background:#1a1a2e;color:#f5f0e8}`) + `showErr` fait un `scrollIntoView` (le message d'erreur HIBP "mot de passe exposé" était hors écran). Bouton "Voir mon compte" ajouté sur la page de confirmation de résa.

**Notes :**
- `last_login` (clients_luxyra) n'est rempli QUE par `lx-login` (connexion explicite). L'inscription (`lx-signup`) auto-connecte SANS le remplir → NULL pour les comptes qui n'ont jamais re-loggé. Normal.
- Genre vide sur certains comptes : l'inscription rapide du site (`showAuthModal`) ne demande pas le genre ; seul `/compte` le demande. Genre optionnel.
- Réseau sandbox Cowork : `api.cloudflare.com` ET `api.github.com` bloqués (proxy 403). Déploiement Worker = via push GitHub → workflow `deploy-worker.yml` (auto). Lecture API GitHub Actions impossible depuis le sandbox → vérifier l'onglet Actions manuellement.

---

## À TRAITER (noté 2026-07-16) — Clôture Z d'une journée OUBLIÉE

**Problème constaté (Alexandre) :** que se passe-t-il si un salon oublie de clôturer le soir ?

**Comportement actuel vérifié dans le code :**
- `cloturerJournee()` (app.html ~L31261) filtre `a.date===TD` où `TD` = **date du jour**. Il n'y a **AUCUN sélecteur de date** de clôture. Donc le bouton « Clôturer » ferme **toujours la journée EN COURS**, jamais une journée passée.
- Une journée oubliée reste **ouverte** : elle est seulement **signalée** par le cron `detect_z_journalier_manquant` (1h du matin) → action audit_log `NF525_Z_JOURNALIER_MANQUANT` → alerte mail monitoring. Mais **le bouton normal ne peut PAS la clôturer**.
- Filet mensuel : `cloture_mensuelle_auto` (1er du mois 3h15) ferme le mois même si des Z quotidiens manquent.

**Double risque identifié :**
1. Une journée oubliée n'est **pas clôturable** proprement (le bouton ne cible que le jour même).
2. **PIÈGE** : si on clique « Clôturer » le matin (croyant rattraper la veille), on ferme **aujourd'hui** trop tôt → le trigger `tickets_block_post_cloture` **bloque le reste des encaissements du jour en cours**.

**Cadre NF525 (à confirmer avec expert-comptable) :** la norme n'interdit pas un Z fait a posteriori pour une journée oubliée ; ce qui compte = chaque journée finit par avoir son Z inaltérable, bons totaux, sans altération.

**À concevoir à froid (avec accord Alexandre, PAS en urgence) :**
- Permettre de clôturer une **journée passée précise** (fermer la veille oubliée avec SES tickets, sans toucher au jour en cours), déclenchable depuis l'alerte « Z manquant ».
- Empêcher / avertir en cas de clôture du jour en cours en pleine journée (garde-fou UX contre le blocage prématuré).
- Tester sur ticket bidon avant déploiement. Ne PAS improviser.
