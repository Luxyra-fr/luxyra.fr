// nf525-sign v1 — 2026-10-11 — Signature électronique asymétrique (ECDSA P-256 / SHA-256, « ES256 ») des données
// fiscales, chaînée par établissement et par type (référentiel NF525 v2.3) :
//   TK (tickets), Z (clôtures journalières), ZM / ZA (mensuelles / annuelles), ZE (exercice),
//   CR (corrections de règlement), DUP (duplicatas), JET (journal des événements techniques).
// Données signées = champs séparés par des virgules + signature précédente du même type (chaînage).
// Signature brute r||s (64 octets) encodée en base64url. Clé privée générée ici, stockée dans Vault,
// jamais exposée ; clé publique dans nf525_cles (lecture libre) pour l'outil de vérification.
// Appels : cron (x-cron-secret) => tous les établissements ; application (JWT du titulaire) => son établissement.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SB_URL = Deno.env.get("SB_URL") || Deno.env.get("SUPABASE_URL")!;
const SB_SR = Deno.env.get("SB_SERVICE_ROLE") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY") || "";
const CRON = Deno.env.get("AVIS_CRON_SECRET") || "";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (s: number, b: unknown) => new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const CAISSE = "C01";

function b64url(u8: Uint8Array): string { let s = ""; u8.forEach((b) => s += String.fromCharCode(b)); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function rnd(n: number) { const a = new Uint8Array(n); crypto.getRandomValues(a); return b64url(a); }
const fmtParis = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
function ts(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso); if (isNaN(d.getTime())) return "";
  const p: Record<string, string> = {}; fmtParis.formatToParts(d).forEach((x) => p[x.type] = x.value);
  return `${p.year}${p.month}${p.day}${p.hour === "24" ? "00" : p.hour}${p.minute}${p.second}`;
}
const m2 = (n: unknown) => (Math.round((Number(n) || 0) * 100) / 100).toFixed(2);
const d8 = (d: string | null | undefined) => String(d || "").slice(0, 10).replace(/-/g, "");

let KEY: { key_id: string; priv: CryptoKey } | null = null;
async function cle() {
  if (KEY) return KEY;
  let r = await sb.rpc("nf525_cle_active");
  if (!r.data) {
    const kp = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pub = await crypto.subtle.exportKey("jwk", kp.publicKey);
    const prv = await crypto.subtle.exportKey("jwk", kp.privateKey);
    const kid = "LX-ES256-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + rnd(6);
    (pub as any).kid = kid; (prv as any).kid = kid;
    await sb.rpc("nf525_cle_creer", { p_key_id: kid, p_public_jwk: pub, p_private_jwk: JSON.stringify(prv) });
    r = await sb.rpc("nf525_cle_active");
  }
  const k: any = r.data; if (!k || !k.private_jwk) throw new Error("clé de signature indisponible");
  const priv = await crypto.subtle.importKey("jwk", k.private_jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  KEY = { key_id: k.key_id, priv }; return KEY;
}
async function signer(data: string) {
  const k = await cle();
  const sig = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, k.priv, new TextEncoder().encode(data)));
  return { sig: b64url(sig), key_id: k.key_id };
}

type Src = { type: string; table: string; order: string[]; build: (r: any, salon: string, first: boolean, prev: string) => Promise<string> | string; num?: (r: any) => number | null };
const SOURCES: Src[] = [
  { type: "TK", table: "tickets", order: ["num"], num: (r) => r.num,
    build: (r, _s, first, prev) => {
      const ttc = Number(r.total_ttc) || 0;
      const quand = r.ts_created || (r.date_ticket && r.heure_ticket ? `${r.date_ticket}T${String(r.heure_ticket).slice(0, 8)}+02:00` : r.created_at);
      return [`${m2(r.taux_tva)}:${m2(ttc)}`, m2(ttc), ts(quand), CAISSE, r.num, ttc < 0 ? "R" : "V", first ? "O" : "N", prev].join(",");
    } },
  { type: "Z", table: "clotures", order: ["num"], num: (r) => r.num,
    build: async (r, salon, first, prev) => {
      const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: r.date_cloture })).data || {};
      return [m2(r.total_ca), m2(r.total_ht), m2(gt.reel), m2(gt.absolu), ts(r.timestamp_cloture || r.created_at), d8(r.date_cloture), r.num, first ? "O" : "N", prev].join(",");
    } },
  { type: "ZM", table: "clotures_mensuelles", order: ["annee", "mois"],
    build: async (r, salon, first, prev) => {
      const fin = new Date(Date.UTC(r.annee, r.mois, 0)).toISOString().slice(0, 10);
      const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: fin })).data || {};
      const deb = `${r.annee}-${String(r.mois).padStart(2, "0")}-01`;
      return [m2(r.total_ca), m2(r.total_ht), m2(r.total_tva), m2(gt.reel), m2(gt.absolu), ts(r.created_at), d8(deb), d8(fin), first ? "O" : "N", prev].join(",");
    } },
  { type: "ZA", table: "clotures_annuelles", order: ["annee"],
    build: async (r, salon, first, prev) => {
      const fin = `${r.annee}-12-31`; const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: fin })).data || {};
      return [m2(r.total_ca), m2(r.total_ht), m2(r.total_tva), m2(gt.reel), m2(gt.absolu), ts(r.created_at), d8(`${r.annee}-01-01`), d8(fin), first ? "O" : "N", prev].join(",");
    } },
  { type: "ZE", table: "clotures_exercices", order: ["date_fin"],
    build: async (r, salon, first, prev) => {
      const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: r.date_fin })).data || {};
      return [m2(r.total_ca), m2(r.total_ht), m2(r.total_tva), m2(gt.reel), m2(gt.absolu), ts(r.created_at), d8(r.date_debut), d8(r.date_fin), first ? "O" : "N", prev].join(",");
    } },
  { type: "CR", table: "corrections_reglement", order: ["num"], num: (r) => r.num,
    build: (r, _s, first, prev) => [r.num, r.ticket_num, d8(r.ticket_date), m2(r.total_ttc_ticket), (r.lignes || []).map((l: any) => `${l.mode}:${m2(l.montant)}`).join("|"), ts(r.created_at), first ? "O" : "N", prev].join(",") },
  { type: "DUP", table: "nf525_duplicatas", order: ["seq"], num: (r) => r.seq,
    build: (r, _s, first, prev) => [r.caisse || CAISSE, r.seq, "TK", r.copie_num, String(r.operateur || "").replace(/,/g, " "), ts(r.horodatage), r.caisse || CAISSE, r.ticket_num, first ? "O" : "N", prev].join(",") },
  { type: "JET", table: "nf525_jet", order: ["seq"], num: (r) => r.seq,
    build: (r, _s, first, prev) => [r.seq, r.code, String(r.libelle || "").replace(/,/g, " "), ts(r.horodatage), String(r.operateur || "").replace(/,/g, " "), r.caisse || CAISSE, first ? "O" : "N", prev].join(",") },
];

async function signerSalon(salon: string, max = 600) {
  const ok = (await sb.rpc("nf525_verrou", { p_salon: salon, p_secondes: 120 })).data;
  if (!ok) return { salon, skipped: "verrou" };
  const out: Record<string, number> = {};
  try {
    // 1re signature de l'établissement avec cette clé -> JET 450 (mise en place / changement de clé)
    const k = await cle();
    const deja = await sb.from("nf525_signatures").select("id").eq("salon_id", salon).eq("key_id", k.key_id).limit(1);
    if (!deja.error && !(deja.data || []).length) {
      await sb.rpc("nf525_jet_ajouter", { p_salon: salon, p_code: 450, p_details: "Mise en service de la clé de signature " + k.key_id + " (ES256)", p_operateur: "Luxyra (éditeur)" });
    }
    for (const S of SOURCES) {
      let n = 0;
      const last = await sb.from("nf525_signatures").select("seq,signature,source_num").eq("salon_id", salon).eq("type", S.type).order("seq", { ascending: false }).limit(1);
      let seq = last.data && last.data[0] ? last.data[0].seq : 0;
      let prev = last.data && last.data[0] ? last.data[0].signature : "";
      const signes = new Set<string>();
      if (!S.num) { const s2 = await sb.from("nf525_signatures").select("source_id").eq("salon_id", salon).eq("type", S.type); (s2.data || []).forEach((x: any) => signes.add(x.source_id)); }
      let q = sb.from(S.table).select("*").eq("salon_id", salon);
      if (S.num && last.data && last.data[0] && last.data[0].source_num != null) q = q.gt(S.order[0], last.data[0].source_num);
      for (const o of S.order) q = q.order(o, { ascending: true });
      const rows = await q.limit(max);
      if (rows.error) { out[S.type + "_err"] = 1; continue; }
      for (const r of rows.data || []) {
        if (signes.has(r.id)) continue;
        if (S.type === "TK" && !r.hash) break; // ticket pas encore scellé : on attend (ordre strict)
        const data = await S.build(r, salon, seq === 0, prev);
        const { sig, key_id } = await signer(data);
        const ins = await sb.from("nf525_signatures").insert({ salon_id: salon, type: S.type, seq: seq + 1, source_table: S.table, source_id: r.id, source_num: S.num ? S.num(r) : null, data_to_sign: data, signature: sig, prev_signature: prev || null, algo: "ES256", key_id });
        if (ins.error) { out[S.type + "_conflit"] = 1; break; }
        seq++; prev = sig; n++;
      }
      if (n) out[S.type] = n;
    }
  } finally { await sb.rpc("nf525_deverrou", { p_salon: salon }); }
  return { salon, signes: out };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json().catch(() => ({}));
    const isCron = CRON && req.headers.get("x-cron-secret") === CRON;
    let salons: string[] = [];
    if (isCron) {
      const s = await sb.from("salons").select("id").in("status", ["active", "trial", "past_due", "cancelled", "archived"]);
      salons = (s.data || []).map((x: any) => x.id);
    } else {
      const auth = req.headers.get("authorization") || "";
      if (!auth.startsWith("Bearer ") || !body.salon_id) return json(401, { error: "Unauthorized" });
      const u = createClient(SB_URL, ANON, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
      const me = await u.auth.getUser(); const uid = me.data && me.data.user && me.data.user.id;
      if (!uid) return json(401, { error: "Unauthorized" });
      const own = await sb.from("salons").select("id").eq("id", body.salon_id).eq("user_id", uid).maybeSingle();
      if (!own.data) return json(403, { error: "Accès refusé" });
      salons = [body.salon_id];
    }
    const res = [];
    for (const id of salons) { try { res.push(await signerSalon(id, isCron ? 600 : 100)); } catch (e) { res.push({ salon: id, error: String((e as Error).message || e) }); } }
    return json(200, { ok: true, res });
  } catch (e) { return json(500, { error: String((e as Error).message || e) }); }
});
