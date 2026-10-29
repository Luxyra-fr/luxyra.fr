-- =====================================================================================================================
-- 2026-10-29 (-9) — LOT 4b : RÉSERVES DU CONTRE-AUDIT DU LOT 4 — FACTURES CLIENTS (bon à usage unique, remise de ligne, numérotation)
-- Luxyra 6.8.7 (version MINEURE) — NON APPLIQUÉ. À passer par Alexandre dans l'éditeur SQL du tableau de bord Supabase, dans
-- l'ordre du registre NF525 (intervention -9 du 29/10/2026). Idempotent (create or replace) ; garde de tête : arrêt si une
-- fonction lue ou remplacée diffère de la version relue en production le 29/10/2026 au soir.
--
-- AUCUNE donnée existante modifiée : aucune facture en production (0 ligne dans factures_clients au 29/10/2026), aucun ticket,
-- aucune Z, aucun bon touché ; format de l'empreinte des factures (« FC|… ») INCHANGÉ ; numérotation INCHANGÉE (série unique).
--
-- §1  Ticket réglé (en partie) par un bon cadeau à usage UNIQUE (ou un bon antérieur au 28/10/2026, déjà encaissé à sa vente) :
--     la part réglée par le bon n'est PAS une remise. Sources : CGI art. 256 ter, 1 et 3-b ; BOI-TVA-CHAMP-10-10-40-50 (version
--     du 14/02/2024) § 60 : « La remise matérielle des biens ou la prestation effective des services en échange d'un bon à usage
--     unique accepté en contrepartie totale ou partielle […] n'est pas considérée comme une opération distincte de la vente du
--     bon » — la TVA de cette part a été acquittée À LA VENTE DU BON (ticket de vente). Une facture qui mentionnerait de nouveau
--     cette TVA la rendrait due une seconde fois (CGI art. 283-3 ; BOI-TVA-DECLA-30-20-20-10 § 310). Choix retenu (même méthode
--     que la « facture définitive après acompte », AFNOR XP Z12-014 cas d'usage 20, option 1 : reprise en ligne négative) :
--       * la facture montre le prix TOTAL de la prestation (lignes du ticket, prix unitaire brut, remise de ligne, net) ;
--       * la part réglée par le bon est une ligne distincte « Bon cadeau <code> (réglé lors de l'achat du bon, ticket n° …) »,
--         négative, au taux du bon (nature « bon », jamais « Remise ») ;
--       * la base HT et la TVA de la facture (par taux) restent celles du ticket scellé = TVA réellement due sur CETTE opération ;
--       * mention récapitulative : prix total, part réglée par le bon (ticket de vente), montant de la facture.
--     Le « montant déjà payé » du XML (TotalPrepaidAmount, BT-113) n'est PAS utilisé pour le bon : il ne réduit pas la base de TVA
--     (BG-23) — la facture déclarerait la TVA de la prestation entière, déjà acquittée à la vente du bon. BT-113 reste le
--     règlement du ticket (facture acquittée).
--     Ticket ENTIÈREMENT réglé par un bon à usage unique (ticket à 0 €) : pas de facture — l'opération a été taxée (et peut être
--     facturée) à la vente du bon ; refus explicite LX_FACTURE_BON_UNIQUE.
-- §2  Remise sur une ligne (CGI ann. II art. 242 nonies A, I-8° et 9° ; BOI-TVA-DECLA-30-20-20-10 § 210 à 250 : prix unitaire HT
--     « déterminé hors rabais, remises ou ristournes », mentionnés sur chaque ligne) : chaque ligne porte désormais le prix
--     unitaire brut (TTC et HT), le montant brut, la remise de la ligne (TTC et HT) et le net. Le net (ttc / ht) est inchangé.
-- §3  Numérotation : une SEULE séquence chronologique et continue par établissement, commune aux factures (F-) et aux factures
--     d'avoir (A-) — principe de l'art. 242 nonies A, I-7° (« numéro unique basé sur une séquence chronologique et continue »,
--     BOI-TVA-DECLA-30-20-20-10 § 70) ; les séries distinctes ne sont qu'une faculté « lorsque les conditions d'exercice de
--     l'activité le justifient » (§ 80 à 100). Conservée (aucune renumérotation) et EXPLIQUÉE sur chaque facture (mention
--     « numerotation »), dans l'aide et dans le registre CSV des factures (colonne « N° d'ordre »).
--
-- RETOUR ARRIÈRE : docs/migrations_1029_lot4b/factures_lot4b_retour_arriere.sql (définition de PRODUCTION de lx_facture_emettre
-- à l'octet, md5 b555d537… ; lx_prive.facture_lignes_v2 retirée). Les factures émises entre-temps sont CONSERVÉES (inaltérables).
-- =====================================================================================================================

-- ===================================================================================================================== §0
-- Garde : md5(pg_get_functiondef(oid)) relevé en PRODUCTION le 29/10/2026 au soir (connecteur Supabase, lecture seule) OU empreinte
-- de la définition posée par CE fichier (seconde exécution). Toute autre valeur arrête le script.
do $$
declare
  v_attendu jsonb := jsonb_build_object(
    'public.lx_facture_emettre(uuid,jsonb,text)', jsonb_build_array('b555d5376727f0b2d63de0ccb37c882b', '69d6e1e2ab1b17c84d5aea9fbf7228ac'),
    'lx_prive.facture_lignes(jsonb,jsonb,numeric,numeric)', jsonb_build_array('c47c42ec9eedb62206b05c95c7761f7a'),
    'lx_prive.tva_ticket_lignes(jsonb,numeric,numeric,numeric,jsonb,numeric,jsonb)', jsonb_build_array('f1cf5f0969713c74ccabacc3124466cf'),
    'lx_prive.tva_item_montant(jsonb)', jsonb_build_array('c400078a37818c12fb340768b16e4e05'),
    'lx_prive.tva_num(jsonb)', jsonb_build_array('558516e619c70f8efcf53428ba00721a'),
    'lx_prive.tva_vrai(jsonb)', jsonb_build_array('eba54c8148d07d03172625f21df04412'),
    'lx_prive.forme_societe(text)', jsonb_build_array('1026bfe2302c4e4bb18097130585810a'),
    'lx_prive.forme_libelle(text)', jsonb_build_array('1ba9a85e9e36fff49357cd6db9c3c1da'),
    'lx_prive.appel_serveur()', jsonb_build_array('40b6d090d00ed5e25dad8e12f138382c'));
  k text; v_m text;
begin
  for k in select jsonb_object_keys(v_attendu) loop
    select md5(pg_get_functiondef(k::regprocedure)) into v_m;
    if not (v_attendu->k) ? v_m then
      raise exception 'GARDE LOT 4b : % a changé en production (md5 %) — ne pas appliquer, écrire au support', k, v_m;
    end if;
  end loop;
end $$;

-- ===================================================================================================================== §1 §2
-- Lignes d'une facture (version 2, 29/10/2026). Même règle de taux que lx_prive.tva_ticket_lignes et que la version 1
-- (lx_prive.facture_lignes, conservée, plus appelée) ; en plus :
--   * chaque ligne d'article : pu_ttc (prix unitaire saisi), pu_ht, brut_ttc / brut_ht (prix × quantité), remise_ttc / remise_ht
--     (remise de LA ligne), ttc / ht (net = brut − remise, inchangé), nature « article » ;
--   * p_bons = bons à usage unique (ou antérieurs, déjà encaissés à leur vente) ayant réglé une partie du ticket :
--     [{code, montant, lignes:{"<taux>|P|Q": montant}, ticket, date}] -> ligne négative nature « bon » au taux couvert
--     (imputation enregistrée par l'application au règlement, ticket.raw_data.bonsUtil[].lignes) ; un bon sans imputation par taux
--     (bon antérieur au modèle v2) est imputé sur le taux qui a l'écart le plus grand ;
--   * écart restant avec la ventilation scellée par taux = remise globale du ticket -> ligne « Remise » (nature « remise »),
--     ou « Ajustement » si l'écart est positif ; écart d'arrondi du HT (≤ 0,025) porté sur l'article le plus important.
-- Somme des lignes = ventilation enregistrée = ticket, au centime (TTC et HT, par taux).
create or replace function lx_prive.facture_lignes_v2(p_items jsonb, p_par jsonb, p_s numeric, p_p numeric, p_bons jsonb default '[]'::jsonb)
returns jsonb language plpgsql immutable set search_path = public, pg_temp as $$
declare
  v_items jsonb := case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end;
  v_bons jsonb := case when jsonb_typeof(p_bons) = 'array' then p_bons else '[]'::jsonb end;
  v_par jsonb := case when jsonb_typeof(p_par) = 'array' then p_par else '[]'::jsonb end;
  v_s numeric := coalesce(p_s, 0); v_p numeric;
  v_taux numeric[]; v_n int; i int; j int; v_t numeric; v_pt numeric; v_ph numeric;
  v_lg jsonb[]; v_dt numeric[]; v_dh numeric[]; v_sg numeric[]; v_bl jsonb[];   -- par taux : lignes, écarts TTC / HT, signe, lignes de bons
  v_l jsonb; v_sttc numeric; v_sht numeric; b jsonb; k text; v_kt numeric; v_m numeric; v_bh numeric; v_lib text;
  v_dispo numeric; v_best int; v_out jsonb := '[]'::jsonb; v_imax int; v_max numeric; v_rt numeric; v_rh numeric; v_nbt int;
begin
  v_p := case when v_s > 0 then coalesce(p_p, v_s) else 0 end;
  -- taux = ceux de la ventilation enregistrée + ceux des lignes (une ligne entièrement réglée par un bon peut être absente de la
  -- ventilation : TTC 0 à ce taux) ; un taux de ligne hors ventilation n'est accepté que s'il est entièrement couvert par des bons
  select coalesce(array_agg(distinct t order by t desc), '{}') into v_taux from (
    select lx_prive.tva_num(x->'taux') t from jsonb_array_elements(v_par) x
    union
    select case when v_s > 0 and lx_prive.tva_num(e->'tvaTaux') is not null then lx_prive.tva_num(e->'tvaTaux')
                when lx_prive.tva_vrai(e->'isProd') then v_p else v_s end
      from jsonb_array_elements(v_items) e
     where jsonb_typeof(e) = 'object' and not lx_prive.tva_vrai(e->'isSep') and not lx_prive.tva_vrai(e->'isAcompteData')
       and round(lx_prive.tva_item_montant(e), 2) <> 0) z where t is not null;
  v_n := coalesce(array_length(v_taux, 1), 0);
  v_nbt := (select count(*) from jsonb_array_elements(v_par) x);
  for i in 1 .. v_n loop
    v_t := v_taux[i];
    select lx_prive.tva_num(x->'ttc'), lx_prive.tva_num(x->'ht') into v_pt, v_ph from jsonb_array_elements(v_par) x where lx_prive.tva_num(x->'taux') = v_t limit 1;
    select coalesce(jsonb_agg(jsonb_build_object(
             'nom', coalesce(nullif(btrim(e->>'name'), ''), 'Article'), 'qte', q, 'ttc', net, 'ht', nh, 'taux', v_t, 'remise', false, 'nature', 'article',
             'pu_ttc', round(coalesce(lx_prive.tva_num(e->'price'), 0), 4), 'brut_ttc', brut, 'brut_ht', bh,
             'remise_ttc', round(brut - net, 2), 'remise_ht', round(bh - nh, 2)) order by o), '[]'::jsonb)
      into v_l
      from (select e, o, q, brut, net,
                   case when v_t > 0 then round(net / (1 + v_t / 100), 2) else net end nh,
                   case when brut = net then case when v_t > 0 then round(net / (1 + v_t / 100), 2) else net end
                        when v_t > 0 then round(brut / (1 + v_t / 100), 2) else brut end bh
              from (select e, o, coalesce(nullif(lx_prive.tva_num(e->'qty'), 0), 1) q,
                           round(coalesce(lx_prive.tva_num(e->'price'), 0) * coalesce(nullif(lx_prive.tva_num(e->'qty'), 0), 1), 2) brut,
                           round(lx_prive.tva_item_montant(e), 2) net
                      from jsonb_array_elements(v_items) with ordinality as z(e, o)
                     where jsonb_typeof(e) = 'object' and not lx_prive.tva_vrai(e->'isSep') and not lx_prive.tva_vrai(e->'isAcompteData')
                       and case when v_s > 0 and lx_prive.tva_num(e->'tvaTaux') is not null then lx_prive.tva_num(e->'tvaTaux')
                                when lx_prive.tva_vrai(e->'isProd') then v_p else v_s end = v_t) a) c;
    select coalesce(sum((x->>'ttc')::numeric), 0), coalesce(sum((x->>'ht')::numeric), 0) into v_sttc, v_sht from jsonb_array_elements(v_l) x;
    v_lg[i] := v_l; v_bl[i] := '[]'::jsonb;
    v_dt[i] := round(coalesce(v_pt, 0) - v_sttc, 2); v_dh[i] := round(coalesce(v_ph, 0) - v_sht, 2);
    v_sg[i] := case when coalesce(v_pt, 0) < 0 or (coalesce(v_pt, 0) = 0 and v_sttc < 0) then -1 else 1 end;
  end loop;
  -- bons à usage unique : imputation par taux enregistrée au règlement (sinon : taux ayant l'écart disponible le plus grand)
  for b in select x from jsonb_array_elements(v_bons) x where jsonb_typeof(x) = 'object' loop
    v_lib := 'Bon cadeau ' || coalesce(nullif(btrim(b->>'code'), ''), '') || ' (réglé lors de l''achat du bon'
             || coalesce(', ticket n° ' || nullif(btrim(b->>'ticket'), ''), '') || coalesce(' du ' || to_char(nullif(b->>'date', '')::date, 'DD/MM/YYYY'), '') || ')';
    if jsonb_typeof(b->'lignes') = 'object' and exists (select 1 from jsonb_each(b->'lignes')) then
      for k, v_m in select key, round(abs(coalesce(lx_prive.tva_num(value), 0)), 2) from jsonb_each(b->'lignes') loop
        if split_part(k, '|', 1) !~ '^-?[0-9]+(\.[0-9]+)?$' or v_m < 0.005 then continue; end if;
        v_kt := case when v_s > 0 then split_part(k, '|', 1)::numeric else 0 end;
        j := array_position(v_taux, v_kt);
        if j is null then
          raise exception 'LX_FACTURE_VENTILATION : bon cadeau % imputé au taux % %% absent du ticket — écrivez au support (support@luxyra.fr)', b->>'code', v_kt using errcode = 'P0001';
        end if;
        v_dispo := greatest(round(-v_sg[j] * v_dt[j], 2), 0); v_m := least(v_m, v_dispo);
        if v_m < 0.005 then continue; end if;
        v_bh := case when v_kt > 0 then round(v_m / (1 + v_kt / 100), 2) else v_m end;
        v_bl[j] := v_bl[j] || jsonb_build_array(jsonb_build_object('nom', v_lib || case when v_n > 1 then ' — TVA ' || replace(trim_scale(v_kt)::text, '.', ',') || ' %' else '' end,
                     'qte', 1, 'ttc', -v_sg[j] * v_m, 'ht', -v_sg[j] * v_bh, 'taux', v_kt, 'remise', false, 'nature', 'bon',
                     'bon_code', b->>'code', 'bon_ticket', nullif(btrim(b->>'ticket'), ''), 'bon_date', nullif(b->>'date', '')));
        v_dt[j] := round(v_dt[j] + v_sg[j] * v_m, 2); v_dh[j] := round(v_dh[j] + v_sg[j] * v_bh, 2);
      end loop;
    else
      v_m := round(abs(coalesce(lx_prive.tva_num(b->'montant'), 0)), 2);
      while v_m >= 0.005 loop
        v_best := null; v_max := 0;
        for i in 1 .. v_n loop if round(-v_sg[i] * v_dt[i], 2) > v_max then v_max := round(-v_sg[i] * v_dt[i], 2); v_best := i; end if; end loop;
        exit when v_best is null;
        v_bh := least(v_m, v_max); v_kt := v_taux[v_best];
        v_rh := case when v_kt > 0 then round(v_bh / (1 + v_kt / 100), 2) else v_bh end;
        v_bl[v_best] := v_bl[v_best] || jsonb_build_array(jsonb_build_object('nom', v_lib || case when v_n > 1 then ' — TVA ' || replace(trim_scale(v_kt)::text, '.', ',') || ' %' else '' end,
                     'qte', 1, 'ttc', -v_sg[v_best] * v_bh, 'ht', -v_sg[v_best] * v_rh, 'taux', v_kt, 'remise', false, 'nature', 'bon',
                     'bon_code', b->>'code', 'bon_ticket', nullif(btrim(b->>'ticket'), ''), 'bon_date', nullif(b->>'date', '')));
        v_dt[v_best] := round(v_dt[v_best] + v_sg[v_best] * v_bh, 2); v_dh[v_best] := round(v_dh[v_best] + v_sg[v_best] * v_rh, 2);
        v_m := round(v_m - v_bh, 2);
      end loop;
    end if;
  end loop;
  -- par taux : lignes d'articles, lignes de bons, puis remise globale (écart restant) ou ajustement d'arrondi du HT
  for i in 1 .. v_n loop
    v_t := v_taux[i]; v_l := v_lg[i];
    if not exists (select 1 from jsonb_array_elements(v_par) x where lx_prive.tva_num(x->'taux') = v_t) and (abs(v_dt[i]) >= 0.005 or abs(v_dh[i]) >= 0.005) then
      raise exception 'LX_FACTURE_VENTILATION : le taux d''une ligne du ticket ne figure pas dans la ventilation enregistrée — facture impossible, écrivez au support (support@luxyra.fr)' using errcode = 'P0001';
    end if;
    v_l := v_l || v_bl[i];
    v_rt := v_dt[i]; v_rh := v_dh[i];
    select lx_prive.tva_num(x->'ttc') into v_pt from jsonb_array_elements(v_par) x where lx_prive.tva_num(x->'taux') = v_t limit 1;
    if abs(v_rt) >= 0.005 then
      v_l := v_l || jsonb_build_array(jsonb_build_object(
        'nom', case when sign(v_rt) <> sign(coalesce(v_pt, 0)) or coalesce(v_pt, 0) = 0 then 'Remise' else 'Ajustement' end
               || case when v_nbt > 1 or v_n > 1 then ' (TVA ' || replace(trim_scale(v_t)::text, '.', ',') || ' %)' else '' end,
        'qte', 1, 'ttc', v_rt, 'ht', v_rh, 'taux', v_t, 'remise', true,
        'nature', case when sign(v_rt) <> sign(coalesce(v_pt, 0)) or coalesce(v_pt, 0) = 0 then 'remise' else 'ajustement' end));
    elsif abs(v_rh) >= 0.005 then
      if abs(v_rh) > 0.025 or jsonb_array_length(v_lg[i]) = 0 then
        raise exception 'LX_FACTURE_VENTILATION : HT des lignes (taux % %%) différent de la ventilation enregistrée de % — écrivez au support', v_t, v_rh using errcode = 'P0001';
      end if;
      -- arrondi du HT : sur la ligne de bon la plus importante (HT dérivé du bon), sinon sur l'article le plus important
      v_max := null; v_imax := 0;
      for j in 0 .. jsonb_array_length(v_l) - 1 loop
        if v_l->j->>'nature' = 'bon' and (v_max is null or abs((v_l->j->>'ttc')::numeric) > v_max) then v_max := abs((v_l->j->>'ttc')::numeric); v_imax := j; end if;
      end loop;
      if v_max is not null then
        v_l := jsonb_set(v_l, array[v_imax::text, 'ht'], to_jsonb(round((v_l->v_imax->>'ht')::numeric + v_rh, 2)));
      else
        for j in 0 .. jsonb_array_length(v_l) - 1 loop
          if v_l->j->>'nature' = 'article' and (v_max is null or abs((v_l->j->>'ttc')::numeric) > v_max) then v_max := abs((v_l->j->>'ttc')::numeric); v_imax := j; end if;
        end loop;
        v_l := jsonb_set(jsonb_set(v_l, array[v_imax::text, 'ht'], to_jsonb(round((v_l->v_imax->>'ht')::numeric + v_rh, 2))),
                         array[v_imax::text, 'brut_ht'], to_jsonb(round((v_l->v_imax->>'brut_ht')::numeric + v_rh, 2)));
      end if;
    end if;
    v_out := v_out || v_l;
  end loop;
  -- prix unitaire HT (hors remise) des articles = montant brut HT / quantité (4 décimales)
  select coalesce(jsonb_agg(case when x->>'nature' = 'article'
                                 then x || jsonb_build_object('pu_ht', round((x->>'brut_ht')::numeric / nullif((x->>'qte')::numeric, 0), 4))
                                 else x end order by o), '[]'::jsonb)
    into v_out from jsonb_array_elements(v_out) with ordinality as z(x, o);
  return v_out;
end $$;
revoke all on function lx_prive.facture_lignes_v2(jsonb, jsonb, numeric, numeric, jsonb) from public, anon, authenticated;

create or replace function public.lx_facture_emettre(p_ticket uuid, p_client jsonb, p_operateur text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare
  t public.tickets%rowtype; s public.salons%rowtype; v_num int; v_prev text; v_hash text; v_id uuid; v_type text; v_orig public.factures_clients%rowtype;
  v_l jsonb; v_par jsonb; v_items jsonb; v_lignes jsonb; v_nom text; v_prenom text; v_adr text; v_cp text; v_ville text; v_email text; v_tel text;
  v_siren text; v_siret text; v_tvacli text; v_pro boolean; v_franchise boolean; v_mentions jsonb; v_numero text;
  v_jour date := (now() at time zone 'Europe/Paris')::date; v_ref text; v_tva_v text; v_siren_v text; v_soc boolean; v_rcs text; v_forme text; v_vendeur text;
  v_bons jsonb; v_bons_tot numeric; v_bvr numeric; v_bons_txt text; v_bon_vente boolean;
begin
  select * into t from public.tickets where id = p_ticket;
  if t.id is null then raise exception 'LX_FACTURE : ticket introuvable' using errcode = 'P0001'; end if;
  if not (lx_prive.appel_serveur() or public.is_admin() or exists (select 1 from public.salons x where x.id = t.salon_id and x.user_id = auth.uid())) then
    raise exception 'LX_REFUS : établissement non autorisé' using errcode = '42501';
  end if;
  select * into s from public.salons where id = t.salon_id;
  -- caisse de TEST : aucune facture (voir l'en-tête du §5 et le déclencheur a_lx_factures_clients_pas_de_test)
  if coalesce(t.mode_caisse, s.mode_caisse, 'reel') = 'test' or coalesce(s.mode_caisse, 'reel') = 'test' then
    raise exception 'LX_FACTURE_TEST : aucune facture en caisse de TEST (ventes sans valeur, effacées au passage en caisse réelle). Les factures se font une fois la caisse réelle activée.' using errcode = 'P0001';
  end if;
  -- 2026-10-29 (lot 4b) : bons à usage UNIQUE (ou antérieurs au 28/10/2026) ayant réglé une partie du ticket — part DÉJÀ TAXÉE à la vente
  -- du bon (CGI art. 256 ter, 1 ; BOI-TVA-CHAMP-10-10-40-50 § 60) : ligne « Bon cadeau … » distincte, jamais une remise (en-tête §1)
  select coalesce(jsonb_agg(jsonb_build_object('code', coalesce(nullif(u->>'code', ''), c.code, ''), 'montant', round(abs(lx_prive.tva_num(u->'montant')), 2),
                                               'lignes', case when jsonb_typeof(u->'lignes') = 'object' then u->'lignes' end,
                                               'ticket', c.tk_num::text, 'date', c.date_creation::text) order by o), '[]'::jsonb)
    into v_bons
    from jsonb_array_elements(case when jsonb_typeof(t.raw_data->'bonsUtil') = 'array' then t.raw_data->'bonsUtil' else '[]'::jsonb end) with ordinality as z(u, o)
    left join public.cartes_cadeaux c on c.salon_id = t.salon_id and c.id::text = u->>'id'
   where jsonb_typeof(u) = 'object' and coalesce(u->>'usage', '') <> 'BUM' and coalesce(lx_prive.tva_num(u->'montant'), 0) <> 0;
  v_bvr := round(coalesce(lx_prive.tva_num(t.raw_data->'bonVenduRemise'), 0), 2);
  if jsonb_array_length(v_bons) = 0 and v_bvr > 0 then  -- ticket antérieur au modèle v2 : montant global « bon vendu », sans imputation par taux
    v_bons := jsonb_build_array(jsonb_build_object('montant', v_bvr, 'code',
                (select string_agg(btrim(substr(p->>'method', 18)), ', ') from jsonb_array_elements(case when jsonb_typeof(t.raw_data->'payments') = 'array' then t.raw_data->'payments' else '[]'::jsonb end) p
                  where p->>'method' like 'Bon cadeau r_gl_ %')));
  end if;
  select coalesce(sum((x->>'montant')::numeric), 0) into v_bons_tot from jsonb_array_elements(v_bons) x;
  if coalesce(t.total_ttc, 0) = 0 and v_bons_tot > 0 then
    raise exception 'LX_FACTURE_BON_UNIQUE : ticket entièrement réglé par un bon cadeau à usage unique — la prestation a été taxée à la vente du bon (CGI art. 256 ter ; BOI-TVA-CHAMP-10-10-40-50 § 60) : la facture, si le client en veut une, est celle du ticket de vente du bon.' using errcode = 'P0001';
  end if;
  if coalesce(t.total_ttc, 0) = 0 then raise exception 'LX_FACTURE : ticket à 0 €, aucune facture' using errcode = 'P0001'; end if;
  if exists (select 1 from public.factures_clients f where f.salon_id = t.salon_id and f.ticket_id = t.id) then
    raise exception 'LX_FACTURE_DEJA : une facture existe déjà pour ce ticket (réimprimez-la)' using errcode = 'P0001';
  end if;
  -- vendeur (ann. II art. 242 nonies A, I-1° et 2° ; C. com. art. R123-237 et R123-238)
  v_siren_v := left(regexp_replace(coalesce(s.siret, ''), '\D', '', 'g'), 9);
  if length(v_siren_v) <> 9 then
    raise exception 'LX_FACTURE_VENDEUR : SIRET de l''établissement non renseigné (Paramètres › Infos établissement)' using errcode = 'P0001';
  end if;
  if nullif(btrim(coalesce(s.adresse, '')), '') is null or nullif(btrim(coalesce(s.cp, '')), '') is null or nullif(btrim(coalesce(s.ville, '')), '') is null then
    raise exception 'LX_FACTURE_VENDEUR : adresse de l''établissement incomplète (Paramètres › Infos établissement : Adresse, CP, Ville)' using errcode = 'P0001';
  end if;
  v_franchise := coalesce(t.taux_tva, 0) = 0 and coalesce(s.taux_tva, 0) = 0;
  v_tva_v := nullif(upper(regexp_replace(coalesce(nullif(s.tva_intra, ''), s.tva, ''), '\s', '', 'g')), '');
  if not v_franchise and v_tva_v is null then
    raise exception 'LX_FACTURE_VENDEUR_TVA : n° de TVA intracommunautaire de l''établissement non renseigné — obligatoire sur une facture avec TVA (CGI, ann. II, art. 242 nonies A, I-2°). À saisir dans Paramètres › Infos établissement › « N° TVA intracommunautaire ».' using errcode = 'P0001';
  end if;
  v_soc := lx_prive.forme_societe(s.forme_juridique);
  if v_soc and (nullif(btrim(coalesce(s.rcs_ville, '')), '') is null or s.capital_social is null) then
    raise exception 'LX_FACTURE_VENDEUR_RCS : société (%) — ville du greffe (mention « RCS ») et capital social obligatoires sur une facture (C. com. art. R123-237 et R123-238). À saisir dans Paramètres › Infos établissement › « Mentions légales de la société ».', s.forme_juridique using errcode = 'P0001';
  end if;
  v_rcs := case when nullif(btrim(coalesce(s.rcs_ville, '')), '') is not null then 'RCS ' || btrim(s.rcs_ville) || ' ' || v_siren_v end;
  v_forme := lx_prive.forme_libelle(s.forme_juridique);
  v_vendeur := nullif(concat_ws(' — ',
                 case when v_forme is not null then v_forme || case when s.capital_social is not null then ' au capital de ' || replace(to_char(s.capital_social, 'FM999999999990.00'), '.', ',') || ' €' else '' end end,
                 v_rcs, 'SIREN ' || v_siren_v), '');
  -- ventilation par taux = valeurs ENREGISTRÉES du ticket (même règle que la Z et le FEC : lx_prive.tva_ticket_lignes)
  v_l := lx_prive.tva_ticket_lignes(t.items, t.total_ttc, t.total_ht, t.taux_tva, t.raw_data->'lxTva',
           case when coalesce(s.taux_tva, 20) > 0 then coalesce(s.taux_tva_produits, s.taux_tva, 20) else 0 end, t.raw_data->'bonsUtil');
  -- vente (ou annulation de vente) d'un bon à usage multiple : opération HORS CHAMP de la TVA (CGI art. 256 ter ; directive
  -- 2016/1065 : la TVA est due à l'utilisation du bon) -> ni livraison ni prestation à facturer (CGI art. 289, I) ; un document
  -- mêlant une catégorie hors champ (« O ») et une catégorie taxée est en outre invalide en EN 16931 (règles BR-O-11 à BR-O-14).
  -- La facture se fait sur le ticket d'UTILISATION du bon (prestation / produit, TVA à cette date).
  if coalesce(lx_prive.tva_num(v_l->'hc'), 0) <> 0 then
    raise exception 'LX_FACTURE_BON_MULTIPLE : ce ticket contient la vente d''un bon cadeau à usage multiple, hors champ de la TVA (CGI art. 256 ter) — pas de facture pour cette vente. La facture s''établit sur le ticket où le bon est utilisé. Pour un bon vendu avec une prestation, encaissez-les sur deux tickets.' using errcode = 'P0001';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('taux', x->'t', 'ht', x->'ht', 'tva', x->'tva', 'ttc', x->'ttc') order by (x->>'t')::numeric desc), '[]'::jsonb)
    into v_par from jsonb_array_elements(coalesce(v_l->'l', '[]'::jsonb)) x;
  v_items := case when jsonb_typeof(t.items) = 'array' then t.items else '[]'::jsonb end;
  -- facture d'avoir : contre-ticket (montant négatif) d'un ticket déjà facturé -> rectifie cette facture ; sans facture d'origine :
  -- refus (le contre-ticket suffit, un avoir ne rectifie qu'une facture)
  v_type := case when t.total_ttc < 0 then 'avoir' else 'facture' end;
  if v_type = 'avoir' then
    v_ref := coalesce(t.raw_data->>'cancelRef', t.raw_data->>'retourRefTk', '');
    select f.* into v_orig from public.factures_clients f join public.tickets o on o.id = f.ticket_id
     where f.salon_id = t.salon_id and f.type = 'facture'
       and (o.id = t.parent_ticket_id or (v_ref <> '' and (o.raw_data->>'tkNum' = v_ref or o.raw_data->>'id' = v_ref or o.num::text = v_ref)))
     order by f.num limit 1;
    if v_orig.id is null then
      raise exception 'LX_FACTURE_AVOIR_SANS_ORIGINE : aucune facture n''a été émise pour le ticket d''origine — une facture d''avoir ne rectifie qu''une facture. Le contre-ticket d''annulation suffit.' using errcode = 'P0001';
    end if;
    -- ventilation de l'avoir : taux compris dans ceux de la facture rectifiée (sinon : taux des produits changé entre la vente et
    -- une annulation par la fonction serveur creer_ticket_avoir -> avoir incohérent avec la facture : refus, support)
    if exists (select 1 from jsonb_array_elements(v_par) x
                where not exists (select 1 from jsonb_array_elements(coalesce(v_orig.par_taux, '[]'::jsonb)) y where lx_prive.tva_num(y->'taux') = lx_prive.tva_num(x->'taux'))) then
      raise exception 'LX_FACTURE_AVOIR_VENTILATION : les taux de TVA du contre-ticket ne correspondent pas à ceux de la facture % — écrivez au support (support@luxyra.fr)', coalesce(v_orig.numero, v_orig.num::text) using errcode = 'P0001';
    end if;
    -- même client que la facture rectifiée
    v_nom := v_orig.client_nom; v_prenom := v_orig.client_prenom; v_adr := v_orig.client_adresse; v_cp := v_orig.client_cp; v_ville := v_orig.client_ville;
    v_email := v_orig.client_email; v_tel := v_orig.client_telephone; v_siren := v_orig.client_siren; v_siret := v_orig.client_siret;
    v_tvacli := v_orig.client_tva_intracom; v_pro := coalesce(v_orig.client_type, '') = 'professionnel';
  else
    v_nom := nullif(btrim(coalesce(p_client->>'nom', '')), ''); v_prenom := nullif(btrim(coalesce(p_client->>'prenom', '')), '');
    v_adr := nullif(btrim(coalesce(p_client->>'adresse', '')), ''); v_cp := nullif(btrim(coalesce(p_client->>'cp', '')), ''); v_ville := nullif(btrim(coalesce(p_client->>'ville', '')), '');
    v_email := nullif(btrim(coalesce(p_client->>'email', '')), ''); v_tel := nullif(btrim(coalesce(p_client->>'telephone', '')), '');
    v_siren := nullif(regexp_replace(coalesce(p_client->>'siren', ''), '\s', '', 'g'), ''); v_siret := nullif(regexp_replace(coalesce(p_client->>'siret', ''), '\s', '', 'g'), '');
    v_tvacli := nullif(upper(regexp_replace(coalesce(p_client->>'tva_intracom', ''), '\s', '', 'g')), '');
    v_pro := coalesce(p_client->>'type', '') = 'professionnel';
    if v_nom is null or v_adr is null or v_cp is null or v_ville is null then
      raise exception 'LX_FACTURE_CLIENT : nom et adresse complète du client obligatoires (CGI, ann. II, art. 242 nonies A, I-1°)' using errcode = 'P0001';
    end if;
    if v_pro and v_siren is null then
      raise exception 'LX_FACTURE_CLIENT : SIREN (ou SIRET) du client professionnel obligatoire' using errcode = 'P0001';
    end if;
  end if;
  -- facture d'avoir d'un ticket réglé (en partie) par un bon à usage unique : le contre-ticket ne porte pas l'imputation du bon ->
  -- reprise des lignes « bon » de la facture rectifiée (même libellé, même taux ; plafonnées à l'écart réel du contre-ticket)
  if v_type = 'avoir' and jsonb_array_length(v_bons) = 0 and jsonb_typeof(v_orig.lignes) = 'array' then
    select coalesce(jsonb_agg(jsonb_build_object('code', l->>'bon_code', 'montant', abs((l->>'ttc')::numeric),
                                                 'lignes', jsonb_build_object(trim_scale((l->>'taux')::numeric)::text || '|P', abs((l->>'ttc')::numeric)),
                                                 'ticket', l->>'bon_ticket', 'date', l->>'bon_date')), '[]'::jsonb)
      into v_bons from jsonb_array_elements(v_orig.lignes) l where l->>'nature' = 'bon';
    select coalesce(sum((x->>'montant')::numeric), 0) into v_bons_tot from jsonb_array_elements(v_bons) x;
  end if;
  v_lignes := lx_prive.facture_lignes_v2(v_items, v_par, t.taux_tva,
                case when coalesce(s.taux_tva, 20) > 0 then coalesce(s.taux_tva_produits, s.taux_tva, 20) else 0 end, v_bons);
  -- taux d'une ligne entièrement réglée par un bon (absent de la ventilation, TTC 0) : ligne 0 de la ventilation de la facture
  -- (EN 16931 BR-S-08 : une ventilation par taux utilisé dans les lignes)
  select v_par || coalesce(jsonb_agg(jsonb_build_object('taux', tx, 'ht', 0, 'tva', 0, 'ttc', 0) order by tx desc), '[]'::jsonb) into v_par
    from (select distinct (l->>'taux')::numeric tx from jsonb_array_elements(v_lignes) l) z
   where not exists (select 1 from jsonb_array_elements(v_par) x where lx_prive.tva_num(x->'taux') = z.tx);
  -- récapitulatif : montants des lignes « bon » réellement portées sur la facture (après plafonnement à l'écart du ticket)
  select coalesce(sum(abs((l->>'ttc')::numeric)), 0),
         string_agg(coalesce(nullif(l->>'bon_code', ''), 'bon') || ' : ' || replace(to_char(abs((l->>'ttc')::numeric), 'FM999999990.00'), '.', ',') || ' €'
                    || coalesce(' (ticket n° ' || (l->>'bon_ticket') || coalesce(' du ' || to_char((l->>'bon_date')::date, 'DD/MM/YYYY'), '') || ')', ''), ' ; ' order by o)
    into v_bons_tot, v_bons_txt
    from jsonb_array_elements(v_lignes) with ordinality as z(l, o) where l->>'nature' = 'bon';
  v_bon_vente := exists (select 1 from jsonb_array_elements(v_items) e where jsonb_typeof(e) = 'object' and lx_prive.tva_vrai(e->'isBon') and e->>'bonUsage' = 'BUU');
  v_mentions := jsonb_build_object(
    'acquittee', case when v_type = 'facture' then 'Facture acquittée le ' || to_char(t.date_ticket, 'DD/MM/YYYY') || ' (ticket de caisse n° ' || coalesce(t.raw_data->>'tkNum', t.num::text) || ', règlement : ' || coalesce(t.mode_paiement, '') || ')'
                      else 'Avoir remboursé le ' || to_char(t.date_ticket, 'DD/MM/YYYY') || ' (ticket n° ' || coalesce(t.raw_data->>'tkNum', t.num::text) || ')' end,
    'recette', 'Facture établie à partir d''un ticket de caisse déjà enregistré : elle ne constitue pas une nouvelle recette.',
    'tva', case when v_franchise then 'TVA non applicable, art. 293 B du CGI' else null end,
    'vendeur', v_vendeur,
    'escompte', case when v_pro then 'Escompte pour paiement anticipé : néant.' else null end,
    'penalites', case when v_pro then 'En cas de retard de paiement : pénalités au taux d''intérêt de la BCE majoré de 10 points et indemnité forfaitaire pour frais de recouvrement de 40 € (C. com. art. L441-10 et D441-5) — sans objet pour une facture acquittée.' else null end,
    'categorie', case when exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'isProd', '') = 'true')
                       and exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'isProd', '') <> 'true' and coalesce(e->>'isSep', '') <> 'true' and coalesce(e->>'isAcompteData', '') <> 'true')
                      then 'Prestations de services et livraisons de biens'
                      when exists (select 1 from jsonb_array_elements(v_items) e where coalesce(e->>'isProd', '') = 'true') then 'Livraisons de biens'
                      else 'Prestations de services' end,
    'rectifie', case when v_orig.id is not null then 'Avoir rectifiant la facture ' || coalesce(v_orig.numero, v_orig.num::text) || ' du ' || to_char(v_orig.date_facture, 'DD/MM/YYYY') else null end,
    'origine_numero', case when v_orig.id is not null then coalesce(v_orig.numero, v_orig.num::text) else null end,
    -- 2026-10-29 (lot 4b)
    'numerotation', 'Numérotation unique et continue, commune aux factures (F-) et aux factures d''avoir (A-) : un numéro qui manque dans une série figure dans l''autre (CGI, ann. II, art. 242 nonies A, I-7°).',
    -- mention récapitulative (montants en valeur absolue : un avoir annonce des montants rectifiés, jamais des montants négatifs) ;
    -- franchise en base (art. 293 B) : aucune TVA, ni à la vente du bon ni ici -> le texte ne parle que du montant déjà encaissé
    'bons', case when v_bons_tot > 0 and v_type = 'avoir' and v_franchise then
      'Opération rectifiée : ' || replace(to_char(abs(t.total_ttc) + v_bons_tot, 'FM999999990.00'), '.', ',') || ' €, dont '
      || replace(to_char(v_bons_tot, 'FM999999990.00'), '.', ',') || ' € : montant déjà encaissé lors de l''achat du bon cadeau (' || coalesce(v_bons_txt, '') || '), non repris par cet avoir. Montant du présent avoir : '
      || replace(to_char(abs(t.total_ttc), 'FM999999990.00'), '.', ',') || ' €.'
      when v_bons_tot > 0 and v_type = 'avoir' then
      'Opération rectifiée : ' || replace(to_char(abs(t.total_ttc) + v_bons_tot, 'FM999999990.00'), '.', ',') || ' € TTC, dont '
      || replace(to_char(v_bons_tot, 'FM999999990.00'), '.', ',') || ' € réglés lors de l''achat du bon cadeau (' || coalesce(v_bons_txt, '') || ') : la TVA de cette part, acquittée à la vente du bon (CGI art. 256 ter), n''est pas rectifiée par cet avoir. Montant du présent avoir : '
      || replace(to_char(abs(t.total_ttc), 'FM999999990.00'), '.', ',') || ' € TTC.'
      when v_bons_tot > 0 and v_franchise then
      'Prix total de l''opération : ' || replace(to_char(t.total_ttc + v_bons_tot, 'FM999999990.00'), '.', ',') || ' €, dont '
      || replace(to_char(v_bons_tot, 'FM999999990.00'), '.', ',') || ' € : montant déjà encaissé lors de l''achat du bon cadeau (' || coalesce(v_bons_txt, '') || '), non facturé de nouveau ici. Montant de la présente facture : '
      || replace(to_char(t.total_ttc, 'FM999999990.00'), '.', ',') || ' €.'
      when v_bons_tot > 0 then
      'Prix total de l''opération : ' || replace(to_char(t.total_ttc + v_bons_tot, 'FM999999990.00'), '.', ',') || ' € TTC, dont '
      || replace(to_char(v_bons_tot, 'FM999999990.00'), '.', ',') || ' € réglés lors de l''achat du bon cadeau (' || coalesce(v_bons_txt, '') || ') : TVA acquittée à la vente du bon (CGI art. 256 ter), non facturée de nouveau ici. Montant de la présente facture : '
      || replace(to_char(t.total_ttc, 'FM999999990.00'), '.', ',') || ' € TTC.' end,
    'bon_vente', case when v_bon_vente and not v_franchise then 'Vente d''un bon cadeau à usage unique : TVA due dès la vente du bon (CGI art. 256 ter, 1 et 3-b) ; son utilisation ne donnera pas lieu à une nouvelle TVA.' end);
  -- numérotation continue par établissement (UNE seule séquence pour F- et A-, sous verrou — art. 242 nonies A, I-7° ; mention
  -- « numerotation » ci-dessus), chaînage de l'empreinte (format inchangé)
  perform pg_advisory_xact_lock(hashtext('factures_clients_' || t.salon_id::text));
  select coalesce(max(num), 0) + 1 into v_num from public.factures_clients where salon_id = t.salon_id;
  select hash into v_prev from public.factures_clients where salon_id = t.salon_id order by num desc limit 1;
  v_numero := (case when v_type = 'avoir' then 'A-' else 'F-' end) || lpad(v_num::text, 6, '0');
  v_hash := upper(encode(extensions.digest('FC|' || v_num || '|' || v_type || '|' || to_char(v_jour, 'YYYY-MM-DD') || '|' || coalesce(t.raw_data->>'tkNum', t.num::text) || '|' ||
            to_char(t.total_ttc, 'FM999999990.00') || '|' || to_char(t.total_ht, 'FM999999990.00') || '|' || coalesce(t.hash, '') || '|' || v_nom || '|' ||
            coalesce(v_prev, '') || '|' || coalesce(s.siret, ''), 'sha256'), 'hex'));
  insert into public.factures_clients (salon_id, num, numero, type, ticket_id, ticket_num, facture_origine_id, date_operation,
      client_nom, client_prenom, client_adresse, client_cp, client_ville, client_email, client_telephone, client_siret, client_siren, client_tva_intracom, client_type,
      salon_nom, salon_siret, salon_adresse, salon_tva_intracom, salon_forme, salon_rue, salon_cp, salon_ville, salon_pays, salon_rcs, salon_capital,
      date_facture, heure_facture, ts_created,
      items, lignes, total_ht, total_tva, total_ttc, taux_tva, par_taux, mode_paiement, mentions, hash, hash_algo, hash_prev, operator_name, mode_caisse)
  values (t.salon_id, v_num, v_numero, v_type, t.id, coalesce(t.raw_data->>'tkNum', t.num::text), v_orig.id, t.date_ticket,
      v_nom, v_prenom, v_adr, v_cp, v_ville, v_email, v_tel, v_siret, v_siren, v_tvacli, case when v_pro then 'professionnel' else 'particulier' end,
      s.nom, s.siret, concat_ws(', ', nullif(btrim(s.adresse), ''), nullif(concat_ws(' ', nullif(btrim(s.cp), ''), nullif(btrim(s.ville), '')), '')),
      case when v_franchise then null else v_tva_v end, v_forme, btrim(s.adresse), btrim(s.cp), btrim(s.ville), 'FR', v_rcs, s.capital_social,
      v_jour, (now() at time zone 'Europe/Paris')::time, now(),
      v_items, v_lignes, t.total_ht, t.total_tva, t.total_ttc, t.taux_tva, v_par, t.mode_paiement, v_mentions, v_hash, 'SHA-256', coalesce(v_prev, ''), left(p_operateur, 120),
      'reel')
  returning id into v_id;
  insert into public.audit_log (salon_id, action, details, operator_name)
  values (t.salon_id, case when v_type = 'avoir' then 'FACTURE_AVOIR_EMISE' else 'FACTURE_EMISE' end,
          v_numero || ' pour le ticket n° ' || coalesce(t.raw_data->>'tkNum', t.num::text) || ' (' || to_char(t.total_ttc, 'FM999999990.00') || ' EUR TTC). Empreinte ' || v_hash, coalesce(left(p_operateur, 120), 'Luxyra'));
  return jsonb_build_object('ok', true, 'id', v_id, 'num', v_num, 'numero', v_numero, 'type', v_type, 'hash', v_hash);
end $$;
revoke all on function public.lx_facture_emettre(uuid, jsonb, text) from public, anon;
grant execute on function public.lx_facture_emettre(uuid, jsonb, text) to authenticated, service_role;

-- ===================================================================================================================== contrôles
-- Après application (lecture seule) — attendus : md5 lx_facture_emettre = 69d6e1e2ab1b17c84d5aea9fbf7228ac ; facture_lignes_v2 présente, non
-- exécutable par anon / authenticated ; aucune facture créée par ce fichier.
--   select md5(pg_get_functiondef('public.lx_facture_emettre(uuid,jsonb,text)'::regprocedure));
--   select has_function_privilege('authenticated','lx_prive.facture_lignes_v2(jsonb,jsonb,numeric,numeric,jsonb)','execute');  -> false
--   select count(*) from public.factures_clients;  -> inchangé
