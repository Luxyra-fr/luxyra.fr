-- Banc rejouable : l'éditeur (compte admin, aal2, session valide) n'a aucun droit d'écriture de caisse.
-- S'exécute DANS UN SEUL BLOC qui finit par une exception : tout est annulé (aucune écriture ne subsiste).
-- Un établissement d'essai fictif est créé puis annulé ; aucune donnée réelle n'est touchée.
-- Résultat attendu (message de l'exception finale) : chaque fonction « REFUSÉ », historique=f, trace_admin=1, trace_proprio=0, proprio_reset=passe.
-- Lot 3 (31/10/2026) : + hist_jet_signe=f (JET d'installation signé), hist_tk_signe=t (contre-épreuve), tva_admin=1 (JET 270), cfg_admin=REFUSÉ, cfg_migration=passe,
--   cfg_proprio=passe, cfg_serveur=passe, insert_admin_proprio=REFUSÉ, update_admin_proprio=REFUSÉ.
-- Résultat obtenu le 31/10/2026 : 11 / 11 REFUSÉ (lx_pack_consommer : « Pack introuvable » car aucun forfait en base ; contrôle propriétaire visible dans le code), historique=f, trace_admin=1, trace_proprio=0, proprio_reset=passe.
do $$
declare v_id uuid := gen_random_uuid(); v_owner uuid; v_adm uuid; v_sess uuid; v_res text := ''; e text; adm boolean;
  n_owner int; n_adm int; e_owner text := 'passe'; hist boolean; hist2 boolean; hist3 boolean; n_tva int;
  e_cfg_adm text := 'ACCEPTÉ !'; e_cfg_mig text := 'passe'; e_cfg_own text := 'passe'; e_cfg_srv text := 'passe';
  e_ins text := 'ACCEPTÉ !'; e_upd text := 'ACCEPTÉ !'; v_id2 uuid := gen_random_uuid(); v_jet uuid;
  procedure_test text; r_txt text; v_tk uuid; v_bon uuid; v_pack uuid;
begin
  select id into v_adm from auth.users where email = 'support@luxyra.fr';
  select s.id into v_sess from auth.sessions s where s.user_id = v_adm and s.created_at > now() - interval '12 hours' order by created_at desc limit 1;
  if v_sess is null then raise exception 'Banc : ouvrir d''abord une session admin (moins de 12 h)'; end if;
  select id into v_owner from auth.users where email <> 'support@luxyra.fr' and id not in (select user_id from salons where user_id is not null) limit 1;
  insert into salons(id, user_id, nom, status, mode_caisse, siret, trial_end)
    values (v_id, v_owner, 'Banc accès admin (annulé)', 'trial', 'test', '12345678901234', now() + interval '10 days');
  hist := public.salon_a_historique_fiscal(v_id);
  -- lot 3 : JET d'installation déjà signé (simulé) -> l'essai reste sans historique fiscal
  select id into v_jet from nf525_jet where salon_id = v_id order by seq limit 1;
  begin
    insert into nf525_signatures(salon_id, type, seq, source_table, source_id, source_num, data_to_sign, signature, prev_signature, algo, key_id)
    values (v_id, 'JET', 1, 'nf525_jet', v_jet, 1, 'banc', 'banc', null, 'ES256', (select key_id from nf525_cles where active limit 1));
    hist2 := public.salon_a_historique_fiscal(v_id);
    -- contre-épreuve : une signature de ticket rend l'historique fiscal vrai
    insert into nf525_signatures(salon_id, type, seq, source_table, source_id, source_num, data_to_sign, signature, prev_signature, algo, key_id)
    values (v_id, 'TK', 1, 'tickets', gen_random_uuid(), 1, 'banc', 'banc', null, 'ES256', (select key_id from nf525_cles where active limit 1));
    hist3 := public.salon_a_historique_fiscal(v_id);
    delete from nf525_signatures where salon_id = v_id and type = 'TK';
  exception when others then hist2 := null; v_res := v_res || E'\nsimulation signature JET : ' || left(sqlerrm, 80); end;
  -- objets RÉELS d'un autre établissement (le contrôle d'accès doit refuser AVANT toute écriture ; tout est annulé à la fin)
  select id into v_tk from tickets order by created_at desc limit 1;
  select id into v_bon from cartes_cadeaux order by created_at desc limit 1;
  select id into v_pack from packs_clients order by created_at desc limit 1;

  -- 1. éditeur
  perform set_config('request.jwt.claims', json_build_object('sub', v_adm, 'role', 'authenticated', 'aal', 'aal2', 'session_id', v_sess)::text, true);
  adm := public.is_admin();
  foreach procedure_test in array array[
    format('select public.creer_ticket_avoir(%L, ''banc'')', v_tk),
    format('select public.consommer_bon_cadeau(%L, 1, ''banc'')', v_bon),
    format('select public.recrediter_bon_cadeau(%L, 1, ''banc'', ''banc'')', v_bon),
    format('select public.lx_pack_consommer(%L)', v_pack),
    format('select public.cloturer_mois(%L, 2026, 1)', v_id),
    format('select public.cloturer_annee(%L, 2025)', v_id),
    format('select public.cloturer_exercice(%L, %L::date)', v_id, '2025-12-31'),
    format('select public.nf525_generer_archive_annuelle(%L, 2025)', v_id),
    format('select public.lx_facture_emettre(%L, ''{}''::jsonb, ''banc'')', v_tk),
    format('select public.factory_reset_salon(%L)', v_id),
    format('select public.reset_ventes_test_salon(%L)', v_id)] loop
    begin execute procedure_test || '::text' into r_txt;
      e := case when r_txt ~* '"ok": *false' then 'REFUSÉ (' || left(r_txt, 60) || ')' else 'ACCEPTÉ ! ' || left(coalesce(r_txt,''), 60) end;
    exception when others then e := 'REFUSÉ (' || left(sqlerrm, 50) || ')'; end;
    v_res := v_res || E'\n' || split_part(split_part(procedure_test, 'public.', 2), '(', 1) || ' : ' || e;
  end loop;
  update salons set ville = 'Ville modifiée par l''éditeur' where id = v_id;
  select count(*) into n_adm from audit_log where salon_id = v_id and action = 'CONFIG_IDENTITE' and operator_name like '%éditeur Luxyra%';
  update salons set taux_tva = 10 where id = v_id;
  select count(*) into n_tva from nf525_jet where salon_id = v_id and code = 270;
  begin update salons set config_json = '{"banc":1}'::jsonb where id = v_id; exception when others then e_cfg_adm := 'REFUSÉ (' || left(sqlerrm, 40) || ')'; end;
  begin perform public.admin_salon_cfg_migration(v_id, 'requested'); exception when others then e_cfg_mig := left(sqlerrm, 80); end;
  begin insert into salons(id, user_id, nom, status, mode_caisse, siret, trial_end) values (v_id2, v_adm, 'Banc admin propriétaire (annulé)', 'trial', 'test', '12345678901234', now() + interval '10 days');
  exception when others then e_ins := 'REFUSÉ (' || left(sqlerrm, 40) || ')'; end;
  begin update salons set user_id = v_adm where id = v_id; exception when others then e_upd := 'REFUSÉ (' || left(sqlerrm, 40) || ')'; end;

  -- 2. propriétaire
  perform set_config('request.jwt.claims', json_build_object('sub', v_owner, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  update salons set ville = 'Ville modifiée par le propriétaire' where id = v_id;
  select count(*) into n_owner from audit_log where salon_id = v_id and action = 'CONFIG_IDENTITE' and operator_name not like '%éditeur Luxyra%';
  begin update salons set config_json = '{"banc":2}'::jsonb where id = v_id; exception when others then e_cfg_own := left(sqlerrm, 80); end;
  begin perform public.reset_ventes_test_salon(v_id); exception when others then e_owner := left(sqlerrm, 80); end;
  -- 3. traitement serveur (rôle service, sans utilisateur)
  perform set_config('request.jwt.claims', json_build_object('role', 'service_role')::text, true);
  begin update salons set config_json = '{"banc":3}'::jsonb where id = v_id; exception when others then e_cfg_srv := left(sqlerrm, 80); end;

  raise exception E'RÉSULTAT is_admin=% historique=% hist_jet_signe=% hist_tk_signe=% trace_admin=% trace_proprio=% proprio_reset=% tva_admin=% cfg_admin=% cfg_migration=% cfg_proprio=% cfg_serveur=% insert_admin_proprio=% update_admin_proprio=% %',
    adm, hist, hist2, hist3, n_adm, n_owner, e_owner, n_tva, e_cfg_adm, e_cfg_mig, e_cfg_own, e_cfg_srv, e_ins, e_upd, v_res;
end $$;
