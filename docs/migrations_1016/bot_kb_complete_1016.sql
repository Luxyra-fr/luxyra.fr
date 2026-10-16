INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('param_menu_liste_1016','Menu Paramètres : la liste complète des rubriques',1000,$kb$Le menu Paramètres s'ouvre avec la roue dentée « ⚙️ » en haut de l'accueil (visible seulement avec la permission « ⚙️ Réglages »).
En haut : la carte de votre forfait (« Forfait Essentiel » ou « Forfait Pro », ou « Essai gratuit » avec les jours restants), avec « Gérer mon abonnement » et « Changer de forfait » (ou « S'abonner » pendant l'essai).
Puis les rubriques, dans cet ordre :
- « Établissement » : métier, autres activités, mode d'activité, déplacement à domicile.
- « Horaires » : ouverture par jour, fermeture / ouverture exceptionnelle.
- « Équipe » : collaborateurs, horaires, absences, comptes de connexion, PIN, permissions, verrouillage automatique.
- « Affichage planning » : intervalle et hauteur des créneaux.
- « Apparence » : thème de couleurs et fond d'écran de l'application.
- « Infos établissement » : logo, coordonnées, réseaux sociaux, SIRET, n° TVA, note en bas des tickets.
- « Site en ligne » (Pro) : page publique, réservation, boutique, acompte.
- « Options commerciales » : fidélité, packs promo, cartes d'abonnement.
- « Caisse et paiements » : modes de paiement, caisse simplifiée, fond de caisse, taux de TVA, validité des devis, exercice comptable.
- « Paiements en ligne » (Pro) : Stripe Connect.
- « SMS et Marketing » (Pro) : crédits, mode d'envoi, rappels, confirmations.
- « Conformité caisse » : journal d'audit, archives, attestation, FEC, exports comptables.
- « Mes factures » : factures de votre abonnement Luxyra.
- « Parrainer un professionnel ».
- « Mes documents » : Kbis et pièce d'identité.
- « Installer l'application ».
- « Notifications push ».
- « Centre d'aide » (ouvre luxyra.fr/aide dans un nouvel onglet).
- « Migration depuis ancien logiciel » (masquée une fois la migration terminée ; « Migration en cours » pendant la reprise).
- « Support Luxyra ».
Tout en bas : « 🚪 Se déconnecter ».
Chaque rubrique a un bouton de retour vers la liste.
Hors forfait Pro, « Site en ligne », « Paiements en ligne » et « SMS et Marketing » sont grisés avec un badge « PRO » et un cadenas : un appui propose de passer en Pro.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('forfait_abonnement_pro_1016','Abonnement : Essentiel ou Pro, gérer, changer, résilier',1005,$kb$Où : Paramètres, carte du forfait tout en haut.
- « Gérer mon abonnement » ouvre le portail sécurisé Stripe : moyen de paiement, factures, résiliation.
- « Changer de forfait » : passer d'Essentiel à Pro ou l'inverse.
- Pendant l'essai : « S'abonner » ouvre le choix du forfait.
Ce que comprend chaque forfait (texte de la fenêtre de choix) :
- « 📋 Essentiel » : planning, clients, caisse anti-fraude, tickets, fidélité, bons cadeaux, stats.
- « 💎 Pro » : tout Essentiel + site vitrine, réservation en ligne, SMS, marketing, annuaire.
Le prix mensuel de chaque forfait est affiché dans cette fenêtre et sur la carte du forfait. Sans engagement.
Pendant l'essai, toutes les fonctions Pro sont ouvertes ; les SMS s'activent à l'abonnement Pro.
Avant de vous abonner, la caisse doit passer du mode test à la caisse réelle (bouton « Passer en caisse réelle »).
Résiliation : depuis « Gérer mon abonnement » (portail Stripe) ou par e-mail à contact@luxyra.fr. Elle prend effet à la fin de la période en cours. Le compte passe ensuite en mode archives (lecture seule) : vous pouvez exporter vos données et vos documents fiscaux restent conservés 6 ans.
Factures de l'abonnement : Paramètres › « Mes factures ».

Forfait Essentiel ou Pro : ce qui est réservé au Pro
Forfait « 📋 Essentiel » : planning, clients, caisse conforme à la loi anti-fraude, tickets, fidélité, bons cadeaux (vente au salon), statistiques.
Forfait « 💎 Pro » : tout Essentiel, plus site vitrine, réservation en ligne, SMS, marketing, annuaire.
Dans l'application, en Essentiel :
- Paramètres › « Site en ligne », « Paiements en ligne » et « SMS et Marketing » sont grisés avec un badge « PRO » et un cadenas 🔒 ; un appui propose de passer en Pro.
- La tuile « Marketing » porte un badge « PRO ».
- La tuile « Commandes » (Click & Collect) n'apparaît pas.
- Une carte « Passez en Pro » s'affiche sous les tuiles.
Pendant l'essai gratuit, toutes les fonctions Pro sont ouvertes (sauf l'envoi de SMS, activé à l'abonnement Pro).
Changer de forfait : Paramètres › carte du forfait › « Changer de forfait ».
Le prix de chaque forfait est affiché dans la fenêtre de choix.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('param_etablissement_1016','Paramètres › Établissement : métier, autres activités, mode d''activité, domicile',1010,$kb$Chemin : Paramètres › « Établissement ».
- « Métier / Activité » : « 🔒 verrouillé ». Défini à l'inscription. Pour le changer : écrire à support@luxyra.fr.
- « Autres activités » : touchez les métiers que vous proposez aussi (Salon de coiffure, Barbershop, Institut de beauté, Salon d'ongles, Studio regard, Studio maquillage, Tatouage & piercing, Spa & massages, Centre bien-être). Votre établissement apparaît aussi dans ces métiers (recherche, pages par ville) ; la fiche technique et le questionnaire santé s'adaptent.
- « Mode d'activité » : « En établissement », « À domicile » ou « Mixte ».
En mode À domicile ou Mixte, le bloc « 🚗 Déplacement à domicile » apparaît :
- « Zone couverte (km) » et « Gratuit jusqu'à (km) ».
- « Mode de tarification » : « Forfait fixe » (« Montant forfait (€) »), « Prix au km » (« Prix par km (€/km) »), « Par commune » (montant par défaut, réglable par commune) ou « Gratuit ».
- « 🏘️ Communes desservies » : bouton « Choisir mes communes » (ou « Modifier mes communes »). Sans liste, toute adresse dans la zone est acceptée.
Les réglages s'enregistrent dès que vous les modifiez.
Le nom, l'adresse et le logo ne sont pas ici : voir Paramètres › « Infos établissement ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('param_horaires_1016','Paramètres › Horaires : jours d''ouverture et exceptions',1020,$kb$Chemin : Paramètres › « Horaires ».
- Une ligne par jour (Dimanche à Samedi) : heure d'ouverture « à » heure de fermeture.
- Bouton « Fermé » : le jour devient fermé. Sur un jour fermé, bouton « Ouvrir » (proposé de 09:00 à 18:00, modifiable ensuite).
- Carte « 🔒 Fermeture / Ouverture exceptionnelle » : boutons « 🔒 Fermeture exceptionnelle » (jour férié, vacances) et « 🔓 Ouverture exceptionnelle » (événement, soldes).
- La liste des exceptions à venir s'affiche dessous, chacune avec « Supprimer ». Les exceptions passées sont dans « Historique (n exceptions passées) », avec « Tout supprimer ».
Ces horaires sont ceux de l'établissement. Les horaires de chaque collaborateur (et sa pause) se règlent dans Paramètres › « Équipe » › fiche du collaborateur. Pour un seul collaborateur absent, utilisez ses horaires « Personnalisés » ou une absence, pas une fermeture.
Il n'y a pas de réglage séparé « heure de début / fin d'affichage du planning » : le planning suit les horaires.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('equipe_ajouter_collab_1016','Ajouter un collaborateur et lui créer un accès (PIN)',1025,$kb$1. Paramètres › « Équipe » › en bas, « + Ajouter collaborateur ».
2. Saisissez « Nom du collaborateur » puis « Créer ». Sa fiche apparaît dans la liste et une colonne est ajoutée au planning.
3. Dépliez sa fiche et réglez : photo (« 📷 Photo »), couleur, horaires, pause, compétences.
4. Pour qu'il se connecte : carte « 🔐 Compte de connexion » › « ➕ Créer un compte de connexion ».
   - « Rôle » : « 👤 Collaborateur (PIN 4 chiffres) » ou « 👑 Administrateur (PIN 6 chiffres) ».
   - « PIN initial » : à lui communiquer ; il pourra le changer après sa première connexion.
   - « ✅ Créer ».
5. Réglez ensuite « ⚙️ Permissions » (ce qu'il peut voir et faire).
Personne qui encaisse ou gère sans faire de prestations (gérant, comptable) : carte « Compte gestionnaire » › « + Créer ». Champs : « Prénom * », « Nom », « Email (facultatif) », « Rôle », « Lié à un collaborateur du planning (facultatif) » (« Aucun — opérateur uniquement »), « 🔑 PIN initial ». Il n'apparaît pas dans le planning ; il est listé sous « Gestionnaires sans planning ».
Il faut la permission « 👪 Opérateurs » (ou être administrateur) pour créer des comptes.
Tant qu'aucun administrateur n'est défini, un bandeau orange « ⚠️ NF525 — … » invite à configurer les opérateurs (un appui ouvre Équipe).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('equipe_fiche_collab_1016','Fiche d''un collaborateur : tout ce qu''on règle dans Équipe',1030,$kb$Chemin : Paramètres › « Équipe » › touchez le nom du collaborateur pour déplier sa fiche.
- Nom (modifiable directement), couleur (sélecteur à côté de l'avatar : couleur de l'avatar, pas des rendez-vous), « 📷 Photo ».
- Case photo publique : « 🌐 Photo publique sur le site » ou « 🔒 Photo masquée sur le site » (seules les initiales sont alors affichées aux clients).
- « Horaires » : « Fixes » (même semaine type : heure de début, heure de fin, « X » pour un jour de repos, « Activer » pour le rouvrir) ou « Personnalisés » (semaine par semaine, flèches ◀◀ ◀ ▶ ▶▶).
- « ☕ Pause quotidienne » : deux heures, « Supprimer », ou « + Ajouter » (12:00–13:00 proposé).
- « Absences / Congés » à venir, chacune avec « X » pour la supprimer, et « + Congé / Absence / Pause ».
- « 📋 Informations RH » : « Date d'entrée », « Date de départ » (à partir de cette date : plus de rendez-vous, au planning comme en ligne).
- « ⏸ Inactif (congés, arrêt, départ...) » : masqué du planning et de la réservation en ligne, reste dans les statistiques.
- « 🎯 Compétences » › « Configurer » : « ✅ Toutes les prestations » ou une sélection.
- « 🔐 Compte de connexion » : « 🔑 Changer PIN », « 👑 Rôle », « ⚙️ Permissions », « 🔓 Débloquer » (si verrouillé), « ✖ Retirer l'accès à l'app ».
- « 🗑 Supprimer la fiche » : refusé si le collaborateur a des rendez-vous ou des tickets (historique obligatoire). Pour un départ, renseignez la « Date de départ » : il passe dans « 🗄️ Anciens collaborateurs », historique conservé.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('equipe_permissions_1016','Permissions des collaborateurs : la liste exacte',1035,$kb$Chemin : Paramètres › « Équipe » › fiche du collaborateur › « 🔐 Compte de connexion » › « ⚙️ Permissions » › cocher / décocher › « ✅ Enregistrer ».
Un administrateur a toujours tout. Les permissions ne concernent que le rôle Collaborateur.
« 📜 Sections principales » : « 📅 Planning », « 💳 Caisse », « 👥 Clients », « 🧴 Produits », « 📊 Statistiques », « 💰 Comptabilité » (clôtures Z, exports), « 📣 Marketing », « ⚙️ Réglages », « 👪 Opérateurs » (gérer les comptes).
« 📅 Planning » : « 👁️ Voir le planning des autres » (sinon il ne voit que ses rendez-vous), « 💰 Voir le CA du jour », « 📈 Voir le prévisionnel mensuel », « ❌ Annuler un RDV ».
« 💳 Caisse et paiements » : « ↩️ Rembourser » (avoir / annulation de ticket), « 🎁 Appliquer une remise », « 📋 Clôturer la journée ».
« 📊 Données sensibles » : « 🔍 Voir les prix d'achat / marges », « 📤 Exporter des données », « ✏️ Modifier produits / prix », « ✏️ Modifier services / forfaits ».
Par défaut, un nouveau collaborateur a : Planning, Caisse, Clients, Produits, Clôturer la journée, Annuler un RDV, Appliquer une remise. Tout le reste est décoché (CA du jour, statistiques, comptabilité, marketing, réglages, rembourser, exports…).
Quand une action n'est pas permise, Luxyra demande le PIN d'un administrateur pour l'autoriser ponctuellement.
La tuile « Avis clients » demande la permission « Modérer les avis clients » : un collaborateur ne l'a pas par défaut.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('pin_verrouillage_1016','Le code PIN est redemandé trop vite / désactiver le verrouillage',1040,$kb$Le délai se règle : Paramètres › « Équipe » › carte « 🔒 Verrouillage automatique ».
Choix : « 5 min », « 15 min », « 30 min », « 1 h » ou « Jamais ». Par défaut : 5 min.
Réservé à l'administrateur : le PIN administrateur est demandé pour changer ce réglage. La modification est inscrite au journal.
« Jamais » : pas de verrouillage en journée ; le PIN est quand même redemandé après 4 h sans activité.
Verrouiller à la main à tout moment : touchez votre avatar en haut de l'accueil › « 🔒 Verrouiller maintenant ».
Supprimer complètement le code PIN n'est pas possible tant que des comptes de connexion existent : chaque encaissement doit être attribué à la personne connectée (loi anti-fraude).
Pour aller plus vite sur votre appareil personnel : Face ID / empreinte. Après avoir tapé votre PIN, Luxyra propose de l'activer ; sur l'écran du PIN, lien « Utiliser Face ID / empreinte sur mon appareil personnel ». À ne pas activer sur une tablette partagée. Lien « Ne plus utiliser la biométrie sur cet appareil » pour l'arrêter.
Conseil : tablette partagée = délai court ; appareil personnel = délai plus long ou biométrie.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('pin_changer_role_1016','Changer un PIN, changer de rôle, changer d''utilisateur',1045,$kb$Changer le PIN d'une personne : Paramètres › « Équipe » › fiche › « 🔐 Compte de connexion » › « 🔑 Changer PIN » › saisir le nouveau code › « Enregistrer ». Longueur imposée : 4 chiffres pour un Collaborateur, 6 chiffres pour un Administrateur.
Changer le rôle : même carte › « 👑 Rôle ». Confirmation « Changer le rôle en … ? » : il faut redéfinir un PIN à la nouvelle longueur.
Retirer l'accès : « ✖ Retirer l'accès à l'app » (la fiche et l'historique restent).
Débloquer après 5 codes faux : « 🔓 Débloquer ».
Changer d'utilisateur sur l'appareil : en haut de l'accueil, touchez votre avatar › « 🔄 Changer d'utilisateur » (ou le petit bouton « ↻ » à côté du prénom).
Menu de l'avatar : « ❓ Centre d'aide / FAQ », « ✉️ Contacter le support », « 🔄 Changer d'utilisateur », « 🔒 Verrouiller maintenant », « Fermer ».
Code PIN oublié : un administrateur le redéfinit avec « 🔑 Changer PIN ». Si c'est le PIN administrateur qui est oublié et qu'il n'y a pas d'autre administrateur, contactez le support.
Mot de passe du compte (e-mail de connexion) oublié : se déconnecter puis « Mot de passe oublié ? » sur la page de connexion. Il n'y a pas de bouton de changement de mot de passe dans les Paramètres.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('param_affichage_apparence_1016','Paramètres › Affichage planning et Apparence',1050,$kb$Chemin : Paramètres › « Affichage planning ». Deux réglages seulement :
- « Intervalle des créneaux » : 10 min, 15 min, 20 min ou 30 min (pas de la grille du planning).
- « Hauteur créneau » : « 16px Compact », « 20px Normal », « 26px Large », « 32px Très large ».
Les deux s'enregistrent dès le choix.
Dans le planning lui-même, le zoom « − / + » change aussi la hauteur des créneaux pour l'affichage en cours.
L'intervalle des créneaux proposés aux clients sur votre page de réservation est un autre réglage : Paramètres › « Site en ligne » › carte « 📅 Réservation » › « Intervalles » (15 min, 30 min, 1 heure).
Il n'y a pas de réglage d'heure de début ou de fin d'affichage : la grille suit vos horaires et s'élargit automatiquement pour montrer un rendez-vous hors horaires.

Paramètres › Apparence : couleurs et fond d'écran de l'application
Chemin : Paramètres › « Apparence ».
- « Thème couleurs » : Rose, Or, Violet, Vert, Bleu, Orange, Rose Gold, Turquoise, Prune, Noir. Un appui applique la couleur (coche ✓ sur le thème actif).
- « Fond d'écran » : « Choisir une photo » (depuis l'appareil), « Ou URL » (adresse d'une image), réglage « Opacité », et fonds prêts : « Salon 1 », « Salon 2 », « Salon 3 », « Aucun ».
Cela ne change que l'apparence de l'application pro.
Il n'y a pas de bascule mode clair / mode sombre pour l'application.
Le look de votre page publique (thème du site, couleur principale, couleur de fond, style de fond) se règle ailleurs : Paramètres › « Site en ligne » › « 🎨 Personnalisation visuelle ».
Votre logo se change dans Paramètres › « Infos établissement ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('param_infos_etablissement_1016','Paramètres › Infos établissement : les champs',1060,$kb$Chemin : Paramètres › « Infos établissement ». Pensez à toucher « ✅ Enregistrer les infos salon » en bas.
- Logo : « Logo établissement (URL ou cliquez pour charger) », « 📷 Charger une image », « Logo par défaut ».
- « Nom établissement » : 🔒 verrouillé. Changement : écrire à support@luxyra.fr.
- « Sous-titre » (optionnel), « Adresse », « CP », « Ville », « Téléphone », « Email ».
- « 📱 Réseaux sociaux » : « Facebook » (URL complète), « Instagram » et « TikTok » (URL ou @pseudo).
- « SIRET » : « 🔒 verrouillé (légal) » une fois enregistré (il figure sur les tickets). Correction : support@luxyra.fr. Sans SIRET (« en cours d'immatriculation ») : saisissez-le dès réception puis « Vérifier et enregistrer ». Il est obligatoire pour activer l'abonnement.
- « N° TVA intracommunautaire » : facultatif (laissez vide si vous n'êtes pas assujetti).
- « Note en bas des tickets » : 600 caractères maximum, imprimée en bas de tous vos tickets et des tickets envoyés par e-mail.
Pendant l'essai (caisse en mode test) : zone « Période d'essai — Zone de réinitialisation » avec « 🔄 Réinitialiser le salon ».
Le taux de TVA n'est pas ici : Paramètres › « Caisse et paiements » › « Taux TVA ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('logo_changer_1016','Comment changer mon logo, et où il apparaît',1065,$kb$1. Paramètres › « Infos établissement ».
2. En haut : « 📷 Charger une image » (photo ou fichier de l'appareil), ou collez l'adresse d'une image dans « Logo établissement (URL ou cliquez pour charger) ».
3. L'aperçu se met à jour. « Logo par défaut » revient au logo Luxyra.
4. Touchez « ✅ Enregistrer les infos salon » en bas de la page.
Le logo apparaît : en haut de l'application, sur votre page publique (en-tête), dans les e-mails envoyés à vos clients et sur les devis au format A4.
Le logo n'est pas imprimé sur le ticket de caisse : le ticket commence par le nom de l'établissement en majuscules, puis le sous-titre, l'adresse et le téléphone.
La photo de couverture de votre page publique est un autre réglage : Paramètres › « Site en ligne » › « Photo hero (bannière) ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('ticket_contenu_1016','Ticket de caisse : ce qui est imprimé, dans l''ordre',1070,$kb$Le ticket est produit automatiquement par la caisse. Dans l'ordre :
1. En-tête : nom de l'établissement en majuscules, sous-titre (s'il est rempli), adresse, code postal et ville, « Tél: » (s'il est rempli). Pas de logo.
2. « Ticket de vente N°… », date et heure, « Collaborateur: », « Client: », « Opérateur caisse : », et la nature de la vente (prestations, produits ou mixte).
3. Les lignes : quantité, désignation, montant TTC, remises de ligne ou de carte d'abonnement, remise ticket, bons cadeaux.
4. « Total HT : », le détail de TVA (TVA / HT / TTC), « Total TTC : ». Si votre taux est 0 % : « TVA non applicable - Art. 293B du CGI ».
5. Acompte déduit éventuel, puis le règlement (« Payé en … : », en espèces « Donné : » et « Rendu : »).
6. Bloc fidélité (points, progression) ou bloc de la carte d'abonnement (économies).
7. Votre « Note en bas des tickets », si vous en avez écrit une.
8. Pied légal : « SIRET: … », « N° TVA: » (si renseigné), « Logiciel sécurisé - attestation de conformité de l'éditeur », version Luxyra, numéro de caisse et de poste, nombre de lignes, extrait de signature, références de chaînage, « Art. 286-I-3° bis du CGI - Conserver 6 ans ».
Bandeaux possibles en tête : « TEST - DOCUMENT SANS VALEUR FISCALE » (caisse en mode test) ou « DUPLICATA » avec le numéro de copie (réimpression).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('ticket_personnaliser_1016','Peut-on modifier les mentions du ticket de caisse ?',1075,$kb$Ce que vous pouvez personnaliser :
- La note libre en bas du ticket : Paramètres › « Infos établissement » › « Note en bas des tickets » (600 caractères, ex. conditions d'échange des produits) › « ✅ Enregistrer les infos salon ». Elle s'imprime sur tous les tickets, y compris ceux envoyés par e-mail.
- Le sous-titre, l'adresse, le code postal, la ville et le téléphone de l'en-tête : même page.
- Le « N° TVA intracommunautaire » : même page.
- Le taux de TVA : Paramètres › « Caisse et paiements » › « Taux TVA ».
Ce que vous ne pouvez pas modifier :
- Le nom de l'établissement et le SIRET (verrouillés une fois enregistrés) : correction par le support (support@luxyra.fr).
- Les mentions légales du pied de ticket (SIRET, mention du logiciel sécurisé, version, numéro de caisse, signature, chaînage, durée de conservation) et le détail de la TVA : elles sont imposées par la loi anti-fraude.
- L'ordre et la mise en page des blocs.
- Le contenu d'un ticket déjà validé : il est scellé. Une erreur se corrige par un avoir (Caisse › « Gestion des tickets » › « ❌ Avoir / Annuler ») ou, pour le mode de paiement, par « 💳 Modifier règlement ».
Le logo n'est pas imprimé sur le ticket (il figure sur les devis A4 et dans les e-mails).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('ticket_imprimer_envoyer_1016','Imprimer un ticket, l''envoyer par e-mail, PDF et duplicata',1080,$kb$Juste après l'encaissement : boutons « Imprimer », « Email » et « Fermer ».
- « Imprimer » ouvre la fenêtre d'impression de votre appareil (imprimante choisie dans le système). Luxyra n'a pas de réglage d'imprimante ni de format 58/80 mm pour le ticket : le format ticket thermique 80 mm n'est proposé que pour les devis.
- « Email » : fenêtre « ✉️ Envoyer le ticket #… » avec « Envoyer par email au client » et « Télécharger le ticket en PDF ». L'envoi est impossible si le client n'a pas d'e-mail dans sa fiche ou a refusé les e-mails (consentement RGPD dans sa fiche).
Plus tard : Caisse › « 🎫 Gestion des tickets » › choisir la période › sur le ticket « 🖨 Imprimer » ou « ✉ Email ». Aussi depuis l'historique de la fiche client.
Toute réimpression est un duplicata : mention « DUPLICATA », numéro de copie, enregistrement obligatoire. Sans connexion, l'impression du duplicata peut être bloquée : réessayez une fois la connexion revenue.
Le ticket envoyé par e-mail ou téléchargé en PDF porte aussi la mention « DUPLICATA » (c'est une copie de l'original).
Le ticket n'est jamais envoyé automatiquement : uniquement quand vous touchez « Email ».
Il n'existe pas d'envoi du ticket par SMS, ni de QR code sur le ticket.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('tva_taux_1016','Où changer mon taux de TVA ?',1085,$kb$Chemin : Paramètres › « Caisse et paiements » › carte « Taux TVA » › saisir le taux (0 à 30 %) › « Valider ».
Rappel affiché : « Métropole: 20% | Micro: 0% ».
Message « Taux de TVA modifié — Appliqué sur les prochains tickets et bandes Z ». Les tickets déjà enregistrés gardent leur taux. Le changement est inscrit au journal.
Taux à 0 % (franchise en base) : le ticket porte « TVA non applicable - Art. 293B du CGI ».
Il n'y a qu'un taux pour toutes les prestations : pas de taux par prestation.
Produits : un taux propre à chaque produit peut être choisi dans la fiche du produit, onglet « 💰 Prix » › « Dont taux de TVA » (0 / 5,5 / 10 / 20 %). Ce champ n'existe pas à la création : enregistrez d'abord le produit, puis rouvrez-le.
Le numéro de TVA intracommunautaire se saisit ailleurs : Paramètres › « Infos établissement » › « N° TVA intracommunautaire ».
En cas de doute sur votre régime de TVA, demandez à votre expert-comptable.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('param_caisse_paiements_1016','Paramètres › Caisse et paiements : tous les réglages',1090,$kb$Chemin : Paramètres › « Caisse et paiements ».
- « Modes de paiement actifs » : décochez Espèces, Chèque, Carte Bancaire ou Virement pour les retirer des tuiles d'encaissement. « Bon cadeau » et « Paiement mixte » restent toujours actifs.
- « Mode caisse simplifiée (auto-entrepreneur, entreprise individuelle) » : pas de fond de caisse, pas d'écran d'ouverture quotidienne, pas d'entrées / sorties d'espèces. Les tickets restent sécurisés. En mode simplifié, « Gestion de la caisse » disparaît du menu Caisse.
- « Fond de caisse » (hors mode simplifié) : montant › « Valider ».
- « Taux TVA » › « Valider ».
- Case « Afficher TVA (HT/TVA/TTC) sur les tickets clients ».
- « 📄 Validité des devis » : 15, 30, 45, 60 ou 90 j, ou un nombre de jours › « Personnalisé » (1 à 365). Par défaut 30 jours.
- « 📅 Exercice comptable » : date de clôture de l'exercice › « Modifier la date de clôture » (choix du mois, puis « Enregistrer »), « Voir les clôtures d'exercice ». En micro-entreprise, l'exercice se termine obligatoirement le 31 décembre.
- « 🔒 Conformité de la caisse (loi anti-fraude) » : « 📋 Mon attestation », « 📥 Archive du mois », « 📜 Fiche technique de conformité ».
Les comptes comptables des exports et le FEC sont dans Paramètres › « Conformité caisse ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('site_activation_adresse_1016','Site en ligne : activer la page, la réservation, la boutique, l''adresse',1095,$kb$Chemin : Paramètres › « Site en ligne » (forfait Pro).
Carte « Activation », un interrupteur par ligne :
- « 🌐 Site vitrine » : votre page publique est visible.
- « 📅 Réservation en ligne » : les clients peuvent réserver.
- « 🛍 Boutique Click & Collect » : vente de produits à retirer sur place.
- « 🎁 Bons cadeaux en ligne » : grisé tant que Stripe Connect n'est pas actif (« Stripe Connect requis »).
Carte « 🔗 Adresse de votre site » : votre URL publique (luxyra.fr/votre-nom), « 📋 Copier », « ↗ Ouvrir ».
« Personnaliser votre adresse » : lettres minuscules, chiffres et tirets, 2 à 60 caractères, sans mot réservé (pro, app, recherche…) › « Enregistrer ».
Carte « 📍 Bouton « Réserver » sur Google » : « 📋 Copier mon lien Luxyra », marche à suivre en 3 étapes et « 📍 Ouvrir Google Business Profile ↗ ».
Carte « 📍 Votre emplacement sur la carte » : déplacez le repère si besoin, ou « 🔄 Recalculer depuis mon adresse ».
Chaque réglage s'enregistre dès que vous le modifiez.
Les prestations affichées viennent de « Services et Forfaits » (cases « Visible sur le site » et « Réservable en ligne » de chaque prestation).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('site_personnalisation_1016','Site en ligne : personnaliser l''apparence et les textes de la page',1100,$kb$Chemin : Paramètres › « Site en ligne » › carte « 🎨 Personnalisation visuelle ».
- « Thème du site » : Sombre et Or, Sombre et Rosé, Sombre et Bleu, Clair et Or, Clair et Rose, Clair et Vert.
- « Couleur principale » et « Couleur de fond » (sélecteurs de couleur).
- « Style de fond du site » : Uni, Brume, Dégradé, Grainé, Brume rosée, Brume bleue…
- « Slogan » et « Description » (présentation de l'établissement).
- « Photo hero (bannière) » : image de fond du haut de page (taille conseillée 1400 x 600 px) › « 📷 Charger ».
- « 🖼 Photos établissement » : « ➕ Ajouter des photos » (plusieurs à la fois).
Carte « ✍️ Messages » :
- « Message d'accueil » (affiché sur la page).
- « Message après réservation » (affiché au client après sa demande).
Le logo et les réseaux sociaux de la page viennent de Paramètres › « Infos établissement ».
La photo de chaque collaborateur sur la page dépend de sa case « 🌐 Photo publique sur le site » (Paramètres › « Équipe »).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('site_acompte_reglages_1016','Site en ligne : réglages de l''acompte et de l''empreinte',1105,$kb$Chemin : Paramètres › « Site en ligne » › carte « 💳 Acompte à la réservation ».
« 🛡️ Garantie anti no-show » : « Aucun » (réservation libre), « Acompte » (paiement à la résa), « Empreinte » (pré-autorisation). « ❓ Comparer les modes » explique la différence. Acompte et Empreinte demandent Stripe actif (Paramètres › « Paiements en ligne »).
Mode Acompte :
- « Montant » et « Type » : « Montant fixe (€) » ou « Pourcentage (%) ».
- « Montant minimum (€) ».
- « Acompte demandé seulement au-delà de (€) » : 0 = toujours.
- « Description visible par le client ».
Mode Empreinte :
- « Montant empreinte (€) » (5 € minimum).
- « Capture auto après (h) » : délai après l'heure du rendez-vous ; 0 = pas de capture automatique, vous capturez vous-même.
Pour les deux :
- « Politique d'annulation » : « Aucun délai (libre) », « 6h avant », « 12h avant », « 24h avant », « 48h avant (recommandé) », « 72h avant », « Jamais (annulation en ligne désactivée) ».
- Case « Remboursement auto ».
- « Part de l'acompte rendue en cas d'annulation tardive (%) ».
Exemption par client : fiche client › « 👤 Infos » › « Acompte en ligne » : « Par défaut (règle du salon) », « Sans acompte (exempté) » ou « Toujours un acompte ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('site_reservation_reglages_1016','Site en ligne : réglages de la réservation',1110,$kb$Chemin : Paramètres › « Site en ligne » › carte « 📅 Réservation ».
- « Confirmation automatique » : cochée, le rendez-vous entre directement au planning ; décochée, chaque réservation attend votre validation.
- « Délai min (heures) » : 0 à 720 (0 = réservable jusqu'au dernier moment).
- « Résa max (jours) » : 1 à 365.
- « Intervalles » : 15 min, 30 min ou 1 heure entre deux créneaux proposés.
- « 🚫 Bloquer la création de nouveaux comptes » : les nouveaux clients ne peuvent plus créer de compte ; les clients existants réservent toujours.
- « 📸 Permettre aux clients de voir leurs photos » : section « Mes photos » dans leur compte ; les photos marquées 🔒 privées restent invisibles.
Carte « ✨ RDV sur mesure » : « Activer les RDV sur mesure » ajoute le bouton « Demander un RDV sur mesure » sur votre page ; vous répondez par une proposition.
Couper complètement la réservation en ligne : décochez « 📅 Réservation en ligne » dans la carte « Activation ». Les rendez-vous déjà pris restent.
Fermer des jours précis : Paramètres › « Horaires » › « 🔒 Fermeture exceptionnelle ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('prestation_en_ligne_cacher_1016','Mettre une prestation en ligne ou la cacher du site',1115,$kb$Chemin : Accueil › « Services et Forfaits » › onglet « Services » › choisir la famille › sur la prestation, bouton « Modifier » (crayon).
Deux cases, cochées par défaut à la création :
- « ● Visible sur le site » : la prestation apparaît dans les tarifs de votre page publique. Décochez pour la cacher.
- « ● Réservable en ligne » : les clients peuvent la réserver en ligne. Décochez pour la garder au salon uniquement (ex. diagnostic).
Puis « Enregistrer ».
Dans la liste, les pastilles « ● Site » / « ○ Site » et « ● Réservation » / « ○ Réservation » montrent l'état ; elles ne sont pas cliquables, passez par « Modifier ».
Pour un forfait : onglet « Forfaits » › crayon ✏️ › cases « 🌐 Site » et « 📅 Réservation ».
Prestation « sur devis » : visible avec « Sur devis » et un bouton Demander (le client envoie une demande au lieu de réserver).
Réserver une prestation à certains collaborateurs : Paramètres › « Équipe » › fiche › « 🎯 Compétences » › « Configurer ».
Il n'existe pas d'interrupteur « désactiver » : décochez les deux cases, ou supprimez la prestation.
La page doit aussi être active : Paramètres › « Site en ligne » › « 🌐 Site vitrine » et « 📅 Réservation en ligne ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('options_commerciales_1016','Paramètres › Options commerciales : fidélité, packs, cartes d''abonnement',1120,$kb$Chemin : Paramètres › « Options commerciales ». Trois sections.
« 🏅 1. Programme de fidélité » :
- « Fidélité active » (interrupteur).
- « Mécanique de fidélité » : « 🎯 Carte tampon (par passages) », « 💰 Cagnotte (% du ticket) » ou « 📊 CA cumulé (seuil en €) ».
- Carte tampon : « Nombre de passages pour la remise », « Type de remise » (« Montant fixe (€) » ou « Pourcentage (%) »), « Valeur de la remise », « La remise s'applique sur » (« Services et forfaits uniquement » ou « Tout le ticket (services, forfaits et produits) »).
- Cagnotte : « % du ticket versé dans la cagnotte du client ».
- CA cumulé : « Seuil de CA cumulé pour déclencher la remise (€) », « Type de remise », « Valeur de la remise » (compteur remis à zéro après la remise).
- Une phrase de résumé vérifie votre réglage.
« 🎟️ 2. Packs promo » : pas de modèle à créer ici. Ils se vendent depuis la fiche client (onglet « 🎟️ Packs » › « + Vendre un pack promo »). Le nombre de packs actifs est affiché.
« 💳 3. Cartes d'abonnement » :
- Interrupteur « Cartes d'abonnement actives » (désactivé : aucune carte proposée à la vente, ni en caisse, ni en fiche client, ni sur le site).
- « + Créer une carte d'abonnement » : « Nom de la carte * », « Tarif fixe (€ TTC) * », « Durée (mois) * », « Remise services (%) », « Remise forfaits (%) ». Pas de remise sur les produits.
- Sur chaque carte : « ✏️ Modifier », « 🗑 Supprimer ».
Carte d'abonnement et fidélité ne se cumulent pas : un client avec carte active n'accumule plus de points (reprise à l'expiration).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('paiements_en_ligne_page_1016','Paramètres › Paiements en ligne (Stripe)',1125,$kb$Chemin : Paramètres › « Paiements en ligne » (forfait Pro).
Sert à encaisser en ligne : acomptes et empreintes de réservation, achats de la boutique Click & Collect, bons cadeaux en ligne, propositions de RDV sur mesure.
L'argent arrive directement sur votre compte bancaire via Stripe Connect. 0 % de commission Luxyra ; seuls les frais Stripe s'appliquent (affichés sur la page).
La zone de statut indique l'état de votre compte Stripe et propose de configurer ou terminer l'inscription (pièce d'identité et RIB nécessaires).
Frais réellement prélevés : Paramètres › « Conformité caisse » › « 💳 Frais bancaires Stripe (temps réel) » › « 💳 Voir mes frais Stripe en temps réel ».
Les paiements par carte au salon passent par votre propre terminal bancaire (TPE) : Luxyra ne gère pas de terminal de paiement intégré. En caisse, vous choisissez simplement « Carte Bancaire » comme mode de paiement.
Tant que Stripe n'est pas actif, l'acompte ou l'empreinte choisis dans Site en ligne sont suspendus : les clients réservent sans payer.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('sms_parametres_1016','Paramètres › SMS et Marketing : crédits, envoi, rappels',1130,$kb$Chemin : Paramètres › « SMS et Marketing » (forfait Pro).
- Solde de crédits SMS et bouton « Acheter des SMS » (ouvre Marketing). Bonus offert une seule fois au 1er paiement Pro.
- « 🔁 Recharge automatique » (abonnement Pro payé) : quand il reste moins d'un seuil, un pack est acheté avec la carte de votre abonnement.
- « 📡 Mode d'envoi des SMS » : « 💼 Via Brevo (par défaut) » (décompté de votre solde) ou « 📱 Depuis mon téléphone » (GRATUIT, via la SIM d'un téléphone Android lié : « 📲 Lier mon téléphone Android », « Délier »). Android uniquement.
- « 📲 Rappels SMS automatiques » : « 🔔 Rappels SMS actifs », « ⏰ Rappel 24h avant » (« Message 24h »), « ⏰ Rappel 2h avant » (« Message 2h »).
- « ✉️ Rappels Email automatiques » : « ✉️ Rappels Email actifs » et « Message email rappel » (illimité).
- « ✅ Confirmation de rendez-vous » : « 🤖 SMS automatique sur réservation en ligne » (1 crédit par réservation) et son message ; puis « Envoi manuel depuis la fiche du RDV » : « 📲 Confirmation par SMS » et « ✉️ Confirmation par Email », avec leurs messages.
Variables utilisables : {prenom} {nom} {heure} {date} {prestation} {salon} {collab}.
Un compteur indique le nombre de crédits que coûte le texte.
Les campagnes, anniversaires et relances se gèrent dans la tuile « Marketing » de l'accueil.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('sms_confirmation_rdv_1016','Envoyer la confirmation d''un rendez-vous par SMS ou e-mail',1135,$kb$Après avoir validé un nouveau rendez-vous dans le planning, si le client a un téléphone ou un e-mail, la fenêtre « ✉ Confirmation de RDV » s'ouvre :
« Envoyer par email », « Envoyer par SMS », « Envoyer les deux » ou « Ne pas envoyer ».
Le texte de ces confirmations se modifie dans Paramètres › « SMS et Marketing » › « ✅ Confirmation de rendez-vous » (« Message SMS de confirmation », « Message email de confirmation »).
Un SMS consomme des crédits (sauf en mode « Depuis mon téléphone »).
Pour les réservations faites sur votre page : case « 🤖 SMS automatique sur réservation en ligne » dans la même rubrique.
Les rappels (24 h et 2 h avant) partent automatiquement si « 🔔 Rappels SMS actifs » est coché.
Il n'y a pas de bouton pour envoyer un SMS libre à un client depuis sa fiche ou depuis le rendez-vous : pour un message à une seule personne, utilisez Marketing › « Message libre » et ne cochez que ce client.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('marketing_tuile_1016','Tuile Marketing : onglets et campagnes disponibles',1140,$kb$Chemin : Accueil › « Marketing » (forfait Pro et permission « 📣 Marketing » ; hors Pro la tuile porte un badge « PRO »).
En haut : « 📱 Crédits SMS » (alerte « ⚠ Bientôt épuisé » à 10 crédits ou moins), « ✉️ Emails — Illimité », « 📜 Historique des SMS envoyés — qui / quand / pourquoi », et les packs « Besoin de plus de SMS ? ».
Onglets : « 📣 Campagnes », « 💳 Automatisations », « 🔔 Rappels RDV », « 📜 Historique », « ⚙️ Configuration ».
Campagnes proposées :
- « Anniversaires » (clients du mois)
- « Clients inactifs » (relance sans harcèlement : délai de 3 à 12 mois)
- « Offre promo » (tous les clients)
- « Fidélité » (seuil atteint)
- « Carte à renouveler » (expiration dans moins de 30 jours)
- « Proposer la carte » (clients sans carte)
- « Nouveaux clients » (inscrits ce mois)
- « Message libre » (sélection manuelle)
Fenêtre d'envoi : « Canal d'envoi » (« 📱 SMS » et / ou « ✉️ Email »), liste des clients à cocher (case « Tous »), « Message » modifiable (variables {prenom} {nom} {salon}), « Objet email », puis « Envoyer 📨 ».
« 💳 Automatisations » : messages des cartes d'abonnement (bienvenue, rappel 30 jours et 7 jours avant expiration), « 🎂 Anniversaire client », « 💌 Relance clients inactifs ».
« ⚙️ Configuration » : « Nom expéditeur SMS » (11 caractères max), « 📱 Envoyer un SMS test », « ✉️ Envoyer un email test », « 📱 Recharger des SMS ».
Il n'existe pas de modèles de messages enregistrables.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('sms_tous_clients_1016','Comment envoyer un SMS à tous mes clients (ou à un seul)',1145,$kb$À tous les clients :
1. Accueil › « Marketing » › onglet « 📣 Campagnes ».
2. Choisissez « Offre promo » (tous les clients) ou « Message libre ».
3. « Canal d'envoi » : cochez « 📱 SMS » (et « ✉️ Email » si vous voulez aussi l'e-mail).
4. Laissez la case « Tous » cochée, ou décochez des clients.
5. Rédigez le « Message » (variables {prenom} {nom} {salon}) et l'« Objet email ».
6. « Envoyer 📨 ».
À un seul client : « Message libre », décochez « Tous », cochez uniquement ce client.
Règles appliquées automatiquement :
- Le SMS ne part qu'aux clients qui ont accepté les SMS ; l'e-mail qu'à ceux qui ont accepté les e-mails (consentements dans la fiche client › onglet « ✉️ RGPD »).
- Chaque SMS consomme des crédits (sauf envoi « Depuis mon téléphone »). Si les crédits manquent : acheter, « Envoyer quand même » (les SMS manquants attendent la recharge) ou annuler.
- Envoi progressif ; pas de SMS la nuit (entre 21 h et 8 h, la campagne attend le matin).
- L'historique est dans l'onglet « 📜 Historique ».
Il n'y a pas de bouton SMS dans la fiche client.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('sms_credits_achat_1016','Acheter des crédits SMS et recharge automatique',1150,$kb$Acheter : Accueil › « Marketing » › « Besoin de plus de SMS ? » (ou onglet « ⚙️ Configuration » › « 📱 Recharger des SMS »). Packs de 100, 250 ou 500 SMS (et 1000 si proposé), prix affiché sur chaque bouton. Paiement sécurisé Stripe dans un nouvel onglet. Réservé au forfait Pro payé.
Raccourci : Paramètres › « SMS et Marketing » › « Acheter des SMS ».
Bonus : un lot de SMS offert une seule fois au 1er paiement Pro (nombre affiché). Pendant l'essai, les SMS ne sont pas actifs.
Recharge automatique : Paramètres › « SMS et Marketing » › « 🔁 Recharge automatique » : « Quand il reste moins de » 10, 20, 50 ou 100 SMS, acheter le pack choisi, avec la carte de votre abonnement Luxyra. Elle se désactive après un refus de paiement.
Le solde s'affiche en haut de l'accueil (« 📱 N SMS », rouge à 10 ou moins, orange à 30 ou moins) ; un appui ouvre Marketing.
Envoyer sans crédits : Paramètres › « SMS et Marketing » › « 📡 Mode d'envoi des SMS » › « 📱 Depuis mon téléphone » (téléphone Android lié, envoi par votre forfait mobile).
Les e-mails sont illimités et gratuits.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('conformite_caisse_page_1016','Paramètres › Conformité caisse : contenu de la page',1155,$kb$Chemin : Paramètres › « Conformité caisse ». La caisse est conforme à la loi anti-fraude (art. 286-I-3° bis du CGI), avec attestation de l'éditeur.
Cartes de la page :
- « Stats » : tickets, annulations, clôtures Z.
- « 💳 Frais bancaires Stripe (temps réel) » › « 💳 Voir mes frais Stripe en temps réel ».
- « Journal audit (20 derniers) » › « Exporter audit » ; « Exporter données » (export complet de votre compte).
- « 📁 Archivage annuel (obligation fiscale) » › « 📁 Générer archive annuelle ».
- « 🔏 Archive fiscale signée (vérifiable) » › « 🔏 Télécharger l'archive signée », case « Fichier remis à l'administration fiscale (contrôle) », lien « Ouvrir l'outil de vérification ↗ » (luxyra.fr/verif-nf525).
- « ℹ️ Identification du logiciel » : version, mode de caisse (test ou réelle).
- « 🔎 Contrôle fiscal » : « Début du contrôle », « Fin du contrôle ».
- « 📊 Bande de contrôle mensuelle » › « 🖨 Générer la bande mensuelle ».
- « 📄 Attestation de conformité » › « 📄 Signer / télécharger l'attestation » (en franchise de TVA : non requise).
- « 🧾 Comptes comptables pour l'export » : CA Services, CA Ventes, Bons cadeaux, TVA collectée, Caisse, Espèces, Cartes bancaires, Paiements en ligne, Chèques, Autres règlements, Code journal › « 💾 Enregistrer les comptes ».
- « 📑 Export FEC (contrôle fiscal) » : « Date de début », « Date de fin », « 📑 Télécharger le fichier FEC », « 📓 Télécharger l'export comptable EBP (par jour) », « 📓 Télécharger l'export comptable CEGID Quadratus (par jour) », « 📊 Rapport "Pour le comptable" ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('exports_comptables_liste_1016','Exports comptables : la liste complète et où les trouver',1160,$kb$1) Accueil › « Caisse » › « 📊 Journal / Bande Z » (permission « 💰 Comptabilité ») › choisir le mois › « Documents comptables » :
- « Télécharger l'Excel comptable » : un fichier Excel avec Synthèse, Journal, TVA (ou URSSAF), Compta, Annulations, Stripe, Cartes cadeaux, Caisse, Guide.
- Documents séparés : « Bande Z mensuelle (PDF) », « Déclaration URSSAF mensuelle (CSV) », « Journal de caisse détaillé (CSV) », « Récap TVA mensuel (CSV) », « Journal des ventes — écritures comptables (CSV) » (importable Sage / EBP / Cegid), « Annulations & remboursements (CSV) », « Bordereau acomptes en ligne (CSV) », « Livre des recettes encaissées (CSV) » (micro-entreprise), « Acomptes reçus non soldés — fin du mois (CSV) », « Paiements en ligne — TVA à l'encaissement (CSV) ».
2) Paramètres › « Conformité caisse » : FEC (fichier texte, SIRET requis), EBP (CSV), CEGID Quadratus, rapport « Pour le comptable », archives signées, bande de contrôle mensuelle, journal d'audit, « Exporter données ».
3) Caisse › « 🎫 Gestion des tickets » : bouton « Excel » (liste des tickets de la période).
4) Tuile « Bons cadeaux » : « 📄 Export CSV ».
Pas d'export natif dédié à Pennylane ou Ciel : utilisez le FEC ou le journal des ventes CSV.
Les statistiques n'ont pas de bouton d'export.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('factures_documents_parrainage_1016','Mes factures, Mes documents et parrainage',1170,$kb$Factures de votre abonnement : Paramètres › « Mes factures ». Page « 🧾 Mes factures Luxyra » : une ligne par facture (numéro, date, forfait, mode de paiement, montant TTC) avec un bouton « 📄 PDF ». « Aucune facture pour le moment. » si aucune facture n'est encore émise.
Moyen de paiement de l'abonnement : Paramètres › « Gérer mon abonnement » (portail Stripe).
Ces factures concernent votre abonnement à Luxyra, pas vos clients : Luxyra n'émet pas de facture client au format A4 (voir la fiche « Facture client »).
Parrainage : Paramètres › « Parrainer un professionnel ».
- « Votre code », « Copier le lien », « ✉️ Message prêt à envoyer (modifiable) » avec « 📋 Copier le message », « WhatsApp », « Email ».
- Fonctionnement : le professionnel s'inscrit avec votre code et profite de son essai ; dès qu'il paie son premier mois, votre mois suivant est offert, déduit automatiquement de votre facture Luxyra (e-mail de confirmation). Jusqu'à 12 mois offerts par an. Si vous êtes encore en essai, le mois offert s'applique dès votre abonnement.
- « Vos établissements parrainés (n) » : liste avec la date d'inscription et le statut.

Paramètres › Mes documents : Kbis et pièce d'identité
Chemin : Paramètres › « Mes documents » (page « 📁 Documents justificatifs »).
- « Statut » de la vérification ; les documents sont vérifiés par l'équipe Luxyra sous 48 h.
- « 🏢 Extrait Kbis ou avis INSEE » : document de moins de 3 mois (PDF, JPG ou PNG, 5 Mo maximum) › « 📄 Sélectionner le fichier ».
- « 🆔 Pièce d'identité du gérant » : carte d'identité, passeport ou titre de séjour en cours de validité. « Recto (obligatoire) » › « 📄 Sélectionner le recto » ; « Verso (optionnel) » › « 📄 Ajouter le verso ».
- Une fois envoyé : « Voir le document ↗ » et « Remplacer ».
- Une fois validé par l'administration : « 🔒 » et « Verrouillé ». Pour le mettre à jour, contactez le support.
Message pendant le contrôle : « 🔍 Vos documents sont en cours de vérification. Vous recevrez une confirmation par email. »
Le SIRET lui-même se saisit dans Paramètres › « Infos établissement ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('notifications_push_param_1016','Paramètres › Notifications push',1185,$kb$Chemin : Paramètres › « Notifications push ».
- « État : » de cet appareil (activées, désactivées, bloquées…).
- « Activer » : autorise les notifications sur cet appareil (nouvelle réservation, annulation, commande…), même application fermée.
- « Tester l'envoi » : envoie une notification de test depuis le serveur.
- « Désactiver » : coupe les notifications sur cet appareil.
- « Tester l'affichage (sans envoi) » : crée une notification directement sur l'appareil, sans passer par le serveur (pour vérifier que l'appareil les affiche).
À activer sur chaque appareil. Sur iPhone / iPad, l'application doit d'abord être installée sur l'écran d'accueil (Paramètres › « Installer l'application »).
Si l'état indique « Bloqué », autorisez les notifications pour luxyra.fr dans les réglages du navigateur ou du téléphone.
« Se déconnecter » coupe aussi les notifications de l'établissement sur cet appareil : réactivez-les après reconnexion.
Les notifications restent aussi consultables dans la cloche « 🔔 » en haut de l'accueil.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('migration_ancien_logiciel_1016','Migration depuis un ancien logiciel (reprise du fichier client)',1195,$kb$Chemin : Paramètres › « Migration depuis ancien logiciel » (« Reprise gratuite de votre fichier client »), juste avant « Support Luxyra ».
Ce n'est pas un import automatique : c'est une demande à l'équipe Luxyra, qui fait la reprise pour vous, gratuitement.
Formulaire : nom de l'établissement, e-mail, téléphone, « Type de solution actuelle * » (logiciel de caisse, plateforme de réservation, logiciel de planning, Excel / CSV, agenda papier, autre), « Nom de votre logiciel actuel », « Nombre approximatif de clients », « Précisions ».
« Que souhaitez-vous récupérer ? » : fiche client, fiches techniques, photos clients, historique des RDV, anciennes factures (archive), programme fidélité, cartes d'abonnement actives.
Bouton « Envoyer ma demande ». Ensuite l'entrée devient « ⏳ Migration en cours » : l'équipe vous recontacte sous 4 h ouvrées. Un bouton « 📧 Demander mes données à mon ancien éditeur » prépare un courrier type (droit à la portabilité RGPD).
Une fois la migration terminée, l'entrée disparaît du menu.
Les tickets importés d'un ancien logiciel restent consultables mais hors du périmètre de la caisse sécurisée Luxyra.
Il n'existe pas d'import CSV / Excel de clients ou de produits fait par vous-même dans l'application.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('support_contact_1016','Contacter le support et trouver l''aide',1200,$kb$- Paramètres › « Support Luxyra » : ouvre la messagerie de support (onglets « En cours » et « Historique », « ＋ Nouveau sujet », pièce jointe 📎, « 🙋 Humain » pour demander une personne de l'équipe, « ✓ Résolu »).
- La bulle « 💬 » en bas de l'écran apparaît quand une réponse non lue vous attend.
- Menu de votre avatar (en haut de l'accueil) : « ❓ Centre d'aide / FAQ » (luxyra.fr/aide) et « ✉️ Contacter le support » (e-mail à support@luxyra.fr).
- Paramètres › « Centre d'aide » : guides illustrés pas à pas, dans un nouvel onglet (l'application reste ouverte).
Écrivez au support pour : changer le métier principal, le nom de l'établissement ou le SIRET (verrouillés), mettre à jour un document validé, un ticket bloqué à la clôture (bouton « Signaler au support »).
<ESCALATE/> quand la demande touche à une modification verrouillée, à la facturation de l'abonnement ou à un problème de caisse non résolu par les guides.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('accueil_tuiles_1016','Accueil : les tuiles et les permissions qui les affichent',1205,$kb$Section « Mon salon » de l'accueil. Une tuile n'apparaît que si la personne connectée a la permission indiquée.
- « Planning » (Planning).
- « Encaissement » (Caisse) : ouvrir un ticket.
- « Clients » (Clients).
- « Services et Forfaits » (« Modifier services / forfaits »).
- « Produits » (Produits) : la page s'intitule « Boutique » ; pastille rouge = produits sous le stock minimum.
- « Bons cadeaux » (Caisse).
- « Attente » (Planning) : menu « 📝 Tickets en attente » et « 📄 Devis » (ces pages demandent aussi la permission Caisse).
- « Caisse » (Caisse) : menu « 🎫 Gestion des tickets », « 🎁 Bons cadeaux », « 💰 Gestion de la caisse » (masqué en caisse simplifiée), « 📊 Journal / Bande Z » (permission Comptabilité).
- « Statistiques » (Statistiques).
- « Avis clients » (« Modérer les avis clients ») : pastille = avis sans réponse.
- « Commandes » (Caisse, forfait Pro, boutique active ou commandes existantes) : Click & Collect.
- « Marketing » (Marketing, forfait Pro ; sinon badge « PRO »).
En haut à droite : solde « 📱 N SMS » (Pro), avatar de la personne connectée, « 🔄 » (actualiser), « ⚙️ » (Paramètres, permission Réglages), cloche « 🔔 ».
Il n'y a pas de recherche globale ni de raccourcis clavier : chaque écran a sa propre recherche.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('accueil_ca_bandeaux_1016','Accueil : CA du jour, prévisionnel, bandeaux et cartes',1210,$kb$Bandeau « CA DU JOUR » (permission « Voir le CA du jour ») : montant TTC, « HT : », nombre de clients, puis 4 cases : « ✅ Réalisé », « ⏳ À venir », « Services (brut) » (avant remise) et « 🛍 Produits ». Sur téléphone, il se replie avec ▲ / ▼.
« 📈 Prévisionnel [mois] » (permission « Voir le prévisionnel mensuel ») : « ✅ Réalisé », « 📅 À venir », « 🎯 Total prévisionnel ».
Ensuite : « ✨ Nouveaux clients » et une case par collaborateur.
Bouton « CLÔTURE DE LA JOURNÉE » (permission « Clôturer la journée » ; sinon le PIN administrateur est demandé).
Cartes possibles en haut :
- « 📩 N demande(s) de rendez-vous à valider » : touchez une ligne pour ouvrir le rendez-vous (acceptez ou refusez dans sa fiche).
- « ✨ N demande(s) sur mesure ».
Bandeaux d'information (un à la fois) : « Entreprise en cours d'immatriculation » (ajoutez votre SIRET), « Attestation de conformité de votre caisse à signer » (« ✕ » = rappel dans 7 jours), « Installez Luxyra sur cet appareil », « Parrainez un professionnel, gagnez 1 mois offert ».
Bandeau violet « MODE TEST » : la caisse est encore en mode test (essai).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('cloche_notifications_1016','La cloche 🔔 : notifications de l''application pro',1215,$kb$Chemin : accueil › cloche « 🔔 » en haut à droite. Le chiffre rouge = notifications non lues.
Fenêtre « 🔔 Notifications » : onglets « Toutes (N) » et « Non lues (N) ».
Types : « Nouveau RDV », « RDV en ligne », « Modification demandée », « RDV annulé », « Modification vue », « Créneau pris : proposition à refaire », « Demande sur mesure », « Proposition refusée », « Commande » (Click & Collect), « Acompte reçu », « Support ».
Boutons :
- Demande de modification : « ✓ Accepter », « ✗ Refuser », « 📅 Voir ce jour ».
- Lié à un rendez-vous : « Voir le RDV → ».
- Demande sur mesure : « Voir la demande → ».
- « Marquer lu » sur une notification.
En bas : « Tout marquer lu » et « 🗑 Effacer les lues ». Les demandes qui attendent votre réponse (« ⏳ En attente de votre réponse ») restent affichées jusqu'à ce que vous les traitiez.
Il n'y a pas de filtre par type ni de réglage des notifications dans cette fenêtre. Pour être prévenu application fermée : Paramètres › « Notifications push ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('menu_caisse_attente_1016','Menus Caisse et Attente ; tickets mis en attente',1220,$kb$Accueil › « Caisse » ouvre un menu :
- « 🎫 Gestion des tickets » : tickets de la période (filtre par dates et mode de paiement, bouton « Excel ») ; sur chaque ticket « 🖨 Imprimer », « ✉ Email », « ✏️ Modifier collaborateur », « 💳 Modifier règlement », « ❌ Avoir / Annuler ».
- « 🎁 Bons cadeaux ».
- « 💰 Gestion de la caisse » : espèces, coffre, remise en banque, entrées / sorties (absent en mode caisse simplifiée).
- « 📊 Journal / Bande Z » : comptabilité du mois, clôtures et exports (permission Comptabilité).
L'encaissement lui-même se fait par la tuile « Encaissement ».
Accueil › « Attente » ouvre :
- « 📝 Tickets en attente » : paniers mis de côté. Chaque carte : client (ou « Client de passage »), collaborateur, articles, montant, bouton « Reprendre » et corbeille « Supprimer ».
- « 📄 Devis ».
Mettre un ticket en attente : dans la caisse, « ⏸ Attente » (ou « Mettre en attente » dans les options). Quitter la caisse avec un panier non vide le met en attente automatiquement. Récupérer : « 📂 Reprendre un ticket » dans la caisse, ou la tuile Attente.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('devis_1016','Devis : créer, imprimer, envoyer, encaisser',1225,$kb$Créer : uniquement depuis la caisse. Composez le panier, puis « 📝 Devis » (ou options › « Créer un devis »).
Retrouver : Accueil › « Attente » › « 📄 Devis ». Filtres : « À traiter », « 📅 Planifiés », « ✓ Encaissés », « Refusés/Expirés », « Tous ».
Sur chaque devis : « Imprimer », « Planifier RDV », « Encaisser », et « Plus » : « Modifier le devis », « Format d'impression… », « Envoyer par email », « Supprimer ».
Formats d'impression : « A4 / Imprimante standard » (avec votre logo et « Bon pour accord — Signature du client ») ou « Imprimante ticket / thermique » (80 mm, sans logo).
Validité : Paramètres › « Caisse et paiements » › « 📄 Validité des devis » (30 jours par défaut). Le devis indique « Valable jusqu'au … ».
Statuts : Brouillon, Envoyé, Accepté, Planifié, Refusé, Encaissé, Expiré.
Un devis n'est pas compté dans le chiffre d'affaires. Il est conservé 10 ans.
Une prestation « sur devis » du catalogue est différente : c'est une prestation dont le prix est demandé à l'encaissement.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('planning_couleurs_1016','Planning : d''où viennent les couleurs et comment les changer',1230,$kb$La couleur d'un rendez-vous dépend de la famille de sa prestation (Coupe, Couleur, Soin…), pas du collaborateur ni du statut.
Changer la couleur d'une famille : Accueil › « Services et Forfaits » › onglet « Services » › choisissez la famille › « Couleur planning : » › choisissez la couleur. Elle s'applique à tous les rendez-vous de cette famille.
Une famille sans couleur choisie reçoit une couleur automatique fixe. Un rendez-vous sans famille est gris.
Forfait en plusieurs étapes : chaque étape prend la couleur de la famille de sa prestation.
Exception : un rendez-vous pris en ligne est toujours violet.
Le statut s'affiche par un badge texte dans le bloc (si le bloc est assez haut) : « ✔ Confirmé », « ✔ Encaissé », « ⏳ À valider », « 🌐 En ligne », « 💳 Acompte X€ », « 🚗 Domicile », « 📅 Prévu »…
La couleur choisie dans Paramètres › « Équipe » pour un collaborateur ne colore que son avatar (en-tête de colonne), pas ses rendez-vous.
Absences : couleurs fixes, non modifiables (congé bleu, pause orange clair, fermeture exceptionnelle rose…).
On ne peut pas choisir une couleur pour un rendez-vous précis.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('planning_temps_pose_1016','Temps de pose et étapes : libérer le collaborateur pendant la pose',1235,$kb$Les temps de pose se règlent uniquement dans un forfait (une prestation simple n'a qu'une durée).
1. Accueil › « Services et Forfaits » › onglet « Forfaits » › « 📦 Nouveau forfait » (ou le crayon ✏️).
2. « Nom * », prix, « Catégorie », cases « 🌐 Site » et « 📅 Réservation ».
3. Bloc « Composition (étapes du forfait) » : « + Ajouter une prestation » (choix dans votre catalogue) et « + Pause ».
4. Une pause (« ⏸ Pause — … peut s'occuper d'un autre client ») libère le collaborateur : le créneau reste réservable pendant ce temps.
5. Réglez la durée de chaque étape avec « - » / « + » ou en tapant les minutes ; flèches ▲ ▼ pour l'ordre, « × » pour retirer. « Durée totale » s'affiche.
6. « Créer le forfait » (ou « Enregistrer »).
Dans le planning : une étape de travail est un bloc coloré ; une pause est une bande transparente « ⏸ ».
Confier une étape à un autre collaborateur : à la prise de rendez-vous, bloc « Détail des phases (modifiable) » (collaborateur et durée par phase) ; ou dans la fiche du rendez-vous, menu collaborateur de chaque phase.
Prendre un client pendant la pose d'un autre : créez simplement le rendez-vous sur le créneau libre ; en cas de chevauchement réel, « Forcer le RDV quand même » est proposé.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('planning_vues_1016','Planning : vues, navigation, impression, synchronisation',1240,$kb$Vues : boutons « 1j » à « 7j » (nombre de jours affichés côte à côte), une colonne par collaborateur et par jour.
En vue plusieurs jours : option « Masquer jours de fermeture » ; toucher l'en-tête d'un jour l'ouvre en vue 1 jour.
Navigation : « Aujourd'hui », flèches ◀ ▶, calendrier pour choisir une date, ↻ « Actualiser le planning ».
Zoom « − / + » : hauteur des créneaux à l'écran (réglage permanent : Paramètres › « Affichage planning »).
« 🖨 Imprimer » : imprime la liste des rendez-vous des jours affichés (par jour et par collaborateur : heures, client, prestation, durée, prix, statut, total), pas la grille.
Un collaborateur sans la permission « 👁️ Voir le planning des autres » ne voit que ses propres rendez-vous.
Les collaborateurs inactifs ou partis n'ont plus de colonne.
N'existe pas :
- vue mois ou vue semaine calendaire (seulement 1 à 7 jours glissants) ;
- filtre pour n'afficher qu'un collaborateur ;
- recherche d'un rendez-vous dans le planning (passez par la fiche client : « Prochains RDV » et « Historique ») ;
- export du planning (CSV, iCal) ;
- synchronisation avec Google Agenda, Outlook ou iCal.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('planning_nouveau_rdv_1016','Nouveau rendez-vous : le formulaire complet',1245,$kb$Ouvrir : « + Nouveau RDV » dans le planning, ou toucher un créneau vide › « Nouveau RDV ».
Dans l'ordre :
1. Bandeau : collaborateur, jour et heure (« Modifiable ci-dessous »), puis date et « Heure ».
2. « 👤 Sélection du client » : « 🔍 Rechercher un client... », bouton « + » (créer un nouveau client sans perdre le rendez-vous), ou tuiles de passage anonyme « Homme / Femme / Enfant ».
3. « Sélection de la prestation » : familles (aux couleurs du planning) puis prestations ; plusieurs possibles. « Détail des phases (modifiable) » pour les forfaits.
4. Collaborateur (avatars).
5. « 👥 Ajouter un 2nd client (couple, amis, famille…) » : rendez-vous groupé.
6. Activité à domicile ou mixte : « 🚗 Lieu du rendez-vous » (« 🏠 En établissement » / « 🚗 À domicile », « Adresse du client... »).
7. « Annuler », « +1 » (valide et rouvre un formulaire même heure, même collaborateur), « Valider ».
Après validation : fenêtre « ✉ Confirmation de RDV » (e-mail, SMS, les deux, ou ne pas envoyer).
Pas de champ notes à la création : ajoutez un « Commentaire » ensuite dans la fiche du rendez-vous.
Conflit, pause, hors horaires : Luxyra prévient et propose de forcer quand c'est permis (jamais sur une absence ou un jour fermé).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('planning_absences_1016','Poser, modifier ou supprimer une absence, un congé, une pause',1250,$kb$Poser :
- Planning › bouton absence (icône calendrier), ou toucher un créneau vide › « Absence / Congé / Pause » ;
- ou Paramètres › « Équipe » › fiche du collaborateur › « + Congé / Absence / Pause ».
Formulaire « Congé / Absence / Pause » :
- « Collaborateur » ;
- « Type » : « Congé (jours) », « Absent (jours) », « Absent (heures) », « Pause » ;
- « Du » / « Au » (jours) ou « Date » / « De » / « À » (heures et pause) ;
- « Motif (facultatif) » ;
- « Ajouter ».
Si des rendez-vous existent déjà sur la période, Luxyra le signale. Le créneau disparaît de la réservation en ligne.
Supprimer : touchez le bloc de l'absence dans le planning › fenêtre « Gérer absence » › « Supprimer » ; ou Paramètres › « Équipe » › fiche › « Absences / Congés » › « X ».
Il n'y a pas de modification d'une absence : supprimez-la et recréez-la.
Pause de tous les jours (déjeuner) : Paramètres › « Équipe » › fiche › « ☕ Pause quotidienne ».
Fermer tout l'établissement : Paramètres › « Horaires » › « 🔒 Fermeture exceptionnelle ».
Absence longue ou départ : case « ⏸ Inactif » ou « Date de départ » dans « 📋 Informations RH ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('planning_nexiste_pas_1016','Planning : fonctions qui n''existent pas (et que faire à la place)',1255,$kb$- Rendez-vous récurrents (toutes les semaines, tous les mois) : n'existe pas. Utilisez « Reprendre RDV » dans la fiche du rendez-vous pour réserver tout de suite le suivant, ou « +1 » dans le formulaire.
- Statut « client arrivé » / « en cours » : n'existe pas. Statuts : prévu / confirmé, encaissé, annulé.
- Bouton « absent / no-show » sur un rendez-vous sans acompte : n'existe pas. Annulez le rendez-vous avec un motif. Avec acompte en ligne payé, l'annulation propose « Le client ne s'est pas présenté » (acompte conservé en tout ou partie) ; avec une empreinte, « 💸 Capturer (no-show) ».
- Liste d'attente consultable par l'établissement : n'existe pas. La liste d'attente est automatique côté clients (ils sont prévenus quand une place se libère).
- Rappel SMS manuel depuis un rendez-vous : n'existe pas. Rappels automatiques (Paramètres › « SMS et Marketing ») ou Marketing › « Message libre ».
- Couleur par rendez-vous : n'existe pas (couleur = famille de prestation).
- Synchronisation Google Agenda / Outlook / iCal, export du planning : n'existe pas.
- Vue mois, filtre par collaborateur, recherche dans le planning : n'existe pas.
- Déplacer par glisser-déposer un rendez-vous pris en ligne : impossible ; ouvrez sa fiche et changez la date ou l'heure avec le crayon (le client voit la modification).
- Déplacer un rendez-vous encaissé ou annulé : impossible.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('fiche_rdv_details_1016','Fiche rendez-vous : commentaire, phases, assignation, aperçu rapide',1260,$kb$Toucher un rendez-vous ouvre d'abord un aperçu rapide : « Fermer », « Modifier », « Encaisser », « Annuler » ; pour un rendez-vous pris en ligne, « 👥 Assigner à : » permet de choisir le collaborateur.
« Modifier » ouvre la fiche complète :
- Informations client, historique, fiches techniques, alerte santé éventuelle (bandeau rouge).
- « Détails du RDV » : pour chaque phase, le collaborateur, la durée, « ⏸ Pause / Libre pour autre client », flèches ↑ ↓, ⇄ « Remplacer cette prestation », × « Supprimer cette phase ».
- « Commentaire » : note libre sur le rendez-vous (enregistrée à la modification).
- Crayon : changer la date ou l'heure. « 🔄 Changer la prestation » : remplacer tout le contenu.
- « + Ajouter une prestation », « 💳 Encaisser un acompte », « Encaisser », « Reprendre RDV », « Annuler RDV ».
- Corbeille 🗑️ (sauf rendez-vous encaissé ou pris en ligne) : « Annuler le RDV (garder l'historique) » ou « Supprimer définitivement ».
Rendez-vous en attente de validation (pris en ligne) : bandeau avec « Accepter », « 🕒 Autre horaire », « Refuser ».
Pour un rendez-vous pris en ligne, vos changements (heure, collaborateur, prestations) sont visibles par le client dans son espace.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('clients_liste_creation_1016','Clients : liste, recherche, tri, créer un client',1265,$kb$Chemin : Accueil › « Clients ».
- Onglets : « Tous (n) », « Fidèles (n) », « À risque (n) », « Perdus (n) ».
- « 🔍 Rechercher... » : recherche sur le nom et le prénom (pas sur le téléphone ni l'e-mail).
- Tri : « A → Z » ou « Derniers ajouts ».
- « 🔍 Doublons » : détecte les fiches en double et propose « Fusionner » ou « Ignorer ».
Créer un client : bouton rond doré « + » en bas à droite › fenêtre « Nouveau client » :
- « Nom * », « Prénom * », « Type » (Femme / Homme / Enfant), « Date de naissance » ;
- « Téléphone — utile pour SMS rappels », « Email — utile pour facture & espace client » ;
- « Adresse », « Code postal », « Ville » ;
- « Notes » (allergies, préférences…) ;
- « Comment a connu le salon ? » (et « Nom du parrain » si recommandé par un client) ;
- « Consentements RGPD » : « 📱 Accepte les SMS », « ✉️ Accepte les emails » (décochés par défaut : cochez-les si le client est d'accord, sinon il ne recevra ni rappels SMS ni campagnes).
- « Ajouter le client ».
Si un e-mail est saisi et les e-mails acceptés, Luxyra propose d'envoyer l'invitation à l'espace client.
On peut aussi créer un client depuis la prise de rendez-vous (bouton « + ») ou depuis la caisse (« Nouveau client »).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('fiche_client_onglets_1016','Fiche client : les onglets et modifier les coordonnées',1270,$kb$Chemin : Accueil › « Clients » › touchez le client.
En-tête : « Visites 12 mois », « Dernière visite », « Prochain(s) RDV », badge de carte d'abonnement, alerte santé. Bouton « 📅 Créer un rendez-vous ».
Onglets : « 👤 Infos », un onglet par métier exercé (« 💇 Cheveux », « 🧴 Peau », « 💅 Ongles », « 🧘 Bien-être »), « 🩺 Santé », « 📷 Photos », « 📞 Historique », « ✏️ Fiche T », « 💳 Carte », « 🎟️ Packs », « 🏅 Fidélité », « ✉️ RGPD », « 📊 C.A. ».
Modifier les coordonnées : onglet « 👤 Infos ». Pas de bouton Enregistrer : chaque champ s'enregistre quand vous le quittez.
- « Informations personnelles » : « Nom », « Prénom », « Date de naissance », « Type de client », « Collaborateur habituel ».
- « Contact » : « Téléphone portable », « Téléphone fixe », « E-mail », « Acompte en ligne », « Adresse », « Code postal », « Ville ».
- « Notes » (texte libre).
- « 📊 Acquisition » : « Comment a connu le salon ? », « Nom du parrain ».
- « 👨‍👩‍👧 Famille » : « + Ajouter un membre de la famille ».
- Case « Client actif ».
Onglet « 🏅 Fidélité » : passages / cagnotte et « Modifier manuellement ».
Onglet « ✉️ RGPD » : consentements SMS / e-mails, invitation à l'espace client, « 📤 Exporter les données », « 🗑 Effacer les données du client ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('clients_supprimer_archiver_1016','Supprimer, archiver ou bloquer un client',1275,$kb$Supprimer un client : il n'y a pas de bouton « Supprimer » simple. La suppression passe par l'effacement RGPD, qui anonymise la fiche :
fiche client › onglet « ✉️ RGPD » › « 🗑 Effacer les données du client » › taper SUPPRIMER › « 🗑 Supprimer ». Ses informations personnelles disparaissent ; ses tickets de caisse restent (obligation fiscale) au nom de « Client anonymisé ». Connexion Internet nécessaire.
Fiches en double : ne les effacez pas, fusionnez-les (Clients › « 🔍 Doublons » › « Fusionner ») : rendez-vous, fidélité et notes sont regroupés.
Archiver un client : n'existe pas. La case « Client actif » (onglet « 👤 Infos ») ne le retire pas de la liste ; elle l'exclut seulement de la campagne de relance des clients inactifs.
Bloquer un client (liste noire) : n'existe pas pour un client précis. Possibilités :
- demander un acompte à ce client : onglet « 👤 Infos » › « Acompte en ligne » › « Toujours un acompte » ;
- bloquer toutes les nouvelles inscriptions en ligne : Paramètres › « Site en ligne » › « 🚫 Bloquer la création de nouveaux comptes » (pour tout l'établissement) ;
- empreinte bancaire pour tous : Paramètres › « Site en ligne » › « 💳 Acompte à la réservation » › « Empreinte ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('clients_import_export_1016','Importer ou exporter mes clients',1280,$kb$Importer un fichier (CSV, Excel) vous-même : n'existe pas dans l'application.
Reprise depuis un ancien logiciel : Paramètres › « Migration depuis ancien logiciel » › formulaire › « Envoyer ma demande ». L'équipe Luxyra fait la reprise gratuitement (fiches, fiches techniques, photos, historique…).
Exporter :
- Toutes vos données (dont tous les clients) : Paramètres › « Conformité caisse » › « Exporter données ». Fichier JSON complet (établissement, clients, prestations, produits, équipe, bons, tickets…). Les codes PIN ne sont jamais exportés.
- Un seul client (demande RGPD) : fiche client › onglet « ✉️ RGPD » › « 📤 Exporter les données ».
- Il n'existe pas d'export Excel / CSV de la seule liste des clients.
Permission nécessaire pour un collaborateur : « 📤 Exporter des données » (sinon le PIN administrateur est demandé).
Abonnement résilié : en mode archives, le bouton « 📁 Toutes mes données » reste disponible.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('clients_photos_espace_1016','Photos client et invitation à l''espace client',1285,$kb$Chemin : fiche client › onglet « 📷 Photos » (« 📸 Galerie photos »).
- Ajouter : « 📸 Prendre photo » (appareil photo) ou « 🖼️ Depuis galerie » (plusieurs photos à la fois).
- Choisir ensuite un libellé : « Avant », « Après », « Référence », et des libellés selon votre métier (ex. coiffure : Couleur, Coupe, Mèches, Brushing). La date est celle du jour.
- Taille maximale : 5 Mo par photo (sinon « Photo trop lourde (max 5 Mo) »). Les photos sont réduites automatiquement et stockées de façon privée. Pas de nombre maximum.
- Affichage « 📅 Par séance » ou « 🏷 Par catégorie ».
- Sur chaque photo : ⬇ « Télécharger en HD », ✕ supprimer. Par séance : « 📦 Télécharger ».
Le client voit-il ses photos ? Seulement si vous activez Paramètres › « Site en ligne » › « 📸 Permettre aux clients de voir leurs photos ». Dans ce cas, l'icône 🔒 / 👁 apparaît sur chaque photo pour la garder privée.
Les photos sont effacées avec l'effacement RGPD du client.

Inviter un client à son espace client en ligne
Chemin : fiche client › onglet « ✉️ RGPD » › carte « 🔑 Accès au compte client » (visible si un e-mail est renseigné).
- Compte pas encore activé : « 📧 Envoyer l'invitation ».
- Compte déjà activé : message « ✅ Ce client a activé son compte… luxyra.fr/compte » et bouton « Renvoyer un email d'invitation (réinit. mot de passe) ».
- Si le client n'a pas accepté les e-mails, une confirmation est demandée avant l'envoi.
À la création d'un client avec e-mail (et e-mails acceptés), Luxyra propose aussi « 📧 Envoyer l'invitation » ou « Plus tard ».
Dans son espace (luxyra.fr/compte ou l'application Luxyra), le client voit ses rendez-vous, ses tickets (duplicata), sa fidélité, ses bons cadeaux, et peut réserver.
Si le client ne voit pas ses rendez-vous : il doit confirmer son adresse e-mail (bouton « Renvoyer l'email » dans son espace).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('clients_packs_cartes_1016','Vendre un pack de séances ou une carte d''abonnement à un client',1295,$kb$Pack promo (séances payées d'avance) :
1. Fiche client › onglet « 🎟️ Packs » › « + Vendre un pack promo ».
2. « 🎟️ Nouveau pack promo » : « Nom du pack * », « Prestation liée » (« Aucune (libre) » ou une prestation), « Nombre de séances * » (2 minimum), « Prix total du pack (€) * », « Date d'expiration (optionnel) ».
3. « Vendre ce pack » : la caisse s'ouvre avec le pack ; encaissez.
4. À chaque visite : « ✅ Valider une séance » dans l'onglet Packs (ou la séance est décomptée en caisse). Barre « restants / total ». Packs finis : « ✅ Packs terminés ».
Carte d'abonnement (prix fixe, durée, remise sur les prestations) :
1. Créer le modèle : Paramètres › « Options commerciales » › « 💳 3. Cartes d'abonnement » › « + Créer une carte d'abonnement ».
2. Vendre : fiche client › onglet « 💳 Carte » › « 💳 Vendre une carte » (ou « 💳 Renouveler / Changer »).
3. L'onglet montre « Achetée le / Expire le », les remises, les économies et « Historique cartes ».
Pendant une carte active, la fidélité est en pause (« Fidélité en stand-by »).
Annuler le ticket de vente d'un pack ou d'une carte qui n'a pas servi les désactive.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('prestation_formulaire_1016','Créer ou modifier une prestation : tous les champs',1300,$kb$Chemin : Accueil › « Services et Forfaits » › onglet « Services » › « Nouvelle prestation » (ou « Modifier » sur une prestation).
Champs :
- « Nom » (obligatoire).
- « Prix (€) ».
- « Durée (min) » : 0 = supplément sans impact sur le planning.
- « Famille ».
- « Genre pour les stats » : « Auto (selon le client du ticket) », « 👨 Homme », « 👩 Femme », « 🧒 Enfant / Ado ».
- « ● Visible sur le site » et « ● Réservable en ligne » (cochées par défaut).
- « 📝 Prix sur devis » : pas de prix fixe ; le client fait une demande ; le prix est demandé à l'encaissement.
- « ↗️ Prix « à partir de » » : le prix saisi est un minimum ; le prix final se fixe en caisse. Les deux options s'excluent.
Puis « Créer » ou « Enregistrer ». Si vous changez le nom ou le prix et que des rendez-vous à venir utilisent la prestation, Luxyra propose de les mettre à jour.
Supprimer : bouton « Supprimer » (poubelle) › confirmation (« Cette action est définitive »).
Modifier plusieurs prix d'un coup : « ⇅ En masse ».
N'existent pas sur une prestation : taux de TVA propre (un seul taux pour les prestations, dans Paramètres › « Caisse et paiements »), description, photo, temps de pose (passez par un forfait), couleur propre (couleur = famille).
Limiter à certains collaborateurs : Paramètres › « Équipe » › « 🎯 Compétences ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('familles_prestations_1016','Familles de prestations : créer, ordonner, colorer, supprimer',1305,$kb$Chemin : Accueil › « Services et Forfaits ».
- Créer : « ＋ Famille » › « Nom de la famille » (ex. Lissage) › « Créer ». La famille est créée dans l'onglet ouvert (Services ou Forfaits).
- Ordonner : flèches « ◀ » « ▶ » pour les familles, « ▲ » « ▼ » pour les prestations. Cet ordre est aussi celui des tarifs sur votre page publique.
- Couleur au planning : choisir la famille › « Couleur planning : ».
- Supprimer : choisir la famille › « Supprimer ». Si elle contient des prestations, une double confirmation est demandée et ces prestations sont supprimées aussi. Impossible si l'une d'elles est utilisée dans un forfait : retirez-la d'abord du forfait.
- Renommer une famille : n'existe pas. Créez la nouvelle famille, déplacez-y les prestations (champ « Famille » de chaque prestation), puis supprimez l'ancienne.
Conseil pour plusieurs métiers : des familles claires (« Coiffure femme », « Pose gel », « Cils »…).
Sur votre page, une famille de 8 prestations ou plus affiche les 5 premières puis « Voir les autres prestations ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('produits_page_1016','Tuile Produits (page Boutique) : boutons et outils',1315,$kb$Chemin : Accueil › « Produits » (la page s'intitule « Boutique »).
En haut : filtres « Tous (n) », « 🛒 Revente (n) », « 🧪 Consommable (n) » ; boutons « 📥 Entrée stock », « 📤 Sortie stock », « 📋 Inventaire ».
Barre d'outils : « ➕ Ajouter », « 📈 Prix » (augmentations / diminutions multiples en € ou en %, par catégorie ou fournisseur), « 🎉 Promos » (promotions actives, programmées, expirées), « 📊 Mouvements », « 📜 Historique inv. », « 🏢 Fournisseurs », « 🗑️ Supprimer » (suppression en masse), « 📊 PAMP » (prix d'achat moyen pondéré).
Recherche « 🔍 Recherche ou scan... », bouton 📷 pour scanner un code-barres avec la caméra. En caisse, la recherche accepte aussi un lecteur de code-barres. Affichage grille ou liste, onglets de catégories, « + Cat. », 🎨 couleurs et icônes.
Alertes : « ⚠ n produit(s) en rupture », « ⚠ n produit(s) stock bas » avec « 📝 Liste de commande (n) » (tableau à copier : « 📋 Copier la liste »), « ⏳ Alertes péremption ».
Les produits de revente apparaissent en caisse ; les consommables se suivent en stock sans être vendus.
Permissions utiles : « 🧴 Produits », « ✏️ Modifier produits / prix », « 🔍 Voir les prix d'achat / marges ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('produit_formulaire_1016','Fiche produit : créer, prix, TVA, promo, péremption, boutique',1320,$kb$Créer : Produits › « ➕ Ajouter ». Champs : « 📷 Choisir une photo », « Nom * », « Contenance », « Prix vente TTC (€) », « Prix achat HT (€) », « Code-barre fournisseur », « Code-barre supplémentaire », « Fournisseur », « Catégorie », « Stock initial », « Alerte stock min », « ⏳ Péremption (facultatif) » (« Date expiration », « PAO (mois) », « Date ouverture »), « Type de produit » (« 🛒 Disponible à la vente (apparaît en caisse) » ou « 🧪 Consommable (utilisé en prestation) »), « Disponible en Click & Collect » › « ➕ Créer ».
Modifier : touchez le produit. Onglets :
- « ℹ️ Infos » : « 📷 Changer photo » / « Supprimer photo », mêmes champs (« Stock actuel »), bloc « 🌐 Boutique en ligne » avec la description affichée sur votre page.
- « 💰 Prix » : « Prix d'achat HT », « Coef. multiplicateur », « Prix de vente TTC », « Dont taux de TVA » (0 / 5,5 / 10 / 20 %), marge calculée. Caché sans la permission « Voir les prix d'achat / marges ».
- « 🎉 Promo » : « Activée », « Prix promo TTC », « Date de début », « Date de fin », « Libellé promo (facultatif) ».
- « 🕒 Historique ».
Boutons « 🗑 Supprimer » et « ✅ Enregistrer ».
Sur la boutique en ligne, la famille du produit est sa « Catégorie ».
N'existent pas : variantes (taille, couleur), champ marque, import ou export CSV / Excel du catalogue, bon de commande fournisseur.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('fournisseurs_stock_mouvements_1016','Fournisseurs, entrées / sorties de stock, inventaire',1325,$kb$Fournisseurs : Produits › « 🏢 Fournisseurs » › « ➕ Ajouter un fournisseur ». Champs : « Nom * », « Email », « Téléphone », « Représentant / Contact », « Délai livraison (jours) », « Notes ». Sur la liste : ✏️ modifier, ✖ supprimer, nombre de produits liés. Un produit est rattaché par le champ « Fournisseur » de sa fiche.
Entrée de stock (« 📥 Entrée stock ») : motifs « 📦 Réapprovisionnement », « ↩️ Retour client », « 📋 Ajustement inventaire (+) », « ℹ️ Autre », et « 💰 Prix achat HT/u : ».
Sortie de stock (« 📤 Sortie stock ») : « 🛒 Vente magasin », « 🏠 Utilisation au salon », « 💥 Casse », « ⚠️ Vol », « ⏳ Périmé », « 📋 Ajustement inventaire (-) », « ℹ️ Autre ».
Les ventes en caisse décrémentent le stock automatiquement ; une annulation de ticket remet les produits en stock.
Historique : « 📊 Mouvements » (filtres Entrées, Sorties, Ventes, Inventaires).
Inventaire : « 📋 Inventaire » pour recompter ; « 📜 Historique inv. » › « 📄 Export PDF » (valorisation au prix d'achat HT).
Commander : il n'y a pas de bon de commande envoyé au fournisseur ; utilisez « 📝 Liste de commande » (produits sous le minimum) › « 📋 Copier la liste ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('encaissement_modes_paiement_1016','Encaissement : modes de paiement, rendu monnaie, paiement en plusieurs moyens',1330,$kb$Écran « Mode de paiement » : tuiles « Espèces », « Carte Bancaire », « Chèque », « Bon cadeau », « Virement », « Paiement mixte ».
Retirer un mode : Paramètres › « Caisse et paiements » › « Modes de paiement actifs » (Bon cadeau et Paiement mixte restent toujours).
Rendu de monnaie (espèces) : champ « Donné par le client », Luxyra affiche « À rendre ». Le ticket imprime « Donné : » et « Rendu : ».
Payer avec plusieurs moyens (ex. une partie en espèces, le reste en carte) : « Paiement mixte » › fenêtre « 🔀 Diviser le paiement » › choisir le moyen, « Montant encaissé en … », « → Ajouter ce paiement », recommencer jusqu'au total. En espèces : « Montant donné par le client » et « À rendre au client ».
Acompte déjà versé (au salon ou en ligne) : déduit automatiquement (« Acompte déduit »).
Fidélité atteinte : Luxyra demande d'appliquer ou non la remise avant le premier règlement.
Si vous changez une remise ou une ligne après avoir saisi le règlement, le règlement est remis à zéro : refaites-le au nouveau montant.
Validation : « ✅ Encaisser et imprimer le ticket » (affiche le ticket avec « Imprimer », « Email », « Fermer »).
N'existent pas : pourboire, ticket restaurant, paiement en plusieurs fois (échéancier), terminal de paiement (TPE) relié à Luxyra. Le paiement carte se fait sur votre TPE, puis vous choisissez « Carte Bancaire ».
Erreur de mode après validation : Caisse › « Gestion des tickets » › « 💳 Modifier règlement ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('encaissement_boutons_ticket_1016','Encaissement : les boutons du ticket en cours',1335,$kb$Chemin : Accueil › « Encaissement » (ou « Encaisser » depuis un rendez-vous).
Sous le ticket en cours :
- « 👥 + Client » : encaisser plusieurs personnes sur le même passage (chacune garde sa fidélité).
- « 🏷 Remise ticket » : remise en % ou en € sur tout le ticket (permission « Appliquer une remise »). Remise sur une ligne : touchez la ligne.
- « 🎁 Bon cadeau » : vendre un bon cadeau (fenêtre « 🎁 Créer un bon cadeau »).
- « 🚗 Déplacement » : frais de déplacement (activité à domicile ou mixte).
- « Encaissement … € » : passer au paiement.
- « 📝 Devis » : transformer le panier en devis.
- « ⏸ Attente » : mettre le ticket de côté.
- « 📂 Reprendre un ticket » : récupérer un ticket en attente ou un devis.
- « ❌ Abandon » : abandonner le ticket (l'abandon est tracé).
Sur téléphone, les mêmes actions sont dans les options : « Remise sur le ticket », « Vendre un bon cadeau », « Ajouter un client », « Créer un devis », « Mettre en attente », « Devis / ticket en attente », « Abandon ticket ».
Catalogue : onglets Services, Forfaits, cartes, packs, produits et « ✍️ Libre » (article libre : intitulé, montant TTC, type prestation ou produit).
Un ticket validé est scellé : correction par avoir uniquement.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('bons_cadeaux_1016','Bons cadeaux : vendre, offrir, modifier, imprimer, utiliser',1340,$kb$Vendre : dans la caisse, « 🎁 Bon cadeau » › « 🎁 Créer un bon cadeau » : « Montant TTC » (montants proposés ou « Autre montant »), « Acheteur », « Bénéficiaire », « Message », « Validité » (6, 12, 18 ou 24 mois), « Utilisable sur » (Tout, Prestations, Produits), « Code du bon » (ou « Auto ») › « Créer le bon ». Le bon est ajouté au ticket et encaissé avec.
Offrir (gratuit : jeu concours, geste commercial) : tuile « Bons cadeaux » › « 🎁 Offrir un bon » (permission « Appliquer une remise ») : « Montant du bon », « Bénéficiaire / motif », « Code du bon », « Validité » (6 ou 12 mois), « Utilisable sur » › « 🎁 Créer le bon offert ». Non facturé, tracé en comptabilité.
Suivre : Accueil › « Bons cadeaux » : onglets « Tous », « Actifs », « Utilisés », « Expirés », totaux, « 📄 Export CSV », « 🔍 Rechercher un bon cadeau ». Sur un bon : « 🖨 Imprimer », « ✏ Modifier » (acheteur, bénéficiaire, message, expiration, utilisable sur), « ✖ Annuler ».
Utiliser : au paiement, tuile « Bon cadeau » ; le bon est débité à la validation du ticket. Le reste éventuel reste sur le bon.
Vente en ligne : Paramètres › « Site en ligne » › « 🎁 Bons cadeaux en ligne » (Stripe actif requis). La tuile affiche le lien de la page de vente avec « 📋 Copier » et « ↗ Ouvrir ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('avoir_remboursement_1016','Comment faire un avoir ou rembourser un client',1345,$kb$1. Accueil › « Caisse » › « 🎫 Gestion des tickets ».
2. Choisissez la période et trouvez le ticket.
3. « ❌ Avoir / Annuler » › « Motif (obligatoire) » › « Confirmer ».
Permission « ↩️ Rembourser » nécessaire (sinon le PIN administrateur est demandé).
Ce qui se passe : le ticket reste, marqué annulé, et un contre-ticket négatif du même montant est créé, sur les mêmes modes de paiement. Stock, fidélité, bons cadeaux et séances de forfait sont remis en place automatiquement.
Vous rendez ensuite l'argent au client par le moyen de votre choix (espèces, virement, ou annulation sur votre TPE).
Pour corriger une erreur : annulez, puis encaissez de nouveau correctement.
Limites :
- L'avoir annule tout le ticket : pas d'avoir partiel ni de remboursement d'un seul produit. Faites l'avoir puis réencaissez ce que le client garde.
- Pas d'avoir transformé en bon d'achat. Vous pouvez à la place offrir un bon (tuile « Bons cadeaux » › « 🎁 Offrir un bon »).
- Un contre-ticket ne peut pas être annulé ; un ticket déjà annulé non plus.
- Ticket d'acompte : « Annuler l'acompte » depuis le rendez-vous.
- Journée déjà clôturée : l'annulation apparaît à la date du jour où elle est faite.
Erreur sur le seul mode de paiement : « 💳 Modifier règlement » au lieu d'un avoir.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('facture_client_1016','Facture client nominative (A4) : n''existe pas',1350,$kb$Luxyra n'émet pas de facture client au format A4 avec nom ou raison sociale du client.
Ce qui existe :
- Le ticket de caisse (nom du client, détail HT / TVA / TTC, SIRET, n° de TVA), imprimable et envoyable par e-mail ou en PDF : Caisse › « 🎫 Gestion des tickets » › « ✉ Email » › « Télécharger le ticket en PDF ».
- Le devis au format « A4 / Imprimante standard », avec votre logo et « Bon pour accord » : il ne remplace pas une facture.
- Les factures de votre abonnement Luxyra (Paramètres › « Mes factures ») : elles concernent Luxyra, pas vos clients.
Si un client professionnel a besoin d'une facture à son nom, transmettez la demande au support pour connaître la solution adaptée.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('cloture_z_especes_1016','Clôture Z et gestion des espèces : comptage, coffre, réimpression',1355,$kb$Clôturer : Accueil › bouton « CLÔTURE DE LA JOURNÉE » (sous le CA du jour).
Fenêtre « Clôture quotidienne » :
- « Solde théorique en caisse » ;
- « Solde réel compté (espèces dans le tiroir) » ;
- « Écart » : s'il n'est pas nul, une justification est obligatoire (3 caractères minimum) ;
- « Valider la clôture ».
En mode caisse simplifiée, le comptage est facultatif.
Si des rendez-vous du jour ne sont pas encaissés, Luxyra vous prévient : après la clôture, ils ne pourront plus être encaissés à cette date.
Après validation : récapitulatif « CLOTURE Z #n » avec « 🖨 Imprimer », « ✉ Email » (ouvre votre messagerie) et « Fermer ».
Réimprimer une clôture : Caisse › « 📊 Journal / Bande Z » › historique des clôtures › « 🖨 Reimprimer » (mention DUPLICATA).
Rapport X (lecture intermédiaire sans clôturer) : n'existe pas. Le bandeau « CA DU JOUR » de l'accueil donne le chiffre en cours.
Rouvrir une journée clôturée : impossible (clôture définitive). Les corrections se font par des opérations tracées : avoir, ou « 🧾 Corriger le moyen de paiement (pièce tracée) ».
Ouverture : chaque jour, l'écran « Ouverture de caisse » affiche le fond de caisse › « Ouvrir la caisse » (sauf en caisse simplifiée).
Oubli de clôture : la journée est clôturée automatiquement dans la nuit.

Gestion de la caisse : espèces, coffre, remise en banque, entrées / sorties
Chemin : Accueil › « Caisse » › « 💰 Gestion de la caisse » (absent en mode caisse simplifiée).
Onglets :
- « Espèces » : « Fond », « Encaissé », « Au coffre », « Espèces en caisse » (le fond se modifie dans Paramètres › « Caisse et paiements »).
- « Coffre » : espèces et chèques mis au coffre, « Historique mises au coffre ».
- « Remise en banque » : « + Nouvelle remise » (transfert du coffre vers la banque ; le coffre est débité automatiquement), « Déjà remis en banque ».
- « Sorties/Entrées » : « ➖ Sortie » (ex. achat de fournitures payé en espèces) ou « ➕ Entrée » ; « Montant (€) * » et « Motif * » › « Valider ». Chaque mouvement génère une pièce de caisse numérotée (PC-…). Liste « Mouvements de caisse ».
Le fond de caisse est permanent (200 € par défaut) : il n'est pas recompté à l'ouverture.
À la clôture du soir, vous comptez le tiroir ; l'écart est enregistré.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('statistiques_detail_1016','Statistiques : indicateurs disponibles',1365,$kb$Chemin : Accueil › « Statistiques » (permission « 📊 Statistiques »).
Période : « Date de debut », « Date de fin », ou liste « Periode » (personnalisée, mois en cours, mois précédent, année en cours, année précédente, dernière semaine). Par défaut : du 1er du mois à aujourd'hui.
Blocs, tous en HT et TTC :
- « Panier moyen » (produits / prestations) et « Panier moyen par genre » (femmes / hommes / enfants) ;
- « Chiffre d'affaires » (produits / prestations) ;
- « CA par collaborateur » et « 📋 Détails par collaborateur » (tickets, panier, % du CA) ;
- « Quantités vendues » ;
- « Meilleurs clients » et « Nouveaux clients » ;
- « 📊 Acquisition clients » (comment ils vous ont connu) et « 🏆 Top parrains » ;
- « Affluence par jour » (moyenne de RDV et de CA par jour) ;
- « 📦 Statistiques Produits » : top produits, valeur du stock HT / TTC, marge potentielle, marges par catégorie, « ⚠ Stock dormant » ;
- « CA par prestation » ;
- « 📈 Évolution mensuelle » (6 derniers mois, indépendant de la période) ;
- « 📋 Taux de remplissage » (heures occupées sur heures disponibles).
Les premiers blocs ont trois vues : « evaluer », « comparer » (avec la période précédente) et « details ».
Pas d'export ni d'impression des statistiques. Pour des chiffres exportables : Caisse › « 📊 Journal / Bande Z » › « Documents comptables ».
Le CA du jour et le prévisionnel du mois sont sur l'accueil.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('avis_clients_1016','Avis clients : répondre, signaler, ce qu''on ne peut pas faire',1370,$kb$Chemin : Accueil › « Avis clients » (★). Pastille = avis sans réponse.
- Note moyenne et nombre d'avis publiés.
- Filtres : « Tous », « Sans réponse », « Signalés à Luxyra », « Masqués par Luxyra ».
- « 💬 Répondre publiquement » (puis « ✏ Modifier ma réponse ») : champ « Votre réponse (visible publiquement sur votre fiche) », 1500 caractères › « Publier ma réponse ». « Supprimer » retire votre réponse.
- « ⚠ Signaler à Luxyra » : « Motif du signalement » (insulte, personne jamais venue, hors-sujet, concurrent, propos discriminatoires, autre motif à préciser) › « Envoyer le signalement ». L'avis reste publié pendant la vérification (48 h) ; Luxyra décide de le masquer ou non. « Annuler le signalement » possible.
Vous ne pouvez pas supprimer ni masquer un avis vous-même.
Les clients sont invités automatiquement par e-mail à laisser un avis 2 jours après un rendez-vous honoré. Ils notent par critère et peuvent ajouter des photos.
Un collaborateur a besoin de la permission « Modérer les avis clients » pour voir la tuile.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('commandes_click_collect_1016','Commandes Click & Collect : préparer, remettre, encaisser, annuler',1375,$kb$Activer la boutique : Paramètres › « Site en ligne » › « 🛍 Boutique Click & Collect » ; chaque produit doit avoir « Disponible en Click & Collect ».
Suivre : Accueil › « Commandes » (🛍). Onglets « À traiter (N) », « Remises (N) », « Annulées (N) », et « ↻ Actualiser » (rafraîchissement automatique toutes les 90 secondes, message « 🛍 Nouvelle commande Click & Collect »).
Statuts : « À préparer », « Prête », « Remise », « Annulée ». Chaque commande indique « ✅ Payée en ligne » ou « 💶 À régler au salon ».
Étapes :
1. « 📦 Marquer prête » : le client est prévenu par e-mail.
2. « 🤝 Remettre au client » : « Code de retrait présenté par le client » (ou case « Pas de code : identité du client vérifiée »).
3. Commande payée : « Remettre (ticket de caisse « payé en ligne ») » crée le ticket. À régler au salon : « Encaisser puis remettre » ouvre la caisse ; la commande passe ensuite en « Remise ».
Annuler : bouton « Annuler » › motif (envoyé au client). Une commande payée est remboursée.
Si la boutique est désactivée, les commandes déjà passées restent à traiter ici.$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('multi_appareils_hors_ligne_1016','Plusieurs appareils, postes de caisse et coupure Internet',1390,$kb$Plusieurs appareils : connectez-vous avec le même compte (e-mail et mot de passe) sur la tablette, l'ordinateur et les téléphones. Chaque personne ouvre ensuite son profil avec son code PIN.
Chaque appareil qui encaisse reçoit automatiquement un numéro de poste (P01, P02…) imprimé sur le ticket ; la numérotation des tickets reste unique pour l'établissement.
« Se déconnecter » (Paramètres, tout en bas) ne déconnecte que cet appareil, et coupe ses notifications push.
Coupure Internet : tickets, rendez-vous et fiches clients saisis sont gardés sur l'appareil et renvoyés automatiquement (au retour de la connexion, au retour sur l'application, et toutes les 2 minutes). Message « ✓ N enregistrement(s) en attente transmis au serveur ».
Sans Internet, la caisse accepte le PIN d'un profil déjà connecté avec Internet sur cet appareil depuis moins de 30 jours.
Ce qui demande Internet : annuler un rendez-vous, effacer un client (RGPD), réimprimer un duplicata, clôturer si des tickets ne sont pas encore transmis.
Ne videz pas les données du navigateur et ne désinstallez pas l'application tant que des tickets sont en attente.
Actualiser l'écran : bouton « 🔄 » en haut de l'accueil (ou ↻ dans le planning).
Installer l'icône sur l'appareil : Paramètres › « Installer l'application ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('nexiste_pas_general_1016','Fonctions qui n''existent pas dans Luxyra (liste de référence)',1380,$kb$Réponses directes aux demandes fréquentes de fonctions absentes :
- Facture client A4 nominative : non (ticket, PDF du ticket, devis A4).
- Avoir partiel, avoir en bon d'achat, remboursement d'un seul article : non (avoir total puis réencaissement).
- Rapport X sans clôture, réouverture d'une journée clôturée : non.
- Pourboire, ticket restaurant, paiement en plusieurs fois, TPE relié à Luxyra : non.
- Envoi du ticket par SMS, QR code sur le ticket, logo sur le ticket : non.
- Pilote d'imprimante ticket (ESC/POS, 58/80 mm) pour le ticket : non (impression par le navigateur).
- Modifier les mentions légales du ticket, le nom ou le SIRET soi-même : non (support).
- TVA par prestation : non (un taux unique). TVA par produit : oui (fiche produit › « 💰 Prix »).
- Import CSV / Excel de clients ou de produits : non (migration faite par l'équipe).
- Export CSV de la liste clients, du stock ou des statistiques : non (export complet JSON, PDF d'inventaire, exports comptables).
- Archiver ou bloquer un client précis : non.
- SMS individuel depuis la fiche client : non (Marketing › « Message libre »).
- Modèles de messages enregistrés : non.
- RDV récurrents, statut « arrivé », vue mois, filtre par collaborateur, recherche dans le planning, synchronisation Google Agenda : non.
- Renommer une famille ou une catégorie produit : non.
- Variantes de produit, champ marque, bon de commande fournisseur : non.
- Mode clair / sombre de l'application : non (thèmes de couleurs dans Apparence).
- Désactiver totalement le PIN quand des comptes existent : non (« Jamais » = pas de verrouillage en journée).$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('faq_ou_regler_quoi_1016','Questions fréquentes : où régler quoi (réponses courtes)',1395,$kb$- Changer mon logo : Paramètres › « Infos établissement » › « 📷 Charger une image » › « ✅ Enregistrer les infos salon ».
- Mentions du ticket : note libre dans Paramètres › « Infos établissement » › « Note en bas des tickets » ; mentions légales non modifiables.
- Taux de TVA : Paramètres › « Caisse et paiements » › « Taux TVA » › « Valider ».
- L'écran se verrouille trop vite : Paramètres › « Équipe » › « 🔒 Verrouillage automatique » (5 min à « Jamais »).
- Ajouter un collaborateur : Paramètres › « Équipe » › « + Ajouter collaborateur », puis « ➕ Créer un compte de connexion ».
- Faire un avoir : Caisse › « 🎫 Gestion des tickets » › « ❌ Avoir / Annuler ».
- Corriger un mode de paiement : Caisse › « 🎫 Gestion des tickets » › « 💳 Modifier règlement ».
- SMS à tous les clients : Marketing › « Offre promo » ou « Message libre ».
- Mettre une prestation en ligne ou la cacher : Services et Forfaits › « Modifier » › « ● Visible sur le site » / « ● Réservable en ligne ».
- Couleurs du planning : Services et Forfaits › famille › « Couleur planning : ».
- Fermer un jour férié : Paramètres › « Horaires » › « 🔒 Fermeture exceptionnelle ».
- Pause déjeuner : Paramètres › « Équipe » › fiche › « ☕ Pause quotidienne ».
- Rappels SMS : Paramètres › « SMS et Marketing » › « 🔔 Rappels SMS actifs ».
- Acompte en ligne : Paramètres › « Site en ligne » › « 💳 Acompte à la réservation » (Stripe actif).
- Fond de caisse : Paramètres › « Caisse et paiements » › « Fond de caisse ».
- Export pour le comptable : Caisse › « 📊 Journal / Bande Z » › « Documents comptables ».
- Factures Luxyra : Paramètres › « Mes factures ».$kb$,true,now()) ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
