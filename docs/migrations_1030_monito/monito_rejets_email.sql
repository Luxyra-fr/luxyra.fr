-- Luxyra — 30/10/2026 — Surveillance : un e-mail rejeté par l'adresse du destinataire (faute de frappe, boîte inexistante)
-- n'est plus classé « grave ». Ce n'est pas une panne : l'envoi a marché, l'adresse saisie est fausse.
-- On alerte seulement si les rejets se répètent (>= 3 en 24 h) : là, ce pourrait être un problème d'expéditeur (DKIM, réputation).
-- Hors périmètre fiscal. Lecture seule sur les données ; seule la fonction de surveillance change.
do $m$
declare d text; a1 text; a2 text;
begin
  d := pg_get_functiondef('lx_prive.a_reparer_brut'::regproc);
  a1 := $a$       and (s.ferme_le is null or e.reported_at < s.ferme_le)
  ), g as ($a$;
  a2 := $a$  -- SMS refusés par l'opérateur$a$;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'ancre introuvable : fonction modifiée entre-temps'; end if;
  if position('brevo_rejet' in d) > 0 then raise notice 'déjà appliqué'; return; end if;
  d := replace(d, a1, $b$       and (s.ferme_le is null or e.reported_at < s.ferme_le)
       -- 30/10/2026 : e-mail rejeté par l'adresse du destinataire = adresse fausse, pas une panne (voir section G, brevo_rejet)
       and not (e.source = 'brevo_webhook' and e.message ~* 'hard_bounce|invalid|blocked|unsubscribed')
  ), g as ($b$);
  d := replace(d, a2, $b$  -- 30/10/2026 (brevo_rejet) : e-mails rejetés en série (>= 3 en 24 h) = possible souci d'expéditeur
  return query
  select md5('brevo_rejet'), 'a_reparer', 'E-mails', 'Plusieurs e-mails rejetés (adresses refusées)',
         'Plusieurs e-mails n''ont pas pu être remis en 24 h. Un rejet isolé vient d''une adresse mal saisie ; une série peut venir de l''expéditeur.',
         'Prévenir Claude si cela continue.',
         count(*)::int, min(e.reported_at), max(e.reported_at), array[]::text[],
         left((array_agg(e.message order by e.reported_at desc))[1], 800)
    from server_errors e
   where e.source = 'brevo_webhook' and e.message ~* 'hard_bounce|invalid|blocked'
     and e.reported_at > greatest(v_depuis, now() - interval '24 hours')
  having count(*) >= 3;

  -- SMS refusés par l'opérateur$b$);
  execute d;
end $m$;
