# Dossier d'attestation — justification « version mineure » de Luxyra 6.8.3

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
version du 25/03/2026, § 340, § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 28/10/2026. Remplace, pour la version
publiée, le dossier `dossier-attestation-version-mineure-6.8.2.md` (6.8.2 jamais publiée ; son contenu reste valable et
n'est pas répété). Concerne le passage de la version publiée 6.6.1 à la version 6.8.3.

## 1. Règle appliquée

§ 340 : version **majeure** si elle modifie « un ou plusieurs paramètres impactant le respect des conditions d'inaltérabilité,
de sécurisation, de conservation et d'archivage des données » ; **mineure** sinon. § 380 : racine majeure **6**, subdivisions
6.x.y réservées aux versions mineures.

## 2. Ce que 6.8.3 ajoute à 6.8.2 — effet sur les quatre conditions

| Évolution 6.8.3 | Condition concernée | Paramètre modifié ? |
|---|---|---|
| Contrôle des « journées retenues » : la base refuse une Z si une journée antérieure n'est pas clôturée ou si des ventes encaissées du jour ne sont pas au journal (`clotures_controle_journal`) ; clôtures mensuelle / annuelle / d'exercice refusées dans ce cas, refaites chaque jour dans l'ordre | Conservation (§ 155-200 : clôtures journalière, mensuelle, annuelle, cumulatives) | **Non** : contrôles d'ENTRÉE supplémentaires ; calculs, cumuls et empreintes des clôtures (Z, ZM, ZA, ZE) inchangés ; aucune clôture existante touchée. Ils renforcent l'exhaustivité (§ 50, § 75) et l'ordre chronologique des clôtures. |
| Forçage tracé d'une clôture (administrateur, motif, liste des ventes consignée, JET 900) | Sécurisation (§ 130-150 : traçabilité, JET) | **Non** : nouvel événement tracé au journal existant ; la table des forçages est inaltérable. |
| Date réelle d'une vente reportée portée par la 1re ligne du ticket (`items[0].lxRep`, versionné) | Inaltérabilité / sécurisation (§ 80-150) | **Non** : le FORMAT de l'empreinte (`num|date|heure|ttc|ht|items|prev|salon`), du sceau et de la signature est inchangé ; la donnée est simplement placée dans un champ déjà couvert. Tickets existants inchangés. Nouveau refus d'entrée `LX_REPORT_NON_SCELLE`. |
| Exports à la date du journal + liste des ventes reportées ; FEC : date de pièce = date réelle d'une vente reportée | Archivage / restitution (§ 220-260) | **Non** : présentation des données ; archives signées inchangées ; sans vente reportée, exports identiques au bit près (banc de non-régression). |
| Remboursement Stripe reçu avant la première activation : consigné, ticketé à l'activation | Exhaustivité (§ 50) | **Non** : même chaîne de création de ticket que tout ticket serveur. |
| Carte « Caisse : action requise » (accueil) | — | Affichage. |

Définitions de production contrôlées par empreinte md5 complète en tête du SQL (21 fonctions relevées en lecture seule le
28/10/2026, recopies vérifiées sur PostgreSQL 17.6) : le script refuse de s'appliquer si l'une a changé.

## 3. Pourquoi « 6.8.3 »

La 6.8.2 (jamais publiée) laissait la date réelle d'une vente reportée hors empreinte et ignorait les nouveaux refus de la base ;
6.8.3 identifie la version corrigée et sert de seuil au contrôle de version minimale (`recettes_en_ligne_version_min` = « 6.8.3 »
une fois tous les postes à jour ; défaut du serveur 6.8.3). JET : `nf525_version` (code 255, version mineure) à la première
ouverture. Racine majeure inchangée : **6** (§ 380).

## 4. Traçabilité

Registre : `docs/registre-interventions-nf525.md`, intervention du 28/10/2026 (-5). SQL : `docs/migrations_1027/bons_cadeaux_tva.sql`
(prérequis), `docs/migrations_1028/recettes_en_ligne.sql`, retour arrière `docs/migrations_1028/retour_arriere_clotures_1028-5.sql`.
