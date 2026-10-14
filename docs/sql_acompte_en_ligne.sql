-- ============================================================================
-- 2026-10-14 (NF525 acompte en ligne) — Acompte payé en ligne = ticket scellé dès le paiement
-- À appliquer APRÈS le déploiement de app.html / luxyra-supabase.js (voir docs/acompte_en_ligne_conception.md,
-- § Transition). Tout est idempotent (IF NOT EXISTS / CREATE OR REPLACE). Aucune donnée existante n'est modifiée :
-- les acomptes déjà payés gardent acompte_modele NULL = ancien modèle (mode de règlement du ticket final).
-- ============================================================================

-- 1) Colonnes rdv_online --------------------------------------------------------------------------------
--   acompte_modele        : NULL = ancien modèle (acomptes payés avant la mise en service) ; 'ticket' = nouveau modèle
--                           (posé automatiquement par trigger au passage acompte_paye false -> true, jamais réécrit).
--   acompte_tk_num        : n° du ticket scellé « Acompte en ligne » (posé par l'application à sa création, jamais réécrit).
--   acompte_tk_claim_at   : verrou définitif « un seul appareil crée le ticket » (même mécanisme que retenue_claim_at).
--   acompte_remb_claim_at : verrou « un seul appareil crée les tickets de remboursement en attente » de ce RDV.
--   remboursements[].tk   : n° du ticket négatif « Remboursement acompte en ligne » de chaque entrée (posé via RPC).
alter table public.rdv_online
  add column if not exists acompte_modele text,
  add column if not exists acompte_tk_num integer,
  add column if not exists acompte_tk_claim_at timestamptz,
  add column if not exists acompte_remb_claim_at timestamptz;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rdv_online_acompte_modele_check') then
    alter table public.rdv_online add constraint rdv_online_acompte_modele_check check (acompte_modele is null or acompte_modele in ('ticket'));
  end if;
end $$;

comment on column public.rdv_online.acompte_modele is 'NF525 2026-10-14 : NULL = acompte en ligne ancien modèle (mode de règlement du ticket final) ; ticket = ticket scellé « Acompte en ligne » au paiement, déduit du ticket final';
comment on column public.rdv_online.acompte_tk_num is 'N° du ticket scellé « Acompte en ligne » (nouveau modèle). Jamais réécrit.';
comment on column public.rdv_online.acompte_tk_claim_at is 'Verrou définitif de création du ticket d''acompte (un seul appareil).';
comment on column public.rdv_online.acompte_remb_claim_at is 'Verrou définitif de création des tickets de remboursement en attente (un seul appareil).';

-- 2) Trigger : marque le modèle au moment du paiement ; protège acompte_modele / acompte_tk_num -------------------------
--    Révision 2026-10-14 (2e revue) :
--    - UPDATE : acompte_modele est TOUJOURS repris de OLD (personne ne peut poser ou changer le modèle, ni « basculer »
--      un ancien acompte) ; la seule exception est le passage acompte_paye false -> true d'une ligne encore NULL,
--      que SEUL ce trigger marque 'ticket' ;
--    - acompte_tk_num : une fois posé, seul service_role peut le modifier (réparation manuelle) ; toute autre session
--      (authenticated / anon) garde OLD. Tant qu'il est NULL, l'application du salon peut le poser.
create or replace function lx_prive.rdv_online_acompte_modele()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := coalesce((select auth.role()), '');
begin
  if TG_OP = 'INSERT' then
    -- à l'insertion, le modèle n'est posé que si l'acompte est déjà payé (service_role) ; sinon NULL
    if coalesce(NEW.acompte_paye, false) and NEW.acompte_modele is null then NEW.acompte_modele := 'ticket'; end if;
    return NEW;
  end if;
  -- UPDATE : le modèle ne change jamais, sauf marquage par ce trigger au moment du paiement
  NEW.acompte_modele := OLD.acompte_modele;
  if OLD.acompte_modele is null
     and coalesce(NEW.acompte_paye, false)
     and not coalesce(OLD.acompte_paye, false) then
    NEW.acompte_modele := 'ticket';
  end if;
  -- le n° du ticket d'acompte n'est jamais réécrit une fois posé (sauf service_role : réparation)
  if OLD.acompte_tk_num is not null
     and NEW.acompte_tk_num is distinct from OLD.acompte_tk_num
     and v_role <> 'service_role' then
    NEW.acompte_tk_num := OLD.acompte_tk_num;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_rdv_online_acompte_modele on public.rdv_online;
create trigger trg_rdv_online_acompte_modele
  before insert or update on public.rdv_online
  for each row execute function lx_prive.rdv_online_acompte_modele();

-- 2 bis) Insertion publique (réservation en ligne par un client anonyme / authentifié non propriétaire) : les champs
--    « caisse » de l'acompte en ligne ne peuvent pas être fournis par le client. Définition EXISTANTE de
--    lx_prive.rdv_online_insert_public_propre reproduite à l'identique (lue en base le 2026-10-14, SECURITY DEFINER,
--    search_path public, pg_temp), complétée des 4 nouvelles colonnes + remboursements / acompte_rembourse_montant /
--    retenue_* / ticket_num (trigger a_trg_rdv_online_insert_public_propre BEFORE INSERT, inchangé).
CREATE OR REPLACE FUNCTION lx_prive.rdv_online_insert_public_propre()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE v_role text := coalesce((select auth.role()), '');
BEGIN
  IF v_role NOT IN ('authenticated','anon') THEN RETURN NEW; END IF;
  IF public.is_admin() OR EXISTS (SELECT 1 FROM salons s WHERE s.id = NEW.salon_id AND s.user_id = auth.uid()) THEN
    RETURN NEW;  -- le salon lui-même
  END IF;
  NEW.acompte_paye := false;  NEW.acompte_rembourse := false;
  NEW.stripe_payment_id := NULL;  NEW.payment_intent_id := NULL;  NEW.stripe_token := NULL;  NEW.stripe_account := NULL;
  NEW.refund_id := NULL;  NEW.refunded_at := NULL;
  NEW.empreinte_held_at := NULL;  NEW.empreinte_captured_at := NULL;  NEW.empreinte_released_at := NULL;
  IF coalesce(NEW.empreinte_status,'none') NOT IN ('none','pending') THEN NEW.empreinte_status := 'pending'; END IF;
  IF coalesce(NEW.status,'pending') NOT IN ('pending','pending_payment','confirmed') THEN NEW.status := 'pending'; END IF;
  IF NEW.status = 'confirmed' AND NOT EXISTS (SELECT 1 FROM site_config c WHERE c.salon_id = NEW.salon_id AND coalesce(c.confirmation_auto,false) = true) THEN
    NEW.status := 'pending';
  END IF;
  NEW.cancelled_at := NULL;  NEW.cancelled_by := NULL;
  -- 2026-10-14 (NF525 acompte en ligne) : champs de caisse de l'acompte, jamais fournis par le client
  NEW.acompte_modele := NULL;  NEW.acompte_tk_num := NULL;  NEW.acompte_tk_claim_at := NULL;  NEW.acompte_remb_claim_at := NULL;
  NEW.remboursements := '[]'::jsonb;  NEW.acompte_rembourse_montant := 0;
  NEW.retenue_at := NULL;  NEW.retenue_tk_num := NULL;  NEW.retenue_claim_at := NULL;  NEW.ticket_num := NULL;
  RETURN NEW;
END $$;

-- 3) Anti-doublon ABSOLU côté base : une clé d'acompte (ticket d'acompte « acompte:<rdv> » ou de remboursement
--    « rembacompte:<rdv>:<refund_id> ») ne peut exister qu'une fois par salon (même motif que tickets_retenue_unique).
create unique index if not exists tickets_acompte_key_unique
  on public.tickets (salon_id, (raw_data ->> 'acompteKey'))
  where (raw_data ? 'acompteKey');

-- 4) RPC : pose le n° de ticket sur UNE entrée de remboursements (atomique, ligne verrouillée : aucune perte de mise à
--    jour face à un remboursement ajouté au même instant par le worker). SECURITY INVOKER : RLS du salon appliquée.
--    p_cle = refund_id de l'entrée (ou son horodatage « at » si refund_id absent). Retourne true si une entrée a été marquée.
create or replace function public.lx_acompte_remb_ticketer(p_rdv uuid, p_cle text, p_tk integer)
returns boolean
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_old jsonb;
  v_new jsonb := '[]'::jsonb;
  v_e   jsonb;
  v_ok  boolean := false;
begin
  if p_rdv is null or p_cle is null or p_tk is null or p_tk <= 0 then return false; end if;
  select coalesce(remboursements, '[]'::jsonb) into v_old from public.rdv_online where id = p_rdv for update;
  if not found then return false; end if;
  for v_e in select value from jsonb_array_elements(v_old) loop
    if not v_ok and (v_e ->> 'tk') is null and coalesce(v_e ->> 'refund_id', v_e ->> 'at') = p_cle then
      v_e := v_e || jsonb_build_object('tk', p_tk);
      v_ok := true;
    end if;
    v_new := v_new || jsonb_build_array(v_e);
  end loop;
  if v_ok then
    update public.rdv_online set remboursements = v_new where id = p_rdv;
  end if;
  return v_ok;
end $$;

revoke all on function public.lx_acompte_remb_ticketer(uuid, text, integer) from public;
grant execute on function public.lx_acompte_remb_ticketer(uuid, text, integer) to authenticated, service_role;

-- 5) Libération du verrou de remboursement (uniquement si TOUTES les entrées sont ticketées) : appelée par l'app en fin
--    de passage. Séparée pour rester atomique (la ligne est verrouillée pendant le contrôle).
create or replace function public.lx_acompte_remb_liberer(p_rdv uuid)
returns boolean
language plpgsql
security invoker
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rest integer;
begin
  if p_rdv is null then return false; end if;
  perform 1 from public.rdv_online where id = p_rdv for update;
  if not found then return false; end if;
  select count(*) into v_rest
    from public.rdv_online r, jsonb_array_elements(coalesce(r.remboursements, '[]'::jsonb)) e
   where r.id = p_rdv and (e ->> 'tk') is null and coalesce((e ->> 'montant')::numeric, 0) > 0;
  if v_rest = 0 then
    update public.rdv_online set acompte_remb_claim_at = null where id = p_rdv;
    return true;
  end if;
  return false;
end $$;

revoke all on function public.lx_acompte_remb_liberer(uuid) from public;
grant execute on function public.lx_acompte_remb_liberer(uuid) to authenticated, service_role;

-- 5 bis) Lectures de synchronisation (SECURITY INVOKER : RLS du salon appliquée ; mêmes droits que les RPC ci-dessus).
--    lx_acompte_a_ticketer : acomptes payés du nouveau modèle SANS ticket d'acompte, encore à traiter par la caisse.
--    EXCLUS (jamais de ticket d'acompte créé) : RDV déjà encaissé (status done / ticket_num : l'acompte a été pris comme
--    mode de règlement du ticket final par une ancienne version de l'application), ou déjà « Acompte conservé »
--    (retenue_tk_num / retenue_claim_at posés par une ancienne version). Ces lignes sont signalées à part (DB_ERROR
--    « déjà traité par l'ancien modèle », une fois) par l'application.
create or replace function public.lx_acompte_a_ticketer(p_salon uuid)
returns setof public.rdv_online
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select r.* from public.rdv_online r
   where r.salon_id = p_salon
     and r.acompte_modele = 'ticket'
     and r.acompte_paye = true
     and r.acompte_tk_num is null
     and coalesce(r.acompte_montant, 0) > 0
     and coalesce(r.status, '') <> 'done'
     and r.ticket_num is null
     and r.retenue_tk_num is null
     and r.retenue_claim_at is null
   order by r.acompte_paye_at nulls first, r.created_at
   limit 20
$$;

revoke all on function public.lx_acompte_a_ticketer(uuid) from public;
grant execute on function public.lx_acompte_a_ticketer(uuid) to authenticated, service_role;

--    lx_acompte_deja_traite_ancien : lignes du nouveau modèle sans ticket d'acompte mais déjà traitées à l'ancienne
--    (signalement une fois par appareil ; aucune création).
create or replace function public.lx_acompte_deja_traite_ancien(p_salon uuid)
returns table (id uuid, status text, ticket_num integer, retenue_tk_num integer, retenue_claim_at timestamptz, acompte_montant numeric)
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select r.id, r.status, r.ticket_num, r.retenue_tk_num, r.retenue_claim_at, r.acompte_montant from public.rdv_online r
   where r.salon_id = p_salon
     and r.acompte_modele = 'ticket'
     and r.acompte_paye = true
     and r.acompte_tk_num is null
     and coalesce(r.acompte_montant, 0) > 0
     and (coalesce(r.status, '') = 'done' or r.ticket_num is not null or r.retenue_tk_num is not null or r.retenue_claim_at is not null)
   limit 50
$$;

revoke all on function public.lx_acompte_deja_traite_ancien(uuid) from public;
grant execute on function public.lx_acompte_deja_traite_ancien(uuid) to authenticated, service_role;

--    lx_acompte_remb_a_ticketer : RDV du nouveau modèle (ticket d'acompte existant) ayant AU MOINS une entrée de
--    remboursements avec montant > 0 et sans tk (ticket négatif à créer). Les plus récents d'abord.
create or replace function public.lx_acompte_remb_a_ticketer(p_salon uuid)
returns setof public.rdv_online
language sql
stable
security invoker
set search_path to 'public', 'pg_temp'
as $$
  select r.* from public.rdv_online r
   where r.salon_id = p_salon
     and r.acompte_modele = 'ticket'
     and r.acompte_tk_num is not null
     and exists (select 1 from jsonb_array_elements(coalesce(r.remboursements, '[]'::jsonb)) e
                  where (e ->> 'tk') is null and coalesce((e ->> 'montant')::numeric, 0) > 0)
   order by r.refunded_at desc nulls last
   limit 50
$$;

revoke all on function public.lx_acompte_remb_a_ticketer(uuid) from public;
grant execute on function public.lx_acompte_remb_a_ticketer(uuid) to authenticated, service_role;

-- 6) Vérifications après application (lecture seule) ----------------------------------------------------------------
-- select column_name from information_schema.columns where table_name='rdv_online' and column_name like 'acompte_%';
-- select tgname from pg_trigger where tgrelid='public.rdv_online'::regclass and tgname='trg_rdv_online_acompte_modele';
-- select indexname from pg_indexes where tablename='tickets' and indexname='tickets_acompte_key_unique';
-- select count(*) from public.rdv_online where acompte_modele='ticket';   -- 0 juste après l'application
-- select proname from pg_proc where proname in ('lx_acompte_a_ticketer','lx_acompte_deja_traite_ancien','lx_acompte_remb_a_ticketer','lx_acompte_remb_ticketer','lx_acompte_remb_liberer');
-- select prosrc like '%acompte_modele%' from pg_proc where proname='rdv_online_insert_public_propre';   -- true
