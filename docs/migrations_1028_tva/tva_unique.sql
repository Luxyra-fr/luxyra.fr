-- =====================================================================================================================
-- 2026-10-28 — TVA : UNE SEULE RÈGLE DANS TOUS LES DOCUMENTS (lot 3 de l'audit indépendant : constats M1, M2, M3)
-- Luxyra 6.8.5 (version MINEURE) — NON APPLIQUÉ. À passer par Alexandre dans l'éditeur SQL du tableau de bord Supabase,
-- dans l'ordre de déploiement du registre NF525 (intervention -7 du 28/10/2026). Idempotent (create or replace, drop trigger if
-- exists) ; garde de tête : arrêt si une fonction protégée diffère de la version relue en production le 28/10/2026.
--
-- RÈGLE RETENUE (sources : registre NF525, intervention -7 du 28/10/2026) : la TVA collectée d'une période = SOMME, PAR TAUX, des
-- montants HT et TVA ENREGISTRÉS sur chaque ticket ; sur le ticket, HT d'un taux = TTC du taux / (1 + taux) arrondi au centime,
-- TVA = TTC − HT. CGI ann. II art. 242 nonies A, I-14° (par taux : total HT et taxe correspondante) ; CGI art. 283, 3 (la TVA
-- mentionnée est due) ; rép. min. n° 26125, JO AN 10/03/2020 (TVA calculée au centime pour chaque facturation, arrondi à l'euro
-- sur la déclaration seulement) ; CJUE 10/07/2008, C-484/06 Koninklijke Ahold ; BOI-TVA-DECLA-30-10-30 § 170, § 180.
--
-- CE QUE FAIT CE FICHIER (aucune ligne existante modifiée : tickets, Z, clôtures, signatures, JET intacts ; aucun format
-- d'empreinte modifié — les empreintes des clôtures ne portent pas sur le HT : ZM|…|CA|nb|…, ZA|…, ZE|…) :
--  §1 lx_prive.tva_ticket_lignes : ventilation par taux d'un ticket à partir de ses valeurs ENREGISTRÉES (raw_data.lxTva posé
--     par l'application 6.8.5, jamais cru tel quel : revalidé entièrement contre le ticket scellé ; sinon taux_tva / total_ht
--     scellés) ; aides lx_prive.tva_num, lx_prive.tva_vrai, lx_prive.tva_item_montant ;
--  §1 bis contrôle a_lx_tickets_raw_data_fige : raw_data d'un ticket figé dès l'enregistrement (lxTva, tkNum, annulation, report,
--     version… : clés lues par les documents fiscaux et les contrôles ; RLS tickets_tenant_update le laissait modifiable par le
--     propriétaire, hors sceau) ; seul contournement : luxyra.allow_nf525_unlock = 'true', tracé dans audit_log ;
--  §2 lx_prive.tva_periode : somme d'une période (journal des tickets, même périmètre que la Z : statut ET mode de caisse) ;
--  §3 contrôle de la base b_nf525_z_controle_tva : une Z au nouveau modèle (raw_data.tvaRegle = 'tickets-v1') doit déclarer
--     le HT = somme des HT des tickets du jour (LX_Z_ECART_TVA) ; Z sans la marque (anciens appareils, Z déjà scellées) : rien ;
--  §4 public.lx_tva_periode_controle : lecture (envoi au comptable, contrôle) TVA de la période + rapprochement avec les Z ;
--  §5-§7 cloturer_mois / cloturer_annee / cloturer_exercice = définitions de PRODUCTION + HT / TVA = somme des tickets de la
--     période (si le journal concorde avec le CA des Z / des mois), HT des Z et écart d'arrondi dans raw_data.tva (mois, année).
--     FRONTIÈRE : seules les clôtures CRÉÉES après l'application de ce fichier suivent la règle ; aucune clôture existante n'est
--     recalculée. La clôture mensuelle d'octobre 2026 (créée le 01/11) contiendra les Z d'avant et d'après la mise en service :
--     HT = somme des tickets, raw_data.tva.ht_z = somme des Z, raw_data.tva.ecart_ht_z = écart d'arrondi des Z anciennes.
--
-- RETOUR ARRIÈRE : docs/migrations_1028_tva/tva_unique_retour_arriere.sql (définitions de production du 28/10/2026 à l'identique,
-- suppression du contrôle §3 et des fonctions §1, §2, §4). Les clôtures créées entre-temps restent valables (même CA, même
-- empreinte ; seul leur HT suit la somme des tickets).
-- =====================================================================================================================

-- ===================================================================================================================== §0
-- Garde : empreintes md5(pg_get_functiondef(oid)) relevées en PRODUCTION le 28/10/2026 (lecture seule, connecteur Supabase),
-- OU empreinte de la définition posée par CE fichier (seconde exécution). Toute autre valeur arrête le script.
do $$
declare
  v_attendu constant jsonb := jsonb_build_object(
    'public.ticket_nf525_insert()',               jsonb_build_array('3219a36f2892dfb5287aa258e7afb0fa'),
    'lx_prive.clotures_controle_journal()',       jsonb_build_array('f60dd43a409593d75f31f229ae4e0994'),
    'lx_prive.z_journal_tickets(uuid,date,text)', jsonb_build_array('18542996de6be22fb08239f9c0c34735'),
    'public.nf525_z_annotation_delta(uuid,date,date)', jsonb_build_array('051ebd31f46390cc1d055b5fa70c2ce3'),
    'public.cloturer_mois(uuid,integer,integer)', jsonb_build_array('10fb2481b3ece62961d0a014f26a9d92', '4a33de47d0542ac1ec4c8125b6e4ad7a'),
    'public.cloturer_annee(uuid,integer)',        jsonb_build_array('76636cd247de920d3f696f6aa0ca0b00', '9111b2ae506fb6e7d2cfb4608c36c9bf'),
    'public.cloturer_exercice(uuid,date)',        jsonb_build_array('9c30504431a8026729e6266b907bcd70', 'daada01d5cf0b5825490c934c9107302'));
  k text; v_md5 text;
begin
  for k in select jsonb_object_keys(v_attendu) loop
    if to_regprocedure(k) is null then raise exception 'Garde 28/10/2026 : fonction % absente en base — relire avant d''appliquer', k; end if;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(k)));
    if not (v_attendu->k) ? v_md5 then
      raise exception 'Garde 28/10/2026 : % différente de la version relue en production (md5 %, attendu %) — relire avant d''appliquer', k, v_md5, v_attendu->k;
    end if;
  end loop;
  if to_regprocedure('lx_prive.appel_serveur()') is null or to_regprocedure('public.is_admin()') is null then raise exception 'Garde 28/10/2026 : lx_prive.appel_serveur() / is_admin() absentes'; end if;
end $$;

-- ===================================================================================================================== §1
-- Ventilation TVA d'UN ticket à partir de ses valeurs ENREGISTRÉES. Une ventilation mémorisée (raw_data.lxTva, posée par
-- l'application 6.8.5) n'est JAMAIS reprise telle quelle (contre-audit du lot 3, 28/10/2026) : elle n'est retenue que si elle est
-- entièrement cohérente avec les données SCELLÉES du ticket — même règle que _lxTvaValide de l'application et de lx-cloture-auto :
--   * taux autorisés seulement : taux enregistré du ticket (taux_tva ; 0 en franchise), taux propres de ses lignes (items[].tvaTaux,
--     items[].bonTaux), taux des produits de l'établissement si le ticket contient des produits, taux des bons utilisés
--     (raw_data.bonsUtil[].lignes) ; un taux par ligne ;
--   * HT de chaque ligne = TTC / (1 + taux) arrondi au centime (écart d'au plus 0,01 sur UNE seule ligne : ajustement au centime
--     sur le HT scellé) ; TVA = TTC − HT (la TVA mémorisée est ignorée) ;
--   * hors CA = ventes de bons à usage multiple RECALCULÉES depuis les lignes scellées (items), la valeur mémorisée doit y être égale ;
--   * somme des TTC + hors CA = TTC scellé ; somme des HT + hors CA = HT scellé ; chaque nature (prestations / produits) seulement
--     si le ticket a des lignes de cette nature à ce taux.
-- Sinon (et pour les tickets antérieurs, ceux créés par le serveur) : lignes du ticket au taux ENREGISTRÉ, TTC réparti au prorata, HT
-- arrondi par taux puis ajusté au centime sur le HT SCELLÉ. Lecture seule. Retour : {hc, l:[{t, ttc, ht, tva}], src}.
create or replace function lx_prive.tva_num(p jsonb) returns numeric language sql immutable set search_path = pg_catalog as $$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric
              when jsonb_typeof(p) = 'string' and (p #>> '{}') ~ '^-?[0-9]+(\.[0-9]+)?$' then (p #>> '{}')::numeric end
$$;
-- valeur « vraie » au sens de l'application (JavaScript) : présente et différente de false / null / 0 / ""
create or replace function lx_prive.tva_vrai(p jsonb) returns boolean language sql immutable set search_path = pg_catalog as $$
  select p is not null and p not in ('false'::jsonb, 'null'::jsonb, '0'::jsonb, '""'::jsonb)
$$;
-- montant d'une ligne, comme l'application : price × (qty, 1 si absente ou nulle) − remise
create or replace function lx_prive.tva_item_montant(e jsonb) returns numeric language sql immutable set search_path = pg_catalog, lx_prive as $$
  select coalesce(lx_prive.tva_num(e->'price'), 0) * coalesce(nullif(lx_prive.tva_num(e->'qty'), 0), 1) - coalesce(lx_prive.tva_num(e->'remise'), 0)
$$;
drop function if exists lx_prive.tva_ticket_lignes(jsonb, numeric, numeric, numeric, jsonb, numeric);
create or replace function lx_prive.tva_ticket_lignes(p_items jsonb, p_ttc numeric, p_ht numeric, p_taux numeric, p_lxtva jsonb, p_taux_prod numeric default null, p_bons jsonb default null)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_ttc numeric := round(coalesce(p_ttc, 0), 2); v_ht numeric := round(coalesce(p_ht, 0), 2);
  v_s numeric := coalesce(p_taux, 0); v_p numeric; v_som numeric := 0; v_hc numeric := 0; v_ca numeric;
  v_n int; v_l jsonb := '[]'::jsonb; r record; v_cum numeric := 0; v_htsum numeric := 0; v_max numeric := null; v_imax int := 0; v_i int := 0;
  v_arr numeric[] := '{}'; v_tt numeric[] := '{}'; v_hh numeric[] := '{}'; v_d numeric;
  v_items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  v_bons jsonb := case when jsonb_typeof(p_bons) = 'array' then p_bons else '[]'::jsonb end;
  v_pp numeric[]; v_pq numeric[]; v_vus numeric[] := '{}'; v_ok boolean; v_adj boolean := false; v_li jsonb;
  v_t numeric; v_lt numeric; v_lh numeric; v_qt numeric; v_e numeric; v_st numeric; v_sh numeric;
begin
  v_p := case when v_s > 0 then coalesce(p_taux_prod, v_s) else 0 end;
  -- hors CA attendu : ventes de bons à usage multiple des lignes SCELLÉES (borné par le TTC, comme l'application)
  select round(coalesce(sum(lx_prive.tva_item_montant(x)), 0), 2) into v_hc from jsonb_array_elements(v_items) x
   where jsonb_typeof(x) = 'object' and not lx_prive.tva_vrai(x->'isSep') and x->'isBon' = 'true'::jsonb and x->>'bonUsage' = 'BUM';
  if v_ttc >= 0 then v_hc := least(v_hc, v_ttc); else v_hc := greatest(v_hc, v_ttc); end if;
  v_ca := round(v_ttc - v_hc, 2);
  if p_lxtva is not null and jsonb_typeof(p_lxtva) = 'object' and jsonb_typeof(p_lxtva->'l') = 'array' and lx_prive.tva_num(p_lxtva->'v') = 1 then
    v_ok := true;
    -- taux et natures autorisés par les lignes SCELLÉES (même règle que lxTvaCalculer) : prestations au taux de l'établissement
    -- toujours ; chaque ligne : taux propre (si taux > 0) sinon taux prestations / produits ; bons utilisés : taux|nature des lignes couvertes
    select coalesce(array_agg(distinct tx) filter (where nat = 'P'), '{}'), coalesce(array_agg(distinct tx) filter (where nat = 'Q'), '{}') into v_pp, v_pq from (
      select v_s tx, 'P' nat
      union all
      select case when v_s > 0 and lx_prive.tva_num(x->'tvaTaux') is not null then lx_prive.tva_num(x->'tvaTaux')
                  when lx_prive.tva_vrai(x->'isProd') then v_p else v_s end,
             case when lx_prive.tva_vrai(x->'isProd') then 'Q' else 'P' end
        from jsonb_array_elements(v_items) x
       where jsonb_typeof(x) = 'object' and not lx_prive.tva_vrai(x->'isSep') and not coalesce(x->'isBon' = 'true'::jsonb and x->>'bonUsage' = 'BUM', false)
      union all
      select case when v_s > 0 then split_part(k, '|', 1)::numeric else 0 end, case when split_part(k, '|', 2) = 'Q' then 'Q' else 'P' end
        from jsonb_array_elements(v_bons) b, jsonb_object_keys(case when jsonb_typeof(b->'lignes') = 'object' then b->'lignes' else '{}'::jsonb end) k
       where coalesce(b->>'usage', '') <> 'BUM' and split_part(k, '|', 1) ~ '^-?[0-9]+(\.[0-9]+)?$') y where tx is not null;
    if p_lxtva ? 'hc' and jsonb_typeof(p_lxtva->'hc') <> 'null' and lx_prive.tva_num(p_lxtva->'hc') is null then v_ok := false; end if;
    if v_ok and abs(round(coalesce(lx_prive.tva_num(p_lxtva->'hc'), 0), 2) - v_hc) >= 0.005 then v_ok := false; end if;
    v_st := v_hc; v_sh := v_hc;
    if v_ok then
      for v_li in select x from jsonb_array_elements(p_lxtva->'l') x loop
        if jsonb_typeof(v_li) <> 'object' or lx_prive.tva_num(v_li->'t') is null or lx_prive.tva_num(v_li->'ttc') is null or lx_prive.tva_num(v_li->'ht') is null then v_ok := false; exit; end if;
        v_t := lx_prive.tva_num(v_li->'t');
        if not (v_t = any(v_pp) or v_t = any(v_pq)) or v_t = any(v_vus) then v_ok := false; exit; end if;
        v_vus := v_vus || v_t;
        v_lt := round(lx_prive.tva_num(v_li->'ttc'), 2); v_lh := round(lx_prive.tva_num(v_li->'ht'), 2);
        v_e := abs(v_lh - case when v_t > 0 then round(v_lt / (1 + v_t / 100), 2) else v_lt end);
        if v_e >= 0.005 then if v_e > 0.0105 or v_adj then v_ok := false; exit; end if; v_adj := true; end if;
        if v_li ? 'qt' and jsonb_typeof(v_li->'qt') <> 'null' and lx_prive.tva_num(v_li->'qt') is null then v_ok := false; exit; end if;
        v_qt := round(coalesce(lx_prive.tva_num(v_li->'qt'), 0), 2);
        if v_li ? 'pt' and jsonb_typeof(v_li->'pt') <> 'null' and (lx_prive.tva_num(v_li->'pt') is null or abs(round(lx_prive.tva_num(v_li->'pt'), 2) - round(v_lt - v_qt, 2)) >= 0.005) then v_ok := false; exit; end if;
        if (abs(v_lt - v_qt) > 0.004 and not (v_t = any(v_pp))) or (abs(v_qt) > 0.004 and not (v_t = any(v_pq))) then v_ok := false; exit; end if; -- nature sans ligne de cette nature à ce taux
        v_st := v_st + v_lt; v_sh := v_sh + v_lh;
        v_l := v_l || jsonb_build_object('t', v_t, 'ttc', v_lt, 'ht', v_lh, 'tva', round(v_lt - v_lh, 2));
      end loop;
    end if;
    if v_ok and abs(round(v_st, 2) - v_ttc) >= 0.005 then v_ok := false; end if;
    if v_ok and p_ht is not null and abs(round(v_sh, 2) - v_ht) >= 0.005 then v_ok := false; end if;
    if v_ok then
      return jsonb_build_object('src', 'ticket', 'hc', v_hc,
        'l', (select coalesce(jsonb_agg(x order by (x->>'t')::numeric desc), '[]'::jsonb) from jsonb_array_elements(v_l) x));
    end if;
    v_l := '[]'::jsonb;
  end if;
  v_htsum := 0; v_som := 0;
  -- lignes du ticket (hors ventes de bons à usage multiple), par taux
  for r in
    select t, sum(m) amt from (
      select lx_prive.tva_item_montant(e) m,
             case when v_s > 0 and lx_prive.tva_num(e->'tvaTaux') is not null then lx_prive.tva_num(e->'tvaTaux')
                  when lx_prive.tva_vrai(e->'isProd') then v_p else v_s end t
        from jsonb_array_elements(v_items) e
       where jsonb_typeof(e) = 'object' and not lx_prive.tva_vrai(e->'isSep') and not coalesce(e->'isBon' = 'true'::jsonb and e->>'bonUsage' = 'BUM', false)) z
     group by t order by t desc
  loop v_tt := v_tt || r.t; v_arr := v_arr || r.amt; end loop;
  v_som := coalesce((select sum(x) from unnest(v_arr) x), 0);
  v_n := coalesce(array_length(v_tt, 1), 0);
  if v_n <= 1 or abs(v_som) < 0.005 or v_som * v_ca < 0 then
    -- un seul taux (cas de tous les tickets de production au 28/10/2026) : HT = HT scellé hors bons à usage multiple
    if abs(v_ca) >= 0.005 or abs(v_ttc) < 0.005 then
      v_l := jsonb_build_array(jsonb_build_object('t', coalesce(v_tt[1], v_s), 'ttc', v_ca, 'ht', round(v_ht - v_hc, 2), 'tva', round(v_ca - (v_ht - v_hc), 2)));
    end if;
    return jsonb_build_object('src', 'journal', 'hc', v_hc, 'l', v_l);
  end if;
  -- plusieurs taux : prorata, reste sur le groupe le plus important ; HT par taux ; ajustement au centime sur le HT scellé
  for v_i in 1..v_n loop if v_max is null or abs(v_arr[v_i]) > v_max then v_max := abs(v_arr[v_i]); v_imax := v_i; end if; end loop;
  for v_i in 1..v_n loop
    if v_i <> v_imax then v_arr[v_i] := round(v_arr[v_i] / v_som * v_ca, 2); v_cum := v_cum + v_arr[v_i]; end if;
  end loop;
  v_arr[v_imax] := round(v_ca - v_cum, 2);
  for v_i in 1..v_n loop v_hh := v_hh || (case when v_tt[v_i] > 0 then round(v_arr[v_i] / (1 + v_tt[v_i] / 100), 2) else v_arr[v_i] end); v_htsum := v_htsum + v_hh[v_i]; end loop;
  v_d := round((v_ht - v_hc) - v_htsum, 2);
  if abs(v_d) >= 0.005 then v_hh[v_imax] := v_hh[v_imax] + v_d; end if;
  for v_i in 1..v_n loop
    v_l := v_l || jsonb_build_object('t', v_tt[v_i], 'ttc', v_arr[v_i], 'ht', v_hh[v_i], 'tva', round(v_arr[v_i] - v_hh[v_i], 2));
  end loop;
  return jsonb_build_object('src', 'journal', 'hc', v_hc, 'l', v_l);
end $$;
comment on function lx_prive.tva_ticket_lignes(jsonb, numeric, numeric, numeric, jsonb, numeric, jsonb) is
  'Luxyra 6.8.5 (28/10/2026) : ventilation TVA par taux d''un ticket à partir de ses valeurs ENREGISTRÉES ; ventilation mémorisée revalidée entièrement (règle TVA unique, registre NF525).';

-- ===================================================================================================================== §1 bis
-- raw_data d'un ticket FIGÉ dès l'enregistrement (contre-audit du lot 3, 28/10/2026). Constat : la politique RLS
-- tickets_tenant_update laisse le propriétaire (rôle authenticated) modifier raw_data, qui n'entre ni dans l'empreinte ni dans
-- l'instantané du sceau (_nf525_seal_row) et n'est protégé ni par tickets_nf525_protect ni par ticket_nf525_update. Or des documents
-- fiscaux et des contrôles lisent raw_data : lxTva (ventilation TVA : Z, clôtures, rapport, FEC, EBP, e-mail au comptable), tkNum
-- (n° imprimé : rapprochement Z / journal, duplicata, corrections de règlement, numérotation serveur), id (identifiant : unicité,
-- rapprochement), isCancel / cancelRef / contraSameDay (paires d'annulation de la Z), isRetour / retourRefId / retourRefTk /
-- retourMotif, isAcompte / isAcompteCancel / acompteKey / acompte / acompteMode / isRetenue / retenueKey (contrôles et libellés FEC),
-- serveur / lxVersion (contrôle de version, série serveur), dateVente / reportJourClos (ventes reportées), payments / comment
-- (doublons Click & Collect), bonsUtil (ventilation des bons), html (réimpression fidèle / duplicata). Toutes ces clés ont un effet
-- fiscal : raw_data ENTIER est figé (refus de toute modification, quelle que soit la clé). Écritures légitimes relevées (app,
-- lx-cloture-auto, worker, fonctions SQL de production, tâches cron, 46 fonctions edge déployées) : AUCUNE ne modifie raw_data
-- après l'insertion (annulation : status / cancelled_at / cancel_reason ; verrouillage : locked / cloture_id ; fusion de fiches
-- clients : client_id) — elles ne sont pas concernées. Seul contournement : le déverrouillage explicite existant
-- luxyra.allow_nf525_unlock = 'true' (maintenance encadrée), tracé dans audit_log (NF525_INALTERABILITE_BYPASSEE).
create or replace function lx_prive.tickets_raw_data_fige()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_bypass text; v_cles text;
begin
  if NEW.raw_data is not distinct from OLD.raw_data then return NEW; end if;
  begin v_bypass := current_setting('luxyra.allow_nf525_unlock', true); exception when others then v_bypass := null; end;
  if jsonb_typeof(OLD.raw_data) = 'object' and jsonb_typeof(NEW.raw_data) = 'object' then
    select string_agg(k, ', ' order by k) into v_cles from (
      select jsonb_object_keys(OLD.raw_data) k union select jsonb_object_keys(NEW.raw_data)) x
     where (OLD.raw_data -> x.k) is distinct from (NEW.raw_data -> x.k);
  else v_cles := '(raw_data entier)'; end if;
  if v_bypass = 'true' then
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (OLD.salon_id, 'NF525_INALTERABILITE_BYPASSEE', left('UPDATE tickets n°' || coalesce(OLD.num::text, '?') || ' (id ' || OLD.id || ') raw_data modifié — clés : ' || coalesce(v_cles, '?') || ' user=' || current_user, 1900), 'BYPASS_EXPLICITE');
    return NEW;
  end if;
  raise exception 'LX_TICKET_DONNEES_FIGEES : ticket n°% — les données enregistrées du ticket (raw_data : %) ne peuvent pas être modifiées après son enregistrement (ventilation TVA, n° imprimé, annulation, report, version…). Pour corriger un ticket : ticket d''annulation.',
    coalesce(OLD.num::text, '?'), left(coalesce(v_cles, '?'), 300) using errcode = 'P0001';
end $$;
drop trigger if exists a_lx_tickets_raw_data_fige on public.tickets;
create trigger a_lx_tickets_raw_data_fige before update on public.tickets for each row execute function lx_prive.tickets_raw_data_fige();
revoke all on function lx_prive.tickets_raw_data_fige() from public, anon, authenticated;

-- ===================================================================================================================== §2
-- Somme d'une période : tickets du journal (status <> cancelled, MODE DE CAISSE comme la Z : mode courant de l'établissement par
-- défaut, tickets sans mode compris), par taux. {regle, mode, nb, ttc, ht, tva, hc, par_taux}
drop function if exists lx_prive.tva_periode(uuid, date, date);
create or replace function lx_prive.tva_periode(p_salon uuid, p_du date, p_au date, p_mode text default null)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_tp numeric; v jsonb; v_mode text;
begin
  select case when coalesce(taux_tva, 20) > 0 then coalesce(taux_tva_produits, taux_tva, 20) else 0 end, coalesce(p_mode, mode_caisse)
    into v_tp, v_mode from public.salons where id = p_salon;
  with t as (
    select x.total_ttc, x.total_ht, x.total_tva,
           lx_prive.tva_ticket_lignes(x.items, x.total_ttc, x.total_ht, x.taux_tva, x.raw_data->'lxTva', v_tp, x.raw_data->'bonsUtil') j
      from public.tickets x
     where x.salon_id = p_salon and x.date_ticket between p_du and p_au and x.status <> 'cancelled'
       and (x.mode_caisse is null or v_mode is null or x.mode_caisse = v_mode)
  ), l as (
    select (e->>'t')::numeric tx, (e->>'ttc')::numeric ttc, (e->>'ht')::numeric ht, (e->>'tva')::numeric tva
      from t, jsonb_array_elements(t.j->'l') e
  ), pt as (
    select tx, round(sum(ttc), 2) ttc, round(sum(ht), 2) ht, round(sum(tva), 2) tva from l group by tx
  )
  select jsonb_build_object('regle', 'tickets-v1', 'mode', v_mode,
      'nb', (select count(*) from t),
      'ttc', (select round(coalesce(sum(total_ttc), 0), 2) from t),
      'ht', (select round(coalesce(sum(total_ht), 0), 2) from t),
      'tva', (select round(coalesce(sum(total_tva), 0), 2) from t),
      'hc', (select round(coalesce(sum((j->>'hc')::numeric), 0), 2) from t),
      'par_taux', coalesce((select jsonb_agg(jsonb_build_object('taux', tx, 'ttc', ttc, 'ht', ht, 'tva', tva) order by tx desc) from pt where abs(ttc) >= 0.005 or abs(ht) >= 0.005), '[]'::jsonb))
    into v;
  return v;
end $$;
revoke all on function lx_prive.tva_periode(uuid, date, date, text) from public, anon, authenticated;

-- ===================================================================================================================== §3
-- Contrôle de la base : une Z au nouveau modèle (raw_data.tvaRegle = 'tickets-v1', posé par l'application 6.8.5 et par
-- lx-cloture-auto v3.5) doit déclarer un HT ÉGAL à la somme des HT enregistrés des tickets de la journée (même périmètre que
-- le contrôle du CA : status <> cancelled, mode de caisse). Sinon refus LX_Z_ECART_TVA (l'application rouvre la journée et
-- propose « Recalculer depuis les tickets enregistrés »). Les Z antérieures (sans la marque) : contrôle inchangé.
create or replace function lx_prive.clotures_controle_tva()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_ht numeric; v_bypass text;
begin
  if coalesce(NEW.raw_data->>'tvaRegle', '') <> 'tickets-v1' then return NEW; end if;
  begin v_bypass := current_setting('luxyra.allow_nf525_unlock', true); exception when others then v_bypass := null; end;
  select coalesce(round(sum(t.total_ht), 2), 0) into v_ht from public.tickets t
   where t.salon_id = NEW.salon_id and t.date_ticket = NEW.date_cloture and t.status <> 'cancelled'
     and (t.mode_caisse is null or NEW.mode_caisse is null or t.mode_caisse = NEW.mode_caisse);
  if abs(coalesce(NEW.total_ht, 0) - v_ht) > 0.005 then
    if v_bypass = 'true' then
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (NEW.salon_id, 'NF525_INALTERABILITE_BYPASSEE', 'INSERT clotures Z n°' || NEW.num || ' HT différent du journal (' || NEW.total_ht || ' vs ' || v_ht || ') user=' || current_user, 'BYPASS_EXPLICITE');
    else
      raise exception 'LX_Z_ECART_TVA : clôture Z n°% du % refusée — HT déclaré % EUR, somme des HT enregistrés sur les tickets de la journée % EUR. Recalculez la clôture depuis les tickets enregistrés.',
        NEW.num, to_char(NEW.date_cloture, 'DD/MM/YYYY'), to_char(coalesce(NEW.total_ht, 0), 'FM999999990.00'), to_char(v_ht, 'FM999999990.00')
        using errcode = 'P0001';
    end if;
  end if;
  return NEW;
end $$;
drop trigger if exists b_nf525_z_controle_tva on public.clotures;
create trigger b_nf525_z_controle_tva before insert on public.clotures for each row execute function lx_prive.clotures_controle_tva();

-- ===================================================================================================================== §4
-- Lecture (envoi au comptable, contrôle) : TVA d'une période selon la règle unique + rapprochement avec les clôtures SCELLÉES.
-- Propriétaire de l'établissement, administrateur Luxyra ou appel serveur (clé service). Lecture seule.
create or replace function public.lx_tva_periode_controle(p_salon uuid, p_du date, p_au date)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; v_zca numeric; v_zht numeric; v_nb int; v_nbv int; v_d record;
begin
  if not (lx_prive.appel_serveur() or public.is_admin() or exists (select 1 from public.salons s where s.id = p_salon and s.user_id = auth.uid())) then
    raise exception 'LX_REFUS : accès refusé' using errcode = '42501';
  end if;
  v := lx_prive.tva_periode(p_salon, p_du, p_au);
  select count(*), count(*) filter (where coalesce(raw_data->>'tvaRegle', '') <> 'tickets-v1'), coalesce(sum(total_ca), 0), coalesce(sum(total_ht), 0)
    into v_nb, v_nbv, v_zca, v_zht from public.clotures where salon_id = p_salon and date_cloture between p_du and p_au
     and (mode_caisse is null or (v->>'mode') is null or mode_caisse = (v->>'mode')); -- même mode de caisse que les tickets (§2)
  select * into v_d from public.nf525_z_annotation_delta(p_salon, p_du, p_au);
  v_zca := round(v_zca + coalesce(v_d.d_ca, 0), 2); v_zht := round(v_zht + coalesce(v_d.d_ht, 0), 2);
  return v || jsonb_build_object('du', p_du, 'au', p_au, 'z_nb', v_nb, 'z_ancienne_regle', v_nbv, 'z_ca', v_zca, 'z_ht', v_zht, 'z_tva', round(v_zca - v_zht, 2),
    'ecart_ht', round(v_zht - (v->>'ht')::numeric, 2), 'ecart_tva', round((v_zca - v_zht) - (v->>'tva')::numeric, 2),
    'concordance_ca', abs(v_zca - (v->>'ttc')::numeric) < 0.005);
end $$;
revoke all on function public.lx_tva_periode_controle(uuid, date, date) from public, anon;
grant execute on function public.lx_tva_periode_controle(uuid, date, date) to authenticated, service_role;

-- ===================================================================================================================== §5
-- cloturer_mois : définition de PRODUCTION (md5 10fb2481…, posée par docs/migrations_1028/recettes_en_ligne.sql) + bloc
-- LX_TVA_UNIQUE_2026_10_28 (HT / TVA = somme des tickets du mois ; HT des Z et écart dans raw_data.tva). Reste inchangé.
CREATE OR REPLACE FUNCTION public.cloturer_mois(p_salon_id uuid, p_annee integer, p_mois integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text; v_nb_jours int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0; v_cloture_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid; v_pay_keys text[]; v_k text; v_sum_pay numeric; v_d record; v_raw jsonb := null;
  v_hc numeric := 0;
  v_fin date; v_ouv jsonb; -- LX_JOURNEES_2026_10_28
  v_tv jsonb; v_htz numeric; -- LX_TVA_UNIQUE_2026_10_28
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
  -- LX_JOURNEES_2026_10_28 (-5) : jamais de clôture mensuelle d'un mois non terminé ni d'un mois dont une journée est retenue
  -- (sans Z, avec tickets ou ventes encaissées non transmises) : refus TRACÉ + alerte, nouvel essai chaque jour (cron quotidien)
  v_fin := (make_date(p_annee, p_mois, 1) + interval '1 month - 1 day')::date;
  IF v_fin >= lx_prive.jour_paris() THEN
    RETURN jsonb_build_object('ok', false, 'refus', 'LX_MOIS_EN_COURS', 'annee', p_annee, 'mois', p_mois);
  END IF;
  v_ouv := lx_prive.journees_non_closes(p_salon_id, make_date(p_annee, p_mois, 1), v_fin);
  IF jsonb_array_length(v_ouv) > 0 THEN
    PERFORM lx_prive.periode_alerter(p_salon_id, 'CLOTURE_MOIS_REPORTEE', 'Clôture mensuelle ' || p_annee || '-' || LPAD(p_mois::text, 2, '0') || ' NON faite : ' ||
      jsonb_array_length(v_ouv) || ' journée(s) non clôturée(s) (' || (SELECT string_agg(to_char((e->>'date')::date, 'DD/MM'), ', ') FROM jsonb_array_elements(v_ouv) e) ||
      ') ; nouvel essai automatique chaque jour', jsonb_build_object('annee', p_annee, 'mois', p_mois, 'journees', v_ouv));
    RETURN jsonb_build_object('ok', false, 'refus', 'LX_MOIS_JOURNEES_OUVERTES', 'annee', p_annee, 'mois', p_mois, 'journees', v_ouv);
  END IF;
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
  -- LX_TVA_UNIQUE_2026_10_28 (Luxyra 6.8.5, règle TVA unique) : HT / TVA du mois = SOMME des HT / TVA ENREGISTRÉS sur les
  -- tickets du mois (par taux), si le journal concorde avec le CA des Z ; HT des Z (scellées, jamais recalculées) et écart d'arrondi
  -- conservés dans raw_data.tva. CA, nombre de tickets, règlements et empreinte : inchangés (somme des Z).
  v_tv := lx_prive.tva_periode(p_salon_id, make_date(p_annee, p_mois, 1), v_fin);
  v_htz := round(v_ht, 2);
  IF abs(coalesce((v_tv->>'ttc')::numeric, 0) - v_ca) < 0.005 THEN
    v_ht := (v_tv->>'ht')::numeric;
    v_raw := coalesce(v_raw, '{}'::jsonb) || jsonb_build_object('tva', v_tv || jsonb_build_object('ht_z', v_htz, 'ecart_ht_z', round(v_htz - v_ht, 2)));
  ELSE
    v_raw := coalesce(v_raw, '{}'::jsonb) || jsonb_build_object('tva', jsonb_build_object('regle', 'z', 'motif', 'total du journal des tickets différent du CA des clôtures Z : HT = somme des Z', 'ttc_journal', v_tv->'ttc', 'ca_z', v_ca, 'ht_tickets', v_tv->'ht'));
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
    'hors_ca_bum', coalesce(v_hc, 0), 'tva', v_raw->'tva');
END;
$function$;

-- ===================================================================================================================== §6
-- cloturer_annee : définition de PRODUCTION (md5 76636cd2…) + bloc LX_TVA_UNIQUE_2026_10_28 (raw_data.tva : HT des mois, écart).
CREATE OR REPLACE FUNCTION public.cloturer_annee(p_salon_id uuid, p_annee integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text;
  v_nb_mois int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0;
  v_mens_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid;
  v_pay_keys text[]; v_k text; v_sum_pay numeric;
  v_ouv jsonb; v_manq jsonb; -- LX_JOURNEES_2026_10_28
  v_tv jsonb; v_htm numeric; v_raw jsonb; -- LX_TVA_UNIQUE_2026_10_28
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM salons WHERE id = p_salon_id AND user_id = v_user_id) AND NOT is_admin() THEN
      RAISE EXCEPTION 'Vous ne gérez pas ce salon';
    END IF;
  END IF;
  SELECT id INTO v_existing FROM clotures_annuelles WHERE salon_id = p_salon_id AND annee = p_annee;
  IF v_existing IS NOT NULL THEN RETURN jsonb_build_object('ok', true, 'already_exists', true, 'id', v_existing); END IF;
  SELECT siret INTO v_siret FROM salons WHERE id = p_salon_id;
  -- LX_JOURNEES_2026_10_28 (-5) : jamais de clôture annuelle d'une année en cours, ni si un mois de l'année (avec Z ou
  -- tickets) n'a pas sa clôture mensuelle, ni si une journée de l'année est retenue : refus TRACÉ + alerte, nouvel essai chaque jour
  IF make_date(p_annee, 12, 31) >= lx_prive.jour_paris() THEN
    RETURN jsonb_build_object('ok', false, 'refus', 'LX_ANNEE_EN_COURS', 'annee', p_annee);
  END IF;
  SELECT coalesce(jsonb_agg(x.m ORDER BY x.m), '[]'::jsonb) INTO v_manq FROM (
    SELECT DISTINCT EXTRACT(MONTH FROM c.date_cloture)::int m FROM clotures c WHERE c.salon_id = p_salon_id AND EXTRACT(YEAR FROM c.date_cloture)::int = p_annee
    UNION SELECT DISTINCT EXTRACT(MONTH FROM t.date_ticket)::int FROM tickets t WHERE t.salon_id = p_salon_id AND t.status <> 'cancelled' AND EXTRACT(YEAR FROM t.date_ticket)::int = p_annee) x
   WHERE NOT EXISTS (SELECT 1 FROM clotures_mensuelles cm WHERE cm.salon_id = p_salon_id AND cm.annee = p_annee AND cm.mois = x.m);
  v_ouv := lx_prive.journees_non_closes(p_salon_id, make_date(p_annee, 1, 1), make_date(p_annee, 12, 31));
  IF jsonb_array_length(v_manq) > 0 OR jsonb_array_length(v_ouv) > 0 THEN
    PERFORM lx_prive.periode_alerter(p_salon_id, 'CLOTURE_ANNEE_REPORTEE', 'Clôture annuelle ' || p_annee || ' NON faite : ' || jsonb_array_length(v_manq) ||
      ' mois sans clôture mensuelle, ' || jsonb_array_length(v_ouv) || ' journée(s) non clôturée(s) ; nouvel essai automatique chaque jour',
      jsonb_build_object('annee', p_annee, 'mois_manquants', v_manq, 'journees', v_ouv));
    RETURN jsonb_build_object('ok', false, 'refus', 'LX_ANNEE_PERIODES_OUVERTES', 'annee', p_annee, 'mois_manquants', v_manq, 'journees', v_ouv);
  END IF;
  SELECT COUNT(*), COALESCE(SUM(nb_tickets),0), COALESCE(SUM(nb_annulations),0),
         COALESCE(SUM(total_ca),0), COALESCE(SUM(total_ht),0), array_agg(id ORDER BY mois)
    INTO v_nb_mois, v_nb_tickets, v_nb_annul, v_ca, v_ht, v_mens_ids
  FROM clotures_mensuelles WHERE salon_id = p_salon_id AND annee = p_annee;
  -- LX_TVA_UNIQUE_2026_10_28 (Luxyra 6.8.5) : HT / TVA de l'année = somme des tickets de l'année (si le journal concorde avec le CA
  -- des clôtures mensuelles) ; HT des clôtures mensuelles scellées et écart d'arrondi conservés dans raw_data.tva
  v_tv := lx_prive.tva_periode(p_salon_id, make_date(p_annee, 1, 1), make_date(p_annee, 12, 31));
  v_htm := round(v_ht, 2);
  IF abs(coalesce((v_tv->>'ttc')::numeric, 0) - v_ca) < 0.005 THEN
    v_ht := (v_tv->>'ht')::numeric;
    v_raw := jsonb_build_object('tva', v_tv || jsonb_build_object('ht_mois', v_htm, 'ecart_ht_mois', round(v_htm - v_ht, 2)));
  ELSE
    v_raw := jsonb_build_object('tva', jsonb_build_object('regle', 'mois', 'motif', 'total du journal des tickets différent du CA des clôtures mensuelles : HT = somme des mois', 'ttc_journal', v_tv->'ttc', 'ca_mois', v_ca, 'ht_tickets', v_tv->'ht'));
  END IF;
  v_tva := v_ca - v_ht;
  IF v_nb_mois = 0 OR v_nb_mois IS NULL THEN
    RAISE EXCEPTION 'Aucune clôture mensuelle pour %, l''année ne peut être clôturée', p_annee;
  END IF;
  v_pay_keys := ARRAY(SELECT DISTINCT jsonb_object_keys(cm.detail_paiements) FROM clotures_mensuelles cm
    WHERE cm.salon_id = p_salon_id AND cm.annee = p_annee AND cm.detail_paiements IS NOT NULL);
  IF v_pay_keys IS NOT NULL THEN
    FOREACH v_k IN ARRAY v_pay_keys LOOP
      SELECT COALESCE(SUM((cm.detail_paiements->>v_k)::numeric), 0) INTO v_sum_pay
      FROM clotures_mensuelles cm WHERE cm.salon_id = p_salon_id AND cm.annee = p_annee AND cm.detail_paiements ? v_k;
      v_detail_paiements := v_detail_paiements || jsonb_build_object(v_k, v_sum_pay);
    END LOOP;
  END IF;
  SELECT hash INTO v_hash_prev FROM clotures_annuelles WHERE salon_id = p_salon_id ORDER BY annee DESC LIMIT 1;
  v_hash := encode(extensions.digest(
    'ZA|' || p_annee || '|' || to_char(v_ca, 'FM9999999.99') || '|' || v_nb_tickets || '|' ||
    COALESCE(v_hash_prev, '') || '|' || COALESCE(v_siret, ''), 'sha256'), 'hex');
  INSERT INTO clotures_annuelles (salon_id, annee, nb_mois_clotures, nb_tickets, nb_annulations,
    total_ca, total_ht, total_tva, detail_paiements, cloture_mens_ids, hash, hash_algo, hash_prev, operator_name, raw_data)
  VALUES (p_salon_id, p_annee, v_nb_mois, v_nb_tickets, v_nb_annul,
    v_ca, v_ht, v_tva, v_detail_paiements, v_mens_ids, v_hash, 'SHA-256', v_hash_prev, 'auto_cron', v_raw)
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_ANNEE', p_annee || ' : ' || v_nb_mois || ' mois, ' || v_nb_tickets || ' tickets, ' ||
    to_char(v_ca, 'FM9999999.99') || ' EUR', 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'annee', p_annee,
    'nb_mois', v_nb_mois, 'nb_tickets', v_nb_tickets, 'total_ca', v_ca, 'hash', v_hash);
END;
$function$;

-- ===================================================================================================================== §7
-- cloturer_exercice : définition de PRODUCTION (md5 9c305044…) + bloc LX_TVA_UNIQUE_2026_10_28 (HT = somme des tickets).
CREATE OR REPLACE FUNCTION public.cloturer_exercice(p_salon_id uuid, p_date_fin date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_uid uuid := auth.uid(); v_mois int; v_siret text; v_existing uuid;
  v_prev_fin date; v_debut date; v_nb int; v_tk int; v_an int; v_ca numeric; v_ht numeric; v_ids uuid[];
  v_det jsonb := '{}'::jsonb; v_keys text[]; v_k text; v_s numeric;
  v_cp_ca numeric; v_cp_tk int; v_cp_at timestamptz; v_prev text; v_hash text; v_id uuid; v_d record; v_pca numeric; v_ptk int;
  v_ouv jsonb; -- LX_JOURNEES_2026_10_28
  v_tv jsonb; -- LX_TVA_UNIQUE_2026_10_28
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
  -- LX_JOURNEES_2026_10_28 (-5) : jamais de clôture d'exercice si une journée de l'exercice est retenue : refus TRACÉ + alerte,
  -- nouvel essai chaque jour (tâche cloture_exercice_auto quotidienne)
  v_ouv := lx_prive.journees_non_closes(p_salon_id, v_debut, p_date_fin);
  IF jsonb_array_length(v_ouv) > 0 THEN
    PERFORM lx_prive.periode_alerter(p_salon_id, 'CLOTURE_EXERCICE_REPORTEE', 'Clôture de l''exercice du ' || to_char(v_debut,'DD/MM/YYYY') || ' au ' || to_char(p_date_fin,'DD/MM/YYYY') ||
      ' NON faite : ' || jsonb_array_length(v_ouv) || ' journée(s) non clôturée(s) ; nouvel essai automatique chaque jour', jsonb_build_object('debut', v_debut, 'fin', p_date_fin, 'journees', v_ouv));
    RETURN jsonb_build_object('ok', false, 'refus', 'LX_EXERCICE_JOURNEES_OUVERTES', 'debut', v_debut, 'fin', p_date_fin, 'journees', v_ouv);
  END IF;
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
  -- LX_TVA_UNIQUE_2026_10_28 (Luxyra 6.8.5) : HT de l'exercice = somme des tickets de l'exercice si le journal concorde avec le CA
  -- des Z (annotations comprises) ; sinon somme des Z (comme avant). La table n'a pas de raw_data : l'écart éventuel avec la somme
  -- des Z se lit par public.lx_tva_periode_controle (aucune donnée scellée modifiée).
  v_tv := lx_prive.tva_periode(p_salon_id, v_debut, p_date_fin);
  IF abs(coalesce((v_tv->>'ttc')::numeric, 0) - v_ca) < 0.005 THEN v_ht := round((v_tv->>'ht')::numeric, 2); END IF;
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

-- ===================================================================================================================== §8
-- Contrôles après application (éditeur SQL) :
--   select tgname from pg_trigger where tgrelid = 'public.clotures'::regclass and tgname like 'b_nf525_z_controle%' order by 1;
--      -> b_nf525_z_controle_journal, b_nf525_z_controle_tva
--   select position('LX_TVA_UNIQUE_2026_10_28' in pg_get_functiondef('public.cloturer_mois(uuid,integer,integer)'::regprocedure)) > 0; -> true
--   select public.lx_tva_periode_controle('<salon>', '2026-07-01', '2026-07-31');  -- juillet : ttc 5965,90 ; ht 4971,67 ; z_ht 4971,58 ; ecart_ht -0,09
--   select check_fiscal_integrity(); select nf525_tests_protections();               -- 0 anomalie / ok
--
-- RETOUR ARRIÈRE (commenté — fichier complet : docs/migrations_1028_tva/tva_unique_retour_arriere.sql) :
--   drop trigger if exists a_lx_tickets_raw_data_fige on public.tickets; drop function if exists lx_prive.tickets_raw_data_fige();
--   drop trigger if exists b_nf525_z_controle_tva on public.clotures;
--   drop function if exists lx_prive.clotures_controle_tva();
--   -- puis rejouer les 3 définitions de production (cloturer_mois / cloturer_annee / cloturer_exercice) du fichier de retour ;
--   drop function if exists public.lx_tva_periode_controle(uuid, date, date);
--   drop function if exists lx_prive.tva_periode(uuid, date, date, text);
--   drop function if exists lx_prive.tva_ticket_lignes(jsonb, numeric, numeric, numeric, jsonb, numeric, jsonb);
--   drop function if exists lx_prive.tva_item_montant(jsonb); drop function if exists lx_prive.tva_vrai(jsonb); drop function if exists lx_prive.tva_num(jsonb);
