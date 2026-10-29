// lx-alert-mail v9 — SECURITE 2026-10-07 : appels worker authentifies (x-lx-internal), test ntfy protege. v8 : ajout classification automatique + lien drilldown dans le mail
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
const NTFY_TOPIC = Deno.env.get("NTFY_TOPIC") || "luxyra-alerts-mobz57-x7k9q2";
const FREE_MOBILE_USER = Deno.env.get("FREE_MOBILE_USER") || "";
const FREE_MOBILE_KEY = Deno.env.get("FREE_MOBILE_KEY") || "";
const ADMIN_EMAIL = "support@luxyra.fr";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "GET, POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}

async function sendEmail(opts: { to: string; toName: string; subject: string; htmlContent: string; textContent: string }) {
  const r = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: opts.to, toName: opts.toName, salonName: "Luxyra Monitoring", subject: opts.subject, htmlContent: opts.htmlContent, textContent: opts.textContent }) });
  const rt = await r.text();
  if (!r.ok) throw new Error(`worker email: ${r.status} ${rt.slice(0, 300)}`);
  return rt;
}

async function sendNtfy(title: string, message: string, priority: number = 4, clickUrl?: string): Promise<{ ok: boolean; status?: number; message?: string }> {
  if (!NTFY_TOPIC) return { ok: false, message: "NTFY_TOPIC non configuré" };
  try {
    const r = await fetch("https://ntfy.sh/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        topic: NTFY_TOPIC,
        title: title.slice(0, 200),
        message: message.slice(0, 4000),
        priority,
        tags: ["rotating_light", "luxyra"],
        click: clickUrl || "https://luxyra.fr/admin?tab=monitoring"
      })
    });
    const txt = await r.text();
    return { ok: r.ok, status: r.status, message: r.ok ? undefined : txt.slice(0, 200) };
  } catch (e) { return { ok: false, message: String((e as Error)?.message || e).slice(0, 200) }; }
}

async function sendSmsFreeMobile(text: string): Promise<{ ok: boolean; status?: number; message?: string }> {
  if (!FREE_MOBILE_USER || !FREE_MOBILE_KEY) return { ok: false, message: "Free Mobile non configuré" };
  try {
    const params = new URLSearchParams({ user: FREE_MOBILE_USER, pass: FREE_MOBILE_KEY, msg: text.slice(0, 999) });
    const r = await fetch("https://smsapi.free-mobile.fr/sendmsg?" + params.toString(), { method: "GET" });
    return { ok: r.ok, status: r.status };
  } catch (e) { return { ok: false, message: String((e as Error)?.message || e).slice(0, 200) }; }
}

function alertMeta(alertType: string) {
  switch (alertType) {
    case "DB_ERROR":               return { label: "Erreur base de données",   icon: "🚨", color: "#ef5350", isCritical: true, sourceType: "audit" };
    case "NF525_SEAL_TRIGGER_FAIL":return { label: "NF525 — Échec scellement", icon: "⛓️",  color: "#ef5350", isCritical: true, sourceType: "audit" };
    case "JS_ERROR":               return { label: "Erreur JavaScript app",    icon: "⚠️",  color: "#ff9800", isCritical: false, sourceType: "audit" };
    case "JS_CONSOLE_ERROR":       return { label: "Console.error app",         icon: "📝", color: "#ff9800", isCritical: false, sourceType: "audit" };
    case "JS_ERROR_PUBLIC":        return { label: "Erreur JS page publique",   icon: "🌐", color: "#ff9800", isCritical: false, sourceType: "public" };
    case "SERVER_ERROR":           return { label: "Erreur serveur",            icon: "🛠️", color: "#ef5350", isCritical: true, sourceType: "server" };
    default:                       return { label: alertType || "Erreur",      icon: "⚠️",  color: "#ff9800", isCritical: false, sourceType: "audit" };
  }
}

// V8 : Pré-fetche classification + signature pour les inclure dans le mail/push
async function enrichWithClassification(alertType: string, msg: string, category: string): Promise<{ classification: any; signature: string; drilldownUrl: string }> {
  let classification: any = null;
  let signature = '';
  try {
    const meta = alertMeta(alertType);
    const [clsRes, sigRes] = await Promise.all([
      sb.rpc('classify_error', { p_msg: msg || '' }),
      sb.rpc('compute_error_signature', { p_source_type: meta.sourceType, p_category: category || alertType, p_msg: msg || '' })
    ]);
    classification = clsRes.error ? null : clsRes.data;
    signature = sigRes.error ? '' : (sigRes.data || '');
  } catch (_) {}
  const drilldownUrl = signature
    ? `${WORKER_BASE}/admin.html?tab=monitoring&open_signature=${encodeURIComponent(signature)}`
    : `${WORKER_BASE}/admin.html?tab=monitoring`;
  return { classification, signature, drilldownUrl };
}

function buildRealtimeHTML(opts: any) {
  const m = alertMeta(opts.alertType);
  const cls = opts.classification;
  let classHTML = '';
  if (cls) {
    classHTML = `<div style="margin:14px 0 20px;padding:14px;background:#faf6ec;border-left:3px solid #c8a84e;border-radius:10px"><div style="color:#9a7b2c;font-weight:700;margin-bottom:6px">🤖 Classification automatique : ${esc(cls.human_title || cls.kind || 'Inconnu')}</div>${cls.human_explain ? `<div style="color:#444;font-size:13px;margin-bottom:8px;line-height:1.5">${esc(cls.human_explain)}</div>` : ''}${cls.fix_proposal ? `<div style="background:#ffffff;border:1px solid #e6dcc3;padding:10px;border-radius:6px;color:#333;font-size:13px;line-height:1.5"><strong style="color:#2e7d32">💡 Piste de fix :</strong> ${esc(cls.fix_proposal)}</div>` : ''}${cls.actionable === false ? `<div style="color:#888;font-size:11px;margin-top:8px;font-style:italic">ℹ️ Probablement non actionnable — comportement normal ou hors de votre contrôle.</div>` : ''}</div>`;
  }
  return lxMailLayout(`<div style="margin:0 0 20px;padding:18px;background:#fdf3f2;border-left:3px solid ${m.color};border-radius:10px"><div style="color:${m.color};font-weight:700">${m.icon} ${esc(m.label)}</div><div style="font-weight:700">Salon : ${esc(opts.salon_nom)}</div></div>${classHTML}<div style="background:#f7f4ec;padding:12px;border-radius:8px"><div style="color:#888;font-size:11px;margin-bottom:4px">Message brut :</div><div style="font-family:monospace;color:${m.color};word-break:break-word">${esc(opts.msg)}</div></div>${opts.file ? `<p style="color:#666;font-size:13px">Source: ${esc(opts.file)}${opts.line?':'+esc(opts.line):''}</p>` : ''}${opts.url ? `<p style="color:#666;font-size:13px">URL: ${esc(opts.url)}</p>` : ''}${lxMailBouton("⏏ Détail dans Monitoring", esc(opts.drilldownUrl))}<p style="color:#888;font-size:11px;text-align:center">Ce lien ouvre directement le drilldown de cette erreur dans le panel admin, même depuis ton téléphone.</p>`, { titre: "Luxyra Monitoring" });
}

{ const _LX_FN="lx-alert-mail"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  if (url.searchParams.get("test_ntfy") === "1") {
    if (!CRON_SECRET || (req.headers.get("x-cron-secret") || "") !== CRON_SECRET) return json(401, { error: "Unauthorized" });
    const r = await sendNtfy("🔔 Test Luxyra Monitoring", "Chaîne ntfy.sh OK ! Tu reçois bien les notifs critiques sur ce téléphone.", 5);
    return json(200, { test_ok: true, ntfy: { ok: r.ok, status: r.status } });
  }
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  if (!CRON_SECRET) return json(500, { error: "AVIS_CRON_SECRET non configuré" });
  const provided = req.headers.get("x-cron-secret") || "";
  if (provided !== CRON_SECRET) return json(401, { error: "Unauthorized" });
  try {
    const body = await req.json().catch(() => ({} as any));
    const mode = String(body.mode || "realtime");
    if (mode === "realtime") {
      const salon_id = String(body.salon_id || "");
      const audit_id = body.audit_id || null;
      const details = body.details || {};
      if (!salon_id) return json(400, { error: "salon_id requis" });
      const alertType = String(details.alert_type || "JS_ERROR");
      const meta = alertMeta(alertType);
      const isDummySalon = salon_id === "00000000-0000-0000-0000-000000000000";
      const { data: salon } = isDummySalon ? { data: null } : await sb.from("salons").select("nom").eq("id", salon_id).maybeSingle();
      const salonNom = salon?.nom || (alertType === "SERVER_ERROR" ? "Serveur Luxyra" : alertType === "JS_ERROR_PUBLIC" ? ("Page publique " + (details.salon_slug ? "(" + details.salon_slug + ")" : "")) : "Salon inconnu");
      let count1h = 1;
      if (!isDummySalon && (alertType === "JS_ERROR" || alertType === "DB_ERROR")) {
        const { count } = await sb.from("audit_log").select("id", { count: "exact", head: true }).eq("action", alertType).eq("salon_id", salon_id).gte("timestamp_action", new Date(Date.now() - 3600 * 1000).toISOString());
        count1h = Number(count || 1);
      }
      // V8 : enrichissement classification + lien drilldown
      const enriched = await enrichWithClassification(alertType, details.msg || '', details.alert_type || alertType);
      const { data: pendingRow } = await sb.from("js_error_alerts_sent").insert({ salon_id: isDummySalon ? null : salon_id, audit_id, err_msg: details.msg, recipient: ADMIN_EMAIL, kind: "realtime", status: "pending" }).select("id").single();
      const html = buildRealtimeHTML({ alertType, salon_nom: salonNom, salon_id, msg: details.msg || "(message inconnu)", file: details.file || "", line: details.line || "", url: details.url || "", classification: enriched.classification, drilldownUrl: enriched.drilldownUrl });
      const clsTitle = enriched.classification?.human_title || meta.label;
      const subject = `${meta.icon} ${clsTitle} — ${salonNom}${count1h > 1 ? ` (${count1h} en 1h)` : ""}`;
      const text = `${clsTitle} — ${salonNom}\n\n${details.msg || ""}${enriched.classification?.fix_proposal ? `\n\n💡 Piste : ${enriched.classification.fix_proposal}` : ''}\n\nDétail : ${enriched.drilldownUrl}`;
      const tasks: Promise<any>[] = [];
      let mailOk = false, ntfyOk = false, ntfyAttempted = false, smsOk = false, smsAttempted = false;
      tasks.push(sendEmail({ to: ADMIN_EMAIL, toName: "Luxyra Admin", subject, htmlContent: html, textContent: text }).then(()=>{mailOk=true;}).catch(async(eMail)=>{ await (globalThis as any).__lxReport?.("Brevo mail failed: "+(eMail as Error).message, "critical", undefined, { alertType, salon_id }); }));
      if (meta.isCritical) {
        if (NTFY_TOPIC) {
          ntfyAttempted = true;
          const pushTitle = `${meta.icon} ${clsTitle}`;
          const pushBody = `Salon: ${salonNom}\n${(details.msg || "").slice(0,200)}${enriched.classification?.fix_proposal ? `\n\n💡 ${enriched.classification.fix_proposal.slice(0,150)}` : ''}`;
          tasks.push(sendNtfy(pushTitle, pushBody, 5, enriched.drilldownUrl).then(r=>{ntfyOk=r.ok;}));
        }
        if (FREE_MOBILE_USER && FREE_MOBILE_KEY) {
          smsAttempted = true;
          tasks.push(sendSmsFreeMobile(`[LUXYRA] ${clsTitle} - ${salonNom}\n${(details.msg || "").slice(0,140)}`).then(r=>{smsOk=r.ok;}));
        }
      }
      await Promise.allSettled(tasks);
      if (pendingRow?.id) {
        await sb.from("js_error_alerts_sent").update({ status: (mailOk || ntfyOk || smsOk) ? "sent" : "failed", error_response: [mailOk?"mail":null, ntfyOk?"ntfy":null, smsOk?"sms":null].filter(Boolean).join("+") || "all_failed" }).eq("id", pendingRow.id);
      }
      return json(200, { ok: true, sent: mailOk || ntfyOk || smsOk, mail_ok: mailOk, ntfy_ok: ntfyOk, sms_ok: smsOk, classification: enriched.classification?.kind, signature: enriched.signature });
    }
    if (mode === "digest") return json(200, { ok: true, skipped: "digest stub" });
    if (mode === "integrity") {
      const { data: allAnomalies, error: rpcErr } = await sb.rpc("check_data_integrity");
      if (rpcErr) return json(500, { error: "rpc: " + rpcErr.message });
      const fresh = (allAnomalies || []).filter((a: any) => a.detected_at && new Date(a.detected_at).getTime() >= Date.now() - 25 * 3600 * 1000);
      if (fresh.length === 0) return json(200, { ok: true, skipped: true });
      const subject = `⚠️ Luxyra Audit — ${fresh.length} anomalie${fresh.length>1?'s':''}`;
      await sendEmail({ to: ADMIN_EMAIL, toName: "Luxyra Admin", subject, htmlContent: lxMailLayout("<p>"+fresh.length+" anomalies</p>", { titre: "Luxyra Audit NF525" }), textContent: subject });
      if (NTFY_TOPIC) await sendNtfy("Luxyra Audit NF525", `${fresh.length} anomalie(s) NF525. Voir admin.`, 5);
      return json(200, { ok: true, sent: true, anomalies: fresh.length });
    }
    return json(400, { error: "mode invalide" });
  } catch (e) {
    console.error("lx-alert-mail", e);
    return json(500, { error: "Erreur interne" });
  }
});
