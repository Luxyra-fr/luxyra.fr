// rdv-empreinte-release v6 — 2026-10-31 (audit final I5) : l'administration Luxyra ne peut plus libérer l'empreinte d'un client à la place de l'établissement (lecture seule) ; seuls le propriétaire du salon et le rôle service.
// v5 — 2026-10-09 : charges directes (Stripe-Account = rdv.stripe_account). v3 — v2 + SECURITE 2026-10-07 (controle proprietaire du salon)
// NB dépôt : copie exacte de la version Supabase n° 7 (l'en-tête « v6 » est la numérotation interne du fichier).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
// === SECURITE : seul le proprietaire du salon (session Supabase) ou le role service (2026-10-31 : plus l'admin) ===
function _lxRoleDuJeton(t: string): string { try { const p = t.split(".")[1]; return String(JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).role || ""); } catch { return ""; } }
async function _lxAutorise(req: Request, salonId: string): Promise<boolean> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return false;
  if (_lxRoleDuJeton(t) === "service_role") return true; // signature deja verifiee par la plateforme (verify_jwt)
  try {
    const { data } = await sb.auth.getUser(t);
    const user = data && data.user;
    if (!user) return false;
    if (!salonId) return false;
    const { data: s } = await sb.from("salons").select("id").eq("id", salonId).eq("user_id", user.id).maybeSingle();
    return !!s;
  } catch { return false; }
}

{ const _LX_FN="rdv-empreinte-release"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    if (!STRIPE_SECRET) return json(503, { error: "Stripe non configuré" });
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON body" });
    const rdv_id = String(body.rdv_id || "").trim();
    const reason = String(body.reason || "rdv_honore").trim();
    if (!rdv_id) return json(400, { error: "rdv_id requis" });
    const { data: rdv } = await sb.from("rdv_online").select("id, salon_id, payment_intent_id, stripe_account, empreinte_status").eq("id", rdv_id).single();
    if (!rdv) return json(404, { error: "RDV introuvable" });
    if (!(await _lxAutorise(req, rdv.salon_id))) return json(403, { error: "Accès refusé" });
    if (!rdv.payment_intent_id) return json(400, { error: "Aucune empreinte sur ce RDV" });
    if (rdv.empreinte_status !== "held") return json(400, { error: `Empreinte déjà ${rdv.empreinte_status} — opération impossible` });
    const params = new URLSearchParams();
    params.append("cancellation_reason", reason === "rdv_honore" ? "requested_by_customer" : "abandoned");
    const cancelRes = await fetch(`https://api.stripe.com/v1/payment_intents/${rdv.payment_intent_id}/cancel`, { method: "POST", headers: { "Authorization": `Bearer ${STRIPE_SECRET}`, "Content-Type": "application/x-www-form-urlencoded", ...(rdv.stripe_account ? { "Stripe-Account": rdv.stripe_account } : {}) }, body: params.toString() });
    const cancelData = await cancelRes.json();
    if (!cancelRes.ok || cancelData.status !== "canceled") {
      console.error("Release failed", cancelData);
      const errCode = cancelData.error?.code || "";
      const errMsg = cancelData.error?.message || "Échec release";
      if (/already_captured/i.test(errCode + errMsg)) return json(400, { error: "L'empreinte a déjà été capturée — impossible de la libérer" });
      if (/already_canceled/i.test(errCode + errMsg)) {
        await sb.from("rdv_online").update({ empreinte_status: "released", empreinte_released_at: new Date().toISOString() }).eq("id", rdv_id);
        return json(200, { rdv_id, empreinte_status: "released", note: "Déjà libéré côté Stripe." });
      }
      await (globalThis as any).__lxReport?.("Stripe release failed: "+errMsg, "error", undefined, { rdv_id, code: errCode });
      return json(402, { error: errMsg });
    }
    await sb.from("rdv_online").update({ empreinte_status: "released", empreinte_released_at: new Date().toISOString(), empreinte_capture_reason: reason }).eq("id", rdv_id);
    return json(200, { rdv_id, empreinte_status: "released" });
  } catch (e) {
    console.error("rdv-empreinte-release unexpected", e);
    return json(500, { error: "Erreur interne" });
  }
});
