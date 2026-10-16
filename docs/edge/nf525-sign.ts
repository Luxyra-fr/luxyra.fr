// nf525-sign v6 (déployé le 16/10/2026) — 2026-10-16 : type ZC (annotations correctives des Z). v5 — 2026-10-11 (v2 : archives AR + autocontrôle ; v3 : réinitialisations d'essai ; v4 : GT sans ventes de test ; v5 : factures FA, alerte éditeur sur anomalie, ancrage externe quotidien) — Signature électronique asymétrique (ECDSA P-256 / SHA-256, « ES256 ») des données
// fiscales, chaînée par établissement et par type (référentiel NF525 v2.3) :
//   TK (tickets), Z (clôtures journalières), ZM / ZA (mensuelles / annuelles), ZE (exercice),
//   CR (corrections de règlement), DUP (duplicatas), JET (journal des événements techniques), AR (archives).
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

type Src = { type: string; table: string; order: string[]; build: (r: any, salon: string, first: boolean, prev: string, at?: string | null) => Promise<string> | string; num?: (r: any) => number | null };
const SOURCES: Src[] = [
  { type: "TK", table: "tickets", order: ["num"], num: (r) => r.num,
    build: (r, _s, first, prev) => {
      const ttc = Number(r.total_ttc) || 0;
      const quand = r.ts_created || (r.date_ticket && r.heure_ticket ? `${r.date_ticket}T${String(r.heure_ticket).slice(0, 8)}+02:00` : r.created_at);
      return [`${m2(r.taux_tva)}:${m2(ttc)}`, m2(ttc), ts(quand), CAISSE, r.num, ttc < 0 ? "R" : "V", first ? "O" : "N", prev].join(",");
    } },
  { type: "Z", table: "clotures", order: ["num"], num: (r) => r.num,
    build: async (r, salon, first, prev, at) => {
      const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: r.date_cloture, p_a: at || null })).data || {};
      return [m2(r.total_ca), m2(r.total_ht), m2(gt.reel), m2(gt.absolu), ts(r.timestamp_cloture || r.created_at), d8(r.date_cloture), r.num, first ? "O" : "N", prev].join(",");
    } },
  { type: "ZM", table: "clotures_mensuelles", order: ["annee", "mois"],
    build: async (r, salon, first, prev, at) => {
      const fin = new Date(Date.UTC(r.annee, r.mois, 0)).toISOString().slice(0, 10);
      const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: fin, p_a: at || null })).data || {};
      const deb = `${r.annee}-${String(r.mois).padStart(2, "0")}-01`;
      return [m2(r.total_ca), m2(r.total_ht), m2(r.total_tva), m2(gt.reel), m2(gt.absolu), ts(r.created_at), d8(deb), d8(fin), first ? "O" : "N", prev].join(",");
    } },
  { type: "ZA", table: "clotures_annuelles", order: ["annee"],
    build: async (r, salon, first, prev, at) => {
      const fin = `${r.annee}-12-31`; const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: fin, p_a: at || null })).data || {};
      return [m2(r.total_ca), m2(r.total_ht), m2(r.total_tva), m2(gt.reel), m2(gt.absolu), ts(r.created_at), d8(`${r.annee}-01-01`), d8(fin), first ? "O" : "N", prev].join(",");
    } },
  { type: "ZE", table: "clotures_exercices", order: ["date_fin"],
    build: async (r, salon, first, prev, at) => {
      const gt: any = (await sb.rpc("nf525_grands_totaux", { p_salon: salon, p_date: r.date_fin, p_a: at || null })).data || {};
      return [m2(r.total_ca), m2(r.total_ht), m2(r.total_tva), m2(gt.reel), m2(gt.absolu), ts(r.created_at), d8(r.date_debut), d8(r.date_fin), first ? "O" : "N", prev].join(",");
    } },
  { type: "CR", table: "corrections_reglement", order: ["num"], num: (r) => r.num,
    build: (r, _s, first, prev) => [r.num, r.ticket_num, d8(r.ticket_date), m2(r.total_ttc_ticket), (r.lignes || []).map((l: any) => `${l.mode}:${m2(l.montant)}`).join("|"), ts(r.created_at), first ? "O" : "N", prev].join(",") },
  { type: "DUP", table: "nf525_duplicatas", order: ["seq"], num: (r) => r.seq,
    build: (r, _s, first, prev) => [r.caisse || CAISSE, r.seq, "TK", r.copie_num, String(r.operateur || "").replace(/,/g, " "), ts(r.horodatage), r.caisse || CAISSE, r.ticket_num, first ? "O" : "N", prev].join(",") },
  { type: "JET", table: "nf525_jet", order: ["seq"], num: (r) => r.seq,
    build: (r, _s, first, prev) => [r.seq, r.code, String(r.libelle || "").replace(/,/g, " "), ts(r.horodatage), String(r.operateur || "").replace(/,/g, " "), r.caisse || CAISSE, first ? "O" : "N", prev].join(",") },
  { type: "FA", table: "factures_clients", order: ["num"], num: (r) => r.num,
    build: (r, _s, first, prev) => [r.num, d8(r.date_facture), `${m2(r.taux_tva)}:${m2(r.total_ttc)}`, m2(r.total_ttc), m2(r.total_ht), m2(r.total_tva), ts(r.ts_created || r.created_at), CAISSE, String(r.client_siret || "").replace(/,/g, " "), first ? "O" : "N", prev].join(",") },
  { type: "AR", table: "nf525_archives_signees", order: ["seq"], num: (r) => r.seq,
    build: (r, _s, first, prev) => [r.seq, String(r.empreinte || "").toUpperCase(), d8(r.du), d8(r.au), r.motif || "periodique", ts(r.horodatage), CAISSE, first ? "O" : "N", prev].join(",") },
  // v6 (2026-10-16, NON DÉPLOYÉ — à déployer avec accord) : annotations correctives des Z (clotures_annotations)
  { type: "ZC", table: "clotures_annotations", order: ["num"], num: (r) => r.num,
    build: (r, _s, first, prev) => [r.num, r.cloture_num, d8(r.cloture_date), m2(r.wrong_total_ca), r.wrong_nb_tickets, m2(r.correct_total_ca), m2(r.correct_total_ht), r.correct_nb_tickets, String(r.hash || "").toUpperCase(), ts(r.created_at), CAISSE, first ? "O" : "N", prev].join(",") },
];

// ---- Autocontrôle d'intégrité (quotidien) : recalcul des données signées + vérification des signatures et du chaînage.
// Toute anomalie est inscrite au JET (code 90), une seule fois par anomalie.
let PUB: Record<string, CryptoKey> = {};
async function clePub(kid: string) {
  if (PUB[kid]) return PUB[kid];
  const r = await sb.from("nf525_cles").select("public_jwk").eq("key_id", kid).maybeSingle();
  const jwk: any = r.data && r.data.public_jwk; if (!jwk) throw new Error("clé publique " + kid + " introuvable");
  PUB[kid] = await crypto.subtle.importKey("jwk", { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  return PUB[kid];
}
function unb64url(s: string) { s = s.replace(/-/g, "+").replace(/_/g, "/"); while (s.length % 4) s += "="; const b = atob(s); const u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
async function verifierSalon(salon: string) {
  const anomalies: string[] = []; let n = 0;
  const purges: any[] = ((await sb.from("nf525_archives_purge").select("contenu").eq("salon_id", salon)).data || []);
  for (const S of SOURCES) {
    const sigs: any[] = []; let i = 0;
    while (true) { const r = await sb.from("nf525_signatures").select("*").eq("salon_id", salon).eq("type", S.type).order("seq").range(i, i + 999); if (r.error) break; sigs.push(...(r.data || [])); if (!r.data || r.data.length < 1000) break; i += 1000; }
    if (!sigs.length) continue;
    const ids = sigs.map((g) => g.source_id); const rows: Record<string, any> = {};
    for (let k = 0; k < ids.length; k += 80) { const q = await sb.from(S.table).select("*").in("id", ids.slice(k, k + 80)); (q.data || []).forEach((x: any) => rows[x.id] = x); }
    // enregistrements effacés lors d'une réinitialisation d'essai : vérifiés sur leur copie archivée (inaltérable)
    for (const pa of purges) for (const x of ((pa.contenu || {})[S.table] || [])) if (!rows[x.id]) rows[x.id] = x;
    let prev = "";
    for (const g of sigs) {
      n++;
      if (g.seq !== (sigs.indexOf(g) + 1)) anomalies.push(`${S.type} : rupture de séquence au n°${g.seq}`);
      if ((g.prev_signature || "") !== prev) anomalies.push(`${S.type} n°${g.seq} : chaînage rompu`);
      prev = g.signature;
      const r = rows[g.source_id];
      if (!r) { anomalies.push(`${S.type} n°${g.seq} : enregistrement d'origine absent`); continue; }
      const attendu = await S.build(r, salon, g.seq === 1, g.prev_signature || "", g.signed_at);
      if (attendu !== g.data_to_sign) anomalies.push(`${S.type} n°${g.seq}${S.num ? " (pièce " + S.num(r) + ")" : ""} : données différentes des données signées`);
      try { const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, await clePub(g.key_id), unb64url(g.signature), new TextEncoder().encode(g.data_to_sign)); if (!ok) anomalies.push(`${S.type} n°${g.seq} : signature invalide`); }
      catch (e) { anomalies.push(`${S.type} n°${g.seq} : vérification impossible (${(e as Error).message})`); }
    }
  }
  let nouvelles = 0;
  for (const a of anomalies.slice(0, 50)) {
    const deja = await sb.from("nf525_jet").select("id").eq("salon_id", salon).eq("code", 90).ilike("details", "%" + a.replace(/[%_]/g, " ") + "%").limit(1);
    // via le journal d'audit : inscrit au JET (90) et alerte immédiate de l'éditeur (anomalie critique)
    if (!deja.error && !(deja.data || []).length) { await sb.from("audit_log").insert({ salon_id: salon, action: "NF525_SIGNATURE_KO", details: "Autocontrôle d'intégrité : " + a, operator_name: "Luxyra (contrôle automatique)" }); nouvelles++; }
  }
  return { salon, controles: n, anomalies: anomalies.length, nouvelles, detail: anomalies.slice(0, 10) };
}

// ---- Ancrage externe quotidien : empreinte des têtes de chaînes de tous les établissements, envoyée hors de la base
async function sha256hex(t: string) { const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(t)); return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("").toUpperCase(); }
async function ancrer() {
  const jour = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const deja = await sb.from("nf525_ancrages").select("id").eq("jour", jour).maybeSingle();
  if (deja.data) return { jour, deja: true };
  const s = await sb.from("salons").select("id,nom").order("created_at");
  const salons: any[] = [];
  for (const sl of (s.data || [])) {
    const tetes: Record<string, any> = {};
    for (const S of SOURCES) {
      const l = await sb.from("nf525_signatures").select("seq,signature").eq("salon_id", sl.id).eq("type", S.type).order("seq", { ascending: false }).limit(1);
      if (l.data && l.data[0]) tetes[S.type] = { seq: l.data[0].seq, signature: l.data[0].signature };
    }
    if (Object.keys(tetes).length) salons.push({ salon_id: sl.id, nom: sl.nom, tetes, empreinte: await sha256hex(JSON.stringify(tetes)) });
  }
  const contenu = { jour, genere_le: new Date().toISOString(), salons };
  const empreinte = await sha256hex(JSON.stringify(contenu));
  const dest = "support@luxyra.fr";
  const lignes = salons.map((x) => `<tr><td style="padding:4px 8px">${String(x.nom || "").replace(/</g, "&lt;")}</td><td style="padding:4px 8px">TK n°${x.tetes.TK ? x.tetes.TK.seq : "-"} · Z n°${x.tetes.Z ? x.tetes.Z.seq : "-"} · JET n°${x.tetes.JET ? x.tetes.JET.seq : "-"}</td><td style="padding:4px 8px;font-family:monospace;font-size:11px">${x.empreinte.slice(0, 32)}…</td></tr>`).join("");
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;color:#1a1a1a"><h2 style="font-family:Georgia,serif;font-weight:400">Ancrage NF525 du ${jour}</h2><p>Empreinte globale (SHA-256) :<br><b style="font-family:monospace;font-size:12px">${empreinte}</b></p><table style="border-collapse:collapse;font-size:13px">${lignes}</table><p style="font-size:12px;color:#666">Preuve externe quotidienne : ce courriel horodaté par la messagerie, hors de la base de données, fige l'état des chaînes signées de chaque établissement. À conserver (ne pas supprimer). Contenu complet : table nf525_ancrages.</p></div>`;
  let envoye: string | null = null;
  try {
    const r = await fetch("https://luxyra.fr/api/email/custom", { method: "POST", headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR }, body: JSON.stringify({ to: dest, toName: "Luxyra", salonName: "Luxyra NF525", subject: `Ancrage NF525 ${jour} — ${empreinte.slice(0, 16)}`, htmlContent: html, textContent: `Ancrage NF525 ${jour}\nEmpreinte : ${empreinte}` }) });
    if (r.ok) envoye = dest;
  } catch (_) { /* l'ancrage reste enregistré ; envoi retenté le lendemain */ }
  await sb.from("nf525_ancrages").insert({ jour, empreinte, contenu, envoye_a: envoye });
  return { jour, empreinte, salons: salons.length, envoye };
}

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
      // après une réinitialisation d'essai, la numérotation repart : on ne filtre plus sur le dernier numéro signé
      const lastAt = last.data && last.data[0] ? (await sb.from("nf525_signatures").select("signed_at").eq("salon_id", salon).eq("type", S.type).eq("seq", seq).maybeSingle()).data?.signed_at : null;
      const purgeApres = lastAt ? !!((await sb.from("nf525_archives_purge").select("id").eq("salon_id", salon).gt("created_at", lastAt).limit(1)).data || []).length : false;
      const parNumero = !!S.num && !purgeApres && !!(last.data && last.data[0] && last.data[0].source_num != null);
      if (!parNumero) { let i = 0; while (true) { const s2 = await sb.from("nf525_signatures").select("source_id").eq("salon_id", salon).eq("type", S.type).range(i, i + 999); (s2.data || []).forEach((x: any) => signes.add(x.source_id)); if (!s2.data || s2.data.length < 1000) break; i += 1000; } }
      let q = sb.from(S.table).select("*").eq("salon_id", salon);
      if (parNumero) q = q.gt(S.order[0], last.data![0].source_num);
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
    if (isCron && body.ancrage === true) { return json(200, { ok: true, ancrage: await ancrer() }); }
    if (isCron && body.verif === true) {
      for (const id of salons) { try { res.push(await verifierSalon(id)); } catch (e) { res.push({ salon: id, error: String((e as Error).message || e) }); } }
      return json(200, { ok: true, verif: true, res });
    }
    for (const id of salons) { try { res.push(await signerSalon(id, isCron ? 600 : 100)); } catch (e) { res.push({ salon: id, error: String((e as Error).message || e) }); } }
    return json(200, { ok: true, res });
  } catch (e) { return json(500, { error: String((e as Error).message || e) }); }
});
