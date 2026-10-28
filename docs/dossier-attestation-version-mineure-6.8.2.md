# Dossier d'attestation — justification « version mineure » de Luxyra 6.8.2

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
version du 25/03/2026, § 340, § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 28/10/2026. Concerne le passage de la
version publiée 6.6.1 à la version 6.8.2 (les versions intermédiaires 6.7.0, 6.8.0 et 6.8.1 ont été développées et
auditées sur la branche `bons-cadeaux-tva` ; 6.8.0 et 6.8.1 n'ont jamais été publiées).

## 1. Règle appliquée

§ 340 : une version est **majeure** si elle modifie « un ou plusieurs paramètres impactant le respect des conditions
d'inaltérabilité, de sécurisation, de conservation et d'archivage des données » ; elle est **mineure** si ces paramètres
ne sont pas modifiés. § 380 : l'attestation reste valable pour les versions mineures ultérieures si elle identifie la racine
de la version majeure (ici **6**) et les subdivisions réservées aux versions mineures (6.x.y) — l'éditeur s'engage à ne pas
utiliser ces subdivisions pour une version majeure.

## 2. Paramètres des quatre conditions — inchangés

| Condition (BOI § 80-260) | Mécanisme | Modifié par 6.7.0 → 6.8.2 ? |
|---|---|---|
| Inaltérabilité (§ 80-120) | déclencheurs `ticket_nf525_insert` (n° légal + chaînage SHA-256), `tickets_nf525_protect`, `ticket_nf525_update`, `ticket_nf525_delete`, `tickets_block_post_cloture`, `appointments_nf525_protect`, `clotures_z_inalterable` ; corrections par opérations de « moins » (avoirs, retours) | **Non.** Définitions relevées en production le 28/10/2026 et contrôlées par empreinte md5 complète en tête du SQL (le script refuse de s'appliquer si l'une a changé). |
| Sécurisation (§ 130-150) | empreinte SHA-256 du ticket, chaîne de scellement `_nf525_seal_row` → `nf525_hash_seal`, signature ES256 (`nf525-sign`), journal des événements (JET), mode test identifié | **Non.** Format de l'empreinte, du sceau et de la signature inchangés ; les tickets créés par le serveur passent par ces mêmes déclencheurs. |
| Conservation (§ 155-200) | tables `tickets`, `clotures` (Z journalière, cumuls mois / année / perpétuel), clôtures mensuelles / par exercice | **Non.** Seul ajout : le verrou de l'établissement dans le contrôle Z / journal (`lx_prive.clotures_controle_journal`, 2 lignes), qui renforce la concordance Z = journal sans changer aucun format ni calcul. |
| Archivage (§ 220-260) | archives signées (AR), notice, export | **Non.** |

## 3. Évolutions fonctionnelles (sans effet sur ces paramètres)

1. **Nouvelle source de tickets : le serveur (paiements en ligne).** Un paiement confirmé par Stripe (acompte, empreinte
   capturée, bon cadeau, carte d'abonnement, Click & Collect) et chaque remboursement sont enregistrés par une fonction
   serveur qui INSÈRE un ticket dans la même table `tickets` : n° légal, chaînage, empreinte, sceau, signature et refus d'une
   journée close sont ceux de tout ticket (mêmes déclencheurs, non modifiés). C'est l'application des § 30, § 35, § 40 et § 50
   (tout règlement d'un client particulier enregistré, y compris en ligne) — un enregistrement supplémentaire, pas une
   modification des fonctions de sécurisation.
2. **Numérotation imprimée par poste.** Les tickets du serveur ont leur propre série imprimée (poste « Serveur (paiements en
   ligne) », 900001, 900002… par établissement), enregistrée comme un poste de caisse (JET 126), comme une caisse
   multi-postes ; le n° légal `num` reste unique et continu pour tous les tickets (§ 50 : n° du justificatif, n° de caisse).
3. **Nouveaux refus (contrôles d'entrée, aucun assouplissement)** : `LX_APP_OBSOLETE` (version d'application trop ancienne,
   seuil réglable), `LX_TKNUM_SERIE_SERVEUR` (n° de la série serveur saisi par un appareil), `LX_SERVEUR_SEUL` (ticket
   « serveur » forgé), `LX_CC_DEJA_EN_CAISSE` (commande déjà en caisse), gardes des colonnes de paiement, carte d'abonnement
   inconnue (`LX_CARTE_INCONNUE`). Ils empêchent des enregistrements erronés ; aucun ne permet de modifier ou supprimer une
   donnée enregistrée.
4. **6.8.2 — exhaustivité de la file de secours.** Un ticket encaissé n'est plus jamais abandonné : s'il est refusé parce que
   sa journée est déjà clôturée, il est enregistré sur la journée ouverte avec sa date et son heure réelles de vente en
   mention (raw_data.dateVente / heureVente, notes) — la Z scellée n'est ni rouverte ni modifiée (§ 80-100, § 170) ; la clôture
   automatique de nuit ne clôt plus une journée dont un rendez-vous encaissé n'a pas son ticket au journal (alerte).
5. Bons cadeaux à usage unique / multiple (6.7.0, CGI art. 256 ter) : calcul de la TVA, sans effet sur les quatre conditions.

## 4. Pourquoi « 6.8.2 » (et non 6.8.1)

La 6.8.1 n'a jamais été publiée, mais son code a circulé (branche, essais, contre-audit) et son comportement de file de
secours (abandon possible d'un ticket refusé « journée clôturée ») a été jugé non conforme. 6.8.2 identifie sans ambiguïté
la version corrigée, sert de seuil au contrôle de version minimale du serveur (`recettes_en_ligne_version_min` = « 6.8.2 »
une fois tous les postes à jour) et apparaît au JET par `nf525_version` (code 255, version mineure). Racine majeure
inchangée : **6** ; l'attestation de la version majeure 6 couvre 6.8.2 (§ 380).

## 5. Traçabilité

Registre des interventions : `docs/registre-interventions-nf525.md`, interventions du 28/10/2026 (-1 à -4). SQL :
`docs/migrations_1027/bons_cadeaux_tva.sql`, `docs/migrations_1028/recettes_en_ligne.sql`. Essais : décrits au registre
(intervention -4). Changement de version enregistré au JET (255) à la première ouverture de chaque établissement.
