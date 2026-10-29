-- Luxyra — 2026-10-26 — Appli Android « Luxyra Pro » (Google Play, fr.luxyra.pro)
-- Préparé le 26/10/2026 ; revu et APPLIQUÉ le 29/10/2026 (appli publiée sur Google Play, app 6.8.7).
-- Vérifié dans app.html : window.LX_PLAY (?source=play / referrer android-app://fr.luxyra.pro), garde lxPlay()
-- dans showPlanChoiceModal, showUpgradeModal, startCheckout, openCustomerPortal, changement de forfait, buySMSPack,
-- recharge automatique ; messages lxPlayInfo() sans prix ni lien. Paramètres › « Installer l'application » propose
-- l'appli Play sur Android (hors appli Play) depuis le 29/10/2026.
-- Contenu final (md5 7d59b643… pour appli_android_pro_1026) après 2 passes lx-bot-eval le 29/10.
-- 3 lignes : appli_android_pro_1026 (nouvelle), installer_app (Android : Google Play), appli_clientes (publiée).
BEGIN;
INSERT INTO public.support_bot_kb (cle,titre,ordre,contenu,actif,maj_le) VALUES ('appli_android_pro_1026','Application Android Luxyra Pro (Google Play)',1362,$kb$RÈGLE PRIORITAIRE (elle passe avant les rubriques sur l'abonnement et les SMS) : à toute question sur l'abonnement, le forfait ou l'achat de SMS DANS l'application Android Luxyra Pro, répondre UNIQUEMENT : ce n'est pas disponible dans l'application Android (règle de Google Play) ; un abonnement déjà actif y fonctionne normalement ; pour toute question sur l'abonnement, l'équipe Luxyra peut répondre ici. Ne JAMAIS ajouter où ni comment s'abonner ou payer ailleurs : pas de luxyra.fr, pas de luxyra.fr/app, pas de « version web », pas de navigateur, pas de « Gérer mon abonnement », pas de Stripe, pas de lien, pas de prix (le support est affiché DANS l'application Android et Google Play interdit d'y orienter vers un autre moyen de paiement).
Luxyra Pro existe en application Android, publiée sur Google Play : « Luxyra Pro – Caisse & planning » (éditeur Luxyra), gratuite à télécharger : https://play.google.com/store/apps/details?id=fr.luxyra.pro
C'est la même application que luxyra.fr/app : mêmes identifiants (e-mail et mot de passe du compte de l'établissement), mêmes données, même caisse, mêmes codes PIN. Elle demande un compte Luxyra Pro existant (on ne crée pas son établissement depuis l'application).
Installation sur un téléphone ou une tablette Android : Paramètres › « Installer l'application » › « Disponible sur Google Play », ou chercher « Luxyra Pro » dans le Play Store. Sans le Play Store, l'installation depuis Chrome reste possible (menu ⋮ › « Installer l'application »).
Dans l'application Android, la souscription et la gestion de l'abonnement (s'abonner, changer de forfait) ainsi que l'achat de SMS et la recharge automatique ne sont pas disponibles (règle de Google Play) : un message l'indique à l'écran. Un abonnement déjà actif continue de fonctionner normalement dans l'application. 
Tout le reste fonctionne : planning, caisse, clôtures, clients, site, rappels SMS avec les crédits déjà disponibles, statistiques, stock, notifications (Paramètres › « Notifications push » › « Activer »).
Les acomptes payés par vos clients pour leurs rendez-vous ne sont pas concernés : ils fonctionnent normalement.
iPhone / iPad : pas d'application sur l'App Store ; Luxyra s'installe depuis Safari (Partager › « Sur l'écran d'accueil »).
Pour vos clients, il existe une autre application : « Luxyra – Beauté & bien-être » (voir appli_clientes).$kb$,true,now())
ON CONFLICT (cle) DO UPDATE SET titre=EXCLUDED.titre,ordre=EXCLUDED.ordre,contenu=EXCLUDED.contenu,actif=true,maj_le=now();

UPDATE public.support_bot_kb SET contenu=$kb$Luxyra s'installe comme une application (icône sur l'écran, ouverture en plein écran, sans repasser par le site). Paramètres → « Installer l'application » (ou la carte « Installez Luxyra sur cet appareil » sur l'accueil).
- Android (téléphone ou tablette) : application « Luxyra Pro – Caisse & planning » sur Google Play. Paramètres → « Installer l'application » → badge « Disponible sur Google Play » (ou chercher « Luxyra Pro » dans le Play Store), puis se connecter avec le compte de l'établissement. Sans Play Store : Chrome, menu ⋮ → « Installer l'application » ou « Ajouter à l'écran d'accueil » (souvent proposé automatiquement). Voir appli_android_pro_1026 (abonnement et achat de SMS non disponibles dans l'application Play).
- iPhone / iPad : pas d'application sur l'App Store. Ouvrir Luxyra dans Safari → bouton Partager ⬆ → « Sur l'écran d'accueil » → Ajouter. (Depuis Gmail/Facebook, ouvrir d'abord dans Safari.) L'iPhone ne propose jamais l'installation tout seul.
- Ordinateur Windows ou Mac avec Chrome ou Edge : icône d'installation à droite de la barre d'adresse → Installer (ou bouton « Installer maintenant » dans Paramètres).
- Mac avec Safari : menu Fichier → « Ajouter au Dock ».
- Firefox sur ordinateur ne permet pas l'installation : utiliser Chrome ou Edge.
À faire sur chaque appareil (téléphone, tablette, ordinateur de la caisse). Guide : luxyra.fr/aide/installer-et-notifications$kb$, maj_le=now()
WHERE cle='installer_app';

UPDATE public.support_bot_kb SET contenu=replace(replace(replace(contenu,
  $a$« Luxyra – Réserver beauté & bien-être »$a$, $b$« Luxyra – Beauté & bien-être »$b$),
  $a$Publication sur Google Play en cours ; en attendant, sur Android/Chrome on peut ouvrir luxyra.fr/client.html puis menu ⋮ > « Ajouter à l'écran d'accueil ».$a$,
  $b$Elle est disponible sur Google Play (gratuite) : https://play.google.com/store/apps/details?id=fr.luxyra.client — sur iPhone, le client ouvre luxyra.fr/compte dans Safari puis Partager > « Sur l'écran d'accueil ». Pour la faire connaître : badge Google Play sur la page de l'établissement et sur l'affichette QR du comptoir (Paramètres › « Site en ligne »).$b$),
  $a$l'espace caisse/agenda reste luxyra.fr/app,$a$,
  $b$l'espace caisse/agenda est luxyra.fr/app ou l'application Android « Luxyra Pro – Caisse & planning » (voir appli_android_pro_1026),$b$),
  maj_le=now()
WHERE cle='appli_clientes';
-- Correction après lx-bot-eval (29/10) : la réponse « comment mes clients réservent » ne citait pas l'appli clients.
UPDATE public.support_bot_kb SET contenu=$b$Question « comment mes clients réservent depuis leur téléphone ? » : toujours citer les DEUX moyens : (1) la page de réservation de l'établissement (luxyra.fr/nom-de-l-etablissement, lien ou QR code de l'affichette du comptoir) ; (2) l'application gratuite « Luxyra – Beauté & bien-être » sur Google Play (Android), où le client cherche l'établissement puis réserve. Sur iPhone : la page de réservation dans Safari.
$b$ || contenu, maj_le=now() WHERE cle='appli_clientes' AND position('Question « comment mes clients réservent' in contenu)=0;
COMMIT;
