-- 2026-10-31 audit final I1 (validé par Alexandre) : contrôle admin S10 « Grand total perpétuel » (lecture seule).
-- Les Z suivantes intègrent déjà la correction des annotations correctives signées : la retirer en plus
-- donnait une fausse alerte « ÉCART » (Excellence : grand total 30 605,20 € = somme des tickets 30 605,20 €).
-- On ne retire la correction que si le grand total brut diffère de la somme des tickets.
-- Aucune donnée de caisse touchée (ni tickets, ni Z, ni signatures) : seul l'affichage du contrôle change.
do $$
declare d text := pg_get_functiondef('public.admin_nf525_etat'::regproc);
  a text := 'if v_num is not null then v_num := v_num - v_n3_num; end if;';
  b text := '-- 2026-10-31 audit final I1 : les Z suivantes intègrent déjà la correction ; on ne la retire que si le grand total brut diffère (sinon double déduction = fausse alerte)
      if v_num is not null and abs(round(v_num, 2) - v_num2) > 0.01 then v_num := v_num - v_n3_num; else v_n3 := 0; end if;';
begin
  if position(a in d) = 0 then raise exception 'motif introuvable'; end if;
  execute replace(d, a, b);
end $$;
