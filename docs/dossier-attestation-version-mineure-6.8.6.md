# Dossier d'attestation — justification « version mineure » de Luxyra 6.8.6

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
version du 25/03/2026, § 340, § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 28/10/2026. Complète le dossier
`dossier-attestation-version-mineure-6.8.5.md` (version publiée le 28/10/2026, dont le contenu reste valable et n'est pas
répété). Concerne le passage de la version publiée 6.8.5 à la version 6.8.6 (couche données 20261028-8, lx-cloture-auto v3.6).

## 1. Règle appliquée

§ 340 : version **majeure** = version « obtenue en ayant modifié […] un ou plusieurs paramètres impactant le respect des
conditions d'inaltérabilité, de sécurisation, de conservation et d'archivage des données » ; version **mineure** = version
« obtenue sans que les paramètres impactant le respect de ces conditions aient été modifiés ». § 380 : racine majeure **6**,
subdivisions 6.x.y réservées aux versions mineures.

## 2. Ce que 6.8.6 change — effet sur les quatre conditions

Objet : lot 4 de l'audit indépendant (constats M4, M10, M9, reste de M6, mineurs) — registre NF525, intervention -8 du 28/10/2026.

| Évolution 6.8.6 | Condition concernée | Paramètre modifié ? |
|---|---|---|
| Tickets : toute colonne figée après l'enregistrement (déclencheur `a_lx_tickets_colonnes_figees`) ; verrouillage seulement par la clôture Z de la journée ; statut jamais modifié (annulation = contre-ticket) ; statut normalisé « paid » à l'insertion (`a_lx_tickets_0_statut`) | Inaltérabilité (§ 80-120), sécurisation (§ 130-150) | **Non** (paramètre RENFORCÉ, non modifié) : aucune empreinte, aucun chaînage, aucun format ni aucune donnée existante changés (0 ticket « cancelled » en production au 28/10/2026, 827 tickets « paid » verrouillés) ; des modifications jusqu'ici possibles et non tracées (statut, note, nom, déverrouillage) deviennent impossibles ; contournement de maintenance existant (`luxyra.allow_nf525_unlock`), tracé. |
| `creer_ticket_avoir` (fonction serveur, non utilisée par l'application) : l'origine n'est plus passée en « cancelled » ; contre-ticket numéroté et chaîné par la base | Inaltérabilité (§ 80 : annulation par opération négative) | **Non** : même modèle que l'application (contre-ticket depuis le 09/07/2026) ; aucune exécution en production (0 avoir de ce type). |
| Bons cadeaux : garde des colonnes fiscales, suppression interdite, journal des mouvements chaîné SHA-256 (`cartes_cadeaux_mouvements`), état fiscal des bons à usage multiple dérivé des tickets (`lx_bons_etat`) ; date d'expiration scellée sur la ligne de vente ; n° du ticket de vente posé sur le bon | Inaltérabilité, conservation (§ 170 : données élémentaires) | **Non** : les données fiscales (vente, utilisations) restent celles des tickets scellés ; le bon (donnée de gestion) gagne une trace inaltérable ; aucune donnée existante modifiée (4 bons en production, aucun à usage multiple). La ligne de vente porte une clé de plus (`bonExp`) : contenu couvert par l'empreinte existante, format d'empreinte inchangé. |
| Arrondi au centime à l'écriture des montants de la Z (bruit de calcul flottant) | Conservation | **Non** : la valeur enregistrée devient exactement celle de l'empreinte (`toFixed(2)`) ; empreinte `Z|n°|date|CA|HT|nb|annul|…` inchangée ; aucune Z existante touchée. |
| Cumul de tickets du mois / de l'année corrigé des annotations (`b_nf525_z_cumul_tickets`) ; annotation signée de 7 Z historiques (nombre de tickets) | Conservation (§ 170-180 : données récapitulatives justifiées par les données élémentaires) | **Non** : mécanisme d'annotation existant (16/10/2026), Z jamais modifiées ; cumuls hors empreinte. |
| lx-cloture-auto v3.6 : clôture de nuit pour tous les statuts d'abonnement | Conservation (clôture périodique) | **Non** : même calcul, même empreinte, mêmes contrôles de la base ; seul le périmètre des établissements traités s'élargit (un établissement suspendu n'était jamais clôturé). |
| Factures clients établies à partir d'un ticket (`lx_facture_emettre`) | — (hors périmètre de la condition « caisse » : document commercial) | **Non** : la facture recopie le ticket scellé (aucun montant nouveau, aucune recette, aucune écriture) ; table `factures_clients` déjà inaltérable ; elle est déjà comprise dans l'archive fiscale (format `LUXYRA-NF525-ARCHIVE-1` inchangé). |
| FEC / EBP / Quadratus : ticket « cancelled » traité comme une vente (sa paire d'annulation est le contre-ticket) ; versements Stripe (banque / frais 627 / 580100) ; FEC de test nommé « _TEST » | Archivage (§ 220 et suivants) | **Non** : exports en lecture seule ; format FEC inchangé (18 colonnes, nommage réglementaire ; seul le suffixe `_TEST` et le libellé du journal en caisse de TEST, sans valeur fiscale) ; écritures de banque ajoutées (journal BQ) à partir de données Stripe, hors données de caisse. |
| Conditions des devis, libellés « loi anti-fraude », nombre de tickets du rapport (tickets numérotés) | — | Présentation / documents de gestion. |
| **Révision du 29/10/2026 (contre-audit, avant mise en service)** — factures : aucune facture en caisse de TEST (`lx_facture_emettre` + déclencheur `a_lx_factures_clients_pas_de_test`), ancienne fonction `generer_facture_client` retirée, lignes calculées par la base (remise globale en ligne « Remise » par taux), mentions du vendeur exigées (n° de TVA, adresse, RCS et capital pour une société : colonnes `salons.rcs_ville` / `capital_social`), avoir sans facture d'origine refusé, vente de bon à usage multiple non facturée ; XML EN 16931 | — (document commercial, hors condition « caisse ») | **Non** : la facture recopie toujours le ticket scellé (aucun montant nouveau, aucune écriture) ; les ventes de test (sans valeur fiscale) ne peuvent plus porter de pièce inaltérable qui empêcherait leur effacement au passage en caisse réelle ; format d'empreinte des factures inchangé (`FC|…`) ; 0 facture en production. |
| Révision du 29/10/2026 — `consommer_bon_cadeau` / `recrediter_bon_cadeau` : montant au centime (3 décimales refusées) ; `creer_ticket_avoir` (non utilisée par l'application) : règlements par bon à usage multiple repris en négatif sur le contre-ticket | Inaltérabilité, conservation | **Non** : contrôle d'entrée ajouté (le montant enregistré était déjà arrondi au centime par la colonne, seule la réponse différait) ; contre-ticket au même modèle que celui de l'application (depuis la v6.7.0). |
| Révision du 29/10/2026 — devis (« acompte », annulation par l'établissement : remboursement total), information TVA sur frais Stripe (bordereau, e-mail au comptable), `payment_intent` des versements Stripe | — | Présentation / données de rapprochement hors caisse. |

## 3. Pourquoi « 6.8.6 »

Aucun paramètre impactant l'inaltérabilité, la sécurisation, la conservation ou l'archivage n'est modifié : les contrôles sont
ajoutés (renforcement), les formats d'empreinte, de chaînage, de clôture et d'archive sont inchangés, aucune donnée enregistrée
n'est modifiée. Version mineure : 6.8.5 → **6.8.6** (même racine majeure 6, attestation individuelle en cours de validité). La révision du 29/10/2026 (corrections du contre-audit) intervient AVANT toute publication de la 6.8.6 (0 ticket portant « 6.8.6 » en production au 29/10/2026) : elle reste la version 6.8.6 ; seule la garde de la couche données passe à 20261028-9 (nouvelles colonnes lues).

## 4. Éléments de preuve

- Code : branche `lot4-protections` (depuis main a5b3a9c), fichiers `docs/migrations_1028_lot4/*.sql`, `docs/edge_1028_lot4/`,
  `app.html`, `luxyra-supabase.js`, `docs/luxyra-router-worker.js`.
- Essais (PostgreSQL 17.6 réel, navigateur sans affichage, base et Stripe simulés) : registre NF525, intervention -8 (bancs
  `/tmp/lot4/`).
- Relevés de production (lecture seule, 28/10/2026) : registre NF525, intervention -8.
- Révision du 29/10/2026 : commit b65be0b ; essais (bancs de l'auditeur sur base reconstituée depuis la production, XML validé par le schéma et le schématron Factur-X 1.09 EN16931, navigateur, worker) : registre NF525, intervention -8, « RÉVISION DU 29/10/2026 ».
