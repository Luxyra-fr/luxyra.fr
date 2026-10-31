-- 2026-10-31 : catégorie « Offert » dans l'admin (demande d'Alexandre : Excellence Coiffure = offert, pas test).
-- Un établissement en CAISSE RÉELLE avec un abonnement offert en cours (is_free, free_until vide ou futur) = « offert » (0 € de revenu,
-- compté dans les actifs et dans « Offerts », jamais dans les tests). Vrais tests : nom « Salon/Luxyra Démo », caisse en mode test hors essai,
-- offre gratuite sur une caisse de test. Essais : règle inchangée (test seulement si nom Démo ou offre gratuite en cours).
-- lx_prive.salon_est_test N'EST PAS modifiée (utilisée seulement par l'admin aujourd'hui, mais on garde sa sémantique).
-- Rejouable. Admin seulement : aucune fonction de caisse, clôture, NF525 touchée.

create or replace function lx_prive.salon_categorie_admin(p_status text, p_mode_caisse text, p_nom text, p_is_free boolean, p_free_until date,
                                                          p_stripe_sub text, p_ferme boolean)
returns text language sql stable set search_path to 'pg_catalog' as $$
  select case
    when coalesce(p_ferme, false) then 'ferme'
    when coalesce(p_nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo' then 'test'
    when coalesce(p_status, '') = 'trial' then
      case when coalesce(p_is_free, false) and (p_free_until is null or p_free_until > current_date) then 'test' else 'essai' end
    when coalesce(p_status, '') = 'cancelled' then 'resilie'
    when coalesce(p_is_free, false) and (p_free_until is null or p_free_until > current_date) then
      case when coalesce(p_mode_caisse, '') = 'reel' then 'offert' else 'test' end
    when coalesce(p_mode_caisse, '') = 'test' then 'test'
    when coalesce(p_stripe_sub, '') <> '' and p_status in ('active', 'past_due') then 'payant'
    else 'autre'
  end
$$;
revoke all on function lx_prive.salon_categorie_admin(text, text, text, boolean, date, text, boolean) from public, anon, authenticated;

-- compute_current_mrr (relevé mensuel) : même règle que le tableau de bord
do $$
declare d text := pg_get_functiondef('public.compute_current_mrr'::regproc);
  a1 text := 'when lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until) then 0::numeric';
  b1 text := 'when lx_prive.salon_categorie_admin(s.status, s.mode_caisse, s.nom, s.is_free, s.free_until, s.stripe_subscription_id, false) <> ''payant'' then 0::numeric';
  a2 text := 'lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until) as test';
  b2 text := 'lx_prive.salon_categorie_admin(s.status, s.mode_caisse, s.nom, s.is_free, s.free_until, s.stripe_subscription_id, false) = ''test'' as test';
begin
  if position('salon_categorie_admin' in d) > 0 then raise notice 'compute_current_mrr déjà à jour'; return; end if;
  if position(a1 in d) = 0 or position(a2 in d) = 0 then raise exception 'compute_current_mrr : motif introuvable'; end if;
  execute replace(replace(d, a1, b1), a2, b2);
end $$;

-- admin_tableau_de_bord : compteurs payants / essais / actifs (offerts inclus) / offerts / tests
do $$
declare d text := pg_get_functiondef('public.admin_tableau_de_bord'::regproc);
  a0 text := 'v_actifs int := 0; v_tests int := 0;';
  b0 text := 'v_actifs int := 0; v_tests int := 0; v_offerts int := 0;';
  a1 text := 'when lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until) then 0';
  b1 text := 'when lx_prive.salon_categorie_admin(s.status, s.mode_caisse, s.nom, s.is_free, s.free_until, s.stripe_subscription_id, false) <> ''payant'' then 0';
  a2 text := $x$  select count(*) filter (where status = 'trial' and not lx_prive.salon_est_test(null, nom, is_free, free_until)),
         count(*) filter (where status = 'active' and not lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until)),
         count(*) filter (where status <> 'cancelled' and case when status = 'trial' then lx_prive.salon_est_test(null, nom, is_free, free_until) else lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until) end)
    into v_essais, v_actifs, v_tests
    from public.salons$x$;
  b2 text := $x$  -- 2026-10-31 : catégorie admin unique (offert = caisse réelle + abonnement offert : actif, jamais test)
  select count(*) filter (where c = 'essai'),
         count(*) filter (where status = 'active' and c in ('payant', 'offert', 'autre')),
         count(*) filter (where c = 'test'),
         count(*) filter (where c = 'offert')
    into v_essais, v_actifs, v_tests, v_offerts
    from (select status, ferme_le, lx_prive.salon_categorie_admin(status, mode_caisse, nom, is_free, free_until, stripe_subscription_id, false) c
            from public.salons) x$x$;
  a3 text := $x$'actifs', v_actifs, 'tests', v_tests)$x$;
  b3 text := $x$'actifs', v_actifs, 'tests', v_tests, 'offerts', v_offerts)$x$;
  a4 text := $x$'regle', 'abonnement Stripe en cours (actif ou impayé), hors comptes de test'$x$;
  b4 text := $x$'regle', 'abonnement Stripe en cours (actif ou impayé), hors comptes de test et abonnements offerts'$x$;
begin
  if position('v_offerts' in d) > 0 then raise notice 'admin_tableau_de_bord déjà à jour'; return; end if;
  if position(a0 in d) = 0 or position(a1 in d) = 0 or position(a2 in d) = 0 or position(a3 in d) = 0 or position(a4 in d) = 0 then
    raise exception 'admin_tableau_de_bord : motif introuvable'; end if;
  execute replace(replace(replace(replace(replace(d, a0, b0), a1, b1), a2, b2), a3, b3), a4, b4);
end $$;

-- admin_bons_cadeaux_etat : les bons d'un établissement offert (caisse réelle) comptent dans les totaux réels
do $$
declare d text := pg_get_functiondef('public.admin_bons_cadeaux_etat'::regproc);
  a1 text := $x$'test', lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until),$x$;
  b1 text := $x$'test', lx_prive.salon_categorie_admin(s.status, s.mode_caisse, s.nom, s.is_free, s.free_until, s.stripe_subscription_id, false) = 'test',
           'categorie', lx_prive.salon_categorie_admin(s.status, s.mode_caisse, s.nom, s.is_free, s.free_until, s.stripe_subscription_id, s.ferme_le is not null),$x$;
begin
  if position('salon_categorie_admin' in d) > 0 then raise notice 'admin_bons_cadeaux_etat déjà à jour'; return; end if;
  if position(a1 in d) = 0 then raise exception 'admin_bons_cadeaux_etat : motif introuvable'; end if;
  execute replace(d, a1, b1);
end $$;
