// rdv-demande-create v8 — 2026-10-14 SECURITE : même secret de session que lx-signup / lx-login
//   (LX_SESSION_SECRET, puis BP_SESSION_SECRET, puis clé service), jeton refusé si la version de session a
//   changé (mot de passe changé / réinitialisé), compte lu dans clients_luxyra (lx_id ou bp_id du jeton).
// rdv-demande-create v6 — v5 + colonne client_luxyra_id (renommage beautypro→luxyra non propagé : toutes les demandes échouaient)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify as jwtVerify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }

{ const _LX_FN="rdv-demande-create"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function verifySession(token: string): Promise<{ bp_id: string; email: string } | null> {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const payload = await jwtVerify(token, key);
    if (!payload) return null;
    const id = String((payload as any).lx_id || (payload as any).bp_id || "");
    if (!UUID_RE.test(id)) return null;
    const { data: row } = await sb.from("clients_luxyra").select("id, email, session_version").eq("id", id).maybeSingle();
    if (!row) return null;
    if ((Number((payload as any).sv ?? 0) || 0) !== (Number(row.session_version) || 0)) return null;
    return { bp_id: String(row.id), email: String(row.email || "") };
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    if (!body.session_token) return json(401, { error: "Connexion requise pour faire une demande" });
    const session = await verifySession(String(body.session_token));
    if (!session) return json(401, { error: "Session invalide ou expirée" });
    const salon_id = String(body.salon_id || "").trim();
    const demande_text = String(body.demande_text || "").trim();
    const dispo_text = String(body.dispo_text || "").trim();
    const service_id_raw = body.service_id;
    const service_id = (service_id_raw && Number.isFinite(Number(service_id_raw))) ? Number(service_id_raw) : null;
    if (!salon_id || !UUID_RE.test(salon_id)) return json(400, { error: "salon_id requis" });
    if (!service_id && demande_text.length < 5) return json(400, { error: "Décrivez ce que vous souhaitez (5 caractères min)" });
    if (demande_text.length > 2000) return json(400, { error: "Demande trop longue (2000 max)" });
    if (dispo_text.length > 1000) return json(400, { error: "Disponibilités trop longues (1000 max)" });
    const { data: salon } = await sb.from("salons").select("id, nom, status").eq("id", salon_id).single();
    if (!salon) return json(404, { error: "Salon introuvable" });
    if (salon.status !== "active" && salon.status !== "trial") return json(403, { error: "Ce salon n'accepte pas de réservations actuellement" });
    const { data: cfg } = await sb.from("site_config").select("accept_rdv_sur_mesure").eq("salon_id", salon_id).maybeSingle();
    if (!cfg?.accept_rdv_sur_mesure) return json(403, { error: "Ce salon n'accepte pas les demandes sur mesure" });
    if (service_id) {
      const { data: svc } = await sb.from("services").select("id, salon_id").eq("id", service_id).eq("salon_id", salon_id).maybeSingle();
      if (!svc) return json(400, { error: "Prestation introuvable pour ce salon" });
    }
    const { data: client } = await sb.from("clients_luxyra").select("id, nom, prenom, telephone, email").eq("id", session.bp_id).single();
    if (!client) return json(404, { error: "Compte introuvable" });
    if (!client.telephone) return json(400, { error: "Veuillez renseigner votre téléphone dans votre compte avant de demander un RDV" });
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const { count, error: countErr } = await sb.from("rdv_demandes").select("id", { count: "exact", head: true }).eq("client_luxyra_id", session.bp_id).eq("salon_id", salon_id).eq("status", "pending").gte("created_at", since);
    if (countErr) { await (globalThis as any).__lxReport?.("Comptage rdv_demandes échec: "+countErr.message, "error", undefined, { salon_id, bp_id: session.bp_id }); return json(500, { error: "Erreur temporaire, réessayez dans un instant." }); }
    if ((count || 0) >= 5) return json(429, { error: "Vous avez déjà plusieurs demandes en attente pour ce salon. Patientez la réponse du salon." });
    const { data: created, error } = await sb.from("rdv_demandes").insert({ salon_id, client_nom: client.nom || "", client_prenom: client.prenom || "", client_tel: client.telephone, client_email: client.email, client_luxyra_id: client.id, demande_text, dispo_text: dispo_text || null, service_id: service_id, status: "pending" }).select("id, created_at").single();
    if (error) { console.error("rdv-demande-create insert error", error); await (globalThis as any).__lxReport?.("Insert rdv_demandes échec: "+error.message, "error", undefined, { salon_id, bp_id: session.bp_id }); return json(500, { error: "Votre demande n'a pas pu être enregistrée. Réessayez dans un instant." }); }
    return json(200, { ok: true, demande_id: created.id, message: "Votre demande a été envoyée. Le salon vous proposera un créneau sous 24-48h." });
  } catch (e) {
    console.error("rdv-demande-create unexpected", e);
    return json(500, { error: "Erreur inattendue, réessayez dans un instant." });
  }
});
