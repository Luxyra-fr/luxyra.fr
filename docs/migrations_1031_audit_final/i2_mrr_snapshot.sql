-- 2026-10-31 audit final I2 : le relevé MRR mensuel (capture_mrr_snapshot) suit la même règle que le tableau de bord admin :
-- abonnement Stripe en cours (active / past_due), comptes de test exclus, établissements fermés exclus, tarif Fondateur.
CREATE OR REPLACE FUNCTION public.compute_current_mrr()
 RETURNS TABLE(mrr_total numeric, active_salons integer, paying_salons integer, breakdown jsonb)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_cfg jsonb := coalesce((select config from app_config where id=1), '{}'::jsonb);
  v_ess numeric; v_pro numeric; v_fond numeric;
begin
  begin v_ess  := coalesce(nullif(v_cfg->>'plan_essential_eur','')::numeric, 14.99); exception when others then v_ess := 14.99; end;
  begin v_pro  := coalesce(nullif(v_cfg->>'plan_pro_eur','')::numeric, 24.99); exception when others then v_pro := 24.99; end;
  begin v_fond := coalesce(nullif(v_cfg->>'plan_pro_founder_eur','')::numeric, 14.99); exception when others then v_fond := 14.99; end;
  return query
  with calc as (
    select s.id, s.status,
      case
        when s.stripe_subscription_id is null or s.stripe_subscription_id = '' then 0::numeric
        when s.status not in ('active','past_due') then 0::numeric
        when lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until) then 0::numeric
        when s.custom_price_amount is not null then s.custom_price_amount
        when s.plan = 'pro' and s.is_founder then v_fond
        when s.plan = 'pro' then v_pro
        else v_ess
      end as mrr,
      lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until) as test
    from salons s where s.ferme_le is null
  )
  select coalesce(sum(mrr),0)::numeric,
    count(*) filter (where status in ('active','past_due') and not test)::integer,
    count(*) filter (where mrr > 0)::integer,
    coalesce(jsonb_object_agg(id::text, mrr) filter (where mrr > 0), '{}'::jsonb)
  from calc;
end;
$function$;
-- Vérifié le 31/10 : 14,99 € — 1 établissement payant.
