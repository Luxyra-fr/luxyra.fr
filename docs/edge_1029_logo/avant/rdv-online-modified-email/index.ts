// rdv-online-modified-email v5 — 2026-10-11 : + ligne « Prix » quand l'établissement change la prestation. v4 — 2026-10-10 : mise en page commune Luxyra (lxMailLayout), contenu inchangé. v3 — v2 + SECURITE 2026-10-08 : appel worker authentifie (x-lx-internal)
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
      <img src="https://luxyra.fr/luxyra-logo.png" width="64" height="64" alt="Luxyra" style="display:block;margin:0 auto 10px;border-radius:12px">
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
{ const _LX_FN="rdv-online-modified-email"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function frDate(iso: string | null | undefined) { if (!iso) return ""; try { return new Date(iso).toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" }); } catch { return String(iso); } }
function frHeure(t: string | null | undefined) { if (!t) return ""; return String(t).slice(0,5); }
function labelFor(field: string): string { switch (field) { case "date_rdv": return "Date"; case "heure_rdv": return "Heure"; case "collaborateur_nom": case "collaborateur_id": return "Avec"; case "duree_minutes": return "Durée"; case "service_nom": case "service_id": return "Prestation"; case "service_prix": return "Prix"; default: return field; } }
function fmtFor(field: string, val: any): string { if (val == null) return "—"; if (field === "date_rdv") return frDate(String(val)); if (field === "heure_rdv") return frHeure(String(val)); if (field === "duree_minutes") return String(val) + " min"; if (field === "service_prix") return String(val).replace(".", ",") + " €"; return String(val); }
function buildEmailHtml(opts: { clientPrenom: string, salonNom: string, newDate: string, newHeure: string, newCollab: string, diffFields: Record<string, { old: any, new: any }>, salonSlug: string | null }) {
  const seen = new Set<string>();
  const rows: string[] = [];
  const order = ["date_rdv","heure_rdv","collaborateur_nom","duree_minutes","service_nom","service_prix"];
  for (const k of order) { if (!opts.diffFields[k]) continue; const lab = labelFor(k); if (seen.has(lab)) continue; seen.add(lab); rows.push(`<tr><td style="padding:8px 12px;color:#6b6b6b;font-size:13px">${esc(lab)}</td><td style="padding:8px 12px;font-size:13px;color:#666;text-decoration:line-through">${esc(fmtFor(k, opts.diffFields[k].old))}</td><td style="padding:8px 12px;font-size:13px;color:#b8922e;font-weight:700">${esc(fmtFor(k, opts.diffFields[k].new))}</td></tr>`); }
  const diffTable = rows.length ? `<table style="width:100%;border-collapse:collapse;background:rgba(212,168,67,.06);border:1px solid rgba(212,168,67,.2);border-radius:10px;margin:18px 0;overflow:hidden"><thead><tr style="background:rgba(212,168,67,.1)"><th style="padding:10px;text-align:left;font-size:11px;color:#b8922e">Champ</th><th style="padding:10px;text-align:left;font-size:11px;color:#b8922e">Avant</th><th style="padding:10px;text-align:left;font-size:11px;color:#b8922e">Après</th></tr></thead><tbody>${rows.join("")}</tbody></table>` : "";
  const compteUrl = "https://luxyra.fr/compte.html";
  const corps = `<p style="font-size:15px;color:#333;margin:0 0 14px">Bonjour ${esc(opts.clientPrenom || "")},</p><p style="font-size:15px;color:#333;margin:0 0 14px"><strong style="color:#1a1a1a">${esc(opts.salonNom)}</strong> vient de modifier votre rendez-vous.</p>${diffTable}<div style="background:rgba(212,168,67,.1);border:1.5px solid rgba(212,168,67,.3);border-radius:12px;padding:18px;margin:18px 0;text-align:center"><div style="font-size:11px;color:#b8922e;font-weight:800;letter-spacing:1.5px;text-transform:uppercase">✨ Nouveau RDV</div><div style="font-size:18px;font-weight:800;color:#1a1a1a">${esc(frDate(opts.newDate))}</div><div style="font-size:22px;font-weight:900;color:#b8922e">à ${esc(opts.newHeure)}</div>${opts.newCollab ? `<div style="font-size:13px;color:#555;margin-top:6px">avec ${esc(opts.newCollab)}</div>` : ""}</div>${lxMailBouton("Voir mon compte →", esc(compteUrl))}`;
  return `<!doctype html><html><body style="margin:0;padding:0">${lxMailLayout(corps, { titre: "⚠️ Modification de votre rendez-vous", salon: opts.salonNom && opts.salonNom !== "Votre salon" ? esc(opts.salonNom) : undefined })}</body></html>`;
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const provided = req.headers.get("x-cron-secret") || "";
    if (!CRON_SECRET || provided !== CRON_SECRET) return json(401, { error: "Unauthorized" });
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const rdv_online_id = String(body.rdv_online_id || "");
    if (!rdv_online_id) return json(400, { error: "rdv_online_id requis" });
    const { data: rdv, error: rErr } = await sb.from("rdv_online").select("id, salon_id, client_email, client_prenom, client_nom, date_rdv, heure_rdv, collaborateur_nom, duree_minutes, service_nom, salon_modified_fields").eq("id", rdv_online_id).maybeSingle();
    if (rErr) return json(500, { error: rErr.message });
    if (!rdv) return json(404, { error: "RDV introuvable" });
    if (!rdv.client_email) return json(200, { ok: true, skipped: "no_client_email" });
    const { data: salon } = await sb.from("salons").select("nom, slug").eq("id", rdv.salon_id).maybeSingle();
    const salonNom = salon?.nom || "Votre salon";
    const salonSlug = salon?.slug || null;
    const diffFields = (rdv.salon_modified_fields as any) || {};
    const subject = `Votre RDV chez ${salonNom} a été modifié`;
    const html = buildEmailHtml({ clientPrenom: rdv.client_prenom || rdv.client_nom || "", salonNom, newDate: rdv.date_rdv as any, newHeure: frHeure(rdv.heure_rdv as any), newCollab: rdv.collaborateur_nom || "", diffFields, salonSlug });
    const res = await fetch(`${WORKER_BASE}/api/email/custom`, { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: rdv.client_email, toName: (rdv.client_prenom || "") + " " + (rdv.client_nom || ""), salonName: salonNom, subject, htmlContent: html, textContent: "" }) });
    const rTxt = await res.text();
    if (!res.ok) { await (globalThis as any).__lxReport?.("Brevo HTTP "+res.status+": "+rTxt.slice(0,200), "error", undefined, { rdv_online_id }); return json(500, { error: "Email envoi échec : " + rTxt }); }
    return json(200, { ok: true, sent_to: rdv.client_email, fields: Object.keys(diffFields) });
  } catch (e) { console.error("rdv-online-modified-email error", e); return json(500, { error: "Erreur interne" }); }
});
