-- Luxyra — 2026-10-28 (-2, 6.8.0) — Bot : paiements en ligne enregistrés en caisse par le serveur. NON APPLIQUÉ.
-- À appliquer APRÈS l'activation (app_config.config.recettes_en_ligne_serveur = true, voir docs/migrations_1028/recettes_en_ligne.sql),
-- puis vérifier avec lx-bot-eval (questions : « le bon cadeau acheté en ligne n'est pas dans ma caisse », « je dois encaisser une
-- commande Click & Collect payée en ligne ? », « j'ai remboursé un client sur Stripe, que faire dans Luxyra ? », « un acompte payé
-- hier soir après ma clôture n'apparaît pas », « l'empreinte capturée est de 20 € mais le client avait 30 € bloqués »).
BEGIN;
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('recettes_en_ligne_1028','Paiements en ligne : enregistrés automatiquement dans la caisse',1342,$kb$Depuis Luxyra 6.8.0, CHAQUE paiement fait en ligne par un client est enregistré automatiquement dans la caisse de l'établissement, au moment où le paiement est confirmé, même si l'application est fermée sur tous les appareils : ticket de caisse sécurisé, réglé « En ligne (Stripe) », compté dans la clôture du jour (ligne « Payés en ligne ») et dans tous les documents comptables. Rien à saisir.
Concerné : acompte de rendez-vous (ticket « Acompte en ligne »), empreinte bancaire capturée (ticket « Empreinte encaissée », pour le montant RÉELLEMENT débité, même si une partie seulement est capturée), bon cadeau acheté sur la page en ligne (ticket « Bon cadeau BC-… (vente en ligne) », même règle de TVA qu'un bon vendu en caisse ; le n° du ticket est dans l'e-mail de l'acheteur), carte d'abonnement payée en ligne, commande Click & Collect payée en ligne.
Remboursements : un remboursement (acompte remboursé, commande annulée et remboursée, remboursement fait directement dans le tableau de bord Stripe) crée automatiquement un ticket négatif. Rien à faire dans Luxyra.
Click & Collect payé en ligne : la commande est DÉJÀ en caisse depuis le paiement. Au retrait, le bouton « Remettre (déjà en caisse : ticket n° …) » marque la commande remise et sort les produits du stock, SANS nouveau ticket : ne pas l'encaisser une 2e fois. Une commande « À régler au salon » s'encaisse toujours avec « Encaisser puis remettre ».
Paiement reçu après la clôture Z du soir : il est enregistré automatiquement dans la journée suivante (la date du paiement reste indiquée sur le ticket). Un message peut dire « le serveur l'enregistre automatiquement » : attendre quelques minutes. S'il manque encore le lendemain : <ESCALATE/>.
Bon cadeau acheté en ligne utilisé en caisse : déduit (bon à usage unique) ou pris comme moyen de paiement (bon à usage multiple), jamais compté deux fois.
Caisse en mode test (essai) : ces tickets sont des tickets de TEST, effacés au passage en caisse réelle comme les autres.$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre, ordre=EXCLUDED.ordre, contenu=EXCLUDED.contenu, actif=true, maj_le=now();
-- Entrée « inexistant » : il n'y a PAS d'écran pour créer à la main le ticket d'un paiement en ligne (le serveur le fait).
UPDATE public.support_bot_kb
   SET contenu = contenu || E'\nIl n''existe pas d''écran pour créer à la main le ticket de caisse d''un paiement en ligne (acompte, bon cadeau, carte, Click & Collect) : Luxyra le crée automatiquement au paiement ; s''il manque plus d''un jour : <ESCALATE/>.',
       maj_le = now()
 WHERE cle = 'inexistant' AND position('ticket de caisse d''un paiement en ligne' in contenu) = 0;
COMMIT;
-- Retour arrière : DELETE FROM public.support_bot_kb WHERE cle = 'recettes_en_ligne_1028'; (la phrase ajoutée à « inexistant » peut rester)
