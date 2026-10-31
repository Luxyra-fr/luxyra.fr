-- 2026-10-31 — Panneau admin « pro » (I1/I2/I3)
-- admin_tableau_de_bord v2 : même structure de retour + nouveaux champs.
--  * Revenu mensuel et « payants » = abonnement Stripe EN COURS uniquement
--    (stripe_subscription_id renseigné ET statut active / past_due), au vrai montant :
--    prix personnalisé (remise) > tarif Fondateur > tarif du plan.
--  * Comptes de test exclus partout (caisse en mode test, « Salon Démo » / « Luxyra Démo », offert en cours).
--  * Nouveaux : 'inscrits_7j' (hors test), 'essais_non_convertis' (essai fini, pas d'abonnement, 90 j).
-- Lecture seule : aucune table modifiée, aucune table NF525 touchée.

create or replace function lx_prive.salon_est_test(p_mode_caisse text, p_nom text, p_is_free boolean, p_free_until date)
returns boolean language sql stable set search_path = pg_catalog as $$
  select coalesce(p_mode_caisse, '') = 'test'
      or coalesce(p_nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo'
      or (coalesce(p_is_free, false) and (p_free_until is null or p_free_until > current_date));
$$;
revoke all on function lx_prive.salon_est_test(text, text, boolean, date) from public, anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_tableau_de_bord()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'lx_prive', 'pg_temp'
AS $function$
declare
  v_cfg jsonb := coalesce((select config from public.app_config where id = 1), '{}'::jsonb);
  v_ess numeric; v_pro numeric; v_fond numeric;
  v_mrr numeric := 0; v_payants int := 0; v_essais int := 0; v_actifs int := 0; v_tests int := 0;
  v_ref_mois date; v_ref_mrr numeric;
  v_essais7 jsonb; v_impayes jsonb; v_nonconv jsonb;
  v_unread int := 0; v_vieux jsonb; v_escal jsonb;
  v_ar_graves int; v_ar_total int; v_ar_err text;
  v_nf jsonb; v_nf_err text; v_nf_pb int := 0;
  v_nuit jsonb;
  v_dem int; v_mig int; v_mig_new int; v_insc7 int; v_insc7_reels int; v_docs int; v_rappels jsonb;
  v_alertes jsonb := '[]'::jsonb;
begin
  if not public.is_admin() then raise exception 'Accès réservé à l''administrateur' using errcode = '42501'; end if;

  begin v_ess  := coalesce(nullif(v_cfg->>'plan_essential_eur', '')::numeric, 14.99); exception when others then v_ess := 14.99; end;
  begin v_pro  := coalesce(nullif(v_cfg->>'plan_pro_eur', '')::numeric, 24.99); exception when others then v_pro := 24.99; end;
  begin v_fond := coalesce(nullif(v_cfg->>'plan_pro_founder_eur', '')::numeric, 14.99); exception when others then v_fond := 14.99; end;

  -- 1. revenu mensuel + 2. payants : abonnement Stripe en cours, hors comptes de test (même règle que mrrOf() du panneau)
  select coalesce(sum(m), 0), count(*) filter (where m > 0) into v_mrr, v_payants from (
    select case
      when s.stripe_subscription_id is null or s.stripe_subscription_id = '' then 0
      when s.status not in ('active','past_due') then 0
      when lx_prive.salon_est_test(s.mode_caisse, s.nom, s.is_free, s.free_until) then 0
      when s.custom_price_amount is not null then s.custom_price_amount
      when s.plan = 'pro' and s.is_founder then v_fond
      when s.plan = 'pro' then v_pro
      else v_ess end m
    from public.salons s where s.ferme_le is null) x;
  select count(*) filter (where status = 'trial'),
         count(*) filter (where status = 'active'),
         count(*) filter (where lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))
    into v_essais, v_actifs, v_tests
    from public.salons
   where ferme_le is null and (status <> 'trial' or not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo');
  select snapshot_month, mrr_total into v_ref_mois, v_ref_mrr
    from public.mrr_snapshots where snapshot_month <= current_date - 30 order by snapshot_month desc limit 1;

  -- 3. essais qui finissent dans moins de 7 jours (hors Salon Démo)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'fin', trial_end,
           'jours', greatest(0, ceil(extract(epoch from (trial_end - now())) / 86400))::int) order by trial_end), '[]'::jsonb)
    into v_essais7 from public.salons
   where status = 'trial' and ferme_le is null and trial_end is not null and trial_end >= now() and trial_end < now() + interval '7 days'
     and not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo';

  -- 3 bis. essais terminés non convertis (90 derniers jours, sans abonnement Stripe, hors test)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'fin', trial_end, 'statut', status,
           'depuis_jours', floor(extract(epoch from (now() - trial_end)) / 86400)::int) order by trial_end desc), '[]'::jsonb)
    into v_nonconv from public.salons
   where ferme_le is null and trial_end is not null and trial_end < now() and trial_end > now() - interval '90 days'
     and (stripe_subscription_id is null or stripe_subscription_id = '')
     and status not in ('active','past_due')
     and not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo'
     and not (coalesce(is_free, false) and (free_until is null or free_until > current_date));

  -- 4. paiements échoués / impayés
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'nom', nom, 'depuis', past_due_since, 'stripe_customer', stripe_customer_id) order by past_due_since nulls last), '[]'::jsonb)
    into v_impayes from public.salons where status = 'past_due' and ferme_le is null;

  -- 5. support
  select coalesce(sum(unread_count_admin), 0) into v_unread from public.support_conversations where status = 'open';
  select jsonb_build_object('le', m.created_at, 'salon_id', m.salon_id, 'conversation_id', m.conversation_id,
           'heures', floor(extract(epoch from (now() - m.created_at)) / 3600)::int)
    into v_vieux
    from public.support_messages m join public.support_conversations c on c.id = m.conversation_id
   where m.sender = 'client' and coalesce(m.read_by_admin, false) = false and c.status = 'open'
   order by m.created_at limit 1;

  -- 6. bot
  select jsonb_build_object(
      'total_30j', count(*),
      'sans_reponse', count(*) filter (where not exists (
          select 1 from public.support_messages a where a.conversation_id = b.conversation_id and a.sender = 'admin' and a.created_at > b.created_at)),
      'liste', coalesce(jsonb_agg(jsonb_build_object('le', b.created_at, 'salon_id', b.salon_id, 'conversation_id', b.conversation_id))
                 filter (where not exists (
          select 1 from public.support_messages a where a.conversation_id = b.conversation_id and a.sender = 'admin' and a.created_at > b.created_at)), '[]'::jsonb))
    into v_escal
    from public.support_messages b
   where b.sender = 'bot' and b.created_at > now() - interval '30 days'
     and (b.message like '🙋%' or b.message ilike '%transmets votre demande à un humain%');

  -- 7. À réparer
  begin
    select count(*) filter (where b.niveau = 'grave'), count(*) into v_ar_graves, v_ar_total
      from lx_prive.a_reparer_brut(72) b
     where not exists (select 1 from public.admin_acquittements a where a.signature = b.signature and a.traite_le >= b.derniere);
  exception when others then v_ar_err := sqlerrm; end;

  -- 8. NF525 (lecture seule, source unique : admin_nf525_etat)
  begin
    v_nf := public.admin_nf525_etat();
    select count(*) into v_nf_pb from jsonb_array_elements(coalesce(v_nf->'global', '[]'::jsonb)) g where g->>'verdict' <> 'ok';
    v_nf_pb := v_nf_pb + (select count(*) from jsonb_array_elements(coalesce(v_nf->'salons', '[]'::jsonb)) s where s->>'verdict' <> 'ok');
  exception when others then v_nf_err := sqlerrm; end;

  -- 9. tâches de nuit
  begin v_nuit := public.admin_taches_nuit(); exception when others then v_nuit := jsonb_build_object('erreur', sqlerrm); end;

  -- compteurs
  select count(*) into v_dem from public.demandes_essai where status = 'new';
  select count(*) filter (where status in ('new','contacted','in_progress')), count(*) filter (where status = 'new')
    into v_mig, v_mig_new from public.migration_requests;
  select count(*), count(*) filter (where not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo')
    into v_insc7, v_insc7_reels from public.salons where created_at > now() - interval '7 days';
  select count(*) into v_docs from public.salons where verification_status = 'pending_review' and ferme_le is null;
  select coalesce(jsonb_agg(jsonb_build_object('id', s.id, 'nom', s.nom, 'note', a.rappel_note)), '[]'::jsonb) into v_rappels
    from public.admin_suivi_salons a join public.salons s on s.id = a.salon_id
   where a.rappel_le is not null and a.rappel_le <= current_date and s.ferme_le is null;

  -- ALERTES DU JOUR
  if coalesce(v_ar_graves, 0) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','grave','texte', v_ar_graves || ' problème(s) grave(s) à réparer','page','qualite/areparer'); end if;
  if v_nf is not null and v_nf->>'verdict' = 'ko' then v_alertes := v_alertes || jsonb_build_object('niveau','grave','texte','NF525 : au moins un contrôle en échec','page','qualite/nf525'); end if;
  if jsonb_array_length(v_impayes) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','grave','texte', jsonb_array_length(v_impayes) || ' établissement(s) en impayé','page','revenus/impayes'); end if;
  if v_nuit ? 'ok' and not (v_nuit->>'ok')::boolean then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte','Une tâche de nuit a échoué ou n''a pas tourné','page','qualite/sauvegardes'); end if;
  if v_vieux is not null and (v_vieux->>'heures')::int >= 24 then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte','Message support non lu depuis ' || (v_vieux->>'heures') || ' h','page','communication/chat'); end if;
  if coalesce((v_escal->>'sans_reponse')::int, 0) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte', (v_escal->>'sans_reponse') || ' question(s) transmise(s) par le bot sans réponse','page','communication/chat'); end if;
  if (select count(*) from jsonb_array_elements(v_essais7) e where (e->>'jours')::int <= 3) > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte', (select count(*) from jsonb_array_elements(v_essais7) e where (e->>'jours')::int <= 3) || ' essai(s) finissent dans 3 jours ou moins','page','revenus/impayes'); end if;
  if (select count(*) from jsonb_array_elements(v_nonconv) e where (e->>'depuis_jours')::int <= 7) > 0 then
    v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte', (select count(*) from jsonb_array_elements(v_nonconv) e where (e->>'depuis_jours')::int <= 7) || ' essai(s) terminé(s) cette semaine sans abonnement','page','revenus/impayes'); end if;
  if v_nf is not null and v_nf->>'verdict' = 'attention' then v_alertes := v_alertes || jsonb_build_object('niveau','attention','texte','NF525 : point(s) à surveiller','page','qualite/nf525'); end if;
  if v_mig_new > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', v_mig_new || ' nouvelle(s) demande(s) de migration','page','salons/migrations'); end if;
  if v_dem > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', v_dem || ' demande(s) d''essai à traiter','page','salons/demandes'); end if;
  if v_docs > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', v_docs || ' justificatif(s) à vérifier','page','salons/inscriptions'); end if;
  if jsonb_array_length(v_rappels) > 0 then v_alertes := v_alertes || jsonb_build_object('niveau','info','texte', jsonb_array_length(v_rappels) || ' rappel(s) prévu(s) aujourd''hui','page','salons/liste'); end if;

  return jsonb_build_object(
    'mrr', jsonb_build_object('total', round(v_mrr, 2), 'ref_mois', v_ref_mois, 'ref_total', v_ref_mrr,
            'variation', case when v_ref_mrr is null then null else round(v_mrr - v_ref_mrr, 2) end,
            'regle', 'abonnement Stripe en cours (actif ou impayé), hors comptes de test'),
    'abonnes', jsonb_build_object('payants', v_payants, 'essais', v_essais, 'actifs', v_actifs, 'tests', v_tests),
    'inscrits_7j', v_insc7_reels,
    'essais_7j', v_essais7,
    'essais_non_convertis', v_nonconv,
    'impayes', v_impayes,
    'support', jsonb_build_object('non_lus', v_unread, 'plus_ancien', v_vieux),
    'bot', v_escal,
    'a_reparer', jsonb_build_object('graves', v_ar_graves, 'total', v_ar_total, 'erreur', v_ar_err),
    'nf525', case when v_nf is null then jsonb_build_object('erreur', v_nf_err)
                  else jsonb_build_object('verdict', v_nf->>'verdict', 'icone', v_nf->>'icone', 'problemes', v_nf_pb, 'genere_le', v_nf->>'genere_le') end,
    'nuit', v_nuit,
    'compteurs', jsonb_build_object('demandes', v_dem, 'migrations', v_mig, 'migrations_nouvelles', v_mig_new,
                   'inscriptions_7j', v_insc7, 'documents', v_docs, 'rappels', jsonb_array_length(v_rappels)),
    'rappels', v_rappels,
    'alertes', v_alertes,
    'genere_le', now());
end $function$;
