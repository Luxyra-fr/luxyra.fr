-- 2026-10-26 : bot de support — affichette QR pour le comptoir (Paramètres › Site en ligne). NON APPLIQUÉ.
BEGIN;
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le)
VALUES ('affichette_qr_1026', 'Affichette QR pour le comptoir (octobre 2026)', 910,
'- Où : Paramètres › « Site en ligne », carte « 🖨️ Affichette QR pour le comptoir », juste sous « 🔗 Adresse de votre site » (avant « Bouton « Réserver » sur Google »). Visible dès que l''établissement a une adresse de page (luxyra.fr/votre-nom) ; sinon, enregistrer d''abord l''adresse dans « Personnaliser votre adresse ». Rubrique « Site en ligne » = forfait Pro.
- Un clic ouvre une fenêtre d''impression : choisir le style « Sombre » (fond noir, bordure dorée) ou « Clair » (fond crème), le format A4 ou A5, puis « 🖨️ Imprimer ». Si les pop-up sont bloquées, les autoriser pour luxyra.fr.
- Contenu : logo de l''établissement (Paramètres › « Infos établissement ») ou, à défaut, son nom ; « Réservez votre prochain rendez-vous en ligne — 24 h/24, en quelques secondes » ; grand QR code vers la page de l''établissement (luxyra.fr/votre-nom ; le lien porte le marqueur ?src=affiche) et l''adresse écrite en clair ; rappel de l''application Luxyra sur Google Play (Android) et, sur iPhone, Partager › Sur l''écran d''accueil ; trois avantages (créneau, rappel, rendez-vous au même endroit).
- Le QR code est fabriqué dans l''application (aucun service extérieur). Si l''adresse de la page change, réimprimer l''affichette : l''ancien QR mène à l''ancienne adresse.
- Fond ou couleurs absents à l''impression : cocher « Graphiques d''arrière-plan » (ou « Imprimer les arrière-plans ») dans la fenêtre d''impression, marges « Aucune » ou « Par défaut », échelle 100 %.',
 true, now())
ON CONFLICT (cle) DO UPDATE SET titre = EXCLUDED.titre, ordre = EXCLUDED.ordre, contenu = EXCLUDED.contenu, actif = true, maj_le = now();
COMMIT;
