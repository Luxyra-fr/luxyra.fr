-- 2026-10-31 audit final (contre-audit + notation), lot sécurité admin 2. Script rejouable.
-- Aucune fonction de caisse / NF525 modifiée (creer_ticket_avoir, bons, packs, clôtures, factures, Z : inchangées).

-- 1) Plus de passe-droit admin pour agir à la place d'un établissement (la vue admin est en lecture seule) :
--    SMS de campagne, fusion de fiches clients, connexion d'un opérateur (PIN / biométrie).
--    Le propriétaire de l'établissement et les appels serveur (sans utilisateur) gardent exactement les mêmes droits.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.lx_sms_campagne_enfiler(uuid,jsonb,text,text)'::regprocedure);
  if position('IF NOT public.is_admin() THEN RETURN jsonb_build_object(''ok'', false, ''erreur'', ''Accès refusé''); END IF;' in d) > 0 then
    execute replace(d, 'IF NOT public.is_admin() THEN RETURN jsonb_build_object(''ok'', false, ''erreur'', ''Accès refusé''); END IF;',
                       'RETURN jsonb_build_object(''ok'', false, ''erreur'', ''Accès refusé'');  -- 2026-10-31 : plus de passe-droit admin');
  end if;

  d := pg_get_functiondef('public.merge_client_duplicates(uuid,uuid)'::regprocedure);
  if position('IF v_user_id IS NOT NULL AND NOT public.is_admin() THEN' in d) > 0 then
    execute replace(d, 'IF v_user_id IS NOT NULL AND NOT public.is_admin() THEN',
                       'IF v_user_id IS NOT NULL THEN  -- 2026-10-31 : plus de passe-droit admin');
  end if;

  d := pg_get_functiondef('public.operateur_verifier_pin(uuid,text)'::regprocedure);
  if position('if not (public.is_admin() or exists' in d) > 0 then
    execute replace(d, 'if not (public.is_admin() or exists', 'if not (exists');
  end if;

  d := pg_get_functiondef('public.operateur_connexion_bio(uuid)'::regprocedure);
  if position('if not (public.is_admin() or exists' in d) > 0 then
    execute replace(d, 'if not (public.is_admin() or exists', 'if not (exists');
  end if;
end $$;

-- 2) Journal admin (admin_log) : écriture uniquement par les fonctions serveur (admin_journal, déclencheurs, worker),
--    plus d'insertion directe depuis le navigateur ; plus aucun droit pour anon ; inaltérable.
revoke all on public.admin_log from anon;
revoke insert, update, delete, truncate on public.admin_log from authenticated;
drop policy if exists admin_log_insert on public.admin_log;

create or replace function lx_prive.admin_log_inalterable()
returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $f$
begin
  -- seule exception : la clé étrangère « ON DELETE SET NULL » quand un établissement est supprimé
  -- (salon_id passe à NULL, tout le reste identique)
  if tg_op = 'UPDATE' and old.salon_id is not null and new.salon_id is null
     and (to_jsonb(old) - 'salon_id') = (to_jsonb(new) - 'salon_id') then
    return new;
  end if;
  raise exception 'Journal admin : ni modifiable ni effaçable' using errcode = '42501';
end $f$;
drop trigger if exists trg_admin_log_inalterable on public.admin_log;
create trigger trg_admin_log_inalterable before update or delete on public.admin_log
  for each row execute function lx_prive.admin_log_inalterable();
drop trigger if exists trg_admin_log_pas_de_truncate on public.admin_log;
create trigger trg_admin_log_pas_de_truncate before truncate on public.admin_log
  for each statement execute function lx_prive.admin_log_inalterable();

-- 3) Suppression d'un établissement : le journal admin n'est plus effacé (la clé étrangère met salon_id à NULL).
--    Seule la liste des tables change ; le reste de la fonction (garde-fous fiscaux compris) est identique.
do $$
declare d text := pg_get_functiondef('public.admin_delete_salon_cascade(uuid)'::regprocedure);
begin
  if position($q$'admin_log','inscriptions_log',$q$ in d) > 0 then
    d := replace(d, $q$'admin_log','inscriptions_log',$q$, $q$'inscriptions_log',$q$);
    d := replace(d, $q$v_keep text[] := ARRAY['factures_luxyra'];$q$, $q$v_keep text[] := ARRAY['factures_luxyra','admin_log'];  -- 2026-10-31 : journal admin conservé$q$);
    if position($q$ARRAY['factures_luxyra','admin_log']$q$ in d) = 0 then raise exception 'v_keep introuvable'; end if;
    execute d;
  end if;
end $$;

-- 4) Traces automatiques : noms, prénoms, motifs libres et e-mails des opérateurs masqués
do $$
declare d text := pg_get_functiondef('lx_prive.admin_journal_auto'::regproc);
  -- (le nom d'un établissement — table salons — reste lisible : ce n'est pas une personne du journal)
  a2 text := $q$(k = 'email' and tg_table_name like 'annuaire_%')$q$;
  b2 text := $q$(k = 'email' and (tg_table_name like 'annuaire_%' or tg_table_name = 'salon_operateurs'))
         or (k in ('nom', 'prenom', 'motif') and tg_table_name <> 'salons')$q$;
begin
  if position('salon_operateurs''))' in d) > 0 then return; end if;
  if position(a2 in d) = 0 then raise exception 'motif introuvable (appliquer f6 avant)'; end if;
  execute replace(d, a2, b2);
end $$;

-- 5) Tableau de bord : une seule règle « compte test » pour les essais (nom Démo ou offre gratuite en cours ;
--    un essai est toujours en caisse test, ce n'est donc pas le mode de caisse qui compte ici)
do $$
declare d text := pg_get_functiondef('public.admin_tableau_de_bord()'::regprocedure);
begin
  if position('lx_prive.salon_est_test(null, nom' in d) > 0 then return; end if;
  d := replace(d, $q$count(*) filter (where status = 'trial' and not lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))$q$,
                  $q$count(*) filter (where status = 'trial' and not lx_prive.salon_est_test(null, nom, is_free, free_until))$q$);
  d := replace(d, $q$trial_end < now() + interval '7 days'
     and not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo';$q$,
                  $q$trial_end < now() + interval '7 days'
     and not lx_prive.salon_est_test(null, nom, is_free, free_until);  -- 2026-10-31 : même règle « test » partout (essai = caisse test par nature)$q$);
  d := replace(d, $q$and status not in ('active','past_due')
     and not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo'$q$,
                  $q$and status not in ('active','past_due')
     and not lx_prive.salon_est_test(null, nom, is_free, free_until)$q$);
  if (length(d) - length(replace(d, 'salon_est_test(null, nom', ''))) / length('salon_est_test(null, nom') <> 3 then raise exception 'remplacements incomplets'; end if;
  execute d;
end $$;

-- 6) Revenus › Bons cadeaux : lecture seule pour l'admin (encours par établissement). Aucune écriture.
create or replace function public.admin_bons_cadeaux_etat()
returns jsonb language plpgsql stable security definer set search_path to 'public', 'lx_prive', 'pg_temp' as $f$
declare v jsonb; t jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;
  with b as (
    select c.salon_id, c.valeur, coalesce(c.restant, 0) restant, coalesce(c.utilise, 0) utilise, c.status, c.date_expiration, c.source
      from public.cartes_cadeaux c
     where coalesce(c.payment_status, 'paid') not in ('pending', 'failed', 'expired', 'canceled')
  ), g as (
    select b.salon_id,
           count(*) emis, coalesce(sum(b.valeur), 0) valeur_emise, coalesce(sum(b.utilise), 0) utilise,
           count(*) filter (where b.status = 'used' or b.restant <= 0) utilises,
           count(*) filter (where b.restant > 0 and b.date_expiration is not null and b.date_expiration < current_date) expires,
           coalesce(sum(b.restant) filter (where b.restant > 0 and b.status not in ('cancelled', 'annule') and (b.date_expiration is null or b.date_expiration >= current_date)), 0) encours,
           coalesce(sum(b.restant) filter (where b.restant > 0 and b.date_expiration is not null and b.date_expiration < current_date), 0) restant_expire,
           count(*) filter (where b.source = 'online') en_ligne
      from b group by b.salon_id
  )
  select coalesce(jsonb_agg(jsonb_build_object('salon_id', g.salon_id, 'nom', s.nom,
           'test', lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until),
           'emis', g.emis, 'valeur_emise', g.valeur_emise, 'utilise', g.utilise, 'utilises', g.utilises,
           'expires', g.expires, 'encours', g.encours, 'restant_expire', g.restant_expire, 'en_ligne', g.en_ligne)
         order by g.encours desc), '[]'::jsonb)
    into v from g left join public.salons s on s.id = g.salon_id;
  select jsonb_build_object('emis', coalesce(sum((e->>'emis')::int), 0), 'encours', coalesce(sum((e->>'encours')::numeric), 0),
           'utilise', coalesce(sum((e->>'utilise')::numeric), 0), 'expires', coalesce(sum((e->>'expires')::int), 0))
    into t from jsonb_array_elements(v) e where not (e->>'test')::boolean;
  return jsonb_build_object('etablissements', v, 'total_reels', t, 'genere_le', now());
end $f$;
revoke all on function public.admin_bons_cadeaux_etat() from public, anon;
grant execute on function public.admin_bons_cadeaux_etat() to authenticated;
