-- =====================================================================================================
-- Luxyra — 2026-10-17 retour partiel — base de connaissances du bot de support (règle permanente du 11/10/2026)
-- Idempotent : INSERT … ON CONFLICT (cle) DO UPDATE ; mises à jour par replace() (sans effet au second passage).
-- Sans effet sur la caisse. À appliquer APRÈS la publication de l'application (app.html + luxyra-supabase.js?v=20261017-1).
-- NON APPLIQUÉ à la date de rédaction.
-- =====================================================================================================
BEGIN;

INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('retour_partiel_1017','Retour / remboursement partiel d''un ticket (un produit rendu, une partie d''une prestation)',1346,$kb$Pour rembourser UNE PARTIE d'un ticket déjà encaissé (un produit rendu, une prestation remboursée en partie, un geste commercial en argent) :
1. Accueil › « Caisse » › « 🎫 Gestion des tickets ».
2. Choisissez la période (dates de début et de fin) et trouvez le ticket.
3. Sur le ticket : « ↩️ Retour / remboursement partiel ». Le bouton est aussi dans « 💳 Modifier règlement » quand la journée est clôturée ou que le règlement est mixte.
4. Pour chaque ligne : produit, « Quantité rendue » (le montant se calcule tout seul, modifiable à la baisse) ; prestation, « Montant remboursé ». Chaque ligne affiche ce qui a été payé, ce qui a déjà été remboursé et le reste.
5. « Remettre en stock » est coché pour les produits rendus : décochez si le produit rendu n'est pas revendable.
6. « Moyen de remboursement » : Espèces, Carte bancaire, Chèque ou Virement (le mode du ticket d'origine est proposé).
7. « Motif » (obligatoire, 5 caractères minimum), vérifiez le récapitulatif (total TTC, HT et TVA par taux), puis « Valider le remboursement ».
8. Imprimez ou envoyez par e-mail le ticket de retour, puis rendez l'argent au client (espèces du tiroir, annulation sur votre TPE, virement…).
Permission « ↩️ Rembourser » nécessaire (sinon le PIN administrateur est demandé). Connexion Internet obligatoire : l'application vérifie sur le serveur les retours déjà faits sur tous vos appareils.
Ce qui se passe :
- Un NOUVEAU ticket « RETOUR / REMBOURSEMENT » est créé, numéroté à la suite des autres, avec des montants négatifs et la mention « Ticket d'origine n° … du JJ/MM/AAAA » et le motif. Il est scellé et signé comme tous les tickets.
- Le ticket d'origine n'est jamais modifié : il affiche seulement « Retour partiel n°… le … ».
- La clôture Z du jour du retour en tient compte : chiffre d'affaires, TVA et mode de remboursement (un remboursement en espèces sort du tiroir). Le retour apparaît dans la bande Z (rubrique « Retours / remboursements partiels »), la bande mensuelle, les exports comptables (FEC, journal, livre des recettes, export « Annulations & remboursements ») et la fiche du client.
- Fidélité : la cagnotte créditée et le chiffre cumulé du client sont retirés au prorata du montant remboursé ; les points « par visite » restent (la visite a eu lieu).
- Stock : les produits rendus sont remis en stock (mouvement « retour » dans l'historique du produit).
Plusieurs retours sont possibles sur un même ticket, jusqu'au montant payé.
Impossible (message à l'écran) :
- Rembourser plus que le payé (retours précédents compris) ou plus de pièces que vendues.
- Ticket annulé (avoir), contre-ticket, ticket de retour, ticket d'acompte ou d'annulation d'acompte, acompte conservé : pour un acompte, « Annuler l'acompte » depuis le rendez-vous.
- Ticket enregistré en mode test alors que la caisse est en réel (ou l'inverse).
- Bon cadeau, carte d'abonnement ou forfait vendus : ces lignes ne se remboursent pas en partie ; utilisez « ❌ Avoir / Annuler », avant tout retour partiel sur ce ticket.
- Rembourser la totalité d'un ticket : utilisez « ❌ Avoir / Annuler » (il remet aussi bons cadeaux, séances et fidélité).
- Hors connexion.
Après un retour partiel, l'avoir total et la modification du ticket d'origine ne sont plus possibles : un nouveau retour partiel rembourse le reste. La correction du moyen de paiement du ticket d'origine (« 💳 Modifier règlement ») reste possible.
Avoir : Luxyra vérifie auprès du serveur qu'aucun retour partiel n'a été fait sur un autre appareil ; connexion trop lente -> message « Vérification impossible… Réessayez » (rien n'est enregistré).
Le remboursement ne se fait pas en bon cadeau ni en avoir à valoir : remboursez en argent, ou offrez un bon (tuile « Bons cadeaux » › « 🎁 Offrir un bon ») si c'est un geste commercial.
Ticket de retour faux : il ne s'annule pas (opération définitive) ; contactez le support.$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();

-- Entrées existantes devenues inexactes (« pas d'avoir partiel ») : remplacement ciblé de la phrase concernée.
UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- L''avoir annule tout le ticket : pas d''avoir partiel ni de remboursement d''un seul produit. Faites l''avoir puis réencaissez ce que le client garde.',
  '- L''avoir annule tout le ticket. Pour rembourser une partie seulement (un produit rendu, une partie d''une prestation) : « ↩️ Retour / remboursement partiel » sur le ticket.'),
  maj_le = now()
 WHERE cle = 'avoir_remboursement_1016' AND position('pas d''avoir partiel' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- Avoir partiel, avoir en bon d''achat, remboursement d''un seul article : non (avoir total puis réencaissement).',
  '- Avoir en bon d''achat : non (remboursement en argent, ou bon offert). Remboursement d''une partie d''un ticket : oui, « ↩️ Retour / remboursement partiel » dans Caisse › « 🎫 Gestion des tickets ».'),
  maj_le = now()
 WHERE cle = 'nexiste_pas_general_1016' AND position('Avoir partiel, avoir en bon d''achat' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'Un ticket validé est scellé : correction par avoir uniquement.',
  'Un ticket validé est scellé : correction par avoir (annulation totale) ou par retour / remboursement partiel (Caisse › « 🎫 Gestion des tickets »).'),
  maj_le = now()
 WHERE cle = 'encaissement_boutons_ticket_1016' AND position('correction par avoir uniquement' in contenu) > 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'Une erreur se corrige par un avoir (Caisse › « Gestion des tickets » › « ❌ Avoir / Annuler »)',
  'Une erreur se corrige par un avoir (Caisse › « Gestion des tickets » › « ❌ Avoir / Annuler »), un remboursement partiel par « ↩️ Retour / remboursement partiel »'),
  maj_le = now()
 WHERE cle = 'ticket_personnaliser_1016' AND position('remboursement partiel par' in contenu) = 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '« 💳 Modifier règlement », « ❌ Avoir / Annuler ».',
  '« 💳 Modifier règlement », « ❌ Avoir / Annuler », « ↩️ Retour / remboursement partiel ».'),
  maj_le = now()
 WHERE cle = 'menu_caisse_attente_1016' AND position('Retour / remboursement partiel' in contenu) = 0;

UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- Faire un avoir : Caisse › « 🎫 Gestion des tickets » › « ❌ Avoir / Annuler ».',
  '- Faire un avoir : Caisse › « 🎫 Gestion des tickets » › « ❌ Avoir / Annuler ».
- Rembourser une partie d''un ticket (produit rendu…) : Caisse › « 🎫 Gestion des tickets » › « ↩️ Retour / remboursement partiel ».'),
  maj_le = now()
 WHERE cle = 'faq_ou_regler_quoi_1016' AND position('Retour / remboursement partiel' in contenu) = 0;

-- 2026-10-17 retour partiel (audit) : renvoi vers la section du guide (ancre #s10 de aide/tickets-et-annulations.html)
UPDATE public.support_bot_kb SET contenu = replace(contenu,
  'tickets et annulations /aide/tickets-et-annulations (#s3 ce que l''annulation remet en place)',
  'tickets et annulations /aide/tickets-et-annulations (#s3 ce que l''annulation remet en place, #s10 retour / remboursement partiel)'),
  maj_le = now()
 WHERE cle = 'guides_aide' AND position('#s10 retour / remboursement partiel' in contenu) = 0;

COMMIT;

-- Contrôle (lecture seule) : plus aucune entrée active n'affirme qu'il n'y a pas de remboursement partiel d'un ticket
-- select cle from public.support_bot_kb where actif and (contenu ilike '%pas d''avoir partiel%' or contenu ilike '%Avoir partiel, avoir en bon%' or contenu ilike '%correction par avoir uniquement%');
-- Puis relancer le banc d'évaluation du bot (lx-bot-eval) avec : « comment rembourser un seul produit ? », « le client rend un shampoing ».
