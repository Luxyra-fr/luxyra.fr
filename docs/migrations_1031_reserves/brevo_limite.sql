-- Luxyra — 31/10/2026 — contre-audit 4, A1 : la limite de 300 événements/minute ne s'applique plus qu'aux appels SANS
-- la bonne clé. Un attaquant qui inonde l'ancienne URL ne peut plus bloquer (429) les vrais appels de Brevo (avec clé).
-- Hors périmètre fiscal. Idempotent.
create or replace function public.lx_brevo_webhook_controle(p_cle text)
 returns text
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare v_cle text; v_etat lx_prive.brevo_webhook_etat%rowtype; v_n int;
begin
  select decrypted_secret into v_cle from vault.decrypted_secrets where name = 'brevo_webhook_cle';
  -- 1. bonne clé : toujours acceptée (aucune limite de débit)
  if v_cle is not null and p_cle is not null and length(p_cle) = length(v_cle)
     and extensions.digest(p_cle, 'sha256') = extensions.digest(v_cle, 'sha256') then
    update lx_prive.brevo_webhook_etat set cle_vue_le = now() where id = 1 and cle_vue_le is null;
    return 'ok';
  end if;
  -- 2. sans clé (ou fausse) : refus définitif dès que la clé a servi une fois
  select * into v_etat from lx_prive.brevo_webhook_etat where id = 1;
  if v_etat.cle_vue_le is not null then return 'refus'; end if;
  -- 3. transition (ancienne URL) : limitée à 300 événements/minute
  select count(*) into v_n from public.server_errors where source = 'brevo_webhook' and reported_at > now() - interval '1 minute';
  if v_n > 300 then return 'trop'; end if;
  if v_etat.alerte_sans_cle_le is null or v_etat.alerte_sans_cle_le < now() - interval '24 hours' then
    update lx_prive.brevo_webhook_etat set alerte_sans_cle_le = now()
     where id = 1 and (alerte_sans_cle_le is null or alerte_sans_cle_le < now() - interval '24 hours');
    if found then
      insert into public.server_errors (source, severity, message, http_path)
      values ('brevo_webhook_config', 'error', 'Brevo appelle encore l''ancienne adresse de notification, sans clé : coller la nouvelle adresse dans Brevo (voir CLAUDE.md, rubrique Brevo)', '/brevo/sans-cle');
    end if;
  end if;
  return 'transition';
end $function$;
revoke all on function public.lx_brevo_webhook_controle(text) from public, anon, authenticated;
grant execute on function public.lx_brevo_webhook_controle(text) to service_role;
