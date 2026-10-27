# Registre des interventions techniques — Conformité NF525

**Logiciel :** Luxyra — module de caisse
**Établissement concerné :** Excellence Coiffure — SIRET 94409902700012 — 57200 Sarreguemines
**Éditeur / responsable technique :** Alexandre Jensen
**Date d'établissement du présent registre :** 30 août 2026

---

## Objet

Ce registre recense les interventions techniques ayant laissé une trace dans le
journal d'audit NF525 (`audit_log`) sous une action de type « bypass », ainsi que
les vérifications effectuées pour établir qu'aucune donnée fiscale n'a été altérée.

Il est destiné à être présenté lors d'un audit de certification, afin d'expliquer
des entrées de journal qui, sans contexte, pourraient être interprétées comme des
anomalies.

**Périmètre :** l'intégralité des entrées `audit_log` dont l'action contient
« BYPASS », depuis la mise en service. À la date d'établissement du présent
registre, ces entrées se rapportent à **deux interventions**, décrites ci-après.

---

## Intervention n° 1 — 19 mai 2026

### Trace laissée dans le journal

| Champ | Valeur |
|---|---|
| Identifiant | `audit_log` id = 1014 |
| Horodatage | 2026-05-19 17:44:51.349317 UTC |
| Action | `NF525_AUDIT_LOG_BYPASS` |
| Opérateur | `BYPASS_EXPLICITE` |
| Détail | `DELETE sur audit_log id=1013 action=NF525_AUDIT_LOG_BYPASS user=postgres` |

### Nature de l'intervention

Le 19 mai 2026 a été consacré au renforcement du dispositif NF525. Vingt migrations
de base de données ont été appliquées ce jour-là entre 17 h 17 et 19 h 45 UTC,
dont l'installation des garde-fous d'inaltérabilité.

L'horodatage de l'entrée 1014 — **17:44:51** — correspond exactement à la migration
`20260519174451_audit_log_nf525_inalterable`, qui **installe le déclencheur
d'inaltérabilité du journal d'audit lui-même**.

L'entrée 1014 est donc un **artefact de l'installation du garde-fou** : la première
opération observée par le déclencheur nouvellement posé a été la suppression, dans
la même transaction, d'une ligne de travail (id 1013) issue de sa propre mise en
place. Autrement dit, le mécanisme a correctement journalisé la dernière opération
de son propre déploiement.

### Discontinuité de numérotation constatée

Les identifiants **1009 à 1013** sont absents de la table, entre l'entrée 1008
(19/05, 15:53:52, `MISE_AU_COFFRE`, opérateur Amandine) et l'entrée 1014.

Deux causes distinctes se combinent, et il convient de les distinguer :

- **id 1013 — suppression établie.** Elle est explicitement journalisée par
  l'entrée 1014 ci-dessus. La ligne supprimée portait elle-même l'action
  `NF525_AUDIT_LOG_BYPASS`, c'est-à-dire une ligne technique de déploiement, et non
  un événement de caisse.
- **id 1009 à 1012 — très probablement des numéros consommés sans écriture.** Aucune
  suppression n'est journalisée pour ces identifiants. PostgreSQL consomme les valeurs
  de séquence de façon non transactionnelle : une transaction annulée consomme des
  numéros sans laisser de ligne. Or la migration `20260519172116_rollback_tickets_auto_triggers`,
  appliquée à 17 h 21 le même jour, atteste précisément d'une opération annulée dans
  cet intervalle horaire.

  Cette seconde explication est une **déduction fondée sur des faits vérifiables**
  (horodatage de la migration d'annulation, absence de toute trace de suppression),
  et non un constat direct : les numéros consommés par une transaction annulée ne
  laissent, par nature, aucune trace exploitable.

### Portée sur les données fiscales

**Aucune.** Les entrées concernées portaient l'action `NF525_AUDIT_LOG_BYPASS`,
propre au déploiement technique. Aucun ticket, aucune clôture, aucun montant n'est
concerné. La continuité des documents fiscaux eux-mêmes — numérotation des tickets
et des clôtures Z — est ininterrompue sur la période.

---

## Intervention n° 2 — 29 mai 2026

### Traces laissées dans le journal

| Champ | Valeur |
|---|---|
| Identifiants | `audit_log` id = 1226 à 1240 (15 entrées) |
| Horodatage | 2026-05-29 20:35:18.505547 UTC (transaction unique) |
| Action | `NF525_INALTERABILITE_BYPASSEE` |
| Opérateur | `BYPASS_EXPLICITE` |
| Détail | `UPDATE sur clotures id=<uuid> user=postgres` |

### Nature de l'intervention

L'horodatage — **20:35:18** — correspond exactement à la migration
`20260529203518_nf525_grand_total_perpetuel`.

Cette migration ajoute aux clôtures Z le **grand total perpétuel** (colonnes
`cumul_perpetuel_ca` et `cumul_perpetuel_tickets`), cumul progressif et ininterrompu
depuis la mise en service, dont la NF525 requiert la tenue. Les quinze clôtures Z
déjà enregistrées à cette date (Z n° 1 à 15, du 11 au 29 mai 2026) ont été mises à
jour pour recevoir cette donnée, qui ne pouvait pas exister avant l'ajout des colonnes.

Il s'agit donc d'un **enrichissement de la structure**, appliqué à des documents
existants, et non d'une modification de leur contenu fiscal.

### Vérification effectuée

Le grand total perpétuel a été recalculé et confronté aux montants d'origine. Sur
les seize premières clôtures, **l'écart entre le cumul perpétuel de chaque Z et
celui du Z précédent est rigoureusement égal au chiffre d'affaires de la journée
correspondante**, au centime près :

| Z | Journée | CA de la journée | Cumul perpétuel | Écart avec le Z précédent |
|---|---|---|---|---|
| 1 | 11/05/2026 | 160,90 € | 160,90 € | — |
| 2 | 12/05/2026 | 198,80 € | 359,70 € | 198,80 € |
| 3 | 13/05/2026 | 257,60 € | 617,30 € | 257,60 € |
| 4 | 15/05/2026 | 433,50 € | 1 050,80 € | 433,50 € |
| 5 | 16/05/2026 | 309,00 € | 1 359,80 € | 309,00 € |
| 6 | 18/05/2026 | 130,90 € | 1 490,70 € | 130,90 € |
| 7 | 19/05/2026 | 254,70 € | 1 745,40 € | 254,70 € |
| 8 | 20/05/2026 | 229,00 € | 1 974,40 € | 229,00 € |
| 9 | 21/05/2026 | 180,00 € | 2 154,40 € | 180,00 € |
| 10 | 22/05/2026 | 185,50 € | 2 339,90 € | 185,50 € |
| 11 | 23/05/2026 | 216,00 € | 2 555,90 € | 216,00 € |
| 12 | 26/05/2026 | 116,60 € | 2 672,50 € | 116,60 € |
| 13 | 27/05/2026 | 299,80 € | 2 972,30 € | 299,80 € |
| 14 | 28/05/2026 | 61,90 € | 3 034,20 € | 61,90 € |
| 15 | 29/05/2026 | 279,00 € | 3 313,20 € | 279,00 € |
| 16 | 30/05/2026 | 384,20 € | 3 697,40 € | 384,20 € |

La concordance est exacte sur l'intégralité de la série. Aucun chiffre d'affaires,
aucun nombre de tickets n'a été modifié par cette intervention.

### Portée sur les données fiscales

**Ajout d'une donnée exigée par la norme, sans altération des données existantes.**
Les quinze clôtures concernées disposent toutes de leur empreinte cryptographique et
sont scellées au registre `nf525_hash_seal`.

---

## Note complémentaire — scellement différé de mai 2026

Les quatre premières clôtures Z (n° 1 à 4, du 11 au 15 mai 2026) portent au registre
de scellement une mention distincte des suivantes :

> « Scellement cryptographique différé suite à correction `sha256Sync` (FIPS 180-4)
> le 2026-05-15 21h. Les données originales restent immuables ; ce scellé certifie
> leur état exact à la date d'insertion. »

Ces quatre clôtures sont antérieures au remplacement de la fonction d'empreinte
initiale par un SHA-256 conforme à la norme FIPS 180-4. Elles ont été scellées
rétroactivement, à données inchangées. Les clôtures suivantes (n° 5 et au-delà) sont
scellées automatiquement à leur création (`trigger_auto`).

---

## État de conformité constaté au 30 août 2026

Les vérifications suivantes ont été conduites à la date d'établissement du présent
registre :

| Contrôle | Résultat |
|---|---|
| Tickets enregistrés pour l'établissement | 547 |
| Tickets disposant d'une empreinte et scellés au registre | 547 / 547 |
| Journées encaissées sans clôture Z | Aucune |
| Continuité du grand total perpétuel sur les clôtures Z | Exacte |
| Contrôle applicatif `check_data_integrity` | Aucune anomalie |
| Entrées « bypass » non expliquées au présent registre | Aucune |

---

## Suivi des mises à jour du registre

| Date | Objet |
|---|---|
| 30/08/2026 | Établissement du registre. Consignation des interventions du 19/05/2026 et du 29/05/2026, et des vérifications associées. |
| 07/10/2026 | Mise en service de la clôture journalière automatique (voir ci-dessous). |
| 07/10/2026 | Suspension ponctuelle de la clôture automatique pour un salon, nuit du 07 au 08/10/2026 (voir ci-dessous). |

---

## Évolution du 7 octobre 2026 — clôture journalière automatique

Conformément au BOI-TVA-DECLA-30-10-30 (le logiciel « doit prévoir obligatoirement une clôture
journalière »), une journée encaissée qui n'a pas été clôturée par l'utilisateur est désormais clôturée
automatiquement la nuit suivante. La clôture automatique applique exactement les mêmes calculs et la même
empreinte chaînée que la clôture manuelle ; elle porte la mention « Clôture automatique » et ne comporte pas
de comptage du tiroir. Avant sa mise en service, le calcul a été rejoué sur les 120 clôtures existantes
d'Excellence Coiffure : totaux, HT et nombres de tickets identiques sur les 120, empreintes identiques sur
toutes les clôtures scellées en SHA-256. Cette évolution ne laisse aucune trace de type « bypass ».

---

## 7 octobre 2026 — suspension ponctuelle (une nuit) de la clôture automatique, Delphinecoiff

À la demande de l'éditeur, la clôture automatique n'est pas lancée pour le salon Delphinecoiff
(44b0d224-…) la nuit du 07 au 08/10/2026 : une question est en cours avec la cliente sur le taux de TVA
de tickets du 05/10/2026, déjà scellés. Aucune donnée fiscale n'est modifiée ; la suspension est tracée dans
le journal du salon (action `CLOTURE_AUTO_SUSPENDUE`). Les autres salons sont traités normalement cette nuit-là,
et tous les salons, dont Delphinecoiff, reprennent le fonctionnement normal dès la nuit suivante.

---

## 8 octobre 2026 — durcissement de sécurité (sans effet sur les données fiscales)

Dans le cadre d'une revue de sécurité, les fonctions de déclencheur de la base (dont celles qui protègent l'inaltérabilité :
`audit_log_inalterable`, `archives_nf525_inalterable`, `clotures_periodiques_inalterable`, `factures_clients_inalterable`)
ont reçu un chemin de recherche figé (`search_path`) et ne sont plus appelables directement depuis l'extérieur. Leur logique
n'est pas modifiée ; aucune donnée fiscale (tickets, clôtures, journal) n'a été lue en écriture ni modifiée.

---

*Toute intervention technique ultérieure laissant une trace de type « bypass » dans
le journal d'audit doit faire l'objet d'une nouvelle entrée dans ce registre, décrivant
la nature de l'intervention, sa cause, et les vérifications établissant l'absence
d'altération des données fiscales.*

- **2026-10-08 (soir)** — Clôture automatique de nuit : Delphinecoiff suspendue aussi la nuit du 08→09/10 (`lx_prive.lancer_cloture_auto`, condition de date étendue au 09/10). Motif : décision reportée par Alexandre (appel avec la cliente le 09/10) sur la clôture du 05/10 et les 5 tickets à 20 %. Aucune donnée fiscale modifiée, aucun autre salon concerné. À partir du 10/10 : comportement normal.

- **2026-10-09 (soir)** — Click & Collect payé en ligne : décision de l'éditeur (Alexandre) de rattacher **chaque remise** à un ticket de caisse scellé. Une commande payée sur le site est remise via la caisse, avec un mode de règlement unique « Payé en ligne (Click & Collect) » pour le montant payé en ligne (poste « en ligne » de la clôture Z et du détail de paiement, compte 58010000). Le serveur refuse désormais toute remise sans numéro de ticket. Pour que la clôture Z range ce mode au même poste que le détail de paiement du ticket (`_mapPaymentBucket`, inchangé), la ventilation des clôtures (`_lxPayBuckets`, application et clôture automatique `lx-cloture-auto` v2) reconnaît le libellé « en ligne ». Vérification préalable en base : **aucun** ticket ni rendez-vous existant ne porte ce libellé (0 ligne) ; après déploiement, le recalcul de contrôle des 122 clôtures d'Excellence Coiffure et la simulation de la nuit donnent un résultat **identique octet pour octet** à celui d'avant la modification. Aucune donnée fiscale existante modifiée. Libellés d'affichage « Acomptes en ligne » renommés « Payés en ligne (acomptes, Click & Collect) » (affichage uniquement, hors empreinte).
- **2026-10-09 (soir)** — Clôture automatique de Delphinecoiff : la suspension (nuits du 07→08 et 08→09/10) prend fin ; décision de l'éditeur de laisser la clôture de la nuit du 09→10/10 se faire normalement (journées du 05/10 et du 09/10). Aucune modification de code ni de données.
- **2026-10-11 (soir)** — Nouvelle fonction « correction de règlement après clôture », décidée par l'éditeur (Alexandre) à la suite de l'écart du ticket n°2079 (Excellence Coiffure, 02/10/2026 : remise fidélité appliquée après la saisie du paiement, CB enregistrée 32,00 € pour un ticket de 28,80 €). Conformément au BOI-TVA-DECLA-30-10-30 §90, la correction se fait par **opérations de « plus » et de « moins »** enregistrées dans une nouvelle table `corrections_reglement` : pièces numérotées par établissement, chaînées (hash SHA-256 + précédent), **inaltérables** (déclencheur `clotures_periodiques_inalterable`), scellées dans `nf525_hash_seal` (nouvelle branche de `_nf525_seal_row`, contrainte `source_table` étendue) et tracées au journal d'audit (`CORRECTION_REGLEMENT`). Seul le **mode** de paiement peut être corrigé : le total des règlements doit rester égal au total du ticket (CA et TVA inchangés) ; motif obligatoire ; fonction serveur `corriger_reglement` réservée au titulaire du compte (administrateur dans l'application). Les tickets et clôtures d'origine ne sont **jamais** modifiés. Restitution : clôture Z (explication de l'écart et pièces du jour), bande de contrôle mensuelle (pièces du mois et totaux après corrections), journal des ventes et FEC (mode réellement encaissé). Tests sur le Salon Démo : pièce n°1 (ticket n°5, CB 15 → CB 12 + espèces 3), refus des totaux faux / motif court / mode inconnu / ticket d'un autre établissement, UPDATE refusé par le déclencheur, journal équilibré. Aucune donnée fiscale existante modifiée.
- **2026-10-11 (soir)** — Renforcement de la sécurisation, décidé par l'éditeur (Alexandre), sans modification d'aucune donnée fiscale existante : (1) **signature électronique asymétrique ES256** (ECDSA P-256, encodage base64url) de chaque ticket, clôture Z/mensuelle/annuelle/exercice, correction de règlement, duplicata et événement du JET, chaînée par type (signature précédente incluse dans les données signées) ; clé privée générée par la fonction `nf525-sign` et conservée dans le coffre (Vault), clé publique publiée dans les archives (`LX-ES256-20261011-O3tPa_YK`) ; signature a posteriori de l'historique existant (tickets, Z, ZM, CR) avec événement JET 450 ; (2) **journal des événements techniques** (`nf525_jet`, inaltérable) alimenté depuis le journal d'audit, avec reprise des événements antérieurs marqués « reprise » (code 210) ; (3) **duplicatas** numérotés (`nf525_duplicata`), mention « DUPLICATA – copie n°k » ; (4) mentions du ticket : version du logiciel (6.3.0), identifiant de caisse (C01), nombre de lignes, extrait de signature (caractères 3, 7, 13, 19) ; (5) **archive signée** (format LUXYRA-NF525-ARCHIVE-1, empreinte SHA-256) et page publique de vérification `/verif-nf525` (vérification locale des signatures, chaînes, séquences et recalcul des tickets). Contrôles : vérification indépendante Node.js des signatures (valide / altérée refusée), archive du Salon Démo vérifiée « intègre », la même archive avec un montant modifié est détectée. Excellence Coiffure : 754/754 tickets, 123 Z, 5 ZM, 1 CR signés.
- **2026-10-11 (soir, suite)** — Préparation à l'audit (version 6.4.0, version mineure : aucun format de données signées modifié), décidée par l'éditeur. (1) **Archives** : l'empreinte SHA-256 de chaque archive exportée est enregistrée dans `nf525_archives_signees` (inaltérable) puis **signée** (chaîne AR) ; l'archive contient désormais aussi les clôtures mensuelles, annuelles et d'exercice ; option « remise à l'administration » (JET 295). (2) **Autocontrôle d'intégrité quotidien** (cron `nf525-verif-quotidienne`, 03:40) : recalcul des données signées, vérification de chaque signature et du chaînage ; toute anomalie est inscrite au JET (code 90). Premier passage : 1 391 signatures contrôlées, 0 anomalie. (3) **JET** : codes R19 ajoutés (70/120/125 mode dégradé, 220/230/240, 280 contrôle fiscal, 295, 400 exercice, 410 identification de l'assujetti, 901 réimpression de Z) ; les événements déjà inscrits ne sont pas modifiés. (4) **Mentions** : bande Z avec ventes / retours, GT perpétuel réel et absolu et extrait de signature ; duplicata avec extrait de sa propre signature ; ticket avec opérateur de caisse, type d'opération et nature de la vente ; avertissement de responsabilité avant clôture manuelle ; écran « Identification du logiciel » ; tickets de la démonstration marqués « SIMULATION – document factice ». (5) **Durcissement** : le déclencheur `tickets_block_post_cloture` ne fait plus d'exception pour les avoirs (`is_avoir`) — aucun enregistrement ne peut être daté d'une journée clôturée ; vérification préalable : 0 avoir en base, aucun effet sur l'existant.
- **2026-10-11 (soir, suite 2)** — Mise en conformité de la correction du mode de règlement **le jour même** (avant la clôture Z), décidée par l'éditeur : la fonction `corriger_reglement_rdv` modifiait jusqu'ici le mode de paiement **du ticket enregistré** (table `tickets`). Elle ne le fait plus : le changement est désormais tracé par une **pièce de correction** (`corrections_reglement`, opérations de plus et de moins, chaînée, signée, marquée `avant_cloture`) ; seul le rendez-vous (donnée de gestion) est mis à jour pour la caisse du jour, si bien que la clôture Z du jour reflète le mode réellement encaissé. Les restitutions fondées sur les rendez-vous (bande mensuelle, journal des ventes) n'ajoutent pas une seconde fois ces pièces ; le FEC (fondé sur les tickets) les applique. Le ticket imprimé et ses duplicatas mentionnent la pièce. Vérification préalable : la fonction n'avait **jamais été utilisée** (0 trace dans le journal pour tous les établissements) ; essai en transaction annulée sur le Salon Démo : ticket inchangé, pièce créée (CB −25,00 / espèces +25,00). Aucune donnée existante modifiée.
- **2026-10-11 (soir, suite 3)** — Duplicatas : l'indicateur « ticket imprimé » ne pouvait pas être enregistré sur un rendez-vous encaissé (protégé), si bien qu'une réimpression après rechargement de l'application n'était pas toujours marquée DUPLICATA. Désormais toute impression depuis l'historique est un duplicata numéroté et signé ; seul le ticket qui vient d'être encaissé est un original. Traces JET ajoutées : gestion des opérateurs (130) et exports de données (110). Aucune donnée existante modifiée.
- **2026-10-11 (soir, suite 4)** — Version 6.5.0 (mineure) : **identification des postes de caisse**, décidée par l'éditeur pour les établissements qui encaissent sur plusieurs appareils. Chaque appareil reçoit un numéro de poste (P01, P02…) attribué par le serveur (`nf525_postes`, fonction `nf525_poste`), jamais supprimé ni renuméroté ; ajout d'un poste inscrit au JET (code 126). La caisse logique reste unique (C01) avec une seule numérotation et une seule chaîne par établissement : le format des données signées est inchangé. Le poste est enregistré avec chaque ticket (données du ticket), imprimé sur le ticket et indiqué à chaque démarrage (JET 80). Aucune donnée existante modifiée.
- **2026-10-11 (soir, suite 5)** — Réinitialisations en période d'essai rendues traçables, décision de l'éditeur (le bouton est conservé pour les établissements qui testent avec leurs proches) : `reset_ventes_test_salon` et `factory_reset_salon` copient d'abord **toutes** les données fiscales de l'établissement (tickets, clôtures des 4 niveaux, corrections, duplicatas) dans `nf525_archives_purge` (inaltérable, empreinte SHA-256), puis effacent ; l'événement est inscrit au JET (code 200) avec l'identifiant et l'empreinte de l'archive. Le journal d'audit n'est **plus jamais effacé** (la réinitialisation complète le supprimait). Les grands totaux perpétuels incluent les tickets archivés (jamais remis à zéro). La signature reprend après une réinitialisation sans rupture de chaîne ; l'autocontrôle vérifie les enregistrements effacés sur leur copie archivée ; l'archive signée exportée et l'outil public intègrent ces copies. Essais en transaction annulée sur le Salon Démo (les deux réinitialisations) : archive créée (8 tickets, 1 clôture, 1 correction, 2 duplicatas), JET 200 inscrit, journal conservé, grands totaux inchangés. Aucune donnée existante modifiée.
- **2026-10-11 (soir, suite 6)** — Décision de l'éditeur : les ventes de test effacées pendant l'essai **ne comptent pas** dans le chiffre d'affaires ni dans les grands totaux perpétuels de l'établissement (les compteurs démarrent à la mise en service réelle). Les grands totaux sont recalculés sans les tickets archivés ; pour revérifier une clôture signée avant la réinitialisation, le calcul se fait tel qu'à l'instant de sa signature (`nf525_grands_totaux(salon, date, instant)`, signature `nf525-sign` v4). Avant de s'abonner, un établissement en essai qui a des encaissements est invité à effacer ses ventes de test (après l'essai, l'effacement est impossible). Autocontrôle complet après déploiement : 1 402 signatures, 0 anomalie.
- **2026-10-11 (soir, suite 7)** — Les ventes de test restent effaçables **jusqu'à l'abonnement** (et non plus seulement jusqu'à la fin des 14 jours) : fonction `essai_reinitialisable` (statut « essai », jamais abonné, fin d'essai depuis moins de 30 jours), utilisée par `reset_ventes_test_salon`, `factory_reset_salon` et la fonction serveur `salon-factory-reset` v6. Après la fin de l'essai l'application est bloquée (aucun encaissement possible) jusqu'à l'abonnement ; l'écran de fin d'essai propose d'effacer les ventes de test avant de s'abonner. Dès l'abonnement, l'effacement est refusé.
- **2026-10-11 (soir, suite 8)** — Information et choix explicite avant l'abonnement : quand un établissement en essai a des encaissements, l'écran d'abonnement (et tout chemin menant au paiement) exige de choisir « C'étaient des tests : je repars de zéro » (effacement archivé, JET 200) ou « Ce sont de vraies ventes : je les conserve » (inscrit au journal, action `MISE_EN_SERVICE_REELLE`, JET 260). Information préalable sur la page d'inscription, dans le contrat d'abonnement (version 1.6, art. 2) et les CGV (art. 3, en vigueur au 11/10/2026).
- **2026-10-11 (soir, suite 9)** — Version 6.6.0 : **mode test (mode école) puis caisse réelle**, décidé par l'éditeur pour supprimer toute ambiguïté sur les ventes de l'essai (exigence « mode école » : données marquées dès leur création, justificatifs « factices », mode visible, entrée/sortie tracées, archivage). Chaque établissement a un mode de caisse (`salons.mode_caisse`) : les nouveaux comptes démarrent en **test** (JET 100), Excellence Coiffure est en **réel**, le Salon Démo et Delphinecoiff en test. Chaque ticket et chaque clôture reçoit le mode **posé par le serveur** à la création (non modifiable). En mode test : bandeau « MODE TEST », mention « TEST – document sans valeur fiscale » sur tickets et bandes Z. **Passage en caisse réelle** (`nf525_passer_en_reel`) : irréversible, obligatoire avant l'abonnement (automatique si un abonnement est enregistré alors que la caisse est en test) ; les données de test sont archivées (`nf525_archives_purge`) puis retirées (rendez-vous à venir conservés) ; JET 105 et 260 ; compteurs à zéro. En caisse réelle, aucun effacement n'est possible (`essai_reinitialisable` exige le mode test). Cas unique des encaissements antérieurs au 11/10/2026 (Delphinecoiff, Salon Démo) : au passage, le titulaire déclare s'il s'agissait de tests (archivage) ou de vraies ventes (conservées, déclaration au JET 260). Essai en transaction annulée sur le Salon Démo : ticket marqué « test » malgré une valeur « reel » envoyée par le client, conservation refusée pour des tickets de test, passage effectué (9 tickets archivés, 5 rendez-vous à venir conservés), JET 200/105/260, effacement refusé ensuite. Contrat 1.7 (art. 2), CGV (art. 3), page d'inscription, page Pro (FAQ), centre d'aide, page sécurité et assistant mis à jour.
- **2026-10-11 (soir, suite 10)** — Revue de sécurité des ajouts du jour : fonction `essai_reinitialisable` retirée au public non connecté, fonctions de déclencheur JET non appelables directement, chemin de recherche figé pour `nf525_jet_code` / `nf525_jet_libelle`. Contrôles : toutes les nouvelles tables sous RLS, Excellence Coiffure en caisse réelle (ticket d'essai en transaction annulée marqué « reel »), autocontrôle des signatures sans anomalie. Aucune donnée modifiée.
- **2026-10-11 (nuit)** — Renforcements décidés par l'éditeur (version 6.6.0, sans changement de format des données signées existantes) : (1) **factures clientes signées** (nouvelle chaîne FA, `nf525-sign` v5 ; 0 facture existante) et incluses dans l'archive signée ; (2) **archive annuelle automatique signée** : son empreinte est enregistrée dans `nf525_archives_signees` (motif « annuelle ») puis signée (chaîne AR) ; (3) **ancrage externe quotidien** (cron `nf525-ancrage-quotidien`, 04:10 UTC) : empreinte SHA-256 des têtes de chaînes de chaque établissement enregistrée dans `nf525_ancrages` (inaltérable) et envoyée par courriel à l'éditeur (support@luxyra.fr) — preuve datée hors de la base contre une restauration à un état antérieur ; premier ancrage le 11/10/2026 (empreinte 64B1A735BE10CED5…) ; (4) **alerte immédiate de l'éditeur** sur toute anomalie de l'autocontrôle (journal d'audit `NF525_SIGNATURE_KO` → JET 90 + alerte critique) ; (5) **tests nocturnes des protections** (`nf525_tests_protections`, cron 03:50 UTC, table `nf525_tests_nuit`) : chaque nuit, tentatives de modification/suppression de tickets, clôtures, signatures, JET, corrections, journal, retour en mode test et effacement en caisse réelle — toutes doivent être refusées, sinon alerte. **Premier passage : une faille détectée** — la suppression d'un ticket restait possible pour le rôle serveur, une connexion directe à la base ou un compte administrateur (déclencheurs `ticket_nf525_delete` et `tickets_nf525_protect`). Corrigé immédiatement : suppression et modification des données sensibles d'un ticket interdites pour **tous** les rôles, sauf déverrouillage explicite et tracé de l'éditeur. Second passage : 11 protections sur 11 refusent. La faille n'a jamais été exploitée : les numéros de tickets de chaque établissement sont continus et l'autocontrôle des signatures (1 405 contrôles) ne relève aucune anomalie. L'alerte du premier passage est inscrite au journal (NF525_TEST_NUIT_KO).
- **2026-10-12** — Robustesse du démarrage hors connexion (service worker de la caisse `sw.js`, v22), décidée par l'éditeur après un écran blanc sur un téléphone (résolu en effaçant les données du site ; aucune vente perdue : aucun mode dégradé dans le journal, tickets du jour tous présents sur le serveur). (1) Une seule copie par fichier dans le cache de l'application (clé sans paramètres d'URL ; auparavant chaque variante était conservée et le cache grossissait sans limite) — les anciennes copies sont reprises (la plus récente de chaque fichier) puis purgées. (2) Sur réseau très faible, si une copie existe, l'application s'ouvre sur celle-ci après 4 secondes au lieu d'attendre indéfiniment ; la réponse du réseau met le cache à jour pour l'ouverture suivante. Le service worker ne gère que le cache des fichiers de l'application : il n'accède jamais à IndexedDB (données de caisse et file des encaissements hors connexion) et n'intercepte ni les écritures (POST) ni les appels aux serveurs de données. Aucune donnée fiscale concernée.
- **2026-10-12 (soir)** — Fausse alerte du test nocturne des protections (12/10, 03:50 UTC : « journal audit : suppression ACCEPTEE »). Cause : le test choisissait la **dernière** ligne du journal d'audit, qui était ce jour-là une erreur d'affichage d'une page publique (`JS_ERROR_PUBLIC`) — catégorie technique effaçable par conception (déclencheur `audit_log_inalterable`, liste blanche JS_ERROR / JS_CONSOLE_ERROR / JS_ERROR_PUBLIC). La tentative a été annulée dans le test lui-même : aucune ligne n'a été supprimée. Correction : `nf525_tests_protections` cible désormais la dernière ligne **non technique** du journal. Nouveau passage immédiat : 11 protections sur 11 refusent. Aucune donnée fiscale concernée.
- **2026-10-12 (soir, suite)** — Tests finaux sur le Salon Démo (mode test), tous conformes : tickets n°9 à 11 (espèces ; remise + paiement mixte ; bon cadeau + complément), avoir n°12 annulant le ticket n°4 de la veille (ticket d'origine intact), clôture Z n°2 (70,80 €, tiroir juste), archive signée vérifiée (54/54 signatures, 12/12 tickets recalculés, falsification détectée), FEC équilibré, passage en caisse réelle (archive de purge, JET 200/105/260, effacement et retour en test refusés). Corrections d'**affichage uniquement**, validées par l'éditeur (aucune donnée signée ni montant modifié) : (1) le bon cadeau utilisé apparaît sur le ticket sous « BON CADEAU BC-… (DÉJÀ ENCAISSÉ À LA VENTE) » ou « BON CADEAU OFFERT » au lieu de « REMISE TICKET », et la bande Z indique « dont bons cadeaux utilisés » ; (2) mention « MODE TEST – SANS VALEUR FISCALE » ajoutée au récapitulatif Z affiché après la clôture et à la Z envoyée par e-mail ; (3) la fenêtre de passage en caisse réelle annonce le nombre exact d'encaissements de test archivés (y compris ceux enregistrés avant la mise en place du mode test).

## 2026-10-12 — Fermeture définitive d'un établissement (remplace la suppression) + fermeture du Salon Démo

- **Constat** : la suppression du Salon Démo échouait (`audit_log_salon_id_fkey`) — `admin_delete_salon_cascade` tentait d'effacer tout l'historique NF525, ce qui est contraire à l'obligation de conservation de 6 ans (art. L102 B LPF). La transaction a été annulée : rien n'avait été effacé.
- **Accord** : Alexandre, 12/10/2026 (« oui fais ca »).
- **Changements (migrations `fermeture_definitive_etablissement`, `fermeture_admin_log_et_garde_suppression`)** :
  - `salons.ferme_le / ferme_motif / ferme_par` ;
  - `salon_a_historique_fiscal(uuid)` : mode réel, tickets, clôtures (Z, mensuelles, annuelles), factures, archives, archives de purge, signatures ;
  - `admin_delete_salon_cascade` : refuse désormais la suppression s'il existe un historique fiscal (renvoie « Utilisez Fermer définitivement ») ;
  - `admin_fermer_salon(uuid, motif, opérateur)` : retire la vitrine (recherche + page de réservation), annule les réservations en ligne à venir (sans e-mail ni SMS ; refus si acompte payé ou empreinte en cours), anonymise les fiches clientes et réservations, efface les questionnaires santé, désactive l'équipe, passe le statut à `cancelled` (Mode archives en lecture seule pour le gérant). **Aucune donnée fiscale n'est touchée** (tickets, clôtures, signatures, JET, archives, factures). Trace : audit `ARRET_CAISSE` → **JET 40** + `admin_log SALON_FERME` ;
  - `salons_vitrine_sync` : un établissement fermé n'est jamais remis dans la vitrine.
- **Exécution sur le Salon Démo** (ad3f2257…) : essai à blanc annulé, puis fermeture réelle à 22h32 : 6 fiches anonymisées, 1 réservation à venir annulée, vitrine retirée. Contrôle après : 66 signatures, 1 archive de purge et le JET intacts (47 → 48, la nouvelle entrée est le code 40).
- **Complément 12/10 (soir)** : aucune notification pendant une fermeture (`luxyra.fermeture` lu par `trg_notif_rdv_online` — la fermeture du Salon Démo avait envoyé « RDV annulé ») ; vue admin d'un établissement fermé : ouverture directe en Mode archives (le stockage de la vue admin est en mémoire, le bouton « Accéder à mes archives » rechargeait sans effet) ; Mode archives : bouton « Archive fiscale complète (signée) » + explication quand aucun encaissement réel (les encaissements test sont dans l'archive scellée). Aucune donnée fiscale modifiée.
- **Correction 12/10 (nuit)** — sur remarque d'Alexandre : la fermeture n'anonymise plus les fiches et réservations liées à un **compte client Luxyra** (elles suivent la règle des 3 ans d'inactivité du compte : le client garde son historique). Réparation Salon Démo : 4 réservations en ligne et la fiche liée au compte client mobz57 restaurées depuis le compte (noms retrouvés dans les notifications). La fermeture libère aussi l'adresse du site (sous-domaine, lien, alias) et le même e-mail peut ouvrir un nouvel établissement (les archives de l'ancien restent consultables depuis la comptabilité). Aucune donnée fiscale touchée.

## 2026-10-12 (nuit) — Conservation 6 ans automatique, comptes clients inactifs, suppression réparée

- **Accord** : Alexandre, 12/10/2026 (« 1 tu peux mettre en place. 2 tu fais comme dit selon la cnil »).
- **Suppression à 6 ans** : `lx_prive.salon_fin_conservation` (6 ans après la résiliation/fermeture ou la dernière opération de caisse si plus tardive), `retention_6ans_candidats`, `purge_salon_6ans` (service seulement ; refuse si délai ou préavis de 30 j non respecté ; trace dans `salons_purges` + `admin_log SALON_PURGE_6ANS`). Le job du worker (cron 03:00 UTC) existait mais faisait un simple DELETE qui aurait échoué : il passe maintenant par ces fonctions, supprime aussi les fichiers (justificatifs, photos) et le compte de connexion du gérant s'il n'a plus d'établissement.
- **Bug de suppression corrigé** (origine de l'erreur `audit_log_salon_id_fkey`) : dans `admin_delete_salon_cascade`, chaque ligne de journal effacée recréait une trace « bypass » puis une ligne JET 900 → boucle, puis échec FK. Les déclencheurs `audit_vers_jet` et `trg_nf525_integrity_alert` sont désactivés le temps de la transaction (comme `audit_log_nf525_inalterable` déjà). Testé à blanc sur le Salon Démo (simulé à 7 ans) : 384 lignes, 0 restante, déclencheurs réactivés ; transaction annulée, rien supprimé en vrai.
- **Comptes clients inactifs 3 ans (CNIL)** : `lx_prive.client_derniere_activite`, `comptes_inactifs_candidats`, `purge_compte_client_inactif` (préavis e-mail 30 j, une connexion l'annule), job worker `runComptesClientsInactifs`. Fiches des établissements en activité : seulement déliées ; établissements fermés : anonymisées.
- **RGPD J+60** (`rgpd_purge_salon`) : ne supprime plus les fiches/réservations liées à un compte client Luxyra.
- Aucune donnée fiscale d'un établissement en conservation n'a été modifiée.
- Vérification finale : tests de protection NF525 11/11 refusés ; purge 6 ans retestée à blanc (OK, annulée) ; `salon_a_historique_fiscal` restreinte à l'admin / au gérant de l'établissement.

## 2026-10-13 — Contrôle de nuit « conservation 6 ans » (tâche automatique, accord d'Alexandre, demande n°3)

- Constat : alerte critique « TICKETS DIMINUE 774→772 » à 04:00 — fausse alerte due au passage en caisse réelle du Salon Démo (tickets de test placés dans l'archive scellée nf525_archives_purge, cf. 12/10).
- Correction (faite par la tâche automatique « Luxyra file Claude » à 09:57 avec l'accord d'Alexandre) : `nf525_take_inventory_snapshot` compte désormais tickets et clôtures en base + ceux de l'archive scellée des tests ; alerte seulement si ce total baisse. Aucun ticket, clôture ni signature modifié. Essai à blanc fait avant (cas normal sans alerte, ticket manquant simulé avec alerte). Vérifié en session PC le 13/10.

## 2026-10-13 — Fusion de fiches clients sans toucher à la caisse (accord d'Alexandre)

- Constat : 12/10 23 h 40, Excellence Coiffure, fusion de 2 fiches (cliente du salon + compte en ligne avec un autre téléphone) refusée : « Ticket #7 verrouillé (clôture Z effectuée) ». La fusion supprimait la fiche en double ; la suppression tentait de modifier un ticket clôturé, refusé à juste titre par les protections de la caisse.
- Correction (`merge_client_duplicates`) : RDV et tickets rattachés ligne par ligne seulement quand la caisse le permet ; un ticket clôturé n'est JAMAIS modifié. S'il reste des tickets/RDV clôturés sur la fiche en double, elle n'est plus supprimée mais marquée `fusionne_dans` (cachée, sans e-mail ni compte en ligne, points remis à 0 car additionnés sur la fiche gardée). L'application affiche ces tickets dans l'historique de la fiche gardée (correspondance en mémoire, lecture seule). Détecteur de doublons : ignore les fiches fusionnées.
- Essai à blanc (annulé) sur le cas réel : 2 RDV déplacés, 1 ticket clôturé laissé intact, points 1 + 2 = 3, ancien numéro en téléphone 2. Aucune fusion réelle faite par Claude : Amandine la refait elle-même dans l'application.
- Prévention : une réservation en ligne est rattachée à la fiche existante si une seule fiche a le même nom + prénom et pas d'autre e-mail.

## 2026-10-13 — Plusieurs métiers par établissement
- Ajout `salons.metiers_autres` (activités secondaires), réglage « Autres activités », inscription, recherche, annuaire, fiche client/technique, admin.
- Aucun impact caisse : ni tickets, ni clôtures, ni JET, ni chaînage modifiés. Changement de réglage tracé (audit CONFIG_METIERS).

## 2026-10-13 — Infos établissement non enregistrées (salon sans SIRET)
- Cause : un salon « en cours d'immatriculation » (SIRET vide) envoyait `siret:""` ; le contrôle SIRET le refusait et TOUTE la mise à jour des infos (note des tickets, logo, téléphone…) échouait en silence. Signalé par O'R STUDIO (note des tickets qui disparaît).
- Correctif app : SIRET envoyé seulement s'il est rempli ; message d'erreur visible si l'enregistrement échoue. Contrôle SIRET en base inchangé (verrou intact).
- O'R STUDIO : coordonnées GPS renseignées (adresse officielle BAN) pour la carte du site. Aucune donnée de caisse touchée.
- Ajout du SIRET dans l'app (salon en cours d'immatriculation) : saisie tolérante (espaces/points/tirets), champs d'identification VIDES complétés depuis le répertoire officiel (TVA intracom, forme juridique, adresse, gérant) sans écrasement, avertissement si l'adresse officielle diffère, traçabilité SIRET_AJOUTE + CONFIG_IDENTITE. SIRET toujours verrouillé ensuite (trigger inchangé).
- Contrôle complet O'R STUDIO avant abonnement : TVA cohérente (micro, franchise 293 B, taux 0, mention sur tickets), aucun ticket encore émis, adresse/gérant OK. Corrigés : (1) photos brutes (fond d'écran 2 Mo dans la configuration, renvoyée à chaque sauvegarde ; logo 2,6 Mo chez Delphinecoiff) -> images réduites à l'envoi (logo 512 px, fond 1600 px) et réduction automatique une fois des images déjà trop lourdes ; (2) « Autres activités » : la colonne n'était pas écrite par la sauvegarde de configuration -> écriture directe ; (3) garde SIRET vide aussi dans l'ancienne sauvegarde. Aucune donnée de caisse touchée.
- Audit des erreurs serveur (24 h) : (1) tout réglage enregistré en colonne affiche désormais une alerte s'il échoue (plus d'échec silencieux), SIRET vide jamais envoyé ; (2) envoi de justificatifs : erreur affichée si le rattachement échoue ; (3) journal des inscriptions (admin) : l'insertion était refusée (utilisateur déjà connecté) -> règle ajoutée + rattrapage des inscriptions des 90 derniers jours ; (4) journal des actions admin : identifiant admin mal référencé -> chaque action tracée échouait, corrigé par correspondance automatique ; (5) alerte « erreur serveur » sans salon : le mail et la notification étaient annulés, corrigé. Tickets : numérotation continue vérifiée (Excellence 1-764, Delphinecoiff 1-12, aucun trou ; le doublon de 09:55 était un renvoi du même ticket, refusé).
- Recherche (luxyra.fr/recherche) : requête cassée par la modification multi-métiers du jour (nom de table erroné) -> corrigée.
- Delphinecoiff (ancien compte de Delphine, remplacé par O'R STUDIO) : site, réservation et boutique désactivés à sa demande (via Alexandre). Un site désactivé est désormais exclu partout : page salon (404), recherche, accueil, annuaire (pages ville + comptes), sitemap v16. Aucune donnée de caisse touchée.
- Relecture indépendante de toutes les modifications du jour : 4 points corrigés — bouton « Voir les autres prestations » inopérant si la catégorie contient une apostrophe ; réduction automatique du logo / fond d'écran qui pouvait écraser une image changée dans les secondes suivant l'ouverture ; « Ajouter une séance » ouvre désormais le métier de l'onglet affiché.
- Téléphone : (1) « Prochaine dispo » en soirée affichait un créneau déjà passé (« Aujourd'hui à 14:00 » à 23h42) : le délai minimum qui bascule après minuit était appliqué au mauvais jour -> corrigé (fn_salon_next_available_slot) ; (2) menu mobile du site (37 pages : accueil, pro, tarifs, aide…) transparent et superposé au contenu -> plein écran opaque ; (3) annuaire : boutons « C'est votre établissement ? » / « Établissement fermé ? » qui débordaient de l'écran -> empilés.

## 2026-10-13 (soir) — Application et site clients : améliorations validées par Alexandre
- Onglet « Mon compte » dans la barre de l'application ; ouverture directe d'un onglet du compte (?tab=).
- Recherche : 3 prochains créneaux cliquables par établissement (RPC fn_salon_next_slots) ; réservation pré-positionnée sur le jour/heure (?d=&h=), heure retenue seulement si elle convient à la prestation.
- Fiche établissement : lectures en parallèle (affichage plus rapide).
- Compte client : rappel « reprendre le même RDV » (écart habituel, 6 semaines par défaut), ajout à l'agenda (.ics), itinéraire ; idem sur l'écran de confirmation.
- Avis : notes par critère + 3 photos max (bucket avis-photos public, avis-create v9) ; favoris (table client_favoris, /api/client/favoris).
- Relecture indépendante : 5 points corrigés avant mise en ligne. Aucune donnée de caisse touchée.
- Alerte « une place s'est libérée » : table creneau_alertes ; déclencheurs (après mise à jour seulement si annulation / statut / date / heure changent) sur rdv_online et appointments, qui n'écrivent RIEN dans ces tables (simple appel au worker, erreurs ignorées) ; e-mail aux clients dont la prestation tient dans la durée libérée ; la place revient au premier qui réserve. Tests de protection NF525 : 0 échec après ajout.
- Double réservation : verrou par salon + jour dans rdv_online_block_double_booking (deux réservations simultanées traitées l'une après l'autre, la seconde refusée si chevauchement) ; une réservation en attente de paiement d'acompte bloque le créneau 35 min ; page de paiement Stripe des acomptes valable 31 min.
- Recherche (téléphone) : la carte se recadre sur tous les résultats à l'ouverture.
- Stripe (accord d'Alexandre) : Google Pay activé et Klarna désactivé, sur le compte Luxyra (abonnements, SMS) et pour les comptes des salons (acomptes, empreintes) — appliqué en mode test puis en production. Vérifié : charges directes actives (paiements des salons encaissés sur LEUR compte Stripe, 0 % de commission Luxyra), abonnements et packs SMS encaissés sur le compte Luxyra, tarifs Essentiel 14,99 €, Pro 24,99 €, Pro Fondateur 14,99 € = identifiants utilisés par le worker, 2 webhooks actifs sans erreur.
- Stripe, design (accord d'Alexandre) : couleurs de marque or #c8a84e / noir #0b0b0b ; page de paiement Luxyra (fond noir, bouton or, police Inter). Paiements des salons : page aux couleurs Luxyra avec le NOM et le LOGO du salon (logo Luxyra si le salon n'en a pas), via branding_settings ; si Stripe refuse l'habillage, le paiement repart automatiquement sans habillage (jamais de paiement bloqué). Nouvelle adresse /api/salon-logo/<id>.png.
- Notifications clients (accord d'Alexandre) : tables client_notifications et client_push_subscriptions (RLS, accès serveur seulement) ; fonction lx_notifier_client ; déclencheur APRÈS mise à jour de rdv_online (statut / modification par le salon / réponse à une demande de modification) qui n'écrit QUE dans client_notifications (aucune écriture dans rdv_online, aucune table de caisse) ; send-push v20 (cible client, réservé au serveur/admin) ; place libérée aussi dans l'appli ; cloche « Notifs » + onglet Notifications ; service worker existant enregistré sur la seule page compte.html (portée distincte de la caisse /app, sw.js NON modifié). Appli pro : nom court « Luxyra Pro ». Tests de protection NF525 relancés après ajout.
- 13/10 : compte client — adresse, code postal et ville obligatoires à la création (site salon, espace client, appli ; lx-signup v7 les enregistre dès la création) + rappel « Complétez votre adresse » pour les comptes existants. Appli clients : aucun lien vers l'espace pro (page /pro ouverte depuis l'appli : lien « Se connecter » masqué). Aucune donnée de caisse touchée.
- 13/10 : centre d'aide réservé à l'application pro (demande d'Alexandre) : liens « Aide » retirés du site public, du site pro, de l'appli clients et de l'annuaire ; pages /aide en noindex ; sitemap v17 sans /aide. Annuaire : bouton « Établissement fermé ? » réparé (Uni-K Sarreguemines retiré). iPhone : icône Luxyra pour « Sur l'écran d'accueil ».
- 13/10 : comptes clients — ville choisie dans la liste des communes du code postal (champ verrouillé, saisie libre seulement pour un code étranger ou si le service des communes ne répond pas) ; iPhone : bandeau d'installation affiché une seule fois. Aucune donnée de caisse touchée (app.html non modifié).
- 13/10 : comptes clients — choix du pays (France, Allemagne, Luxembourg, Belgique, Suisse ; colonne clients_luxyra.pays, lx-signup v8, lx-profile v7) : liste des communes pour la France, saisie libre de la ville pour les autres pays ; code postal contrôlé selon le pays.
- 13/10 : réservation en ligne — le réglage « Intervalles » (15 / 30 / 60 min) de l'application est maintenant appliqué par le site (il était ignoré : toujours 15 min) et par les prochains créneaux de la recherche (pas aligné sur l'ouverture). Les 4 établissements sont à 15 min : aucun changement visible aujourd'hui. Aucune donnée de caisse touchée.
- 13/10 : réservation en ligne — horaires réels du jour calculés de la même façon partout (calendrier, créneaux, prochain créneau) : avec « Pas de préférence », les horaires personnalisés des collaborateurs comptent, et la fermeture exceptionnelle d'UN collaborateur ne ferme plus le jour pour tous ; motif de fermeture affiché. Recherche : prochains créneaux recalculés comme le site (horaires de chaque collaborateur, personnalisés, absences, durée des rendez-vous, intervalle). Aucune donnée de caisse touchée.
- 13/10 : remboursement PARTIEL d'un acompte en ligne (accord d'Alexandre) : client absent / prévient trop tard -> l'établissement conserve tout ou rembourse une partie (% ou €) ; route /api/rdv/acompte-rembourser (propriétaire vérifié, verrou anti double-clic, refusée si la partie conservée est déjà en caisse) ; colonne rdv_online.acompte_rembourse_montant ; le ticket scellé « Acompte conservé » porte UNIQUEMENT la partie conservée (libellé avec le montant remboursé) ; exports TVA paiements en ligne et livre des recettes : partie remboursée et partie conservée sur 2 lignes. Notification client : pas de message « annulé par l'établissement » pour une absence. Chaînage, clôtures, JET : inchangés.
- 13/10 (relecture indépendante) : SÉCURITÉ — un client ne peut plus « ré-annuler » un rendez-vous déjà annulé (l'acompte conservé d'un client absent pouvait être remboursé) : annulation client limitée aux rendez-vous en attente/confirmés. Remboursement partiel : refusé si l'acompte doit être remboursé en entier (annulation par l'établissement ou dans les délais), verrou commun avec la création du ticket « Acompte conservé » (montant relu après le verrou), enregistrement vérifié (alerte critique sinon).

## 2026-10-14 — Acomptes dans tous les documents + article libre + prestation sur devis (accord d'Alexandre)
- Recherche des règles (BOI-TVA-DECLA-30-10-30 §30/35/50/90, BOI-TVA-BASE-10-10-50 §260/310, BOI-TVA-BASE-20-20, CGI 269-2-c, 50-0/102 ter, F23266) : TVA des prestations exigible à l'encaissement des acomptes ; sommes conservées (no-show, annulation tardive) imposables par prudence ; corrections par opérations en plus/en moins ; ligne de transaction complète (libellé, prix, taux).
- Rapports et exports corrigés : rapport mensuel PDF (ligne « Payé en ligne » manquante), Excel (vraie répartition des règlements), déclaration URSSAF / pack / Excel micro (recettes ENCAISSÉES : acomptes en ligne au jour du paiement), FEC (paiements en ligne au compte 580100 et non 512, libellés « acompte » explicites), journal des ventes (libellés acompte), journal de caisse CSV / pack / Excel (mode de paiement détaillé avec l'acompte en ligne), bande Z mensuelle (libellé), bande de contrôle mensuelle (même filtre que la Z, libellés réels, règlement détaillé), relevés Stripe (remboursements partiels, frais conservés par Stripe), récap TVA (ajustement des paiements en ligne + montant à déclarer), historique des remboursements (une ligne par remboursement, à sa date), reçu d'acompte = ticket scellé imprimé, ticket réglé par l'acompte en ligne (« En ligne (Stripe) »), statistiques (acomptes sur des lignes à part, plus de double comptage), ticket « Acompte conservé » rattaché à la fiche du client, date réelle de paiement des acomptes en ligne (jamais vide : déclencheur).
- Pack comptable : + paiements en ligne (TVA), + livre des recettes (micro), + acomptes non soldés ; annulations = même fichier que l'export (annulations d'acompte comprises).
- Nouveau : « Acomptes reçus non soldés » à la fin du mois (clôture/bilan, compte 4191).
- Article libre en caisse (intitulé obligatoire + montant + type prestation/produit = taux de TVA de l'établissement) : ligne normale du ticket scellé (flag isLibre), journal ARTICLE_LIBRE.
- Prestation « sur devis » (services.prix_sur_devis) : prix saisi à l'ajout au ticket ; « Sur devis » sur le site, réservation par demande.
- Chaînage, numérotation, clôtures, JET : inchangés.
- Relecture indépendante (14/10) : acomptes en caisse détectés par les lignes du ticket (après rechargement), bande de contrôle : plus de double déduction des annulations, panier moyen hors contre-tickets ; lecture paginée ; TVA de l'ajustement par taux (prestations/produits) et pour toute entreprise redevable de la TVA ; prestation sur devis : prix exigé avant tout encaissement quel que soit le chemin ; libellé d'article libre sans caractères HTML ; historique des remboursements antérieurs repris ; fichiers du pack nommés par type.

## 2026-10-14 — Audit complet (app pro, app client, site, caisse NF525, comptes) + corrections (demande d'Alexandre)
- 5 audits indépendants puis 2e passe de vérification sur le résultat fusionné, puis 3e contrôle des derniers correctifs.
- Caisse NF525 : file de secours (WAL) ne marque plus « transmis » un envoi échoué (réessais espacés, alerte opérateur ; seuls les refus définitifs « journée déjà clôturée » / « inaltérable » d'un ticket sont abandonnés avec trace WAL_ABANDON ; une clôture Z ou un ticket ne sont jamais abandonnés pour une erreur passagère) ; contrôle « journée ouverte » en mémoire ET en base avant de sceller (vente, acompte, annulation d'acompte, bon cadeau, avoir, modification de ticket ; lecture bornée à 4 s) ; garde anti double appui ; refus d'« Avoir » sur un ticket d'acompte (passer par « Annuler l'acompte ») ; idempotence des tickets par identifiant (index unique tickets(salon_id, raw_data->>'id')) ; relecture du statut avant encaissement (autre appareil) ; écart de numéro serveur tracé (NUM_MISMATCH) ; acomptes en plusieurs versements suivis ; champs de ticket non fiscaux conservés après rechargement (appointments.meta, hors hash) ; Z : nombre de tickets = tickets numérotés (montants inchangés).
- App pro : plus de réécriture de toute l'équipe à chaque changement de page ; enregistrements vérifiés (équipe, prestations/forfaits ligne par ligne, produits, packs, opérateurs, documents, logo, thème, configuration fusionnée entre appareils, site sans ligne de configuration) ; message d'erreur visible au lieu d'un échec silencieux.
- Client / site / serveur : politique d'annulation contrôlée par le serveur, heure de Paris, demandes de modification validées, créneau bloqué 35 min pendant le paiement, retour de paiement vérifié (et page qui restait bloquée sur « Chargement »), aucune correspondance de paiement sans e-mail, désabonnement des notifications à la déconnexion, données du compte précédent effacées, textes échappés (XSS), CGU à l'inscription depuis la page salon, « Pas de préférence » limité aux collaborateurs habilités.
- Notifications app pro : avertissement quand Android confie la demande d'autorisation à l'appli clients installée.
- Tests de protection NF525 relancés après déploiement.

## 2026-10-14 — Acompte en ligne = ticket scellé dès le paiement (accord d'Alexandre)
- Fondement : BOI-TVA-DECLA-30-10-30 §30/§35/§37/§50/§90, référentiel LNE (ex. 3/7/9), TVA à l'encaissement des acomptes (BOI-TVA-BASE-20-20 §30/§70). Conception : docs/acompte_en_ligne_conception.md.
- Paiement Stripe confirmé -> rdv_online.acompte_modele='ticket' (trigger) -> la caisse crée le ticket scellé « Acompte en ligne » (numéroté, chaîné, signé), date de règlement conservée et imprimée ; jamais sur une journée clôturée (journée suivante) ; un seul appareil (verrou + index unique tickets(salon_id, raw_data->>'acompteKey')).
- Ticket du RDV : ligne « Acompte déjà versé (ticket #X) » ; trop-perçu remboursé avant encaissement ; remboursements = tickets négatifs ; absence = rien de plus.
- Transition : acomptes payés avant la mise en service = ancien modèle inchangé (acompte_modele NULL). Insertion publique : champs de caisse forcés à vide. Deux revues indépendantes + corrections, tests NF525 : 0 échec.
- Double vérification finale (2 agents, GO) — derniers durcissements : fonctions lx_acompte_* retirées du rôle anonyme ; file de secours : un RDV déjà encaissé (ticket scellé) n'est jamais abandonné (alerte critique sinon) ; un ticket encaissé n'est jamais retiré de la liste de la caisse. Aucun changement de calcul, de numérotation ni de chaînage.
- Site / compte client (hors caisse) : échappement des textes du salon (adresse, sous-titre, image produit, nom de prestation), libellés « Paiement en attente » / « Refusé » / « Absent », date du jour en heure locale, message clair si le compte existe déjà.

## 2026-10-14 — Synchronisation des données et file de secours (accord d'Alexandre, audit du 14/10)
Aucune donnée scellée modifiée (tickets, clôtures, signatures, JET inchangés). Base : fichier docs/migrations_1014/donnees.sql, à appliquer par Alexandre puis tests de protection NF525 relancés (nf525_tests_protections).
- Numérotation des tickets (inaltérabilité / continuité, BOI-TVA-DECLA-30-10-30 §50-§60) : le déclencheur ticket_nf525_insert prend désormais un verrou transactionnel par établissement (pg_advisory_xact_lock) avant de calculer max(num)+1 et le chaînage ; corps de la fonction inchangé par ailleurs. Deux postes encaissant au même instant ne calculent plus le même numéro. Côté application : refus 23505 sur tickets_num_per_salon -> un nouvel essai immédiat (après contrôle « déjà en base » par identifiant).
- Rendez-vous encaissés (lignes scellées de appointments) : statut et détail des règlements (payments) désormais inchangeables ; annulation seulement dans le sens false -> true (chemin officiel : annulation / contre-ticket, inchangé) ; date d'annulation renseignable une fois puis figée. La correction de règlement avant clôture (corriger_reglement_rdv, trappe tracée) n'est pas affectée. Application : la reprise « colonnes non protégées » n'écrit plus jamais cancelled=false par-dessus une annulation.
- File de secours (mode dégradé, JET 70/120/125) : les entrées d'un AUTRE établissement ne sont jamais rejouées (rejeu automatique et récupération manuelle) ; tickets, clôtures Z et RDV encaissés non transmis ne sont jamais évincés quand la file est pleine (les entrées déjà transmises partent d'abord) ; rejeu automatique à la reconnexion réseau, au retour au premier plan et toutes les 2 min (un seul à la fois) ; une clôture Z n'est jamais rejouée avant des tickets plus anciens non transmis ; une opération de caisse saisie en mode TEST n'est jamais rejouée après le passage en caisse réelle (abandon tracé WAL_ABANDON) ; un refus 42501 sur une clôture n'est plus pris pour « déjà enregistrée » sans vérifier sa présence en base (cas de la session expirée).
- Clôture Z : refusée tant que des tickets de la journée (ou antérieurs) sont encore dans la file de secours de l'appareil, avec message et bouton « Réessayer la transmission » (la Z doit inclure tous les tickets).
- Mode de caisse : relu toutes les 5 min et au retour au premier plan ; un appareil resté ouvert pendant le passage TEST -> réel fait ailleurs est invité à recharger (données de test purgées par le serveur).
- Session expirée : fenêtre de reconnexion sans rechargement (mémoire et file conservées), puis reprise de la transmission ; un autre compte que celui ouvert n'est jamais accepté (déconnexion).
- Chaînage, calcul des montants, signatures, archives : inchangés.

## 2026-10-14 — Audit de la caisse : corrections (accord de l'éditeur, Alexandre, 14/10/2026)

Branche `fix1014-caisse`. Aucune donnée fiscale existante n'est modifiée : aucun ticket, aucune clôture, aucune pièce de
correction, aucun duplicata, aucun événement du JET n'est réécrit ni supprimé ; numérotation, chaînage, format des données
hachées (`TK|…`, `Z|…`, empreinte serveur `num|date|heure|ttc|ht|items|prev|salon`) et des données signées : inchangés.
Script base unique et idempotent : `docs/migrations_1014/caisse.sql` (**non appliqué** à la date de rédaction).

| # | Constat | Correction | Fondement |
|---|---|---|---|
| 1 | Un contre-ticket pouvait être annulé à son tour (boutons visibles, aucun contrôle) ; l'annulation d'un ticket n'inversait pas ses effets de gestion. | Refus d'annuler / modifier / corriger le règlement d'un ticket déjà annulé ou d'un contre-ticket (y compris s'il existe déjà un contre-ticket qui le référence) ; boutons masqués (réimpression et envoi conservés). Au scellement, relevé des effets du ticket (`lxEffets` : fidélité avant/après, bons cadeaux utilisés, séances de forfait, forfaits / bons / cartes vendus, stock), conservé hors empreinte (raw_data / meta) ; à l'annulation, plan d'inversion mémorisé sur le contre-ticket (`lxEffetsInverses`) puis exécuté : points / cagnotte / CA cumulé retirés, bons recrédités (fonction serveur `recrediter_bon_cadeau`), séance rendue, forfait / bon / carte vendus désactivés s'ils n'ont pas servi, stock remis (mouvement « retour »). Tickets antérieurs sans relevé : liste des points à régulariser à la main (journal `ANNULATION_EFFETS_MANUELS`). Une modification de ticket (contre-ticket + nouveau ticket) n'inverse pas les effets (même passage). | BOI-TVA-DECLA-30-10-30 §90 (corrections par opérations en moins, définitives) |
| 2 | Correction du règlement le jour même d'un ticket avec acompte payé en ligne (ancien modèle) : la pièce et le rendez-vous transféraient aussi l'acompte vers le nouveau mode (double comptage en Z). | Seul le solde (prix − en ligne − bon cadeau) change de mode, côté application et côté serveur (`corriger_reglement_rdv`, définition reprise à l'identique sauf ce point). | §90 ; exactitude des totaux de la Z |
| 3 | Acompte versé au salon sur un RDV pris en ligne : perdu au rechargement (non enregistré dans rdv_online). | Reconstitué à chaque chargement / synchronisation depuis ses tickets scellés « Acompte » (moins les annulations d'acompte), et déduit à l'encaissement sur tout appareil (avec l'acompte en ligne conservé s'il existe). | Unicité de l'enregistrement d'une recette |
| 4 | Paiement par bon cadeau : l'acompte déjà versé n'était pas déduit du reste dû (bon sur-débité). | Reste dû = total − déjà réglé − acompte. | — |
| 5 | Bon cadeau débité en base dès sa sélection (panier abandonné / encaissement refusé = bon débité sans vente) ; double appui possible. | Le bon est réservé sur le panier (solde réel relu en base) et débité de façon atomique **au scellement**, juste avant la création du ticket ; échec -> aucun ticket, recrédit automatique des bons déjà débités, message. Un bon ne s'applique qu'une fois par ticket. | Concordance caisse / stock de bons |
| 6 | Le montant d'un acompte payé en ligne était celui envoyé par le navigateur ; la finalisation n'acceptait qu'un paiement inférieur comme anomalie. | Montant relu sur le rendez-vous (`acompte_montant` / `empreinte_amount`), écart refusé ; à la finalisation, montant payé ≠ acompte -> remboursement total immédiat + alerte critique, acompte non enregistré. | Fiabilité de la recette enregistrée |
| 7 | Bons cadeaux utilisés non recopiés sur le ticket : Z « dont bons cadeaux utilisés » à 0, ticket imprimé « REMISE ». | `bonVenduRemise` / `offertRemise` recopiés sur le ticket (raw_data / meta seulement, hors empreinte). | Mentions du ticket et de la Z |
| 8 | Taux de TVA propre d'un produit ignoré dans le HT / la TVA du ticket. | Tickets **futurs** : ligne produit portant un taux particulier (`tvaTaux`, posé uniquement dans ce cas) -> HT / TVA calculés ligne à ligne. Format de l'empreinte inchangé ; tickets existants non concernés. La Z et le FEC gardent la ventilation par taux de l'établissement (à aligner avec la clôture automatique serveur dans une évolution ultérieure). | CGI art. 278 s. ; exactitude de la TVA collectée |
| 9 | Annulation de la remise fidélité incomplète (`remiseAuto` restait) ; remises négatives acceptées. | `remiseAuto` corrigée, règlement recalculé ; remises bornées à [0 ; montant de la ligne]. | — |
| 10 | Forme juridique « EI » = franchise de TVA dans les rapports, même pour une entreprise qui facture la TVA. | Franchise en base (taux 0, art. 293 B) distinguée du régime micro : les rapports n'affichent « TVA non applicable » qu'en franchise (même source que les tickets). | CGI art. 293 B |
| 11 | Corrections de règlement après clôture appliquées à la date du ticket d'origine dans le FEC et le journal des ventes (journal déjà arrêté modifié rétroactivement). | Écritures distinctes à la date de la pièce (`date_correction`, pièce CR n°), entre comptes de trésorerie (somme nulle). | §90 ; arrêté du 29/07/2013 (FEC) |
| 12 | Réimpressions : hash précédent de la Z = avant-dernière Z de la liste ; fond de caisse actuel au lieu de celui du jour ; tickets annulés un autre jour retirés du duplicata ; échec d'enregistrement du duplicata ignoré. | Hash de la Z n° (n−1) ; fond mémorisé à la clôture (anciennes Z : déduit du solde théorique enregistré) ; même règle que la Z (`_lxCaOk`) ; duplicata de ticket : 2 essais puis **impression bloquée** avec message ; duplicata de Z enregistré avant impression (`nf525_duplicata_z` -> JET 901, n° de copie imprimé). | Exigence de numérotation et de traçabilité des duplicatas |
| 13 | Passage en caisse réelle : un comptage en erreur était lu comme 0 ticket. | Passage interrompu avec message si un comptage échoue. | Mode test / réel (JET 105 / 260) |
| 14 | Acompte payé sur un RDV refusé : ticket scellé, mais aucun remboursement (le filet ne traitait que les annulés). | Les RDV refusés avec acompte payé sont remboursés en totalité (filet de nuit et contrôle), puis le ticket négatif « Remboursement acompte en ligne » est créé par le circuit existant. | §90 |
| 15 | Reprise du verrou après 15 min : deux postes pouvaient sceller le même acompte ; le doublon local restait dans la caisse après le refus 23505. | Sur 23505 (clé d'acompte) avec un ticket d'un autre poste : le doublon local (jamais entré au journal scellé) est retiré de la caisse, son rendez-vous local neutralisé hors CA (sans date d'annulation, référence `lxDoublonDe`), le ticket du serveur rechargé ; aucun ticket scellé n'est touché. | Unicité de l'enregistrement |
| 16 | Clôture automatique de nuit : pas de mise au coffre (solde théorique du lendemain faux). | Au premier passage de l'application, même mise au coffre que la clôture manuelle (donnée de gestion, Z automatiques à partir du 15/10/2026). | Gestion de caisse (hors données fiscales) |
| 17 | Exports CSV : injection de formules. | Cellules texte commençant par = + − @ préfixées d'une apostrophe (nombres intacts). | Sécurité des exports |

Contrôles : vérification syntaxique de tous les scripts modifiés ; lectures seules en base (définitions de fonctions, colonnes) ;
aucune écriture en base, aucun déploiement. À faire avant mise en service : appliquer `caisse.sql`, déployer le worker, essais
sur le Salon Démo (voir rapport de la branche).

## 2026-10-16 — Incident : clôture Z n°128 d'Excellence Coiffure supérieure au journal des tickets (accord de l'éditeur, Alexandre Jensen : « oui »)

**Constat.** Z n°128 du 16/10/2026 (créée à 17 h 44, empreinte `4D3D9CDD86CFD7A22E1434DD039A5DC528DA934129543B46EB1655297DA14215`) :
4 tickets / 95,40 € TTC (CB 52,00 €, espèces 43,40 €). Journal des tickets scellés du jour : **3 tickets / 69,40 € TTC
(CB 26,00 €, espèces 43,40 €)** — n° serveur 778 à 780, imprimés 2156 à 2158. Écart : +26,00 € CB et +1 ticket.
Détecté par le contrôle fiscal automatique (`check_fiscal_integrity` §2) et par le contrôle de verrouillage (3 tickets verrouillés pour 4 attendus).
Les tickets scellés sont exacts et n'ont jamais été modifiés.

**Cause.** Le rendez-vous réservé en ligne 501b42c5… encaissé à 16 h 14 (ticket n°2158, n° serveur 780, 26,00 € CB) figurait
**deux fois** dans la liste de l'appareil : l'entrée d'affichage de la réservation (`online_…`) et la ligne du rendez-vous
encaissé (relue en base). Depuis la version du 14/10/2026 (commit e57efc8, « un ticket encaissé n'est jamais retiré de la
liste »), l'entrée d'affichage n'était plus retirée. La clôture, calculée sur cette liste, a compté le ticket deux fois.
Même cause pour le symptôme signalé par l'établissement : le rendez-vous en ligne encaissé apparaissait deux fois au planning.

**Traitement (aucune donnée scellée modifiée ni supprimée : tickets, clôtures, signatures, JET inchangés).**
1. **Z n°128 conservée telle quelle.** Fondement : CGI art. 286-I-3° bis et BOI-TVA-DECLA-30-10-30 (inaltérabilité, §90 :
   toute correction prend la forme d'une opération nouvelle, l'enregistrement d'origine étant conservé).
2. **Événement JET n°515, code 90** (« Défaut d'intégrité détecté ») : n° et empreinte de la Z, montants faux et exacts, cause, version corrective.
3. **Annotation corrective n°1** (nouvelle table `clotures_annotations`, inaltérable — même déclencheur que les clôtures —,
   chaînée SHA-256, empreinte `1AA6945AE24361A0BBFF54909B8429B4AAB8E279DB2B5D4028B82C7BA4C33455`), créée par la fonction
   serveur `nf525_annoter_cloture` qui **relit elle-même les montants exacts dans le journal des tickets** (refus si les montants
   ne correspondent pas au journal ou si la Z est conforme) ; inscrite au **JET n°516, code 900** (« Intervention éditeur tracée »),
   signé ES256 avec le JET. L'annotation est imprimée sur tout duplicata de la Z n°128, affichée dans l'historique des Z de
   l'application et sur la page NF525 de l'administration.
4. **Cumuls** : la Z annotée compte pour son montant exact (69,40 €) dans le cumul mensuel / annuel de la Z suivante, le grand
   total perpétuel (écart −26,00 € / −1 ticket repris par la première Z qui suit l'annotation), la clôture mensuelle d'octobre
   (`cloturer_mois`) et la clôture d'exercice (`cloturer_exercice`). Contrôles `check_fiscal_integrity` §2 et
   `check_cumul_clotures_periodiques` alignés. Essai en transaction annulée : Z suivante 0 € -> cumul du mois 2 801,30 € (au lieu
   de 2 827,30 €), grand total 28 241,40 € ; clôture mensuelle d'octobre 2 801,30 € / 93 tickets, aucun écart signalé.
5. **Correctif applicatif (version 6.6.1, couche données 20261016-1)** : une réservation en ligne = une seule entrée (la ligne
   du rendez-vous encaissé remplace l'entrée d'affichage, sans jamais retirer le seul porteur du n° de ticket) ; un même ticket
   n'est compté qu'une fois dans la Z ; **avant de sceller, la Z est comparée au journal des tickets en base** (nombre, total TTC,
   modes de règlement, corrections de règlement « avant clôture » comprises) : en cas d'écart la Z est **bloquée**, avec
   « Recalculer depuis les tickets enregistrés » (le journal fait foi). Hors connexion, la Z reste possible seulement si aucun
   ticket n'attend dans la file de secours ; le contrôle impossible est tracé.
6. **Garde-fou serveur** (déclencheur `b_nf525_z_controle_journal`, avant insertion d'une Z) : refus de toute Z dont le total
   TTC diffère de la somme des tickets du jour (même règle que `check_fiscal_integrity` §2), ou qui déclare plus de tickets que
   le journal (Z manuelles). Validation préalable sur les 132 Z existantes de tous les établissements : seule la Z n°128 est en
   écart de montant ; avec la règle de comptage en vigueur depuis le 14/10 (tickets numérotés), aucune Z n'aurait été refusée sur
   le nombre. Essais en transaction annulée : Z fausse refusée, Z exacte acceptée, annotation non modifiable ni supprimable,
   seconde annotation et annotation d'une Z conforme refusées.
7. Le signalement « À réparer » lié à la Z n°128 (3 tickets verrouillés pour 4 attendus) est marqué traité ; le contrôle fiscal ne la signale plus (annotée).

À faire : publier l'application (luxyra-supabase.js v=20261016-1) ; signature ES256 directe des annotations prête dans
`docs/edge/nf525-sign.ts` (type ZC, v6) — à déployer avec l'accord de l'éditeur (l'annotation est déjà chaînée et tracée au JET).

**16/10/2026, ~21 h 50 (Paris) — préparation de la signature ES256 de l'annotation n°1 (accord de l'éditeur).**
v6 comparée à la version déployée (nf525-sign v5) : seul ajout = source `ZC` (`clotures_annotations`) ; code de tous les
autres types (TK, Z, ZM, ZA, ZE, CR, DUP, JET, FA, AR), gestion de clé, contrôles d'accès et tables écrites identiques
(diff après compilation esbuild : uniquement l'entrée ZC + commentaires). Contrainte `nf525_signatures_type_check`
élargie à `'ZC'` (`docs/migrations_1016/nf525_signatures_type_zc.sql` ; types existants inchangés). Autocontrôle
`{verif:true}` avant intervention : Excellence 1 433 signatures contrôlées, 0 anomalie. **Déploiement de v6 non abouti**
(3 tentatives expirées côté outil de déploiement ; v5 reste active) : annotation n°1 toujours chaînée SHA-256 et tracée
au JET n°516, **pas encore signée ES256**. À refaire : déployer v6 (verify_jwt false) ; le cron `nf525-sign-2min` la
signera alors automatiquement (ZC n°1). Constat annexe : `'FA'` n'est pas dans la contrainte -> la première facture
(`factures_clients`, vide à ce jour) ne pourrait pas être signée (FA_conflit) ; non modifié, à traiter avec accord.
- **2026-10-16, 21:56 (Paris)** — nf525-sign v6 déployé (seul ajout : type ZC). Annotation corrective n°1 de la Z n°128 signée ES256 (signature ZC n°1, clé LX-ES256-20261011-O3tPa_YK, 21:58:07). Autocontrôle complet lancé aussitôt : 1 434 signatures vérifiées pour Excellence Coiffure, 0 anomalie (et 0 pour les autres établissements).

## 2026-10-17 — Retour / remboursement partiel d'un ticket validé (accord de l'éditeur, Alexandre : « dans les règles de l'art, sans erreur ni oubli »)

**Objet.** Jusqu'ici, seule l'annulation totale d'un ticket (contre-ticket négatif du même montant, ticket d'origine marqué annulé)
existait ; un produit rendu imposait l'avoir total puis un nouvel encaissement. Nouvelle fonction « ↩️ Retour / remboursement
partiel » (Caisse › « 🎫 Gestion des tickets », et fenêtre « 💳 Modifier règlement » d'un ticket de journée clôturée ou au règlement
mixte), version
6.6.1, couche données `luxyra-supabase.js` 20261017-1. Fondement : BOI-TVA-DECLA-30-10-30 §90 (correction par opération nouvelle
en « moins », l'enregistrement d'origine étant conservé).

**Enregistrement.** Le retour est un **nouveau ticket négatif** : numéro suivant de la séquence normale (`nextTicketNum`), chaînage
applicatif (`chainTicket`), puis insertion par `saveTicketToDb` — même chemin que tous les tickets et contre-tickets : numéro,
`hash_prev` et empreinte serveur (`ticket_nf525_insert`, format `num|date|heure|ttc|ht|items|prev|salon` **inchangé**), scellement
`nf525_hash_seal` et signature ES256 « TK » par `nf525-sign` (inchangée ; type « R » pour un total négatif). Statut `paid`, daté du
jour du retour (journée ouverte contrôlée en mémoire et en base). Le ticket et chacune de ses lignes portent la référence du ticket
d'origine (`raw_data.isRetour`, `retourRefId` = identifiant, `retourRefTk` = n° imprimé, `retourRefDate`, `retourMotif` ; lignes
`isRetour`, `retourIdx`, `retourQty`), imprimée : « RETOUR / REMBOURSEMENT », « Ticket d'origine n° X du JJ/MM/AAAA », motif,
lignes en négatif, TVA par taux, « Remboursé en … », mentions légales identiques aux autres tickets. Le **ticket d'origine n'est
jamais modifié** (ni annulé ni marqué ; aucune écriture sur sa ligne `tickets` ni sur son rendez-vous) : les écrans et duplicatas
affichent « Retour partiel n°… le … » à partir de la référence portée par le ticket de retour. Journal d'audit :
`TICKET_RETOUR_PARTIEL` (et `RETOUR_PARTIEL_EFFETS`, `RETOUR_PARTIEL_REFUSE`) ; `TICKET_RETOUR_PARTIEL` est reporté au JET (code 190)
par l'adaptation de `nf525_jet_code` ajoutée au script lors de l'audit (voir ci-dessous).

**Garde-fous application.** Permission « Rembourser » ou code PIN administrateur (même mécanisme que l'avoir). Connexion obligatoire :
relecture du journal des tickets (ticket d'origine scellé et de même montant, retours déjà enregistrés sur tout appareil, contre-ticket
éventuel), refaite au moment de valider. Refus : cumul des retours supérieur au payé, quantité supérieure à la quantité achetée,
montant d'une ligne supérieur à sa part payée restante, ticket annulé / contre-ticket / ticket de retour / acompte / annulation
d'acompte / retenue, mode de caisse (test / réel) différent, lignes de bon cadeau / carte / forfait vendus, motif absent ; 100 % du
ticket sans retour antérieur -> « Avoir / Annuler ». Après un retour, l'avoir total et la modification du ticket d'origine sont
refusés (mémoire et relecture en base). Un refus définitif du serveur ne laisse aucun ticket local (numéro et chaînage locaux rendus).

**Base (`docs/migrations_1017/retour_partiel.sql`, NON APPLIQUÉ à la date de rédaction).** Déclencheur de contrôle
`a_lx_tickets_retour_controle` (fonction `lx_prive.tickets_retour_controle`, lecture seule) avant insertion dans `tickets` : refus
`LX_RETOUR_REFUSE` d'un retour incohérent (mêmes règles que ci-dessus, cumul et quantités recalculés sous le verrou transactionnel
par établissement de `ticket_nf525_insert`) et d'un contre-ticket visant un ticket de retour ou un ticket déjà remboursé en partie ;
index partiel de lecture. Aucune ligne existante modifiée ; aucun ticket existant ne porte le marqueur (requête 0 du fichier). La
couche données traite `LX_RETOUR_REFUSE` comme un refus définitif (jamais rejoué par la file de secours, tracé `WAL_ABANDON` +
`DB_ERROR`).

**Restitutions.** Clôture Z (le retour est un ticket numéroté compté une fois dans le nombre, le CA, la TVA et les règlements —
espèces remboursées déduites du tiroir — ; détail « Retours / remboursements partiels » ; panier moyen sur les seules ventes),
contrôle pré-Z `_lxZControleJournal` et garde-fou serveur `b_nf525_z_controle_journal` (même règle : tickets `status <> 'cancelled'`,
le retour n'étant pas un contre-ticket), bande Z mensuelle, bande de contrôle mensuelle, rapport mensuel, journal de caisse CSV / pack
/ Excel (statut « Retour partiel (ticket #… du …) »), journal des ventes et FEC (libellé « RETOUR », sens inversé, écriture
équilibrée), livre des recettes, export « Annulations & remboursements », archive annuelle, statistiques (montants nets, quantités
rendues déduites), fiche client (CA net, le retour n'est pas une visite), planning (jamais de bloc). Effets de gestion : cagnotte
créditée et chiffre cumulé de fidélité retirés au prorata du montant remboursé (points par visite conservés), produits remis en stock
si demandé (mouvement « retour »).

**Vérifications faites.** Contrôle syntaxique des scripts de `app.html` et de `luxyra-supabase.js` (node --check). **Aucun essai
fonctionnel ni aucune écriture en base n'a été fait** dans cette intervention ; à faire avant mise en service : application du SQL,
publication, essais en caisse TEST (liste des cas dans le compte rendu), puis `nf525_tests_protections()` et contrôles
`check_fiscal_integrity` / `check_data_integrity` / `admin_nf525_etat`. Aucune donnée fiscale existante modifiée.

**Audit indépendant du 2026-10-17 (avant toute mise en service) — défauts trouvés et corrigés** (marqués « 2026-10-17 retour partiel
(audit) » dans le code). Définitions relues EN BASE (lecture seule) : déclencheurs de `tickets` et `clotures`, `ticket_nf525_insert`,
`tickets_block_post_cloture`, `nf525_marquer_mode`, `lx_prive.clotures_controle_journal`, `lx_prive.z_journal_tickets`,
`clotures_set_cumul_perpetuel`, `check_fiscal_integrity`, `check_data_integrity` (2 versions), `admin_nf525_etat`, `nf525_infos_z`,
`nf525_tests_protections`, `nf525_jet_code`, `trg_audit_vers_jet`, `appointments_nf525_protect`, contraintes de `tickets`, fonctions
`lx-cloture-auto` et `nf525-sign`.
1. *Tickets de réservation en ligne* : 54 tickets du journal ont `raw_data.id` = « online_<uuid> » alors que l'application les recharge
   sous « <uuid> » : le retour était refusé (« pas encore enregistré ») et le déclencheur ne trouvait pas l'origine. Corrigé : les deux
   formes sont acceptées (application et déclencheur) et la référence portée par le ticket de retour est l'identifiant EXACT du journal
   (n° imprimé et date relus au journal ; le déclencheur refuse désormais un n° d'origine différent du journal).
2. *Contrainte `tickets_operator_required`* (collaborateur_id ou collaborateur_nom obligatoire, non vue par la première version) : le
   ticket de retour reprend le collaborateur du ticket d'origine relu au journal (à défaut l'opérateur) ; sans cela une insertion
   refusée serait restée indéfiniment en file de secours.
3. *Avoir après un retour fait sur un autre appareil* : l'avoir marque le ticket d'origine « annulé » AVANT l'envoi du contre-ticket
   (marque irréversible en base) ; si la base refusait ensuite le contre-ticket, le rendez-vous restait annulé sans contre-ticket au
   journal. Corrigé : en ligne, si la relecture des retours échoue (délai, erreur), l'avoir et la modification sont bloqués
   (« Vérification impossible… réessayez ») ; hors connexion, comportement antérieur (mémoire de l'appareil).
4. *Rejeu de la file de secours refusé* (`LX_RETOUR_REFUSE` au rejeu d'un retour déjà ajouté à la caisse) : le ticket de retour local
   restait dans la caisse et les rendez-vous, alors qu'il n'est pas au journal (Z de l'appareil et clôture de nuit différentes du
   journal, clôture de nuit refusée). Corrigé : écarté de la caisse (rendez-vous local marqué annulé, hors CA, alerte et trace
   `DB_ERROR` critique avec les effets de fidélité / stock à régulariser).
5. *« 💳 Modifier règlement » bloqué après un retour* (la règle « déjà un retour » s'appliquait aussi à la correction du moyen de
   paiement, et rendait inaccessible le bouton de retour de cette fenêtre). Corrigé : seuls l'avoir total et la modification sont
   refusés. Au passage, la correction du moyen de paiement retrouve aussi les tickets « online_<uuid> ».
6. *Déclencheur serveur renforcé* : motif obligatoire, somme des lignes = total, aucune ligne ni règlement positif, ligne « retour »
   sans drapeau du ticket refusée, origine « retour » au niveau des lignes refusée ; recherches indexées (index `tickets_tknum_idx`,
   `tickets_cancel_ref_idx` ajoutés ; plus de balayage de la table, dont `raw_data` pèse ~4,4 Ko par ligne).
7. *JET* : `TICKET_RETOUR_PARTIEL` n'avait pas de code (non reporté au JET) -> code 190 ajouté à `nf525_jet_code` (remplacement gardé
   de la définition réelle).
8. *`check_fiscal_integrity`, règle 5* : un ticket de retour de même montant pouvait masquer une annulation sans contre-ticket, et un
   retour écarté localement (point 4) aurait été signalé à tort -> retour exclu du rapprochement, montants négatifs non signalés
   (remplacement gardé de la définition réelle).
9. Textes : aide (motif 5 caractères, bons / cartes / forfaits à annuler avant tout retour, correction du moyen de paiement toujours
   possible, vérification serveur de l'avoir) et bot (mêmes points, renvoi vers la section #s10 du guide).
**Rien à changer, vérifié sur les définitions réelles** : contrôle de la Z par la base (`b_nf525_z_controle_journal`), clôture de
nuit `lx-cloture-auto` (le retour, rendez-vous « done » non annulé de prix négatif, entre dans total et nombre = journal), cumuls,
`check_data_integrity`, `admin_nf525_etat`, `nf525_infos_z`, signature TK (type R), tests de nuit. Écart ANTÉRIEUR relevé (non
corrigé, sans effet sur total_ca / nombre / HT en taux unique) : la copie de `_splitPrestProd` de `lx-cloture-auto` date d'avant le
11/10 et range tout montant négatif (contre-tickets, retours) en « prestations » : ventilation prestations / produits de la Z de nuit
à réaligner pour les établissements à double taux.
**Essais réalisés lors de l'audit** : (a) `node --check` des 6 scripts de `app.html` et de `luxyra-supabase.js` ; (b) fonctions de
calcul du retour (lignes payées / déjà remboursées / reste, TVA par taux, identifiant « online_ ») exécutées sous Node avec des
données fictives ; (c) script SQL complet exécuté en base dans une transaction ANNULÉE (aucune donnée conservée, vérifié ensuite :
0 ticket, 0 clôture, ni déclencheur ni index ni modification de fonction restants) sur le « Salon Démo » (fermé, sans ticket) :
retour accepté (n°, chaînage et sceau posés comme tout ticket), dépassement du payé refusé (y compris référence sans « online_ » et
0,01 € de trop), quantité supérieure refusée, n° d'origine faux refusé, ligne positive / règlement positif / motif absent / ligne
sans drapeau refusés, avoir sur un ticket ayant un retour refusé, avoir sur un ticket de retour refusé, retour sur un ticket annulé
ou sur un ticket de retour refusé, rejeu du même ticket écarté par l'index d'unicité, solde exact accepté, vente et avoir ordinaires
acceptés (non-régression), Z égale au journal (retours inclus) acceptée par la base et Z différente refusée, `nf525_jet_code` = 190,
`check_fiscal_integrity` recompilée. **Non fait** : aucun essai dans l'application elle-même (écran, impression, exports, file de
secours, deux appareils), aucune application du SQL, aucune publication.

- 2026-10-17, 00:45 — docs/migrations_1017/retour_partiel.sql APPLIQUÉ en base (déclencheur a_lx_tickets_retour_controle, 3 index, nf525_jet_code TICKET_RETOUR_PARTIEL=190, check_fiscal_integrity règle 5). Contrôles après application : check_fiscal_integrity 0 anomalie, check_data_integrity 0 anomalie, nf525_tests_protections ok=true. Application publiée ensuite (v=20261017-1). Essais en caisse TEST dans l application : restent à faire.

- 2026-10-27, 19h — Déclenchement de la signature électronique (accord d'Alexandre). Cause : quota de trafic sortant Supabase (offre gratuite) dépassé à 98 % par la tâche nf525-sign-2min, qui appelait la fonction de signature toutes les 2 min même sans rien à signer (~70 000 lectures de nf525_signatures / jour). **Fonction nf525-sign NON modifiée** (données signées, clé ES256, chaînage, séquences identiques). Changement : (1) 18h50 fréquence 2 -> 10 min (provisoire) ; (2) nouvelle fonction en lecture seule `lx_prive.nf525_signature_en_attente()` (mêmes 11 sources et mêmes statuts d'établissement que la fonction ; tickets scellés uniquement ; établissement sans signature avec la clé active = JET 450 ; toute erreur => « à signer ») ; la tâche 37 (toutes les 2 min) n'appelle la fonction que si elle répond « à signer » ; nouvelle tâche `nf525-sign-filet-horaire` (minute 7) = passage complet toutes les heures quoi qu'il arrive. Script : docs/migrations_1027/nf525_sign_declenchement.sql. Revue indépendante (agent expert) : aucun cas où une signature serait manquée ; réserves appliquées (repli « à signer » sur erreur, exists au lieu de count). Contrôles : détection simulée (dernière signature TK puis JET exclues : 1 détectée chacune) ; essai réel : JET 80 créé à 19:25:19 -> appel à 19:26:00 -> signé à 19:26:04 -> plus rien en attente ; check_fiscal_integrity 0 anomalie ; nf525_tests_protections ok=true ; 1 664 signatures, aucune modifiée. Retour arrière : remettre la commande d'origine de la tâche 37 (sans la clause WHERE).

- 2026-10-27 — **Envoi automatique des documents comptables au comptable (option A, accord d'Alexandre) — branche envoi-comptable, NON déployé, SQL NON appliqué.** Nature : fonction de transmission, **en LECTURE SEULE sur la caisse**. **Aucun changement fiscal** : aucune table, aucun déclencheur, aucune fonction fiscale créé ou modifié (tickets, clotures, clotures_mensuelles, clotures_annuelles, clotures_exercices, corrections_reglement, nf525_*, JET, audit_log, signatures) ; aucun nouveau calcul de CA, de TVA ou de règlement ; aucun format de donnée signée touché ; LX_VERSION inchangée (6.6.1). Ce qui change : (1) `app.html` — les exports existants peuvent être produits pour un mois passé en paramètre, sans modifier le mois affiché ni télécharger (`_lxPackComptableZip`, `_lxFecConstruire`, paramètres `(mois, collecteur)` de `expAnnulations`, `expTvaPaiementsEnLigne`, `expLivreRecettes`, `expAcomptesNonSoldes`) ; les boutons manuels appellent ces mêmes fonctions ; (2) envoi le mois suivant, seulement si la caisse est en mode réel et si le mois est clôturé (ligne `clotures_mensuelles`, lue, jamais écrite) ; contrôle de cohérence avant envoi : total des tickets du mois chargés dans l'application = `total_ca` de la clôture mensuelle (sinon rien ne part) ; les chiffres écrits dans l'e-mail sont lus dans la clôture mensuelle scellée ; (3) nouvelles tables hors périmètre fiscal `compta_envoi_config` / `compta_envois` (docs/migrations_1027/envoi_comptable.sql) ; (4) worker `/api/compta/envoi`. Traces : la production des fichiers inscrit au journal les mêmes actions d'export que les boutons (`EXPORT_ANNULATIONS`, `EXPORT_TVA_EN_LIGNE`, `EXPORT_ACOMPTES_NON_SOLDES`, `EXPORT_LIVRE_RECETTES` en micro) puis `EXPORT_PACK_COMPTABLE` (« Envoi automatique au comptable - Période AAAA-MM - fichiers ») : codes d'action existants, aucun nouveau code JET. **Preuve de non-régression des exports** (banc navigateur, mode démo, date et aléa figés, données de démonstration + ajouts identiques : annulation d'un autre jour, remise, paiement mixte, 2 ventes produits) : pour 2026-09 et 2026-10, en TVA 20 % et en franchise (293 B), ZIP du pack (7 ou 8 fichiers), FEC (octets, BOM compris) et rapport : **identiques** entre l'ancien code (HEAD 8763862) et le nouveau, bouton manuel comme envoi automatique (y compris les pièces jointes relues après encodage) ; mois affiché inchangé, aucun téléchargement ni fenêtre pendant l'envoi automatique ; témoin : la modification d'un seul ticket est bien détectée. Limites du banc : le mode démo n'a ni paiement en ligne, ni acompte, ni correction de règlement (ces fichiers sont produits vides des deux côtés) ; aucun essai sur une vraie base ni d'envoi d'e-mail réel.
