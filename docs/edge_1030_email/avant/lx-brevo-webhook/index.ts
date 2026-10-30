// lx-brevo-webhook v1 — reçoit les événements Brevo (hard_bounce, soft_bounce, blocked, error,
// spam, unsubscribed, deferred) et les push dans server_errors avec severity adaptée.
// Configurer dans Brevo Dashboard → Transactionnel → Réglages → Webhooks.
// URL: https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/lx-brevo-webhook
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}

{ const _LX_FN="lx-brevo-webhook"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

const SEVERITY_MAP: Record<string, "info"|"warning"|"error"|"critical"> = {
  hard_bounce: "critical",
  soft_bounce: "warning",
  blocked: "critical",
  spam: "critical",
  invalid_email: "error",
  deferred: "warning",
  error: "critical",
  unsubscribed: "info",
  delivered: "info",
  opened: "info",
  click: "info",
  unique_opened: "info",
  complaint: "critical",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON" });
    const events = Array.isArray(body) ? body : [body];
    let processed = 0;
    let skipped = 0;
    const errors: any[] = [];
    for (const e of events) {
      try {
        const eventName = String(e.event || "").toLowerCase();
        const sev = SEVERITY_MAP[eventName] || "warning";
        if (sev === "info") { skipped++; continue; }
        const email = String(e.email || "").slice(0, 200);
        const subject = String(e.subject || "").slice(0, 300);
        const reason = String(e.reason || e["sub-type"] || "").slice(0, 400);
        const message = `Brevo ${eventName} → ${email}` + (subject ? ` (sujet: ${subject.slice(0, 80)})` : "") + (reason ? ` — ${reason}` : "");
        await sb.from("server_errors").insert({
          source: "brevo_webhook",
          severity: sev,
          message: message.slice(0, 800),
          http_path: "/brevo/" + eventName,
          http_status: null,
          salon_id: null,
        });
        processed++;
      } catch (eRow) {
        errors.push(String((eRow as Error).message).slice(0, 200));
      }
    }
    return json(200, { ok: true, processed, skipped, errors });
  } catch (e) {
    console.error("lx-brevo-webhook error:", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
