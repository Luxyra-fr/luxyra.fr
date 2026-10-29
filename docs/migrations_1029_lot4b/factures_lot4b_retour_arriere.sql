-- =====================================================================================================================
-- 2026-10-29 (-9) — RETOUR ARRIÈRE du lot 4b (factures_lot4b.sql). À passer seulement en cas de problème, dans l'éditeur SQL.
-- Remet la définition de PRODUCTION de public.lx_facture_emettre relevée le 29/10/2026 au soir (md5 b555d5376727f0b2d63de0ccb37c882b,
-- vérifiée en fin de fichier) et retire lx_prive.facture_lignes_v2. Les factures émises entre-temps sont CONSERVÉES (pièces
-- inaltérables : leurs lignes « bon » / remises de ligne restent lisibles par l'application 6.8.7 ; l'application 6.8.6 les affiche
-- comme des lignes ordinaires). Aucune autre donnée touchée.
-- =====================================================================================================================
CREATE OR REPLACE FUNCTION public.lx_facture_emettre(p_ticket uuid, p_client jsonb, p_operateur text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
declare
  t public.tickets%rowtype; s public.salons%rowtype; v_num int; v_prev text; v_hash text; v_id uuid; v_type text; v_orig public.factures_clients%rowtype;
  v_l jsonb; v_par jsonb; v_items jsonb; v_lignes jsonb; v_nom text; v_prenom text; v_adr text; v_cp text; v_ville text; v_email text; v_tel text;
  v_siren text; v_siret text; v_tvacli text; v_pro boolean; v_franchise boolean; v_mentions jsonb; v_numero text;
  v_jour date := (now() at time zone 'Europe/Paris')::date; v_ref text; v_tva_v text; v_siren_v text; v_soc boolean; v_rcs text; v_forme text; v_vendeur text;
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
  v_lignes := lx_prive.facture_lignes(v_items, v_par, t.taux_tva,
                case when coalesce(s.taux_tva, 20) > 0 then coalesce(s.taux_tva_produits, s.taux_tva, 20) else 0 end);
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
    'origine_numero', case when v_orig.id is not null then coalesce(v_orig.numero, v_orig.num::text) else null end);
  -- numérotation continue par établissement (une seule série F- / A-, sous verrou), chaînage de l'empreinte
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
end $function$
;
revoke all on function public.lx_facture_emettre(uuid, jsonb, text) from public, anon;
grant execute on function public.lx_facture_emettre(uuid, jsonb, text) to authenticated, service_role;
drop function if exists lx_prive.facture_lignes_v2(jsonb, jsonb, numeric, numeric, jsonb);
do $$ begin
  if md5(pg_get_functiondef('public.lx_facture_emettre(uuid,jsonb,text)'::regprocedure)) <> 'b555d5376727f0b2d63de0ccb37c882b' then
    raise exception 'RETOUR ARRIÈRE LOT 4b : lx_facture_emettre différente de la définition de production — écrire au support';
  end if;
end $$;
