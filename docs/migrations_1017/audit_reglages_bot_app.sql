-- =====================================================================================================
-- Luxyra — 2026-10-17 audit réglages (application pro) — base de connaissances du bot de support
-- Source : docs/audit_reglages_1017.md, corrections app.html + luxyra-supabase.js (?v=20261017-2).
-- Idempotent : INSERT … ON CONFLICT (cle) DO UPDATE ; mises à jour ciblées par replace() (sans effet au second passage).
-- Sans effet sur la caisse. À appliquer APRÈS la publication de l'application (app.html + luxyra-supabase.js?v=20261017-2).
-- NON APPLIQUÉ à la date de rédaction.
-- =====================================================================================================
BEGIN;

-- ---------------------------------------------------------------------------------------------------
-- 1. Nouvelle entrée : ce que font réellement les réglages corrigés le 17/10
-- ---------------------------------------------------------------------------------------------------
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('reglages_effets_app_1017','Réglages de l''application : ce qu''ils font vraiment (mise à jour du 17/10/2026)',1350,$kb$Rappels et confirmations (Paramètres › « SMS et Marketing ») :
- Nouveau compte : les rappels 24 h, 2 h et e-mail sont cochés ET enregistrés dès la première ouverture ; ce qui est affiché est ce qui part.
- « 🔔 Rappels SMS actifs » ne concerne que les SMS de rappel. Le rappel e-mail de la veille dépend seulement de « ✉️ Rappels Email actifs ».
- « Message email de rappel » et « Message email de confirmation » remplacent la phrase d'accueil de l'e-mail ; la date, l'heure, la prestation, le collaborateur et l'adresse restent dans l'encadré. Vide = texte standard.
- « 📲 Proposer la confirmation par SMS » / « ✉️ Proposer la confirmation par Email » : un canal décoché n'est plus proposé dans la fenêtre « ✉ Confirmation de RDV » qui s'ouvre après une prise de RDV ; les deux décochés = la fenêtre ne s'ouvre pas.
- « Client actif » décoché (fiche client) : plus aucune campagne, anniversaire ni relance. Les rappels et confirmations de RDV continuent.
Notifications push : « Désactiver » est retenu sur l'appareil (plus de réactivation automatique au redémarrage) ; l'état affiche « ⚪ Désactivé sur cet appareil ». « Activer » pour les remettre.
Empreinte bancaire : « Capture auto après (h) » à 0 est enregistré tel quel (0 = pas de capture automatique) ; le montant d'empreinte ne descend pas sous 5 €.
Acompte : passer le type de « Montant fixe » à « Pourcentage » ramène une valeur supérieure à 100 à 100 %.
Devis : « Afficher le détail HT / TVA / TTC sur les devis » décoché -> prix TTC avec « Prix TTC, TVA … % incluse ». La mention « TVA non applicable, art. 293 B du CGI » n'apparaît que si le taux est 0 % (franchise).
Taux de TVA : après « Valider », le taux des produits suit immédiatement (sans recharger), sauf taux produits distinct réglé pour l'établissement. Un duplicata de ticket reprend le taux, le HT et la TVA enregistrés dans le ticket.
Fiche produit : passer d'un onglet à l'autre ou changer la photo ne perd plus les saisies ; « Code-barre supplémentaire » reconnu par tous les scans (caisse, entrées, sorties, inventaire) ; « Disponible à la vente » décoché = impossible à ajouter au ticket, même scanné ; taux de TVA proposés 0 / 2,1 / 5,5 / 8,5 / 10 / 20 % (le taux affiché par défaut est celui des produits de l'établissement) ; une catégorie créée sans produit reste enregistrée ; l'icône d'une famille de produits est enregistrée.
Pack promo (séances payées d'avance) : il n'existe et n'est utilisable qu'une fois le ticket payé ; un ticket abandonné ne laisse pas de pack.
Infos établissement : « Infos enregistrées » ne s'affiche que si TOUT est enregistré (identité, logo / note du ticket / téléphone / e-mail, réseaux sociaux) ; sinon un message dit ce qui n'a pas été enregistré.
Comptes comptables (Conformité caisse) : une fois « 💾 Enregistrer les comptes » touché, ils sont utilisés par le FEC, EBP et Quadratus. Sans enregistrement, le FEC garde ses comptes standard (706, 707, 44571, 530, 512, 467). « Bons cadeaux » = compte des règlements par bon cadeau ou avoir (467 par défaut, à valider avec le comptable).
Équipe :
- « Date d'entrée » : avant cette date, aucun RDV ne peut être donné à la personne dans l'application, et ces jours ne comptent pas dans le taux de remplissage.
- « 🎯 Compétences » : une prestation non cochée est refusée pour ce collaborateur à la prise de RDV, au déplacement vers sa colonne, au changement de collaborateur et en caisse. « Forcer (administrateur) » permet l'exception avec le code PIN administrateur (noté au journal).
- Effacer la « Date de départ » propose de réactiver la personne si « Inactif » est encore coché.
- Changer le rôle d'un opérateur remplace ses permissions personnalisées par celles du rôle (la confirmation le dit).
- Changer le nom d'un collaborateur recalcule ses initiales.
- Pause quotidienne : refusée si l'heure de début n'est pas avant l'heure de fin.
Permissions : « ❌ Annuler un RDV » vaut aussi pour la corbeille (« Supprimer définitivement ») et l'annulation d'un RDV groupé ; « ↩️ Rembourser » vaut aussi pour l'annulation d'un acompte versé en salon et le remboursement d'un acompte payé en ligne ; « ✏️ Modifier produits / prix » pour créer un produit, enregistrer une fiche produit et les prix en masse. Sans la permission : code PIN administrateur.
Modes de paiement décochés (Paramètres › « Caisse et paiements ») : plus proposés pour la vente d'un bon cadeau, l'acompte en salon, « Modifier règlement » et la correction de règlement (sauf s'ils figurent déjà sur le ticket).
Fidélité : l'onglet « Fidélité » de la fiche client suit la mécanique (passages, cagnotte en €, CA cumulé en €) et l'unité (€ ou %) ; « Modifier manuellement » corrige ce compteur (noté au journal). Cagnotte à 0 % possible. Remise fidélité en montant fixe : jamais plus que le montant concerné.
Fiche client : « Collaborateur habituel » est présélectionné dans un nouveau RDV (« Aucun » possible) ; allergies des fiches techniques reprises dans l'alerte « ⚠️ Santé / précautions » ; « Acompte en ligne » : « Exempté d'acompte » (l'empreinte reste demandée si activée), « Toujours un acompte » (même sous le seuil, si l'établissement est en mode acompte).
Planning : la hauteur réglée avec le zoom « − / + » est enregistrée ; « Intervalle des créneaux » (Affichage planning) ne règle que la grille de l'application, pas les créneaux en ligne (Site en ligne › « Intervalles »).
Apparence : l'opacité du fond d'écran est enregistrée ; le « ✓ » du thème reste affiché après rechargement.
Verrouillage « Jamais » : aucun verrouillage tant que l'application reste ouverte, même après plusieurs heures. Application rouverte (ou page rechargée) après plus de 4 h sans activité : connexion de l'établissement puis code PIN redemandés.
E-mails : un logo chargé depuis l'appareil s'affiche désormais dans les e-mails (Gmail, Outlook).$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();

-- ---------------------------------------------------------------------------------------------------
-- 2. Entrées existantes devenues inexactes : remplacement ciblé de la phrase concernée
-- ---------------------------------------------------------------------------------------------------
UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '« Jamais » : pas de verrouillage en journée ; le PIN est quand même redemandé après 4 h sans activité.',
  '« Jamais » : aucun verrouillage tant que l''application reste ouverte, même après plusieurs heures. Si elle est rouverte (ou la page rechargée) après plus de 4 h sans activité, la connexion de l''établissement puis le PIN sont redemandés.'),
  maj_le = now()
 WHERE cle = 'pin_verrouillage_1016' AND position('le PIN est quand même redemandé après 4 h sans activité' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '(« Jamais » = pas de verrouillage en journée)',
  '(« Jamais » = pas de verrouillage tant que l''application reste ouverte)'),
  maj_le = now()
 WHERE cle = 'nexiste_pas_general_1016' AND position('(« Jamais » = pas de verrouillage en journée)' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'Dans le planning lui-même, le zoom « − / + » change aussi la hauteur des créneaux pour l''affichage en cours.',
  'Dans le planning lui-même, le zoom « − / + » change la hauteur des créneaux et l''enregistre (même réglage que « Hauteur créneau »). « Intervalle des créneaux » ne règle que la grille de l''application, pas les créneaux proposés en ligne (Site en ligne › « Intervalles »).'),
  maj_le = now()
 WHERE cle = 'param_affichage_apparence_1016' AND position('pour l''affichage en cours' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '« Par défaut (règle du salon) », « Sans acompte (exempté) » ou « Toujours un acompte ».',
  '« Par défaut (règle du salon) », « Exempté d''acompte » (l''empreinte bancaire reste demandée si elle est activée) ou « Toujours un acompte » (même sous le seuil, si l''établissement est en mode acompte).'),
  maj_le = now()
 WHERE cle = 'site_acompte_reglages_1016' AND position('« Sans acompte (exempté) »' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- « ✉️ Rappels Email automatiques » : « ✉️ Rappels Email actifs » et « Message email rappel » (illimité).',
  '- « ✉️ Rappels Email automatiques » : « ✉️ Rappels Email actifs » (indépendant de « Rappels SMS actifs ») et « Message email de rappel » (phrase d''accueil de l''e-mail ; vide = texte standard ; illimité).'),
  maj_le = now()
 WHERE cle = 'sms_parametres_1016' AND position('et « Message email rappel » (illimité)' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'puis « Envoi manuel depuis la fiche du RDV » : « 📲 Confirmation par SMS » et « ✉️ Confirmation par Email », avec leurs messages.',
  'puis « Fenêtre « Confirmation de RDV » proposée après une prise de RDV dans l''application » : « 📲 Proposer la confirmation par SMS » et « ✉️ Proposer la confirmation par Email » (un canal décoché n''est plus proposé ; les deux décochés = pas de fenêtre), avec leurs messages.'),
  maj_le = now()
 WHERE cle = 'sms_parametres_1016' AND position('« Envoi manuel depuis la fiche du RDV »' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '(« Message SMS de confirmation », « Message email de confirmation »).',
  '(« Message SMS de confirmation », « Message email de confirmation » : ce dernier remplace la phrase d''accueil de l''e-mail ; date, heure, prestation et collaborateur restent affichés ; vide = texte standard). Seuls les canaux cochés (« Proposer la confirmation par SMS / par Email ») sont proposés dans la fenêtre.'),
  maj_le = now()
 WHERE cle = 'sms_confirmation_rdv_1016' AND position('« Message email de confirmation »).' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- « Désactiver » : coupe les notifications sur cet appareil.',
  '- « Désactiver » : coupe les notifications sur cet appareil, et ce choix est retenu (plus de réactivation automatique au redémarrage ; état « ⚪ Désactivé sur cet appareil »).'),
  maj_le = now()
 WHERE cle = 'notifications_push_param_1016' AND position('- « Désactiver » : coupe les notifications sur cet appareil.' in contenu) > 0
   AND position('ce choix est retenu' in contenu) = 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'elle l''exclut seulement de la campagne de relance des clients inactifs.',
  'elle l''exclut de tous les messages marketing (campagnes, anniversaire, relance) ; les rappels et confirmations de RDV restent envoyés.'),
  maj_le = now()
 WHERE cle = 'clients_supprimer_archiver_1016' AND position('elle l''exclut seulement de la campagne de relance des clients inactifs.' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- « 📋 Informations RH » : « Date d''entrée », « Date de départ » (à partir de cette date : plus de rendez-vous, au planning comme en ligne).',
  '- « 📋 Informations RH » : « Date d''entrée » (avant cette date : aucun rendez-vous dans l''application, jours exclus du taux de remplissage), « Date de départ » (à partir de cette date : plus de rendez-vous, au planning comme en ligne).'),
  maj_le = now()
 WHERE cle = 'equipe_fiche_collab_1016' AND position('« Date d''entrée », « Date de départ » (à partir' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- « 🎯 Compétences » › « Configurer » : « ✅ Toutes les prestations » ou une sélection.',
  '- « 🎯 Compétences » › « Configurer » : « ✅ Toutes les prestations » ou une sélection. Une prestation non cochée est refusée pour ce collaborateur dans l''application (prise de RDV, déplacement, changement de collaborateur, caisse), sauf « Forcer (administrateur) » avec le PIN administrateur.'),
  maj_le = now()
 WHERE cle = 'equipe_fiche_collab_1016' AND position('« ✅ Toutes les prestations » ou une sélection.' in contenu) > 0
   AND position('Forcer (administrateur)' in contenu) = 0;

COMMIT;
