// rdv-demande-propose v6 — 2026-10-30 RDV sur mesure v2 (« plusieurs options ») — verify_jwt : TRUE (inchangé)
// - Reçoit 1 à 3 options : { demande_id, options:[{rang, libelle?, date, heure, collaborateur_id?, items:[{type:'service'|'forfait', id}],
//   acompte_mode:'aucun'|'pct'|'montant', acompte_valeur?, note?}], expire_heures (24|48|72|168), forcer? }.
//   Le navigateur n'envoie AUCUN montant : durée, temps de pose, prix et acompte sont calculés par la base (RPC
//   public.lx_demande_proposer, transactionnelle, propriétaire du salon vérifié par la base aussi).
// - Créneau pris à l'envoi : 409 { conflit:true, conflits } sans rien écrire ; « envoyer quand même » = forcer:true.
// - E-mail « Nouvelle proposition » envoyé PAR LE SERVEUR (worker /api/rdv-demande/notifier, x-lx-internal) ; SMS court
//   si le client n'a pas d'e-mail ; notification dans l'espace client Luxyra.
// - Ancienne app (corps { demande_id, proposed_data }) : convertie en 1 option, montants RECALCULÉS par la base, pas de
//   contrôle bloquant de créneau (comportement d'origine), e-mail laissé à l'ancienne app (pas de doublon).
// v5 (avant) : docs/edge_1030_surmesure/avant/rdv-demande-propose/index.ts
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SB_ANON") || Deno.env.get("SUPABASE_ANON_KEY")!;
const WORKER = Deno.env.get("LX_WORKER_URL") || "https://luxyra.fr";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="rdv-demande-propose"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

// Appel d'une fonction de la base avec la clé service ; erreur métier (P0001 + hint LX_SM_*) -> { erreur, code }
async function rpc(nom: string, args: Record<string, unknown>): Promise<{ data?: any; erreur?: string; code?: string; http?: number }> {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${nom}`, { method: "POST", headers: { apikey: SB_SR, Authorization: "Bearer " + SB_SR, "Content-Type": "application/json" }, body: JSON.stringify(args) });
  const t = await r.text(); let j: any = null; try { j = JSON.parse(t); } catch (_) { j = null; }
  if (!r.ok) return { erreur: (j && j.message) || t || ("HTTP " + r.status), code: (j && (j.hint || j.code)) || "", http: r.status };
  return { data: j };
}
async function notifier(demande_id: string, type: string) {
  try {
    const r = await fetch(WORKER + "/api/rdv-demande/notifier", { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ demande_id, type }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) await (globalThis as any).__lxReport?.("Notification « " + type + " » non envoyée : HTTP " + r.status, "warning", undefined, { demande_id, reponse: j });
    return j;
  } catch (e) {
    await (globalThis as any).__lxReport?.("Notification « " + type + " » non envoyée : " + String((e as Error)?.message || e), "warning", undefined, { demande_id });
    return { ok: false };
  }
}
// ancien format (une proposition, montants calculés par le navigateur) -> 1 option ; seuls les identifiants sont gardés
function depuisAncienFormat(pd: any) {
  const items = (Array.isArray(pd.items) ? pd.items : []).map((it: any) => it && it.forfait_id ? { type: "forfait", id: Number(it.forfait_id) } : { type: "service", id: Number(it && it.service_id) });
  const pct = Number(pd.acompte_pct) || 0, mt = Number(pd.acompte_montant) || 0;
  return [{ rang: 1, date: pd.date, heure: String(pd.heure || "").slice(0, 5), collaborateur_id: pd.collaborateur_id ? Number(pd.collaborateur_id) : null, items,
    acompte_mode: pct > 0 ? "pct" : (mt > 0 ? "montant" : "aucun"), acompte_valeur: pct > 0 ? pct : (mt > 0 ? mt : null), note: pd.message_salon ? String(pd.message_salon).slice(0, 500) : null }];
}

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
    if (!/^[0-9a-f-]{36}$/i.test(demande_id)) return json(400, { error: "demande_id requis" });

    const ancien = !Array.isArray(body.options) && body.proposed_data && typeof body.proposed_data === "object";
    const options = ancien ? depuisAncienFormat(body.proposed_data) : body.options;
    if (!Array.isArray(options) || options.length < 1 || options.length > 3) return json(400, { error: "Proposez entre 1 et 3 options" });
    const heures = [24, 48, 72, 168].includes(Number(body.expire_heures)) ? Number(body.expire_heures) : 72;
    const forcer = ancien ? true : body.forcer === true;

    const r = await rpc("lx_demande_proposer", { p_demande: demande_id, p_user: userId, p_options: options, p_expire_heures: heures, p_forcer: forcer });
    if (r.erreur !== undefined) {
      const code = String(r.code || "");
      if (/^LX_SM_/.test(code)) return json(code === "LX_SM_INTERDIT" ? 403 : code === "LX_SM_INTROUVABLE" ? 404 : 409, { error: r.erreur, code });
      await (globalThis as any).__lxReport?.("lx_demande_proposer : " + r.erreur, "error", undefined, { demande_id, code });
      return json(500, { error: "Envoi impossible pour le moment, réessayez." });
    }
    const d = r.data || {};
    if (d.ok === false && d.code === "conflit") return json(409, { error: "Un créneau proposé n'est plus libre.", conflit: true, conflits: d.conflits || [], avertissements: d.avertissements || [], options: d.options || [] });
    if (d.ok !== true) return json(409, { error: d.error || "Envoi impossible", code: d.code || "" });

    const proposalUrl = `https://luxyra.fr/proposal.html?t=${d.token}`;
    // ancienne app : elle envoie elle-même son e-mail (aucun doublon) ; nouvelle app : e-mail / SMS / notification par le serveur
    const envoi = ancien ? { ancien: true } : await notifier(demande_id, "proposition");
    return json(200, { ok: true, version: 2, proposal_token: d.token, proposal_url: proposalUrl, expires_at: d.expires_at, envoi_n: d.envoi,
      options: d.options || [], avertissements: d.avertissements || [], force: !!d.force, envoi,
      client: { nom: d.client?.nom, prenom: d.client?.prenom, email: d.client?.email, tel: d.client?.tel }, salon_nom: d.salon_nom });
  } catch (e) {
    console.error("rdv-demande-propose unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
