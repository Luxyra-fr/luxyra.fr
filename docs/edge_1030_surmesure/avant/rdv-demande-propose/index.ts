// rdv-demande-propose v4 — v3 + monitoring 100%
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SB_ANON") || Deno.env.get("SUPABASE_ANON_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="rdv-demande-propose"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function randomToken(len = 32): string { const bytes = crypto.getRandomValues(new Uint8Array(len)); return Array.from(bytes).map((b)=>b.toString(16).padStart(2,"0")).join("").slice(0, len); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const auth = req.headers.get("Authorization") || "";
    const userJwt = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (!userJwt) return json(401, { error: "Authentification requise" });
    const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: `Bearer ${userJwt}` } }, auth: { persistSession: false } });
    const { data: userData, error: userErr } = await userClient.auth.getUser(userJwt);
    if (userErr || !userData?.user) return json(401, { error: "Session invalide" });
    const userId = userData.user.id;
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const demande_id = String(body.demande_id || "").trim();
    const proposed_data = body.proposed_data;
    if (!demande_id) return json(400, { error: "demande_id requis" });
    if (!proposed_data || typeof proposed_data !== "object") return json(400, { error: "proposed_data requis" });
    const pd = proposed_data;
    if (!pd.date || !pd.heure) return json(400, { error: "date et heure requises" });
    if (!Array.isArray(pd.items) || pd.items.length === 0) return json(400, { error: "Au moins une prestation requise" });
    if (typeof pd.prix_total !== "number" || pd.prix_total <= 0) return json(400, { error: "prix_total invalide" });
    if (typeof pd.duree_minutes !== "number" || pd.duree_minutes <= 0) return json(400, { error: "duree_minutes invalide" });
    if (typeof pd.acompte_montant !== "number" || pd.acompte_montant < 0) return json(400, { error: "acompte_montant invalide" });
    if (pd.acompte_montant > pd.prix_total) return json(400, { error: "L'acompte ne peut pas dépasser le prix total" });
    const { data: demande, error: demErr } = await sb.from("rdv_demandes").select("id, salon_id, status, client_nom, client_prenom, client_email, client_tel").eq("id", demande_id).single();
    if (demErr || !demande) return json(404, { error: "Demande introuvable" });
    if (demande.status !== "pending") return json(409, { error: `La demande est en statut '${demande.status}', impossible de proposer·e` });
    const { data: salon } = await sb.from("salons").select("id, nom, user_id").eq("id", demande.salon_id).single();
    if (!salon) return json(404, { error: "Salon introuvable" });
    if (salon.user_id !== userId) return json(403, { error: "Vous n'êtes pas autorisé à traiter cette demande" });
    let token = randomToken(32);
    for (let i = 0; i < 3; i++) {
      const { data: exists } = await sb.from("rdv_demandes").select("id").eq("proposal_token", token).maybeSingle();
      if (!exists) break;
      token = randomToken(32);
    }
    const expiresAt = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
    const { error: updErr } = await sb.from("rdv_demandes").update({ status: "proposed", proposed_data: pd, proposal_token: token, proposal_expires_at: expiresAt, proposed_at: new Date().toISOString() }).eq("id", demande_id);
    if (updErr) { console.error("update failed", updErr); await (globalThis as any).__lxReport?.("Update demande propose failed: "+updErr.message, "error", undefined, { demande_id }); return json(500, { error: updErr.message }); }
    const proposalUrl = `https://luxyra.fr/proposal.html?t=${token}`;
    return json(200, { ok: true, proposal_token: token, proposal_url: proposalUrl, expires_at: expiresAt, client: { nom: demande.client_nom, prenom: demande.client_prenom, email: demande.client_email, tel: demande.client_tel }, salon_nom: salon.nom });
  } catch (e) {
    console.error("rdv-demande-propose unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
