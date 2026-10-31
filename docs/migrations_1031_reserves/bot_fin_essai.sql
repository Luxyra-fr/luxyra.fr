-- 31/10/2026 : bot — fin de l'essai gratuit (écran de choix de formule, caisse test, SIRET). Idempotent.
insert into public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le) values ('fin_essai_1031', 'Fin de l''essai gratuit : s''abonner', 45,
'Quand l''essai gratuit de 14 jours est terminé sans abonnement, l''application affiche l''écran « Votre essai gratuit est terminé » (noir et or) avec les deux formules : Essentiel et Pro. Vos données (planning, clients, caisse) sont conservées et reviennent exactement comme avant dès l''abonnement.
Pour s''abonner depuis cet écran :
1. Si votre caisse est encore en mode test : touchez « Passer en caisse réelle » (étape 1). Vos encaissements de test sont archivés (copie scellée, 6 ans) puis retirés ; tapez REEL pour confirmer ; l''application se recharge.
2. Si votre numéro SIRET n''est pas encore renseigné : saisissez-le (14 chiffres) dans le cadre « votre numéro SIRET » puis « Enregistrer ». Il est obligatoire pour activer l''abonnement.
3. Cochez « J''accepte les CGV et la politique de confidentialité », puis « Choisir Essentiel » ou « Choisir Pro » : le paiement sécurisé Stripe s''ouvre.
Au retour du paiement, un écran d''attente s''affiche quelques secondes puis l''application s''ouvre. Ne payez pas une deuxième fois : un seul paiement ouvert à la fois est possible, et si vous avez déjà un abonnement en cours le changement de formule se fait dans Paramètres → « Changer de forfait » (en haut).
Le bouton « Régulariser mon paiement » n''apparaît que pour un abonnement existant en défaut de paiement (il ouvre le portail Stripe pour changer de carte).', true, now())
on conflict (cle) do update set titre = excluded.titre, contenu = excluded.contenu, actif = true, maj_le = now();
