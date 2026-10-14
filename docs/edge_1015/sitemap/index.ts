// sitemap v18 (2026-10-15) — index de sitemaps + sitemaps enfants.
//   ?part=index               -> <sitemapindex> (servi par le worker sur /sitemap.xml)
//   ?part=pages               -> pages du site (accueil, pro, tarifs, logiciel-*, blog, légal)  (/sitemap-pages.xml)
//   ?part=salons              -> pages publiques des établissements /<slug>                      (/sitemap-salons.xml)
//   ?part=annuaire-<métier>   -> /<métier> + /<métier>/<ville> (annuaire « Métier à Ville »)      (/sitemap-annuaire-<métier>.xml)
//   (sans part)               -> ancien format : un seul <urlset> complet (compatibilité avec l'ancien worker)
// Règles (alignées sur le worker, docs/luxyra-router-worker.js) :
//   - établissements : vue salons_public (Pro / essai en cours, non fermés), site_actif ≠ false, slug valide et non réservé.
//     /<slug>/reserver N'EST PAS listé : sa balise canonical pointe vers /<slug>.
//   - annuaire : mêmes RPC que les pages SSR (annuaire_villes2 = non masqué, retraits exclus, doublons Luxyra exclus,
//     sites désactivés exclus) ; une ville n'est listée que si sa page répond 200 (≥ 1 établissement).
//     Seuls les métiers servis par le worker (LX_ANN_METIERS) existent : coiffeur, institut-de-beaute, spa-massage,
//     onglerie, extension-de-cils, barbier (pas de page maquillage / tatouage-piercing).
//   - /aide/* : NON listé (noindex, réservé à l'appli pro — décision du 13/10/2026, CLAUDE.md « Centre d'aide »).
//   - pages app / admin / compte / démo technique / acompte / proposal / reset / clear : jamais listées.
// En cas d'erreur : 503 (Google garde la version précédente) — jamais un sitemap tronqué servi en 200.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const BASE = "https://luxyra.fr";
{ const _LX_FN="sitemap"; const _LX_URL=Deno.env.get("SB_URL")||Deno.env.get("SUPABASE_URL")||""; const _LX_SR=Deno.env.get("SB_SERVICE_ROLE")||Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||""; const _lxReport=async(msg:string,sev:"warning"|"error"|"critical",err?:unknown,ctx?:Record<string,unknown>)=>{try{await fetch(_LX_URL+"/rest/v1/rpc/report_server_error",{method:"POST",headers:{"Content-Type":"application/json","apikey":_LX_SR,"Authorization":"Bearer "+_LX_SR},body:JSON.stringify({p_source:"edge_fn:"+_LX_FN,p_message:String(msg||"").slice(0,800),p_severity:sev,p_stack:(err as Error)?.stack?String((err as Error).stack).slice(0,3000):null,p_context:ctx||null})});}catch(_){}}; (globalThis as any).__lxReport=_lxReport; const _orig=Deno.serve; (Deno as any).serve=(handler:any,opts?:any)=>_orig(async(req:Request)=>{try{const res=await handler(req); if(res&&res.status>=500){const body=await res.clone().text().catch(()=>""); await _lxReport("HTTP "+res.status,"error",undefined,{url:req.url,body:body.slice(0,500)});} return res;}catch(e){const err=e as Error; await _lxReport("Exception non gérée: "+(err?.message||String(e)),"critical",err,{url:req.url}); return new Response(JSON.stringify({error:"Internal server error"}),{status:500,headers:{"Content-Type":"application/json"}});}}, opts); }

// ---------------------------------------------------------------------------
// Pages statiques indexables (aucune n'a de noindex ; canonical = cette URL).
// lastmod = date du dernier commit du fichier HTML — À METTRE À JOUR quand une page change.
// ---------------------------------------------------------------------------
const STATIC_PAGES: { loc: string; lastmod: string }[] = [
  { loc: "/", lastmod: "2026-10-14" },
  { loc: "/recherche", lastmod: "2026-10-14" },
  { loc: "/pro", lastmod: "2026-10-13" },
  { loc: "/tarifs", lastmod: "2026-10-13" },
  { loc: "/demo", lastmod: "2026-10-13" },
  { loc: "/logiciel-coiffure", lastmod: "2026-10-13" },
  { loc: "/logiciel-barbier", lastmod: "2026-10-13" },
  { loc: "/logiciel-institut-beaute", lastmod: "2026-10-13" },
  { loc: "/logiciel-onglerie", lastmod: "2026-10-13" },
  { loc: "/logiciel-cils-sourcils", lastmod: "2026-10-13" },
  { loc: "/logiciel-maquilleuse", lastmod: "2026-10-13" },
  { loc: "/logiciel-tatouage-piercing", lastmod: "2026-10-13" },
  { loc: "/logiciel-spa-massage", lastmod: "2026-10-13" },
  { loc: "/logiciel-bien-etre", lastmod: "2026-10-13" },
  { loc: "/sans-commission", lastmod: "2026-10-11" },
  { loc: "/inscription", lastmod: "2026-10-14" },
  { loc: "/migration", lastmod: "2026-10-13" },
  { loc: "/securite-rgpd", lastmod: "2026-10-11" },
  { loc: "/verif-nf525", lastmod: "2026-10-13" },
  { loc: "/a-propos", lastmod: "2026-10-12" },
  { loc: "/blog", lastmod: "2026-10-12" },
  { loc: "/blog/prestations-a-domicile-frais-de-deplacement", lastmod: "2026-10-12" },
  { loc: "/blog/acompte-arrhes-empreinte-bancaire", lastmod: "2026-10-12" },
  { loc: "/blog/micro-entreprise-ou-societe-caisse-et-comptabilite", lastmod: "2026-10-11" },
  { loc: "/blog/comment-choisir-logiciel-caisse-coiffeur", lastmod: "2026-10-10" },
  { loc: "/blog/nf525-explique-ce-que-tout-salon-doit-savoir", lastmod: "2026-10-10" },
  { loc: "/blog/reservation-en-ligne-sans-commission", lastmod: "2026-10-10" },
  { loc: "/cgv", lastmod: "2026-10-12" },
  { loc: "/mentions-legales", lastmod: "2026-10-13" },
  { loc: "/politique-confidentialite", lastmod: "2026-10-14" },
  { loc: "/dpa", lastmod: "2026-10-11" },
  { loc: "/suppression-donnees", lastmod: "2026-10-14" },
];

// Annuaire : copie de LX_ANN_METIERS du worker (page, source Sirene, motif d'enseigne, métiers Luxyra).
const ANNUAIRE: { page: string; source: string; motif: string | null; lx: string[] }[] = [
  { page: "coiffeur", source: "coiffeur", motif: null, lx: ["coiffure", "barbier"] },
  { page: "institut-de-beaute", source: "institut-de-beaute", motif: null, lx: ["esthetique", "ongles", "regard", "maquillage"] },
  { page: "spa-massage", source: "spa-massage", motif: null, lx: ["spa", "bien_etre"] },
  { page: "onglerie", source: "institut-de-beaute", motif: "ongl|nail|manucur|vernis", lx: ["ongles"] },
  { page: "extension-de-cils", source: "institut-de-beaute", motif: "cil|lash|regard|sourcil|brow", lx: ["regard"] },
  { page: "barbier", source: "coiffeur", motif: "barb", lx: ["barbier"] },
];
// Date du dernier changement du gabarit des pages annuaire dans le worker (plancher du lastmod).
const ANNUAIRE_GABARIT = "2026-10-14";

// Copie de RESERVED_FOR_SLUG du worker : ces adresses ne sont jamais des pages d'établissement.
const RESERVED = new Set([
  "", "app", "admin", "compte", "inscription", "pro", "recherche", "proposal", "cgv", "mentions", "mentions-legales",
  "confidentialite", "politique-confidentialite", "suppression-donnees", "dpa", "reset-password", "site", "index", "home",
  "verif-nf525", "tarifs", "sans-commission", "a-propos", "about", "securite-rgpd", "securite", "rgpd", "blog", "aide",
  "migration", "preview-email-confirmation", "clear", "coiffeur", "institut-de-beaute", "spa-massage", "onglerie",
  "extension-de-cils", "barbier", "annuaire-retrait", "annuaire-gerant", "annuaire-retrait-confirmer",
  "logiciel-coiffure", "logiciel-barbier", "logiciel-institut-beaute", "logiciel-onglerie", "logiciel-cils-sourcils",
  "logiciel-maquilleuse", "logiciel-tatouage-piercing", "logiciel-spa-massage", "logiciel-bien-etre", "demo",
]);
const SLUG_OK = /^[a-z0-9][a-z0-9-]{1,79}$/;
const VILLE_OK = /^[a-z0-9-]{2,80}$/;

// Même calcul que lxAnnSlug() du worker (sert à vérifier qu'une ville « Luxyra seulement » s'affiche bien).
function jsSlug(s: string): string {
  return String(s || "").replace(/œ/gi, "oe").replace(/æ/gi, "ae").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/['’]/g, "-").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
// Même calcul que public.lx_slug_ville() (clé de regroupement de annuaire_villes2).
function sqlSlug(p: string): string {
  const from = "éèêëàâäáãîïíìôöóòõûüúùçñÿÉÈÊËÀÂÄÁÃÎÏÍÌÔÖÓÒÕÛÜÚÙÇÑŸ";
  const to = "eeeeaaaaaiiiiooooouuuucnyEEEEAAAAAIIIIOOOOOUUUUCNY";
  let s = String(p || "").replace(/Œ/g, "Oe").replace(/œ/g, "oe").replace(/Æ/g, "Ae").replace(/æ/g, "ae");
  s = Array.from(s).map((c) => { const i = from.indexOf(c); return i >= 0 ? to[i] : c; }).join("");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function esc(s: string): string {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
const day = (v: unknown): string | null => (v ? String(v).slice(0, 10) : null);
const maxDay = (...d: (string | null | undefined)[]): string | null =>
  d.filter((x): x is string => !!x && /^\d{4}-\d{2}-\d{2}$/.test(x)).sort().pop() || null;

type U = { loc: string; lastmod?: string | null };
function urlset(urls: U[]): string {
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const u of urls) x += `  <url><loc>${esc(u.loc)}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ""}</url>\n`;
  return x + "</urlset>\n";
}
function sitemapindex(maps: U[]): string {
  let x = '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  for (const m of maps) x += `  <sitemap><loc>${esc(m.loc)}</loc>${m.lastmod ? `<lastmod>${m.lastmod}</lastmod>` : ""}</sitemap>\n`;
  return x + "</sitemapindex>\n";
}

// ---------------------------------------------------------------------------
// Données
// ---------------------------------------------------------------------------
type Salon = { id: string; slug: string; ville: string | null; metier: string | null; metiers_autres: string[] | null; lastmod: string | null };
let _salons: Promise<Salon[]> | null = null;
function salonsPublics(): Promise<Salon[]> {
  if (_salons) return _salons;
  _salons = (async () => {
    const { data: pub, error: e1 } = await sb.from("salons_public").select("id, slug, ville, metier, metiers_autres").limit(10000);
    if (e1) throw new Error("salons_public: " + e1.message);
    const { data: off, error: e2 } = await sb.from("site_config").select("salon_id").eq("site_actif", false).limit(10000);
    if (e2) throw new Error("site_config: " + e2.message);
    const offSet = new Set((off || []).map((x: any) => x.salon_id));
    const ok = (pub || []).filter((s: any) => s.slug && !offSet.has(s.id));
    const ids = ok.map((s: any) => s.id);
    const ts = new Map<string, string | null>();
    if (ids.length) {
      const [{ data: sal }, { data: cfg }] = await Promise.all([
        sb.from("salons").select("id, updated_at").in("id", ids),
        sb.from("site_config").select("salon_id, updated_at").in("salon_id", ids),
      ]);
      for (const s of sal || []) ts.set((s as any).id, day((s as any).updated_at));
      for (const c of cfg || []) ts.set((c as any).salon_id, maxDay(ts.get((c as any).salon_id), day((c as any).updated_at)));
    }
    return ok.map((s: any) => ({ id: s.id, slug: s.slug, ville: s.ville, metier: s.metier, metiers_autres: s.metiers_autres, lastmod: ts.get(s.id) || null }));
  })();
  return _salons;
}

// Lignes visibles de l'annuaire (pour le lastmod par ville), paginées par 1000.
let _ann: Promise<Map<string, { nom: string; ville_slug: string; importe_le: string | null }[]>> | null = null;
function annuaireLignes() {
  if (_ann) return _ann;
  _ann = (async () => {
    const parSource = new Map<string, { nom: string; ville_slug: string; importe_le: string | null }[]>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await sb.from("annuaire_etablissements")
        .select("siret, metier, nom, ville_slug, importe_le").eq("masque", false).order("siret").range(from, from + 999);
      if (error) throw new Error("annuaire_etablissements: " + error.message);
      for (const r of data || []) {
        const a = parSource.get((r as any).metier) || [];
        a.push({ nom: (r as any).nom || "", ville_slug: (r as any).ville_slug, importe_le: day((r as any).importe_le) });
        parSource.set((r as any).metier, a);
      }
      if (!data || data.length < 1000) break;
    }
    return parSource;
  })();
  return _ann;
}

async function urlsPages(): Promise<U[]> {
  return STATIC_PAGES.map((p) => ({ loc: BASE + p.loc, lastmod: p.lastmod }));
}

async function urlsSalons(): Promise<U[]> {
  const salons = await salonsPublics();
  return salons
    .filter((s) => SLUG_OK.test(s.slug) && !RESERVED.has(s.slug))
    .sort((a, b) => a.slug.localeCompare(b.slug))
    .map((s) => ({ loc: `${BASE}/${s.slug}`, lastmod: s.lastmod }));
}

async function urlsAnnuaire(page: string): Promise<U[]> {
  const M = ANNUAIRE.find((m) => m.page === page);
  if (!M) return [];
  const { data: villes, error } = await sb.rpc("annuaire_villes2", { p_source: M.source, p_motif: M.motif, p_lx: M.lx });
  if (error) throw new Error(`annuaire_villes2(${page}): ${error.message}`);
  if (!villes || !villes.length) return []; // /<métier> répond 404 + noindex quand il n'y a aucune ville
  // Établissements Luxyra de ce métier (même filtre que la vue + le worker)
  const lx = (await salonsPublics()).filter((s) => s.ville && ((s.metier && M.lx.includes(s.metier)) || (s.metiers_autres || []).some((m) => M.lx.includes(m))));
  const lxParSql = new Map<string, number>();
  const lxParJs = new Map<string, string | null>();
  for (const s of lx) {
    const k = sqlSlug(s.ville!);
    lxParSql.set(k, (lxParSql.get(k) || 0) + 1);
    const j = jsSlug(s.ville!);
    lxParJs.set(j, maxDay(lxParJs.get(j), s.lastmod));
  }
  // lastmod par ville : plus récent import Sirene visible (avec le motif d'enseigne) / établissement Luxyra / gabarit
  const re = M.motif ? new RegExp(M.motif, "i") : null;
  const impParVille = new Map<string, string | null>();
  for (const r of (await annuaireLignes()).get(M.source) || []) {
    if (re && !re.test(r.nom)) continue;
    impParVille.set(r.ville_slug, maxDay(impParVille.get(r.ville_slug), r.importe_le));
  }
  const urls: U[] = [];
  let maxAll: string | null = ANNUAIRE_GABARIT;
  for (const v of villes as any[]) {
    const vs = String(v.ville_slug || "");
    if (!VILLE_OK.test(vs)) continue; // le worker ne route pas ces adresses
    const nSirene = Number(v.n || 0) - (lxParSql.get(vs) || 0);
    // Ville « Luxyra seulement » : la page SSR compare lxAnnSlug(ville) ; on vérifie qu'elle trouvera l'établissement.
    if (nSirene <= 0 && !lxParJs.has(vs)) continue;
    const lm = maxDay(ANNUAIRE_GABARIT, impParVille.get(vs), lxParJs.get(vs));
    maxAll = maxDay(maxAll, lm);
    urls.push({ loc: `${BASE}/${page}/${vs}`, lastmod: lm });
  }
  if (!urls.length) return [];
  urls.unshift({ loc: `${BASE}/${page}`, lastmod: maxAll });
  return urls;
}

const lastOf = (u: U[]) => maxDay(...u.map((x) => x.lastmod));

async function index(): Promise<string> {
  const [pages, salons, ...ann] = await Promise.all([urlsPages(), urlsSalons(), ...ANNUAIRE.map((m) => urlsAnnuaire(m.page))]);
  const maps: U[] = [{ loc: `${BASE}/sitemap-pages.xml`, lastmod: lastOf(pages) }];
  if (salons.length) maps.push({ loc: `${BASE}/sitemap-salons.xml`, lastmod: lastOf(salons) });
  ANNUAIRE.forEach((m, i) => { if (ann[i].length) maps.push({ loc: `${BASE}/sitemap-annuaire-${m.page}.xml`, lastmod: lastOf(ann[i]) }); });
  return sitemapindex(maps);
}

const HEADERS = {
  "Content-Type": "application/xml; charset=utf-8",
  "Cache-Control": "public, max-age=3600, s-maxage=3600",
  "X-Robots-Tag": "noindex",
  "Access-Control-Allow-Origin": "*",
};

Deno.serve(async (req) => {
  _salons = null; _ann = null; // une lecture fraîche par requête (l'isolat peut être réutilisé)
  const part = new URL(req.url).searchParams.get("part") || "";
  try {
    let xml: string;
    if (part === "index") xml = await index();
    else if (part === "pages") xml = urlset(await urlsPages());
    else if (part === "salons") xml = urlset(await urlsSalons());
    else if (part.startsWith("annuaire-")) {
      const page = part.slice("annuaire-".length);
      if (!ANNUAIRE.some((m) => m.page === page)) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
      const urls = await urlsAnnuaire(page);
      if (!urls.length) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
      xml = urlset(urls);
    } else if (part === "") {
      // Ancien format (worker non mis à jour) : tout dans un seul <urlset> (< 50 000 URL / 10 Mo à ce jour)
      const all = [await urlsPages(), await urlsSalons()];
      for (const m of ANNUAIRE) all.push(await urlsAnnuaire(m.page));
      xml = urlset(all.flat());
    } else {
      return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain" } });
    }
    return new Response(xml, { status: 200, headers: HEADERS });
  } catch (e) {
    await (globalThis as any).__lxReport?.("sitemap exception (" + part + "): " + ((e as Error)?.message || String(e)), "error", e);
    // 503 : Google réessaie et garde la version précédente (un sitemap partiel en 200 ferait « disparaître » des URL)
    return new Response("Sitemap temporairement indisponible", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Retry-After": "600", "Cache-Control": "no-store" } });
  }
});
