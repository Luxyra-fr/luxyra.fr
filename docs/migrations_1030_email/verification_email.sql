-- Luxyra — 30/10/2026 (soir) — Contre-audit 2 « e-mail client » : le lien de confirmation est lié à l'adresse à laquelle il part.
-- Ferme la course send_verification / change_email (un lien envoyé à l'ancienne adresse ne peut plus confirmer la nouvelle).
-- Hors périmètre fiscal. Idempotent.
begin;
alter table public.clients_luxyra add column if not exists verification_email text;
comment on column public.clients_luxyra.verification_email is 'Adresse (minuscules) à laquelle le lien de confirmation en cours a été envoyé. verify_email exige verification_email = email.';

-- Codes en cours émis AVANT la mise en service de change_email (30/10/2026 20:15 UTC) : l'adresse n'a pas pu changer
-- depuis (seul change_email change l'adresse côté client, et il émet toujours un nouveau code) -> on fixe l'adresse actuelle.
-- Codes plus récents sans verification_email (aucun en prod au moment de l'application) : laissés NULL = refusés.
update public.clients_luxyra set verification_email = lower(email)
 where verification_code is not null and verification_email is null and not email_verified
   and verification_sent_at < '2026-10-30 20:15:00+00';

-- Écriture réservée au serveur (service_role), comme verification_code
do $m$
declare d text;
begin
  d := pg_get_functiondef('public.bp_protect_sensitive'::regproc);
  if position('verification_email' in d) = 0 then
    d := replace(d, 'or new.verification_code is distinct from old.verification_code',
                    'or new.verification_code is distinct from old.verification_code
       or new.verification_email is distinct from old.verification_email');
    if position('verification_email' in d) = 0 then raise exception 'ancre bp_protect_sensitive introuvable'; end if;
    execute d;
  end if;
end $m$;
commit;
-- Contrôle : select count(*) from clients_luxyra where verification_code is not null and not email_verified and verification_email is null; -- attendu 0
