# -*- coding: utf-8 -*-
# Contenu des guides illustrés du centre d'aide (luxyra.fr/aide/<slug>).
# Les captures viennent du mode démo (données fictives) : aide/img/<id>.webp
# Les numéros des légendes correspondent aux pastilles dorées dessinées sur les captures.

GUIDES = [
dict(slug="premiers-pas", ic="🚀", cat="Démarrer", titre="Premiers pas : l'accueil et la navigation",
 resume="Ce que vous voyez en ouvrant Luxyra, et comment aller partout en deux clics.",
 sections=[
  dict(h="L'écran d'accueil", p="""<p>L'accueil est votre tableau de bord de la journée. Il se met à jour à chaque encaissement et à chaque rendez-vous pris.</p>""",
   img="accueil", alt="Écran d'accueil de Luxyra sur ordinateur", leg=[
    "<strong>CA du jour</strong> : ce qui est déjà encaissé, ce qui reste à venir, la part prestations / produits et le détail par collaborateur. Touchez le bandeau doré pour le replier.",
    "<strong>Prévisionnel du mois</strong> : réalisé + rendez-vous à venir. Visible uniquement par les personnes autorisées (permission « Voir le prévisionnel »).",
    "<strong>Planning</strong> : votre agenda, par jour ou sur plusieurs jours.",
    "<strong>Encaissement</strong> : ouvrir un ticket de caisse, avec ou sans rendez-vous.",
    "<strong>Paramètres</strong> (roue dentée) : tous les réglages de l'établissement.",
    "<strong>Notifications</strong> (cloche) : nouveaux rendez-vous en ligne, annulations, commandes. Un chiffre rouge indique les non lues.",
    "<strong>Clôture de la journée</strong> : à faire le soir, après le dernier encaissement (voir le guide « Clôture du jour »)."]),
  dict(h="Sur téléphone", p="""<p>Sur téléphone, les mêmes informations s'empilent : le CA du jour en haut, les tuiles en dessous. Faites défiler pour retrouver toutes les tuiles. Pour une utilisation confortable, installez l'application sur l'écran d'accueil (guide « Installer l'application et les notifications »).</p>""",
   img="accueil_mobile", alt="Accueil de Luxyra sur téléphone", leg=[]),
  dict(h="Les tuiles de l'accueil", p="""<ul>
<li><strong>Clients</strong> : le fichier clients, les fiches, l'historique.</li>
<li><strong>Services et Forfaits</strong> : votre catalogue de prestations.</li>
<li><strong>Produits</strong> : la vente et le stock.</li>
<li><strong>Bons cadeaux</strong> : les bons vendus, utilisés, expirés.</li>
<li><strong>Attente</strong> : les tickets mis de côté pour être terminés plus tard.</li>
<li><strong>Caisse</strong> : un menu avec la gestion des tickets, la gestion des espèces, les bons cadeaux et le journal / bande Z.</li>
<li><strong>Statistiques</strong>, <strong>Avis clients</strong>, <strong>Commandes</strong> (Click &amp; Collect) et <strong>Marketing</strong> (campagnes SMS et email).</li>
</ul>
<p>Une tuile n'apparaît que si la personne connectée a la permission correspondante (voir « Équipe, comptes et permissions »).</p>""",
   img="caisse_menu", alt="Menu de la tuile Caisse", leg=[]),
  dict(h="Les paramètres", p="""<p>La roue dentée ouvre la liste des réglages. Chaque ligne ouvre une page dédiée ; le bouton « Retour Paramètres » en haut ramène à la liste.</p>""",
   img="parametres", alt="Liste des paramètres", leg=[
    "<strong>Votre forfait</strong> : gérer l'abonnement (moyen de paiement, factures) ou changer de forfait.",
    "<strong>Établissement</strong> : métier et mode d'activité (en établissement, à domicile ou mixte).",
    "<strong>Équipe</strong> : collaborateurs, horaires, comptes de connexion et permissions.",
    "<strong>Site en ligne</strong> : votre page publique, la réservation en ligne, la boutique, les bons cadeaux.",
    "<strong>Caisse et paiements</strong> : modes de paiement, fond de caisse, TVA, exercice comptable.",
    "<strong>Conformité caisse</strong> : attestation, archives, bande de contrôle et export FEC."]),
 ]),

dict(slug="configurer-mon-etablissement", ic="🏢", cat="Démarrer", titre="Configurer son établissement",
 resume="Mode d'activité, coordonnées, logo, horaires et apparence : les réglages à faire le premier jour.",
 sections=[
  dict(h="1. Métier et mode d'activité", p="""<p><strong>Paramètres › Établissement</strong>. Le métier est choisi à l'inscription : il adapte les textes, les catégories et les exemples de l'application. Pour le changer, écrivez au support.</p>""",
   img="etablissement", alt="Réglage du métier et du mode d'activité", leg=[
    "<strong>Métier</strong> : verrouillé après l'inscription.",
    "<strong>En établissement</strong> : les clientes viennent chez vous.",
    "<strong>À domicile</strong> : vous vous déplacez ; votre adresse personnelle n'est pas affichée sur votre page publique (seule la ville l'est).",
    "<strong>Mixte</strong> : les deux ; la cliente choisit au moment de réserver."]),
  dict(h="2. Coordonnées et logo", p="""<p><strong>Paramètres › Infos établissement</strong>. Ces informations apparaissent sur vos tickets, vos factures et votre page publique. Pensez à cliquer sur <strong>« Enregistrer les infos salon »</strong> en bas de la page.</p>
<p>Le nom de l'établissement et le SIRET sont verrouillés une fois enregistrés : ils figurent sur les tickets sécurisés. Pour une correction, passez par le support. Tout en bas, une <strong>note libre</strong> peut être imprimée sur chaque ticket (par exemple vos conditions d'échange des produits).</p>""",
   img="infos_etab", alt="Infos établissement", leg=[
    "<strong>Logo</strong> : chargez une image depuis l'appareil.",
    "<strong>Sous-titre</strong> : la phrase affichée sous votre nom (ex. « Coiffure &amp; couleur sur-mesure »).",
    "<strong>Adresse</strong> : tapez le code postal, la ville se choisit dans la liste.",
    "<strong>Réseaux sociaux</strong> : liens affichés sur votre page publique."]),
  dict(h="3. Horaires d'ouverture", p="""<p><strong>Paramètres › Horaires</strong>. Ces horaires définissent les créneaux réservables en ligne et l'affichage du planning. Les horaires de chaque collaborateur se règlent ensuite dans <strong>Équipe</strong>.</p>""",
   img="horaires", alt="Horaires d'ouverture", leg=[
    "<strong>Une ligne par jour</strong> : heure d'ouverture et de fermeture ; le bouton « Fermé » rend le jour non réservable.",
    "<strong>Fermeture exceptionnelle</strong> : jour férié, vacances, travaux. Personne ne peut réserver ces jours-là.",
    "<strong>Ouverture exceptionnelle</strong> : un dimanche ou un soir d'événement, par exemple."]),
  dict(h="4. Apparence de l'application", p="""<p><strong>Paramètres › Apparence</strong> : choisissez la couleur principale et un fond d'écran (photo de votre établissement, par exemple). Cela ne change que l'application ; le look de votre page publique se règle dans <strong>Site en ligne › Personnalisation visuelle</strong>.</p>""",
   img="apparence", alt="Apparence de l'application", leg=[]),
 ]),

dict(slug="equipe-comptes-permissions", ic="👥", cat="Démarrer", titre="Équipe, comptes et permissions",
 resume="Ajouter un collaborateur, régler ses horaires, ses absences, son code PIN et ce qu'il a le droit de voir.",
 sections=[
  dict(h="La page Équipe", p="""<p><strong>Paramètres › Équipe</strong>. Chaque collaborateur a une fiche dépliable. Chaque encaissement est attribué à la personne connectée : c'est ce qui permet le CA par collaborateur et la traçabilité exigée par la loi anti-fraude.</p>""",
   img="equipe", alt="Page Équipe", leg=[
    "<strong>Verrouillage automatique</strong> : après ce délai sans activité, l'application redemande le code PIN. Réservé à l'administrateur.",
    "<strong>Compte gestionnaire</strong> : pour un gérant ou un comptable qui utilise l'application sans apparaître dans le planning.",
    "<strong>Horaires</strong> : « Fixes » (identiques chaque semaine) ou « Personnalisés » (semaine par semaine), avec la pause quotidienne.",
    "<strong>Congé / Absence / Pause</strong> : bloque le planning et la réservation en ligne sur la période.",
    "<strong>Inactif</strong> : masque le collaborateur du planning et de la réservation (arrêt, départ) sans perdre ses statistiques.",
    "<strong>Compétences</strong> : limite les prestations qu'il peut réaliser (planning et réservation en ligne).",
    "<strong>Compte de connexion</strong> : code PIN personnel, rôle et permissions. Le visage ou l'empreinte peuvent remplacer le PIN sur un appareil personnel.",
    "<strong>Ajouter collaborateur</strong> : nouvelle fiche ; créez ensuite son compte de connexion."]),
  dict(h="Les permissions", p="""<p>Dans la fiche d'un collaborateur, <strong>⚙️ Permissions</strong> ouvre la liste de ce qu'il peut faire. Un administrateur a tout. Pour un collaborateur, décochez ce qui ne le concerne pas : voir le CA du jour, voir le prévisionnel, annuler un rendez-vous, encaisser, accéder à la comptabilité, exporter des données…</p>
<p>Conseil : sur une tablette partagée, laissez un verrouillage automatique court et n'activez pas Face ID / empreinte.</p>""",
   img="permissions", alt="Permissions d'un collaborateur", leg=[]),
 ]),

dict(slug="prestations-et-forfaits", ic="✂️", cat="Démarrer", titre="Prestations et forfaits",
 resume="Créer votre catalogue : familles, prix, durées, visibilité en ligne et forfaits en plusieurs étapes.",
 sections=[
  dict(h="Le catalogue", p="""<p>Tuile <strong>Services et Forfaits</strong>. Les prestations sont rangées par <strong>famille</strong> (Coupe, Couleur, Soin…). Choisissez une famille pour voir ses prestations ; les flèches ◀ ▶ réordonnent les familles, les flèches ▲ ▼ réordonnent les prestations.</p>
<p>Chaque prestation affiche son prix, sa durée et des pastilles : <strong>Site</strong> (visible sur votre page), <strong>Réservation</strong> (réservable en ligne) et le genre utilisé pour les statistiques.</p>""",
   img="services", alt="Catalogue des prestations", leg=[]),
  dict(h="Créer une prestation", p="""<p><strong>+ Nouvelle prestation</strong> : nom, prix, durée, famille. Décochez <strong>Réservable en ligne</strong> pour une prestation que vous voulez garder au salon uniquement (ex. un diagnostic). Pour une prestation en plusieurs étapes (couleur + temps de pose + brushing), utilisez l'onglet <strong>Forfaits</strong> : chaque étape a sa durée et peut libérer le collaborateur pendant la pose.</p>
<p><strong>⇅ En masse</strong> permet de modifier plusieurs prix d'un coup (augmentation annuelle, par exemple).</p>""",
   img="services_new", alt="Création d'une prestation", leg=[]),
 ]),

dict(slug="planning", ic="📅", cat="Rendez-vous", titre="Le planning au quotidien",
 resume="Naviguer dans l'agenda, prendre un rendez-vous, poser une absence.",
 sections=[
  dict(h="Se repérer dans le planning", p="""<p>Une colonne par collaborateur, une couleur par famille de prestation. Un rendez-vous encaissé porte la mention « Encaissé ». Glissez-déposez un rendez-vous pour le déplacer.</p><p><strong>Rendez-vous exceptionnel hors horaires</strong> (ex. 8h30 alors que vous ouvrez à 9h) : « + Nouveau RDV », saisissez l'heure, puis « Créer quand même ». Vos horaires et la réservation en ligne ne changent pas ; le planning s'élargit automatiquement pour afficher ce rendez-vous.</p>""",
   img="planning", alt="Planning du jour", leg=[
    "<strong>Aujourd'hui</strong> et les flèches ◀ ▶ : revenir au jour même, passer au jour précédent ou suivant.",
    "<strong>Calendrier</strong> : aller directement à une date.",
    "<strong>1j à 7j</strong> : nombre de jours affichés côte à côte.",
    "<strong>+ Nouveau RDV</strong> : prendre un rendez-vous (vous pouvez aussi toucher un créneau vide).",
    "<strong>Absence / Congé / Pause</strong> : bloquer un créneau ou des jours pour un collaborateur.",
    "<strong>Imprimer</strong> : le planning du jour sur papier ; le zoom (− / +) change la hauteur des créneaux."]),
  dict(h="Prendre un rendez-vous", p="""<p>Choisissez la date et l'heure, la cliente (ou créez-la avec le bouton <strong>+</strong>), la prestation et le collaborateur, puis <strong>Valider</strong>. Si la cliente a un email ou un téléphone, elle reçoit la confirmation et les rappels réglés dans <strong>SMS et Marketing</strong>.</p>""",
   img="planning_new", alt="Nouveau rendez-vous", leg=[
    "<strong>Date et heure</strong> du rendez-vous.",
    "<strong>Rechercher une cliente</strong> par nom ou téléphone ; le bouton + crée une nouvelle fiche.",
    "<strong>Type</strong> (femme, homme, enfant) : filtre les prestations proposées.",
    "<strong>Collaborateur</strong> qui réalise la prestation.",
    "<strong>Ajouter un 2nd client</strong> : rendez-vous groupé (couple, mère et fille…).",
    "<strong>Valider</strong> ; « +1 » valide et ouvre aussitôt un nouveau rendez-vous."]),
  dict(h="Poser une absence", p="""<p>Choisissez le collaborateur, le type (congé en jours, absence en jours ou en heures, pause), les dates et un motif facultatif. Le créneau disparaît de la réservation en ligne. Pour fermer tout l'établissement, utilisez plutôt <strong>Paramètres › Horaires › Fermeture exceptionnelle</strong>.</p>""",
   img="planning_absence", alt="Poser une absence", leg=[]),
 ]),

dict(slug="fiche-rendez-vous", ic="🗂️", cat="Rendez-vous", titre="La fiche rendez-vous",
 resume="Modifier, compléter, encaisser un acompte, encaisser ou annuler un rendez-vous.",
 sections=[
  dict(h="Ouvrir un rendez-vous", p="""<p>Touchez un rendez-vous dans le planning. En haut, les informations de la cliente ; en dessous, le détail du rendez-vous.</p>""",
   img="planning_fiche", alt="Fiche d'un rendez-vous", leg=[
    "<strong>Historique</strong> : ses précédents passages et achats.",
    "<strong>Fiches techniques</strong> : formules couleur, notes de soin, photos avant / après.",
    "<strong>Le rendez-vous</strong> : le crayon change la date ou l'heure, la corbeille le supprime ; changez le collaborateur ou la durée directement sur la ligne. Le bouton <strong>« 🔄 Changer la prestation »</strong> remplace d'un coup tout le contenu (prestation ou forfait) sans recréer le rendez-vous ; pour un rendez-vous pris en ligne, la cliente voit le changement (prestation, prix, durée) dans son espace et reçoit un email.",
    "<strong>+ Ajouter une prestation</strong> : à la suite, ou pendant une autre (un soin pendant un temps de pose).",
    "<strong>Encaisser un acompte</strong> : la cliente paie une partie à l'avance ; il sera déduit automatiquement au moment d'encaisser.",
    "<strong>Encaisser</strong> : ouvre la caisse avec les prestations du rendez-vous déjà dans le ticket.",
    "<strong>Reprendre RDV</strong> : réserver tout de suite le prochain rendez-vous, même cliente et même collaborateur.",
    "<strong>Annuler RDV</strong> : avec un motif. Si un acompte en ligne avait été payé, il est remboursé quand c'est vous qui annulez."]),
 ]),

dict(slug="rendez-vous-en-ligne", ic="📩", cat="Rendez-vous", titre="Demandes de RDV en ligne et notifications",
 resume="Valider une demande, proposer un autre horaire, et ne rater aucune réservation.",
 sections=[
  dict(h="Confirmation automatique ou manuelle", p="""<p>Dans <strong>Paramètres › Site en ligne › Réservation</strong>, l'option <strong>Confirmation automatique</strong> décide si un rendez-vous pris en ligne entre directement dans le planning, ou s'il attend votre validation. Les rendez-vous <strong>à domicile</strong> attendent toujours votre validation : vous seul savez si le déplacement est possible.</p>"""),
  dict(h="La carte « Demandes de rendez-vous » de l'accueil", p="""<p>Quand une demande attend, une carte orange s'affiche en haut de l'accueil. Touchez une ligne pour ouvrir la demande. Dans le planning, le rendez-vous en attente est déjà placé pour réserver le créneau.</p>""",
   img="demande_accueil", alt="Carte des demandes à valider sur l'accueil", leg=[
    "<strong>Demandes à valider</strong> : nom de la cliente, 🏠 pour un rendez-vous à domicile, date et heure.",
    "<strong>Cloche</strong> : la notification de la nouvelle réservation."]),
  dict(h="Valider, proposer un autre horaire ou refuser", p="""<p>En haut de la fiche, un bandeau résume la demande (lieu, distance, acompte prévu). La cliente est prévenue par email, ou par SMS si elle n'a pas d'email.</p>""",
   img="demande_fiche", alt="Demande de rendez-vous à valider", leg=[
    "<strong>Accepter</strong> : le rendez-vous est confirmé. Si un acompte est prévu, la cliente reçoit le lien de paiement à ce moment-là.",
    "<strong>Autre horaire</strong> : choisissez une nouvelle date ou heure et un message ; la cliente reçoit la proposition et peut annuler depuis son espace si elle ne lui convient pas.",
    "<strong>Refuser</strong> : avec un motif facultatif. Rien n'est prélevé ; un acompte déjà payé serait remboursé.",
    "<strong>RDV pris en ligne</strong> : vos modifications (heure, collaborateur, prestations) sont visibles par la cliente dans son espace."]),
  dict(h="Les notifications", p="""<p>La cloche liste les nouveaux rendez-vous en ligne, les annulations, les demandes de modification et les commandes. <strong>« Voir le RDV »</strong> ouvre directement la fiche du rendez-vous dans le planning. Une demande de modification de la cliente s'accepte ou se refuse directement depuis la notification. Quand la cliente a vu une modification faite par vous, une notification « 👁 Modification vue par la cliente » arrive, et la fiche du rendez-vous l'indique. Pour un rendez-vous <strong>annulé</strong>, « Voir le RDV » affiche sa fiche : qui l'a annulé et quand, le motif, et ce qu'il advient de l'acompte ou de l'empreinte.</p>
<p>Si un proche réserve <strong>pour une autre personne</strong> depuis son propre compte, le rendez-vous est au nom de la personne réservée, et la fiche indique « Réservé par … ».</p>""",
   img="notifs", alt="Panneau des notifications", leg=[]),
 ]),

dict(slug="encaisser", ic="💳", cat="Caisse", titre="Encaisser une cliente",
 resume="Du choix du collaborateur au ticket : prestations, produits, remises, bons cadeaux et paiement mixte.",
 sections=[
  dict(h="1. Qui et pour qui", p="""<p>Tuile <strong>Encaissement</strong> (ou bouton « Encaisser » d'un rendez-vous, qui remplit le ticket pour vous).</p>""",
   img="caisse_1", alt="Choix du collaborateur et de la cliente", leg=[
    "<strong>Collaborateur</strong> qui a réalisé la prestation.",
    "<strong>Pour qui ?</strong> : femme, homme ou enfant, puis la cliente dans la liste ou la recherche.",
    "<strong>Nouveau client</strong> : crée la fiche sans quitter la caisse. Pour une vente sans fiche, choisissez « Passage ».",
    "<strong>Continuer</strong> vers le ticket."]),
  dict(h="2. Le ticket", p="""<p>À droite, le catalogue : prestations, forfaits, cartes d'abonnement, packs et produits (recherche ou lecteur de code-barres). À gauche, le ticket en cours ; touchez une ligne pour changer la quantité ou appliquer une remise sur la ligne.</p>""",
   img="caisse_2", alt="Ticket de caisse en cours", leg=[
    "<strong>Collaborateur et cliente</strong> du ticket ; l'étoile indique sa fidélité.",
    "<strong>+ Client</strong> : encaisser plusieurs personnes sur le même ticket.",
    "<strong>Remise ticket</strong> : en % ou en € sur tout le ticket (selon vos permissions).",
    "<strong>Bon cadeau</strong> : vendre un bon cadeau.",
    "<strong>Encaissement</strong> : passer au paiement.",
    "<strong>Devis</strong> : transformer le panier en devis à remettre à la cliente.",
    "<strong>Attente</strong> : mettre le ticket de côté (tuile « Attente ») pour le terminer plus tard."]),
  dict(h="3. Le paiement", p="""<p>Choisissez le mode de paiement. <strong>Paiement mixte</strong> répartit le montant entre plusieurs moyens (une partie en espèces, le reste en carte). <strong>Bon cadeau</strong> déduit un bon vendu auparavant. Un acompte déjà versé (au salon ou en ligne) est déduit automatiquement.</p><p>Si la cliente a atteint son seuil de fidélité, Luxyra vous demande <strong>avant le premier règlement</strong> d'appliquer ou non la remise : le montant à taper sur le terminal est ainsi toujours le bon.</p><p>Si vous ajoutez une remise ou retirez une ligne <strong>après</strong> avoir saisi le règlement, le règlement est remis à zéro avec un message : refaites-le au nouveau montant. Ainsi les totaux par mode de paiement de la clôture correspondent toujours au chiffre d'affaires.</p>
<p>Une fois validé, le ticket est <strong>scellé</strong> (loi anti-fraude) : il ne peut plus être modifié. Vous pouvez l'imprimer ou l'envoyer par email.</p>""",
   img="caisse_3", alt="Choix du mode de paiement", leg=[]),
 ]),

dict(slug="cloture-du-jour", ic="🔒", cat="Caisse", titre="Clôture du jour (Z) et gestion des espèces",
 resume="Clôturer la journée, compter le tiroir, mettre au coffre, enregistrer une entrée ou une sortie d'espèces.",
 sections=[
  dict(h="Clôturer la journée", p="""<p>Bouton <strong>Clôture de la journée</strong> en bas du CA du jour, le soir après le dernier encaissement. La clôture fige le total du jour (rapport Z) : c'est une obligation de la loi anti-fraude pour les entreprises qui facturent la TVA.</p>
<ul><li>Si des rendez-vous du jour ne sont pas encaissés, la fenêtre vous prévient : une fois clôturé, ils ne pourront plus être encaissés à cette date.</li>
<li><strong>Comptez le tiroir</strong> : saisissez les espèces réellement présentes ; l'écart avec le solde théorique est enregistré.</li>
<li>En cas d'oubli, la journée est clôturée automatiquement dans la nuit, sans comptage du tiroir.</li></ul>""",
   img="cloture", alt="Fenêtre de clôture quotidienne", leg=[]),
  dict(h="Gestion des espèces", p="""<p>Tuile <strong>Caisse › Gestion de la caisse</strong>. L'onglet <strong>Espèces</strong> montre le fond de caisse, les espèces encaissées, ce qui a été mis au coffre et les mouvements. <strong>Coffre</strong> et <strong>Remise banque</strong> tracent les dépôts. Chaque <strong>Sortie</strong> (achat de fournitures payé en espèces…) ou <strong>Entrée</strong> d'espèces génère une pièce de caisse numérotée.</p>
<p>Entreprise individuelle ou micro-entreprise sans vrai tiroir ? Activez le <strong>mode caisse simplifiée</strong> dans <strong>Paramètres › Caisse et paiements</strong> : pas de fond de caisse, pas de comptage, pas de coffre. Les tickets restent sécurisés.</p>""",
   img="caisse_gestion", alt="Gestion des espèces", leg=[]),
 ]),

dict(slug="tickets-et-annulations", ic="🎫", cat="Caisse", titre="Tickets : réimprimer, envoyer, corriger, annuler",
 resume="Retrouver un ticket, l'envoyer par email, corriger le collaborateur ou le règlement, ou l'annuler proprement.",
 sections=[
  dict(h="La gestion des tickets", p="""<p>Tuile <strong>Caisse › Gestion des tickets</strong>. Filtrez par période et par mode de paiement ; le bouton <strong>Excel</strong> exporte la liste.</p>""",
   img="tickets", alt="Gestion des tickets", leg=[
    "<strong>Période</strong> (date de début et de fin, la liste se met à jour dès que vous changez une date) et mode de paiement.",
    "<strong>Imprimer</strong> une copie du ticket.",
    "<strong>Email</strong> : envoyer le ticket à la cliente.",
    "<strong>Modifier collaborateur</strong> : réattribuer la vente (tracé dans le journal).",
    "<strong>Modifier règlement</strong> : corriger le mode de paiement le jour même (carte au lieu d'espèces, par exemple). Le ticket enregistré n'est jamais modifié : une pièce de correction numérotée est créée et la clôture du soir tient compte du bon mode. Si la journée est déjà clôturée : « 🧾 Corriger le moyen de paiement (pièce tracée) » (administrateur, motif obligatoire) crée une pièce de correction numérotée et scellée, sans toucher au ticket ni à la clôture ; le montant du ticket ne peut pas changer.",
    "<strong>Avoir / Annuler</strong> : annuler un ticket encaissé."]),
  dict(h="Annuler un ticket", p="""<p>Un ticket encaissé n'est <strong>jamais supprimé</strong> : il reste dans la caisse, marqué comme annulé, et un <strong>contre-ticket</strong> du même montant en négatif est créé. Le motif est obligatoire et tout est tracé. Pour corriger une erreur, annulez puis encaissez de nouveau correctement.</p>
<p>Une journée déjà clôturée ne peut plus être modifiée : l'annulation apparaît alors à la date du jour où elle est faite.</p>""",
   img="ticket_annuler", alt="Annulation d'un ticket", leg=[]),
 ]),

dict(slug="comptabilite-et-exports", ic="📊", cat="Comptabilité", titre="Comptabilité et documents pour le comptable",
 resume="Le CA du mois, le journal de caisse, le pack Excel, la TVA et la date de clôture de l'exercice.",
 sections=[
  dict(h="La page comptabilité", p="""<p>Tuile <strong>Caisse › Journal / Bande Z</strong>. Choisissez le mois et l'année avec les flèches. Les totaux du mois correspondent toujours à la somme des clôtures journalières.</p>""",
   img="compta", alt="Page comptabilité", leg=[
    "<strong>Documents comptables</strong> : tous les exports du mois.",
    "<strong>CA du mois</strong> : TTC, HT, TVA, nombre de tickets, part prestations / produits et modes de paiement.",
    "<strong>Répartition par collaborateur</strong>.",
    "<strong>Journal de caisse</strong> : chaque jour, chaque ticket, son mode de paiement."]),
  dict(h="Les documents comptables", p="""<p>Le plus simple : <strong>« Télécharger l'Excel comptable »</strong>, un seul fichier avec tout ce dont votre comptable a besoin (synthèse, journal, TVA, écritures, annulations, paiements en ligne, bons cadeaux, caisse). Les documents séparés sont aussi disponibles : bande Z mensuelle (à imprimer et conserver), journal de caisse, récapitulatif de TVA, journal des ventes importable dans Sage / EBP / Cegid, annulations, acomptes en ligne.</p>
<p>En micro-entreprise, la page s'adapte : <strong>livre des recettes</strong> et déclaration URSSAF à la place des documents de TVA.</p>""",
   img="compta_docs", alt="Documents comptables", leg=[]),
  dict(h="Exercice comptable et réglages de caisse", p="""<p><strong>Paramètres › Caisse et paiements</strong> : modes de paiement acceptés, fond de caisse, taux de TVA, validité des devis et <strong>date de clôture de l'exercice</strong>. Si votre exercice ne se termine pas le 31 décembre (par exemple le 31 mars), indiquez-le : la caisse enregistre alors une clôture scellée à cette date, en plus des clôtures du jour, du mois et de l'année. En micro-entreprise, l'exercice suit l'année civile.</p>""",
   img="caisse_reglages", alt="Réglages de caisse", leg=[]),
  dict(h="", p="", img="exercice", alt="Exercice comptable", leg=[]),
 ]),

dict(slug="conformite-caisse", ic="🛡️", cat="Comptabilité", titre="Conformité de la caisse (loi anti-fraude)",
 resume="Attestation, archives, bande de contrôle, FEC : ce qu'il faut conserver et où le trouver.",
 sections=[
  dict(h="Qui est concerné ?", p="""<p>La loi impose une caisse sécurisée (inaltérabilité, sécurisation, conservation, archivage) aux entreprises qui <strong>facturent la TVA</strong> et encaissent des particuliers. En <strong>franchise de TVA</strong> (« TVA non applicable, art. 293 B du CGI »), elle n'est pas obligatoire ; vos tickets Luxyra restent sécurisés de la même façon.</p>"""),
  dict(h="Paramètres › Conformité caisse", p="""<ul>
<li><strong>Journal d'audit</strong> : les dernières opérations sensibles (annulations, corrections, clôtures), exportable.</li>
<li><strong>Archivage annuel</strong> : un fichier signé contenant tous les tickets, clôtures, annulations et le journal d'une année. À générer chaque année et à conserver 6 ans.</li>
<li><strong>Bande de contrôle mensuelle</strong> : tous les tickets, annulations et clôtures du mois.</li>
<li><strong>Attestation de conformité</strong> : au modèle officiel de l'administration. Le volet 1 est signé par Luxyra, vous signez le volet 2 en ligne. Téléchargez le PDF et gardez-le : il se présente en cas de contrôle.</li>
<li><strong>Comptes comptables</strong> : les numéros utilisés dans les exports, que votre cabinet peut adapter.</li>
<li><strong>Export FEC</strong> : le fichier des écritures comptables à fournir en cas de contrôle fiscal, ainsi que les exports EBP, Cegid Quadratus et le rapport « Pour le comptable ».</li></ul>""",
   img="conformite", alt="Page conformité de la caisse", leg=[]),
  dict(h="Signature électronique et journal des événements", p="""<ul>
<li>Chaque ticket, clôture (jour, mois, année, exercice), duplicata et correction est <strong>signé électroniquement</strong> (algorithme ES256) et chaîné au précédent, automatiquement, en moins de 2 minutes.</li>
<li>Le ticket imprimé indique la version du logiciel, le nombre de lignes et <strong>4 caractères de la signature</strong>. Une réimpression porte la mention <strong>DUPLICATA</strong> et son numéro de copie.</li>
<li>Le <strong>journal des événements techniques</strong> (JET) enregistre démarrages et arrêts de caisse, clôtures, annulations de ligne, abandons de vente, réimpressions, archivages et changements de version.</li></ul>"""),
  dict(h="Archive signée et vérification", p="""<p>Dans <strong>Paramètres › Conformité caisse › Archive fiscale signée</strong>, choisissez une période puis téléchargez le fichier. Il contient les tickets, clôtures, corrections, duplicatas, le JET, les signatures et la clé publique.</p>
<p>Vous (ou un contrôleur) pouvez le vérifier sur <a href="/verif-nf525">luxyra.fr/verif-nf525</a> : la vérification se fait dans le navigateur, le fichier n'est envoyé nulle part. Toute modification d'un seul chiffre est détectée. L'archive elle-même est signée par le serveur au moment de l'export. Cochez « Fichier remis à l'administration fiscale » si vous la remettez lors d'un contrôle.</p>"""),
  dict(h="Mode test puis caisse réelle", p="""<p>Pendant l'essai gratuit, votre caisse est en <strong>mode test</strong> : un bandeau violet « MODE TEST » s'affiche en haut de l'écran et chaque ticket porte « TEST – document sans valeur fiscale ». Essayez tout librement (avec vos proches, par exemple) : ces encaissements ne comptent pas dans votre chiffre d'affaires. N'encaissez pas de vraies clientes en mode test.</p>
<ul>
<li>Quand vous êtes prêt, cliquez sur <strong>Passer en caisse réelle</strong> (bandeau violet, ou Paramètres › NF525 › Identification du logiciel). Tapez REEL pour confirmer.</li>
<li>Vos encaissements de test et leurs clôtures sont copiés dans une archive scellée conservée 6 ans, puis retirés. Votre caisse démarre à zéro.</li>
<li>Clientèle, prestations, produits, équipe, réglages et rendez-vous à venir sont conservés.</li>
<li>Ce passage est <strong>définitif</strong> et inscrit au journal de la caisse. Il se fait au plus tard au moment de vous abonner.</li>
<li>En caisse réelle, aucun encaissement ne peut plus être effacé : une erreur se corrige par un ticket d'annulation ou une pièce de correction, tous deux tracés.</li>
<li>En mode test, <strong>Paramètres › Infos établissement › Réinitialiser le salon</strong> efface aussi vos tests à tout moment (même archive scellée).</li></ul>
<p>Pour simplement regarder l'application sans créer de compte, utilisez la <a href="/demo">démo</a>.</p>"""),
  dict(h="En cas de contrôle fiscal", p="""<ul>
<li><strong>Paramètres › NF525 › Contrôle fiscal</strong> : appuyez sur « Début du contrôle » puis « Fin du contrôle » ; les deux sont inscrits au journal des événements.</li>
<li>Présentez l'attestation (volets 1 et 2), remettez une archive signée de la période et, si demandé, le FEC.</li>
<li><strong>Identification du logiciel</strong> (même page) : version, numéro de caisse, licence, liste des postes et justificatif de conformité.</li>
<li><strong>Plusieurs appareils</strong> : chaque appareil qui encaisse reçoit automatiquement un numéro de poste (P01, P02…) imprimé sur le ticket ; la numérotation des tickets reste unique pour l'établissement.</li>
<li>Chaque nuit, Luxyra contrôle automatiquement toutes les signatures ; une anomalie serait inscrite au journal et signalée à l'éditeur.</li></ul>"""),
 ]),

dict(slug="site-et-reservation-en-ligne", ic="🌐", cat="En ligne", titre="Site et réservation en ligne",
 resume="Activer votre page, choisir votre adresse, ajouter le bouton Réserver sur Google, protéger votre agenda.",
 sections=[
  dict(h="Activer votre page", p="""<p><strong>Paramètres › Site en ligne</strong>. Votre page publique présente vos prestations, vos photos, vos horaires et vos avis ; vos clientes y réservent sans commission.</p>""",
   img="site_activation", alt="Activation du site", leg=[
    "<strong>Site vitrine</strong> : votre page est visible.",
    "<strong>Réservation en ligne</strong> : les clientes peuvent réserver.",
    "<strong>Boutique Click &amp; Collect</strong> : vente de produits à retirer sur place.",
    "<strong>Bons cadeaux en ligne</strong> : vente de bons cadeaux sur votre page.",
    "<strong>Votre adresse</strong> : copiez-la pour vos réseaux sociaux, votre signature email, un QR code en vitrine.",
    "<strong>Personnaliser votre adresse</strong> : choisissez un nom court (luxyra.fr/votre-nom)."]),
  dict(h="Le bouton « Réserver » sur Google", p="""<p>Copiez votre lien et collez-le dans votre fiche Google (Google Business Profile › Modifier le profil › Lien pour les rendez-vous). Les personnes qui vous trouvent sur Google Maps réservent alors directement chez vous.</p>""",
   img="site_google", alt="Bouton Réserver sur Google", leg=[]),
  dict(h="Garantie anti-absence et règles de réservation", p="""<p>Plus bas sur la même page :</p>""",
   img="site_garantie", alt="Garantie et réglages de réservation", leg=[
    "<strong>Aucun</strong> : réservation libre, sans carte bancaire.",
    "<strong>Acompte</strong> : la cliente paie une partie en réservant (paiements en ligne à activer).",
    "<strong>Empreinte</strong> : la carte est pré-autorisée, rien n'est débité sauf absence.",
    "<strong>Politique d'annulation</strong> : jusqu'à quand la cliente peut annuler en ligne et être remboursée automatiquement.",
    "<strong>Confirmation automatique</strong> : décochée, chaque réservation attend votre validation.",
    "<strong>Délai minimum</strong> avant un rendez-vous, <strong>réservation maximum</strong> à l'avance et intervalle des créneaux proposés."]),
 ]),

dict(slug="paiements-en-ligne", ic="💶", cat="En ligne", titre="Paiements en ligne (acomptes, empreintes, boutique)",
 resume="Activer Stripe pour recevoir acomptes et achats en ligne directement sur votre compte bancaire.",
 sections=[
  dict(h="Activer les paiements", p="""<p><strong>Paramètres › Paiements en ligne › Configurer mes paiements</strong>. Munissez-vous d'une pièce d'identité et d'un RIB : l'inscription chez Stripe prend quelques minutes. L'argent arrive directement sur votre compte bancaire ; Luxyra ne prend aucune commission, seuls les frais Stripe s'appliquent.</p>
<ul><li>Un <strong>acompte payé en ligne</strong> est déduit automatiquement quand vous encaissez le rendez-vous.</li>
<li>Si <strong>vous</strong> annulez ou refusez, la cliente est toujours remboursée.</li>
<li>Un acompte conservé (absence, annulation tardive) ou une empreinte encaissée crée automatiquement un ticket dans la caisse : rien à saisir.</li>
<li>Les frais réels prélevés par Stripe sont consultables dans <strong>Conformité caisse › Frais bancaires Stripe</strong>.</li></ul>""",
   img="connect", alt="Activation des paiements en ligne", leg=[]),
 ]),

dict(slug="sms-et-rappels", ic="📲", cat="En ligne", titre="SMS, rappels et campagnes",
 resume="Rappels automatiques, confirmation, solde de SMS, envoi depuis votre téléphone et campagnes marketing.",
 sections=[
  dict(h="Les rappels automatiques", p="""<p><strong>Paramètres › SMS et Marketing</strong>. Un rappel la veille réduit fortement les oublis. Les rappels par email sont illimités ; les SMS consomment un crédit chacun (les accents et émojis sont convertis pour rester à un crédit).</p>""",
   img="sms", alt="Réglages des SMS", leg=[
    "<strong>Acheter des SMS</strong> : recharger votre solde.",
    "<strong>Recharge automatique</strong> : un pack est acheté quand le solde passe sous un seuil.",
    "<strong>Via Brevo</strong> : envoi professionnel, décompté du solde.",
    "<strong>Depuis mon téléphone</strong> (Android) : envoi gratuit avec votre forfait mobile.",
    "<strong>Rappel 24 h avant</strong> : texte modifiable, avec les variables {prenom}, {heure}, {salon}…",
    "<strong>Rappel 2 h avant</strong> : facultatif."]),
  dict(h="Les campagnes", p="""<p>Tuile <strong>Marketing</strong> : anniversaires, clientes inactives, offre promo, fidélité, cartes à renouveler… Choisissez une campagne, vérifiez l'audience (clientes joignables par SMS ou par email) et envoyez par SMS ou email. L'historique indique qui a reçu quoi.</p>""",
   img="marketing", alt="Campagnes marketing", leg=[]),
 ]),

dict(slug="fichier-clients", ic="👤", cat="Clients", titre="Le fichier clients",
 resume="Retrouver une cliente, sa fiche, ses photos, sa fidélité et ses données personnelles.",
 sections=[
  dict(h="La liste", p="""<p>Tuile <strong>Clients</strong>.</p>""",
   img="clients", alt="Liste des clients", leg=[
    "<strong>Recherche</strong> par nom, téléphone ou email.",
    "<strong>Doublons</strong> : repère les fiches en double et les fusionne (rendez-vous, tickets, fidélité et notes sont regroupés).",
    "<strong>Toutes</strong> les clientes.",
    "<strong>À risque</strong> : pas revenues depuis plus de 4 mois.",
    "<strong>Perdues</strong> : plus de 6 mois sans visite, à relancer (voir les campagnes marketing)."]),
  dict(h="La fiche cliente", p="""<p>Touchez une cliente pour ouvrir sa fiche.</p>""",
   img="client_fiche", alt="Fiche cliente", leg=[
    "<strong>Visites</strong> sur 12 mois et dernière visite.",
    "<strong>Prochains rendez-vous</strong>.",
    "<strong>Créer un rendez-vous</strong> directement depuis la fiche.",
    "<strong>Photos</strong> avant / après (une photo peut être marquée privée).",
    "<strong>Fiche technique</strong> : formules, références, notes de soin.",
    "<strong>Fidélité</strong> : passages, cagnotte, remise disponible.",
    "<strong>RGPD</strong> : consentements SMS et email, invitation à l'espace client, export et effacement de ses données."]),
  dict(h="Questionnaire santé (allergies, contre-indications)", p="""<p>Onglet <strong>🩺 Santé</strong> de la fiche cliente : allergies connues (coloration/PPD, latex, nickel, colles…), test de tolérance (date et résultat), grossesse ou allaitement, contre-indications (diabète, anticoagulants, troubles circulatoires…) et une précision libre.</p>
<ul>
<li>Ce sont des <strong>données de santé</strong> : elles ne s'enregistrent qu'avec le <strong>consentement explicite</strong> de la cliente (case à cocher obligatoire, date conservée).</li>
<li>Dès qu'une information est saisie, un <strong>bandeau rouge</strong> la rappelle dans la fiche rendez-vous et dans la fiche cliente. Un test de tolérance de plus de 6 mois est signalé « à refaire », un questionnaire de plus d'un an « à revoir ».</li>
<li>Visible uniquement par votre établissement. <strong>Effacer</strong> retire tout à la demande de la cliente ; ces informations figurent dans l'export de ses données.</li></ul>"""),
 ]),

dict(slug="fidelite-et-bons-cadeaux", ic="🎁", cat="Clients", titre="Fidélité, cartes d'abonnement et bons cadeaux",
 resume="Récompenser les clientes fidèles et vendre des bons cadeaux, en caisse ou en ligne.",
 sections=[
  dict(h="Le programme de fidélité", p="""<p><strong>Paramètres › Options commerciales</strong>.</p>""",
   img="fidelite", alt="Programme de fidélité", leg=[
    "<strong>Fidélité active</strong> : les passages sont comptés automatiquement à chaque encaissement.",
    "<strong>Mécanique</strong> : carte à tampons (nombre de passages), cagnotte (% du ticket) ou CA cumulé. La remise est proposée automatiquement en caisse quand elle est atteinte.",
    "<strong>Packs promo</strong> : des séances payées d'avance, utilisées au fil des visites.",
    "<strong>Cartes d'abonnement</strong> : un prix fixe pour une durée, avec une remise sur chaque prestation. Non cumulables avec la fidélité."]),
  dict(h="Les bons cadeaux", p="""<p>Un bon se vend en caisse (bouton <strong>Bon cadeau</strong> du ticket) ou sur votre page en ligne. La tuile <strong>Bons cadeaux</strong> liste les bons actifs, utilisés et expirés ; pour l'utiliser, choisissez « Bon cadeau » au moment du paiement. Le registre s'exporte pour le comptable.</p>""",
   img="bons_cadeaux", alt="Bons cadeaux", leg=[]),
 ]),

dict(slug="produits-et-stock", ic="🧴", cat="Caisse", titre="Produits et stock",
 resume="Vendre des produits, suivre le stock, faire un inventaire.",
 sections=[
  dict(h="Le catalogue produits", p="""<p>Tuile <strong>Produits</strong>. Les produits de <strong>revente</strong> se vendent en caisse ; les <strong>consommables</strong> (utilisés pendant les prestations) se suivent en stock sans être vendus.</p>
<ul><li><strong>Entrée stock</strong> : une livraison arrive.</li><li><strong>Sortie stock</strong> : casse, usage interne.</li><li><strong>Inventaire</strong> : recompter et corriger.</li><li>Prix d'achat, marge, fournisseurs et historique des mouvements sont dans les boutons du dessous.</li></ul>""",
   img="produits", alt="Produits et stock", leg=[]),
 ]),

dict(slug="statistiques", ic="📈", cat="Clients", titre="Statistiques",
 resume="Panier moyen, chiffre d'affaires, collaborateurs, meilleures clientes.",
 sections=[
  dict(h="Lire vos statistiques", p="""<p>Tuile <strong>Statistiques</strong>. Choisissez la période en haut. Chaque bloc a trois vues : résumé, <strong>comparer</strong> (avec la période précédente) et <strong>détails</strong>. Vous y trouvez le panier moyen (global et par genre), le CA prestations / produits, le CA par collaborateur, les quantités vendues, les meilleures clientes et les nouvelles clientes.</p>""",
   img="stats", alt="Statistiques", leg=[]),
 ]),

dict(slug="prestations-a-domicile", ic="🚗", cat="Rendez-vous", titre="Prestations à domicile",
 resume="Zone desservie, frais de déplacement et validation des demandes.",
 sections=[
  dict(h="Régler la zone et les frais", p="""<p><strong>Paramètres › Établissement</strong>, mode <strong>À domicile</strong> ou <strong>Mixte</strong>.</p>""",
   img="domicile_reglages", alt="Réglages du domicile", leg=[
    "<strong>À domicile</strong> (ou Mixte) : active les réglages de déplacement.",
    "<strong>Zone couverte</strong> en km autour de votre adresse, et les premiers km gratuits.",
    "<strong>Tarification</strong> : forfait fixe, prix au km, prix par commune ou gratuit.",
    "<strong>Choisir mes communes</strong> : les communes de votre zone sont proposées et pré-cochées ; décochez celles que vous ne desservez pas. Une adresse hors liste ne peut pas réserver."]),
  dict(h="Au quotidien", p="""<ul><li>La cliente saisit son adresse (code postal puis commune dans la liste) ; les frais s'affichent <strong>avant</strong> qu'elle confirme.</li>
<li>Chaque demande à domicile <strong>attend votre validation</strong> (carte orange de l'accueil) : accepter, proposer un autre horaire ou refuser.</li>
<li>L'acompte éventuel est demandé <strong>après</strong> acceptation.</li>
<li>Dans la fiche du rendez-vous, l'adresse s'ouvre dans Maps, et la ligne « Déplacement » est ajoutée automatiquement à l'encaissement.</li></ul>"""),
 ]),

dict(slug="installer-et-notifications", ic="📱", cat="Démarrer", titre="Installer l'application et les notifications",
 resume="Mettre Luxyra sur l'écran d'accueil de votre téléphone, tablette ou ordinateur, et recevoir les alertes.",
 sections=[
  dict(h="Installer", p="""<p><strong>Paramètres › Installer l'application</strong> affiche la marche à suivre pour votre appareil.</p>
<ul><li><strong>iPhone / iPad</strong> : ouvrez luxyra.fr/app dans Safari, bouton Partager, « Sur l'écran d'accueil ».</li>
<li><strong>Android</strong> : dans Chrome, menu ⋮, « Installer l'application » ou « Ajouter à l'écran d'accueil ».</li>
<li><strong>Ordinateur</strong> (Chrome ou Edge) : icône d'installation à droite de la barre d'adresse.</li></ul>""",
   img="installer", alt="Installer l'application", leg=[]),
  dict(h="Notifications push", p="""<p><strong>Paramètres › Notifications push</strong> : activez-les sur chaque appareil où vous voulez être prévenu d'une réservation, même application fermée. Sur iPhone, l'application doit d'abord être installée sur l'écran d'accueil. Si l'état indique « Bloqué », autorisez les notifications pour luxyra.fr dans les réglages du navigateur.</p>"""),
 ]),
]
