// Banc v3 (31/10) : /api/bons/ecarte, plafond /api/email/custom, QR par jeton. fetch simulé (Supabase, Brevo).
// node docs/bons_1031/bancs/bons_v3_worker_test.mjs
import fs from "fs"; import path from "path"; import os from "os";
const racine = path.resolve(new URL("../../../", import.meta.url).pathname);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3-"));
let w = fs.readFileSync(racine + "/docs/luxyra-router-worker.js", "utf8")
  .replace('import lxQrcode from "../lx-qrcode.js";', `import lxQrcode from "${racine}/lx-qrcode.js";`)
  .replace('import "../lx-bon-cadeau.js";', `import "${racine}/lx-bon-cadeau.js";`);
w += "\nexport { handleBonEcarte as __ecarte, handleEmailCustom as __emc, handleQrJeton as __qrt, handleQr as __qr, lxBonMentionTvaCaisse as __tva };\n";
fs.writeFileSync(tmp + "/w3.mjs", w);
let ok = 0, ko = 0; const T = (n, c, d) => { if (c) ok++; else { ko++; console.log("KO", n, JSON.stringify(d).slice(0, 500)); } };
let st = {};
const J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
globalThis.fetch = async (u, o = {}) => {
  u = String(u); const m = o.method || "GET"; const body = o.body ? String(o.body) : "";
  (st.calls = st.calls || []).push(m + " " + u.replace(/https:\/\/[^/]+/, "") + " " + body.slice(0, 300));
  if (u.includes("/auth/v1/user")) return st.user ? J(st.user) : J({}, 401);
  if (u.includes("/rest/v1/salons?select=id&id=eq.")) return J(st.owner ? [{ id: "s" }] : []);
  if (u.includes("/rest/v1/salons?select=id&user_id=eq.")) return J(st.owner ? [{ id: st.salonId }] : []);
  if (u.includes("/rest/v1/cartes_cadeaux?")) return J(st.bon ? [st.bon] : []);
  if (u.includes("/rest/v1/salons?select=id,nom")) return J(st.salon ? [st.salon] : []);
  if (u.includes("/rest/v1/app_config")) return J([{ config: st.cfg || {} }]);
  if (u.includes("/rpc/lx_envoi_quota_rendre")) { const a = JSON.parse(body); st.quota = st.quota || {}; const k = a.p_salon + a.p_type; st.rendu = (st.rendu || 0) + 1; if (st.quota[k] > 0) st.quota[k]--; return new Response("", { status: 204 }); }
  if (u.includes("/rpc/lx_envoi_quota")) { if (st.quotaKo) return J({ message: "x" }, 500); const a = JSON.parse(body); st.quota = st.quota || {}; const k = a.p_salon + a.p_type; st.quota[k] = (st.quota[k] || 0); if (st.quota[k] >= a.p_max) return J(false); st.quota[k]++; return J(true); }
  if (u.includes("/rpc/lx_qr_jeton")) return J("AbCdEfGhIjKlMnOpQrStUvWx");
  if (u.includes("/rpc/lx_qr_resoudre")) { const a = JSON.parse(body); return J(a.p_jeton === "AbCdEfGhIjKlMnOpQrStUvWx" ? "BC-7K4Q2M" : null); }
  if (u.includes("/rest/v1/messaging_log") && m === "POST") { st.ml = (st.ml || []).concat(JSON.parse(body)); if (st.dup) return new Response('{"code":"23505"}', { status: 409 }); return new Response("", { status: 201 }); }
  if (u.includes("/rest/v1/messaging_log") && m === "DELETE") { st.libere = (st.libere || 0) + 1; return new Response("", { status: 204 }); }
  if (u.includes("/rest/v1/messaging_log")) return J([]);
  if (u.includes("api.brevo.com/v3/smtp/email")) { st.brevo = (st.brevo || []).concat(JSON.parse(body)); return st.brevoKo ? J({ code: "invalid", message: "refus" }, 400) : J({ messageId: "<m1>" }); }
  if (u.includes("report_server_error") || u.includes("server_errors")) { st.rep = (st.rep || []).concat(body); return J({}); }
  return J({});
};
const W = await import(tmp + "/w3.mjs");
const env = { SUPABASE_SERVICE_KEY: "sk", BREVO_API_KEY: "bk" };
const SAL = "11111111-1111-4111-8111-111111111111", BON = "22222222-2222-4222-8222-222222222222";
const req = (p, b, h) => new Request("https://luxyra.fr" + p, { method: "POST", headers: Object.assign({ Authorization: "Bearer jwt.eyJhYWwiOiJhYWwxIn0.x" }, h || {}), body: JSON.stringify(b) });
const bonOk = () => ({ id: BON, salon_id: SAL, code: "BC-7K4Q2M", valeur: 50, restant: 50, status: "active", payment_status: "paid", date_expiration: "2030-01-01", de: "Camille <b>", pour: "Léa \"x\"", message: "<script>alert(1)</script>", theme_id: "anniversaire", scope: "prestations", usage_tva: null, tva_rate: 0.2, is_offert: false, pay_method: "CB", tk_num: 12 });
const salOk = () => ({ id: SAL, nom: "Excellence <i>Coiffure</i>", sous_titre: "by A", adresse: "20 rue", cp: "57200", ville: "Sarreguemines", tel: "03", logo: "https://luxyra.fr/x.png", couleur_primaire: "#7a2e3a", siret: "123", taux_tva: 20, email: "salon@ex.fr", config_json: JSON.stringify({ bonModele: "ecrin", bonPalette: "noir_or" }), ferme_le: null });
let uid = 0; const base = () => ({ user: { id: "u" + (++uid), email: "pro@ex.fr" }, owner: true, salonId: SAL, bon: bonOk(), salon: salOk() });
async function E(b, h) { const r = await W.__ecarte(req("/api/bons/ecarte", b, h), env); return { s: r.status, j: await r.json() }; }
const B = { salon_id: SAL, bon_id: BON, to: "Client@Exemple.fr" };

// 1. parcours normal
st = base(); let r = await E(B);
T("ecarte OK 200", r.s === 200 && r.j.success === true, r);
const env1 = st.brevo && st.brevo[0];
T("Brevo appelé une fois, destinataire normalisé", st.brevo && st.brevo.length === 1 && env1.to[0].email === "client@exemple.fr" && !env1.to[0].name, env1 && env1.to);
T("HTML construit côté serveur, échappé (script/b/i)", env1 && !/<script>|Camille <b>|<i>Coiffure/.test(env1.htmlContent) && /&lt;script&gt;/.test(env1.htmlContent) && /Camille &lt;b&gt;/.test(env1.htmlContent), (env1.htmlContent.match(/.{40}(<script>|Camille <b>|<i>Coiffure).{40}/)||[""])[0]);
T("QR par jeton opaque, code absent des URL d'image", env1 && /https:\/\/luxyra\.fr\/api\/qr\/t\/AbCdEfGhIjKlMnOpQrStUvWx/.test(env1.htmlContent) && !/api\/qr\?d=/.test(env1.htmlContent), "");
T("reply-to = e-mail de l'établissement", env1 && env1.replyTo && env1.replyTo.email === "salon@ex.fr", env1 && env1.replyTo);
const ml = st.ml && st.ml[0];
T("dedup_key hachée (ni code ni adresse en clair)", ml && ml.context === "bon_ecarte" && !/BC-7K4Q2M|client@/i.test(ml.dedup_key) && /^11111111-1111-4111-8111-111111111111\|ecarte\|[0-9a-f]{40}\|\d{4}-\d{2}-\d{2}$/.test(ml.dedup_key), ml);
T("mention TVA serveur (20 % incluse)", env1 && /TVA 20 % incluse/.test(env1.htmlContent), "");
// 2. refus
for (const [n, mod, code] of [["annulé", (b) => b.status = "cancelled", "inactif"], ["utilisé", (b) => b.status = "used", "inactif"], ["épuisé", (b) => b.restant = 0, "epuise"], ["non payé", (b) => b.payment_status = "pending", "non_paye"], ["expiré", (b) => b.date_expiration = "2020-01-01", "expire"]]) {
  st = base(); mod(st.bon); r = await E(B);
  T("refus " + n, r.s === 409 && r.j.code === code && !st.brevo, r);
}
st = base(); st.bon = null; r = await E(B); T("bon d'un autre établissement / inconnu -> 404", r.s === 404 && !st.brevo, r);
st = base(); st.owner = false; r = await E(B); T("non propriétaire -> 403", r.s === 403 && !st.brevo, r);
st = base(); st.user = null; r = await E(B); T("non connecté -> 401", r.s === 401, r);
st = base(); r = await E({ ...B, to: "pas-une-adresse" }); T("adresse invalide -> 400", r.s === 400, r);
st = base(); r = await E({ ...B, to: "a@b.fr<script>" }); T("adresse avec balise -> 400", r.s === 400, r);
st = base(); st.salon.config_json = "{}"; r = await E(B); T("sans modèle -> 409 sans_modele", r.s === 409 && r.j.code === "sans_modele", r);
st = base(); r = await E(B, { "x-lx-internal": "sk" }); T("appel interne refusé (403)", r.s === 403 || r.s === 401, r);
// 3. quota quotidien
st = base(); st.cfg = { bon_ecarte_max_jour: 2 }; let n200 = 0;
for (let i = 0; i < 3; i++) { st.user = { id: "uq" + i }; st.bon = bonOk(); st.brevo = null; const x = await E({ ...B, to: "c" + i + "@ex.fr" }); if (x.s === 200) n200++; else r = x; }
T("plafond e-cartes/jour (2) -> 3e refusé 429", n200 === 2 && r.s === 429 && r.j.code === "quota_jour", r);
st = base(); st.quotaKo = true; r = await E(B); T("quota indisponible -> 503 (fail-closed e-carte)", r.s === 503 && !st.brevo, r);
// 4. doublon
st = base(); st.dup = true; r = await E(B); T("doublon du jour -> deduplique, pas d'envoi", r.s === 200 && r.j.deduplique === true && !st.brevo, r);
// 5. Brevo refuse -> 502 et réservation libérée
st = base(); st.brevoKo = true; r = await E(B); T("Brevo refuse -> 502 + libération", r.s === 502 && st.libere === 1, r);
// 2026-10-31 (contre-audit bons v3, R2a) : quota décompté APRÈS l'anti-doublon, rendu si Brevo refuse
st = base(); st.dup = true; r = await E(B); T("R2a : doublon -> aucun décompte de quota", r.j.deduplique === true && !Object.values(st.quota || {}).some(v => v > 0), st.quota);
st = base(); st.brevoKo = true; r = await E(B); T("R2a : Brevo refuse -> unité rendue (compteur à 0)", r.s === 502 && st.rendu === 1 && !Object.values(st.quota || {}).some(v => v > 0), { q: st.quota, r: st.rendu });
st = base(); st.cfg = { bon_ecarte_max_jour: 1 }; st.quota = {}; r = await E(B); st.user = { id: "uz" }; st.bon = bonOk(); st.brevo = null; const r2 = await E({ ...B, to: "z@ex.fr" });
T("R2a : plafond atteint -> réservation anti-doublon libérée", r2.s === 429 && r2.j.code === "quota_jour" && st.libere >= 1, r2);
// 6. mentions TVA
T("TVA BUM", /usage multiple/.test(W.__tva({ usage_tva: "BUM", tva_rate: 0 }, 20)), "");
T("TVA offert", /^Bon offert/.test(W.__tva({ is_offert: true, tva_rate: 0 }, 20)) && /20 % incluse/.test(W.__tva({ is_offert: true, tva_rate: 0 }, 20)), W.__tva({ is_offert: true, tva_rate: 0 }, 20));
T("TVA 10 %", /TVA 10 % incluse/.test(W.__tva({ tva_rate: 0.1 }, 20)), "");

// 7. /api/email/custom : plafond quotidien persistant
async function EM(b) { const r = await W.__emc(req("/api/email/custom", b), env); return { s: r.status, j: await r.json() }; }
st = base(); st.cfg = { email_custom_max_jour: 3 }; let c200 = 0, last;
for (let i = 0; i < 4; i++) { last = await EM({ to: "x" + i + "@ex.fr", subject: "S" + i, htmlContent: "<p>h" + i + "</p>", salon_id: SAL }); if (last.s === 200 && last.j.success) c200++; }
T("email/custom : 3 envois puis 429 quota_jour", c200 === 3 && last.s === 429 && last.j.code === "quota_jour", last);
st = base(); st.quotaKo = true; last = await EM({ to: "y@ex.fr", subject: "S", htmlContent: "<p>h</p>", salon_id: SAL });
T("email/custom : quota indisponible -> envoi autorisé (rappels jamais bloqués)", last.s === 200 && last.j.success === true, last);
st = base(); last = await (await W.__emc(new Request("https://luxyra.fr/api/email/custom", { method: "POST", headers: { "x-lx-internal": "sk" }, body: JSON.stringify({ to: "z@ex.fr", subject: "S", htmlContent: "x" }) }), env)).json();
T("email/custom interne : pas de quota", !(st.calls || []).some((c) => /lx_envoi_quota/.test(c)), st.calls);
// 2026-10-31 (contre-audit bons v3, R3a) : quota APRÈS validation et anti-doublon, rendu si Brevo refuse
st = base(); last = await EM({ to: "", subject: "S", htmlContent: "x", salon_id: SAL });
T("R3a : requête invalide (to vide) -> 400 sans décompte", last.s === 400 && !Object.values(st.quota || {}).some(v => v > 0), { last, q: st.quota });
st = base(); st.dup = true; last = await EM({ to: "d@ex.fr", subject: "S", htmlContent: "x", salon_id: SAL });
T("R3a : doublon -> sans décompte", last.j.deduplique === true && !Object.values(st.quota || {}).some(v => v > 0), { last, q: st.quota });
st = base(); st.brevoKo = true; last = await EM({ to: "k@ex.fr", subject: "S", htmlContent: "x", salon_id: SAL });
T("R3a : Brevo refuse -> unité rendue", last.j.success === false && st.rendu === 1 && !Object.values(st.quota || {}).some(v => v > 0), { last, q: st.quota, r: st.rendu });
st = base(); st.cfg = { email_custom_max_jour: 1 }; await EM({ to: "a1@ex.fr", subject: "S", htmlContent: "x", salon_id: SAL }); last = await EM({ to: "a2@ex.fr", subject: "S2", htmlContent: "y", salon_id: SAL });
T("R3a : plafond atteint -> réservation libérée + code quota_jour", last.s === 429 && last.j.code === "quota_jour" && st.libere >= 1, last);

// 8. QR par jeton
let q = await W.__qrt(new URL("https://luxyra.fr/api/qr/t/AbCdEfGhIjKlMnOpQrStUvWx"), env);
T("QR jeton connu -> GIF privé", q.status === 200 && q.headers.get("content-type") === "image/gif" && /private/.test(q.headers.get("cache-control")), q.status);
q = await W.__qrt(new URL("https://luxyra.fr/api/qr/t/ZZZZZZZZZZZZZZZZZZZZZZZZ"), env); T("QR jeton inconnu -> 404", q.status === 404, q.status);
q = await W.__qrt(new URL("https://luxyra.fr/api/qr/t/court"), env); T("QR jeton mal formé -> 400", q.status === 400, q.status);
q = W.__qr(new URL("https://luxyra.fr/api/qr?d=BC-7K4Q2M")); T("ancienne URL /api/qr?d= conservée", q.status === 200, q.status);

console.log(`bons v3 worker : ${ok}/${ok + ko} OK`); process.exit(ko ? 1 : 0);
