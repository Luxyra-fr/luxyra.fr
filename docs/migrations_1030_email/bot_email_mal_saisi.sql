-- Luxyra — 2026-10-30 — Bot de support : adresse e-mail client mal saisie (suggestion, correction, adresse refusée).
-- À appliquer APRÈS la mise en service (email_client_rejete.sql + lx-profile v11 + lx-brevo-webhook v2 + worker + pages).
-- Rejouable. Puis vérifier avec lx-bot-eval : « mon client s'est trompé d'adresse e-mail », « un client ne reçoit pas ses e-mails ».
BEGIN;
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif)
SELECT 'email_client_mal_saisi_1030', 'Client : adresse e-mail mal saisie / e-mails non reçus', 1310,
'Un client qui s''est trompé en tapant son adresse (ex. « laposte.fr » au lieu de « laposte.net ») ne reçoit aucun e-mail Luxyra (lien de confirmation, confirmations et rappels).
- À l''inscription (espace client, page de réservation), Luxyra propose la correction des fautes courantes : « Vouliez-vous dire …@gmail.com ? » (cliquable) et rappelle l''adresse à laquelle le lien sera envoyé.
- Adresse PAS encore confirmée : le client la corrige lui-même dans son espace client (luxyra.fr/compte.html) : lien « Adresse mal saisie ? Corrigez-la » sous le bandeau « ✉️ Confirmez votre adresse email », nouvelle adresse + son mot de passe, bouton « Corriger et recevoir le lien ». Il se connecte ensuite avec la nouvelle adresse (même mot de passe). Limite : 5 essais par jour.
- E-mails refusés (adresse inexistante) : l''espace client affiche « ⚠️ Votre adresse e-mail semble incorrecte : corrigez-la » avec le formulaire ouvert. Les propositions de RDV sur mesure partent alors par SMS.
- Adresse DÉJÀ confirmée : pas de changement par le client ; il écrit à contact@luxyra.fr.
- Côté établissement : les RDV déjà pris gardent l''adresse saisie à la réservation ; corriger aussi l''e-mail de la fiche client (Clients › fiche › modifier).
Guide : luxyra.fr/aide/espace-client#s2', true
WHERE NOT EXISTS (SELECT 1 FROM public.support_bot_kb WHERE cle = 'email_client_mal_saisi_1030');
COMMIT;
-- Contrôle : select cle, actif, length(contenu) from support_bot_kb where cle='email_client_mal_saisi_1030';
