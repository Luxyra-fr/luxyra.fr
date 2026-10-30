-- ============================================================================================================
-- RETOUR ARRIÈRE de surmesure_v2.sql (RDV sur mesure v2) — à n'utiliser qu'en cas de problème.
-- Effet : lx_creneau_libre remise à la définition de PRODUCTION du 30/10/2026 (à l'octet, md5 608615e8…),
-- tâche planifiée, déclencheurs, RPC et fonctions v2 retirés. Tables rdv_demande_options / rdv_demande_paiements et
-- colonnes ajoutées CONSERVÉES (historique). Les propositions v2 encore « proposed » sont passées « cancelled_by_salon »
-- (sinon impossibles à payer avec l'ancien worker) : prévenir les clients concernés. Contre-audit 30/10 (d) : la liste est
-- CONSERVÉE dans lx_prive.sm_retour_arriere_clients et relue APRÈS le commit (dernière requête du script, relisible ensuite).
-- Ordre (registre NF525, intervention 2026-10-30 (-2)) : d'abord app.html / luxyra-supabase.js « avant » (push), puis les edge
-- functions « avant », PUIS ce script ; le worker et proposal.html de la v2 peuvent rester (ils lisent les deux formats).
-- Garde : refus tant qu'un paiement d'acompte sur mesure est en cours (session Stripe ouverte + 60 min de marge), sinon un
-- acompte payé ensuite ne trouverait plus la fonction de finalisation (le worker le rembourserait, mais sans RDV).
-- ============================================================================================================
begin;
do $paiements$ declare v timestamptz; begin
  select max(checkout_expires_at) + interval '60 minutes' into v from public.rdv_demandes
   where status = 'proposed' and checkout_expires_at + interval '60 minutes' > now();
  if v is not null then
    raise exception 'RETOUR ARRIÈRE REFUSÉ : un paiement d''acompte sur mesure est en cours. Réessayez après % (heure de Paris).', to_char(v at time zone 'Europe/Paris', 'DD/MM HH24:MI');
  end if;
end $paiements$;
select cron.unschedule('rdv-sur-mesure-echeances') where exists (select 1 from cron.job where jobname = 'rdv-sur-mesure-echeances');
drop trigger if exists a_lx_rdv_demandes_garde on public.rdv_demandes;
drop trigger if exists trg_rdv_demandes_options_suivi on public.rdv_demandes;
drop trigger if exists trg_rdv_demande_option_notif on public.rdv_demande_options;
create table if not exists lx_prive.sm_retour_arriere_clients (
  demande_id uuid primary key, salon_id uuid, client_prenom text, client_nom text, client_email text, client_tel text,
  annulee_at timestamptz not null default now());
revoke all on lx_prive.sm_retour_arriere_clients from public, anon, authenticated;
insert into lx_prive.sm_retour_arriere_clients (demande_id, salon_id, client_prenom, client_nom, client_email, client_tel)
  select id, salon_id, client_prenom, client_nom, client_email, client_tel from public.rdv_demandes where status = 'proposed' and proposal_version = 2
  on conflict (demande_id) do nothing;
update public.rdv_demandes set status = 'cancelled_by_salon'
 where status = 'proposed' and proposal_version = 2 and id in (select demande_id from lx_prive.sm_retour_arriere_clients);

CREATE OR REPLACE FUNCTION public.lx_creneau_libre(p_salon uuid, p_collab integer, p_date date, p_heure time without time zone, p_duree integer)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select p_collab is null or not (
    exists (select 1 from rdv_online r
      where r.salon_id = p_salon and r.collaborateur_id = p_collab and r.date_rdv = p_date
        and coalesce(r.status,'') not in ('cancelled','cancelled_by_client','refused','pending_payment')
        and (extract(hour from r.heure_rdv)::int*60 + extract(minute from r.heure_rdv)::int) < (extract(hour from p_heure)::int*60 + extract(minute from p_heure)::int + coalesce(p_duree,30))
        and (extract(hour from r.heure_rdv)::int*60 + extract(minute from r.heure_rdv)::int + coalesce(r.duree_minutes,30)) > (extract(hour from p_heure)::int*60 + extract(minute from p_heure)::int))
    or exists (select 1 from appointments a
      where a.salon_id = p_salon and a.collab_id = p_collab and a.date_rdv::text = p_date::text
        and coalesce(a.cancelled,false) = false and coalesce(a.status,'') not in ('canc','cancelled','annule')
        and a.heure ~ '^[0-9]{1,2}:[0-9]{2}' and not public.lx_appt_sans_duree(a.from_caisse, a.a_phases, a.service_id, a.items)
        and (split_part(a.heure,':',1)::int*60 + split_part(a.heure,':',2)::int) < (extract(hour from p_heure)::int*60 + extract(minute from p_heure)::int + coalesce(p_duree,30))
        and (split_part(a.heure,':',1)::int*60 + split_part(a.heure,':',2)::int
             + greatest((select coalesce(sum((p->>'d')::int),0) from jsonb_array_elements(coalesce(a.a_phases,'[]'::jsonb)) p),30)) > (extract(hour from p_heure)::int*60 + extract(minute from p_heure)::int))
  );
$function$
;

drop function if exists public.lx_demande_proposer(uuid, uuid, jsonb, integer, boolean);
drop function if exists public.lx_demande_consulter(text);
drop function if exists public.lx_demande_choisir(text, uuid);
drop function if exists public.lx_demande_paiement_preparer(text, uuid);
drop function if exists public.lx_demande_paiement_enregistrer(text, uuid, text, timestamptz);
drop function if exists public.lx_demande_paiement_finaliser(text, text, uuid, text, text, bigint);
drop function if exists public.lx_demande_paiement_rembourse(uuid, text, boolean, text);
drop function if exists public.lx_demande_refuser(text, text);
drop function if exists public.lx_demande_paiement_effacer(text, text);
drop function if exists lx_prive.demandes_sur_mesure_echeances();
drop function if exists lx_prive.sm_notifier_worker(uuid, text);
drop function if exists lx_prive.trg_rdv_demande_option_notif();
drop function if exists lx_prive.trg_rdv_demandes_options_suivi();
drop function if exists lx_prive.rdv_demandes_garde();
drop function if exists lx_prive.sm_confirmer(public.rdv_demandes, public.rdv_demande_options, uuid, text);
drop function if exists lx_prive.sm_creer_rdv(public.rdv_demandes, public.rdv_demande_options, text, text, text, boolean);
drop function if exists lx_prive.sm_proposed_data(public.rdv_demande_options);
drop function if exists lx_prive.sm_creneau_ou_pris(public.rdv_demande_options);
drop function if exists lx_prive.sm_demande_active(text, uuid);
drop function if exists lx_prive.sm_option_json(public.rdv_demande_options);
drop function if exists lx_prive.demande_option_calculer(uuid, jsonb);
drop function if exists lx_prive.demande_creneau(uuid, integer, date, time, jsonb);
drop function if exists lx_prive.sm_paiement_en_cours(public.rdv_demandes);
drop function if exists lx_prive.sm_centimes_inf(numeric);
drop function if exists lx_prive.sm_lettre(integer);
drop function if exists lx_prive.sm_stripe_actif(uuid);
drop function if exists lx_prive.sm_hhmm(integer);
drop function if exists lx_prive.sm_minutes(time);
drop function if exists lx_prive.sm_phases(jsonb, text);
drop function if exists lx_prive.sm_erreur(text, text);

do $v$ declare v text; begin
  select md5(pg_get_functiondef('public.lx_creneau_libre(uuid,integer,date,time,integer)'::regprocedure)) into v;
  if v <> '608615e8c8faa8621b0306ff6abec150' then raise exception 'retour arrière : lx_creneau_libre md5 % (attendu 608615e8…)', v; end if;
end $v$;
commit;
-- clients à prévenir (propositions v2 annulées par un retour arrière) : relisible à tout moment
select d.annulee_at, s.nom as etablissement, d.client_prenom, d.client_nom, d.client_email, d.client_tel
  from lx_prive.sm_retour_arriere_clients d left join public.salons s on s.id = d.salon_id order by d.annulee_at desc;
