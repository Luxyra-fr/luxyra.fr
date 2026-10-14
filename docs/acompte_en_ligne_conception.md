# Acompte payé en ligne = ticket scellé dès le paiement — note de conception (NF525)

Version : 2026-10-14 (révision 2 après deux relectures indépendantes, voir § 9) — branche `acompte-en-ligne`. Pièce du dossier technique
(loi anti-fraude TVA, art. 286-I-3° bis CGI).

## 1. Pourquoi

- La TVA d'une prestation de services est exigible à l'**encaissement**, acomptes compris (CGI 269-2-c ; BOI-TVA-DECLA-30-10-30
  § 30, 35, 37 : tout encaissement doit être enregistré dans le système de caisse au moment où il intervient ; § 50 : données
  d'origine inaltérables ; § 90 : corrections = opérations en plus / en moins, jamais de modification).
- Jusqu'ici l'acompte payé en ligne (Stripe Connect, compte du salon) n'avait **aucun ticket** : il n'apparaissait en caisse que le
  jour de la prestation, comme un **mode de règlement** (« En ligne (Stripe) », poste `enligne`, compte 58010000) du ticket final.
  Les exports « TVA à l'encaissement » et « livre des recettes » corrigeaient l'écart hors caisse. Un acompte conservé (absence)
  recevait un ticket « Acompte conservé » le jour de la décision (lxRetenuesSync).
- Nouveau modèle : l'acompte en ligne devient **sa propre pièce de caisse scellée** le jour où il est payé, exactement comme un
  acompte versé au salon (`doSaveAcompte`). Le reste du cycle est aligné sur l'acompte en salon :

| Événement | Ancien modèle (acomptes payés avant la mise en service) | Nouveau modèle (`rdv_online.acompte_modele = 'ticket'`) |
|---|---|---|
| Paiement Stripe | aucune pièce | ticket **« Acompte en ligne »** (+montant, mode « En ligne (Stripe) », TVA au taux du salon, 0 % en franchise), clé `acompte:<rdv>` |
| Prestation réalisée | acompte = mode de règlement du ticket final (poste `enligne`) | ligne négative **« Acompte déjà versé (ticket #X) »** (`isAcompteDeduct`, `acompteTkNum`), montant = part conservée ; le ticket final ne porte plus l'acompte |
| Remboursement (total, partiel, automatique, politique %) | rien en caisse (ou ticket « Acompte conservé » pour la part gardée) | ticket **négatif « Remboursement acompte en ligne (ticket #X) »** par entrée de `remboursements` (clé `rembacompte:<rdv>:<refund_id>`), mode « En ligne (Stripe) » |
| Acompte conservé (absence, hors délai) | ticket « Acompte conservé » | **rien** (recette déjà scellée au paiement) — `lxRetenuesSync` ignore ces RDV |
| Empreinte bancaire capturée | ticket « Empreinte encaissée » | inchangé |

## 2. Où le ticket est créé : dans l'application PRO, pas sur le serveur (décision)

Analyse du code et de la base :

- `public.tickets` : le trigger `ticket_nf525_insert` attribue `num` (max+1 par salon), `hash_prev`, `hash` (SHA-256 serveur
  sur `num|date|heure|ttc|ht|items|prev|salon`) ; `tickets_block_post_cloture` refuse toute pièce datée d'une journée clôturée ;
  `nf525_seal_ticket` scelle (`nf525_hash_seal`) ; signature ES256 par l'edge `nf525-sign` à partir de `tickets`.
- `public.appointments` : la **chaîne de l'application** (`chainTicket` : `TK|tkNum|date|heure|pr|met|prevHash|siret`,
  `_lastTicketHash` relu au démarrage depuis AP trié par tkNum) et le **compteur `tkN`** (`nextTicketNum`) vivent en mémoire
  dans l'application. La **clôture Z** (`cloturerJournee`), les totaux, le journal, les exports et les duplicatas sont calculés
  depuis AP (= appointments). Un ticket inséré par le serveur dans `tickets` seul n'apparaîtrait ni dans la Z ni dans les exports ;
  inséré aussi dans `appointments`, il devrait connaître `_lastTicketHash` et `tkN` de l'appareil (qui peut être en avance : tickets
  non encore transmis, file de secours) → rupture de la chaîne mémoire et collision de numéros (`NUM_MISMATCH`).
- Conclusion : une création serveur **cohérente avec les tickets de l'application n'est pas réalisable sans risque**. On reprend le
  **motif éprouvé des retenues** (`lxRetenuesSync` / `_lxRetenueTicket`, en production depuis le 11/10) :
  1. le serveur (worker Stripe `handleAcompteFinalize`, rejoué par le webhook Connect) enregistre le paiement
     (`acompte_paye=true` ; `acompte_paye_at` posé par trigger = **date de règlement**) ; le trigger
     `trg_rdv_online_acompte_modele` pose `acompte_modele='ticket'` (jamais réécrit) ;
  2. l'application crée le ticket scellé à son prochain passage : `lxAcomptesEnLigneSync` (démarrage +4 s, retour au premier
     plan, sondage 30 s limité à 1 passage / 2 min, ouverture de la fiche du RDV, après un remboursement partiel depuis l'app) ;
  3. **avant tout ticket final** d'un RDV en ligne, `_lxAcompteEnLigneAvantEncaissement` (dans `doFinalPayExecute`) relit le RDV en
     base, crée le ticket d'acompte s'il manque (synchronisation forcée, avec récupération d'un ticket local non transmis ou d'un
     verrou bloqué) et refuse l'encaissement s'il n'existe toujours pas (journée fermée : message explicite ; autre appareil ;
     réseau) : la ligne de déduction référence **toujours** un ticket réel. Lecture en base impossible alors que le ticket porte un
     acompte en ligne (nouveau modèle connu, ou modèle non vérifiable) → refus « Vérification du ticket d'acompte impossible,
     réessayez » (jamais l'ancien modèle « par défaut » ; hors ligne explicite : ancien modèle inchangé, nouveau modèle sans n° refusé).
  4. Les lectures de synchronisation sont des RPC filtrées côté serveur (`lx_acompte_a_ticketer`, `lx_acompte_remb_a_ticketer`,
     `lx_acompte_deja_traite_ancien`, SECURITY INVOKER / RLS) : aucune ligne déjà encaissée ou déjà « conservée » n'arrive à la caisse.

## 3. Garanties

- **Date** : le ticket est daté du jour de sa création (jamais antidaté, jamais sur une journée clôturée : LOCKED_DAYS + lecture
  `clotures`, trigger `tickets_block_post_cloture` en dernier rempart, jamais après 23 h). La date de règlement Stripe est conservée
  (`raw_data.datePaiement` / `dateRemboursement`), imprimée sur le ticket (« Date de règlement … — ticket établi le … ») et
  reprise dans le libellé de la ligne. Les exports « à l'encaissement » utilisent la date de règlement (voir § 5).
- **Numérotation / chaînage / signature** : identiques à tout ticket : `nextTicketNum` + `chainTicket` + `saveAppointment`
  (appointments, meta) + `saveTicketToDb` (tickets : num / hash serveur, scellement, signature ES256 au prochain passage de
  `nf525-sign`). Le n° mémorisé sur le RDV (`acompte_tk_num`), sur l'entrée de remboursement (`tk`), sur la ligne de déduction
  (`acompteTkNum`) et sur les tickets négatifs (`origTkNum`) est le **n° IMPRIMÉ** (`tk.tkNum` = `raw_data.tkNum`) ; si le serveur a
  attribué un autre `num` (deux postes simultanés, `NUM_MISMATCH`), il reste `dbNum` dans `appointments.meta` et toutes les
  correspondances par numéro (`_lxAcompteTicketNums`, `expAcomptesNonSoldes`, relibération d'un RDV à l'annulation d'un ticket,
  rattachement des remboursements) acceptent `tkNum` **ou** `dbNum` (`_lxAcEnLigneNumImprime` lit `raw_data->tkNum`, à défaut `num`).
- **Anti-doublon** (3 niveaux, comme les retenues) : verrou `acompte_tk_claim_at` / `acompte_remb_claim_at` (un seul appareil) ;
  contrôle mémoire (`AP[].acompteKey`) ; contrôle base par clé `raw_data->>acompteKey` + **index unique** `tickets_acompte_key_unique`
  (un 23505 est traité comme « déjà en base » dans `saveTicketToDb`). Les entrées de `remboursements` reçoivent leur n° via la RPC
  `lx_acompte_remb_ticketer` (ligne verrouillée `FOR UPDATE` : aucune perte de mise à jour face au worker qui ajoute une entrée au
  même instant).
- **Verrou bloqué / ticket local non transmis** (`_lxAcEnLigneLocalRetenter`, `_lxAcEnLigneVerrouReprendre`) : 1) un ticket portant
  la clé existe en mémoire (créé ici, `saveTicketToDb` en échec) → renvoi immédiat (idempotent par `raw_data->>id` / clé), succès →
  n° reporté, **aucun nouveau ticket** ; 2) verrou posé depuis **plus de 15 min** sans aucune trace (ni `tickets.raw_data->>acompteKey`,
  ni `appointments.meta->>acompteKey`) → repris par UPDATE conditionnel `.eq(col, ancienne valeur)` (un seul gagnant), audit
  `ACOMPTE_EN_LIGNE_VERROU_REPRIS` ; sinon attente, alerte `DB_ERROR` après 24 h.
- **Version périmée de l'application** (appareil au cache ancien) : une ligne du nouveau modèle déjà traitée à l'ancienne (acompte pris
  comme mode de règlement du ticket final → `status='done'` / `ticket_num` ; ticket « Acompte conservé » → `retenue_tk_num` /
  `retenue_claim_at`) **ne reçoit jamais de ticket d'acompte** (recette déjà en caisse) : exclue des RPC de lecture, refusée par
  `_lxAcompteEnLigneTicket`, signalée une fois par appareil (`DB_ERROR` « acompte en ligne déjà traité par l'ancien modèle »,
  `lx_acompte_deja_traite_ancien`). Inversement l'application à jour ne traite jamais une ligne `acompte_modele='ticket'` à l'ancienne :
  `lxRetenuesSync` la filtre côté serveur (`.or("acompte_modele.is.null,acompte_modele.neq.ticket")`, repli sans filtre si la colonne
  manque), `_lxApOnlineEnrichir` n'emprunte la branche historique que si le modèle relu en base est NULL et si le RDV n'a jamais été
  reconnu « nouveau modèle ».
- **Base** : à l'insertion publique (client anonyme / non propriétaire), `lx_prive.rdv_online_insert_public_propre` force à NULL
  `acompte_modele`, `acompte_tk_num`, `acompte_tk_claim_at`, `acompte_remb_claim_at`, `retenue_at`, `retenue_tk_num`,
  `retenue_claim_at`, `ticket_num`, et `remboursements='[]'`, `acompte_rembourse_montant=0`. Sur UPDATE, le trigger
  `trg_rdv_online_acompte_modele` garde **toujours** `OLD.acompte_modele` (seule exception : passage `acompte_paye` false→true d'une
  ligne NULL → 'ticket', posé par le trigger seul ; personne ne peut basculer un ancien acompte) et garde `OLD.acompte_tk_num` une fois
  posé pour tout rôle autre que `service_role`.
- **Mode test / réel** : `tickets.mode_caisse` est posé par trigger (`a_nf525_marquer_mode`) comme pour tout ticket ; le checkout en
  ligne est bloqué en mode test. **Démo** (`window._lxDemo`) et **vue admin** : aucune écriture. **Hors ligne** : aucune synchro ; un
  encaissement d'un RDV dont le ticket d'acompte manque est refusé (message explicite).
- **TVA** : taux de prestation du salon (`lxTauxTVA`, 0 % en franchise), comme les acomptes en salon et les retenues.

## 4. Ticket final (jour de la prestation)

- Le RDV en ligne (fantôme `online_<uuid>`) porte `acompteEnLigneTicket=true`, `acompteTkNum` et `acompte` = **part conservée**
  (`acompte_montant − acompte_rembourse_montant`) via `_lxApOnlineEnrichir` (chargement, sondage 30 s, synchro).
- `_lxAcompteSalonAmount` renvoie ce montant (comme un acompte salon) → `_doFinalPayExecuteSync` ajoute la ligne
  « Acompte déjà versé (ticket #X) » et neutralise `acompte` / `acompteMode` : `_mapPayment`, `_lxPayBuckets`, la Z, le contre-ticket,
  le livre des recettes ne voient **plus** d'acompte « en ligne » sur ce ticket. Reste à payer nul → bouton « réglé par l'acompte déjà
  versé » (mode « Acompte déjà versé », 0 €).
- Si la part conservée a changé entre l'ouverture de la caisse et la validation (remboursement entre-temps), le règlement saisi
  est remis à zéro et l'opérateur le ressaisit.
- **Trop-perçu** (part conservée > total du ticket, panier réduit) : aucun scellement ; modale « L'acompte versé (X €) dépasse le
  total (Y €). Remboursez la différence (Z €) au client avant d'encaisser. » avec bouton → worker `/api/rdv/acompte-rembourser`
  `{salon_id, rdv_id, montant: Z, trop_percu: true}` (accepté uniquement pour `acompte_modele='ticket'`, statut pending / confirmed,
  montant ≤ acompte − déjà remboursé ; statut et `retenue_at` inchangés ; entrée `remboursements` `par:"trop_percu"`). Puis
  synchronisation (ticket négatif « Remboursement acompte en ligne … trop-perçu rendu avant l'encaissement ») et retour à l'écran de
  règlement : la déduction vaut alors exactement le total. Un panier vide garde le message « Aucune prestation ».
- Vente directe (hors planning) rapprochée d'un RDV en ligne dont l'acompte est déjà en caisse : rapprochement **refusé** + avertissement
  (`VENTE_DIRECTE_ACOMPTE_EN_LIGNE`) — il faut encaisser le RDV depuis le planning pour que l'acompte soit déduit. Les tickets
  d'acompte / remboursement / retenue / contre-tickets ne rapprochent jamais un RDV (`_lxFindOnlineRdvForTicketBrut`).
- Annulation même jour du ticket final : le RDV relibéré garde l'acompte en ligne (mode « En ligne (Stripe) », même n° de ticket,
  `acompteEnLigneTicket` dans l'élément `isAcompteData`) → nouvelle déduction au ré-encaissement.

## 5. Rapports et exports (aucun double comptage)

- **Z / totaux / stats** : le ticket d'acompte compte le jour de sa date (poste « Payés en ligne » via `met`) ; le ticket de
  remboursement est négatif sur le même poste ; les lignes `isAcompte` / `isAcompteCancel` sont regroupées « Acomptes… » dans les stats.
- **Journal / FEC** : libellés par `_lxLibAcompte` (nom de la ligne), poste « en ligne » → compte 580100 ; aucun changement de format.
- **Paiements en ligne — TVA à l'encaissement** (`_lxPaiementsEnLigne`, `expTvaPaiementsEnLigne`, `_lxAjustEnLigneMois` →
  URSSAF, récap TVA) : lignes du nouveau modèle marquées `caisse:true` avec `caisseDate` (date du ticket d'acompte) et
  `rembCaisse` (date du ticket de remboursement). Ajustement du mois = m·[paiement∈M] − m·[ticket acompte∈M] − m·[remboursement∈M]
  + m·[ticket remboursement∈M] (`_lxAjustLigneCaisse`) : **0** dans le cas normal (ticket le jour du règlement) ; non nul
  seulement si l'application est restée fermée à cheval sur deux mois (le ticket, daté du mois suivant, porte la date de règlement).
- **Livre des recettes (micro)** : inchangé — les tickets « en ligne » sont exclus du comptoir (`_lxPayBuckets` → poste `enligne`),
  les paiements sont listés à la date de paiement et les remboursements à la date de remboursement : chaque flux compte une fois.
- **Acomptes reçus non soldés (4191)** : les RDV du nouveau modèle sont exclus de la section « rdv_online » et traités dans la section
  « tickets d'acompte » : reste = ticket − tickets de remboursement le référençant ; soldé si déduit (`isAcompteDeduct`), si le RDV est
  encaissé en base, ou conservé (`retenue_at`).
- **Bordereau Stripe** : inchangé (lecture `rdv_online`).

## 6. Transition

- `acompte_modele` NULL = **ancien modèle**, conservé intégralement (mode de règlement au ticket final, ticket « Acompte conservé »,
  exports avec ajustement). Aucun ticket d'acompte n'est jamais créé rétroactivement (le trigger ne marque que le passage
  `acompte_paye false → true` postérieur à son installation, et ne réécrit jamais une valeur).
- Ordre de mise en service : 1) déployer `app.html` (`luxyra-supabase.js?v=20261014-4`) / `compte.html` et le **worker**
  (`docs/luxyra-router-worker.js` : `trop_percu`, lecture `acompte_modele` avec repli) — le code gère `acompte_modele` absent
  (RPC absentes → synchro sans effet, `lxRetenuesSync` en repli) ; 2) appliquer `docs/sql_acompte_en_ligne.sql` ; 3) vérifier
  (requêtes de contrôle en fin de script). Les appareils encore sur l'ancienne version doivent recharger l'application (voir § 3,
  « version périmée » : aucun double comptage, mais le ticket d'acompte n'est pas créé pour une ligne déjà traitée à l'ancienne).
- Au 14/10/2026, la base ne contient qu'un acompte en ligne payé (ancien modèle, RDV terminé) et aucun RDV actif avec acompte payé ;
  le script SQL n'est pas encore appliqué (vérifié : aucun trigger `trg_rdv_online_acompte_modele`, colonnes absentes).

## 7. Cas limites tracés

| Cas | Comportement |
|---|---|
| Paiement → ticket | finalize (ou webhook) → `acompte_paye_at`, `acompte_modele='ticket'` → synchro app ≤ 2 min (ou immédiate à l'ouverture de la fiche / au démarrage) → ticket « Acompte en ligne » daté du jour, `acompte_tk_num` posé, fantôme mis à jour, audit `ACOMPTE_EN_LIGNE`. |
| Prestation | `doFinalPayExecute` → relecture RDV (ticket présent) → ligne « Acompte déjà versé (ticket #X) » (part conservée) → ticket final sans acompte, Z équilibrée. |
| Absence (no-show) | `_lxCancelOnlineRdv` pose `retenue_at` ; cron de remboursement l'ignore ; `lxRetenuesSync` ignore `acompte_modele='ticket'` → **aucun** ticket supplémentaire. |
| Remboursement partiel (app ou %) | worker ajoute une entrée `remboursements` → synchro (forcée depuis l'app) → ticket négatif du montant remboursé ; part conservée mise à jour sur le RDV ; aucun ticket « Acompte conservé ». |
| Remboursement total (salon / client dans les délais) | cron → entrée « automatique » → ticket négatif du total ; RDV annulé retiré du planning. |
| Journée clôturée / après 23 h | aucune création (LOCKED_DAYS / `clotures` / heure ≥ 23) ; encaissement d'un RDV sans ticket d'acompte refusé avec le message « Le ticket d'acompte sera créé à l'ouverture de la prochaine journée de caisse ; encaissez après sa création (ou demain) » ; reprise le jour ouvert suivant, date de règlement imprimée. |
| Trop-perçu | part conservée > total → refus + remboursement de la différence depuis la caisse (`trop_percu:true`), ticket négatif, puis encaissement (déduction = total). |
| Verrou bloqué | ticket local non transmis → renvoi immédiat ; verrou > 15 min sans trace → repris (UPDATE conditionnel) ; sinon alerte à 24 h. |
| Appareil à l'ancienne version | RDV encaissé avec l'acompte en mode de règlement, ou « Acompte conservé » : la ligne (`done` / `ticket_num` / `retenue_*`) est exclue des RPC, jamais ticketée, `DB_ERROR` une fois ; la déduction au ticket final n'est jamais faite sans relecture du modèle en base. |
| Application fermée 3 jours | paiement J, ticket J+3 (daté J+3, « réglé le J ») ; exports à l'encaissement → ajustement 0 si même mois, ± si changement de mois. |
| Deux appareils | verrou `acompte_tk_claim_at` (UPDATE conditionnel) ; perdant : « déjà en base » → report du n° imprimé (`raw_data->tkNum`) ; index unique en dernier rempart ; verrou bloqué repris après 15 min sans trace ; après 24 h sans ticket : alerte `DB_ERROR`. |
| Hors ligne | aucune synchro ; encaissement d'un RDV sans ticket d'acompte refusé avec message. |
| Ancien modèle | `acompte_modele` NULL → `_lxApOnlineEnrichir` branche historique, `_lxAcompteSalonAmount` = 0, bucket `enligne` au ticket final, retenue par `lxRetenuesSync`, exports historiques. |

## 8. Journal des événements

`ACOMPTE_EN_LIGNE` (ticket d'acompte), `ACOMPTE_EN_LIGNE_REMBOURSE` (ticket négatif), `ENCAISSEMENT_REFUSE_ACOMPTE_EN_LIGNE`,
`VENTE_DIRECTE_ACOMPTE_EN_LIGNE`, `ACOMPTE_TROP_PERCU_REMBOURSE`, `ACOMPTE_EN_LIGNE_VERROU_REPRIS`, `DB_ERROR` (verrou > 24 h ;
« acompte en ligne déjà traité par l'ancien modèle »). Comme `ACOMPTE` / `ACOMPTE_CONSERVE`, ces codes sont dans `audit_log`
(pas de code JET dédié dans `nf525_jet_code`, inchangé).

## 9. Révision 2 (deux relectures indépendantes) — ce qui a changé

1. Version périmée : lignes `done` / `ticket_num` / `retenue_*` exclues (RPC + garde `_lxAcEnLigneDejaAncien`), `DB_ERROR` une fois ;
   `_lxApOnlineEnrichir` et `lxRetenuesSync` ne traitent jamais une ligne `ticket` à l'ancienne.
2. Verrou bloqué : renvoi d'un ticket local (`_lxAcEnLigneLocalRetenter`), reprise après 15 min sans trace (`_lxAcEnLigneVerrouReprendre`),
   aussi pour les remboursements ; utilisé avant tout refus d'encaissement.
3. SQL : `rdv_online_insert_public_propre` étendu ; trigger `acompte_modele` (OLD toujours gardé, marquage par le trigger seul) et
   `acompte_tk_num` (seul `service_role` peut le changer une fois posé).
4. Trop-perçu : modale + worker `trop_percu:true`.
5. Numéros : n° imprimé partout, correspondance `tkNum` ou `dbNum`.
6. Après 23 h / journée clôturée : message explicite.
7. `doFinalPayExecute` : exception pendant les contrôles → refus si le ticket d'acompte n'est pas connu.
8. Lectures par RPC `lx_acompte_a_ticketer` / `lx_acompte_remb_a_ticketer` (filtre serveur, `refunded_at desc`).
9. `lxRetenuesSync` : filtre serveur du nouveau modèle, repli si colonne absente.
10. `compte.html` : « Reçu d'acompte n° X » aussi sur les RDV à venir et annulés / absence (échappé, `_lxRecuAcompteHtml`).
11. `luxyra-supabase.js?v=20261014-4`.
