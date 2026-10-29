-- 2026-10-29 : conformité Google Play (paiements) du bot support.
-- Le message envoyé depuis l'appli Android « Luxyra Pro » (window.LX_PLAY / lxPlay() dans app.html) porte play = true ;
-- bot-reply (v17) lit ce drapeau sur les messages du pro de la conversation et n'oriente alors JAMAIS vers un
-- autre moyen de payer l'abonnement ou les SMS. Aucune donnée existante modifiée (colonne nouvelle, défaut false).
-- Ordre : CE SQL -> bot-reply v17 (lit la colonne) -> app.html 20261029-6 (écrit la colonne).
-- Retour arrière : voir en bas.

alter table public.support_messages add column if not exists play boolean not null default false;
comment on column public.support_messages.play is 'Message du pro envoyé depuis l''appli Android Luxyra Pro (Google Play) : le bot n''oriente vers aucun paiement (2026-10-29).';

-- Garde : identique à la version du 15/10 (md5 prosrc db813487b9fa5f0210858547ddb79eb4) + 2 lignes « play ».
CREATE OR REPLACE FUNCTION lx_prive.support_msg_garde()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_salon uuid;
begin
  if tg_op = 'INSERT' and new.conversation_id is not null then
    select c.salon_id into v_salon from public.support_conversations c where c.id = new.conversation_id;
    if found and v_salon is distinct from new.salon_id then
      raise exception 'Conversation de support inconnue pour cet établissement' using errcode = '42501';
    end if;
  end if;
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.read_by_admin := false; new.created_at := now();
    new.bot_avis := null; -- 2026-10-15 : avis seulement via support_bot_avis
    new.play := (coalesce(new.play, false) and new.sender = 'client'); -- 2026-10-29
    return new;
  end if;
  new.id := old.id; new.salon_id := old.salon_id; new.conversation_id := old.conversation_id; new.sender := old.sender;
  new.message := old.message; new.read_by_admin := old.read_by_admin; new.created_at := old.created_at;
  new.pieces := old.pieces; new.bot_avis := old.bot_avis; -- 2026-10-15
  new.play := old.play; -- 2026-10-29
  return new;
end;
$function$;

-- Retour arrière (après avoir redéployé bot-reply v16 = docs/edge_1029_bot/avant/bot-reply/index.ts) :
--   recréer lx_prive.support_msg_garde sans les 2 lignes « play » puis
--   alter table public.support_messages drop column play;
