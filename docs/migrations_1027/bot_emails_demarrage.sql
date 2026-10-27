-- Luxyra — 2026-10-27 — Bot : e-mails de démarrage (salon-onboarding-email v10). APPLIQUÉ le 27/10.
BEGIN;
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('emails_demarrage_1027','E-mails de démarrage (les 14 premiers jours)',1370,$kb$Après l'inscription, Luxyra envoie 6 e-mails de démarrage, signés par Alexandre, le fondateur : le jour même (bienvenue, accès, 4 premières étapes), puis aux jours 1 (prestations, horaires, équipe), 3 (forfait Pro : acompte en ligne ; Essentiel : encaisser et clôturer), 5 (fidélité, forfaits, bons cadeaux), 7 (forfait Pro : rappels et campagnes SMS ; Essentiel : statistiques, clôture, comptabilité) et 14 (faire connaître sa page de réservation, fin de l'essai).
Les conseils sont adaptés au métier principal choisi à l'inscription et au mode d'activité (en établissement ou à domicile). Chaque e-mail renvoie vers le guide d'aide correspondant.
On peut répondre directement à ces e-mails : la réponse arrive à l'équipe Luxyra. La série s'arrête d'elle-même après 14 jours.$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
COMMIT;
