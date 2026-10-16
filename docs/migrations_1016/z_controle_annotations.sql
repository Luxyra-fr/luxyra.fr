-- 2026-10-16 — Incident Z n°128 (Excellence Coiffure) — accord d'Alexandre (« oui ») — NF525
-- 1) Garde-fou serveur : une clôture Z dont le total TTC diffère du journal des tickets du jour est REFUSÉE
--    (même règle que check_fiscal_integrity §2 : somme des tickets status <> 'cancelled' de la date ; tickets du mode de
--    caisse de la Z). Le nombre de tickets déclaré ne peut pas dépasser le nombre de tickets du journal (Z manuelles ;
--    la clôture automatique de nuit compte encore les RDV groupés liés -> contrôle du nombre non appliqué pour elle).
-- 2) Annotations correctives des Z (clotures_annotations) : la Z n'est JAMAIS modifiée ; l'annotation porte les montants
--    exacts (relus dans le journal des tickets par le serveur), chaînée (SHA-256 + précédente), inaltérable, inscrite au
--    JET (code 900 « Intervention éditeur tracée »). Les cumuls (mois / année / grand total perpétuel / ZM / exercice)
--    utilisent les montants corrigés.
-- 3) check_fiscal_integrity §2 et check_cumul_clotures_periodiques tiennent compte des annotations.
-- Idempotent. Aucune ligne scellée (tickets, clotures, signatures, JET) n'est modifiée ni supprimée.

-- ===================================================================== 2. table des annotations
create table if not exists public.clotures_annotations (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null references public.salons(id),
  num integer not null,
  cloture_id uuid not null unique references public.clotures(id),
  cloture_num integer not null,
  cloture_date date not null,
  cloture_hash text,
  motif text not null check (length(btrim(motif)) >= 10),
  wrong_total_ca numeric not null,
  wrong_total_ht numeric not null,
  wrong_nb_tickets integer not null,
  wrong_detail_paiements jsonb not null default '{}'::jsonb,
  correct_total_ca numeric not null,
  correct_total_ht numeric not null,
  correct_nb_tickets integer not null,
  correct_detail_paiements jsonb not null default '{}'::jsonb,
  version_corrigee text,
  operateur text,
  jet_id uuid,
  created_at timestamptz not null default now(),
  hash text not null,
  prev_hash text,
  hash_algo text not null default 'SHA-256',
  unique (salon_id, num)
);
comment on table public.clotures_annotations is 'NF525 : annotation corrective signée d''une clôture Z (Z jamais modifiée). Montants exacts relus dans le journal des tickets ; chaînage SHA-256 ; inaltérable ; JET 900.';
alter table public.clotures_annotations enable row level security;
revoke all on public.clotures_annotations from anon, authenticated;
grant select on public.clotures_annotations to authenticated;
grant all on public.clotures_annotations to service_role;
drop policy if exists clotures_annotations_lecture on public.clotures_annotations;
create policy clotures_annotations_lecture on public.clotures_annotations for select to authenticated
  using (exists (select 1 from public.salons s where s.id = clotures_annotations.salon_id and s.user_id = auth.uid()) or public.is_admin());

drop trigger if exists clotures_annotations_inalterable on public.clotures_annotations;
create trigger clotures_annotations_inalterable before update or delete on public.clotures_annotations
  for each row execute function public.clotures_periodiques_inalterable();

-- Journal des tickets d'une journée (règle unique : Z, annotation, contrôle) : total, nombre (paires annulées le même jour
-- exclues), détail des règlements (detail_paiement + corrections de règlement « avant clôture »).
create or replace function lx_prive.z_journal_tickets(p_salon uuid, p_date date, p_mode text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_total numeric; v_nb int; v_det jsonb := '{}'::jsonb; r record;
begin
  with t as (
    select x.*, x.raw_data->>'tkNum' tk from public.tickets x
     where x.salon_id = p_salon and x.date_ticket = p_date and x.status <> 'cancelled'
       and (x.mode_caisse is null or p_mode is null or x.mode_caisse = p_mode)
  ), contra as (
    select t.id, t.raw_data->>'cancelRef' ref from t
     where coalesce(t.raw_data->>'contraSameDay','') = 'true'
        or (coalesce(t.raw_data->>'isCancel','') = 'true' and (t.raw_data->>'cancelRef') in (select tk from t where tk is not null))
  )
  select coalesce(round(sum(t.total_ttc),2),0),
         count(*) filter (where t.id not in (select id from contra) and coalesce(t.tk,'#') not in (select coalesce(ref,'##') from contra))
    into v_total, v_nb from t;
  for r in
    select k, round(sum(v),2) v from (
      select d.key k, (d.value)::numeric v from public.tickets x, jsonb_each_text(case when jsonb_typeof(x.detail_paiement)='object' then x.detail_paiement else '{}'::jsonb end) d
       where x.salon_id = p_salon and x.date_ticket = p_date and x.status <> 'cancelled' and (x.mode_caisse is null or p_mode is null or x.mode_caisse = p_mode)
      union all
      select l->>'mode', (l->>'montant')::numeric from public.corrections_reglement c, jsonb_array_elements(case when jsonb_typeof(c.lignes)='array' then c.lignes else '[]'::jsonb end) l
       where c.salon_id = p_salon and c.ticket_date = p_date and c.avant_cloture is true
    ) z group by k
  loop v_det := v_det || jsonb_build_object(r.k, r.v); end loop;
  return jsonb_build_object('total', v_total, 'nb', v_nb, 'detail', v_det);
end $$;
revoke all on function lx_prive.z_journal_tickets(uuid, date, text) from public, anon, authenticated;

-- Avant insertion d'une annotation : montants d'origine relus sur la Z, montants exacts vérifiés contre le journal,
-- numéro, chaînage, empreinte, JET 900.
create or replace function lx_prive.clotures_annotations_avant()
returns trigger language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare z record; j jsonb; v_siret text;
begin
  select * into z from public.clotures where id = NEW.cloture_id;
  if not found then raise exception 'Annotation : clôture Z introuvable'; end if;
  if NEW.salon_id is distinct from z.salon_id then raise exception 'Annotation : la clôture appartient à un autre établissement'; end if;
  NEW.cloture_num := z.num; NEW.cloture_date := z.date_cloture; NEW.cloture_hash := z.hash;
  NEW.wrong_total_ca := z.total_ca; NEW.wrong_total_ht := z.total_ht; NEW.wrong_nb_tickets := z.nb_tickets;
  NEW.wrong_detail_paiements := coalesce(z.detail_paiements, '{}'::jsonb);
  j := lx_prive.z_journal_tickets(z.salon_id, z.date_cloture, z.mode_caisse);
  if abs(NEW.correct_total_ca - (j->>'total')::numeric) > 0.005 then
    raise exception 'Annotation refusée : montant corrigé % différent du journal des tickets %', NEW.correct_total_ca, j->>'total';
  end if;
  if NEW.correct_nb_tickets <> (j->>'nb')::int then
    raise exception 'Annotation refusée : nombre corrigé % différent du journal des tickets %', NEW.correct_nb_tickets, j->>'nb';
  end if;
  perform pg_advisory_xact_lock(hashtext('clotures_annotations_' || NEW.salon_id::text));
  select coalesce(max(num), 0) + 1 into NEW.num from public.clotures_annotations where salon_id = NEW.salon_id;
  select hash into NEW.prev_hash from public.clotures_annotations where salon_id = NEW.salon_id order by num desc limit 1;
  select coalesce(siret, '') into v_siret from public.salons where id = NEW.salon_id;
  NEW.created_at := now(); NEW.hash_algo := 'SHA-256';
  NEW.hash := upper(encode(extensions.digest(
    'ZC|' || NEW.num || '|' || NEW.cloture_num || '|' || to_char(NEW.cloture_date, 'YYYY-MM-DD') || '|' ||
    to_char(NEW.wrong_total_ca, 'FM999999990.00') || '|' || NEW.wrong_nb_tickets || '|' ||
    to_char(NEW.correct_total_ca, 'FM999999990.00') || '|' || to_char(NEW.correct_total_ht, 'FM999999990.00') || '|' ||
    NEW.correct_nb_tickets || '|' || NEW.correct_detail_paiements::text || '|' || coalesce(NEW.cloture_hash, '') || '|' ||
    coalesce(NEW.prev_hash, '') || '|' || v_siret, 'sha256'), 'hex'));
  NEW.jet_id := public.nf525_jet_ajouter(NEW.salon_id, 900,
    'ANNOTATION_CORRECTIVE_Z n°' || NEW.num || ' — Z n°' || NEW.cloture_num || ' du ' || to_char(NEW.cloture_date, 'DD/MM/YYYY') ||
    ' (empreinte Z ' || coalesce(NEW.cloture_hash, '?') || ') : clôture ' || NEW.wrong_nb_tickets || ' ticket(s) / ' || to_char(NEW.wrong_total_ca, 'FM999999990.00') ||
    ' EUR ; journal des tickets ' || NEW.correct_nb_tickets || ' ticket(s) / ' || to_char(NEW.correct_total_ca, 'FM999999990.00') ||
    ' EUR. Motif : ' || NEW.motif || coalesce(' — version corrigée ' || NEW.version_corrigee, '') || ' — empreinte annotation ' || NEW.hash,
    coalesce(NEW.operateur, 'Luxyra (éditeur)'));
  return NEW;
end $$;
revoke all on function lx_prive.clotures_annotations_avant() from public, anon, authenticated;
drop trigger if exists a_clotures_annotations_avant on public.clotures_annotations;
create trigger a_clotures_annotations_avant before insert on public.clotures_annotations
  for each row execute function lx_prive.clotures_annotations_avant();

-- Création d'une annotation : éditeur seulement (admin 2FA ou rôle serveur). Montants exacts = journal des tickets.
create or replace function public.nf525_annoter_cloture(p_cloture uuid, p_motif text, p_operateur text default null, p_version text default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare z record; j jsonb; v_ht numeric; v_det jsonb := '{}'::jsonb; k text; v_id uuid; v_hash text; v_num int;
begin
  if auth.uid() is not null and not public.is_admin() then raise exception 'Réservé à l''éditeur'; end if;
  select * into z from public.clotures where id = p_cloture;
  if not found then raise exception 'Clôture Z introuvable'; end if;
  j := lx_prive.z_journal_tickets(z.salon_id, z.date_cloture, z.mode_caisse);
  if abs(z.total_ca - (j->>'total')::numeric) <= 0.005 and z.nb_tickets = (j->>'nb')::int then
    raise exception 'La clôture Z n°% est conforme au journal des tickets : aucune annotation nécessaire', z.num;
  end if;
  -- HT exact : même calcul que la Z (montant TTC ramené au taux de la Z, à 2 décimales)
  v_ht := case when coalesce(z.total_ca, 0) <> 0 then round((j->>'total')::numeric * z.total_ht / z.total_ca, 2) else 0 end;
  foreach k in array array['cb','esp','chq','bon','vir','aut','enligne'] loop
    v_det := v_det || jsonb_build_object(k, coalesce((j->'detail'->>k)::numeric, 0));
  end loop;
  insert into public.clotures_annotations (salon_id, num, cloture_id, cloture_num, cloture_date, motif,
      wrong_total_ca, wrong_total_ht, wrong_nb_tickets, correct_total_ca, correct_total_ht, correct_nb_tickets,
      correct_detail_paiements, version_corrigee, operateur, hash)
    values (z.salon_id, 0, z.id, z.num, z.date_cloture, p_motif, 0, 0, 0, (j->>'total')::numeric, v_ht, (j->>'nb')::int,
      v_det, p_version, coalesce(p_operateur, 'Luxyra (éditeur)'), '')
    returning id, hash, num into v_id, v_hash, v_num;
  insert into public.audit_log (salon_id, action, details, operator_name)
    values (z.salon_id, 'Z_ANNOTATION_CORRECTIVE', 'Annotation n°' || v_num || ' de la Z n°' || z.num || ' du ' || z.date_cloture ||
      ' : ' || z.total_ca || ' -> ' || (j->>'total') || ' EUR, ' || z.nb_tickets || ' -> ' || (j->>'nb') || ' ticket(s). Empreinte ' || v_hash,
      coalesce(p_operateur, 'Luxyra (éditeur)'));
  return jsonb_build_object('ok', true, 'id', v_id, 'num', v_num, 'hash', v_hash, 'journal', j);
end $$;
revoke all on function public.nf525_annoter_cloture(uuid, text, text, text) from public, anon;
grant execute on function public.nf525_annoter_cloture(uuid, text, text, text) to authenticated, service_role;

-- Écart (corrigé − clôturé) des Z annotées d'une période
create or replace function public.nf525_z_annotation_delta(p_salon uuid, p_du date, p_au date)
returns table(d_ca numeric, d_ht numeric, d_nb integer, d_det jsonb)
language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(a.correct_total_ca - a.wrong_total_ca), 0),
         coalesce(sum(a.correct_total_ht - a.wrong_total_ht), 0),
         coalesce(sum(a.correct_nb_tickets - a.wrong_nb_tickets), 0)::int,
         coalesce((select jsonb_object_agg(k, v) from (
            select x.k, round(sum(coalesce((a2.correct_detail_paiements->>x.k)::numeric, 0) - coalesce((a2.wrong_detail_paiements->>x.k)::numeric, 0)), 2) v
              from public.clotures_annotations a2
              cross join lateral jsonb_object_keys(a2.correct_detail_paiements || a2.wrong_detail_paiements) x(k)
             where a2.salon_id = p_salon and a2.cloture_date between p_du and p_au group by x.k) q), '{}'::jsonb)
    from public.clotures_annotations a
   where a.salon_id = p_salon and a.cloture_date between p_du and p_au;
$$;
revoke all on function public.nf525_z_annotation_delta(uuid, date, date) from public, anon;
grant execute on function public.nf525_z_annotation_delta(uuid, date, date) to authenticated, service_role;

-- ===================================================================== 1. garde-fou serveur sur les Z
create or replace function lx_prive.clotures_controle_journal()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_somme numeric; v_nb int; v_bypass text; v_d record; v_auto boolean;
begin
  begin v_bypass := current_setting('luxyra.allow_nf525_unlock', true); exception when others then v_bypass := null; end;
  select coalesce(sum(t.total_ttc), 0), count(*) into v_somme, v_nb from public.tickets t
   where t.salon_id = NEW.salon_id and t.date_ticket = NEW.date_cloture and t.status <> 'cancelled'
     and (t.mode_caisse is null or NEW.mode_caisse is null or t.mode_caisse = NEW.mode_caisse);
  v_auto := coalesce(NEW.raw_data->>'auto', '') = 'true';
  if abs(coalesce(NEW.total_ca, 0) - v_somme) > 0.005 or (not v_auto and coalesce(NEW.nb_tickets, 0) > v_nb) then
    if v_bypass = 'true' then
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (NEW.salon_id, 'NF525_INALTERABILITE_BYPASSEE', 'INSERT clotures Z n°' || NEW.num || ' différente du journal (' || NEW.total_ca || ' vs ' || v_somme || ') user=' || current_user, 'BYPASS_EXPLICITE');
    else
      raise exception 'LX_Z_ECART_JOURNAL : clôture Z n°% du % refusée — % EUR / % ticket(s) déclarés, journal des tickets % EUR / % ticket(s). Recalculez la clôture depuis les tickets enregistrés.',
        NEW.num, to_char(NEW.date_cloture, 'DD/MM/YYYY'), to_char(coalesce(NEW.total_ca, 0), 'FM999999990.00'), coalesce(NEW.nb_tickets, 0), to_char(v_somme, 'FM999999990.00'), v_nb
        using errcode = 'P0001';
    end if;
  end if;
  -- Cumuls : les Z annotées comptent pour leur montant corrigé (sauf si l'application l'a déjà fait : raw_data.lxAnnotOk)
  if coalesce(NEW.raw_data->>'lxAnnotOk', '') <> 'true' and exists (select 1 from public.clotures_annotations a where a.salon_id = NEW.salon_id and a.cloture_date < NEW.date_cloture) then
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('month', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_ca, 0) <> 0 then NEW.cumul_mois_ca := coalesce(NEW.cumul_mois_ca, 0) + v_d.d_ca; end if;
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('year', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_ca, 0) <> 0 then NEW.cumul_annee_ca := coalesce(NEW.cumul_annee_ca, 0) + v_d.d_ca; end if;
  end if;
  return NEW;
end $$;
revoke all on function lx_prive.clotures_controle_journal() from public, anon, authenticated;
drop trigger if exists b_nf525_z_controle_journal on public.clotures;
create trigger b_nf525_z_controle_journal before insert on public.clotures
  for each row execute function lx_prive.clotures_controle_journal();

-- Grand total perpétuel : + écarts des annotations créées depuis la Z précédente
create or replace function public.clotures_set_cumul_perpetuel()
 returns trigger language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
DECLARE v_ca numeric; v_tk integer; v_at timestamptz; v_dca numeric := 0; v_dtk integer := 0;
BEGIN
  IF NEW.cumul_perpetuel_ca IS NOT NULL THEN RETURN NEW; END IF;  -- valeur déjà posée (backfill) → respecter
  SELECT cumul_perpetuel_ca, cumul_perpetuel_tickets, created_at INTO v_ca, v_tk, v_at
    FROM clotures WHERE salon_id = NEW.salon_id AND cumul_perpetuel_ca IS NOT NULL
    ORDER BY num DESC LIMIT 1;
  -- 2026-10-16 : annotation corrective d'une Z déjà clôturée -> l'écart (corrigé − clôturé) entre dans le grand total
  -- de la première Z qui suit l'annotation (la Z annotée n'est jamais modifiée).
  SELECT coalesce(sum(correct_total_ca - wrong_total_ca), 0), coalesce(sum(correct_nb_tickets - wrong_nb_tickets), 0)
    INTO v_dca, v_dtk FROM clotures_annotations
   WHERE salon_id = NEW.salon_id AND (v_at IS NULL OR created_at > v_at);
  NEW.cumul_perpetuel_ca      := COALESCE(v_ca,0) + v_dca + COALESCE(NEW.total_ca,0);
  NEW.cumul_perpetuel_tickets := COALESCE(v_tk,0) + v_dtk + COALESCE(NEW.nb_tickets,0);
  RETURN NEW;
END $function$;

-- ===================================================================== 3. clôtures mensuelles / exercice
CREATE OR REPLACE FUNCTION public.cloturer_mois(p_salon_id uuid, p_annee integer, p_mois integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text; v_nb_jours int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0; v_cloture_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid; v_pay_keys text[]; v_k text; v_sum_pay numeric; v_d record; v_raw jsonb := null;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = p_salon_id AND user_id = v_user_id) AND NOT is_admin() THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;
  SELECT id INTO v_existing FROM clotures_mensuelles WHERE salon_id = p_salon_id AND annee = p_annee AND mois = p_mois;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing); END IF;
  SELECT siret INTO v_siret FROM salons WHERE id = p_salon_id;
  SELECT COUNT(*), COALESCE(SUM(nb_tickets),0), COALESCE(SUM(nb_annulations),0),
         COALESCE(SUM(total_ca),0), COALESCE(SUM(total_ht),0), array_agg(id ORDER BY date_cloture)
    INTO v_nb_jours, v_nb_tickets, v_nb_annul, v_ca, v_ht, v_cloture_ids
  FROM clotures WHERE salon_id = p_salon_id
    AND EXTRACT(YEAR FROM date_cloture)::int = p_annee
    AND EXTRACT(MONTH FROM date_cloture)::int = p_mois;
  IF v_nb_jours = 0 OR v_nb_jours IS NULL THEN
    RAISE EXCEPTION 'Aucune clôture journalière trouvée pour %-%, mois ne peut pas être clôturé', p_annee, p_mois;
  END IF;
  v_pay_keys := ARRAY(SELECT DISTINCT jsonb_object_keys(c.detail_paiements) FROM clotures c
    WHERE c.salon_id = p_salon_id AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee
      AND EXTRACT(MONTH FROM c.date_cloture)::int = p_mois AND c.detail_paiements IS NOT NULL);
  IF v_pay_keys IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_pay_keys LOOP
      SELECT COALESCE(SUM((c.detail_paiements->>v_k)::numeric), 0) INTO v_sum_pay
      FROM clotures c WHERE c.salon_id = p_salon_id
        AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee
        AND EXTRACT(MONTH FROM c.date_cloture)::int = p_mois
        AND c.detail_paiements ? v_k;
      v_detail_paiements := v_detail_paiements || jsonb_build_object(v_k, v_sum_pay);
    END LOOP;
  END IF;
  -- 2026-10-16 : Z annotées (annotation corrective signée) -> montants corrigés
  SELECT * INTO v_d FROM nf525_z_annotation_delta(p_salon_id, make_date(p_annee, p_mois, 1), (make_date(p_annee, p_mois, 1) + interval '1 month - 1 day')::date);
  IF coalesce(v_d.d_ca,0) <> 0 OR coalesce(v_d.d_nb,0) <> 0 OR coalesce(v_d.d_ht,0) <> 0 THEN
    v_ca := v_ca + v_d.d_ca; v_ht := v_ht + v_d.d_ht; v_nb_tickets := v_nb_tickets + v_d.d_nb;
    FOR v_k IN SELECT jsonb_object_keys(v_d.d_det) LOOP
      v_detail_paiements := v_detail_paiements || jsonb_build_object(v_k, COALESCE((v_detail_paiements->>v_k)::numeric, 0) + (v_d.d_det->>v_k)::numeric);
    END LOOP;
    v_raw := jsonb_build_object('annotations', (SELECT jsonb_agg(jsonb_build_object('num', a.num, 'z', a.cloture_num, 'hash', a.hash, 'ecart_ca', a.correct_total_ca - a.wrong_total_ca))
      FROM clotures_annotations a WHERE a.salon_id = p_salon_id AND EXTRACT(YEAR FROM a.cloture_date)::int = p_annee AND EXTRACT(MONTH FROM a.cloture_date)::int = p_mois));
  END IF;
  v_tva := v_ca - v_ht;
  SELECT hash INTO v_hash_prev FROM clotures_mensuelles WHERE salon_id = p_salon_id ORDER BY annee DESC, mois DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    'ZM|' || p_annee || '-' || p_mois || '|' || to_char(v_ca, 'FM9999999.99') || '|' || v_nb_tickets || '|' ||
    COALESCE(v_hash_prev, '') || '|' || COALESCE(v_siret, ''), 'sha256'), 'hex');
  INSERT INTO clotures_mensuelles (salon_id, annee, mois, nb_jours_clotures, nb_tickets, nb_annulations,
    total_ca, total_ht, total_tva, detail_paiements, cloture_ids, hash, hash_algo, hash_prev, operator_name, raw_data)
  VALUES (p_salon_id, p_annee, p_mois, v_nb_jours, v_nb_tickets, v_nb_annul,
    v_ca, v_ht, v_tva, v_detail_paiements, v_cloture_ids, v_hash, 'SHA-256', v_hash_prev, 'auto_cron', v_raw)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_MOIS', p_annee || '-' || LPAD(p_mois::text, 2, '0') || ' : ' || v_nb_jours || ' jours, ' ||
    v_nb_tickets || ' tickets, ' || to_char(v_ca, 'FM9999999.99') || ' EUR' || CASE WHEN v_raw IS NOT NULL THEN ' (Z annotées : montants corrigés)' ELSE '' END, 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'annee', p_annee, 'mois', p_mois,
    'nb_jours', v_nb_jours, 'nb_tickets', v_nb_tickets, 'total_ca', v_ca, 'total_ht', v_ht, 'total_tva', v_tva, 'hash', v_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.cloturer_exercice(p_salon_id uuid, p_date_fin date)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_mois int; v_siret text; v_existing uuid;
  v_prev_fin date; v_debut date; v_nb int; v_tk int; v_an int; v_ca numeric; v_ht numeric; v_ids uuid[];
  v_det jsonb := '{}'::jsonb; v_keys text[]; v_k text; v_s numeric;
  v_cp_ca numeric; v_cp_tk int; v_cp_at timestamptz; v_prev text; v_hash text; v_id uuid; v_d record; v_pca numeric; v_ptk int;
BEGIN
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM salons WHERE id = p_salon_id AND user_id = v_uid) AND NOT is_admin() THEN
    RAISE EXCEPTION 'Vous ne gérez pas ce salon';
  END IF;
  SELECT exercice_fin_mois, siret INTO v_mois, v_siret FROM salons WHERE id = p_salon_id;
  IF v_mois IS NULL THEN RAISE EXCEPTION 'Salon introuvable'; END IF;
  IF p_date_fin IS NULL OR p_date_fin <> lx_fin_exercice(extract(year FROM p_date_fin)::int, v_mois) THEN
    RAISE EXCEPTION 'Date de fin d''exercice incohérente avec le réglage (fin du mois %)', v_mois;
  END IF;
  IF p_date_fin >= (now() AT TIME ZONE 'Europe/Paris')::date THEN
    RAISE EXCEPTION 'L''exercice n''est pas encore terminé';
  END IF;
  SELECT id INTO v_existing FROM clotures_exercices WHERE salon_id = p_salon_id AND date_fin = p_date_fin;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing); END IF;
  SELECT max(date_fin) INTO v_prev_fin FROM clotures_exercices WHERE salon_id = p_salon_id AND date_fin < p_date_fin;
  v_debut := coalesce(v_prev_fin + 1, (p_date_fin - interval '1 year' + interval '1 day')::date);
  SELECT count(*), coalesce(sum(nb_tickets),0), coalesce(sum(nb_annulations),0), round(coalesce(sum(total_ca),0),2), round(coalesce(sum(total_ht),0),2),
         array_agg(id ORDER BY date_cloture)
    INTO v_nb, v_tk, v_an, v_ca, v_ht, v_ids
  FROM clotures WHERE salon_id = p_salon_id AND date_cloture BETWEEN v_debut AND p_date_fin;
  IF coalesce(v_nb,0) = 0 THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'aucune clôture journalière sur l''exercice', 'debut', v_debut, 'fin', p_date_fin);
  END IF;
  v_keys := ARRAY(SELECT DISTINCT jsonb_object_keys(c.detail_paiements) FROM clotures c
                  WHERE c.salon_id = p_salon_id AND c.date_cloture BETWEEN v_debut AND p_date_fin
                    AND c.detail_paiements IS NOT NULL AND jsonb_typeof(c.detail_paiements) = 'object');
  IF v_keys IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_keys LOOP
      SELECT coalesce(sum(CASE WHEN jsonb_typeof(c.detail_paiements->v_k) = 'number' THEN (c.detail_paiements->>v_k)::numeric ELSE 0 END),0) INTO v_s
      FROM clotures c WHERE c.salon_id = p_salon_id AND c.date_cloture BETWEEN v_debut AND p_date_fin
        AND jsonb_typeof(c.detail_paiements) = 'object' AND c.detail_paiements ? v_k;
      v_det := v_det || jsonb_build_object(v_k, round(v_s,2));
    END LOOP;
  END IF;
  -- 2026-10-16 : Z annotées -> montants corrigés
  SELECT * INTO v_d FROM nf525_z_annotation_delta(p_salon_id, v_debut, p_date_fin);
  IF coalesce(v_d.d_ca,0) <> 0 OR coalesce(v_d.d_nb,0) <> 0 OR coalesce(v_d.d_ht,0) <> 0 THEN
    v_ca := round(v_ca + v_d.d_ca, 2); v_ht := round(v_ht + v_d.d_ht, 2); v_tk := v_tk + v_d.d_nb;
    FOR v_k IN SELECT jsonb_object_keys(v_d.d_det) LOOP
      v_det := v_det || jsonb_build_object(v_k, round(COALESCE((v_det->>v_k)::numeric, 0) + (v_d.d_det->>v_k)::numeric, 2));
    END LOOP;
  END IF;
  SELECT cumul_perpetuel_ca, cumul_perpetuel_tickets, created_at INTO v_cp_ca, v_cp_tk, v_cp_at
  FROM clotures WHERE salon_id = p_salon_id AND date_cloture BETWEEN v_debut AND p_date_fin
  ORDER BY date_cloture DESC, num DESC LIMIT 1;
  -- grand total : annotations (Z de l'exercice) créées après la dernière Z de l'exercice
  SELECT coalesce(sum(correct_total_ca - wrong_total_ca),0), coalesce(sum(correct_nb_tickets - wrong_nb_tickets),0) INTO v_pca, v_ptk
    FROM clotures_annotations WHERE salon_id = p_salon_id AND cloture_date <= p_date_fin AND created_at > v_cp_at;
  v_cp_ca := v_cp_ca + coalesce(v_pca,0); v_cp_tk := v_cp_tk + coalesce(v_ptk,0);
  SELECT hash INTO v_prev FROM clotures_exercices WHERE salon_id = p_salon_id ORDER BY date_fin DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    'ZE|' || v_debut || '|' || p_date_fin || '|' || to_char(v_ca, 'FM999999990.00') || '|' || v_tk || '|' ||
    coalesce(v_prev, '') || '|' || coalesce(v_siret, ''), 'sha256'), 'hex');
  INSERT INTO clotures_exercices (salon_id, date_debut, date_fin, nb_jours_clotures, nb_tickets, nb_annulations,
    total_ca, total_ht, total_tva, detail_paiements, cloture_ids, cumul_perpetuel_ca, cumul_perpetuel_tickets,
    hash, hash_algo, hash_prev, operator_name)
  VALUES (p_salon_id, v_debut, p_date_fin, v_nb, v_tk, v_an, v_ca, v_ht, v_ca - v_ht, v_det, v_ids, round(v_cp_ca,2), v_cp_tk,
    v_hash, 'SHA-256', v_prev, CASE WHEN v_uid IS NULL THEN 'auto_cron' ELSE 'utilisateur' END)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_EXERCICE', 'Exercice du ' || to_char(v_debut,'DD/MM/YYYY') || ' au ' || to_char(p_date_fin,'DD/MM/YYYY') || ' : ' ||
    v_nb || ' jours, ' || v_tk || ' tickets, ' || to_char(v_ca, 'FM999999990.00') || ' EUR', 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'debut', v_debut, 'fin', p_date_fin, 'nb_jours', v_nb,
    'nb_tickets', v_tk, 'total_ca', v_ca, 'hash', v_hash);
END $function$;

CREATE OR REPLACE FUNCTION public.check_cumul_clotures_periodiques(p_salon_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(severity text, category text, rule text, detail text, affected_id text, expected numeric, got numeric, delta numeric)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  -- Cumul mensuel vs somme des Z journaliers du mois (2026-10-16 : Z annotées pour leur montant corrigé)
  RETURN QUERY
  SELECT 'critical'::text, 'NF525'::text, 'cumul_mois_mismatch'::text,
    ('Clôture mensuelle ' || cm.annee || '-' || LPAD(cm.mois::text,2,'0') ||
     ' : total_ca=' || to_char(cm.total_ca,'FM9999999.99') ||
     ' mais somme Z journaliers=' || to_char(COALESCE(z.sum_ca,0),'FM9999999.99'))::text,
    cm.id::text, COALESCE(z.sum_ca, 0), cm.total_ca, ABS(cm.total_ca - COALESCE(z.sum_ca,0))
  FROM clotures_mensuelles cm
  LEFT JOIN LATERAL (
    SELECT SUM(COALESCE(an.correct_total_ca, c.total_ca)) AS sum_ca
    FROM clotures c LEFT JOIN clotures_annotations an ON an.cloture_id = c.id
    WHERE c.salon_id = cm.salon_id
      AND EXTRACT(YEAR FROM c.date_cloture)::int = cm.annee
      AND EXTRACT(MONTH FROM c.date_cloture)::int = cm.mois
  ) z ON true
  WHERE (p_salon_id IS NULL OR cm.salon_id = p_salon_id)
    AND ABS(cm.total_ca - COALESCE(z.sum_ca,0)) > 0.01;

  RETURN QUERY
  SELECT 'critical'::text, 'NF525'::text, 'cumul_annee_mismatch'::text,
    ('Clôture annuelle ' || ca.annee || ' : total_ca=' || to_char(ca.total_ca,'FM9999999.99') ||
     ' mais somme mensuelles=' || to_char(COALESCE(m.sum_ca,0),'FM9999999.99'))::text,
    ca.id::text, COALESCE(m.sum_ca, 0), ca.total_ca, ABS(ca.total_ca - COALESCE(m.sum_ca,0))
  FROM clotures_annuelles ca
  LEFT JOIN LATERAL (
    SELECT SUM(cm.total_ca) AS sum_ca FROM clotures_mensuelles cm WHERE cm.salon_id = ca.salon_id AND cm.annee = ca.annee
  ) m ON true
  WHERE (p_salon_id IS NULL OR ca.salon_id = p_salon_id)
    AND ABS(ca.total_ca - COALESCE(m.sum_ca,0)) > 0.01;
END;
$function$;

-- check_fiscal_integrity §2 : une Z annotée est comparée au journal par son montant CORRIGÉ (l'anomalie reste
-- consignée au JET 90 et dans l'annotation ; elle ne réapparaît plus comme « à réparer » une fois traitée).
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('public.check_fiscal_integrity()'::regprocedure);
  if position('clotures_annotations' in d) > 0 then return; end if;
  n := replace(d, 'AND ABS(COALESCE(c.total_ca,0) - COALESCE(j.somme,0)) > 0.005;',
                  'AND ABS(COALESCE((SELECT an.correct_total_ca FROM clotures_annotations an WHERE an.cloture_id = c.id), c.total_ca, 0) - COALESCE(j.somme,0)) > 0.005;');
  if n = d then raise exception 'check_fiscal_integrity : motif §2 introuvable (définition modifiée ?)'; end if;
  execute n;
end $$;
