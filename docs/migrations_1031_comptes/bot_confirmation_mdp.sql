-- Luxyra — 2026-10-31 — Bot : confirmation de l'adresse e-mail du client avec mot de passe (contre-audit 3, M1). Rejouable.
BEGIN;
INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif)
SELECT 'email_confirmation_mdp_1031', 'Client : confirmer son adresse e-mail (mot de passe demandé)', 1311,
'Quand un client touche le lien « Confirmer mon adresse email », Luxyra confirme directement s''il est connecté à son compte sur cet appareil. Sinon, la page « Confirmer votre adresse » lui demande le mot de passe de son compte Luxyra (sécurité : un lien seul ne suffit plus, pour qu''un compte créé par quelqu''un d''autre avec son adresse ne puisse pas récupérer ses rendez-vous, bons ou points).
- Mot de passe oublié, ou compte qu''il n''a pas créé lui-même mais qui porte son adresse : « Définir un mot de passe » sur la même page (un lien part à son adresse ; tous les appareils connectés au compte sont déconnectés).
- Il n''a jamais créé de compte Luxyra : ne rien faire, rien n''est relié à son adresse.
Guide : luxyra.fr/aide/espace-client#s2', true
WHERE NOT EXISTS (SELECT 1 FROM public.support_bot_kb WHERE cle = 'email_confirmation_mdp_1031');
COMMIT;
