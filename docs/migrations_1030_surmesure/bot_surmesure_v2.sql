-- Luxyra — 2026-10-30 — Bot de support : RDV sur mesure v2 (proposition à 1, 2 ou 3 options).
-- À appliquer APRÈS la mise en service (surmesure_v2.sql + edge functions + worker + pages : voir le registre NF525,
-- intervention du 30/10/2026). Rejouable (chaque modification ne s'applique qu'une fois). Faits vérifiés dans le code.
-- Puis vérifier avec lx-bot-eval : « comment répondre à une demande sur mesure ? », « puis-je proposer plusieurs
-- créneaux à un client ? », « le client a payé deux options », « je veux modifier une proposition envoyée »,
-- « je ne peux pas activer l'acompte dans la proposition », « une prestation n'apparaît pas dans la liste de la proposition ».
BEGIN;

INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif)
SELECT 'rdv_sur_mesure_v2_1030', 'RDV sur mesure : répondre avec 1 à 3 options', 1300,
'Chemin : carte dorée de l''accueil « ✨ N demande(s) sur mesure à traiter » (ou cloche 🔔 › « Voir la demande → ») : la fenêtre « Répondre à la demande » s''ouvre.
- En haut : la demande du client, ses disponibilités, bouton « Appeler ».
- Onglets d''options : « Option A », « + Ajouter une option » (3 maximum), liens « Dupliquer » et « Supprimer ». Le client choisira UNE seule option ; les autres sont libérées automatiquement.
- Pour chaque option : « intitulé vu par le client », « Date », « Heure », « Collaborateur » (ou « Pas de préférence »), « Prestations et forfaits » (recherche, familles, bouton « Forfaits (N) ») : toutes les prestations ACTIVES sont proposées, même non réservables en ligne. Une prestation ou un forfait « Sur devis » n''est pas sélectionnable : fixer d''abord son prix dans « Services et Forfaits ».
- Durée (dont temps de pose), heure de fin et prix total sont calculés automatiquement. « Acompte à payer en ligne pour valider » : en « % » ou en « € » (1 € minimum, jamais plus que le prix). Le serveur recalcule et vérifie tous les montants depuis le catalogue.
- « Note pour le client (visible sur la proposition) ».
- Planning du jour à droite (sur téléphone : bande « Planning du … » avec « Agrandir ») : une colonne par collaborateur, rendez-vous existants, temps de pose hachurés (collaborateur libre pendant la pose), option surlignée en doré. En cas de chevauchement : onglet « conflit », message « Conflit : … a déjà un rendez-vous à … » et « Créneaux libres ce jour pour … » (un clic applique le créneau). Un clic dans une colonne place l''option à cette heure avec ce collaborateur.
- « Valable jusqu''au » : 24 h, 48 h, 72 h ou 7 jours. Bouton « Envoyer les N options au client ». Si un créneau est pris au moment de l''envoi, Luxyra propose d''envoyer quand même ; le créneau est revérifié quand le client choisit et juste avant son paiement.
- Le client reçoit un e-mail (ou un SMS court s''il n''a pas d''e-mail) et une notification dans son espace Luxyra. Sur sa page il compare les options : sans acompte, rendez-vous confirmé tout de suite ; avec acompte, paiement en ligne sur le compte Stripe de l''établissement (Paramètres › « Paiements en ligne ») puis confirmation. L''acompte payé est enregistré en caisse automatiquement (ticket « Acompte en ligne »), comme pour une réservation en ligne. Il peut aussi refuser avec un message.
- Sans paiements en ligne actifs, l''acompte en ligne est désactivé dans la fenêtre (le client confirme sans payer).
- Suivi : ouvrir la demande. États des options : « Proposée », « Choisie ✓ », « Libérée », « Créneau pris », « Remplacée » ; « vue par le client », « paiement en cours », option choisie et acompte payé. Boutons : « Copier le lien », « 🕒 Proposer un autre horaire » (la proposition actuelle ne peut plus être choisie ni payée ; la fenêtre se rouvre avec les mêmes options à ajuster), « Annuler la proposition ». Une proposition ENVOYÉE ne se modifie pas : il faut en refaire une.
- Relance automatique du client 24 h avant l''échéance s''il n''a rien choisi ; à l''échéance, la proposition expire. Notifications : « 👀 Proposition consultée », « ⏰ Demande sans réponse » (demande en attente depuis plus de 24 h), « ⌛ Proposition expirée », « ⚠️ Créneau pris : option B », « ⚠️ Double réservation possible » (le client a payé alors que le créneau venait d''être pris : vérifier le planning).
- Deux options payées (deux onglets) : le paiement en trop est remboursé automatiquement au client et la demande l''indique.
Guide : luxyra.fr/aide/rendez-vous-en-ligne#s8', true
WHERE NOT EXISTS (SELECT 1 FROM public.support_bot_kb WHERE cle = 'rdv_sur_mesure_v2_1030');

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- Proposition sur mesure dont le créneau a été pris avant que le client ne paie : ouvrir la demande › « 🕒 Proposer un autre horaire » (l''ancienne proposition n''est plus payable), puis envoyer la nouvelle proposition.',
  '- Proposition sur mesure dont le créneau d''une option a été pris : le client ne peut plus choisir cette option (rien n''est débité) et peut en choisir une autre ; notification « ⚠️ Créneau pris : option … ». Si aucune ne convient : ouvrir la demande › « 🕒 Proposer un autre horaire » (l''ancienne proposition n''est plus payable ; la fenêtre se rouvre avec les mêmes options à ajuster), puis envoyer.'),
  maj_le = now()
 WHERE cle = 'rdv_demande_modif_client' AND position('rouvre avec les mêmes options' in contenu) = 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '« Demande sur mesure », « Proposition refusée »,',
  '« Demande sur mesure », « Proposition refusée », « Proposition consultée », « Proposition expirée », « Demande sans réponse », « Double réservation possible »,'),
  maj_le = now()
 WHERE cle = 'cloche_notifications_1016' AND position('Proposition consultée' in contenu) = 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- « ✨ N demande(s) sur mesure ».',
  '- « ✨ N demande(s) sur mesure à traiter · N proposition(s) en attente du client » : ouvre la demande (ou la liste « ✨ Demandes sur mesure » s''il y en a plusieurs) ; voir la fiche « RDV sur mesure : répondre avec 1 à 3 options ».'),
  maj_le = now()
 WHERE cle = 'accueil_ca_bandeaux_1016' AND position('proposition(s) en attente du client' in contenu) = 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'Carte « ✨ RDV sur mesure » : « Activer les RDV sur mesure » ajoute le bouton « Demander un RDV sur mesure » sur votre page ; vous répondez par une proposition.',
  'Carte « ✨ RDV sur mesure » : « Activer les RDV sur mesure » ajoute le bouton « Demander un RDV sur mesure » sur votre page ; vous répondez par une proposition de 1 à 3 options (voir la fiche « RDV sur mesure : répondre avec 1 à 3 options »).'),
  maj_le = now()
 WHERE cle = 'site_reservation_reglages_1016' AND position('1 à 3 options' in contenu) = 0;

-- contrôle (attendu : 1 | true | true | true | true)
SELECT (SELECT count(*) FROM public.support_bot_kb WHERE cle = 'rdv_sur_mesure_v2_1030' AND actif) AS fiche,
       (SELECT position('rouvre avec les mêmes options' in contenu) > 0 FROM public.support_bot_kb WHERE cle = 'rdv_demande_modif_client') AS modif,
       (SELECT position('Proposition consultée' in contenu) > 0 FROM public.support_bot_kb WHERE cle = 'cloche_notifications_1016') AS cloche,
       (SELECT position('proposition(s) en attente du client' in contenu) > 0 FROM public.support_bot_kb WHERE cle = 'accueil_ca_bandeaux_1016') AS accueil,
       (SELECT position('1 à 3 options' in contenu) > 0 FROM public.support_bot_kb WHERE cle = 'site_reservation_reglages_1016') AS site;
COMMIT;
