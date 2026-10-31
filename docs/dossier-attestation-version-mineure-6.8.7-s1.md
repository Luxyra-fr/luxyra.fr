# Dossier d'attestation — révision serveur « 6.8.7-s1 » (droits de l'éditeur)

Pièce du dossier technique de l'attestation individuelle de l'éditeur (art. 286, I-3° bis du CGI ; BOI-TVA-DECLA-30-10-30,
§ 340 et § 360 à 390 ; modèle BOI-LETTRE-000242). Rédigée le 31/10/2026. Complète `dossier-attestation-version-mineure-6.8.7.md`.

## 1. Objet

Renforcement des contrôles d'accès côté serveur pour que **l'éditeur ne puisse réaliser aucune opération de caisse à la place
d'un établissement**, et traçabilité des changements de données d'identification. Aucune modification de l'application installée
(LX_VERSION reste 6.8.7) ni des fonctions d'inaltérabilité, de sécurisation, de conservation ou d'archivage : formats d'empreinte,
chaînage, signatures, numérotation, contenu des Z et des archives, JET existant **inchangés**, prouvé par empreinte md5 des
définitions avant / après et remplacement inverse (registre NF525, 31/10/2026).

## 2. Classement : version mineure (§ 340)

| Évolution | Condition | Paramètre impactant modifié ? |
|---|---|---|
| Passe-droit admin retiré de 11 fonctions qui écrivent en caisse (avoir, bons cadeaux débit/recrédit, forfaits, clôtures mois/année/exercice, archive annuelle, factures, réinitialisations d'essai) + capture d'empreinte (edge v8) | Sécurisation | **Non** : le contrôle devient plus strict, les traitements sont identiques à l'octet |
| Trace JET 410 (CONFIG_IDENTITE) des changements d'identification faits par un autre que le propriétaire | Sécurisation / traçabilité | **Non** : ajout d'un événement au JET par le mécanisme existant (audit_log → trg_audit_vers_jet) |
| Garde « historique fiscal » élargie (suppression d'un établissement refusée dès qu'il existe une trace fiscale) | Conservation | **Non** : renforcement, aucune donnée supprimée |
| Politique de suppression directe d'établissement retirée | Conservation | **Non** : renforcement |
| Export NF525 complet sans plafond, version réelle | Archivage (lecture) | **Non** : lecture seule |

## 3. Pourquoi « 6.8.7-s1 » et pas « 6.8.8 »

Le numéro de version porté par chaque ticket (raw_data.lxVersion) et contrôlé par le serveur est celui de l'application installée.
L'application n'a pas changé : lui donner un nouveau numéro créerait une version publiée sans aucune différence de code et
forcerait la mise à jour des appareils sans objet. La révision est donc **identifiable** :
- dans la table `luxyra_versions` (ligne `6.8.7-s1`, `is_current = false`, notes détaillées) ;
- dans le registre des interventions (docs/registre-interventions-nf525.md, 31/10/2026) avec les empreintes md5 ;
- dans ce dossier.
La prochaine publication de l'application prendra le numéro 6.8.8 et reprendra cette révision dans son dossier.

## 4. Seules actions de l'éditeur restantes sur les données d'un établissement

| Action | Pourquoi | Traçabilité |
|---|---|---|
| Forçage d'une Z (`lx_z_forcer_admin`) | Dépannage d'une journée retenue | Motif ≥ 15 caractères, journée passée seulement, `clotures_forcages.admin = true`, `CLOTURE_Z_FORCEE_ADMIN` → JET 900, alerte |
| Annotation corrective signée d'une Z (`nf525_annoter_cloture`) | Corriger un écart sans modifier la Z | Ligne `clotures_annotations` signée, JET |
| Attestation éditeur (`nf525_signer_editeur`) | Obligation de l'éditeur | Table `nf525_attestation_editeur` |
| Lectures, contrôles, exports | Support, contrôle fiscal | Journal admin serveur (inaltérable) ; exports tracés |

Aucune autre écriture de caisse n'est possible pour l'éditeur (banc rejouable :
docs/migrations_1031_audit_final/tests_acces_admin_caisse.sql, résultat 11 / 11 refusés le 31/10/2026).

## 5. Fonctions edge de caisse : authentification des appels (relevé du 31/10/2026)

| Fonction | verify_jwt | Comment l'appelant est reconnu |
|---|---|---|
| rdv-empreinte-capture (v8), rdv-empreinte-release (v7), lx-cloture-auto (v6), salon-factory-reset (v7) | **true** | Le rôle « service » est lu dans le jeton : sûr **uniquement** parce que la plateforme vérifie sa signature. Les autres appels : session utilisateur + contrôle propriétaire |
| nf525-sign (v6) | false | Secret partagé `x-cron-secret` (tâche planifiée) ou session vérifiée par `auth.getUser` + contrôle propriétaire |
| cron-empreinte-auto-capture (v9) | false | Secret lu dans `app_secrets`, comparé en temps constant |
| gc-stripe-webhook (v15) | false | Signature Stripe du webhook |

Règles : (1) `verify_jwt` ne doit **jamais** être désactivé sur les fonctions de la première ligne ; tout redéploiement le contrôle.
(2) Une fonction de caisse déployée avec `verify_jwt = false` ne lit **jamais** le rôle dans un jeton non vérifié : secret partagé,
signature Stripe ou `auth.getUser` seulement. (3) Aucune de ces fonctions n'accorde de droit au compte de l'éditeur.

## 6. Clé « service » (rôle serveur)

- Détenteur : l'éditeur seul (Alexandre). Stockée dans les secrets de la plateforme (Supabase, Cloudflare Worker), jamais dans le code
  ni dans un fichier du dépôt ; copie en coffre (Vault Supabase) pour les appels planifiés.
- Usage : traitements automatiques (clôtures de nuit, archivage, recettes en ligne, capture d'empreinte), worker.
- Lancements manuels de `lx-cloture-auto` (mode « run ») : uniquement pour rattraper une Z, avec mention au registre (date, établissement,
  motif) ; chaque Z produite porte son horodatage et sa trace JET 50 ; une Z antérieure à une Z existante est refusée.
- En cas de fuite supposée : rotation immédiate de la clé et mention au registre.
