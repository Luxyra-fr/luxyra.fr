// rdv-empreinte-capture v8 — 2026-10-31 : l'administrateur Luxyra ne peut plus encaisser une empreinte (ticket scellé) à la place d'un établissement.
// rdv-empreinte-capture v6 — 2026-10-28 (-2, Luxyra 6.8.0) : montant RÉELLEMENT prélevé (constat M5).
//  - empreinte_captured_amount = amount_received de Stripe (capture partielle : montant demandé, jamais le montant autorisé) ;
//    le passage à "captured" crée, dans la même transaction, le ticket de caisse scellé « Empreinte encaissée » pour CE
//    montant (déclencheur zz_trg_rdv_online_recettes, docs/migrations_1028/recettes_en_ligne.sql).
//  - Montant demandé supérieur à l'empreinte : refusé avant l'appel Stripe (Stripe le refuserait aussi).
//  - « Déjà capturé chez Stripe » : le PaymentIntent est relu pour connaître le montant réellement prélevé.
// v5 — 2026-10-09 : charges directes (Stripe-Account = rdv.stripe_account). v3 — v2 + SECURITE 2026-10-07 (controle proprietaire du salon)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_SECRET = Deno.env.get("STRIPE_SECRET_KEY") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s: number, b: unknown) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
// === SECURITE 2026-10-07 / 2026-10-31 : seul le proprietaire du salon (session Supabase) ou le role service (jamais l'admin Luxyra) ===
function _lxRoleDuJeton(t: string): string { try { const p = t.split(".")[1]; return String(JSON.parse(atob(p.replace(/-/g, "+").replace(/_/g, "/"))).role || ""); } catch { return ""; } }
async function _lxAutorise(req: Request, salonId: string): Promise<boolean> {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return false;
  if (_lxRoleDuJeton(t) === "service_role") return true; // signature deja verifiee par la plateforme (verify_jwt)
  try {
    const { data } = await sb.auth.getUser(t);
    const user = data && data.user;
    if (!user) return false;
    // 2026-10-31 v8 (NF525) : plus de passe-droit éditeur/admin — l'encaissement crée un ticket scellé, réservé à l'établissement.
    if (!salonId) return false;
    const { data: s } = await sb.from("salons").select("id").eq("id", salonId).eq("user_id", user.id).maybeSingle();
    return !!s;
  } catch { return false; }
}
// Montant prélevé (euros) d'une réponse Stripe PaymentIntent ; null si inconnu
export function lxMontantPreleve(pi: any): number | null {
  const c = pi && (typeof pi.amount_received === "number" ? pi.amount_received : (pi.latest_charge && typeof pi.latest_charge.amount_captured === "number" ? pi.latest_charge.amount_captured : null));
  return (typeof c === "number" && c > 0) ? Math.round(c) / 100 : null;
}
// Montant à demander (centimes) : null = totalité ; erreur si > empreinte
export function lxMontantDemande(amountEur: number | null, empreinte: number | null): { cents: number | null; erreur?: string } {
  if (!(amountEur && amountEur > 0)) return { cents: null };
  const c = Math.round(amountEur * 100);
  if (empreinte != null && c > Math.round(Number(empreinte) * 100)) return { cents: null, erreur: "Montant supérieur à l'empreinte autorisée" };
  return { cents: c };
}

// === MONITORING 100% ===
{
  const _LX_FN = "rdv-empreinte-capture";
  const _LX_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL") || "";
  const _LX_SR = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const _lxReport = async (msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>) => { try { await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})}); } catch(_){} };
  (globalThis as any).__lxReport = _lxReport;
  const _orig = Deno.serve;
  (Deno as any).serve = (handler:any,opts?:any) => _orig(async (req:Request) => { try { const res = await handler(req); if (res && res.status>=500) { const body = await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)}); } return res; } catch(e) { const err = e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}}); } }, opts);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    if (!STRIPE_SECRET) return json(503, { error: "Stripe non configuré" });
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Invalid JSON body" });
    const rdv_id = String(body.rdv_id || "").trim();
    const reason = String(body.reason || "no_show").trim();
    const amount_eur = body.amount_eur ? Number(body.amount_eur) : null;
    if (!rdv_id) return json(400, { error: "rdv_id requis" });
    const { data: rdv } = await sb.from("rdv_online").select("id, salon_id, payment_intent_id, stripe_account, empreinte_status, empreinte_amount, client_nom, date_rdv, heure_rdv").eq("id", rdv_id).single();
    if (!rdv) return json(404, { error: "RDV introuvable" });
    if (!(await _lxAutorise(req, rdv.salon_id))) return json(403, { error: "Accès refusé" });
    if (!rdv.payment_intent_id) return json(400, { error: "Aucune empreinte sur ce RDV" });
    if (rdv.empreinte_status !== "held") return json(400, { error: `Empreinte déjà ${rdv.empreinte_status} — opération impossible` });
    const dem = lxMontantDemande(amount_eur, rdv.empreinte_amount);
    if (dem.erreur) return json(400, { error: dem.erreur });
    const H = { "Authorization": `Bearer ${STRIPE_SECRET}`, "Content-Type": "application/x-www-form-urlencoded", ...(rdv.stripe_account ? { "Stripe-Account": rdv.stripe_account } : {}) };
    const params = new URLSearchParams();
    if (dem.cents) params.append("amount_to_capture", String(dem.cents));
    const capRes = await fetch(`https://api.stripe.com/v1/payment_intents/${rdv.payment_intent_id}/capture`, { method: "POST", headers: H, body: params.toString() });
    const capData = await capRes.json();
    if (!capRes.ok || capData.status !== "succeeded") {
      console.error("Capture failed", capData);
      const errCode = capData.error?.code || "";
      const errMsg = capData.error?.message || "Échec capture";
      if (/already_captured|charge_already_captured/i.test(errCode + errMsg)) {
        // montant réellement prélevé relu chez Stripe (jamais supposé)
        let preleve: number | null = null;
        try { const r = await fetch(`https://api.stripe.com/v1/payment_intents/${rdv.payment_intent_id}`, { headers: H }); preleve = lxMontantPreleve(await r.json()); } catch (_) {}
        await sb.from("rdv_online").update({ empreinte_status: "captured", empreinte_captured_at: new Date().toISOString(), ...(preleve ? { empreinte_captured_amount: preleve } : {}) }).eq("id", rdv_id);
        if (!preleve) await (globalThis as any).__lxReport?.("Empreinte déjà capturée : montant prélevé non relu (ticket au montant de l'empreinte)", "warning", undefined, { rdv_id });
        return json(200, { rdv_id, empreinte_status: "captured", amount_captured: preleve, note: "Déjà capturé côté Stripe — état synchronisé." });
      }
      if (/expired|cancellable_only|requires_payment_method/i.test(errCode + errMsg)) {
        await sb.from("rdv_online").update({ empreinte_status: "expired", empreinte_capture_reason: "expired_at_capture" }).eq("id", rdv_id);
      }
      await (globalThis as any).__lxReport?.("Stripe capture failed: "+errMsg, "error", undefined, { rdv_id, code: errCode });
      return json(402, { error: errMsg });
    }
    const preleve = lxMontantPreleve(capData);
    // 2026-10-28 (-2) : cette mise à jour crée aussi le ticket de caisse scellé « Empreinte encaissée » du montant PRÉLEVÉ
    const { data: maj } = await sb.from("rdv_online").update({ empreinte_status: "captured", empreinte_captured_at: new Date().toISOString(), empreinte_capture_reason: reason, empreinte_captured_amount: preleve }).eq("id", rdv_id).select("empreinte_tk_num");
    return json(200, { rdv_id, empreinte_status: "captured", amount_captured: preleve, tk_num: Array.isArray(maj) && maj[0] ? maj[0].empreinte_tk_num : null });
  } catch (e) {
    console.error("rdv-empreinte-capture unexpected", e);
    return json(500, { error: "Erreur interne" });
  }
});
