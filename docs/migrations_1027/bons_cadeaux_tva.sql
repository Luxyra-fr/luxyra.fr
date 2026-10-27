-- =====================================================================================================================
-- 2026-10-28 — BONS CADEAUX : BON À USAGE UNIQUE (BUU) / À USAGE MULTIPLE (BUM) — Luxyra 6.7.0 — accord du propriétaire
-- NON APPLIQUÉ. À passer par Alexandre dans l'éditeur SQL, dans l'ordre indiqué en bas de fichier. Idempotent.
--
-- Règles : CGI art. 256 ter (3-b / 3-c, 1 et 2), art. 266, 1-a bis, art. 269, 2-c ; BOI-TVA-CHAMP-10-10-40-50 § 30-90 (version
-- du 14/02/2024) ; BOI-TVA-BASE-20-40 § 270-295.
--
-- POURQUOI CE SQL EST NÉCESSAIRE (l'application fonctionne sans, mais incomplètement) :
--  §1 cartes_cadeaux.usage_tva / qualif_tva : la qualification BUU / BUM doit être une donnée du BON, lisible par tous les
--     appareils et par le serveur. Sans les colonnes, l'application la range dans l'historique du bon (repli prévu dans
--     luxyra-supabase.js) — fonctionnel, mais moins lisible et non protégé.
--  §2 Qualification figée : une fois posée, usage_tva / qualif_tva ne peuvent plus être modifiés (traçabilité : la frontière
--     de non-rétroactivité ne doit pas pouvoir être déplacée a posteriori).
--  §3 Qualification des bons vendus EN LIGNE (edge function gc-create-checkout / gc-stripe-webhook, hors application) : le
--     serveur applique la même règle que l'application (taux des prestations, des produits et taux propres des produits en
--     vente) quand le modèle est activé (app_config.config.bons_tva_v2 = true) et qu'aucune qualification n'est fournie.
--  §4 Clôture mensuelle : total_ca reste le TOTAL DES TICKETS (règle du journal, inchangée, contrôlée par
--     b_nf525_z_controle_journal) ; raw_data reçoit en plus la somme des ventes de BUM hors chiffre d'affaires des Z du mois
--     (clotures.raw_data->>'totalHorsCa'), pour que l'e-mail au comptable (worker) et le rapport distinguent CA et BUM.
--     Empreinte ZM (format 'ZM|...') INCHANGÉE. Aucune ligne existante modifiée.
--
-- CE QUE CE SQL NE FAIT PAS : aucun ticket, bon, clôture, signature ou JET existant n'est modifié ; aucun format d'empreinte
-- ni de chaînage n'est changé ; ticket_nf525_insert (empreinte num|date|heure|ttc|ht|items|prev|salon) est inchangé.
-- =====================================================================================================================

begin;

-- ===================================================================================================================== §1
alter table public.cartes_cadeaux add column if not exists usage_tva text;
alter table public.cartes_cadeaux add column if not exists qualif_tva jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cartes_cadeaux_usage_tva_check') then
    alter table public.cartes_cadeaux add constraint cartes_cadeaux_usage_tva_check check (usage_tva is null or usage_tva in ('BUU','BUM'));
  end if;
end $$;
comment on column public.cartes_cadeaux.usage_tva is 'CGI art. 256 ter : BUU (bon à usage unique, TVA à la vente) / BUM (bon à usage multiple, vente hors champ, TVA à l''utilisation). NULL = bon antérieur à Luxyra 6.7.0 (traitement d''origine). Figé à la création.';
comment on column public.cartes_cadeaux.qualif_tva is 'Qualification TVA du bon à sa création : {usage, scope, taux[], tauxBon, franchise, regle, version, date, source}. Figée.';

-- ===================================================================================================================== §3
-- Taux possibles sur un périmètre (même règle que lxBonTauxPossibles dans app.html)
create or replace function lx_prive.bon_taux_possibles(p_salon uuid, p_scope text)
returns numeric[] language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_s numeric; v_p numeric; v_t numeric[] := '{}';
begin
  select coalesce(taux_tva, 20), coalesce(taux_tva_produits, coalesce(taux_tva, 20)) into v_s, v_p from public.salons where id = p_salon;
  if v_s = 0 then v_p := 0; end if;  -- franchise : produits à 0 (comme l'application)
  if coalesce(p_scope,'tout') <> 'produits' then v_t := array_append(v_t, v_s); end if;
  if coalesce(p_scope,'tout') <> 'prestations' then
    v_t := array_append(v_t, v_p);
    if v_s > 0 then
      v_t := v_t || coalesce((select array_agg(distinct tva_taux) from public.produits
                              where salon_id = p_salon and coalesce(for_sale, true) and tva_taux is not null), '{}');
    end if;
  end if;
  return (select array_agg(distinct x order by x) from unnest(v_t) x);
end $$;
revoke all on function lx_prive.bon_taux_possibles(uuid, text) from public, anon, authenticated;

create or replace function lx_prive.cartes_cadeaux_qualifier()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_actif boolean; v_t numeric[]; v_u text; v_q jsonb;
begin
  -- §2 : qualification figée (mise à jour)
  if tg_op = 'UPDATE' then
    if old.usage_tva is not null and (new.usage_tva is distinct from old.usage_tva or new.qualif_tva is distinct from old.qualif_tva) then
      new.usage_tva := old.usage_tva; new.qualif_tva := old.qualif_tva;   -- remis à l'identique, sans erreur (pas de blocage de l'encaissement)
    end if;
    if old.usage_tva is null and new.usage_tva is not null then
      new.usage_tva := null; new.qualif_tva := null;                      -- frontière : un bon existant sans qualification ne se requalifie jamais
    end if;                                                               -- (bon qualifié avant ce SQL : qualification gardée dans history, relue par l'app)
    return new;
  end if;
  -- §3 : INSERT sans qualification (vente en ligne), modèle activé, bon vendu (pas offert), ligne réellement NOUVELLE
  -- (un upsert de l'application sur un bon existant passe aussi par BEFORE INSERT : on n'y touche jamais)
  if new.usage_tva is not null or coalesce(new.is_offert, false) then return new; end if;
  if exists (select 1 from public.cartes_cadeaux c where c.id = new.id) then return new; end if;
  select coalesce((config->>'bons_tva_v2')::boolean, false) into v_actif from public.app_config where id = 1;
  if not coalesce(v_actif, false) then return new; end if;
  v_t := lx_prive.bon_taux_possibles(new.salon_id, coalesce(new.scope, 'tout'));
  v_u := case when coalesce(array_length(v_t, 1), 0) = 1 then 'BUU' else 'BUM' end;
  v_q := jsonb_build_object('usage', v_u, 'scope', coalesce(new.scope,'tout'), 'taux', to_jsonb(v_t), 'regle', 'CGI art. 256 ter',
                            'version', '6.7.0', 'date', coalesce(new.date_creation, (now() at time zone 'Europe/Paris')::date), 'source', 'serveur');
  if v_u = 'BUU' then v_q := v_q || jsonb_build_object('tauxBon', v_t[1]); if v_t[1] = 0 then v_q := v_q || '{"franchise":true}'::jsonb; end if; end if;
  new.usage_tva := v_u; new.qualif_tva := v_q;
  if v_u = 'BUM' then new.tva_rate := 0; new.ht := new.valeur; new.tva := 0;
  else new.tva_rate := v_t[1] / 100; new.ht := round(new.valeur / (1 + v_t[1] / 100), 2); new.tva := new.valeur - round(new.valeur / (1 + v_t[1] / 100), 2); end if;
  return new;
end $$;
revoke all on function lx_prive.cartes_cadeaux_qualifier() from public, anon, authenticated;
drop trigger if exists a_cartes_cadeaux_qualifier on public.cartes_cadeaux;
create trigger a_cartes_cadeaux_qualifier before insert or update of usage_tva, qualif_tva on public.cartes_cadeaux
  for each row execute function lx_prive.cartes_cadeaux_qualifier();

-- ===================================================================================================================== §4
-- cloturer_mois : corps de la version du 16/10/2026 (docs/migrations_1016/z_controle_annotations.sql) + raw_data.hors_ca_bum.
-- Garde : on ne remplace que la version attendue (présence de nf525_z_annotation_delta).
do $$ begin
  if position('nf525_z_annotation_delta' in pg_get_functiondef('public.cloturer_mois(uuid,integer,integer)'::regprocedure)) = 0 then
    raise exception 'cloturer_mois : version en base différente de celle du 16/10/2026 — relire avant de remplacer';
  end if;
end $$;

CREATE OR REPLACE FUNCTION public.cloturer_mois(p_salon_id uuid, p_annee integer, p_mois integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text; v_nb_jours int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0; v_cloture_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid; v_pay_keys text[]; v_k text; v_sum_pay numeric; v_d record; v_raw jsonb := null;
  v_hc numeric := 0;
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
  -- 2026-10-28 (Luxyra 6.7.0) : ventes de bons à usage multiple (hors CA, TVA 0) comprises dans total_ca -> détaillées à part
  SELECT round(COALESCE(SUM(CASE WHEN jsonb_typeof(c.raw_data->'totalHorsCa') = 'number' THEN (c.raw_data->>'totalHorsCa')::numeric ELSE 0 END), 0), 2) INTO v_hc
    FROM clotures c WHERE c.salon_id = p_salon_id AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee AND EXTRACT(MONTH FROM c.date_cloture)::int = p_mois;
  IF coalesce(v_hc, 0) <> 0 THEN
    v_raw := coalesce(v_raw, '{}'::jsonb) || jsonb_build_object('hors_ca_bum', v_hc, 'ca_hors_bum', round(v_ca - v_hc, 2));
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
    v_nb_tickets || ' tickets, ' || to_char(v_ca, 'FM9999999.99') || ' EUR' || CASE WHEN v_raw ? 'annotations' THEN ' (Z annotées : montants corrigés)' ELSE '' END ||
    CASE WHEN coalesce(v_hc,0) <> 0 THEN ' (dont ' || to_char(v_hc, 'FM9999999.99') || ' EUR de bons à usage multiple vendus, hors CA)' ELSE '' END, 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'annee', p_annee, 'mois', p_mois,
    'nb_jours', v_nb_jours, 'nb_tickets', v_nb_tickets, 'total_ca', v_ca, 'total_ht', v_ht, 'total_tva', v_tva, 'hash', v_hash,
    'hors_ca_bum', coalesce(v_hc, 0));
END;
$function$;

commit;

-- =====================================================================================================================
-- VÉRIFICATIONS (lecture seule, après application)
-- select column_name from information_schema.columns where table_name='cartes_cadeaux' and column_name in ('usage_tva','qualif_tva');
-- select tgname from pg_trigger where tgrelid='public.cartes_cadeaux'::regclass and not tgisinternal;
-- select lx_prive.bon_taux_possibles('e0cf27c7-d402-4d76-8e91-9ef5231b3582','tout');   -- Excellence Coiffure : {20} attendu -> BUU
-- Test en transaction annulée (aucune trace) :
-- begin; update public.app_config set config = config || '{"bons_tva_v2":true}' where id=1;
--   insert into public.cartes_cadeaux (id, salon_id, code, valeur, restant, utilise, status, scope, date_creation, date_expiration, is_offert)
--   values (gen_random_uuid(), '<salon test>', 'TEST-BUM', 100, 100, 0, 'active', 'tout', current_date, current_date + 365, false) returning usage_tva, qualif_tva, tva_rate, ht, tva;
-- rollback;
--
-- ORDRE DE MISE EN SERVICE (le modèle reste INACTIF tant que l'étape 5 n'est pas faite)
--  1. Ce fichier (SQL).
--  2. Edge function lx-cloture-auto : recopier la ventilation v2 de l'application (_lxVentilV2 / _lxTicketV2 / _splitPrestProd /
--     _lxHtTva : lignes items[].isBon + bonUsage='BUM' hors CA, HT = TTC, TVA 0 ; bonsUtil[].lignes imputées) et ajouter
--     totalHorsCa / caHorsBum / bumUtilises dans raw_data ; relancer {"mode":"verify"} (identique avant / après sur Excellence).
--  3. Worker (docs/luxyra-router-worker.js) : déjà prêt (libellés CA / BUM lus dans clotures_mensuelles.raw_data).
--  4. Pages (app.html + luxyra-supabase.js 20261028-1 + lx-demo.js).
--  5. Activation : update public.app_config set config = config || '{"bons_tva_v2":true}' where id = 1;
--     -> date/heure d'activation = FRONTIÈRE de non-rétroactivité (à reporter au registre NF525).
--  6. docs/migrations_1028/bot_bons_cadeaux_tva.sql (base du bot).
--
-- ROLLBACK (commenté, à n'utiliser qu'avant toute vente de bon qualifié ; ensuite, NE PAS supprimer les colonnes : elles
-- portent la qualification de bons vendus) :
-- update public.app_config set config = config - 'bons_tva_v2' where id = 1;           -- désactive le modèle (bons déjà qualifiés : gardent leur traitement)
-- drop trigger if exists a_cartes_cadeaux_qualifier on public.cartes_cadeaux;
-- drop function if exists lx_prive.cartes_cadeaux_qualifier();
-- drop function if exists lx_prive.bon_taux_possibles(uuid, text);
-- -- cloturer_mois : réappliquer le corps de docs/migrations_1016/z_controle_annotations.sql (§3, CREATE OR REPLACE FUNCTION public.cloturer_mois)
-- -- seulement si aucune clôture mensuelle n'a encore été créée avec raw_data.hors_ca_bum :
-- --   select count(*) from clotures_mensuelles where raw_data ? 'hors_ca_bum';   -- doit valoir 0
-- alter table public.cartes_cadeaux drop constraint if exists cartes_cadeaux_usage_tva_check;
-- alter table public.cartes_cadeaux drop column if exists qualif_tva;                     -- uniquement si select count(*) ... where usage_tva is not null = 0
-- alter table public.cartes_cadeaux drop column if exists usage_tva;
-- =====================================================================================================================
