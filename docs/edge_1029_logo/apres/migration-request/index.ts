// migration-request v10 — v9 + SECURITE 2026-10-08 : from_app/salon_id pris en compte UNIQUEMENT si la session du proprietaire du salon est fournie ;
// config_json jamais ecrase si illisible ; appel worker authentifie (x-lx-internal).
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
const NOTIFY_EMAIL = "contact@luxyra.fr";
const SUPPORT_EMAIL = "support@luxyra.fr";
const LOGO_URL = "https://luxyra.fr/luxyra-logo.png";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function esc(s:unknown){return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
function trim(s:unknown,max:number){return String(s??"").trim().slice(0,max);}
function validEmail(s:string){return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);}
{ const _LX_FN="migration-request"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
const SOURCE_LABELS: Record<string,string> = {"caisse-salon":"Logiciel de caisse salon","reservation-online":"Plateforme de réservation en ligne","planning":"Logiciel de planning / agenda","excel":"Excel / CSV","papier":"Agenda papier","autre":"Autre solution"};
const RANGE_LABELS: Record<string,string> = {"0-100":"Moins de 100","100-500":"100 à 500","500-1000":"500 à 1000","1000-2000":"1000 à 2000","2000+":"Plus de 2000"};
const SCOPE_DEFAULT = { clients:true, fiches_tech:true, photos:true, rdvs:true, archives:true, fidelite:false, abos:false };
function normalizeDataScope(input: any): Record<string, boolean> { if (!input || typeof input !== "object") return { ...SCOPE_DEFAULT }; const out: Record<string, boolean> = {}; Object.keys(SCOPE_DEFAULT).forEach(k => { out[k] = (k in input) ? !!input[k] : (SCOPE_DEFAULT as any)[k]; }); return out; }
function simpleEmail(title: string, body: string) { return lxMailLayout(body, { titre: esc(title) }); }
function buildAdminEmail(payload: any) { const sourceLabel = SOURCE_LABELS[payload.source_type] || payload.source_type; const rangeLabel = RANGE_LABELS[payload.client_count_range] || payload.client_count_range || "—"; const subject = `Migration Luxyra — ${payload.salon_name}`; const scopeLines = Object.keys(SCOPE_DEFAULT).map(k=>`<li>${k}: ${payload.data_scope?.[k]?"✓":"✗"}</li>`).join(""); const body = `<p>${payload.from_app?"Demande depuis l'app (salon abonné, session vérifiée)":"Demande publique"}.</p><h3 style="color:#c8a84e">Coordonnées</h3><ul><li>Salon: ${esc(payload.salon_name)}</li><li>Email: <a href="mailto:${esc(payload.email)}">${esc(payload.email)}</a></li><li>Téléphone: ${esc(payload.phone)}</li>${payload.salon_id ? `<li>Salon ID: ${esc(payload.salon_id)}</li>` : ""}</ul><h3 style="color:#c8a84e">Situation</h3><ul><li>Solution: ${esc(sourceLabel)}</li>${payload.source_software_name ? `<li>Logiciel: ${esc(payload.source_software_name)}</li>` : ""}<li>Clients: ${esc(rangeLabel)}</li></ul><h3 style="color:#c8a84e">Périmètre</h3><ul>${scopeLines}</ul>${payload.message ? `<h3 style="color:#c8a84e">Message</h3><p>${esc(payload.message)}</p>` : ""}<p style="color:#666;font-size:11px">Réf: ${esc(payload.request_id)}</p>`; return { subject, html: simpleEmail("Nouvelle demande de migration", body) }; }
function buildClientEmail(payload: { salon_name: string; }) { const subject = `Votre demande de migration Luxyra a bien été reçue`; const body = `<p>Bonjour,</p><p>Nous avons bien reçu votre demande de migration vers Luxyra pour <strong style="color:#c8a84e">${esc(payload.salon_name)}</strong>.</p><p>Notre équipe vous recontacte sous <strong>4 heures ouvrées</strong>.</p><p>Pour toute question urgente : <a href="mailto:${SUPPORT_EMAIL}" style="color:#c8a84e">${SUPPORT_EMAIL}</a></p><p style="color:#c8a84e;font-style:italic">L'équipe Luxyra</p>`; return { subject, html: simpleEmail("Demande bien reçue", body) }; }
async function sendEmail(to: string, toName: string, subject: string, html: string) { try { const res = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to, toName, salonName: "Luxyra", subject, htmlContent: html, textContent: "" }) }); const txt = await res.text(); let body: any = null; try { body = JSON.parse(txt); } catch {} if (!res.ok) return { ok: false, debug: { status: res.status, body: txt } }; if (body && body.success === false) return { ok: false, debug: body }; return { ok: true, debug: body }; } catch (e) { return { ok: false, debug: { error: String((e as Error)?.message || e) } }; } }
async function setSalonMigrationStatus(salon_id: string, status: string, request_id: string) { try { const { data: salon } = await sb.from("salons").select("config_json").eq("id", salon_id).maybeSingle(); if (!salon) return; let cfg: any = {}; if (salon.config_json) { try { const asString = typeof salon.config_json === "string" ? salon.config_json : JSON.stringify(salon.config_json); const parsed = JSON.parse(asString); cfg = (typeof parsed === "string") ? JSON.parse(parsed) : parsed; } catch { return; } if (typeof cfg !== "object" || cfg === null || Array.isArray(cfg)) return; } cfg.migrationStatus = status; cfg.migrationRequestedAt = new Date().toISOString(); cfg.migrationRequestId = request_id; await sb.from("salons").update({ config_json: JSON.stringify(cfg) }).eq("id", salon_id); } catch (e) { console.error("setSalonMigrationStatus:", e); } }
// Le salon_id / from_app ne sont acceptes que si la session fournie est celle du proprietaire du salon.
async function salonVerifie(req: Request, salonId: string | null): Promise<boolean> {
  if (!salonId) return false;
  const t = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!t) return false;
  try { const { data } = await sb.auth.getUser(t); const user = data && data.user; if (!user) return false; const { data: s } = await sb.from("salons").select("id").eq("id", salonId).eq("user_id", user.id).maybeSingle(); return !!s; } catch { return false; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const salon_name = trim(body.salon_name, 200);
    const email = trim(body.email, 200).toLowerCase();
    const phone = trim(body.phone, 50);
    const source_type = trim(body.source_type, 50);
    const source_software_name = trim(body.source_software_name, 200);
    const client_count_range = trim(body.client_count_range, 30);
    const message = trim(body.message, 2000);
    const salonDemande = trim(body.salon_id, 64) || null;
    const verifie = (!!body.from_app || !!salonDemande) ? await salonVerifie(req, salonDemande) : false;
    const salon_id = verifie ? salonDemande : null;
    const from_app = verifie;
    const data_scope = normalizeDataScope(body.data_scope);
    if (!salon_name) return json(400, { error: "Le nom du salon est requis" });
    if (!email || !validEmail(email)) return json(400, { error: "Email invalide" });
    if (!phone) return json(400, { error: "Le téléphone est requis" });
    if (!source_type) return json(400, { error: "Le type de solution est requis" });
    if (source_type && !SOURCE_LABELS[source_type]) return json(400, { error: "Type de solution invalide" });
    if (client_count_range && !RANGE_LABELS[client_count_range]) return json(400, { error: "Tranche de clients invalide" });
    if (body.website) return json(200, { ok: true, request_id: "honeypot" });
    { const since = new Date(Date.now() - 24*3600*1000).toISOString(); const { count: recentCount } = await sb.from("migration_requests").select("id", { count: "exact", head: true }).eq("email", email).gte("created_at", since); if ((recentCount || 0) >= (from_app ? 10 : 3)) return json(429, { error: "Trop de demandes récentes. Contactez " + SUPPORT_EMAIL }); }
    const ip = req.headers.get("cf-connecting-ip") || req.headers.get("x-forwarded-for") || "";
    const ua = req.headers.get("user-agent") || "";
    const insertPayload: any = { salon_name, email, phone, source_type, source_software_name: source_software_name || null, client_count_range: client_count_range || null, message: message || null, ip_address: ip || null, user_agent: ua || null, data_scope };
    if (salon_id) insertPayload.salon_id = salon_id;
    const { data: inserted, error: insErr } = await sb.from("migration_requests").insert(insertPayload).select("id").single();
    if (insErr) { console.error("insert failed:", insErr); await (globalThis as any).__lxReport?.("Insert migration_requests failed: "+insErr.message, "error", undefined, { salon_name }); return json(500, { error: "Erreur enregistrement" }); }
    const request_id = inserted.id;
    if (from_app && salon_id) await setSalonMigrationStatus(salon_id, "requested", request_id);
    const adminTpl = buildAdminEmail({ salon_name, email, phone, source_type, source_software_name, client_count_range, message, salon_id, from_app, request_id, data_scope });
    const adminEmailRes = await sendEmail(NOTIFY_EMAIL, "Luxyra", adminTpl.subject, adminTpl.html);
    const clientTpl = buildClientEmail({ salon_name });
    const clientEmailRes = await sendEmail(email, salon_name, clientTpl.subject, clientTpl.html);
    if (!adminEmailRes.ok) await (globalThis as any).__lxReport?.("Admin email failed: "+JSON.stringify(adminEmailRes.debug).slice(0,200), "error", undefined, { request_id });
    return json(200, { ok: true, request_id, email_admin_sent: adminEmailRes.ok, email_client_sent: clientEmailRes.ok });
  } catch (e) {
    console.error("migration-request error:", e);
    return json(500, { error: "Erreur interne" });
  }
});
