// lx-brevo-webhook v5 — 2026-10-31 (contre-audit 4) : limite 300/min seulement sans clé (A1), contrôle en échec -> 503 (A2),
//   la clé n'est jamais enregistrée dans les rapports d'erreur (A3).
// lx-brevo-webhook v4 — 2026-10-31 (contre-audit 3) : clé secrète dans l'URL (?k=…, coffre Supabase, contrôlée par
//   lx_brevo_webhook_controle). Tant que la nouvelle URL n'a jamais servi, l'ancienne (sans clé) reste acceptée avec des
//   limites (50 événements, 5 adresses signalées) et une alerte par jour dans la surveillance ; dès que la clé a servi une
//   fois, tout appel sans la bonne clé est refusé (401). Plus de 300 événements/minute : 429.
// lx-brevo-webhook v2 — 2026-10-30 : adresse d'un client Luxyra rejetée (hard_bounce / invalid_email / blocked) :
//   l'adresse est transmise au worker (/api/email/rejet-signale, appel interne). Le worker VÉRIFIE auprès de Brevo
//   (journal des événements) que le rejet est réel avant de marquer le compte (clients_luxyra.email_rejete_at) :
//   un faux appel à ce webhook (URL publique) ne peut donc pas marquer un compte.
// lx-brevo-webhook v1 — reçoit les événements Brevo (hard_bounce, soft_bounce, blocked, error,
// spam, unsubscribed, deferred) et les push dans server_errors avec severity adaptée.
// Configurer dans Brevo Dashboard → Transactionnel → Réglages → Webhooks.
// URL: https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/lx-brevo-webhook
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const REJETS = ["hard_bounce", "invalid_email", "blocked"]; // 2026-10-30
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}

{ const _LX_FN="lx-brevo-webhook"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url.split("?")[0],body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url.split("?")[0]}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

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
    // 2026-10-31 : clé secrète (paramètre k de l'URL)
    const cle = new URL(req.url).searchParams.get("k");
    const { data: ctl, error: ctlErr } = await sb.rpc("lx_brevo_webhook_controle", { p_cle: cle && cle.length <= 200 ? cle : null });
    // 31/10 (contre-audit 4, A2) : contrôle impossible -> 503 (Brevo réessaie), jamais d'acceptation par défaut
    if (ctlErr || !ctl) return json(503, { error: "Contrôle indisponible, réessayez" });
    const etat = String(ctl);
    if (etat === "refus") return json(401, { error: "Clé invalide" });
    if (etat === "trop") return json(429, { error: "Trop d'événements" });
    const limite = etat === "ok" ? 1000 : 50;
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON" });
    const events = (Array.isArray(body) ? body : [body]).slice(0, limite);
    let processed = 0;
    let skipped = 0;
    const errors: any[] = [];
    const rejetees = new Set<string>(); // 2026-10-30
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
        if (REJETS.includes(eventName) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && rejetees.size < (etat === "ok" ? 20 : 5)) rejetees.add(email.toLowerCase().trim());
      } catch (eRow) {
        errors.push(String((eRow as Error).message).slice(0, 200));
      }
    }
    // 2026-10-30 : signalement au worker (qui vérifie chez Brevo avant de marquer le compte). Jamais bloquant.
    let signales = 0;
    if (rejetees.size) {
      try {
        const r = await fetch(`${WORKER_BASE}/api/email/rejet-signale`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ emails: [...rejetees] }) });
        if (r.ok) signales = rejetees.size; else errors.push("rejet-signale HTTP " + r.status);
      } catch (eS) { errors.push("rejet-signale: " + String((eS as Error)?.message || eS).slice(0, 120)); }
    }
    return json(200, { ok: true, processed, skipped, signales, errors });
  } catch (e) {
    console.error("lx-brevo-webhook error:", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
