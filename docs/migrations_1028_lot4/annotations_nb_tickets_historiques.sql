-- =====================================================================================================================
-- 2026-10-28 (-8) — ANNOTATIONS CORRECTIVES SIGNÉES de 7 clôtures Z historiques d'Excellence Coiffure (nombre de tickets)
-- Luxyra 6.8.6 — NON APPLIQUÉ. Étape de déploiement n° 3 du registre NF525 (intervention -8). À passer UNE fois, par Alexandre,
-- dans l'éditeur SQL (rôle postgres : la fonction public.nf525_annoter_cloture est réservée à l'éditeur).
--
-- CONSTAT (mineur de l'audit indépendant, revérifié en production le 28/10/2026, lecture seule) : les clôtures mensuelles de juin,
-- juillet et août 2026 comptent 132 / 158 / 171 tickets alors que le journal des tickets en compte 131 / 159 / 167. Cause, établie
-- ligne à ligne : 7 Z (n° 25 du 10/06, 48 du 08/07, 82 du 21/08, 87 du 27/08, 88 du 28/08, 89 du 29/08, 117 du 03/10) comptent UN
-- ticket de plus que leur journal — chacune de ces journées a exactement UN rendez-vous groupé lié, marqué encaissé à 0 € SANS
-- numéro de ticket, que la version de l'époque comptait comme ticket (corrigé dans l'application le 14/10/2026 : seuls les tickets
-- numérotés sont comptés ; contrôle de la base depuis le 16/10/2026). Montants, TVA et règlements de ces Z : EXACTS (égaux au
-- journal au centime). Juillet : 158 = 159 tickets − 2 (paire d'annulation du 11/07, non comptée comme ventes par la Z) + 1 (Z n° 48).
-- (La Z n° 128 du 16/10 est déjà annotée, annotation n° 1 du 16/10/2026.)
--
-- TRAITEMENT CONFORME (BOI-TVA-DECLA-30-10-30 § 80 à 120 : une donnée enregistrée ne se modifie pas ; la correction est une
-- écriture nouvelle, tracée) : AUCUNE clôture (Z ni mensuelle) n'est modifiée. Une annotation corrective SIGNÉE est ajoutée à chaque
-- Z (table clotures_annotations, inaltérable, chaînée SHA-256, évènement JET 900), par le mécanisme existant
-- public.nf525_annoter_cloture (qui REFUSE d'annoter une Z conforme au journal et recalcule lui-même le nombre et le montant
-- corrects depuis le journal des tickets). Effets : affichage / réimpression des Z avec leur annotation ; la prochaine Z reporte la
-- correction dans le grand total perpétuel des tickets (−7, mécanisme existant) et dans les cumuls de tickets du mois / de l'année
-- (déclencheur b_nf525_z_cumul_tickets du lot 4) ; la clôture mensuelle d'octobre comptera 139 tickets (= journal). Les clôtures
-- mensuelles de juin / juillet / août restent scellées telles quelles ; leur écart est expliqué par ces annotations.
--
-- SÉCURITÉ DU SCRIPT : chaque Z est contrôlée AVANT annotation (établissement, n°, date, nombre de tickets et CA enregistrés,
-- nombre du journal = enregistré − 1, CA du journal = CA enregistré) ; la moindre différence ARRÊTE tout (aucune annotation
-- écrite) ; une Z déjà annotée est ignorée (script rejouable sans doublon).
-- RETOUR ARRIÈRE : aucun (une annotation signée est inaltérable par construction, comme la Z). Ne passer qu'après accord.
-- =====================================================================================================================
do $$
declare
  v_salon constant uuid := 'e0cf27c7-d402-4d76-8e91-9ef5231b3582';
  v_attendu constant jsonb := '[
    {"num":25,  "date":"2026-06-10", "nb":10, "ca":428.40},
    {"num":48,  "date":"2026-07-08", "nb":8,  "ca":380.80},
    {"num":82,  "date":"2026-08-21", "nb":14, "ca":485.70},
    {"num":87,  "date":"2026-08-27", "nb":12, "ca":447.70},
    {"num":88,  "date":"2026-08-28", "nb":10, "ca":420.00},
    {"num":89,  "date":"2026-08-29", "nb":12, "ca":725.00},
    {"num":117, "date":"2026-10-03", "nb":14, "ca":422.70}]'::jsonb;
  e jsonb; z record; j jsonb; v_faits int := 0; v_deja int := 0; r jsonb;
begin
  -- 1. contrôles de toutes les Z AVANT toute écriture
  for e in select * from jsonb_array_elements(v_attendu) loop
    select * into z from public.clotures where salon_id = v_salon and num = (e->>'num')::int;
    if not found then raise exception 'Annotations lot 4 : Z n° % introuvable — rien n''a été écrit', e->>'num'; end if;
    if z.date_cloture <> (e->>'date')::date or z.nb_tickets <> (e->>'nb')::int or abs(z.total_ca - (e->>'ca')::numeric) > 0.005 then
      raise exception 'Annotations lot 4 : Z n° % différente du relevé du 28/10/2026 (date %, % tickets, % EUR) — rien n''a été écrit', z.num, z.date_cloture, z.nb_tickets, z.total_ca;
    end if;
    if exists (select 1 from public.clotures_annotations a where a.cloture_id = z.id) then continue; end if;
    j := lx_prive.z_journal_tickets(z.salon_id, z.date_cloture, z.mode_caisse);
    if (j->>'nb')::int <> z.nb_tickets - 1 or abs((j->>'total')::numeric - z.total_ca) > 0.005 then
      raise exception 'Annotations lot 4 : journal de la Z n° % inattendu (% ticket(s), % EUR) — rien n''a été écrit', z.num, j->>'nb', j->>'total';
    end if;
  end loop;
  -- 2. annotations (mécanisme existant, signé, JET 900)
  for e in select * from jsonb_array_elements(v_attendu) loop
    select * into z from public.clotures where salon_id = v_salon and num = (e->>'num')::int;
    if exists (select 1 from public.clotures_annotations a where a.cloture_id = z.id) then v_deja := v_deja + 1; continue; end if;
    r := public.nf525_annoter_cloture(z.id,
      'Nombre de tickets de la Z supérieur de 1 au journal des tickets : un rendez-vous groupé lié, marqué encaissé à 0 € sans numéro de ticket, était compté comme ticket par la version de l''époque (comptage des seuls tickets numérotés depuis le 14/10/2026). Montants, TVA et règlements exacts, inchangés. Relevé lors de l''audit indépendant (lot 4, 28/10/2026).',
      'Luxyra (éditeur)', '6.8.6');
    v_faits := v_faits + 1;
  end loop;
  raise notice 'Annotations lot 4 : % annotation(s) créée(s), % Z déjà annotée(s)', v_faits, v_deja;
end $$;

-- Contrôle (lecture) : 8 annotations attendues pour l'établissement (n° 1 du 16/10/2026 + 7), nombre corrigé = journal
-- select a.num, a.cloture_num, a.cloture_date, a.wrong_nb_tickets, a.correct_nb_tickets, a.wrong_total_ca, a.correct_total_ca, left(a.hash, 12)
--   from public.clotures_annotations a where a.salon_id = 'e0cf27c7-d402-4d76-8e91-9ef5231b3582' order by a.num;
