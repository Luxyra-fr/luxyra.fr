-- =====================================================================================
-- 2026-10-15 — BOÎTE DE SUPPORT RENFORCÉE (branche admin-chat)
-- Idempotent : peut être rejoué sans effet de bord. À appliquer AVANT de publier admin.html / app.html,
-- puis redéployer bot-reply (docs/edge_1015/bot-reply/index.ts, v14).
--
-- Contenu :
--   1. Statuts « ouvert / en attente du pro / résolu » + drapeau d'escalade par le bot
--   2. Pièces jointes (jsonb sur support_messages) + avis 👍/👎 sur les réponses du bot
--   3. Notes internes (table séparée support_notes : JAMAIS lisible par un pro, jamais vue par le bot)
--   4. Réponses types (support_reponses_types) — admin uniquement
--   5. Stockage privé « support-pieces » (images + PDF, 5 Mo, pas de HTML/SVG) + règles d'accès
--   6. Realtime privé « support:<conversation> » (indicateur de saisie, lu en direct, sans écriture en base)
--   7. Déclencheurs : statut automatique, compteur de non-lus (réponses du bot comprises), escalade
--   8. RPC admin : contexte salon, recherche plein texte, statistiques, revue du bot
--   9. E-mail de secours après 15 min sans lecture (pro et admin), sans doublon, silence 21 h – 8 h
--  10. Base de connaissances du bot (support_bot_kb) mise à jour
-- =====================================================================================
BEGIN;

-- -------------------------------------------------------------------------------------
-- 1. STATUTS + ESCALADE
-- -------------------------------------------------------------------------------------
-- 'waiting' = en attente d'une réponse du pro (posé automatiquement quand l'équipe répond)
ALTER TABLE public.support_conversations DROP CONSTRAINT IF EXISTS support_conv_status_check;
ALTER TABLE public.support_conversations ADD CONSTRAINT support_conv_status_check
  CHECK (status = ANY (ARRAY['open'::text, 'waiting'::text, 'resolved'::text]));

-- Escalade : le bot (ou le pro via « 🙋 Humain ») a passé la main à un humain
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS escalade_bot boolean NOT NULL DEFAULT false;
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS escalade_le timestamptz;
ALTER TABLE public.support_conversations ADD COLUMN IF NOT EXISTS escalade_motif text;
ALTER TABLE public.support_conversations DROP CONSTRAINT IF EXISTS support_conv_escalade_motif_check;
ALTER TABLE public.support_conversations ADD CONSTRAINT support_conv_escalade_motif_check
  CHECK (escalade_motif IS NULL OR escalade_motif = ANY (ARRAY['bot','demande_pro','erreur_bot','piece_jointe']));

-- Reprise de l'historique : une conversation dont le bot a passé la main (message du bot non lu par l'admin)
UPDATE public.support_conversations c
   SET escalade_bot = true,
       escalade_le = (SELECT max(m.created_at) FROM public.support_messages m
                       WHERE m.conversation_id = c.id AND m.sender = 'bot' AND m.read_by_admin = false),
       escalade_motif = 'bot'
 WHERE c.escalade_bot = false
   AND EXISTS (SELECT 1 FROM public.support_messages m
                WHERE m.conversation_id = c.id AND m.sender = 'bot' AND m.message LIKE '🙋%');

-- -------------------------------------------------------------------------------------
-- 2. PIÈCES JOINTES + AVIS SUR LE BOT
-- -------------------------------------------------------------------------------------
-- pieces : [{chemin, nom, type, taille}] — chemin = <salon>/<conversation>/<uuid>.<ext> dans « support-pieces »
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS pieces jsonb NOT NULL DEFAULT '[]'::jsonb;
-- bot_avis : 1 = utile, -1 = pas utile (posé par le pro via la RPC support_bot_avis)
ALTER TABLE public.support_messages ADD COLUMN IF NOT EXISTS bot_avis smallint;
ALTER TABLE public.support_messages DROP CONSTRAINT IF EXISTS support_messages_bot_avis_check;
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_bot_avis_check CHECK (bot_avis IS NULL OR bot_avis IN (-1, 1));
ALTER TABLE public.support_messages DROP CONSTRAINT IF EXISTS support_messages_pieces_check;
ALTER TABLE public.support_messages ADD CONSTRAINT support_messages_pieces_check
  CHECK (jsonb_typeof(pieces) = 'array' AND jsonb_array_length(pieces) <= 5);

-- Recherche dans le texte : ILIKE simple (volume faible ; index trigramme à ajouter si le volume grossit)
CREATE INDEX IF NOT EXISTS idx_support_messages_non_lus ON public.support_messages (conversation_id, created_at)
  WHERE read_by_admin = false OR read_by_client = false;

-- -------------------------------------------------------------------------------------
-- 3. NOTES INTERNES (admin seulement)
-- -------------------------------------------------------------------------------------
-- Table SÉPARÉE : aucune policy pour les pros, aucun déclencheur bot / push / non-lus ; bot-reply ne lit que
-- support_messages. Un pro ne peut donc ni lire ni deviner une note.
CREATE TABLE IF NOT EXISTS public.support_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id uuid NOT NULL REFERENCES public.support_conversations(id) ON DELETE CASCADE,
  salon_id uuid NOT NULL REFERENCES public.salons(id) ON DELETE CASCADE,
  contenu text NOT NULL CHECK (length(btrim(contenu)) BETWEEN 1 AND 5000),
  auteur text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_support_notes_conv ON public.support_notes (conversation_id, created_at);
ALTER TABLE public.support_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_notes FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_notes TO authenticated;
DROP POLICY IF EXISTS support_notes_admin ON public.support_notes;
CREATE POLICY support_notes_admin ON public.support_notes FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- -------------------------------------------------------------------------------------
-- 4. RÉPONSES TYPES (admin seulement)
-- -------------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.support_reponses_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  titre text NOT NULL CHECK (length(btrim(titre)) BETWEEN 1 AND 120),
  raccourci text NOT NULL UNIQUE CHECK (raccourci ~ '^[a-z0-9_-]{1,30}$'),
  contenu text NOT NULL CHECK (length(btrim(contenu)) BETWEEN 1 AND 4000),
  ordre integer NOT NULL DEFAULT 100,
  actif boolean NOT NULL DEFAULT true,
  maj_le timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.support_reponses_types ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.support_reponses_types FROM anon, public;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.support_reponses_types TO authenticated;
DROP POLICY IF EXISTS support_reponses_types_admin ON public.support_reponses_types;
CREATE POLICY support_reponses_types_admin ON public.support_reponses_types FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

INSERT INTO public.support_reponses_types (titre, raccourci, contenu, ordre) VALUES
  ('Bonjour', 'bonjour', 'Bonjour {prenom}, merci pour votre message. Je regarde cela pour {salon} et je reviens vers vous très vite.', 10),
  ('Capture d''écran', 'capture', 'Pour que je voie exactement ce qui se passe, pouvez-vous m''envoyer une capture d''écran avec le bouton 📎 en bas de la conversation ?', 20),
  ('Corrigé', 'corrige', 'C''est corrigé de notre côté, {prenom}. Pouvez-vous fermer puis rouvrir l''application et me dire si tout est bon ?', 30),
  ('Je vérifie', 'verif', 'Je vérifie avec l''équipe technique et je vous tiens au courant dans la journée.', 40),
  ('Clôture', 'merci', 'Avec plaisir {prenom} ! Je passe cette conversation en « résolu » ; écrivez-nous ici si besoin, elle se rouvrira.', 50)
ON CONFLICT (raccourci) DO NOTHING;

-- -------------------------------------------------------------------------------------
-- 5. STOCKAGE PRIVÉ « support-pieces »
-- -------------------------------------------------------------------------------------
-- Types autorisés : PNG, JPEG, WebP, PDF (pas de HTML, SVG, scripts) ; 5 Mo maximum ; affichage par lien signé.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('support-pieces', 'support-pieces', false, 5242880,
        ARRAY['image/png','image/jpeg','image/webp','application/pdf'])
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/png','image/jpeg','image/webp','application/pdf'];

-- Chemin : <salon_id>/<conversation_id>/<uuid>.<png|jpg|jpeg|webp|pdf>
-- Pro : dépôt et lecture dans SON établissement uniquement, et seulement dans une conversation de cet établissement.
-- Admin (is_admin, 2FA) : tout. Aucune modification / suppression côté pro.
DROP POLICY IF EXISTS support_pieces_insert ON storage.objects;
CREATE POLICY support_pieces_insert ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'support-pieces'
  AND lower(name) ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|jpe?g|webp|pdf)$'
  AND (
    public.is_admin()
    OR EXISTS (SELECT 1 FROM public.support_conversations c JOIN public.salons s ON s.id = c.salon_id
                WHERE s.user_id = auth.uid()
                  AND c.salon_id::text = (storage.foldername(name))[1]
                  AND c.id::text = (storage.foldername(name))[2])
  )
);
DROP POLICY IF EXISTS support_pieces_select ON storage.objects;
CREATE POLICY support_pieces_select ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'support-pieces'
  AND (public.is_admin()
       OR (storage.foldername(name))[1] IN (SELECT s.id::text FROM public.salons s WHERE s.user_id = auth.uid()))
);
DROP POLICY IF EXISTS support_pieces_delete ON storage.objects;
CREATE POLICY support_pieces_delete ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'support-pieces' AND public.is_admin());

-- -------------------------------------------------------------------------------------
-- 6. REALTIME PRIVÉ (saisie en cours, lu en direct) : canal « support:<conversation_id> »
-- -------------------------------------------------------------------------------------
-- Diffusion + présence seulement (rien n'est écrit en base). Accès : admin ou propriétaire du salon de la conversation.
-- Fonction dans « public » (le schéma lx_prive reste fermé aux rôles de l'API) ; elle ne révèle que l'accès de l'appelant.
CREATE OR REPLACE FUNCTION public.support_canal_autorise(p_topic text)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id uuid;
BEGIN
  IF p_topic IS NULL OR p_topic !~ '^support:[0-9a-f-]{36}$' THEN RETURN false; END IF;
  v_id := substr(p_topic, 9)::uuid;
  IF public.is_admin() THEN RETURN EXISTS (SELECT 1 FROM public.support_conversations WHERE id = v_id); END IF;
  RETURN EXISTS (SELECT 1 FROM public.support_conversations c JOIN public.salons s ON s.id = c.salon_id
                  WHERE c.id = v_id AND s.user_id = auth.uid());
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.support_canal_autorise(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.support_canal_autorise(text) TO authenticated;

DROP POLICY IF EXISTS support_canal_lecture ON realtime.messages;
CREATE POLICY support_canal_lecture ON realtime.messages FOR SELECT TO authenticated
  USING (realtime.messages.extension IN ('broadcast','presence') AND public.support_canal_autorise(realtime.topic()));
DROP POLICY IF EXISTS support_canal_envoi ON realtime.messages;
CREATE POLICY support_canal_envoi ON realtime.messages FOR INSERT TO authenticated
  WITH CHECK (realtime.messages.extension IN ('broadcast','presence') AND public.support_canal_autorise(realtime.topic()));

-- -------------------------------------------------------------------------------------
-- 7. DÉCLENCHEURS
-- -------------------------------------------------------------------------------------
-- 7a. Gardes : les nouvelles colonnes ne sont pas modifiables par un pro
CREATE OR REPLACE FUNCTION lx_prive.support_conv_garde()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if public.is_admin() then return new; end if;
  if tg_op = 'INSERT' then
    new.status := 'open'; new.resolved_at := null; new.resolved_by := null;
    new.unread_count_admin := 0; new.unread_count_client := 0; new.bot_active := true;
    new.created_at := now(); new.updated_at := now(); new.last_message_at := now();
    new.subject := left(new.subject, 120);
    new.escalade_bot := false; new.escalade_le := null; new.escalade_motif := null; -- 2026-10-15
    return new;
  end if;
  new.id := old.id; new.salon_id := old.salon_id; new.subject := old.subject; new.bot_active := old.bot_active;
  new.unread_count_admin := old.unread_count_admin; new.last_message_at := old.last_message_at; new.created_at := old.created_at;
  new.escalade_bot := old.escalade_bot; new.escalade_le := old.escalade_le; new.escalade_motif := old.escalade_motif; -- 2026-10-15
  new.unread_count_client := least(coalesce(old.unread_count_client, 0), greatest(coalesce(new.unread_count_client, 0), 0));
  if new.status is distinct from old.status and new.status = 'resolved' then
    new.resolved_at := now(); new.resolved_by := 'salon';
  else
    new.status := old.status; new.resolved_at := old.resolved_at; new.resolved_by := old.resolved_by;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

CREATE OR REPLACE FUNCTION lx_prive.support_msg_garde()
RETURNS trigger LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
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
    return new;
  end if;
  new.id := old.id; new.salon_id := old.salon_id; new.conversation_id := old.conversation_id; new.sender := old.sender;
  new.message := old.message; new.read_by_admin := old.read_by_admin; new.created_at := old.created_at;
  new.pieces := old.pieces; new.bot_avis := old.bot_avis; -- 2026-10-15
  return new;
end;
$$;

-- 7b. Pièces jointes : chaque pièce doit exister dans « support-pieces », dans le dossier de CE salon et de CETTE
-- conversation ; type et taille RELUS dans le stockage (jamais ceux annoncés par le navigateur).
CREATE OR REPLACE FUNCTION lx_prive.support_pieces_valider()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE p jsonb; v_out jsonb := '[]'::jsonb; v_ch text; v_obj record; v_nom text;
BEGIN
  IF new.pieces IS NULL OR jsonb_typeof(new.pieces) <> 'array' THEN new.pieces := '[]'::jsonb; RETURN new; END IF;
  IF jsonb_array_length(new.pieces) = 0 THEN RETURN new; END IF;
  IF jsonb_array_length(new.pieces) > 5 THEN RAISE EXCEPTION 'Au plus 5 pièces jointes par message' USING errcode = '22023'; END IF;
  FOR p IN SELECT * FROM jsonb_array_elements(new.pieces) LOOP
    v_ch := p->>'chemin';
    IF v_ch IS NULL OR lower(v_ch) !~ ('^' || new.salon_id::text || '/' || new.conversation_id::text || '/[0-9a-f-]{36}\.(png|jpe?g|webp|pdf)$') THEN
      RAISE EXCEPTION 'Pièce jointe refusée (chemin)' USING errcode = '42501';
    END IF;
    SELECT o.name, o.metadata INTO v_obj FROM storage.objects o WHERE o.bucket_id = 'support-pieces' AND o.name = v_ch;
    IF NOT FOUND THEN RAISE EXCEPTION 'Pièce jointe introuvable' USING errcode = '22023'; END IF;
    IF coalesce(v_obj.metadata->>'mimetype','') NOT IN ('image/png','image/jpeg','image/webp','application/pdf') THEN
      RAISE EXCEPTION 'Type de fichier refusé (images ou PDF uniquement)' USING errcode = '22023';
    END IF;
    IF coalesce((v_obj.metadata->>'size')::bigint, 0) > 5242880 THEN
      RAISE EXCEPTION 'Fichier trop lourd (5 Mo maximum)' USING errcode = '22023';
    END IF;
    v_nom := left(regexp_replace(coalesce(p->>'nom','piece'), '[\r\n\t<>"\\/]', '_', 'g'), 120);
    v_out := v_out || jsonb_build_array(jsonb_build_object('chemin', v_ch, 'nom', v_nom,
               'type', v_obj.metadata->>'mimetype', 'taille', coalesce((v_obj.metadata->>'size')::bigint, 0)));
  END LOOP;
  new.pieces := v_out;
  RETURN new;
END $$;
REVOKE ALL ON FUNCTION lx_prive.support_pieces_valider() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS b_trg_support_pieces ON public.support_messages;
CREATE TRIGGER b_trg_support_pieces BEFORE INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION lx_prive.support_pieces_valider();

-- 7c. Statut automatique : réponse de l'équipe -> « en attente du pro » ; message du pro -> « ouvert » ;
-- réponse du bot -> statut conservé (une conversation résolue se rouvre).
CREATE OR REPLACE FUNCTION public.fn_touch_support_conv()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
declare v_salon uuid; v_status text;
begin
  if new.conversation_id is not null then
    select c.salon_id into v_salon from public.support_conversations c where c.id = new.conversation_id;
    if found and v_salon is distinct from new.salon_id then
      raise exception 'Conversation de support inconnue pour cet établissement' using errcode = '42501';
    end if;
    v_status := case new.sender when 'admin' then 'waiting' when 'client' then 'open' else null end;
    insert into public.support_conversations (id, salon_id, status, last_message_at, updated_at)
    values (new.conversation_id, new.salon_id, coalesce(v_status, 'open'), new.created_at, new.created_at)
    on conflict (id) do update
      set last_message_at = excluded.last_message_at,
          updated_at = excluded.last_message_at,
          status = coalesce(v_status, case when public.support_conversations.status = 'resolved' then 'open'
                                           else public.support_conversations.status end),
          resolved_at = null,
          resolved_by = null
      where public.support_conversations.salon_id = excluded.salon_id;
  end if;
  return new;
end;
$$;

-- 7d. Non-lus côté pro : les réponses du bot non lues comptent aussi (avant : seulement l'équipe)
CREATE OR REPLACE FUNCTION public.fn_bump_unread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.sender = 'client' THEN
    UPDATE public.support_conversations SET unread_count_admin = COALESCE(unread_count_admin, 0) + 1 WHERE id = NEW.conversation_id;
  ELSIF NEW.sender = 'admin' OR (NEW.sender = 'bot' AND NEW.read_by_client = false) THEN
    UPDATE public.support_conversations SET unread_count_client = COALESCE(unread_count_client, 0) + 1 WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END;
$$;

-- 7e. Escalade : un message du bot NON lu par l'admin = passage de main (bot-reply et escalate_to_human
-- l'insèrent avec read_by_admin = false ; une réponse ordinaire du bot a read_by_admin = true).
CREATE OR REPLACE FUNCTION lx_prive.support_marquer_escalade()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.sender = 'bot' AND NEW.read_by_admin = false THEN
    UPDATE public.support_conversations
       SET escalade_bot = true, escalade_le = NEW.created_at, escalade_motif = coalesce(escalade_motif, 'bot'), bot_active = false
     WHERE id = NEW.conversation_id;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION lx_prive.support_marquer_escalade() FROM public, anon, authenticated;
DROP TRIGGER IF EXISTS trg_support_escalade ON public.support_messages;
CREATE TRIGGER trg_support_escalade AFTER INSERT ON public.support_messages
  FOR EACH ROW EXECUTE FUNCTION lx_prive.support_marquer_escalade();

-- 7f. « 🙋 Humain » côté pro : motif « demande_pro »
CREATE OR REPLACE FUNCTION public.escalate_to_human(p_conv_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT (EXISTS (SELECT 1 FROM public.support_conversations c JOIN public.salons s ON s.id = c.salon_id WHERE c.id = p_conv_id AND s.user_id = auth.uid())
          OR public.is_caller_admin() OR coalesce(auth.role(),'') = 'service_role') THEN
    RAISE EXCEPTION 'Acces refuse' USING ERRCODE = '42501';
  END IF;
  UPDATE public.support_conversations SET bot_active = false, escalade_motif = 'demande_pro' WHERE id = p_conv_id;
  INSERT INTO public.support_messages (conversation_id, salon_id, sender, message, read_by_admin, read_by_client)
  SELECT id, salon_id, 'bot', '🙋 D''accord, je transmets votre demande à un humain. Vous recevrez une réponse rapidement.', false, true
  FROM public.support_conversations WHERE id = p_conv_id;
END;
$$;

-- 7g. Push : un message sans texte (pièce jointe seule) garde un aperçu lisible
CREATE OR REPLACE FUNCTION public.fn_push_admin_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.sender = 'admin' AND NEW.salon_id IS NOT NULL THEN
    PERFORM notify_salon(
      NEW.salon_id, 'admin_reply', '💬 Réponse support',
      left(COALESCE(NULLIF(btrim(NEW.message),''), CASE WHEN jsonb_array_length(coalesce(NEW.pieces,'[]'::jsonb)) > 0 THEN '📎 Pièce jointe' ELSE '' END),120),
      'https://luxyra.fr/app.html#support?conv=' || NEW.conversation_id::text,
      jsonb_build_object('message_id',NEW.id,'conversation_id',NEW.conversation_id)
    );
  END IF;
  RETURN NEW;
END;$$;

-- -------------------------------------------------------------------------------------
-- 7h. Avis du pro sur une réponse du bot (👍 / 👎)
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.support_bot_avis(p_message uuid, p_avis integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF p_avis IS NOT NULL AND p_avis NOT IN (-1, 1) THEN RAISE EXCEPTION 'Avis invalide' USING errcode = '22023'; END IF;
  UPDATE public.support_messages m SET bot_avis = p_avis
   WHERE m.id = p_message AND m.sender = 'bot'
     AND EXISTS (SELECT 1 FROM public.salons s WHERE s.id = m.salon_id AND s.user_id = auth.uid());
  RETURN FOUND;
END $$;
REVOKE ALL ON FUNCTION public.support_bot_avis(uuid, integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.support_bot_avis(uuid, integer) TO authenticated;

-- -------------------------------------------------------------------------------------
-- 8. RPC ADMIN (toutes exigent is_admin(), donc la double authentification)
-- -------------------------------------------------------------------------------------
-- 8a. Contexte du salon à côté de la conversation
CREATE OR REPLACE FUNCTION public.admin_support_contexte(p_salon uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb; s record; v_score int; v_score7 int; v_last_ticket timestamptz; v_last_rdv timestamptz;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Accès réservé à l''administrateur' USING errcode = '42501'; END IF;
  SELECT id, nom, plan, status, trial_end, is_free, free_until, cancelled_at, ferme_le, stripe_customer_id,
         stripe_subscription_id, last_login, created_at, email, gerant_prenom, metier, mode_caisse
    INTO s FROM public.salons WHERE id = p_salon;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'Salon introuvable'); END IF;
  SELECT score INTO v_score FROM public.salons_scores WHERE salon_id = p_salon ORDER BY jour DESC LIMIT 1;
  SELECT score INTO v_score7 FROM public.salons_scores WHERE salon_id = p_salon AND jour <= current_date - 7 ORDER BY jour DESC LIMIT 1;
  SELECT max(created_at) INTO v_last_ticket FROM public.tickets WHERE salon_id = p_salon;
  SELECT max(created_at) INTO v_last_rdv FROM public.appointments WHERE salon_id = p_salon;
  v := jsonb_build_object(
    'ok', true,
    'salon', jsonb_build_object('id', s.id, 'nom', s.nom, 'plan', s.plan, 'status', s.status, 'trial_end', s.trial_end,
             'is_free', s.is_free, 'free_until', s.free_until, 'cancelled_at', s.cancelled_at, 'ferme_le', s.ferme_le,
             'stripe_customer_id', s.stripe_customer_id, 'stripe_subscription_id', s.stripe_subscription_id,
             'last_login', s.last_login, 'created_at', s.created_at, 'email', s.email, 'prenom', s.gerant_prenom,
             'metier', s.metier, 'mode_caisse', s.mode_caisse),
    'score', v_score, 'score_7j', v_score7,
    'derniere_activite', greatest(s.last_login, v_last_ticket, v_last_rdv),
    'dernier_ticket', v_last_ticket, 'dernier_rdv', v_last_rdv,
    'erreurs', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'le' DESC) FROM (
        SELECT jsonb_build_object('source', e.source, 'niveau', e.severity, 'message', left(e.message, 300),
                                  'chemin', e.http_path, 'le', e.reported_at) AS x
          FROM public.server_errors e
         WHERE e.salon_id = p_salon AND e.reported_at > now() - interval '14 days'
           AND e.severity IN ('error','critical')
           AND e.source NOT IN ('slow_query','sw_push_recu','synthetic_check','pg_net')
           AND e.message !~* 'Failed to fetch|NetworkError|Load failed|ERR_INTERNET|ethereum|chrome-extension|moz-extension|safari-(web-)?extension'
         ORDER BY e.reported_at DESC LIMIT 10
      ) q), '[]'::jsonb),
    'journal', coalesce((
      SELECT jsonb_agg(x ORDER BY x->>'le' DESC) FROM (
        SELECT jsonb_build_object('action', a.action, 'details', left(a.details, 300), 'le', a.timestamp_action) AS x
          FROM public.audit_log a
         WHERE a.salon_id = p_salon AND a.timestamp_action > now() - interval '14 days'
           AND (a.action IN ('DB_ERROR','WAL_ABANDON','RAPPEL_EMAIL_ECHEC') OR a.action LIKE '%\_KO' OR a.action LIKE '%ECHEC%')
         ORDER BY a.timestamp_action DESC LIMIT 10
      ) q), '[]'::jsonb),
    'conversations', (SELECT count(*) FROM public.support_conversations WHERE salon_id = p_salon)
  );
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_support_contexte(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_contexte(uuid) TO authenticated;

-- 8b. Recherche dans le texte des messages et des notes internes (ILIKE, caractères spéciaux neutralisés)
CREATE OR REPLACE FUNCTION public.admin_support_recherche(p_q text)
RETURNS TABLE (conversation_id uuid, salon_id uuid, source text, extrait text, le timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_motif text;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Accès réservé à l''administrateur' USING errcode = '42501'; END IF;
  IF p_q IS NULL OR length(btrim(p_q)) < 2 THEN RETURN; END IF;
  v_motif := '%' || replace(replace(replace(left(btrim(p_q), 100), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  RETURN QUERY
    SELECT * FROM (
      SELECT m.conversation_id, m.salon_id, m.sender, left(m.message, 240), m.created_at
        FROM public.support_messages m WHERE m.message ILIKE v_motif
      UNION ALL
      SELECT n.conversation_id, n.salon_id, 'note', left(n.contenu, 240), n.created_at
        FROM public.support_notes n WHERE n.contenu ILIKE v_motif
    ) r ORDER BY 5 DESC LIMIT 100;
END $$;
REVOKE ALL ON FUNCTION public.admin_support_recherche(text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_recherche(text) TO authenticated;

-- 8c. Statistiques : délai de 1re réponse humaine, délai de résolution, volume par semaine, file d'attente
CREATE OR REPLACE FUNCTION public.admin_support_stats(p_jours integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_depuis timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 365)));
        v jsonb;
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Accès réservé à l''administrateur' USING errcode = '42501'; END IF;
  WITH conv AS (
    SELECT c.id, c.created_at, c.resolved_at, c.status, c.escalade_bot,
           (SELECT min(m.created_at) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender = 'client') AS t_client,
           (SELECT min(m.created_at) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender = 'admin') AS t_admin,
           EXISTS (SELECT 1 FROM support_messages m WHERE m.conversation_id = c.id AND m.sender = 'bot' AND m.read_by_admin = true) AS bot_a_repondu
      FROM support_conversations c WHERE c.created_at > v_depuis
  ), rep AS (
    SELECT extract(epoch FROM (t_admin - t_client)) / 60.0 AS mn FROM conv WHERE t_admin IS NOT NULL AND t_client IS NOT NULL AND t_admin > t_client
  ), res AS (
    SELECT extract(epoch FROM (resolved_at - created_at)) / 3600.0 AS h FROM conv WHERE resolved_at IS NOT NULL AND resolved_at > created_at
  ), attente AS (
    -- dernier message du pro sans réponse humaine ensuite, conversations non résolues
    SELECT c.id, (SELECT max(m.created_at) FROM support_messages m WHERE m.conversation_id = c.id AND m.sender = 'client') AS t
      FROM support_conversations c
     WHERE c.status <> 'resolved' AND c.bot_active = false
  )
  SELECT jsonb_build_object(
    'jours', p_jours,
    'conversations', (SELECT count(*) FROM conv),
    'premiere_reponse_min_moy', (SELECT round(avg(mn)::numeric, 0) FROM rep),
    'premiere_reponse_min_med', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY mn))::numeric, 0) FROM rep),
    'resolution_h_moy', (SELECT round(avg(h)::numeric, 1) FROM res),
    'resolution_h_med', (SELECT round((percentile_cont(0.5) WITHIN GROUP (ORDER BY h))::numeric, 1) FROM res),
    'escaladees', (SELECT count(*) FROM conv WHERE escalade_bot),
    'traitees_par_bot_seul', (SELECT count(*) FROM conv WHERE bot_a_repondu AND NOT escalade_bot AND t_admin IS NULL),
    'ouvertes', (SELECT count(*) FROM support_conversations WHERE status = 'open'),
    'en_attente_pro', (SELECT count(*) FROM support_conversations WHERE status = 'waiting'),
    'non_lus', (SELECT coalesce(sum(unread_count_admin), 0) FROM support_conversations WHERE status <> 'resolved'),
    'plus_ancienne_attente', (SELECT min(a.t) FROM attente a
                               WHERE a.t IS NOT NULL AND NOT EXISTS (SELECT 1 FROM support_messages m WHERE m.conversation_id = a.id AND m.sender = 'admin' AND m.created_at > a.t)),
    'par_semaine', coalesce((SELECT jsonb_agg(jsonb_build_object('semaine', w, 'n', n) ORDER BY w) FROM (
         SELECT to_char(date_trunc('week', created_at AT TIME ZONE 'Europe/Paris'), 'YYYY-MM-DD') AS w, count(*) AS n
           FROM support_conversations WHERE created_at > now() - interval '8 weeks' GROUP BY 1) q), '[]'::jsonb)
  ) INTO v;
  RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.admin_support_stats(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_stats(integer) TO authenticated;

-- 8d. Revue du bot : passages de main, avis négatifs, questions restées sans réponse
CREATE OR REPLACE FUNCTION public.admin_support_bot_revue(p_jours integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_depuis timestamptz := now() - make_interval(days => greatest(1, least(coalesce(p_jours, 30), 365)));
BEGIN
  IF NOT public.is_admin() THEN RAISE EXCEPTION 'Accès réservé à l''administrateur' USING errcode = '42501'; END IF;
  RETURN jsonb_build_object(
    'escalades', coalesce((SELECT jsonb_agg(x ORDER BY x->>'le' DESC) FROM (
      SELECT jsonb_build_object('conversation_id', b.conversation_id, 'salon_id', b.salon_id, 'salon', s.nom, 'le', b.created_at,
               'motif', c.escalade_motif,
               'question', (SELECT left(q.message, 600) FROM support_messages q WHERE q.conversation_id = b.conversation_id
                              AND q.sender = 'client' AND q.created_at <= b.created_at ORDER BY q.created_at DESC LIMIT 1)) AS x
        FROM support_messages b JOIN support_conversations c ON c.id = b.conversation_id LEFT JOIN salons s ON s.id = b.salon_id
       WHERE b.sender = 'bot' AND b.read_by_admin = false AND b.created_at > v_depuis
       ORDER BY b.created_at DESC LIMIT 100) q), '[]'::jsonb),
    'avis_negatifs', coalesce((SELECT jsonb_agg(x ORDER BY x->>'le' DESC) FROM (
      SELECT jsonb_build_object('conversation_id', b.conversation_id, 'salon_id', b.salon_id, 'salon', s.nom, 'le', b.created_at,
               'reponse', left(b.message, 800),
               'question', (SELECT left(q.message, 600) FROM support_messages q WHERE q.conversation_id = b.conversation_id
                              AND q.sender = 'client' AND q.created_at <= b.created_at ORDER BY q.created_at DESC LIMIT 1)) AS x
        FROM support_messages b LEFT JOIN salons s ON s.id = b.salon_id
       WHERE b.sender = 'bot' AND b.bot_avis = -1 AND b.created_at > v_depuis
       ORDER BY b.created_at DESC LIMIT 100) q), '[]'::jsonb),
    'avis_positifs', (SELECT count(*) FROM support_messages WHERE sender = 'bot' AND bot_avis = 1 AND created_at > v_depuis),
    'sans_reponse', coalesce((SELECT jsonb_agg(x ORDER BY x->>'le' DESC) FROM (
      SELECT jsonb_build_object('conversation_id', q.conversation_id, 'salon_id', q.salon_id, 'salon', s.nom, 'le', q.created_at,
               'question', left(q.message, 600)) AS x
        FROM support_messages q JOIN support_conversations c ON c.id = q.conversation_id LEFT JOIN salons s ON s.id = q.salon_id
       WHERE q.sender = 'client' AND q.created_at > v_depuis AND q.created_at < now() - interval '30 minutes'
         AND c.status <> 'resolved'
         AND NOT EXISTS (SELECT 1 FROM support_messages r WHERE r.conversation_id = q.conversation_id
                          AND r.sender IN ('admin','bot') AND r.created_at >= q.created_at)
       ORDER BY q.created_at DESC LIMIT 100) q), '[]'::jsonb)
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_support_bot_revue(integer) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_support_bot_revue(integer) TO authenticated;

-- -------------------------------------------------------------------------------------
-- 9. E-MAIL DE SECOURS (15 min sans lecture), sans doublon, silence 21 h – 8 h (heure de Paris)
-- -------------------------------------------------------------------------------------
-- Pro : 1er message de l'équipe non lu depuis 15 min -> e-mail au gérant (adresse du salon).
-- Admin : 1er message du pro non lu depuis 15 min, quand le bot ne répond pas (passé la main) -> support@luxyra.fr.
-- Un seul e-mail par série de messages non lus (clé dedup_key = id du plus ancien message non lu, index unique
-- uniq_messaging_log_dedup). Messages de plus de 3 jours ignorés. Envoi par le chemin habituel
-- (worker /api/email/custom, en-tête x-lx-internal = lx_prive.cle_service()). Notes internes : jamais envoyées.
-- p_essai = true : essai à blanc (aucune écriture, aucun envoi), même en heures de silence.
CREATE OR REPLACE FUNCTION lx_prive.support_relances_email(p_essai boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_h int := extract(hour FROM (now() AT TIME ZONE 'Europe/Paris'))::int;
  r record; v_html text; v_sujet text; v_envoyes int := 0; v_ignores int := 0; v_essai jsonb := '[]'::jsonb;
  v_lien text; v_extrait text;
BEGIN
  IF NOT coalesce(p_essai, false) AND (v_h >= 21 OR v_h < 8) THEN
    RETURN jsonb_build_object('ok', true, 'silence', true);
  END IF;

  FOR r IN
    -- A. Réponses de l'équipe non lues par le pro
    SELECT 'pro'::text AS dest, m.id, m.conversation_id, m.salon_id, m.message, m.pieces, m.created_at,
           s.nom AS salon_nom, trim(s.email) AS email, s.gerant_prenom AS prenom
      FROM support_conversations c
      JOIN LATERAL (SELECT * FROM support_messages x WHERE x.conversation_id = c.id AND x.sender = 'admin'
                      AND x.read_by_client = false ORDER BY x.created_at ASC LIMIT 1) m ON true
      JOIN salons s ON s.id = c.salon_id
     WHERE c.status <> 'resolved' AND s.ferme_le IS NULL
       AND m.created_at < now() - interval '15 minutes' AND m.created_at > greatest(now() - interval '3 days', timestamptz '2026-10-15 21:30:00+00') /* 2026-10-15 : jamais de relance pour un message antérieur à la mise en service */
       AND s.email ~ '^\s*[^@\s]+@[^@\s]+\.[^@\s]+\s*$'
    UNION ALL
    -- B. Messages du pro non lus par l'équipe (bot hors jeu)
    SELECT 'admin', m.id, m.conversation_id, m.salon_id, m.message, m.pieces, m.created_at,
           s.nom, 'support@luxyra.fr', NULL
      FROM support_conversations c
      JOIN LATERAL (SELECT * FROM support_messages x WHERE x.conversation_id = c.id AND x.sender = 'client'
                      AND x.read_by_admin = false ORDER BY x.created_at ASC LIMIT 1) m ON true
      JOIN salons s ON s.id = c.salon_id
     WHERE c.status <> 'resolved'
       AND m.created_at < now() - interval '15 minutes' AND m.created_at > greatest(now() - interval '3 days', timestamptz '2026-10-15 21:30:00+00') /* 2026-10-15 : jamais de relance pour un message antérieur à la mise en service */
       AND (c.bot_active = false
            OR NOT EXISTS (SELECT 1 FROM support_messages b WHERE b.conversation_id = c.id AND b.sender = 'bot' AND b.created_at >= m.created_at))
  LOOP
    BEGIN
      IF EXISTS (SELECT 1 FROM messaging_log WHERE dedup_key = 'support_relance|' || r.dest || '|' || r.id::text) THEN
        v_ignores := v_ignores + 1; CONTINUE;
      END IF;
      v_extrait := left(coalesce(nullif(btrim(r.message), ''), CASE WHEN jsonb_array_length(coalesce(r.pieces, '[]'::jsonb)) > 0 THEN '📎 Pièce jointe' ELSE '' END), 300);
      IF r.dest = 'pro' THEN
        v_sujet := 'Le support Luxyra vous a répondu';
        v_lien := 'https://luxyra.fr/app.html#support?conv=' || r.conversation_id::text;
      ELSE
        v_sujet := 'Support : message non lu de ' || coalesce(r.salon_nom, 'un établissement');
        v_lien := 'https://luxyra.fr/admin.html?tab=communication&sub=chat&conv=' || r.conversation_id::text;
      END IF;
      v_html := '<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>'
        || '<body style="margin:0;padding:0;background:#0a0a0a;font-family:Helvetica,Arial,sans-serif">'
        || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0a0a0a"><tr><td align="center" style="padding:24px 16px">'
        || '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;margin:0 auto">'
        || '<tr><td style="padding:24px 0;text-align:center"><img src="https://luxyra.fr/email/luxyra-logo-128.png" alt="Luxyra" style="height:48px"></td></tr>'
        || '<tr><td style="padding:8px 24px 16px;text-align:center;font-size:15px;color:rgba(255,255,255,.8);line-height:1.6">'
        || CASE WHEN r.dest = 'pro'
             THEN 'Bonjour' || CASE WHEN coalesce(r.prenom, '') <> '' THEN ' <strong style="color:#fff">' || lx_prive.html_esc(r.prenom) || '</strong>' ELSE '' END
                  || ',<br>l&#8217;&#233;quipe Luxyra a r&#233;pondu &#224; votre message pour <strong style="color:#fff">' || lx_prive.html_esc(coalesce(r.salon_nom, '')) || '</strong>.'
             ELSE 'Message de <strong style="color:#fff">' || lx_prive.html_esc(coalesce(r.salon_nom, '')) || '</strong> non lu depuis 15 minutes.' END
        || '</td></tr>'
        || '<tr><td style="padding:0 20px"><div style="background:#141418;border:1px solid #2a2a30;border-radius:16px;padding:16px 20px;color:#fff;font-size:14px;line-height:1.6;white-space:pre-line">'
        || lx_prive.html_esc(v_extrait) || '</div></td></tr>'
        || '<tr><td style="padding:22px 24px;text-align:center"><a href="' || lx_prive.html_esc(v_lien) || '" style="display:inline-block;background:#c8a84e;color:#111;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:10px">Ouvrir la conversation</a></td></tr>'
        || '<tr><td style="padding:0 24px 20px;text-align:center;font-size:12px;color:rgba(255,255,255,.45)">Un seul e-mail par message non lu ; aucun envoi entre 21 h et 8 h.</td></tr>'
        || '</table></td></tr></table></body></html>';

      IF coalesce(p_essai, false) THEN
        v_essai := v_essai || jsonb_build_object('dest', r.dest, 'email', r.email, 'conversation', r.conversation_id, 'sujet', v_sujet);
        CONTINUE;
      END IF;

      INSERT INTO messaging_log (salon_id, type, recipient, content, via, context, dedup_key)
      VALUES (r.salon_id, 'email', lower(r.email), CASE WHEN r.dest = 'pro' THEN 'Relance support (réponse non lue)' ELSE 'Relance support (équipe)' END,
              'brevo', 'support_relance', 'support_relance|' || r.dest || '|' || r.id::text);
      PERFORM net.http_post(
        url := 'https://luxyra.fr/api/email/custom',
        headers := jsonb_build_object('Content-Type', 'application/json', 'x-lx-internal', lx_prive.cle_service()),
        body := jsonb_build_object('to', r.email, 'toName', coalesce(r.prenom, ''), 'salonName', 'Luxyra',
                                   'salonEmail', 'support@luxyra.fr', 'subject', v_sujet, 'htmlContent', v_html),
        timeout_milliseconds := 30000);
      v_envoyes := v_envoyes + 1;
    EXCEPTION
      WHEN unique_violation THEN v_ignores := v_ignores + 1;
      WHEN OTHERS THEN
        BEGIN
          INSERT INTO audit_log (salon_id, action, details, operator_name)
          VALUES (r.salon_id, 'SUPPORT_RELANCE_ECHEC', 'Relance e-mail support non envoyée : ' || SQLERRM, 'traitement_automatique');
        EXCEPTION WHEN OTHERS THEN NULL; END;
    END;
  END LOOP;

  IF coalesce(p_essai, false) THEN RETURN jsonb_build_object('ok', true, 'essai', true, 'a_envoyer', v_essai, 'ignores', v_ignores); END IF;
  RETURN jsonb_build_object('ok', true, 'envoyes', v_envoyes, 'ignores', v_ignores);
END $$;
REVOKE ALL ON FUNCTION lx_prive.support_relances_email(boolean) FROM public, anon, authenticated;

-- Toutes les 5 minutes (la fonction ne fait rien entre 21 h et 8 h)
DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'support-relances-email') THEN
    PERFORM cron.unschedule('support-relances-email');
  END IF;
  PERFORM cron.schedule('support-relances-email', '*/5 * * * *', 'select lx_prive.support_relances_email(false)');
END
$cron$;

-- -------------------------------------------------------------------------------------
-- 10. BASE DE CONNAISSANCES DU BOT
-- -------------------------------------------------------------------------------------
UPDATE public.support_bot_kb SET contenu =
'Paramètres → « Support Luxyra » (ou avatar → « Contacter le support ») : onglets « En cours » et « Historique », bouton « ＋ Nouveau sujet », bouton « 🙋 Humain » pour parler à l''équipe, bouton « ✓ Résolu ».
- Statut affiché sur chaque conversation : « Ouverte » (l''équipe doit répondre), « Réponse reçue » (l''équipe a répondu, à vous de jouer), « Résolue ». Écrire dans une conversation résolue n''est pas possible : créer un nouveau sujet.
- Capture d''écran / pièce jointe : bouton « 📎 » à gauche du champ de message. Images (PNG, JPEG, WebP) ou PDF, 5 Mo maximum, jusqu''à 5 fichiers par message. Les images s''affichent en aperçu ; un toucher les ouvre en grand. Les fichiers sont privés : seuls l''établissement et l''équipe Luxyra peuvent les voir.
- « En train d''écrire… » s''affiche quand l''équipe rédige une réponse ; « Vu » sous votre dernier message quand l''équipe l''a lu.
- Sous chaque réponse de l''assistant : « 👍 » / « 👎 » pour dire si elle a aidé (un 👎 aide l''équipe à améliorer l''assistant ; pour une réponse humaine, utiliser « 🙋 Humain »).
- Une pastille rouge sur la bulle 💬 compte les réponses non lues (équipe et assistant).
- Si une réponse de l''équipe n''est pas lue au bout de 15 minutes, un e-mail est envoyé à l''adresse de l''établissement (jamais entre 21 h et 8 h, un seul e-mail par réponse).
- L''assistant ne voit pas les images : si une capture est envoyée, la conversation passe directement à un humain.
Migration : Paramètres → « Migration depuis ancien logiciel » → formulaire ; l''équipe rappelle sous 4 h ouvrées.',
  maj_le = now()
WHERE cle = 'support';

INSERT INTO public.support_bot_kb (cle, titre, ordre, contenu, actif)
VALUES ('support_pieces_1015', 'Envoyer une capture d''écran au support', 909,
'Dans la conversation de support (bulle 💬 ou Paramètres → « Support Luxyra »), bouton « 📎 » à gauche du champ de message : choisir une image (PNG, JPEG, WebP) ou un PDF de 5 Mo maximum. Sur téléphone, faire d''abord la capture (boutons du téléphone), puis la choisir dans la galerie. Un texte peut accompagner le fichier. Les autres formats (vidéo, Word, HTML, SVG…) sont refusés. Quand une capture est envoyée, l''assistant passe la main à un humain car il ne peut pas lire les images.', true)
ON CONFLICT (cle) DO UPDATE SET titre = EXCLUDED.titre, contenu = EXCLUDED.contenu, ordre = EXCLUDED.ordre, actif = true, maj_le = now();

COMMIT;
