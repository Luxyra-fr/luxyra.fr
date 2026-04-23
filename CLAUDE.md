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

**Cloudflare Pages** (à confirmer — possiblement Workers) connecté au repo GitHub. Tout push sur `main` déclenche un redeploy automatique. Alexandre gère Cloudflare manuellement.

**Pour les modifs Cloudflare** : Claude donne les instructions précises (nom de variable, valeur, emplacement dans le dashboard) qu'Alexandre applique.

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

### 🟠 Reste à faire (non bloquant)

- [ ] `salons` : 3 SELECT policies `USING true` (anon, authenticated, public) → à restreindre ou passer via vue `salons_public` (déjà existante)
- [ ] Storage bucket `salon-documents` : retirer les broad SELECT (`public_read_docs`, `Allow salon document read`)
- [ ] Supabase Auth : activer "Leaked password protection" dans Dashboard → Auth → Providers → Email
- [ ] 11 fonctions Postgres sans `search_path` fixé (WARN) — ajouter `SET search_path = public, pg_temp`
- [ ] `factures_luxyra` : 2 policies INSERT identiques `WITH CHECK true` (nettoyer doublons)
- [ ] (long terme) Migrer BP vers Supabase Auth pour avoir reset-password natif + email verif + OAuth

### 📦 Edge Functions déployées

| Function | verify_jwt | Endpoints |
|---|---|---|
| `bp-signup` | false | POST { email, password, nom, prenom, ... } → { user, session_token } |
| `bp-login` | false | POST { email, password } → { user, session_token } |
| `bp-profile` | false | POST { session_token, action, ... } où action ∈ get\|update\|change_password\|delete\|remove_payment\|toggle_notif |
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
