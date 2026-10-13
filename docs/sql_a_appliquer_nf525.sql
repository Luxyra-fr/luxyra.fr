-- ============================================================================
-- 2026-10-14 (NF525) — SQL À APPLIQUER (non appliqué automatiquement)
-- Correctifs caisse : champs de ticket perdus au rechargement (finding 9) + n° serveur (finding 5)
-- ============================================================================
-- Contexte : l'application conserve désormais dans appointments.meta (jsonb) les champs de TICKET qui
-- n'existaient qu'en mémoire : operator_id, operator_name, poste, ts, extraClients, clientNom,
-- clientPrenom, isAcompte, isAcompteCancel, apptId, isRetenue, retenueKey, retenueRdv, origTkNum,
-- origTkNums, bonVenduRemise, offertRemise, dbNum (n° attribué par le serveur si différent du n° imprimé).
--
-- Le code fonctionne SANS cette colonne (il détecte son absence à la 1re écriture et continue sans elle,
-- les champs ne sont alors simplement pas persistés, comme avant). Appliquer ce script active la persistance.
--
-- Aucune donnée scellée n'est modifiée : colonne additive, nullable, sans valeur par défaut.
-- La colonne ne participe à aucun hash / chaînage / signature (tickets.hash et appointments.hash inchangés).

alter table public.appointments
  add column if not exists meta jsonb;

comment on column public.appointments.meta is
  'NF525 2026-10-14 : champs de ticket non fiscaux conservés après rechargement (opérateur, poste, horodatage, clients supplémentaires, nom client figé, drapeaux acompte/retenue/annulation d''acompte, ticket d''origine, bons utilisés, n° serveur dbNum). Hors hash.';

-- ----------------------------------------------------------------------------
-- IMPORTANT — trigger appointments_nf525_protect
-- ----------------------------------------------------------------------------
-- L'application met à jour `meta` sur une ligne DÉJÀ SCELLÉE dans deux cas :
--   1) chemin « inaltérable » de saveAppointment (update ciblé : cancelled, cancel_reason, cancel_date,
--      printed, ticket_html, comment, lieu, adresse_domicile, meta) ;
--   2) _lxApptMetaPatch (mémorisation de meta.dbNum après un audit NUM_MISMATCH).
-- Si le trigger appointments_nf525_protect fonctionne par LISTE BLANCHE de colonnes modifiables
-- (et non par liste de colonnes protégées), ajouter `meta` à cette liste blanche, sinon ces écritures
-- seront refusées (sans erreur visible : le code les ignore). Vérifier avec :
--
--   select pg_get_functiondef(p.oid)
--   from pg_trigger t join pg_proc p on p.oid = t.tgfoid
--   where t.tgrelid = 'public.appointments'::regclass and t.tgname ilike '%nf525%';
--
-- Si la fonction compare NEW.<col> IS DISTINCT FROM OLD.<col> pour une liste de colonnes PROTÉGÉES
-- (prix, items, hash, ticket_num, status, date_rdv, ...), rien à faire : `meta` n'y figure pas.

-- ----------------------------------------------------------------------------
-- (Optionnel, recommandé) index d'idempotence côté serveur pour saveTicketToDb (finding 4)
-- ----------------------------------------------------------------------------
-- Le code déduplique désormais sur raw_data->>id (clé principale) puis hash (secondaire). Un index
-- unique garantit l'absence de doublon même en cas de course entre deux appareils rejouant la même entrée.
-- Vérifier d'abord qu'aucun doublon n'existe :
--
--   select salon_id, raw_data->>'id' as tk_id, count(*)
--   from public.tickets
--   where raw_data->>'id' is not null
--   group by 1,2 having count(*) > 1;
--
-- Puis (uniquement si la requête ci-dessus ne renvoie rien) :
create unique index if not exists tickets_unique_raw_id_per_salon
  on public.tickets (salon_id, (raw_data->>'id'))
  where raw_data->>'id' is not null;

-- Index de lecture pour le contrôle d'idempotence (évite un scan complet à chaque insertion si l'index
-- unique ci-dessus n'est pas créé) :
-- create index if not exists tickets_raw_id_idx on public.tickets (salon_id, (raw_data->>'id'));
