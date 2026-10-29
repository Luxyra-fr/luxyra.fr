# Dossier d'attestation — justification « version mineure » de Luxyra 6.8.7

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
version du 25/03/2026, § 340, § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 29/10/2026. Complète les dossiers 6.8.5 et
`dossier-attestation-version-mineure-6.8.6.md` (dont le contenu reste valable et n'est pas répété). Concerne le passage de la
version publiée 6.8.6 (en ligne depuis le 29/10/2026, 06 h 46 ; 6 tickets « 6.8.6 » en production au 29/10/2026 au soir) à la
version 6.8.7 (couche données 20261029-1). Un nouveau numéro est donc obligatoire : la 6.8.6 a été utilisée.

## 1. Règle appliquée

§ 340 : version **mineure** = version « obtenue sans que les paramètres impactant le respect [des conditions d'inaltérabilité, de
sécurisation, de conservation et d'archivage] aient été modifiés ». § 380 : racine majeure **6**, subdivisions 6.x.y réservées
aux versions mineures.

## 2. Ce que 6.8.7 change — effet sur les quatre conditions

Objet : réserves du contre-audit du lot 4 (lot 4b) — registre NF525, intervention -9 du 29/10/2026.

| Évolution 6.8.7 | Condition concernée | Paramètre modifié ? |
|---|---|---|
| Factures clients : ligne « Bon cadeau … (réglé lors de l'achat du bon) » pour la part réglée par un bon à usage unique (au lieu d'une ligne « Remise ») ; refus d'une facture pour un ticket entièrement réglé par un tel bon (`LX_FACTURE_BON_UNIQUE`) | — (document commercial, hors condition « caisse ») | **Non** : la facture recopie toujours le ticket scellé (base HT et TVA par taux = celles du ticket, aucun montant nouveau, aucune recette, aucune écriture) ; seule la présentation des lignes change (`factures_clients.lignes`, hors empreinte) ; format de l'empreinte « FC|… » inchangé ; 0 facture en production au 29/10/2026. |
| Factures clients : prix unitaire brut, remise de la ligne et net sur chaque article (facture imprimée et XML EN 16931 : remise de ligne BG-27) | — | **Non** : mêmes montants nets, présentation seulement. |
| Factures clients : mention de la numérotation (suite unique F- / A-) ; colonne « N° d'ordre » au registre CSV | — | **Non** : numérotation inchangée (séquence unique sous verrou, aucune renumérotation). |
| Droits TRUNCATE / TRIGGER / REFERENCES retirés aux rôles de l'API (anon, authenticated) sur toutes les relations du schéma public ; privilèges par défaut des futures tables | Sécurisation (§ 130-150) | **Non** (renforcement) : aucun usage de ces droits par l'application, le worker, les fonctions ou les tâches planifiées (relevé de production) ; SELECT / INSERT / UPDATE / DELETE inchangés (contrôlés par le script). |

Aucun calcul de caisse (ticket, Z, clôtures, FEC, exports, JET, signatures, archives) n'est modifié : non-régression vérifiée sur le
même scénario (FEC d'octobre, données du rapport du mois, liste des tickets, devis identiques entre 6.8.6 et 6.8.7).

## 3. Pourquoi « 6.8.7 »

Aucun paramètre impactant l'inaltérabilité, la sécurisation, la conservation ou l'archivage n'est modifié (la sécurisation est
renforcée par le retrait de droits inutiles) ; formats d'empreinte, de chaînage, de clôture et d'archive inchangés ; aucune donnée
enregistrée modifiée. Version mineure : 6.8.6 → **6.8.7** (même racine majeure 6, attestation individuelle en cours de validité).
JET « nf525_version » (code 255) écrit à la première ouverture de la 6.8.7 sur chaque poste.

## 4. Éléments de preuve

- Code : branche `lot4b-finitions` (depuis main ccc9b96), `docs/migrations_1029_lot4b/*.sql`, `app.html`, `luxyra-supabase.js`.
- Essais (PGlite = définitions de production au md5 près, schéma XSD et schématron Factur-X 1.09 EN16931, navigateur sans
  affichage) et relevés de production (lecture seule, 29/10/2026) : registre NF525, intervention -9.
