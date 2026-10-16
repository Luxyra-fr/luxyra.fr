# Audit des réglages de l'app pro Luxyra : chaque réglage a-t-il un effet ?

Audit en lecture seule, fait les 16 et 17/10/2026. Aucun fichier du dépôt n'a été modifié, ni git ni réseau.

**Périmètre :** app.html, luxyra-supabase.js, site.html, recherche.html, compte.html, docs/luxyra-router-worker.js, docs/migrations_1014/1015/1016, docs/edge_*.

**Volume :** 339 contrôles, soit environ 325 réglages distincts. Les réglages d'acompte et de garantie ont été vérifiés deux fois, depuis « Site en ligne » et depuis « Paiements en ligne ».

> **Numéros de ligne.** app.html a été modifié par une autre session pendant l'audit (17/10 à 00:03, environ 40 lignes de plus). Les numéros de app.html correspondent à la version du 16/10 à 23:19. Après la l.2315, ajoutez environ +38 à +55 lignes pour retrouver la position actuelle. Par exemple : réglages équipe 15389 → 15427, SMS 16329 → 16367, editProd 20838 → 20881, lxEnsurePushSubscription 40251 → 40313. Certains numéros de site.html sont décalés de +2 lignes (modification de 23:56). luxyra-supabase.js et le worker n'ont pas changé.
>
> **Vérifié à nouveau sur la version actuelle** (encore présents au 17/10 à 00:05) :
> - réactivation par le worker ;
> - `||24` de l'empreinte ;
> - push réactivé au rechargement ;
> - `CONTINUE WHEN v_cfg IS NULL` des rappels ;
> - opt-out de compte.html non propagé ;
> - mention 293 B sur les devis ;
> - opacité du fond non enregistrée ;
> - cases confirmSms / confirmEmail.

**Légende des verdicts :**
- OK
- SANS EFFET
- EFFET PARTIEL
- LIBELLÉ TROMPEUR
- NON ENREGISTRÉ (perdu au rechargement)
- PAS RELU (enregistré mais pas relu par le site ou le serveur)
- NON VÉRIFIABLE (fonction serveur absente du dépôt)

**À savoir pour lire les tableaux :**
- La fonction `saveSalonConfig` réellement exécutée est celle d'app.html (l.29996, puis `_lxSaveSalonConfigUneFois` l.30094, avec la table `LX_CFG_SECTIONS` l.29909-29931). Elle écrit `salons.config_json` et `show_tva_ticket`. Celle de luxyra-supabase.js:4428 est remplacée et ne sert jamais : c'est du code mort.
- `site_config` est écrit par `_lxSiteData` (app.html l.14693-14740) et relu par `_lxTraiterSite` (l.14848-14880).
- Pour la correspondance des noms entre l'app et la base, j'ai vérifié tous les mappings : `lxMapProduitRow`/`_lxProduitData`, `_lxSvcPayload`, `lxMapCollabRow`, `lxMapClientRow`/`_lxClientData`, `_lxSiteData`/`_lxTraiterSite`. Je n'ai trouvé **aucun autre écart de nom du type `cc` / `click_collect`**. Le seul écart restant est `date_entree` (problème n°41).

---

## 1. Tableaux par rubrique

### 1.1 Paramètres › Établissement (l.15224-15298)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Métier (verrouillé) | 15230 | salons.metier | supabase:2124 | recherche:285, worker:5757 | OK |
| Autres activités | 15239 | salons.metiers_autres | supabase:2125 | recherche:277/285, worker:5757 | OK |
| Mode d'activité (établissement/domicile/mixte) | 15247 | config_json.modeActivite + colonne mode_activite | supabase:2126 | site:1700/1835/3629, recherche:285, worker:4348/5728 | OK |
| Zone couverte (km) | 15260 | domicile.zone + zone_deplacement_km | supabase:2205 | site:767/3651, recherche:291/409 | OK |
| Gratuit jusqu'à (km) | 15261 | domicile.gratuitKm | oui | site:717/1845 | OK |
| Mode de tarification | 15269 | domicile.type + frais_deplacement_type | oui | site:715-726 | OK |
| Montant forfait | 15276 | domicile.forfait + frais_deplacement | oui | site:722 | OK |
| Prix par km | 15278 | domicile.prixKm | oui | site:721 | OK |
| Forfait par commune | 15283 | domicile.forfait | oui | site:720/790 | OK |
| Communes desservies | 15292 | domicile.communes | oui | site:769/1878 ; **recherche.html:409 filtre sur le rayon** | EFFET PARTIEL |

### 1.2 Paramètres › Horaires (l.15299-15384)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Ouverture/fermeture par jour | 15307-15309 | site_config.horaires_salon | 14869 | Affichage : site:1918, worker:5943. Créneaux : **seulement pour les collaborateurs sans horaires propres** (app 8150, site 3340, planning.sql:120-124) | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Bouton « Fermé » / « Ouvrir » | 15310/15313 | idem | idem | idem | EFFET PARTIEL |
| Fermeture exceptionnelle | 15324 | config_json.absences + site_config.absences | 39120 | site:3240, planning.sql:53-61 | OK |
| Ouverture exceptionnelle | 15325 | idem | idem | site:3200, planning.sql:83/130 | OK |
| Supprimer / tout supprimer (exceptions) | 15348/15371 | idem | idem | idem | OK |
| Afficher l'historique | 15366 | affichage seulement | — | — | OK |

### 1.3 Paramètres › Affichage planning (l.15729-15742)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Intervalle des créneaux | 15733 | config_json.slot | supabase:2187 | planning de l'app seulement (11266…) ; le site suit site_config.creneau_intervalle | OK, LIBELLÉ AMBIGU |
| Hauteur créneau | 15738 | config_json.slot_h | oui | 11267/11345 ; valeur par défaut 28 absente de la liste ; les boutons +/− n'enregistrent pas | LIBELLÉ TROMPEUR (faible) |

### 1.4 Paramètres › Apparence (l.15743-15777)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Thème couleurs | 15758 | salons.couleur_primaire/secondaire | 39174 | variables CSS de l'app | OK (la coche ✓ se perd au rechargement) |
| Fond : photo / URL / prédéfinis / aucun | 15765-15773 | config_json.app_bg + localStorage | 39138 | #appBg | OK |
| Opacité du fond | 15768 | window._bgOp (mémoire) | **non** | perdue au rechargement | **NON ENREGISTRÉ** |

### 1.5 Paramètres › Infos établissement (l.15778-15858)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Logo (URL / chargement / défaut) | 15796-15800 | salons.logo | supabase:2085 | en-tête, tickets, site:1704, recherche:285, worker:3119 ; **les e-mails reçoivent du base64, bloqué par Gmail/Outlook** | EFFET PARTIEL |
| Nom (verrouillé) | 15806 | — | — | partout | OK |
| Sous-titre / Téléphone / E-mail / Note des tickets | 15807/15812/15813/15840 | salons.* (envoyés seulement s'ils ont changé) | oui | site, worker, tickets 33519 | OK, mais **risque de perte** (problème n°14) |
| Adresse / CP / Ville | 15808-15811 | salons.* + géocodage | oui | site, recherche, worker:5788 | OK |
| Facebook / Instagram / TikTok | 15816-15818 | config_json.*Url | oui | site:1138-1140, 2262-2290 | OK |
| SIRET / N° TVA intracom. | 15824-15835 | salons.siret / tva | oui | tickets, factures | OK |

### 1.6 Paramètres › Équipe et fiche collaborateur (l.15389-15728)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Verrouillage auto 5/15/30/60/Jamais | 15400 → 1934 | config_json.verrouillage_min | supabase:2205 | 1917-1931, 1545 ; « Jamais : PIN redemandé après 4 h » n'existe pas | LIBELLÉ TROMPEUR |
| Compte gestionnaire, lien opérateur ↔ collaborateur | 15414, 2138 | salon_operateurs (+ collab_id) | 5158 | connexion PIN | OK |
| Nom | 15507 | collaborateurs.nom | 1665 | planning, site:1250 ; les initiales ne sont pas recalculées | EFFET PARTIEL (faible) |
| Couleur | 15509 | collaborateurs.couleur | oui | planning, site:2882 | OK |
| Photo (ajout / suppression) | 15510-15511 | collaborateurs.img | oui | site:1817/2881 | OK |
| Photo publique sur le site | 15517 → 7139 | photo_visible | 1672 | masque seulement l'affichage ; **l'image reste envoyée au visiteur** (site:1046 select *) | EFFET PARTIEL (RGPD) |
| Horaires fixes | 15542 | collaborateurs.horaires | 1666 | app 8136, site 3336, SQL planning.sql:122 | OK |
| Jour « Repos » | 15543 | horaires[dow]=null | oui | **7 jours en repos = horaires du salon** | EFFET PARTIEL |
| Horaires personnalisés (jour) | 15585-15598 | horaires_overrides | 1669 | app 8166, site 3261, SQL 115-119 | OK |
| Pause quotidienne | 15622 | collaborateurs.pause | oui | app 8186, site 3181, SQL 141 | OK (aucun contrôle début < fin) |
| Congé / Absence | 15661 | absences (config_json + site_config) | oui | app, site, SQL | OK |
| Date d'entrée | 15668 | date_entree | 1670 | lue sous le mauvais nom (app 26687 `collab.date_entree` au lieu de `dateEntree`) | **SANS EFFET** |
| Date de départ | 15670 | date_depart | oui | app, site, SQL (validate, next_slots) | OK (l'effacer ne réactive pas la personne) |
| Inactif | 15675 | inactif | oui | app 1050, site 1250, SQL | OK |
| Compétences | 15687 → 1441 | competences | 1673 | site seulement (2831…3235) ; `canCollabDoService` n'est **jamais appelée** ; aucun contrôle SQL ; site:3235 reprend toute l'équipe si personne n'est habilité | EFFET PARTIEL + LIBELLÉ TROMPEUR + PAS RELU par le serveur |
| Créer compte / PIN / Débloquer / Retirer / Supprimer / Ajouter | 15709-15726 | salon_operateurs / collaborateurs | oui | connexion | OK |
| Rôle | 15710 → 2409 | role + permissions remises à zéro | oui | hasPermission 1030 | EFFET PARTIEL (les permissions personnalisées sont effacées sans prévenir) |

**Permissions** (salon_operateurs.permissions, relues par loadOperateurs) : 21 contrôlées.
- **OK :** planning, caisse, clients, products, stats, compta, marketing, settings, operateurs, see_other_planning, see_ca, see_previsionnel_mois, discount, cloture_journee, see_prices_achat, export_data, manage_services, manage_reviews.
- **EFFET PARTIEL :**
  - `cancel_rdv` : vérifiée seulement dans cancelAppt 13385 ; contournée par delAppt et lxSupprimerApptDefinitif.
  - `refund` : vérifiée seulement dans cancelSecureTicket 37096 ; les remboursements d'acompte ne sont pas protégés.
  - `manage_products` : bloque seulement deleteProd 21828.
- Toutes ces permissions sont contrôlées uniquement dans le navigateur.

### 1.7 Paramètres › Site en ligne (l.15859-16204)

| Réglage | app.html | App → colonne | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Site vitrine | 15882 | siteActif → site_actif | oui | site:1167, recherche:280, worker:5910 ; **remis à true par worker:990/1116** | EFFET PARTIEL (écrasé) |
| Réservation en ligne | 15883 | reservationActive → reservation_active | oui | site, recherche:302, SQL recherche_1015:501, worker:2822 ; **remis à true par worker:990/1116** | EFFET PARTIEL (écrasé) |
| Boutique Click & Collect | 15884 | boutique_active | oui | site:1713/2155, worker:1425 | OK |
| Bons cadeaux en ligne | 15899 | salons.bons_cadeaux_online_actif | supabase:2151 | bons-cadeaux.html:324 ; serveur gc-create-checkout absent | OK / NON VÉRIFIABLE côté serveur |
| Adresse du site (slug) | 15928 | salons.slug | oui | site:1055, worker | OK |
| Thème du site | 16002 | style_theme | oui | site:1192, **mais écrasé à 1203-1204** | EFFET PARTIEL |
| Couleur principale / de fond | 16009/16011 | couleur_primaire / couleur_secondaire | oui | site:1203-1204 (défaut « var(--gold) » / #0a0a0a : casse les thèmes clairs et l'accent) | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Style de fond | 16027 | fond_style | oui | site:1216 | OK |
| Slogan / Description / Message d'accueil | 16036/16040/16070 | slogan / description_salon / message_accueil | oui | site:1746/1781/1753, worker:5899 | OK (non échappés) |
| Photo hero, photos de l'établissement | 16047-16064 | photo_hero, photos_salon | oui | site:932/1734/1826 | OK |
| Message après réservation | 16072 | message_confirmation | oui | site:3821 **seulement sans paiement** | EFFET PARTIEL |
| Garantie (aucun / acompte / empreinte) | 16116 | mode_caution | oui | site:1185, SQL apartir.sql:142-188, worker:1308 | OK |
| Acompte : montant / type / min / seuil / description | 16139-16145 | acompte_* | oui | SQL apartir.sql:161-170 (calcul serveur), worker:1305-1318 (refuse un écart) | OK |
| Empreinte : montant | 16148 | empreinte_montant | oui | site:3687, SQL apartir.sql:149 | OK |
| Empreinte : capture auto après (h) | 16149 | empreinte_capture_delai_h | oui, **0 devient 24** | aucun lecteur serveur dans le dépôt | NON ENREGISTRÉ (valeur 0) + NON VÉRIFIABLE |
| Politique d'annulation | 16154 | politique_annulation | oui | worker:4625/5011/5186, compte:1843 | OK |
| Remboursement auto / % annulation tardive | 16155/16158 | remboursement_annulation / remboursement_partiel_pct | oui | worker:4661-4662 | OK |
| Confirmation automatique | 16163 | confirmation_auto | oui | site:1596, SQL apartir.sql:82, worker:2744/4550 | OK |
| Délai min (h) / Résa max (jours) | 16165/16166 | delai_min_heures / delai_max_jours | oui | site:2942, SQL rdv_creneau_refus (recherche_1015:93-107) | OK |
| Intervalles des créneaux | 16167 | creneau_intervalle | oui | site:3260, SQL de proposition ; aucun contrôle à l'insertion | EFFET PARTIEL (faible) |
| Bloquer la création de nouveaux comptes | 16173 | bloquer_nouveaux_comptes | oui | site:1432 seulement (pas compte.html, lx-signup ni SQL) | EFFET PARTIEL + LIBELLÉ TROMPEUR |
| Les clients voient leurs photos | 16178 | photos_visible_client | oui | edge client-mes-photos:43 | OK |
| RDV sur mesure | 16184 | accept_rdv_sur_mesure | oui | site:2138, edge rdv-demande-create:52 | OK |
| Emplacement sur la carte | 16196 | salons.latitude/longitude | oui | site, recherche | OK |
| (Sans interface) Liste produits_en_ligne / services_en_ligne | — (toggleProdOnline/toggleSvcOnline jamais appelées) | produits_en_ligne | — | **filtre encore** la boutique : site:2164, worker:1479-1483 | Filtre fantôme |

### 1.8 Paramètres › Paiements en ligne (l.16205-16212)

Cet onglet n'affiche que le statut Stripe.

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Statut Stripe / Configurer | 3229-3290 | salons.stripe_connect_status (écrit par le worker) | supabase:2144 | SQL apartir.sql:143, worker:1493 | OK |
| Tableau de bord Stripe | 3330 | action ponctuelle | — | worker /connect-dashboard | OK |
| « Prestations concernées par l'acompte » | — | ce réglage n'existe pas | — | — | sans objet |

Les réglages d'acompte et d'empreinte sont dans « Site en ligne » (voir 1.7).

### 1.9 Paramètres › Options commerciales (l.16213-16328)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Fidélité active | 16231 | config_json.fidconf.active | supabase:2187 | caisse 31643… ; **ignorée par site:3875-3910, compte:1024-1090, worker:4141** | EFFET PARTIEL |
| Mécanique (passages / cagnotte / CA) | 16235 | fidconf.mode | oui | caisse ; ignorée par la fiche client (onglet Fidélité), compte.html et site.html | EFFET PARTIEL |
| Nombre de passages | 16244 | fidconf.seuil | oui | caisse, worker:4144, site:3896 | OK |
| Type de remise (fixe / %) | 16246 | fidconf.type | oui | caisse : % par défaut ; worker, site et compte : € par défaut | EFFET PARTIEL (valeurs par défaut incohérentes) |
| Valeur de la remise | 16247 | fidconf.remise | oui | caisse, worker:4145 ; la fiche client affiche toujours « % » | LIBELLÉ TROMPEUR (fiche) |
| La remise s'applique sur | 16252 | fidconf.remiseSur | oui | appliqué **seulement en %** (31800-31809) | EFFET PARTIEL |
| % versé dans la cagnotte | 16262 | fidconf.cagnottePct | oui | 31884 ; **0 impossible** (`||5`) ; tickets « produits seuls » non crédités | EFFET PARTIEL |
| Seuil / type / valeur de la remise CA | 16269-16272 | fidconf.ca* | oui | 31944-31953 | OK |
| Cartes d'abonnement actives | 16298 | config_json.cartes_abo_config.active | 39123 | caisse, fiche client, site:1142 | OK |
| Modèles de cartes | 16324 | config_json.cartes_abo | 39122 | ventes, site:1145, SQL apartir.sql:122 | OK |
| Packs promo (compteur) | 16280 | — | — | — | sans objet |

### 1.10 Paramètres › Caisse et paiements (l.16644-16740)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Modes de paiement actifs (4) | 16653-16669 | config_json.pay_active | supabase:2187 | tuiles de caisse 29275 et paiement divisé 31318 ; **non filtrés** dans bon cadeau 27088, acompte en salon 28238, correction de règlement 33768 et modification de ticket 33840 | EFFET PARTIEL |
| Caisse simplifiée | 16675 | site_config.gestion_caisse_simple | 14867 | 3582, 6492, 22799… | OK |
| Fond de caisse | 16684 | caisse_data.fond + fond_caisse | supabase:2195 | ouverture, Z 6802/37769 | OK |
| Taux de TVA | 16692 | salons.taux_tva | supabase:2108 | nouveaux tickets OK ; **taux produits non mis à jour dans la session** ; **duplicatas recalculés au taux actuel** | EFFET PARTIEL |
| Afficher le détail HT/TVA/TTC sur les devis | 16700 | salons.show_tva_ticket | supabase:2129 | devis 4831/5036/5342 ; **décoché → « TVA non applicable, art. 293 B » même si le salon est assujetti** (4991, 5154, 5431) | LIBELLÉ TROMPEUR / mention légale fausse |
| Validité des devis | 16705 | config_json.validite_devis | oui | devis 4835/5039/5344 | OK |
| Exercice comptable (mois de clôture) | 16722 | salons.exercice_fin_mois | supabase:2114 | lxExercicePeriode, SQL cloturer_exercice | OK |
| Pourboires, remise max, arrondi, impression auto | — | ces réglages n'existent pas | — | — | sans objet |

### 1.11 Options de l'écran de caisse

| Option | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Collaborateur par défaut de la fiche technique | 32635 | calculé à chaque fois | — | 32677 | OK (ce n'est pas un réglage) |
| Menu caisse | 32972 | suit la caisse simplifiée | — | — | OK |
| Icône de famille produit (grille caisse) | 21942 → 30790 | window.PRODICONS (mémoire) | **non** | 30846 | **NON ENREGISTRÉ** |
| Ticket : affichage / impression / buildTicketHTML | 32828/32770/33315 | aucune option | — | — | OK |

### 1.12 Paramètres › SMS et Marketing (l.16329-16451) et page Marketing

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Mode d'envoi Brevo / « Depuis mon téléphone (GRATUIT) » | 16357 | salons.sms_mode | supabase:2134 | envois depuis l'app et anniversaires/relances serveur ; **les rappels 24h/2h et le SMS de réservation en ligne passent toujours par Brevo** (reglages.sql:158, rappels_rdv_online.sql:180, planning.sql:776) | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Lier / délier le téléphone | 16378/16367 | sms_native_device_id | oui | — | OK |
| Recharge automatique (oui / seuil / pack) | 16343 | salons.sms_recharge_* | worker:3875 | worker:3809 | OK |
| Rappels SMS actifs | 16389 | config_json.sms_config.rappelActif | supabase:2205 | reglages.sql:177, rappels_rdv_online.sql:46/186 ; **coupe aussi les rappels e-mail** ; **valeur par défaut affichée mais jamais enregistrée** | LIBELLÉ TROMPEUR + NON ENREGISTRÉ |
| Rappel 24h avant | 16391 | rappel24h | oui | reglages.sql:178 (planification 8:00 absente du dépôt) | OK / NON VÉRIFIABLE |
| Message 24h | 16393 | rappelTexte24h | oui | reglages.sql:180 ; `{prestation}` toujours vide pour les RDV pris au salon (l.189) | EFFET PARTIEL |
| Rappel 2h / message 2h | 16396/16398 | rappel2h / rappelTexte2h | oui | rappels_rdv_online.sql:187-189 | OK |
| Rappels e-mail actifs | 16405 | rappelEmail | oui | rappels_rdv_online.sql:47 | OK |
| Message e-mail de rappel | 16407 / 34359 | rappelEmailTexte | oui | **lu nulle part** (HTML fixe : rappels_rdv_online.sql:85-105, buildRdvEmailHTML 34711) | **SANS EFFET** |
| SMS auto sur réservation en ligne | 16426 | confirmResaOnline | oui | planning.sql:705/744 (CREATE TRIGGER absent du dépôt) ; une demande « en attente » acceptée n'est pas couverte | EFFET PARTIEL |
| Texte du SMS de réservation | 16429 | confirmResaTexte | oui | planning.sql:758 | OK |
| Confirmation par SMS (case) | 16435 | confirmSms | oui | **lu nulle part** | **SANS EFFET** |
| Message SMS de confirmation | 16437 | confirmSmsTexte | oui | envoi manuel 34851 | OK |
| Confirmation par e-mail (case) | 16440 | confirmEmail | oui | **lu nulle part** | **SANS EFFET** |
| Message e-mail de confirmation | 16442 | confirmEmailTexte | oui | **lu nulle part** (doSendConfirm utilise buildRdvEmailHTML) | **SANS EFFET** |
| Anniversaire actif / SMS | 34308/34314 | anniActif / anniSms | oui | clients.sql:828-835 (si sms_auto_serveur), app 35658 | OK |
| E-mail d'anniversaire | 34316 | anniEmail | oui | **seulement quand l'app est ouverte** (35671) ; le libellé dit « automatique » | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Relance inactifs / délai / SMS | 34322-34334 | relance* | oui | clients.sql:854-868 | OK |
| E-mail de relance | 34336 | relanceEmail | oui | seulement quand l'app est ouverte (35700) | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Nom de l'expéditeur SMS | 34379 | smsSender | oui | reglages.sql:182, rappels:191, planning:766 | OK |

### 1.13 Paramètres › Conformité caisse (l.16452-16554)

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Passer en caisse réelle | 16509 → 2918 | salons.mode_caisse (RPC nf525_passer_en_reel, absente du dépôt) | supabase:2066 | tickets.mode_caisse | OK / NON VÉRIFIABLE côté serveur |
| Archive signée (du / au, remise à l'administration) | 16502-16504 | ponctuel | — | 36560/36592 | OK |
| Début / fin du contrôle fiscal | 16514 | audit_log | — | JET 280 introuvable en SQL | NON VÉRIFIABLE |
| Bande mensuelle / FEC (dates) | 16520/16544 | ponctuel | — | exports | OK |
| Comptes comptables (10 champs) | 16532-16535 | config_json.comptaAccounts | 38587 | EBP 38631, Quadratus 38879 ; **le FEC les ignore** (comptes codés en dur l.38448), alors que l'écran dit « FEC, EBP » | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Compte « Bons cadeaux » | 16532 | comptaAccounts.bonsCadeaux | oui | utilisé dans **aucun** export | **SANS EFFET** |
| Clôture Z automatique de nuit | aucun interrupteur | — | — | lx-cloture-auto absente du dépôt | NON VÉRIFIABLE |

### 1.14 Paramètres › Notifications push (l.16639) et autres onglets

| Réglage | app.html | Stockage | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Activer | 40232 → 40127 | push_subscriptions (upsert) | 40114 | send-push absent du dépôt | OK |
| Désactiver | 40233 → 40154 | suppression push_subscriptions + désabonnement | — | **annulé au chargement suivant** : lxEnsurePushSubscription (40251, lancée 5 s après chaque chargement) réabonne dès que la permission est « granted » | **NON ENREGISTRÉ** |
| Tester l'envoi / tester l'affichage | 40233/40237 | ponctuel | — | — | OK |
| Mes documents (Kbis, pièce d'identité recto/verso) | 16588-16628 | salons.documents_*, verification_status | supabase:2140 | — | OK |
| Parrainage / Installer | 16561/16636 | aucun réglage | — | — | OK |

### 1.15 Fiche PRODUIT (editProd l.20838, doEditProd 21705, mapping supabase:3567/3594)

| Champ | app.html | App → colonne | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Photo | 20877 | img → img | oui | site:1269/2191 | OK |
| Nom / contenance / catégorie / description | 20879-20912 | nom, contenance, categorie, description | oui | site, caisse, worker:1477 | OK |
| Fournisseur | 20884 | fournisseur_id | oui | app | OK |
| Code-barre fournisseur | 20888 | code_barre | oui | scan 20264/20408/20607/20809 | OK |
| Code-barre supplémentaire | 20889 | code_barre_supp | oui | **aucun scan ne le lit** | **SANS EFFET** |
| Stock / alerte stock min | 20893-20894 | stock / stock_min | oui | site « Rupture » 2202, worker:1484, alertes | OK |
| Péremption / PAO / ouverture | 20898-20900 | date_peremption, pao_mois, date_ouverture | oui | alertes 2804 | OK |
| Disponible à la vente | 20905 | for_sale | oui | grille caisse, site:2161, worker:1483 ; **ignorée par le scan (20809) et par addProdToCaisse (20831)** | EFFET PARTIEL |
| Consommable | 20906 | for_use | oui | badge et filtre seulement ; la sortie de stock montre tous les produits | EFFET PARTIEL (faible) |
| Disponible en Click & Collect | 20908 | cc → coup_coeur | oui | site:1269/2163, worker:1477/1483 | OK (corrigé), mais filtre fantôme produits_en_ligne |
| Prix d'achat / coefficient | 20918/20921 | prix_achat / coef_multi | oui | marge, PAMP | OK |
| Prix de vente TTC | 20924 | prix | oui | caisse, site:2199, worker:1385 | OK |
| TVA du produit | 20931 | tva_taux | oui | ticket 32282 ; affiche par défaut le taux des prestations, sans 8,5 / 2,1 % (DOM) | EFFET PARTIEL |
| Promo active / prix / début / fin | 20966-20984 | promo_* | oui | caisse, site:2188, worker:1387 ; une promo à 0 € est traitée différemment par le worker | OK (réserve faible) |
| Libellé promo | 20985 | promo_label | oui | app seulement ; jamais affiché sur le site | PAS RELU par le site |
| Texte « visible sur le site et l'annuaire » | 20987 | — | — | l'annuaire n'affiche pas les promos | LIBELLÉ TROMPEUR |
| Onglets Infos / Prix / Promo | 20888-20891 | — | — | **la saisie de l'onglet quitté est perdue** | NON ENREGISTRÉ |
| Couleur de famille | 21924 | config_json.prodcolors | oui | app | OK |
| Icône de famille | 21942 | PRODICONS (mémoire) | non | — | **NON ENREGISTRÉ** |
| Nouvelle famille (sans produit) | 21961 | PCATS (mémoire) | déduite des produits | — | NON ENREGISTRÉ (faible) |

### 1.16 Fiche PRESTATION (editService l.19600, _lxSvcPayload supabase:4572)

| Champ | app.html | App → colonne | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Nom | 19627 | nom | oui | site:1256, worker:5965 | OK |
| Prix | 19630 | prix | oui | recalcul serveur apartir.sql:95-111 ; **0 € impossible** (`_esP||sv.p`) | EFFET PARTIEL (faible) |
| Durée | 19631 | phases | oui | site:2063, next_slots ; **à l'insertion, le serveur reprend la durée envoyée par le navigateur** | OK côté site / PARTIEL côté serveur |
| Famille / genre pour les stats | 19634/19640 | categorie / cat_genre | oui | site, stats | OK |
| Visible sur le site | 19650 | show_site | oui | site:1047, worker:5902, SQL:372 | OK |
| Réservable en ligne | 19651 | book_online | oui | site, SQL:372/505 | OK |
| Prix sur devis / « à partir de » | 19653-19654 | prix_sur_devis / prix_a_partir_de | oui | site:645, SQL apartir.sql:97-100 | OK |
| Ordre | 19290 | ordre | oui | tri du site | OK |
| Phases (editPhases 16796) | — | phases | — | code mort, jamais appelé | — |

### 1.17 FORFAITS et PACKS

| Champ | app.html | App → colonne | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Nom / catégorie / Site / Réservation / devis / à partir de | 18857-18877 | services.* | oui | site, serveur | OK |
| Prix du forfait | 18860 | prix | oui | site, serveur ; **la saisie est cassée** (chaque frappe ré-affiche la fenêtre) | OK en base, saisie difficile |
| Étapes / durée / pause | 18940-19057 | phases | oui | planning, site, SQL occupations_temps_pose | OK |
| Ancien format (table forfaits, editForfait 19105) | — | `dur` absent du payload | — | écran inaccessible ; ces forfaits n'apparaissent jamais sur le site (site:2073) | NON ENREGISTRÉ / sans effet (faible) |
| Pack promo : nom, prestation, séances, prix, expiration | 29717-29722 | packs_clients.* | supabase:2622 | caisse, RPC lx_pack_consommer ; **créé « actif » avant le paiement** (29752) | OK, sauf statut (problème n°12) |

### 1.18 Fiche CLIENT (oM('client') l.27021, onglets l.18195-18560, supabase:1632/2922)

| Champ | app.html | App → colonne | Relu | Effet | Verdict |
|---|---|---|---|---|---|
| Nom, prénom, type, date de naissance, téléphones, e-mail, adresse | 27022-27040 / 18195-18210 | colonnes clients | oui | partout, anniversaires (clients.sql:835) | OK |
| Notes (« Allergies, préférences… ») | 27042/18212 | notes | oui | affichage seulement, aucune alerte | LIBELLÉ TROMPEUR |
| Provenance / parrain | 27046/18230 | acquisition_* | oui | stats 26432 | OK |
| Accepte les SMS | 27064/18555 | sms_ok | oui | campagnes, crons, rappels ; **opt-out de l'espace client non répercuté** ; bloque aussi les rappels de RDV | EFFET PARTIEL |
| Accepte les e-mails | 27065/18557 | email_ok | oui | idem ; pas de lien de désinscription | EFFET PARTIEL |
| Collaborateur habituel | 18199 | collab_pref | oui | **jamais lu** ; vaut T[0] par défaut (28002) | **SANS EFFET** |
| Acompte en ligne (défaut / jamais / toujours) | 18206 | acompte_online | RPC get_client_acompte_mode | site:556/2951, site.sql:126 ; « Toujours » ne marche qu'en mode acompte ; « Jamais » n'exempte pas de l'empreinte | EFFET PARTIEL / LIBELLÉ TROMPEUR |
| Client actif | 18268 | actif | oui | cron serveur et campagne « inactifs » seulement ; envois depuis l'app et autres campagnes l'ignorent | EFFET PARTIEL |
| Famille (lier / délier) | 18241 | famille_ids | oui | navigation seulement ; « RDV coordonnés, marketing famille » n'existe pas | LIBELLÉ TROMPEUR |
| Fiches techniques Cheveux / Peau / Ongles / Bien-être (≈ 25 champs) | 18271-18380 | fiche_tech / colonnes | oui | affichage | OK |
| Allergies des fiches techniques | 18287/18332/18355/18377 | fiche_tech | oui | **aucune alerte** (seul clients_sante en déclenche) | EFFET PARTIEL |
| Questionnaire santé (9 champs) | 36486-36537 | clients_sante | 36410 | alerte RDV 12618 | OK |
| Photo privée / note de photo | 17672/17829 | photos[] | oui | edge client-mes-photos:53 | OK |
| Fidélité « Modifier manuellement » | 18549 | points_fidelite | oui | mode « passages » seulement ; ignore cagnotte et CA | EFFET PARTIEL |
| Client bloqué, remise permanente, VIP, tags | — | ces champs n'existent pas | — | — | sans objet |

---

## 2. À CORRIGER, trié par gravité

### CRITIQUE

**1. Le serveur réactive le site et la réservation en ligne d'un salon qui les avait coupés**
- Fichier : `docs/luxyra-router-worker.js:989-990` (webhook `customer.subscription.updated`, déclenché aussi à chaque renouvellement mensuel) et `:1115-1116` (changement de forfait).
- Explication : pour un salon Pro, le worker écrit `site_actif=true, reservation_active=true`. Un salon fermé pour congés ou qui a coupé la réservation la voit rouverte sans rien faire.
- Correction :
  ```js
  if (newPlan !== "pro") await patchSiteConfig(env, salonId, { site_actif: false, reservation_active: false });
  // supprimer la branche « else » aux deux endroits (l.990 et l.1116)
  ```
  En cas de vrai passage Essentiel → Pro (l.1116 seulement), si on veut rouvrir : ne le faire que si l'ancien forfait était `essential`.

**2. Les rappels sont affichés « actifs » mais aucun ne part tant que le salon n'a rien modifié dans l'écran SMS**
- Fichiers : app.html:16331 et 34143 (valeurs par défaut posées en mémoire `window.SMS_CONFIG={rappelActif:true,…}`, jamais enregistrées) ; `reglages.sql:176, 320, 449`, `rappels_rdv_online.sql:45, 185`, `planning.sql:741`, `clients.sql:825` (`CONTINUE WHEN v_cfg IS NULL`).
- Explication : pour un nouveau salon, `config_json.sms_config` n'existe pas. L'écran montre les rappels 24h, 2h et e-mail cochés, mais le serveur saute ce salon.
- Correction côté app (les deux endroits) :
  ```js
  if(!window.SMS_CONFIG){ window.SMS_CONFIG={/* défauts actuels */}; saveSmsConfig(); }
  ```
  Ou côté SQL, dans chaque fonction de rappel :
  ```sql
  v_cfg := coalesce(v_cfg, '{"rappelActif":true,"rappel24h":true,"rappel2h":true,"rappelEmail":true}'::jsonb);
  ```

**3. Un client qui se désabonne depuis son espace client continue de recevoir les SMS et e-mails des salons**
- Fichiers : `compte.html:1635-1643` (TODO explicite), `docs/edge_1014/lx-profile/index.ts:163`.
- Explication : seul `clients_luxyra` est modifié. Les campagnes et les crons lisent `clients.sms_ok` / `email_ok`, qui ne changent pas. C'est un risque RGPD et CNIL.
- Correction dans lx-profile, pour `toggle_notif` et pour `update` (propager seulement le retrait du consentement) :
  ```ts
  if (patch[field] === false) await sb.from("clients").update({ [field]: false }).eq("client_luxyra_id", lx_id);
  ```
  Vérifier aussi `luxyra-supabase.js:3073-3074` : envoyer `p_sms_ok:null, p_email_ok:null` à `sync_clients_luxyra_from_salon` pour ne pas écraser le choix du client. La définition de cette fonction n'est pas dans le dépôt.

### ÉLEVÉE

**4. Aucun moyen de se désinscrire dans les e-mails et SMS marketing**
- Fichiers : app.html:35712, 35674, 35702, 36260, 36289 (`lxEmailSalon` 36220 sans lien) ; le worker possède `buildUnsubscribeUrl` (l.7148), mais ne l'utilise que pour les tickets (l.3498).
- Correction dans `handleEmailCustom` (worker:3539), avec l'envoi par l'app de `clientId` et `context` :
  ```js
  if (_corps.clientId && ["marketing","anniversaire","relance","carte_rappel_30j","carte_rappel_7j"].includes(_corps.context)) {
    const u = await buildUnsubscribeUrl(_corps.clientId, "email", env);
    htmlContent = (htmlContent||"").replace("</body>", `<div style="text-align:center;font-size:10px"><a href="${u}" style="color:#999">Se désinscrire</a></div></body>`);
  }
  ```
  Ajouter aussi « STOP au … » aux SMS de prospection.

**5. Les horaires du salon ne limitent pas les réservations dès que les collaborateurs ont leurs propres horaires, ce qui est le cas par défaut**
- Fichiers : app.html:7097 (`defHrs` donné à chaque nouveau collaborateur), 8150 ; site.html:3340 ; `planning.sql:120-124` (`lx_horaires_effectifs`).
- Explication : si le salon se met « Fermé » le samedi, le site affiche « Fermé » mais accepte quand même des réservations le samedi.
- Correction minimale (avertissement dans l'onglet Horaires) :
  ```js
  var _perso=getActiveTeam().filter(function(t){return t.hrs&&Object.keys(t.hrs).some(function(k){var v=t.hrs[k];return v&&v.o&&v.c;});});
  if(_perso.length) h+='<div style="font-size:12px;color:#ffb74d;margin-bottom:10px">⚠️ '+_perso.length+' collaborateur(s) ont leurs propres horaires : ce sont eux qui fixent le planning et les créneaux en ligne.</div>';
  ```
- Correction complète : faire des horaires du salon une limite, dans `lx_horaires_effectifs` avant le bloc « ouverture exceptionnelle », et de la même façon dans `getEffectiveHrs` (app) et `_lxSiteEffHrs` (site).
  ```sql
  if not (v_col.horaires_overrides is not null and v_col.horaires_overrides ? p_date::text) then
    v_hs := v_cfg_h -> v_dow;
    if jsonb_typeof(v_hs) <> 'object' then v_o := null; v_c := null;
    else v_o := greatest(v_o, lx_hm(v_hs->>'o')); v_c := least(v_c, lx_hm(v_hs->>'c')); end if;
  end if;
  ```

**6. Les compétences des collaborateurs ne sont appliquées ni dans l'app ni par le serveur**
- Fichiers : app.html:1356-1369 (`canCollabDoService` et `getCollabsForService` ne sont jamais appelées) ; texte l.1390 (« ni assignées dans la modal RDV ») ; aucune trace de `competences` en SQL ; site.html:3235 (`return elig.length?elig:actifs`).
- Correction :
  - Modale RDV : filtrer la liste des collaborateurs.
    ```js
    lxEquipeSelection(a.stId).filter(function(t){ return canCollabDoService(t, svcId) || String(t.id)===String(a.stId); })
    ```
  - Site : `return elig;`
  - SQL `rdv_online_validate` :
    ```sql
    IF NEW.collaborateur_id IS NOT NULL AND NEW.service_id IS NOT NULL THEN
      PERFORM 1 FROM collaborateurs c WHERE c.id=NEW.collaborateur_id
        AND (coalesce((c.competences->>'all')::boolean,true)
             OR c.competences->'services' @> to_jsonb(NEW.service_id)
             OR c.competences->'services' @> to_jsonb(NEW.service_id::text));
      IF NOT FOUND THEN RAISE EXCEPTION 'Ce collaborateur ne réalise pas cette prestation'; END IF;
    END IF;
    ```
    Faire de même pour chaque `items[]`.

**7. « Désactiver » les notifications push est annulé au rechargement**
- Fichier : app.html:40154 (désactivation) et 40251-40282 (`lxEnsurePushSubscription` se réabonne 5 s après chaque chargement).
- Correction :
  ```js
  // lxSalonPushDisable :
  try{localStorage.setItem('lx_push_off_'+_salonId,'1');}catch(e){}
  // lxSalonPushEnable :
  try{localStorage.removeItem('lx_push_off_'+_salonId);}catch(e){}
  // début de lxEnsurePushSubscription :
  if(localStorage.getItem('lx_push_off_'+_salonId)==='1') return;
  ```

**8. Empreinte bancaire : « Mettez 0 pour désactiver la capture auto » ne fonctionne pas, et l'empreinte expire au-delà de 7 jours**
- Fichiers : app.html:14715 et 14865 (`Number(x)||24` transforme 0 en 24, à l'écriture comme à la lecture).
- Correction de la valeur 0 :
  ```js
  empreinte_capture_delai_h:(Number.isFinite(+SC.empreinteCaptureDelaiH)&&+SC.empreinteCaptureDelaiH>=0)?Math.round(+SC.empreinteCaptureDelaiH):24,
  empreinteCaptureDelaiH:(d.empreinte_capture_delai_h!=null&&isFinite(+d.empreinte_capture_delai_h))?+d.empreinte_capture_delai_h:24,
  ```
  Le lecteur serveur (cron d'auto-capture) n'est pas dans le dépôt : vérifier qu'il traite 0 comme « pas de capture auto ».
- Expiration : une pré-autorisation Stripe dure au plus 7 jours, alors que la réservation est possible jusqu'à 365 jours (app 16166). Correction : dans le trigger `apartir.sql` (branche empreinte), refuser `NEW.date_rdv > current_date + 6`, ou passer à un SetupIntent avec débit hors session.

**9. Le thème choisi pour le site est écrasé par les couleurs par défaut : accent ignoré, thèmes clairs illisibles**
- Fichiers : site.html:1203-1204 ; app.html:14723-14724 et 16002.
- Correction côté site :
  ```js
  var _hex=/^#[0-9a-f]{6}$/i;
  if(_hex.test(SITE_CFG.couleur||"") && d.couleur_primaire) t.gold=SITE_CFG.couleur;
  if(_hex.test(SITE_CFG.couleur2||"") && d.couleur_secondaire && !/^light_/.test(th)) t.bg=SITE_CFG.couleur2;
  ```
- Correction côté app : quand on clique sur un thème, faire `SITE_CONFIG.couleur=null; SITE_CONFIG.couleur2=null;`. À l'écriture : `couleur_primaire:/^#[0-9a-f]{6}$/i.test(SC.couleur||"")?SC.couleur:null` (même chose pour couleur2).

**10. Devis : décocher « Afficher le détail HT / TVA / TTC » imprime « TVA non applicable, art. 293 B du CGI » pour un salon assujetti (mention légale fausse)**
- Fichiers : app.html:4991-4992, 5154-5155, 5430-5431 (`if(!showTVA||isAutoEntr)`).
- Correction aux trois endroits :
  ```js
  if(isAutoEntr){ h+="<div class='mention-tva'>TVA non applicable, art. 293 B du CGI</div>"; }
  else if(!showTVA){ h+="<div class='mention-tva'>Prix TTC, TVA "+txTVA+" % incluse</div>"; }
  ```

**11. Taux de TVA : les produits gardent l'ancien taux jusqu'au rechargement, et les duplicatas sont recalculés au taux actuel**
- Fichiers : app.html:16757-16762 (`saveTVA`), luxyra-supabase.js:2109-2111 et 3840 ; app.html:33319-33333 (`buildTicketHTML`).
- Correction dans `saveTVA`, après la confirmation de la base (et revenir à `_prodAvant` en cas d'échec) :
  ```js
  var _prodAvant=SALON_CONFIG.tvaProduits;
  if(val===0 || _prodAvant==null || Number(_prodAvant)===Number(_tvaAvant)) SALON_CONFIG.tvaProduits=val;
  ```
- Correction au début de `buildTicketHTML` :
  ```js
  var txTVA=(typeof a.tauxTVA==="number"&&!isNaN(a.tauxTVA))?a.tauxTVA:lxTauxTVA();
  if(typeof a.totalTVA==="number"&&typeof a.totalHT==="number"){ ht=a.totalHT; tva=a.totalTVA; } else { /* calcul actuel */ }
  ```

**12. Un pack promo est enregistré « actif » avant d'être payé**
- Fichiers : app.html:29752 (et `doAddPack` 18631).
- Explication : si le ticket est abandonné, le client garde un pack utilisable sans l'avoir payé.
- Correction :
  ```js
  var pack={...,status:"pending"};
  _tk.items.push({...,isPack:true,packVenteId:pack.id});
  // dans doFinalPayExecute, une fois le paiement validé :
  _tk.items.forEach(function(it){ if(it.packVenteId){ var pk=PACKS_CLIENTS.find(function(p){return p.id===it.packVenteId;}); if(pk){pk.status="active";pk.ticketNum=tkNum;savePack(pk);} } });
  ```

**13. Fiche produit : changer d'onglet (Infos, Prix, Promo) ou de photo efface les modifications non enregistrées**
- Fichiers : app.html:20888-20891 (boutons d'onglet qui rappellent `editProd(id)`) et 21705 (`doEditProd` ne lit que l'onglet affiché).
- Correction :
  ```js
  function _epGarder(){var d=window._epBrouillon=window._epBrouillon||{};document.querySelectorAll('#modal [id^="ep"]').forEach(function(el){d[el.id]=(el.type==="checkbox")?el.checked:el.value;});}
  // onglets / photo : onclick="_epGarder();window._epTab='prix';editProd(id)"
  // fin de editProd : restaurer _epBrouillon dans les champs ; doEditProd : lire champ OU _epBrouillon ; vider dans cM() et après saveProduct
  ```

**14. Infos établissement : sous-titre, téléphone, e-mail, logo (URL) et note des tickets peuvent être perdus alors que « Infos enregistrées » s'affiche**
- Fichier : app.html:15788 (la photo de référence `_lxSalonFormInit` est reprise à chaque affichage, depuis `window.SALON` qui contient déjà la saisie) ; comparaison l.14397-14403.
- Correction :
  ```js
  if(!window._lxSalonFormInit) window._lxSalonFormInit={sousTitre:SALON_CONFIG.sousTitre||"",logo:SALON_CONFIG.logo||"",tel:SALON_CONFIG.tel||"",email:SALON_CONFIG.email||"",noteTicket:String(SALON_CONFIG.noteTicket||"").slice(0,600)};
  ```
  Ajouter aussi, dans `handleLogoUpload` en cas de succès : `window._lxSalonFormInit.logo=dataUrl;`

**15. « Photo masquée sur le site » cache la photo du collaborateur à l'écran, mais l'envoie quand même au visiteur (RGPD)**
- Fichiers : site.html:1046 (`select("*")` sur collaborateurs), 1250.
- Correction : passer par une vue publique.
  ```sql
  create view collaborateurs_public as select id, salon_id, nom, initiales, couleur, horaires, horaires_overrides, pause, competences, inactif, date_depart, actif, photo_visible,
    case when coalesce(photo_visible,true) then img else '' end as img from collaborateurs;
  ```
  Côté site, lire cette vue avec une liste de colonnes explicite.

**16. Les permissions « Annuler un RDV » et « Rembourser » sont contournables**
- Fichiers : app.html:13322 (`delAppt`), 13357 (`lxSupprimerApptDefinitif`), 14131/14136 ; 28129 (`annulerAcompte`), 13517, 14047.
- Correction en tête de chaque fonction :
  ```js
  if(typeof hasPermission==="function"&&!hasPermission("cancel_rdv")){ requireAdmin("Annuler / supprimer un RDV",function(){ delAppt(id); }); return; }
  if(typeof hasPermission==="function"&&!hasPermission("refund")){ requireAdmin("Rembourser un acompte",function(){ annulerAcompte(apptId); }); return; }
  ```

### MOYENNE

**17. Les cases « Confirmation par SMS » et « Confirmation par Email », et les textes « Message email de confirmation » et « Message email rappel », sont SANS EFFET**
- Fichiers : app.html:16435, 16440, 16442, 16407, 34359 (fenêtre de confirmation 34691-34700 ; e-mails `buildRdvEmailHTML` 34711 ; serveur rappels_rdv_online.sql:85-105).
- Correction : soit retirer ces 4 contrôles, soit les respecter.
  ```js
  var cfg=window.SMS_CONFIG||{}; hasEm = hasEm && cfg.confirmEmail!==false; hasPh = hasPh && cfg.confirmSms!==false;
  var _txt = isRappel ? cfg.rappelEmailTexte : cfg.confirmEmailTexte;
  if(_txt) h += '<tr><td>' + escapeHtml(buildSmsText(_txt, vars)).replace(/\n/g,'<br>') + '</td></tr>';
  ```
  Côté serveur, faire de même avec `v_cfg->>'rappelEmailTexte'` dans `envoyer_rappels_email_24h`.

**18. « Depuis mon téléphone (GRATUIT, illimité) » ne s'applique pas aux rappels 24h et 2h ni au SMS de réservation en ligne : ils partent par Brevo et consomment des crédits**
- Fichiers : app.html:16357/16365 ; reglages.sql:158+, rappels_rdv_online.sql:180, planning.sql:776.
- Correction : si `sms_mode='native'`, insérer dans la file du téléphone (même mécanisme que les anniversaires et relances, clients.sql:821). Sinon, ajouter sous l'option : « Les rappels automatiques passent toujours par Brevo et consomment des crédits ».

**19. Export FEC : les comptes comptables saisis sont ignorés, et le compte « Bons cadeaux » n'est utilisé dans aucun export**
- Fichiers : app.html:38448 (comptes codés en dur), 16532.
- Correction :
  ```js
  var A=_comptaAccounts();
  var ACC_VENTE_PREST=A.services, ACC_VENTE_PROD=A.produits, ACC_TVA=A.tva, ACC_CAISSE=A.especes, ACC_CARTE_CADEAU=A.bonsCadeaux;
  ```
  Revoir aussi le compte par défaut des bons cadeaux (70730000 n'est pas adapté : 4191 ou 467, à voir avec le comptable).

**20. Fidélité : l'espace client et le site ignorent « actif » et « mécanique », et le type de remise a des valeurs par défaut contradictoires**
- Fichiers : compte.html:1024-1090, site.html:3875-3910, worker:4141-4147 (`|| "amount"`) ; app.html:31818 et 14874 (« pourcentage » par défaut).
- Correction :
  - Au chargement :
    ```js
    if(window.FIDCONF&&!window.FIDCONF.type){ window.FIDCONF.type=(window.SITE_CONFIG&&window.SITE_CONFIG.fideliteType==="montant")?"amount":"percent"; }
    ```
  - Dans le worker : utiliser `"percent"` par défaut, et renvoyer `fid_active`, `fid_mode`, `cagnotte_pct` et `ca_seuil`.
  - Dans compte.html et site.html : `if(f.fid_active===false) return;`, puis un affichage adapté à chaque mode.

**21. Fiche client, onglet Fidélité : affiche et modifie toujours des « passages » et des « % », quels que soient le mode et le type**
- Fichiers : app.html:18521-18549, 39924 (`lxEditFidManually`).
- Correction : `var u=_lxFidType()==="pourcentage"?"%":" €";`. Selon `FIDCONF.mode`, modifier `cc.cagnotte` ou `cc.caTotal`, et ajouter `auditLog("FIDELITE_MANUELLE",…)`.

**22. Les modes de paiement désactivés restent proposés en dehors des tuiles de caisse**
- Fichiers : app.html:27088 (bon cadeau), 28238-28240 (acompte en salon), 33768 (correction de règlement), 33840 (modification de ticket).
- Correction :
  ```js
  function lxModeActif(pak){ return !window.PAY_ACTIVE || window.PAY_ACTIVE[pak]!==false; }
  ```
  L'appliquer à chaque liste. En correction de règlement, garder le mode d'origine.

**23. Une ancienne liste « produits en ligne », que plus aucun écran ne modifie, filtre encore la boutique**
- Fichiers : site.html:2164, worker:1479-1483, app.html:14720 (liste réécrite telle quelle).
- Explication : un produit coché « Click & Collect » peut rester invisible et être refusé par le serveur.
- Correction : supprimer le filtre `prodOnline` dans site.html:2164 ; dans le worker:1483, retirer `|| (enLigne.length && enLigne.indexOf(d.id) < 0)` ; puis `update site_config set produits_en_ligne='[]';`

**24. Le serveur applique encore l'ancienne case « acompte obligatoire »**
- Fichier : docs/migrations_1015/apartir.sql:160 et 184 (`OR coalesce(v_cfg.acompte_obligatoire,false)`).
- Explication : un acompte peut être « dû » sur un RDV alors que le salon est en mode « aucun ».
- Correction : `IF v_mode = 'acompte' THEN …` aux deux endroits, puis `UPDATE site_config SET acompte_obligatoire = (mode_caution='acompte');`

**25. « Bloquer la création de nouveaux comptes » n'agit que dans le formulaire du site**
- Fichiers : site.html:1432, 1722 ; compte.html:1570.
- Correction :
  - Dans `rdv_online_validate` : si `bloquer_nouveaux_comptes` est vrai et que la personne n'a ni fiche ni RDV dans ce salon, `RAISE EXCEPTION 'Ce salon n''accepte pas de nouveaux clients en ligne'`.
  - Sur le site : `if(SITE_CFG.resa && !SITE_CFG.bloquerNouveauxComptes)` autour du bouton « S'inscrire ».

**26. « Message après réservation » n'est pas affiché après un paiement d'acompte ou une empreinte**
- Fichiers : site.html:1603 et 1652+.
- Correction : ajouter `(SITE_CFG.msgConfirm?'<p>'+escapeHtmlSimple(SITE_CFG.msgConfirm)+'</p>':'')` dans `_payOk` et dans l'écran « Empreinte enregistrée ».

**27. Les e-mails d'anniversaire et de relance ne partent que si l'app est ouverte, alors que l'écran les annonce « automatiques »**
- Fichiers : app.html:34309, 34323, 35671, 35700.
- Correction : ajouter l'envoi e-mail dans `envoyer_sms_anniv_relance`, ou corriger le libellé (« e-mail envoyé quand l'application est ouverte »).

**28. Le logo chargé dans l'app n'apparaît pas dans les e-mails, car il est en base64**
- Fichier : app.html:36225.
- Correction :
  ```js
  var _lg=C.logo||""; if(/^data:/.test(_lg)) _lg="https://luxyra.fr/api/salon-logo/"+_salonId+".png?v="+_lg.length;
  ```

**29. Icônes de famille produit jamais enregistrées**
- Fichiers : app.html:30790, 29909-29931 ; supabase:2205.
- Correction :
  ```js
  // LX_CFG_SECTIONS :
  {k:"prodicons", mem:function(){return (window.PRODICONS&&typeof window.PRODICONS==="object")?window.PRODICONS:undefined;}, set:function(v){window.PRODICONS=v;}},
  // setProdCatIcon : lxCfgEcrireSections({prodicons:window.PRODICONS});
  // chargement : if(cfg.prodicons&&typeof cfg.prodicons==="object") window.PRODICONS=cfg.prodicons;
  ```

**30. Opacité du fond d'écran jamais enregistrée**
- Fichier : app.html:15768.
- Correction :
  - Ajouter `{k:"app_bg_op", mem:function(){return window._bgOp;}, set:function(v){window._bgOp=Number(v);}}` dans LX_CFG_SECTIONS, et `onchange="lxCfgEcrireSections({app_bg_op:+this.value})"` sur le curseur.
  - Au chargement : `if(cfg.app_bg_op){window._bgOp=cfg.app_bg_op;var b=document.getElementById("appBg");if(b)b.style.opacity=cfg.app_bg_op/100;}`

**31. Le code-barre supplémentaire d'un produit est SANS EFFET**
- Fichiers : app.html:20264, 20408, 20607, 20809.
- Correction : `if(PRODS[i].cb===code||(PRODS[i].cbSupp&&PRODS[i].cbSupp===code))`, et `cbSupp` dans les données d'inventaire (20525).

**32. Prix du forfait : la saisie est cassée (le curseur se perd après chaque chiffre)**
- Fichier : app.html:18860.
- Correction :
  ```js
  oninput="window._forfaitDraft.price=parseFloat(this.value)||0" onchange="_renderForfaitComposer()"
  ```

**33. Durée de la prestation : à la réservation, le serveur reprend la durée envoyée par le navigateur**
- Fichiers : apartir.sql:93-120, recherche_1015.sql:417. À confirmer sur la définition réelle en base.
- Correction dans `rdv_online_validate` :
  ```sql
  SELECT coalesce(sum((ph->>'d')::int),0) INTO v_dcat FROM services s, jsonb_array_elements(s.phases) ph WHERE s.id=v_sid AND s.salon_id=NEW.salon_id;
  NEW.duree_minutes := greatest(coalesce(NEW.duree_minutes,0), v_dtot);
  ```

**34. Fiche client « Acompte en ligne » : les options ne font pas ce qu'elles disent**
- Fichiers : app.html:18206 ; site.sql:111-131.
- Explication : « Toujours » n'agit que si le salon est en mode acompte ; « Jamais » n'exempte pas de l'empreinte.
- Correction : renommer en « Toujours (même sous le seuil du salon) » et « Exempté d'acompte (l'empreinte reste demandée) ». Sinon, dans le trigger, faire passer `v_client_mode='jamais'` avant le bloc empreinte.

**35. « Client actif » décoché n'empêche presque aucun envoi**
- Fichiers : app.html:18268, 35660-35705, 35770-35838.
- Correction :
  - Ajouter `if(cl.actif===false)return;` dans les deux boucles automatiques.
  - Ajouter `c.actif!==false&&` dans chaque filtre de `openCampaignV2`.
  - Afficher la case avec `(c.actif!==false?"checked":"")`.

**36. Les allergies saisies dans les fiches techniques ne déclenchent aucune alerte**
- Fichiers : app.html:18287, 18332, 18355, 18377, 27042 ; alerte 36458.
- Correction :
  ```js
  var ftA=[c.allergiesChev,c.allergiesPeau,c.allergiesOngles,c.contrIndBE].filter(Boolean);
  if(ftA.length) parts.push("Fiche technique : "+ftA.map(escapeHtml).join(", "));
  ```
  Mieux : renvoyer vers l'onglet Santé, qui recueille le consentement.

**37. Un collaborateur mis en « Repos » les 7 jours devient réservable aux horaires du salon**
- Fichiers : app.html:8150, site.html:3339, planning.sql:120-125.
- Correction : distinguer `horaires` vide (`{}`) de « 7 jours à null ».
  - Site et app : `var hasPerso = col.hrs && Object.keys(col.hrs).length>0;`
  - SQL : `elsif v_col.horaires is not null and v_col.horaires <> '{}'::jsonb then v_h := v_col.horaires -> v_dow;`

**38. La permission « Modifier produits / prix » ne bloque que la suppression d'un produit**
- Fichiers : app.html:21828, alors que 20838, 21705, 21851, 21226, 21435 et 21567 ne sont pas protégées.
- Correction : ajouter `if(!hasPermission("manage_products")){requireAdmin(…);return;}` en tête de chacune (`manage_services` pour les prix des prestations).

**39. Verrouillage « Jamais (PIN redemandé après 4 h) » : le délai de 4 h n'existe pas**
- Fichiers : app.html:1915, 15403, 1545-1547.
- Correction : au démarrage, `var INACTIVITY_MS = lxDelaiVerrouMs() || 4*3600*1000;`

### FAIBLE

40. **Rappels SMS actifs coupe aussi les rappels e-mail** (rappels_rdv_online.sql:46, app 35571). Renommer en « Rappels de RDV actifs (SMS et e-mail) », ou retirer `rappelActif` du test e-mail.
41. **Date d'entrée sans effet** (app 26687-26688 lit `collab.date_entree` / `collab.date_depart`). Utiliser `collab.dateEntree` et `lxCollabDepartAu(collab, dk2)`.
42. **`{prestation}` vide dans le rappel 24h des RDV pris au salon** (reglages.sql:189). Ajouter `LEFT JOIN services sv ON sv.id=a.service_id AND sv.salon_id=a.salon_id` et `coalesce(sv.nom,'') AS prestation`.
43. **Rappel 24h des réservations en ligne : l'opposition aux SMS n'est pas vérifiée** (reglages.sql:192-198). Recopier le `NOT EXISTS (… c2.sms_ok=false …)` de rappels_rdv_online.sql:218-221.
44. **Le SMS automatique de réservation n'est pas envoyé quand le salon accepte une demande « en attente »** (planning.sql:724-728). Ajouter `OLD.status IN ('pending_payment','pending') AND NEW.status='confirmed'`, sans doubler avec lxRdvAccepter (app 36866).
45. **« Collaborateur habituel » sans effet**, et T[0] posé par défaut (app 18199, 28002). Mettre `collab:null` à la création ; dans pickRdvClient : `if(cl.collab&&!s.value) s.value=cl.collab;`
46. **Cagnotte à 0 % impossible** (`||5` en app 16223 et 31884), et les tickets « produits seuls » ne sont pas crédités (31664). Utiliser `(FC.cagnottePct!=null&&!isNaN(+FC.cagnottePct))?+FC.cagnottePct:5`.
47. **Remise fidélité en montant fixe non plafonnée, et « s'applique sur » ignoré** (app 31725). Utiliser `var remiseAmt=lxFidRewardAmount();`
48. **« Disponible à la vente » ignoré au scan et par addProdToCaisse** (app 20809, 20831). Ajouter `if(p.forSale===false){showAlert("« "+p.n+" » n'est pas disponible à la vente","warning");return;}`
49. **TVA produit : le taux affiché par défaut est celui des prestations, et les taux DOM manquent** (app 20844, 20929). Base : `SALON_CONFIG.tvaProduits` ; options `[0,2.1,5.5,8.5,10,20]`.
50. **Prix de prestation à 0 € impossible** (app 19668). Utiliser `sv.p=isNaN(_esP)?sv.p:_esP;`
51. **Libellé promo jamais affiché sur le site, et le texte « site et annuaire » est faux** (site 2188-2201, app 20987). Ajouter `p.promoLabel` dans le badge ; remplacer le texte par « visible sur votre boutique en ligne ».
52. **Promo à 0 € traitée différemment par le worker** (worker:1387). Aligner partout sur `promoPrix>0`.
53. **Hauteur créneau** : valeur par défaut 28 absente de la liste (app 15739), et les boutons +/− n'enregistrent pas (11215/11217). Ajouter l'option « Actuel », et `saveSalonConfig()` sur les boutons.
54. **L'intervalle du planning n'est pas celui des créneaux en ligne** (app 15732). Ajouter : « Planning de l'app uniquement. Créneaux en ligne : Site en ligne › Intervalles ».
55. **La recherche ignore les communes cochées** (recherche.html:409). Publier une colonne `domicile_communes_codes text[]` et filtrer dessus.
56. **Apparence : la coche ✓ du thème de l'app disparaît au rechargement** (app 39174). Retrouver la clé du thème d'après `couleurPrimaire`.
57. **Nom du collaborateur : les initiales ne sont pas recalculées** (app 15507). Recalculer `T[ti].i` et l'enregistrer dans `initiales`.
58. **Effacer la date de départ ne réactive pas le collaborateur** (app 14520-14527). Proposer « Réactiver aussi ? » et faire `inactif=false`.
59. **Changer le rôle efface les permissions personnalisées sans prévenir** (app 2440). Le dire dans la confirmation.
60. **`savePermsUI` sans contrôle de permission** (app 2496). Ajouter `if(!hasPermission("operateurs")) return;`. Au-delà : les permissions sont vérifiées seulement dans le navigateur, et la base laisse modifier `permissions` (secu_restrictif.sql:48).
61. **Bons cadeaux en ligne** : exigence `active` seulement, alors que l'acompte accepte aussi `enabled` et `payouts_pending` (app 15896/22090). Utiliser `["active","enabled","payouts_pending"].indexOf(_cnxStatus)>=0`.
62. **Intervalle des créneaux non contrôlé à l'insertion SQL** (rdv_creneau_refus). Ajouter `IF minutes % v_step <> 0 THEN RETURN 'Horaire hors grille';` en tenant compte de l'heure d'ouverture.
63. **Acompte** : passer de « fixe » à « % » ne plafonne pas à 100 ; le montant d'empreinte accepte 1 € (app 16140/16148). Utiliser `Math.max(5,+this.value||30)`.
64. **Listes déroulantes (délai d'annulation, intervalle)** : une valeur hors liste s'affiche comme la première option (app 16154/16167). Ajouter une option « Valeur actuelle ».
65. **Slogan, message d'accueil et description d'acompte non échappés** sur le site (site 1746/1753/3589) et dans les champs de l'app (16036/16047). Utiliser `escapeHtmlSimple` côté site et `_lxAttr` côté app ; idem pour les champs de la fiche produit (20879-20985).
66. **Famille de clients : le libellé promet des « RDV coordonnés » et un « marketing famille » qui n'existent pas** (app 18240). Corriger le texte.
67. **« Accepte les SMS » bloque aussi les rappels de RDV** (app 35576, reglages.sql:193/338). Renommer en « Accepte les SMS (rappels et offres) », ou séparer les deux consentements.
68. **Fiche créée pour un « nouveau client en ligne »** (app 39444) : `genre` et `notes` ne sont pas lus par la sauvegarde. Utiliser `sex`, `no`, et ajouter `smsOk:false, emOk:false, actif:true`.
69. **Famille produit créée sans produit perdue au rechargement** (supabase 2477-2480). Enregistrer `config_json.pcats`.
70. **Ancien format de forfait** (table `forfaits`) : `dur` absent du payload, et ces forfaits sont filtrés sur le site (site 1152/2073). Supprimer ce bloc, ou ajouter `services` et `phases`.
71. **Pause quotidienne** : aucun contrôle début < fin (app 15622). Utiliser `lxPlageHoraireOk(o,c)`.
72. **Code mort qui prête à confusion** : `saveSalonConfig` de luxyra-supabase.js:4428, `editPhases`, `editForfait`, `toggleProdOnline`, `toggleSvcOnline`. À supprimer ou renommer.

### NON VÉRIFIABLE (code serveur absent du dépôt, à contrôler dans Supabase)
- `cron-empreinte-auto-capture` (lecture de `empreinte_capture_delai_h`)
- `gc-create-checkout` (contrôle de `bons_cadeaux_online_actif`)
- `send-push`
- `lx-cloture-auto` et la planification `cloture_z_auto_nuit`
- `nf525_passer_en_reel`, `nf525_archive_enregistrer`
- la planification `rappels-24h-serveur` et celle de `cloturer_exercice`
- le `CREATE TRIGGER` de `fn_sms_confirmation_resa_online`
- `lx_creneau_libre`, `sync_clients_luxyra_from_salon`, la vue `salons_public`
- la valeur en production des drapeaux `rappels_serveur_2h_email` et `sms_auto_serveur`

---

## 3. Bilan chiffré

| Rubrique | Contrôles |
|---|---|
| Établissement, Horaires, Affichage planning, Apparence, Infos établissement | 44 |
| Équipe, comptes et 21 permissions | 46 |
| Site en ligne | 35 |
| Paiements en ligne, Options commerciales, Caisse et paiements, écran de caisse | 43 |
| SMS et Marketing, Conformité caisse, Notifications push, Documents, Parrainage, Installer | 52 |
| Fiches produit, prestation, forfait, pack | 58 |
| Fiche client | 61 |
| **Total** | **339 contrôles (environ 325 réglages distincts)** |

**Réglages totalement SANS EFFET (9) :**
- Message e-mail de rappel
- Message e-mail de confirmation
- Case Confirmation par SMS
- Case Confirmation par e-mail
- Compte comptable Bons cadeaux
- Code-barre supplémentaire
- Collaborateur habituel (client)
- Date d'entrée (collaborateur)
- Compétences (côté app et serveur)

**NON ENREGISTRÉS / perdus au rechargement (8) :**
- Opacité du fond
- Icônes de famille produit
- Famille produit vide
- « Désactiver » push
- Valeurs par défaut des rappels SMS
- Capture auto d'empreinte à 0
- Saisie d'un onglet de la fiche produit
- Infos établissement (cas de la photo de référence)

**Écrasé par le serveur (2) :** Site vitrine et Réservation en ligne (worker).

**Pas d'autre écart de nom du type `cc` / `click_collect`** entre l'app, la base, le site et le worker.
