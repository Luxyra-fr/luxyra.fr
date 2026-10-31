-- 31/10/2026 (nuit) : admin_tableau_de_bord v3 — compteurs cohérents (LECTURE SEULE, aucune table modifiée).
--  essais = essais en cours HORS comptes de test ; actifs = abonnements « actifs » HORS comptes offerts/test ;
--  tests = TOUS les comptes de test encore ouverts (non fermés, non résiliés), Salon Démo en essai compris.
-- Règle de test inchangée : lx_prive.salon_est_test() (caisse en test, Salon/Luxyra Démo, offert en cours).
-- Modification par remplacement exact du bloc de comptage dans la définition en production (échoue si le bloc diffère).
-- Retour arrière exact : tdb_compteurs_v3_retour.sql.
DO $m$
DECLARE d text; a text; n text;
BEGIN
  SELECT pg_get_functiondef('public.admin_tableau_de_bord()'::regprocedure) INTO d;
  a := $a$  select count(*) filter (where status = 'trial'),
         count(*) filter (where status = 'active'),
         count(*) filter (where lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))
    into v_essais, v_actifs, v_tests
    from public.salons
   where ferme_le is null and (status <> 'trial' or not coalesce(nom, '') ~* '^\s*(salon|luxyra)\s+d[eé]mo');$a$;
  n := $n$  select count(*) filter (where status = 'trial' and not lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until)),
         count(*) filter (where status = 'active' and not lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until)),
         count(*) filter (where status <> 'cancelled' and lx_prive.salon_est_test(mode_caisse, nom, is_free, free_until))
    into v_essais, v_actifs, v_tests
    from public.salons
   where ferme_le is null;$n$;
  IF position(n in d) > 0 THEN RAISE NOTICE 'déjà en v3'; RETURN; END IF;
  IF position(a in d) = 0 THEN RAISE EXCEPTION 'bloc de comptage introuvable : définition différente, rien modifié'; END IF;
  EXECUTE replace(d, a, n);
END $m$;
