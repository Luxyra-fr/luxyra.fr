# 29/10/2026 — logo léger dans les e-mails des edge functions

Remplacement, dans l'en-tête `lxMailLayout` des e-mails, de
`<img src="https://luxyra.fr/luxyra-logo.png"` (422 Ko) par
`<img src="https://luxyra.fr/email/luxyra-logo-128.png"` (23 Ko, fichier `email/luxyra-logo-128.png`, commit c552a37).
Aucun autre changement (diff : 1 ligne par fonction, +10 octets). Le worker, app.html et inscription.html étaient déjà corrigés (c552a37).

Inventaire : les 48 edge functions du projet kxdgjtvrkwugbifgppai ont été relues (code déployé, get_edge_function).
Seules ces 10 contenaient `luxyra-logo.png`, à chaque fois dans la balise `<img>` d'en-tête de `lxMailLayout`.

| Fonction | Version avant | Version après | verify_jwt (avant = après) | Entrypoint | Fichiers |
|---|---|---|---|---|---|
| lx-password-reset | 5 | 6 | false | index.ts | index.ts |
| lx-signup | 10 | 11 | false | index.ts | index.ts |
| lx-profile | 9 | 10 | false | index.ts | index.ts |
| salon-onboarding-email | 14 | 15 | false | index.ts | index.ts |
| gc-stripe-webhook | 11 | 12 | false | index.ts | index.ts |
| salon-billing-email | 7 | 8 | false | index.ts | index.ts |
| avis-invite-email | 9 | 10 | false | index.ts | index.ts |
| rdv-online-modified-email | 8 | 9 | false | index.ts | index.ts |
| lx-alert-mail | 12 | 13 | false | index.ts | index.ts |
| migration-request | 13 | 14 | false | index.ts | index.ts |

- `avant/<fonction>/index.ts` : code déployé exact avant modification (copie octet par octet de la réponse get_edge_function).
- `apres/<fonction>/index.ts` : code redéployé, relu après déploiement (get_edge_function) et comparé : identique à `avant` à l'URL près.
- verify_jwt relevé par list_edge_functions avant et après : inchangé (false pour les 10).
- Fonctions sensibles : nf525-sign, lx-cloture-auto, carte-abo-confirm-payment, rdv-empreinte-capture, cron-empreinte-auto-capture, gc-create-checkout ne contiennent pas l'ancien logo : non touchées. gc-stripe-webhook (e-mail du bon cadeau) : seul l'URL a changé, reste identique octet par octet.
- Copies du dépôt mises à jour (étaient identiques au code déployé) : `docs/edge_1014/{lx-password-reset,lx-signup,lx-profile}/index.ts`, `docs/edge_1027/salon-onboarding-email/index.ts`, `docs/edge_1028/gc-stripe-webhook/index.ts`. Les 5 autres fonctions n'ont pas de copie dans le dépôt (désormais : `apres/`).

Non modifié volontairement :
- migration-request : constante `LOGO_URL = "https://luxyra.fr/luxyra-logo.png"` déclarée mais jamais utilisée (pas dans un `<img>`).
- `docs/migrations_1015/support_chat.sql` : e-mail construit en SQL (fonction de base, pas une edge function) avec l'ancien logo, hors périmètre.
- Usages hors e-mail du worker (og:image, redirections, logo Stripe Checkout, manifeste).

Retour arrière : redéployer `avant/<fonction>/index.ts` (entrypoint index.ts, verify_jwt false).
