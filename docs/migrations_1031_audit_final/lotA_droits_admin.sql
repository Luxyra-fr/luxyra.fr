-- 2026-10-31 Lot A (objectif 9,5) — F7 / S3 : l'admin n'écrit plus directement dans salons, clients_luxyra, support_messages.
-- Écritures admin sur salons : UNIQUEMENT via admin_salon_maj(id, patch) (liste blanche, journal serveur, messages FR).
-- Les déclencheurs existants restent actifs dans la RPC (auth.uid()/jwt de l'appelant conservés) :
--   identité -> JET 410 obligatoire ; config_json / mode_caisse / TVA / user_id / stripe_* : hors liste blanche.
-- Rejouable.

create or replace function public.admin_salon_maj(p_id uuid, p_patch jsonb)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $$
declare
  -- colonnes réellement modifiées par le panneau (relevé du 31/10 : essai, verrou des documents, plan offert,
  -- statut, forfait sans Stripe, vérification des justificatifs, notes, fiche légale / SIRET (tracée au JET 410))
  v_ok constant text[] := array['trial_end','documents_locked','is_free','free_until','plan','status',
    'verification_status','verified_at','verified_by','documents_kbis','documents_id','documents_id_verso','documents_uploaded_at',
    'notes_admin','nom','metier','gerant_nom','gerant_prenom','forme_juridique','siret','siren','tva_intra','adresse','cp','ville','tel'];
  -- RGPD (comme f7) : coordonnées personnelles masquées dans le journal admin
  v_masque constant text[] := array['gerant_nom','gerant_prenom','tel','adresse'];
  k text; v_set text := ''; v_avant jsonb; v_apres jsonb; v_n int;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur (reconnectez-vous avec votre code)' using errcode = '42501'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then raise exception 'Aucune modification demandée'; end if;
  for k in select jsonb_object_keys(p_patch) loop
    if not (k = any(v_ok)) then raise exception 'Champ « % » non modifiable depuis l''administration', k using errcode = '42501'; end if;
    v_set := v_set || case when v_set = '' then '' else ', ' end
      || format('%I = (jsonb_populate_record(null::public.salons, $1)).%I', k, k);
  end loop;
  select to_jsonb(s) into v_avant from salons s where s.id = p_id;
  if v_avant is null then raise exception 'Établissement introuvable'; end if;
  execute format('update public.salons set %s where id = $2', v_set) using p_patch, p_id;
  get diagnostics v_n = row_count;
  if v_n <> 1 then raise exception 'Modification non appliquée'; end if;
  select to_jsonb(s) into v_apres from salons s where s.id = p_id;
  insert into admin_log(salon_id, action, details, cible, avant, apres, origine)
  select p_id, 'SALON_MAJ', 'Champs : ' || (select string_agg(x, ', ') from jsonb_object_keys(p_patch) x), 'salons:' || p_id,
         (select jsonb_object_agg(x, case when x = any(v_masque) then to_jsonb('(masqué)'::text) else v_avant -> x end) from jsonb_object_keys(p_patch) x),
         (select jsonb_object_agg(x, case when x = any(v_masque) then to_jsonb('(masqué)'::text) else v_apres -> x end) from jsonb_object_keys(p_patch) x), 'api';
  return (select jsonb_object_agg(x, v_apres -> x) from jsonb_object_keys(p_patch) x) || jsonb_build_object('id', p_id);
end $$;
revoke all on function public.admin_salon_maj(uuid, jsonb) from public, anon;
grant execute on function public.admin_salon_maj(uuid, jsonb) to authenticated;

-- salons : plus d'écriture admin directe (propriétaire seulement ; les RPC admin_* sont SECURITY DEFINER)
drop policy if exists salon_update on public.salons;
create policy salon_update on public.salons for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists salon_insert on public.salons;
create policy salon_insert on public.salons for insert to authenticated with check (user_id = auth.uid());

-- clients_luxyra : l'admin lit seulement (le panneau n'y écrit pas ; serveur = clé service)
drop policy if exists bp_admin_all on public.clients_luxyra;
drop policy if exists bp_auth_update_own on public.clients_luxyra;
create policy bp_auth_update_own on public.clients_luxyra for update to authenticated
  using (lower(email) = lower(coalesce(auth.email(), ''))) with check (lower(email) = lower(coalesce(auth.email(), '')));

-- support_messages : admin = lecture, envoi de SES réponses (sender='admin'), marquer lu. Ni suppression ni réécriture.
drop policy if exists admin_full_access_msg on public.support_messages;
drop policy if exists sm_admin_select on public.support_messages;
drop policy if exists sm_admin_insert on public.support_messages;
drop policy if exists sm_admin_update on public.support_messages;
create policy sm_admin_select on public.support_messages for select to authenticated using (public.is_admin());
create policy sm_admin_insert on public.support_messages for insert to authenticated with check (public.is_admin() and sender = 'admin');
create policy sm_admin_update on public.support_messages for update to authenticated using (public.is_admin()) with check (public.is_admin());
create or replace function lx_prive.support_messages_admin_garde() returns trigger language plpgsql set search_path to 'public','pg_temp' as $$
begin
  -- l'admin (non propriétaire) ne peut changer QUE read_by_admin
  if public.is_admin() and not exists (select 1 from salons s where s.id = old.salon_id and s.user_id = auth.uid()) then
    if (to_jsonb(new) - 'read_by_admin') is distinct from (to_jsonb(old) - 'read_by_admin') then
      raise exception 'L''administration peut seulement marquer un message comme lu' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_support_messages_admin_garde on public.support_messages;
create trigger trg_support_messages_admin_garde before update on public.support_messages for each row execute function lx_prive.support_messages_admin_garde();
