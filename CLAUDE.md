# Luxyra — Mémoire projet pour Claude

## RÈGLE PERMANENTE (Alexandre, 2026-10-11) — à chaque changement fonctionnel
Toujours mettre à jour, dans le même lot, AVANT de dire « c'est fait » :
1. le bot de support (`support_bot_kb`) ;
2. le centre d'aide (`docs/generateurs/aide_guides.py` → `aide_build.py` ; captures à refaire si l'écran change ; FAQ d'aide.html) ;
3. le site public concerné (index FAQ, pro, tarifs, pages métier, blog si concerné) ;
4. les pages conditions / légales si le changement les touche (cgv, politique-confidentialite, mentions, dpa, securite-rgpd, suppression-donnees) ;
5. CLAUDE.md (notes).
Et tester en réel (Salon Démo / compte client test) avant d'annoncer.

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
| `bot-reply` v17 | true | POST { conversation_id } (rôle service, déclencheur trg_bot_reply) ; mode Google Play si support_messages.play |

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

**MISE À JOUR 2026-08-30 :**
- Vérifié : AUCUNE journée encaissée n'est actuellement sans clôture Z (requête sur tickets paid sans clôture correspondante → 0 résultat). Il n'y a donc rien à régulariser à ce jour.
- Le garde-fou UX contre le piège n°2 est FAIT : la modale de clôture affiche désormais un avertissement rouge listant les RDV du jour non encore encaissés, avec le nombre et les heures (`_lxRdvRestantsAujourdhui()` dans app.html). On avertit, on ne bloque pas.
- RESTE À FAIRE : la clôture d'une journée passée précise (point 1 ci-dessous). Toujours à concevoir à froid, ne pas improviser.

**À concevoir à froid (avec accord Alexandre, PAS en urgence) :**
- Permettre de clôturer une **journée passée précise** (fermer la veille oubliée avec SES tickets, sans toucher au jour en cours), déclenchable depuis l'alerte « Z manquant ».
- Empêcher / avertir en cas de clôture du jour en cours en pleine journée (garde-fou UX contre le blocage prématuré).
- Tester sur ticket bidon avant déploiement. Ne PAS improviser.

---

## À ANTICIPER (noté 2026-08-25) — Facturation électronique / e-reporting

**Calendrier légal (vérifié 08/2026) :**
- **01/09/2026** : obligation de **RECEVOIR** des factures électroniques (toutes entreprises) + émission pour GE/ETI. Rien à développer dans Luxyra (concerne les factures FOURNISSEURS, pas les ventes).
- **01/09/2027** : obligation d'**ÉMETTRE** (B2B) + **e-reporting** des données B2C pour TPE/PME/micro. **C'est là que Luxyra est concerné.**

**Entités :**
- Excellence Coiffure = **SASU**, assujettie TVA 20 % → plateforme payante (Pennylane 10 €HT/mois via comptable ; prix public 14 €).
- Luxyra (éditeur) = **EI micro-entrepreneur, franchise TVA** → éligible au **plan gratuit micro** de Pennylane (0 €, ~1200 factures/an). Ne pas payer d'abonnement pour cette entité.
- Pennylane = plateforme agréée (immatriculation définitive DGFiP du 11/12/2025).

**CHANTIER PRODUIT e-reporting 2027 (à faire, ~1 an devant) :**
Données exigées = **CA par taux de TVA + TVA collectée + ventilation par mode de paiement**, agrégées (PAS les tickets individuels).
→ **Luxyra les calcule DÉJÀ** : c'est le contenu de la clôture Z (`clotures.total_ca`, `total_ht`, `detail_paiements`).
Reste à faire : transmettre ces données via une **plateforme agréée** (~138 immatriculées, liste sur impots.gouv.fr).
Deux options : (a) connecteur Luxyra → PA (transmission auto = argument commercial fort « conforme 2027 sans rien saisir »),
(b) à défaut, le salon saisit manuellement sur sa PA depuis le Z.
Exports déjà en place et réutilisables : FEC, CEGID Quadratus, EBP, pack comptable.

**NB** : la franchise de TVA n'exonère de rien (assujetti non redevable).

---

## AUDIT SÉCURITÉ BASE DE DONNÉES — 2026-08-30

Balayage effectué avec le linter Supabase (242 constats) + vérifications manuelles.
**Ce n'est PAS un audit complet de l'application** : il porte sur la base de données
(RLS, droits d'exécution, fonctions SECURITY DEFINER, vues). Le code front, les edge
functions et le worker n'ont pas été audités ligne à ligne.

### CORRIGÉ — faille critique

**`_exec_raw_sql(text)` et `_exec_blob(text)` — SUPPRIMÉES.**
`_exec_raw_sql` exécutait `EXECUTE p_sql` en SECURITY DEFINER, propriété de `postgres`,
et était **appelable sans authentification** via `/rest/v1/rpc/_exec_raw_sql`. La clé
anon étant publique (lisible dans le code du site), n'importe qui pouvait exécuter du
SQL arbitraire avec les droits `postgres` : lecture de tous les salons et de tous les
clients, modification/suppression de n'importe quelle donnée, désactivation de RLS.
Reliquats d'outillage de migration, aucun appel applicatif. Migration
`urgence_supprimer_exec_raw_sql_acces_anonyme`.

### CORRIGÉ — durcissement

- `creer_ticket_avoir` : authentification désormais obligatoire (le contrôle de
  propriété était sauté pour un appelant anonyme). Droits limités à `authenticated` +
  `service_role`. Idem `corriger_reglement_rdv` (défense en profondeur).
- 33 fonctions internes (cron, purges, clôtures périodiques, notifications, stats,
  RGPD) : accès anonyme retiré. Notamment `run_cloture_mensuelle_pour_tous()`, qui
  aurait permis à un inconnu de déclencher les clôtures mensuelles NF525 de TOUS les
  salons. Migrations `revoquer_acces_anonyme_fonctions_internes` puis `..._v2`.

**PIÈGE RENCONTRÉ DEUX FOIS — à retenir :** `REVOKE ... FROM anon` est **sans effet**
quand le droit est hérité de `PUBLIC`. Il faut `REVOKE ... FROM PUBLIC` puis
`GRANT ... TO authenticated, service_role`. Toujours vérifier après coup avec
`has_function_privilege('anon', oid, 'EXECUTE')`, pas avec
`information_schema.routine_privileges` (qui ne montre que les droits visibles du rôle courant).

**Vérifications avant révocation (à refaire pour toute nouvelle révocation) :**
1. La fonction est-elle utilisée dans une politique RLS ? Si oui, retirer le droit à
   `anon` **casse les requêtes anonymes du site public** (l'EXECUTE est vérifié).
2. Est-elle appelée par une page publique ? Les seules RPC publiques sont
   `get_client_acompte_mode` (site.html) et `fn_salon_next_available_slot` (recherche.html).
3. Les edge functions utilisent `service_role` (vérifié sur avis-create) — non affectées.
4. Les 26 tâches cron tournent sous `postgres` — non affectées.

### RESTE À TRAITER (non urgent, à froid)

- **8 tables sans RLS**, lisibles ET écrivables par anon : `js_error_alerts_sent`,
  `_pg_net_scan_cursor`, `admin_push_payloads`, `monitoring_heartbeat`,
  `monitoring_synthetic_log`, `client_duplicate_ignored`, `monitoring_snooze`,
  `error_signature_resolved`. Contenu = monitoring interne (pas de données de caisse),
  mais un anonyme peut les polluer. Attention : `monitoring_synthetic_log` est lue par
  admin.html (ligne ~2046) — prévoir une policy admin avant d'activer RLS.
- **~60 autres fonctions SECURITY DEFINER encore appelables par anon** — à passer en
  revue une par une avec la checklist ci-dessus. Les plus sensibles ont été traitées.
- **5 vues SECURITY DEFINER** : `salons_public`, `clients_beautypro`, `admin_cron_health`,
  `v_js_errors_recent`, `v_js_errors_summary`. `clients_beautypro` est à vérifier en
  priorité (vue sur des données clients).
- **25 fonctions avec `search_path` mutable** (durcissement classique).
- **Protection « mot de passe compromis » désactivée** dans Supabase Auth — à activer
  depuis le tableau de bord.

---

## NOTIFICATIONS PUSH — 2026-08-30

**Constat :** le test push fonctionnait, mais aucune notification n'arrivait pour un
nouveau rendez-vous. Cause : le push n'était branché QUE sur les messages support
(`trg_push_admin_reply`, `trg_push_support_msg`). `trg_notif_rdv_online` se contentait
d'insérer dans la table `notifications` (notification *dans l'app*) sans jamais appeler
`notify_salon`. Preuve en prod : notification `rdv_online_new` du 30/08 à 19h22, sans
push associé.

**Correction :** nouveau déclencheur `trg_push_notification_ins` AFTER INSERT sur la
table `notifications`. Tout ce qui atterrit dans cette table part désormais en push :
nouveaux RDV, annulations, demandes de modification, demandes de RDV sur mesure — et
les types futurs seront couverts automatiquement, sans nouvelle intervention.

**Garde-fous :** fonction SECURITY DEFINER, envoi asynchrone via pg_net, et
`EXCEPTION WHEN OTHERS` qui avale toute erreur. Un push en échec ne peut jamais faire
échouer la réservation ou l'encaissement qui l'a déclenché.

**Points à connaître :**
- La branche « salon » de `send-push` ne filtre PAS par `event_type` (contrairement à la
  branche admin qui teste une colonne `events_<type>`). Inutile donc d'ajouter une
  colonne `events_rdv` pour chaque nouveau type.
- `send-push` supprime automatiquement les abonnements qui répondent 410/404. Lors du
  test : 4 abonnements, 2 envoyés, 2 expirés nettoyés (dont un endpoint Windows de mai).
  Il reste 2 abonnements FCM actifs.
- Un abonnement push est lié à un appareil ET un navigateur. Si Amandine change de
  téléphone ou vide les données du site, il faut réactiver les notifications dans l'app.
- L'URL de clic est `https://luxyra.fr/app.html` sans ancre : `handleHash()` ne gère que
  `#support` et `#settings/migration`, une ancre `#planning` ne ferait rien.

### Push : livraison application fermée (2026-08-30, suite)

Après correction du double service worker, le push partait bien (`sent:2, failed:0`)
mais **rien n'arrivait sur le téléphone application fermée** — la notification
n'apparaissait qu'à la réouverture de l'app.

**Cause identifiée :** `web-push` envoie par défaut avec `urgency: 'normal'`. Cette
urgence autorise FCM à **retenir** le message tant que l'appareil Android est en veille
profonde (doze), et à ne le délivrer qu'au réveil — c'est-à-dire au moment où l'on
rouvre l'application. C'est exactement le symptôme observé.

**Correction :** `send-push` v15 envoie avec `urgency: 'high'` (livraison immédiate même
en veille) et `TTL: 86400` (une notif de RDV n'a plus d'intérêt au-delà de 24 h ; le
défaut de web-push était 4 semaines). La réponse renvoie désormais aussi un tableau
`errors` détaillant les échecs par abonnement (code HTTP + corps), ce qui manquait pour
diagnostiquer.

**ATTENTION — effet de bord du déploiement :** déployer send-push via l'outil MCP a
remis `verify_jwt` à **true** (il était à `false`). Vérifié : `notify_salon` et
`notify_admins` envoient tous deux un en-tête `Authorization` avec la clé service_role,
et l'app appelle via `_sb.functions.invoke` (jeton de session) — les deux passent.
Test après déploiement : 200, `sent:2, failed:0`. Si un jour un appel sans jeton doit
fonctionner, il faudra repasser `verify_jwt` à false dans le tableau de bord Supabase.

**Le code des edge functions n'est PAS versionné dans ce dépôt** (pas de dossier
`supabase/functions`). La source de vérité est Supabase. À penser lors d'un audit ou
d'une reprise.

**Si ça ne suffit pas :** le reste est côté appareil — Réglages Android → Applications →
Luxyra → Batterie → « Non restreinte ». Xiaomi, Huawei, Oppo et Samsung sont les plus
agressifs et tuent les processus en arrière-plan malgré une urgence haute.

### Push : délai pg_net trop court (2026-08-30, suite)

**Constaté en production** lors des essais : `Timeout of 5000 ms reached. Total time:
5001 ms` sur un envoi réel. `notify_salon` utilisait le délai par défaut de `net.http_post`,
soit **5 secondes**, alors que `send-push` en démarrage à froid dépasse régulièrement ce
délai (chargement du module web-push + envoi à chaque abonnement).

Conséquence : l'appel était coupé, la réponse perdue, et impossible de savoir si la
notification était partie. En production, une notification de rendez-vous pouvait donc
disparaître silencieusement.

**Correction :** `timeout_milliseconds := 30000` dans `notify_salon`. L'appel restant
asynchrone, allonger ce délai ne ralentit ni la réservation ni l'encaissement qui
déclenchent la notification.

**À vérifier un jour :** `notify_admins` a probablement le même défaut (non corrigé ce
soir, non testé). Et `net._http_response` ne conserve les réponses que peu de temps —
pour diagnostiquer un envoi, il faut regarder rapidement après coup.

**Méthode de diagnostic qui a marché**, à réutiliser :
```sql
select status_code, error_msg, created, content
from net._http_response
where content like '%sent%' or error_msg is not null
order by created desc limit 5;
```
Attention : la sonde de monitoring synthétique tourne toutes les 10 min et pollue cette
table — filtrer sur le contenu, pas seulement sur la date.

### PIÈGE — deux paires de clés VAPID différentes (constaté 2026-08-30)

- `app_secrets.VAPID_PUBLIC_KEY` = `BFh9-tutkjOTEJUFGvVMkq4L1uTrXS…` (**obsolète, inutilisée**)
- Variable d'environnement des edge functions = `BAg80uDJxWmu1ltDdXbiQbAFEUXn4v5bfNRVbvT1jRh07y29Opxqksn8MeomA-3K-AhVwzxqVXM_UetPDpy2vaI`
- `window.VAPID_PUBLIC_KEY` codée en dur dans app.html = **la même que l'environnement** ✅

Vérifié le 30/08 : `send-push` lit `Deno.env.get("VAPID_PUBLIC_KEY")` et
`lx-push-public-key` renvoie bien `BAg80uDJ…`. L'app et l'envoi sont donc cohérents.

**DANGER :** si quelqu'un fait un jour lire `app_secrets` à `send-push` « pour centraliser
les secrets », **tous les abonnements existants cesseront de fonctionner** — un abonnement
est lié à la clé VAPID utilisée au moment de la souscription. Il faudrait alors forcer
tous les salons à se réabonner. Soit supprimer cette entrée obsolète d'`app_secrets`,
soit y écrire la bonne valeur.

Contrôle des clés d'un abonnement (une clé invalide = message accepté par FCM mais que le
navigateur ne peut pas déchiffrer, donc **rien ne s'affiche, silencieusement**) :
```sql
select id, length(p256dh) as p256dh, length(auth) as auth from push_subscriptions;
-- attendu : p256dh 87-88, auth 22
```

### Notifications — état final au 30/08/2026 (session complète)

**Ce qui déclenche désormais une notification (cloche dans l'app + push) :**
tout ce qui atterrit dans la table `notifications` — nouveau RDV en ligne, annulation,
demande de modification, demande de RDV sur mesure, et **nouvel avis client**
(`trg_notif_avis` sur `avis_salon`, INSERT + UPDATE quand la note ou le texte change ;
les réponses du salon et la modération ne déclenchent rien). Tout type ajouté plus tard
sera couvert automatiquement, sans nouvelle intervention.

**Défauts corrigés dans la chaîne push :**
1. Aucun push n'était envoyé pour un RDV (branché uniquement sur le support).
2. `notify_salon` coupait l'appel à 5 s → notifications perdues sans trace.
3. `urgency: normal` → FCM retenait le message pendant la veille Android.
4. Toutes les notifs partageaient une étiquette → une notif écrasait la précédente,
   **deux réservations = une seule visible**.
5. La bannière d'activation ne revenait jamais → un salon sans aucun abonné n'en
   était jamais averti.
6. Un abonnement lié à l'**ancienne clé VAPID** s'affichait « Actif » sans jamais rien
   recevoir → `_lxSubscribePush()` compare la clé et se réabonne si elle diffère.
7. Le bouton « Tester » annonçait un succès dès l'acceptation serveur, sans vérifier
   l'affichage réel.

**FAUSSE PISTE — ne pas refaire :** avoir voulu unifier le scope du service worker
('/app' → '/') et désenregistrer l'ancien a CASSÉ la réception sur PWA installée
(manifeste de scope `/app`). Le double enregistrement est un vrai défaut, mais le
corriger ainsi est pire que le mal. `lxFixSwScope()` est conservée NON APPELÉE.

**Xiaomi / MIUI :** le refus « Registration failed - push service error » a été levé
côté téléphone (démarrage automatique pour Chrome dans l'app Sécurité + batterie sans
restriction). À reverifier si les notifications s'arrêtent : MIUI peut réinitialiser
ces réglages après une mise à jour système.

**Notification Chrome « Appuyez pour copier l'URL » :** comportement normal de Chrome
quand une application web tourne. Se désactive par appui long → engrenage, en prenant
garde à ne pas toucher la catégorie « Sites » qui porte les notifications Luxyra.

### COÛT RÉEL DES SMS — découverte du 30/08/2026

**Un SMS = 1 crédit seulement s'il n'utilise que l'alphabet GSM-7** (160 caractères).
Un seul caractère hors de cet alphabet fait basculer tout le message en UCS-2, limité
à **70 caractères** — un texte de 90 caractères passe alors à **2 segments**.

Pièges les plus courants en français : **« ô »** (bientôt), **« À » majuscule**,
« û », « î », les guillemets typographiques « » et l'apostrophe courbe ’.
Sont en revanche autorisés : à, é, è, ù, ì, ò, ç minuscule, Ä, Ö, Ñ, Ü.

**Le modèle de rappel 24h par défaut coûte 2 crédits** : « Bonjour {prenom}, nous vous
rappelons votre RDV demain à {heure} chez {salon}. À bientôt ! » — 90 caractères, mais
« À » et « ô » le font basculer en UCS-2. Sans ces deux caractères : 96 caractères,
1 seul segment.

**IMPACT ÉDITEUR, à ne pas manquer :** `decrement_sms_credit` retire **1 crédit par
appel**, quel que soit le nombre de segments. Un salon dont le modèle fait 2 segments
consomme donc 1 crédit mais coûte **2 SMS chez Brevo**. La marge par SMS est divisée
par deux sans que rien ne l'indique. À arbitrer : soit compter les segments côté
worker, soit livrer des modèles par défaut sans caractères fautifs (fait pour la
confirmation en ligne).

Un compteur en direct sous chaque modèle affiche désormais taille, encodage et coût
en crédits, et signale les caractères fautifs (`lxSmsInfo` / `lxRenderSmsCost`).

### SMS : pourquoi le doublon du 30/08 à 23h41 est passé malgré le verrou

Le verrou unique ne compare que les clés **non nulles**. Les SMS envoyés AVANT la pose
du déclencheur n'en ont pas : un nouvel envoi vers le même client ne rencontrait donc
aucun conflit. Marina a reçu un rappel à 21h28 (sans clé) puis un second à 23h41 (avec
clé) — aucun conflit entre les deux. Les clés de la journée en cours ont été calculées
après coup, en gardant la première ligne de chaque groupe.

**Point important pour la suite :** le verrou n'empêche l'ENVOI que si l'application
tourne avec le code qui réserve la ligne AVANT d'envoyer. Avec l'ancien code (log écrit
après envoi), le verrou bloque seulement l'écriture du journal — le SMS est déjà parti.
Toujours s'assurer que les appareils ont rechargé l'app après ce genre de correctif.

**Heures de silence ajoutées :** les rappels ne partent plus qu'entre 8h et 21h. Rien
n'est perdu, la vérification repasse toutes les 10 minutes.

**PISTE À VÉRIFIER (non conclue) :** la politique de lecture de `messaging_log` exige
`salons.user_id = auth.uid()` OR `is_admin()`. Le salon appartient à
`amandinej@excellence-coiffure.fr`. Si un appareil ouvre l'app avec un autre compte non
admin, il ne peut PAS lire `messaging_log` — `hasAlreadySent()` ne voit alors jamais les
envois précédents et renvoie systématiquement des doublons. Cela expliquerait les
doublons chroniques constatés depuis juillet. À confirmer en vérifiant sous quel compte
chaque appareil est connecté, et si besoin élargir la politique de lecture aux
opérateurs du salon.

### Monitoring — anomalies relevées le 31/08/2026

1. **`column push_subscriptions.events_fiscal_integrity does not exist` → HTTP 500.**
   La branche ADMIN de `send-push` construisait un nom de colonne à partir du type
   d'événement. Pour tout type sans colonne dédiée, la requête échouait et **l'alerte
   n'était jamais délivrée** — y compris celle du contrôle d'intégrité fiscal NF525 de
   5h du matin. Corrigé en v17 : seules les colonnes réellement existantes servent de
   filtre (`admin_reply`, `new_signup`, `payment_failed`, `critical`, `migration`), tout
   autre type est traité comme critique. Vérifié : HTTP 200, `filtre=events_critical`.

2. **`notify_admins` avait le même délai de 5 s que `notify_salon`** (corrigé la veille).
   Porté à 30 s.

3. **AUCUN abonnement push de type `admin`** n'existe : les 4 abonnements sont
   `target_type='salon'`. Les alertes admin ne peuvent donc atteindre personne par push,
   même corrigées — elles reposent uniquement sur l'email. À activer depuis admin.html
   si on veut les recevoir sur le téléphone.

4. **`RDV_ONLINE_SANS_COLLABORATEUR`** : la réservation de Leana Fuhrmann du 26/09
   (« sans préférence ») n'a toujours pas de collaborateur affecté. À assigner dans le
   planning, sinon elle restera signalée chaque nuit.

5. **`site:resa_echec` ×2 le 30/08 à 21h21** : « Ce créneau vient d'être réservé » —
   collision normale entre deux tentatives simultanées, la cliente a pu réserver ensuite.
   Pas d'action.

### Verrous de réservation en ligne — batterie de tests du 07/09/2026

Sept tentatives de réservation interdites lancées directement en base, plus un cas
légitime en non-régression. Résultat après correction :

| Cas | Verdict |
|---|---|
| Avant l'ouverture (lundi 9h, ouverture 14h) | refusé — « Horaire trop tôt » |
| Après la fermeture (lundi 18h30) | refusé — « Horaire trop tard » |
| Déborde la fermeture (17h30 + 1h) | refusé — « Horaire trop tard » |
| Jour fermé (dimanche) | refusé — « Jour fermé » |
| **Collaboratrice archivée** | **refusé — corrigé le 07/09** |
| Délai minimum non respecté (2 h) | refusé |
| Au-delà du délai maximum (60 j) | refusé |
| Réservation légitime (mardi 10h) | **acceptée** — pas de régression |

**Trou trouvé et corrigé :** `rdv_online_validate` vérifiait `actif` mais ignorait
`inactif` et `date_depart`. Une collaboratrice archivée restait réservable côté base —
le site ne la proposait pas, mais rien ne l'empêchait côté serveur. Manue était masquée
par sa période d'absence jusqu'au 31/10 ; **dès novembre elle serait redevenue
réservable**. Contrôle ajouté sur `inactif` et sur une date de départ antérieure ou
égale à la date du rendez-vous.

**INCIDENT pendant la correction, à retenir :** j'ai d'abord remplacé
`rdv_online_validate` par une version courte déléguant à une fonction
`rdv_online_validate_coeur` **qui n'existait pas** — la validation était cassée en
production pendant environ une minute. Restaurée intégralement dans la foulée, puis
revalidée par la batterie complète. Leçon : ne jamais remplacer une fonction de
validation par une version qui référence du code non encore créé ; réécrire le corps
complet, ou créer la dépendance d'abord.

**Rappel de conception :** le contrôle valide les horaires du COLLABORATEUR en
priorité, puis ceux du salon (`coalesce(v_col_horaires->dow, v_cfg_horaires->dow)`).
Un collaborateur dont la grille hebdomadaire est plus large que celle du salon rendrait
donc réservables des créneaux hors ouverture du salon. Non corrigé : ce serait un
changement de règle métier, à décider avec Alexandre.

### Historique des horaires et exceptions (07/09/2026)

Table `historique_horaires`, alimentée par deux déclencheurs :

- `site_config` → changement de `horaires_salon` ou de `absences`
- `collaborateurs` → changement de `horaires` ou de `horaires_overrides`

Chaque entrée porte un **résumé lisible** (« Lundi : 14:00-18:00 -> 09:00-18:00 »,
« SUPPRIME : ouverture_except du 2026-09-14 (09:00-18:00) »), l'ancienne et la nouvelle
valeur complètes, l'utilisateur et son email, et l'horodatage.

**Pourquoi :** impossible de déterminer pourquoi la réservation d'Ophélie du 07/09 à 9h
avait été acceptée un lundi ouvrant à 14h. Toutes les pistes ont été éliminées
(validation testée sur 7 cas, horaires d'Amandine confirmés à 14h-18h, aucune demande
de RDV sur mesure, aucune ouverture exceptionnelle subsistante) sauf deux, invérifiables
faute d'historique : horaires modifiés depuis, ou ouverture exceptionnelle créée puis
effacée — ce que la republication de `site_config` depuis un appareil périmé peut faire
sans laisser de trace.

**Pour interroger :**
```sql
select modifie_le, quoi, resume, modifie_par_email
from historique_horaires
where salon_id = '...' order by modifie_le desc limit 30;
```

**Points de conception :**
- `modifie_le` utilise `clock_timestamp()`, PAS `now()` : `now()` renvoie l'heure de
  début de transaction, donc plusieurs modifications d'une même transaction auraient
  porté un horodatage identique et leur ordre aurait été indéterminable — exactement le
  flou qu'on cherche à supprimer. Trouvé par un test qui a échoué pour cette raison.
- Les déclencheurs avalent toute erreur : l'historique ne doit JAMAIS empêcher un
  enregistrement.
- RLS : lecture réservée au propriétaire du salon et à l'admin. Aucune policy
  d'écriture — l'historique n'est pas modifiable depuis l'application.

### Rappels 24h : passage côté serveur (07/09/2026)

**Constat mesuré :** sur les 3 semaines précédentes, 102 rendez-vous honorés avec
téléphone et consentement SMS — seuls **29 ont reçu leur rappel la veille**. Plus de
70 % des clientes n'ont rien reçu. Cause : le rappel était envoyé par l'APPLICATION
(`checkSmsReminders`, toutes les 10 min), donc uniquement si un appareil était ouvert
au bon moment. Aucune tâche serveur n'existait. Exemple : mercredi 19/08, 6 rendez-vous,
zéro rappel.

**Correction :** `envoyer_rappels_24h()`, planifiée à 08h00 UTC (10h Paris l'été).
Couvre `appointments` ET `rdv_online`. Même règle anti-doublon que l'application : une
confirmation envoyée le jour même rend le rappel inutile. Sans crédits, le rappel part
dans `sms_differes` avec l'heure du rendez-vous comme limite de pertinence.

**L'envoi côté application reste actif en secours.** Les deux ne peuvent pas faire
doublon : le premier qui passe « réserve » sa ligne dans `messaging_log` (index unique
sur salon+contexte+destinataire+jour), le second est ignoré.

**Piège rencontré :** `appointments.heure` est du **TEXTE** ('14:30'), pas un type
`time` — contrairement à `rdv_online.heure_rdv`. `to_char()` échouait et la fonction
serait tombée en erreur chaque nuit, en silence. Détecté par un essai à blanc
(crédits mis à 0 → mise en file au lieu d'envoi, aucun SMS réel). **Toujours tester
ainsi une fonction qui envoie des SMS.**

**Confirmation en production le 07/09 :** Geoffrey KNOBLOCH a reçu sa confirmation à
10h48 et son rappel à 10h48 — la même minute. C'est exactement le doublon signalé par
Alexandre, désormais impossible.

## INCIDENT 2026-10-07 — Config du site jamais chargée (1re cliente en essai, Delphinecoiff)

**Symptôme :** « chaque fois que je ferme et reviens, tout ce que j'avais modifié a disparu ».
**Preuve (historique_horaires) :** horaires salon réglés le 04/10 (lun 8h30→13h30, mar/mer/ven 8h30, jeu 9h30, sam 9h-12h30)
remplacés le 05/10 17:16 et le 06/10 21:41 par le `H` codé en dur = **horaires d'Excellence Coiffure**.
**Cause :** `loadSiteConfig()` n'était appelée qu'une fois, `setTimeout 1000` après le parse. Sur un login frais,
`_salonId` est null à ce moment → aucun chargement, jamais de nouvel essai. SITE_CONFIG vide → 4 DB_ERROR
« SITE_CONFIG absent » ; et H par défaut republié par `saveSiteConfig` à la 1re modif. En plus, l'ancien
abandon rechargeait la config, ce qui écrasait en mémoire la modif d'horaire en cours.
**Correctif :** chargement ATTENDU dans `loadSalonData` avant `initApp()` (8 s max) ; marqueurs
`SITE_CONFIG._lxCharge` et `window._lxHCharge` ; `saveSiteConfig` ne publie jamais une config ni des horaires
non chargés (reprise : charge, reporte les champs modifiés, publie) ; onglet « Site en ligne » n'invente plus
de défauts ; salon sans horaires en base = vierge (jamais ceux d'Excellence). 8 scénarios testés (harnais mock).
**Règle :** ne JAMAIS publier un état mémoire qui n'a pas été chargé depuis la base.

**Même journée (07/10), côté serveur :**
- `rdv-demande-create` v6 et `rdv-demande-proposal-action` v8 : colonne `client_beautypro_id` → `client_luxyra_id`
  (renommage non propagé ; toutes les demandes sur mesure échouaient depuis le renommage, et toute proposition
  était « introuvable »). Victime constatée : Julie Wagner (Excellence), 9 essais les 04-05/10 — RDV finalement pris
  par le salon. Audit des 39 autres fonctions : aucune autre référence à l'ancien nom.
- `bot-reply` v10 : le bot inventait des menus (« Paramètres → Sécurité »), un délai de verrouillage réglable
  (15 min — c'est 5 min, codé en dur) et une obligation NF525 du PIN. Prompt doté de la liste EXACTE des rubriques
  de Paramètres, d'emplacements vérifiés, et de règles : jamais de menu non listé, jamais d'argument légal/NF525,
  escalade immédiate sur bug/perte de données. À TENIR À JOUR si les rubriques changent.
- Horaires de Delphinecoiff restaurés (migration `restaurer_horaires_salon_delphinecoiff`, tracée dans historique_horaires).

## 2026-10-07 (suite) — CLOISONNEMENT DES COMPTES + FIN DES ÉCRASEMENTS DE CONFIG

**Demande d'Alexandre :** « les nouveaux comptes ne doivent rien avoir d'un autre compte, et rien effacer du salon
d'Amandine ». Constaté chez Delphinecoiff : couleurs des 8 marques d'Excellence en base, sms_config vidé,
familles créées puis perdues.

**Causes (toutes reproduites dans un banc jsdom qui démarre app.html avec un faux Supabase — /tmp/lx, non versionné) :**
1. Déconnexion SANS rechargement → toute la mémoire du compte précédent passait au suivant (équipe, catalogue,
   clients, minuteries SMS…). → `doLogout` recharge la page.
2. Valeurs codées en dur = données d'Excellence : `SVC` (41 prestations), `T` (« Membre 1/2 »), `H`, `CATS`,
   couleurs de marques. Sur une panne réseau au chargement, `saveServices`/`saveCollaborateurs` les INSÉRAIENT
   (banc : 47 insertions dans un salon neuf). → tout vidé ; `_lxTableOk` + `_lxListeChargee()` bloquent les
   enregistrements en masse d'une liste non chargée.
3. Clés localStorage non propres à un salon (`_lx_prodcolors`, `_lx_svccolors`, `_cp_sms_config`, `_cp_app_bg`,
   `_lx_pending_2nd_rdv`) lues au démarrage puis ENREGISTRÉES chez le salon connecté. → plus lues / purgées ;
   SMS_CONFIG et APP_BG réinitialisés au chargement puis pris de la base uniquement.
4. `saveSalonConfig` (≈50 appels) recopiait TOUTES les sections depuis la mémoire : un 2e appareil ouvert avant
   effaçait les familles créées sur le 1er (banc : « Lissage » perdu, ancien code ; conservé, nouveau code).
   → FUSION PAR SECTION (`LX_CFG_SECTIONS`, références `_lxCfgBaseDb/_lxCfgBaseMem` fixées par
   `lxCfgFixerBase` à la fin du chargement de initApp) : n'écrit que ce que CET appareil a modifié, rafraîchit
   la mémoire avec ce qui a changé ailleurs, n'écrit rien avant chargement, file d'attente, erreurs visibles.
   `saveAppBg`/`saveSmsConfig` → `lxCfgEcrireSections` (une seule section). 20 tests unitaires + parcours.
5. Sauvegarde NON SOLLICITÉE au démarrage (`initApp` → `applyTheme` → `saveSalonConfig`) : supprimée
   (`applyTheme(...,true)`).
6. Forfaits fabriqués automatiquement depuis les prestations quand un salon n'en avait aucun : supprimé.
7. Chargement des familles : la « réparation » depuis l'ancienne clé `categories` ne s'applique plus qu'en
   migration (sinon familles supprimées ressuscitées) ; suggestions du métier seulement si jamais enregistrées.
8. Site public : sans horaires configurés → fermé (avant : horaires d'Excellence).

**Excellence vérifiée identique** (banc, ancien vs nouveau) : équipe, 72 prestations, horaires, 11/11 familles,
22 forfaits, 34 réglages SMS, couleurs, TVA 20 ; toutes les pages s'affichent ; 0 écriture de config au
démarrage (l'ancien code en faisait 1 à chaque ouverture).

## RÈGLE PERMANENTE (Alexandre, 07/10/2026) — LE BOT SUPPORT SE MET À JOUR À CHAQUE MODIFICATION

**Toute modification de l'app visible par l'utilisateur (menu, libellé, bouton, réglage, comportement)
doit être reportée DANS LA MÊME INTERVENTION dans la base de connaissances du bot.**

- Base : table `public.support_bot_kb` (cle, titre, ordre, contenu, actif). Lue à CHAQUE réponse par
  `bot-reply` (v12+) → une mise à jour SQL suffit, sans redéploiement. RLS active, aucun accès anon/authenticated.
- Contenu : uniquement des faits VÉRIFIÉS dans le code (libellés exacts entre « »). Ce qui n'existe pas va
  dans la ligne `inexistant`. Les cas à transmettre à un humain portent `<ESCALATE/>`.
- Vérifier après chaque mise à jour avec le banc `lx-bot-eval` (même consigne/base/contexte que bot-reply,
  AUCUNE écriture, réservé au rôle service — refuse la clé anon) : appel via `net.http_post` avec le jeton
  service (`'Bearer ' || lx_prive.cle_service()`), `{salon_id, questions:[...]}`, lire `net._http_response`. Questions de référence : désactiver le
  PIN, délai de verrouillage, créer une famille, clôture oubliée (→ ESCALATE), TVA qui ne reste pas
  (→ ESCALATE), congé d'une collègue, rappels SMS en Essentiel, rubrique « Sécurité », horaires du samedi,
  remboursement, salutations.
- Si la consigne du bot change (BASE_PROMPT), redéployer `bot-reply` ET `lx-bot-eval` (même texte).
- Affichage côté client : messages en `white-space:pre-line`, `**gras**` rendu pour l'assistant (texte échappé).


## SÉCURITÉ (07/10/2026) — clé service_role dans le coffre Vault

- La clé service_role était écrite EN CLAIR dans `fn_trigger_bot_reply`, `notify_salon`, `notify_admins`
  (et recopiée dans 2 migrations de l'historique : notify_*_timeout_30s). Désormais : secret Vault
  `service_role_key`, lu par `lx_prive.cle_service()` (schéma `lx_prive` non exposé à l'API, EXECUTE retiré
  à public/anon/authenticated). Les 3 fonctions appellent `'Bearer ' || lx_prive.cle_service()`.
  Historique des migrations masqué. Vérifié : 0 clé en clair (fonctions, cron, migrations, dépôt git) ;
  notify_salon testé de bout en bout (200, aucune notification envoyée).
- **RÈGLE : ne JAMAIS écrire une clé dans le texte d'une fonction, d'une migration, d'un cron ou du dépôt.**
  Utiliser `lx_prive.cle_service()` (ou un autre secret Vault).
- **RESTE À FAIRE (planifié, pas en urgence)** : faire tourner la clé service_role (elle a été visible dans
  le texte des fonctions). Avec les nouvelles clés API Supabase (sb_secret_…) : créer une clé secrète,
  mettre à jour le secret Vault + les secrets des edge functions / du worker Cloudflare, puis désactiver
  l'ancienne. NE PAS régénérer le « JWT secret » legacy sans plan : il invaliderait aussi la clé anon
  écrite dans app.html, site.html, inscription.html…

## 2026-10-07 — CLÔTURE Z AUTOMATIQUE DE NUIT (filet en cas d'oubli) — validée par Alexandre

- Base légale : BOI-TVA-DECLA-30-10-30 — le LOGICIEL doit « prévoir obligatoirement une clôture journalière,
  mensuelle et annuelle » (cumulatives). Une clôture automatique en cas d'oubli remplit cette obligation.
- Edge function `lx-cloture-auto` (rôle service uniquement) : calculs RECOPIÉS de l'app (cloturerJournee →
  calculerZ, _splitPrestProd, _lxPayBuckets, caPerCollabForAppt, lxMapApptRow…), état « à la fin du jour D »
  (annulations postérieures ignorées), empreinte SHA-256 identique (« Z|num|date|CA|HT|nb|annul|dernier ticket|siret »).
  Modes : `verify` (recalcule les Z existantes), `simulate`, `run`. Écrit la Z (raw_data.auto=true,
  operator_name « Clôture automatique », pas de comptage), verrouille les tickets du jour, trace CLOTURE_Z.
- VALIDATION : 120 Z d'Excellence recalculées → totaux/HT/nb tickets identiques sur les 120 ; empreinte identique
  sur 116 (les 4 non identiques = Z1-4 scellées en mai avec l'ancien algorithme) ; tout identique depuis le 18/06
  (avant : cumuls mois/année non stockés par l'ancienne version de l'app, et Z25 avec un règlement modifié après coup).
- Cron `cloture_z_auto_nuit` 23:30 UTC → `lx_prive.lancer_cloture_auto()` (clé lue au coffre).
  `detect_z_manquant_daily` (01:00 UTC) reste le second filet.
- **SI cloturerJournee OU SES FONCTIONS CHANGENT DANS L'APP : reporter le changement dans lx-cloture-auto ET relancer
  `{"mode":"verify","salon_id":…}` avant de déployer.**
- App : la fenêtre de clôture l'explique ; en caisse simplifiée (auto-entrepreneur) la clôture et le comptage du
  tiroir sont FACULTATIFS. Base du bot mise à jour (lignes `cloture`, `inexistant`).

## 2026-10-07 — Synchronisation tablette / téléphone de la configuration du SITE (site_config)
`saveSiteConfig` réécrivait toute la ligne site_config depuis la mémoire : un appareil ouvert avant une modification
faite sur l'autre l'effaçait (banc : horaires modifiés sur la tablette, message modifié ensuite sur le téléphone →
horaires de la tablette perdus). Désormais `_lxSiteEcrire` relit la ligne et n'écrit que les champs modifiés sur
l'appareil depuis le chargement (référence `_lxSiteBase`, fixée par loadSiteConfig) ; les horaires reçus d'un
autre appareil sont repris en mémoire. Écritures en file (`_lxSiteFile`).
Récap synchro multi-appareils : RDV/clients/équipe = rafraîchis en direct ; config salon (familles, forfaits,
paiements, SMS…) = fusion par section ; config du site = fusion par champ ; clôtures = relues avant chaque Z +
index unique (salon, date) ; encaissement après Z bloqué en base (tickets_block_post_cloture).
FICHES CLIENTS ET PRODUITS : traitées le même jour (voir section suivante).


## 2026-10-07 — Synchro multi-appareils des FICHES CLIENTS et des PRODUITS
`saveClient` / `saveProduct` réécrivaient la fiche entière depuis la mémoire (banc, ancien code : points 5+3+2 → 7,
fiche technique de la tablette perdue, stock 10-1+5 → 15). Désormais : référence `_lxBase` (non énumérable) posée
par les mappers uniques `lxMapClientRow` / `lxMapProduitRow` ; à la sauvegarde, relecture de la ligne et fusion
`_lxFusionFiche` : champs modifiés ici écrits, autres gardés de la base ; COMPTEURS (points_fidelite, stock,
pamp_qty) = valeur en base + différence faite ici ; fiches techniques (liste sans id) = ajouts/suppressions faits
ici appliqués à la base ; fiche_tech = clé par clé. Inventaire : `saveProduct(p,{stockAbsolu:true})` (stock compté
écrit tel quel). Sauvegardes d'une même fiche en file (`_lxEnFile`). Mémoire de l'appareil mise à jour après chaque
sauvegarde. Banc : 10/10 (points 10, 3 fiches, stock 14, inventaire 12, double encaissement rapide +2).

## 2026-10-07 — Conflits : le MÊME champ modifié sur deux appareils

Avant : la dernière sauvegarde écrasait silencieusement l'autre appareil. Maintenant :
- **Fiches clientes / produits** (`_lxFusionFiche` dans luxyra-supabase.js, option `conflits`) :
  texte complété des deux côtés (notes…) → les deux ajouts sont gardés (`_lxFusionTexte`) ;
  sinon version de l'appareil qui enregistre en dernier + ancienne valeur au journal.
- **Config salon** (`_lxSaveSalonConfigUneFois` → `_lxCfgFusionValeur` dans app.html) : listes avec `id`
  (forfaits, absences, cartes) fusionnées par id ; familles = ajouts/suppressions des deux côtés ;
  objets clé par clé ; valeur simple → dernière version + journal. Mémoire rafraîchie (`sec.set`).
- **Site** (`_lxSiteEcrire`) : même fusion (horaires jour par jour…), sauf `collaborateurs` (dérivé de l'équipe) ;
  après fusion, `loadSiteConfig({})` remet la mémoire à jour.
- Journal : action `CONFLIT_SYNCHRO` (dans `LX_NON_FISCAL_ACTIONS`, hors export d'audit fiscal) + toast.
- Test : `/tmp/lx/conflit.js` (2 appareils jsdom) — ancien code 4/14, nouveau 14/14.
- Collaborateurs partis (complément) : devis→RDV et absence depuis le planning passent par `lxEquipeSelection`/`getActiveTeam` ;
  côté base, `fn_salon_next_available_slot` et `rdv_online_block_double_booking` excluent aussi `inactif` et `date_depart` passée
  (migrations `next_slot_exclut_collaborateurs_partis`, `double_booking_exclut_collaborateurs_partis`).

## 2026-10-07 (soir) — Date de départ, sécurité, clôture auto

- **Date de départ = PREMIER jour d'absence définitive** (règle unique, celle de `rdv_online_validate`).
  App : `lxCollabPartiAu(c,date)` (Inactif OU date atteinte) / `lxCollabDepartAu(c,date)` (date seule) ;
  `getEffectiveHrs` → null à partir de la date (bloque `aAp`, créneaux, planning) ; colonne et récap du planning
  masqués à partir de la date sauf RDV ce jour-là ; `setCollabDepart` : date future ⇒ PAS coché Inactif
  (reste dans l'équipe jusqu'à la veille), date passée ⇒ Inactif ; année hors 19xx/20xx refusée ;
  alerte s'il reste des RDV à réaffecter. Site : `COLLABS[].dep` + `applyHrsOverride`/`isCollabDayOff`.
  SQL : `fn_salon_next_available_slot`, `rdv_online_block_double_booking` en `date_depart > date`.
  Test : `/tmp/lx/dep.js` 11/11.
- **Sécurité** (migrations du 07/10) : `clients_beautypro` (password_hash !) plus lisible par anon/authenticated ;
  `admin_find_duplicate_clients` réservé au propriétaire du salon ou admin ; 8 tables monitoring en RLS
  (policy `is_admin()`) ; fonctions internes révoquées pour anon ; `salons_public.config_json` passe par
  `lx_config_publique()` (retire caisse_data, fond_caisse, sms_config, pay_active, verrouillage, migration*) ;
  vues `v_js_errors_*`, `admin_cron_health` plus lisibles par anon.
- **Clôture auto** : `lx_prive.lancer_cloture_auto()` saute Delphinecoiff UNIQUEMENT si date Paris = 2026-10-08
  (registre NF525). Code mort ensuite — pourra être retiré.

## 2026-10-08 — Revue de sécurité complète (base, fonctions serveur, worker)

**Règles à respecter désormais**
- Worker `/api/*` : les routes d'UN salon (`LX_ROUTES_SALON` : stripe create-checkout/portal/switch-plan/connect-*,
  admin/export-nf525, sms/rappel, sms/custom, sms/generate-link-token, client/invite) exigent
  `Authorization: Bearer <JWT du propriétaire>` (vérifié via /auth/v1/user + salons.user_id) OU l'en-tête
  `x-lx-internal: <clé service>` (appels serveur) OU le JWT de support@luxyra.fr.
  `email/custom` : appel serveur ou utilisateur connecté. `email/ticket` : idem ou session cliente (`session_token`,
  destinataire forcé). `email/welcome` : 410. `client/tickets` et `rdv/cancel` : `session_token` cliente obligatoire.
- app.html : relais `window.fetch` qui ajoute automatiquement le jeton de session aux appels same-origin `/api/`.
- Toute NOUVELLE edge function / fonction SQL qui appelle le worker doit envoyer `x-lx-internal`
  (edge : `SB_SR` ; SQL : `lx_prive.cle_service()`).
- Finalisations Stripe (acompte, empreinte, carte abo, bon cadeau) : métadonnée = cet objet, même salon, montant ≥ attendu,
  jamais deux fois. Plus d'UPDATE anonyme de `rdv_online` (policy supprimée).
- Webhooks Stripe sans secret : l'événement est relu chez Stripe, jamais cru sur parole.
- Fonctions SECURITY DEFINER : déclencheurs et fonctions internes non exécutables par anon/authenticated ;
  fonctions admin gardées par `is_caller_admin()` ; seules restent publiques : fn_salon_next_available_slot,
  founders_stats, get_client_acompte_mode, get_monitoring_status, get_salon_id, is_admin, is_caller_admin, report_server_error.
- `salons_public` : vue en lecture seule (elle était modifiable !), config filtrée par `lx_config_publique()`.
- Connexion clientes (lx-login) : 8 échecs / 15 min par email, 30 par IP (table `login_attempts`). bp-* désactivées (410).
- Tests : `/tmp/wt/test.mjs` (worker, 17/17), `/tmp/lx/fw.js` (relais du jeton).

## 2026-10-08 — Textes : essai, conservation après résiliation, offre Pro Fondateur

**Essai = fonctions Pro ouvertes SAUF SMS (accord Alexandre 08/10 : « surtout pas de SMS offerts, seulement après le 1er paiement ils sont offerts une fois »)**. En base l'essai reste plan='essential', status='trial'.
- App : `isPro()` = plan pro OU essai en cours (`lxEssaiProActif()`) ; `isProPaid()` = plan pro réellement payé → TOUT ce qui touche aux SMS (sendSms, rappels auto, cartes, QR natif, achat de packs) utilise `isProPaid()`.
- Serveur : `gateSmsAndDecrementCredit` et le mode natif exigent plan='pro' (inchangé) ; checkout des packs SMS refusé si plan≠'pro' ; bonus 150 SMS seulement si invoice.paid live, plan pro ET amount_paid > 0, une seule fois (welcome_sms_bonus_given).
- Base : `lx_salon_pro_actif(plan,status,trial_end)` → vue `salons_public` (site, annuaire, sitemap, bons cadeaux) et trigger `rdv_online_validate` (réservation refusée si ni Pro ni essai en cours). Essai expiré → site hors ligne automatiquement.
- ⚠️ FAILLE CORRIGÉE : trigger `trg_salons_proteger_facturation` (lx_prive.salons_proteger_facturation). Un salon connecté pouvait se mettre lui-même plan='pro', status='active', is_free, sms_credits=9999, Fondateur… via l'API. Désormais, pour les rôles authenticated/anon non admin : à l'INSERT valeurs forcées (essential/trial/0 SMS/≤15 j d'essai), à l'UPDATE les colonnes de facturation sont remises à l'ancienne valeur (sans erreur). Autorisé côté salon : is_free true→false, baisse de sms_credits, verification_status → pending/pending_review. service_role, postgres (cron) et admin : libres. Testé en transaction annulée.

**Conservation après résiliation (règle unique, la même partout : CGV art. 9, politique de confidentialité §3/3.1, contrat 7.7 de l'inscription, tarifs, aide, securite-rgpd, bot)** :
- résiliation effective → mode archives (lecture seule) ;
- 60 jours : export complet ou réactivation à l'identique ;
- après 60 jours : suppression des données personnelles non fiscales (fiches clients, notes, photos, RDV), art. 28 RGPD ;
- documents comptables (tickets, Z, journal) : 6 ans à compter de la résiliation (art. L102 B LPF), préavis 30 jours, puis purge (worker, phase 6 ans, déjà en place, filtre status='cancelled').
- ⚠️ À FAIRE AVANT LA PREMIÈRE VRAIE RÉSILIATION : la suppression automatique des données non fiscales à J+60 n'existe pas encore (aucun salon résilié aujourd'hui). Suppression = action irréversible → accord d'Alexandre avant d'activer.
- Worker `customer.subscription.deleted` : `cancelled_at` = toujours la date de la DERNIÈRE résiliation (avant : l'ancien cancelled_at était gardé et raccourcissait les 6 ans). Le salon d'Amandine (status active) a un cancelled_at du 10/05/2026 resté d'un ancien abonnement : sans effet tant qu'il est actif.

**Offre Pro Fondateur — CGV article 5 bis** : 100 premiers salons Pro, 14,99 €/mois au lieu de 24,99 €, prix garanti tant que l'abonnement Pro reste actif sans interruption ; fin en cas de résiliation, de passage à Essentiel ou d'impayé non régularisé ; nouvelle souscription au tarif Fondateur seulement s'il reste des places. Exception ajoutée à l'art. 5 (hausse de prix). Plus de « à vie » nulle part.
- Worker `switch-plan` Essentiel → Pro : même règle que create-checkout (claim_founder_slot, NULL = plus de place → prix standard). Avant : 24,99 € facturés même s'il restait des places.
- App : `lxPlanPrice("pro")` affiche 14,99 si `window._lxProFondateur` (salon Fondateur déjà au Pro, ou places restantes via founders_stats) → le prix affiché = le prix facturé.

## 2026-10-08 (soir) — Fin d'essai bloquante, ventes produit hors planning, revue des écritures publiques

**Fin d'essai** : écran de choix de forfait BLOQUANT (déjà au démarrage) + `lxControleFinEssai()` toutes les 5 min et au retour sur l'onglet (tablette jamais rechargée). Le retour `?checkout=success` ne débloque plus rien tant que la base n'a pas confirmé le paiement (`lxVerifierRetourPaiement`, 2 min max puis re-blocage) — avant, ajouter ce paramètre à l'URL contournait le blocage.

**Vente de produit = 0 min au planning** (signalé par Amandine) : un encaissement direct a `a_phases = []` → le planning mettait 30 min par défaut. `_lxDureeTicketDirect(a)` = somme des PRESTATIONS uniquement (produits, bons, cartes, packs achetés, acomptes : 0). Vente sans prestation → aucun bloc ; vente produit + prestation → durée de la prestation seule. Même règle côté serveur : `lx_appt_sans_duree()` dans `rdv_online_block_double_booking`, et le worker `/availability` n'envoie plus ces ventes au site.

**Revue des écritures publiques (RLS)** :
- `rdv_online` : trigger `a_trg_rdv_online_insert_public_propre` — depuis le site (anon / pas le salon) impossible de créer une réservation « acompte payé », avec ids Stripe, remboursée, etc. ; « confirmed » seulement si `site_config.confirmation_auto`.
- `commandes_online` : idem (`paye=false`, statut pending/pending_payment).
- `salons` : création réservée à un compte connecté pour lui-même (avant : WITH CHECK true, même anonyme).
- `produits_prix_historique` : insertion réservée au salon propriétaire.
- `rdv_online_validate` : une réservation « sans préférence » était refusée dès qu'UN collaborateur avait une période d'absence (ex. collaboratrice partie, absence 31/08→31/10 chez Amandine). Corrigé.
- site.html : le mode empreinte écrivait `empreinte_montant` (colonne inexistante → réservation refusée). Corrigé en `empreinte_amount` (aucun salon n'utilise ce mode aujourd'hui).
- À savoir : Click & Collect (`commandes_online`) n'est lu nulle part dans l'app salon → fonction inachevée.

## 2026-10-08 (nuit) — Empreinte bancaire, « sans préférence », Click & Collect, faille webhook

**FAILLE GRAVE CORRIGÉE (webhook Stripe)** : `checkout.session.completed` traitait TOUT paiement Checkout portant un `salon_id` (acompte d'une cliente, carte, etc.) comme un abonnement → `updateSalonPlan` : salon passé Pro/actif ET son vrai abonnement Luxyra ANNULÉ chez Stripe (anti-double-facturation). Désormais seules les sessions `mode === "subscription"` touchent au forfait. 1 seul acompte payé dans l'historique (Amandine, 20/05, salon offert → sans effet).

**Empreinte bancaire** (aucun salon ne l'utilisait, elle ne pouvait pas marcher) :
- site.html écrivait `empreinte_montant` → insertion refusée ; worker `empreinte-finalize` lisait/écrivait `empreinte_payment_intent_id` (colonne inexistante) et `empreinte_status:"authorized"` alors que capture/release/cron attendent `payment_intent_id` + `"held"`. Corrigé (+ `empreinte_held_at`, statut final selon `confirmation_auto`).
- RDV encaissé → empreinte libérée automatiquement (`lxEmpreinteReleaseAuto` dans `_lxMarkOnlineRdvDone`). Annulation cliente dans les délais → libérée (worker `releaseEmpreinteOnCancel`, sur /api/rdv/cancel et /api/client/rdv-update) ; hors délai → décision du salon. Annulation par le salon → l'app propose de libérer.

**Réservation** : « Pas de préférence » affiché seulement s'il y a ≥ 2 professionnels éligibles (1 seul → choisi d'office, déjà le cas avant + filet `_lxResoudreCollab`).

**Click & Collect** (fonction inachevée : commande impossible — insert+select refusé par la RLS —, prix/total envoyés par le navigateur, paiement jamais enregistré, rien dans l'app salon) :
- Worker : `/api/cc/commande` (session cliente obligatoire ; prix, promos, total, stock et produits « en vente » vérifiés côté serveur ; code de retrait 6 caractères ; paiement Stripe Connect si actif sinon « à régler au salon »), `/api/cc/finalize` (+ webhook `click_collect`), `/api/cc/action` (route salon : prete / retiree / annulee, emails cliente, remboursement auto si payée), `/api/client/commandes` (espace client).
- Base `commandes_online` : numero (par salon), code_retrait, mode_paiement, ready_at, collected_at/by, ticket_num, cancelled_*, refund_id ; statuts `pending_payment → a_preparer → prete → retiree | annulee`. Plus d'insert/update depuis le navigateur.
- App : tuile « Commandes » (badge, actualisation 90 s, perm. caisse), page à 3 onglets. Remise = code vérifié (ou « identité vérifiée ») ; une commande remise affiche date/heure/opérateur et ne peut plus être remise. Payée en ligne → sortie de stock à la remise. À régler au salon → « Encaisser puis remettre » : ticket NF525 normal (aucune modif fiscale), puis remise avec n° de ticket.
- ⚠️ DÉCISION ALEXANDRE (NF525) : une commande payée EN LIGNE ne génère pas de ticket de caisse (aucun mode de paiement « en ligne » en caisse). La créer = toucher à la caisse NF525 → accord requis.
- compte.html : onglet « Commandes » avec le code de retrait.

## 2026-10-09 — Note en bas des tickets (demande Delphinecoiff, promise par Alexandre dans le chat)
Paramètres → Infos établissement → « Note en bas des tickets » (colonne `salons.note_ticket`, 600 car. max, `SALON_CONFIG.noteTicket`). Rendue dans `buildTicketHTML` juste avant les mentions NF525 (affichage seulement : le hash est calculé avant le rendu, aucune donnée chaînée touchée). Bot mis à jour (clé `parametres`).

## 2026-10-09 — Gestion Stripe dans le panneau admin
- Worker `POST /api/admin/stripe` (JWT admin support@luxyra.fr obligatoire) : `overview` (revenu mensuel remises déduites, abonnés par forfait, nouveaux/départs du mois, impayés, solde, virements, litiges, factures impayées, comptes Stripe des salons) ; `salon` (abonnement, remises, factures + PDF, compte Stripe du salon et pièces manquantes, paiements des clientes 90 j) ; actions `coupon`, `retirer_coupon`, `changer_forfait` (même règle Fondateur que switch-plan), `annuler_fin_periode`, `reprendre`, `relancer_facture`, `rembourser` (motif obligatoire ; paiement cliente → `reverse_transfer` repris au salon ; refus si le paiement n'appartient pas au salon), `lien_inscription` (account_link). Toute action → `admin_log` (STRIPE_*).
- Alertes push admin : webhook `charge.dispute.created` (⚠️ à cocher dans Stripe → Webhooks) + cron quotidien `runStripeSurveillanceJob` (litiges à traiter, comptes Stripe des salons bloqués, et resynchronise `stripe_connect_status`).
- admin.html : Finance → « 💳 Stripe » ; fiche salon → « ⚙️ Gestion Stripe ». Liens Stripe en mode réel (plus `/test/`).

## 2026-10-09 — Paiements des clientes en CHARGES DIRECTES (décision Alexandre : « option 2 »)
Constat : en mode « destination » (transfer_data), Stripe prélevait ses frais sur le compte LUXYRA (−0,33 € sur l'acompte de 5 € du 20/05). Décision : les paiements des clientes sont créés SUR le compte Stripe du salon (en-tête Stripe-Account) ; le compte Luxyra ne porte que les abonnements et les packs SMS.
- Interrupteur `app_config.config.stripe_charges_directes` (FALSE au déploiement). Colonne `stripe_account` (acct_…) sur rdv_online, commandes_online, cartes_cadeaux, cartes_abo_clients ; NULL = ancien paiement « destination » (toujours géré sur la plateforme avec reverse_transfer).
- Worker : `stripeAPI(env, endpoint, params, method, compte)`, `lxChargesDirectes`, `lxSessionOu` (lit une session sur le compte du salon puis la plateforme). Bimodes : connect-payment (acompte/empreinte/carte), cc commande/finalize/annulation, rdv sur mesure (connect-pay/finalize), acompte/empreinte finalize, remboursement d'acompte, libération d'empreinte à l'annulation, admin (liste + remboursement), surveillance (litiges par compte salon).
- NOUVEAU `/api/stripe/webhook-connect` : évènements des comptes connectés, authentifiés en RELISANT l'évènement chez Stripe au nom du compte (aucun secret). click_collect → ccFinaliserPaiement ; bon_cadeau → transmis à gc-stripe-webhook (x-lx-internal) ; litige → alerte admin ; account.updated → stripe_connect_status.
- Edge functions déployées : gc-create-checkout v5, gc-stripe-webhook v7, carte-abo-confirm-payment v6, rdv-empreinte-capture v5, rdv-empreinte-release v5, cron-empreinte-auto-capture v6 (tous bimodes), rdv-demande-proposal-action v9.
- « Chemin B » SUPPRIMÉ (encaissait sur le compte Luxyra quand le salon n'avait pas Stripe) : rdv-charge-acompte et rdv-empreinte-create → 410 ; site.html → RDV sans acompte ; proposal.html + proposal-action → acompte « à régler au salon » (et refus de confirmer sans payer si le salon a un compte Stripe actif).
- MISE EN SERVICE : 1) Alexandre crée dans Stripe un webhook « Événements sur les comptes connectés » → https://luxyra.fr/api/stripe/webhook-connect (checkout.session.completed, checkout.session.async_payment_succeeded, charge.dispute.created, account.updated) ; l'admin Finance → Stripe affiche « configuré ✓ ». 2) passer `stripe_charges_directes` à true. 3) test réel (bon cadeau de 10 € chez Amandine, puis remboursement depuis l'admin).
- **ACTIVÉ le 09/10/2026 à la demande d'Alexandre** (app_config.stripe_charges_directes = true ; retour arrière = remettre false, effet sous 60 s).
- 2026-10-09 : admin cohérent avec Stripe. Bouton « forfait » d'un salon abonné → op `changer_forfait` (Stripe + base ; avant : base seule, la facture ne suivait pas). « Plan offert » sur un salon abonné → op `pause_facturation` (pause_collection void jusqu'à la date de fin) / `reprendre_facturation`. Restent en base seule (normal) : prolonger l'essai, suspendre/réactiver, crédits SMS.

## 2026-10-09 — Gestion pro (admin) : SIRET, salons, SMS
- **SIRET** : worker `GET /api/siret?siret=` (API publique recherche-entreprises.api.gouv.fr, contrôle Luhn, cache 24 h) → nom/enseigne, adresse, forme (code Luxyra), NAF → métier, dirigeant, TVA intracom, actif/fermé, fiche non diffusible respectée. Inscription : SIRET en premier (France), remplissage auto des champs vides, établissement fermé = refusé. Admin : fiche → « Vérifier le SIRET » (écarts CP / TVA signalés).
- **Salons (admin)** : liste avec filtres (statut, forfait/offert, étape, étiquette, métier, fin d'essai, inactivité, rappel), tri, sélection multiple, export CSV (Excel FR, `;`), actions groupées (email via /api/email/custom 1 envoi / 2 s, SMS, prolonger l'essai, étape, étiquette). Fiche à onglets Identité / Abonnement / Suivi / Activité / Technique & SMS. Tables `admin_suivi_salons` (étape, étiquettes, rappel) et `admin_notes_salons` (historique appel/email/rdv/note), RLS admin. Cron `rappels-admin-salons` 9 h → push admin.
- **SMS (admin)** : Communication → Packs SMS = 3 onglets (tableau de bord via RPC `admin_sms_stats`, par salon, réglages). Table `sms_mouvements` (achats de packs et bonus enregistrés par le worker, ajouts/retraits admin via RPC `admin_sms_ajuster` atomique + admin_log). `salons.sms_bloque` (RPC `admin_sms_bloquer`, protégé par le trigger facturation) → `gateSmsAndDecrementCredit` refuse l'envoi Brevo. Réglages : prix des packs, bonus, prix de réf., coût Brevo, seuil « solde bas » (`sms_seuil_alerte`).

## 2026-10-09 (soir) — Admin pro, lot 2
- **Corrigé** : Analytics cohortes/entonnoir (lisaient `s.created_at` inexistant → `created_at` ajouté à SALONS ; « payant » = `mrrOf(s)>0`), raccourcis du Cockpit (filtres appliqués), « Inscriptions pending » (compteur jamais décroissant → « Nouveaux à accueillir » = étape « nouveau » du suivi, < 30 j), revenu mensuel unique (`mrrOf` partout, tarif Fondateur inclus), Clôtures Z (filtre jour + salon), onglet Email (était une liste figée), `admin_salon_health` (plantait : « salon_id ambiguous » → l'activité affichait 0 partout).
- **Démarrage** : `salon_demarrage_etapes(salon)` (service) / `admin_salons_demarrage()` (admin) : prestations, horaires, équipe, clientes, 1er RDV, 1er ticket, 1re clôture (7 essentiels) + site, Stripe, logo. Colonne « Démarrage x/7 » + bloc dans l'onglet Suivi.
- **Relances d'essai** : worker cron `0 8 * * *` → `runRelancesEssaiJob` (J+3, J+7 personnalisé avec les étapes manquantes, J-2 fin d'essai), signées Alexandre, `salon_emails_auto` (unique salon+type, réservé avant envoi), pixel d'ouverture `/api/e/o/<id>.gif`. Interrupteur `app_config.relances_essai_actives` = **false** au déploiement (Communication → Email → Relances). Étapes « client »/« perdu » exclues.
- **Modèles d'emails** : `admin_email_modeles` (3 modèles de départ), choix du modèle à l'envoi groupé ; Historique = relances auto + emails admin.
- **Score de santé** : `lx_score_sante(salon)` 0-100 (activité 40 / volume 25 / tendance 20 / RDV à venir 15), historisé chaque jour (`salons_scores`, cron `scores-sante-salons` 07:15 UTC) + push admin si chute ≥ 25 pts en 7 j (salons > 14 j). Colonne + tri « Santé », détail dans l'onglet Activité.
- **Cockpit** : + alertes critiques (1 h), impayés, rappels du jour, clients en santé faible (< 40).

## Admin pro, lot 3 (2026-10-09)
- **Onglet 💬 Support** dans la fiche salon (`asOngletSupport` / `asChargerSupport` / `asRepondreSupport`) : mêmes tables et mêmes écritures que la page Chat support (support_conversations / support_messages).
- **Vue de l'app du salon en lecture seule** : menu Actions → « 👁 Voir l'app du salon » → `asVoirApp` (PAS de journal, demande d'Alexandre) → `/app.html?vue_admin=<salon_id>`.
  - Isolation navigateur (script en tête d'app.html) : localStorage/sessionStorage remplacés par une mémoire vide, cache IndexedDB coupé → la session et les données du salon habituellement connecté (Amandine) ne sont ni lues ni modifiées. Le client Supabase utilise la session du PANNEAU ADMIN (`sb-luxyra-admin-auth`), signOut neutralisé, pas d'écran de connexion (message à la place).
  - luxyra-supabase.js : `window._lxVueAdmin` ; refuse si l'utilisateur n'est pas support@luxyra.fr ; charge le salon par id ; bloque TOUTES les écritures (`_sb.from` insert/update/upsert/delete, `_sb.rpc` sauf founders_stats/admin_find_duplicate_clients, storage, fetch non-GET vers /api/ (sauf availability/fees/siret), /functions/v1/, /rest/v1/). Bandeau rouge. Pas de PIN opérateur, pas de déconnexion d'inactivité.
  - Lecture via les policies `admin_lecture_vue` (10 tables). Aucune écriture NF525 possible depuis cette vue.
- **Export factures Luxyra** : Finance → Stripe → « ⬇️ Export factures (CSV) » → worker `/api/admin/stripe` op `factures` (mois AAAA-MM ou 12 derniers mois), lecture seule, journalisé `STRIPE_EXPORT_FACTURES`.
- **Recherche globale Ctrl+K** (ou « 🔍 Rechercher » dans la barre latérale) : salons (côté client) + RPC `admin_recherche(p_q)` (security definer, `is_admin()` obligatoire) sur clientes (nom, email, téléphone) et tickets (numéro exact). Lecture seule.

## SMS : conversion GSM-7 avant envoi (2026-10-09)
- Problème : nos propres modèles par défaut (« À bientôt ! ») contenaient À et ô, hors alphabet SMS → message en Unicode (70 car.) → **2 crédits Brevo par SMS** alors qu'on ne débite qu'1 crédit au salon.
- Worker : `lxSmsGsm()` appliqué dans `brevoSendSms` (seul point d'envoi SMS de tout Luxyra) : ô→o, â→a, ê→e, î→i, û→u, ç→c, À→A, ’→', «»→", …→..., espaces insécables, émojis supprimés. é è ù à É Ç restent (alphabet GSM). Expéditeur inchangé.
- app.html : `lxSmsInfo` calcule sur le texte converti, le compteur affiche « converti(s) automatiquement » au lieu de l'avertissement rouge.
- Débit au nombre RÉEL de SMS Brevo (accord d'Alexandre) : RPC `decrement_sms_credits(p_salon_id, p_nb)` (service_role seul, atomique, exige sms_credits >= nb). Le worker calcule `lxSmsSegments` sur le texte converti (1 si ≤ 160 unités, sinon ceil(n/153) ; ^{}\[~]|€ = 2 unités) dans `/api/sms/custom` et `/api/sms/rappel`. Crédits insuffisants pour un long message → 402 explicite. Réponse : `smsDebites`. L'ancienne `decrement_sms_credit(uuid)` n'est plus appelée (gardée).
- Bot : entrée `sms` complétée.
- Compteur app (`lxSmsCostHtml`) : estime la taille une fois les variables remplacées (`lxSmsRempli`, vrai nom du salon + valeurs normales / longues). Rouge = >1 crédit, orange = peut dépasser avec des valeurs longues.
- Pastille solde SMS dans le bandeau d'accueil (`#lxSmsPastille`, `lxMajPastilleSms`) : Pro payant seulement, orange ≤ 30, rouge ≤ 10 (pulsation), clic → go('marketing'). Mise à jour après chaque envoi (`smsDebites`).

## 2026-10-09 (soir) — Click & Collect NF525 complet, SMS fiables, revenus SMS
- **C&C payé en ligne → ticket scellé** (accord Alexandre) : `lxCcRemettreValider` ouvre TOUJOURS la caisse (`_tk._ccPayeEnLigne`, `_ccMontantEnLigne`). Tuile unique « Payée en ligne — X € » → `lxCcPayerEnLigne` (refuse si le ticket < montant payé en ligne), mode `LX_CC_MODE_EN_LIGNE` = « Payé en ligne (Click & Collect) » → poste `enligne` (`_mapPaymentBucket` déjà ; `_lxPayBuckets` app + edge `lx-cloture-auto` v2 alignés, verify identique avant/après). Stock sorti par le ticket. Worker `/api/cc/action retiree` exige `ticket_num` dans tous les cas. Registre NF525 complété.
- **SMS** : `lx_prive.sms_nb(text)` (nb réel de SMS) utilisé par `envoyer_rappels_24h`, `traiter_sms_differes` (saute un long message si pas assez de crédits), `fn_sms_confirmation_resa_online` (crédits insuffisants → `sms_differes`). App : `sendSms` met en attente si crédits < nb SMS du message.
- Worker `lxEnvoyerSmsFacture` : Brevo refuse → crédits rendus (`crediter_sms` type `remboursement_echec`, `sms_mouvements`, `sms_conso_jour.nb_rembourses`) + réponse 502 `success:false` (l'app libère la réservation messaging_log) ; Brevo facture plus (smsCount) → différence débitée si possible ; solde qui passe sous 10 → email `notifySalonCreditBas` (1×/24 h, `salons.sms_alerte_basse_le`).
- Packs SMS : crédit ATOMIQUE `crediter_sms` (avant : lecture puis écriture). Les SMS en attente repartent via le déclencheur existant `trg_sms_recharge`.
- `sms_conso_jour` (salon, jour, nb_sms, nb_rembourses) alimentée par `decrement_sms_credits` / `crediter_sms`. `admin_sms_stats` : `en_attente` = statut en_attente seulement (affichait 9 chez Amandine alors que tout était parti), + `conso_mois`, `conso_par_mois`, `conso_depuis`.
- Admin SMS : carte « SMS facturés ce mois » (nb réel) + tableau « 💶 Revenus SMS (12 mois) » : packs vendus (worker `/api/admin/stripe` op `sms_revenus`, sessions Checkout `metadata.type=sms_pack`), SMS facturés, coût (`sms_cost_brevo_eur` = 0,06), marge.

## 2026-10-09 (nuit) — Revue complète des 4 derniers jours + corrections
- Alertes SMS gérant : UNE fois par épisode (`trg_sms_alertes_reset` remet `sms_alerte_basse_le` / `last_sms_credit_alert_at` à null quand le solde remonte > 10). Alerte « épuisé » seulement si solde réellement à 0 (`gate.soldeZero`).
- Worker : `customer.subscription.updated` reconnaît PRICE_PRO_FOUNDER (repassait les Fondateurs en Essentiel) ; prix inconnu = forfait inchangé. `handleSwitchPlan` met `metadata[plan]`. Pack SMS idempotent (id de session Stripe dans `sms_mouvements.motif`). Annulation C&C non payée filtrée `paye=eq.false` (paiement concurrent jamais annulé sans remboursement).
- Vue admin : `createClient(..., {global:{fetch: → window.fetch}})` pour que supabase-js (fonctions serveur, stockage = getters qui recréent un client) passe par le filtre lecture seule ; stockage en écriture bloqué (sauf sign/list).
- C&C : relecture du statut en base avant d'ouvrir la caisse (jamais deux tickets pour une commande).
- `_lxRafraichirClotures` garde une Z locale non encore enregistrée (sauf si la journée existe en base).
- Admin : garde lecture `app_config` avant fusion (emBasculer, smsSauverReglages) ; apostrophes dans onclick (historique SMS, étiquettes) ; confirmations Suspendre / Réactiver / Lien mot de passe.
- Connu, non traité : webhook Connect ne finalise pas acomptes/empreintes/cartes si la cliente ferme l'onglet (finalisation au retour seulement, déjà le cas avant) ; bande mensuelle `_modeCanonique` range « Payé en ligne » en « Autre » (affichage).
- Monitoring : `/api/siret` ne renvoie plus de 5xx quand l'annuaire officiel est indisponible (1 nouvel essai, puis 200 `{ok:false, indisponible:true}`) ; `run_public_booking_error_check` ignore les erreurs injectées par des extensions/portefeuilles crypto (window.ethereum, chrome-extension://…) — fausse alerte « réservation bloquée » du 08/10. search_path figé sur sms_nb, sms_alertes_reset, lx_appt_sans_duree, lx_salon_pro_actif.

## 2026-10-10 — Points restants de la revue
- Webhook Connect (`handleWebhookConnect`) : `checkout.session.completed` payé sur le compte du salon rejoue la finalisation de la page si la cliente a fermé l'onglet : acompte → `handleAcompteFinalize`, empreinte (`subtype=empreinte`) → `handleEmpreinteFinalize`, `rdv_demande_acompte` → `handleRdvDemandeFinalize` (token `metadata.proposal_token`), `carte_abo` → edge `carte-abo-confirm-payment`. Idempotent (« déjà » = normal) ; 5xx → Stripe réessaie ; refus 4xx → warning monitoring. Index unique `rdv_online_payment_intent_unique` (un paiement = un seul RDV, course page/webhook).
- Rapports mensuels : `_lxEstEnLigne(met)` ; rapport HTML : ligne « Payés en ligne (Click & Collect) » ; export Documents comptables (lignes à index fixes) : libellé « Autres (dont payés en ligne : X €) ». `_modeCanonique` inchangé.
- Surveillance Stripe (`runStripeSurveillanceJob`) : alerte « compte Stripe à régulariser » seulement pour un compte qui encaissait (actif) ; une inscription Stripe commencée puis abandonnée (Delphinecoiff, statut incomplete) n'alerte plus. Une seule alerte par situation (signature dans app_secrets `stripe_alerte_<acct>`, effacée quand tout redevient normal).
- 2026-10-10 : bandeau orange « NF525 — Configurez vos opérateurs » qui apparaissait par moments chez Amandine : `loadOperateurs` renvoyait `[]` quand la lecture échouait (réseau / base lente) -> bandeau + passage sans PIN. Désormais `null` en cas d'échec ; `refreshOperateurs` garde la liste connue, pose `window._lxOpsIndispo` (bandeau masqué) et réessaie 20 s plus tard.
- 2026-10-10 : `verify_nf525_status` (panneau admin « Inaltérabilité ») cherchait un déclencheur « tickets_nf525_protect » inexistant (nom de la fonction) -> 8/9 en permanence. Remplacé par `ticket_nf525_update_trg` et seuls les déclencheurs actifs (tgenabled<>'D') comptent : 9/9. Aucune protection ni donnée modifiée.

## RÈGLE (à partir du 30/10/2026) — GRANT explicites sur toute nouvelle table public
Supabase ne donne plus automatiquement l'accès API aux nouvelles tables du schéma public. Toute migration qui crée une table DOIT inclure dans la même migration les GRANT nécessaires (et rien de plus que nécessaire), en plus de RLS + policies :
- table lue/écrite par l'app (session salon) : `grant select, insert, update, delete on public.X to authenticated;`
- table publique (site) : `grant select on public.X to anon;` seulement si une policy anon existe
- toujours : `grant select, insert, update, delete on public.X to service_role;` (worker, edge functions)
- table interne lue seulement via RPC security definer : service_role uniquement.
Tables existantes : inchangées.

## À savoir (2026-10-10)
- Projet Supabase en offre GRATUITE (org « Luxyra », plan free) : sauvegardes non garanties / non téléchargeables ; ni PITR. Pour une caisse NF525 (conservation 6 ans), prévoir offre Pro (+ sauvegarde externe).
- Brevo : le worker utilise `POST /v3/transactionalSMS/sms` (DÉPRÉCIÉ par Brevo, toujours fonctionnel ; renvoie smsCount/usedCredits). Le nouveau `POST /v3/transactionalSMS/send` ne renvoie que messageId (débit alors basé uniquement sur `lxSmsSegments`). Statistiques : `/v3/transactionalSMS/statistics/reports` (par jour), `/events`.

## 2026-10-10 — SMS Brevo suivis de bout en bout + sauvegarde de nuit
- Envoi : `brevoSendSms` utilise `POST /v3/transactionalSMS/send` (nouvel endpoint ; numéro sans « + »), `tag` = `salon_<id>`, `webUrl` = `/api/brevo/sms-event?r=<id sms_envois>&s=<HMAC>` ; repli automatique sur l'ancien `/sms` si le nouveau répond 5xx/404.
- Table `sms_envois` (un enregistrement par SMS : nb_sms, message_id, statut en_cours/envoye/livre/en_attente/echec, événements, rembourse). `/api/brevo/sms-event` (signature HMAC de la référence, clé = service key) : delivered → livré (définitif) ; hardBounce/rejected/blocked/skipped/error… → échec + `sms_envoi_rembourser` (crédit rendu UNE fois) ; softBounce → en attente.
- Cron 08:00 UTC : `runSmsRapprochementJob` compare la veille (heure de Paris) Luxyra vs Brevo (`/statistics/reports`) → alerte push si écart (pas le 1er jour du suivi), et solde SMS du compte Brevo Luxyra (`/v3/account`) → alerte UNE fois sous 200. Résultat dans `app_secrets.sms_rapprochement_dernier`, affiché dans Admin → SMS (carte « Distribution »).
- Sauvegarde : `.github/workflows/sauvegarde-nuit.yml` (00:30 UTC) : pg_dump 17 → gpg AES-256 (BACKUP_PASSPHRASE) → POST vers un script Google Apps Script (`docs/sauvegarde-drive.gs`, application Web) qui dépose le fichier dans Google Drive « Sauvegardes Luxyra » (60 jours). Secrets GitHub : SUPABASE_DB_URL (Session pooler), BACKUP_PASSPHRASE, GDRIVE_WEBAPP_URL, GDRIVE_SECRET (= propriété LUXYRA_SECRET du script). Sans eux : arrêt propre.

## 2026-10-10 — Entreprise en cours d'immatriculation
- inscription.html : case « en cours d'immatriculation » (`DATA.enCoursImmat`) -> essai sans SIRET (`siret: null`).
- app.html : bandeau orange sur l'accueil tant que `SALON_CONFIG.siret` est vide ; Paramètres → Infos établissement : champ + `lxSiretAjouter()` (vérif `/api/siret`, établissement actif, confirmation, complète SIREN/TVA si vides, audit `SIRET_AJOUTE`).
- Worker `handleCreateCheckout` : abonnement refusé sans SIRET (`code: siret_requis`) — sinon paiement accepté mais passage « actif » refusé par `salon_siret_required_trg`.
- Base : `trg_salons_siret_verrou` (lx_prive.salons_siret_verrou) : un salon ne peut qu'AJOUTER un SIRET vide (14 chiffres) ; le modifier = admin/service uniquement (avant : verrou seulement dans l'écran).
- Bot : entrée `abonnement` complétée.

- 2026-10-10 : tickets / devis d'un salon sans SIRET : « SIRET : en cours d'attribution (immatriculation en cours) » (affichage seulement, hors empreinte).
- 2026-10-10 : sauvegarde de nuit Google Drive EN SERVICE (premier essai OK, fichier reçu dans « Sauvegardes Luxyra »).

## 2026-10-10 — Alerte SIRET incohérent + test de restauration
- inscription.html : `lxSiretIncoherence()` compare le gérant saisi au dirigeant / raison sociale officiels (fiche non diffusible ou « en cours d'immatriculation » : pas de contrôle). Avertissement non bloquant (confirm) ; résultat stocké dans `config_json.siret_controle` ({coherent:false, detail} / {coherent:true} / {en_cours:true}).
- admin.html : `s.siretAlerte` (incohérence ou SIRET manquant) -> badge « ⚠️ SIRET » dans la liste + encadré dans Informations légales.
- `.github/workflows/test-restauration.yml` (1er du mois 03:30 UTC + manuel) : comptage lecture seule de la base réelle -> pg_dump -> gpg -> déchiffrement -> pg_restore (--disable-triggers) dans un Postgres 17 jetable -> comparaison des comptages (tickets, clôtures, audit_log, clients, appointments, salons, cartes_cadeaux, nf525_hash_seal, auth.users). Échec = mail GitHub.

## 2026-10-10 — Recharge SMS automatique
- Colonnes salons : `sms_recharge_auto`, `sms_recharge_seuil` (5-500), `sms_recharge_pack` (100/250/500/1000), `sms_recharge_dernier`, `sms_recharge_echec`. RPC `sms_recharge_verrou` (1 tentative / 10 min, service_role).
- Worker : `lxRechargeAutoSiBesoin` appelé (ATTENDU, pas en arrière-plan) après chaque SMS débité et sur refus 402 ; PaymentIntent hors session (`off_session`, `confirm`) sur la carte de l'abonnement (`lxCarteAbonnement` : défaut client > abonnement > 1re carte), metadata `type=sms_recharge_auto`, reçu Stripe ; crédit `crediter_sms` idempotent (id du paiement dans le motif). Échec → option désactivée + email gérant + push admin (aucune tentative répétée).
- Route salon `/api/sms/recharge-auto` (op `etat` / `regler`) ; app : carte « 🔁 Recharge automatique » dans Paramètres → SMS (`lxRechargeAutoCharger` / `lxRechargeAutoRegler`, confirmation à l'activation). Admin revenus SMS : inclut les recharges auto (recherche Stripe des PaymentIntents).
- Bot : entrée `sms` complétée.
- 2026-10-10 : test de restauration RÉUSSI (premier essai manuel vert : déchiffrement + restauration + comptages identiques).

## 2026-10-10 — Export RGPD complet + factures Luxyra conformes
- RPC `rgpd_export_client_data(p_client_id)` (propriétaire du salon ou admin) : fiche, RDV, tickets, tickets en attente, devis, forfaits, cartes, factures, anciennes factures, réservations/demandes/commandes en ligne, fidélité, avis. Utilisée par `exportClientData` (fiche cliente → « Exporter les données »). Voyant « portabilité » du panneau NF525/RGPD : vert.
- `factures_luxyra` : colonnes `type` (abonnement / sms_pack / sms_recharge_auto), `montant_brut`, `remise`, `remise_libelle`, `date_paiement` ; numéro attribué par trigger `lx_prive.factures_luxyra_numero` (verrou, LUX-AAAA-0001, sans trou ni doublon ; l'ancienne RPC next_facture_numero n'est plus utilisée) ; index uniques (1 facture par facture Stripe / par paiement SMS) ; trigger `factures_luxyra_inalterable` (ni modification ni suppression ; salon supprimé -> salon_id null autorisé).
- Worker : invoice.paid -> montant réellement payé y compris 0 € (avant : 0 € facturé au prix catalogue !), prix avant remise + remise détaillée (crédit parrainage / code promo) ; `lxFactureSms` pour packs (checkout) et recharges auto.
- Modèle de facture (app.html `printFactureSalon`) : « Alexandre Jensen EI », adresse éditeur (`app_config.luxyra_adresse`, champ ajouté dans Admin → Configuration ; À RENSEIGNER), SIRET 14 chiffres (91092846400023), SIREN/TVA du client, nature « prestation de services », ligne de remise, « facture acquittée le … », pas d'escompte, pénalités de retard + indemnité forfaitaire 40 €.

## 2026-10-10 — Parrainage entre salons
- salons : `code_parrainage` (unique, LX + 6, attribué à tous + à l'inscription), `parrain_code` (saisi à l'inscription), `parrain_id` (résolu par trigger `lx_prive.salons_parrainage_insert`, jamais soi-même). Verrou `trg_salons_parrainage_verrou` (ni le salon ni personne sauf admin/service ne les change). Table `parrainages` (parrain, filleul unique, statut inscrit/en_cours/en_attente/recompense/refuse, montant, stripe_ref) ; lecture : le parrain et l'admin. RPC publique `parrainage_verifier(code)` -> nom du salon.
- Récompense (worker, invoice.paid avec amount_paid > 0 du FILLEUL) : `lxParrainageRecompenser` -> crédit Stripe `customers/{parrain}/balance_transactions` = 1 mois de SON abonnement (prix × quantité), déduit de sa prochaine facture ; facture Luxyra : remise « mois offert — parrainage ». Garde-fous : même SIREN / même client Stripe refusé, 12 mois max / an, verrou de statut (pas de double crédit). Parrain sans abonnement payant (essai, offert) -> `en_attente`, appliqué par `lxParrainageAppliquerEnAttente` à chacune de ses factures payées. Email au parrain + push admin.
- inscription.html : champ « Code parrainage » (étape 2), prérempli par `?parrain=CODE`, vérifié en direct. app.html : Paramètres → « Parrainer un salon » (code, lien, partage WhatsApp/SMS/Email, liste des filleuls et statut). admin : ligne parrainage dans la fiche (code, parrain, filleuls). Bot : entrée `parrainage`.
- Parrainage : page avec « comment ça marche » en 3 étapes + message prêt à envoyer (modifiable, copier / WhatsApp / SMS / email) ; carte discrète fermable sur l'accueil (localStorage lx_parr_masque). Adresse éditeur renseignée (29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines).
- 2026-10-10 : inscription.html refondue (charte du site : Cormorant Garamond + DM Sans, vrai logo /luxyra-logo.png, colonne de présentation de l'offre, carte de formulaire, étapes nommées, bandeau « Vous êtes invité par X » via `parrainage_verifier`, mobile compact). Classes CSS utilisées par le JS conservées. Vocabulaire parrainage : « professionnel / établissement » (pas « salon »). pro.html : pastille « Nouveau · Parrainage » dans le hero, lien menu, section #parrainage (3 étapes + conditions), question FAQ JSON-LD.

## 2026-10-10 — Documents légaux mis à jour (CGV, contrat v1.2, DPA, confidentialité, mentions)
- CGV (en vigueur 10/10/2026) : éditeur « EI » + adresse ; art. 3 inscription en cours d'immatriculation ; art. 5 factures (comptant, pas d'escompte, pénalités + 40 €) ; NOUVEAU 5 ter Crédits SMS (160 car., conversion, recrédit si non distribué, recharge automatique = autorisation de débit) ; NOUVEAU 6 bis Parrainage ; art. 9 export RGPD par cliente + sauvegardes chiffrées 60 j ; NOUVEAU 12 ter paiements des clientes sur le compte Stripe du salon ; NOUVEAU 14 bis modification des CGV (préavis email 30 j).
- Contrat d'inscription : CONTRAT_VERSION 1.2 (EI/adresse, immatriculation, 7.2/7.3 sous-traitants + transfert sauvegardes Google/GitHub sous DPF, 7.4 sauvegardes, art. 9 bis SMS/parrainage/paiements/évolution).
- DPA : sauvegardes chiffrées 60 j vérifiées, sous-traitants Google + GitHub, art. 8 localisation (DPF), conservation 60 j (alignée CGV, était 30 j).
- Politique de confidentialité (10/10/2026) : sauvegardes + Google/GitHub. Mentions légales : « Alexandre Jensen EI », statut EI micro-entreprise.
- À FAIRE (Alexandre) : informer par email les abonnés existants des nouvelles conditions et des nouveaux sous-traitants (préavis 30 j prévu par le DPA) ; relecture par un juriste conseillée.

## 2026-10-10 — Mise en conformité textes ↔ application (audit)
- Justificatifs : bucket `salon-documents` PRIVÉ ; `lxOuvrirDoc(url)` (app + admin) ouvre par URL signée 5 min.
- QR codes : `lx-qrcode.js` (qrcode-generator, MIT) — `lxQrDataUrl(texte, px)` ; plus d'appel à qrserver.com / cdnjs.
- RGPD J+60 : `lx_prive.salon_fin_service` (résilié → cancelled_at ; suspendu → past_due_since ; essai non transformé → trial_end ; is_free exclu), RPC `rgpd_purge_candidats` / `rgpd_purge_salon` (rgpd_delete_client_atomic par cliente, rdv/demandes/commandes anonymisés, messaging_log sans nom, sms_differes supprimés, audit `RGPD_PURGE_J60`), colonnes `rgpd_preavis_le` / `rgpd_purge_le`, trigger de réactivation. Worker `runRgpdPurgeJ60` (dans runRetentionPurgeJob, cron 03:00) : email J-7 (à J+53), purge ≥ J+60 et préavis ≥ 6 j, photos client-photos/<salon>/ supprimées, push admin.
- Admin : double authentification TOTP (`lxMfaGate`, `lxMfaActiver`, bandeau d'invitation) ; `is_admin()` exige aal2 dès qu'un facteur est vérifié ; worker `lxIsAdminUser` idem (claim aal du jeton + u.factors). ⚠️ Alexandre doit l'activer.
- Mode archives : carte « Récupérer mes données » dans la compta (exportAllData, exportTicketsCSV, exportFEC, factures) ; « Reprendre l'abonnement » = nouveau paiement (`lxArchiveReprendre` → startCheckout).
- Fondateur : `is_founder=false, founder_num=null` à la résiliation et au passage en Essentiel (worker). Justificatifs : 15 j à partir de `salons.abonne_depuis` (1er paiement, posé par invoice.paid).
- Polices auto-hébergées `/fonts/luxyra-fonts.css` (Fontsource, OFL) + `/vendor/` (leaflet, jszip, xlsx-js-style) + `/supabase.min.js` partout (URL absolues https://luxyra.fr/… car site.html est servi sur les sous-domaines ; GitHub Pages renvoie ACAO *). Plus aucun Google Fonts / jsdelivr / unpkg / cdnjs. Restent : Stripe.js, tuiles OpenStreetMap France (déclarées).
- Textes : CGV (empreinte « susceptible d'être capturée » + limite ~7 j, acompte selon politique du salon, acceptation expresse = empreinte, résiliation espace ou email, sauvegardes +30 j corbeille), contrat v1.3 (résiliation, 7.4 double authentification + journalisation des opérations, 7.5 48 h, sous-traitants OSM + ntfy), DPA (catégories : naissance, notes, photos, santé ; violation 48 h ; TLS 1.2+ ; double authentification ; OSM + ntfy ; opposition → résiliation sans frais), politique (TLS, EI, OSM, ntfy).
- 2026-10-10 : déverrouillage biométrique des opérateurs (WebAuthn, authentificateur de plateforme : Face ID / Touch ID / empreinte Android / Windows Hello). Proposé après une connexion PIN (une fois par opérateur et par appareil, refus mémorisé `lx_bio_refus_<op>`), identifiant de clé stocké localement `lx_bio_<salon>` = {opId: credentialId}. Pavé PIN : bouton « Face ID / empreinte » (+ tentative auto), lien « ne plus utiliser ». `operatorLoginBio` (luxyra-supabase.js) : mêmes contrôles que le PIN (actif, non verrouillé). Audit OPERATEUR_BIOMETRIE_ACTIVEE / OPERATEUR_CONNEXION_BIOMETRIE. Aucune donnée biométrique ne quitte l'appareil. PIN toujours disponible.
- 2026-10-10 (suite) : biométrie limitée à UN profil par appareil (`_lxBioAutreProfil`) et proposée seulement pour un appareil personnel — l'authentificateur accepte tout visage/empreinte enregistré sur l'appareil, donc sur une tablette partagée la traçabilité opérateur (NF525) serait faussée. Registre interne `admin_consultations` (RLS is_admin) rempli à chaque « Voir l'app (lecture seule) » — hors journal NF525 du salon. Site public aligné : plus de PITR / « 7 jours » / « aucune donnée hors UE » / ISO 27001 Supabase (le plan FREE n'a AUCUNE sauvegarde Supabase : seule notre sauvegarde de nuit chiffrée Drive existe). Contrat d'inscription v1.4.
- 2026-10-10 : ATTESTATION NF525 AU MODÈLE OFFICIEL BOI-LETTRE-000242 (25/03/2026), accord d'Alexandre. Texte et constantes dans `lx-nf525-attestation.js` (LX_ATT : version 6.3.0, majeure « 6 », mise sur le marché 11/05/2026 = 1er ticket d'Excellence Coiffure). Volet 1 signé UNE fois par version majeure depuis l'admin (bandeau « Lire et signer », RPC `nf525_signer_editeur`, is_admin + aal2) ; volet 2 signé dans l'app (Paramètres → Caisse → Conformité NF525 → Mon attestation : ressaisie du mot de passe via client Supabase séparé, RPC `nf525_signer_etablissement`, dates ≥ mise sur le marché). Tables `nf525_attestation_editeur` / `nf525_attestations` INALTÉRABLES (trigger + aucun droit d'écriture direct), IP/UA/SHA-256 stockés. Anciennes fonctions `genererAttestation` / `lxDownloadAttestationNF525` = alias. `nf525-attestation-generale.html` devenue « fiche technique » (n'est plus une attestation). ⚠ Changer la version MAJEURE impose une nouvelle signature (§ 340 BOI-TVA-DECLA-30-10-30). LF 2026 art. 125 a rétabli l'attestation éditeur (pas l'« article 43 », qui est la LF 2025 qui l'avait supprimée).
- 2026-10-10 : VOCABULAIRE NF525 (accord d'Alexandre). Luxyra n'est PAS certifié NF525 (marque de certification Infocert/AFNOR). Formulations autorisées : « caisse conforme à la loi anti-fraude TVA (art. 286, I, 3° bis CGI) », « attestation éditeur au modèle officiel ». JAMAIS « certifié », ni « conforme NF525 » comme argument commercial. « NF525 » seulement en contexte explicatif (« la NF525 est une certification… »). Site, blog, CGV art. 10, contrat d'inscription v1.5, documents imprimés (Z, bandes, exports), email ticket (worker) et bot alignés. Version logiciel affichée : v6.3.0 (= attestation).
- 2026-10-10 : rappels attestation (volet 2) : bandeau vert sur l'accueil de l'app dès le 1er ticket si non signée (`lxAttStatutCharger`, masquable 7 j) ; admin page Conformité = liste signées / à signer + interrupteur `app_config.relance_attestation_active` (OFF par défaut) ; worker cron 08:00 `runAttestationRelanceJob` = UN seul email par établissement (salon_emails_auto type attestation_v6), 2 j après le 1er encaissement. Logo Luxyra dans l'en-tête du document.
- 2026-10-10 (suite) : rappels attestation SEULEMENT pour les abonnements payés (status active) — choix d'Alexandre ; en essai l'attestation reste accessible dans Paramètres → Caisse. Accueil de l'app : un seul bandeau d'info à la fois (priorité SIRET > attestation > parrainage). Emails : mise en page commune `lxMailLayout` (logo, noir/or, mentions de l'expéditeur) utilisée par relMail, ccMail, parrainage, rappel attestation. `relance_attestation_active` = true (activé par Alexandre).
- 2026-10-10 : attestation / obligation caisse NON applicable aux établissements en FRANCHISE DE TVA (taux_tva = 0, art. 293 B) ni hors de France : `lxAttConcerne()` (app) masque bandeau + bouton et affiche une explication ; worker `taux_tva=gt.0` + pays ; admin « non concerné ». Passage au régime TVA ⇒ attestation proposée automatiquement.
- 2026-10-10 : emails aux clientes envoyés par l'app = marque du salon (logo/nom) + `lxEnvoyeVia()` (petit logo « Envoyé via Luxyra ») ; textes simples via `lxEmailSalonTexte()`. Emails serveur (worker + edge functions) = `lxMailLayout` (option `salon` pour les clientes). Installation PWA : `lxInstallerApp()` (beforeinstallprompt ou instructions iOS/Android/Mac/PC), Paramètres → « Installer l'application », carte sur l'accueil (dernière priorité, masquable 30 j) ; email J0 d'accueil (salon-onboarding-email v13) explique l'installation.
- **E-mails : logo https://luxyra.fr/email/luxyra-logo-128.png (jamais luxyra-logo.png, trop lourd)** — 29/10/2026 : worker, app.html, inscription.html (c552a37) puis les 10 edge functions dont l'en-tête `lxMailLayout` l'utilisait (lx-password-reset v6, lx-signup v11, lx-profile v10, salon-onboarding-email v15, gc-stripe-webhook v12, salon-billing-email v8, avis-invite-email v10, rdv-online-modified-email v9, lx-alert-mail v13, migration-request v14 ; verify_jwt false inchangé ; seul l'URL a changé). Détail, avant/après : `docs/edge_1029_logo/`. Reste hors e-mail (og:image, redirections, manifestes) inchangé ; `docs/migrations_1015/support_chat.sql` (e-mail généré en SQL) et la constante inutilisée `LOGO_URL` de migration-request gardent l'ancienne adresse.
- 2026-10-10 : emails de l'app aux clientes refaits sur un gabarit commun `lxEmailSalon()` (logo + nom du salon, badge titre, carte de détail, boutons Réserver / Mon espace, coordonnées complètes cliquables `lxSalonCoordonneesHtml()` : adresse→Google Maps, tél, email, lien de réservation, réseaux, puis « Envoyé via Luxyra »). Confirmation/rappel RDV gardent leur carte détaillée avec ce nouveau pied ; carte d'abonnement, proposition sur mesure, anniversaire, « vous nous manquez », campagnes et test utilisent le gabarit.
- 2026-10-10 : RDV sur mesure — une proposition NE bloque PAS le planning. Vérification `lx_creneau_libre()` (SQL, service_role) avant paiement (worker connect-pay) et avant confirmation sans paiement (edge rdv-demande-proposal-action v11) ; si pris → 409 à la cliente (aucun paiement), `refuse_reason` posé, trigger `trg_notif_demande_creneau_pris` → notification « Créneau pris : proposition à refaire » au salon. Après paiement (finalize / webhook) le RDV est toujours créé.
- 2026-10-10 LOTS 1+2 (audit métiers / domicile / acompte) :
  - Métiers : `METIER_TEXTES` + `getMetierTxt()` (relance SMS, exemples, fiche technique, demande sur mesure), `lxRelanceTexte()` remplace l'ancien SMS coiffure par défaut chez les autres métiers, `getCatIcon` étendu (+ repli icône du métier), `getSvcColor` palette stable.
  - Domicile : `lxSyncDomicileColonnes()` (début de saveSalonConfig) écrit mode_activite / zone / frais / type dans `salons` (lus par mini-site, recherche, SEO). Site : `SALON.domicileCfg` (config) pour km gratuits ; géocodage de secours si pas de GPS ; adresse masquée si 100 % domicile (site, JSON-LD, worker SEO, recherche arrondie, pied d'email).
  - RDV en ligne : `lxMapRdvOnlineRow` (lieu, adresse, frais, remise) + `_lxApOnlineEnrichir()` (frais séparés du prix, acompte en ligne repris) au chargement, dans `_lxOnlineToAP` et à la relecture 30 s (qui ajoute aussi un RDV passé de pending_payment à confirmé et respecte un statut local annulé/encaissé).
  - Caisse : ligne « 🚗 Déplacement » auto dans mD si a.fraisDepl ; simple avertissement si acompte en ligne > panier (calcul inchangé).
  - Acompte en ligne d'un ticket encaissé : persisté via items[].isAcompteData (`_lxItemsAvecAcompteEnLigne` dans saveAppointment) — ATTENTION trigger appointments_nf525_protect : items d'un ticket done INALTÉRABLES -> l'élément doit être strictement identique à chaque écriture ; lxMapApptRow le retire de la liste en mémoire (st done).
  - Annulation d'un RDV en ligne avec acompte : choix « l'établissement annule » (cancelled_by salon -> toujours remboursé, pour les annulations à partir du 10/10/2026 21:30 UTC) ou « cliente absente » (cancelled_by no_show -> acompte conservé).
- 2026-10-11 : RDV à domicile = demande « pending » (site : bouton « Envoyer ma demande », aucun paiement) ; app : bloc « Demande à valider » dans la fiche RDV (`lxRdvAccepter` / `lxRdvProposer` / `lxRdvRefuser`), badge « ⏳ À valider », carte accueil ; à l'acceptation, si acompte et Stripe Connect actif : jeton `rdv_online.acompte_token` + lien https://luxyra.fr/acompte.html?t=… (endpoint worker /api/rdv/acompte-info ; finalize garde « confirmed »). Message cliente : email (gabarit salon) sinon SMS ≤160 car. Trigger SMS de confirmation : plus envoyé pour une demande « pending ».
- 2026-10-11 : communes desservies `SALON_CONFIG.domicile.communes` [{code INSEE, nom, cp, forfait?}] (geo.api.gouv.fr), type de tarif « commune » ; site : contrôle par citycode BAN + forfait de la commune.
- 2026-10-11 : 4 nouveaux métiers : regard, maquillage, tatouage, spa (app METIER_CONFIG/TEXTES, histo, photos, onglet fiche ; inscription ; site ; recherche ; admin ; index ; worker SEO).

## 2026-10-11 — Correctifs relecture validation domicile
- Refus d'une demande : statut `cancelled` + cancelled_by salon (« refused » interdit par rdv_online_status_check) → acompte remboursé par le cron, empreinte libérée (lxEmpreinteReleaseAuto).
- Accepter / refuser / autre horaire : update gardé par `.eq("status","pending").select()` ; autre horaire = update direct date_rdv/heure_rdv SANS salon_modified_at (évite le double email).
- _lxMessageCliente : vérifie r.ok de l'email, repli SMS, sinon affiche le lien d'acompte au pro.
- Worker : connect-payment refuse un RDV non actif ou acompte déjà payé (409) ; acompte-finalize ne touche jamais un RDV cancelled/refused/done (enregistre le paiement + alerte critique pour remboursement) ; acompte-info : done = non payable.
- site.html : arrondissements Paris/Lyon/Marseille normalisés (75056/69123/13055) avant la comparaison des communes.
- compte.html : statut refused affiché « Non retenu ».

## 2026-10-11 — Exercice comptable, retenues en caisse, TVA à l'encaissement (NF525 — accord d'Alexandre)
- salons.exercice_fin_mois (1..12, fin de mois ; micro forcé 12 par trigger lx_prive.salons_exercice_trace, changement tracé audit_log CONFIG_EXERCICE). Amandine = 3 (31 mars).
- clotures_exercices (inaltérable, chaînée 'ZE|debut|fin|ca|nb|prev|siret', depuis les Z journaliers) ; cloturer_exercice(salon, date_fin) ; run_cloture_exercice_pour_tous() cron 03:50 (mois<>12 ; le 31/12 = clôture annuelle civile inchangée). factory_reset_salon purge aussi la table. UI : carte « Exercice comptable » (lxExerciceCarte…).
- Retenues : rdv_online.retenue_at (décision définitive : no_show app / worker conserve:true hors délai ou remboursement désactivé), retenue_tk_num/claim_at, empreinte_tk_num/claim_at. lxRetenuesSync (poll ≤ 1×/5 min, jamais après 23 h, jamais jour clôturé) crée un ticket scellé met « En ligne (Stripe) », cId passage, TVA au taux du salon (prudence BOI-TVA-BASE-10-10-50). Verrou définitif + index unique tickets(salon_id, raw_data->>'retenueKey'). Le cron de remboursement ignore retenue_at non nul.
- rdv_online.acompte_paye_at / commandes_online.paye_at posés par trigger (historique = confirmed_at/created_at).
- Exports (lecture seule) : expTvaPaiementsEnLigne (ajustement TVA à l'encaissement, régime réel) ; expLivreRecettes (micro : recettes encaissées, bons cadeaux exclus au règlement).
- Le modèle de caisse de l'acompte en ligne (mode de règlement « enligne » au jour de la prestation) est INCHANGÉ.

## 2026-10-11 (soir) — Audit persistance + comptabilité
- Persistance : slot/slot_h en section config ; liens sociaux effaçables ; thème -> salons.couleur_primaire ; table forfaits fait foi ; défauts domicile avant enregistrement ; cagnotte/caTotal dans fiche_tech ; édition RDV en ligne n'écrit plus message/items ; caisse/absences/comptes via lxCfgEcrireSections ; lxChargerRdvOnline (actifs + 400 j, pages de 1000).
- Règle unique des totaux mensuels : _lxCaOk(a) (annulation même jour exclue, autre jour : original au jour d'origine + contre-ticket au jour d'annulation) = somme des Z.
- _lxJournalVentes : journal unique (CSV, ZIP, Excel), montants négatifs inversés, contrepartie par mode réel (_lxPayBuckets), 293B sans TVA. FEC négatifs équilibrés.
- Contre-ticket : items ventilés prestations/produits, payments inversés (+ ligne acompte en ligne). RDV relibéré garde l'acompte. _splitPrestProd gère les négatifs.
- Acompte salon cumulatif (versements[] dans l'item isAcompteData ; annulation remboursée par mode de chaque versement).
- lxTauxTVA partout (plus de ||20) ; franchise -> tvaProduits=0 ; URSSAF 2026 = taux + CFP (_lxTxUrssaf) ; seuils micro 2026-2028 (83 600 / 203 100 ; TVA 37 500 / 85 000).
- Bons cadeaux : libellés = CA à la vente (706), TVA incluse ; « obligatoire » seulement si lxAttConcerne().

## 2026-10-11 — Démo libre + site par métier
- app.html?demo=<metier>[&mode=salon|domicile|mixte][&page=…][&embed=1] : lx-demo.js (chargé après supabase.min.js) remplace supabase.createClient par un client SIMULÉ en mémoire (données fictives générées par métier), bloque tout appel réseau API, isole le stockage (comme vue_admin), opérateur ouvert sans PIN. Rien n'est jamais écrit en base. Testé : 9 métiers × 3 modes × 13 pages sans erreur, encaissement + clôture Z complets.
- Pages métier générées par docs/generateurs/build.py (logiciel-coiffure, -barbier, -institut-beaute, -onglerie, -cils-sourcils, -maquilleuse, -tatouage-piercing, -spa-massage, -bien-etre) + demo.html ; iframe de la vraie app (démo) avec onglets. Routes propres dans le worker, slugs réservés (is_reserved_slug), sitemap v12.
- pro.html : section démo en direct (sélecteur de métier), grille 9 métiers ; a-propos multi-métiers ; blog : 3 articles (domicile, acompte/arrhes/empreinte, micro vs société) via docs/generateurs/blog.py.
- Ne JAMAIS revendiquer dans les pages une fonction inexistante (ex. questionnaire santé : pas encore fait).

## 2026-10-11 — Audit réel sur « Salon Démo » (ad3f2257-91a6-4faf-99ba-6ad6a02917be, compte créé par Alexandre, à supprimer par lui via l'admin)
- Vérifié en base après rechargement : collaborateur, prestations, clientes, 3 encaissements scellés et chaînés (tickets + nf525_hash_seal), annulation même jour, clôture Z #1 (90 €, 2 tickets, 1 annulation), SLOT/SLOT_H, thème, réseaux sociaux effacés, mode mixte + domicile, exercice, cagnotte/CA cumulé, forfaits (supprimé ne revient pas), absences, fond de caisse, formules couleur, RDV à domicile du lendemain, exports (journal équilibré 90/90).
- BUG CORRIGÉ : l'annulation du ticket original n'était pas enregistrée en base quand le hash en mémoire différait (saveTicketToDb remplace tk.hash par celui de la table tickets) -> CA du jour faux après rechargement. saveAppointment retombe sur une mise à jour des seules colonnes non protégées. Fausse alerte « tickets verrouillés vs attendus » corrigée.
- lx-cp-ville.js (code postal -> liste des communes) sur inscription, compte, site, app ; RPC lx_email_deja_inscrit + vérification à l'étape email (client Supabase séparé sans session).
- Réinitialisation d'essai : factory_reset_salon refusait toujours (appel par la fonction serveur en rôle service -> auth.uid() vide) ; corrigé. Nouvelle RPC reset_ventes_test_salon (essai uniquement) : efface ventes/RDV/clôtures/bons/devis/fidélité gagnée, garde clientèle, prestations, forfaits, produits, équipe, réglages. Edge salon-factory-reset v6 : body.mode "ventes" | "tout". Modale à 2 choix (défaut : ventes seules).

## 2026-10-11 — RDV en ligne réservé pour une autre personne
- `_lxResolveClientId(o)` (app.html) : parmi les fiches liées au compte (luxyraId/email/tél, `_lxCandidatsCompte`), retient la 1re dont le prénom correspond (`_lxPrenomOk` : égal ou préfixe ≥3, normalisé `_lxNormNom`) ; sinon fiche au prénom+nom exacts ; sinon null (le planning affiche le nom saisi).
- `_lxReservePar(o)` : nom du titulaire du compte quand le prénom diffère → bandeau doré « Réservé par X depuis son compte, pour Y » dans clickAppt.
- `syncClientFromOnlineRdv` (luxyra-supabase.js) : prénom différent → ne rattache pas au titulaire ; cherche fiche prénom+nom, sinon crée une fiche SANS client_luxyra_id.
- Testé en mode démo (sans BDD) : Evan sur compte Delphine → null puis fiche Evan ; Delphine → sa fiche ; prénom vide → fiche titulaire.
- KB bot : `rdv_reserve_pour_autrui`.

## 2026-10-11 — Centre d'aide : guides illustrés
- 21 guides `aide/<slug>.html` (route worker `/aide/<slug>` → `.html`), images `aide/img/*.webp` = vraies captures du mode démo annotées (pastilles numérotées = ordre des légendes).
- Texte : `docs/generateurs/aide_guides.py` ; build : `docs/generateurs/aide_build.py [dossier_webp]` (section « Guides » de aide.html entre marqueurs GUIDES:DEBUT/FIN, recherche filtre aussi les guides). Outillage captures : `docs/generateurs/captures/` (README).
- FAQ aide.html corrigée (chemins réels : Infos établissement, Compte gestionnaire, Caisse › Gestion des tickets › Avoir / Annuler, Conformité caisse › Export FEC, Options commerciales, Paiements en ligne › Configurer, « Mot de passe oublié ? »…).
- App : entrée « Centre d'aide » dans Paramètres (ouvre luxyra.fr/aide#guides) ; notification « Voir le RDV » ouvre directement la fiche (clickAppt) ; carte « Demandes de RDV » à fond opaque ; accents corrigés (Conformité caisse, clôture : solde théorique / réel compté / Valider la clôture, modale « Annulation du ticket ») ; lien FEC des documents comptables → « Paramètres › Conformité caisse ».
- Sitemap v13 : + /aide/<guide>. KB bot : `guides_aide`.
- Si l'UI change : refaire les captures concernées (shots.json) et relancer aide_build.py.

## 2026-10-11 — RDV : changer la prestation, contenu modifié conservé, fiche RDV annulé
- Fiche RDV (non encaissé) : bouton « 🔄 Changer la prestation » → `lxChangerPrestationRdv` / `lxAppliquerChangementPrestation` : remplace tout (sId, aPhases du catalogue avec stId du RDV, pr), garde seulement items isAcompteData. Audit `CHANGEMENT_PRESTATION_RDV`.
- RDV en ligne : nouvelle colonne `rdv_online.salon_edit` jsonb {phases, items, at} écrite par saveAppointment (branche online) ; relue au chargement (luxyra-supabase loader + `_lxOnlineToAP`, select du poll) → les modifs (forfait changé, phase remplacée/ajoutée, durées) ne reviennent plus au catalogue après rechargement. service_nom = nom + « + ajouts » ; diff `service_prix` suivi (compte.html bandeau « Prix », email rdv-online-modified-email v8 ligne Prix).
- Notification d'un RDV annulé : `openRdvFromNotif` → `lxFicheRdvAnnule(row)` (qui/quand, motif, acompte remboursé/conservé, empreinte, contact, fiche cliente) au lieu du planning vide.

## 2026-10-11 — Test réel point par point (Salon Démo + compte cliente d'Alexandre)
- OK : réservation en ligne, notif → fiche, changer prestation → forfait (en ligne et en salon) + rechargement, durée de phase conservée (salon_edit), acceptation (email « confirmé »), demande de modif cliente → acceptée depuis la notif, fiche RDV annulé depuis la notif, réservation pour un proche (fiche Léa + « Réservé par »), annulation salon avec motif (email envoyé, motif visible côté cliente), blocage annulation < 48 h.
- Corrigé pendant le test : tri des RDV à venir (espace cliente), date locale, modifs salon cumulées dans le bandeau, « Modification demandée → — à null », annulation salon sans motif ni message à la cliente, bouton « Appeler le salon » quand l'annulation en ligne est bloquée.
- Reste lundi : encaissements (journée du 11/10 déjà clôturée), annulation de ticket de la veille, Z, exports.
- 2026-10-11 (suite) : RDV exceptionnel hors horaires : (marge hachurée retirée à la demande d'Alexandre ; data-gs sur .pg-slots lu par le glisser-déposer), aAp propose « Créer quand même » (depi) au lieu de refuser, `_lxHorsHorairesOk`/`_lxHorsHorairesOkTime` (clickSlot force) court-circuitent le blocage « hors_horaire » de checkConflict (jour travaillé uniquement). Accusé de lecture cliente : mapper salonModifAt/Vue/VueAt + poll ; fiche RDV affiche « vue / pas encore vue » ; trigger trg_notif_rdv_online → notif `rdv_online_vu` (source unique par salon_modified_at) ; 2e demande de modif sur un même RDV notifiée (source horodatée).
- 2026-10-11 : Z imprimée : si écart CA/règlements, `_lxEcartsReglement(done)` explique le ticket en cause (sans rien modifier ; ventilation NON plafonnée pour que Σ Z = totaux mensuels).
- 2026-10-11 : contrôle lecture seule Excellence Coiffure : 754 tickets n°1→754 sans trou, chaîne de hash intacte, TTC=HT+TVA partout, 123 Z = somme des tickets jour par jour, cumuls cohérents. 1 anomalie : ticket imprimé n°2079 (num interne 701 ; n° imprimé = num + 1378, reprise de l'ancienne numérotation) du 02/10, Carine GUIDON, remise 10 % appliquée APRÈS le règlement → CB enregistrée 32 € pour 28,80 € → Z du 02/10 : modes 289,50 € vs CA 286,30 € (+3,20 € CB). Z scellée : NON modifiée. Correctif : `_lxReglementTotalAJour()` (doApplyTkRemise, doApplyRemise, showCaisse, doFinalPayExecute) remet les règlements >0 à zéro si total < réglé.
- Numéros imprimés Excellence Coiffure (raw_data.tkNum) : = num + 1378, sauf 09/07 (num 280-283 imprimés 1657-1660 → n°1657 en double, 1661 absent) et num 525 / 653 (raw_data figé avant encaissement, tkNum null → 1903 et 2031 non imprimés). Séquence légale `num` 1→754 continue et chaînée : OK. Anciennes anomalies, non retouchées.
- 2026-10-11 : CAUSE RÉELLE du ticket 2079 : la remise fidélité au seuil était proposée par doFinalPay (bouton Encaisser) APRÈS la saisie du règlement (quickPay CB 32 €). `_lxFidAvantReglement(suite)` (quickPay, showPayInput) demande maintenant la décision fidélité AVANT le 1er règlement (appliquer · compteur 0/1, ou « pas cette fois » = skip). Testé démo : ticket 37,80 / CB 37,80.
- 2026-10-11 : CORRECTION DE RÈGLEMENT APRÈS CLÔTURE — table `corrections_reglement` (inaltérable, chaînée, scellée nf525_hash_seal), RPC `corriger_reglement(p_ticket_id, p_regle_apres, p_motif, p_operateur)` (titulaire uniquement, total = total ticket, motif ≥ 5). App : `lxCorrReglOuvrir/_lxCorrReglModale/lxCorrReglValider`, `lxCorrReglCharger` (window.LX_CORR_REGL, appt_id via tickets.raw_data->>id), restitution Z (`printClotureZ`), bande mensuelle (`printBandeZ`), journal (`bucketsPart`) et FEC (`_fecLegs`). Registre NF525 mis à jour.
- 2026-10-11 : NF525 RENFORCÉ — edge `nf525-sign` (docs/edge/nf525-sign.ts, verify_jwt false ; cron `nf525-sign-2min` avec x-cron-secret, ou JWT utilisateur + salon_id) signe en ES256 (base64url) TK/Z/ZM/ZA/ZE/CR/DUP/JET, chaîne par type, table `nf525_signatures` ; clé via `nf525_cle_creer`/`nf525_cle_active` (Vault), table `nf525_cles` (clé publique JWK). JET : `nf525_jet` alimenté par trigger `audit_vers_jet` (codes `nf525_jet_code`), reprise code 210. Duplicatas : RPC `nf525_duplicata`. Version : RPC `nf525_version` (LX_VERSION=6.3.0, LX_CAISSE=C01 dans app.html — bumper LX_VERSION à chaque version majeure). Ticket : extrait signature (car. 3,7,13,19 via `lxSigRemplir`), nb lignes, DUPLICATA. Archive signée `lxArchiveSignee()` (format LUXYRA-NF525-ARCHIVE-1) + vérificateur public `/verif-nf525` (verif-nf525.html, 100 % navigateur). Testé : archive Démo intègre, montant modifié détecté. NE JAMAIS modifier le format data_to_sign TK sans versionner (vérificateur recalcule `[taux:ttc,ttc,ts Paris,C01,num,V/R,O/N,prev]`). Reste pour certification : référentiel Infocert officiel, mode formation, ID par terminal, notes provisoires.
- 2026-10-11 : PRÉPARATION AUDIT (v6.4.0) — archive : empreinte enregistrée (`nf525_archive_enregistrer`, table `nf525_archives_signees`) + signée (chaîne AR) + ZM/ZA/ZE inclus, case « remise à l'administration » (JET 295) ; autocontrôle nocturne `nf525-sign` {verif:true} (cron `nf525-verif-quotidienne` 03:40, anomalie → JET 90) ; RPC `nf525_infos_z` (GT réel/absolu + extrait sig. sur bande Z, `lxZInfosRemplir`) ; duplicata avec extrait DUP (`lxDupSigRemplir`) ; ticket : opérateur, « Ticket - Vente - nature », mention pièce de correction, SIMULATION en démo ; avertissement responsabilité clôture ; cartes « Identification du logiciel » et « Contrôle fiscal » (JET 280) ; JET codes R19 complets (70/120/125 WAL, 400, 410 CONFIG_IDENTITE dans saveSalonInfo, 130 opérateurs, 110 exports, 901) ; `tickets_block_post_cloture` sans exception is_avoir ; `corriger_reglement_rdv` NE MODIFIE PLUS le ticket : pièce `corrections_reglement` avant_cloture=true (journal/bande AP-based l'ignorent, FEC l'applique). Dossier technique (Doc) : https://claude.ai/code/artifact/6b7dee9f-71ef-4aef-8fee-265359d8ba49 . Versions : SALON_CONFIG.version/title/LX_VERSION à aligner à chaque bump. v6.5.0 : postes de caisse (`nf525_postes`, RPC `nf525_poste`, `lxPosteInit` au démarrage, localStorage `lx_device_id`, `window.LX_POSTE`, tk.poste dans raw_data via saveTicketToDb, JET 126) — caisse logique C01 inchangée dans les données signées. Réinitialisations d'essai : `_nf525_archiver_purge` → `nf525_archives_purge` (inaltérable) avant effacement, JET 200 (RESET_VENTES_TEST / FACTORY_RESET), audit_log JAMAIS effacé, GT via `_nf525_tickets_gt` (inclut purges), signer v3 purge-aware (pas de filtre par numéro après purge), archive exportée `donnees.reinitialisations_essai`. v6.6.0 MODE TEST (mode école) : `salons.mode_caisse` test|reel (défaut test, Excellence reel), `tickets/clotures.mode_caisse` posés par trigger `a_nf525_marquer_mode` (inaltérable), garde `salons_mode_caisse_garde` (reel→test interdit, passage seulement via `luxyra.passage_reel`), RPC `nf525_passer_en_reel(salon, conserver, operateur)` → `_nf525_passer_en_reel` (purge `_nf525_purger_essai(...,false)` garde les RDV à venir, JET 105+260 ; conserver=true seulement si aucun ticket mode test), trigger `salons_passage_reel_abonnement` (trial→autre statut ⇒ passage auto), JET 100 à la création. `essai_reinitialisable` exige mode test. App : `window.LX_MODE_CAISSE`, bandeau violet MODE TEST, tickets/Z « TEST », `lxPasserEnReel`, checkout bloqué en mode test. Contrat 1.7, CGV art. 3. Nuit du 11/10 : chaîne FA (factures), archive annuelle signée (`_nf525_archive_enregistrer_interne`, motif 'annuelle'), ancrage externe (`nf525_ancrages`, cron 04:10, email support@), alerte via audit NF525_SIGNATURE_KO/NF525_TEST_NUIT_KO (critiques), tests nocturnes `nf525_tests_protections()` (cron 03:50, table nf525_tests_nuit) ; tickets : suppression/modif sensibles interdites pour TOUS les rôles (service_role, postgres, admin) sauf `luxyra.allow_nf525_unlock='true'` (tracé). Page Pro : section #caisse-verifiable ; liens « Vérifier une archive » dans les pieds de page.
- 2026-10-11 : Gestion des tickets : la date de fin était forcée à aujourd'hui à chaque affichage (recherche d'une période passée impossible) → défauts seulement si vides, dates remises dans l'ordre, recherche dès le changement de date.
- 2026-10-11 : Pack Excel : onglet « 5b — Corrections règlement » (pièces du mois de correction ou du mois du ticket).

## 2026-10-11 (nuit) — Questionnaire santé, vitrine salons, rappel CGV
- RAPPEL : le 18/10/2026, préparer (sans envoyer sans accord) le mail aux établissements (Amandine, Delphine) sur les changements CGV art. 3 / contrat 1.7 (mode test) + autres changements depuis le 11/10 (les tâches planifiées ne sont plus créables localement : Alexandre doit le créer dans « Scheduled » ou y penser).
- `salons_public` n'est plus SECURITY DEFINER : vue security_invoker sur la table `salons_vitrine` (colonnes publiques uniquement, RLS lecture anon/auth si `lx_salon_pro_actif`), tenue à jour par trigger `salons_vitrine_sync` sur salons. Toute nouvelle colonne publique = l'ajouter à la table + trigger + vue.
- Questionnaire santé : table `clients_sante` (RLS propriétaire, FK clients cascade, consentement_at obligatoire), app : onglet fiche cliente « sante », `lxSanteCharger/lxSanteFormulaire/lxSanteEnregistrer/lxSanteEffacer/lxSanteAlerte` (bandeau rouge fiche RDV + fiche cliente), audit SANTE_QUESTIONNAIRE/SANTE_EFFACEE (sans détail de santé). Export RGPD inclut `questionnaire_sante`. Politique de confidentialité (ligne art. 9.2.a), DPA, aide fichier-clients, bot `questionnaire_sante`, page pro.

## Application clientes Google Play (TWA) — 11/10/2026
- Package `fr.luxyra.client`, nom Play « Luxyra – Beauté & bien-être » (30 car. max), compte Play d'organisation « Luxyra » (dev id 6960219191496082736, app id 4972872055406133723).
- Démarre sur `/client.html?source=app` ; `lx-client-app.js` = barre d'onglets en mode app + « récemment consultés » (localStorage lx_recents). PAS de service worker client : la portée « / » est réservée à sw.js de la caisse.
- `.well-known/assetlinks.json` : empreinte Google (6A:C9:…:49:44) + clé d'importation (05:D3:…:72:64). Clé d'importation = fichiers keystore chez Alexandre uniquement (jamais dans le repo).
- Visuels Play dans /store (icône, image 1024x500, captures 1080x1920).
- Fait : politique conf., annonces=non, AD_ID=non, gouv=non, finance=aucune, santé=aucune, classification IARC (PEGI 3), fiche Store, catégorie Beauté, coordonnées contact@luxyra.fr, Sécurité des données (brouillon).
- Compte test Google : client contact@luxyra.fr (TEST Google, tel 0000000000 ; mot de passe connu d'Alexandre seul). Cible : 16-17 + 18+. Pays : France.
- 11/10/2026 ~22h : envoyé en examen par Alexandre (production 1.0.0.0). Publication gérée désactivée → en ligne dès approbation.

## Luxyra SMS Companion (fr.luxyra.sms, app id 4974729537663482636) — préparation Play
- Décision 11/10 : envoi en examen SEULEMENT après acceptation de l'appli clientes (protéger le compte dev).
- Fait : fiche réécrite (transactionnel RDV, sans « illimité »/marketing/prix/concurrents), icône + store/sms-feature-graphic.png.
- Fiche complète et ENREGISTRÉE (2 captures, icône, image). Bundle 22/04 = dernière version (confirmé par Alexandre).
- Reste au moment de l'envoi :
  * FAIT 11/10 : déclaration SMS enregistrée (attestations cochées avec accord d'Alexandre), pays France, release production brouillon avec bundle 4 (1.3).
  * ERREUR à traiter : « l'appli ne prend pas en charge les tailles de page de 16 Ko » (bouton « Continuer quand même » proposé ; correctif propre = recompiler avec NDK r28+/AGP 8.5.1+ et libs natives à jour, ex. ML Kit/CameraX).
  * (historique) Déclaration SMS : cocher « Archivage, CRM et gestion des appareils pour les entreprises » + texte d'examen (EN) ci-dessous + 4 attestations (accord d'Alexandre requis).
    Texte : "B2B companion app for Luxyra, a booking/POS SaaS for beauty salons (luxyra.fr). Only SEND_SMS is used; the app never reads SMS or call logs. A salon links its own phone by QR code; the app then sends that salon's appointment messages (confirmation, reminder, change) to its own customers from the salon's SIM. Requires a Luxyra pro account. Login: see App access."
  * Service de premier plan (FOREGROUND_SERVICE_DATA_SYNC) : « Traitement en réseau › Autre » + VIDÉO YouTube (non répertoriée) obligatoire montrant liaison QR + notification du service + envoi d'un SMS. Texte : "Once the salon owner links the phone to their Luxyra account, the app runs a foreground service with a persistent notification. It keeps a network connection to the salon's message queue and sends each appointment SMS (confirmation, reminder, change) as soon as Luxyra requests it, even when the app is not open. The user can stop it at any time by unlinking the phone."
  * Release production depuis la bibliothèque (version 1), pays France, puis envoi par Alexandre.
- Risque : SEND_SMS hors exceptions → refus probable ; distribution hors Play déjà enregistrée (validation développeurs Android).
- 29/10/2026 : NON publiée sur Google Play. Textes alignés : politique-confidentialite § 10 (« n'est pas publiée sur Google Play à ce jour (publication en préparation) : fournie directement par Luxyra, sur demande auprès du support »), suppression-donnees (intro, mise à jour 29/10), aide/sms-et-rappels #s7 (« n'est pas sur Google Play pour l'instant : demandez-la au support »). Le bot n'affirmait rien (aucune fiche ne cite le Play Store pour l'appli SMS). À la publication : remettre « disponible sur Google Play » dans ces 3 pages.
- REPRISE PRÉVUE : quand l'appli clientes est acceptée par Google → finir SMS Companion (vidéo YouTube d'Alexandre + déclaration service premier plan + correctif 16 Ko) puis envoi par Alexandre.
- Source Android de SMS Companion : construite par Claude dans une session d'avril 2026 (pas d'Android Studio chez Alexandre). Introuvable dans ce dépôt et dans le sandbox du 11/10 → à rechercher sur le PC d'Alexandre (dossier outputs d'une ancienne session Cowork, ou zip dans Téléchargements). Les clés de signature (upload key) de cette appli doivent aussi être retrouvées pour publier une nouvelle version.

## FAIT 12/10/2026 — Service worker caisse v22 (déployé, registre mis à jour). Vérifié navigateur : migration 290→113 entrées, 0 clé avec paramètres, copies = fichiers en ligne. Test réel mode avion sur téléphone à faire par Alexandre (Salon Démo).
### (historique) Service worker caisse (sw.js v21) : 2 faiblesses (accord d'Alexandre le 11/10)
1. Cache qui grossit sans fin : chaque variante ?v= / ?x= / ?demo= est stockée séparément (constaté : des centaines d'entrées). Correctif : clé de cache = chemin SANS query (cache.put + match ignoreSearch), bump LX_CACHE v22 (purge des vieux).
2. Pas de délai sur réseau faible (network-first sans timeout → écran blanc possible, vécu par Alexandre le 11/10, résolu en effaçant les données). Correctif : timeout ~4 s sur navigation puis repli cache ; ATTENTION cohérence app.html / luxyra-supabase.js (même lot de versions) — appliquer le même repli aux fichiers de code, ou servir le couple depuis le cache.
- Ne jamais toucher IndexedDB (snapshot fiscal LX_CACHE) ni les POST. Tester : 1er chargement en ligne, hors ligne (ouverture + encaissement en mode dégradé + JET), retour réseau (renvoi + signature), mise à jour après déploiement. Puis registre + aide/bot si besoin.
- 12/10 : admin-sw.js enregistré sur la portée « /admin » (et plus « / ») + retrait de l'ancien enregistrement admin-sw.js sur « / » ; lxPushDisable vise « /admin/ ». La portée « / » est réservée à sw.js (caisse).

## Boîte « Demandes à Claude » (12/10/2026)
- Table `claude_demandes` (RLS is_admin) + onglet admin « 🤖 Claude » (envoi, réponses, boutons OK/Non, badge). Notification téléphone automatique quand une réponse est écrite (trigger → notify_admins 'admin_reply').
- Statuts : nouvelle → en_cours → faite | attente_ok (accord requis, champ proposition) → (accord true → en_cours → faite) | refusee | annulee.
- Tâche planifiée cloud « Luxyra file Claude » CRÉÉE le 12/10 (5h56, 7h56 … 17h56), sans jeton : accès GitHub du compte ; si publication impossible → analyse/base + « modif site en session PC ». Premier passage 13/10 5h56. (Le « Luxyra controle quotidien » cloud tourne aussi chaque jour à 8 h, lecture seule.)
- Dispatch indisponible pour les nouveaux utilisateurs ; urgent = session cloud depuis l'appli Claude du téléphone.

## Tests finaux Salon Démo — 12/10/2026 (soir) : TOUS OK
Tickets 9 (espèces), 10 (remise 10 % + mixte CB/esp), 11 (bon cadeau BC-0001 + complément CB), avoir 12 (annulation du ticket 4 de la veille), Z n°2 (70,80 €, tiroir 209,80 juste), archive signée (54/54 signatures, 12/12 tickets recalculés ; falsification détectée), FEC (débit = crédit 426,80), passage en caisse réelle (purge archivée, JET 200/105/260, RDV à venir conservés, effacement et retour test refusés), bandeau parrainage masqué côté serveur.
À valider par Alexandre (affichage seulement) :
1. Bon cadeau utilisé affiché « REMISE TICKET » sur le ticket et compté dans « Remises » de la Z → libellé « Bon cadeau BC-xxxx (déjà encaissé) » + ligne dédiée en Z.
2. Mention « MODE TEST – SANS VALEUR FISCALE » absente du récapitulatif Z affiché après clôture et du Z envoyé par e-mail (présente sur la bande Z complète).
3. Fenêtre « Passer en caisse réelle » : annonce seulement les encaissements mode test (4) alors que les tickets antérieurs sans mode (8) sont aussi archivés/retirés.
Ensuite : Alexandre supprime le Salon Démo (admin) → entrée registre.

## Fermeture définitive d'un établissement (12/10/2026)
- Admin > fiche > Actions > « 🔒 Fermer définitivement » → RPC `admin_fermer_salon` (motif + nom à retaper). Garde tout le fiscal 6 ans ; le gérant garde le Mode archives (status `cancelled`) ; vitrine retirée ; clientes anonymisées ; JET 40.
- « Supprimer » ne marche plus que pour un compte SANS historique de caisse (`salon_a_historique_fiscal`).
- Salon Démo fermé le 12/10/2026 (tests finis). Textes : CGV art. 7, aide FAQ « supprimer mon compte », bot `fermeture_definitive`.
- Admin : un établissement fermé sort de tout le suivi (étape « Perdu », plus de rappel, plus dans « Nouveaux à accueillir » ni « Documents à contrôler ») et n'apparaît plus dans la liste des salons sauf avec le filtre « 🔒 Fermés ». `admin_fermer_salon` met aussi admin_suivi_salons à « perdu » ; `rappels_admin_du_jour` ignore les fermés.

## Vocabulaire « client » (12/10/2026, demande d'Alexandre)
- Toujours « client(s) » (mot neutre), jamais « cliente(s) » : app, admin, site, aide, blog, e-mails du worker, bot (support_bot_kb). Accorder au masculin (« le client est prévenu », « client absent », « il »).
- Les identifiants techniques gardent leur nom (`paiements_clientes`, `_lxMessageCliente`, `clientes_anonymisees`…).

## Conservation des données (12/10/2026)
- Établissement : 6 ans après résiliation/fermeture (ou dernière opération de caisse) → préavis J-30 → `purge_salon_6ans` (worker cron 03:00, `runRetentionPurgeJob`). Trace : table `salons_purges`.
- Comptes clients Luxyra : 3 ans sans activité → préavis J-30 → `purge_compte_client_inactif` (worker `runComptesClientsInactifs`). Une connexion annule le préavis (trigger `trg_clients_luxyra_reprise`).
- Fermeture : fiches/RDV liés à un compte client Luxyra gardés ; adresse du site libérée ; même e-mail réutilisable (inscription accepte un compte dont l'établissement est fermé ; l'app ouvre l'établissement actif, archives de l'ancien depuis la Comptabilité via `lxOuvrirArchivesAncien`).
- Questionnaire santé : `LX_SANTE_METIERS` (listes par métier), lien « Voir les questions des autres métiers », grossesse masquée pour les hommes.

## SEO (12/10/2026, Search Console ouverte dans le navigateur intégré, compte d'Alexandre)
- robots.txt (worker) : + Disallow /api/, /rest/, /site.html.
- Adresse de salon inconnue / fermée / site désactivé → statut 404 + noindex (avant : 200, ex. luxyra.fr/100 indexée). Ancienne adresse (alias) → redirection 301 vers la nouvelle.
- Pieds de page (accueil, pro, tarifs, blog, aide) : liens vers les 9 pages « logiciel par métier » et tous les articles du blog (maillage interne).
- Bouton Réserver Google : la carte de Paramètres › Site en ligne donne maintenant le lien /<slug>/reserver (+ conseils Site Web, avis, fiche complète) ; aide et bot (google_reserver) à jour. 9 demandes d'indexation faites le 12/10 (logiciel-coiffure, institut, onglerie, barbier, cils, aide, 2 articles blog, delphinecoiff) ; sitemap renvoyé.

## Annuaire public « Métier à Ville » (13/10/2026, demande d'Alexandre « faire comme Planity »)
- Sous-métiers (13/10) : /onglerie, /extension-de-cils, /barbier = même source Sirene filtrée par l’enseigne (RPC annuaire_ville2 / annuaire_villes2, sitemap v15).
- Pages worker (v2 design Luxyra + logo, FAQ) : /coiffeur, /institut-de-beaute, /spa-massage (+ /<ville>) ; /annuaire-gerant?siret= (« C’est votre établissement ? » → essai, inscription pré-remplie siret/nom/metier ; retrait en petit en bas) ; /annuaire-retrait (retrait par SIRET, RPC annuaire_retirer, anon). Salons Luxyra en tête (bouton Réserver), autres « Réservation en ligne non disponible ». 404 + noindex si ville vide.
- Données : table annuaire_etablissements (Sirene via API Recherche d'entreprises, uniquement établissements actifs, diffusion publique, avec ENSEIGNE/nom commercial — jamais de nom de personne, dirigeants, téléphone, note). annuaire_retraits = oppositions (jamais réaffichées).
- Import : edge function annuaire-import (par morceaux ≤ 95 s, file annuaire_jobs), cron « annuaire-import » toutes les 2 min tant qu'il reste du travail ; « annuaire-relance-mensuelle » le 1er du mois (mise à jour + suppression des disparus > 62 j). Départements de départ : 57, 63, 67, 54, 03, 15, 43 (ajouter une ligne dans annuaire_jobs pour en couvrir d'autres).
- Sitemap v14 : pages métier + villes. Mots réservés (is_reserved_slug, worker, app) : coiffeur, institut-de-beaute, spa-massage, annuaire-retrait.
- Textes : politique de confidentialité §10 ter, mentions légales (source Sirene, Licence Ouverte), bot annuaire_public, liens en pied de page d'accueil.
- 13/10 : tâche auto (demande n°3) a corrigé nf525_take_inventory_snapshot (archives de test comptées) — noté au registre en session PC. Monitoring : tuiles de carte OSM ignorées.
- 13/10 : fusion clients sans toucher aux tickets clôturés (clients.fusionne_dans, lxCid/lxMajFusions dans luxyra-supabase.js) ; résa en ligne rattachée par nom+prénom unique sans autre e-mail.

- 2026-10-13 : MULTI-MÉTIERS. `salons.metiers_autres text[]` (check sur les 9 métiers, défaut '{}'), copié dans `salons_vitrine` (trigger `salons_vitrine_sync`) et exposé par la vue `salons_public`. Métier principal = `salons.metier` (verrouillé, inchangé). App : `SALON_CONFIG.metiers` (= autres activités, sans le principal), carte « Autres activités » dans Paramètres › Établissement (`lxToggleMetierAutre`, audit CONFIG_METIERS), `lxMetiersSalon()` pour les onglets de fiche client, fiche technique `_histoMetierSchema(m)` + choix « Activité » (entrée `histoMetier[].metier`), questionnaire santé `lxSanteMetiers`. Inscription : chips « Vous proposez aussi ». Recherche + annuaire (worker `or=(metier.in…,metiers_autres.ov…)`, `annuaire_villes2`) incluent les autres activités. Admin : affichage + filtre. Bot (`metiers`) et aide (configurer-mon-etablissement §1) à jour. Aucune donnée de caisse touchée.
- 2026-10-13 : Tarifs par activité ABANDONNÉS (décision d'Alexandre, comme Planity) : une seule liste par catégorie ; le multi-métiers sert surtout à être trouvé dans chaque métier (recherche/annuaire). Site salon (site.html) : catégorie ≥ 8 prestations → 5 visibles + « Voir les N autres » (`LX_CAT_SEUIL`, `LX_CAT_VISIBLES`, `lxVoirPlus`), page Tarifs et étape 1 de réservation (une prestation sélectionnée reste visible). Inscription : recherche SIRET auto si pré-rempli + bouton « Rechercher » + saisie tolérante.

## Notifications clients (13/10/2026, accord d'Alexandre)
- Tables `client_notifications` (cloche) et `client_push_subscriptions` (push téléphone), RLS sans policy (worker en service_role).
- `public.lx_notifier_client(p_client, p_type, p_titre, p_texte, p_url)` (service_role seulement) : insère + push via send-push v20 (`target_client_id`, refusé aux salons).
- Déclencheur `trg_rdv_online_notif_client` (AFTER UPDATE, WHEN statut/salon_modified_at/modification_status) : confirmé, refusé, annulé par l'établissement, terminé (avis), modifié, réponse de modification. N'écrit que dans client_notifications.
- Worker `/api/client/notifs` (op list|count|read|read_all|subscribe|unsubscribe) ; `handleCreneauLibere` appelle aussi `lx_notifier_client` (type place_liberee).
- UI : onglet « Notifs » 🔔 + pastille dans lx-client-app.js (v=3) ; onglet `?tab=notifs` dans compte.html ; abonnement push via `/sw.js` scope `/compte.html` (NE PAS toucher sw.js ni la portée /app de la caisse). Déconnexion = désabonnement.
- Noms : appli pro `manifest-app.json` short_name « Luxyra Pro ». Appli clients (APK) : libellé « Luxyra » → « Luxyra Beauté » dans l'APK v1.0.1, APRÈS validation Google (fiche Play : « Luxyra – Beauté & bien-être »).

## Centre d'aide (13/10/2026)
- Réservé à l'appli pro : AUCUN lien /aide sur le site public, les pages pro/logiciel, l'appli clients ni l'annuaire. Pages /aide en noindex, absentes du sitemap (v17). Ne pas remettre de lien public.

## Sitemap v18 (15/10/2026) — index + sitemaps enfants
- `/sitemap.xml` = index (worker → edge `sitemap?part=index`) ; enfants `/sitemap-pages.xml`, `/sitemap-salons.xml`, `/sitemap-annuaire-<métier>.xml` (coiffeur, institut-de-beaute, spa-massage, onglerie, extension-de-cils, barbier). Source : `docs/edge_1015/sitemap/index.ts` (sans `part` = ancien urlset complet, compatibilité).
- Salons : salons_public + site_actif ≠ false, `/<slug>` seulement (`/reserver` a canonical → `/<slug>`). Annuaire : RPC annuaire_villes2 (mêmes filtres que les pages SSR), ville listée seulement si la page répond 200. /aide/* jamais listé (noindex).
- lastmod des pages statiques écrit en dur dans STATIC_PAGES : le mettre à jour quand une page change (et ajouter toute nouvelle page / article de blog). Erreur → 503 + Retry-After (plus de sitemap minimal en 200).
- Ordre de déploiement : edge `sitemap` d'abord, puis le worker ; renvoyer `https://luxyra.fr/sitemap.xml` dans Search Console.

## Centre d'aide + bot — mise à jour du 15/10/2026 (changements des 13-14/10)
- Pages aide/*.html retouchées À LA MAIN (aide_guides.py toujours en retard : NE PAS relancer aide_build.py). Nouvelles sections : rendez-vous-en-ligne #s5-#s7 (cloche « en attente », Accepter quand même, Proposer un autre horaire), planning #s4-#s6 (annuler / supprimer définitivement, alertes, glisser-déposer), configurer #s5 (fermeture exceptionnelle avec RDV), cloture #s3-#s4 (Z bloquée, file de secours), premiers-pas #s5-#s6 (session expirée, mise à jour, déconnexion), equipe #s3 (PIN serveur / hors ligne), tickets #s3-#s4 (effets inversés, duplicata), encaisser #s6, fidelite #s3, fichier-clients #s4 (anonymisation), sms #s3-#s5 (rappels serveur, automatisations, campagnes), site #s4, paiements #s3. Nouveaux guides : aide/espace-client.html (carte dans la grille) et aide/administration-luxyra.html (équipe Luxyra, non lié depuis aide.html). « Nouveautés » d'aide.html : 17 cartes ajoutées.
- 21 captures nouvelles (shots.json, fin de liste) ; cap.mjs accepte `page` / `ls` / `mock` / `ready` (captures de compte.html avec données fictives, réseau bloqué).
- Bot : `docs/migrations_1014/bot_aide_1015.sql` (15 lignes réécrites + 5 nouvelles : notifications_pro_1015, session_donnees_1015, caisse_effets_1015, campagnes_sms_1015, espace_client_1015 ; « NF525 » → « Conformité caisse » partout) — NON appliqué, à passer par Alexandre puis lx-bot-eval.
- Pages publiques : politique-confidentialite (vérification e-mail 48 h, déconnexion des autres appareils, suppression avec mot de passe, annuaire : retrait confirmé par e-mail, signalements), suppression-donnees (anonymisation, onglet RGPD).

## Acomptes, article libre, prix sur devis (14/10/2026, accord d'Alexandre)
- Règles appliquées (sources BOFiP/CGI dans le registre) : TVA des prestations à l'encaissement des acomptes ; sommes conservées soumises à TVA (prudence) ; corrections = opérations en plus/en moins.
- Helpers app.html : `_lxPayBuckets` (référence des règlements, comme la Z), `_lxModeDetail(a)` (règlement détaillé pour exports), `_lxLibAcompte(items, acompteEnLigne)` (libellés compta), `_lxAjustEnLigneMois(mois)` (ajustement paiements en ligne : URSSAF micro, récap TVA), `_lxStripeLigne(r)` (relevés Stripe), `_lxHistRemb(r, ac)` (historique des remboursements `rdv_online.remboursements`), `expAcomptesNonSoldes(silencieux)` (4191, fin du mois), capture CSV `window._lxCsvCapture` (pack comptable).
- FEC : paiements en ligne au compte 580100 (comme le journal des ventes), jamais 512.
- Article libre : `tkAddLibre`/`doAddLibre`, item `isLibre` (+ `isProd` selon le type) ; audit ARTICLE_LIBRE.
- Prix sur devis : `services.prix_sur_devis` ↔ `sv.devis` ; `_lxPrixDevis` demande le prix à l'ajout (posAddService, doAddTkSvc) et garde-fou au début de `finalizePay`. Site : « Sur devis », bookOnline forcé à false (demande).
- Centre d'aide : les pages `aide/*.html` ont été retouchées à la main depuis le 11/10 (client, multi-métiers, liste d'attente, notifications, remboursement partiel, article libre, sur devis…) : `aide_guides.py` est EN RETARD → NE PAS relancer `aide_build.py` sans y reporter ces textes (sinon perte). Nouvelles captures : caisse_ajout, caisse_libre, acompte_absent, services_devis (+ services_new, compta_docs refaites), voir shots.json.

## Acompte en ligne = ticket scellé au paiement (14/10/2026, accord d'Alexandre — branche acompte-en-ligne)
- Conception complète : `docs/acompte_en_ligne_conception.md` ; SQL à appliquer APRÈS déploiement de l'app : `docs/sql_acompte_en_ligne.sql`
  (colonnes rdv_online.acompte_modele / acompte_tk_num / acompte_tk_claim_at / acompte_remb_claim_at, trigger `trg_rdv_online_acompte_modele`,
  index unique `tickets_acompte_key_unique` sur raw_data->>acompteKey, RPC `lx_acompte_remb_ticketer` / `lx_acompte_remb_liberer`,
  RPC de lecture `lx_acompte_a_ticketer` / `lx_acompte_remb_a_ticketer` / `lx_acompte_deja_traite_ancien`, `rdv_online_insert_public_propre` étendu).
  Le worker DOIT être redéployé (route /api/rdv/acompte-rembourser : `trop_percu:true`). Numéros mémorisés (acompte_tk_num, origTkNum,
  acompteTkNum) = n° IMPRIMÉ tk.tkNum (dbNum = n° serveur en meta) ; correspondances sur (tkNum OU dbNum). Verrou bloqué > 15 min sans
  trace -> repris (UPDATE conditionnel) ; ligne déjà traitée par une ancienne app (done / ticket_num / retenue_*) -> jamais de ticket, DB_ERROR.
- Nouveau modèle (`acompte_modele='ticket'`, posé par trigger au passage acompte_paye false→true) : l'app crée le ticket « Acompte en ligne »
  (`lxAcomptesEnLigneSync`, même motif que lxRetenuesSync : verrou, clé, jamais jour clôturé, date de règlement dans raw_data.datePaiement) ;
  au RDV : ligne « Acompte déjà versé (ticket #X) » (`acompteEnLigneTicket` sur le fantôme, `_lxAcompteSalonAmount`), contrôle
  `_lxAcompteEnLigneAvantEncaissement` dans doFinalPayExecute ; remboursements : un ticket négatif par entrée de `remboursements` (champ tk) ;
  acompte conservé : rien de plus (lxRetenuesSync ignore ces RDV). Ancien modèle (NULL) : strictement inchangé.
- Rapports : lignes `caisse:true` dans `_lxPaiementsEnLigne` (ajustement `_lxAjustLigneCaisse`, 0 sauf ticket daté d'un autre mois) ;
  expAcomptesNonSoldes traite ces acomptes depuis le ticket d'acompte. Tickets d'acompte/retenue/annulation ne rapprochent plus un RDV en ligne
  (`_lxFindOnlineRdvForTicketBrut`). Reste à faire après mise en service : bot support, centre d'aide, registre NF525, test réel.

## 2026-10-14 — Audit données / synchronisation (branche fix1014-donnees, version couche données 20261014-6)
- SQL à appliquer par Alexandre : `docs/migrations_1014/donnees.sql` (verrou numérotation tickets, protection statut/annulation/règlements des RDV scellés, `appointments.updated_at`, autolink comptes = e-mail vérifié + même nom, consentement recopié du compte). Tant qu'il n'est pas appliqué, l'app fonctionne (contrôle updated_at ignoré).
- luxyra-supabase.js : `lxSessionPerdue` (fenêtre de reconnexion sans rechargement, onAuthStateChange), `lxWalRejouer` (online / premier plan / 2 min, un seul à la fois), éviction WAL protégée (`_walProtege`), base de fusion client stockée dans l'entrée WAL (`entry.base`), entrées d'un autre salon jamais rejouées, Z jamais rejouée avant des tickets plus anciens, `lxClotureBloqueeParWal` (Z refusée si tickets non transmis), rendez-vous supprimés (`lxRdvMarquerSupprime`, abonnement DELETE), fusions `lxFusionnerClients` / `lxFusionnerCollabs` (plus de remplacement en bloc), `lxRafraichirModeCaisse` (5 min), `_lxEcrituresBloquees` (archives / suspendu), saveAppointment = enveloppe + `_saveAppointmentUneFois`.
- Supprimé : copie identité/consentement vers toutes les fiches de même e-mail (saveClient) ; e-mail / client_luxyra_id écrits sur une fiche retrouvée par le nom seul ; sms_ok/email_ok=true à la création depuis une réservation.
- Bot support / centre d'aide : à compléter (fenêtre « Session expirée », message « Non enregistré — nouvelle tentative automatique », Z bloquée tant que des tickets ne sont pas transmis).

## 2026-10-14 — Audit sécurité (branche fix1014-secu) — À DÉPLOYER DANS L'ORDRE
SQL `docs/migrations_1014/secu.sql` (idempotent) -> edge functions `docs/edge_1014/*` -> worker -> pages.
- **Comptes clients** : depuis le 31/10/2026, code à 6 chiffres par e-mail AVANT la création (lx-signup v14, voir rubrique « Code à 6 chiffres ») ; comptes plus anciens non confirmés : email vérifié par lien (`?verif=` dans compte.html, 48 h, renvoi limité 2 min / 5 par jour).
  Tant que `email_verified` est faux, le worker ne rattache RIEN par email (`lxEmailVerifie(session)`) : seulement par
  `client_luxyra_id`. Rattachement automatique des fiches (`fn_autolink_clients_luxyra`) : seulement quand l'email devient
  vérifié, et seulement par email (plus jamais par téléphone). Lien fiche existante <- compte depuis l'app pro
  (`syncClientFromOnlineRdv`) : ignoré par la base sauf email vérifié identique (`trg_clients_lien_compte_verifie`).
- **Version de session** : `clients_luxyra.session_version` dans le jeton (`sv`) ; incrémentée par `lx_client_session_bump`
  (changement / réinitialisation du mot de passe, « Déconnecter mes autres appareils »). Vérifiée par lx-profile (donc le
  worker), avis-create, client-mes-photos, rdv-demande-create. Suppression du compte : mot de passe obligatoire (lx-profile
  `delete` et worker `/api/client/anonymize`).
- **client_salon** : plus aucun accès anonyme ; worker `/api/client/salons` (list / lier).
- **rdv_online** : plus de DELETE anonyme ; `/api/rdv/abandon` (secret du navigateur, empreinte `abandon_hash`, pending_payment
  non payé < 35 min).
- **PIN opérateurs** : RPC `operateur_verifier_pin` / `operateur_connexion_bio` / `operateur_debloquer` (3/h) ; `pin_hash` non
  lisible (droits par colonne : toute nouvelle colonne de salon_operateurs doit être ajoutée aux GRANT). Hors ligne :
  empreinte PBKDF2 locale du dernier PIN validé (`lx_opc_<salon>`, 30 j, 5 erreurs -> 30 min), liste `lx_ops_liste_<salon>`.
- **Annuaire** : `annuaire_signalements` + RPC service (`annuaire_signaler`, `annuaire_retrait_demander/confirmer`) via le
  worker (`/api/annuaire/*`, empreinte IP) ; modération Admin > Salons > Annuaire. Anciennes RPC non exécutables par anon.
- **Fonctions publiques** : report_server_error plafonné (anon -> warning, authenticated -> error max, 30 / 10 min / IP) ;
  lx_email_deja_inscrit via `/api/inscription/email-check` ; get_monitoring_status -> service (admin : `admin_monitoring_status`) ;
  devis_expire_overdue -> cron `devis_expire_overdue_nuit`.
- **Support** : l'établissement ne peut plus modifier une conversation que pour « lu » / « résolu » ; messages non réécrivables.
- **Admin** : `is_admin()` et worker `lxIsAdminUser` exigent aal2 ; `admin_users` non inscriptible ; CSP stricte ; écritures
  vérifiées (`saMaj`) ; onglets « Annuaire » et « Base du bot ».
- **sw.js** : le contenu des push n'est plus journalisé.

## Planning — audit du 14/10/2026 (branche fix1014-planning)
- SQL : `docs/migrations_1014/planning.sql` (idempotent, à appliquer AVANT l'app) : `lx_horaires_effectifs(salon, collab|null, date)` = source unique des horaires (overrides du jour, semaine type, ouverture except. qui élargit, fermetures/congés, pauses) utilisée par `rdv_online_validate`, `rdv_online_block_double_booking` (réservation sans préférence = 1 collaborateur consommé, erreur inattendue = refus) et `fn_salon_next_slots` ; `messaging_log.rdv_date` + `lx_prive.confirmation_concerne_rdv` (rappel 24 h supprimé seulement par la confirmation de CE RDV) ; pas d'alerte créneau libéré pour un créneau commencé / no-show ; refus de demande = « Demande non retenue » (cancel_reason préfixé).
- App : annulation d'un RDV non encaissé = UPDATE (status cancelled, cancelled, cancel_date) au lieu d'un DELETE ; exclu de AP au chargement / merge (`lxApptAnnuleSansTicket`, luxyra-supabase.js) ; corbeille = choix « Annuler » / « Supprimer définitivement » (`lxSupprimerApptDefinitif`). acceptModification relit la base, contrôle le créneau (« Accepter quand même »), passe par lxRdvAccepter si la demande est en attente. Pastille notifications = `updateNotifBadge` (plus d'entrées locales injectées).
- Reste (règle permanente) : bot support, centre d'aide, test réel Salon Démo.

## Audit 14/10/2026 — lot « site public / compte client » (branche fix1014-site, NON déployé)
- SQL : `docs/migrations_1014/site.sql` (idempotent). Edge : `docs/edge_1014/{rdv-demande-proposal-action v12, avis-create v10, lx-signup v10, lx-profile v9}`.
- Acompte/empreinte calculés par `lx_prive.rdv_online_insert_public_propre` (insertions anon/client) ; « sur devis » refusé ; avec Stripe actif (hors domicile) un RDV à acompte doit être `pending_payment`. `/api/stripe/connect-payment` facture le montant STOCKÉ (acompte_montant / empreinte_amount).
- RDV sur mesure : verrou `rdv_demandes.confirm_claim_at` + `stripe_session_id` (worker finalize, webhook -> 202 = rejoué par Stripe, proposal-action confirm). Double paiement détecté -> server_errors critical.
- Nouvelles routes worker : `/api/bons-cadeaux/statut` (succès, par session Stripe, rattache `cartes_cadeaux.acheteur_luxyra_id`), `/api/client/bons-cadeaux` (lien compte, e-mail seulement si `email_verified`), `/api/client/avis` (avis en modération inclus).
- `LX.ouvrirSession(token,user)` (lx-client.js) : si un autre compte était connecté -> `lxAvantDeconnexion` puis `window.lxChangementCompte` (compte.html / site.html effacent les données). lx-client.js v=20261014-2, lx-client-app.js v=6 (`lxClientAppReset`).
- compte.html : plus aucun ticket fabriqué (buildCompteTicketHTML supprimé) ; visite RDV en ligne + ticket fusionnée par (salon_id, ticket_num) ; statuts Terminé / Non confirmé / Non retenu.
- Suppression de compte (`/api/client/anonymize`) : RDV à venir annulés (cancelled_by client, « Annulé suite à suppression du compte », remboursement selon politique) + adresse/lat/lng effacées. Invitation : compte client via lx-signup, fiche reliée (client_luxyra_id), email_verified=true.
- Texte d'annulation du site = `lxPolitiqueAnnulation()` (miroir de `lxPolitiqueHeures`). Pages métier-à-ville : `lxAnnEngagements(cfg, salon)`.
- sw.js : notification de /compte -> `client.navigate(url)` ; la caisse garde le simple focus.

## Audit 14/10 — Réglages (branche fix1014-reglages, SQL `docs/migrations_1014/reglages.sql` NON appliqué)
- Site en ligne : champ « Part de l'acompte rendue en cas d'annulation tardive (%) » = `site_config.remboursement_partiel_pct` (`SC.rembPartielPct`, lu par le worker) ; plus de case « Acompte obligatoire » (le mode fait foi) ; site.html : `mode_caution` ramené à « aucun » sans Stripe encaissant, `lxCalcAcompte` (calcul unique, plafonné au prix), `lxDelaiMinH`/`lxDelaiMaxJ` (0 h respecté, max 1..365, aussi `fn_salon_next_slots`).
- Worker : `lxConnectStatut(acc)` = codification unique du statut Connect (2 webhooks + handleConnectStatus + contrôle quotidien) ; appels `x-lx-internal` exemptés des limites par IP (email/custom, sms/custom).
- Rappels : `envoyer_rappels_24h` remplace {collab} ; NOUVELLES `envoyer_rappels_2h(p_essai)` (cron */10) et `envoyer_rappels_email_24h(p_essai)` (cron 8:05 UTC), INACTIVES tant que `app_config.config.rappels_serveur_2h_email` ≠ true ; même drapeau coupe l'envoi côté app (checkSmsReminders). Activation + textes bot/aide à basculer : bloc en fin du SQL.
- App : déconnexion = suppression de l'abonnement push salon de l'appareil (doLogout) ; re-géocodage si adresse modifiée (`lxGeocoderApresAdresse`) ; `_lxNumDef` (0 € déplacement respecté) ; fermeture exceptionnelle avec RDV -> liste + confirmation + « Prévenir les clients ? » (sms:/mailto: pré-remplis, jamais d'envoi auto) ; « Remplacer » un justificatif = nouvel envoi qui remplace la colonne (`lxRemplacerDoc`) ; export complet relu en base ; champs Infos établissement échappés (`_lxAttr`) ; horaires fermeture > ouverture (`lxPlageHoraireOk`) ; photos du site réduites (`lxImgReduire` 1600/0,8) ; anti double appui startCheckout / doSwitchPlan.

## Intégration 14/10 — revue croisée (branche integ1014, rien d'appliqué / déployé)
- Ordre de mise en production : `docs/migrations_1014/ORDRE.md` (SQL additifs -> edge functions, lx-profile d'abord -> worker -> pages -> `secu_restrictif.sql` EN DERNIER). `secu_restrictif.sql` contient tous les retraits de droits qui casseraient le code de main (client_salon anon, DELETE anon rdv_online, pin_hash, RPC annuaire/email/monitoring/devis).
- Comptes clients antérieurs au 15/10/2026 : repris `email_verified=true` + `email_verified_legacy=true` (secu.sql §1 bis) ; l'autolink n'est pas rejoué pour eux. Nouveaux comptes : vérification obligatoire.
- Un seul déclencheur autolink (`trg_autolink_clients_luxyra`, donnees.sql) ; lien fiche ↔ compte vérifié aussi à l'INSERT (`trg_clients_a_lien_compte_verifie`).
- SMS anniversaires / relances : un seul drapeau `app_config.config.sms_auto_serveur` (serveur actif ⇔ app muette). Activation après publication des pages.
- Caisse : ticket WAL refusé 10 fois (hors réseau) = « bloque » -> fenêtre Z avec « Signaler au support » / « Forcer la clôture (ticket non transmis consigné) » (audit WAL_ABANDON avec le ticket complet, entrée conservée sur l'appareil). Séances de pack en échec -> file `_lx_pack_attente_<salon>` rejouée par lxWalRejouer.
- `rdv_online_block_double_booking` : conversions sûres (`lx_int_sur`, `lx_hm`), erreur -> RAISE WARNING (journal Postgres) + detail transmis à site.html `_resaFail` (server_errors) ; la ligne report_server_error en base est annulée avec le refus (pas de dblink).

## Prix « à partir de » + forfaits sur devis (15/10/2026, accord d'Alexandre — branche feat-apartir, NON déployé)
- SQL `docs/migrations_1015/apartir.sql` (idempotent, validé en BEGIN…ROLLBACK le 15/10) à appliquer AVANT les pages : `services.prix_a_partir_de`, `forfaits.prix_sur_devis` / `prix_a_partir_de`, contraintes d'exclusivité, `lx_prive.rdv_online_insert_public_propre` recréée depuis la définition en base (md5 1096251c…) : drapeau `items[].a_partir_de` recopié DU CATALOGUE (posé/retiré), acompte sur le minimum ; bot `prix_a_partir_de_1015`, `forfait_sur_devis_1015`.
- Les « forfaits » de l'app = lignes `services` à phases > 1 (compositeur `addForfaitFromServices`) ; la table `forfaits` (FORFAITS, ancien format, recopiée dans config_json) n'est utilisée par aucun écran actif.
- App : `sv.apartir` ↔ `prix_a_partir_de` (écrit seulement si la colonne existe : `window._lxColsCat`), cases `nsAPartir`/`esAPartir`/`fcAPartir` (+ `fcDevis`), `_lxPrixTxt`, `_lxPrixListeHtml`, `_lxPrixOptExcl`, `_lxPrixAPartirCase` ; caisse : lignes `apartir`/`prixMin` (posAddService, doAddTkSvc, `_lxMarquerAPartir` à l'encaissement d'un RDV, `ap.aPartirSids` via `_lxApOnlineEnrichir`), `_lxPrixAPartir(idx)` (baisse sous le minimum = confirmation, audit PRIX_A_PARTIR_DE). Le ticket ne stocke QUE le prix final (aucune clé ajoutée aux lignes scellées). Version couche données 20261015-1.
- Site : `lxPrixTxt`, `lxApPfx`, `lxApNotice`, items `a_partir_de` ; compte.html `lxApRdv` ; worker SSR : services `select=*`, Offer `priceSpecification.minPrice` / « Sur devis » sans prix. Démo : Chignon + Balayage (coiffure) « à partir de ».
- Aide : prestations-et-forfaits #s4-#s5, encaisser #s7, site-et-reservation-en-ligne #s5, espace-client #s8 (+ sections égarées après le bandeau contact remises dans le guide) ; 8 captures (services_apartir*, forfait_options_prix, caisse_apartir*, site_apartir_*) ; cap.mjs sert les scripts https://luxyra.fr/* en local (captures de site.html avec `mock`).

## Multi-appareils : réglages sans mise à jour perdue + e-mails sans doublon (15/10/2026 — branche fix-multiappareil, NON déployé)
- SQL `docs/migrations_1015/multiappareil.sql` (idempotent, validé en BEGIN…ROLLBACK le 15/10 sur Salon Démo : 2 écritures avec la même version attendue -> la 2e touche 0 ligne ; version forcée par un client ignorée ; clé e-mail ancienne app = clé serveur -> unique_violation). Peut passer avant ou après les pages : sans la colonne, l'app retombe sur l'ancien comportement (erreur 42703 détectée, `_lxCfgVersionOk=false`).
- `salons.config_version` / `site_config.config_version` : incrémentés PAR LA BASE (`lx_prive.salons_config_version` sur changement de config_json ; `lx_prive.site_config_version` sur toute colonne hors updated_at). App : `_lxCfgLire` / `_lxCfgEcrire` (`.eq("config_version",v)`), boucle `LX_CFG_ESSAIS`=4 dans `_lxSaveSalonConfigUneFois`, `_lxCfgEcrireSectionsUneFois`, `_lxSiteEcrire` (0 ligne -> relecture, refusion des seules clés « sales » = mémoire ≠ `_lxCfgBaseMem` / `_lxSiteBase`, nouvel essai ; 0 ligne SANS changement de version = refus -> message). Site : seuls les champs modifiés sont envoyés (UPDATE, plus d'upsert de la ligne entière). `show_tva_ticket` écrit seulement si modifié ici (`_lxTvaTicketBase`). Colonnes domicile recopiées APRÈS l'enregistrement de la config.
- Rafraîchissement des réglages (il n'existait pas) : `lxReglagesSynchro` toutes les 60 s + retour au premier plan (lit l'entier config_version ; sans colonne : relecture complète toutes les 5 min). Applique seulement les sections non modifiées ici. JAMAIS pendant une saisie (`_lxSaisie` posé par les événements input/change, fenêtre #modal avec champs, champ actif) ni sur caisseGestion/products/gifts : rien n'est touché, bandeau « Mis à jour sur un autre appareil » + « Afficher » (`lxMajDistanteAfficher`). Pages redessinées : settings, marketing, services (`_lxRedessinerPage`) ; autres : refreshCurrentView.
- Prestations / forfaits (`_lxSaveCatRow`) : seuls les champs modifiés depuis la signature `_lxSvcSig`/`_lxForfSig` ; ligne vue en base puis disparue = supprimée ailleurs -> plus recréée (`_lxCatRetirerSupprimes`, CONFLIT_SYNCHRO). Équipe : l'enregistrement en masse ne réécrit plus les fiches existantes (sauf `_dirty`), fiche supprimée ailleurs jamais recréée (`_lxCollabZeroLigne`, rechargement). Produits : idem (`prod._lxBase` présent + ligne absente).
- Rappels : `_lxRappelsParApplication()` — l'app n'envoie AUCUN rappel RDV (veille SMS, veille e-mail, 2 h) si `app_config.config.rappels_serveur_2h_email` est true ; drapeau relu toutes les 10 min ; inconnu -> dernière valeur lue (< 7 j) sinon abstention.
- E-mails : worker `/api/email/custom` et `/api/email/ticket` réservent la ligne messaging_log AVANT Brevo (`lxEmailReserver`, index unique existant `uniq_messaging_log_dedup`) : clé d'événement `dedupKey` (doit commencer par l'id du salon de l'appelant ; rappel veille = `<salon>|rappel_24h_email|<adresse>|<date RDV>`, identique au serveur ; anniversaire / relance / cartes : clé du jour / de la carte) sinon empreinte destinataire+objet+texte par tranche de 10 min (tranche précédente vérifiée). Échec Brevo -> réservation supprimée. Réponse `deduplique:true` / `journalise:true` (l'app n'écrit plus sa propre ligne). Appels x-lx-internal : non touchés. Le ticket par e-mail renvoie maintenant `success:false` si Brevo refuse.
- Bancs (non versionnés) : /tmp/lxtest/{test,site,worker,cat}.js — 21 + 11 + 6 + 7 OK ; sans la colonne, 19/20 écritures simultanées perdaient une modification (ancien comportement), 0/20 avec.
- Ordre : SQL -> worker -> pages (luxyra-supabase.js v=20261015-3). Reste (règle permanente) : centre d'aide (section « plusieurs appareils »), test réel 2 appareils sur Salon Démo, bot (ligne `multiappareil_1015` dans le SQL) à vérifier avec lx-bot-eval.
## 2026-10-15 — Crédits Brevo dans l'admin
- Worker `GET /api/admin/brevo[?refresh=1]` (`handleAdminBrevo`, admin support@luxyra.fr + aal2 via `lxIsAdminUser`) → Brevo `GET /v3/account` avec `env.BREVO_API_KEY`. Renvoie seulement `account` (email, companyName, prénom/nom), `plans` (type, credits, creditsType, start/endDate), `planVerticals` (résumé), `smsCredits`, `emailPlans`, `fetchedAt`, `cached`, `ageSec`. Jamais relay ni clé Marketing Automation. Cache 5 min (mémoire + caches.default) ; « Actualiser » = au plus 1 appel Brevo / 30 s ; Brevo injoignable → dernières valeurs (`stale`).
- Admin → SMS → Tableau de bord : carte « 💳 Crédits Brevo » (`brevoCharger` / `brevoRendu`) : crédits SMS Brevo, ≈ SMS France = floor(crédits / ratio), crédits vendus aux établissements (somme `salons.sms_credits` > 0), écart, plans email, alerte rouge sous le seuil ou si vendus > disponibles.
- Réglages `app_config.config.brevo_credits_par_sms_fr` (défaut 4,5 — « à vérifier dans votre compte Brevo », estimation) et `brevo_seuil_sms_fr` (défaut 200), écrits par l'admin (`brevoSauverReglages`, lecture-fusion, policy is_admin, admin_log `BREVO_RATIO_SMS`).
- ⚠ Le cron `runSmsRapprochementJob` alerte toujours sous 200 CRÉDITS bruts (pas SMS) — non modifié.

- 2026-10-15 : VÉRIFIER LE WORKER EN MODULE avant tout push : `cp docs/luxyra-router-worker.js /tmp/w.mjs && node --check /tmp/w.mjs` (un `node --check` du .js ne voit pas les fonctions déclarées deux fois ; une fusion avait créé un doublon de lxSha256Hex et fait échouer le déploiement Cloudflare).

## 2026-10-15 — Admin : « 🔧 À réparer » + « 🧾 NF525 » (APPLIQUÉ en base)
- SQL `docs/migrations_1015/admin_a_reparer.sql` (idempotent, lecture seule sur les données métier) : table `admin_acquittements` (RLS is_admin), `lx_prive.a_reparer_brut(p_heures)` (toutes les sources), RPC `admin_a_reparer(p_heures=72)` / `admin_acquitter(signature, titre)` / `admin_nf525_etat()` (is_admin + aal2).
- Sources : server_errors error/critical (edge_fn:*, worker:*, nf525_integrity, public_booking, Brevo) hors bruit ; pg_net seulement si ≥ 3 en 24 h (tâche retrouvée par son timeout) ; audit_log DB_ERROR / WAL_ABANDON / JS_ERROR / JS_CONSOLE_ERROR (hors tuiles/images, réseau, [ALERT]/[TOAST], RGPD, refus « inaltérable », ticket rejoué avec succès) ; contournements NF525 sans RESET_VENTES_TEST/archive de purge à ±10 min ; js_errors_public (site non chargé ≥ 3, autres ≥ 2) ; cron échecs + exécutions manquées (*/N, horaire, quotidien) + heartbeat ; sonde synthétique ; sms_differes / sms_envois (échec définitif) / sms_queue ; Stripe (refund_error hors « skip », payé mais pending_payment, annulé par le salon non remboursé, empreinte > 6 j) ; acomptes « ticket » sans ticket > 2 h, remboursements sans ticket > 2 h ; check_data_integrity / check_fiscal_integrity ; double scellement recalculé ; ticket modifié après scellement sans CORRECTION_REGLEMENT ; journée vendue sans Z ; numéros imprimés (tkNum) sautés/doublés.
- Bruit connu exclu en dur : NF525_TEST_NUIT_KO avant le 12/10 20h ; baisse d'inventaire dans les 36 h après une archive de purge ; extensions navigateur (ethereum…). Acquittement = caché tant que `derniere` <= `traite_le`.
- NF525 : tests de nuit (dernier résultat stocké, la fonction n'est PAS relancée : elle écrit), verrous (verify_nf525_status), autocontrôle signatures, clé, ancrage, attestation éditeur (constante `v_majeure`='6' à bumper avec LX_ATT), conservation ; par établissement : mode, numérotation, numéros imprimés, chaînage, scellement recalculé, signatures, JET, Z, ZM/ZA, exercice, grand total, archives, attestation.
- admin.html : `lxARCharger` / `lxARRendu` / `_lxARHtml` / `_lxNfHtml` / `lxARTraiter`. Depuis la refonte du 15/10 (ci-dessous) : UNE page Qualité › À réparer (#lxARPage) et UNE page Qualité › NF525 (#lxNfPage) ; le monitoring garde son résumé « en clair ».
- État au 15/10 : 0 point à réparer sur 72 h ; NF525 ✅ partout (Excellence : 2 irrégularités de numéros imprimés de juillet, historiques ; ticket #311 corrigé cb→esp avant clôture le 16/07, tracé).

## 2026-10-15 — Admin : nouvelle organisation en 7 rubriques (branche admin-structure, NON appliqué / NON déployé)
Audit approuvé : `docs/admin-audit-1015.md` (P1 + P2, sauf le chat support fait en parallèle par un autre lot).
- **Menu** (`LX_MENU`, `lxMenuRendu`, sous-pages dans la barre latérale + en haut de page) : Tableau de bord · Établissements (liste & fiches, inscriptions, demandes d'essai, migrations, fermetures & archives) · Revenus & abonnements (revenu mensuel & historique, Stripe, essais & impayés, parrainage, revenus SMS) · Support (boîte de réception = chat existant, base du bot) · Communication (SMS Brevo, modèles & relances e-mail, statistiques d'envoi) · Qualité & conformité (À réparer, monitoring, NF525 & attestations, clôtures Z, sauvegardes & tâches de nuit, RGPD & purges, journal admin, demandes à Claude) · Croissance & réglages (annuaire, chiffres clés, cohortes, entonnoir, réglages & notifications, légal, système & intégrations, liens externes).
- **Clés d'URL** `?tab=&sub=` : tableau, salons, revenus, communication (= Support, clé historique gardée car le chat teste `_currentTab==='communication'&&_currentSub==='chat'`), diffusion (= Communication), qualite, croissance. `LEGACY_NAV` + `lxNavResoudre` : toutes les anciennes adresses (cockpit, finance/*, analytics/*, parametres/*, monitoring, claude, `#stripe`, `#sms`, raccourcis enregistrés, liens des push) mènent à la nouvelle page.
- **Doublons supprimés** : NF525 = une page (source `admin_nf525_etat` ; l'ancienne page `verify_nf525_status` est retirée, ses contrôles RGPD sont dans RGPD & purges) ; « À réparer » = une page ; intégrations = page Système seulement (plus dans le monitoring) ; MRR = Revenus (graphe 12 mois déplacé du cockpit).
- **Tableau de bord** (`rTableau`, `lxTdbCharger`, `lxTdbRendu`) : 10 cartes cliquables + « Alertes du jour », RPC unique `admin_tableau_de_bord()` (+ `/api/admin/brevo` et `/api/admin/github-actions`, en cache). Repli navigateur partiel si la RPC manque. Raccourcis personnels conservés.
- **Corrections** : raccourci / carte « non lus » = vrai filtre (`lxChatFiltreBandeau`, liste figée des conversations non lues, chat non modifié) ; pastilles calculées (`lxBadges`) ; notifications : texte faux « Web Push abandonné » remplacé, carte Réglages › Notifications (appareils de `push_subscriptions` avec bouton Retirer, activer, test) ; `admin-sw.js` = notifications locales seulement, clic -> `lx-notif-click` ; simulation « +5 Pro/mois » remplacée par la croissance réelle (`lxCroissanceReelle`) ; liste des salons sans 2 requêtes par salon (`admin_salons_compteurs`, repli `admin_salon_health`).
- **Journal admin** : helper unique `lxJournal(action,{salon,cible,details,avant,apres})` -> RPC `admin_journal` (saJournal / logAdminAction y passent ; plus aucune insertion directe dans admin_log). Traces automatiques avant/après en base (`lx_prive.admin_journal_auto`, déclencheur `trg_admin_journal_auto` sur salons, app_config, demandes_essai, migration_requests, admin_email_modeles, support_bot_kb, admin_suivi_salons, parrainages, push_subscriptions ; seulement les écritures de la session admin 2FA ; secrets et gros champs masqués ; jamais bloquant). Page Qualité › Journal admin (filtres période, établissement, action, texte, traces auto).
- **Nouvelles pages** : Parrainage (table parrainages, statut, montant, référence Stripe) ; RGPD & purges (`admin_rgpd_etat` : J+60, 6 ans, comptes clients inactifs avec dates ; bouton « Lancer maintenant » -> `/api/admin/retention-purge` avec double confirmation, export NF525 par établissement) ; Fermetures (liste, archives en lecture seule, export) ; Essais & impayés (prolonger, portail / liens Stripe) ; Statistiques d'envoi (Brevo) ; Sauvegardes (GitHub + `admin_taches_nuit`) ; Liens externes.
- **Worker** : `GET /api/admin/brevo-emails` (aggregatedReport 7/30 j + incidents, cache 10 min), `GET /api/admin/github-actions` (jeton `GITHUB_TOKEN_RO`, sinon `connecte:false` + marche à suivre dans la page), `POST /api/admin/retention-purge` accepte aussi la session admin 2FA (trace `RETENTION_MANUELLE`). Portail Stripe depuis la fiche : `/api/stripe/portal` existant (admin autorisé par lxGuardSalon).
- **SQL** `docs/migrations_1015/admin_structure.sql` (BEGIN/COMMIT, idempotent ; validé en BEGIN…ROLLBACK le 15/10 avec une session admin simulée) : colonnes admin_log (admin_email, cible, avant, apres, origine), RPC admin_journal / admin_salons_compteurs / admin_taches_nuit / admin_tableau_de_bord / admin_rgpd_etat (toutes is_admin), déclencheurs de journal, cartes d'abonnement : 3 tâches de nuit -> 1 (`expire-cartes-abo-daily` 02:00, `expire_cartes_abo` corrigée : sa trace admin_log n'était jamais écrite). `salon_admin_notes` (vide) LAISSÉE : encore citée par `admin_delete_salon_cascade`.
- **Ordre** : SQL -> worker (`cp docs/luxyra-router-worker.js /tmp/w.mjs && node --check /tmp/w.mjs`) -> admin.html + admin-sw.js. Secret optionnel : `GITHUB_TOKEN_RO` (fine-grained, dépôt luxyra.fr, Actions : lecture seule).

## 2026-10-15 — Boîte de support renforcée (branche admin-chat, NON déployé)
- SQL `docs/migrations_1015/support_chat.sql` (validé BEGIN…ROLLBACK, à appliquer AVANT les pages) puis `bot-reply` v14 (`docs/edge_1015/bot-reply/index.ts`).
- Statuts `support_conversations.status` : `open` (ouvert) / `waiting` (en attente du pro, posé par `fn_touch_support_conv` quand l'équipe répond) / `resolved`. Message du pro → `open`.
- Escalade : `escalade_bot`, `escalade_le`, `escalade_motif` (bot | demande_pro | erreur_bot | piece_jointe). Déclencheur `trg_support_escalade` : message du bot avec `read_by_admin=false` = passage de main. « Réactiver le bot » (admin) remet `bot_active=true` et efface l'escalade.
- Notes internes : table SÉPARÉE `support_notes` (policy is_admin seulement ; bot-reply ne lit que support_messages).
- Réponses types : `support_reponses_types` (titre, raccourci, contenu, ordre, actif), admin ; « / » dans la réponse, variables {prenom} {salon}.
- Pièces jointes : `support_messages.pieces` jsonb [{chemin,nom,type,taille}], bucket privé `support-pieces` (PNG/JPEG/WebP/PDF, 5 Mo ; chemin `<salon>/<conversation>/<uuid>.<ext>`), validées par `lx_prive.support_pieces_valider` (type/taille relus dans storage.objects). Liens signés 10 min. Signature réelle du fichier vérifiée côté navigateur.
- Avis 👍/👎 sur le bot : `support_messages.bot_avis` via RPC `support_bot_avis`. Gardes `support_msg_garde` / `support_conv_garde` : nouvelles colonnes non modifiables par un pro.
- Realtime privé `support:<conversation>` (broadcast typing / lu + présence), policies sur `realtime.messages` via `public.support_canal_autorise(topic)`.
- RPC admin (is_admin) : `admin_support_contexte`, `admin_support_recherche` (ILIKE messages + notes), `admin_support_stats`, `admin_support_bot_revue`.
- E-mail de secours : `lx_prive.support_relances_email()` (cron `support-relances-email` */5), 15 min sans lecture, dedup `messaging_log.dedup_key = support_relance|pro|admin|<message>`, rien entre 21 h et 8 h (Paris), messages > 3 j ignorés.
- Admin : Communication › Chat support = onglets internes Boîte / Réponses types / Revue du bot / Statistiques ; raccourcis j k r e / Ctrl+Entrée ; lien direct `?tab=communication&sub=chat&conv=<id>`.
- App pro : 📎, statut « Ouverte / Réponse reçue / Résolue », « en train d'écrire », « ✓✓ Vu », 👍/👎, pastille = non-lus de toutes les conversations (réponses du bot comprises).

## 2026-10-16 — INCIDENT Z n°128 (Excellence) : RDV en ligne compté 2 fois — corrigé (accord d'Alexandre « oui »)
- Cause : e57efc8 (14/10) gardait l'entrée `online_X` encaissée ; saveAppointment crée la ligne appointments `X` ; reloadFromSupabase la poussait en 2e entrée -> doublon planning + Z (4 tk / 95,40 au lieu de 3 / 69,40).
- App (6.6.1, données 20261016-1) : `_lxDedupOnlineAP` fusionne `online_X` + `X` (ligne base gardée, clés manquantes recopiées ; seul porteur du tkNum jamais retiré), appelée après chaque relecture, dans `go()` (planning/home/stats/compta/caisse) et par `_lxZDoneAP` ; reloadFromSupabase remplace `online_X` par la ligne `X` ; `_lxDedupTkNum` (n° imprimé + date + montant) dernier filet de la Z.
- Z : `doConfirmCloture` -> `_lxZControleJournal(TD)` (relit tickets du jour + corrections avant clôture ; compare nb / total / modes) -> écart = `_lxZAfficherEcart` (bloquée) + `_lxZRecalculerDepuisTickets` / `_lxZValiderDepuisTickets` (liste `_lxZDoneDepuisTickets`, `cloturerJournee({done})`). `_lxZFinaliser` = ancienne fin de doConfirmCloture. saveCloture : erreur `LX_Z_ECART_JOURNAL` -> refus définitif (WAL soldé), `_lxZRefuseeParServeur` rouvre la journée ; tickets non verrouillés.
- Base (APPLIQUÉ le 16/10, SQL `docs/migrations_1016/z_controle_annotations.sql`, via execute_sql car apply_migration a expiré) : déclencheur `b_nf525_z_controle_journal` (Z refusée si total ≠ journal ou nb > journal hors auto), table `clotures_annotations` (inaltérable, chaînée, JET 900, RLS lecture propriétaire/admin), `nf525_annoter_cloture` (admin/service, montants relus dans le journal), `nf525_z_annotation_delta`, `lx_prive.z_journal_tickets`, cumuls corrigés (`clotures_set_cumul_perpetuel`, `cloturer_mois`, `cloturer_exercice`, cumul mois/année de la Z suivante sauf `raw_data.lxAnnotOk`), `check_fiscal_integrity` §2 et `check_cumul_clotures_periodiques` tiennent compte des annotations.
- Données : JET 515 (code 90) + annotation n°1 de la Z 128 (JET 516, code 900). App : `window.Z_ANNOTATIONS` (lxChargerAnnotationsZ), affichées historique Z + duplicata (`_lxZAnnotationHtml`) ; admin NF525 : liste des annotations.
- Reste : push des pages ; déployer nf525-sign v6 (type ZC, `docs/edge/nf525-sign.ts`) si Alexandre l'accepte ; lx-cloture-auto ne connaît pas les annotations (le serveur corrige ses cumuls) ; bot / centre d'aide (Z bloquée + « Recalculer depuis les tickets enregistrés ») ; test réel Salon Démo.

## 2026-10-17 — Page de désinscription Luxyra + motifs + statistiques (SQL APPLIQUÉ, worker à déployer)
- SQL `docs/migrations_1017/desinscription_motifs.sql` (APPLIQUÉ) : table `lx_desinscription_motifs` (salon, canal, motif, texte « Autre » 5-300 nettoyé, date, annule_le ; RLS fermée, aucune donnée perso) ; `lx_desinscrire_code(code, motif, texte, source)` (remplace la version 1 arg, compatible) ; `lx_annuler_desinscription(code)` (48 h, rétablit l'état d'avant, refus si STOP reçu depuis) ; `lx_desinscription_info` (+deja réel, annulable, sms_global) ; `admin_desinscriptions_stats(jours)` (is_admin) ; `lx_salon_desinscriptions(salon)` (propriétaire, sans textes libres).
- Réalité : lien SMS = opposition GLOBALE du numéro (tous établissements, `lx_sms_stop`), rappels gardés ; lien e-mail = fiche de CET établissement (email_ok).
- Worker : `lxPageDesinscription` / `lxReponseDesinscription` (CSP nonce, no-store, noindex) ; états confirmer / succes / deja / reinscrit / invalide / impossible / trop / erreur ; POST `action=reinscrire` ; « un clic » RFC 8058 -> motif un_clic. Ancienne route /api/unsubscribe : même apparence (sans motif). Regex e-mail : liens /s/ reconnus (plus de double pied).
- Admin : Communication › Désinscriptions. App pro : Paramètres › SMS et Marketing › encart 30 jours. luxyra-supabase.js NON modifié.
- Connu : les préférences SMS/e-mail de l'espace client (compte.html) ne sont PAS synchronisées vers les fiches salons (TODO toggleNotif) — la page ne le promet pas.

## 2026-10-17 — SMS publicitaires : mode « Depuis mon téléphone » + purge désinscriptions (SQL APPLIQUÉ, app à pousser)
- SQL `docs/migrations_1017/sms_restes.sql` (APPLIQUÉ, tests en transaction annulée consignés) : déclencheur `trg_sms_queue_pub` (BEFORE INSERT / UPDATE OF message, context sur `sms_queue`, contextes marketing/anniversaire/relance seulement) -> refus `LX_HORS_CRENEAU` / `LX_STOP` / `LX_SANS_LIEN`, sinon ajoute « \nStop SMS: luxyra.fr/s/<code6> » (`lx_code_desinscription_sms`). Cron `sms-queue-pub-garde` (chaque minute) : SMS publicitaires 'pending' -> 'cancelled' hors créneau ou numéro opposé. Cron `desinscriptions-purge` (3 h 55) : après 48 h, codes.motif_id/avant_* = null + dates arrondies au jour (codes.utilise_le, motifs.cree_le/annule_le) ; motifs > 3 ans supprimés ; lx_sms_stop jamais touché.
- App : `lxSmsMentionStopActive()` = true (compteur compte la mention dans les deux modes ; libellés « SMS sur le forfait » en natif) ; `sendSmsNative` traduit les refus (hors_creneau / stop / sans_lien), journal = texte réel ; campagne : stop -> ignorés.
- Légal : politique-confidentialite (17/10 : §2, tableau §3, §3.2, §10) + securite-rgpd. Aide s11 + bot (sms_stop_creneaux_1017, desinscription_motifs_1017) à jour.
- Connu : en natif, aucune conversion GSM (accents envoyés tels quels par le téléphone -> peut basculer en UCS-2 / 70 car.) alors que le compteur suppose la conversion ; l'appli Android n'est pas dans le dépôt (lit status 'pending').

## 2026-10-17 — SMS libres (information / publicité) + liste d'opposition 3 ans (SQL APPLIQUÉ, app + worker à pousser)
- Constat : AUCUN envoi SMS individuel libre dans app.html (pas de bouton SMS fiche client / fiche RDV ; liens `sms:` = SMS du téléphone du pro, hors Luxyra). Seule fenêtre de texte libre : Marketing › Campagnes › « Message libre » (type `custom`), auparavant toujours 'marketing'.
- « Message libre » + SMS : nature OBLIGATOIRE (`lxCampNature`) ; « Information » + marqueurs pub (`lxSmsMarqueursPub`) -> avertissement inline « Envoyer comme publicité » / « Modifier le texte » ; info -> `lx_sms_campagne_enfiler(..., p_contexte:'libre_info')` (48 h, 8 h-21 h) ; audit `SMS_LIBRE_NATURE`.
- `sendSms` : contexte hors LX_SMS_CTX_PUB / LX_SMS_CTX_TRANSAC -> 'marketing' si marqueurs, sinon 'libre_info'.
- Serveur : worker `handleSmsCustom` (appels NON internes seulement, contextes transactionnels exclus) requalifie en marketing + consentement (`sans_consentement`) ; déclencheurs `trg_sms_queue_pub` (+ LX_SANS_CONSENTEMENT) et `trg_sms_differes_requalifie` ; fonctions `lx_prive.sms_texte_publicitaire / sms_contexte_transactionnel / sms_contexte_requalifie` ; audit `SMS_LIBRE_REQUALIFIE`.
- `lx_sms_stop` supprimée 3 ans après greatest(stop_le, maj_le) par `desinscriptions_purge` (cron existant 3 h 55) ; `lx_sms_stop_levee` > 3 ans aussi ; trace `admin_log` RGPD_SMS_STOP_PURGE (sans numéro).
- Fichiers : docs/migrations_1017/sms_libre_et_purge.sql, politique-confidentialite, securite-rgpd, aide/sms-et-rappels.html, bot (3 fiches).

## Appli Android « Luxyra Pro » (fr.luxyra.pro) — préparation Play 26/10/2026
- TWA de app.html, construite par Alexandre sur PWABuilder (comme fr.luxyra.client), URL de démarrage `/app.html?source=play`. Même clé d'importation que l'appli clients possible (keystore chez Alexandre).
- `window.LX_PLAY` (head de app.html) : vrai si `?source=play` ou referrer `android-app://fr.luxyra.pro`, mémorisé en sessionStorage `lx_play` (jamais localStorage : Chrome partage le stockage avec la TWA). En mode Play : AUCUN achat (règle paiements Google Play) — garde `lxPlay()` dans showPlanChoiceModal, showUpgradeModal, checkCgv*AndPay, startCheckout, openCustomerPortal, showSwitchPlanModal, confirmDowngrade, doSwitchPlan, buySMSPack, lxRechargeAutoRegler ; blocs prix/boutons masqués (accueil, Paramètres forfait, bandeau essai, marketing, SMS épuisés, abonnement résilié). Message neutre `lxPlayInfo()` sans prix ni lien. Toute nouvelle offre payante dans app.html = ajouter la garde.
- Acomptes clients (Stripe Connect) non concernés (services physiques).
- manifest-app.json : related_applications → fr.luxyra.pro.
- Visuels : outputs play-store-pro (8 captures mode démo 1080x1920, image 1024x500, icône, textes). Captures refaites avec shot/play.mjs + compose.mjs (serveur local, ?demo=coiffure).
- Compte d'examen Google : NE PAS rouvrir le Salon Démo (fermé, caisse réelle, retour test impossible : les encaissements des examinateurs seraient des tickets fiscaux réels). Nouvel établissement de test créé par Alexandre (caisse en mode test), passé en gratuit dans l'admin.
- À faire à la mise en ligne : assetlinks (empreinte Google de fr.luxyra.pro), docs/migrations_1026/bot_appli_play_pro.sql, aide, badge Play sur les pages pro.
- 26/10 soir : appli Play créée (app id 4973731668304146178), bundle 1.0.0.0 (PWABuilder via /app-play.html + manifest-pro-play.json, app.html > 2 Mo), clé d'importation nouvelle (zip chez Alexandre). assetlinks : empreinte Google A2:50:64:…:9F:E3. Fiche, déclarations, sécurité des données, classification (PEGI 3), France, catégorie Professionnel : FAITS. Envoi pour examen par Alexandre. Visuels en ligne : /store/pro/.
- Compte d'examen : « Luxyra Démo » luxyra.dev+google@gmail.com (salon 3c41689a-52f8-41e7-b9ec-f10e574f22cc), caisse test, site hors ligne (site_config.site_actif=false), essai jusqu'au 31/12/2027 (statut active impossible sans SIRET), tag test_google_play, données fictives (7 prestations, 3 collaborateurs, 15 clients sans e-mail/SMS, 16 RDV 27-31/10).
- **APPLI PRO PUBLIÉE LE 29/10/2026** (page Play vérifiée : « Luxyra Pro – Caisse & planning », éditeur Luxyra ; appli clients « Luxyra – Beauté & bien-être » déjà en ligne). Mis à jour ce jour-là :
  * Bot : `docs/migrations_1026/bot_appli_play_pro.sql` APPLIQUÉ (appli_android_pro_1026 nouvelle + installer_app + appli_clientes « publiée »), 2 passes lx-bot-eval. RESTE : malgré la « RÈGLE PRIORITAIRE », le bot ajoute encore « abonnez-vous sur luxyra.fr/app dans un navigateur » à « puis-je m'abonner depuis l'appli Android ? » (risque règle Play anti-orientation, le chat est affiché dans l'appli Play). Vraie correction à faire : transmettre LX_PLAY au contexte de bot-reply (+ lx-bot-eval) et y interdire l'orientation.
  * **FAIT 29/10/2026 soir (garde 20261029-6)** : colonne `support_messages.play` (défaut false ; `docs/edge_1029_bot/support_messages_play.sql`, migration `support_messages_play_20261029` APPLIQUÉE ; garde `lx_prive.support_msg_garde` : play seulement sur un message `client`, figé à la mise à jour). app.html `sendMsg` du chat support ajoute `play:true` si `lxPlay()`. **bot-reply v17** (plateforme v17, verify_jwt true inchangé) : si UN message du pro de la conversation porte play → bloc système `PLAY_PROMPT` (jamais où / comment s'abonner, acheter des SMS, aucun prix, site, lien, navigateur ; réponse « Cette opération n'est pas disponible dans l'application. »), contexte sans prix, puis filtre `filtrerPlay()` (retire toute phrase avec luxyra.fr/app, navigateur, http(s)://, www., stripe.com, « lien de paiement », « s'abonner / abonnez-vous / souscrire sur|depuis|via|en ligne… », 14,99 / 24,99, luxyra.fr/tarifs|inscription, ou lieu (ordinateur, luxyra.fr, Chrome, site de Luxyra…) + achat (abonn, forfait, pack, achat, recharg, tarif, prix…) ; réponse vide → phrase neutre). **lx-bot-eval v5** (verify_jwt true inchangé) RÉALIGNÉ sur bot-reply v17 (même consigne, modèle Sonnet + repli Haiku, contexte) + paramètre `play` ; sortie `a` (filtrée), `brut`, `filtre_play`. Avant : `docs/edge_1029_bot/avant/` (bot-reply v16, lx-bot-eval v4 = ancienne consigne v12 + Haiku). Essais lx-bot-eval play=true (« puis-je m'abonner depuis l'appli Android ? », « comment acheter des SMS ? », « combien coûte le forfait Pro ? », « comment changer de forfait ? », « pack de 500 SMS sur ordinateur », relance « et sur le site ? donnez-moi le lien ») → tous « Cette opération n'est pas disponible dans l'application. » ; fonctions du forfait Pro, acomptes, collaboratrice : réponses normales sans prix ni lien. play=false : réponses habituelles (prix, chemins). bot-reply : démarrage contrôlé (conversation inexistante → skipped). Toute modification de la consigne : la reporter dans les DEUX fonctions (PLAY_PROMPT et filtre compris). Les réponses écrites par un HUMAIN dans l'admin ne sont pas filtrées : ne pas y donner de lien de paiement si le pro écrit depuis l'appli Play (champ `play` des messages).
  * app.html (garde 20261029-5, 3 endroits) : Paramètres › « Installer l'application » et bandeau d'accueil proposent sur Android le badge Google Play de fr.luxyra.pro (`lxPlayProBloc`, `lxInstallerPlayModal`, « Installer depuis Chrome à la place ») ; jamais dans l'appli Play (`lxEstInstallee()` vrai si LX_PLAY).
  * Site : index « Nos applications » (#application, 2 cartes, captures store/web/*.webp, JSON-LD MobileApplication ×2), pro.html + 9 logiciel-*.html (badges Pro + clients `.lxgp-duo`), tarifs (Luxyra Pro incluse : liste Essentiel, comparatif, bandeau), inscription (écran final + e-mail de bienvenue), politique-confidentialite (§ 10 quater appli Pro, nom appli clients corrigé). Aide à la main : installer-et-notifications (#s1, #s3, FAQ), premiers-pas, aide.html (FAQ + Nouveautés). Sitemap (lastmod) non touché.
  * Annonce (image 1080, textes réseaux, e-mail établissements NON envoyé) : outputs Cowork `luxyra-annonce-google-play-*`.

## Supabase Disk IO (27/10/2026)
- Projet sur offre FREE, machine Nano. Alerte « Disk IO Budget ». Causes : scan_pg_net_failures (scan complet net._http_response, 35 Mo gonflée, sans index id) et get_monitoring_status (scan complet cron.job_run_details). Corrigé (docs/migrations_1027/disk_io_optimisation.sql) : fenêtre 2 h sur created / lecture par runid ; fréquences : pg-net-scan */15, annuaire-import */30, synthetic */30. Mesuré après : scan 25 ms (avant ~1 s), monitoring < 10 ms.
- Recommandé à Alexandre : passer en Pro (sauvegardes quotidiennes, pas de pause, Micro inclus). MCP Supabase refusé ce jour → éditeur SQL du tableau de bord via le navigateur intégré.
- 27/10 soir : quota EGRESS FREE dépassé (5,9/5 Go) — 98 % PostgREST dû à nf525-sign appelée toutes les 2 min sans travail. Tâche 37 conditionnée par `lx_prive.nf525_signature_en_attente()` (+ filet horaire job `nf525-sign-filet-horaire`). Fonction nf525-sign inchangée. Voir registre NF525 et docs/migrations_1027/nf525_sign_declenchement.sql. Si une nouvelle source est ajoutée à SOURCES de nf525-sign : l'ajouter aussi dans cette fonction.

## E-mails de démarrage (salon-onboarding-email v10, 27/10/2026)
- Source de référence : `docs/edge_1027/salon-onboarding-email/index.ts` (déployée via l'éditeur du dashboard, empreinte SHA-256 vérifiée identique). Cron job 6 (10h) envoie J1/3/5/7/14 ; J0 part de inscription.html.
- Contenu : étapes avec les VRAIS noms de menus (vérifier dans l'aide avant toute modif), conseil du jour, guides d'aide, signature Alexandre. Version texte jointe (`versionTexte`).
- Prénom : `salons.gerant_prenom` (repli config_json). Conseils adaptés au MÉTIER (`METIER[...]`, clés coiffure/barbier/esthetique/ongles/regard/maquillage/tatouage/spa/bien_etre ; repli générique) et au mode (`mode_activite` = domicile). Tout nouveau métier → ajouter une entrée dans `METIER`.
- Essentiel ≠ Pro : site/réservation en ligne, acomptes, SMS, cartes d'abonnement = Pro (ouverts pendant l'essai sauf SMS). Ne jamais promettre une fonction Pro à un Essentiel sans le dire.
- `sendWelcomeEmail` d'inscription.html est du code mort (jamais appelé) : ne pas le rebrancher (doublon de J0).
- Bot : entrée `emails_demarrage_1027` (docs/migrations_1027/bot_emails_demarrage.sql). Toute modification des e-mails → mettre à jour cette entrée.

## Envoi automatique au comptable (27/10/2026, option A — branche envoi-comptable, NON déployé, SQL NON appliqué)
- Ordre : `docs/migrations_1027/envoi_comptable.sql` (tables `compta_envoi_config`, `compta_envois`, RLS lecture propriétaire/admin, écriture service seulement, index unique `compta_envois_un_par_mois`) -> worker (`/api/compta/envoi`, dans `LX_ROUTES_SALON`) -> app.html (+ luxyra-supabase.js, version 20261027-2) -> `bot_envoi_comptable.sql`.
- LECTURE SEULE sur la caisse, aucun calcul fiscal nouveau. Exports refactorés pour un mois explicite, sans toucher `accM` ni télécharger : `_lxPackComptableZip(mois,{strict})` (expPackComptable l'appelle), `_lxFecConstruire(du,au)` (exportFEC l'appelle), `expAnnulations/expTvaPaiementsEnLigne/expLivreRecettes(mois, collecteur)`, `expAcomptesNonSoldes(silencieux, mois, collecteur)`, `_lxMoisExport`, `_lxCsvSortie`. Ne plus utiliser `window._lxCsvCapture`. Banc de non-régression : identiques avant/après (voir registre NF525). Tout changement de ces exports doit garder bouton manuel = envoi automatique.
- NB : `expPackComptable` (ZIP) et `expRapportComptablePDF` n'ont AUCUN bouton dans l'app (constaté le 27/10) ; l'envoi automatique les utilise.
- 27/10 (-2, décision d'Alexandre) : le comptable reçoit ce que l'établissement voit : PJ par défaut = FEC + pack Excel (`expExcelComptable`, bouton « Télécharger l'Excel comptable ») + rapport (depuis -3 : VRAI PDF, voir ci-dessous) ; pack ZIP = option décochée. Excel refactoré : `_lxExcelComptableClasseur(mois,{silencieux,strict})` -> `{wb,fname}` + `_lxExcelComptableOctets(X)` (XLSX.write type array) ; `expExcelComptable` l'appelle puis `XLSX.writeFile` (banc : classeur identique à 8763862, entrées xlsx et cellules). Réglage normalisé par `_lxEcDocs` (fec/excel/rapport !== false, pack === true) ; colonne SQL `doc_excel` (défaut true), `doc_pack` défaut false. PJ Excel nommée `Excel_comptable_AAAA-MM.xlsx` (le nom du téléchargement manuel contient le nom du salon et des accents : refusé par la liste blanche). Excel non compressé (comme le bouton) : ~0,9-1,3 Mo pour 300-430 tickets/mois. Refus 400/413 du worker : l'app arrête pour ce mois sur cet appareil (`LX_EC.stopMois` + motif dans la carte).
- App : `lxEnvoiComptaVerifier` (toutes les minutes, délais 10 min / 1 h si mois non clôturé ; profil « Comptabilité » + « Exporter des données » ; pas en démo / vue admin / archives) -> op `statut` -> contrôle `_lxEcControleApp(mois)` = `clotures_mensuelles.total_ca` (±0,05 €, sinon op `ecart`, rien ne part) -> `_lxEcFichiers` -> op `envoyer`. Carte Paramètres › Caisse et paiements (`lxEnvoiComptaCarte`), carte accueil `_lxEcCarteAccueil` (priorité juste après SIRET).
- Worker : destinataire relu dans `compta_envoi_config` (jamais du corps) ; auto = caisse réelle + mois clôturé + contrôle CA ; noms de PJ imposés (depuis -3 : `<SIREN>FEC<clôture d'exercice>_AAAAMM.txt`, `Excel_comptable_AAAA-MM.xlsx`, `Rapport_comptable_AAAA-MM.pdf`, `Luxyra_compta_AAAA-MM.zip`), 4 PJ, 8 Mo ; tests 3 / 24 h ; ligne `reserve` AVANT Brevo (409 = déjà envoyé) ; chiffres de l'e-mail = clôture mensuelle ; `lxMailLayout(…, {salon})` ; `brevoSendEmail({cc})`. Tests : `/tmp/nrtest/worker_test.mjs` (45/45 au -2, base et Brevo simulés), `/tmp/nrtest/nr.cjs` (non-régression ZIP/FEC/rapport/Excel), `/tmp/nrtest/ui.cjs`, `/tmp/nrtest/check_inline.py` (node --check des scripts inline) (non versionnés).
- Mode test (essai) : jamais d'envoi automatique ; test possible, objet « [Données de test] ».

## Rapport du mois en vrai PDF + audit des exports (27/10/2026, -3 — branche rapport-pdf, NON déployé, aucun SQL appliqué)
- Bibliothèque : `vendor/jspdf/jspdf.umd.min.js` (jsPDF 4.2.1, MIT, 420 Ko) + `vendor/jspdf/jspdf.plugin.autotable.min.js` (5.0.9, MIT, 33 Ko), chargées à la demande par `_lxChargerJsPdf()` depuis https://luxyra.fr/vendor/… (aucun CDN). Polices standard Helvetica (WinAnsi) : accents, €, œ, « » OK ; `_lxPdfTxt` remplace les espaces insécables (séparateur de milliers fr-FR, sinon « / ») et retire les émojis.
- `_lxRapportDonnees(mois)` = SEULE source des chiffres du rapport (calculs de l'ancien `_buildRapportHTML`, inchangés) ; `_buildRapportHTML` (aperçu + pack ZIP) et `_lxRapportPDF(mois,{cloture})` (PDF) la lisent. `expRapportComptablePDF()` = téléchargement du PDF ; `expRapportComptableApercu()` = ancienne page imprimable. Entrées « Rapport du mois (PDF) » et « … aperçu à l'écran » dans Documents comptables.
- PDF : en-tête établissement / SIRET / régime TVA, période, date-heure (Paris), version, origine + empreinte de la clôture mensuelle (`clotures_mensuelles`, lecture seule ; l'envoi auto passe la ligne renvoyée par le worker, `statut.cloture.hash`), pagination « page x / y », empreinte SHA-256 du JSON de `_lxRapportDonnees` (pied + métadonnées « keywords »). Vocabulaire : JAMAIS « signé » ni « certifié ». ~9-12 Ko pour un mois de 300 tickets.
- Envoi au comptable : PJ `Rapport_comptable_AAAA-MM.pdf` (`_lxEcFichiers(mois, docs, cloture)`). Worker : liste blanche .pdf / application/pdf, `.html` refusé, `lxEcSignatureOk` (PDF « %PDF- », xlsx/zip « PK\x03\x04 », FEC texte sans octet nul) APRÈS le contrôle de taille.
- FEC : nom `<SIREN>FEC<date de clôture de l'exercice>[_AAAAMM | _AAAAMMJJ-AAAAMMJJ].txt` (`_lxFecNomFichier`, art. A. 47 A-1 LPF / BOI-CF-IOR-60-40-20 § 370) — le worker calcule le même nom avec `salons.exercice_fin_mois` (`lxEcFinExercice`). Écritures triées par date puis numérotées (corrections de règlement après clôture). Deux taux : TVA en deux lignes.
- EBP / Quadratus : montant négatif -> sens inversé ; detail_paiement ≠ total -> repli sur mode_paiement (comme `_fecLegs`). Récap TVA du ZIP + onglet « 3 — TVA » de l'Excel : une ligne par taux en double taux.
- Bancs (non versionnés) : `/tmp/nrpdf/nr.cjs` (non-régression ancien/nouveau), `audit.cjs` (13 cas injectés, cohérence entre documents, structure FEC/EBP/Quadratus), `pdf1.cjs` (PDF mono/franchise/double taux + rendu PNG), `worker_test.mjs` (50/50), `ui.cjs`.
- Reste (règle permanente) : appliquer `docs/migrations_1027/bot_envoi_comptable_pdf.sql` APRÈS déploiement ; captures d'aide si l'écran Documents comptables est refait (compta_docs.webp montre l'ancienne liste) ; test réel (envoi de test) par Alexandre.


## Bons cadeaux : usage unique (BUU) / usage multiple (BUM) — 28/10/2026 (6.7.0, branche bons-cadeaux-tva, NON déployé, SQL NON appliqué)
- Règle (CGI art. 256 ter ; BOI-TVA-CHAMP-10-10-40-50 ; BOI-TVA-BASE-20-40 § 270-295) : qualification À LA CRÉATION du bon par `lxBonQualifier(scope)` (taux des prestations ; taux produits + taux propres des produits en vente ; 1 taux ⇒ BUU, sinon BUM). Figée : `cartes_cadeaux.usage_tva` / `qualif_tva` (repli : entrée `history[{type:"qualification_tva"}]`, relue par `_lxBonQualifLigne`), et sur la ligne du ticket (`items[].isBon`, `bonUsage`, `bonCode`, `bonScope`, `bonTaux`). Texte sous « Utilisable sur » (`lxBonQualifBloc` / `lxBonQualifTexte`).
- Interrupteur : `app_config.config.bons_tva_v2` (lu par `lxBonsV2Actif()`, LX_CONFIG). Inactif = comportement historique strict. Bons sans `usage_tva` = antérieurs : traitement d'origine jusqu'à épuisement.
- BUM vendu : ligne hors CA (HT = TTC, TVA 0), ticket scellé normal, `taux_tva` 0 si vente de BUM seule. BUM utilisé : règlement `payments[{method:"Bon cadeau", bonUsage:"BUM", bonCode, bonId}]` (poste « bon ») + `bonsUtil[{usage:"BUM", montant}]`. BUU (et bon antérieur, modèle actif) utilisé : déduction (`bonVenduRemise`) imputée sur les lignes couvertes `bonsUtil[].lignes {"<taux>|P|Q": montant}` (`_lxBonEligible`, `_lxBonImputer`, `_lxBonsUtilValider` au scellement). `bonsUtil` dans `_LX_APPT_META_KEYS`.
- Calcul : `_lxTicketV2(a)` (ligne BUM ou bonsUtil) ⇒ `_lxVentilV2(a)` {prest, prod, horsCa, parTaux, ht, htCa, tva} ; `_splitPrestProd` / `_lxHtTva` / `saveTicketToDb` délèguent UNIQUEMENT pour ces tickets. Helpers : `_lxHorsCa`, `_lxCaTtc` (CA = pr − BUM), `_lxBumPaye`, `lxBumMois`, `lxBumExpires`, `lxBumEncours`, `_lxRecetteMicroBum` (micro : BUM = recette à la vente).
- Z : `total_ca` = TOTAL DES TICKETS (contrôle serveur inchangé) ; raw_data `totalHorsCa`, `caHorsBum`, `bumUtilises`, `txTVAProd`. Tous les exports : CA hors BUM vendus, règlements = CA + BUM ; FEC / journal / EBP / Quadratus : 4191 (vente / utilisation), solde expiré OD 4191 → 758 (comptes `bonsMultiples`, `bonsExpires` dans « Comptes comptables pour l'export »). Export `expBonsUsageMultiple`, onglet Excel « 9 — Bons usage multiple », section 6 du rapport, ZIP `10_bons_usage_multiple_*.csv` : seulement s'il y a une activité.
- Remise refusée sur un ticket contenant la vente d'un BUM. Démo : `lx-demo.js` répond à `consommer_bon_cadeau`.
- Mise en service (ordre) : `docs/migrations_1027/bons_cadeaux_tva.sql` → réaligner `lx-cloture-auto` (copie de la ventilation v2, puis `verify`) → worker → pages (données 20261028-1) → activer `bons_tva_v2` (noter l'heure au registre = frontière) → `docs/migrations_1028/bot_bons_cadeaux_tva.sql`.
- Bancs (non versionnés) : `/tmp/nrb/nr.cjs` (non-régression 9cd810e / branche, V2=0 et V2=1), `/tmp/nrb/bons.cjs` (10 scénarios chiffrés), `/tmp/nrb/wmail.mjs` (e-mail comptable).
- Ouvert : bons vendus EN LIGNE sans ticket de caisse à la vente (voir registre NF525, 28/10).

## Recettes encaissées EN LIGNE = ticket scellé créé par le SERVEUR au paiement — 28/10/2026 (-2, 6.8.0, données 20261028-2, branche bons-cadeaux-tva, NON déployé, SQL NON appliqué)
- Corrige C1 (bons en ligne sans ticket), C2 (cartes d'abonnement en ligne sans ticket), M7 (acomptes / retenues / empreintes ticketés seulement à l'ouverture de l'app ; C&C payé jamais remis hors caisse), M5 (capture partielle : montant prélevé), C3 (lx-cloture-auto). Règles et sources : registre NF525, intervention du 28/10/2026 (-2).
- SQL `docs/migrations_1028/recettes_en_ligne.sql` : `lx_prive.recette_tk_inserer` INSÈRE dans `tickets` (chaîne existante : `ticket_nf525_insert` n° + hash, `tickets_block_post_cloture`, `nf525_marquer_mode`, sceau, signature nf525-sign) ET recopie dans `appointments` (même id, `meta.serveur=true`) ; n° imprimé = suite (max tkNum tickets / ticket_num appointments) sous le même verrou. Déclencheurs BEFORE UPDATE `zz_trg_*_recettes` sur rdv_online / commandes_online / cartes_cadeaux / cartes_abo_clients (même transaction que le paiement ; erreur = jamais bloquante, file `recettes_en_ligne` + cron `recettes-en-ligne-rattrapage` */5). Journée close -> ticket le lendemain (`raw_data.datePaiement`). Clés : `raw_data.recetteKey` (index unique) + `acompteKey` / `retenueKey`. `lx_recette_remboursement_externe` (worker, `charge.refunded`). `lx_tk_num_imprime_max` (plancher de numérotation de l'app). Garde `a_lx_tickets_cc_doublon` (LX_CC_DEJA_EN_CAISSE). Poste nf525 « Serveur (paiements en ligne) » (JET 126). Colonnes : rdv_online.empreinte_captured_amount, commandes_online.recette_tk_num / recette_remb_tk_num, cartes_abo_clients.recette_tk_num / montant_paye / payment_intent_id.
- Interrupteur `app_config.config.recettes_en_ligne_serveur` (+ `recettes_en_ligne_serveur_depuis`) : éteint = rien n'est créé, app = ancien comportement strict. Allumé : `lxAcomptesEnLigneSync` / `lxRetenuesSync` ne créent plus rien, `lxRecettesServeurImport` reprend les copies (60 s, avant la Z, focus) ; `lxJourOuvertOuAlerte` relève `window._lxTkNumPlancher` (lu par nextTicketNum / _lxProchainTkNum) ; remise C&C déjà en caisse = `lxCcRemettreSansTicket` (stock une fois, marque locale) ; worker /api/cc/action impose le n° du ticket du paiement.
- Edge functions `docs/edge_1028/` : gc-stripe-webhook v9 (mention TVA de l'e-mail selon BUU / BUM / historique / 293 B + n° du ticket), gc-create-checkout v6 (HT/TVA au taux réel ; refus tant que l'interrupteur est éteint), carte-abo-confirm-payment v7 (montant = tarif ET tarif configuré `config_json.cartes_abo`, sinon remboursement), rdv-empreinte-capture v6 et cron-empreinte-auto-capture v9 (montant prélevé), lx-cloture-auto v3 (Z depuis le JOURNAL des tickets, calculs cloturerJournee 6.8.0, cumuls de tickets ; `verify` à lire avec `{"depuis":"2026-10-14"}` : 7 Z plus anciennes comptaient les lignes non numérotées).
- Z (app ET nuit) : `cumul_mois_tickets` / `cumul_annee_tickets` enfin calculés (0 jusqu'ici). Limite connue : la Z ventile la TVA au taux de l'établissement (produit à taux propre exact sur le ticket et le FEC, pas dans la Z).
- Exports : FEC lit le journal (tickets serveur inclus d'office) ; `_lxPaiementsEnLigne` : C&C du nouveau modèle, bons et cartes (file recettes_en_ligne) en lignes « caisse » ; empreinte au montant prélevé ; `expAcomptesNonSoldes` : C&C payé non retiré (4191).
- Ordre : (0) bons_cadeaux_tva.sql conseillé -> (1) recettes_en_ligne.sql -> (2) edge functions (lx-cloture-auto verify avant/après) -> (3) worker + cocher `charge.refunded` (webhook « comptes connectés ») -> (4) pages + recharger les appareils -> (5) activer l'interrupteur (heure au registre) -> (6) bot `docs/migrations_1028/bot_recettes_en_ligne.sql` -> (7) seulement ensuite rouvrir `salons.bons_cadeaux_online_actif`.
- Bancs (non versionnés) : `/tmp/rel_pg/test.cjs` (PGlite = PostgreSQL 17 en mémoire + fonctions de scellement recopiées : 47/47), `/tmp/rel_pg/scenario_export.cjs` -> `/tmp/nrb/rel.cjs` (exports dans l'app : 16/16) et `/tmp/nrb/rel_ui.cjs` (7/7), `/tmp/rel_pg/edge_test.mjs` (28/28), `/tmp/nrb/worker_rel.mjs` (5/5), non-régression `/tmp/nrb/nr2.cjs` (V2, RS), `/tmp/audit_ind/bench.cjs`, `/tmp/nrb/bons.cjs`.
- Aide (à la main) : paiements-en-ligne #s5 #s7 #s8 + FAQ, site-et-reservation-en-ligne #s9, fidelite-et-bons-cadeaux #s10, cloture-du-jour #s4. CGV art. 12 ter. bons-cadeaux.html : « Utilisable en une ou plusieurs fois » (plus « multi-usages »).

## Recettes en ligne — corrections de l'audit (28/10/2026 -3, 6.8.1, données 20261028-3, branche bons-cadeaux-tva, NON déployé, SQL NON appliqué)
- Détail, sources, ordre de déploiement (avec verify_jwt) et retour arrière : registre NF525, intervention du 28/10/2026 (-3). La 6.8.0 n'a jamais été publiée.
- **N° imprimés** : tickets du serveur = série PROPRE 900001+ par établissement (`lx_prive.recette_serie_base()`, index unique partiel `tickets_tknum_serveur_unique`) ; copie appointments avec `ticket_num` VIDE et `meta.tkNumServeur` (relu par `lxMapApptRow`, app ET lx-cloture-auto) ; l'app exclut `a.serveur` de `nextTicketNum` / `_lxProchainTkNum` / `_lastTicketHash` / plage de la Z (`tkSrvMin/Max` à part) ; `saveAppointment` ignore les copies serveur ; refus `LX_TKNUM_SERIE_SERVEUR` (n° 900001+ par un appareil) et `LX_SERVEUR_SEUL` (ticket « serveur » forgé). Le n° légal `num` reste unique / continu.
- **Version minimale** : `saveTicketToDb` pose `raw_data.lxVersion` (= LX_VERSION) ; garde `a_lx_tickets_a_version` (interrupteur allumé) : `LX_APP_OBSOLETE` si < `app_config.config.recettes_en_ligne_version_min` (défaut 6.8.1) -> ticket gardé en file de secours, `lxAppObsolete()` affiche « Mettez l'application à jour ».
- **Appels de confiance** : `lx_prive.appel_serveur()` (auth.role() ∉ anon/authenticated). Déclencheurs créateurs de tickets : serveur seulement (sauf retenue_at posée par l'app sur un acompte déjà payé). Gardes `a0_lx_garde_paiements` (rdv_online, commandes_online, cartes_cadeaux, cartes_abo_clients) : colonnes de paiement remises à l'origine pour l'app / le site (signalé `sql:garde_paiements`). Refund valide = `re_…`/`pyr_…` (`lx_prive.refund_valide`) ; cumul négatif plafonné (LX_REFUS -> statut `ignore`).
- **Cartes d'abonnement** : `lx_prive.carte_abo_config` ; insertion « pending_payment » par le site = valeurs RECOPIÉES de `config_json.cartes_abo` (id/nom/tarif/duree/remiseServices/remiseForfaits), carte inconnue -> `LX_CARTE_INCONNUE` ; worker connect-payment type carte_abo = tarif enregistré ; carte-abo-confirm-payment v8 (`lxCarteConfiguree`, `lxValeursCarte`, refus + remboursement si inconnue). Carte remboursée en totalité -> `cancelled`.
- **Remboursements Stripe** : `lx_recette_remboursement_externe(p_pi, p_refund_id, p_cents, p_at, p_meta)` (5 arguments ; le worker passe `rf.metadata`) : C&C = clé partagée `cc_annul:<commande>` ; RDV par métadonnée ou payment_intent (acompte, acompte conservé, empreinte, avance ancien modèle) ; bons / cartes ; inconnu -> alerte critique. Commande remboursée (`recette_remb_tk_num`) non remettable (worker + app).
- **Rattrapage** : `lx_prive.recettes_filet()` (sans date de départ pour acompte / retenue / empreinte / remboursements / C&C non remis ; avec date pour bons / cartes), `lx_prive.recette_rattraper_un(id)`, procédure `lx_prive.recettes_rattrapage_job()` (cron « call », COMMIT par évènement ; pg_cron 1.6.4 en mode libpq), `lx_prive.recettes_rattrapage()` (une transaction, essais). Retour arrière : `lx_prive.recettes_desactiver(motif)`. Clé d'acompte conservé alignée sur l'app (`acompte:<rdv>`). Dates Stripe : `cartes_cadeaux.paye_at`, `cartes_abo_clients.paye_at`, acompte / C&C rejoués par le webhook (`opts.payeSec`).
- **Z** : `lx_prive.clotures_controle_journal` + verrou `pg_advisory_xact_lock(hashtext(salon_id))` (définition prod + 1 ligne). `lx-cloture-auto` v3.1 : `verify` explique les écarts d'empreinte dus au « dernier hash » de la chaîne locale (jamais un écart de montant).
- **M6** : garde `a_lx_appointments_cc_doublon` + `_lxCcDoublonEcarter` (app) ; `LX_CC_DEJA_EN_CAISSE` = erreur permanente de la file de secours.
- **QR des e-mails** : worker `GET /api/qr?d=<code>&s=<px>` (GIF, `import lxQrcode from "../lx-qrcode.js"`, regroupé par wrangler) ; gc-stripe-webhook v10 l'utilise. Bancs worker : `node /tmp/nrb/build_w.mjs` regroupe le worker dans /tmp/w.mjs avant `node --check` / les essais.
- **CGV 12 ter** : remise au texte d'avant la branche ; nouveau texte dans le registre, à publier APRÈS l'activation (étape 7).
- **Empreinte capturée (absence) = taxable** : CE 9/10/2024 n° 472257 (tables) ; CJUE C-250/14, C-295/17, C-43/19 (détail au registre).
- Bancs : `/tmp/rel_pg/test.cjs` (48/48), `/tmp/audit_lot12/cases_lot13.cjs` (49/49, cas A–J + nouveaux), `/tmp/pgreal/concurrence.cjs` (PostgreSQL 17 réel multi-connexions, 11/11), `/tmp/rel_pg/edge_test.mjs` (34/34), `/tmp/nrb/worker_rel.mjs` (10/10), `/tmp/nrb/rel.cjs` (19/19), `/tmp/nrb/nr2.cjs` × 4 interrupteurs (`node /tmp/nrb/resume13.cjs resultat_V_rsR.json`), `/tmp/nrpdf/nr13.cjs`.

## Recettes en ligne — corrections du contre-audit « NO GO » (28/10/2026 -4, 6.8.2, données 20261028-4, branche bons-cadeaux-tva, NON déployé, SQL NON appliqué)
- Détail, analyse BOI, ordre de déploiement PAS À PAS (remplace celui de -3), requête de contrôle des versions et retour arrière : registre NF525, intervention du 28/10/2026 (-4). Justification « version mineure » pour le dossier d'attestation : `docs/dossier-attestation-version-mineure-6.8.2.md`. 6.8.0 et 6.8.1 jamais publiées.
- **Ticket encaissé jamais abandonné** : refus « journée déjà clôturée » -> `_lxTicketReporter` (luxyra-supabase.js) enregistre la même vente sur la journée OUVERTE (`raw_data.reportJourClos / dateVente / heureVente / dateEnregistrement`, mention dans notes, même id / n° imprimé, unicité raw_data.id) ; journée du jour close aussi -> reste en file. `_walResync` : la règle « refus définitif » ne s'applique plus aux tickets (rendez-vous seulement). `lxWalForcerCloture` : WAL_CONSIGNE + `horsZJusqua` (gardé en file, ne bloque plus la Z de ce jour). Rendez-vous : `meta.dateJournal` -> `_lxZDoneAP` compte la vente le jour de son enregistrement. Audit `TICKET_REPORTE_JOUR_CLOS`.
- **lx-cloture-auto v3.2** : pas de Z si un rendez-vous encaissé du jour (status done + n°, hors `meta.serveur`) n'a pas son ticket au journal (recherche par raw_data.id toutes dates) -> alerte critique `report_server_error` (source lx-cloture-auto) + audit `CLOTURE_Z_REPORTEE` ; journées postérieures à la dernière Z avec rendez-vous encaissés mais sans ticket : signalées ; jamais de Z à zéro.
- **Version minimale** : défaut 6.8.2 ; activation avec `recettes_en_ligne_version_min = '0'`, relevé à '6.8.2' quand la requête de contrôle (registre) donne 0 poste à mettre à jour.
- **SQL** : garde de tête = md5(pg_get_functiondef) COMPLET de 7 fonctions (valeurs relevées en prod le 28/10) ; `lx_prive.remb_ajout_tk_seul` / `remb_tk_justifies` (ajout de « tk » accepté si ticket « rembacompte:… » au journal) ; carte d'abonnement existante upsertée : colonnes de paiement reprises sans alerte ; `recettes_desactiver` : n'écarte que acompte / acompte_remb / retenue / empreinte (`rendus_application`), le reste est `gardes_serveur` et reste traité ; rattrapage : filet seulement si allumé, file toujours traitée ; annulation C&C déjà en caisse traitée interrupteur éteint ; **bail daté** `lx_prive.recettes_bail` (`recettes_bail_prendre / _prolonger / _rendre`) au lieu du verrou de session — `call lx_prive.recettes_rattrapage_job();` SEUL dans l'éditeur, sinon `select lx_prive.recettes_rattrapage();`.
- **App** : `_lxCartesAboIds()` (id garanti à la création / au chargement des cartes configurées). Prod 28/10 : 0 carte configurée.
- **Bancs** (non versionnés) : schéma de test enrichi des déclencheurs de PRODUCTION (`/tmp/rel_pg/prod_defs/*.sql`, md5 identiques, `/tmp/pgreal/md5chk.cjs` 14/14 ; rendez-vous de départ créés par le serveur : `/tmp/rel_pg/seed_helper.cjs`) ; `/tmp/contre_audit/adverse_lot14.cjs` 26/26 ; `/tmp/pgreal/ca_lock_lot14.cjs` 15/15 ; `/tmp/pgreal/concurrence_lot14.cjs` 11/11 ; `/tmp/rel_pg/test.cjs` 48/48 ; `/tmp/audit_lot12/cases_lot14.cjs` 50/50 ; `/tmp/rel_pg/edge_test.mjs` 42/42 (`node /tmp/rel_pg/build.mjs && node /tmp/rel_pg/build2.mjs` avant) ; `/tmp/rep14/report_lot14.cjs` 17/17 ; `/tmp/nrb/z_report_lot14.cjs` 4/4 ; nr2 × 4 interrupteurs identiques (old = 0919e8f dans /tmp/nrb/old) ; rel 19/19, rel_ui 7/7, bons identiques, worker 10/10 + 50/50, nr13 identique.

## Recettes en ligne / clôtures — corrections du contre-audit final (28/10/2026 -5, 6.8.3, données 20261028-5, branche bons-cadeaux-tva, NON déployé, SQL NON appliqué)
- Détail, sources (exigibilité CGI 269-2-c / 269-2-a ; régularisation BOI-TVA-DECLA-20-20-20-10 § 240-250), ordre de déploiement FINAL pas à pas, retour arrière : registre NF525, intervention du 28/10/2026 (-5). Dossier : `docs/dossier-attestation-version-mineure-6.8.3.md`. 6.8.0 à 6.8.2 jamais publiées. `docs/migrations_1027/bons_cadeaux_tva.sql` = PRÉREQUIS OBLIGATOIRE du SQL des recettes en ligne (garde md5 de cloturer_mois) et ne peut plus être rejoué après.
- **Journée retenue** = sans Z, avec tickets au journal OU rendez-vous encaissés (done + n°, hors `meta.serveur`) dont le ticket manque au journal (par `raw_data.id`, toutes dates), hors ventes consignées par un forçage : `lx_prive.journees_non_closes(salon, du, au)`, `lx_prive.z_rdv_hors_journal(salon, jour, hors_forces)`.
- **Base** : `clotures_controle_journal` refuse `LX_Z_JOURNEE_ANTERIEURE_OUVERTE` (60 j) et `LX_Z_VENTES_NON_TRANSMISES` ; `cloturer_mois` / `cloturer_annee` / `cloturer_exercice` : refus tracés (`CLOTURE_*_REPORTEE`, alerte `sql:clotures`), mois / année en cours refusés ; `run_cloture_*_pour_tous` : toutes les périodes terminées, dans l'ordre, arrêt au premier refus ; crons mensuel / annuel QUOTIDIENS (3 h 15 / 3 h 30). Forçage `lx_z_forcer` (2 contrôles `lx_z_controle_ventes` en 2 h + compte rendu de renvoi + motif ≥ 15 car.) -> `clotures_forcages` (inaltérable), `CLOTURE_Z_FORCEE`, JET 900. Alertes de l'établissement `lx_caisse_alertes`. Retour arrière dédié : `docs/migrations_1028/retour_arriere_clotures_1028-5.sql`.
- **lx-cloture-auto v3.3** : toute date sans Z des 60 derniers jours ; arrêt à la première journée retenue (jamais J+1 avant J : ordre des Z et cumuls) ; alerte chaque nuit ; forçages pris en compte.
- **Vente reportée** : date réelle SCELLÉE dans `items[0].lxRep` `{v:1,type,dateVente,heureVente,dateEnr}` (app `_lxTicketReporter` ; serveur `recette_tk_inserer` pour un règlement d'un jour antérieur) ; garde `a_lx_tickets_report_scelle` (LX_REPORT_NON_SCELLE). Meta `heureVente`, `dateEnregistrement`.
- **Exports** : date du JOURNAL partout (`_lxDJ(a)` = dateJournal || date) ; ventes reportées signalées (`_lxVenteReelle`, `_lxVentesReportees(mois)`, `expVentesReportees`, `_lxVentesReporteesSignaler(du,au,quoi)`, `LX_REPORT_NOTE`) : rapport « 5 ter », Excel « 10 — Ventes reportées », ZIP `11_ventes_reportees_*`, pieds CSV, e-mail comptable (worker `lxEcVentesReportees`), FEC PieceDate = date réelle + libellé ; rien d'ajouté sans vente reportée.
- **App** : contrôle serveur avant la Z (`_lxZVentesAvantCloture` : contrôle, renvoi `lxWalRejouer`, 2e contrôle), fenêtre `_lxZVentesModal`, forçage admin (`requireAdmin`), carte accueil `_lxCaisseAlertesCarte` (prioritaire). `lxRecettesServeurReprise()` : copies serveur reprises aussi interrupteur éteint après une activation (`recettes_en_ligne_serveur_depuis`).
- **Remboursement Stripe avant la 1re activation** (`lx_recette_remboursement_externe`) : aucun ticket ; file `statut='attente_activation'` ticketée à l'activation (filet) ; carte « ne le saisissez pas ». Après une activation : ticket serveur immédiat.
- Seuil serveur par défaut 6.8.3 (activation à « 0 », relevé à « 6.8.3 » ; requête de contrôle avec `array[6,8,3]`).
- **Bancs** (non versionnés) : `/tmp/lot15/sql_lot15.cjs` 43/43, `edge_lot15.mjs` 10/10, `app_lot15.cjs` 22/22, `worker_lot15.mjs` 5/5, `rb_test.cjs`, `/tmp/pgreal/rb_md5.cjs` 7/7, `/tmp/pgreal/md5_nouveaux.cjs` (recalcule les md5 « ce fichier » de la garde, `--ecrire`), `/tmp/pgreal/md5chk.cjs` 21/21 ; copies adaptées `adverse_lot15`, `cases_lot15`, `concurrence_lot15`, `z_report_lot15` ; contre-audit `/tmp/contre_audit2/ca2_cloture.mjs` 0/4 constaté, `ca2_sql.cjs` A non constaté. Schéma de test enrichi : `/tmp/rel_pg/schema_mock.sql` (+ clôtures périodiques de prod, cloturer_mois bons, 3 crons ; sauvegarde `.bak_lot15`), `/tmp/rel_pg/prod_defs/09_clotures_periodiques.sql`, stub mémoire `gte`.

## Clôtures — corrections du contre-audit 3 (28/10/2026 -6, 6.8.4, données 20261028-6, branche bons-cadeaux-tva, NON déployé, SQL NON appliqué)
- Détail, relevés en base, justification du critère, ORDRE DE DÉPLOIEMENT FINAL (remplace -5), sortie administrateur : registre NF525, intervention du 28/10/2026 (-6). Dossier : `docs/dossier-attestation-version-mineure-6.8.4.md`. 6.8.0 à 6.8.3 jamais publiées.
- **Vente encaissée (journées retenues) = rendez-vous SCELLÉ** (`coalesce(a.hash,'') <> ''`) dans `lx_prive.z_rdv_hors_journal`, `lx_prive.journees_non_closes` et `rdvEncaisse` (lx-cloture-auto v3.4). Raison : 1 370 rendez-vous importés de LS Coiffure (Excellence, 26/06/2025-09/05/2026, done + n°, SANS empreinte, sans ticket ni Z) bloquaient à vie la clôture annuelle 2026 et l'exercice au 31/03/2027. Ne PAS utiliser le commentaire « Import LS » comme critère (modifiable par l'établissement) ; l'empreinte est inaltérable et posée par `chainTicket` avant tout enregistrement. Contrôle de déploiement : 0 rendez-vous done + n° sans empreinte hors import.
- **Sortie administrateur** `public.lx_z_forcer_admin(salon, date, motif, operateur)` (is_admin() ou serveur, sans fenêtre de 60 j, `clotures_forcages.admin = true`, `CLOTURE_Z_FORCEE_ADMIN`, JET 900, alerte) ; Z d'une date précise : lx-cloture-auto `{"mode":"run","salon_id","date"}` (refusée si une Z postérieure existe). `lx_caisse_alertes.journees_retenues_anciennes` (61-400 j) -> carte « Caisse ».
- **`lx_z_forcer`** : propriétaire seulement, 2 contrôles espacés de ≥ 5 min (`LX_FORCAGE_DELAI`, `possible_a`), hors ventes déjà consignées ; app : contrôle refait au forçage, heure affichée. Le serveur ne vérifie pas le PIN (limite documentée).
- **`LX_REPORT_NON_SCELLE`** : lxRep 1re ligne seulement ; vente reportée = type « vente », journée de vente avec Z, ni future ni avant la 1re activité, date d'enregistrement = jour ± 1, heure HH:MM[:SS] ou absente.
- Seuil serveur par défaut 6.8.4 (activation « 0 », relevé « 6.8.4 », requête `array[6,8,4]`). Garde md5 de tête inchangée (fonctions protégées non modifiées).
- **Bancs** (non versionnés) : tout en une commande `sh /tmp/lot16/tout.sh` (résultats `/tmp/lot16/runall/_status.txt` + logs) ; nouveaux `/tmp/lot16/ca3_lot16.cjs`, `sql_lot16.cjs`, `edge_lot16.mjs`, `app_lot16.cjs` ; copies 6.8.4 `/tmp/audit_lot12/cases_lot16.cjs`, `/tmp/pgreal/concurrence_lot16.cjs`, `/tmp/nrb/z_report_lot16.cjs` ; contre-audit 3 `/tmp/contre_audit3/` (`ca3_sql*.cjs`, `nr3.cjs` prod vs branche : `old` = prod, `new` = copie de la branche à resynchroniser par `rsync -a --delete --exclude .git wt-bons/ /tmp/contre_audit3/new/`, idem `/tmp/nrb/new`).

## 2026-10-28 — MISE EN SERVICE recettes en ligne 6.8.4 + bons v2 (registre : « 2026-10-28 (-6) — MISE EN SERVICE »)
- Activation le 28/10/2026 à 05:23:18 UTC (06:23:18 Paris) : `recettes_en_ligne_serveur` = true, `_depuis` = 2026-10-28T05:23:18Z, `recettes_en_ligne_version_min` = '0', `bons_tva_v2` = true. Bot (2 SQL de docs/migrations_1028) appliqué ; CGV 12 ter publié.
- FAIT 29/10/2026 ~21 h 20 : « charge.refunded » (et « payout.paid ») cochés par Alexandre (webhook « comptes connectés » we_1UOh66Pk42Psx94T72zzMLeL, 6 évènements) ; bot (`docs/migrations_1029_lot4b/bot_stripe_actif.sql`) et CGV 12 ter mis à jour. Reste EN ATTENTE : seuil '6.8.4' quand tous les postes sont en 6.8.4 ; vente en ligne de bons fermée chez tous (étape 10, décision d'Alexandre).
- Contrôle du bail : `select count(*) from lx_prive.recettes_bail where expire_at > now()` = 0 (une ligne expirée reste après le 1er passage). Erreurs serveur : `public.server_errors.reported_at`.

## TVA : une seule règle dans tous les documents — 28/10/2026 (lot 3 de l'audit, 6.8.5, données 20261028-7, branche lot3-tva-arrondis, NON déployé, SQL NON appliqué)
- Détail, sources, frontière, ordre de déploiement pas à pas et retour arrière : registre NF525, intervention -7 du 28/10/2026. Dossier : `docs/dossier-attestation-version-mineure-6.8.5.md`.
- **Règle** : HT / TVA d'une période = SOMME, PAR TAUX, des montants ENREGISTRÉS sur chaque ticket (HT d'un taux = TTC / (1 + taux) arrondi au centime, calcul exact `_lxHtDe` ; TVA = TTC − HT). Partout : Z (app ET lx-cloture-auto), clôtures mensuelle / annuelle / exercice, rapport (données / HTML / PDF), Excel, ZIP, FEC, journal des ventes, EBP / Quadratus, e-mail au comptable, accueil, compta, statistiques, archive annuelle, bande mensuelle. Une ligne de TVA par taux sur le ticket imprimé et le duplicata.
- **Module unique (app.html, après `_splitPrestProdHisto` / `_lxHtTvaHisto` = anciennes règles conservées pour référence)** : `lxTvaCalculer(a, {s,p})`, `lxTvaFiger(tk)` (ventilation figée à l'encaissement → `raw_data.lxTva` + `appointments.meta.lxTva`, reprise par `saveTicketToDb`), `lxTvaTk(a)` (journal lu en base `LX_TVA_J` / `_lxZJournalJour` → ventilation mémorisée → calcul au taux de la Z de la journée), `_lxTvaDepuisScelle` (ticket ancien : taux enregistré + ajustement au centime sur le HT scellé, écart sur les prestations), `lxTvaSomme(liste, ps)`, `lxTvaLignesRecap`, `lxTvaCollabs` (répartition indicative), `lxTvaRapprochementZ(mois, A)` + `LX_TVA_NOTE_ECART`, `lxTvaDeLigne(ligneTicket)` (FEC / EBP / Quadratus), `lxTvaJournalCharger(du, au)` / `lxTvaJournalMois(mois)` (À APPELER avant tout export d'un mois ; chargement de 400 jours au démarrage). `_splitPrestProd` / `_lxHtTva` délèguent à `lxTvaTk`. Toute NOUVELLE fonction qui affiche un HT ou une TVA doit passer par `lxTvaTk` / `lxTvaSomme`, jamais `ttc/(1+taux)` sur un total.
- **Correctifs du contre-audit (NO GO, 28/10/2026 au soir)** — **`raw_data` d'un ticket est FIGÉ** dès l'enregistrement (déclencheur `a_lx_tickets_raw_data_fige`, `LX_TICKET_DONNEES_FIGEES` ; seul contournement `luxyra.allow_nf525_unlock`, tracé `NF525_INALTERABILITE_BYPASSEE`) : la RLS `tickets_tenant_update` le laissait modifiable par le propriétaire et le sceau `_nf525_seal_row` ne le couvre PAS. Ne jamais écrire de code qui fait un UPDATE de `tickets.raw_data` (annulation = status / cancelled_at / cancel_reason ; verrouillage = locked / cloture_id ; fusion = client_id). **Ventilation mémorisée jamais crue** : `_lxTvaValide(L, {ttc, ht, items, bons, tx, prod})` (app = lx-cloture-auto à l'identique ; SQL `tva_ticket_lignes`) — taux / natures autorisés par les lignes scellées, HT de chaque ligne = `_lxHtDe` (±0,01 sur une seule ligne), TVA = TTC − HT, hors CA recalculé depuis les lignes BUM, totaux TTC / HT scellés ; sinon recalcul. `appointments.meta.lxTva` (non protégé par la base) : même revalidation (`lxTvaTk`, `lxTvaFiger`). `tva_periode(salon, du, au, mode)` filtre le mode de caisse comme la Z. Bancs : `/tmp/lot3c/` (`adv_sql_suite.cjs`, `parite.cjs` SQL = app, `advjs/adv_js_suite.cjs`, copies des cas de l'auditeur `adv_sql_auditeur.cjs` / `advjs/adv_js.cjs`).
- **Z** : `_lxZTva(done, jour)` ; clés hors empreinte `tvaRegle = "tickets-v1"` (frontière), `tvaParTaux`, `tvaSource` ; `_lxZTvaLignes(c)` pour l'affichage (Z ancienne : lignes d'origine ; taux déduit des montants si absent, `_mapClotureRow`). Base : `b_nf525_z_controle_tva` refuse `LX_Z_ECART_TVA` (traité comme `LX_Z_ECART_JOURNAL` par saveCloture).
- **SQL** `docs/migrations_1028_tva/tva_unique.sql` : `lx_prive.tva_ticket_lignes` (+ `tva_num`, `tva_vrai`, `tva_item_montant`), `lx_prive.tickets_raw_data_fige` (déclencheur `a_lx_tickets_raw_data_fige`), `lx_prive.tva_periode(…, mode)`, `lx_prive.clotures_controle_tva`, `public.lx_tva_periode_controle`, `cloturer_mois` / `cloturer_annee` / `cloturer_exercice` (prod + bloc `LX_TVA_UNIQUE_2026_10_28` ; `raw_data.tva` : par_taux, ht_z / ecart_ht_z). Garde md5 (prod 28/10 : 10fb2481… / 76636cd2… / 9c305044… ; ce fichier : 4a33de47… / 9111b2ae… / daada01d…) ; retour `tva_unique_retour_arriere.sql`. Rend NON rejouables les SQL antérieurs qui gardent l'ancienne empreinte de cloturer_mois (recettes_en_ligne.sql).
- **lx-cloture-auto v3.5** (`docs/edge_1028_tva/`) : module TVA recopié À L'IDENTIQUE (vérifier l'égalité octet par octet des fonctions communes après toute modification de l'app : `node /tmp/lot3c/cmpfn.cjs`, seules `lxTvaTk`, `lxTauxTvaAu`, `_lxPayBuckets`, `_splitPrestProdHisto` diffèrent volontairement) ; `verify` : chaque Z avec SA règle.
- **Worker** : `lxEcTvaMois` → `lx_tva_periode_controle` ; e-mail : HT / TVA par taux des tickets + ligne d'écart des Z anciennes ; repli : chiffres de la clôture mensuelle.
- Écarts historiques : jamais d'écriture d'écart (FEC = pièces) ; rapprochement affiché (rapport, récap, Excel, ZIP, e-mail). Prod 28/10 : 56 Z sur 138 à ±0,02 € ; juillet TVA Z 994,32 / tickets 994,23.
- Bancs (non versionnés) : `/tmp/lot3/` — `md5_lot3.cjs` (13/13), `sql_lot3.cjs` (25/25), `edge_lot3.mjs` (8/8), `edge_lot16_v35.mjs`, `edge_cross.mjs` (app = nuit), `bench_lot3.cjs <racine> mono|dual|franchise 0|1` (cohérence au centime de tous les documents + changement de taux), `e2e_pg.cjs` (tickets et Z de l'app → PostgreSQL : contrôle, ZM, e-mail), tout : `sh /tmp/lot3/tout_lot3.sh` (copies `__l3` des anciens bancs).

## Protections après enregistrement — 28/10/2026 (-8, lot 4 de l'audit, 6.8.6, données 20261028-9 depuis la révision du 29/10, lx-cloture-auto v3.6, branche lot4-protections, SQL APPLIQUÉ et lx-cloture-auto v3.6 DÉPLOYÉE le 29/10/2026 ; étapes 3 à 7 à faire)
- **29/10/2026 06 h 34-06 h 43 (Paris)** : étapes (0) (1) (2) du registre faites (migrations `lot4_protections_20261029` et `lot4_reserve4_factures_clients_revoke_truncate`, lx-cloture-auto v3.6 = version 6 de la plateforme, verify identique à v3.5, simulate vide) ; étape (3) annotations : EN ATTENTE de l'accord d'Alexandre ; (4)(5) worker + pages 6.8.6 en ligne (contrôle 06 h 46 : `attendu="20261028-9"`, `LX_VERSION="6.8.6"`) ; `payout.paid` et `charge.refunded` COCHÉS le 29/10/2026 vers 21 h 20 (Alexandre ; bot mis à jour : `docs/migrations_1029_lot4b/bot_stripe_actif.sql`) ; (6) bot appliqué (`bot_lot4.sql` revu : versements Stripe « pas encore actif », annotations « pas encore faites », RCS / capital pour facturer ; lx-bot-eval 11 questions OK après corrections) ; (7) essai : à faire. Annotations faites (29/10 ~21 h 10) et évènements Stripe cochés (29/10 ~21 h 20) : `protections_lot4_1028`, `recettes_en_ligne_1028`, `bons_cadeaux_en_ligne_1028` mis à jour (bot_stripe_actif.sql). Détail : registre NF525, fin de l'intervention -8.
- Détail, relevés de production, sources, ordre de déploiement pas à pas, retour arrière, essais : registre NF525, intervention -8 du 28/10/2026. Dossier : `docs/dossier-attestation-version-mineure-6.8.6.md`.
- **Tickets (M4)** : `lx_prive.tickets_colonnes_figees` (déclencheur `a_lx_tickets_colonnes_figees`, tous rôles) : TOUTE colonne figée après l'enregistrement, sauf `locked` (false -> true, seulement si une Z de la journée existe), `cloture_id` (vide -> Z de CETTE journée / CET établissement, une fois), `updated_at`, et `cancelled_at` / `cancel_reason` posés UNE fois par `creer_ticket_avoir` (réglage `lx.annulation_ticket` + contre-ticket créé dans la transaction). Erreur `LX_TICKET_COLONNES_FIGEES`. **Le statut d'un ticket ne change JAMAIS** : annulation = contre-ticket (l'application le fait depuis le 09/07/2026 ; `cancelTicketDb` retirée, `saveTicketToDb` envoie toujours « paid »). À l'insertion : `a_lx_tickets_0_statut` normalise « cancelled » -> « paid » (trace `TICKET_ENREGISTRE_NORMALISE`) et refuse is_avoir / parent / locked venant d'un appareil. `creer_ticket_avoir` (serveur, inutilisée par l'app) : origine reste « paid », contre-ticket numéroté par la base, lignes / règlements négatifs, raw_data isCancel / cancelRef / contraSameDay. Ne JAMAIS écrire de code qui modifie un ticket existant hors verrouillage par la clôture.
- **Bons cadeaux (M10)** : garde `a1_lx_cartes_cadeaux_garde_fiscale` (valeur, code, périmètre, qualification, HT / TVA, gc_num, pay_method, tk_num une fois, date d'expiration : prolongation seulement — valeurs d'origine REMISES + `garde_signaler`, jamais d'erreur bloquante pour l'upsert de l'app) ; utilisé / solde / statut / historique : seulement utilisation tracée (une entrée d'historique du même montant : `consommer_bon_cadeau` / `recrediter_bon_cadeau`), annulation (`voided` + solde 0) ou serveur ; suppression interdite `LX_BON_SUPPRESSION_INTERDITE` (sauf déverrouillage tracé, bon en ligne jamais payé supprimé par le serveur). Journal SCELLÉ `public.cartes_cadeaux_mouvements` (chaîne SHA-256 « BM|seq|bon|code|nature|avant|apres|ticket|at|prev », sans donnée personnelle, inaltérable). État fiscal dérivé des tickets : `public.lx_bons_etat(salon, date)` ; app : `lxBonsEtatCharger()` (au démarrage, dans `lxTvaJournalMois`, FEC / EBP / Quadratus) -> `lxBumExpires` / `lxBumEncours` utilisent vente − utilisations des tickets (repli : liste GC). Ligne de vente d'un bon : `bonExp` (date d'expiration scellée) ; n° du ticket de vente posé sur le bon (aGi, doCreateBon via `_lxEffetsReleve`). UI : périmètre non modifiable, expiration prolongée seulement.
- **Devis (M9)** : `lxDevisConditions(validiteJours, totalTTC)` (3 modèles : A4, ticket, e-mail) : tirées de SITE_CONFIG (modeCaution, acompteMontant / Type / Min / Seuil, politiqueAnnul, remboursementAnnul, rembPartielPct), vocabulaire « arrhes » (C. consom. L214-1, C. civ. 1590). Ne plus jamais figer « 30 % / 48 h / perte de l'acompte ».
- **Z (M6 / mineurs)** : arrondi au centime à l'écriture (`saveCloture` : `Number(x.toFixed(2))` = valeur de l'empreinte ; base : `a0_lx_clotures_arrondi`, `zz_lx_clotures_arrondi_cumul`, bruit < 0,000001 seulement) ; cumuls de tickets corrigés des annotations (`_zDeltaTk`, marque `lxAnnotTk`, base `b_nf525_z_cumul_tickets`) ; lx-cloture-auto v3.6 (`docs/edge_1028_lot4/`) : TOUS les statuts d'abonnement (raw_data.statutAbonnement), montants arrondis. Annotations signées des 7 Z historiques (n° 25, 48, 82, 87, 88, 89, 117 d'Excellence : +1 ticket chacune, ligne 0 € non numérotée) : `docs/migrations_1028_lot4/annotations_nb_tickets_historiques.sql` (étape 3, irréversible par construction).
- **Rapport** : `_lxNbTk` (tickets numérotés) ; `nbTicketsJournal` (= FEC) affiché quand il diffère. **FEC** : ticket « cancelled » = vente (plus d'« annulation seule ») ; caisse de test : `…_TEST.txt` + JournalLib « - MODE TEST SANS VALEUR FISCALE ».
- **Stripe** : worker `handleWebhookConnect` -> `payout.paid` -> `lxStripeVersementEnregistrer` (relit le payout et `balance_transactions?payout=` au nom du compte) -> `stripe_versements` / `stripe_versements_lignes` (worker seul). Exports : FEC journal BQ (512 net D / 627800 frais D / 580100 C), EBP, Quadratus, bordereau (frais réels). Comptes « banque » / « fraisStripe » dans Conformité caisse. `payout.paid` coché le 29/10/2026 ~21 h 20 (seuls les versements reçus ensuite sont relevés : aucune reprise des antérieurs). Remboursement fait dans Stripe (`charge.refunded`) : ticket négatif ; bon cadeau en ligne annulé SEULEMENT si remboursé en totalité ET jamais utilisé ; RDV / commande non modifiés.
- **Factures clients** : `public.lx_facture_emettre(ticket, client jsonb, operateur)` (seule voie d'insertion ; politique d'insertion directe supprimée) : recopie du ticket scellé, ventilation `tva_ticket_lignes`, mentions (acquittée, pas une nouvelle recette, 293 B, escompte / pénalités pro, catégorie, rectifie), n° continu F- / A- (série TEST- 900001+ en caisse de test), empreinte « FC|… » chaînée, une facture par ticket. App : « 🧾 Facture » / « 🧾 Facture d'avoir » (Gestion des tickets), `lxFactureHtml`, `lxFactureCII` (XML CII EN 16931, Factur-X sans PDF/A-3 : produit par la plateforme agréée), export « Registre des factures clients (CSV) ».
- **Révision du 29/10/2026 (contre-audit NO GO → corrigé, commit b65be0b)** : **JAMAIS de facture en caisse de TEST** (`LX_FACTURE_TEST` dans `lx_facture_emettre` + déclencheur `a_lx_factures_clients_pas_de_test`, tous rôles ; `factures_clients.ticket_id` sans cascade bloquait reset d'essai / passage en réel) ; `generer_facture_client` (prod, cassée : operator_id uuid ← collaborateur_id integer) remplacée par un refus. App : `lxFactureBouton(apId, avoir)` (grisé + `lxFactureTestInfo` si `LX_MODE_CAISSE==="test"`). Lignes de facture calculées par la base (`factures_clients.lignes`, `lx_prive.facture_lignes` : remise globale = ligne « Remise » négative par taux) ; `_lxFactureLignes` lit `f.lignes`. Refus : `LX_FACTURE_VENDEUR_TVA` (hors franchise sans n° TVA), `LX_FACTURE_VENDEUR` (adresse), `LX_FACTURE_VENDEUR_RCS` (société sans `salons.rcs_ville` / `capital_social`, `lx_prive.forme_societe`), `LX_FACTURE_AVOIR_SANS_ORIGINE`, `LX_FACTURE_AVOIR_VENTILATION`, `LX_FACTURE_BON_MULTIPLE` (vente de BUM jamais facturée : hors champ, art. 256 ter). Avoir = client de la facture d'origine. Colonnes facture : `salon_rue/cp/ville/pays`, `salon_rcs`, `salon_capital`, `mentions.vendeur`, `mentions.origine_numero`. RCS / capital : Paramètres › Infos établissement (« Mentions légales de la société », `SALON_CONFIG.rcsVille` / `capitalSocial`, écrits avec l'identité par `saveSalonInfo`), imprimés sur facture et devis (`lxMentionsSociete`, `lxEstSociete`). XML `lxFactureCII` : remises de pied BG-20 par taux, quantité −1 si ligne négative, E à 0 % + VATEX-FR-FRANCHISE, jamais O ; `lxFactureControleEN` avertit (franchise sans n° TVA : BR-E-02/03). Validateur : `/tmp/lot4b/valider.py` (paquet pip factur-x 7.8 : XSD + schématron Factur-X 1.09 EN16931, saxonche) — BR-CO-17 a une tolérance de 1,00. Devis : « acompte » (pas arrhes : sinon restitution au double, L214-1), annulation par l'établissement = remboursement total (ce que fait l'app). `consommer/recrediter_bon_cadeau` : montant au centime. `creer_ticket_avoir` : bonsUtil BUM en négatif + recrédit du bon. Worker : `expand[]=data.source` ; e-mail comptable + bordereau : info TVA frais Stripe (283-2 / 261 C, aucune écriture). Étape 7 du registre : plus d'essai de facture. Aide éditée à la main (le générateur `docs/generateurs/aide_guides.py` n'a PAS les textes du lot 4 : ne pas régénérer sans les reporter).
- **Libellés** : « Sous NF525 », « Les tickets restent NF525 », « protection légale NF525 », « obligation NF525 » -> « caisse conforme à la loi anti-fraude » (jamais « certifié »).
- SQL `docs/migrations_1028_lot4/` : `lot4_protections.sql` (garde md5 : creer_ticket_avoir prod cf9b3c1e… / ce fichier a4b3134a… (révision 29/10 ; b81e7974… = version du 28/10 jamais appliquée) ; remplacées aussi : consommer_bon_cadeau 5362a257… → d887fdcc…, recrediter_bon_cadeau 901a4d8b… → b785b85e…, generer_facture_client d2e41194… → 25e27c4d… ; fonctions lues 2efe40f4…, 91f7a2c1…, 9273bd3d…, 3420d7d3…, 5362a257…, 901a4d8b…, f2a2530f…, f60dd43a…, 34ecf21d…), `lot4_protections_retour_arriere.sql` (définition de prod de creer_ticket_avoir à l'octet, tables conservées), `annotations_nb_tickets_historiques.sql`, `bot_lot4.sql`.
- Bancs (non versionnés) : `/tmp/lot4/` (DISPARU le 29/10 ; remplacé par `/tmp/lot4b/` : `bench/adv_lot4_v2.cjs` 62/62, `bench/adv_fact_test_v2.cjs` 7/7, `bench/bench_fact_v2.cjs` 60/60 (+ XML validés), `app_v2.mjs` 20/20 navigateur, `nonreg.mjs` HEAD vs révision, `wt/test_worker.mjs` 5/5, `bench/bot.cjs` ; base PGlite de l'auditeur `/tmp/audit_lot4/bench/lib.cjs`) — ancien contenu : `sql_lot4.cjs` (PostgreSQL réel, `AVANT=1` : constat reproduit sur la prod), `edge_lot4.mjs`, `edge_lot16_v36.mjs`, `worker_lot4.mjs`, `app_lot4.cjs` (navigateur), `e2e_pg_l4.cjs <scénario>`, `bot_check.cjs`, `cmpfn_v36.cjs` ; définitions de prod recopiées (md5 vérifiés) `/tmp/lot4/prod/` ; tout : `sh /tmp/lot4/tout_lot4.sh` (copies `__l4` des bancs antérieurs, référence avant modification `/tmp/lot4/runall_base/`).

## Factures clients — réserves du contre-audit du lot 4 (lot 4b) — 29/10/2026 (-9, 6.8.7, données 20261029-1, branche lot4b-finitions, NON DÉPLOYÉ, SQL NON APPLIQUÉ)
- **Bon à usage unique (BUU)** : la part réglée par un BUU (ou un bon « ANCIEN », déjà encaissé à sa vente) n'est JAMAIS une « Remise » : ligne négative « Bon cadeau <code> (réglé lors de l'achat du bon, ticket n° … du …) », nature `bon`, au taux couvert (`raw_data.bonsUtil[].lignes`, repli `bonVenduRemise`) ; base HT / TVA de la facture = ticket scellé (TVA acquittée à la vente du bon : CGI 256 ter ; BOI-TVA-CHAMP-10-10-40-50 § 60 ; ne jamais la refacturer : CGI 283-3) ; mention `mentions.bons` (prix total, part du bon, montant). XML : ligne quantité −1 + note BT-127, PAS d'AllowanceCharge ni de TotalPrepaidAmount pour le bon (BT-113 = règlement du ticket). Ticket entièrement réglé par un BUU : refus `LX_FACTURE_BON_UNIQUE` (facturer le ticket de vente du bon). Avoir : lignes « bon » reprises de la facture rectifiée.
- **Lignes** (`lx_prive.facture_lignes_v2`, la v1 reste mais n'est plus appelée) : article = `pu_ttc`, `pu_ht` (4 déc.), `brut_ttc/ht`, `remise_ttc/ht` (remise de LA ligne), `ttc/ht` (net), `nature` (`article` / `bon` / `remise` / `ajustement`) ; `remise:true` seulement pour remise / ajustement (compatibilité 6.8.6). Facture : colonnes « Prix unitaire HT » (avant remise) et « Remise HT » ; XML : quantité réelle, prix brut = prix net, remise de ligne BG-27 ; remise du total = BG-20 par taux. Taux entièrement couvert par un bon : ventilation 0 ajoutée (BR-S-08). Arrondi HT résiduel : sur la ligne de bon.
- **Numérotation** : UNE suite F- / A- par établissement (art. 242 nonies A, I-7° ; BOI-TVA-DECLA-30-20-20-10 § 70-100), conservée, JAMAIS renumérotée ; expliquée : `mentions.numerotation` (repli `LX_FACTURE_NUMEROTATION` dans l'app), aide, colonne « N° d'ordre » du registre CSV.
- **Droits** : `docs/migrations_1029_lot4b/revoke_truncate.sql` retire TRUNCATE / TRIGGER / REFERENCES à anon / authenticated sur toutes les relations de public (relevé AVANT dans `lx_prive.privileges_avant_lot4b`, retour arrière exact) + privilèges par défaut de postgres. Prod au 29/10 : TRUNCATE anon 87 / authenticated 111 ; aucun usage (fonctions, cron, pg_stat_statements, dépôt). MAINTAIN aussi accordé par défaut : non traité (à décider). RÈGLE : toute nouvelle table → GRANT explicites sans TRUNCATE / TRIGGER / REFERENCES pour l'API.
- SQL `docs/migrations_1029_lot4b/` : `factures_lot4b.sql` (garde md5 : lx_facture_emettre prod b555d537… → 69d6e1e2… (après réserve 1 du contre-audit du lot 4b : franchise + bon sans TVA)), `factures_lot4b_retour_arriere.sql` (définition de prod à l'octet), `revoke_truncate.sql`, `revoke_truncate_retour_arriere.sql`, `bot_lot4b.sql`. Ordre : (1) factures_lot4b.sql (2) revoke_truncate.sql (3) pages (4) bot. Détail, md5, sources, essais : registre NF525, intervention -9 ; dossier `docs/dossier-attestation-version-mineure-6.8.7.md`. Aide éditée à la main (`aide/tickets-et-annulations.html` § s11, `aide.html` FAQ).
- Bancs (non versionnés) `/tmp/lot4c/` : `base4.cjs` (PGlite = prod après lot 4, md5 vérifiés), `bench_4b.cjs` 60/60, `bench_truncate.cjs` 23/23 (ACL de prod dans `acl_prod.txt`), `bench_fact_v2_4b.cjs` 61/61, `adv_lot4_v2_4b.cjs` 63/63, `bot_4b.cjs` 3/3, `app_4b.mjs` 7/7 (serveurs locaux 8781 = branche, 8782 = HEAD ccc9b96), `nonreg.mjs` (FEC / rapport / tickets / devis identiques), XML validés par `/tmp/lot4b/valider.py` (XSD + schématron Factur-X 1.09).
- Non corrigé, signalé : `creer_ticket_avoir` (serveur, inutilisée par l'app) inverse `price` mais pas `remise` d'une ligne remisée.

## 29/10/2026 au soir — évènements Stripe actifs (registre : « 2026-10-29 (-8 / -2, évènements Stripe) »)
- Webhook « comptes connectés » we_1UOh66Pk42Psx94T72zzMLeL : account.updated, charge.dispute.created, charge.refunded, checkout.session.async_payment_succeeded, checkout.session.completed, payout.paid. Webhook plateforme : 7 évènements, 0 échec ; account.external_account.updated non traité (ignoré). Comptes connectés : Excellence « Activé », Luxyra Démo et Delphinecoiff « Limité ».
- Pas encore vérifié en réel (aucun charge.refunded / payout.paid reçu au 29/10 20:20 UTC) : contrôler au 1er versement `stripe_versements` et `app_secrets.stripe_webhook_connect_dernier`.

## EN ATTENTE (décision d'Alexandre, 29/10/2026)
- **LOT 5 — conservation / archivage 6 ans (L102 B LPF) : MIS DE CÔTÉ.** Constat de l'audit indépendant (M8) : base Supabase en offre gratuite sans sauvegarde garantie ; seule la sauvegarde chiffrée nocturne (Google Drive, 60 jours) existe. À lancer quand Alexandre passe Supabase en Pro (dès les premiers abonnés) : archivage externe automatique et durable sur 6 ans + procédure de restauration testée. Toujours avec agent expert + contre-audit indépendant. Le rappeler à Alexandre au premier abonné payant.
- Version de l'app affichée en petit en bas de l'accueil depuis le 29/10/2026 (rHome, « Luxyra vX · données »).
- 2026-10-30 (monitoring) : (1) `check_quotas` ne signale plus « salon Pro sans Stripe Connect » pour un établissement en ESSAI (status active/past_due seulement) — c'était l'alerte « Grave : paiements Stripe » due au compte Luxyra Démo ; (2) sw.js : témoin `sw_push_recu` (trace de chaque push reçu, en warning) RETIRÉ, cache SW v24 ; (3) `pg_stat_statements_reset()` : les alertes « slow query » venaient de moyennes cumulées d'avant l'optimisation du 27/10 (mesuré : scan_pg_net_failures 2 ms, get_monitoring_status 8 ms).

## RDV sur mesure v2 — plusieurs options (30/10/2026, plan + maquettes validés ; branche rdv-sur-mesure-v2, NON DÉPLOYÉ, SQL NON APPLIQUÉ ; garde 20261030-3 après contre-audit, LX_VERSION 6.8.7 inchangée)
- Détail, essais, ORDRE DE DÉPLOIEMENT pas à pas et retour arrière : registre NF525, intervention « 2026-10-30 (-2) » (paragraphe CONTRE-AUDIT : procédure révisée = SQL → push n° 1 worker + proposal.html SEULS → edge functions → push n° 2 le reste ; retour arrière : app « avant » → edges « avant » → SQL de retour arrière).
- **Contre-audit du 30/10 (NO GO → corrigé)** : RÈGLE « jamais d'argent sans ticket » : `lx_demande_paiement_finaliser` crée RDV + ticket dans un bloc protégé ; tout échec (ou ticket ni créé ni en file `recettes_en_ligne`) → paiement « à rembourser » (code `erreur`) → worker `lxSmRembourser` (remboursement Stripe idempotent + alerte critique) ; lien inconnu / fonction absente (400-404) → remboursé aussi. `sm_creer_rdv` : clés étrangères gardées seulement si elles existent (C1). Garde `a_lx_rdv_demandes_garde` limitée aux colonnes de la proposition (C2 : suppressions / anonymisation RGPD de nouveau possibles) ; expiration ignorée pendant un paiement + 60 min (C3/k, `lx_prive.sm_paiement_en_cours`, y compris `fn_auto_expire_all`). Retour depuis Stripe : `/api/rdv-demande/liberer-paiement` (public, lien + métadonnée) expire la session et `lx_demande_paiement_effacer` ; choix / refus permis pendant un paiement (l'edge expire d'abord ; paiement tardif remboursé). Échéance passée = plus de préparation / enregistrement / choix. Heure 00:00-23:59. Arrondi acompte : centime INFÉRIEUR partout (`lx_prive.sm_centimes_inf` = `_lxSmCentimes`). Nouvelle proposition après refus / expiration (5 envois max). Offre Essentiel : « Offre Pro requise » / LX_SM_PRO. 1 option → `proposed_data` rempli (ancienne app). Liste du retour arrière : `lx_prive.sm_retour_arriere_clients`. Conception validée : outputs `rdv-sur-mesure/rdv-sur-mesure-presentation.html`.
- **Contre-audit final du 30/10 (NO GO léger → corrigé)** : worker `lxSmFinaliser` : avant tout remboursement (400/404, « introuvable » / « parametres ») → `lxSmDejaEnregistre` (rdv_online payment_intent_id + acompte_paye) : trouvé = `already_confirmed`, jamais remboursé ; lecture impossible = 503 « Paiement reçu » ; garde INSERT : colonnes de proposition / verrou (`confirm_claim_at`, `stripe_session_id`, `proposal_expires_at`, `refuse_reason`…) à NULL ; e-mail « expirée » par `trg_rdv_demandes_options_suivi` (tous chemins, une fois par envoi). `surmesure_v2.sql` md5 63451b3afab880863c681dd10819fe94. **À SURVEILLER après mise en service** : alerte critique « REMBOURSEMENT IMPOSSIBLE, à faire dans Stripe » (rembourser à la main) ; `refund.failed` NON traité (échec tardif visible seulement dans Stripe) ; clé d'idempotence des remboursements = 24 h chez Stripe (rejeu plus tardif → fausse alerte « remboursement impossible » : vérifier dans Stripe). Retour arrière (b) : proposition v2 à 1 option = ancien écran (sans acompte : confirmable ; avec acompte : « Payer » refusé, aucun débit) → enchaîner (c).
- **Modèle** : `rdv_demandes.proposal_version` (1 = ancien format, traité par le code d'origine ; 2 = options), `envoi`, `expire_heures`, `option_choisie_id`, `checkout_option_id/_session_id/_expires_at`, `vue_at`, `relance_at`, `rappel_salon_at`. `rdv_demande_options` (1-3 par envoi : date, heure, collaborateur, `items` [{type service|forfait, id, nom, prix, duree, pose, phases}], `phases`, durée / pose / prix / acompte CALCULÉS par la base, note, statut proposee|choisie|liberee|creneau_pris|remplacee). `rdv_demande_paiements` (une ligne par session Stripe payée : confirme | doublon | rembourse | remboursement_echec). Écriture : rôle service seulement.
- **Règles** : le navigateur n'envoie que des identifiants (`lx_demande_proposer` relit services / forfaits, refuse « sur devis », acompte % ou € arrondi, ≥ 1 €, ≤ total, refusé sans Stripe actif `lx_prive.sm_stripe_actif`). Créneau : `lx_prive.demande_creneau` (phases de travail seulement, comme le planning ; « pas de préférence » = un collaborateur libre sur toutes les phases ; horaires = avertissement) ; `lx_creneau_libre` (ancienne signature) l'utilise. Contrôlé à l'envoi (409 conflit, « envoyer quand même » = forcer), au choix et avant le paiement (verrou de journée `lx_rdv:<salon>:<date>` partagé avec la réservation en ligne). Après paiement : RDV créé même si le créneau vient d'être pris (règle d'origine) + notification « Double réservation possible ».
- **NF525** : acompte de l'option = chemin EXISTANT (INSERT rdv_online pending_payment puis UPDATE confirmed + acompte_paye → `zz_trg_rdv_online_recettes` → ticket serveur). Aucune fonction fiscale modifiée. Paiement en trop : pas de RDV ni ticket, remboursement automatique + alerte (puis alerte « remboursement sans paiement connu » de `lx_recette_remboursement_externe`, attendue).
- **RDV créé** : `rdv_online.salon_edit = {phases, items, source:'sur_mesure'}` → le planning de l'app affiche les vraies phases (temps de pose) ; message « RDV sur mesure (proposition #…, option X) » ; `rdv_demandes.proposed_data` = copie de l'option au format v1 à la confirmation.
- **Edge** : `rdv-demande-propose` v6 (verify_jwt TRUE ; corps `{demande_id, options, expire_heures, forcer}` ; ancien corps `proposed_data` accepté → 1 option, montants recalculés, pas d'e-mail serveur), `rdv-demande-proposal-action` v14 (verify_jwt FALSE ; v2 : get / choose / refuse par RPC ; v1 : code v13 inchangé). Sources « avant » : `docs/edge_1030_surmesure/avant/`.
- **Worker** : `connect-pay {token, option_id}` (session 31 min sur le compte du salon, session précédente expirée), `finalize` / webhook (metadata.option_id → `lx_demande_paiement_finaliser`), `/api/rdv-demande/notifier` (INTERNE x-lx-internal : e-mails proposition / confirmation / relance / expiree au gabarit `lxMailLayout(…, {salon})`, logo 128, SMS court sans e-mail, `lx_notifier_client`), `/api/rdv-demande/salon-action` (propriétaire : annuler / reproposer, expire la session en cours, refuse si le client vient de payer).
- **Échéances** : cron `rdv-sur-mesure-echeances` */15 → `lx_prive.demandes_sur_mesure_echeances()` (expire jamais pendant un paiement ; relance UNE fois 24 h avant l'échéance si ≥ 12 h après l'envoi ; rappel au salon UNE fois après 24 h sans réponse) ; e-mails via `lx_prive.sm_notifier_worker` (net.http_post + `lx_prive.cle_service()`).
- **Protection** : `a_lx_rdv_demandes_garde` : hors serveur, seul le statut change (proposed → pending / cancelled_by_salon, pending → cancelled_by_salon ; refus si confirmation en cours) ; colonnes serveur remises à zéro à l'insertion anonyme.
- **App** : `lxSmOuvrir` (fenêtre « Répondre à la demande », maquettes 1-2 : `_lxSmCatalogue` SVC + FORFAITS, `_lxSmEtat` via `checkConflict`, `_lxSmLibres`, `_lxSmPlanning` / `_lxSmPlanningMobile`, `lxSmEnvoyer`), `lxSmSuivi` (états, paiement, doublons), `lxSmListe`, `lxSmAction` (worker salon-action, préremplissage `_lxSmPrefill`). `openDemande` : pending → nouvelle fenêtre ; v2 → suivi ; v1 → vues d'origine. Anciennes fonctions (`renderDemandeComposer`…) gardées (inutilisées pour pending).
- **Page client** : `proposal.html` (`renderV2`, maquettes 3-4 ; `v2Valider` : choose ou connect-pay ; confirmation `renderV2Confirme` avec reçu d'acompte `recu_acompte` ; refus avec message). Ancien format : code d'origine.
- **Bancs** (versionnés) : `docs/edge_1030_surmesure/bancs/` — `base.mjs` charge le schéma de production relu (catalogues → `/tmp/sm/prod/*.sql`, à régénérer par requêtes de catalogue en lecture seule) dans PGlite ; copier les bancs dans `/tmp/sm`, `node build_edge.mjs` (edges + worker), puis `sql_test.mjs` 145/145, `rb_test.mjs` 11/11, `edge_worker_test.mjs` 75/75 (`harness.mjs` : PostgREST, Stripe, Brevo simulés), `arrondi_test.mjs` 198/198, `page_client_test.mjs` 29/29 et `sm_app_test.mjs` 37/37 (serveur `python3 -m http.server 8790` à la racine du dépôt, lancé depuis `/sessions/.../shot`) (Chromium sans affichage : `/sessions/.../shot/node_modules` @sparticuz/chromium + puppeteer-core), `bot_test.mjs`.
- Textes : aide `aide/rendez-vous-en-ligne.html` #s8 (+ 2 captures), `aide.html` (FAQ + carte), bot `docs/migrations_1030_surmesure/bot_surmesure_v2.sql`, pro / index / site (jusqu'à 3 créneaux). CGV / confidentialité : non concernées (mêmes données, même paiement sur le compte de l'établissement).

## Adresse e-mail client mal saisie (30/10/2026, accord d'Alexandre « oui fais ca »)
- Hors périmètre fiscal. SQL `docs/migrations_1030_email/email_client_rejete.sql` : `clients_luxyra.email_rejete_at` + `email_rejet_motif` (écrits par le serveur seulement : `bp_protect_sensitive` refuse tout autre rôle).
- `lx-profile` v11 (sources `docs/edge_1030_email/lx-profile`, « avant » = v10) : action `change_email` (session + MOT DE PASSE, seulement si `email_verified=false`, forme stricte, adresse libre, 2 min / 5 par jour partagés avec `send_verification` — les refus « adresse déjà utilisée » comptent aussi —, nouveau lien à la NOUVELLE adresse, ancien lien invalidé, `session_version` +1 → autres appareils déconnectés, nouveau jeton renvoyé). `get` renvoie `email_rejete_at` ; `verify_email` et `change_email` l'effacent. Rien n'est rattaché par e-mail avant confirmation (`fn_autolink_clients_luxyra` au passage `email_verified=true`).
- **30/10/2026 (contre-audit, règles permanentes)** : (1) un lien « mot de passe oublié » (`lx-password-reset` v7) ne confirme l'adresse (`email_verified=true`) QUE si l'adresse du compte est toujours celle à laquelle le lien a été envoyé (colonne `client_password_resets.email`) ; sinon il change seulement le mot de passe. `change_email` (lx-profile v12) annule tous les liens de réinitialisation en attente. (2) Jamais de rattachement d'une fiche salon (invitation `/api/client/invite/verify`) à un compte client NON confirmé : 409 `compte_non_confirme`. (3) E-mail de confirmation après correction d'adresse : sans prénom, avec « Si vous n'avez pas créé ce compte, ne cliquez pas ». (4) `update` : nom/prénom 80 caractères max, sans lien, @ ni < >. (5) SMS « sur mesure » de secours : anti-doublon `messaging_log` clé `…|sms`. Restent à faire : limite atomique des 5 essais/jour (m1), secret du webhook Brevo + limite par IP (m3), confirmation du lien exigeant la session (M1 complet).
- **30/10/2026 (contre-audit 2, règles permanentes)** : (1) tout lien de confirmation d'adresse porte l'adresse à laquelle il part (`clients_luxyra.verification_email`, écriture réservée au service_role par `bp_protect_sensitive`) ; `verify_email` (`lx-profile` v13) refuse si `verification_email <> email` ; (2) toute émission de code (`send_verification`, `change_email`, `lx-signup` v12) est une écriture CONDITIONNELLE (`.eq(email, adresse lue).eq(email_verified,false)` + délai 2 min et limite 5/jour revérifiés par la base via `.or(...)`) — 0 ligne = AUCUN envoi ; (3) aucun e-mail vers une adresse non confirmée ne cite le prénom (signup, renvoi, correction, réinitialisation `lx-password-reset` v8) ; (4) invitation (worker) : confirmation écrite avec `email=eq.<invitation>&email_verified=eq.false`, sinon ni confirmation ni rattachement ; (5) `update` borne adresse/ville/cp/téléphone et n'accepte `avatar_url` que sur le stockage Supabase du projet. Migration `docs/migrations_1030_email/verification_email.sql` (codes émis avant le 30/10 20:15 UTC repris avec l'adresse actuelle ; plus récents sans adresse = refusés). Restant : secret du webhook Brevo (m3).
- `lx-brevo-webhook` v2 (verify_jwt FALSE, URL publique) : hard_bounce / invalid_email / blocked → POST interne `/api/email/rejet-signale` (worker). Le worker VÉRIFIE le rejet dans le journal Brevo (`smtp/statistics/events`, hardBounces / invalid, 30 j) avant de marquer le compte : un faux appel ne marque rien.
- Worker : `lxEmailClientRejete()` ; notifier sur mesure : adresse marquée → pas d'e-mail (`email:"rejete"`), SMS à la place. Les autres e-mails ne sont pas interceptés (Brevo bloque de lui-même une adresse en rejet définitif).
- Pages : `lx-client.js` (`LX.changeEmail`, `LX.suggererEmail`, champs `data-lx-sugg` → « Vouliez-vous dire … ? » + rappel de l'adresse ; « laposte.fr » → « laposte.net »), `compte.html` (bandeau rouge « Votre adresse e-mail semble incorrecte : corrigez-la » + formulaire ; lien « Adresse mal saisie ? Corrigez-la » sous le bandeau jaune ; compte confirmé + rejet : « écrivez à contact@luxyra.fr »), `site.html` (inscription + e-mail de réservation). `lx-client.js?v=20261030-1`.
- Bancs : `docs/edge_1030_email/bancs` (email_test.mjs 46/46 sur base reconstruite depuis la prod ; em_ui.mjs navigateur téléphone 18/18 ; sur mesure edge_worker_test 75/75 inchangé).
- Retour arrière : edges `avant/` (lx-profile v10, lx-brevo-webhook v1), puis pages (`git revert`), puis SQL (fin du fichier). Le compte réel concerné le 29/10 (adresse rejetée, Excellence) n'a pas été modifié.


## 31/10/2026 — Comptes clients : contre-audit 3 (hors fiscal)
- **Confirmation d'adresse (verify_email, lx-profile v14)** : le lien seul ne suffit plus. Il faut être connecté à CE compte (jeton de session envoyé par lx-client.js) OU saisir le mot de passe du compte (page `verif` de compte.html). Sinon 403 `besoin_mot_de_passe` ; la page propose « Définir un mot de passe » (mot de passe oublié). À la confirmation : session_version +1 (autres appareils déconnectés), abonnements push supprimés, nouveau jeton renvoyé.
- **Réinitialisation (lx-password-reset v9)** : supprime aussi les abonnements push. Adresses ASCII strictes (lx-signup v13, lx-password-reset v9).
- **sync_clients_luxyra_from_salon** : un établissement ne modifie QUE le compte relié à sa fiche (`clients.client_luxyra_id`), jamais par égalité d'e-mail.
- **Droits** : anon n'a plus aucun droit sur `clients_luxyra` / `client_invites` ; authenticated n'a que des droits par colonne sur `clients_luxyra` (jamais password_hash, codes, session). Ne JAMAIS rouvrir ces droits ; tout passe par les edge functions (service_role).
- **Webhook Brevo (lx-brevo-webhook v4) — rubrique Brevo** : clé secrète `brevo_webhook_cle` dans le coffre Supabase (vault). URL à coller dans Brevo (Transactionnel > Paramètres > Webhooks) : `https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/lx-brevo-webhook?k=<clé>` (lire la clé : `select decrypted_secret from vault.decrypted_secrets where name='brevo_webhook_cle'`). Tant que la nouvelle URL n'a jamais servi, l'ancienne reste tolérée (limites + alerte « Brevo : coller la nouvelle adresse… » dans la surveillance) ; dès le premier appel avec la clé, tout appel sans clé est refusé (401). État : `lx_prive.brevo_webhook_etat`.
- **Établissement suspendu sans abonnement (essai terminé)** : écran de choix de formule (pas le portail Stripe) ; retour de paiement `?checkout=success` → écran d'attente qui se recharge (jamais un 2e paiement). Garde 20261031-2.
- **31/10/2026 — Contre-audit 4 (comptes clients + fin d'essai), corrigé** :
  - Webhook Brevo `lx-brevo-webhook` v5 : la bonne clé passe TOUJOURS (la limite 300 événements/min ne s'applique qu'aux appels sans clé, `lx_brevo_webhook_controle` réécrite : `docs/migrations_1031_reserves/brevo_limite.sql`) ; contrôle en erreur → 503 (jamais d'acceptation par défaut) ; la clé `?k=` n'est jamais enregistrée dans les rapports d'erreur.
  - `lx-password-reset` v10 : réinitialisation d'un compte jamais confirmé → carte enregistrée oubliée (stripe_pm, card_last4, card_exp, stripe_customer_id).
  - Fin d'essai sans abonnement (salon `suspended` sans `stripe_subscription_id`) : écran `showTrialExpiredScreen` (luxyra-supabase.js) avec, AVANT le paiement, 1) caisse test → « Passer en caisse réelle » (procédure existante lxPasserEnReel / nf525_passer_en_reel, obligatoire : startCheckout redirige toujours vers elle en caisse test), 2) SIRET manquant → champ (Luhn, `lxValidateSiret`) enregistré par `lxSaveSalonColumns` ; réponse `siret_requis` du worker → champ réaffiché. Vue admin : ni passage ni paiement. Garde 20261031-4.
  - Worker `create-checkout` : refus 409 `abonnement_actif` si un abonnement Stripe vivant non programmé pour s'arrêter existe (changement de forfait = switch-plan) ; sessions d'abonnement ouvertes du même salon expirées avant d'en créer une. `updateSalonPlan` : abonnement remplacé créé il y a < 24 h → sa facture payée est remboursée (Idempotency-Key `lx-abo-double-<sub>`, alerte surveillance) ; JAMAIS pour un abonnement plus ancien. Activation vérifiée (`supabaseUpdate(…, true)`) : refus ou 0 ligne → alerte critique `worker:stripe-activation`.
  - Bancs : `docs/edge_1030_email/bancs/email_test.mjs` (94/94), `docs/migrations_1031_reserves/bancs/` (worker 11/11, écran fin d'essai 11/11).

## 31/10/2026 — Abonnement Luxyra : doublons et reprise (contre-audit 5, worker)
- `updateSalonPlan` (checkout.session.completed) LIT D'ABORD l'abonnement arrivant chez Stripe : `canceled`/`incomplete_expired` → ignoré (return false) ; plus ancien (`created`) que l'abonnement en place encore vivant → l'ARRIVANT est le doublon (`lxAnnulerAbonnementDouble`), salon inchangé ; illisible → aucune annulation + alerte critique. Le webhook ne fait rien d'autre (site, Fondateur) si `updateSalonPlan` renvoie false.
- Remboursement d'un doublon : seulement si l'abonnement doublon a < 24 h (clé `lx-abo-double-<sub>`). Pas d'avoir automatique sur `factures_luxyra` : alerte `worker:abonnement-double` (niveau error) « AVOIR À ÉTABLIR À LA MAIN » avec le n° de facture.
- `create-checkout` : lecture Stripe en échec → 503 `stripe_indisponible` ; past_due/unpaid → 409 `regulariser` (l'app ouvre le portail) ; abonnement vivant programmé pour s'arrêter → RÉACTIVÉ (`reactive:true`, formule changée via `lxChangerFormuleSub`, partagé avec switch-plan), jamais un 2e abonnement ; abonnement introuvable (resource_missing) → nouvelle session.


## 31/10/2026 — Bons cadeaux : modèles « Maison » / « Écrin » au choix de chaque établissement
- `config_json.bonModele` = "maison" | "ecrin" | "" (vide = rendu HISTORIQUE inchangé, défaut pour tous, Excellence comprise). Lu dans luxyra-supabase.js (`SALON_CONFIG.bonModele`), écrit par la section `bonModele` de `LX_CFG_SECTIONS` (valeur vide écrite aussi). Clé publique (salons_public) : elle sert à la page de vente.
- Rendu : `lx-bon-cadeau.js` (`window.LXBon` : palette dérivée de `couleur_primaire` avec garde-fou de contraste, `carte(modele, recto|verso)`, `a6`, `documentImpression(…, "carte"|"a6")`). PRÉSENTATION SEULEMENT : aucun montant / code / TVA calculé dans ce fichier ; la mention TVA est fournie par l'appelant (`_lxBonMentionTva` = même règle que `printGiftThemed`). Classes internes préfixées `lxb-` (sinon collisions avec les classes de l'app : `.sb`, `.code`…).
- App : `chooseGiftTheme` → `_lxBonChoixImpression` si un modèle est choisi (Carte 85 × 55 à plier sur A4 / A6 ; bons pré-imprimés d'Excellence et « Anciens thèmes » = `chooseGiftThemeAncien` conservés) ; réglage `lxBonChoisirModele` (tuile Bons cadeaux + Paramètres › Site en ligne).
- Page publique `bons-cadeaux.html` : `body.lxm` + occasion (`LXBon.OCCASIONS`) → `theme_id` HISTORIQUE valide (classique/anniversaire/noel/feteMeres/stValentin/roseGold) : gc-create-checkout inchangée.
- Confirmation : `/api/bons-cadeaux/statut` renvoie `carte` (de/pour/message saisis par l'acheteur, données publiques de l'établissement ; logo omis s'il dépasse 400 000 caractères) SEULEMENT si un modèle est choisi.
- E-mail : `gc-stripe-webhook` v13 → `buildBonHTMLModele` (tableaux, sans Google Fonts, objet sans emoji) si modèle choisi ; sinon `buildBonHTML` historique. Logo base64 jamais mis dans l'e-mail (bloqué par Gmail/Outlook).
- **31/10 (-2) : palettes, e-carte en caisse, formats A4.**
  - `config_json.bonPalette` = "" (couleur de l'établissement) | clé de `LXB_PALETTES` (noir_or, bordeaux, nuit, sauge, rose, taupe). Section `bonPalette` de `LX_CFG_SECTIONS`, écrite avec `bonModele` ; lue dans luxyra-supabase.js ; page publique / worker `statut` (`carte.palette`) / edge.
  - **Bloc commun `LXB-PARTAGE`** (couleurs, palettes, `lxbEmailCorps` = e-carte) : source `lx-bon-cadeau.js`, **copie exacte** dans `docs/edge_1031_bons/gc-stripe-webhook/index.ts` par `node docs/bons_1031/sync_partage.mjs` (`--verifier` au banc). Ne JAMAIS le modifier dans l'edge seul. JS pur (pas de types) : l'edge n'est pas typé-vérifié au déploiement.
  - E-carte : QR = image `https://luxyra.fr/api/qr?d=CODE&s=160` (worker, même lx-qrcode.js ; GIF décodé au banc), code du bon sur sa propre ligne (nowrap), logo https seulement, sans pastille. Edge **v14** (verify_jwt false) : esc() échappe aussi " et ' (R5) ; périmètre passé en clair.
  - App : `_lxBonChoixImpression` → formats A4 `plie` (A4 plié en deux, recto simple, dos imprimé à 180°, carte 178,5 × 115,5 mm), `carte`, `a6a4` (A6 centrée sur A4 + traits de coupe), `pleine` (A6 × 2), lien `a6` (papier A6) ; **« Envoyer l'e-carte »** (`lxBonEcarte` → `sendEmailViaWorker`, contexte `bon_ecarte` ajouté à `LX_EMAIL_CONTEXTES` du worker, dedupKey `salon|ecarte|code|email|jour`, audit `BON_ECARTE` avec e-mail masqué ; refus si bon non actif / épuisé / expiré / non payé ; rien en démo) ; **« Partager »** (navigator.share ou copie).
  - Bancs : docs/bons_1031/bancs/bons_v2_test.mjs (51/51, avec `WORKER_MJS` pour servir le vrai QR) + bons_v2_app.mjs (26/26).

## 31/10/2026 — Inscription client : code à 6 chiffres AVANT la création du compte (accord d'Alexandre « on part sur l'option 1 »)
- **lx-signup v14** (verify_jwt FALSE, avant : `docs/edge_1031_code/avant/lx-signup`). Étape 1 sans `code` : tous les contrôles des champs (ASCII strict, 8 caractères, mot de passe divulgué) puis code envoyé → **HTTP 428** `{code_requis, renvoi_s, expire_min}` ; aucune ligne `clients_luxyra`. Étape 2 avec `code` : `lx_signup_code_verifier` puis insertion **`email_verified=true`** (le déclencheur `trg_autolink_clients_luxyra` rattache les fiches comme une confirmation). Pas de lien `?verif=` envoyé.
- **Réponse neutre** : adresse déjà inscrite → même 428, mais l'e-mail dit « Vous avez déjà un compte » (aucun code) ; 409 seulement à l'étape 2 (impossible sans boîte mail). Le texte d'erreur du 428 n'a ni « déjà » ni « existe » (anciennes pages en cache : compte.html les transformait en « compte existe »).
- **Base** (`docs/migrations_1031_code/code_inscription.sql`, appliqué) : `clients_signup_codes` (empreinte sha256(secret|signup|email|code), 15 min, 5 essais puis code effacé, usage unique), `clients_signup_ip` (empreinte d'IP) ; fonctions `lx_signup_code_demander` (60 s entre deux envois, 3/h/adresse, 10/h/IP, verrou de ligne) / `_verifier` / `_menage` (> 2 jours) — service_role uniquement, RLS sans règle.
- **Appel interne du worker (invitation)** : jeton service (exact ou validé par lecture de `client_invites`, réservée au rôle service) → ancien chemin inchangé (compte non confirmé + lien, puis le worker confirme). Contrôle : `{"action":"verif_interne"}` ne renvoie qu'un booléen.
- **Front** : `lx-client.js` (v=20261031-2) ouvre la fenêtre « Vérifiez votre e-mail » sur un 428 (champ unique `one-time-code`, collage nettoyé, validation auto à 6 chiffres, « Renvoyer le code » après 60 s, « Modifier l'adresse » = annulation → `{status:499, annule:true}`). Aucune page à modifier : compte.html et site.html appellent `LX.signup` comme avant.
- Banc : /tmp/em/code_test.mjs (24/24), UI /sessions/quirky-affectionate-hypatia/shot/code_ui.mjs (8/8). Retour arrière : redéployer lx-signup « avant » puis le DROP en fin du fichier SQL.

## 31/10/2026 — Code d'inscription v2 (contre-audit) + e-mails sans nom
- lx-signup v16 : plafond global des codes (app_config.signup_codes_max_heure, défaut 200/h), 15 échecs/24 h par adresse -> blocage 24 h, IPv6 par /64, ancien code valable jusqu'à expiration, ménage pg_cron horaire. Appel interne (invitation du worker) = clé service de l'environnement OU jeton role=service_role confirmé par `rpc/lx_est_role_service` — **la clé SUPABASE_SERVICE_KEY du worker n'est PAS celle injectée dans les edges** : ne jamais revenir à une simple égalité de chaîne.
- **Brevo refuse `to[].name` vide** : brevoSendEmail n'envoie plus le nom s'il est vide. Toujours tester `success` dans la réponse de /api/email/custom (le worker répond 200 même quand Brevo refuse).
