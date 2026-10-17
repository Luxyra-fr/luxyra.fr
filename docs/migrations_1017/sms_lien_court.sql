-- =====================================================================================================
-- 2026-10-17 — SMS publicitaires : lien de désinscription COURT « \nStop SMS: luxyra.fr/s/<code> »
-- APPLIQUÉ le 17/10/2026 (base kxdgjtvrkwugbifgppai).
-- =====================================================================================================
-- Décision du propriétaire (17/10) : PAS de mention Brevo « STOP au 36xxx » (app_config.config.sms_stop_brevo
-- reste absent / false — vérifié : absent). Les SMS publicitaires (campagnes, anniversaire, relance) portent
-- NOTRE lien de désinscription :
--     « \nStop SMS: luxyra.fr/s/k3x9a2 »  = 29 caractères GSM-7 (saut de ligne compris), toujours 29
--     (code de 6 caractères [a-z0-9], unique, créé à la première utilisation, collision gérée).
--   => un SMS publicitaire tient en 1 SMS si son texte (variables remplacées) fait au plus 160 - 29 = 131 caractères.
-- Les anciens codes de 10 caractères hexadécimaux (luxyra.fr/stop/<code>) restent valides.
--
-- Ce que fait ce fichier :
--   1. lx_desinscription_codes.code_court (6 caractères base36 minuscules, unique) ; nouveaux codes : code = code_court.
--   2. lx_prive.code_desinscription renvoie toujours le code COURT (le crée au besoin, y compris pour une ligne
--      existante à code long) ; lx_desinscrire_code / lx_desinscription_info acceptent les deux formats.
--   3. Lien SMS (canal sms) : la désinscription n'éteint PLUS clients.sms_ok (qui commande aussi les rappels de
--      RDV) : elle inscrit le numéro dans lx_sms_stop (opposition aux SMS publicitaires, même filtre que la
--      réponse STOP). Les rappels et confirmations de RDV continuent. Canal email / all : inchangé pour l'e-mail.
--   4. traiter_sms_differes : mention « \nStop SMS: luxyra.fr/s/<code> » (au lieu de « STOP SMS : luxyra.fr/stop/… »),
--      ajoutée à TOUT SMS publicitaire (l'interrupteur sms_stop_brevo n'a plus d'effet sur la mention), sauf si le
--      texte contient déjà un lien luxyra.fr/s/ ou luxyra.fr/stop/ ; client introuvable -> SMS publicitaire NON
--      envoyé (échec motivé) au lieu de partir sans désinscription ; coût = texte réellement envoyé (mention comprise).
--   5. envoyer_sms_anniv_relance : texte d'anniversaire par défaut réécrit (1 SMS garanti), liens e-mail -> /s/.
--   6. public.lx_code_desinscription_sms(salon, téléphone) : code court pour le worker (SMS d'anniversaire /
--      relance / campagne envoyés depuis l'appareil avec un contexte publicitaire). service_role uniquement.
-- Rappels 24 h / 2 h, confirmations, modifications, annulations (transactionnels) : aucune mention (inchangé).
-- =====================================================================================================
set lock_timeout = '8s';

-- 1. Colonne du code court ---------------------------------------------------------------------------
alter table public.lx_desinscription_codes add column if not exists code_court text;
create unique index if not exists lx_desinscription_codes_code_court_key on public.lx_desinscription_codes (code_court);
do $$ begin
  alter table public.lx_desinscription_codes add constraint lx_desinscription_codes_code_court_format
    check (code_court is null or code_court ~ '^[a-z0-9]{6}$');
exception when duplicate_object then null; end $$;

-- 6 caractères base36 minuscules (36^6 ≈ 2,2 milliards de valeurs), tirés de gen_random_uuid (aléa cryptographique)
create or replace function lx_prive.code_court_aleatoire()
returns text language sql volatile set search_path to 'pg_catalog' as $$
  select string_agg(substr('abcdefghijklmnopqrstuvwxyz0123456789', (get_byte(x.b, i) % 36) + 1, 1), '' order by i)
    from (select uuid_send(gen_random_uuid()) as b) x, generate_series(0, 5) i
$$;

-- 2. Code de désinscription (toujours le code court) -------------------------------------------------
create or replace function lx_prive.code_desinscription(p_client uuid, p_canal text)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
-- 2026-10-17 audit réglages (#4) ; 2026-10-17 lien court : renvoie le code COURT (6 caractères [a-z0-9]) du client
-- pour ce canal ; le crée au besoin (collision : nouvel essai, 8 au plus). Les anciens codes longs restent valides.
declare v_code text; v_court text; v_i int := 0;
begin
  if p_client is null or p_canal not in ('sms', 'email', 'all') then return null; end if;
  select code, code_court into v_code, v_court from public.lx_desinscription_codes where client_id = p_client and canal = p_canal;
  if v_court is not null then return v_court; end if;
  loop
    v_i := v_i + 1;
    v_court := lx_prive.code_court_aleatoire();
    begin
      if v_code is not null then
        update public.lx_desinscription_codes set code_court = v_court
         where client_id = p_client and canal = p_canal and code_court is null;
        if found then return v_court; end if;
      else
        insert into public.lx_desinscription_codes (code, code_court, client_id, canal) values (v_court, v_court, p_client, p_canal);
        return v_court;
      end if;
    exception when unique_violation then
      null;  -- code déjà pris (ou ligne créée en parallèle) : relecture puis nouvel essai
    end;
    select code, code_court into v_code, v_court from public.lx_desinscription_codes where client_id = p_client and canal = p_canal;
    if v_court is not null then return v_court; end if;
    if v_i >= 8 then return null; end if;
  end loop;
end $function$;

create or replace function public.lx_desinscription_info(p_code text)
returns jsonb language sql stable security definer set search_path to 'public', 'pg_temp' as $function$
  -- 2026-10-17 audit réglages (#4) ; lien court : code long (10 hex) ou court (6 [a-z0-9])
  -- deja : e-mail -> email_ok déjà à faux ; SMS -> numéro déjà opposé aux SMS publicitaires
  select coalesce((select jsonb_build_object('ok', true, 'canal', d.canal, 'salon', coalesce(s.nom, ''),
                                             'deja', d.utilise_le is not null)
                     from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
                     left join public.salons s on s.id = c.salon_id
                    where coalesce(p_code, '') ~ '^([0-9a-f]{10}|[a-z0-9]{6})$'
                      and (d.code = p_code or d.code_court = p_code)
                    limit 1), jsonb_build_object('ok', false))
$function$;

create or replace function public.lx_desinscrire_code(p_code text)
returns jsonb language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
-- 2026-10-17 audit réglages (#4) : lien « Stop SMS » / « Se désinscrire » (luxyra.fr/s/<code>, luxyra.fr/stop/<code>)
-- 2026-10-17 lien court : SMS -> opposition aux SMS PUBLICITAIRES (lx_sms_stop), clients.sms_ok inchangé :
--   les rappels et confirmations de rendez-vous continuent (comme pour une réponse STOP).
declare v record; v_salon text; v_tel text;
begin
  if coalesce(p_code, '') !~ '^([0-9a-f]{10}|[a-z0-9]{6})$' then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide'); end if;
  select d.code, d.canal, d.client_id, c.salon_id, c.prenom, c.nom, c.telephone into v
    from public.lx_desinscription_codes d join public.clients c on c.id = d.client_id
   where d.code = p_code or d.code_court = p_code
   limit 1;
  if not found then return jsonb_build_object('ok', false, 'erreur', 'Lien invalide ou expiré'); end if;
  if v.canal in ('email', 'all') then
    update public.clients set email_ok = false, updated_at = now() where id = v.client_id;
  end if;
  if v.canal in ('sms', 'all') then
    v_tel := public.normalize_phone(v.telephone);
    if v_tel is not null then
      insert into public.lx_sms_stop (telephone_norm, source, salon_id, details)
      values (v_tel, 'lien_desinscription', v.salon_id, 'Lien Stop SMS (luxyra.fr/s/) : plus de SMS publicitaires')
      on conflict (telephone_norm) do update set maj_le = now();
      delete from public.lx_sms_stop_levee where telephone_norm = v_tel;
    end if;
  end if;
  update public.lx_desinscription_codes set utilise_le = coalesce(utilise_le, now()) where code = v.code;
  select s.nom into v_salon from public.salons s where s.id = v.salon_id;
  begin
    insert into public.audit_log (salon_id, action, details, operator_name)
    values (v.salon_id, 'RGPD_UNSUBSCRIBE',
            'Client ' || trim(coalesce(v.prenom,'') || ' ' || coalesce(v.nom,'')) || ' désabonné (' || v.canal || ') via le lien de désinscription'
            || case when v.canal in ('sms', 'all') then ' : plus aucun SMS publicitaire (campagnes, anniversaire, relance) ; les rappels et confirmations de RDV continuent' else '' end,
            'Auto (lien de désinscription)');
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'canal', v.canal, 'salon', coalesce(v_salon, ''));
end $function$;

-- 6. Code court pour le worker (SMS publicitaire envoyé depuis l'appareil) ---------------------------
create or replace function public.lx_code_desinscription_sms(p_salon uuid, p_tel text)
returns text language plpgsql security definer set search_path to 'public', 'pg_temp' as $function$
declare v_cid uuid;
begin
  if p_salon is null or public.normalize_phone(p_tel) is null then return null; end if;
  select c.id into v_cid from public.clients c
   where c.salon_id = p_salon and c.telephone_norm = public.normalize_phone(p_tel)
     and c.fusionne_dans is null and c.rgpd_anonymise_le is null
   order by c.created_at limit 1;
  if v_cid is null then return null; end if;
  return lx_prive.code_desinscription(v_cid, 'sms');
end $function$;
revoke all on function public.lx_code_desinscription_sms(uuid, text) from public, anon, authenticated;
grant execute on function public.lx_code_desinscription_sms(uuid, text) to service_role;

-- 4-5. Remplacements exacts dans les fonctions existantes ---------------------------------------------
create or replace function pg_temp.lx_remplacer(p_src text, p_avant text, p_apres text, p_nb int default 1)
returns text language plpgsql as $$
declare n int := (length(p_src) - length(replace(p_src, p_avant, ''))) / greatest(length(p_avant), 1);
begin
  if n <> p_nb then raise exception 'motif trouvé % fois (attendu %) : %', n, p_nb, left(p_avant, 120); end if;
  return replace(p_src, p_avant, p_apres);
end $$;

do $migr$
declare d text;
begin
  -- ===== traiter_sms_differes =====
  d := pg_get_functiondef('public.traiter_sms_differes(uuid)'::regprocedure);
  d := pg_temp.lx_remplacer(d, $p$      -- 2026-10-17 audit réglages (#4) : SMS de prospection -> lien de désinscription « STOP SMS » (fiche du salon)
      -- (remplacé par la mention officielle Brevo « STOP au 36xxx », ajoutée par le worker, quand sms_stop_brevo = true)
      v_envoi := r.message;
      IF NOT v_stop_brevo AND lx_prive.desinscription_active() AND r.contexte IN ('marketing','anniversaire','relance') AND r.message !~* '(^|[^a-z])stop([^a-z]|$)' THEN$p$,
$p$      -- 2026-10-17 (lien court) : SMS publicitaire -> « \nStop SMS: luxyra.fr/s/<code> » (29 caractères, fiche du salon).
      -- Jamais la mention Brevo « STOP au 36xxx » (décision du 17/10, quel que soit sms_stop_brevo).
      v_envoi := r.message;
      IF v_pub AND lx_prive.desinscription_active() AND r.message !~* 'luxyra\.fr/(s|stop)/' THEN$p$);
  d := pg_temp.lx_remplacer(d, $p$        IF v_code IS NOT NULL THEN v_envoi := rtrim(r.message) || E'\nSTOP SMS : luxyra.fr/stop/' || v_code; END IF;
      END IF;$p$,
$p$        IF v_code IS NOT NULL THEN
          v_envoi := rtrim(r.message) || E'\nStop SMS: luxyra.fr/s/' || v_code;
        ELSE
          -- jamais de SMS publicitaire sans moyen de désinscription
          UPDATE sms_differes SET statut='echec', traite_le=clock_timestamp(),
                 motif='SMS publicitaire non envoyé : lien de désinscription impossible (client introuvable dans le fichier)' WHERE id = r.id;
          v_echecs := v_echecs + 1; CONTINUE;
        END IF;
      END IF;$p$);
  d := pg_temp.lx_remplacer(d, $p$      -- 2026-10-17 : la mention Brevo « \nSTOP au 36xxx » (14 caractères) est comptée dans le coût
      v_nb := lx_prive.sms_nb(CASE WHEN v_pub AND v_stop_brevo THEN rtrim(v_envoi) || E'\nSTOP au 36XXX' ELSE v_envoi END);$p$,
$p$      -- 2026-10-17 (lien court) : coût = texte réellement envoyé, mention « Stop SMS » comprise
      v_nb := lx_prive.sms_nb(v_envoi);$p$);
  d := pg_temp.lx_remplacer(d, $p$
                || CASE WHEN v_pub AND v_stop_brevo THEN jsonb_build_object('context', r.contexte) ELSE '{}'::jsonb END,$p$,
$p$,  -- 2026-10-17 (lien court) : sans contexte -> le worker n'ajoute rien (lien déjà dans le texte)$p$);
  execute d;

  -- ===== envoyer_sms_anniv_relance =====
  d := pg_get_functiondef('public.envoyer_sms_anniv_relance()'::regprocedure);
  d := pg_temp.lx_remplacer(d, $p$'Joyeux anniversaire {prenom} ! {salon} vous souhaite une merveilleuse journee. Profitez de -10% sur votre prochaine visite !'$p$,
$p$'Joyeux anniversaire {prenom} ! {salon} vous offre -10% sur votre prochaine visite. Belle journée !'$p$);
  d := pg_temp.lx_remplacer(d, $p$'https://luxyra.fr/stop/' || v_code$p$, $p$'https://luxyra.fr/s/' || v_code$p$, 2);
  execute d;
end $migr$;

-- =====================================================================================================
-- 7. Bot de support (APPLIQUÉ le 17/10/2026) : entrées desinscription_marketing_1017, sms_stop_creneaux_1017
--    et sms_lien_court_1017 réécrites / ajoutées (mention « Stop SMS: luxyra.fr/s/… », 29 caractères, compteur
--    1 SMS / 2 SMS, STOP et lien n'empêchent jamais les rappels). Texte complet : voir support_bot_kb.
-- =====================================================================================================

-- =====================================================================================================
-- 8. Tests faits le 17/10/2026 vers 19 h 45 (transactions annulées, rien d'envoyé)
--   * app_config.config.sms_stop_brevo : absent (= false) ; desinscription_courte = true.
--   * code_desinscription : « 3po9sz » (6 car.), même code au 2e appel et via lx_code_desinscription_sms ;
--     ligne à ancien code long « abcdef0123 » -> code court ajouté, les deux codes ouvrent la même fiche.
--   * lx_desinscrire_code(code court, canal sms) : lx_sms_stop rempli, clients.sms_ok reste VRAI (rappels gardés),
--     info.deja = true ensuite.
--   * sms_nb : 131 car. + mention (29) = 160 -> 1 SMS ; 132 + 29 = 161 -> 2 SMS ; length(mention) = 29.
--   * traiter_sms_differes (salon e0cf27c7, créneau ouvert) : campagne d'un client connu -> corps envoyé
--     « Test campagne …\nStop SMS: luxyra.fr/s/0apl4z », sans 'context' ; numéro inconnu -> « echec », motif
--     « SMS publicitaire non envoyé : lien de désinscription impossible … ».
-- Textes enregistrés des établissements (config_json, NON modifiés) qui dépassent 1 SMS avec le lien (29) :
--   Excellence Coiffure : anniversaire 162 (Marie) / 172 (Marie-Christine) ; relance 186 / 196 (tous deux désactivés).
--   O'R STUDIO : anniversaire 153 / 163 (2 SMS dès 14 caractères de prénom) ; relance 177 / 187 (ACTIVE -> 2 SMS).
--   Delphinecoiff : textes vides -> textes par défaut du serveur (anniversaire 152 au pire, relance 150) = 1 SMS.
-- =====================================================================================================
