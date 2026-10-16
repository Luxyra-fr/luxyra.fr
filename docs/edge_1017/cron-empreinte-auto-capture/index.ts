// cron-empreinte-auto-capture v8 — 2026-10-17 audit réglages (#8) : « capture auto après 0 h » = PAS de capture automatique
//   (avant : Number(x)||24 transformait 0 en 24) ; heure du RDV lue à l'heure de Paris (avant : lue en UTC, capture 1 à 2 h trop tard).
// cron-empreinte-auto-capture v6 — 2026-10-09 : charges directes (Stripe-Account = rdv.stripe_account). v4 — SECURITE 2026-10-08 : secret lu dans app_secrets (plus dans app_config, lisible publiquement). v3 : monitoring 100%
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
{ const _LX_FN="cron-empreinte-auto-capture"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function _h(compte?: string|null): Record<string,string> { const h: Record<string,string> = { "Authorization": `Bearer ${STRIPE_SECRET}` }; if (compte) h["Stripe-Account"] = compte; return h; }
async function captureStripe(piId: string, compte?: string|null) { return await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/capture`, { method: "POST", headers: _h(compte) }); }
async function cancelStripe(piId: string, compte?: string|null) { return await fetch(`https://api.stripe.com/v1/payment_intents/${piId}/cancel`, { method: "POST", headers: { ..._h(compte), "Content-Type": "application/x-www-form-urlencoded" }, body: "cancellation_reason=abandoned" }); }
// 2026-10-17 : date + heure locales de Paris -> instant UTC (heure d'été / d'hiver)
function heureParis(jour: string, hm: string): Date {
  const [y, m, d] = jour.split("-").map(Number); const [hh, mm] = hm.split(":").map(Number);
  const approx = Date.UTC(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  let decalage = 0;
  try {
    const p = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Paris", timeZoneName: "shortOffset" }).formatToParts(new Date(approx));
    const z = (p.find((x) => x.type === "timeZoneName") || { value: "GMT+1" }).value; const mt = z.match(/GMT([+-]\d{1,2})(?::(\d{2}))?/);
    decalage = mt ? (Number(mt[1]) * 60 + (mt[2] ? Math.sign(Number(mt[1])) * Number(mt[2]) : 0)) : 60;
  } catch { decalage = 60; }
  return new Date(approx - decalage * 60000);
}
function egal(a: string, b: string): boolean { if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
Deno.serve(async (req) => {
  const headerSecret = req.headers.get("x-cron-secret") || "";
  try { const { data: sec } = await sb.from("app_secrets").select("value").eq("key", "cron_empreinte_secret").maybeSingle(); const expected = (sec && sec.value) || ""; if (!expected || !egal(headerSecret, expected)) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }); } catch { return new Response(JSON.stringify({ error: "Auth check failed" }), { status: 500 }); }
  if (!STRIPE_SECRET) return new Response(JSON.stringify({ error: "Stripe non configuré" }), { status: 503 });
  const stats = { checked: 0, captured: 0, released_expired: 0, errors: 0 };
  try {
    const { data: rdvs } = await sb.from("rdv_online").select("id, salon_id, payment_intent_id, stripe_account, empreinte_held_at, date_rdv, heure_rdv, status, client_nom").eq("empreinte_status", "held");
    if (!rdvs || rdvs.length === 0) return new Response(JSON.stringify(stats));
    const salonIds = [...new Set(rdvs.map((r) => r.salon_id))];
    const { data: cfgs } = await sb.from("site_config").select("salon_id, empreinte_capture_delai_h").in("salon_id", salonIds);
    const cfgMap: Record<string, number> = {};
    // 2026-10-17 audit réglages (#8) : 0 = pas de capture automatique (le salon capture lui-même) ; valeur absente -> 24 h
    (cfgs || []).forEach((c) => { const v = c.empreinte_capture_delai_h; const n = Number(v); cfgMap[c.salon_id] = (v === null || v === undefined || v === "" || !Number.isFinite(n) || n < 0) ? 24 : n; });
    const now = new Date();
    for (const rdv of rdvs) {
      stats.checked++;
      try {
        const heldAt = rdv.empreinte_held_at ? new Date(rdv.empreinte_held_at) : null;
        const ageHours = heldAt ? (now.getTime() - heldAt.getTime()) / 3600000 : 0;
        if (ageHours > 156) { await cancelStripe(rdv.payment_intent_id, rdv.stripe_account); await sb.from("rdv_online").update({ empreinte_status: "expired", empreinte_released_at: now.toISOString(), empreinte_capture_reason: "auto_expired_pre_7d" }).eq("id", rdv.id); stats.released_expired++; continue; }
        const delaiH = (rdv.salon_id in cfgMap) ? cfgMap[rdv.salon_id] : 24;  // 2026-10-17 audit réglages (#8)
        if (delaiH <= 0) continue;
        const rdvDateTime = heureParis(String(rdv.date_rdv), String(rdv.heure_rdv || "00:00").slice(0, 5));  // 2026-10-17 : heure de Paris
        const hoursPastRdv = (now.getTime() - rdvDateTime.getTime()) / 3600000;
        if (hoursPastRdv < delaiH) continue;
        if (["cancelled", "canceled", "done", "completed", "honored"].includes(rdv.status)) continue;
        const r = await captureStripe(rdv.payment_intent_id, rdv.stripe_account);
        const data = await r.json();
        if (r.ok && data.status === "succeeded") { await sb.from("rdv_online").update({ empreinte_status: "captured", empreinte_captured_at: now.toISOString(), empreinte_capture_reason: "auto_no_show" }).eq("id", rdv.id); stats.captured++; }
        else { await (globalThis as any).__lxReport?.("Stripe capture cron failed: "+(data?.error?.message||JSON.stringify(data).slice(0,200)), "error", undefined, { rdv_id: rdv.id }); stats.errors++; }
      } catch (e) { await (globalThis as any).__lxReport?.("Loop exception cron: "+(e as Error).message, "error", e, { rdv_id: rdv.id }); stats.errors++; }
    }
    return new Response(JSON.stringify(stats), { status: 200, headers: { "Content-Type": "application/json" } });
  } catch (e) { return new Response(JSON.stringify({ error: "Erreur interne", stats }), { status: 500 }); }
});
