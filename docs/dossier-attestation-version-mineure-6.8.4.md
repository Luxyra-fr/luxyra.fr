# Dossier d'attestation — justification « version mineure » de Luxyra 6.8.4

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
version du 25/03/2026, § 340, § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 28/10/2026. Remplace, pour la version
publiée, le dossier `dossier-attestation-version-mineure-6.8.3.md` (6.8.3 jamais publiée ; son contenu reste valable et
n'est pas répété). Concerne le passage de la version publiée 6.6.1 à la version 6.8.4.

## 1. Règle appliquée

§ 340 : version **majeure** si elle modifie « un ou plusieurs paramètres impactant le respect des conditions d'inaltérabilité,
de sécurisation, de conservation et d'archivage des données » ; **mineure** sinon. § 380 : racine majeure **6**, subdivisions
6.x.y réservées aux versions mineures.

## 2. Ce que 6.8.4 ajoute à 6.8.3 — effet sur les quatre conditions

| Évolution 6.8.4 | Condition concernée | Paramètre modifié ? |
|---|---|---|
| « Vente encaissée » prise en compte pour retenir une journée = rendez-vous **scellé** par Luxyra (empreinte non vide) ; l'historique repris d'un ancien logiciel (sans empreinte, sans ticket ni Z) n'est plus compté | Conservation (§ 155-200 : clôtures) | **Non** : la règle d'exhaustivité porte sur les opérations enregistrées par le logiciel ; les données d'un autre logiciel, jamais scellées par Luxyra, n'en relèvent pas. Calculs, cumuls et empreintes des clôtures (Z, ZM, ZA, ZE) inchangés ; aucune donnée existante touchée. |
| Sortie administrateur d'une journée retenue depuis plus de 60 jours (`lx_z_forcer_admin`, réservée à l'administrateur Luxyra / au serveur, motif, liste des ventes consignée, JET 900, alerte) ; clôture Z d'une date précise par la clôture automatique (clé service), jamais hors de l'ordre des dates | Sécurisation (§ 130-150 : traçabilité, JET) ; conservation | **Non** : nouvel événement tracé au journal existant (code 900 déjà employé) ; table des forçages inaltérable (colonne `admin` ajoutée) ; la Z suit les calculs et contrôles existants. |
| Garde `LX_REPORT_NON_SCELLE` complétée : vente reportée seulement sur une journée de vente clôturée, date ni future ni antérieure à la première activité, heure valide, marque sur la 1re ligne seulement | Inaltérabilité (§ 80-120) | **Non** : contrôle d'ENTRÉE supplémentaire ; format de l'empreinte, du sceau et de la signature inchangé. |
| Forçage de l'établissement (`lx_z_forcer`) réservé au compte propriétaire, deux contrôles espacés d'au moins 5 minutes ; un second forçage ne recopie pas une vente déjà consignée | Sécurisation (§ 130-150) | **Non** : conditions d'accès supplémentaires à une opération déjà tracée. |
| Carte « Caisse » : journées retenues de plus de 60 jours ; heure à partir de laquelle le forçage est accepté | — | Affichage. |

Définitions de production contrôlées par empreinte md5 complète en tête du SQL : inchangées par rapport à 6.8.3 (les
fonctions protégées par la garde ne sont pas modifiées par ces corrections : empreintes recalculées sur PostgreSQL 17.6,
identiques).

## 3. Pourquoi « 6.8.4 » (et non 6.8.3 conservée)

La 6.8.3 n'a jamais été publiée, mais elle est décrite au registre (intervention -5) et dans le dossier 6.8.3 avec un contenu
précis (commit 8c3338e). Le code de l'application change (forçage avec délai, carte « Caisse ») : garder le même numéro ferait
correspondre deux contenus différents à une même version, contraire à l'identification de la version (§ 360 à 390). 6.8.4
identifie la version corrigée et sert de seuil au contrôle de version minimale (`recettes_en_ligne_version_min` = « 6.8.4 »
une fois tous les postes à jour ; défaut du serveur 6.8.4). JET : `nf525_version` (code 255, version mineure) à la première
ouverture. Racine majeure inchangée : **6** (§ 380).

## 4. Traçabilité

Registre : `docs/registre-interventions-nf525.md`, intervention du 28/10/2026 (-6). SQL : `docs/migrations_1027/bons_cadeaux_tva.sql`
(prérequis), `docs/migrations_1028/recettes_en_ligne.sql`, retour arrière `docs/migrations_1028/retour_arriere_clotures_1028-5.sql`.
