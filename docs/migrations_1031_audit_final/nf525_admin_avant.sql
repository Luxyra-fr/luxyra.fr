-- 2026-10-31 — RETOUR ARRIÈRE de nf525_admin_sans_ecriture_caisse.sql (remet le passe-droit admin, à n'utiliser qu'en cas de besoin).
-- Remplacement inverse exact ; empreinte md5(pg_get_functiondef) AVANT modification notée pour chaque fonction :
--   cloturer_mois(uuid,integer,integer) : 4a33de47d0542ac1ec4c8125b6e4ad7a
--   cloturer_annee(uuid,integer) : 9111b2ae506fb6e7d2cfb4608c36c9bf
--   nf525_generer_archive_annuelle(uuid,integer) : 57fa3608e061a765fc8ee3c5613957d5
--   cloturer_exercice(uuid,date) : daada01d5cf0b5825490c934c9107302
--   creer_ticket_avoir(uuid,text) : a4b3134a35a4799a4df2a56dd9a2879c
--   consommer_bon_cadeau(uuid,numeric,text) : d887fdccfcdbfcc0c88df8ab308bccad
--   lx_pack_consommer(uuid) : 2dab9ae7a13bae4081a6cba6a4340665
--   recrediter_bon_cadeau(uuid,numeric,text,text) : b785b85e4a80c414e0cb676283a4b01b
--   lx_facture_emettre(uuid,jsonb,text) : 69d6e1e2ab1b17c84d5aea9fbf7228ac

do $do$
declare d text := pg_get_functiondef('public.cloturer_mois(uuid,integer,integer)'::regprocedure);
  a text := $q$AND user_id = v_user_id) THEN$q$; b text := $q$AND user_id = v_user_id) AND NOT is_admin() THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cloturer_mois(uuid,integer,integer) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'cloturer_mois(uuid,integer,integer) : passe-droit admin remis';
  else
    raise notice 'cloturer_mois(uuid,integer,integer) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.cloturer_annee(uuid,integer)'::regprocedure);
  a text := $q$AND user_id = v_user_id) THEN$q$; b text := $q$AND user_id = v_user_id) AND NOT is_admin() THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cloturer_annee(uuid,integer) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'cloturer_annee(uuid,integer) : passe-droit admin remis';
  else
    raise notice 'cloturer_annee(uuid,integer) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.nf525_generer_archive_annuelle(uuid,integer)'::regprocedure);
  a text := $q$AND user_id = v_user_id) THEN$q$; b text := $q$AND user_id = v_user_id) AND NOT is_admin() THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'nf525_generer_archive_annuelle(uuid,integer) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'nf525_generer_archive_annuelle(uuid,integer) : passe-droit admin remis';
  else
    raise notice 'nf525_generer_archive_annuelle(uuid,integer) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.cloturer_exercice(uuid,date)'::regprocedure);
  a text := $q$AND user_id = v_uid) THEN$q$; b text := $q$AND user_id = v_uid) AND NOT is_admin() THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cloturer_exercice(uuid,date) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'cloturer_exercice(uuid,date) : passe-droit admin remis';
  else
    raise notice 'cloturer_exercice(uuid,date) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.creer_ticket_avoir(uuid,text)'::regprocedure);
  a text := $q$and user_id = v_user_id) then$q$; b text := $q$and user_id = v_user_id) and not is_admin() then$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'creer_ticket_avoir(uuid,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'creer_ticket_avoir(uuid,text) : passe-droit admin remis';
  else
    raise notice 'creer_ticket_avoir(uuid,text) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.consommer_bon_cadeau(uuid,numeric,text)'::regprocedure);
  a text := $q$s.user_id = v_uid)) THEN$q$; b text := $q$s.user_id = v_uid)
              OR public.is_admin()) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'consommer_bon_cadeau(uuid,numeric,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'consommer_bon_cadeau(uuid,numeric,text) : passe-droit admin remis';
  else
    raise notice 'consommer_bon_cadeau(uuid,numeric,text) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.lx_pack_consommer(uuid)'::regprocedure);
  a text := $q$s.user_id = v_uid)) THEN$q$; b text := $q$s.user_id = v_uid) OR public.is_admin()) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'lx_pack_consommer(uuid) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'lx_pack_consommer(uuid) : passe-droit admin remis';
  else
    raise notice 'lx_pack_consommer(uuid) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.recrediter_bon_cadeau(uuid,numeric,text,text)'::regprocedure);
  a text := $q$s.user_id = v_uid)) THEN$q$; b text := $q$s.user_id = v_uid) OR public.is_admin()) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'recrediter_bon_cadeau(uuid,numeric,text,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'recrediter_bon_cadeau(uuid,numeric,text,text) : passe-droit admin remis';
  else
    raise notice 'recrediter_bon_cadeau(uuid,numeric,text,text) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.lx_facture_emettre(uuid,jsonb,text)'::regprocedure);
  a text := $q$lx_prive.appel_serveur() or exists$q$; b text := $q$lx_prive.appel_serveur() or public.is_admin() or exists$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'lx_facture_emettre(uuid,jsonb,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'lx_facture_emettre(uuid,jsonb,text) : passe-droit admin remis';
  else
    raise notice 'lx_facture_emettre(uuid,jsonb,text) : déjà fait (motif absent)';
  end if;
end $do$;

-- Vérification : après retour arrière, md5(pg_get_functiondef(...)) doit redonner les empreintes ci-dessus.
select p.oid::regprocedure as fonction, md5(pg_get_functiondef(p.oid)) as md5 from pg_proc p where p.oid in ('public.cloturer_mois(uuid,integer,integer)'::regprocedure,'public.cloturer_annee(uuid,integer)'::regprocedure,'public.nf525_generer_archive_annuelle(uuid,integer)'::regprocedure,'public.cloturer_exercice(uuid,date)'::regprocedure,'public.creer_ticket_avoir(uuid,text)'::regprocedure,'public.consommer_bon_cadeau(uuid,numeric,text)'::regprocedure,'public.lx_pack_consommer(uuid)'::regprocedure,'public.recrediter_bon_cadeau(uuid,numeric,text,text)'::regprocedure,'public.lx_facture_emettre(uuid,jsonb,text)'::regprocedure);
