-- Retour arrière de comptes_securite.sql (31/10/2026). Remet les droits d'avant (anon/authenticated : tous droits de table,
-- RLS inchangée), l'ancienne synchronisation par e-mail et l'ancienne garde. Garde la clé Brevo dans le coffre (sans effet).
-- À n'utiliser qu'en cas de régression constatée ; redéployer aussi lx-brevo-webhook v3 (docs/edge_1030_email/avant).
begin;
grant select, insert, update, delete on public.clients_luxyra to anon, authenticated;
grant select, insert, update, delete on public.client_invites to anon, authenticated;
create or replace function public.sync_clients_luxyra_from_salon(p_email text, p_nom text DEFAULT NULL::text, p_prenom text DEFAULT NULL::text, p_telephone text DEFAULT NULL::text, p_genre text DEFAULT NULL::text, p_adresse text DEFAULT NULL::text, p_cp text DEFAULT NULL::text, p_ville text DEFAULT NULL::text, p_date_naissance date DEFAULT NULL::date, p_sms_ok boolean DEFAULT NULL::boolean, p_email_ok boolean DEFAULT NULL::boolean)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_user_id uuid; v_is_salon boolean; v_nb_updated int;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentification requise'; END IF;
  SELECT EXISTS(SELECT 1 FROM salons WHERE user_id = v_user_id) INTO v_is_salon;
  IF NOT v_is_salon AND NOT is_admin() THEN RAISE EXCEPTION 'Réservé aux salons et admins'; END IF;
  IF p_email IS NULL OR p_email = '' THEN RETURN jsonb_build_object('ok', false, 'reason', 'email vide'); END IF;
  UPDATE clients_luxyra SET nom = COALESCE(p_nom, nom), prenom = COALESCE(p_prenom, prenom), telephone = COALESCE(p_telephone, telephone),
    genre = COALESCE(p_genre, genre), adresse = COALESCE(p_adresse, adresse), cp = COALESCE(p_cp, cp), ville = COALESCE(p_ville, ville),
    date_naissance = COALESCE(p_date_naissance, date_naissance), sms_ok = COALESCE(p_sms_ok, sms_ok), email_ok = COALESCE(p_email_ok, email_ok), updated_at = NOW()
  WHERE LOWER(email) = LOWER(p_email)
    AND (public.is_admin() OR EXISTS (SELECT 1 FROM public.clients c JOIN public.salons s ON s.id = c.salon_id
                                      WHERE s.user_id = auth.uid() AND LOWER(c.email) = LOWER(p_email)));
  GET DIAGNOSTICS v_nb_updated = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'updated', v_nb_updated, 'email', p_email);
END;
$function$;
drop function if exists public.lx_brevo_webhook_controle(text);
drop table if exists lx_prive.brevo_webhook_etat;
-- bp_protect_sensitive : la version étendue est conservée (plus stricte, sans effet sur les appels serveur).
commit;
