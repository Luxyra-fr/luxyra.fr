-- =====================================================================================================
-- Base de connaissances du bot support (support_bot_kb) — mise à jour du 15/10/2026
-- Couvre les changements visibles des 13 et 14/10/2026 (app pro, caisse, réglages, clients, espace client).
-- Rédigé d'après le code (app.html, luxyra-supabase.js, compte.html, lx-client-app.js, SQL docs/migrations_1014)
-- et l'état de la base lu le 15/10 (drapeaux app_config sms_auto_serveur = true et rappels_serveur_2h_email = true ;
-- crons rappels-24h-serveur 8:00 UTC, rappels-2h-serveur */10, rappels-email-24h-serveur 8:05 UTC,
-- sms-anniv-relance-serveur 8:30 UTC, sms-differes-file */2).
-- AUCUN effet sur la caisse, les tickets ou les clôtures. Idempotent : peut être rejoué.
-- À appliquer par Alexandre (SQL editor Supabase), puis vérifier avec le banc lx-bot-eval.
-- =====================================================================================================
BEGIN;

-- ---------------------------------------------------------------- 1) Lignes réécrites (contenu devenu faux ou incomplet)
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le) VALUES

('parametres', 'Menu Paramètres (⚙️)', 2, $kb$Rubriques, dans l'ordre : Établissement ; Horaires ; Équipe ; Affichage planning ; Apparence ; Infos établissement ; Site en ligne ; Options commerciales ; Caisse et paiements ; Paiements en ligne ; SMS et Marketing ; Conformité caisse (exports FEC, archives, contrôle fiscal, « Exporter données ») ; Mes factures ; Parrainer un professionnel ; Mes documents ; Installer l'application ; Notifications push ; Centre d'aide ; Migration depuis ancien logiciel ; Support Luxyra. Bouton « 🚪 Se déconnecter » en bas (ne déconnecte que CET appareil).
En haut de la page : le forfait (Essentiel ou Pro) avec « Gérer mon abonnement » et « Changer de forfait » (pendant l'essai : « S'abonner »).
Avec le forfait Essentiel, « Site en ligne », « Paiements en ligne » et « SMS et Marketing » sont grisés (réservés au forfait Pro). Pendant l'essai gratuit, ils sont ouverts (sauf l'envoi de SMS).
IL N'EXISTE PAS de rubrique « Sécurité » ni de rubrique nommée « NF525 » (c'est « Conformité caisse »).
Tickets de caisse : une NOTE libre (ex. conditions d'échange des produits, 600 caractères max) se saisit dans Paramètres → « Infos établissement » → « Note en bas des tickets », puis « Enregistrer les infos salon ». Elle s'imprime automatiquement en bas de tous les tickets suivants (et des tickets envoyés par email). Le reste du ticket (montants, TVA, mentions légales) n'est pas modifiable.$kb$, true, now()),

('planning', 'Planning et rendez-vous', 8, $kb$- Créer : « + Nouveau RDV », ou clic sur un créneau libre. Choisir client (ou « Nouveau client »), prestation, collaborateur → « Valider ».
- Alertes à la création ou au déplacement : chevauchement (« Conflit de RDV » → « 🔄 Modifier le créneau » ou « Forcer le RDV quand même ») ; pause (« Forcer malgré la pause ») ; rendez-vous qui se termine après la fermeture (« Ce rendez-vous se termine après la fermeture. Vous pouvez le créer quand même si vous êtes sûr. ») ; hors horaires (« Hors horaires » → « 🔓 Créer quand même (RDV exceptionnel) ») ; absence, congé ou jour fermé = « Créneau bloqué », impossible de forcer.
- Déplacer : appui long puis glisser ; fenêtre « Déplacer ce RDV ? » (Avant / Après) → « Confirmer ». Le dépôt suit les horaires réels du jour du collaborateur ; congé/absence/jour fermé = « ⛔ Impossible : … » sans bouton Confirmer ; pause ou fin après fermeture = avertissement « ⚠️ Attention », on peut confirmer. En changeant de collaborateur, toutes les étapes du RDV le suivent. Un RDV encaissé ou annulé ne se déplace pas.
- Clic sur un RDV : fiche avec « Modifier », « Encaisser », « Annuler RDV », corbeille 🗑️.
- ANNULER ≠ SUPPRIMER. « Annuler RDV » (« Annuler RDV (notifie le client) » pour un RDV en ligne, motif et case « Prévenir le client » facultatifs) → « Oui, annuler » : le RDV disparaît du planning mais RESTE dans l'historique du client. La corbeille 🗑️ ouvre « Supprimer définitivement ? » avec « Annuler le RDV (garder l'historique) », « Supprimer définitivement » (seulement pour un RDV créé par erreur : effacé sans trace, client non prévenu) et « Retour ». Pas de corbeille sur un RDV encaissé (« 🔒 Encaissé » : passer par la caisse, avoir) ni sur un RDV pris en ligne. Hors ligne : « Hors ligne : l'annulation n'a pas pu être enregistrée, le rendez-vous est conservé. »
- Autres : « Aujourd'hui », flèches, « 🖨 Imprimer », vue 1 à 7 jours, « + » / « − » pour la hauteur des créneaux.
Guide : luxyra.fr/aide/planning (sections Annuler ou supprimer, Alertes, Glisser-déposer).$kb$, true, now()),

('cloture', 'Clôture de la journée (Z)', 11, $kb$Bouton « CLÔTURE DE LA JOURNÉE » dans le bandeau du chiffre d'affaires de l'accueil. Fenêtre « Clôture quotidienne » : RDV non encaissés signalés, comptage du tiroir, justification obligatoire en cas d'écart → « Valider la cloture ». Définitive.
Elle clôture UNIQUEMENT la journée en cours. Si la clôture n'a pas été faite, la journée est clôturée AUTOMATIQUEMENT dans la nuit (clôture automatique, sans comptage du tiroir) : il n'y a rien à faire. Depuis le 15/10/2026, à la première ouverture de l'application le lendemain, espèces et chèques de cette journée sont mis au coffre automatiquement (comme après une clôture manuelle). Ne jamais conseiller de cliquer le lendemain matin pour « rattraper » (cela clôturerait le nouveau jour et bloquerait ses encaissements).
Mode caisse simplifiée (auto-entrepreneur) : la clôture est facultative, le comptage du tiroir aussi ; la clôture automatique de nuit s'en charge.
Fenêtre « Clôture impossible pour le moment » : des tickets de CET appareil ne sont pas encore transmis au serveur (coupure Internet). Vérifier la connexion puis « Réessayer la transmission » (voir l'entrée integration_1014 pour un ticket bloqué, « Signaler au support » et « Forcer la clôture »).
Historique : Caisse → « Journal / Bande Z » → « Historique des clôtures Z ». Bande mensuelle : Paramètres → « Conformité caisse » → « Générer la bande mensuelle ».
Guide : luxyra.fr/aide/cloture-du-jour$kb$, true, now()),

('annulation', 'Annuler un ticket (avoir)', 10, $kb$Accueil → « Caisse » → « Gestion des tickets » → « ❌ Avoir / Annuler » sur le ticket → fenêtre « Annulation du ticket » → « Motif (obligatoire) » → « Confirmer ». Le ticket n'est jamais supprimé : il reste marqué annulé et un contre-ticket négatif est créé et tracé (loi anti-fraude). Permission « remboursement » ou PIN administrateur.
Depuis le 14/10/2026, l'annulation DÉFAIT AUSSI les effets du ticket, automatiquement : fidélité (la variation du ticket est retirée : passages, cagnotte, CA cumulé, jamais sous 0), bon cadeau utilisé en paiement recrédité, séance de forfait rendue, forfait / bon cadeau / carte d'abonnement vendus sur ce ticket désactivés s'ils n'ont pas servi, produits remis en stock (mouvement « retour »). Message « Effets du ticket annulés : … » ; si un point échoue : « Ticket annulé. À régulariser à la main : … ».
Ticket encaissé AVANT le 14/10/2026 : ses effets n'ont pas été relevés ; après l'annulation, un message liste ce qu'il faut vérifier et corriger à la main (stock, forfait, bon cadeau, carte, fidélité).
Refusés : annuler un contre-ticket (« Un contre-ticket d'annulation ne peut pas être annulé ni modifié (opération négative définitive). ») ; annuler deux fois le même ticket ; annuler un ticket d'acompte ici (passer par « Annuler l'acompte » depuis le rendez-vous ; acompte payé en ligne : remboursement depuis le rendez-vous).
« 💳 Modifier règlement » est possible le jour même avant la clôture et hors paiement mixte : le ticket n'est jamais modifié, une pièce de correction numérotée est créée. Après la clôture : « Corriger le moyen de paiement (pièce tracée) ».
Réimpression (duplicata) : si elle ne peut pas être enregistrée (2 essais), l'impression est bloquée (« … impression bloquée. Réessayez une fois la connexion rétablie. »).
Guide : luxyra.fr/aide/tickets-et-annulations$kb$, true, now()),

('bons', 'Bons cadeaux', 12, $kb$Accueil → « Bons cadeaux » : onglets Actifs, Utilisés, Expirés, Tous ; « 🎁 Offrir un bon » (gratuit), recherche, « Export CSV ». Sur un bon : Imprimer, Modifier, Annuler.
Vendre un bon : Encaissement → « 🎁 Bon cadeau » → « Créer un bon cadeau » (encaissé avec le ticket). Utiliser un bon : mode de paiement « Bon cadeau ».
Depuis le 14/10/2026 : le bon choisi est seulement RÉSERVÉ sur le panier (solde réel relu) puis DÉBITÉ au moment où le ticket est validé (un panier abandonné ne consomme plus le bon). Échec : « Bon cadeau CODE non débité : … Aucun ticket n'a été créé ; choisissez un autre règlement. » Un bon absent de l'appareil est cherché dans la base. Bon acheté en ligne dont le paiement n'est pas confirmé : refusé (« Paiement en ligne de ce bon non confirmé : il ne peut pas encore être utilisé. ») ; bon annulé : « Ce bon a été annulé. » ; réseau : « Vérification du bon impossible (connexion). Réessayez. » Un bon ne s'applique qu'une fois par ticket. Ticket annulé = bon recrédité automatiquement.
Vente en ligne : Paramètres → « Site en ligne » → « Bons cadeaux en ligne » (forfait Pro et paiements en ligne Stripe actifs). Le client retrouve ses bons dans son espace client, onglet « 🎁 Bons cadeaux ».$kb$, true, now()),

('fidelite', 'Fidélité, packs, cartes d''abonnement', 13, $kb$Paramètres → « Options commerciales » : 1. Programme de fidélité (case « Fidélité active », « Mécanique de fidélité » : carte tampon par passages, cagnotte, CA cumulé) ; 2. Packs promo (vente en caisse : « Vendre un pack promo ») ; 3. Cartes d'abonnement (« + Créer une carte d'abonnement »). Carte d'abonnement et fidélité ne se cumulent pas.
« Type de remise » (passages ou CA cumulé) : « Montant fixe (€) » ou « Pourcentage (%) », avec « Valeur de la remise ». Depuis le 14/10/2026 le montant fixe est appliqué en euros en caisse (avant, il était appliqué à tort comme un pourcentage). La remise est proposée AVANT le premier règlement quand le seuil est atteint.
Séance de pack : décomptée au moment du paiement (plus à l'ajout de la ligne). Sans connexion : « Séance du forfait « … » mémorisée : elle sera décomptée automatiquement dès le retour de la connexion. » (jamais deux fois). Message « séance à vérifier » si la connexion a coupé pendant l'envoi : contrôler la fiche du client, onglet Packs.
Ticket annulé : la fidélité revient à son niveau d'avant le ticket et la séance est rendue.
Guide : luxyra.fr/aide/fidelite-et-bons-cadeaux$kb$, true, now()),

('clients', 'Clients', 21, $kb$Accueil → « Clients » : recherche, tri, « 🔍 Doublons » (fusion), bouton « + » pour créer. Fiche : Infos, Cheveux/Peau/Ongles selon le métier, Photos, Historique, Fiche T (fiche technique), Carte, Packs, Fidélité, RGPD, C.A.
Effacement RGPD = ANONYMISATION : fiche → onglet « RGPD » → carte « Droit à l'effacement (Art. 17 RGPD) » → « 🗑 Effacer les données du client » → lire la liste → taper SUPPRIMER → « 🗑 Supprimer ». La fiche devient « Client anonymisé » : nom, téléphone, e-mail, adresse, date de naissance, fiches techniques, notes, photos, questionnaire santé, commentaires et adresse des RDV effacés ; points de fidélité perdus ; réservations en ligne anonymisées. Les tickets de caisse sont CONSERVÉS (obligation fiscale) et rattachés à la fiche anonyme ; le compte Luxyra du client et ses données dans d'autres établissements ne sont pas touchés. Connexion Internet obligatoire (« Effacement impossible hors connexion »). Succès : « ✓ Client anonymisé conformément au RGPD ». Export préalable possible : « 📤 Exporter les données ».
Il n'y a PAS de bouton d'import de fichier clients : l'import se fait via « Migration depuis ancien logiciel ».
Guide : luxyra.fr/aide/fichier-clients$kb$, true, now()),

('rappels_automatiques', 'Rappels automatiques (SMS veille, SMS 2 h, e-mail) — envoyés par le serveur', 14, $kb$Depuis le 15/10/2026, TOUS les rappels sont envoyés PAR LE SERVEUR LUXYRA, même si l'application est fermée sur tous les appareils. Plus besoin de laisser une tablette allumée.
Réglages : Paramètres → « SMS et Marketing » (aussi Marketing → onglet « 🔔 Rappels RDV ») :
- « 🔔 Rappels SMS actifs » : interrupteur général. Il doit AUSSI être coché pour que les rappels par e-mail partent.
- « ⏰ Rappel 24h avant » : SMS de la veille, envoyé chaque matin vers 10 h (heure d'été ; 9 h en hiver) pour les RDV du lendemain.
- « ⏰ Rappel 2h avant » : SMS environ 2 h avant le RDV (vérification toutes les 10 min, entre 8 h et 21 h).
- « ✉️ Rappels Email actifs » : e-mail de rappel la veille, vers 10 h (gratuit, illimité ; le client doit avoir un e-mail).
- Textes modifiables ; variables {prenom}, {nom}, {heure}, {date}, {prestation}, {salon}, {collab} (nom du collaborateur du RDV).
Règles : un seul rappel de chaque type par RDV, même avec plusieurs appareils ouverts ; une confirmation envoyée le jour même remplace le rappel de la veille ; jamais de SMS entre 21 h et 8 h ; seuls les clients qui ont accepté les SMS reçoivent les SMS ; sans crédit, le SMS attend la recharge. En mode « Depuis mon téléphone (Android) », c'est le téléphone qui envoie les SMS.
SMS d'anniversaire et de relance automatique : aussi envoyés par le serveur (voir l'entrée campagnes_sms_1015).
Forfait Pro requis pour les SMS (aucun SMS pendant l'essai). Rappel non reçu par un client précis malgré tout cela : <ESCALATE/>
Guide : luxyra.fr/aide/sms-et-rappels$kb$, true, now()),

('click_collect', 'Boutique Click & Collect (commandes en ligne)', 16, $kb$Activation : Paramètres → « Site en ligne » → « Boutique Click & Collect » (forfait Pro). Seuls les produits actifs et en vente apparaissent ; un produit à 0 en stock est affiché « Rupture de stock ».
Côté client : il commande sur le site de l'établissement (compte client obligatoire). Si l'établissement a activé les paiements en ligne (Stripe), il paie tout de suite ; sinon il réglera sur place. Il reçoit un email avec un numéro de commande et un CODE DE RETRAIT à 6 caractères, visible aussi dans son espace client (onglet « Commandes »).
Côté établissement : tuile « Commandes » sur l'accueil (avec le nombre à traiter) ; un email arrive aussi à chaque commande. Boutons : « Marquer prête » (le client est prévenu par email), « Remettre au client », « Annuler » (s'il a payé en ligne, il est remboursé automatiquement).
Remise : saisir le code de retrait donné par le client (ou cocher « identité vérifiée » s'il ne l'a plus). Chaque remise passe par la caisse et produit un ticket de caisse (obligation de la caisse sécurisée, loi anti-fraude), qui sort aussi les produits du stock. Commande payée en ligne : « Remettre (ticket de caisse « payé en ligne ») » ouvre la caisse avec les produits ; le seul mode de paiement proposé est « Payée en ligne » pour le montant déjà payé sur le site, puis « Encaisser » ; le ticket indique « Payé en ligne (Click & Collect) » et la clôture Z le range dans « Payés en ligne ». Le ticket doit reprendre toute la commande : s'il manque un article, annuler la commande (le client est remboursé) et refaire une vente en caisse. Commande à régler sur place : « Encaisser puis remettre » ouvre la caisse avec les produits et on encaisse normalement. Dans les deux cas, la commande est marquée remise avec le numéro du ticket.
Une commande remise affiche « Remise le … à … par … » : elle ne peut pas être remise une deuxième fois. Si un client dit ne pas avoir reçu sa commande, ouvrir l'onglet « Remises » de la tuile Commandes pour voir la date, l'heure, la personne qui l'a remise et si le code a été vérifié.$kb$, true, now()),

('compta', 'Comptabilité et statistiques', 17, $kb$Accueil → « Caisse » → « Journal / Bande Z » (permission comptabilité) : CA du mois, journal, historique des Z, « Documents comptables » (bande Z mensuelle PDF, déclaration URSSAF pour les micro-entreprises, journal de caisse, récap TVA, journal des ventes, annulations, acomptes en ligne, paiements en ligne (TVA à l'encaissement), livre des recettes (micro), acomptes reçus non soldés, fichier Excel).
FEC et exports EBP / CEGID : Paramètres → « Conformité caisse ». Export complet de toutes les données du compte (établissement, clients, prestations, forfaits, produits, stock, fournisseurs, équipe, bons cadeaux, packs, cartes, site, tickets, clôtures, journal ; jamais les codes PIN) : Paramètres → « Conformité caisse » → « Exporter données ».
Statistiques : tuile « Statistiques » (périodes au choix).$kb$, true, now()),

('relance_inactives', 'Relancer les clients inactifs (sans harcèlement)', 21, $kb$Campagne manuelle : tuile « Marketing » → « Clients inactifs ». Choisir le délai sans visite (3, 4, 6, 9 ou 12 mois ; 4 par défaut), décocher les personnes à ne pas relancer, choisir SMS et/ou email, modifier le message ({prenom}, {nom}, {salon}). Règles automatiques : seulement les clients qui ont accepté SMS ou emails ; jamais si un RDV est prévu ; 6 mois minimum entre deux relances d'un même client ; 2 relances maximum sans retour (il redevient relançable après sa prochaine visite). La fenêtre indique combien de clients sont exclus et pourquoi. Les SMS consomment des crédits, les emails sont gratuits.
Relance AUTOMATIQUE : Marketing → onglet « 💳 Automatisations » → « 💌 Relance clients inactifs » (avec « Délai d'inactivité »). Depuis le 15/10/2026 le SMS part du SERVEUR chaque matin (vers 10 h 30), même application fermée, avec les mêmes règles (consentement SMS, jamais si un RDV est prévu, 6 mois minimum après une autre relance). Cette case est indépendante de « Rappels SMS actifs ».$kb$, true, now()),

('annuaire_public', 'Annuaire public « Coiffeur à … », « Institut de beauté à … » (comme Planity)', 110, $kb$Luxyra publie des pages par métier et par ville : luxyra.fr/coiffeur/<ville>, luxyra.fr/institut-de-beaute/<ville>, luxyra.fr/spa-massage/<ville> (liste des villes sur luxyra.fr/coiffeur, etc.). Les établissements Luxyra y sont en tête avec un bouton « Réserver » et leur note. Les autres établissements en activité de la ville viennent de la base publique Sirene (enseigne et adresse seulement, aucune note, aucun téléphone, aucun nom de personne) avec la mention « Réservation en ligne non disponible ». Mise à jour automatique chaque mois. Départements couverts au départ : 57, 67, 54, 63, 03, 15, 43 (d'autres peuvent être ajoutés). Un établissement à la même adresse qu'un établissement Luxyra (ancien établissement) n'est pas affiché.
« Établissement fermé ? Le signaler » (fiche non cliente) : la fiche N'EST PLUS retirée immédiatement. Elle est masquée après vérification par l'équipe Luxyra, ou automatiquement après 3 signalements venant de connexions différentes (en 90 jours) ; jamais pour un établissement qui utilise Luxyra.
Retrait par le gérant : luxyra.fr/annuaire-retrait (avec le SIRET) ; la demande est confirmée par un lien envoyé par email (valable 48 h) puis traitée par l'équipe Luxyra. Pour un établissement Luxyra, l'email part à l'adresse du compte du gérant (jamais à une adresse tapée dans le formulaire). Le lien « C'est votre établissement ? » mène à une page qui propose l'essai gratuit (inscription pré-remplie) ; le retrait reste possible en bas de cette page.$kb$, true, now()),

('push', 'Notifications push', 16, $kb$Paramètres → « Notifications push » : « Activer », « Tester l'envoi », « Désactiver », « Tester l'affichage (sans envoi) ». À activer sur chaque appareil. Sur iPhone, installer d'abord l'application sur l'écran d'accueil. Si l'appli Luxyra (clients) est installée sur le même téléphone Android, l'autorisation peut s'afficher dans celle-ci : accepter puis revenir dans Luxyra Pro.
« Se déconnecter » coupe les notifications de l'établissement sur CET appareil : les réactiver après reconnexion.
La cloche 🔔 de l'application et ce qui « attend une réponse » : voir l'entrée notifications_pro_1015.$kb$, true, now()),

('guides_aide', 'Guides illustrés du centre d''aide', 100, $kb$Le centre d'aide luxyra.fr/aide propose 22 guides illustrés avec de vraies captures annotées (accessible aussi depuis Paramètres > Centre d'aide) et une rubrique « Nouveautés d'octobre 2026 ». Quand c'est utile, donne le lien du guide adapté (avec la section #sN si elle existe) : premiers pas luxyra.fr/aide/premiers-pas (#s5 session expirée, #s6 mise à jour et déconnexion) ; configurer l'établissement /aide/configurer-mon-etablissement (#s5 fermeture exceptionnelle avec RDV) ; équipe, PIN et permissions /aide/equipe-comptes-permissions (#s3 code PIN hors ligne, blocage) ; prestations et forfaits /aide/prestations-et-forfaits ; planning /aide/planning (#s4 annuler ou supprimer, #s5 alertes, #s6 glisser-déposer) ; fiche rendez-vous /aide/fiche-rendez-vous ; demandes de RDV en ligne et notifications /aide/rendez-vous-en-ligne (#s5 demandes en attente dans la cloche, #s6 accepter une modification, #s7 proposer un autre horaire) ; encaisser /aide/encaisser (#s6 bons cadeaux et séances débités au paiement) ; clôture du jour et espèces /aide/cloture-du-jour (#s3 clôture bloquée, #s4 coupure Internet) ; tickets et annulations /aide/tickets-et-annulations (#s3 ce que l'annulation remet en place) ; comptabilité et exports /aide/comptabilite-et-exports ; conformité caisse (attestation, FEC, archives) /aide/conformite-caisse ; site et réservation en ligne /aide/site-et-reservation-en-ligne (#s4 acompte, remboursement partiel, délais) ; paiements en ligne Stripe /aide/paiements-en-ligne ; SMS, rappels et campagnes /aide/sms-et-rappels (#s3 qui envoie quoi, #s4 anniversaires et relances, #s5 campagnes) ; fichier clients /aide/fichier-clients (#s4 effacement RGPD) ; espace client de vos clients /aide/espace-client ; fidélité et bons cadeaux /aide/fidelite-et-bons-cadeaux (#s3 montant fixe) ; produits et stock /aide/produits-et-stock ; statistiques /aide/statistiques ; prestations à domicile /aide/prestations-a-domicile ; installer l'application et notifications /aide/installer-et-notifications. Chemins exacts : la caisse se trouve via la tuile Caisse (Gestion des tickets, Gestion de la caisse, Bons cadeaux, Journal / Bande Z) ; l'export FEC est dans Paramètres > Conformité caisse ; la fidélité dans Paramètres > Options commerciales ; le mot de passe se réinitialise depuis la page de connexion (« Mot de passe oublié ? »).$kb$, true, now()),

('inexistant', 'Ce qui N''EXISTE PAS (ne jamais le proposer)', 24, $kb$Rubrique « Sécurité » ; rubrique « NF525 » dans les Paramètres (elle s'appelle « Conformité caisse ») ; délai de verrouillage ailleurs que dans Paramètres → Équipe ; import CSV de clients ; menu « ⋮ » dans l'encaissement ; suppression définitive d'un ticket ; suppression d'un rendez-vous encaissé ; désactivation du PIN ; bouton pour remettre le bot en marche dans une conversation où l'équipe Luxyra a répondu ; message affiché lors d'une mise à jour de l'application (elle se recharge seule) ; annulation d'un contre-ticket.$kb$, true, now()),

-- ---------------------------------------------------------------- 2) Nouvelles lignes
('notifications_pro_1015', 'Cloche 🔔 : demandes en attente, accepter / refuser, proposer un autre horaire', 901, $kb$- Dans la cloche 🔔 de l'application pro, tout ce qui attend une RÉPONSE reste non lu avec l'étiquette « ⏳ En attente de votre réponse » jusqu'à ce que ce soit traité : nouveau RDV en ligne à valider, demande de modification du client, demande sur mesure à proposer, proposition sur mesure à refaire (créneau pris). « Tout marquer lu », « Voir le RDV » et « 🗑 Effacer les lues » ne les retirent pas ; « Marquer lu » n'apparaît pas sur elles. L'état est relu en base à chaque ouverture (si un collègue a répondu sur un autre appareil, l'étiquette disparaît). Une demande dont la date est passée n'est plus « en attente ».
- Demande de modification (« ✏️ Demande de modification ») : boutons « ✓ Accepter » (le RDV passe à la nouvelle date/heure, client prévenu : « Modification acceptée — le client est informé »), « ✗ Refuser » (le RDV initial est gardé tel quel, client prévenu) et « 📅 Voir ce jour » (ouvre le planning du jour demandé ; « La demande reste dans les notifications 🔔 : revenez-y pour accepter ou refuser »).
- « ✓ Accepter » relit d'abord la demande en base (« Cette demande a déjà été traitée » si un autre appareil a répondu ; « Ce rendez-vous est annulé ou terminé ») puis vérifie le créneau : jour fermé, congé, hors horaires, collaborateur occupé… Si problème : fenêtre « ⚠️ Créneau demandé indisponible » avec la raison, « Retour » ou « Accepter quand même ».
- RDV en ligne en attente de validation : ouvrir le RDV → « 🕒 Autre horaire » → fenêtre « 🕒 Proposer un autre horaire » avec « Date », « Heure », « Message au client (facultatif) » → « Envoyer ». Le créneau est contrôlé avant l'envoi (« ⚠️ Créneau proposé indisponible » → « Envoyer quand même » ou revenir).
- Proposition sur mesure dont le créneau a été pris avant le paiement du client : la demande affiche « ⚠️ Le client a voulu accepter, mais ce créneau a été pris entre-temps. Aucun paiement n'a été fait. » → « 🕒 Proposer un autre horaire » → confirmer « Préparer une nouvelle proposition ? » (l'ancienne ne pourra plus être payée) → envoyer la nouvelle proposition. « Annuler la proposition » la retire.
Guide : luxyra.fr/aide/rendez-vous-en-ligne#s5$kb$, true, now()),

('session_donnees_1015', 'Session expirée, coupure Internet, mise à jour, déconnexion', 902, $kb$- Fenêtre « Session expirée » : « Reconnectez-vous pour continuer. Rien n'est perdu : l'écran en cours et les enregistrements en attente sont conservés sur cet appareil… ». Saisir le mot de passe (e-mail pré-rempli) → « Se reconnecter » → « ✓ Reconnecté — reprise des enregistrements en attente ». La page n'est pas rechargée. Un AUTRE compte que celui ouvert est refusé (« Ce n'est pas le compte ouvert sur cet appareil. Déconnexion… »). « Se déconnecter complètement » quitte le compte (les enregistrements non transmis restent sur l'appareil). Mot de passe oublié : se déconnecter complètement puis « Mot de passe oublié ? ».
- Coupure Internet : tickets, rendez-vous et fiches saisis restent sur l'appareil dans une file d'attente et sont renvoyés automatiquement (retour de la connexion, retour sur l'application, toutes les 2 min). Messages : « Non enregistré — nouvelle tentative automatique » (normal), puis « ✓ N enregistrement(s) en attente transmis au serveur ». Après plusieurs échecs, message demandant de vérifier la connexion. Un ticket n'est jamais abandonné pour une simple coupure. Ne pas vider les données du navigateur ni désinstaller l'application tant que des tickets attendent.
- Clôture Z refusée tant que des tickets de l'appareil ne sont pas transmis (« Clôture impossible pour le moment » → « Réessayer la transmission ») : voir integration_1014.
- Mise à jour : quand une nouvelle version est publiée, l'application se recharge seule une fois (sans message), seulement avec Internet. Rien n'est perdu.
- « Se déconnecter » ne déconnecte QUE cet appareil (les autres appareils de l'établissement restent connectés) et coupe les notifications push de l'établissement sur cet appareil.
- Code PIN : vérifié par le serveur, utilisable hors ligne sous conditions : voir securite_1014.
Guide : luxyra.fr/aide/premiers-pas#s5 et luxyra.fr/aide/cloture-du-jour#s4$kb$, true, now()),

('caisse_effets_1015', 'Caisse : bons, séances et acomptes au paiement ; annulation qui remet tout en place', 903, $kb$- Bon cadeau : réservé sur le panier, DÉBITÉ à la validation du ticket (voir bons). Séance de forfait : décomptée au paiement, mise en attente hors ligne (voir fidelite).
- Acompte payé en ligne : ticket scellé « Acompte en ligne » créé automatiquement le jour du paiement (mode « En ligne (Stripe) ») ; à l'encaissement du RDV, ligne « Acompte déjà versé (ticket #X) ». Si l'acompte dépasse le total : fenêtre « Acompte supérieur au total » → « Rembourser X € au client » puis valider de nouveau l'encaissement. Si le ticket d'acompte n'est pas encore en caisse (appareil hors ligne) : fenêtre « Acompte en ligne non enregistré en caisse », se reconnecter et réessayer.
- Annulation d'un ticket : défait fidélité, bons, séances, ventes de forfaits/bons/cartes et stock (voir annulation).
- Article libre (« ✍️ Libre ») et prestation « sur devis » (prix demandé à l'ajout, « 📝 Prix sur devis ») : voir encaissement.
- Duplicata non enregistré = impression bloquée.
- Acompte payé sur une demande REFUSÉE par l'établissement : remboursé en totalité automatiquement (dans la nuit), avec le ticket négatif « Remboursement acompte en ligne ».
Problème de montant, ticket en double ou bon débité sans ticket : <ESCALATE/>$kb$, true, now()),

('campagnes_sms_1015', 'Campagnes SMS, anniversaires et relances automatiques (serveur)', 904, $kb$- Campagne SMS (tuile Marketing) : les SMS sont mis en FILE et partent progressivement dans les minutes qui suivent. Résultat « Campagne lancée » : « 📱 N SMS programmé(s) — envoi progressif dans les minutes qui suivent ». Lancée entre 21 h et 8 h : « … — envoi à partir de 8h (pas de SMS la nuit) ». Déjà contactés ou sans consentement : « N déjà envoyé(s) ou sans consentement (ignoré(s)) ».
- Crédits insuffisants : fenêtre avec « 📱 Acheter plus de crédits avant », « Envoyer quand même (N SMS + tous les emails) » et « Annuler ». « Envoyer quand même » envoie les SMS possibles et tous les e-mails ; les autres SMS attendent la prochaine recharge (3 jours au plus). Ce bouton n'envoyait rien avant le 14/10 : c'est corrigé.
- Double appui : le bouton passe à « ⏳ Envoi en cours… » (« Campagne déjà en cours d'envoi… »), rien n'est envoyé deux fois.
- Automatisations (Marketing → onglet « 💳 Automatisations ») : « 🎂 Anniversaire client » (le jour de l'anniversaire si la date de naissance est renseignée, au plus une fois par an) et « 💌 Relance clients inactifs ». Depuis le 15/10/2026, ces SMS partent du SERVEUR chaque matin vers 10 h 30, même application fermée, seulement aux clients qui ont accepté les SMS. Ces deux cases sont INDÉPENDANTES de « Rappels SMS actifs ». En mode « Depuis mon téléphone (Android) », c'est le téléphone qui les envoie.
Guide : luxyra.fr/aide/sms-et-rappels#s4$kb$, true, now()),

('espace_client_1015', 'Espace client de vos clients : e-mail à confirmer, statuts, sécurité, suppression', 905, $kb$Pour répondre à un pro dont le client a une question sur son compte Luxyra (luxyra.fr/compte ou appli Luxyra) :
- Création de compte : « Adresse * », « Pays * » (France, Allemagne, Luxembourg, Belgique, Suisse, Autre pays), « Code postal * », « Ville * » (en France, choisie dans la liste des communes du code postal ; ailleurs, saisie libre). Mot de passe : 8 caractères minimum. Compte ancien sans adresse : bandeau « 🏠 Complétez votre adresse ».
- E-mail à confirmer (comptes créés à partir du 15/10/2026) : e-mail « Confirmez votre adresse email Luxyra », lien valable 48 h. Tant qu'il n'est pas confirmé, les RDV, tickets, points et cartes enregistrés par l'établissement avec cette adresse N'APPARAISSENT PAS dans le compte. Bandeau « ✉️ Confirmez votre adresse email » → « Renvoyer l'email ». Les comptes créés avant le 15/10/2026 ne sont pas concernés. « Mot de passe oublié » réussi = adresse confirmée aussi. « Lien invalide ou expiré » : renvoyer un e-mail.
- Statuts des RDV : « En attente », « Confirmé », « Terminé » (encaissé, ou confirmé et passé), « Non confirmé » (demande jamais confirmée, date passée), « Non retenu » (refus de l'établissement), « Annulé », « Paiement en attente » (acompte pas encore payé ; créneau libéré s'il abandonne).
- Onglet Tickets : seulement les vrais tickets de caisse et les reçus d'acompte réellement émis (plus de ticket fabriqué pour un RDV en ligne non encaissé) ; une visite n'apparaît qu'une fois. Onglet « 🎁 Bons cadeaux » : les bons achetés en ligne. Onglet « 🔔 Notifications » : « 🔔 Activer les notifications » pour être prévenu sur le téléphone.
- Avis signalé ou en contrôle : « ⏳ Avis en cours de vérification », non modifiable pendant ce temps.
- Profil → « 📱 Appareils connectés » → « Déconnecter mes autres appareils » (celui-ci reste connecté). Changer de mot de passe déconnecte aussi les autres appareils.
- Supprimer son compte : « ⚙️ Réglages » → « ⚠️ Zone dangereuse » → « Supprimer mon compte » → taper SUPPRIMER + MOT DE PASSE obligatoire → « 🗑 Supprimer ». Les RDV à venir sont annulés (« Annulé suite à suppression du compte »), acompte remboursé selon la politique d'annulation de l'établissement ; l'établissement le voit dans son planning ; les tickets de caisse sont conservés.
- Réservation commencée avant connexion : reprise automatiquement après la connexion. Double appui sur « Confirmer » / « Payer » : une seule réservation.
- iPhone : bandeau affiché une seule fois (« Partager » puis « Sur l'écran d'accueil »).
Compte bloqué, e-mail de confirmation jamais reçu après plusieurs essais : <ESCALATE/>
Guide : luxyra.fr/aide/espace-client$kb$, true, now())

ON CONFLICT (cle) DO UPDATE SET
  titre   = EXCLUDED.titre,
  ordre   = EXCLUDED.ordre,
  contenu = EXCLUDED.contenu,
  actif   = EXCLUDED.actif,
  maj_le  = now();

-- ---------------------------------------------------------------- 3) Corrections ciblées dans les autres lignes
-- La rubrique s'appelle « Conformité caisse » (plus « NF525 ») dans Paramètres.
UPDATE public.support_bot_kb
   SET contenu = replace(contenu, 'Paramètres → « NF525 »', 'Paramètres → « Conformité caisse »'), maj_le = now()
 WHERE position('Paramètres → « NF525 »' IN contenu) > 0;

-- SMS : le rappel 2 h et l'e-mail partent aussi du serveur.
UPDATE public.support_bot_kb
   SET contenu = replace(contenu, 'Le rappel de la veille part aussi quand l''application est fermée.',
                 'Tous les rappels (SMS de la veille, SMS 2 h avant, e-mail) partent du serveur, même application fermée (voir rappels_automatiques).'),
       maj_le = now()
 WHERE cle = 'sms' AND position('Le rappel de la veille part aussi quand l''application est fermée.' IN contenu) > 0;

-- Suppression du compte client : mot de passe et RDV annulés.
UPDATE public.support_bot_kb
   SET contenu = replace(contenu, 'Le client peut aussi supprimer son compte lui-même à tout moment (Mon compte > Supprimer mon compte).',
                 'Le client peut aussi supprimer son compte lui-même à tout moment (Mon compte > Réglages > Supprimer mon compte, mot de passe demandé ; ses RDV à venir sont alors annulés).'),
       maj_le = now()
 WHERE cle = 'conservation_donnees';

-- ---------------------------------------------------------------- 4) Contrôles (lecture seule)
SELECT cle, ordre, length(contenu) AS taille, maj_le FROM public.support_bot_kb
 WHERE cle IN ('parametres','planning','cloture','annulation','bons','fidelite','clients','rappels_automatiques','click_collect',
               'compta','relance_inactives','annuaire_public','push','guides_aide','inexistant','notifications_pro_1015',
               'session_donnees_1015','caisse_effets_1015','campagnes_sms_1015','espace_client_1015','sms','conservation_donnees')
 ORDER BY ordre, cle;
-- Doit renvoyer 0 ligne :
SELECT cle FROM public.support_bot_kb
 WHERE contenu LIKE '%« NF525 » →%' OR contenu LIKE '%caisse certifiée%'
    OR contenu LIKE '%par l''application ouverte%' OR contenu LIKE '%retirée tout de suite%';

COMMIT;
