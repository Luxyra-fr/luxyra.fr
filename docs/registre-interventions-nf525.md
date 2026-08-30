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

---

*Toute intervention technique ultérieure laissant une trace de type « bypass » dans
le journal d'audit doit faire l'objet d'une nouvelle entrée dans ce registre, décrivant
la nature de l'intervention, sa cause, et les vérifications établissant l'absence
d'altération des données fiscales.*
