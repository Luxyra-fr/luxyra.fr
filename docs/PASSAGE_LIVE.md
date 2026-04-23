# Passage en live — checklist complet Luxyra

Document à lire **avant** de basculer les salons en encaissement réel.

---

## 🎯 Intention business (à ne jamais oublier)

**Les acomptes doivent arriver DIRECTEMENT sur le compte Stripe du salon**, pas sur le compte Luxyra. C'est pour ça qu'on passe par **Stripe Connect** (pattern marketplace).

Chaque salon doit :
1. Aller dans Paramètres → Paiements en ligne → onboarding Stripe Connect
2. Compléter la vérification d'identité (KYC) : carte d'identité, Kbis, RIB, etc.
3. Obtenir le statut `stripe_connect_status = 'active'` sur sa fiche dans `salons`

Tant que `stripe_connect_status !== 'active'`, le salon est en état "dégradé" :
- Soit les acomptes tombent sur le compte Luxyra (flow actuel via `rdv-charge-acompte`)
- Soit les acomptes doivent être désactivés pour ce salon (à décider)

**Exemple** : Excellence Coiffure (id `e0cf27c7-d402-4d76-8e91-9ef5231b3582`) est en `pending_verification`. Tant que leur KYC n'est pas fini, les acomptes en ligne de leurs clients arrivent **sur le compte Luxyra**.

---

## 🏗️ Architecture des paiements

```
Client réserve sur luxyra.fr
        │
        ▼
  SALON.stripe_connect_status ?
        │
        ├── "active"      ──→  Path A : Cloudflare Worker
        │                       /api/stripe/connect-payment
        │                       → Stripe Checkout Session
        │                       → $$ direct sur compte salon
        │                       → Stripe webhook confirme paiement
        │
        └── autre chose    ──→  Path B : Supabase Edge Function
                                rdv-charge-acompte
                                → Stripe Charges API (sk_live_)
                                → $$ sur compte Luxyra (TEMPORAIRE)
                                → INSERT rdv_online service_role
```

Les deux paths sont dans `site.html` autour de `processStripePayment()` (ligne 1395 environ) et `submitWithStripe()` (ligne 1347).

---

## 🔐 Valeurs à changer lors du passage test → live

### Au total : 3 valeurs à remplacer à 3 endroits

| # | Valeur | Où la modifier | Type |
|---|---|---|---|
| 1 | `sk_live_51TCS0K...` | **Supabase** Dashboard → Functions → Settings → Secrets → `STRIPE_SECRET_KEY` | Secret |
| 2 | `sk_live_51TCS0K...` | **Cloudflare** Dashboard → Workers → luxyra-router → Variables and Secrets → (secret Stripe) | Secret |
| 3 | `pk_live_51TCS0K...` | **GitHub / code** → `site.html` ligne ~206 + `marketplace.html` si présent | Public (normal, dans le JS client) |

### Récupérer les clés live

1. Va sur https://dashboard.stripe.com/apikeys (sans `/test/`)
2. Toggle **"Viewing test data"** en haut à droite doit être **désactivé** (tu vois "LIVE" dans le bandeau)
3. Copie :
   - **Publishable key** : `pk_live_51TCS0K...` → **pour site.html** (valeur 3)
   - **Secret key** : `sk_live_51TCS0K...` → **pour Supabase + Cloudflare** (valeurs 1 et 2)

### Procédure recommandée

1. **D'abord Supabase** : remplace `STRIPE_SECRET_KEY` par `sk_live_...`
2. **Ensuite Cloudflare Worker** : remplace la secret Stripe par `sk_live_...`
3. **Enfin le code** : modifie `site.html` et `marketplace.html` pour passer à `pk_live_...`, puis commit + push
4. **Teste avec TA vraie carte** en achetant un acompte de 1€ pour valider

---

## 🧪 Carte de test vs carte réelle

### Mode test (actuel)

- Pas de vrai débit
- Carte magique Stripe : **4242 4242 4242 4242**, date future, CVV 123
- `stripe.createToken()` renvoie un `tok_test_...`
- La charge apparaît dans https://dashboard.stripe.com/test/payments

### Mode live

- Débit réel
- Utilise une VRAIE carte (la tienne) pour tester avec un petit montant (1€)
- La charge apparaît dans https://dashboard.stripe.com/payments (sans `/test/`)
- **Tu peux rembourser** depuis le dashboard Stripe en 1 clic

---

## ⚠ Points de vigilance

### Excellence Coiffure (et tout salon en `pending_verification`)

Actuellement en Path B → leurs acomptes arrivent **sur ton compte Luxyra**. Quand tu passeras en live :
- Option A : tu gardes leurs acomptes et tu les leur reverses manuellement
- Option B : tu désactives l'acompte online tant que Connect n'est pas `active` (plus propre). Pour ça, modifier la logique dans `site.html` `processStripePayment()` pour refuser si pas de Connect.
- Option C : forcer le KYC avant mise en production (bloquer le flux côté salon app si Connect pas active)

Recommandation : **Option C + B** pour ne pas avoir de cash à gérer manuellement.

### Sécurité

- La clé `sk_live_...` est **critique**. Si elle fuite, quelqu'un peut faire des charges à ta place.
- Ne la commite **JAMAIS** dans un fichier versionné (GitHub).
- Les secrets Supabase et Cloudflare sont chiffrés et sûrs — c'est le bon endroit pour la stocker.
- Si tu la crois compromise : https://dashboard.stripe.com/apikeys → **Roll key** → tu reçois une nouvelle clé, l'ancienne est invalidée.

### Webhooks Stripe (à configurer idéalement)

Pour que les RDV en `pending_payment` (Path A Connect) soient automatiquement confirmés après paiement, il faudrait un webhook Stripe qui appelle une edge function ou une route Worker. **À faire plus tard**, ne bloque pas le live.

---

## 📜 Historique de la session d'implémentation

Session 2026-04-23 : audit complet du flow réservation + paiement. Création des edge functions + triggers + anti-tampering. 10/11 failles fermées. Edge function `rdv-charge-acompte` testée avec `tok_visa` → charge réel `ch_3TPTevPk42Psx94T0jokqzyv` créé sur Stripe test.
