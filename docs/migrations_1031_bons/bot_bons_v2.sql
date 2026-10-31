-- 31/10/2026 (-2) : bot — palettes des bons cadeaux, formats d'impression sur A4, e-carte depuis la caisse, partager. Idempotent.
-- Met à jour la fiche bons_modele_1031 (impression A4) et ajoute bons_ecarte_1031. Aucune autre table touchée.
update public.support_bot_kb set contenu = replace(contenu,
 'Impression (« 🖨 Imprimer » sur un bon) : « Carte 85 × 55 mm » (recto et verso côte à côte sur une feuille A4, à découper puis plier au milieu) ou « Carte A6 » (avec le message, pour une enveloppe).',
 'Couleurs : sous « Couleurs », choisir une palette (« Couleur de l''établissement » par défaut, « Noir & or », « Bordeaux & or », « Bleu nuit & argent », « Vert sauge », « Rose poudré », « Taupe & or ») ; elle s''applique à l''impression, à la page de vente, à la confirmation et à l''e-mail. Impression (« 🖨 Imprimer » sur un bon), tout sur une feuille A4 : « Carte pliée en deux » (une seule face, plier image vers l''extérieur puis découper les deux épaisseurs le long des repères : 178 × 115 mm), « Carte 85 × 55 mm » (recto et verso côte à côte, à découper puis plier), « Carte A6 avec message » (centrée sur A4 avec traits de coupe, enveloppe C6) ou « Bon pleine page ». Avec du papier A6 : lien « Imprimer au format A6 ».'),
 maj_le = now()
where cle = 'bons_modele_1031' and contenu not like '%Carte pliée en deux%';
insert into public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le) values ('bons_ecarte_1031', 'Envoyer un bon cadeau par e-mail (e-carte) ou le partager', 47,
'Pour un bon vendu en caisse, quand un modèle (Maison ou Écrin) est choisi : sur le bon, toucher « 🖨 Imprimer » puis « Envoyer l''e-carte ». Saisir l''e-mail du destinataire (celui de l''achat en ligne est déjà rempli) et « Envoyer ». Le client reçoit la carte au modèle et aux couleurs des bons de l''établissement, avec le code et le QR code, à présenter sur place sur papier ou sur téléphone.
L''e-carte ne peut pas être envoyée pour un bon annulé, entièrement utilisé, expiré ou non payé. Une même e-carte n''est envoyée qu''une fois par jour à la même adresse. L''envoi est noté dans l''historique des messages.
« Partager » (même fenêtre) prépare un court texte (valeur, code, validité, adresse de l''établissement) à envoyer par SMS, WhatsApp ou e-mail depuis le téléphone.
Les bons achetés en ligne reçoivent déjà l''e-carte automatiquement après le paiement. En mode démo, rien n''est envoyé.', true, now())
on conflict (cle) do update set titre = excluded.titre, contenu = excluded.contenu, actif = true, maj_le = now();
