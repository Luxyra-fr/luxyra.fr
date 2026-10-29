// salon-billing-email v4 — v3 + SECURITE 2026-10-08 : appel worker authentifie (x-lx-internal)
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
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const CRON_SECRET = Deno.env.get("AVIS_CRON_SECRET") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
{ const _LX_FN="salon-billing-email"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
const APP_URL = "https://luxyra.fr/app.html";
const SUPPORT_EMAIL = "support@luxyra.fr";
interface Ctx { nom: string; prenom: string; email: string; plan: string; trial_end: string | null; past_due_since: string | null; }
function wrap(title: string, body: string) { return lxMailLayout(body, { titre: title }); }
function btn(href: string, label: string, color = "gold") { if (color === "gold") return lxMailBouton(esc(label), esc(href)); const bg = color === "red" ? "#e74c3c" : "#3498db"; return `<p style="text-align:center;margin:22px 0"><a href="${esc(href)}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:700;padding:13px 26px;border-radius:30px">${esc(label)}</a></p>`; }
function pp(text: string) { return `<p style="font-size:15px;line-height:1.7;color:#333333;margin:0 0 14px">${text}</p>`; }
function box(title: string, content: string) { return `<div style="background:#faf6ec;border:1px solid #e6dcc3;border-radius:12px;padding:18px;margin:18px 0"><div style="font-weight:800;color:#9a7b2c;margin-bottom:8px">${title}</div><div style="font-size:14px;line-height:1.7;color:#333333">${content}</div></div>`; }
function price(plan: string) { return plan === "pro" ? "24,99 €" : "14,99 €"; }
function planLabel(plan: string) { return plan === "pro" ? "Pro" : "Essentiel"; }
function frDate(iso: string | null) { if (!iso) return ""; try { return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }); } catch { return iso; } }
function buildEmail(kind: string, ctx: Ctx) {
  const prenom = ctx.prenom ? esc(ctx.prenom) : "";
  const greet = `Bonjour ${prenom},`;
  const sign = `<strong style="color:#c8a84e">L'équipe Luxyra</strong>`;
  switch (kind) {
    case "trial_d3": return { subject: `${prenom?prenom+", ":""}votre essai Luxyra se termine dans 3 jours`, html: wrap("⏰ J-3 avant la fin de votre essai", `${pp(greet)}${pp(`Votre essai gratuit se termine le <strong>${frDate(ctx.trial_end)}</strong>.`)}${box("💡 Pour continuer", `Ajoutez votre moyen de paiement. <strong>${price(ctx.plan)}</strong> / mois, résiliable.`)}${btn(APP_URL+"?upgrade=now", "Choisir mon abonnement →")}${pp(sign)}`) };
    case "trial_d1": return { subject: `${prenom?prenom+", ":""}DEMAIN votre essai se termine`, html: wrap("⚠️ Demain : fin de votre essai", `${pp(greet)}${pp(`Votre essai se termine <strong>demain (${frDate(ctx.trial_end)})</strong>.`)}${box("⚡ Action requise", `Sans paiement, votre accès sera suspendu.`)}${btn(APP_URL+"?upgrade=now", "Choisir maintenant →")}${pp(sign)}`) };
    case "trial_expired": return { subject: `Votre essai est terminé — réactivez en 1 minute`, html: wrap("🔒 Essai terminé", `${pp(greet)}${pp(`Votre accès est suspendu.`)}${box("🔓 Réactiver", `Choisissez votre forfait et payez. Rétablissement instantané.`)}${btn(APP_URL+"?upgrade=now", "Réactiver →", "red")}${pp(sign)}`) };
    case "payment_failed": return { subject: `Échec du prélèvement Luxyra`, html: wrap("⚠️ Échec du prélèvement", `${pp(greet)}${pp(`Prélèvement <strong>${price(ctx.plan)}</strong> a <strong style="color:#e74c3c">échoué</strong>.`)}${box("💳 Causes", `Carte expirée, plafond, provisions insuffisantes.`)}${btn(APP_URL+"?portal=billing", "Mettre à jour →")}${pp(sign)}`) };
    case "payment_failed_d3": return { subject: `2e rappel — paiement en échec`, html: wrap("🔔 2e rappel", `${pp(greet)}${pp(`Pas de régularisation. Suspension dans 7 jours.`)}${btn(APP_URL+"?portal=billing", "Régulariser →")}${pp(sign)}`) };
    case "payment_failed_d7": return { subject: `URGENT — suspension sous 3 jours`, html: wrap("🚨 URGENT", `${pp(greet)}${pp(`Suspension dans 3 jours.`)}${btn(APP_URL+"?portal=billing", "Régulariser MAINTENANT →", "red")}${pp(sign)}`) };
    case "suspended": return { subject: `Votre compte Luxyra a été suspendu`, html: wrap("🔒 Compte suspendu", `${pp(greet)}${pp(`Suspension faute de paiement.`)}${box("📦 60 jours de conservation", `Vos données sont gardées 60 jours.`)}${btn(APP_URL+"?portal=billing", "Réactiver →", "red")}${pp(sign)}`) };
    default: return null;
  }
}
const VALID_KINDS = ["trial_d3","trial_d1","trial_expired","payment_failed","payment_failed_d3","payment_failed_d7","suspended"];
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const provided = req.headers.get("x-cron-secret") || "";
    if (!CRON_SECRET || provided !== CRON_SECRET) return json(401, { error: "Unauthorized" });
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const salon_id = String(body.salon_id || "");
    const kind = String(body.kind || "");
    const force = !!body.force;
    if (!salon_id) return json(400, { error: "salon_id requis" });
    if (!VALID_KINDS.includes(kind)) return json(400, { error: "kind invalide. Valides : " + VALID_KINDS.join(", ") });
    const { data: salon, error: sErr } = await sb.from("salons").select("id, nom, email, plan, trial_end, past_due_since, status, billing_emails_sent, config_json").eq("id", salon_id).maybeSingle();
    if (sErr) return json(500, { error: sErr.message });
    if (!salon) return json(404, { error: "Salon introuvable" });
    if (!salon.email) return json(400, { error: "Salon sans email" });
    if (!force) {
      const sentArr: any[] = Array.isArray(salon.billing_emails_sent) ? salon.billing_emails_sent : [];
      const recentSame = sentArr.find((it) => it && it.kind === kind && it.sent_at && (Date.now() - new Date(it.sent_at).getTime() < 24*3600*1000));
      if (recentSame) return json(200, { ok: true, skipped: "sent_within_24h", kind });
    }
    let prenom = "";
    try { const c = (salon as any).config_json as any; if (c) prenom = c.gerantPrenom || c.prenom || c.contact_prenom || ""; } catch {}
    const ctx: Ctx = { nom: salon.nom || "votre salon", prenom: prenom || "", email: salon.email, plan: (salon.plan || "essential").toLowerCase(), trial_end: salon.trial_end as any, past_due_since: (salon as any).past_due_since };
    const tpl = buildEmail(kind, ctx);
    if (!tpl) return json(400, { error: "Pas de template pour ce kind" });
    const res = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: salon.email, toName: ctx.nom, salonName: "Luxyra", subject: tpl.subject, htmlContent: tpl.html, textContent: "" }) });
    const rTxt = await res.text();
    if (!res.ok) { await (globalThis as any).__lxReport?.("Brevo HTTP "+res.status+": "+rTxt.slice(0,200), "error", undefined, { salon_id, kind }); return json(500, { error: "Email envoi échec : " + rTxt }); }
    const sentArr: any[] = Array.isArray(salon.billing_emails_sent) ? salon.billing_emails_sent : [];
    sentArr.push({ kind, sent_at: new Date().toISOString() });
    await sb.from("salons").update({ billing_emails_sent: sentArr }).eq("id", salon_id);
    return json(200, { ok: true, kind, sent_to: salon.email });
  } catch (e) { console.error("salon-billing-email error", e); return json(500, { error: "Erreur interne" }); }
});
