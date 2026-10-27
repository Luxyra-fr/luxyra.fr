// carte-abo-confirm-payment v7 — 2026-10-28 (-2, Luxyra 6.8.0) : recettes en ligne en caisse.
//  - L'activation (pending_payment -> active) crée, DANS LA MÊME TRANSACTION, le ticket de caisse scellé du paiement
//    (déclencheur zz_trg_cartes_abo_recettes, docs/migrations_1028/recettes_en_ligne.sql) : prestation de services payée
//    d'avance, TVA exigible à l'encaissement (CGI art. 269-2-c). Le n° du ticket est renvoyé (tk_num).
//  - Montant : la session doit être EXACTEMENT le tarif de la carte, et ce tarif doit être celui configuré par
//    l'établissement (salons.config_json.cartes_abo) — le tarif de la ligne est saisi par la page publique. Écart : le
//    paiement est remboursé en totalité (comme un acompte au montant incohérent), la carte n'est pas activée, alerte critique.
//  - montant_paye et payment_intent_id enregistrés (remboursement fait hors Luxyra -> ticket négatif, charge.refunded).
// v6 — 2026-10-09 : charges directes (session lue sur le compte du salon, puis plateforme). v5 — SECURITE 2026-10-08 : la session Stripe doit porter CETTE carte (metadonnee), du meme salon,
// du type carte d'abonnement, d'un montant au moins egal au tarif, et ne jamais avoir servi a une autre carte.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}

{ const _LX_FN="carte-abo-confirm-payment"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

// Tarif configuré par l'établissement pour cette carte (config_json.cartes_abo, lu par la page publique). null = introuvable.
export function lxTarifConfigure(config: any, carteId: string, carteNom: string): number | null {
  try {
    const cfg = typeof config === "string" ? JSON.parse(config) : (config || {});
    const L = Array.isArray(cfg.cartes_abo) ? cfg.cartes_abo : [];
    const c = L.find((x: any) => x && ((carteId && String(x.id) === String(carteId)) || (!carteId && x.nom === carteNom)));
    return c && c.tarif != null && isFinite(Number(c.tarif)) ? Number(c.tarif) : null;
  } catch { return null; }
}
// Contrôle du montant payé (centimes) : exactement le tarif de la ligne ET le tarif configuré (s'il est connu)
export function lxMontantCarteOk(payeCents: number, tarifLigne: number, tarifConfig: number | null): boolean {
  const attendu = Math.round(Number(tarifLigne) * 100);
  if (!(attendu > 0) || payeCents !== attendu) return false;
  if (tarifConfig !== null && Math.round(tarifConfig * 100) !== attendu) return false;
  return true;
}

async function rembourser(session: any, compte: string | null, carteId: string): Promise<string | null> {
  try {
    const pi = session.payment_intent; if (!pi) return null;
    const p = new URLSearchParams(); p.append("payment_intent", String(pi)); p.append("metadata[carte_abo_id]", carteId); p.append("metadata[motif]", "montant_incoherent");
    if (!compte) p.append("reverse_transfer", "true");
    const h: Record<string,string> = { Authorization: `Bearer ${STRIPE_KEY}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": "lx_carte_incoherent_" + pi };
    if (compte) h["Stripe-Account"] = compte;
    const r = await fetch("https://api.stripe.com/v1/refunds", { method: "POST", headers: h, body: p.toString() });
    const j = await r.json().catch(() => null);
    return j && j.id ? j.id : null;
  } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!STRIPE_KEY) return json(500, { error: "STRIPE_SECRET_KEY non configurée" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const carteId = String(body.carte_id || "").trim();
    const sessionId = String(body.stripe_session_id || "").trim();
    if (!carteId || !sessionId) return json(400, { error: "carte_id et stripe_session_id requis" });
    if (!/^cs_[A-Za-z0-9_]+$/.test(sessionId)) return json(400, { error: "stripe_session_id invalide" });
    const { data: carte, error: cErr } = await sb.from("cartes_abo_clients").select("id, salon_id, status, tarif, carte_nom, carte_id, recette_tk_num").eq("id", carteId).single();
    if (cErr || !carte) return json(404, { error: "Carte introuvable" });
    if (carte.status === "active") return json(200, { ok: true, already_active: true, tk_num: carte.recette_tk_num || null });
    if (carte.status !== "pending_payment") return json(409, { error: `Statut carte invalide : ${carte.status}` });
    const { data: salon } = await sb.from("salons").select("stripe_connect_id, nom, config_json").eq("id", carte.salon_id).single();
    if (!salon?.stripe_connect_id) return json(400, { error: "Salon sans compte Connect" });
    let session: any = null; let compteSession: string|null = null;
    for (const c of [salon.stripe_connect_id, null]) {
      const h: Record<string,string> = { Authorization: `Bearer ${STRIPE_KEY}` }; if (c) h["Stripe-Account"] = c;
      const r = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, { method: "GET", headers: h });
      const j = await r.json().catch(() => null);
      if (j && j.id) { session = j; compteSession = c; break; }
    }
    if (!session?.id) { await (globalThis as any).__lxReport?.("Stripe session introuvable", "error", undefined, { carteId, sessionId }); return json(404, { error: "Session Stripe introuvable" }); }
    if (session.payment_status !== "paid") return json(402, { error: `Paiement non confirmé (status: ${session.payment_status})` });
    const md = session.metadata || {};
    const sessionCarteId = String(md.carte_abo_id || md.rdv_id || "");
    if (sessionCarteId !== carteId || (md.type && md.type !== "carte_abo") || String(md.salon_id || "") !== String(carte.salon_id)) {
      await (globalThis as any).__lxReport?.("Session Stripe non liee a cette carte (refus)", "critical", undefined, { carteId, sessionCarteId, type: md.type || null });
      return json(403, { error: "Session Stripe ne correspond pas à cette carte" });
    }
    const { data: dejaUtilisee } = await sb.from("cartes_abo_clients").select("id").eq("ticket_num", session.id).neq("id", carteId).limit(1);
    if (dejaUtilisee && dejaUtilisee.length) return json(409, { error: "Ce paiement a déjà servi" });
    const tarifCfg = lxTarifConfigure(salon.config_json, String(carte.carte_id || ""), String(carte.carte_nom || ""));
    if (!lxMontantCarteOk(Number(session.amount_total || 0), Number(carte.tarif), tarifCfg)) {
      const rf = await rembourser(session, compteSession, carteId);
      await (globalThis as any).__lxReport?.("Carte d'abonnement : montant payé différent du tarif (paiement remboursé)", "critical", undefined, { carteId, paye: session.amount_total, tarif_ligne: carte.tarif, tarif_config: tarifCfg, remboursement: rf });
      return json(409, { error: "Montant payé incohérent avec le tarif de la carte : le paiement est remboursé.", rembourse: !!rf });
    }
    // 2026-10-28 (-2) : cette mise à jour crée aussi le ticket de caisse scellé du paiement (déclencheur zz_trg_cartes_abo_recettes)
    const { data: maj, error: updErr } = await sb.from("cartes_abo_clients")
      .update({ status: "active", ticket_num: session.id, stripe_account: compteSession, montant_paye: Number(session.amount_total) / 100, payment_intent_id: session.payment_intent || null })
      .eq("id", carteId).eq("status", "pending_payment").select("recette_tk_num");
    if (updErr) { await (globalThis as any).__lxReport?.("Update carte active échec: "+updErr.message, "error", undefined, { carteId }); return json(500, { error: "Erreur interne" }); }
    const tk = Array.isArray(maj) && maj[0] ? maj[0].recette_tk_num : null;
    return json(200, { ok: true, activated: true, carte_nom: carte.carte_nom, salon_nom: salon.nom, tk_num: tk });
  } catch (e) {
    console.error("carte-abo-confirm-payment unexpected", e);
    return json(500, { error: "Erreur interne" });
  }
});
