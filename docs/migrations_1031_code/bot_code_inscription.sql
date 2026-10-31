-- Bot : fiche « code à 6 chiffres à l'inscription client » (31/10/2026) + précision sur la fiche « adresse mal saisie ». Rejouable.
insert into public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le)
values ('code_inscription_1031', 'Client : code à 6 chiffres à l''inscription', 1312,
'Depuis le 31/10/2026, quand un client crée son compte Luxyra (page de réservation de l''établissement, luxyra.fr/compte ou application Luxyra), il reçoit un code à 6 chiffres par e-mail (« Votre code de confirmation Luxyra », valable 15 minutes). Il le saisit dans la fenêtre « Vérifiez votre e-mail » puis touche « Valider et créer mon compte » : le compte est créé avec son adresse déjà confirmée. Une adresse mal tapée ne reçoit pas le code : aucun compte n''est créé avec une adresse fausse.
- Il ne reçoit pas le code : regarder les courriers indésirables (spams), puis « Renvoyer le code » (possible après 60 secondes, 3 fois par heure).
- Adresse mal tapée : « Modifier l''adresse » ferme la fenêtre pour la corriger.
- 5 codes faux de suite : demander un nouveau code.
- L''adresse a déjà un compte Luxyra : le client reçoit à la place un e-mail « Vous avez déjà un compte » ; il se connecte avec son mot de passe ou « Mot de passe oublié ».
Les comptes créés avant le 31/10/2026 et non confirmés gardent l''ancien fonctionnement (lien « Confirmer mon adresse email » + mot de passe du compte).
Guide : luxyra.fr/aide/espace-client#s1', true, now())
on conflict (cle) do update set titre = excluded.titre, ordre = excluded.ordre, contenu = excluded.contenu, actif = true, maj_le = now();
update public.support_bot_kb
   set contenu = replace(contenu, 'et rappelle l''adresse à laquelle le lien sera envoyé.', 'puis envoie un code à 6 chiffres à cette adresse (depuis le 31/10/2026) : avec une adresse mal tapée, le code n''arrive pas et le compte n''est pas créé.'), maj_le = now()
 where cle = 'email_client_mal_saisi_1030' and contenu like '%et rappelle l''adresse à laquelle le lien sera envoyé.%';
