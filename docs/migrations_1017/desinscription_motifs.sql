-- =====================================================================================================
-- 2026-10-17 — Page de désinscription Luxyra : motifs (statistiques) + « me réinscrire » + statistiques
-- APPLIQUÉ le 17/10/2026 vers 20 h (base kxdgjtvrkwugbifgppai) — voir le bloc TESTS en fin de fichier.
-- Compatible avec le worker actuellement déployé (appel lx_desinscrire_code(p_code) seul => motif « non_precise »).
-- =====================================================================================================
-- Ce que fait ce fichier :
--   1. Table public.lx_desinscription_motifs : salon, canal, motif, texte libre (motif « autre » seulement,
--      5 à 300 caractères, nettoyé), date, annulation. AUCUNE donnée personnelle (ni client, ni numéro, ni e-mail).
--      RLS activée sans aucune règle + droits retirés à anon/authenticated : lecture par les RPC ci-dessous seulement.
--   2. lx_desinscription_codes : motif_id (lien vers la ligne de motif, pour l'annulation) + état AVANT la
--      désinscription (avant_email_ok, avant_sms_stop) : « me réinscrire » rétablit exactement l'état d'avant.
--   3. public.lx_desinscrire_code(code, motif, texte, source) remplace lx_desinscrire_code(code) :
--      motif obligatoire depuis la page (contrôlé ici aussi) ; désinscription « un clic » des messageries
--      (RFC 8058, sans page) -> motif « un_clic » ; ancien appel sans motif -> « non_precise ».
--      Comportement inchangé sur le fond : SMS -> numéro ajouté à lx_sms_stop (opposition GLOBALE aux SMS
--      publicitaires de TOUS les établissements Luxyra, comme une réponse STOP ; clients.sms_ok inchangé,
--      rappels et confirmations de RDV maintenus) ; e-mail -> clients.email_ok = false sur la fiche de CET
--      établissement seulement.
--   4. public.lx_annuler_desinscription(code) : « Je me suis trompé(e) : me réinscrire », 48 h au plus après la
--      désinscription faite par CE lien ; rétablit l'état d'avant (jamais un consentement qui n'existait pas) ;
--      refusé si le numéro a entre-temps répondu STOP (opposition plus récente conservée).
--   5. public.lx_desinscription_info(code) : + deja (code utilisé OU déjà opposé/désinscrit), annulable,
--      sms_global.
--   6. public.admin_desinscriptions_stats(jours) : statistiques plateforme, réservé à is_admin().
--   7. public.lx_salon_desinscriptions(salon) : 30 derniers jours pour SON établissement (salons.user_id =
--      auth.uid()), sans les textes libres (ils pourraient identifier un client).
-- =====================================================================================================
set lock_timeout = '8s';

-- 1. Table des motifs ----------------------------------------------------------------------------------
create table if not exists public.lx_desinscription_motifs (
  id        bigint generated always as identity primary key,
  cree_le   timestamptz not null default now(),
  salon_id  uuid references public.salons(id) on delete set null,
  canal     text not null check (canal in ('sms', 'email', 'all')),
  motif     text not null check (motif in ('trop_de_messages', 'offres_sans_interet', 'ne_vient_plus', 'jamais_inscrit',
                                            'autre_moyen', 'autre', 'un_clic', 'non_precise')),
  texte     text check (texte is null or char_length(texte) between 5 and 300),
  annule_le timestamptz,
  constraint lx_desinscription_motifs_texte_autre check ((motif = 'autre') = (texte is not null))
);
create index if not exists lx_desinscription_motifs_cree_le_idx on public.lx_desinscription_motifs (cree_le desc);
create index if not exists lx_desinscription_motifs_salon_idx on public.lx_desinscription_motifs (salon_id, cree_le desc);
alter table public.lx_desinscription_motifs enable row level security;
revoke all on public.lx_desinscription_motifs from public, anon, authenticated;
comment on table public.lx_desinscription_motifs is
  '2026-10-17 : motifs de désinscription (page luxyra.fr/s/<code>) pour statistiques. Sans donnée personnelle : '
  'salon, canal, motif, texte libre (motif autre, 5-300 car. nettoyé), date, annulation. Lecture : admin_desinscriptions_stats, lx_salon_desinscriptions.';

-- 2. Colonnes d'annulation sur les codes ---------------------------------------------------------------
alter table public.lx_desinscription_codes add column if not exists motif_id bigint references public.lx_desinscription_motifs(id) on delete set null;
alter table public.lx_desinscription_codes add column if not exists avant_email_ok boolean;
alter table public.lx_desinscription_codes add column if not exists avant_sms_stop boolean;

-- Libellés (affichage, journal du salon)
create or replace function lx_prive.desinscription_motif_libelle(p_motif text)
returns text language sql immutable set search_path to 'pg_catalog' as $$
  select case p_motif
    when 'trop_de_messages'    then 'Trop de messages'
    when 'offres_sans_interet' then 'Les offres ne m''intéressent pas'
    when 'ne_vient_plus'       then 'Je ne viens plus dans cet établissement'
    when 'jamais_inscrit'      then 'Je ne me suis jamais inscrit(e)'
    when 'autre_moyen'         then 'Préfère être contacté(e) autrement'
    when 'autre'               then 'Autre'
    when 'un_clic'             then 'Désinscription en un clic (messagerie)'
    when 'non_precise'         then 'Non précisé'
    else coalesce(p_motif, '') end
$$;

-- 3. Désinscription avec motif -------------------------------------------------------------------------
drop function if exists public.lx_desinscrire_code(text);
create or replace function public.lx_desinscrire_code(p_code text, p_motif text default null, p_texte text default null, p_source text default null)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
-- 2026-10-17 audit réglages (#4) : lien « Stop SMS » / « Se désinscrire » (luxyra.fr/s/<code>, luxyra.fr/stop/<code>)
-- 2026-10-17 lien court : SMS -> opposition aux SMS PUBLICITAIRES (lx_sms_stop, globale : tous les établissements
--   Luxyra), clients.sms_ok inchangé : les rappels et confirmations de rendez-vous continuent (comme une réponse STOP).
--   E-mail -> clients.email_ok = false sur la fiche de CET établissement.
-- 2026-10-17 motifs : motif obligatoire depuis la page ('page') ; 'un_clic' (RFC 8058) ; sans source -> non_precise.
declare v record; v_salon text; v_tel text; v_motif text; v_txt text; v_mid bigint;
        v_avant_email boolean; v_avant_sms boolean;
begin
  if coalesce(p_code, '') !~ '^([0-9a-f]{10}|[a-z0-9]{6})$' then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide'); end if;
  -- motif
  if p_motif is null or p_motif = '' then
    if p_source = 'page' then return jsonb_build_object('ok', false, 'erreur', 'Choisissez un motif', 'champ', 'motif'); end if;
    v_motif := case when p_source = 'un_clic' then 'un_clic' else 'non_precise' end;
  elsif p_motif in ('trop_de_messages', 'offres_sans_interet', 'ne_vient_plus', 'jamais_inscrit', 'autre_moyen', 'autre') then
    v_motif := p_motif;
  else
    return jsonb_build_object('ok', false, 'erreur', 'Motif invalide', 'champ', 'motif');
  end if;
  if v_motif = 'autre' then
    -- nettoyage : caractères de contrôle et chevrons retirés, espaces regroupés
    v_txt := btrim(regexp_replace(regexp_replace(coalesce(p_texte, ''), '[[:cntrl:]<>]', ' ', 'g'), '\s+', ' ', 'g'));
    if char_length(v_txt) < 5 or char_length(v_txt) > 300 then
      return jsonb_build_object('ok', false, 'erreur', 'Précisez votre motif (5 à 300 caractères)', 'champ', 'texte');
    end if;
  end if;

  select d.code, d.canal, d.client_id, d.utilise_le, c.salon_id, c.prenom, c.nom, c.telephone, c.email_ok into v
    from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
   where d.code = p_code or d.code_court = p_code
   limit 1
   for update of d;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide ou expiré'); end if;
  select s.nom into v_salon from public.salons s where s.id = v.salon_id;
  v_tel := public.normalize_phone(v.telephone);

  -- déjà fait par ce lien : rien de plus (pas de 2e motif)
  if v.utilise_le is not null then
    return jsonb_build_object('ok', true, 'deja', true, 'canal', v.canal, 'salon', coalesce(v_salon, ''));
  end if;

  v_avant_email := case when v.canal in ('email', 'all') then coalesce(v.email_ok, false) end;
  v_avant_sms := case when v.canal in ('sms', 'all') and v_tel is not null
                      then exists (select 1 from public.lx_sms_stop s where s.telephone_norm = v_tel) end;

  if v.canal in ('email', 'all') then
    update public.clients set email_ok = false, updated_at = now() where id = v.client_id;
  end if;
  if v.canal in ('sms', 'all') and v_tel is not null then
    insert into public.lx_sms_stop (telephone_norm, source, salon_id, details)
    values (v_tel, 'lien_desinscription', v.salon_id, 'Lien Stop SMS (luxyra.fr/s/) : plus de SMS publicitaires')
    on conflict (telephone_norm) do update set maj_le = now();
    delete from public.lx_sms_stop_levee where telephone_norm = v_tel;
  end if;

  insert into public.lx_desinscription_motifs (salon_id, canal, motif, texte)
  values (v.salon_id, v.canal, v_motif, case when v_motif = 'autre' then v_txt end)
  returning id into v_mid;
  update public.lx_desinscription_codes
     set utilise_le = now(), motif_id = v_mid, avant_email_ok = v_avant_email, avant_sms_stop = v_avant_sms
   where code = v.code;

  begin
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (v.salon_id, 'RGPD_UNSUBSCRIBE',
            'Client ' || trim(coalesce(v.prenom,'') || ' ' || coalesce(v.nom,'')) || ' désabonné (' || v.canal || ') via le lien de désinscription'
            || case when v.canal in ('sms', 'all') then ' : plus aucun SMS publicitaire (campagnes, anniversaire, relance), de tous les établissements Luxyra ; les rappels et confirmations de RDV continuent' else '' end
            || ' — motif : ' || lx_prive.desinscription_motif_libelle(v_motif),
            'Auto (lien de désinscription)');
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'deja', false, 'canal', v.canal, 'salon', coalesce(v_salon, ''),
                            'sms_global', v.canal in ('sms', 'all'), 'annulable', true);
end $function$;
revoke all on function public.lx_desinscrire_code(text, text, text, text) from public, anon, authenticated;
grant execute on function public.lx_desinscrire_code(text, text, text, text) to service_role;

-- 4. Réinscription (« je me suis trompé(e) ») -----------------------------------------------------------
create or replace function public.lx_annuler_desinscription(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
-- 2026-10-17 : annule une désinscription faite par CE lien il y a 48 h au plus ; rétablit l'état d'avant :
--   e-mail : email_ok = true seulement s'il l'était avant ; SMS : retire l'opposition seulement si ce lien l'a créée
--   et qu'aucun STOP n'est arrivé depuis (maj_le inchangée). Sinon : refus motivé (support / établissement).
declare v record; v_salon text; v_tel text; v_n int := 0;
begin
  if coalesce(p_code, '') !~ '^([0-9a-f]{10}|[a-z0-9]{6})$' then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide'); end if;
  select d.code, d.canal, d.client_id, d.utilise_le, d.motif_id, d.avant_email_ok, d.avant_sms_stop, c.salon_id, c.prenom, c.nom, c.telephone into v
    from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
   where d.code = p_code or d.code_court = p_code
   limit 1
   for update of d;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide ou expiré'); end if;
  select s.nom into v_salon from public.salons s where s.id = v.salon_id;
  if v.utilise_le is null then
    return jsonb_build_object('ok', true, 'deja', true, 'canal', v.canal, 'salon', coalesce(v_salon, ''));
  end if;
  if v.motif_id is null or v.utilise_le < now() - interval '48 hours' then
    return jsonb_build_object('ok', false, 'erreur', 'La réinscription par ce lien n''est plus possible (48 h). Demandez-la à l''établissement ou à support@luxyra.fr.', 'trop_tard', true);
  end if;
  v_tel := public.normalize_phone(v.telephone);
  if v.canal in ('sms', 'all') and v_tel is not null and v.avant_sms_stop is false then
    delete from public.lx_sms_stop
     where telephone_norm = v_tel and source = 'lien_desinscription' and maj_le <= v.utilise_le + interval '1 minute';
    get diagnostics v_n = row_count;
    if v_n = 0 and exists (select 1 from public.lx_sms_stop where telephone_norm = v_tel) then
      return jsonb_build_object('ok', false, 'erreur', 'Votre numéro a demandé l''arrêt des SMS publicitaires depuis (réponse STOP) : la réinscription doit se faire en répondant START ou auprès de support@luxyra.fr.');
    end if;
  end if;
  if v.canal in ('email', 'all') and v.avant_email_ok is true then
    update public.clients set email_ok = true, updated_at = now() where id = v.client_id;
  end if;
  update public.lx_desinscription_motifs set annule_le = now() where id = v.motif_id;
  update public.lx_desinscription_codes set utilise_le = null, motif_id = null, avant_email_ok = null, avant_sms_stop = null where code = v.code;
  begin
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (v.salon_id, 'RGPD_RESUBSCRIBE',
            'Client ' || trim(coalesce(v.prenom,'') || ' ' || coalesce(v.nom,'')) || ' a annulé sa désinscription (' || v.canal || ') depuis la page du lien : état d''avant rétabli',
            'Auto (lien de désinscription)');
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'deja', false, 'canal', v.canal, 'salon', coalesce(v_salon, ''));
end $function$;
revoke all on function public.lx_annuler_desinscription(text) from public, anon, authenticated;
grant execute on function public.lx_annuler_desinscription(text) to service_role;

-- 5. Infos pour la page ---------------------------------------------------------------------------------
create or replace function public.lx_desinscription_info(p_code text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  -- 2026-10-17 audit réglages (#4) ; lien court : code long (10 hex) ou court (6 [a-z0-9])
  -- 2026-10-17 motifs : deja = lien déjà utilisé OU état déjà atteint (e-mail : email_ok faux ; SMS : numéro déjà
  --   opposé aux SMS publicitaires) ; annulable = désinscription faite par ce lien il y a moins de 48 h.
  select coalesce((select jsonb_build_object('ok', true, 'canal', d.canal, 'salon', coalesce(s.nom, ''),
                                             'deja', d.utilise_le is not null
                                                     or (d.canal = 'email' and c.email_ok is not true)
                                                     or (d.canal = 'sms' and lx_prive.sms_pub_bloque(c.telephone))
                                                     or (d.canal = 'all' and c.email_ok is not true and lx_prive.sms_pub_bloque(c.telephone)),
                                             'annulable', d.utilise_le is not null and d.motif_id is not null and d.utilise_le >= now() - interval '48 hours',
                                             'sms_global', d.canal in ('sms', 'all'))
                     from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
                     left join public.salons s on s.id = c.salon_id
                    where coalesce(p_code, '') ~ '^([0-9a-f]{10}|[a-z0-9]{6})$'
                      and (d.code = p_code or d.code_court = p_code)
                    limit 1), jsonb_build_object('ok', false))
$function$;
revoke all on function public.lx_desinscription_info(text) from public, anon, authenticated;
grant execute on function public.lx_desinscription_info(text) to service_role;

-- 6. Statistiques admin ---------------------------------------------------------------------------------
create or replace function public.admin_desinscriptions_stats(p_jours int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
-- 2026-10-17 : panel admin › Communication › Désinscriptions. p_jours : 30, 90 ou null/0 = tout.
declare v_depuis timestamptz := case when coalesce(p_jours, 0) > 0 then now() - make_interval(days => p_jours) else '-infinity'::timestamptz end;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  return jsonb_build_object(
    'jours', nullif(coalesce(p_jours, 0), 0),
    'totaux', (select jsonb_build_object(
                 'j30',  count(*) filter (where annule_le is null and cree_le >= now() - interval '30 days'),
                 'j90',  count(*) filter (where annule_le is null and cree_le >= now() - interval '90 days'),
                 'tout', count(*) filter (where annule_le is null),
                 'annulees', count(*) filter (where annule_le is not null and cree_le >= v_depuis))
                 from public.lx_desinscription_motifs),
    'par_motif', coalesce((select jsonb_agg(jsonb_build_object('motif', motif, 'libelle', lx_prive.desinscription_motif_libelle(motif), 'n', n) order by n desc, motif)
                             from (select motif, count(*) n from public.lx_desinscription_motifs
                                    where annule_le is null and cree_le >= v_depuis group by motif) x), '[]'::jsonb),
    'par_canal', coalesce((select jsonb_agg(jsonb_build_object('canal', canal, 'n', n) order by n desc)
                             from (select canal, count(*) n from public.lx_desinscription_motifs
                                    where annule_le is null and cree_le >= v_depuis group by canal) x), '[]'::jsonb),
    'par_salon', coalesce((select jsonb_agg(jsonb_build_object('salon_id', x.salon_id, 'nom', coalesce(s.nom, '(établissement supprimé)'), 'n', x.n, 'sms', x.sms, 'email', x.email) order by x.n desc)
                             from (select salon_id, count(*) n, count(*) filter (where canal in ('sms', 'all')) sms, count(*) filter (where canal in ('email', 'all')) email
                                     from public.lx_desinscription_motifs where annule_le is null and cree_le >= v_depuis
                                    group by salon_id order by count(*) desc limit 30) x
                             left join public.salons s on s.id = x.salon_id), '[]'::jsonb),
    'autres', coalesce((select jsonb_agg(jsonb_build_object('cree_le', m.cree_le, 'canal', m.canal, 'salon', coalesce(s.nom, '—'), 'texte', m.texte) order by m.cree_le desc)
                          from (select * from public.lx_desinscription_motifs
                                 where motif = 'autre' and annule_le is null and cree_le >= v_depuis
                                 order by cree_le desc limit 50) m
                          left join public.salons s on s.id = m.salon_id), '[]'::jsonb));
end $function$;
revoke all on function public.admin_desinscriptions_stats(int) from public, anon;
grant execute on function public.admin_desinscriptions_stats(int) to authenticated;

-- 7. Encart de l'app pro (son établissement, 30 jours, sans texte libre) -----------------------------------
create or replace function public.lx_salon_desinscriptions(p_salon uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public', 'pg_temp' as $function$
-- 2026-10-17 : app pro › Paramètres › SMS et Marketing. Propriétaire de l'établissement seulement.
begin
  if auth.uid() is null or not exists (select 1 from public.salons s where s.id = p_salon and s.user_id = auth.uid()) then
    return jsonb_build_object('ok', false, 'erreur', 'Accès refusé');
  end if;
  return jsonb_build_object('ok', true,
    'total', (select count(*) from public.lx_desinscription_motifs where salon_id = p_salon and annule_le is null and cree_le >= now() - interval '30 days'),
    'sms',   (select count(*) from public.lx_desinscription_motifs where salon_id = p_salon and annule_le is null and cree_le >= now() - interval '30 days' and canal in ('sms', 'all')),
    'email', (select count(*) from public.lx_desinscription_motifs where salon_id = p_salon and annule_le is null and cree_le >= now() - interval '30 days' and canal in ('email', 'all')),
    'motifs', coalesce((select jsonb_agg(jsonb_build_object('libelle', lx_prive.desinscription_motif_libelle(motif), 'n', n) order by n desc, motif)
                          from (select motif, count(*) n from public.lx_desinscription_motifs
                                 where salon_id = p_salon and annule_le is null and cree_le >= now() - interval '30 days'
                                 group by motif) x), '[]'::jsonb));
end $function$;
revoke all on function public.lx_salon_desinscriptions(uuid) from public, anon;
grant execute on function public.lx_salon_desinscriptions(uuid) to authenticated;

-- =====================================================================================================
-- 8. Bot de support : entrée desinscription_motifs_1017 (voir support_bot_kb ; texte appliqué ci-dessous)
-- =====================================================================================================
insert into public.support_bot_kb (cle, titre, ordre, contenu, actif, maj_le)
values ('desinscription_motifs_1017', 'Page de désinscription, motifs et statistiques', 62,
$kb$Page de désinscription (lien « Stop SMS: luxyra.fr/s/… » des SMS publicitaires et lien « Se désinscrire » des e-mails d'offres) :
- Ouvrir le lien ne désinscrit personne : le client voit une page Luxyra avec le nom de l'établissement, choisit un motif (obligatoire) puis confirme. Motifs : Trop de messages ; Les offres ne m'intéressent pas ; Je ne viens plus dans cet établissement ; Je ne me suis jamais inscrit(e) ; Je préfère être contacté(e) autrement ; Autre (précision obligatoire, 5 à 300 caractères).
- SMS : la désinscription arrête les SMS publicitaires (campagnes, anniversaire, relance) de TOUS les établissements Luxyra pour ce numéro, comme une réponse STOP. Les rappels et confirmations de rendez-vous continuent.
- E-mail : la désinscription arrête les e-mails d'offres de CET établissement seulement. Les e-mails liés aux rendez-vous continuent.
- Erreur : pendant 48 h, la même page propose « Je me suis trompé(e) : me réinscrire », qui rétablit exactement l'état d'avant. Ensuite : le client répond START au SMS ou écrit à support@luxyra.fr.
- Les messageries qui proposent « Se désabonner » en un clic désinscrivent directement (motif « en un clic »).
- Statistiques pour l'établissement : Paramètres › SMS et Marketing › encart « Désinscriptions de vos clients (30 jours) » (nombre, SMS / e-mail, principaux motifs). Les textes libres ne sont pas montrés à l'établissement (ils pourraient identifier un client). Aucun numéro ni e-mail n'est conservé avec le motif.
- Beaucoup de « Trop de messages » : espacez les campagnes ; « Je ne me suis jamais inscrit(e) » : vérifiez le consentement recueilli à la création de la fiche.$kb$, true, now())
on conflict (cle) do update set titre = excluded.titre, contenu = excluded.contenu, actif = true, maj_le = now();

-- Bot (APPLIQUÉ 17/10) : desinscription_marketing_1017 — « ou depuis son espace client » (préférences du compte NON
-- synchronisées vers les fiches des établissements, cf. TODO compte.html toggleNotif) remplacé par « ou, dans les 48 h,
-- en rouvrant le lien et en touchant « Je me suis trompé(e) : me réinscrire » ».
-- =====================================================================================================
-- TESTS (17/10/2026 ~20 h, client réel de Delphinecoiff, DO … RAISE EXCEPTION => tout annulé, rien de conservé) :
--   info (code neuf)             -> deja false, annulable false, sms_global true
--   page sans motif              -> {ok:false, champ:motif, « Choisissez un motif »}
--   motif inconnu                -> {ok:false, champ:motif, « Motif invalide »}
--   autre « <b> » / 301 car.     -> {ok:false, champ:texte, « Précisez votre motif (5 à 300 caractères) »}
--   autre « Trop <script>x</script>\n souvent » -> ok ; stocké « Trop script x /script souvent » (chevrons/contrôles retirés)
--   après : lx_sms_stop présent, clients.sms_ok reste VRAI (rappels gardés) ; info deja true, annulable true
--   rejoué avec autre motif      -> {ok:true, deja:true}, toujours 1 seule ligne de motif
--   lx_annuler_desinscription    -> ok ; lx_sms_stop supprimé ; motif annule_le rempli ; info deja false
--   un clic (p_source un_clic)   -> ok, motif « un_clic »
--   STOP reçu après (maj_le +5 min) -> annulation refusée (« … répondant START … »), opposition conservée
--   49 h après                   -> annulation refusée (trop_tard) ; info annulable false
--   e-mail (motif ne_vient_plus, texte ignoré) -> email_ok false, texte NULL ; annulation -> email_ok true (était vrai)
--   ancien appel lx_desinscrire_code(code) (worker actuel) -> fonctionne (motif « non_precise »)
--   admin_desinscriptions_stats (support@ en aal2) -> totaux / par motif / canal / salon / autres OK ;
--     propriétaire d'un salon -> « Accès réservé à l'administrateur »
--   lx_salon_desinscriptions : propriétaire -> chiffres de SON salon ; autre salon ou admin non propriétaire -> Accès refusé
--   Droits : lx_desinscrire_code / lx_annuler_desinscription / lx_desinscription_info = service_role seulement ;
--     admin_desinscriptions_stats / lx_salon_desinscriptions = authenticated (contrôle interne) ;
--     table lx_desinscription_motifs : RLS activée, aucun droit anon/authenticated.
-- =====================================================================================================
