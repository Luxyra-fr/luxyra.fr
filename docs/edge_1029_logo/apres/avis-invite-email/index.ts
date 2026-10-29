// avis-invite-email v5 — 2026-10-10 : mise en page commune Luxyra (lxMailLayout), contenu inchangé. v4 — v3 + SECURITE 2026-10-08 : appel worker authentifie (x-lx-internal)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
// 2026-10-10 : mise en page commune des emails Luxyra (identique au worker docs/luxyra-router-worker.js → lxMailLayout)
// opts.salon : si renseigné, email envoyé AU NOM d'un établissement à sa cliente (pied de page : « envoyé pour le compte de … via Luxyra »)
function lxMailLayout(corpsHtml: string, opts: { titre?: string; pied?: string; salon?: string; idSuivi?: string } = {}): string {
  const titre = opts.titre ? `<h1 style="margin:0 0 16px;font-family:Georgia,'Times New Roman',serif;font-size:22px;font-weight:400;color:#1a1a1a;line-height:1.3">${opts.titre}</h1>` : "";
  const pixel = opts.idSuivi ? `<img src="https://luxyra.fr/api/e/o/${opts.idSuivi}.gif" width="1" height="1" alt="" style="display:block;border:0">` : "";
  const pied = opts.pied ? `<div style="margin-bottom:6px">${opts.pied}</div>` : "";
  const sousTitre = opts.salon ? opts.salon : "GESTION &amp; CAISSE POUR LES PROFESSIONNELS DE LA BEAUTÉ ET DU BIEN-ÊTRE";
  const mentions = opts.salon
    ? `Email envoyé pour le compte de ${opts.salon} via <a href="https://luxyra.fr" style="color:#b8922e">Luxyra</a>.`
    : `Luxyra — Alexandre JENSEN, entrepreneur individuel — SIRET 910 928 464 00023<br>29 rue de l'Abbé Alexandre Pax, 57200 Sarreguemines — <a href="mailto:contact@luxyra.fr" style="color:#b8922e">contact@luxyra.fr</a> — <a href="https://luxyra.fr" style="color:#b8922e">luxyra.fr</a>`;
  return `<div style="background:#f4f1ea;padding:24px 10px;margin:0">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e6dcc3;font-family:-apple-system,'Segoe UI',Arial,sans-serif;color:#1a1a1a;font-size:15px;line-height:1.6">
    <div style="background:#0b0b0b;padding:26px 20px 20px;text-align:center;border-bottom:3px solid #c8a84e">
      <img src="https://luxyra.fr/email/luxyra-logo-128.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
      <div style="color:#d4a843;font-family:Georgia,'Times New Roman',serif;font-size:22px;letter-spacing:6px">LUXYRA</div>
      <div style="color:#8c8270;font-size:11px;letter-spacing:1px;margin-top:4px;text-transform:uppercase">${sousTitre}</div>
    </div>
    <div style="padding:28px 26px 8px">${titre}${corpsHtml}</div>
    <div style="padding:16px 26px 22px;font-size:11px;color:#8a8a8a;border-top:1px solid #eee;margin-top:18px;line-height:1.5">${pied}${mentions}</div>
  </div>${pixel}</div>`;
}
function lxMailBouton(texte: string, url: string): string {
  return `<p style="text-align:center;margin:22px 0"><a href="${url}" style="display:inline-block;background:#c8a84e;color:#111;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:30px">${texte}</a></p>`;
}
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const CRON_SECRET = Deno.env.get("AVIS_CRON_SECRET") || "";
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
{ const _LX_FN="avis-invite-email"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function buildEmailHTML(opts: { prenom: string; salonNom: string; serviceNom: string; dateLabel: string; deepLink: string; }) {
  const { prenom, salonNom, serviceNom, dateLabel, deepLink } = opts;
  const corps = `<p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 16px">Bonjour ${esc(prenom)},</p><p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 16px">Vous avez été chez <strong style="color:#1a1a1a">${esc(salonNom)}</strong> le ${esc(dateLabel)} pour un <em style="color:#6b6b6b">${esc(serviceNom)}</em>.</p><p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 24px">Votre avis aide d’autres clients à choisir leur salon en confiance.</p>${lxMailBouton("★ Laisser mon avis", esc(deepLink))}<p style="font-size:12px;color:#8a8a8a;line-height:1.6;margin:24px 0 0;text-align:center">Connecté à votre compte Luxyra, votre avis est vérifié et publié sous votre prénom et l’initiale de votre nom.</p>`;
  return `<!doctype html><html><body style="margin:0;padding:0">${lxMailLayout(corps, { titre: "Comment s’est passé votre rendez-vous ?", salon: salonNom && salonNom !== "votre salon" ? esc(salonNom) : undefined })}</body></html>`;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!CRON_SECRET) return json(500, { error: "AVIS_CRON_SECRET non configuré" });
  const provided = req.headers.get("x-cron-secret") || "";
  if (provided !== CRON_SECRET) return json(401, { error: "Unauthorized" });
  try {
    const target = new Date();
    target.setDate(target.getDate() - 2);
    const targetIso = target.toISOString().slice(0, 10);
    const { data: rdvs, error } = await sb.from("rdv_online").select("id, salon_id, client_luxyra_id, client_email, client_prenom, service_nom, date_rdv, status, avis_invite_sent, salons(nom,slug), clients_luxyra(email,prenom,email_ok)").eq("date_rdv", targetIso).eq("status", "done").eq("avis_invite_sent", false).not("client_luxyra_id", "is", null);
    if (error) return json(500, { error: error.message });
    let sent = 0; let skipped = 0; const errors: string[] = [];
    for (const rdv of (rdvs || [])) {
      try {
        const { data: existing } = await sb.from("avis_salon").select("id").eq("rdv_online_id", rdv.id).maybeSingle();
        if (existing) { skipped++; continue; }
        const salon = (rdv as any).salons || {};
        const lx = (rdv as any).clients_luxyra || {};
        if (lx.email_ok === false) { await sb.from("rdv_online").update({ avis_invite_sent: true }).eq("id", rdv.id); skipped++; continue; }
        const toEmail = lx.email || rdv.client_email;
        const prenom = lx.prenom || rdv.client_prenom || "";
        if (!toEmail) { skipped++; continue; }
        const deepLink = `${WORKER_BASE}/compte.html#avis-${rdv.id}`;
        const dp = String(rdv.date_rdv).split("-");
        const moisFR = ["janvier","février","mars","avril","mai","juin","juillet","août","septembre","octobre","novembre","décembre"];
        const dateLabel = `${parseInt(dp[2])} ${moisFR[parseInt(dp[1]) - 1]} ${dp[0]}`;
        const htmlContent = buildEmailHTML({ prenom, salonNom: salon.nom || "votre salon", serviceNom: rdv.service_nom || "votre prestation", dateLabel, deepLink });
        const r = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: toEmail, toName: prenom, salonName: salon.nom || "Luxyra", subject: `Comment s’est passé votre rendez-vous chez ${salon.nom || "votre salon"} ?`, htmlContent, textContent: `Bonjour ${prenom},\n\nComment s'est passé votre rendez-vous chez ${salon.nom} le ${dateLabel} ?\nLaissez votre avis ici : ${deepLink}\n\n— Luxyra` }) });
        const rt = await r.text();
        if (!r.ok) { errors.push(`rdv ${rdv.id}: ${rt}`); await (globalThis as any).__lxReport?.("Brevo HTTP "+r.status+" : "+rt.slice(0,200), "error", undefined, { rdv_id: rdv.id }); continue; }
        await sb.from("rdv_online").update({ avis_invite_sent: true }).eq("id", rdv.id);
        sent++;
      } catch (eRow) { errors.push(`rdv ${rdv.id}: ${(eRow as Error).message}`); await (globalThis as any).__lxReport?.("Loop exception: "+(eRow as Error).message, "error", eRow, { rdv_id: rdv.id }); }
    }
    return json(200, { ok: true, target_date: targetIso, eligible: rdvs?.length || 0, sent, skipped, errors });
  } catch (e) {
    console.error("avis-invite-email unexpected", e);
    return json(500, { error: "Erreur interne" });
  }
});
