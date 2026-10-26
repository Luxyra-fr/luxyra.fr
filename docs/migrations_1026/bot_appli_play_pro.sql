-- Luxyra — 2026-10-26 — Appli Android « Luxyra Pro » (Google Play, fr.luxyra.pro)
-- À APPLIQUER LE JOUR OÙ L'APPLI EST EN LIGNE SUR GOOGLE PLAY (pas avant : le bot ne doit pas annoncer une appli absente).
-- NON APPLIQUÉ à la date de rédaction.
BEGIN;
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('appli_android_pro_1026','Application Android Luxyra Pro (Google Play)',1360,$kb$Luxyra Pro existe en application Android sur Google Play (« Luxyra Pro »). C'est la même application que sur luxyra.fr/app.html : mêmes identifiants, mêmes données, même caisse.
Dans l'application Android, la souscription et la gestion de l'abonnement ainsi que l'achat de SMS ne sont pas disponibles (règle de Google Play). Un message l'indique à l'écran. Tout le reste fonctionne : planning, caisse, clients, site, SMS automatiques avec les crédits déjà disponibles, statistiques, stock.
Les acomptes payés par vos clients pour leurs rendez-vous ne sont pas concernés : ils fonctionnent normalement.$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();
COMMIT;
