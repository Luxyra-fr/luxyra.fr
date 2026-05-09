# Playbook Migration — Workflow Cowork

> Procédure opératoire pour traiter une demande de migration depuis l'admin
> Luxyra en utilisant Cowork (assistance Claude). Ce doc te guide étape par
> étape pour les premiers cas, avant qu'on ait les connecteurs auto.

---

## 🎯 Vue d'ensemble

**Quand on est ici :** un salon a soumis une demande de migration depuis son
app (Settings → Migration). Tu reçois :

1. ✅ Email de notification sur `contact@luxyra.fr` (design palace, infos complètes)
2. ✅ Push notification mobile/desktop "📥 Nouvelle migration — [Salon]"
3. ✅ Carte rouge clignotante dans le cockpit `/admin`
4. ✅ Badge rouge sur Salons → Migrations
5. ✅ La demande apparaît dans la table avec icônes du périmètre demandé

**Statuts dans le cycle de vie :**

```
new ──▶ contacted ──▶ in_progress ──▶ completed
                          │
                          └──▶ cancelled (réversible)
```

---

## 📋 Étape 1 — Recevoir et qualifier (5 min)

### 1.1 Lire la demande
Va dans `/admin → Salons → 📥 Migrations`. Clique 💬 pour voir le message
client. Vérifie le périmètre demandé (icônes 👤📋📷📅📚⭐💳).

### 1.2 Marquer "Contacté"
Clique 📞 → modal de confirmation → OK. Le statut passe à `contacted`.

### 1.3 Appeler/écrire au salon
- Confirme la demande
- Demande comment elle veut transmettre les données :
  - **Option A** — Elle a un export RGPD de son ancien éditeur (CSV/Excel/JSON)
  - **Option B** — Elle te donne ses identifiants (lien sécurisé 24h, à supprimer
    sous 48h après migration)
  - **Option C** — Elle n'a rien et veut qu'on extraie depuis l'interface web

### 1.4 Demande d'export RGPD (Option A — préférée)
Si elle n'a rien encore, envoie-lui ce template à transmettre à son éditeur
actuel :

```
Objet : Demande de portabilité de données (RGPD article 20)

Bonjour,

Conformément à l'article 20 du Règlement Général sur la Protection des
Données (RGPD) et à l'article L.224-42-1 du Code de la consommation, je
sollicite l'export complet de l'intégralité de mes données salon dans un
format structuré, couramment utilisé et lisible par machine (CSV, Excel
ou JSON).

Je souhaite recevoir, dans un délai d'un mois maximum à compter de la
présente demande :
• Mes fiches clients (coordonnées, historique des services, fiches techniques)
• Les photos clients (avant/après, références coiffure)
• L'historique des rendez-vous (passés et planifiés)
• Mes factures émises (au format PDF + données structurées)
• Mes données de fidélité (points, cartes d'abonnement actives)

Cordialement,
[Nom du salon]
```

---

## 🔧 Étape 2 — Démarrer la migration (10 min)

### 2.1 Marquer "En cours"
Clique 🔧 dans le panneau Migrations admin. Le statut passe à `in_progress`.
Le salon voit "⏳ Migration en cours" dans son menu Settings.

### 2.2 Réceptionner les données
- **Si CSV/Excel reçu** → tu l'as sur ton PC, on passe à l'étape 3
- **Si identifiants reçus** → on lance Cowork (étape 2.3)

### 2.3 Ouvrir une session Cowork
Démarre une session avec moi (Claude). Donne-moi le contexte :

```
Je dois migrer les données du salon X depuis [LS Coiffure / Planity / etc.].
Voici les identifiants : [URL d'accès, login, mot de passe]
Périmètre demandé : [coller depuis l'admin Migrations]
Migration ID : [coller l'UUID]
Salon ID : [coller l'UUID]
```

Je ferai alors l'extraction via Chrome MCP : login, navigation, scrape,
conversion en CSV propre. Tu valideras chaque étape avant de poursuivre.

---

## 🗄️ Étape 3 — Importer dans Luxyra

### 3.1 Préparer le fichier CSV
Le fichier doit avoir ces colonnes (ordre libre, casse libre) :

| Colonne | Exemple | Obligatoire |
|---|---|---|
| nom | Dupont | ✅ |
| prenom | Marie | ⬜ |
| sexe | F / H / E | ⬜ (défaut F) |
| telephone | 0612345678 | ⬜ |
| telephone2 | 0123456789 | ⬜ |
| email | marie@example.com | ⬜ |
| adresse | 12 rue Foch | ⬜ |
| cp | 57200 | ⬜ |
| ville | Sarreguemines | ⬜ |
| date_naissance | 1985-06-12 | ⬜ |
| notes | Texte libre | ⬜ |
| nature_cheveux | Frisés | ⬜ |
| type_cheveux | Long | ⬜ |
| details_cheveux | Sensibles, allergies parabens | ⬜ |
| points_fidelite | 7 | ⬜ |
| sms_ok | true / false | ⬜ (défaut true) |
| email_ok | true / false | ⬜ (défaut false) |

**Anti-doublon :** déduplication automatique sur `téléphone` (normalisé
sans espaces/symboles), ou sur `(nom, prenom)` si pas de téléphone.

### 3.2 Appeler l'edge function `migration-import-clients`
Pour l'instant en attendant l'UI d'upload admin, utilise un curl/Postman
ou je le fais en Cowork :

```bash
curl -X POST 'https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/migration-import-clients' \
  -H 'Authorization: Bearer [TON_JWT_ADMIN]' \
  -H 'Content-Type: application/json' \
  -d '{
    "migration_request_id": "[UUID demande]",
    "salon_id": "[UUID salon]",
    "mode": "dry_run",
    "clients": [
      {"nom":"Dupont","prenom":"Marie","telephone":"0612345678","email":"marie@x.fr"},
      ...
    ]
  }'
```

**Mode `dry_run`** = simule l'import et renvoie ce qui serait inséré/skippé,
**sans rien insérer**. Toujours faire un dry_run d'abord pour valider.

**Mode `insert`** = insère pour de vrai. Renvoie `{ inserted, skipped, errors,
total_in_db_after }` et met à jour `migration_requests.internal_notes` +
`audit_log`.

### 3.3 Importer les factures historiques (archives)
Pour les anciennes factures du salon (mode lecture seule), insertion directe
dans `migrated_invoices` via SQL ou edge function dédiée (à créer si besoin) :

```sql
INSERT INTO migrated_invoices (
  salon_id, migration_request_id, source_software,
  source_invoice_number, date_facture, client_name,
  total_ht, total_ttc, tva_taux, items, modes_paiement
) VALUES (
  '[salon_id]', '[migration_request_id]', 'LS Coiffure',
  '2024-001234', '2024-03-15', 'Dupont Marie',
  41.67, 50.00, 20.0,
  '[{"nom":"Coupe femme","qty":1,"prix":35},{"nom":"Brushing","qty":1,"prix":15}]'::jsonb,
  '[{"type":"CB","montant":50}]'::jsonb
);
```

Ces factures apparaîtront automatiquement dans la page Compta du salon
(section "📚 Archives migrées") avec bandeau pédagogique NF525.

### 3.4 Importer les RDV historiques
À insérer dans `appointments` avec `st='done'` et un flag dans les notes
indiquant l'origine (à formaliser plus tard si besoin).

### 3.5 Importer les photos
Upload dans Supabase Storage bucket `client-photos`, référencer dans
`clients.fiche_tech.photos[]` (array d'URLs).

---

## ✅ Étape 4 — Validation et clôture

### 4.1 Validation 5 fiches au hasard
- Demande au salon de vérifier 5 fiches clients tirées au hasard dans son app
- Cherche-les via la barre de recherche pour confirmer présence + intégrité
- Vérifier les fiches techniques, l'historique, la fidélité (selon périmètre)

### 4.2 Marquer "Complété"
Dans le panneau admin Migrations, clique ✅ → modal de confirmation → OK.

**Effet automatique** :
- `migration_requests.status` = `completed`
- `salons.config_json.migrationStatus` = `"completed"`
- L'entrée "Migration" **disparaît du menu Paramètres** de l'app du salon
  (au prochain reload)

### 4.3 Sécurité (si identifiants reçus)
- **Supprime tout** ce qui est identifiants : message Slack/Email/SMS, fichiers
- **Confirme au salon** que ses identifiants ont été supprimés
- Note dans la conversation Cowork : "Identifiants supprimés à [date/heure]"

### 4.4 Email de bienvenue post-migration (optionnel)
Tu peux envoyer un email manuel via Brevo pour confirmer la fin :
"Bonjour, votre migration vers Luxyra est terminée. X clients importés,
Y factures en archive, Z photos. Bonne utilisation !"

---

## 🚨 Cas particuliers

### Le salon a déjà des clients dans Luxyra (avant migration)
- Le déduplicateur de l'edge function évite les doublons par téléphone normalisé
- Si certains clients ont été saisis manuellement avec un nom différent que
  dans l'ancien logiciel → vérifier manuellement après import

### Certaines données sont incomplètes (pas d'email, pas de tel)
- L'edge function les accepte quand même (champs optionnels)
- Garder une trace dans `clients.notes` : "Migré depuis LS Coiffure - email manquant"

### L'éditeur ancien refuse de fournir l'export RGPD
- Lettre recommandée avec AR + signalement à la CNIL (article 20 RGPD)
- En parallèle, tenter Cowork avec scraping (avec autorisation explicite du salon)
- Plan B : ressaisie manuelle assistée

### Volume énorme (>5000 clients)
- L'edge function limite à 5000 par batch
- Faire plusieurs appels par lots de 5000
- Mémoriser la progression dans `migration_requests.internal_notes`

### Le salon veut annuler en cours de migration
- Clique 🚫 (Annuler) dans le panneau Migrations
- `migrationStatus` retiré du config salon → menu redevient normal
- Le salon peut refaire une nouvelle demande quand il veut

---

## 📊 Vérifications post-migration

Après avoir marqué "Complété", il est recommandé de vérifier dans la DB :

```sql
-- Nombre de clients dans le salon
SELECT COUNT(*) FROM clients WHERE salon_id = '[salon_id]';

-- Nombre de factures en archive
SELECT COUNT(*), MIN(date_facture), MAX(date_facture)
FROM migrated_invoices WHERE salon_id = '[salon_id]';

-- Audit log de la migration
SELECT * FROM audit_log
WHERE salon_id = '[salon_id]' AND type LIKE 'MIGRATION_%'
ORDER BY created_at DESC;

-- Notes internes de la demande
SELECT internal_notes FROM migration_requests WHERE id = '[migration_request_id]';
```

---

## 🔮 Évolutions futures

Quand on aura beaucoup de migrations (>30/mois), envisager :

1. **UI d'import admin** : modal upload CSV/XLSX dans le panneau Migrations
   admin, avec preview des 5 premières lignes et mapping colonnes auto
2. **Connecteur LS Coiffure auto** : edge function qui prend les identifiants
   et fait le scrape sans Cowork
3. **Connecteur Planity** (similaire)
4. **Self-service côté salon** : zone d'upload dans Settings → Migration pour
   que le salon dépose son fichier directement (Supabase Storage). Tu valides
   ensuite depuis l'admin
5. **Tableau de bord migrations** : KPIs (temps moyen, taux de complétion,
   sources les plus fréquentes, taux d'erreurs)

---

## 📞 Support

Pour toute question sur le workflow ou un cas non couvert : ouvrir une
session Cowork avec le contexte. Ce playbook est un point de départ, à
enrichir au fur et à mesure des cas concrets traités.
