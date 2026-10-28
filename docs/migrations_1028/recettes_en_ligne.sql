-- =====================================================================================================================
-- 2026-10-28 (-2) — RECETTES ENCAISSÉES EN LIGNE = TICKET DE CAISSE SCELLÉ CRÉÉ PAR LE SERVEUR AU PAIEMENT CONFIRMÉ
-- Luxyra 6.8.3 (version MINEURE ; 6.8.0, 6.8.1 et 6.8.2 jamais publiées) — NON APPLIQUÉ. À passer par Alexandre dans l'éditeur SQL (ordre en bas de fichier).
-- 2026-10-28 (-3) : corrections de l'audit de la 6.8.0 (registre NF525, intervention -3) : série de n° imprimés propre au serveur
-- (900001+), version minimale de l'application, déclencheurs réservés aux écritures du serveur + gardes des colonnes de paiement,
-- remboursements vérifiés (re_…) et plafonnés, clé partagée d'annulation Click & Collect, filet sans date de départ (sources à
-- clé partagée), carte d'abonnement recopiée de la configuration, remboursements d'empreinte / d'acompte conservé, rattrapage en
-- une transaction par évènement, verrou de l'établissement dans le contrôle de la Z, retour arrière propre.
-- 2026-10-28 (-4) : corrections du contre-audit (NO GO) — Luxyra 6.8.2 (registre NF525, intervention -4) : garde de tête par
-- empreintes md5 COMPLÈTES des définitions relues en production ; garde des colonnes de paiement : ajout du n° « tk » par
-- l'application accepté (lx_acompte_remb_ticketer), plus de fausse alerte à l'enregistrement d'une carte d'abonnement payée en
-- ligne ; retour arrière : seules les recettes que l'application sait reprendre sont écartées, la file est traitée même
-- interrupteur éteint (seul le filet de création s'éteint), annulation Click & Collect d'une commande déjà en caisse traitée
-- même interrupteur éteint ; rattrapage : bail daté dans une table (plus de verrou de session) ; version minimale par défaut 6.8.2.
-- 2026-10-28 (-5) : corrections du contre-audit final — Luxyra 6.8.3 (registre NF525, intervention -5) : journées RETENUES
-- (sans Z : tickets au journal ou ventes encaissées non transmises) : Z refusée tant qu'une journée antérieure est retenue ou
-- que des ventes du jour manquent au journal (forçage tracé par un administrateur : lx_z_forcer), clôtures mensuelle / annuelle /
-- d'exercice refusées (tracé + alerte, nouvel essai quotidien) ; date réelle d'une vente reportée SCELLÉE dans les lignes du
-- ticket (items[0].lxRep, garde LX_REPORT_NON_SCELLE) ; remboursement fait sur Stripe avant la première activation : aucun
-- ticket, consigné et ticketé à l'activation (attente_activation) ; alertes de caisse de l'établissement
-- (lx_caisse_alertes) ; version minimale par défaut 6.8.3. PRÉREQUIS OBLIGATOIRE : docs/migrations_1027/bons_cadeaux_tva.sql.
-- Idempotent (create or replace / if not exists / drop trigger if exists). Ne crée AUCUN ticket tant que
-- app_config.config.recettes_en_ligne_serveur <> true (interrupteur, posé en DERNIER, après publication des pages).
--
-- Constats corrigés (audit indépendant du 27-28/10/2026) : C1 bons cadeaux vendus en ligne sans ticket ; C2 cartes
-- d'abonnement payées en ligne sans ticket ; M7 acomptes en ligne / acomptes conservés / empreintes ticketés seulement
-- quand un appareil ouvre l'application, Click & Collect payé jamais remis = jamais en caisse ; M5 empreinte capturée en
-- partie : ticket au montant autorisé au lieu du montant prélevé.
--
-- Règles (sources : voir docs/registre-interventions-nf525.md, intervention du 28/10/2026 -2) :
--  - toute recette encaissée par le système (paiement en ligne compris) est enregistrée et sécurisée : CGI art. 286-I-3° bis ;
--    BOI-TVA-DECLA-30-10-30 (version du 25/03/2026) § 30, § 35 (aucune dispense dès qu'une partie
--    des ventes est payée autrement que par un établissement de crédit), § 37 (exemple 3 : paiement en ligne proposé en boutique
--    à côté d'autres modes — pas de dispense pour ces paiements ; citation corrigée le 28/10/2026 -4), § 40, § 50 ;
--  - TVA des prestations de services exigible à l'encaissement, acomptes compris : CGI art. 269-2-c ; BOI-TVA-BASE-20-20 § 30, § 70 ;
--  - acomptes sur livraisons de biens : TVA exigible à l'encaissement, à concurrence du montant encaissé, depuis le 1/1/2023
--    (loi n° 2021-1900 du 30/12/2021, art. 30) : CGI art. 269-2-a ; BOI-TVA-BASE-20-10 (version du 21/12/2022) § 10, § 65 ;
--  - bons : CGI art. 256 ter ; BOI-TVA-CHAMP-10-10-40-50 (version du 14/02/2024) § 40, § 60-90 ; BOI-TVA-BASE-20-40 § 270-293 ;
--  - remboursement / annulation : opération « en moins », document rectificatif référençant l'original : CGI art. 272-1 ;
--    BOI-TVA-DED-40-10-20 § 1, § 30, § 60-80 ; BOI-TVA-DECLA-30-10-30 § 90.
--
-- CONCEPTION (la chaîne de scellement est celle de tous les tickets, AUCUN format modifié) :
--  - le serveur INSÈRE dans public.tickets : numéro, chaînage (hash_prev) et empreinte SHA-256 par le déclencheur existant
--    ticket_nf525_insert (verrou pg_advisory_xact_lock par établissement, format num|date|heure|ttc|ht|items|prev|salon) ;
--    refus d'une journée clôturée par tickets_block_post_cloture ; mode test / réel posé par nf525_marquer_mode ; sceau
--    nf525_hash_seal par _nf525_seal_row ; signature ES256 « TK » par la fonction nf525-sign (tâche planifiée existante, qui
--    détecte tout ticket non signé : lx_prive.nf525_signature_en_attente) ;
--  - le même enregistrement est recopié dans public.appointments (même identifiant que raw_data.id), exactement comme
--    l'application le fait pour chacun de ses tickets (saveAppointment + saveTicketToDb) : planning, Z de l'application,
--    exports (FEC, Excel, ZIP, rapport, livre des recettes, URSSAF, EBP, Quadratus, envoi au comptable) le lisent déjà ;
--  - n° imprimé (raw_data.tkNum, appointments.ticket_num) : suite de la numérotation imprimée de l'établissement, calculée
--    sous le même verrou (max des n° imprimés des tickets et des rendez-vous + 1) ;
--  - le ticket est daté du jour (heure de Paris) où il est créé ; journée déjà clôturée (Z faite) -> le ticket attend dans
--    public.recettes_en_ligne et la tâche de rattrapage le crée le lendemain (jamais antidaté), date de règlement conservée
--    (raw_data.datePaiement), comme le faisait l'application ;
--  - DÉCLENCHEMENT : déclencheurs BEFORE UPDATE (nommés « zz_… » : exécutés après les déclencheurs existants) sur
--    rdv_online, commandes_online, cartes_cadeaux, cartes_abo_clients : le ticket est créé DANS LA MÊME TRANSACTION que
--    l'enregistrement du paiement (webhook Stripe, retour de page, capture d'empreinte, remboursement) — quel que soit le
--    chemin (worker, edge function, application), et sans attendre l'ouverture de l'application. Toute erreur est
--    rattrapée : l'enregistrement du paiement n'échoue JAMAIS à cause du ticket (file + tâche de rattrapage + alerte) ;
--  - idempotence : clé unique par événement (raw_data.recetteKey, index unique) + clés historiques de l'application
--    (raw_data.acompteKey, raw_data.retenueKey, index uniques existants) : jamais deux tickets pour un même paiement, y
--    compris avec une ancienne version de l'application encore ouverte sur un appareil.
--
-- TRAITEMENTS (CA = chiffre d'affaires ; « en ligne » = poste de règlement enligne, compte 580100 dans le FEC) :
--  acompte RDV (nouveau modèle)  : ticket « Acompte en ligne » au paiement, TVA prestations ; remboursement = ticket négatif
--  remboursement d'acompte       : un ticket négatif par entrée de rdv_online.remboursements (clé = refund_id)
--  acompte conservé (ancien mod.): ticket « Acompte conservé » à la décision (retenue_at), montant conservé
--  empreinte capturée            : ticket « Empreinte encaissée », montant RÉELLEMENT PRÉLEVÉ (empreinte_captured_amount)
--  bon cadeau vendu en ligne     : modèle bons v2 actif : BUU -> TVA à la vente (taux du bon) ; BUM -> ticket hors champ
--                                  (HT = TTC, TVA 0, taux 0 : TVA à l'utilisation) ; modèle inactif / bon sans qualification ->
--                                  traitement historique de l'application (vente comptée en CA, TVA au taux des prestations,
--                                  déduction à l'utilisation) : TVA déclarée au plus tôt, jamais omise
--  carte d'abonnement            : ticket au paiement, TVA prestations (droit à remise pendant la durée de la carte : prestation
--                                  de services payée d'avance) ; aucune re-taxation à l'usage (la remise réduit le prix taxé)
--  Click & Collect payé en ligne : ticket au paiement (lignes produits, TVA par taux) ; remise au client : AUCUN ticket ;
--                                  annulation remboursée : ticket négatif inverse (mêmes HT / TVA, au centime)
--  remboursement fait hors Luxyra: (tableau de bord Stripe) public.lx_recette_remboursement_externe, appelée par le worker
--                                  sur l'évènement charge.refunded : ticket négatif (ou entrée de remboursement d'acompte)
--
-- CE QUE CE SQL NE FAIT PAS : aucun ticket, clôture, signature, JET existant n'est modifié ; ticket_nf525_insert,
-- tickets_block_post_cloture, nf525_marquer_mode, _nf525_seal_row, nf525-sign : INCHANGÉS. clotures_controle_journal : verrou
-- (-3) et contrôle des journées retenues (-5) ajoutés ; cloturer_mois / _annee / _exercice et leurs tâches : contrôle des
-- journées retenues ajouté (-5), calculs et empreintes inchangés.
-- =====================================================================================================================

begin;

-- ===================================================================================================================== §0
-- Garde : les fonctions de la chaîne de scellement doivent être celles relues le 28/10/2026 (sinon : relire avant d'appliquer)
-- 2026-10-28 (-4, contre-audit constat 6) : comparaison des empreintes md5 COMPLÈTES des définitions relevées en production le
-- 28/10/2026. Méthode (identique pour le relevé et pour ce contrôle) : md5(pg_get_functiondef(oid)) — texte complet rendu par
-- PostgreSQL 17 (en-tête RETURNS / LANGUAGE / SECURITY / SET search_path + corps entre $function$), relu en lecture seule dans
-- l'éditeur SQL du tableau de bord le 28/10/2026 (7 valeurs retrouvées à l'identique) et recalculé sur PostgreSQL 17.6 à partir
-- des définitions recopiées (/tmp/pgreal/md5chk.cjs : 14/14 identiques). Toute différence (même un commentaire) arrête le script.
-- 2026-10-28 (-5) : garde étendue aux fonctions de clôture périodique remplacées par ce SQL (§11) et à leurs tâches. Valeurs
-- acceptées par fonction : empreinte de PRODUCTION relevée le 28/10/2026 (lecture seule, éditeur SQL : md5(pg_get_functiondef))
-- OU empreinte de la définition posée par CE fichier (seconde exécution). cloturer_mois : seule la version posée par
-- docs/migrations_1027/bons_cadeaux_tva.sql (prérequis OBLIGATOIRE, empreinte calculée sur PostgreSQL 17.6) est acceptée.
-- Recalcul des empreintes « ce fichier » : /tmp/pgreal/md5_nouveaux.cjs (embedded-postgres 17.6).
do $$
declare
  v_attendu constant jsonb := jsonb_build_object(
    'public.ticket_nf525_insert()',            jsonb_build_array('3219a36f2892dfb5287aa258e7afb0fa'),
    'public.tickets_block_post_cloture()',     jsonb_build_array('59714d7eaadabdfab295f52e23376950'),
    'public.nf525_marquer_mode()',             jsonb_build_array('8b26e30b07f5957ad64126208a241eaa'),
    'public._nf525_seal_row()',                jsonb_build_array('d9a16f5a25ceda362a3bde86e8b22c84'),
    'public.appointments_nf525_protect()',     jsonb_build_array('ac1d644f6672a78c805845de2c386009'),
    'lx_prive.tickets_retour_controle()',      jsonb_build_array('e10116728f108070fb8dd710cd5f66eb'),
    'lx_prive.clotures_controle_journal()',    jsonb_build_array('3688061418cabdbaa209134689196361', 'f60dd43a409593d75f31f229ae4e0994'),
    'public.cloturer_mois(uuid,integer,integer)', jsonb_build_array('6bc6c186c012501fcea1380e86b5e853', '10fb2481b3ece62961d0a014f26a9d92'),
    'public.run_cloture_mensuelle_pour_tous()',  jsonb_build_array('68b020ba8012a2bf412327d2428450f3', '11feddf48ee998950610064242c92fc1'),
    'public.cloturer_annee(uuid,integer)',       jsonb_build_array('1bcf301bca958cd8936cbbd6236479e6', '76636cd247de920d3f696f6aa0ca0b00'),
    'public.run_cloture_annuelle_pour_tous()',   jsonb_build_array('9f148f33c69b975eabfe74d240220f58', '25cae68979fdde09ddefc42c611674ab'),
    'public.cloturer_exercice(uuid,date)',       jsonb_build_array('6b2ba5edb7e47b9427d4b541c786608d', '9c30504431a8026729e6266b907bcd70'),
    'public.run_cloture_exercice_pour_tous()',   jsonb_build_array('1050b00baa4feee0300990aea7312409', 'a454d21e8ec86c5fed83a0de1b886c13'),
    'public.lx_fin_exercice(integer,integer)',   jsonb_build_array('5343f54c7f811af98672e25778065d23'));
  k text; v_md5 text;
begin
  for k in select jsonb_object_keys(v_attendu) loop
    if to_regprocedure(k) is null then
      raise exception 'Garde 28/10/2026 : fonction % absente en base — relire avant d''appliquer', k;
    end if;
    v_md5 := md5(pg_get_functiondef(to_regprocedure(k)));
    if not (v_attendu->k) ? v_md5 then
      raise exception 'Garde 28/10/2026 : % différente de la version relue en production (md5 %, attendu %) — relire avant d''appliquer%', k, v_md5, v_attendu->k,
        case when k = 'public.cloturer_mois(uuid,integer,integer)' then ' (prérequis : docs/migrations_1027/bons_cadeaux_tva.sql appliqué AVANT ce fichier)' else '' end;
    end if;
  end loop;
  if to_regprocedure('auth.role()') is null then raise exception 'auth.role() absente'; end if;
  -- tâches planifiées de clôture périodique : celles relevées en production (ou posées par ce fichier)
  if (select count(*) from cron.job where jobname in ('cloture_mensuelle_auto', 'cloture_annuelle_auto', 'cloture_exercice_auto')) <> 3 then
    raise exception 'Garde 28/10/2026 : tâches cloture_mensuelle_auto / cloture_annuelle_auto / cloture_exercice_auto attendues — relire avant d''appliquer';
  end if;
end $$;

-- ===================================================================================================================== §1
-- Colonnes (aucune donnée existante modifiée)
alter table public.rdv_online        add column if not exists empreinte_captured_amount numeric;
comment on column public.rdv_online.empreinte_captured_amount is 'Montant RÉELLEMENT prélevé à la capture de l''empreinte (Stripe amount_received / 100). NULL = capture antérieure au 28/10/2026 (montant = empreinte_amount).';
alter table public.commandes_online  add column if not exists recette_tk_num integer;
alter table public.commandes_online  add column if not exists recette_remb_tk_num integer;
comment on column public.commandes_online.recette_tk_num is 'N° imprimé du ticket scellé créé par le serveur au paiement en ligne (Click & Collect). Remise au client : aucun nouveau ticket.';
comment on column public.commandes_online.recette_remb_tk_num is 'N° imprimé du ticket négatif (annulation remboursée).';
alter table public.cartes_abo_clients add column if not exists recette_tk_num integer;
alter table public.cartes_abo_clients add column if not exists montant_paye numeric;
alter table public.cartes_abo_clients add column if not exists payment_intent_id text;
comment on column public.cartes_abo_clients.recette_tk_num is 'N° imprimé du ticket scellé créé par le serveur au paiement en ligne de la carte.';
-- 2026-10-28 (-3) : date du paiement CHEZ STRIPE (évènement / paiement), posée par l'edge function ; la reprise de secours
-- (tâche de rattrapage) la reprend comme date de règlement au lieu de l'heure de la reprise.
alter table public.cartes_cadeaux     add column if not exists paye_at timestamptz;
alter table public.cartes_abo_clients add column if not exists paye_at timestamptz;
comment on column public.cartes_cadeaux.paye_at is 'Date du paiement en ligne chez Stripe (vente en ligne). NULL = bon vendu en caisse ou antérieur au 28/10/2026.';
comment on column public.cartes_abo_clients.paye_at is 'Date du paiement en ligne chez Stripe (carte payée en ligne).';

-- ===================================================================================================================== §2
-- File / trace des recettes en ligne (hors périmètre de scellement : le ticket, lui, est scellé)
create table if not exists public.recettes_en_ligne (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null,
  source text not null check (source in ('acompte','acompte_remb','retenue','empreinte','bon_cadeau','carte_abo','click_collect','click_collect_annul','remb_externe')),
  objet_id uuid not null,
  cle text not null,
  montant numeric not null,
  paye_at timestamptz,
  payment_intent text,
  refund_id text,
  details jsonb not null default '{}'::jsonb,
  statut text not null default 'a_ticketer' check (statut in ('a_ticketer','tickete','ignore','attente_activation')),
  ticket_id uuid,
  ticket_num integer,
  tk_num integer,
  date_ticket date,
  essais integer not null default 0,
  derniere_erreur text,
  created_at timestamptz not null default now(),
  traite_at timestamptz,
  constraint recettes_en_ligne_cle_unique unique (salon_id, cle)
);
-- 2026-10-28 (-5) : statut « attente_activation » (remboursement Stripe reçu avant la toute première activation : ticket créé à
-- l'activation, jamais avant — voir lx_recette_remboursement_externe). Idempotent pour une seconde exécution.
alter table public.recettes_en_ligne drop constraint if exists recettes_en_ligne_statut_check;
alter table public.recettes_en_ligne add constraint recettes_en_ligne_statut_check check (statut in ('a_ticketer','tickete','ignore','attente_activation'));
create index if not exists recettes_en_ligne_attente on public.recettes_en_ligne (created_at) where statut = 'a_ticketer';
create index if not exists recettes_en_ligne_pi on public.recettes_en_ligne (payment_intent) where payment_intent is not null;
alter table public.recettes_en_ligne enable row level security;
drop policy if exists recettes_en_ligne_lecture on public.recettes_en_ligne;
create policy recettes_en_ligne_lecture on public.recettes_en_ligne for select to authenticated
  using (exists (select 1 from public.salons s where s.id = recettes_en_ligne.salon_id and s.user_id = auth.uid()) or public.is_admin());
revoke all on public.recettes_en_ligne from anon, authenticated;
grant select on public.recettes_en_ligne to authenticated;
grant select, insert, update, delete on public.recettes_en_ligne to service_role;

-- Clé d'idempotence générique des tickets serveur (en plus de acompteKey / retenueKey existantes)
create unique index if not exists tickets_recette_key_unique on public.tickets (salon_id, (raw_data->>'recetteKey')) where raw_data ? 'recetteKey';
-- 2026-10-28 (-3, constat BLOQUANT de l'audit : n° imprimés en double) : les tickets créés par le serveur ont leur PROPRE série
-- de n° imprimés (poste « Serveur (paiements en ligne) » : 900001, 900002, … par établissement), qui ne croise jamais la
-- série des appareils (n° imprimés actuels : 2197 au maximum en base le 28/10/2026). Unicité garantie par cet index, qui ne
-- porte QUE sur les tickets serveur (aucun ticket existant concerné : les doublons historiques des appareils — 1 cas relevé
-- en base le 28/10/2026 — ne gênent pas sa création). Le n° légal (num) reste unique et continu pour TOUS les tickets.
create unique index if not exists tickets_tknum_serveur_unique on public.tickets (salon_id, (raw_data->>'tkNum')) where raw_data->>'serveur' = 'true';
-- Index de la reprise de secours (filet sans date de départ : lectures ciblées, pas de balayage des tables)
create index if not exists rdv_online_filet_acompte on public.rdv_online (created_at) where acompte_modele = 'ticket' and acompte_paye and acompte_tk_num is null;
create index if not exists rdv_online_filet_retenue on public.rdv_online (created_at) where retenue_at is not null and retenue_tk_num is null;
create index if not exists rdv_online_filet_empreinte on public.rdv_online (created_at) where empreinte_status = 'captured' and empreinte_tk_num is null;
create index if not exists rdv_online_pi on public.rdv_online (payment_intent_id) where payment_intent_id is not null;
create index if not exists commandes_online_filet on public.commandes_online (created_at) where paye and recette_tk_num is null;
create index if not exists commandes_online_pi on public.commandes_online (payment_intent_id) where payment_intent_id is not null;

-- ===================================================================================================================== §3
-- Outils
create or replace function lx_prive.recettes_serveur_actif()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select (config->>'recettes_en_ligne_serveur')::boolean from public.app_config where id = 1), false)
$$;
-- 2026-10-28 (-5) : l'interrupteur a-t-il déjà été allumé (date d'activation conservée par recettes_desactiver) ? Tant que non,
-- AUCUN ticket ne peut être créé par le serveur (étapes 1 à 5 du déploiement) ; ensuite, l'application 6.8.3 reprend les copies
-- des tickets du serveur même interrupteur éteint (lxRecettesServeurReprise).
create or replace function lx_prive.recettes_serveur_deja_active()
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce((select config ? 'recettes_en_ligne_serveur_depuis' from public.app_config where id = 1), false)
$$;
-- Arrondi au centime IDENTIQUE à l'application (Math.round(x*100)/100 : demi vers +infini)
create or replace function lx_prive.r2(x numeric)
returns numeric language sql immutable as $$ select floor(coalesce(x,0) * 100 + 0.5) / 100 $$;
create or replace function lx_prive.date_fr(d date)
returns text language sql immutable as $$ select to_char(d, 'DD/MM/YYYY') $$;

-- 2026-10-28 (-3, constat MAJEUR 2) : l'écriture vient-elle du SERVEUR ? Sous Supabase, PostgREST pose le rôle du jeton
-- (request.jwt.claims -> role, lu par auth.role()) pour CHAQUE requête : 'anon' (site public), 'authenticated' (application
-- d'un établissement), 'service_role' (worker, edge functions). Les tâches planifiées, l'éditeur SQL et les fonctions appelées
-- sans jeton n'ont pas de rôle (NULL). current_user / session_user ne conviennent pas : dans une fonction SECURITY DEFINER,
-- current_user est le propriétaire, et session_user vaut 'authenticator' pour tous les appels PostgREST. Le réglage
-- request.jwt.claims n'est pas modifiable par un client (PostgREST le pose lui-même, set_config n'est pas exposé). Même règle
-- que les gardes existantes (rdv_online_insert_public_propre, appointments_nf525_protect).
create or replace function lx_prive.appel_serveur()
returns boolean language sql stable set search_path = public, pg_temp as $$
  select coalesce((select auth.role()), '') not in ('anon', 'authenticated')
$$;
-- Version « a.b.c » -> nombre comparable (6.8.1 -> 6008001) ; illisible -> 0
create or replace function lx_prive.version_num(v text)
returns bigint language sql immutable as $$
  select case when coalesce(v, '') ~ '^[0-9]{1,3}\.[0-9]{1,3}(\.[0-9]{1,3})?$'
    then split_part(v, '.', 1)::bigint * 1000000 + split_part(v, '.', 2)::bigint * 1000 + coalesce(nullif(split_part(v, '.', 3), ''), '0')::bigint
    else 0 end
$$;
-- Version minimale de l'application acceptée pour enregistrer un ticket une fois l'interrupteur allumé
-- (app_config.config.recettes_en_ligne_version_min). 2026-10-28 (-4) : défaut 6.8.2 (première version qui ne laisse jamais
-- un ticket encaissé sortir de sa file de secours : report sur la journée ouverte) si la clé est absente. MISE EN SERVICE :
-- la clé est posée à '0' (neutre : version_num('0') = 0, aucun refus) à l'activation, puis relevée à '6.8.2' quand tous les
-- postes actifs ont remonté 6.8.2 (requête de contrôle : registre NF525, intervention -4).
-- 2026-10-28 (-5) : défaut 6.8.3 (date réelle d'une vente reportée scellée dans le ticket, refus de clôture des journées
-- retenues compris par l'application, forçage tracé) ; même procédure (activation à '0', relevé à '6.8.3').
create or replace function lx_prive.recettes_version_min()
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(nullif((select config->>'recettes_en_ligne_version_min' from public.app_config where id = 1), ''), '6.8.3')
$$;
-- Début de la série des n° imprimés du serveur (n° 900001, 900002, … par établissement)
create or replace function lx_prive.recette_serie_base()
returns integer language sql immutable as $$ select 900000 $$;
-- Refund Stripe valide (re_… ; pyr_… pour certains moyens de paiement)
create or replace function lx_prive.refund_valide(p text)
returns boolean language sql immutable as $$ select coalesce(p, '') ~ '^(re|pyr)_[A-Za-z0-9]+$' $$;

-- Poste de caisse « Serveur (paiements en ligne) » : enregistré une fois par établissement (nf525_postes + JET 126, comme
-- l'enregistrement d'un appareil par public.nf525_poste). Caisse logique C01 inchangée dans les données signées.
create or replace function lx_prive.recette_poste(p_salon uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare v_code text; v_n int;
begin
  select code into v_code from public.nf525_postes where salon_id = p_salon and device_id = 'serveur-paiements-en-ligne';
  if v_code is not null then return v_code; end if;
  perform pg_advisory_xact_lock(hashtext('nf525_poste_' || p_salon::text));
  select code into v_code from public.nf525_postes where salon_id = p_salon and device_id = 'serveur-paiements-en-ligne';
  if v_code is not null then return v_code; end if;
  select count(*) into v_n from public.nf525_postes where salon_id = p_salon;
  v_code := 'P' || lpad((v_n + 1)::text, 2, '0');
  insert into public.nf525_postes(salon_id, device_id, code, libelle) values (p_salon, 'serveur-paiements-en-ligne', v_code, 'Serveur (paiements en ligne)');
  perform public.nf525_jet_ajouter(p_salon, 126, 'Ajout du poste ' || v_code || ' (Serveur - paiements en ligne) sur la caisse C01', 'Serveur Luxyra');
  return v_code;
end $$;

-- HT / TVA d'un ticket serveur : MÊMES règles que saveTicketToDb (luxyra-supabase.js) :
--  - taux d'une ligne = taux propre (tvaTaux, hors franchise) sinon produits (isProd) sinon prestations ;
--  - un seul taux -> HT = arrondi(TTC / (1 + t)) ; plusieurs -> TTC réparti par taux (dernier = reste), HT par taux ;
--    ordre des taux = ordre de Object.keys (clés entières croissantes, puis ordre d'apparition) ;
--  - ligne de bon à usage multiple (isBon + bonUsage BUM) : hors CA, HT = TTC, TVA 0 ; ticket de BUM seul -> taux 0.
create or replace function lx_prive.recette_ht_tva(p_salon uuid, p_items jsonb, p_ttc numeric)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_s numeric; v_p numeric; v_hc numeric := 0; v_ca numeric; v_ht numeric := 0; v_tva numeric; v_reste numeric; v_somme numeric := 0;
  r record; v_n int := 0; v_i int := 0; v_ttcr numeric; v_taux_col numeric; v_t1 numeric;
begin
  select coalesce(taux_tva, 20), coalesce(taux_tva_produits, coalesce(taux_tva, 20)) into v_s, v_p from public.salons where id = p_salon;
  v_s := coalesce(v_s, 20); v_p := coalesce(v_p, v_s); if v_s = 0 then v_p := 0; end if;
  -- lignes : montant, ligne de BUM (hors CA), taux de la ligne
  select coalesce(sum(m) filter (where bum), 0), coalesce(sum(m) filter (where not bum), 0), count(distinct t) filter (where not bum), min(t) filter (where not bum)
    into v_hc, v_somme, v_n, v_t1
    from (select coalesce((e.value->>'price')::numeric,0) * coalesce(nullif(e.value->>'qty','')::numeric,1) - coalesce((e.value->>'remise')::numeric,0) m,
                 (coalesce((e.value->>'isBon')::boolean,false) and e.value->>'bonUsage' = 'BUM') bum,
                 case when v_s > 0 and (e.value->>'tvaTaux') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.value->>'tvaTaux')::numeric
                      when coalesce((e.value->>'isProd')::boolean,false) then v_p else v_s end t
            from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) e where not coalesce((e.value->>'isSep')::boolean,false)) l;
  v_hc := lx_prive.r2(v_hc);
  v_ca := lx_prive.r2(coalesce(p_ttc, 0) - v_hc);
  if v_n = 0 then
    v_ht := case when v_s = 0 then v_ca else lx_prive.r2(v_ca / (1 + v_s / 100)) end;
  elsif v_n = 1 then
    v_ht := lx_prive.r2(v_ca / (1 + v_t1 / 100));
  else
    v_reste := v_ca;
    for r in
      select t, trim_scale(t)::text k, sum(m) amt, min(pos) pos from (
        select e.ordinality pos, coalesce((e.value->>'price')::numeric,0) * coalesce(nullif(e.value->>'qty','')::numeric,1) - coalesce((e.value->>'remise')::numeric,0) m,
               case when v_s > 0 and (e.value->>'tvaTaux') ~ '^-?[0-9]+(\.[0-9]+)?$' then (e.value->>'tvaTaux')::numeric
                    when coalesce((e.value->>'isProd')::boolean,false) then v_p else v_s end t
          from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) with ordinality e
         where not coalesce((e.value->>'isSep')::boolean,false) and not (coalesce((e.value->>'isBon')::boolean,false) and e.value->>'bonUsage' = 'BUM')) l
      group by t order by (trim_scale(t)::text ~ '^[0-9]+$') desc, case when trim_scale(t)::text ~ '^[0-9]+$' then t end, min(pos)
    loop
      v_i := v_i + 1;
      v_ttcr := case when v_i = v_n then v_reste else lx_prive.r2(case when abs(v_somme) > 0.004 then r.amt / v_somme * v_ca else 0 end) end;
      v_reste := lx_prive.r2(v_reste - v_ttcr);
      v_ht := v_ht + lx_prive.r2(v_ttcr / (1 + r.t / 100));
    end loop;
    v_ht := lx_prive.r2(v_ht);
  end if;
  v_ht := lx_prive.r2(v_ht + v_hc);
  v_tva := lx_prive.r2(coalesce(p_ttc, 0) - v_ht);
  v_taux_col := case when abs(v_hc) > 0.004 and abs(v_ca) < 0.005 then 0 else v_s end;
  return jsonb_build_object('ht', v_ht, 'tva', v_tva, 'taux', v_taux_col, 'horsCa', v_hc);
end $$;

-- Fiche client de l'établissement liée à un compte Luxyra (une seule, non fusionnée) ; sinon NULL (« passage »)
create or replace function lx_prive.recette_client(p_salon uuid, p_luxyra uuid)
returns uuid language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v uuid; v_n int;
begin
  if p_luxyra is null then return null; end if;
  begin
    select count(*), min(id::text)::uuid into v_n, v from public.clients where salon_id = p_salon and client_luxyra_id = p_luxyra and fusionne_dans is null;
  exception when others then return null; end;
  return case when v_n = 1 then v else null end;
end $$;

-- ===================================================================================================================== §4
-- CŒUR : insertion d'un ticket serveur (tickets + appointments). Retourne {ticket_id, num, tk_num, date, hash, deja}.
-- p_cles : clés d'idempotence à poser dans raw_data (recetteKey toujours ; acompteKey / retenueKey pour la compatibilité
-- avec l'application). Lève LX_JOUR_CLOS si la journée du jour (Paris) est déjà clôturée.
create or replace function lx_prive.recette_tk_inserer(
  p_salon uuid, p_cles jsonb, p_items jsonb, p_ttc numeric, p_client uuid, p_client_nom text, p_client_prenom text,
  p_collab integer, p_sid integer, p_comment text, p_extra jsonb, p_ht_tva jsonb default null)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_now timestamptz := clock_timestamp(); v_date date; v_heure time; v_hm text; v_tk int; v_id uuid := gen_random_uuid();
  v_t record; v_calc jsonb; v_raw jsonb; v_meta jsonb; v_pay jsonb; v_poste text; v_coll_nom text; v_coll int; k text; v_dreel date;
  v_meta_cles text[] := array['operator_name','poste','ts','clientNom','clientPrenom','isAcompte','isAcompteCancel','apptId','isRetenue',
    'retenueKey','retenueRdv','origTkNum','origTkNums','dbNum','isAcompteEnLigne','acompteKey','acompteRdv','datePaiement',
    'dateRemboursement','refundId','serveur','recetteKey','recetteType','ccCommandeId','ccNumero','bonCode','bonId','carteAboId','recetteRef'];
begin
  perform pg_advisory_xact_lock(hashtext(p_salon::text)); -- même verrou que ticket_nf525_insert (réentrant dans la transaction)
  -- idempotence : ticket déjà créé pour cet évènement (serveur ou application)
  for k in select jsonb_object_keys(p_cles) loop
    select id, num, date_ticket, hash, (raw_data->>'tkNum') tkn into v_t from public.tickets
     where salon_id = p_salon and raw_data->>k = p_cles->>k limit 1;
    if found then
      return jsonb_build_object('ticket_id', v_t.id, 'num', v_t.num, 'tk_num', coalesce(nullif(v_t.tkn,'')::int, v_t.num), 'date', v_t.date_ticket, 'hash', v_t.hash, 'deja', true);
    end if;
    -- 2026-10-28 (-3) : ticket créé par un appareil (avant la mise en service) pas encore transmis au journal, mais déjà
    -- enregistré dans appointments (même clé dans meta) -> on attend sa transmission (jamais deux tickets pour un paiement)
    if k in ('acompteKey', 'retenueKey') and exists (select 1 from public.appointments a where a.salon_id = p_salon and a.meta->>k = p_cles->>k
                                                     and coalesce(a.meta->>'serveur', '') <> 'true') then
      raise exception 'LX_ATTENTE : ticket de l''application (%) en cours de transmission', p_cles->>k;
    end if;
  end loop;
  v_date := (v_now at time zone 'Europe/Paris')::date;
  v_heure := date_trunc('second', (v_now at time zone 'Europe/Paris')::time);
  -- LX_REPORT_SCELLE_2026_10_28 (-5) : règlement d'une journée ANTÉRIEURE (journée close, file de rattrapage) -> sa date réelle
  -- est scellée dans les lignes du ticket (items[0].lxRep, couvert par l'empreinte num|date|heure|ttc|ht|items|prev|salon), en
  -- plus de raw_data.datePaiement / dateRemboursement (hors empreinte). Tickets du jour même : lignes inchangées.
  begin v_dreel := nullif(coalesce(p_extra->>'datePaiement', p_extra->>'dateRemboursement'), '')::date; exception when others then v_dreel := null; end;
  if v_dreel is not null and v_dreel < v_date and jsonb_typeof(p_items) = 'array' and jsonb_array_length(p_items) > 0 then
    p_items := jsonb_set(p_items, '{0,lxRep}', jsonb_build_object('v', 1, 'type', case when nullif(p_extra->>'datePaiement', '') is not null then 'paiement' else 'remboursement' end, 'dateVente', v_dreel, 'dateEnr', v_date));
  end if;
  v_hm := to_char(v_heure, 'HH24:MI');
  if exists (select 1 from public.clotures where salon_id = p_salon and date_cloture = v_date) then
    raise exception 'LX_JOUR_CLOS : journée du % déjà clôturée, ticket reporté à la journée suivante', v_date using errcode = 'P0001';
  end if;
  -- 2026-10-28 (-3, constat BLOQUANT) : n° imprimé = série PROPRE du serveur (poste « Serveur (paiements en ligne) ») :
  -- 900001, 900002, … par établissement, continue, calculée sous le verrou de l'établissement et garantie unique par l'index
  -- tickets_tknum_serveur_unique. Elle ne partage AUCUN compteur avec les appareils (qui peuvent numéroter hors ligne) :
  -- aucune collision possible, quelle que soit la version de l'application ou l'état du réseau.
  select greatest(lx_prive.recette_serie_base(),
    coalesce((select max((raw_data->>'tkNum')::int) from public.tickets where salon_id = p_salon and raw_data->>'serveur' = 'true'
                and (raw_data->>'tkNum') ~ '^[0-9]{1,9}$'), 0)) + 1 into v_tk;
  v_calc := coalesce(p_ht_tva, lx_prive.recette_ht_tva(p_salon, p_items, p_ttc));
  v_poste := lx_prive.recette_poste(p_salon);
  select id, nom into v_coll, v_coll_nom from public.collaborateurs where salon_id = p_salon and id = p_collab;
  v_pay := jsonb_build_array(jsonb_build_object('method', 'En ligne (Stripe)', 'amount', p_ttc));
  v_raw := jsonb_build_object('id', v_id, 'cId', coalesce(p_client::text, 'passage'), 'fromCaisse', true, 'sId', p_sid, 'stId', v_coll,
    'date', v_date, 'time', v_hm, 'heureEncaiss', v_hm, 'ts', to_char(v_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'pr', p_ttc, 'brutTotal', p_ttc, 'remise', 0, 'items', p_items, 'st', 'done', 'met', 'En ligne (Stripe)', 'payments', v_pay,
    'tkNum', v_tk, 'clientNom', p_client_nom, 'clientPrenom', p_client_prenom, 'comment', p_comment, 'poste', v_poste,
    'operator_name', 'Paiement en ligne (serveur)', 'serveur', true, 'hashAlgo', 'SHA-256')
    || coalesce(p_extra, '{}'::jsonb) || p_cles;
  v_raw := jsonb_strip_nulls(v_raw);
  -- 2026-10-28 (-3) : marque de l'insertion serveur (réglage local à la transaction, posé uniquement ici ; un client ne peut pas
  -- le poser : PostgREST n'expose pas set_config) — lue par la garde tickets_version_controle (LX_SERVEUR_SEUL)
  perform set_config('lx.recette_insertion', '1', true);
  insert into public.tickets (salon_id, date_ticket, heure_ticket, client_id, client_nom, client_prenom, collaborateur_id, collaborateur_nom,
      items, total_brut, total_remise, total_ttc, total_ht, total_tva, taux_tva, mode_paiement, detail_paiement, status, notes, raw_data)
    values (p_salon, v_date, v_heure, p_client, p_client_nom, p_client_prenom, v_coll, coalesce(v_coll_nom, 'Paiement en ligne'),
      p_items, p_ttc, 0, p_ttc, (v_calc->>'ht')::numeric, (v_calc->>'tva')::numeric, (v_calc->>'taux')::numeric,
      'enligne', jsonb_build_object('enligne', p_ttc), 'paid', p_comment, v_raw)
    returning id, num, hash, hash_prev into v_t;
  perform set_config('lx.recette_insertion', '', true);
  if v_t.num is distinct from v_tk then v_raw := v_raw || jsonb_build_object('dbNum', v_t.num); end if;
  select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) into v_meta from jsonb_each(v_raw) e
   where e.key = any(v_meta_cles) and e.value not in ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '[]'::jsonb);
  -- 2026-10-28 (-3) : la copie dans appointments ne remplit PAS la colonne ticket_num (lue par toutes les versions de
  -- l'application pour calculer leur prochain n°) : le n° de la série serveur est dans meta.tkNumServeur, relu seulement par
  -- l'application 6.8.1 et suivantes (lxMapApptRow). Une ancienne version ne voit donc jamais un n° 9000xx dans sa mémoire.
  v_meta := v_meta || jsonb_build_object('tkNumServeur', v_tk);
  insert into public.appointments (id, salon_id, client_id, service_id, collab_id, date_rdv, heure, prix, brut_total, remise, status,
      mode_paiement, ticket_num, hash, prev_hash, hash_algo, items, comment, a_phases, cancelled, from_caisse, payments, heure_encaissement,
      collab_name, clients, meta)
    values (v_id, p_salon, p_client, p_sid, v_coll, v_date, v_hm, p_ttc, p_ttc, 0, 'done', 'En ligne (Stripe)', null, v_t.hash, coalesce(v_t.hash_prev, ''),
      'SHA-256', p_items, coalesce(p_comment, ''), '[]'::jsonb, false, true, v_pay, v_hm, v_coll_nom, '[]'::jsonb, v_meta);
  return jsonb_build_object('ticket_id', v_t.id, 'num', v_t.num, 'tk_num', v_tk, 'date', v_date, 'hash', v_t.hash, 'deja', false);
end $$;

-- ===================================================================================================================== §5
-- Construction et création du ticket d'un évènement de la file. p_row = ligne source (to_jsonb, valeurs À JOUR).
-- Retourne {ok, tk_num, ...} ou {ok:false, erreur}. Ne lève jamais d'exception (tout est tracé dans la file).
create or replace function lx_prive.recette_traiter(p_q public.recettes_en_ligne, p_row jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_res jsonb; v_items jsonb; v_cles jsonb; v_extra jsonb := '{}'::jsonb; v_comment text; v_lib text; v_m numeric := p_q.montant;
  v_quand text; v_svc text; v_cli text; v_client uuid; v_dpaie date; v_orig int; v_bon jsonb; v_usage text; v_scope text; v_tb numeric;
  v_s numeric; v_p numeric; v_httva jsonb := null; v_src record; v_it jsonb; v_lignes jsonb := '[]'::jsonb; v_err text;
begin
  if p_q.statut = 'tickete' then return jsonb_build_object('ok', true, 'tk_num', p_q.tk_num, 'deja', true); end if;
  v_dpaie := (coalesce(p_q.paye_at, now()) at time zone 'Europe/Paris')::date;
  begin
    if p_q.source in ('acompte','acompte_remb','retenue','empreinte') then
      v_quand := lx_prive.date_fr((p_row->>'date_rdv')::date) || coalesce(' ' || left(p_row->>'heure_rdv', 5), '');
      v_svc := coalesce(nullif(p_row->>'service_nom',''), 'Prestation');
      v_cli := trim(coalesce(p_row->>'client_prenom','') || ' ' || coalesce(p_row->>'client_nom',''));
      v_client := lx_prive.recette_client(p_q.salon_id, nullif(p_row->>'client_luxyra_id','')::uuid);
    end if;
    if p_q.source = 'acompte' then
      v_lib := 'Acompte en ligne - ' || v_svc || ' (RDV du ' || v_quand || ', payé le ' || lx_prive.date_fr(v_dpaie) || ')';
      v_items := jsonb_build_array(jsonb_build_object('name', v_lib, 'price', v_m, 'qty', 1, 'remise', 0, 'ci', 0, 'isAcompte', true, 'isAcompteEnLigne', true));
      v_cles := jsonb_build_object('recetteKey', p_q.cle, 'acompteKey', 'acompte:' || p_q.objet_id);
      v_extra := jsonb_build_object('isAcompte', true, 'isAcompteEnLigne', true, 'acompteRdv', p_q.objet_id, 'apptId', 'online_' || p_q.objet_id,
        'datePaiement', v_dpaie, 'recetteType', 'acompte');
      v_comment := 'Acompte payé en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe) pour le RDV du ' || v_quand || ' - ' || v_cli;
    elsif p_q.source = 'acompte_remb' then
      v_orig := nullif(p_row->>'acompte_tk_num','')::int;
      if v_orig is null then raise exception 'LX_ATTENTE : ticket d''acompte pas encore créé'; end if;
      -- 2026-10-28 (-3, constat MAJEUR 2) : remboursement réel uniquement (refund Stripe re_…), cumul plafonné à l'acompte encaissé
      if not lx_prive.refund_valide(p_q.refund_id) then
        raise exception 'LX_REFUS : remboursement d''acompte sans identifiant de remboursement Stripe valide (%)', coalesce(p_q.refund_id, 'aucun');
      end if;
      declare v_deja numeric; v_enc numeric := coalesce(nullif(p_row->>'acompte_montant','')::numeric, 0);
      begin
        select coalesce(sum(-t.total_ttc), 0) into v_deja from public.tickets t
         where t.salon_id = p_q.salon_id and t.raw_data->>'acompteRdv' = p_q.objet_id::text and t.raw_data->>'isAcompteCancel' = 'true' and t.status <> 'cancelled';
        if lx_prive.r2(v_enc - v_deja) <= 0.004 then raise exception 'LX_REFUS : acompte déjà entièrement remboursé en caisse (% EUR)', v_deja; end if;
        if v_m > lx_prive.r2(v_enc - v_deja) + 0.004 then
          v_m := lx_prive.r2(v_enc - v_deja);
          begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Remboursement d''acompte plafonné au reste encaissé', p_severity := 'warning',
            p_context := jsonb_build_object('recette', p_q.id, 'demande', p_q.montant, 'retenu', v_m)); exception when others then null; end;
        end if;
      end;
      v_lib := 'Remboursement acompte en ligne (ticket #' || v_orig || ') - ' || v_svc || ' (RDV du ' || v_quand || ', remboursé le '
        || lx_prive.date_fr(v_dpaie) || ', ' || case p_q.details->>'par' when 'etablissement' then 'par l’établissement' when 'politique' then 'politique d’annulation'
           when 'trop_percu' then 'trop-perçu rendu avant l’encaissement' when 'externe' then 'remboursement fait sur Stripe' else 'annulation' end || ')';
      v_items := jsonb_build_array(jsonb_build_object('name', v_lib, 'price', -v_m, 'qty', 1, 'remise', 0, 'ci', 0, 'isAcompteCancel', true,
        'isAcompteEnLigne', true, 'origTkNum', v_orig, 'origTkNums', jsonb_build_array(v_orig)));
      v_cles := jsonb_build_object('recetteKey', p_q.cle, 'acompteKey', 'rembacompte:' || p_q.objet_id || ':' || coalesce(p_q.refund_id, p_q.details->>'at'));
      v_extra := jsonb_build_object('isAcompteCancel', true, 'isAcompteEnLigne', true, 'origTkNum', v_orig, 'origTkNums', jsonb_build_array(v_orig),
        'acompteRdv', p_q.objet_id, 'apptId', 'online_' || p_q.objet_id, 'dateRemboursement', v_dpaie, 'refundId', p_q.refund_id, 'recetteType', 'acompte_remb');
      v_comment := 'Remboursement Stripe du ' || lx_prive.date_fr(v_dpaie) || ' de l’acompte en ligne (ticket #' || v_orig || ') - RDV du ' || v_quand || ' - ' || v_cli;
      v_m := -v_m;
    elsif p_q.source in ('retenue','empreinte') then
      v_lib := case when p_q.source = 'retenue'
        then 'Acompte conservé - ' || v_svc || ' (RDV du ' || v_quand || ', ' || case p_row->>'cancelled_by' when 'no_show' then 'client absent' when 'client' then 'annulation hors délai' else 'conditions d’annulation' end || ')'
        else 'Empreinte encaissée - ' || v_svc || ' (RDV du ' || v_quand || ', client absent)' end;
      v_items := jsonb_build_array(jsonb_build_object('name', v_lib, 'price', v_m, 'qty', 1, 'remise', 0, 'ci', 0, 'isRetenue', true));
      -- 2026-10-28 (-3) : MÊME clé que l'application (_lxRetenueTicket : « acompte:<rdv> » / « empreinte:<rdv> ») : un ticket
      -- d'acompte conservé / d'empreinte créé par un appareil avant la mise en service n'est jamais refait par le serveur.
      v_cles := jsonb_build_object('recetteKey', p_q.cle, 'retenueKey', case when p_q.source = 'retenue' then 'acompte' else 'empreinte' end || ':' || p_q.objet_id);
      v_extra := jsonb_build_object('isRetenue', true, 'retenueRdv', p_q.objet_id, 'datePaiement', v_dpaie, 'recetteType', p_q.source);
      v_comment := case when p_q.source = 'retenue' then 'Acompte payé en ligne et conservé' else 'Empreinte bancaire capturée' end || ' - RDV du ' || v_quand || ' - ' || v_cli;
    elsif p_q.source = 'bon_cadeau' then
      v_usage := nullif(p_row->>'usage_tva', ''); v_bon := p_row->'qualif_tva'; v_scope := coalesce(nullif(p_row->>'scope',''), 'tout');
      select coalesce(taux_tva, 20), coalesce(taux_tva_produits, coalesce(taux_tva, 20)) into v_s, v_p from public.salons where id = p_q.salon_id;
      if v_s = 0 then v_p := 0; end if;
      v_it := jsonb_build_object('sId', null, 'name', 'Bon cadeau ' || coalesce(p_row->>'code','') || ' (vente en ligne)', 'price', v_m, 'qty', 1, 'remise', 0, 'isBon', true, 'bonCode', p_row->>'code');
      if v_usage = 'BUM' then
        v_it := v_it || jsonb_build_object('bonUsage', 'BUM', 'bonScope', v_scope);
      elsif v_usage = 'BUU' then
        v_tb := nullif(v_bon->>'tauxBon','')::numeric;
        v_it := v_it || jsonb_build_object('bonUsage', 'BUU', 'bonScope', v_scope, 'bonTaux', v_tb);
        if v_scope = 'produits' then v_it := v_it || '{"isProd":true}'::jsonb; end if;
        if v_s > 0 and v_tb is not null and v_tb <> (case when v_scope = 'produits' then v_p else v_s end) then v_it := v_it || jsonb_build_object('tvaTaux', v_tb); end if;
      end if; -- sans qualification (modèle bons v2 inactif / bon antérieur) : ligne historique de l'application (CA, taux des prestations)
      v_items := jsonb_build_array(v_it);
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('bonCode', p_row->>'code', 'bonId', p_q.objet_id, 'datePaiement', v_dpaie, 'recetteType', 'bon_cadeau');
      v_comment := 'Bon cadeau ' || coalesce(p_row->>'code','') || ' vendu en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe)'
        || coalesce(' - offert par ' || nullif(p_row->>'de',''), '') || case when v_usage = 'BUM' then ' - bon à usage multiple : TVA à l''utilisation (CGI art. 256 ter)' else '' end;
      v_cli := nullif(p_row->>'de','');
      v_client := lx_prive.recette_client(p_q.salon_id, nullif(p_row->>'acheteur_luxyra_id','')::uuid);
    elsif p_q.source = 'carte_abo' then
      v_lib := '💳 Carte: ' || coalesce(p_row->>'carte_nom','Carte d''abonnement') || ' (achat en ligne, jusqu''au ' || coalesce(lx_prive.date_fr(nullif(p_row->>'date_expiration','')::date), '?') || ')';
      v_items := jsonb_build_array(jsonb_build_object('sId', null, 'name', v_lib, 'price', v_m, 'qty', 1, 'remise', 0, 'isCarteAbo', true, 'carteAboId', p_q.objet_id));
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('carteAboId', p_q.objet_id, 'datePaiement', v_dpaie, 'recetteType', 'carte_abo');
      v_cli := nullif(p_row->>'client_nom','');
      v_comment := 'Carte d''abonnement payée en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe)' || coalesce(' - ' || v_cli, '');
    elsif p_q.source = 'click_collect' then
      for v_it in select value from jsonb_array_elements(coalesce(p_row->'items', '[]'::jsonb)) loop
        declare v_pid int := nullif(v_it->>'produit_id','')::int; v_tp numeric;
        begin
          select tva_taux into v_tp from public.produits where id = v_pid and salon_id = p_q.salon_id;
          v_lignes := v_lignes || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('sId', null, 'name', v_it->>'nom', 'price', (v_it->>'prix')::numeric,
            'qty', coalesce(nullif(v_it->>'qty','')::numeric, 1), 'remise', 0, 'isProd', true, 'prodId', v_pid, 'tvaTaux', v_tp)));
        end;
      end loop;
      -- 2026-10-28 (-3, cas E de l'audit) : les lignes doivent faire EXACTEMENT le montant payé (code promo, arrondi) : écart
      -- négatif -> remise répartie au prorata des lignes (dernière ligne = reste) ; écart positif -> ligne de complément.
      declare v_sl numeric := 0; v_ec numeric; v_rep numeric := 0; v_nl int; v_il int := 0; v_r numeric; v_l2 jsonb := '[]'::jsonb; v_x jsonb;
      begin
        select coalesce(sum((e->>'price')::numeric * (e->>'qty')::numeric), 0), count(*) into v_sl, v_nl from jsonb_array_elements(v_lignes) e;
        v_ec := lx_prive.r2(v_m - v_sl);
        if v_ec < -0.004 and v_sl > 0 then
          for v_x in select value from jsonb_array_elements(v_lignes) loop
            v_il := v_il + 1;
            v_r := case when v_il = v_nl then lx_prive.r2(-v_ec - v_rep)
                        else lx_prive.r2((v_x->>'price')::numeric * (v_x->>'qty')::numeric / v_sl * (-v_ec)) end;
            v_rep := v_rep + v_r;
            v_l2 := v_l2 || jsonb_build_array(v_x || jsonb_build_object('remise', v_r));
          end loop;
          v_lignes := v_l2;
        elsif v_ec > 0.004 then
          v_lignes := v_lignes || jsonb_build_array(jsonb_build_object('sId', null, 'name', 'Complément commande en ligne', 'price', v_ec, 'qty', 1, 'remise', 0, 'isProd', true));
        end if;
      end;
      v_items := v_lignes;
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('ccCommandeId', p_q.objet_id, 'ccNumero', nullif(p_row->>'numero','')::int, 'datePaiement', v_dpaie, 'recetteType', 'click_collect');
      v_cli := nullif(p_row->>'client_nom','');
      v_client := lx_prive.recette_client(p_q.salon_id, nullif(p_row->>'client_luxyra_id','')::uuid);
      v_comment := 'Click & Collect n°' || coalesce(p_row->>'numero','') || ' payé en ligne le ' || lx_prive.date_fr(v_dpaie) || ' (Stripe) - remise au client sans nouveau ticket';
    elsif p_q.source in ('click_collect_annul','remb_externe') then
      -- ticket négatif : lignes de l'original inversées (au prorata si remboursement partiel), HT / TVA inversés au centime
      select t.* into v_src from public.tickets t where t.salon_id = p_q.salon_id and t.id = (p_q.details->>'ticket_id')::uuid;
      if not found then raise exception 'LX_ATTENTE : ticket d''origine introuvable'; end if;
      v_orig := coalesce(nullif(v_src.raw_data->>'tkNum','')::int, v_src.num);
      -- 2026-10-28 (-3) : remboursement réel uniquement, cumul des tickets négatifs plafonné au montant du ticket d'origine
      if not lx_prive.refund_valide(p_q.refund_id) then
        raise exception 'LX_REFUS : remboursement sans identifiant de remboursement Stripe valide (%)', coalesce(p_q.refund_id, 'aucun');
      end if;
      declare v_deja numeric;
      begin
        select coalesce(sum(-t.total_ttc), 0) into v_deja from public.tickets t
         where t.salon_id = p_q.salon_id and t.raw_data->>'recetteRef' = v_src.id::text and t.status <> 'cancelled';
        if lx_prive.r2(v_src.total_ttc - v_deja) <= 0.004 then raise exception 'LX_REFUS : ticket d''origine #% déjà entièrement remboursé', v_orig; end if;
        if v_m > lx_prive.r2(v_src.total_ttc - v_deja) + 0.004 then
          v_m := lx_prive.r2(v_src.total_ttc - v_deja);
          begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Remboursement plafonné au reste du ticket d''origine #' || v_orig, p_severity := 'warning',
            p_context := jsonb_build_object('recette', p_q.id, 'demande', p_q.montant, 'retenu', v_m)); exception when others then null; end;
        end if;
      end;
      declare v_f numeric := case when abs(v_src.total_ttc) > 0.004 then v_m / v_src.total_ttc else 0 end; v_tot numeric := 0; v_n int := 0; v_k int := 0;
      begin
        select count(*) into v_n from jsonb_array_elements(v_src.items) e where not coalesce((e.value->>'isSep')::boolean, false);
        for v_it in select value from jsonb_array_elements(v_src.items) loop
          if coalesce((v_it->>'isSep')::boolean, false) then continue; end if;
          v_k := v_k + 1;
          declare v_l numeric := lx_prive.r2((coalesce((v_it->>'price')::numeric,0) * coalesce(nullif(v_it->>'qty','')::numeric,1) - coalesce((v_it->>'remise')::numeric,0)) * v_f);
          begin
            if v_k = v_n then v_l := lx_prive.r2(v_m - v_tot); end if;
            v_tot := v_tot + v_l;
            v_lignes := v_lignes || jsonb_build_array((v_it - 'remise' - 'qty' - 'price') || jsonb_build_object('name', 'Remboursement : ' || coalesce(v_it->>'name',''), 'price', -v_l, 'qty', 1, 'remise', 0,
              'isRembEnLigne', true, 'origTkNum', v_orig));
          end;
        end loop;
        if abs(v_m - v_src.total_ttc) < 0.005 then
          v_httva := jsonb_build_object('ht', -v_src.total_ht, 'tva', -v_src.total_tva, 'taux', v_src.taux_tva);
        end if;
      end;
      v_items := v_lignes;
      v_cles := jsonb_build_object('recetteKey', p_q.cle);
      v_extra := jsonb_build_object('isRembEnLigne', true, 'origTkNum', v_orig, 'origTkNums', jsonb_build_array(v_orig), 'recetteRef', v_src.id,
        'dateRemboursement', v_dpaie, 'refundId', p_q.refund_id, 'recetteType', p_q.source,
        'ccCommandeId', v_src.raw_data->>'ccCommandeId', 'bonCode', v_src.raw_data->>'bonCode', 'carteAboId', v_src.raw_data->>'carteAboId');
      v_cli := coalesce(v_src.client_nom, '');
      v_client := v_src.client_id;
      v_comment := 'Remboursement Stripe du ' || lx_prive.date_fr(v_dpaie) || ' (ticket d''origine #' || v_orig || ' du ' || lx_prive.date_fr(v_src.date_ticket) || ')'
        || case when p_q.source = 'click_collect_annul' then ' - commande Click & Collect annulée' else ' - remboursement fait sur Stripe' end;
      v_m := -v_m;
    else
      raise exception 'source inconnue %', p_q.source;
    end if;
    v_res := lx_prive.recette_tk_inserer(p_q.salon_id, v_cles, v_items, v_m, v_client,
      case when p_q.source in ('acompte','acompte_remb','retenue','empreinte') then nullif(p_row->>'client_nom','') else v_cli end,
      case when p_q.source in ('acompte','acompte_remb','retenue','empreinte') then nullif(p_row->>'client_prenom','') else null end,
      case when p_q.source in ('acompte','acompte_remb','retenue','empreinte') then nullif(p_row->>'collaborateur_id','')::int else null end,
      case when p_q.source in ('acompte','acompte_remb') then nullif(p_row->>'service_id','')::int else null end,
      v_comment, v_extra, v_httva);
    update public.recettes_en_ligne set statut = 'tickete', ticket_id = (v_res->>'ticket_id')::uuid, ticket_num = (v_res->>'num')::int,
      tk_num = (v_res->>'tk_num')::int, date_ticket = (v_res->>'date')::date, traite_at = now(), essais = essais + 1, derniere_erreur = null,
      montant = case when coalesce((v_res->>'deja')::boolean, false) then montant else abs(v_m) end -- 2026-10-28 (-3) : montant réellement ticketé (plafond)
     where id = p_q.id;
    if not coalesce((v_res->>'deja')::boolean, false) then
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (p_q.salon_id, case when v_m < 0 then 'AVOIR_TICKET' else 'RECETTE_EN_LIGNE' end,
        'Ticket #' || (v_res->>'tk_num') || ' (n° serveur ' || (v_res->>'num') || ') - ' || p_q.source || ' - ' || to_char(v_m, 'FM999999990.00') || ' EUR - paiement du '
        || lx_prive.date_fr(v_dpaie) || ' - créé par le serveur au paiement confirmé', 'Paiement en ligne (serveur)');
    end if;
    return jsonb_build_object('ok', true) || v_res;
  exception when others then
    v_err := sqlerrm;
    -- 2026-10-28 (-3) : refus définitif (remboursement non vérifiable, déjà remboursé) -> évènement écarté (jamais rejoué), alerte
    update public.recettes_en_ligne set essais = essais + 1, derniere_erreur = left(v_err, 500),
      statut = case when v_err like 'LX_REFUS%' then 'ignore' else statut end, traite_at = case when v_err like 'LX_REFUS%' then now() else traite_at end
     where id = p_q.id;
    if v_err like 'LX_REFUS%' then
      begin
        perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('Évènement de recette en ligne écarté : ' || v_err, 800), p_severity := 'warning',
          p_context := jsonb_build_object('recette', p_q.id, 'source', p_q.source, 'cle', p_q.cle, 'salon', p_q.salon_id));
      exception when others then null; end;
      return jsonb_build_object('ok', false, 'refus', true, 'erreur', v_err);
    end if;
    if v_err not like 'LX_JOUR_CLOS%' and v_err not like 'LX_ATTENTE%' then
      begin
        perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('Ticket de recette en ligne non créé : ' || v_err, 800), p_severity := 'critical',
          p_context := jsonb_build_object('recette', p_q.id, 'source', p_q.source, 'cle', p_q.cle, 'salon', p_q.salon_id));
      exception when others then null; end;
    end if;
    return jsonb_build_object('ok', false, 'erreur', v_err);
  end;
end $$;

-- File : ajoute l'évènement (une seule fois par clé) et renvoie la ligne
create or replace function lx_prive.recette_enfiler(p_salon uuid, p_source text, p_objet uuid, p_cle text, p_montant numeric,
  p_paye_at timestamptz, p_pi text, p_refund text, p_details jsonb)
returns public.recettes_en_ligne language plpgsql security definer set search_path = public, pg_temp as $$
declare v public.recettes_en_ligne;
begin
  insert into public.recettes_en_ligne (salon_id, source, objet_id, cle, montant, paye_at, payment_intent, refund_id, details)
  values (p_salon, p_source, p_objet, p_cle, lx_prive.r2(p_montant), p_paye_at, p_pi, p_refund, coalesce(p_details, '{}'::jsonb))
  on conflict (salon_id, cle) do nothing;
  select * into v from public.recettes_en_ligne where salon_id = p_salon and cle = p_cle;
  return v;
end $$;

-- ===================================================================================================================== §6
-- DÉCLENCHEURS (BEFORE UPDATE, exécutés en dernier : « zz_ »). Ne bloquent jamais l'écriture du paiement.
-- 2026-10-28 (-3, constat MAJEUR 2) : les déclencheurs ne créent un ticket que pour une écriture du SERVEUR
-- (lx_prive.appel_serveur : worker / edge functions = service_role, tâches planifiées) — jamais pour une écriture faite par
-- l'application d'un établissement (authenticated) ou par le site public (anon). Seule exception : la décision de
-- conserver un acompte ANCIEN MODÈLE (retenue_at, posée par l'application quand le client est absent) sur un acompte
-- déjà encaissé, dont le paiement (acompte_paye) n'a pu être enregistré que par le serveur (garde a0_lx_garde_paiements).
create or replace function lx_prive.zz_rdv_online_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb; e jsonb; v_new jsonb; v_k numeric; v_cle text; v_srv boolean := lx_prive.appel_serveur();
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  begin
    -- 1) acompte payé (nouveau modèle) : ticket « Acompte en ligne » — paiement enregistré par le serveur seulement
    if v_srv and NEW.acompte_modele = 'ticket' and coalesce(NEW.acompte_paye, false) and not coalesce(OLD.acompte_paye, false)
       and NEW.acompte_tk_num is null and coalesce(NEW.acompte_montant, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'acompte', NEW.id, 'acompte:' || NEW.id, NEW.acompte_montant, coalesce(NEW.acompte_paye_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.acompte_tk_num := (r->>'tk_num')::int; NEW.acompte_tk_claim_at := coalesce(NEW.acompte_tk_claim_at, now());
      else NEW.acompte_tk_claim_at := coalesce(NEW.acompte_tk_claim_at, now()); end if; -- verrou serveur : l'application ne le crée pas (rattrapage serveur)
    end if;
    -- 2) remboursements (nouveau modèle) : un ticket négatif par entrée sans « tk », refund Stripe valide (re_…) uniquement,
    --    cumul plafonné à l'acompte encaissé (lx_prive.recette_traiter)
    if v_srv and NEW.acompte_modele = 'ticket' and NEW.remboursements is distinct from OLD.remboursements then
      v_new := '[]'::jsonb;
      for e in select value from jsonb_array_elements(coalesce(NEW.remboursements, '[]'::jsonb)) loop
        if (e->>'tk') is null and coalesce((e->>'montant')::numeric, 0) > 0 and NEW.acompte_tk_num is not null then
          if not lx_prive.refund_valide(e->>'refund_id') then
            begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Entrée de remboursement d''acompte sans remboursement Stripe valide : aucun ticket', p_severity := 'warning',
              p_context := jsonb_build_object('rdv', NEW.id, 'entree', e)); exception when others then null; end;
          else
            v_cle := 'rembacompte:' || NEW.id || ':' || (e->>'refund_id');
            q := lx_prive.recette_enfiler(NEW.salon_id, 'acompte_remb', NEW.id, v_cle, (e->>'montant')::numeric, coalesce((e->>'at')::timestamptz, now()),
                   NEW.payment_intent_id, e->>'refund_id', jsonb_build_object('par', e->>'par', 'at', e->>'at'));
            r := lx_prive.recette_traiter(q, to_jsonb(NEW));
            if coalesce((r->>'ok')::boolean, false) then e := e || jsonb_build_object('tk', (r->>'tk_num')::int); end if;
          end if;
        end if;
        v_new := v_new || jsonb_build_array(e);
      end loop;
      NEW.remboursements := v_new;
    end if;
    -- 3) acompte conservé (ANCIEN modèle uniquement : le nouveau modèle a déjà son ticket au paiement) : décision de
    --    l'établissement (application) ou du serveur, sur un acompte DÉJÀ encaissé (OLD.acompte_paye)
    if OLD.retenue_at is null and NEW.retenue_at is not null and coalesce(OLD.acompte_paye, false) and coalesce(NEW.acompte_modele, '') <> 'ticket'
       and not coalesce(NEW.acompte_rembourse, false) and NEW.retenue_tk_num is null and NEW.retenue_claim_at is null then
      v_k := lx_prive.r2(coalesce(NEW.acompte_montant, 0) - coalesce(NEW.acompte_rembourse_montant, 0));
      if v_k > 0 then
        q := lx_prive.recette_enfiler(NEW.salon_id, 'retenue', NEW.id, 'retenue:acompte:' || NEW.id, v_k, NEW.retenue_at, NEW.payment_intent_id, null, '{}');
        r := lx_prive.recette_traiter(q, to_jsonb(NEW));
        if coalesce((r->>'ok')::boolean, false) then NEW.retenue_tk_num := (r->>'tk_num')::int; end if;
        NEW.retenue_claim_at := coalesce(NEW.retenue_claim_at, now());
      end if;
    end if;
    -- 4) empreinte capturée (edge functions) : montant RÉELLEMENT prélevé
    if v_srv and coalesce(OLD.empreinte_status, '') <> 'captured' and NEW.empreinte_status = 'captured' and NEW.empreinte_tk_num is null
       and coalesce(NEW.empreinte_captured_amount, NEW.empreinte_amount, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'empreinte', NEW.id, 'empreinte:' || NEW.id, coalesce(NEW.empreinte_captured_amount, NEW.empreinte_amount),
             coalesce(NEW.empreinte_captured_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.empreinte_tk_num := (r->>'tk_num')::int; end if;
      NEW.empreinte_claim_at := coalesce(NEW.empreinte_claim_at, now());
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_rdv_online_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('rdv', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

create or replace function lx_prive.zz_commandes_online_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb; v_q0 public.recettes_en_ligne; v_srv boolean := lx_prive.appel_serveur();
  v_actif boolean := lx_prive.recettes_serveur_actif();
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not v_srv then return NEW; end if; -- paiement et annulation remboursée : worker uniquement (2026-10-28 -3)
  -- 2026-10-28 (-4, contre-audit constat 3) : interrupteur éteint = plus de NOUVELLE recette (paiement) ; l'annulation remboursée
  -- d'une commande DÉJÀ en caisse par le serveur (ticket « cc: » créé) donne toujours son ticket négatif (sinon CA surévalué :
  -- l'application ne connaît pas ce ticket et ne fait aucun avoir).
  if not v_actif and NEW.recette_tk_num is null then return NEW; end if;
  begin
    if v_actif and coalesce(NEW.paye, false) and not coalesce(OLD.paye, false) and NEW.recette_tk_num is null and coalesce(NEW.total, 0) > 0
       and coalesce(NEW.mode_paiement, 'en_ligne') = 'en_ligne' then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'click_collect', NEW.id, 'cc:' || NEW.id, NEW.total, coalesce(NEW.paye_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.recette_tk_num := (r->>'tk_num')::int; NEW.ticket_num := coalesce(NEW.ticket_num, (r->>'tk_num')); end if;
    end if;
    -- annulation remboursée : clé « cc_annul:<commande> » PARTAGÉE avec lx_recette_remboursement_externe (évènement
    -- charge.refunded arrivé avant l'écriture du refund_id par le worker) -> un seul ticket négatif, quel que soit l'ordre
    if NEW.status = 'annulee' and coalesce(OLD.status, '') <> 'annulee' and coalesce(NEW.paye, false) and lx_prive.refund_valide(NEW.refund_id)
       and NEW.recette_remb_tk_num is null then
      select * into v_q0 from public.recettes_en_ligne where salon_id = NEW.salon_id and cle = 'cc:' || NEW.id;
      if v_q0.id is not null then
        q := lx_prive.recette_enfiler(NEW.salon_id, 'click_collect_annul', NEW.id, 'cc_annul:' || NEW.id, NEW.total, coalesce(NEW.cancelled_at, now()), NEW.payment_intent_id,
               NEW.refund_id, jsonb_build_object('ticket_id', v_q0.ticket_id));
        if v_q0.statut = 'tickete' then
          r := lx_prive.recette_traiter(q, to_jsonb(NEW));
          if coalesce((r->>'ok')::boolean, false) then NEW.recette_remb_tk_num := (r->>'tk_num')::int; end if;
        end if;
      end if;
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_commandes_online_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('commande', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

create or replace function lx_prive.zz_cartes_cadeaux_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb;
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  if not lx_prive.appel_serveur() then return NEW; end if; -- paiement : edge function gc-stripe-webhook uniquement (2026-10-28 -3)
  begin
    if NEW.source = 'web' and NEW.payment_status = 'paid' and coalesce(OLD.payment_status, '') <> 'paid' and not coalesce(NEW.is_offert, false)
       and NEW.tk_num is null and coalesce(NEW.valeur, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'bon_cadeau', NEW.id, 'bon:' || NEW.id, NEW.valeur, coalesce(NEW.paye_at, now()), NEW.payment_intent_id, null, '{}');
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.tk_num := (r->>'tk_num')::int; end if;
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_cartes_cadeaux_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('bon', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

create or replace function lx_prive.zz_cartes_abo_recettes()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb;
begin
  if coalesce(current_setting('lx.recette_en_cours', true), '') = '1' then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  if not lx_prive.appel_serveur() then return NEW; end if; -- activation : edge function carte-abo-confirm-payment uniquement (2026-10-28 -3)
  begin
    if coalesce(OLD.status, '') = 'pending_payment' and NEW.status = 'active' and coalesce(NEW.ticket_num, '') like 'cs\_%' and NEW.recette_tk_num is null
       and coalesce(NEW.montant_paye, NEW.tarif, 0) > 0 then
      q := lx_prive.recette_enfiler(NEW.salon_id, 'carte_abo', NEW.id, 'carte:' || NEW.id, coalesce(NEW.montant_paye, NEW.tarif), coalesce(NEW.paye_at, now()), NEW.payment_intent_id, null,
             jsonb_build_object('session', NEW.ticket_num));
      r := lx_prive.recette_traiter(q, to_jsonb(NEW));
      if coalesce((r->>'ok')::boolean, false) then NEW.recette_tk_num := (r->>'tk_num')::int; end if;
    end if;
  exception when others then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := left('zz_cartes_abo_recettes : ' || sqlerrm, 800), p_severity := 'critical', p_context := jsonb_build_object('carte', NEW.id)); exception when others then null; end;
  end;
  return NEW;
end $$;

drop trigger if exists zz_trg_rdv_online_recettes on public.rdv_online;
create trigger zz_trg_rdv_online_recettes before update on public.rdv_online for each row execute function lx_prive.zz_rdv_online_recettes();
drop trigger if exists zz_trg_commandes_online_recettes on public.commandes_online;
create trigger zz_trg_commandes_online_recettes before update on public.commandes_online for each row execute function lx_prive.zz_commandes_online_recettes();
drop trigger if exists zz_trg_cartes_cadeaux_recettes on public.cartes_cadeaux;
create trigger zz_trg_cartes_cadeaux_recettes before update on public.cartes_cadeaux for each row execute function lx_prive.zz_cartes_cadeaux_recettes();
drop trigger if exists zz_trg_cartes_abo_recettes on public.cartes_abo_clients;
create trigger zz_trg_cartes_abo_recettes before update on public.cartes_abo_clients for each row execute function lx_prive.zz_cartes_abo_recettes();

-- ===================================================================================================================== §6 bis
-- 2026-10-28 (-3, constat MAJEUR 2) GARDES DES COLONNES DE PAIEMENT. Les droits par colonne (GRANT UPDATE (col)) casseraient
-- l'application : elle enregistre des lignes entières (upsert de cartes_cadeaux / cartes_abo_clients) qui contiennent ces
-- colonnes, même inchangées. Une garde BEFORE INSERT / UPDATE (nommée « a0_ » : exécutée la première) REMET donc la valeur
-- d'origine de toute colonne de paiement modifiée par un appel qui n'est pas celui du serveur (application = authenticated,
-- site = anon), sans faire échouer l'écriture du reste de la ligne, et signale la tentative (report_server_error). Usages
-- légitimes vérifiés dans app.html / site.html / luxyra-supabase.js (28/10/2026) : l'application n'écrit aucune de ces
-- colonnes (paiements, remboursements, captures : worker et edge functions), sauf retenue_at (absence du client) et ses
-- propres n° de ticket (acompte_tk_num, retenue_tk_num, empreinte_tk_num, claims), qui restent permis.
create or replace function lx_prive.garde_signaler(p_table text, p_id uuid, p_cols text[])
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if coalesce(array_length(p_cols, 1), 0) = 0 then return; end if;
  begin
    perform public.report_server_error(p_source := 'sql:garde_paiements', p_message := 'Écriture de colonnes de paiement refusée (' || p_table || ' : ' || array_to_string(p_cols, ', ') || ')',
      p_severity := 'warning', p_context := jsonb_build_object('table', p_table, 'id', p_id, 'colonnes', p_cols, 'role', coalesce((select auth.role()), '')));
  exception when others then null; end;
end $$;

-- 2026-10-28 (-4, contre-audit constat 2) : l'application enregistre le n° de SON ticket de remboursement d'acompte dans
-- l'entrée de remboursement (clé « tk », fonction public.lx_acompte_remb_ticketer, SECURITY INVOKER, appelée avec le jeton de
-- l'établissement — interrupteur éteint ou avant la mise en service). Cette écriture est LÉGITIME : seule différence acceptée
-- sur remboursements = ajout de « tk » (entier > 0) à des entrées existantes qui n'en avaient pas, sans rien changer d'autre
-- (même nombre d'entrées, même ordre, mêmes montants / refund_id / dates).
create or replace function lx_prive.remb_ajout_tk_seul(p_old jsonb, p_new jsonb)
returns boolean language sql immutable as $$
  select case
    when jsonb_typeof(coalesce(p_old, '[]'::jsonb)) <> 'array' or jsonb_typeof(coalesce(p_new, '[]'::jsonb)) <> 'array' then false
    when jsonb_array_length(coalesce(p_old, '[]'::jsonb)) <> jsonb_array_length(coalesce(p_new, '[]'::jsonb)) then false
    else not exists (
      select 1 from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) with ordinality o(v, i)
        join jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) with ordinality n(v, i) using (i)
       where not (n.v = o.v
              or (jsonb_typeof(o.v) = 'object' and jsonb_typeof(n.v) = 'object' and not (o.v ? 'tk') and n.v ? 'tk'
                  and (n.v - 'tk') = o.v and jsonb_typeof(n.v->'tk') = 'number' and (n.v->>'tk') ~ '^[0-9]{1,9}$' and (n.v->>'tk')::int > 0)))
  end
$$;
-- … et chaque « tk » ajouté correspond à un ticket de remboursement RÉELLEMENT enregistré au journal (clé partagée
-- application / serveur « rembacompte:<rdv>:<refund_id ou date> », index unique tickets_acompte_key_unique) : un n° inventé
-- (qui ferait croire au serveur que le remboursement est déjà en caisse) est refusé comme toute écriture de paiement.
create or replace function lx_prive.remb_tk_justifies(p_salon uuid, p_rdv uuid, p_old jsonb, p_new jsonb)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select lx_prive.remb_ajout_tk_seul(p_old, p_new) and not exists (
    select 1 from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) n(v)
     where n.v ? 'tk'
       and not exists (select 1 from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o(v) where o.v = n.v)
       and not exists (select 1 from public.tickets t where t.salon_id = p_salon
                         and t.raw_data->>'acompteKey' = 'rembacompte:' || p_rdv || ':' || coalesce(n.v->>'refund_id', n.v->>'at', '')))
$$;

create or replace function lx_prive.garde_paiements_rdv_online()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[] := '{}';
begin
  if lx_prive.appel_serveur() then return NEW; end if;
  if TG_OP = 'INSERT' then
    if coalesce(NEW.acompte_paye, false) then v := v || 'acompte_paye'::text; end if;
    NEW.acompte_paye := false; NEW.acompte_paye_at := null; NEW.acompte_rembourse := false; NEW.acompte_rembourse_montant := 0;
    NEW.remboursements := '[]'::jsonb; NEW.refund_id := null; NEW.refunded_at := null;
    if NEW.empreinte_status = 'captured' then v := v || 'empreinte_status'::text; NEW.empreinte_status := 'pending'; end if;
    NEW.empreinte_captured_amount := null; NEW.empreinte_captured_at := null;
  else
    if NEW.acompte_paye is distinct from OLD.acompte_paye then v := v || 'acompte_paye'::text; NEW.acompte_paye := OLD.acompte_paye; end if;
    if NEW.acompte_paye_at is distinct from OLD.acompte_paye_at then v := v || 'acompte_paye_at'::text; NEW.acompte_paye_at := OLD.acompte_paye_at; end if;
    if coalesce(OLD.acompte_paye, false) and NEW.acompte_montant is distinct from OLD.acompte_montant then v := v || 'acompte_montant'::text; NEW.acompte_montant := OLD.acompte_montant; end if;
    if NEW.payment_intent_id is distinct from OLD.payment_intent_id then v := v || 'payment_intent_id'::text; NEW.payment_intent_id := OLD.payment_intent_id; end if;
    if NEW.stripe_payment_id is distinct from OLD.stripe_payment_id then v := v || 'stripe_payment_id'::text; NEW.stripe_payment_id := OLD.stripe_payment_id; end if;
    if NEW.remboursements is distinct from OLD.remboursements and not lx_prive.remb_tk_justifies(NEW.salon_id, NEW.id, OLD.remboursements, NEW.remboursements) then
      v := v || 'remboursements'::text; NEW.remboursements := OLD.remboursements; end if; -- 2026-10-28 (-4) : ajout de « tk » seul accepté
    if NEW.acompte_rembourse is distinct from OLD.acompte_rembourse then v := v || 'acompte_rembourse'::text; NEW.acompte_rembourse := OLD.acompte_rembourse; end if;
    if NEW.acompte_rembourse_montant is distinct from OLD.acompte_rembourse_montant then v := v || 'acompte_rembourse_montant'::text; NEW.acompte_rembourse_montant := OLD.acompte_rembourse_montant; end if;
    if NEW.refund_id is distinct from OLD.refund_id then v := v || 'refund_id'::text; NEW.refund_id := OLD.refund_id; end if;
    if NEW.refunded_at is distinct from OLD.refunded_at then v := v || 'refunded_at'::text; NEW.refunded_at := OLD.refunded_at; end if;
    if (NEW.empreinte_status = 'captured' or OLD.empreinte_status = 'captured') and NEW.empreinte_status is distinct from OLD.empreinte_status then
      v := v || 'empreinte_status'::text; NEW.empreinte_status := OLD.empreinte_status; end if;
    if NEW.empreinte_captured_amount is distinct from OLD.empreinte_captured_amount then v := v || 'empreinte_captured_amount'::text; NEW.empreinte_captured_amount := OLD.empreinte_captured_amount; end if;
    if NEW.empreinte_captured_at is distinct from OLD.empreinte_captured_at then v := v || 'empreinte_captured_at'::text; NEW.empreinte_captured_at := OLD.empreinte_captured_at; end if;
    if NEW.empreinte_amount is distinct from OLD.empreinte_amount and OLD.empreinte_status in ('held', 'captured') then v := v || 'empreinte_amount'::text; NEW.empreinte_amount := OLD.empreinte_amount; end if;
  end if;
  perform lx_prive.garde_signaler('rdv_online', NEW.id, v);
  return NEW;
end $$;

create or replace function lx_prive.garde_paiements_commandes_online()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[] := '{}';
begin
  if lx_prive.appel_serveur() then return NEW; end if;
  if TG_OP = 'INSERT' then
    if coalesce(NEW.paye, false) then v := v || 'paye'::text; end if;
    NEW.paye := false; NEW.paye_at := null; NEW.refund_id := null; NEW.recette_tk_num := null; NEW.recette_remb_tk_num := null;
  else
    if NEW.paye is distinct from OLD.paye then v := v || 'paye'::text; NEW.paye := OLD.paye; end if;
    if NEW.paye_at is distinct from OLD.paye_at then v := v || 'paye_at'::text; NEW.paye_at := OLD.paye_at; end if;
    if NEW.total is distinct from OLD.total then v := v || 'total'::text; NEW.total := OLD.total; end if;
    if NEW.items is distinct from OLD.items then v := v || 'items'::text; NEW.items := OLD.items; end if;
    if NEW.mode_paiement is distinct from OLD.mode_paiement then v := v || 'mode_paiement'::text; NEW.mode_paiement := OLD.mode_paiement; end if;
    if NEW.payment_intent_id is distinct from OLD.payment_intent_id then v := v || 'payment_intent_id'::text; NEW.payment_intent_id := OLD.payment_intent_id; end if;
    if NEW.stripe_payment_id is distinct from OLD.stripe_payment_id then v := v || 'stripe_payment_id'::text; NEW.stripe_payment_id := OLD.stripe_payment_id; end if;
    if NEW.refund_id is distinct from OLD.refund_id then v := v || 'refund_id'::text; NEW.refund_id := OLD.refund_id; end if;
    if NEW.recette_tk_num is distinct from OLD.recette_tk_num then v := v || 'recette_tk_num'::text; NEW.recette_tk_num := OLD.recette_tk_num; end if;
    if NEW.recette_remb_tk_num is distinct from OLD.recette_remb_tk_num then v := v || 'recette_remb_tk_num'::text; NEW.recette_remb_tk_num := OLD.recette_remb_tk_num; end if;
  end if;
  perform lx_prive.garde_signaler('commandes_online', NEW.id, v);
  return NEW;
end $$;

create or replace function lx_prive.garde_paiements_cartes_cadeaux()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[] := '{}';
begin
  if lx_prive.appel_serveur() then return NEW; end if;
  if TG_OP = 'INSERT' then
    -- un bon « vendu en ligne » ne naît que par gc-create-checkout (serveur) : jamais payé à la création par l'application
    if NEW.source = 'web' then
      if coalesce(NEW.payment_status, 'paid') <> 'pending' then v := v || 'payment_status'::text; end if;
      NEW.payment_status := 'pending'; NEW.payment_intent_id := null; NEW.paye_at := null; NEW.tk_num := null;
    end if;
  else
    if NEW.payment_status is distinct from OLD.payment_status then v := v || 'payment_status'::text; NEW.payment_status := OLD.payment_status; end if;
    if NEW.payment_intent_id is distinct from OLD.payment_intent_id then v := v || 'payment_intent_id'::text; NEW.payment_intent_id := OLD.payment_intent_id; end if;
    if NEW.source is distinct from OLD.source then v := v || 'source'::text; NEW.source := OLD.source; end if;
    if NEW.paye_at is distinct from OLD.paye_at then v := v || 'paye_at'::text; NEW.paye_at := OLD.paye_at; end if;
    if NEW.stripe_session_id is distinct from OLD.stripe_session_id then v := v || 'stripe_session_id'::text; NEW.stripe_session_id := OLD.stripe_session_id; end if;
    if OLD.source = 'web' then
      if NEW.valeur is distinct from OLD.valeur then v := v || 'valeur'::text; NEW.valeur := OLD.valeur; end if;
      if NEW.is_offert is distinct from OLD.is_offert then v := v || 'is_offert'::text; NEW.is_offert := OLD.is_offert; end if;
      if OLD.tk_num is not null and NEW.tk_num is distinct from OLD.tk_num then NEW.tk_num := OLD.tk_num; end if; -- upsert de l'application sans le n° : sans alerte
    end if;
  end if;
  perform lx_prive.garde_signaler('cartes_cadeaux', NEW.id, v);
  return NEW;
end $$;

-- Carte d'abonnement (constat MAJEUR 4) : une carte créée « en attente de paiement » par le site public ne garde AUCUNE
-- valeur du navigateur : tarif, remises, nom et durée sont RECOPIÉS depuis la configuration de l'établissement
-- (salons.config_json.cartes_abo, champs id / nom / tarif / duree / remiseServices / remiseForfaits) ; carte inconnue ou
-- cartes désactivées (cartes_abo_config.active = false) -> refus. L'activation reste réservée à carte-abo-confirm-payment.
create or replace function lx_prive.carte_abo_config(p_salon uuid, p_carte text)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v jsonb; e jsonb;
begin
  select to_jsonb(s.config_json) into v from public.salons s where s.id = p_salon;
  if v is null then return null; end if;
  if jsonb_typeof(v) = 'string' then begin v := (v #>> '{}')::jsonb; exception when others then return null; end; end if;
  if jsonb_typeof(v) <> 'object' then return null; end if;
  if coalesce(v->'cartes_abo_config'->>'active', '') = 'false' then return null; end if;
  if jsonb_typeof(v->'cartes_abo') <> 'array' or coalesce(p_carte, '') = '' then return null; end if;
  select x.value into e from jsonb_array_elements(v->'cartes_abo') x where x.value->>'id' = p_carte limit 1;
  return e;
end $$;

create or replace function lx_prive.garde_paiements_cartes_abo()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text[] := '{}'; e jsonb; v_t numeric; v_d int; x public.cartes_abo_clients;
begin
  if lx_prive.appel_serveur() then return NEW; end if;
  -- 2026-10-28 (-4, contre-audit constat 5) : l'application enregistre ses cartes par UPSERT (insert … on conflict (id) do
  -- update). Pour une carte qui EXISTE déjà, la partie « insert » n'est jamais écrite : les colonnes de paiement sont reprises
  -- de la ligne existante (aucune alerte), puis la garde « update » ci-dessous protège la ligne comme pour toute modification.
  -- Seule une valeur ENVOYÉE et différente de la ligne existante est signalée (tentative réelle) ; une colonne absente de
  -- l'envoi (valeur par défaut NULL) ne l'est pas. Avant : 2 fausses alertes à chaque enregistrement d'une carte payée en ligne.
  if TG_OP = 'INSERT' and NEW.id is not null then
    select * into x from public.cartes_abo_clients where id = NEW.id and salon_id is not distinct from NEW.salon_id;
    if found then
      if NEW.ticket_num is not null and NEW.ticket_num is distinct from x.ticket_num and (coalesce(NEW.ticket_num, '') like 'cs\_%' or coalesce(x.ticket_num, '') like 'cs\_%') then v := v || 'ticket_num'::text; end if;
      if NEW.montant_paye is not null and NEW.montant_paye is distinct from x.montant_paye then v := v || 'montant_paye'::text; end if;
      if NEW.payment_intent_id is not null and NEW.payment_intent_id is distinct from x.payment_intent_id then v := v || 'payment_intent_id'::text; end if;
      if NEW.recette_tk_num is not null and NEW.recette_tk_num is distinct from x.recette_tk_num then v := v || 'recette_tk_num'::text; end if;
      if NEW.paye_at is not null and NEW.paye_at is distinct from x.paye_at then v := v || 'paye_at'::text; end if;
      if (coalesce(NEW.ticket_num, '') like 'cs\_%' or coalesce(x.ticket_num, '') like 'cs\_%') then NEW.ticket_num := x.ticket_num; end if;
      NEW.montant_paye := x.montant_paye; NEW.payment_intent_id := x.payment_intent_id; NEW.recette_tk_num := x.recette_tk_num; NEW.paye_at := x.paye_at;
      perform lx_prive.garde_signaler('cartes_abo_clients', NEW.id, v);
      return NEW;
    end if;
  end if;
  if TG_OP = 'INSERT' then
    NEW.montant_paye := null; NEW.payment_intent_id := null; NEW.recette_tk_num := null; NEW.paye_at := null;
    if coalesce(NEW.ticket_num, '') like 'cs\_%' then v := v || 'ticket_num'::text; NEW.ticket_num := ''; end if;
    if NEW.status = 'pending_payment' then
      e := lx_prive.carte_abo_config(NEW.salon_id, NEW.carte_id);
      if e is null then
        raise exception 'LX_CARTE_INCONNUE : cette carte d''abonnement n''est pas (ou plus) proposée par l''établissement. Rechargez la page.' using errcode = 'P0001';
      end if;
      v_t := nullif(e->>'tarif', '')::numeric; v_d := coalesce(nullif(e->>'duree', '')::numeric, 0)::int;
      if not (v_t > 0) or not (v_d > 0) then
        raise exception 'LX_CARTE_INCONNUE : tarif ou durée de la carte non configurés par l''établissement.' using errcode = 'P0001';
      end if;
      NEW.carte_nom := coalesce(nullif(e->>'nom', ''), NEW.carte_nom);
      NEW.tarif := v_t;
      NEW.remise_services := round(coalesce(nullif(e->>'remiseServices', '')::numeric, 0))::int;
      NEW.remise_forfaits := round(coalesce(nullif(e->>'remiseForfaits', '')::numeric, 0))::int;
      NEW.date_achat := (now() at time zone 'Europe/Paris')::date;
      NEW.date_expiration := (NEW.date_achat + make_interval(months => v_d))::date;
      NEW.economies_totales := 0;
    end if;
  else
    if OLD.status = 'pending_payment' and NEW.status = 'active' then v := v || 'status'::text; NEW.status := OLD.status; end if;
    if (coalesce(NEW.ticket_num, '') like 'cs\_%' or coalesce(OLD.ticket_num, '') like 'cs\_%') and NEW.ticket_num is distinct from OLD.ticket_num then
      v := v || 'ticket_num'::text; NEW.ticket_num := OLD.ticket_num; end if;
    if NEW.montant_paye is distinct from OLD.montant_paye then v := v || 'montant_paye'::text; NEW.montant_paye := OLD.montant_paye; end if;
    if NEW.payment_intent_id is distinct from OLD.payment_intent_id then v := v || 'payment_intent_id'::text; NEW.payment_intent_id := OLD.payment_intent_id; end if;
    if NEW.recette_tk_num is distinct from OLD.recette_tk_num then v := v || 'recette_tk_num'::text; NEW.recette_tk_num := OLD.recette_tk_num; end if;
    if NEW.paye_at is distinct from OLD.paye_at then v := v || 'paye_at'::text; NEW.paye_at := OLD.paye_at; end if;
    if (OLD.status = 'pending_payment' or coalesce(OLD.ticket_num, '') like 'cs\_%') then
      if NEW.tarif is distinct from OLD.tarif then v := v || 'tarif'::text; NEW.tarif := OLD.tarif; end if;
      if OLD.status = 'pending_payment' then
        if NEW.remise_services is distinct from OLD.remise_services then v := v || 'remise_services'::text; NEW.remise_services := OLD.remise_services; end if;
        if NEW.remise_forfaits is distinct from OLD.remise_forfaits then v := v || 'remise_forfaits'::text; NEW.remise_forfaits := OLD.remise_forfaits; end if;
        if NEW.date_expiration is distinct from OLD.date_expiration then v := v || 'date_expiration'::text; NEW.date_expiration := OLD.date_expiration; end if;
        if NEW.carte_id is distinct from OLD.carte_id then v := v || 'carte_id'::text; NEW.carte_id := OLD.carte_id; end if;
      end if;
    end if;
  end if;
  perform lx_prive.garde_signaler('cartes_abo_clients', NEW.id, v);
  return NEW;
end $$;

drop trigger if exists a0_lx_garde_paiements on public.rdv_online;
create trigger a0_lx_garde_paiements before insert or update on public.rdv_online for each row execute function lx_prive.garde_paiements_rdv_online();
drop trigger if exists a0_lx_garde_paiements on public.commandes_online;
create trigger a0_lx_garde_paiements before insert or update on public.commandes_online for each row execute function lx_prive.garde_paiements_commandes_online();
drop trigger if exists a0_lx_garde_paiements on public.cartes_cadeaux;
create trigger a0_lx_garde_paiements before insert or update on public.cartes_cadeaux for each row execute function lx_prive.garde_paiements_cartes_cadeaux();
drop trigger if exists a0_lx_garde_paiements on public.cartes_abo_clients;
create trigger a0_lx_garde_paiements before insert or update on public.cartes_abo_clients for each row execute function lx_prive.garde_paiements_cartes_abo();

-- ===================================================================================================================== §6 ter
-- 2026-10-28 (-3, constat BLOQUANT a) VERSION MINIMALE DE L'APPLICATION. Une fois l'interrupteur allumé, un ticket envoyé par
-- l'application (authenticated) doit porter raw_data.lxVersion >= recettes_en_ligne_version_min (lxVersion transmis depuis 6.8.1 :
-- luxyra-supabase.js saveTicketToDb ; seuil par défaut 6.8.2, posé à '0' à l'activation puis relevé — voir recettes_version_min). Une version plus ancienne (qui crée encore elle-même les
-- tickets d'acompte, ne connaît pas la série serveur…) est refusée avec un message « mettez l'application à jour » ; le ticket
-- reste dans la file de secours de l'appareil et sera transmis par la nouvelle version après rechargement (aucune vente perdue).
-- Un ticket marqué « serveur » ne peut être inséré que par le serveur.
create or replace function lx_prive.tickets_version_controle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v text := NEW.raw_data->>'lxVersion'; v_min text;
begin
  if coalesce(NEW.raw_data->>'serveur', '') = 'true' then
    if not lx_prive.appel_serveur() and coalesce(current_setting('lx.recette_insertion', true), '') <> '1' then
      raise exception 'LX_SERVEUR_SEUL : un ticket de paiement en ligne ne peut être enregistré que par le serveur.' using errcode = 'P0001';
    end if;
    return NEW;
  end if;
  -- la série 900001+ est réservée aux tickets du serveur (quel que soit l'appelant) : un appareil ne peut pas y numéroter
  -- (une version 6.8.1+ l'exclut de son compteur, une version plus ancienne ne la voit pas — appointments.ticket_num vide)
  -- -> refus : un n° imprimé n'est jamais partagé entre un ticket du serveur et un ticket d'appareil
  if (NEW.raw_data->>'tkNum') ~ '^[0-9]{1,9}$' and (NEW.raw_data->>'tkNum')::int > lx_prive.recette_serie_base() then
    raise exception 'LX_TKNUM_SERIE_SERVEUR : le n° de ticket % est réservé aux paiements en ligne (série du serveur). Rechargez l''application.', NEW.raw_data->>'tkNum' using errcode = 'P0001';
  end if;
  if lx_prive.appel_serveur() then return NEW; end if;
  if not lx_prive.recettes_serveur_actif() then return NEW; end if;
  v_min := lx_prive.recettes_version_min();
  if lx_prive.version_num(v) < lx_prive.version_num(v_min) then
    raise exception 'LX_APP_OBSOLETE : mettez l''application à jour (version % sur cet appareil, % minimum) : fermez-la complètement puis rouvrez-la, ou rechargez la page. Le ticket reste en attente sur cet appareil et sera transmis après la mise à jour.',
      coalesce(nullif(v, ''), 'antérieure à 6.8.1'), v_min using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_tickets_a_version on public.tickets;
create trigger a_lx_tickets_a_version before insert on public.tickets for each row execute function lx_prive.tickets_version_controle();

-- 2026-10-28 (-5, contre-audit final constat 4) : VENTE REPORTÉE (journée de vente déjà close lors de sa transmission,
-- application 6.8.3 : _lxTicketReporter) : la date et l'heure réelles de vente doivent être SCELLÉES — elles sont portées par
-- la 1re ligne du ticket (items[0].lxRep = {v:1, type:"vente", dateVente, heureVente, dateEnr}), champ couvert par l'empreinte
-- (num|date|heure|ttc|ht|items|prev|salon, format inchangé) et par le sceau ; raw_data (hors empreinte) n'en est que la copie.
-- Refus (LX_REPORT_NON_SCELLE) d'un ticket reporté sans cette ligne cohérente, et d'une marque lxRep posée par un appareil hors
-- report. Tickets existants et tickets non reportés : inchangés (aucune clé lxRep).
create or replace function lx_prive.tickets_report_controle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_r jsonb := case when jsonb_typeof(NEW.items) = 'array' and jsonb_array_length(NEW.items) > 0 then NEW.items->0->'lxRep' else null end;
begin
  if coalesce(NEW.raw_data->>'serveur', '') = 'true' then return NEW; end if; -- tickets du serveur : posée par recette_tk_inserer
  if coalesce(NEW.raw_data->>'reportJourClos', '') = 'true' then
    if v_r is null or coalesce(v_r->>'v', '') <> '1' or v_r->>'dateVente' is distinct from (NEW.raw_data->>'dateVente')
       or v_r->>'dateEnr' is distinct from NEW.date_ticket::text or not (v_r->>'dateVente' ~ '^\d{4}-\d{2}-\d{2}$')
       or (v_r->>'dateVente')::date >= NEW.date_ticket then
      raise exception 'LX_REPORT_NON_SCELLE : vente reportée sans date réelle de vente scellée dans le ticket (mettez l''application à jour).' using errcode = 'P0001';
    end if;
  elsif v_r is not null then
    raise exception 'LX_REPORT_NON_SCELLE : marque de report (lxRep) sur un ticket qui n''est pas reporté.' using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_tickets_report_scelle on public.tickets;
create trigger a_lx_tickets_report_scelle before insert on public.tickets for each row execute function lx_prive.tickets_report_controle();

-- Garde-fou : une ANCIENNE version de l'application (appareil non rechargé) ne doit jamais sceller une 2e fois une commande
-- Click & Collect déjà en caisse par le serveur (remise « Payé en ligne (Click & Collect) »). Refus définitif LX_CC_DEJA_EN_CAISSE.
create or replace function lx_prive.tickets_cc_doublon_controle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_num int; v_tk int;
begin
  if coalesce(NEW.raw_data->>'serveur', '') = 'true' then return NEW; end if;
  if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(NEW.raw_data->'payments') = 'array' then NEW.raw_data->'payments' else '[]'::jsonb end) p
                  where p.value->>'method' = 'Payé en ligne (Click & Collect)') then return NEW; end if;
  v_num := nullif(substring(coalesce(NEW.raw_data->>'comment', NEW.notes, '') from 'Click & Collect n°([0-9]+)'), '')::int;
  if v_num is null then return NEW; end if;
  select recette_tk_num into v_tk from public.commandes_online where salon_id = NEW.salon_id and numero = v_num;
  if v_tk is not null then
    raise exception 'LX_CC_DEJA_EN_CAISSE : la commande n°% payée en ligne est déjà en caisse (ticket #%) : la remise ne crée pas de ticket. Rechargez l''application.', v_num, v_tk using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_tickets_cc_doublon on public.tickets;
create trigger a_lx_tickets_cc_doublon before insert on public.tickets for each row execute function lx_prive.tickets_cc_doublon_controle();

-- 2026-10-28 (-3, constat MAJEUR 6) : même refus pour la COPIE dans appointments (une ancienne version enregistrait le
-- rendez-vous encaissé même quand son ticket était refusé -> chiffre d'affaires compté deux fois dans le rapport / Excel).
create or replace function lx_prive.appointments_cc_doublon_controle()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare v_num int; v_tk int;
begin
  if lx_prive.appel_serveur() then return NEW; end if;
  if coalesce(NEW.meta->>'serveur', '') = 'true' then return NEW; end if;
  if not exists (select 1 from jsonb_array_elements(case when jsonb_typeof(NEW.payments) = 'array' then NEW.payments else '[]'::jsonb end) p
                  where p.value->>'method' = 'Payé en ligne (Click & Collect)') then return NEW; end if;
  if TG_OP = 'UPDATE' and OLD.payments is not distinct from NEW.payments then return NEW; end if;
  v_num := nullif(substring(coalesce(NEW.comment, '') from 'Click & Collect n°([0-9]+)'), '')::int;
  if v_num is null then return NEW; end if;
  select recette_tk_num into v_tk from public.commandes_online where salon_id = NEW.salon_id and numero = v_num;
  if v_tk is not null then
    raise exception 'LX_CC_DEJA_EN_CAISSE : la commande n°% payée en ligne est déjà en caisse (ticket #%) : la remise ne crée ni ticket ni encaissement. Rechargez l''application.', v_num, v_tk using errcode = 'P0001';
  end if;
  return NEW;
end $$;
drop trigger if exists a_lx_appointments_cc_doublon on public.appointments;
create trigger a_lx_appointments_cc_doublon before insert or update on public.appointments for each row execute function lx_prive.appointments_cc_doublon_controle();

-- ===================================================================================================================== §7
-- RATTRAPAGE (tâche planifiée toutes les 5 min) : évènements en attente (journée clôturée, ticket d'origine pas encore créé,
-- erreur passagère) + filet (paiements enregistrés sans évènement).
-- 2026-10-28 (-3, constat MAJEUR 3) : filet SANS date de départ pour les sources protégées par une clé partagée avec
-- l'application (acompte en ligne « acompte:<rdv> », remboursement « rembacompte:<rdv>:<refund> », acompte conservé
-- « acompte:<rdv> », empreinte « empreinte:<rdv> ») et pour le Click & Collect payé non remis (ticket_num vide : aucune
-- remise en caisse) : un paiement fait juste avant la mise en service reçoit son ticket, jamais deux (ticket de l'application
-- retrouvé par sa clé dans tickets OU appointments, verrou d'un appareil de moins de 15 min respecté). Bons cadeaux et
-- cartes d'abonnement gardent la date de mise en service : l'application ne les enregistrait pas à la vente et les traite
-- encore à l'utilisation (bons antérieurs) — un ticket de vente rétroactif compterait la recette deux fois.
-- 2026-10-28 (-3, mineur) : une transaction PAR évènement (procédure recettes_rattrapage_job, COMMIT après chacun),
-- ordre de verrouillage fixe (ligne source PUIS verrou de l'établissement — le même ordre que le paiement : UPDATE de la ligne
-- -> déclencheur -> verrou), lignes déjà verrouillées sautées (SKIP LOCKED : reprises au passage suivant), une seule
-- exécution à la fois.
create or replace function lx_prive.recettes_filet()
returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare v_depuis timestamptz; x record; v_n int := 0;
begin
  if not lx_prive.recettes_serveur_actif() then return 0; end if;
  -- 2026-10-28 (-5) : remboursements Stripe reçus avant la première activation -> ticketés maintenant (date réelle scellée)
  update public.recettes_en_ligne set statut = 'a_ticketer', derniere_erreur = null where statut = 'attente_activation';
  select coalesce((config->>'recettes_en_ligne_serveur_depuis')::timestamptz, now()) into v_depuis from public.app_config where id = 1;
  for x in select * from public.rdv_online where acompte_modele = 'ticket' and acompte_paye and acompte_tk_num is null and coalesce(acompte_montant,0) > 0
            and coalesce(status,'') <> 'done' and ticket_num is null and retenue_tk_num is null
            and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = rdv_online.salon_id and z.cle = 'acompte:' || rdv_online.id) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'acompte', x.id, 'acompte:' || x.id, x.acompte_montant, coalesce(x.acompte_paye_at, x.created_at), x.payment_intent_id, null, '{}'); v_n := v_n + 1;
  end loop;
  for x in select * from public.rdv_online where retenue_at is not null and retenue_tk_num is null and coalesce(acompte_modele,'') <> 'ticket' and acompte_paye
            and not coalesce(acompte_rembourse,false) and (retenue_claim_at is null or retenue_claim_at < now() - interval '15 minutes')
            and coalesce(acompte_montant,0) - coalesce(acompte_rembourse_montant,0) > 0.004
            and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = rdv_online.salon_id and z.cle = 'retenue:acompte:' || rdv_online.id) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'retenue', x.id, 'retenue:acompte:' || x.id, lx_prive.r2(x.acompte_montant - coalesce(x.acompte_rembourse_montant,0)), x.retenue_at, x.payment_intent_id, null, '{}'); v_n := v_n + 1;
  end loop;
  for x in select * from public.rdv_online where empreinte_status = 'captured' and empreinte_tk_num is null and coalesce(empreinte_captured_amount, empreinte_amount, 0) > 0
            and (empreinte_claim_at is null or empreinte_claim_at < now() - interval '15 minutes')
            and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = rdv_online.salon_id and z.cle = 'empreinte:' || rdv_online.id) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'empreinte', x.id, 'empreinte:' || x.id, coalesce(x.empreinte_captured_amount, x.empreinte_amount), coalesce(x.empreinte_captured_at, x.created_at), x.payment_intent_id, null, '{}'); v_n := v_n + 1;
  end loop;
  for x in select * from public.commandes_online where paye and recette_tk_num is null and recette_remb_tk_num is null and coalesce(mode_paiement,'en_ligne') = 'en_ligne'
            and status in ('a_preparer','prete') and coalesce(ticket_num, '') = '' and coalesce(total,0) > 0
            and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = commandes_online.salon_id and z.cle = 'cc:' || commandes_online.id) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'click_collect', x.id, 'cc:' || x.id, x.total, coalesce(x.paye_at, x.created_at), x.payment_intent_id, null, '{}'); v_n := v_n + 1;
  end loop;
  for x in select * from public.cartes_cadeaux where source = 'web' and payment_status = 'paid' and tk_num is null and not coalesce(is_offert,false) and created_at >= v_depuis
            and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = cartes_cadeaux.salon_id and z.cle = 'bon:' || cartes_cadeaux.id) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'bon_cadeau', x.id, 'bon:' || x.id, x.valeur, coalesce(x.paye_at, x.created_at), x.payment_intent_id, null, '{}'); v_n := v_n + 1;
  end loop;
  for x in select * from public.cartes_abo_clients where status = 'active' and coalesce(ticket_num,'') like 'cs\_%' and recette_tk_num is null and created_at >= v_depuis
            and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = cartes_abo_clients.salon_id and z.cle = 'carte:' || cartes_abo_clients.id) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'carte_abo', x.id, 'carte:' || x.id, coalesce(x.montant_paye, x.tarif), coalesce(x.paye_at, x.created_at), x.payment_intent_id, null, jsonb_build_object('session', x.ticket_num)); v_n := v_n + 1;
  end loop;
  for x in select r.*, e.value ev from public.rdv_online r, jsonb_array_elements(coalesce(r.remboursements,'[]'::jsonb)) e
            where r.acompte_modele = 'ticket' and r.acompte_tk_num is not null and (e.value->>'tk') is null and coalesce((e.value->>'montant')::numeric,0) > 0
              and lx_prive.refund_valide(e.value->>'refund_id')
              and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = r.salon_id and z.cle = 'rembacompte:' || r.id || ':' || (e.value->>'refund_id')) limit 50 loop
    perform lx_prive.recette_enfiler(x.salon_id, 'acompte_remb', x.id, 'rembacompte:' || x.id || ':' || (x.ev->>'refund_id'), (x.ev->>'montant')::numeric,
      coalesce((x.ev->>'at')::timestamptz, now()), x.payment_intent_id, x.ev->>'refund_id', jsonb_build_object('par', x.ev->>'par', 'at', x.ev->>'at')); v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Un évènement de la file (dans la transaction de l'appelant). Retourne {ok…} / {occupe:true} / {ok:false, erreur}.
create or replace function lx_prive.recette_rattraper_un(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare q public.recettes_en_ligne; r jsonb; v_row jsonb; v_new jsonb; v_tbl text; v_occ boolean := false; v_tid uuid;
begin
  perform set_config('lx.recette_en_cours', '1', true);
  select * into q from public.recettes_en_ligne where id = p_id and statut = 'a_ticketer' for update skip locked;
  if not found then return jsonb_build_object('ok', false, 'occupe', true); end if;
  -- 1) ligne source (verrou AVANT celui de l'établissement, pris par recette_tk_inserer)
  if q.source in ('acompte','acompte_remb','retenue','empreinte') then
    select to_jsonb(t) into v_row from public.rdv_online t where t.id = q.objet_id for update skip locked;
    if v_row is null then v_occ := exists (select 1 from public.rdv_online where id = q.objet_id); end if;
  elsif q.source in ('click_collect','click_collect_annul') then
    select to_jsonb(t) into v_row from public.commandes_online t where t.id = q.objet_id for update skip locked;
    if v_row is null then v_occ := exists (select 1 from public.commandes_online where id = q.objet_id); end if;
  elsif q.source = 'bon_cadeau' then
    select to_jsonb(t) into v_row from public.cartes_cadeaux t where t.id = q.objet_id for update skip locked;
    if v_row is null then v_occ := exists (select 1 from public.cartes_cadeaux where id = q.objet_id); end if;
  elsif q.source = 'carte_abo' then
    select to_jsonb(t) into v_row from public.cartes_abo_clients t where t.id = q.objet_id for update skip locked;
    if v_row is null then v_occ := exists (select 1 from public.cartes_abo_clients where id = q.objet_id); end if;
  else
    v_row := '{}'::jsonb; -- remb_externe : objet = ticket d'origine (details.ticket_id)
  end if;
  if v_occ then perform set_config('lx.recette_en_cours', '', true); return jsonb_build_object('ok', false, 'occupe', true); end if;
  if v_row is null then
    update public.recettes_en_ligne set statut = 'ignore', derniere_erreur = 'objet introuvable', traite_at = now() where id = q.id;
    perform set_config('lx.recette_en_cours', '', true); return jsonb_build_object('ok', false, 'erreur', 'objet introuvable');
  end if;
  -- 2) ticket d'origine d'un remboursement pas encore connu à l'enfilage
  if q.source = 'click_collect_annul' and (q.details->>'ticket_id') is null then
    select ticket_id into v_tid from public.recettes_en_ligne where salon_id = q.salon_id and cle = 'cc:' || q.objet_id and statut = 'tickete';
    if v_tid is null then perform set_config('lx.recette_en_cours', '', true); return jsonb_build_object('ok', false, 'erreur', 'LX_ATTENTE ticket d''origine'); end if;
    update public.recettes_en_ligne set details = details || jsonb_build_object('ticket_id', v_tid) where id = q.id returning * into q;
  end if;
  if q.source = 'remb_externe' and (q.details->>'ticket_id') is null and (q.details ? 'orig_cle') then
    select id into v_tid from public.tickets where salon_id = q.salon_id and raw_data->>(q.details->>'orig_cle') = q.details->>'orig_val' limit 1;
    if v_tid is null then perform set_config('lx.recette_en_cours', '', true); return jsonb_build_object('ok', false, 'erreur', 'LX_ATTENTE ticket d''origine'); end if;
    update public.recettes_en_ligne set details = details || jsonb_build_object('ticket_id', v_tid) where id = q.id returning * into q;
  end if;
  -- acompte : verrou d'un appareil posé il y a moins de 15 min -> on le laisse finir (son ticket sera repris par sa clé)
  if q.source = 'acompte' and (v_row->>'acompte_tk_claim_at') is not null and (v_row->>'acompte_tk_claim_at')::timestamptz > now() - interval '15 minutes'
     and q.essais = 0 then perform set_config('lx.recette_en_cours', '', true); return jsonb_build_object('ok', false, 'attente', 'verrou appareil'); end if;
  -- 3) ticket, puis marques sur la ligne source
  r := lx_prive.recette_traiter(q, v_row);
  if coalesce((r->>'ok')::boolean, false) then
    if q.source = 'acompte' then update public.rdv_online set acompte_tk_num = (r->>'tk_num')::int, acompte_tk_claim_at = coalesce(acompte_tk_claim_at, now()) where id = q.objet_id and acompte_tk_num is null;
    elsif q.source = 'retenue' then update public.rdv_online set retenue_tk_num = (r->>'tk_num')::int, retenue_claim_at = coalesce(retenue_claim_at, now()) where id = q.objet_id and retenue_tk_num is null;
    elsif q.source = 'empreinte' then update public.rdv_online set empreinte_tk_num = (r->>'tk_num')::int, empreinte_claim_at = coalesce(empreinte_claim_at, now()) where id = q.objet_id and empreinte_tk_num is null;
    elsif q.source = 'acompte_remb' then
      select coalesce(jsonb_agg(case when (ee.value->>'tk') is null and 'rembacompte:' || q.objet_id || ':' || coalesce(ee.value->>'refund_id', ee.value->>'at') = q.cle
                                     then ee.value || jsonb_build_object('tk', (r->>'tk_num')::int) else ee.value end order by ee.ordinality), '[]'::jsonb)
        into v_new from public.rdv_online t, jsonb_array_elements(coalesce(t.remboursements,'[]'::jsonb)) with ordinality ee where t.id = q.objet_id;
      update public.rdv_online set remboursements = v_new where id = q.objet_id;
    elsif q.source = 'click_collect' then update public.commandes_online set recette_tk_num = (r->>'tk_num')::int, ticket_num = coalesce(nullif(ticket_num, ''), r->>'tk_num') where id = q.objet_id;
    elsif q.source = 'click_collect_annul' then update public.commandes_online set recette_remb_tk_num = (r->>'tk_num')::int where id = q.objet_id;
    elsif q.source = 'bon_cadeau' then update public.cartes_cadeaux set tk_num = (r->>'tk_num')::int where id = q.objet_id and tk_num is null;
    elsif q.source = 'carte_abo' then update public.cartes_abo_clients set recette_tk_num = (r->>'tk_num')::int where id = q.objet_id;
    end if;
  end if;
  perform set_config('lx.recette_en_cours', '', true);
  return r;
end $$;

create or replace function lx_prive.recettes_alerte_attente()
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  -- alerte : évènement en attente depuis plus de 26 h (hors simple report de journée clôturée)
  if exists (select 1 from public.recettes_en_ligne where statut = 'a_ticketer' and created_at < now() - interval '26 hours') then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Recette(s) en ligne sans ticket depuis plus de 26 h', p_severity := 'critical',
      p_context := (select jsonb_agg(jsonb_build_object('id', id, 'source', source, 'erreur', derniere_erreur)) from (select * from public.recettes_en_ligne where statut = 'a_ticketer' and created_at < now() - interval '26 hours' limit 10) z));
    exception when others then null; end;
  end if;
end $$;

-- 2026-10-28 (-4, contre-audit constat 4) : BAIL DATÉ (table) au lieu d'un verrou de session (pg_try_advisory_lock). Le verrou
-- de session survivait à l'échec de l'appel (« call » dans une transaction ou dans une exécution à plusieurs requêtes : erreur
-- « invalid transaction termination ») : la connexion de l'éditeur gardait le verrou et la tâche planifiée (toutes les 5 min)
-- comme l'alerte « 26 h » s'arrêtaient sans bruit. Le bail est une LIGNE : prise ET validée immédiatement (COMMIT) ; si l'appel
-- échoue avant ce COMMIT, la prise est annulée avec la transaction (rien n'est laissé) ; si l'exécution s'interrompt après
-- (connexion coupée, délai dépassé), le bail EXPIRE seul (10 min, prolongé pendant le traitement). Une seule exécution à la fois.
create table if not exists lx_prive.recettes_bail (
  nom text primary key,
  jeton uuid not null,
  pris_at timestamptz not null default now(),
  expire_at timestamptz not null,
  par text
);
comment on table lx_prive.recettes_bail is 'Bail daté de la tâche de rattrapage des recettes en ligne (une exécution à la fois ; expire seul). 2026-10-28 (-4).';
revoke all on table lx_prive.recettes_bail from public, anon, authenticated;

-- Prise du bail : renvoie le jeton si pris, NULL si une autre exécution le détient (bail non expiré).
create or replace function lx_prive.recettes_bail_prendre(p_duree interval default interval '10 minutes')
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare v_j uuid := gen_random_uuid(); v_n int;
begin
  insert into lx_prive.recettes_bail as b (nom, jeton, pris_at, expire_at, par)
  values ('rattrapage', v_j, clock_timestamp(), clock_timestamp() + p_duree, coalesce(current_setting('application_name', true), '') || ' pid ' || pg_backend_pid())
  on conflict (nom) do update set jeton = excluded.jeton, pris_at = excluded.pris_at, expire_at = excluded.expire_at, par = excluded.par
   where b.expire_at < clock_timestamp();
  get diagnostics v_n = row_count;
  return case when v_n = 1 then v_j else null end;
end $$;
-- Prolongation (seulement par le détenteur) ; renvoie false si le bail a été perdu (expiré puis repris ailleurs).
create or replace function lx_prive.recettes_bail_prolonger(p_jeton uuid, p_duree interval default interval '10 minutes')
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare v_n int;
begin
  update lx_prive.recettes_bail set expire_at = clock_timestamp() + p_duree where nom = 'rattrapage' and jeton = p_jeton;
  get diagnostics v_n = row_count; return v_n = 1;
end $$;
create or replace function lx_prive.recettes_bail_rendre(p_jeton uuid)
returns void language sql security definer set search_path = public, pg_temp as $$
  update lx_prive.recettes_bail set expire_at = clock_timestamp() where nom = 'rattrapage' and jeton = p_jeton
$$;

-- Exécution en UNE transaction (appel MANUEL, essais : utilisable partout, y compris dans une transaction ou avec d'autres
-- requêtes : « select lx_prive.recettes_rattrapage(); »). Même ordre, mêmes sauts de lignes verrouillées. Ne s'exécute pas
-- pendant que la tâche planifiée détient le bail.
-- 2026-10-28 (-4, contre-audit constat 3) : interrupteur ÉTEINT -> seul le FILET (création de nouveaux évènements) s'arrête ;
-- les évènements déjà en file (bons, cartes, Click & Collect, remboursements…, que l'application ne sait pas reprendre) sont
-- toujours traités : une recette encaissée n'est jamais abandonnée.
create or replace function lx_prive.recettes_rattrapage()
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_id uuid; r jsonb; v_ok int := 0; v_ko int := 0; v_f int := 0; v_actif boolean := lx_prive.recettes_serveur_actif();
begin
  if exists (select 1 from lx_prive.recettes_bail where nom = 'rattrapage' and expire_at > clock_timestamp()) then
    return jsonb_build_object('actif', v_actif, 'occupe', true);
  end if;
  if v_actif then v_f := lx_prive.recettes_filet(); end if;
  for v_id in select id from public.recettes_en_ligne where statut = 'a_ticketer' order by salon_id, created_at limit 200 loop
    r := lx_prive.recette_rattraper_un(v_id);
    if coalesce((r->>'ok')::boolean, false) then v_ok := v_ok + 1; else v_ko := v_ko + 1; end if;
  end loop;
  perform lx_prive.recettes_alerte_attente();
  return jsonb_build_object('actif', v_actif, 'filet', v_f, 'tickets', v_ok, 'en_attente', v_ko);
end $$;

-- Tâche planifiée : UNE TRANSACTION PAR ÉVÈNEMENT (COMMIT). Procédure sans SECURITY DEFINER ni SET (obligatoire pour pouvoir
-- valider en cours de route) : noms qualifiés, exécutée par pg_cron (rôle postgres, mode libpq : cron.use_background_workers
-- = off relevé le 28/10/2026, pg_cron 1.6.4 -> « call » seul au niveau supérieur, COMMIT autorisé).
-- APPEL MANUEL : « call lx_prive.recettes_rattrapage_job(); » SEUL dans l'éditeur SQL (aucune autre requête dans la même
-- exécution, pas de begin/commit autour) ; sinon PostgreSQL refuse le COMMIT (« invalid transaction termination ») : l'appel
-- échoue SANS RIEN LAISSER (le bail pris dans la même transaction est annulé avec elle) et la tâche planifiée continue. Pour un
-- appel dans une transaction ou avec d'autres requêtes : « select lx_prive.recettes_rattrapage(); ».
create or replace procedure lx_prive.recettes_rattrapage_job()
language plpgsql as $$
declare v_ids uuid[]; v_id uuid; v_j uuid; v_i int := 0;
begin
  v_j := lx_prive.recettes_bail_prendre(interval '10 minutes');
  if v_j is null then return; end if; -- une autre exécution détient le bail (non expiré)
  commit; -- bail validé immédiatement (visible des autres exécutions)
  if lx_prive.recettes_serveur_actif() then perform lx_prive.recettes_filet(); end if; -- 2026-10-28 (-4) : filet seulement si allumé
  commit;
  select array_agg(id order by salon_id, created_at) into v_ids
    from (select id, salon_id, created_at from public.recettes_en_ligne where statut = 'a_ticketer' order by created_at limit 200) z;
  if v_ids is not null then
    foreach v_id in array v_ids loop
      perform lx_prive.recette_rattraper_un(v_id);
      v_i := v_i + 1;
      if v_i % 20 = 0 and not lx_prive.recettes_bail_prolonger(v_j) then commit; return; end if; -- bail perdu : on s'arrête
      commit;
    end loop;
  end if;
  perform lx_prive.recettes_alerte_attente();
  perform lx_prive.recettes_bail_rendre(v_j);
  commit;
end $$;

-- ===================================================================================================================== §8
-- Remboursement fait HORS Luxyra (tableau de bord Stripe, litige perdu…) OU remboursement Luxyra dont l'évènement
-- charge.refunded arrive avant que le worker ait enregistré le refund_id : appelé par le worker (évènement relu chez Stripe
-- au nom du compte, métadonnées du remboursement transmises). Idempotent par refund_id ; cumul plafonné au montant encaissé.
-- 2026-10-28 (-3) : constats MAJEUR 1 (C&C : clé « cc_annul » partagée), MAJEUR 5 (acompte conservé, empreinte capturée,
-- recherche par rdv_online.payment_intent_id, alerte si inconnu), mineurs (plafond, carte d'abonnement désactivée).
drop function if exists public.lx_recette_remboursement_externe(text, text, bigint, timestamptz);
create or replace function public.lx_recette_remboursement_externe(p_pi text, p_refund_id text, p_cents bigint, p_at timestamptz default now(), p_meta jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_o public.recettes_en_ligne; q public.recettes_en_ligne; r jsonb; v_m numeric := round(coalesce(p_cents,0)::numeric) / 100;
  v_rdv public.rdv_online; v_cmd public.commandes_online; v_tk public.tickets; v_cid uuid; v_rid uuid; v_reste numeric; v_cle text; v_val text;
  v_meta jsonb := coalesce(p_meta, '{}'::jsonb);
begin
  if coalesce(p_pi,'') = '' or not lx_prive.refund_valide(p_refund_id) or v_m <= 0 then return jsonb_build_object('ok', false, 'erreur', 'paramètres'); end if;
  -- déjà connu (remboursement enregistré par Luxyra, ou déjà traité ici)
  if exists (select 1 from public.recettes_en_ligne where refund_id = p_refund_id and statut <> 'ignore')
     or exists (select 1 from public.commandes_online where refund_id = p_refund_id and recette_remb_tk_num is not null)
     or exists (select 1 from public.rdv_online r2, jsonb_array_elements(coalesce(r2.remboursements,'[]'::jsonb)) e where e.value->>'refund_id' = p_refund_id)
     or exists (select 1 from public.rdv_online where refund_id = p_refund_id and not coalesce(acompte_paye, false)) then -- remboursement d'un paiement jamais enregistré (montant incohérent)
    return jsonb_build_object('ok', true, 'deja', true);
  end if;
  if (v_meta->>'commande_id') ~ '^[0-9a-f-]{36}$' then v_cid := (v_meta->>'commande_id')::uuid; end if;
  if (v_meta->>'rdv_id') ~ '^[0-9a-f-]{36}$' then v_rid := (v_meta->>'rdv_id')::uuid; end if;

  -- 1) CLICK & COLLECT (métadonnée commande_id posée par Luxyra, sinon payment_intent de la commande)
  select * into v_cmd from public.commandes_online where (v_cid is not null and id = v_cid) or (v_cid is null and payment_intent_id = p_pi) order by created_at limit 1;
  if v_cmd.id is not null then
    if v_cmd.recette_remb_tk_num is not null then return jsonb_build_object('ok', true, 'deja', true, 'commande', v_cmd.id); end if;
    select * into v_o from public.recettes_en_ligne where salon_id = v_cmd.salon_id and cle = 'cc:' || v_cmd.id;
    if v_o.id is null or v_o.statut <> 'tickete' then
      begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Remboursement Stripe d''une commande Click & Collect sans ticket de paiement serveur (payée avant la mise en service ?) : à traiter en caisse (avoir)', p_severity := 'critical',
        p_context := jsonb_build_object('commande', v_cmd.id, 'refund', p_refund_id, 'montant', v_m)); exception when others then null; end;
      return jsonb_build_object('ok', false, 'inconnu', true, 'commande', v_cmd.id);
    end if;
    if v_m >= coalesce(v_cmd.total, 0) - 0.004 and coalesce(v_cmd.status, '') <> 'retiree' then
      -- annulation remboursée : clé « cc_annul:<commande> » partagée avec le déclencheur de l'annulation par Luxyra
      q := lx_prive.recette_enfiler(v_cmd.salon_id, 'click_collect_annul', v_cmd.id, 'cc_annul:' || v_cmd.id, v_cmd.total, p_at, p_pi, p_refund_id,
             jsonb_build_object('ticket_id', v_o.ticket_id, 'par', 'stripe'));
      perform set_config('lx.recette_en_cours', '1', true);
      r := lx_prive.recette_traiter(q, to_jsonb(v_cmd));
      if coalesce((r->>'ok')::boolean, false) then update public.commandes_online set recette_remb_tk_num = (r->>'tk_num')::int where id = v_cmd.id and recette_remb_tk_num is null; end if;
      perform set_config('lx.recette_en_cours', '', true);
      return r;
    end if;
    v_cle := 'remb:' || p_refund_id;
    q := lx_prive.recette_enfiler(v_cmd.salon_id, 'remb_externe', v_o.objet_id, v_cle, v_m, p_at, p_pi, p_refund_id, jsonb_build_object('ticket_id', v_o.ticket_id, 'origine', 'click_collect'));
    perform set_config('lx.recette_en_cours', '1', true);
    r := lx_prive.recette_traiter(q, '{}'::jsonb);
    perform set_config('lx.recette_en_cours', '', true);
    return r;
  end if;

  -- 2) RENDEZ-VOUS : acompte (nouveau modèle), acompte conservé (ancien modèle), empreinte capturée — métadonnée rdv_id ou
  --    payment_intent du rendez-vous (tickets créés avant la mise en service par l'application compris)
  select * into v_rdv from public.rdv_online where (v_rid is not null and id = v_rid) or (v_rid is null and payment_intent_id = p_pi) order by created_at limit 1 for update;
  if v_rdv.id is not null then
    if v_rdv.empreinte_status = 'captured' then
      v_cle := 'retenueKey'; v_val := 'empreinte:' || v_rdv.id;
    elsif coalesce(v_rdv.acompte_modele, '') = 'ticket' and coalesce(v_rdv.acompte_paye, false) then
      -- acompte en caisse dès le paiement : entrée d'historique -> ticket négatif par le déclencheur (clé partagée avec l'app)
      v_reste := lx_prive.r2(coalesce(v_rdv.acompte_montant,0) - coalesce(v_rdv.acompte_rembourse_montant,0));
      if v_reste <= 0.004 then
        begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Remboursement Stripe d''un acompte déjà entièrement remboursé : ignoré', p_severity := 'warning',
          p_context := jsonb_build_object('rdv', v_rdv.id, 'refund', p_refund_id, 'montant', v_m)); exception when others then null; end;
        return jsonb_build_object('ok', false, 'refus', true, 'erreur', 'acompte déjà remboursé');
      end if;
      v_m := least(v_m, v_reste);
      update public.rdv_online set remboursements = coalesce(remboursements,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', p_at, 'montant', v_m, 'refund_id', p_refund_id, 'par', 'externe')),
        acompte_rembourse_montant = lx_prive.r2(coalesce(acompte_rembourse_montant,0) + v_m),
        acompte_rembourse = lx_prive.r2(coalesce(acompte_rembourse_montant,0) + v_m) >= coalesce(acompte_montant,0) - 0.004,
        refund_id = p_refund_id, refunded_at = p_at
       where id = v_rdv.id;
      return jsonb_build_object('ok', true, 'acompte', true, 'montant', v_m);
    elsif coalesce(v_rdv.acompte_paye, false) and (v_rdv.retenue_tk_num is not null or v_rdv.retenue_at is not null) then
      v_cle := 'retenueKey'; v_val := 'acompte:' || v_rdv.id;
    elsif coalesce(v_rdv.acompte_paye, false) then
      -- ancien modèle, acompte encore en avance (hors chiffre d'affaires, aucun ticket) : remboursement enregistré sur le RDV
      v_reste := lx_prive.r2(coalesce(v_rdv.acompte_montant,0) - coalesce(v_rdv.acompte_rembourse_montant,0));
      v_m := least(v_m, greatest(v_reste, 0));
      if v_m <= 0.004 then return jsonb_build_object('ok', false, 'refus', true, 'erreur', 'acompte déjà remboursé'); end if;
      update public.rdv_online set remboursements = coalesce(remboursements,'[]'::jsonb) || jsonb_build_array(jsonb_build_object('at', p_at, 'montant', v_m, 'refund_id', p_refund_id, 'par', 'externe')),
        acompte_rembourse_montant = lx_prive.r2(coalesce(acompte_rembourse_montant,0) + v_m),
        acompte_rembourse = lx_prive.r2(coalesce(acompte_rembourse_montant,0) + v_m) >= coalesce(acompte_montant,0) - 0.004,
        refund_id = p_refund_id, refunded_at = p_at
       where id = v_rdv.id;
      return jsonb_build_object('ok', true, 'hors_caisse', true, 'montant', v_m);
    end if;
    if v_cle is not null then
      -- acompte conservé / empreinte encaissée : ticket négatif référençant le ticket d'origine (serveur OU application)
      select * into v_tk from public.tickets where salon_id = v_rdv.salon_id and raw_data->>v_cle = v_val order by num limit 1;
      -- 2026-10-28 (-5, contre-audit final constat 5) : AVANT LA PREMIÈRE ACTIVATION (étapes 1 à 5 : interrupteur jamais allumé)
      -- AUCUN ticket n'est créé par le serveur (une application 6.6 ne reprend pas les copies du serveur : sa Z différerait du
      -- journal ; rien ne doit être créé avant l'étape 6). Le remboursement n'est pas perdu : il est consigné dans la file
      -- (statut « attente_activation », date du remboursement conservée) et son ticket négatif est créé par le serveur DÈS
      -- l'activation (recettes_filet), date réelle du remboursement scellée (items[0].lxRep) et signalée dans les exports
      -- (ventes reportées) ; administrateur alerté, établissement prévenu (carte « Caisse » : rien à saisir — un retour saisi en
      -- caisse ferait double emploi ; le retour partiel d'un ticket d'acompte conservé est d'ailleurs refusé par la base).
      -- Interrupteur déjà allumé une fois (retour arrière ensuite) : ticket négatif du serveur tout de suite, comme avant
      -- (l'application 6.8.3 reprend les copies : lxRecettesServeurReprise).
      if not lx_prive.recettes_serveur_actif() and not lx_prive.recettes_serveur_deja_active() then
        q := lx_prive.recette_enfiler(v_rdv.salon_id, 'remb_externe', v_rdv.id, 'remb:' || p_refund_id, v_m, p_at, p_pi, p_refund_id,
               jsonb_build_object('ticket_id', v_tk.id, 'tk_origine', coalesce(v_tk.raw_data->>'tkNum', v_tk.num::text), 'origine', case when v_val like 'empreinte:%' then 'empreinte' else 'retenue' end,
                 'orig_cle', v_cle, 'orig_val', v_val, 'differe', true));
        update public.recettes_en_ligne set statut = 'attente_activation',
               derniere_erreur = 'Remboursement Stripe reçu avant l''activation : ticket négatif créé par le serveur à l''activation (ticket d''origine n° ' || coalesce(v_tk.raw_data->>'tkNum', v_tk.num::text, '?') || ')'
         where id = q.id and statut = 'a_ticketer';
        begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Remboursement Stripe de ' || to_char(v_m, 'FM999999990.00') || ' EUR (acompte conservé / empreinte, ticket n° ' || coalesce(v_tk.raw_data->>'tkNum', v_tk.num::text, '?') || ') reçu avant l''activation : ticket négatif créé à l''activation (étape 6) — rien à saisir en caisse',
          p_severity := 'warning', p_context := jsonb_build_object('salon_id', v_rdv.salon_id, 'rdv', v_rdv.id, 'refund', p_refund_id, 'montant', v_m, 'ticket_origine', v_tk.id)); exception when others then null; end;
        return jsonb_build_object('ok', false, 'attente_activation', true, 'montant', v_m, 'ticket_origine', coalesce(v_tk.raw_data->>'tkNum', v_tk.num::text));
      end if;
      q := lx_prive.recette_enfiler(v_rdv.salon_id, 'remb_externe', v_rdv.id, 'remb:' || p_refund_id, v_m, p_at, p_pi, p_refund_id,
             jsonb_build_object('ticket_id', v_tk.id, 'origine', case when v_val like 'empreinte:%' then 'empreinte' else 'retenue' end, 'orig_cle', v_cle, 'orig_val', v_val));
      if v_tk.id is null then return jsonb_build_object('ok', false, 'attente', true, 'erreur', 'ticket d''origine pas encore créé : traité par le rattrapage'); end if;
      perform set_config('lx.recette_en_cours', '1', true);
      r := lx_prive.recette_traiter(q, '{}'::jsonb);
      perform set_config('lx.recette_en_cours', '', true);
      return r;
    end if;
  end if;

  -- 3) BON CADEAU / CARTE D'ABONNEMENT vendus en ligne (file), sinon par leur payment_intent
  select * into v_o from public.recettes_en_ligne where payment_intent = p_pi and source in ('bon_cadeau','carte_abo','acompte','click_collect','retenue','empreinte')
     and statut = 'tickete' order by created_at limit 1;
  if v_o.id is null then
    select z.* into v_o from public.recettes_en_ligne z where z.statut = 'tickete' and (
        (z.source = 'bon_cadeau' and z.objet_id = (select id from public.cartes_cadeaux where payment_intent_id = p_pi limit 1))
     or (z.source = 'carte_abo' and z.objet_id = (select id from public.cartes_abo_clients where payment_intent_id = p_pi limit 1))) limit 1;
  end if;
  if v_o.id is null then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := 'Remboursement Stripe sans paiement connu en caisse (aucun ticket créé) : à vérifier et, si besoin, à enregistrer par un avoir en caisse', p_severity := 'critical',
      p_context := jsonb_build_object('payment_intent', p_pi, 'refund', p_refund_id, 'montant', v_m, 'metadata', v_meta)); exception when others then null; end;
    return jsonb_build_object('ok', false, 'inconnu', true);
  end if;
  q := lx_prive.recette_enfiler(v_o.salon_id, 'remb_externe', v_o.objet_id, 'remb:' || p_refund_id, v_m, p_at, p_pi, p_refund_id,
         jsonb_build_object('ticket_id', v_o.ticket_id, 'origine', v_o.source));
  perform set_config('lx.recette_en_cours', '1', true);
  r := lx_prive.recette_traiter(q, '{}'::jsonb);
  if coalesce((r->>'ok')::boolean, false) then
    if v_o.source = 'bon_cadeau' and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = v_o.salon_id and z.source = 'remb_externe' and z.objet_id = v_o.objet_id
         and z.statut = 'tickete' having sum(z.montant) < v_o.montant - 0.004) then
      update public.cartes_cadeaux set status = 'voided', restant = 0 where id = v_o.objet_id and coalesce(utilise,0) = 0;
    elsif v_o.source = 'carte_abo' and not exists (select 1 from public.recettes_en_ligne z where z.salon_id = v_o.salon_id and z.source = 'remb_externe' and z.objet_id = v_o.objet_id
         and z.statut = 'tickete' having sum(z.montant) < v_o.montant - 0.004) then
      -- carte remboursée en totalité : désactivée (plus de remise)
      update public.cartes_abo_clients set status = 'cancelled' where id = v_o.objet_id and status = 'active';
    end if;
  end if;
  perform set_config('lx.recette_en_cours', '', true);
  return r;
end $$;

-- Lecture pour l'application : plancher de la numérotation imprimée DES APPAREILS (les tickets du serveur ont leur propre
-- série 900001+ et sont exclus : 2026-10-28 -3). Sert à éviter qu'un appareil réutilise un n° pris par un autre appareil.
create or replace function public.lx_tk_num_imprime_max(p_salon uuid)
returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select case when exists (select 1 from public.salons s where s.id = p_salon and (s.user_id = auth.uid() or public.is_admin()))
    then greatest(coalesce((select max((raw_data->>'tkNum')::int) from public.tickets where salon_id = p_salon and (raw_data->>'tkNum') ~ '^[0-9]{1,9}$'
                                and coalesce(raw_data->>'serveur', '') <> 'true' and (raw_data->>'tkNum')::int <= lx_prive.recette_serie_base()), 0),
                  coalesce((select max(ticket_num) from public.appointments where salon_id = p_salon and ticket_num <= lx_prive.recette_serie_base()), 0)) else null end
$$;

-- RETOUR ARRIÈRE propre (2026-10-28 -3, mineur ; 2026-10-28 -4, contre-audit constat 3) : éteint l'interrupteur et rend à
-- l'application UNIQUEMENT ce qu'elle sait reprendre elle-même (ancien circuit, clés partagées) : acomptes en ligne, leurs
-- remboursements, acomptes conservés, empreintes capturées — évènements en file écartés (« ignore ») et verrous posés par le
-- serveur effacés (acompte_tk_claim_at, retenue_claim_at, empreinte_claim_at sans ticket). Tout le RESTE de la file (bons
-- cadeaux, cartes d'abonnement, Click & Collect et leurs annulations, remboursements faits sur Stripe) reste « à ticketer » et
-- continue d'être traité par la tâche de rattrapage, interrupteur éteint (seul le filet de création s'arrête) : l'application
-- ne les enregistre pas, les écarter ferait perdre la recette. Ils sont comptés dans le résultat et signalés (alerte). Les
-- tickets déjà créés restent.
create or replace function lx_prive.recettes_desactiver(p_motif text default 'retour arrière')
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n_q int := 0; n_a int := 0; n_r int := 0; n_e int := 0; n_g int := 0; v_garde jsonb;
  c_reprenables constant text[] := array['acompte','acompte_remb','retenue','empreinte'];
begin
  update public.app_config set config = config - 'recettes_en_ligne_serveur' where id = 1;
  update public.rdv_online r set acompte_tk_claim_at = null from public.recettes_en_ligne q
   where q.statut = 'a_ticketer' and q.source = 'acompte' and q.objet_id = r.id and r.acompte_tk_num is null;
  get diagnostics n_a = row_count;
  update public.rdv_online r set retenue_claim_at = null from public.recettes_en_ligne q
   where q.statut = 'a_ticketer' and q.source = 'retenue' and q.objet_id = r.id and r.retenue_tk_num is null;
  get diagnostics n_r = row_count;
  update public.rdv_online r set empreinte_claim_at = null from public.recettes_en_ligne q
   where q.statut = 'a_ticketer' and q.source = 'empreinte' and q.objet_id = r.id and r.empreinte_tk_num is null;
  get diagnostics n_e = row_count;
  update public.recettes_en_ligne set statut = 'ignore', derniere_erreur = left('Désactivation (repris par l''application) : ' || coalesce(p_motif, ''), 500), traite_at = now()
   where statut = 'a_ticketer' and source = any (c_reprenables);
  get diagnostics n_q = row_count;
  select coalesce(sum(n), 0)::int, coalesce(jsonb_object_agg(source, n), '{}'::jsonb) into n_g, v_garde
    from (select source, count(*) n from public.recettes_en_ligne where statut = 'a_ticketer' group by source) z;
  insert into public.audit_log (salon_id, action, details, operator_name)
  values (null, 'RECETTES_EN_LIGNE_DESACTIVEES', 'Interrupteur recettes_en_ligne_serveur éteint (' || coalesce(p_motif,'') || ') : ' || n_q
    || ' évènement(s) rendu(s) à l''application (acomptes, remboursements d''acompte, acomptes conservés, empreintes), verrous effacés : acompte '
    || n_a || ', retenue ' || n_r || ', empreinte ' || n_e || ' ; ' || n_g || ' évènement(s) toujours traité(s) par le serveur ' || v_garde::text, 'Serveur Luxyra');
  if n_g > 0 then
    begin perform public.report_server_error(p_source := 'sql:recettes_en_ligne', p_message := n_g || ' recette(s) en ligne en attente gardée(s) par le serveur après la désactivation (l''application ne les reprend pas) : toujours traitées par la tâche de rattrapage', p_severity := 'warning',
      p_context := jsonb_build_object('par_source', v_garde, 'motif', p_motif)); exception when others then null; end;
  end if;
  return jsonb_build_object('rendus_application', n_q, 'verrous_acompte', n_a, 'verrous_retenue', n_r, 'verrous_empreinte', n_e,
    'gardes_serveur', n_g, 'gardes_par_source', v_garde);
end $$;

-- ===================================================================================================================== §8 bis
-- 2026-10-28 (-3, mineur) : VERROU DE L'ÉTABLISSEMENT dans le contrôle Z / journal. Sans lui, un ticket serveur (paiement
-- en ligne) pouvait s'insérer entre la lecture du journal par la Z et l'enregistrement de la Z : Z juste au moment du contrôle
-- mais journal du jour complété ensuite. Avec le verrou (le même que ticket_nf525_insert), la Z et les tickets de
-- l'établissement sont sérialisés : un ticket qui attend la Z voit ensuite la journée close (tickets_block_post_cloture,
-- LX_JOUR_CLOS -> report au lendemain par le serveur).
-- 2026-10-28 (-5, contre-audit final, constats 1 à 3) : JOURNÉES RETENUES. Une journée « retenue » est une journée sans Z qui
-- a des tickets au journal, ou des rendez-vous ENCAISSÉS (status done + n° de ticket, hors copies des tickets du serveur) dont
-- le ticket est ABSENT du journal (recherche par identifiant raw_data.id, avec et sans préfixe « online_ », sur toutes les
-- dates : un ticket reporté sur une journée ouverte est retrouvé), sauf ventes consignées par un forçage tracé
-- (public.clotures_forcages). Règles : (a) la Z d'une journée est refusée tant qu'une journée ANTÉRIEURE (60 jours) est retenue
-- (LX_Z_JOURNEE_ANTERIEURE_OUVERTE) : les Z restent numérotées dans l'ordre des dates et leurs cumuls (mois, année, grand
-- total) n'incluent jamais une journée postérieure ; (b) la Z d'une journée est refusée si des ventes encaissées de cette
-- journée ne sont pas au journal (LX_Z_VENTES_NON_TRANSMISES), sauf forçage tracé par un administrateur (lx_z_forcer) après
-- tentative de renvoi ; (c) aucune clôture mensuelle, annuelle ou d'exercice tant qu'une journée de la période est retenue
-- (refus tracé + alerte, nouvel essai automatique chaque jour). Définitions de production relues le 28/10/2026, seules les
-- lignes marquées LX_JOURNEES_2026_10_28 sont ajoutées.

-- Forçage tracé d'une clôture Z malgré des ventes non transmises (jamais modifié ni supprimé)
create table if not exists public.clotures_forcages (
  id uuid primary key default gen_random_uuid(),
  salon_id uuid not null,
  date_journee date not null,
  rdv jsonb not null,
  nb integer not null,
  montant numeric not null,
  motif text not null,
  operateur text,
  renvoi jsonb not null default '{}'::jsonb,
  cree_par uuid,
  created_at timestamptz not null default now()
);
create index if not exists clotures_forcages_jour on public.clotures_forcages (salon_id, date_journee);
alter table public.clotures_forcages enable row level security;
drop policy if exists clotures_forcages_lecture on public.clotures_forcages;
create policy clotures_forcages_lecture on public.clotures_forcages for select to authenticated
  using (exists (select 1 from public.salons s where s.id = clotures_forcages.salon_id and s.user_id = auth.uid()) or public.is_admin());
revoke all on public.clotures_forcages from anon, authenticated;
grant select on public.clotures_forcages to authenticated;
grant select on public.clotures_forcages to service_role;
create or replace function lx_prive.clotures_forcages_inalterables()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'NF525 : un forçage de clôture est inaltérable (% impossible).', TG_OP using errcode = 'P0001';
end $$;
drop trigger if exists clotures_forcages_inalterables on public.clotures_forcages;
create trigger clotures_forcages_inalterables before update or delete on public.clotures_forcages for each row execute function lx_prive.clotures_forcages_inalterables();

-- Jour courant (heure de Paris)
create or replace function lx_prive.jour_paris()
returns date language sql stable as $$ select (now() at time zone 'Europe/Paris')::date $$;

-- Rendez-vous ENCAISSÉS du jour dont le ticket est absent du journal (p_hors_forces : hors ventes déjà consignées par un forçage)
create or replace function lx_prive.z_rdv_hors_journal(p_salon uuid, p_date date, p_hors_forces boolean default true)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id::text, 'ticket_num', coalesce(a.ticket_num::text, a.meta->>'tkNum', a.meta->>'tkNumServeur'),
           'heure', a.heure, 'prix', lx_prive.r2(a.prix)) order by a.heure, a.id), '[]'::jsonb)
    from public.appointments a
   where a.salon_id = p_salon and a.date_rdv = p_date and a.status = 'done' and not coalesce(a.cancelled, false)
     and coalesce(a.meta->>'serveur', '') <> 'true'
     and (a.ticket_num is not null or a.meta->>'tkNum' is not null or a.meta->>'tkNumServeur' is not null)
     and not exists (select 1 from public.tickets t where t.salon_id = p_salon and t.raw_data->>'id' in (a.id::text, 'online_' || a.id::text))
     and (not p_hors_forces or not exists (select 1 from public.clotures_forcages f where f.salon_id = p_salon and f.date_journee = p_date
                                             and f.rdv @> jsonb_build_array(jsonb_build_object('id', a.id::text))))
$$;

-- Journées RETENUES (sans Z) d'une période : [{date, tickets, montant, rdv_hors_journal:[…]}] par date croissante
create or replace function lx_prive.journees_non_closes(p_salon uuid, p_debut date, p_fin date)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with m as (select mode_caisse from public.salons where id = p_salon),
  d as (
    select t.date_ticket j from public.tickets t, m
     where t.salon_id = p_salon and t.date_ticket between p_debut and p_fin and t.status <> 'cancelled'
       and (t.mode_caisse is null or m.mode_caisse is null or t.mode_caisse = m.mode_caisse)
    union
    select a.date_rdv from public.appointments a
     where a.salon_id = p_salon and a.date_rdv between p_debut and p_fin and a.status = 'done' and not coalesce(a.cancelled, false)
       and coalesce(a.meta->>'serveur', '') <> 'true'
       and (a.ticket_num is not null or a.meta->>'tkNum' is not null or a.meta->>'tkNumServeur' is not null)),
  c as (
    select x.j, (select count(*) from public.tickets t, m where t.salon_id = p_salon and t.date_ticket = x.j and t.status <> 'cancelled'
                   and (t.mode_caisse is null or m.mode_caisse is null or t.mode_caisse = m.mode_caisse)) nb,
           (select coalesce(sum(t.total_ttc), 0) from public.tickets t, m where t.salon_id = p_salon and t.date_ticket = x.j and t.status <> 'cancelled'
                   and (t.mode_caisse is null or m.mode_caisse is null or t.mode_caisse = m.mode_caisse)) mt,
           lx_prive.z_rdv_hors_journal(p_salon, x.j, true) rh
      from (select distinct j from d) x
     where not exists (select 1 from public.clotures z where z.salon_id = p_salon and z.date_cloture = x.j))
  select coalesce(jsonb_agg(jsonb_build_object('date', j, 'tickets', nb, 'montant', lx_prive.r2(mt), 'rdv_hors_journal', rh) order by j), '[]'::jsonb)
    from c where nb > 0 or jsonb_array_length(rh) > 0
$$;

-- Alerte (administrateur Luxyra : server_errors ; établissement : carte « Caisse » de l'application, lx_caisse_alertes)
create or replace function lx_prive.periode_alerter(p_salon uuid, p_action text, p_message text, p_contexte jsonb)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  begin
    insert into public.audit_log (salon_id, action, details, operator_name) values (p_salon, p_action, left(p_message, 1900), 'Serveur Luxyra');
  exception when others then null; end;
  begin
    perform public.report_server_error(p_source := 'sql:clotures', p_message := p_message, p_severity := 'critical',
      p_context := coalesce(p_contexte, '{}'::jsonb) || jsonb_build_object('salon_id', p_salon, 'action', p_action));
  exception when others then null; end;
end $$;

CREATE OR REPLACE FUNCTION lx_prive.clotures_controle_journal()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_somme numeric; v_nb int; v_bypass text; v_d record; v_auto boolean;
  v_ant jsonb; v_rdv jsonb; -- LX_JOURNEES_2026_10_28
begin
  -- LX_VERROU_Z_2026_10_28 : même verrou que ticket_nf525_insert / recette_tk_inserer (réentrant dans la transaction)
  perform pg_advisory_xact_lock(hashtext(NEW.salon_id::text));
  begin v_bypass := current_setting('luxyra.allow_nf525_unlock', true); exception when others then v_bypass := null; end;
  -- LX_JOURNEES_2026_10_28 : (a) journée antérieure retenue ; (b) ventes encaissées du jour absentes du journal (hors forçage)
  v_ant := lx_prive.journees_non_closes(NEW.salon_id, NEW.date_cloture - 60, NEW.date_cloture - 1);
  v_rdv := lx_prive.z_rdv_hors_journal(NEW.salon_id, NEW.date_cloture, true);
  if (jsonb_array_length(v_ant) > 0 or jsonb_array_length(v_rdv) > 0) and v_bypass = 'true' then
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (NEW.salon_id, 'NF525_INALTERABILITE_BYPASSEE', left('INSERT clotures Z n°' || NEW.num || ' du ' || NEW.date_cloture || ' malgré journées retenues ' || v_ant::text || ' / ventes non transmises ' || v_rdv::text || ' user=' || current_user, 1900), 'BYPASS_EXPLICITE');
  elsif jsonb_array_length(v_ant) > 0 then
    raise exception 'LX_Z_JOURNEE_ANTERIEURE_OUVERTE : clôture Z du % refusée — la journée du % n''est pas clôturée (% ticket(s) au journal, % vente(s) encaissée(s) non transmise(s)). Les clôtures se font dans l''ordre des dates : faites transmettre les ventes en attente (appareil à mettre à jour ou à reconnecter) ; la clôture automatique de nuit clôturera ensuite les journées dans l''ordre.',
      to_char(NEW.date_cloture, 'DD/MM/YYYY'), to_char((v_ant->0->>'date')::date, 'DD/MM/YYYY'), v_ant->0->>'tickets', jsonb_array_length(v_ant->0->'rdv_hors_journal')
      using errcode = 'P0001';
  elsif jsonb_array_length(v_rdv) > 0 then
    raise exception 'LX_Z_VENTES_NON_TRANSMISES : clôture Z du % refusée — % vente(s) encaissée(s) ce jour (ticket(s) n° %, % EUR) ne sont pas au journal des tickets. Faites transmettre les tickets en attente (appareil à mettre à jour ou à reconnecter) puis relancez la clôture ; à défaut, un administrateur peut forcer la clôture (forçage tracé).',
      to_char(NEW.date_cloture, 'DD/MM/YYYY'), jsonb_array_length(v_rdv),
      (select string_agg(coalesce(e->>'ticket_num', '?'), ', ') from jsonb_array_elements(v_rdv) e),
      (select to_char(coalesce(sum((e->>'prix')::numeric), 0), 'FM999999990.00') from jsonb_array_elements(v_rdv) e)
      using errcode = 'P0001';
  end if;
  select coalesce(sum(t.total_ttc), 0), count(*) into v_somme, v_nb from public.tickets t
   where t.salon_id = NEW.salon_id and t.date_ticket = NEW.date_cloture and t.status <> 'cancelled'
     and (t.mode_caisse is null or NEW.mode_caisse is null or t.mode_caisse = NEW.mode_caisse);
  v_auto := coalesce(NEW.raw_data->>'auto', '') = 'true';
  if abs(coalesce(NEW.total_ca, 0) - v_somme) > 0.005 or (not v_auto and coalesce(NEW.nb_tickets, 0) > v_nb) then
    if v_bypass = 'true' then
      insert into public.audit_log (salon_id, action, details, operator_name)
      values (NEW.salon_id, 'NF525_INALTERABILITE_BYPASSEE', 'INSERT clotures Z n°' || NEW.num || ' différente du journal (' || NEW.total_ca || ' vs ' || v_somme || ') user=' || current_user, 'BYPASS_EXPLICITE');
    else
      raise exception 'LX_Z_ECART_JOURNAL : clôture Z n°% du % refusée — % EUR / % ticket(s) déclarés, journal des tickets % EUR / % ticket(s). Recalculez la clôture depuis les tickets enregistrés.',
        NEW.num, to_char(NEW.date_cloture, 'DD/MM/YYYY'), to_char(coalesce(NEW.total_ca, 0), 'FM999999990.00'), coalesce(NEW.nb_tickets, 0), to_char(v_somme, 'FM999999990.00'), v_nb
        using errcode = 'P0001';
    end if;
  end if;
  if coalesce(NEW.raw_data->>'lxAnnotOk', '') <> 'true' and exists (select 1 from public.clotures_annotations a where a.salon_id = NEW.salon_id and a.cloture_date < NEW.date_cloture) then
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('month', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_ca, 0) <> 0 then NEW.cumul_mois_ca := coalesce(NEW.cumul_mois_ca, 0) + v_d.d_ca; end if;
    select * into v_d from public.nf525_z_annotation_delta(NEW.salon_id, date_trunc('year', NEW.date_cloture)::date, NEW.date_cloture - 1);
    if coalesce(v_d.d_ca, 0) <> 0 then NEW.cumul_annee_ca := coalesce(NEW.cumul_annee_ca, 0) + v_d.d_ca; end if;
  end if;
  return NEW;
end $function$;

-- Contrôle AVANT la Z (application) : ventes du jour non transmises, journées antérieures retenues, forçages existants.
-- Chaque contrôle qui trouve des ventes non transmises est tracé (CLOTURE_Z_VENTES_NON_TRANSMISES) : le forçage exige deux
-- contrôles successifs (avant et après la tentative de renvoi des tickets en attente).
create or replace function public.lx_z_controle_ventes(p_salon uuid, p_date date)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rdv jsonb; v_ant jsonb; v_f jsonb;
begin
  if not exists (select 1 from public.salons s where s.id = p_salon and (s.user_id = auth.uid() or public.is_admin())) then
    return jsonb_build_object('ok', false, 'erreur', 'acces');
  end if;
  v_rdv := lx_prive.z_rdv_hors_journal(p_salon, p_date, true);
  v_ant := lx_prive.journees_non_closes(p_salon, p_date - 60, p_date - 1);
  select coalesce(jsonb_agg(jsonb_build_object('at', f.created_at, 'nb', f.nb, 'montant', f.montant, 'operateur', f.operateur) order by f.created_at), '[]'::jsonb)
    into v_f from public.clotures_forcages f where f.salon_id = p_salon and f.date_journee = p_date;
  if jsonb_array_length(v_rdv) > 0 then
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (p_salon, 'CLOTURE_Z_VENTES_NON_TRANSMISES', left(p_date::text || ' - contrôle avant clôture : ' || jsonb_array_length(v_rdv) || ' vente(s) encaissée(s) absente(s) du journal ' || v_rdv::text, 1900), 'Contrôle de clôture');
  end if;
  return jsonb_build_object('ok', true, 'date', p_date, 'ventes_non_transmises', v_rdv, 'journees_anterieures', v_ant, 'forcages', v_f);
end $$;

-- FORÇAGE TRACÉ d'une clôture malgré des ventes non transmises : administrateur de l'établissement (code PIN administrateur
-- demandé par l'application ; le serveur exige le compte de l'établissement ou un administrateur Luxyra), seulement après
-- tentative de renvoi (deux contrôles successifs tracés au journal dans les 2 dernières heures + compte rendu du renvoi transmis
-- par l'application), motif obligatoire. Consigne la liste exacte des ventes concernées (inaltérable), le JET (code 900,
-- opération exceptionnelle) et le journal des événements ; alerte l'administrateur Luxyra. Ne crée ni ne modifie aucun ticket :
-- une vente transmise plus tard est enregistrée sur la journée ouverte (report, date réelle de vente scellée).
create or replace function public.lx_z_forcer(p_salon uuid, p_date date, p_motif text, p_operateur text, p_renvoi jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare v_rdv jsonb; v_nb int; v_mt numeric; v_ctl int; v_id uuid; v_lib text; v_tks text;
begin
  if not exists (select 1 from public.salons s where s.id = p_salon and (s.user_id = auth.uid() or public.is_admin())) then
    return jsonb_build_object('ok', false, 'erreur', 'Accès refusé');
  end if;
  if p_date is null or p_date > lx_prive.jour_paris() or p_date < lx_prive.jour_paris() - 60 then
    return jsonb_build_object('ok', false, 'erreur', 'Date hors période (60 derniers jours)');
  end if;
  if exists (select 1 from public.clotures where salon_id = p_salon and date_cloture = p_date) then
    return jsonb_build_object('ok', false, 'erreur', 'Journée déjà clôturée');
  end if;
  if length(trim(coalesce(p_motif, ''))) < 15 then
    return jsonb_build_object('ok', false, 'erreur', 'Motif obligatoire (15 caractères au moins)');
  end if;
  if length(trim(coalesce(p_operateur, ''))) < 2 then
    return jsonb_build_object('ok', false, 'erreur', 'Administrateur non identifié');
  end if;
  select count(*) into v_ctl from public.audit_log where salon_id = p_salon and action = 'CLOTURE_Z_VENTES_NON_TRANSMISES'
     and details like p_date::text || ' - %' and timestamp_action > now() - interval '2 hours';
  if v_ctl < 2 or coalesce(p_renvoi->>'tente_at', '') = '' then
    return jsonb_build_object('ok', false, 'erreur', 'Tentative de renvoi des tickets en attente non constatée : relancez la transmission puis la clôture avant de forcer', 'controles', v_ctl);
  end if;
  v_rdv := lx_prive.z_rdv_hors_journal(p_salon, p_date, false);
  v_nb := jsonb_array_length(v_rdv);
  if v_nb = 0 then return jsonb_build_object('ok', true, 'inutile', true); end if;
  select coalesce(sum((e->>'prix')::numeric), 0), string_agg(coalesce(e->>'ticket_num', '?'), ', ') into v_mt, v_tks from jsonb_array_elements(v_rdv) e;
  insert into public.clotures_forcages (salon_id, date_journee, rdv, nb, montant, motif, operateur, renvoi, cree_par)
  values (p_salon, p_date, v_rdv, v_nb, lx_prive.r2(v_mt), trim(p_motif), trim(p_operateur), coalesce(p_renvoi, '{}'::jsonb), auth.uid())
  returning id into v_id;
  v_lib := 'Clôture Z du ' || to_char(p_date, 'DD/MM/YYYY') || ' FORCÉE par ' || trim(p_operateur) || ' : ' || v_nb || ' vente(s) encaissée(s) non transmise(s) au journal (ticket(s) n° '
           || coalesce(v_tks, '?') || ', ' || to_char(v_mt, 'FM999999990.00') || ' EUR) — motif : ' || trim(p_motif);
  insert into public.audit_log (salon_id, action, details, operator_name) values (p_salon, 'CLOTURE_Z_FORCEE', left(v_lib || ' — forçage ' || v_id || ' ' || v_rdv::text, 1900), trim(p_operateur));
  begin perform public.nf525_jet_ajouter(p_salon, 900, left(v_lib, 900), trim(p_operateur)); exception when others then null; end;
  begin perform public.report_server_error(p_source := 'sql:clotures', p_message := left(v_lib, 900), p_severity := 'warning',
    p_context := jsonb_build_object('salon_id', p_salon, 'date', p_date, 'forcage', v_id, 'rdv', v_rdv, 'renvoi', p_renvoi)); exception when others then null; end;
  return jsonb_build_object('ok', true, 'id', v_id, 'nb', v_nb, 'montant', lx_prive.r2(v_mt), 'rdv', v_rdv);
end $$;

-- Alertes de caisse pour l'ÉTABLISSEMENT (carte de l'accueil de l'application) : journées retenues, mois non clôturés,
-- remboursements faits sur Stripe reçus avant l'activation (ticket négatif créé automatiquement à l'activation : rien à saisir)
create or replace function public.lx_caisse_alertes(p_salon uuid)
returns jsonb language plpgsql stable security definer set search_path = public, pg_temp as $$
declare v_j jsonb; v_m jsonb; v_r jsonb; v_auj date := lx_prive.jour_paris();
begin
  if not exists (select 1 from public.salons s where s.id = p_salon and (s.user_id = auth.uid() or public.is_admin())) then
    return jsonb_build_object('ok', false);
  end if;
  v_j := lx_prive.journees_non_closes(p_salon, v_auj - 60, v_auj - 1);
  select coalesce(jsonb_agg(to_char(x.m, 'YYYY-MM') order by x.m), '[]'::jsonb) into v_m from (
    select distinct date_trunc('month', c.date_cloture)::date m from public.clotures c
     where c.salon_id = p_salon and c.date_cloture >= v_auj - 400 and c.date_cloture < date_trunc('month', v_auj)::date) x
   where (v_auj - (x.m + interval '1 month')::date) >= 2
     and not exists (select 1 from public.clotures_mensuelles cm where cm.salon_id = p_salon and cm.annee = extract(year from x.m)::int and cm.mois = extract(month from x.m)::int);
  select coalesce(jsonb_agg(jsonb_build_object('le', q.paye_at, 'montant', q.montant, 'ticket_origine', q.details->>'tk_origine', 'refund', q.refund_id) order by q.created_at), '[]'::jsonb)
    into v_r from public.recettes_en_ligne q
   where q.salon_id = p_salon and q.source = 'remb_externe' and q.statut = 'attente_activation';
  return jsonb_build_object('ok', true, 'journees_retenues', v_j, 'mois_non_clotures', v_m, 'remboursements_en_attente', v_r);
end $$;

-- « À réparer » (admin) : la série du serveur (900001+) n'est pas un « saut » de la numérotation imprimée des appareils
do $$ declare d text; a text := $q$from tickets t where t.raw_data->>'tkNum' ~ '^[0-9]+$'$q$; begin
  if to_regprocedure('lx_prive.a_reparer_brut(integer)') is null then return; end if;
  d := pg_get_functiondef('lx_prive.a_reparer_brut(integer)'::regprocedure);
  if position('serveur' in d) > 0 then return; end if; -- déjà adapté
  if position(a in d) = 0 then raise notice 'a_reparer_brut : motif non trouvé, non modifié (à adapter à la main)'; return; end if;
  execute replace(d, a, a || $q$ and coalesce(t.raw_data->>'serveur', '') <> 'true'$q$);
end $$;

-- ===================================================================================================================== §11
-- 2026-10-28 (-5, contre-audit final, constat 1) : CLÔTURES MENSUELLE, ANNUELLE ET D'EXERCICE — jamais scellées tant qu'une
-- journée de la période est retenue (sans Z : tickets au journal ou ventes encaissées non transmises, voir §8 bis). Refus
-- TRACÉ (journal des événements CLOTURE_*_REPORTEE) + alerte critique (server_errors, source sql:clotures) + carte de
-- l'établissement (lx_caisse_alertes) ; nouvel essai automatique CHAQUE JOUR (tâches cloture_mensuelle_auto /
-- cloture_annuelle_auto passées en quotidien ; cloture_exercice_auto l'était déjà), toujours dans l'ordre chronologique.
-- Définitions relues en production le 28/10/2026 (cloturer_mois : version de docs/migrations_1027/bons_cadeaux_tva.sql,
-- prérequis), seules les lignes marquées LX_JOURNEES_2026_10_28 sont ajoutées ; calculs et empreintes (ZM / ZA / ZE) inchangés.
CREATE OR REPLACE FUNCTION public.cloturer_mois(p_salon_id uuid, p_annee integer, p_mois integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id uuid; v_existing uuid; v_siret text; v_nb_jours int; v_nb_tickets int := 0; v_nb_annul int := 0;
  v_ca numeric := 0; v_ht numeric := 0; v_tva numeric := 0; v_cloture_ids uuid[]; v_detail_paiements jsonb := '{}'::jsonb;
  v_hash text; v_hash_prev text; v_id uuid; v_pay_keys text[]; v_k text; v_sum_pay numeric; v_d record; v_raw jsonb := null;
  v_hc numeric := 0;
  v_fin date; v_ouv jsonb; -- LX_JOURNEES_2026_10_28
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
    'hors_ca_bum', coalesce(v_hc, 0));
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_cloture_mensuelle_pour_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- LX_JOURNEES_2026_10_28 (-5) : tous les mois TERMINÉS non encore clôturés (et non plus seulement le mois précédent), dans
-- l'ordre chronologique par établissement (chaînage hash_prev) ; au premier mois refusé (journée retenue), on s'arrête pour
-- cet établissement (jamais un mois postérieur clôturé avant). Tâche quotidienne : nouvel essai chaque jour.
DECLARE
  r record; v_auj date := lx_prive.jour_paris(); v_bloque uuid := NULL;
  v_results jsonb := '[]'::jsonb; v_one jsonb; v_nb_ok int := 0; v_nb_err int := 0; v_nb_att int := 0;
BEGIN
  FOR r IN
    SELECT x.salon_id, x.annee, x.mois FROM (
      SELECT DISTINCT c.salon_id, EXTRACT(YEAR FROM c.date_cloture)::int annee, EXTRACT(MONTH FROM c.date_cloture)::int mois
        FROM clotures c WHERE c.date_cloture < date_trunc('month', v_auj)::date
      UNION
      SELECT DISTINCT t.salon_id, EXTRACT(YEAR FROM t.date_ticket)::int, EXTRACT(MONTH FROM t.date_ticket)::int
        FROM tickets t JOIN salons s ON s.id = t.salon_id AND s.status IN ('active', 'trial')
       WHERE t.status <> 'cancelled' AND t.date_ticket < date_trunc('month', v_auj)::date AND t.date_ticket >= v_auj - 400
    ) x
    WHERE NOT EXISTS (SELECT 1 FROM clotures_mensuelles m WHERE m.salon_id = x.salon_id AND m.annee = x.annee AND m.mois = x.mois)
    ORDER BY x.salon_id, x.annee, x.mois
  LOOP
    IF r.salon_id = v_bloque THEN
      v_nb_att := v_nb_att + 1;
      v_results := v_results || jsonb_build_object('salon_id', r.salon_id, 'periode', r.annee || '-' || LPAD(r.mois::text, 2, '0'), 'attente', 'mois antérieur non clôturé');
      CONTINUE;
    END IF;
    BEGIN
      v_one := public.cloturer_mois(r.salon_id, r.annee, r.mois);
    EXCEPTION WHEN OTHERS THEN
      v_one := jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
    v_results := v_results || jsonb_build_object('salon_id', r.salon_id, 'periode', r.annee || '-' || LPAD(r.mois::text, 2, '0'), 'result', v_one);
    IF coalesce((v_one->>'ok')::boolean, false) THEN v_nb_ok := v_nb_ok + 1;
    ELSE v_nb_err := v_nb_err + 1; v_bloque := r.salon_id; END IF;
  END LOOP;
  RETURN jsonb_build_object('jour', v_auj, 'nb_ok', v_nb_ok, 'nb_err', v_nb_err, 'nb_attente', v_nb_att, 'results', v_results);
END;
$function$;

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
    total_ca, total_ht, total_tva, detail_paiements, cloture_mens_ids, hash, hash_algo, hash_prev, operator_name)
  VALUES (p_salon_id, p_annee, v_nb_mois, v_nb_tickets, v_nb_annul,
    v_ca, v_ht, v_tva, v_detail_paiements, v_mens_ids, v_hash, 'SHA-256', v_hash_prev, 'auto_cron')
  RETURNING id INTO v_id;
  INSERT INTO audit_log (salon_id, action, details, operator_name)
  VALUES (p_salon_id, 'CLOTURE_ANNEE', p_annee || ' : ' || v_nb_mois || ' mois, ' || v_nb_tickets || ' tickets, ' ||
    to_char(v_ca, 'FM9999999.99') || ' EUR', 'auto_cron');
  RETURN jsonb_build_object('ok', true, 'id', v_id, 'annee', p_annee,
    'nb_mois', v_nb_mois, 'nb_tickets', v_nb_tickets, 'total_ca', v_ca, 'hash', v_hash);
END;
$function$;

CREATE OR REPLACE FUNCTION public.run_cloture_annuelle_pour_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- LX_JOURNEES_2026_10_28 (-5) : toutes les années TERMINÉES non encore clôturées, dans l'ordre par établissement ; arrêt pour
-- l'établissement à la première année refusée. Tâche quotidienne : nouvel essai chaque jour.
DECLARE
  r record; v_auj date := lx_prive.jour_paris(); v_bloque uuid := NULL;
  v_results jsonb := '[]'::jsonb; v_one jsonb; v_nb_ok int := 0; v_nb_err int := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT m.salon_id, m.annee FROM clotures_mensuelles m
     WHERE m.annee < EXTRACT(YEAR FROM v_auj)::int
       AND NOT EXISTS (SELECT 1 FROM clotures_annuelles a WHERE a.salon_id = m.salon_id AND a.annee = m.annee)
     ORDER BY m.salon_id, m.annee
  LOOP
    IF r.salon_id = v_bloque THEN CONTINUE; END IF;
    BEGIN
      v_one := public.cloturer_annee(r.salon_id, r.annee);
    EXCEPTION WHEN OTHERS THEN
      v_one := jsonb_build_object('ok', false, 'error', SQLERRM);
    END;
    v_results := v_results || jsonb_build_object('salon_id', r.salon_id, 'annee', r.annee, 'result', v_one);
    IF coalesce((v_one->>'ok')::boolean, false) THEN v_nb_ok := v_nb_ok + 1;
    ELSE v_nb_err := v_nb_err + 1; v_bloque := r.salon_id; END IF;
  END LOOP;
  RETURN jsonb_build_object('jour', v_auj, 'nb_ok', v_nb_ok, 'nb_err', v_nb_err, 'results', v_results);
END;
$function$;

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

CREATE OR REPLACE FUNCTION public.run_cloture_exercice_pour_tous()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
-- LX_JOURNEES_2026_10_28 (-5) : arrêt pour l'établissement au premier exercice refusé (jamais un exercice postérieur clôturé avant)
DECLARE
  r record; v_today date := (now() AT TIME ZONE 'Europe/Paris')::date; v_first date; v_y int; v_fin date;
  v_res jsonb := '[]'::jsonb; v_one jsonb;
BEGIN
  FOR r IN SELECT id, exercice_fin_mois FROM salons WHERE exercice_fin_mois <> 12 LOOP
    SELECT min(date_cloture) INTO v_first FROM clotures WHERE salon_id = r.id;
    IF v_first IS NULL THEN CONTINUE; END IF;
    FOR v_y IN extract(year FROM v_first)::int .. extract(year FROM v_today)::int LOOP
      v_fin := lx_fin_exercice(v_y, r.exercice_fin_mois);
      IF v_fin < v_first OR v_fin >= v_today THEN CONTINUE; END IF;
      IF EXISTS (SELECT 1 FROM clotures_exercices WHERE salon_id = r.id AND date_fin = v_fin) THEN CONTINUE; END IF;
      BEGIN
        v_one := cloturer_exercice(r.id, v_fin);
        v_res := v_res || jsonb_build_object('salon_id', r.id, 'fin', v_fin, 'result', v_one);
      EXCEPTION WHEN OTHERS THEN
        v_one := jsonb_build_object('ok', false, 'error', SQLERRM);
        v_res := v_res || jsonb_build_object('salon_id', r.id, 'fin', v_fin, 'error', SQLERRM);
      END;
      EXIT WHEN NOT coalesce((v_one->>'ok')::boolean, false); -- LX_JOURNEES_2026_10_28
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('ok', true, 'results', v_res);
END $function$;

-- Tâches planifiées : mensuelle et annuelle QUOTIDIENNES (même heure ; nouvel essai chaque jour tant qu'une période est retenue)
do $$ begin
  if exists (select 1 from cron.job where jobname = 'cloture_mensuelle_auto') then perform cron.unschedule('cloture_mensuelle_auto'); end if;
  perform cron.schedule('cloture_mensuelle_auto', '15 3 * * *', 'SELECT public.run_cloture_mensuelle_pour_tous();');
  if exists (select 1 from cron.job where jobname = 'cloture_annuelle_auto') then perform cron.unschedule('cloture_annuelle_auto'); end if;
  perform cron.schedule('cloture_annuelle_auto', '30 3 * * *', 'SELECT public.run_cloture_annuelle_pour_tous();');
end $$;

-- ===================================================================================================================== §9 droits
revoke all on function lx_prive.recettes_serveur_actif() from public, anon, authenticated;
revoke all on function lx_prive.recettes_serveur_deja_active() from public, anon, authenticated;
revoke all on function lx_prive.recette_poste(uuid) from public, anon, authenticated;
revoke all on function lx_prive.recette_ht_tva(uuid, jsonb, numeric) from public, anon, authenticated;
revoke all on function lx_prive.recette_client(uuid, uuid) from public, anon, authenticated;
revoke all on function lx_prive.recette_tk_inserer(uuid, jsonb, jsonb, numeric, uuid, text, text, integer, integer, text, jsonb, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.recette_traiter(public.recettes_en_ligne, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.recette_enfiler(uuid, text, uuid, text, numeric, timestamptz, text, text, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.recettes_rattrapage() from public, anon, authenticated;
revoke all on function lx_prive.recettes_filet() from public, anon, authenticated;
revoke all on function lx_prive.recette_rattraper_un(uuid) from public, anon, authenticated;
revoke all on function lx_prive.recettes_alerte_attente() from public, anon, authenticated;
revoke all on procedure lx_prive.recettes_rattrapage_job() from public, anon, authenticated;
revoke all on function lx_prive.recettes_bail_prendre(interval) from public, anon, authenticated;
revoke all on function lx_prive.recettes_bail_prolonger(uuid, interval) from public, anon, authenticated;
revoke all on function lx_prive.recettes_bail_rendre(uuid) from public, anon, authenticated;
revoke all on function lx_prive.recettes_desactiver(text) from public, anon, authenticated;
revoke all on function lx_prive.recettes_version_min() from public, anon, authenticated;
revoke all on function lx_prive.carte_abo_config(uuid, text) from public, anon, authenticated;
revoke all on function lx_prive.garde_signaler(text, uuid, text[]) from public, anon, authenticated;
revoke all on function lx_prive.remb_ajout_tk_seul(jsonb, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.remb_tk_justifies(uuid, uuid, jsonb, jsonb) from public, anon, authenticated;
revoke all on function lx_prive.tickets_cc_doublon_controle() from public, anon, authenticated;
revoke all on function lx_prive.appointments_cc_doublon_controle() from public, anon, authenticated;
revoke all on function lx_prive.tickets_version_controle() from public, anon, authenticated;
revoke all on function lx_prive.tickets_report_controle() from public, anon, authenticated;
revoke all on function lx_prive.clotures_forcages_inalterables() from public, anon, authenticated;
revoke all on function lx_prive.z_rdv_hors_journal(uuid, date, boolean) from public, anon, authenticated;
revoke all on function lx_prive.journees_non_closes(uuid, date, date) from public, anon, authenticated;
revoke all on function lx_prive.periode_alerter(uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.lx_z_controle_ventes(uuid, date) from public, anon;
grant execute on function public.lx_z_controle_ventes(uuid, date) to authenticated, service_role;
revoke all on function public.lx_z_forcer(uuid, date, text, text, jsonb) from public, anon;
grant execute on function public.lx_z_forcer(uuid, date, text, text, jsonb) to authenticated, service_role;
revoke all on function public.lx_caisse_alertes(uuid) from public, anon;
grant execute on function public.lx_caisse_alertes(uuid) to authenticated, service_role;
revoke all on function public.run_cloture_mensuelle_pour_tous() from public, anon, authenticated;
revoke all on function public.run_cloture_annuelle_pour_tous() from public, anon, authenticated;
revoke all on function public.run_cloture_exercice_pour_tous() from public, anon, authenticated;
revoke all on function lx_prive.garde_paiements_rdv_online() from public, anon, authenticated;
revoke all on function lx_prive.garde_paiements_commandes_online() from public, anon, authenticated;
revoke all on function lx_prive.garde_paiements_cartes_cadeaux() from public, anon, authenticated;
revoke all on function lx_prive.garde_paiements_cartes_abo() from public, anon, authenticated;
revoke all on function lx_prive.zz_rdv_online_recettes() from public, anon, authenticated;
revoke all on function lx_prive.zz_commandes_online_recettes() from public, anon, authenticated;
revoke all on function lx_prive.zz_cartes_cadeaux_recettes() from public, anon, authenticated;
revoke all on function lx_prive.zz_cartes_abo_recettes() from public, anon, authenticated;
revoke all on function public.lx_recette_remboursement_externe(text, text, bigint, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.lx_recette_remboursement_externe(text, text, bigint, timestamptz, jsonb) to service_role;
revoke all on function public.lx_tk_num_imprime_max(uuid) from public, anon;
grant execute on function public.lx_tk_num_imprime_max(uuid) to authenticated, service_role;
-- fonctions utilitaires sans donnée (appelées par les déclencheurs, exécutés avec les droits du propriétaire)
revoke all on function lx_prive.appel_serveur() from public, anon, authenticated;
revoke all on function lx_prive.refund_valide(text) from public, anon, authenticated;
revoke all on function lx_prive.version_num(text) from public, anon, authenticated;

-- ===================================================================================================================== §10 tâche planifiée
do $$ begin
  if exists (select 1 from cron.job where jobname = 'recettes-en-ligne-rattrapage') then perform cron.unschedule('recettes-en-ligne-rattrapage'); end if;
  perform cron.schedule('recettes-en-ligne-rattrapage', '*/5 * * * *', 'call lx_prive.recettes_rattrapage_job()');
end $$;

commit;

-- =====================================================================================================================
-- ORDRE DE MISE EN SERVICE : voir docs/registre-interventions-nf525.md, intervention du 28/10/2026 (-5) — ordre complet pas à
-- pas, verify_jwt de chaque edge function, contrôles et RETOUR ARRIÈRE. Résumé :
--  0. docs/migrations_1027/bons_cadeaux_tva.sql (OBLIGATOIRE, avant)   1. CE FICHIER (interrupteur éteint : rien n'est créé)
--  2. edge functions docs/edge_1028/* (lx-cloture-auto v3.3)   3. worker (+ cocher charge.refunded)   4. pages (6.8.2, données
--  20261028-5) et recharger les appareils   5. activation avec recettes_en_ligne_version_min = '0' (heure au registre)
--  5 bis. relever recettes_en_ligne_version_min à '6.8.3' quand TOUS les postes actifs ont remonté 6.8.3 (requête de contrôle
--  au registre)   6. bot   7. CGV art. 12 ter   8. bons en ligne.
--
-- RETOUR ARRIÈRE (les tickets déjà créés restent : ils sont scellés et exacts) :
--  a) arrêt immédiat ET propre : select lx_prive.recettes_desactiver('motif');
--     (interrupteur éteint ; acomptes / remboursements d'acompte / acomptes conservés / empreintes rendus à l'application,
--     verrous du serveur effacés ; le reste de la file — bons, cartes, Click & Collect, remboursements Stripe — CONTINUE d'être
--     traité par la tâche de rattrapage : NE PAS la retirer tant que « gardes_serveur » > 0)
--  b) retrait complet (après a, et seulement quand select count(*) from recettes_en_ligne where statut = 'a_ticketer' = 0) :
--     select cron.unschedule('recettes-en-ligne-rattrapage');
--     drop trigger if exists zz_trg_rdv_online_recettes on public.rdv_online;
--     drop trigger if exists zz_trg_commandes_online_recettes on public.commandes_online;
--     drop trigger if exists zz_trg_cartes_cadeaux_recettes on public.cartes_cadeaux;
--     drop trigger if exists zz_trg_cartes_abo_recettes on public.cartes_abo_clients;
--     drop trigger if exists a_lx_tickets_cc_doublon on public.tickets;
--     drop trigger if exists a_lx_tickets_a_version on public.tickets;
--     drop trigger if exists a_lx_appointments_cc_doublon on public.appointments;
--     -- les gardes a0_lx_garde_paiements (4 tables), a_lx_tickets_report_scelle, le contrôle de la Z (verrou, journées
--     -- retenues) et les clôtures périodiques (§11) sont INDÉPENDANTS de l'interrupteur : à garder.
--     drop function if exists public.lx_recette_remboursement_externe(text, text, bigint, timestamptz, jsonb);
--     -- garder la table public.recettes_en_ligne, les index et les colonnes : trace des tickets créés.
-- =====================================================================================================================
