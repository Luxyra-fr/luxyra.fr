# Dossier d'attestation — justification « version mineure » de Luxyra 6.8.5

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
version du 25/03/2026, § 340, § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 28/10/2026, corrigée le 28/10/2026 au soir après le contre-audit indépendant (protection de `raw_data`, revalidation de la ventilation mémorisée, dates). Complète le dossier
`dossier-attestation-version-mineure-6.8.4.md` (version publiée le 28/10/2026, dont le contenu reste valable et n'est pas
répété). Concerne le passage de la version publiée 6.8.4 à la version 6.8.5.

## 1. Règle appliquée

§ 340 (texte lu sur bofip.impots.gouv.fr le 28/10/2026) : version **majeure** = version « obtenue en ayant modifié […] un ou
plusieurs paramètres impactant le respect des conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage des
données » ; version **mineure** = version « obtenue sans que les paramètres impactant le respect de ces conditions aient été
modifiés ». § 380 : racine majeure **6**, subdivisions 6.x.y réservées aux versions mineures.

## 2. Ce que 6.8.5 change — effet sur les quatre conditions

Objet : constats M1, M2, M3 de l'audit indépendant (lot 3) — une même période donnait des HT / TVA différents selon le document
(arrondis à des niveaux différents, produit à taux propre ventilé au taux unique, taux actuel appliqué aux mois passés).
Règle retenue : HT et TVA d'une période = somme, par taux, des montants enregistrés sur chaque ticket (registre NF525,
intervention -7 du 28/10/2026).

| Évolution 6.8.5 | Condition concernée | Paramètre modifié ? |
|---|---|---|
| Ventilation TVA du ticket (par taux et par nature) calculée une fois à l'encaissement et mémorisée dans le ticket (`raw_data.lxTva`) ; `total_ht` / `total_tva` / `taux_tva` = ses totaux | Inaltérabilité (§ 80-120) | **Non** : aucune donnée nouvelle n'entre dans l'empreinte (format `num\|date\|heure\|ttc\|ht\|items\|prev\|salon` inchangé) ; la ventilation est dans `raw_data` (hors empreinte et hors instantané du sceau `_nf525_seal_row`, qui ne couvrent pas `raw_data`). **Protection réelle** : (1) `raw_data` est figé par la base dès l'enregistrement du ticket (déclencheur `a_lx_tickets_raw_data_fige` : toute modification refusée, quel que soit le rôle ; seul contournement, le déverrouillage explicite existant `luxyra.allow_nf525_unlock`, tracé dans `audit_log`) ; (2) la ventilation mémorisée n'est jamais crue telle quelle : elle n'est retenue que si elle est entièrement cohérente avec les données scellées du ticket (taux enregistrés et taux propres des lignes, HT de chaque ligne = TTC / (1 + taux) au centime, TVA = TTC − HT, hors CA recalculé depuis les lignes, totaux TTC et HT scellés) ; sinon recalcul depuis les données scellées. Tickets existants jamais modifiés. Pour un ticket à un seul taux (100 % des 827 tickets de production au 28/10/2026), le HT est celui calculé jusqu'ici (`TTC / (1 + taux)` arrondi au centime). |
| HT / TVA de la Z = somme des HT / TVA enregistrés des tickets du jour (au lieu d'un recalcul sur le total du jour) ; une ligne de TVA par taux (`raw_data.tvaParTaux`, marque `tvaRegle`) | Conservation (§ 170 : données cumulatives et récapitulatives) | **Non** : la Z reste calculée, enregistrée et scellée par le logiciel, avec la même empreinte (`Z\|num\|date\|CA\|HT\|nb\|annul\|dernier ticket\|siret`) ; seule la valeur du HT suit désormais exactement les données élémentaires (§ 180 : résultats justifiés par les données élémentaires). CA, nombre de tickets, cumuls, total perpétuel : inchangés. Z déjà scellées : jamais recalculées. |
| Déclencheur `a_lx_tickets_raw_data_fige` : `raw_data` d'un ticket figé dès l'enregistrement (correctif du contre-audit du 28/10/2026 : il restait modifiable par le propriétaire, hors sceau) | Inaltérabilité (§ 80-120), sécurisation | **Non** (paramètre renforcé, non modifié) : aucune empreinte, aucun chaînage, aucun format, aucune donnée existante changés ; une modification jusqu'ici possible et non tracée devient impossible (contournement de maintenance tracé). Aucune écriture légitime de l'application, de la clôture automatique ou des fonctions serveur ne modifie `raw_data` après l'insertion (relevé et essais). |
| Contrôle de la base `b_nf525_z_controle_tva` (refus `LX_Z_ECART_TVA` si le HT d'une Z au nouveau modèle ≠ somme du journal) | Sécurisation (§ 130-150) | **Non** : contrôle d'entrée supplémentaire, à côté du contrôle du CA existant ; aucune donnée modifiée. |
| Clôtures mensuelle / annuelle / d'exercice : HT / TVA = somme des tickets de la période (si le journal concorde avec le CA des Z) ; HT des Z et écart d'arrondi conservés (`raw_data.tva`) | Conservation (§ 170) | **Non** : empreintes `ZM\|…\|CA\|nb\|…`, `ZA\|…`, `ZE\|…` inchangées (le HT n'y entre pas) ; CA = somme des Z (contrôle `check_cumul_clotures_periodiques` inchangé) ; clôtures existantes non touchées. |
| Documents (rapport, Excel, ZIP, FEC, EBP / Quadratus, e-mail au comptable, statistiques) : valeurs enregistrées des tickets, par taux ; rapprochement affiché avec les Z anciennes | Archivage (§ 220 et suivants) | **Non** : exports en lecture seule ; formats d'archive et de FEC inchangés (colonnes, nommage) ; seules les lignes de TVA sont ventilées par taux. |
| Ticket imprimé et duplicata : une ligne de TVA par taux (valeurs enregistrées) | — | Présentation (mention par taux). |
| lx-cloture-auto v3.5 : même règle que l'application ; `verify` recalcule chaque Z avec SA règle | Conservation | **Non** : mêmes contrôles de la base ; empreinte inchangée. |

## 3. Pourquoi « 6.8.5 »

Le calcul d'une donnée récapitulative de la Z (son HT) change pour les Z créées à partir de cette version : un même numéro
ne doit pas désigner deux règles. 6.8.5 identifie la version (JET `nf525_version`, code 255, à la première ouverture) et la
frontière : une Z porte la marque `raw_data.tvaRegle = "tickets-v1"` si elle a été calculée par 6.8.5 (ou par lx-cloture-auto
v3.5) ; sans la marque, elle relève de la règle antérieure. Racine majeure inchangée : **6** (§ 380). La couche de données
passe à `20261028-7`.
Les correctifs du contre-audit (28/10/2026 au soir) sont intégrés à la même version 6.8.5 : elle n'a jamais été publiée ni
déployée (production au 28/10/2026 : aucun ticket portant la version 6.8.5 ni de ventilation `raw_data.lxTva`, aucun événement
JET « 6.8.5 ») ; le numéro ne désigne donc qu'un seul contenu.

Appréciation de l'éditeur : version **mineure**. Aucune fonction d'inaltérabilité (empreintes, chaînage, sceau, signatures
ES256, numérotation, JET), de sécurisation, de conservation (toutes les données restent enregistrées ligne par ligne et
récapitulées) ou d'archivage n'est modifiée ; la correction rend les données récapitulatives conformes aux données
élémentaires, ce qui est l'objet même du § 180. Le déclencheur `a_lx_tickets_raw_data_fige` ne modifie aucune de ces
fonctions : il ajoute un refus (inaltérabilité des données complémentaires du ticket) sans changer empreintes, sceau ni formats.

## 4. Traçabilité

Registre : `docs/registre-interventions-nf525.md`, intervention -7 du 28/10/2026. SQL : `docs/migrations_1028_tva/tva_unique.sql`
(garde md5 des définitions de production du 28/10/2026), retour arrière `docs/migrations_1028_tva/tva_unique_retour_arriere.sql`.
Fonction de clôture automatique : `docs/edge_1028_tva/lx-cloture-auto/index.ts` (v3.5).
