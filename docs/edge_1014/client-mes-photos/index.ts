// client-mes-photos v7 — 2026-10-14 SECURITE : jeton client refusé si la version de session a changé
//   (mot de passe changé / réinitialisé sur un autre appareil, compte supprimé).
// client-mes-photos v4 — SECURITE 2026-10-07 : rattachement UNIQUEMENT par client_luxyra_id
// (avant : filtre .or() construit avec l'email/telephone du compte, non verifies et modifiables
// -> injection de filtre et acces aux photos d'autres clientes).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verify as jwtVerify } from "https://deno.land/x/djwt@v3.0.2/mod.ts";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LX_SECRET = Deno.env.get("LX_SESSION_SECRET") || Deno.env.get("BP_SESSION_SECRET") || SB_SR;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
{ const _LX_FN="client-mes-photos"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function verifySession(token: string): Promise<{ lx_id: string; email: string } | null> {
  if (!token) return null;
  try {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(LX_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign","verify"]);
    const payload = await jwtVerify(token, key);
    if (!payload) return null;
    const id = String((payload as any).lx_id || (payload as any).bp_id || "");
    if (!UUID_RE.test(id)) return null;
    const { data: row } = await sb.from("clients_luxyra").select("id, email, session_version").eq("id", id).maybeSingle();
    if (!row) return null;
    if ((Number((payload as any).sv ?? 0) || 0) !== (Number(row.session_version) || 0)) return null;
    return { lx_id: String(row.id), email: String(row.email || "") };
  } catch { return null; }
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  try {
    const body = await req.json().catch(() => null);
    if (!body || !body.session_token) return json(401, { error: "session_token requis" });
    const session = await verifySession(String(body.session_token));
    if (!session) return json(401, { error: "Session invalide ou expirée" });
    const clientLx = { id: session.lx_id };
    // Seules les fiches salon explicitement rattachees a CE compte (lien pose par le salon / a l'inscription).
    const { data: clientRecords } = await sb.from("clients").select("id, salon_id, fiches, fiche_tech").eq("client_luxyra_id", clientLx.id);
    if (!clientRecords || !clientRecords.length) return json(200, { salons: [] });
    const salonIds = [...new Set(clientRecords.map((r) => r.salon_id))];
    const { data: sites } = await sb.from("site_config").select("salon_id, photos_visible_client").in("salon_id", salonIds);
    const visibleMap: Record<string, boolean> = {};
    (sites || []).forEach((s) => { visibleMap[s.salon_id] = s.photos_visible_client === true; });
    const { data: salonInfos } = await sb.from("salons").select("id, nom, logo").in("id", salonIds);
    const salonInfoMap: Record<string, any> = {};
    (salonInfos || []).forEach((s) => { salonInfoMap[s.id] = s; });
    const result: any[] = [];
    for (const rec of clientRecords) {
      if (!visibleMap[rec.salon_id]) continue;
      const photos = (rec.fiche_tech && rec.fiche_tech.photos) || (rec as any).photos || [];
      const visiblePhotos = photos.filter((p: any) => p.private !== true);
      if (!visiblePhotos.length) continue;
      const enriched = await Promise.all(visiblePhotos.map(async (p: any) => {
        let signedUrl = p.data || "";
        if (p.path && !signedUrl) { try { const signed = await sb.storage.from("client-photos").createSignedUrl(p.path, 3600); signedUrl = signed.data?.signedUrl || ""; } catch { signedUrl = ""; } }
        return { date: p.date || null, label: p.label || null, note: p.note || null, signed_url: signedUrl };
      }));
      const enrichedFiltered = enriched.filter((p) => p.signed_url);
      if (!enrichedFiltered.length) continue;
      result.push({ salon_id: rec.salon_id, salon_nom: salonInfoMap[rec.salon_id]?.nom || "Salon", salon_logo: salonInfoMap[rec.salon_id]?.logo || null, photos: enrichedFiltered.sort((a, b) => (b.date || "").localeCompare(a.date || "")) });
    }
    return json(200, { salons: result });
  } catch (e) {
    console.error("client-mes-photos unexpected", e);
    return json(500, { error: "Erreur interne" });
  }
});
