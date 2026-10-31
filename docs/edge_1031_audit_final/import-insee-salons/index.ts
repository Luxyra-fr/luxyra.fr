// import-insee-salons v4 — 2026-10-31 audit final : contrôle admin par la base (rpc is_admin avec le jeton de
// l'utilisateur : support@luxyra.fr + double authentification + session < 12 h). Plus de repli sur une adresse e-mail en dur.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR  = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const APE_TO_METIER: Record<string, string> = { "9602A":"coiffure","96.02A":"coiffure","9602B":"esthetique","96.02B":"esthetique" };
const APE_LABELS: Record<string, string> = { "9602A":"Coiffure","96.02A":"Coiffure","9602B":"Soins de beauté","96.02B":"Soins de beauté" };
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
function json(s:number,b:unknown){return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}});}
async function lxEstAdmin(jwt: string): Promise<boolean> {
  try {
    const r = await fetch(SB_URL + "/rest/v1/rpc/is_admin", { method: "POST", headers: { apikey: SB_ANON || SB_SR, Authorization: "Bearer " + jwt, "Content-Type": "application/json" }, body: "{}" });
    return r.ok && (await r.json()) === true;
  } catch (_) { return false; }
}
{ const _LX_FN="import-insee-salons"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }
function slugify(s: string): string { return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80); }
function normalizeNom(nom: string): string { return String(nom || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim(); }
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const authHeader = req.headers.get("authorization") || "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "");
  if (!jwt) return json(401, { error: "Missing JWT" });
  const { data: { user }, error: authErr } = await sb.auth.getUser(jwt);
  if (authErr || !user) return json(401, { error: "Invalid JWT" });
  if (!(await lxEstAdmin(jwt))) return json(403, { error: "Admin only" });
  const body = await req.json().catch(() => null);
  if (!body) return json(400, { error: "Invalid JSON body" });
  const departement = String(body.departement || "").padStart(2, "0");
  const metiers: string[] = Array.isArray(body.metiers) && body.metiers.length ? body.metiers : ["coiffure"];
  const dryRun = body.dry_run === true;
  const limit = Number(body.limit || 5000);
  if (!/^\d{2,3}$/.test(departement)) return json(400, { error: "departement invalide (ex: '57')" });
  const apeCodes = metiers.includes("coiffure") ? ["96.02A"] : [];
  if (metiers.includes("esthetique")) apeCodes.push("96.02B");
  if (!apeCodes.length) return json(400, { error: "metiers requis (coiffure/esthetique)" });
  const inserted: string[] = []; const updated: string[] = []; const skipped: string[] = []; const errors: { siret: string; error: string }[] = []; let totalScanned = 0;
  for (const ape of apeCodes) {
    let page = 1; let stop = false;
    while (!stop && totalScanned < limit) {
      const url = `https://recherche-entreprises.api.gouv.fr/search?activite_principale=${encodeURIComponent(ape)}&departement=${encodeURIComponent(departement)}&etat_administratif=A&page=${page}&per_page=25`;
      let r: Response;
      try { r = await fetch(url, { headers: { "Accept": "application/json" } }); } catch (e) { errors.push({ siret: "-", error: "Network error: " + (e as Error).message }); break; }
      if (!r.ok) { const txt = await r.text(); errors.push({ siret: "-", error: `API ${r.status}: ${txt.slice(0, 200)}` }); break; }
      const data = await r.json();
      const results = Array.isArray(data?.results) ? data.results : [];
      if (!results.length) { stop = true; break; }
      for (const ent of results) {
        totalScanned++;
        const siret = String(ent?.siege?.siret || "");
        if (!siret) { skipped.push("no-siret"); continue; }
        const nomEnt = String(ent?.nom_complet || ent?.nom_raison_sociale || "").trim();
        if (!nomEnt) { skipped.push(siret); continue; }
        const siege = ent.siege || {};
        const adresseNum = siege.numero_voie || "";
        const adresseVoie = [siege.type_voie, siege.libelle_voie].filter(Boolean).join(" ");
        const adresseComplete = [adresseNum, adresseVoie].filter(Boolean).join(" ").trim();
        const cp = siege.code_postal || "";
        const ville = (siege.libelle_commune || "").trim();
        const apeCode = ent.activite_principale || ape;
        const metier = APE_TO_METIER[apeCode] || "coiffure";
        const apeLabel = APE_LABELS[apeCode] || "Salon";
        const dirigeants = Array.isArray(ent.dirigeants) ? ent.dirigeants : [];
        const dir = dirigeants[0] || {};
        const dirNom = (dir.nom || "").trim() || null;
        const dirPrenom = (dir.prenoms || "").trim() || null;
        const villeSlug = slugify(ville);
        let slug = `${slugify(nomEnt)}-${villeSlug}`;
        if (slug.length > 60) slug = slug.slice(0, 60);
        if (slug.length < 3) slug = `salon-${siret}`;
        const existsBySlug = await sb.from("salons_pending").select("siret").eq("slug", slug).maybeSingle();
        if (existsBySlug.data && existsBySlug.data.siret !== siret) slug = `${slug}-${departement}`;
        const row = { siret, siren: siret.slice(0, 9), nom: nomEnt, nom_norm: normalizeNom(nomEnt), slug, ville_slug: villeSlug, adresse: adresseComplete || null, adresse_num: adresseNum || null, adresse_voie: adresseVoie || null, cp: cp || null, ville: ville || null, departement, region: ent.region || null, latitude: siege.latitude ? Number(siege.latitude) : null, longitude: siege.longitude ? Number(siege.longitude) : null, ape_code: apeCode, ape_label: apeLabel, metier, date_creation: ent.date_creation || null, dirigeant_nom: dirNom, dirigeant_prenom: dirPrenom, status: "draft", data_source: "INSEE-SIRENE", raw_data: dryRun ? null : ent };
        if (dryRun) { inserted.push(`[DRY] ${siret} ${nomEnt} ${ville}`); continue; }
        const existing = await sb.from("salons_pending").select("id, status").eq("siret", siret).maybeSingle();
        if (existing.data) {
          if (existing.data.status === "claimed" || existing.data.status === "deleted_rgpd") { skipped.push(siret); continue; }
          const upd = await sb.from("salons_pending").update({ ...row, last_refreshed_at: new Date().toISOString() }).eq("siret", siret);
          if (upd.error) errors.push({ siret, error: upd.error.message });
          else updated.push(siret);
        } else {
          const ins = await sb.from("salons_pending").insert(row);
          if (ins.error) errors.push({ siret, error: ins.error.message });
          else inserted.push(siret);
        }
      }
      if (results.length < 25) stop = true; else page++;
      await new Promise(r => setTimeout(r, 150));
    }
  }
  return json(200, { ok: true, departement, metiers, dry_run: dryRun, scanned: totalScanned, inserted_count: inserted.length, updated_count: updated.length, skipped_count: skipped.length, error_count: errors.length, samples: { inserted: inserted.slice(0, 5), errors: errors.slice(0, 5) } });
});
