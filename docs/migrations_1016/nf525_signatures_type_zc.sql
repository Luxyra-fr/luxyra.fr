-- 2026-10-16 — NF525 : autoriser le type 'ZC' (annotations correctives des Z, nf525-sign v6) dans nf525_signatures.
-- Élargissement strict de la contrainte : les types existants (TK, Z, ZM, ZA, ZE, CR, DUP, JET, AR) sont inchangés.
-- Sans cela, l'insertion de la signature ZC échoue (ZC_conflit) et l'annotation n'est jamais signée.
-- Remarque : 'FA' (factures, ajouté dans nf525-sign v5) n'est PAS dans la contrainte -> FA jamais signé à ce jour ;
-- volontairement non modifié ici (hors périmètre de l'incident, à traiter avec accord).
begin;
alter table public.nf525_signatures drop constraint nf525_signatures_type_check;
alter table public.nf525_signatures add constraint nf525_signatures_type_check
  check (type = any (array['TK','Z','ZM','ZA','ZE','CR','DUP','JET','AR','ZC']::text[]));
commit;
