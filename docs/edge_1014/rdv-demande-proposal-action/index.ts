// rdv-demande-proposal-action v13 — 2026-10-14 audit (suite) : RDV déjà créé pour la proposition (essai
// interrompu) RÉUTILISÉ au lieu d'un second insert ; passage « confirmed » conditionnel (status proposed +
// notre verrou) et vérifié ; échec = verrou conservé + 500 (un réessai après 3 min reprend le même RDV).
// v12 — 2026-10-14 audit : verrou de confirmation (UPDATE conditionnel
// status='proposed' + confirm_claim_at) AVANT l'insertion du RDV (double tap / deux onglets = un seul RDV).
// Nécessite les colonnes rdv_demandes.confirm_claim_at / stripe_session_id (docs/migrations_1014/site.sql).
// v10 (+ contrôle lx_creneau_libre à la confirmation) — v9 — 2026-10-09 : plus aucun débit sur le compte Luxyra (ancien « chemin B »). Sans compte
// Stripe du salon, le RDV est confirmé et l'acompte reste à régler au salon. v8 — v7 + colonne client_luxyra_id (renommage beautypro->luxyra non propage : toute proposition etait « introuvable »)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}

{ const _LX_FN="rdv-demande-proposal-action"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

async function loadByToken(token: string) { const { data, error } = await sb.from("rdv_demandes").select("id, salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, status, proposed_data, proposal_expires_at, refused_at, confirmed_at, rdv_online_id").eq("proposal_token", token).single(); if (error || !data) return null; return data; }
async function loadSalon(salon_id: string) { const { data: pub } = await sb.from("salons_public").select("id, nom, adresse, cp, ville, logo, stripe_connect_id, stripe_connect_status, metier").eq("id", salon_id).single(); if (!pub) return null; const { data: priv } = await sb.from("salons").select("tel").eq("id", salon_id).single(); return { ...pub, telephone: priv?.tel || null }; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const token = String(body.token || "").trim();
    const action = String(body.action || "get").trim();
    if (!token || token.length < 16) return json(400, { error: "Token invalide" });
    const dem = await loadByToken(token);
    if (!dem) return json(404, { error: "Proposition introuvable ou expirée" });
    if (dem.proposal_expires_at && new Date(dem.proposal_expires_at) < new Date()) {
      if (dem.status === "proposed") await sb.from("rdv_demandes").update({ status: "expired" }).eq("id", dem.id).eq("status", "proposed");
      return json(410, { error: "Cette proposition a expiré. Contactez le salon pour relancer une demande." });
    }
    if (action === "get") {
      const salon = await loadSalon(dem.salon_id);
      return json(200, { ok: true, demande: { id: dem.id, status: dem.status, proposed_data: dem.proposed_data, expires_at: dem.proposal_expires_at, confirmed_at: dem.confirmed_at, refused_at: dem.refused_at, rdv_online_id: dem.rdv_online_id, client: { nom: dem.client_nom, prenom: dem.client_prenom, tel: dem.client_tel, email: dem.client_email } }, salon });
    }
    if (action === "refuse") {
      if (dem.status !== "proposed") return json(409, { error: "Cette proposition n'est plus active" });
      const reason = body.reason ? String(body.reason).slice(0, 500) : null;
      // 2026-10-14 audit : pas de refus pendant une confirmation en cours (verrou frais < 3 min)
      const _stale = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const { data: _ref, error } = await sb.from("rdv_demandes").update({ status: "refused", refused_at: new Date().toISOString(), refuse_reason: reason }).eq("id", dem.id).eq("status", "proposed").or(`confirm_claim_at.is.null,confirm_claim_at.lt.${_stale}`).select("id");
      if (error) { await (globalThis as any).__lxReport?.("Update refused échec: "+error.message, "error", undefined, { id: dem.id }); return json(500, { error: error.message }); }
      if (!_ref || !_ref.length) return json(409, { error: "Cette proposition est en cours de confirmation ou n'est plus active" });
      return json(200, { ok: true });
    }
    if (action === "confirm") {
      if (dem.status !== "proposed") return json(409, { error: "Cette proposition n'est plus active" });
      const pd = dem.proposed_data || {};
      if (!pd.date || !pd.heure || !pd.items || !Array.isArray(pd.items) || !pd.items.length) return json(500, { error: "Données de proposition invalides" });
      const acompteRequired = Number(pd.acompte_montant) || 0;
      // Salon avec compte Stripe actif : l'acompte DOIT être payé en ligne (worker /api/rdv-demande/connect-pay).
      if (acompteRequired > 0) {
        const _s = await loadSalon(dem.salon_id);
        if (_s && _s.stripe_connect_id && ["active", "enabled", "payouts_pending"].includes(String(_s.stripe_connect_status || ""))) {
          return json(409, { error: "L'acompte de ce rendez-vous se règle en ligne : utilisez le bouton de paiement." });
        }
      }
      // 2026-10-14 audit : prise atomique de la demande (un seul RDV même en cas de double appel)
      const _staleIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
      const _claimAt = new Date().toISOString();
      const { data: _claim, error: _claimErr } = await sb.from("rdv_demandes")
        .update({ confirm_claim_at: _claimAt })
        .eq("id", dem.id).eq("status", "proposed")
        .or(`confirm_claim_at.is.null,confirm_claim_at.lt.${_staleIso}`)
        .select("id");
      if (_claimErr) { await (globalThis as any).__lxReport?.("Claim proposition échec: "+_claimErr.message, "error", undefined, { id: dem.id }); return json(500, { error: "Confirmation momentanément impossible, réessayez." }); }
      if (!_claim || !_claim.length) {
        const again = await loadByToken(token);
        if (again && again.status === "confirmed") return json(200, { ok: true, already_confirmed: true, rdv_online_id: again.rdv_online_id });
        return json(409, { error: "Confirmation déjà en cours, patientez quelques secondes puis rechargez la page." });
      }
      const liberer = async () => { try { await sb.from("rdv_demandes").update({ confirm_claim_at: null }).eq("id", dem.id).eq("status", "proposed"); } catch (_) {} };
      // v13 : marqueur stable du RDV issu de cette proposition (rdv_online n'a pas de colonne demande_id ;
      // rdv_demandes.rdv_online_id n'est posé qu'à la fin -> un essai interrompu laisse un RDV non relié).
      const _marqueur = "RDV sur mesure (proposition #" + dem.id.slice(0, 8) + ")";
      const { data: _exist, error: _existErr } = await sb.from("rdv_online").select("id")
        .eq("salon_id", dem.salon_id).eq("date_rdv", pd.date).eq("heure_rdv", pd.heure)
        .like("message", _marqueur + "%")
        .order("created_at", { ascending: false }).limit(1);
      if (_existErr) {
        await (globalThis as any).__lxReport?.("Lecture rdv_online existant (proposition) échec: "+_existErr.message, "error", undefined, { demande_id: dem.id });
        await liberer();
        return json(500, { error: "Confirmation momentanément impossible, réessayez." });
      }
      let rdvId: string | null = (_exist && _exist[0] && (_exist[0] as { id: string }).id) || null;
      // v10 : vérifie que le créneau est toujours libre avant de créer le RDV (erreur RPC = on ne bloque pas). v13 : sauté si le RDV de cette proposition existe déjà (réessai).
      if (!rdvId) {
        const { data: _libre, error: _libreErr } = await sb.rpc("lx_creneau_libre", { p_salon: dem.salon_id, p_collab: pd.collaborateur_id ? Number(pd.collaborateur_id) : null, p_date: pd.date, p_heure: pd.heure, p_duree: Number(pd.duree_minutes) || 30 });
        if (!_libreErr && _libre === false) {
          await sb.from("rdv_demandes").update({ refuse_reason: "Créneau pris entre-temps (vérifié à la confirmation)", confirm_claim_at: null }).eq("id", dem.id);
          return json(409, { error: "Ce créneau vient d'être pris entre-temps. Le salon a été prévenu et va vous proposer un autre horaire.", creneau_pris: true });
        }
      }
      const primaryItem = pd.items[0];
      const serviceNom = pd.items.length > 1 ? pd.items.map((x: {nom: string}) => x.nom).join(" + ") : primaryItem.nom;
      const itemsPayload = pd.items.map((it: {service_id: number; nom: string; prix: number; duree: number}, idx: number) => ({ service_id: it.service_id, nom: it.nom, prix: Number(it.prix) || 0, duree: Number(it.duree) || 0, ordre: idx }));
      const insertPayload = { salon_id: dem.salon_id, client_nom: dem.client_nom, client_prenom: dem.client_prenom, client_tel: dem.client_tel, client_email: dem.client_email, client_luxyra_id: dem.client_luxyra_id, service_id: primaryItem.service_id, service_nom: serviceNom, service_prix: Number(pd.prix_total) || 0, items: itemsPayload, collaborateur_id: pd.collaborateur_id || null, collaborateur_nom: pd.collaborateur_nom || null, date_rdv: pd.date, heure_rdv: pd.heure, duree_minutes: Number(pd.duree_minutes) || 30, acompte_montant: acompteRequired, acompte_paye: false, stripe_payment_id: null, stripe_token: null, stripe_brand: null, stripe_last4: null, status: "confirmed", message: _marqueur + (acompteRequired > 0 ? " — acompte de " + acompteRequired + " € à régler au salon" : "") };
      if (!rdvId) {
        const { data: rdvCreated, error: insErr } = await sb.from("rdv_online").insert(insertPayload).select("id").single();
        if (insErr || !rdvCreated) {
          console.error("rdv_online insert failed", insErr);
          await (globalThis as any).__lxReport?.("Insert rdv_online proposal failed: "+(insErr?.message || "aucune ligne"), "critical", undefined, { demande_id: dem.id });
          await liberer(); // aucun RDV créé : on peut rendre la main
          return json(500, { error: "Création du RDV échouée: " + (insErr?.message || "aucune ligne") });
        }
        rdvId = rdvCreated.id;
      }
      // Conditionnel : encore « proposed » ET encore NOTRE verrou. Échec -> verrou conservé (personne ne
      // peut insérer un second RDV pendant 3 min) ; le réessai suivant retrouve le RDV via le marqueur.
      const { data: _conf, error: _confErr } = await sb.from("rdv_demandes")
        .update({ status: "confirmed", confirmed_at: new Date().toISOString(), rdv_online_id: rdvId })
        .eq("id", dem.id).eq("status", "proposed").eq("confirm_claim_at", _claimAt)
        .select("id");
      if (_confErr || !_conf || !_conf.length) {
        const again = await loadByToken(token);
        if (again && again.status === "confirmed" && again.rdv_online_id === rdvId) return json(200, { ok: true, already_confirmed: true, rdv_online_id: rdvId });
        await (globalThis as any).__lxReport?.("Proposition non passée en confirmée après création du RDV: "+(_confErr?.message || "0 ligne"), "error", undefined, { demande_id: dem.id, rdv_online_id: rdvId });
        return json(500, { error: "Votre confirmation est en cours de finalisation. Réessayez dans quelques minutes ou contactez l'établissement.", en_cours: true });
      }
      return json(200, { ok: true, rdv_online_id: rdvId });
    }
    return json(400, { error: "Action inconnue: " + action });
  } catch (e) {
    console.error("rdv-demande-proposal-action unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
