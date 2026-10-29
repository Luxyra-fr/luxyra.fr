-- Luxyra — 2026-10-29 au soir — Bot : évènements Stripe charge.refunded et payout.paid ACTIFS (webhook « comptes connectés »).
-- Fait : le 29/10/2026 vers 21 h 20 (Paris), le propriétaire a ajouté payout.paid et charge.refunded à la destination
-- we_1UOh66Pk42Psx94T72zzMLeL (https://luxyra.fr/api/stripe/webhook-connect). Textes alignés sur le code (lecture seule) :
-- worker docs/luxyra-router-worker.js handleWebhookConnect -> lxRemboursementsExternes / lxStripeVersementEnregistrer ;
-- public.lx_recette_remboursement_externe (md5 d9fd20257b8fb3a5b5c9fd2539eda4d3 au 29/10/2026) ; lx_prive.recette_traiter (remb_externe).
-- Nuances exactes du code reprises :
--  * remboursement Stripe -> ticket négatif (lignes du ticket d'origine inversées, au prorata si partiel, plafonné au ticket d'origine) ;
--    un remboursement déjà connu (fait par Luxyra) est ignoré ; paiement sans ticket serveur -> aucun ticket, alerte critique.
--  * bon cadeau en ligne : ticket négatif ; bon annulé (voided, restant 0) SEULEMENT si le total remboursé atteint le prix du bon ET
--    utilise = 0 ; sinon (partiel, ou bon déjà utilisé) le bon reste valable avec son solde.
--  * carte d'abonnement : désactivée (cancelled) si remboursée en totalité.
--  * Click & Collect : ticket négatif (clé partagée avec l'annulation) ; le statut de la commande n'est pas modifié.
--  * acompte (modèle « ticket ») : entrée d'historique « externe » sur le RDV -> ticket négatif, plafonné au reste non remboursé ;
--    ancien modèle (acompte encore en avance, sans ticket) : noté sur le RDV, sans ticket.
--  * versements : seulement à réception de payout.paid (aucune reprise des versements antérieurs), relus chez Stripe.
-- Complément : la fiche protections_lot4_1028 disait encore « annotations PRÉVUES, PAS ENCORE FAITES » alors qu'elles ont été
-- appliquées le 29/10/2026 vers 21 h 10 (registre, -8 étape 3) : phrase corrigée dans le même fichier.
-- Révisé après lx-bot-eval (blocs 5 à 7, puis 8 à 10).
-- Rejouable : chaque remplacement ne s'applique qu'une fois (garde sur le nouveau texte). Contrôle final : attendu true partout.
BEGIN;

-- 1) bons_cadeaux_en_ligne_1028
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o1$Remboursement d'un bon acheté en ligne : la page de vente et le bon indiquent « Non remboursable ». Luxyra n'a AUCUN bouton pour rembourser sur la carte du client un bon acheté en ligne, et un remboursement fait directement dans le tableau de bord Stripe n'est PAS encore enregistré automatiquement dans la caisse (la caisse et l'argent ne correspondraient plus). Donc : ne jamais conseiller de rembourser sur Stripe, ni de faire un avoir ou d'annuler le ticket de vente. Client qui demande le remboursement d'un bon acheté en ligne, ou bon déjà remboursé sur Stripe : transmettre à un humain <ESCALATE/>.$o1$,
$n1$Remboursement d'un bon acheté en ligne : la page de vente et le bon indiquent « Non remboursable ». Luxyra n'a AUCUN bouton pour rembourser sur la carte du client un bon acheté en ligne. Depuis le 29/10/2026 (soir), un remboursement fait directement dans le tableau de bord Stripe de l'établissement EST enregistré automatiquement dans la caisse, peu après : ticket négatif créé par le serveur (ligne « Remboursement : Bon cadeau BC-… (vente en ligne) », commentaire « remboursement fait sur Stripe »), pour le montant remboursé, qui renvoie au ticket de vente du bon ; jamais plus que le ticket de vente. Le bon lui-même n'est annulé automatiquement (annulé, solde 0) QUE si les remboursements atteignent TOUT son prix ET qu'il n'a JAMAIS été utilisé. Remboursement partiel, ou bon déjà utilisé (même en partie) : le ticket négatif est créé, mais le bon N'EST NI annulé NI réduit (il reste utilisable avec son solde). Donc : ne jamais faire d'avoir ni annuler le ticket de vente en plus (ce serait compté deux fois) ; ne pas conseiller de rembourser un bon (non remboursable). Client qui demande le remboursement d'un bon acheté en ligne, remboursement partiel, bon déjà utilisé, ou bon remboursé sur Stripe resté valable : transmettre à un humain <ESCALATE/>.$n1$),
  maj_le = now()
 WHERE cle = 'bons_cadeaux_en_ligne_1028' AND position('EST enregistré automatiquement dans la caisse, peu après' in contenu) = 0;

-- 2) recettes_en_ligne_1028
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o2$Remboursement fait directement dans le tableau de bord Stripe (hors Luxyra) : il n'est PAS encore enregistré automatiquement dans la caisse ; conseiller de faire les remboursements depuis Luxyra (sauf bon cadeau acheté en ligne : <ESCALATE/>) ; si un remboursement a déjà été fait sur Stripe, ne rien saisir soi-même et transmettre à un humain <ESCALATE/>.$o2$,
$n2$Remboursement fait directement dans le tableau de bord Stripe (hors Luxyra) : depuis le 29/10/2026 (soir), il est enregistré automatiquement dans la caisse, peu après (Stripe prévient Luxyra, le remboursement est relu chez Stripe) : ticket négatif « Remboursement : … » qui renvoie au ticket du paiement (au prorata des lignes si le remboursement est partiel), jamais plus que le montant encaissé ; un remboursement fait depuis Luxyra n'est jamais compté une 2e fois. Selon le paiement : commande Click & Collect = ticket négatif, mais la commande n'est PAS annulée ni modifiée dans la tuile « Commandes » ; acompte en ligne = ticket négatif « Remboursement acompte en ligne … (remboursement fait sur Stripe) », limité à ce qui reste à rembourser ; acompte conservé / empreinte encaissée = ticket négatif ; carte d'abonnement = ticket négatif, et carte désactivée si remboursée en totalité ; bon cadeau acheté en ligne : voir l'entrée « Bons cadeaux vendus en ligne » (le bon n'est annulé que dans un cas précis). Ancien acompte encore en avance (sans ticket d'acompte) : le remboursement est noté sur le rendez-vous, sans ticket (cet acompte n'était pas en caisse). Ne rien saisir soi-même en caisse (pas d'avoir en plus : ce serait compté deux fois). Le rendez-vous ou la commande ne sont pas annulés par un remboursement fait sur Stripe : rembourser de préférence depuis Luxyra (acompte, annulation de commande). Remboursement d'un paiement qui n'a pas de ticket en caisse (paiement d'avant le 28/10/2026, paiement inconnu) : AUCUN ticket créé, l'éditeur est alerté : <ESCALATE/>. Ticket négatif toujours absent le lendemain, ou commande / bon resté actif après un remboursement Stripe : <ESCALATE/>.$n2$),
  maj_le = now()
 WHERE cle = 'recettes_en_ligne_1028' AND position('depuis le 29/10/2026 (soir), il est enregistré automatiquement dans la caisse' in contenu) = 0;

-- 3) protections_lot4_1028 : versements Stripe
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o3$- Paiements en ligne (Stripe), relevé des versements : PAS ENCORE ACTIF (au 29/10/2026, la réception des versements Stripe n'est pas encore activée par l'éditeur ; les remboursements faits dans le tableau de bord Stripe ne sont pas non plus enregistrés automatiquement). Une fois activé : chaque versement reçu sur le compte bancaire sera relevé automatiquement ; le FEC, EBP et Quadratus passeront l'écriture (banque = montant viré, frais Stripe en 627800, compte des paiements en ligne 580100 soldé) et le « Bordereau acomptes en ligne » listera les versements avec les frais réels. En attendant, aucun versement n'apparaît : ne pas dire qu'il est relevé ; les frais Stripe se passent avec le comptable à partir des relevés Stripe ; question sur un versement précis : <ESCALATE/>.$o3$,
$n3$- Paiements en ligne (Stripe), relevé des versements : ACTIF depuis le 29/10/2026 au soir. Chaque versement Stripe ARRIVÉ sur le compte bancaire de l'établissement (versement « payé ») est relevé automatiquement auprès de Stripe, au nom du compte Stripe de l'établissement (montant viré, paiements moins remboursements, frais Stripe, autres opérations comme les litiges) et enregistré pour le rapprochement : le FEC, EBP et Quadratus passent l'écriture (banque = montant viré, frais Stripe en 627800, compte des paiements en ligne 580100 soldé ; comptes réglables dans Conformité caisse : « Banque (versements Stripe) », « Frais Stripe (commissions) ») et le « Bordereau acomptes en ligne » liste les versements avec les frais réels. Seuls les versements arrivés à partir du 29/10/2026 au soir sont relevés : les versements antérieurs ne sont pas repris (leurs frais se passent avec le comptable à partir des relevés Stripe). Un compte Stripe dont l'inscription n'est pas terminée ne reçoit pas de versement. Les remboursements faits dans le tableau de bord Stripe sont, eux aussi, enregistrés automatiquement en caisse (voir l'entrée « Paiements en ligne : enregistrés automatiquement dans la caisse »). Versement absent ou montant qui ne correspond pas à la banque : <ESCALATE/>.$n3$),
  maj_le = now()
 WHERE cle = 'protections_lot4_1028' AND position('relevé des versements : ACTIF depuis le 29/10/2026' in contenu) = 0;

-- 4) protections_lot4_1028 : annotations des Z historiques (appliquées le 29/10/2026 vers 21 h 10)
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o4$Correction par annotation signée PRÉVUE, PAS ENCORE FAITE (en attente de l'accord du propriétaire) : ne pas dire qu'elle est faite ; si l'établissement pose la question : <ESCALATE/>.$o4$,
$n4$Correction faite le 29/10/2026 par des annotations signées (nombre de tickets corrigé ; montants inchangés ; la Z elle-même n'est jamais modifiée) ; si l'établissement pose la question : <ESCALATE/>.$n4$),
  maj_le = now()
 WHERE cle = 'protections_lot4_1028' AND position('Correction faite le 29/10/2026 par des annotations signées' in contenu) = 0;

-- 5) à 7) Révision après lx-bot-eval (29/10/2026) : versement ≠ ticket ; libellé exact du ticket négatif d'un acompte ; bon resté
--    valable = transmettre (ne pas l'annuler / le modifier soi-même).
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o5$et le « Bordereau acomptes en ligne » liste les versements avec les frais réels. Seuls les versements arrivés$o5$,
$n5$et le « Bordereau acomptes en ligne » liste les versements avec les frais réels. Un versement n'est PAS une vente : il ne crée AUCUN ticket, n'apparaît PAS dans la clôture Z (ni dans « Payés en ligne ») et ne change pas le chiffre d'affaires ; il sert seulement au rapprochement bancaire dans les exports comptables. Seuls les versements arrivés$n5$),
  maj_le = now()
 WHERE cle = 'protections_lot4_1028' AND position('Un versement n''est PAS une vente' in contenu) = 0;
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o6$acompte en ligne = ticket négatif « Remboursement acompte en ligne … (remboursement fait sur Stripe) », limité à ce qui reste à rembourser ;$o6$,
$n6$acompte en ligne = ticket négatif intitulé « Remboursement acompte en ligne (ticket #…) - … (RDV du …, remboursé le …, remboursement fait sur Stripe) » (et non « Remboursement : … »), limité à ce qui reste à rembourser, le rendez-vous n'étant PAS annulé ;$n6$),
  maj_le = now()
 WHERE cle = 'recettes_en_ligne_1028' AND position('(et non « Remboursement : … »)' in contenu) = 0;
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o7$Client qui demande le remboursement d'un bon acheté en ligne, remboursement partiel, bon déjà utilisé, ou bon remboursé sur Stripe resté valable : transmettre à un humain <ESCALATE/>.$o7$,
$n7$Bon resté valable après un remboursement Stripe (partiel, ou bon déjà utilisé) : ne PAS conseiller de l'annuler, de le modifier ni de faire quoi que ce soit en caisse ; la réponse entière est <ESCALATE/>. Client qui demande le remboursement d'un bon acheté en ligne : transmettre à un humain <ESCALATE/>.$n7$),
  maj_le = now()
 WHERE cle = 'bons_cadeaux_en_ligne_1028' AND position('Bon resté valable après un remboursement Stripe' in contenu) = 0;

-- 8) à 10) 2e révision après lx-bot-eval : libellés du ticket négatif selon le paiement ; RDV / commande à annuler ensuite =
--    transmettre ; e-mail au comptable sans liste des versements (le worker ne lit pas stripe_versements pour l'e-mail).
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o8$ticket négatif « Remboursement : … » qui renvoie au ticket du paiement (au prorata des lignes si le remboursement est partiel)$o8$,
$n8$ticket négatif qui renvoie au ticket du paiement (libellé selon le paiement, ci-dessous ; au prorata des lignes si le remboursement est partiel)$n8$),
  maj_le = now()
 WHERE cle = 'recettes_en_ligne_1028' AND position('(libellé selon le paiement, ci-dessous ;' in contenu) = 0;
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o9$Le rendez-vous ou la commande ne sont pas annulés par un remboursement fait sur Stripe : rembourser de préférence depuis Luxyra (acompte, annulation de commande).$o9$,
$n9$Autres paiements (acompte conservé, empreinte, carte d'abonnement, bon cadeau, Click & Collect) : lignes « Remboursement : <ligne du ticket d'origine> », commentaire « remboursement fait sur Stripe ». Le rendez-vous ou la commande ne sont pas annulés par un remboursement fait sur Stripe : rembourser de préférence depuis Luxyra (acompte, annulation de commande). Rendez-vous ou commande à annuler APRÈS un remboursement déjà fait sur Stripe : ne pas donner de marche à suivre, <ESCALATE/>.$n9$),
  maj_le = now()
 WHERE cle = 'recettes_en_ligne_1028' AND position('Rendez-vous ou commande à annuler APRÈS un remboursement' in contenu) = 0;
UPDATE public.support_bot_kb SET contenu = replace(contenu,
$o10$il sert seulement au rapprochement bancaire dans les exports comptables.$o10$,
$n10$il sert seulement au rapprochement bancaire dans les exports comptables (FEC, EBP, Quadratus, bordereau). L'e-mail automatique au comptable ne liste PAS les versements (il rappelle seulement l'information sur la TVA des frais Stripe).$n10$),
  maj_le = now()
 WHERE cle = 'protections_lot4_1028' AND position('ne liste PAS les versements' in contenu) = 0;

-- contrôle (attendu : true sur chaque ligne, et ancien_texte false)
SELECT cle,
       CASE cle WHEN 'bons_cadeaux_en_ligne_1028' THEN position('EST enregistré automatiquement dans la caisse, peu après' in contenu) > 0
                WHEN 'recettes_en_ligne_1028' THEN position('depuis le 29/10/2026 (soir), il est enregistré automatiquement dans la caisse' in contenu) > 0
                ELSE position('relevé des versements : ACTIF depuis le 29/10/2026' in contenu) > 0
                     AND position('Correction faite le 29/10/2026 par des annotations signées' in contenu) > 0 END
       AND CASE cle WHEN 'bons_cadeaux_en_ligne_1028' THEN position('Bon resté valable après un remboursement Stripe' in contenu) > 0
                WHEN 'recettes_en_ligne_1028' THEN position('(et non « Remboursement : … »)' in contenu) > 0
                ELSE position('Un versement n''est PAS une vente' in contenu) > 0 END
       AND CASE cle WHEN 'recettes_en_ligne_1028' THEN position('Rendez-vous ou commande à annuler APRÈS un remboursement' in contenu) > 0
                     AND position('(libellé selon le paiement, ci-dessous ;' in contenu) > 0
                WHEN 'protections_lot4_1028' THEN position('ne liste PAS les versements' in contenu) > 0 ELSE true END AS nouveau_texte,
       (contenu ILIKE '%PAS encore enregistré%' OR contenu ILIKE '%PAS ENCORE ACTIF%' OR contenu ILIKE '%PAS ENCORE FAITE%') AS ancien_texte
  FROM public.support_bot_kb WHERE cle IN ('bons_cadeaux_en_ligne_1028', 'recettes_en_ligne_1028', 'protections_lot4_1028') ORDER BY cle;
COMMIT;
