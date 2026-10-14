// avis-create v10 — 2026-10-14 : version FUSIONNÉE des lots « secu » et « site » (intégration integ1014).
//   site : un avis signalé (reported) ou masqué par Luxyra (hidden_by_luxyra) ne peut plus être modifié par le client
//   (avant : la modification effaçait le signalement et republiait l'avis).
// 2026-10-14 SECURITE : jeton client refusé si la version de session a changé (mot de passe
//   changé / réinitialisé) ; rattachement d'un ticket PAR EMAIL seulement si l'email du compte est vérifié
//   (sinon uniquement par client_luxyra_id).
// avis-create v9 — v8 + notes par critère (accueil, propreté, cadre, qualité) + jusqu'à 3 photos (2026-10-13)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify as jwtVerify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(status: number, body: unknown) { return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } }); }

{ const _LX_FN="avis-create"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// 2026-10-14 : version de session (sv) comparée à clients_luxyra.session_version (0 pour les anciens jetons)
async function verifySession(token: string): Promise<{ lx_id: string; email: string; email_verified: boolean } | null> {
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const payload = await jwtVerify(token, key);
    if (!payload) return null;
    const id = String((payload as any).lx_id || (payload as any).bp_id || "");
    if (!UUID_RE.test(id)) return null;
    const { data: row } = await sb.from("clients_luxyra").select("id, email, email_verified, session_version").eq("id", id).maybeSingle();
    if (!row) return null;
    if ((Number((payload as any).sv ?? 0) || 0) !== (Number(row.session_version) || 0)) return null;
    return { lx_id: String(row.id), email: String(row.email || "").toLowerCase().trim(), email_verified: row.email_verified === true };
  } catch { return null; }
}

const HONORED_STATUSES = new Set(["honore", "honoré", "done", "termine", "terminé", "completed"]);
const CANCELLED_STATUSES = new Set(["cancelled", "canceled", "annule", "annulé"]);
const PHOTO_PREFIX = SB_URL + "/storage/v1/object/public/avis-photos/";
const CRITERES = ["accueil", "proprete", "cadre", "qualite"];
const SELECT_AVIS = "id, salon_id, nom, note, texte, date, created_at, updated_at, note_accueil, note_proprete, note_cadre, note_qualite, photos";

async function traiterPhotos(raw: unknown, existantes: string[], salon_id: string, lx_id: string): Promise<string[] | undefined> {
  if (!Array.isArray(raw)) return undefined;
  const out: string[] = [];
  for (const p of raw.slice(0, 3)) {
    if (typeof p !== "string") continue;
    if (p.startsWith(PHOTO_PREFIX) && existantes.includes(p)) { out.push(p); continue; }
    const m = p.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) continue;
    const bin = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    if (bin.length > 1048576) continue;
    const ext = m[1] === "image/png" ? "png" : m[1] === "image/webp" ? "webp" : "jpg";
    const path = `${salon_id}/${lx_id}/${crypto.randomUUID()}.${ext}`;
    const { error } = await sb.storage.from("avis-photos").upload(path, bin, { contentType: m[1], upsert: false });
    if (error) { await (globalThis as any).__lxReport?.("Upload photo avis échec: " + error.message, "warning"); continue; }
    out.push(PHOTO_PREFIX + path);
  }
  const retirees = existantes.filter((u) => !out.includes(u) && u.startsWith(PHOTO_PREFIX)).map((u) => u.slice(PHOTO_PREFIX.length));
  if (retirees.length) { try { await sb.storage.from("avis-photos").remove(retirees); } catch (_) {} }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body) return json(400, { error: "Body JSON requis" });
    if (!body.session_token) return json(401, { error: "Compte Luxyra requis pour laisser un avis" });
    const session = await verifySession(String(body.session_token));
    if (!session) return json(401, { error: "Session invalide ou expirée — reconnectez-vous" });
    const lx_id = session.lx_id;
    const note = Math.round(Number(body.note));
    if (!Number.isFinite(note) || note < 1 || note > 5) return json(400, { error: "note doit être entre 1 et 5" });
    const texte = String(body.texte || "").trim();
    if (texte.length > 2000) return json(400, { error: "Texte trop long (2000 caractères max)" });
    const crit: Record<string, number | null> = {};
    for (const k of CRITERES) { const v = Math.round(Number(body["note_" + k])); crit["note_" + k] = (Number.isFinite(v) && v >= 1 && v <= 5) ? v : null; }
    const { data: lxUser } = await sb.from("clients_luxyra").select("id, email, nom, prenom").eq("id", lx_id).maybeSingle();
    if (!lxUser) return json(404, { error: "Compte Luxyra introuvable" });
    // 2026-10-14 : email utilisable pour le rattachement SEULEMENT s'il est vérifié
    const realEmail = session.email_verified ? String(lxUser.email || "").toLowerCase().trim() : "";
    const rdv_id = body.rdv_online_id ? String(body.rdv_online_id) : "";
    const ticket_id = body.ticket_id ? String(body.ticket_id) : "";
    if (!rdv_id && !ticket_id) return json(400, { error: "Une preuve de visite est requise (rdv_online_id ou ticket_id)" });
    let salon_id: string | null = null;
    let validated_rdv_id: string | null = null;
    let validated_ticket_id: string | null = null;
    let validated_appointment_id: string | null = null;
    if (rdv_id) {
      const { data: rdv } = await sb.from("rdv_online").select("id, salon_id, client_luxyra_id, status").eq("id", rdv_id).maybeSingle();
      if (!rdv) return json(404, { error: "RDV introuvable" });
      if (String(rdv.client_luxyra_id || "") !== lx_id) return json(403, { error: "Ce RDV n'est pas lié à votre compte" });
      const status = String(rdv.status || "").toLowerCase();
      if (!HONORED_STATUSES.has(status)) return json(400, { error: "Vous ne pouvez laisser un avis qu'après un RDV honoré (statut actuel : " + status + ")" });
      salon_id = rdv.salon_id;
      validated_rdv_id = rdv.id;
    } else {
      const { data: ap } = await sb.from("appointments").select("id, salon_id, client_id, client_email, status, cancelled").eq("id", ticket_id).maybeSingle();
      if (ap) {
        if (ap.cancelled === true) return json(400, { error: "Ce ticket a été annulé" });
        const apStatus = String(ap.status || "").toLowerCase();
        if (CANCELLED_STATUSES.has(apStatus)) return json(400, { error: "Ce ticket a été annulé" });
        let validIdentity = false;
        if (realEmail && ap.client_email && String(ap.client_email).toLowerCase().trim() === realEmail) validIdentity = true;
        else if (ap.client_id) {
          const { data: cli } = await sb.from("clients").select("email, client_luxyra_id").eq("id", ap.client_id).maybeSingle();
          if (cli) {
            if (realEmail && cli.email && String(cli.email).toLowerCase().trim() === realEmail) validIdentity = true;
            else if (String(cli.client_luxyra_id || "") === lx_id) validIdentity = true;
          }
        }
        if (!validIdentity) return json(403, { error: session.email_verified ? "Ce ticket n'est pas lié à votre compte" : "Confirmez d'abord votre adresse email (lien envoyé à l'inscription) pour retrouver ce ticket." });
        salon_id = ap.salon_id;
        validated_appointment_id = ap.id;
      } else {
        const { data: tk } = await sb.from("tickets").select("id, salon_id, client_id, status").eq("id", ticket_id).maybeSingle();
        if (!tk) return json(404, { error: "Ticket introuvable" });
        const tkStatus = String(tk.status || "").toLowerCase();
        if (CANCELLED_STATUSES.has(tkStatus)) return json(400, { error: "Ce ticket a été annulé" });
        if (!tk.client_id) return json(403, { error: "Ce ticket n'est associé à aucun client" });
        const { data: cli } = await sb.from("clients").select("id, email, client_luxyra_id").eq("id", tk.client_id).maybeSingle();
        if (!cli) return json(403, { error: "Ce ticket n'est pas lié à votre compte" });
        const parId = String(cli.client_luxyra_id || "") === lx_id;
        const parEmail = !!realEmail && !!cli.email && String(cli.email).toLowerCase().trim() === realEmail;
        if (!parId && !parEmail) return json(403, { error: session.email_verified ? "Ce ticket n'est pas lié à votre compte" : "Confirmez d'abord votre adresse email (lien envoyé à l'inscription) pour retrouver ce ticket." });
        salon_id = tk.salon_id;
        validated_ticket_id = tk.id;
      }
    }
    const prenom = lxUser.prenom ? String(lxUser.prenom).trim() : "Client";
    const lastInit = lxUser.nom ? String(lxUser.nom).trim().charAt(0).toUpperCase() : "";
    const displayName = lastInit ? `${prenom} ${lastInit}.` : prenom;
    const { data: existing } = await sb.from("avis_salon").select("id, salon_reply, flag_reason, photos, reported, hidden_by_luxyra").eq("salon_id", salon_id).eq("client_luxyra_id", lx_id).maybeSingle();
    // 2026-10-14 audit site : avis en modération -> pas de modification (ni de nouvel avis pour ce salon)
    if (existing && (existing.reported === true || existing.hidden_by_luxyra === true)) {
      return json(409, { error: "Votre avis sur cet établissement est en cours de vérification : il ne peut pas être modifié pour le moment." });
    }
    const photos = await traiterPhotos(body.photos, (existing?.photos as string[]) || [], String(salon_id), lx_id);
    if (existing) {
      const patch: Record<string, unknown> = { note, texte, nom: displayName, salon_reply: null, salon_reply_at: null, flag_reason: null, flagged_at: null, ...crit };
      if (photos !== undefined) patch.photos = photos;
      if (validated_rdv_id) patch.rdv_online_id = validated_rdv_id;
      if (validated_ticket_id) patch.ticket_id = validated_ticket_id;
      if (validated_appointment_id) patch.appointment_id = validated_appointment_id;
      const { data: updated, error: updErr } = await sb.from("avis_salon").update(patch).eq("id", existing.id).select(SELECT_AVIS).single();
      if (updErr) { await (globalThis as any).__lxReport?.("Update avis_salon échec: "+updErr.message, "error", undefined, { id: existing.id }); return json(500, { error: updErr.message }); }
      return json(200, { success: true, action: "updated", avis: updated });
    }
    const { data: avis, error: insErr } = await sb.from("avis_salon").insert({ salon_id, rdv_online_id: validated_rdv_id, ticket_id: validated_ticket_id, appointment_id: validated_appointment_id, client_luxyra_id: lx_id, nom: displayName, note, texte, ...crit, photos: photos || [], approved: true, reported: false, date: new Date().toISOString().slice(0, 10) }).select(SELECT_AVIS).single();
    if (insErr) { await (globalThis as any).__lxReport?.("Insert avis_salon échec: "+insErr.message, "error", undefined, { salon_id, lx_id }); return json(500, { error: insErr.message }); }
    return json(200, { success: true, action: "created", avis });
  } catch (e) {
    console.error("avis-create unexpected", e);
    return json(500, { error: String((e as Error)?.message || e) });
  }
});
