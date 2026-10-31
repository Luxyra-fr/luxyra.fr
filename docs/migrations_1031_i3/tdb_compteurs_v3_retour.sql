-- Retour arrière exact de tdb_compteurs_v3.sql (rétablit le bloc de comptage v2).
DO $m$
DECLARE d text; a text; n text;
BEGIN
  SELECT pg_get_functiondef('public.admin_tableau_de_bord()'::regprocedure) INTO d;
  a := $a$  select count(*) filter (where status = 'trial' and not lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until)),
         count(*) filter (where status = 'active' and not lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until)),
         count(*) filter (where status <> 'cancelled' and lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))
    into v_essais, v_actifs, v_tests
    from public.salons
   where ferme_le is null;$a$;
  n := $n$  select count(*) filter (where status = 'trial'),
         count(*) filter (where status = 'active'),
         count(*) filter (where lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))
    into v_essais, v_actifs, v_tests
    from public.salons
   where ferme_le is null and (status <> 'trial' or not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo');$n$;
  IF position(n in d) > 0 THEN RAISE NOTICE 'déjà en v2'; RETURN; END IF;
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'bloc v3 introuvable : définition différente, rien modifié'; END IF;
  EXECUTE replace(d, a, n);
END $m$;
