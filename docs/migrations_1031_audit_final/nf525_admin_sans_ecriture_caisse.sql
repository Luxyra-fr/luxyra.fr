-- 2026-10-31 — NF525 : l'éditeur (compte admin Luxyra) ne peut plus faire d'opération de caisse à la place d'un établissement.
-- Validé par Alexandre (« oui fais ce qu'il faut, ça doit être conforme et passer l'audit NF525 »).
-- Nature : CONTRÔLE D'ACCÈS UNIQUEMENT. Seule la condition « ... ou administrateur » est retirée ;
-- aucun calcul, format d'empreinte, chaînage, signature, numérotation ni JET ne change (BOI-TVA-DECLA-30-10-30 § 340 : version mineure).
-- Restent autorisés : le propriétaire de l'établissement (session de l'établissement, opérateurs inclus)
-- et les appels serveur sans utilisateur (cron, edge functions en service_role, lx_prive.appel_serveur()).
-- GARDÉ côté admin (rôle éditeur, tracé) : lx_z_forcer_admin (déblocage d'une journée), nf525_annoter_cloture
-- (annotation corrective signée de l'éditeur), nf525_signer_editeur (attestation éditeur), et les contrôles en lecture.
-- Rejouable. Retour arrière : nf525_admin_avant.sql.
do $do$
declare d text := pg_get_functiondef('public.cloturer_mois(uuid,integer,integer)'::regprocedure);
  a text := $q$AND user_id = v_user_id) AND NOT is_admin() THEN$q$; b text := $q$AND user_id = v_user_id) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cloturer_mois(uuid,integer,integer) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'cloturer_mois(uuid,integer,integer) : passe-droit admin retiré';
  else
    raise notice 'cloturer_mois(uuid,integer,integer) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.cloturer_annee(uuid,integer)'::regprocedure);
  a text := $q$AND user_id = v_user_id) AND NOT is_admin() THEN$q$; b text := $q$AND user_id = v_user_id) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cloturer_annee(uuid,integer) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'cloturer_annee(uuid,integer) : passe-droit admin retiré';
  else
    raise notice 'cloturer_annee(uuid,integer) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.nf525_generer_archive_annuelle(uuid,integer)'::regprocedure);
  a text := $q$AND user_id = v_user_id) AND NOT is_admin() THEN$q$; b text := $q$AND user_id = v_user_id) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'nf525_generer_archive_annuelle(uuid,integer) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'nf525_generer_archive_annuelle(uuid,integer) : passe-droit admin retiré';
  else
    raise notice 'nf525_generer_archive_annuelle(uuid,integer) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.cloturer_exercice(uuid,date)'::regprocedure);
  a text := $q$AND user_id = v_uid) AND NOT is_admin() THEN$q$; b text := $q$AND user_id = v_uid) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'cloturer_exercice(uuid,date) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'cloturer_exercice(uuid,date) : passe-droit admin retiré';
  else
    raise notice 'cloturer_exercice(uuid,date) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.creer_ticket_avoir(uuid,text)'::regprocedure);
  a text := $q$and user_id = v_user_id) and not is_admin() then$q$; b text := $q$and user_id = v_user_id) then$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'creer_ticket_avoir(uuid,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'creer_ticket_avoir(uuid,text) : passe-droit admin retiré';
  else
    raise notice 'creer_ticket_avoir(uuid,text) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.consommer_bon_cadeau(uuid,numeric,text)'::regprocedure);
  a text := $q$s.user_id = v_uid)
              OR public.is_admin()) THEN$q$; b text := $q$s.user_id = v_uid)) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'consommer_bon_cadeau(uuid,numeric,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'consommer_bon_cadeau(uuid,numeric,text) : passe-droit admin retiré';
  else
    raise notice 'consommer_bon_cadeau(uuid,numeric,text) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.lx_pack_consommer(uuid)'::regprocedure);
  a text := $q$s.user_id = v_uid) OR public.is_admin()) THEN$q$; b text := $q$s.user_id = v_uid)) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'lx_pack_consommer(uuid) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'lx_pack_consommer(uuid) : passe-droit admin retiré';
  else
    raise notice 'lx_pack_consommer(uuid) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.recrediter_bon_cadeau(uuid,numeric,text,text)'::regprocedure);
  a text := $q$s.user_id = v_uid) OR public.is_admin()) THEN$q$; b text := $q$s.user_id = v_uid)) THEN$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'recrediter_bon_cadeau(uuid,numeric,text,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'recrediter_bon_cadeau(uuid,numeric,text,text) : passe-droit admin retiré';
  else
    raise notice 'recrediter_bon_cadeau(uuid,numeric,text,text) : déjà fait (motif absent)';
  end if;
end $do$;

do $do$
declare d text := pg_get_functiondef('public.lx_facture_emettre(uuid,jsonb,text)'::regprocedure);
  a text := $q$lx_prive.appel_serveur() or public.is_admin() or exists$q$; b text := $q$lx_prive.appel_serveur() or exists$q$;
begin
  if position(a in d) > 0 then
    if (length(d) - length(replace(d, a, ''))) / length(a) <> 1 then raise exception 'lx_facture_emettre(uuid,jsonb,text) : motif présent plusieurs fois'; end if;
    execute replace(d, a, b);
    raise notice 'lx_facture_emettre(uuid,jsonb,text) : passe-droit admin retiré';
  else
    raise notice 'lx_facture_emettre(uuid,jsonb,text) : déjà fait (motif absent)';
  end if;
end $do$;

-- Contrôle : plus aucune de ces fonctions ne cite is_admin()
select p.oid::regprocedure as fonction, p.prosrc ~ 'is_admin\(\)' as cite_encore_is_admin
from pg_proc p where p.oid in ('public.cloturer_mois(uuid,integer,integer)'::regprocedure,'public.cloturer_annee(uuid,integer)'::regprocedure,'public.nf525_generer_archive_annuelle(uuid,integer)'::regprocedure,'public.cloturer_exercice(uuid,date)'::regprocedure,'public.creer_ticket_avoir(uuid,text)'::regprocedure,'public.consommer_bon_cadeau(uuid,numeric,text)'::regprocedure,'public.lx_pack_consommer(uuid)'::regprocedure,'public.recrediter_bon_cadeau(uuid,numeric,text,text)'::regprocedure,'public.lx_facture_emettre(uuid,jsonb,text)'::regprocedure);
