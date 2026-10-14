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
create or replace function lx_prive.rdv_online_acompte_modele()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  -- passage « non payé » -> « payé » après la mise en service => nouveau modèle (ticket scellé au paiement)
  if coalesce(NEW.acompte_paye, false)
     and (TG_OP = 'INSERT' or not coalesce(OLD.acompte_paye, false))
     and NEW.acompte_modele is null then
    NEW.acompte_modele := 'ticket';
  end if;
  if TG_OP = 'UPDATE' then
    -- le modèle d'un acompte ne change jamais (un ancien acompte reste ancien modèle : aucun ticket rétroactif)
    if OLD.acompte_modele is not null then NEW.acompte_modele := OLD.acompte_modele; end if;
    -- le n° du ticket d'acompte n'est jamais réécrit une fois posé
    if OLD.acompte_tk_num is not null and NEW.acompte_tk_num is distinct from OLD.acompte_tk_num then
      NEW.acompte_tk_num := OLD.acompte_tk_num;
    end if;
  end if;
  return NEW;
end $$;

drop trigger if exists trg_rdv_online_acompte_modele on public.rdv_online;
create trigger trg_rdv_online_acompte_modele
  before insert or update on public.rdv_online
  for each row execute function lx_prive.rdv_online_acompte_modele();

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

-- 6) Vérifications après application (lecture seule) ----------------------------------------------------------------
-- select column_name from information_schema.columns where table_name='rdv_online' and column_name like 'acompte_%';
-- select tgname from pg_trigger where tgrelid='public.rdv_online'::regclass and tgname='trg_rdv_online_acompte_modele';
-- select indexname from pg_indexes where tablename='tickets' and indexname='tickets_acompte_key_unique';
-- select count(*) from public.rdv_online where acompte_modele='ticket';   -- 0 juste après l'application
