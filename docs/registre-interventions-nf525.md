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
