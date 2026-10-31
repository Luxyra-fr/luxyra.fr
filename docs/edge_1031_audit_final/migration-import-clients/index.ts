// migration-import-clients v5 — 2026-10-31 audit final : contrôle admin par la base (rpc is_admin avec le jeton de
// l'utilisateur : support@luxyra.fr + double authentification + session < 12 h) au lieu de la table admin_users seule.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const sbAdmin = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
function trim(s:unknown, max=500){return String(s??"").trim().slice(0,max);}
function parseSexe(s:string):string{const x=(s||"").trim().toUpperCase(); if(x==="M"||x==="H"||x==="HOMME"||x==="MASCULIN")return"H"; if(x==="F"||x==="FEMME"||x==="FÉMININ")return"F"; if(x==="E"||x==="ENFANT")return"E"; return"F";}
function parseBool(s:any, def=true):boolean{if(typeof s==="boolean")return s; const x=String(s||"").trim().toLowerCase(); if(x==="true"||x==="1"||x==="oui"||x==="yes"||x==="y")return true; if(x==="false"||x==="0"||x==="non"||x==="no"||x==="n")return false; return def;}
function parseInt0(s:any):number{const n=parseInt(String(s||"").trim(),10); return Number.isFinite(n)?n:0;}
function normPhone(s:string):string{return String(s||"").replace(/\D/g,"");}
async function lxEstAdmin(jwt: string): Promise<boolean> {
  try {
    const r = await fetch(SB_URL + "/rest/v1/rpc/is_admin", { method: "POST", headers: { apikey: SB_ANON || SB_SR, Authorization: "Bearer " + jwt, "Content-Type": "application/json" }, body: "{}" });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
}
{ const _LX_FN="migration-import-clients"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const authHeader = req.headers.get("Authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "JWT requis" });
  const { data: userData, error: userErr } = await sbAdmin.auth.getUser(jwt);
  if (userErr || !userData?.user) return json(401, { error: "Token invalide" });
  if (!(await lxEstAdmin(jwt))) return json(403, { error: "Accès admin requis" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    const migration_request_id = trim(body.migration_request_id, 64);
    const salon_id = trim(body.salon_id, 64);
    const clients: any[] = Array.isArray(body.clients) ? body.clients : [];
    const mode = body.mode || "insert";
    if (!migration_request_id) return json(400, { error: "migration_request_id requis" });
    if (!salon_id) return json(400, { error: "salon_id requis" });
    if (!clients.length) return json(400, { error: "Aucun client à importer" });
    if (clients.length > 5000) return json(400, { error: "Maximum 5000 clients par batch" });
    const { data: mr, error: mrErr } = await sbAdmin.from("migration_requests").select("id, salon_id, status").eq("id", migration_request_id).maybeSingle();
    if (mrErr || !mr) return json(404, { error: "Migration request introuvable" });
    if (mr.salon_id !== salon_id) return json(400, { error: "salon_id ne correspond pas à la demande" });
    if (mr.status === "completed" || mr.status === "cancelled") return json(400, { error: "Migration déjà clôturée" });
    const { data: salon, error: sErr } = await sbAdmin.from("salons").select("id, nom").eq("id", salon_id).maybeSingle();
    if (sErr || !salon) return json(404, { error: "Salon introuvable" });
    const { data: existingClients } = await sbAdmin.from("clients").select("id, nom, prenom, telephone").eq("salon_id", salon_id);
    const existingByPhone = new Map<string, any>();
    const existingByNamePrenom = new Set<string>();
    (existingClients || []).forEach(c => { const tel = normPhone(c.telephone || ""); if (tel) existingByPhone.set(tel, c); const key = (c.nom||"").toLowerCase().trim() + "|" + (c.prenom||"").toLowerCase().trim(); if (key !== "|") existingByNamePrenom.add(key); });
    const toInsert: any[] = [];
    const errors: { line: number; reason: string; data: any }[] = [];
    let skipped = 0;
    clients.forEach((c, i) => {
      const lineNo = i + 1;
      const nom = trim(c.nom, 200);
      const prenom = trim(c.prenom, 200);
      if (!nom) { errors.push({ line: lineNo, reason: "Nom manquant", data: c }); return; }
      const phone = trim(c.telephone, 50);
      const phoneNorm = normPhone(phone);
      if (phoneNorm && existingByPhone.has(phoneNorm)) { skipped++; return; }
      const npKey = nom.toLowerCase() + "|" + prenom.toLowerCase();
      if (!phoneNorm && existingByNamePrenom.has(npKey)) { skipped++; return; }
      const row = { salon_id, nom, prenom: prenom || "", sexe: parseSexe(c.sexe || ""), telephone: phone || "", telephone2: trim(c.telephone2, 50), email: trim(c.email, 200), adresse: trim(c.adresse, 500), cp: trim(c.cp, 20), ville: trim(c.ville, 200), date_naissance: trim(c.date_naissance, 20), notes: trim(c.notes, 4000), nature_cheveux: trim(c.nature_cheveux, 200), type_cheveux: trim(c.type_cheveux, 200), details_cheveux: trim(c.details_cheveux, 1000), points_fidelite: parseInt0(c.points_fidelite), sms_ok: parseBool(c.sms_ok, true), email_ok: parseBool(c.email_ok, false), actif: parseBool(c.actif, true) };
      toInsert.push(row);
      if (phoneNorm) existingByPhone.set(phoneNorm, { id: "new" });
      else existingByNamePrenom.add(npKey);
    });
    if (mode === "dry_run") return json(200, { ok: true, mode: "dry_run", would_insert: toInsert.length, would_skip: skipped, errors, sample: toInsert.slice(0, 5) });
    let inserted = 0;
    const insertErrors: any[] = [];
    for (let i = 0; i < toInsert.length; i += 200) {
      const batch = toInsert.slice(i, i + 200);
      const { data: insRes, error: insErr } = await sbAdmin.from("clients").insert(batch).select("id");
      if (insErr) { insertErrors.push({ batch_start: i, message: insErr.message }); await (globalThis as any).__lxReport?.("Insert clients batch failed: "+insErr.message, "error", undefined, { salon_id, batch_start: i }); }
      else inserted += (insRes || []).length;
    }
    const importNote = `⚡ Import effectué ${new Date().toISOString()} — ${inserted} clients insérés, ${skipped} doublons skip, ${errors.length} erreurs ligne` + (insertErrors.length ? `, ${insertErrors.length} erreurs batch` : "");
    try {
      const { data: cur } = await sbAdmin.from("migration_requests").select("internal_notes, status").eq("id", migration_request_id).maybeSingle();
      const prevNotes = (cur && cur.internal_notes) ? cur.internal_notes + "\n" : "";
      const updates: any = { internal_notes: prevNotes + importNote };
      if (cur && (cur.status === "new" || cur.status === "contacted")) { updates.status = "in_progress"; updates.status_updated_at = new Date().toISOString(); }
      await sbAdmin.from("migration_requests").update(updates).eq("id", migration_request_id);
    } catch {}
    try { await sbAdmin.from("audit_log").insert({ salon_id, type: "MIGRATION_IMPORT_CLIENTS", details: importNote, operateur: userData.user.email || "admin" }); } catch {}
    try { await sbAdmin.from("admin_log").insert({ action: "MIGRATION_IMPORT_CLIENTS", salon_id, cible: "migration_requests:" + migration_request_id, details: inserted + " client(s) importé(s), " + skipped + " doublon(s)", admin_email: userData.user.email || "admin", origine: "auto" }); } catch {}
    const { count: totalAfter } = await sbAdmin.from("clients").select("id", { count: "exact", head: true }).eq("salon_id", salon_id);
    return json(200, { ok: true, mode: "insert", inserted, skipped, errors, insert_errors: insertErrors, total_in_db_after: totalAfter || 0, report: importNote });
  } catch (e) {
    console.error("[migration-import-clients] error:", e);
    return json(500, { error: "Erreur interne" });
  }
});
