-- Luxyra — 2026-10-29 (-9, 6.8.7) — Bot : factures clients (lot 4b) — bon cadeau à usage unique, remise de ligne, numérotation F- / A-.
-- À appliquer APRÈS la mise en service de la 6.8.7 (registre NF525, intervention -9 : SQL factures_lot4b.sql PUIS pages 6.8.7).
-- Rejouable (chaque modification ne s'applique qu'une fois). Puis vérifier avec lx-bot-eval : « la facture affiche une remise alors que
-- le client a payé avec un bon cadeau », « il manque des numéros dans mes factures (F-000002 puis F-000004) », « je veux voir le prix
-- avant remise sur la facture », « facture refusée : ticket entièrement réglé par un bon cadeau ».
-- Révisé le 29/10/2026 (application et lx-bot-eval) : franchise 293 B (pas de « TVA déclarée à la vente du bon »), colonnes exactes,
-- phrases récapitulatives exactes (avec TVA / franchise), exemple A-000003.
BEGIN;
UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- La facture REPREND le ticket enregistré (lignes, prix unitaires HT, remise du ticket en ligne « Remise » négative par taux de TVA, TVA par taux, total au centime) : ce n''est pas une nouvelle vente, elle ne change ni le chiffre d''affaires ni la TVA.',
  '- La facture REPREND le ticket enregistré (TVA par taux, total au centime) : ce n''est pas une nouvelle vente, elle ne change ni le chiffre d''affaires ni la TVA. Depuis la version 6.8.7, colonnes du tableau de la facture, dans cet ordre : « Désignation », « Qté », « Prix unitaire HT » (prix AVANT remise), « Remise HT » (remise de la ligne), « TVA », « Total HT » et « Total TTC » (montants nets, après remise) ; une remise sur le TOTAL du ticket est une ligne « Remise » négative par taux de TVA.
- Ticket réglé en partie par un bon cadeau à usage UNIQUE (version 6.8.7) : la facture montre le prix complet, puis une ligne négative « Bon cadeau <code> (réglé lors de l''achat du bon, ticket n° …) » (code du bon, n° et date du ticket de vente du bon). Ce n''est NI une remise NI un simple moyen de paiement : c''est la part payée d''avance, lors de l''achat du bon. Établissement qui facture la TVA : la TVA de cette part était due à la vente du bon ; la TVA de la facture est seulement celle de ce qui a été payé ce jour-là (comme le ticket) ; phrase récapitulative : « Prix total de l''opération : … € TTC, dont … € réglés lors de l''achat du bon cadeau (…) : TVA acquittée à la vente du bon (CGI art. 256 ter), non facturée de nouveau ici. Montant de la présente facture : … € TTC. » Établissement en franchise de TVA (art. 293 B du CGI) : aucune TVA, ni à la vente du bon ni sur la facture ; phrase récapitulative : « Prix total de l''opération : … €, dont … € : montant déjà encaissé lors de l''achat du bon cadeau (…), non facturé de nouveau ici. Montant de la présente facture : … €. » Ticket ENTIÈREMENT réglé par un bon à usage unique : facture refusée (« LX_FACTURE_BON_UNIQUE ») ; si le client veut une facture, la faire sur le ticket de VENTE du bon. Bon à usage multiple utilisé en règlement : moyen de paiement, facture ordinaire. Une facture émise AVANT la 6.8.7 garde son ancienne présentation (« Remise ») : elle ne se modifie jamais.'),
  maj_le = now()
 WHERE cle = 'facture_client_1016' AND position('réglé lors de l''achat du bon' in contenu) = 0;
UPDATE public.support_bot_kb SET contenu = replace(contenu,
  '- Numéro continu par établissement (F-000001, F-000002… ; avoir : A-…, même série), donné par le serveur : connexion nécessaire.',
  '- Numéro continu par établissement, donné par le serveur (connexion nécessaire) : factures (F-) et factures d''avoir (A-) partagent UNE SEULE suite de numéros (ex. F-000001, F-000002, A-000003, F-000004). Un numéro qui « manque » dans les F- est un A- (ex. F-000002 puis F-000004 : le n° 000003 est la facture d''avoir A-000003), et inversement : ce n''est pas un trou. La loi demande un numéro unique dans une suite chronologique et continue ; la mention est imprimée sur chaque facture et la suite complète se lit dans la colonne « N° d''ordre » du « Registre des factures clients (CSV) » (même chemin que le registre du mois, ci-dessous). Aucune facture n''est jamais renumérotée.'),
  maj_le = now()
 WHERE cle = 'facture_client_1016' AND position('UNE SEULE suite de numéros' in contenu) = 0;
-- contrôle (attendu : true, true)
SELECT position('réglé lors de l''achat du bon' in contenu) > 0 AS bon_unique, position('UNE SEULE suite de numéros' in contenu) > 0 AS numerotation
  FROM public.support_bot_kb WHERE cle = 'facture_client_1016';
COMMIT;
