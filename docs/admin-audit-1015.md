# Audit du panneau admin Luxyra — 15/10/2026

## 1. Ce qui existe aujourd'hui

Le menu a 8 rubriques, plus la recherche (Ctrl K) :

- **Cockpit** : « À réparer », NF525, 6 chiffres clés, « À traiter aujourd'hui », raccourcis, courbe du revenu mensuel, activité récente.
- **Salons** : liste avec actions groupées, Inscriptions, Demandes d'essai, Migrations, Annuaire (modération). La fiche d'un salon a 6 onglets complets (abonnement, suivi, support, technique…).
- **Finance** : Revenus (calculés dans le navigateur), Stripe (vue d'ensemble, remises, remboursements, relances), Clôtures Z, NF525.
- **Communication** : chat support, base du bot, SMS (statistiques, crédits Brevo, packs, simulateur), modèles d'e-mails.
- **Analytics** : chiffres clés, cohortes, entonnoir. Tout est calculé depuis la liste des salons, sans historique.
- **Claude** : la boîte « Demandes à Claude ».
- **Monitoring** : erreurs, tâches planifiées, intégrations, requêtes lentes, quotas, anomalies.
- **Paramètres** : réglages et constantes, page Légal (5 liens fixes), page Système.

**Bonne nouvelle : aucun bouton ne pointe vers une fonction absente.** Le désordre vient d'ailleurs :

- **Doublons**
  - NF525 apparaît à 3 endroits (Cockpit, Monitoring, Finance), avec 2 sources différentes qui peuvent dire des choses différentes.
  - « À réparer » est affiché deux fois (Cockpit et Monitoring).
  - L'état des intégrations est affiché deux fois (Monitoring et Système).
  - Le revenu mensuel est affiché deux fois (Cockpit et Revenus).
  - Deux tables de notes salon (`admin_notes_salons` et `salon_admin_notes`), toutes deux vides.
  - Trois tâches de nuit font la même chose : expirer les cartes d'abonnement.
- **Ce qui ne marche qu'à moitié**
  - Le raccourci « messages non lus » ouvre le chat sans filtrer : il ne filtre pas sur le bon nom de variable.
  - Les pastilles Demandes, Inscriptions et Migrations visent des éléments absents du menu : elles ne s'affichent jamais.
  - Notifications push : le Cockpit propose de les activer, alors que Paramètres affirme qu'elles sont abandonnées. La liste des appareils n'a pas de zone où s'afficher. `admin-sw.js` n'est plus le fichier utilisé.
  - La simulation de croissance repose sur +5 salons par mois, un chiffre inventé.
- **Code mort** : `rAlerts` et 5 petites fonctions jamais appelées.
- **Lenteur** : au chargement, le panneau lance 2 requêtes par salon (clients, collaborateurs). Il ralentira à mesure que le nombre de salons augmente.
- **Visible seulement en base** :
  - Journal des actions admin : `admin_audit_log` est vide, une seule action y est enregistrée.
  - Parrainages : seul le code est visible dans la fiche du salon.
  - Candidats aux purges RGPD et à la suppression à 6 ans.
  - Doublons de clients.
  - Contrôles d'intégrité des données et de la fiscalité.
  - Escalades du bot vers un humain.
  - Sauvegarde de nuit et test de restauration (GitHub).
  - Historique du revenu (`mrr_snapshots`), déjà utilisé mais sans vrai rapport.

## 2. Ce qui manque pour le pilotage quotidien

| Besoin | État |
|---|---|
| Abonnements et revenu par salon (Stripe) | existe et bon (onglet Stripe + fiche salon) |
| Paiements échoués / factures impayées | existe mais faible (dans la vue Stripe, sans alerte dédiée) |
| Essais qui expirent et conversion des essais | existe mais faible (dispersé, pas de liste « fin d'essai sous 7 j ») |
| Score de santé et démarrage des salons | existe et bon (liste des salons) |
| SMS par salon / Brevo | existe et bon |
| E-mails envoyés / ouverts | existe mais faible (relances seulement, aucun suivi des rejets) |
| Support : délais de réponse | manquant |
| Questions auxquelles le bot n'a pas su répondre | manquant |
| Modération de l'annuaire | existe et bon |
| Parrainage | manquant (aucune vue d'ensemble) |
| NF525 | existe mais éclaté (3 vues) |
| Sauvegardes de nuit | manquant |
| « À réparer » / monitoring | existe et bon (mais en double) |
| Demandes RGPD / purges à venir | manquant |
| Fermetures de salons | existe (action), mais pas de liste |
| Liens Play Console / Search Console | manquant |
| Demandes à Claude | existe et bon |
| Journal des actions admin | existe mais vide, sans écran |

## 3. Chat support

**Ce qui marche :**
- 3 colonnes (salons, conversations, messages), mises à jour en direct.
- Compteurs de non-lus.
- Accusés de lecture (✓✓).
- Statuts « en cours » et « résolu ».
- Recherche par nom de salon.
- Affichage adapté au mobile.
- Notification push à l'admin et au pro.
- Le bot s'arrête dès que vous répondez.

**Ce qui manque :**
1. Le contexte du salon à côté de la conversation : forfait, fin d'essai, dernière activité, erreurs récentes, lien vers la fiche.
2. Des réponses toutes faites, insérables avec « / ».
3. Des notes internes invisibles du pro.
4. L'envoi de captures d'écran et de pièces jointes.
5. Un filtre « escaladé par le bot » et un bouton pour réactiver le bot.
6. Une revue des réponses du bot : questions sans réponse, ajout direct à la base de connaissances.
7. Un statut « en attente du pro ».
8. La recherche dans le texte des messages.
9. Le délai de première réponse et le délai de résolution.
10. Un indicateur « en train d'écrire ».
11. Des raccourcis clavier : conversation suivante, résoudre.
12. Un e-mail de secours quand la push n'arrive pas.

## 4. À connecter

Clés disponibles dans le worker : `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `BREVO_API_KEY`, `LUXYRA_LINK_SECRET`, `RETENTION_ADMIN_TOKEN`, `LUXYRA_ADMIN_EMAIL`, `AVIS_CRON_SECRET`.

**Faisable tout de suite :**
- **Stripe** : bouton « portail client » et lien direct vers le client Stripe depuis la fiche salon. L'adresse `/api/stripe/portal` existe déjà.
- **Brevo** : statistiques e-mails (envoyés, ouverts, rejets) avec la même clé que les SMS, déjà utilisée.
- **Purge RGPD** : `/api/admin/retention-purge` existe, mais aucun bouton ne l'appelle.
- **Export NF525** : `/api/admin/export-nf525` existe, mais aucun bouton ne l'appelle.
- **Liens fixes** : Play Console, Search Console, Cloudflare, Supabase, Brevo, Stripe.

**À ajouter (une clé GitHub en lecture seule) :**
- État des 3 automatismes GitHub (sauvegarde de nuit, test de restauration, déploiement du worker), avec alerte en cas d'échec.
- Les échecs des tâches de nuit sont déjà suivis par le Monitoring ; il faut les remonter dans le tableau de bord.

## 5. Nouvelle organisation proposée (7 rubriques)

1. **Tableau de bord** : uniquement les chiffres et les alertes du jour.
2. **Établissements** : liste, fiche, inscriptions, demandes d'essai, migrations, fermetures.
3. **Revenus & abonnements** : revenu mensuel et historique, Stripe, impayés, essais qui expirent, parrainage, revenus SMS.
4. **Support** : boîte de réception, base du bot, revue du bot, réponses toutes faites, statistiques.
5. **Communication** : SMS (Brevo), modèles d'e-mails, statistiques d'envoi, envois groupés.
6. **Qualité & conformité** : À réparer, monitoring, NF525 (une seule page) et clôtures Z, sauvegardes, RGPD et purges, journal admin, Demandes à Claude.
7. **Croissance & réglages** : annuaire et SEO, analytics, réglages, légal, système, liens externes.

**Les 10 chiffres du tableau de bord :**
1. Revenu mensuel et variation sur 30 jours
2. Salons payants / en essai
3. Essais qui finissent sous 7 jours
4. Paiements échoués
5. Messages support non lus, et le plus ancien en attente
6. Questions sans réponse du bot
7. « À réparer » graves
8. État NF525
9. Sauvegarde de la nuit (OK / échec)
10. Crédits Brevo restants

## Priorités

**P1 — indispensable**

| Chantier | Effort |
|---|---|
| Réorganiser le menu en 7 rubriques, supprimer les doublons, une seule source NF525 | M |
| Corriger le filtre « non lus », les pastilles et la contradiction sur les push | S |
| Contexte salon dans le chat, réponses toutes faites, notes internes, filtre « escaladé », réactivation du bot | M |
| Essais qui expirent et impayés en alerte sur le tableau de bord | S |
| Enregistrer toutes les actions sensibles dans le journal admin, avec un écran pour le consulter | S |

**P2 — important**

| Chantier | Effort |
|---|---|
| Revue des réponses du bot | M |
| Délais de réponse du support | S |
| Captures d'écran dans le chat | M |
| État des sauvegardes et des automatismes GitHub | S |
| Statistiques e-mails Brevo | S |
| Page Parrainage | S |
| Page RGPD et purges | M |
| Chargement plus rapide de la liste des salons | S |

**P3 — confort**

| Chantier | Effort |
|---|---|
| Indicateur « en train d'écrire » | S |
| Raccourcis clavier | S |
| Liens Play Console / Search Console | S |
| Supprimer le code mort et la table de notes en double | S |
| Fusionner les 3 tâches de nuit identiques | S |
| Remplacer la simulation de croissance par des données réelles | M |
