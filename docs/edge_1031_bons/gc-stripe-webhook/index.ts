// gc-stripe-webhook v15 — 2026-10-31 (-3, contre-audit bons v2 R3) : QR de l'e-carte par jeton opaque (RPC lx_qr_jeton,
//    image https://luxyra.fr/api/qr/t/<jeton>) : le code du bon ne passe plus dans l'URL de l'image ; repli sur l'ancienne URL si
//    le jeton est indisponible. Bloc commun resynchronisé. Paiement, montants, codes, ticket, mention TVA : INCHANGÉS. verify_jwt = false.
// gc-stripe-webhook v14 — 2026-10-31 (-2) : e-carte = bloc commun de lx-bon-cadeau.js (copie exacte, docs/bons_1031/sync_partage.mjs) :
//    palettes au choix (config_json.bonPalette), code du bon sur sa propre ligne (jamais coupé), logo sans pastille, échappement
//    des guillemets (R5), logo https uniquement. Paiement, montants, codes, ticket, mention TVA : INCHANGÉS. verify_jwt = false.
// gc-stripe-webhook v13 — 2026-10-31 : e-mail de l'acheteur au MODÈLE choisi par l'établissement (config_json.bonModele =
//    « maison » | « ecrin », réglage Bons cadeaux › Modèle des bons) : gabarit en tableaux (Gmail / Outlook), couleurs dérivées de
//    la couleur principale de l'établissement (mêmes règles que lx-bon-cadeau.js), pas de police Google, objet sans emoji,
//    établissement en tête, Luxyra en pied. Sans modèle choisi : e-mail historique INCHANGÉ. Aucune donnée, montant, code,
//    ticket ni mention TVA modifiés (lxBonMentionTva inchangée). verify_jwt = false (inchangé).
// gc-stripe-webhook v10 — 2026-10-28 (-3, Luxyra 6.8.1) : date de paiement = date de l'évènement Stripe (paye_at : la reprise
//    de secours l'utilise au lieu de son heure) ; QR code de l'e-mail généré par Luxyra (https://luxyra.fr/api/qr, worker,
//    bibliothèque lx-qrcode.js déjà utilisée par l'application) : le code du bon n'est plus envoyé à api.qrserver.com.
//    verify_jwt = false (webhook Stripe et appel interne du worker).
// gc-stripe-webhook v9 — 2026-10-28 (-2, Luxyra 6.8.0) : recettes en ligne en caisse.
//  - Le passage du bon à payment_status = "paid" déclenche, DANS LA MÊME TRANSACTION, la création du ticket de caisse scellé
//    de la vente (déclencheur zz_trg_cartes_cadeaux_recettes, docs/migrations_1028/recettes_en_ligne.sql, actif quand
//    app_config.config.recettes_en_ligne_serveur = true) : n°, chaînage, empreinte, sceau et signature comme tout ticket.
//    Le n° du ticket (cartes_cadeaux.tk_num) est rappelé dans l'e-mail de l'acheteur.
//  - Mention TVA de l'e-mail CORRIGÉE (avant : « Bon multi-usages (art. 256 ter CGI) — TVA applicable lors de l'utilisation »
//    pour TOUS les bons, ce qui était faux) : la mention dépend de la qualification du bon (CGI art. 256 ter ;
//    BOI-TVA-CHAMP-10-10-40-50 § 60-80) : bon à usage unique -> TVA incluse, due à l'achat ; bon à usage multiple -> TVA due
//    à l'utilisation ; bon sans qualification (modèle historique) -> TVA incluse ; franchise -> art. 293 B.
//  - « Utilisable en une ou plusieurs fois » (fractionnement) n'est plus confondu avec « usage multiple » (notion fiscale).
// v8 — 2026-10-10 : email du bon cadeau dans la mise en page commune Luxyra (lxMailLayout), contenu inchangé.
// v7 — 2026-10-09 : accepte aussi l'évènement transmis par le worker (/api/stripe/webhook-connect,
// paiements directs sur le compte du salon), déjà relu chez Stripe par le worker ; authentifié par x-lx-internal.
// v6 — SECURITE 2026-10-08 :
//  - plus jamais d'evenement accepte sans preuve : signature verifiee (temps constant, tolerance 5 min) ;
//    si le secret webhook manque, l'evenement est RELU chez Stripe (cle secrete) au lieu d'etre cru sur parole ;
//  - session reellement payee et montant = valeur du bon, sinon refus ;
//  - appel worker email authentifie (x-lx-internal).
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
const WH_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET_GC") || "";
const STRIPE_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const WORKER_BASE = Deno.env.get("WORKER_BASE") || "https://luxyra.fr";
const sb = createClient(SB_URL, SB_SR, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(s:number,b:unknown){ return new Response(JSON.stringify(b),{status:s,headers:{...CORS,"Content-Type":"application/json"}}); }
function esc(s:unknown){ return String(s??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;"); } // 31/10 (-2, R5) : guillemets aussi

// 2026-10-28 (-2) : mention TVA du bon selon sa qualification (CGI art. 256 ter). Exportée pour les tests unitaires.
export function lxBonMentionTva(b: { usage_tva?: string | null; qualif_tva?: any; tva_rate?: number | null }, tauxSalon: number | null | undefined): string {
  const fr = (t: number) => String(Number(t)).replace(".", ",") + " %";
  const ts = (tauxSalon === null || tauxSalon === undefined || isNaN(Number(tauxSalon))) ? 20 : Number(tauxSalon);
  if (ts === 0) return "TVA non applicable, art. 293 B du CGI";
  const u = b && b.usage_tva;
  if (u === "BUM") return "Bon à usage multiple (CGI art. 256 ter) : la TVA est due lors de l'utilisation, sur les prestations et produits réellement fournis";
  if (u === "BUU") { const t = b.qualif_tva && b.qualif_tva.tauxBon != null ? Number(b.qualif_tva.tauxBon) : ts; return `Bon à usage unique (CGI art. 256 ter) : TVA ${fr(t)} incluse, due à l'achat du bon`; }
  return `TVA ${fr(ts)} incluse, due à l'achat du bon`;
}
export function lxBonPerimetre(scope: string | null | undefined): string {
  return scope === "prestations" ? "Prestations" : (scope === "produits" ? "Produits" : "Services &amp; Produits");
}

async function reportError(message: string, severity: "warning"|"error"|"critical", error?: Error, context?: unknown) {
  try {
    await sb.rpc("report_server_error", {
      p_source: "edge_fn:gc-stripe-webhook",
      p_message: message.slice(0, 800),
      p_severity: severity,
      p_stack: error?.stack ? error.stack.slice(0, 3000) : null,
      p_context: context ? (context as Record<string, unknown>) : null
    });
  } catch (e) { console.error("[reportError] failed:", e); }
}

function egalTempsConstant(a: string, b: string): boolean { if (a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; }
async function verifyStripeSignature(payload: string, header: string, secret: string): Promise<boolean> {
  if (!header || !secret) return false;
  let timestamp = ""; const v1s: string[] = [];
  for (const p of header.split(",")) { const i = p.indexOf("="); const k = p.slice(0, i); const v = p.slice(i + 1); if (k === "t") timestamp = v; else if (k === "v1") v1s.push(v); }
  if (!timestamp || !v1s.length) return false;
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!isFinite(age) || age > 300) return false;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(`${timestamp}.${payload}`));
  const hex = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2,"0")).join("");
  return v1s.some((v) => egalTempsConstant(hex, v));
}
// Secret webhook absent : on ne croit pas le corps recu, on relit l'evenement chez Stripe.
async function relireEvenement(evt: any): Promise<any | null> {
  if (!STRIPE_KEY || !evt || typeof evt.id !== "string" || !/^evt_[A-Za-z0-9]+$/.test(evt.id)) return null;
  const headers: Record<string, string> = { "Authorization": `Bearer ${STRIPE_KEY}` };
  if (typeof evt.account === "string" && /^acct_[A-Za-z0-9]+$/.test(evt.account)) headers["Stripe-Account"] = evt.account;
  try { const r = await fetch(`https://api.stripe.com/v1/events/${evt.id}`, { headers }); if (!r.ok) return null; return await r.json(); } catch { return null; }
}

async function sendEmail(opts: { to:string; toName:string; subject:string; htmlContent:string; textContent:string }) {
  try {
    const r = await fetch(`${WORKER_BASE}/api/email/custom`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-lx-internal": SB_SR },
      body: JSON.stringify({ to: opts.to, toName: opts.toName, salonName: "Luxyra", subject: opts.subject, htmlContent: opts.htmlContent, textContent: opts.textContent }),
    });
    if (!r.ok) {
      console.warn("sendEmail status", r.status);
      await reportError("sendEmail HTTP " + r.status, "warning", undefined, { to: opts.to.slice(0,40), status: r.status });
    }
    return r.ok;
  } catch(e) {
    console.warn("sendEmail exception", e);
    await reportError("sendEmail exception: " + (e as Error)?.message, "warning", e as Error, { to: opts.to.slice(0,40) });
    return false;
  }
}

type Theme = { bg:string; acc:string; txt:string; soft:string; bdr:string; bbg:string; fbg:string; ftx:string; lf:string; mf:string; dc:string; dcol:string; hl:string; dark:boolean };
const THEMES: Record<string,Theme> = {
  luxeNoir:    { bg:"#0a0a0a", acc:"#c8a84e", txt:"#d5c9a8", soft:"rgba(200,168,78,.4)",  bdr:"#c8a84e", bbg:"#151520",                                              fbg:"rgba(200,168,78,.06)", ftx:"rgba(200,168,78,.5)",  lf:"'Playfair Display',serif",   mf:"'Cormorant Garamond',serif", dc:"✦", dcol:"#c8a84e",                          hl:"Carte Cadeau",         dark:true },
  noel:        { bg:"#14412a", acc:"#ffd700", txt:"#c8e6c9", soft:"rgba(255,215,0,.4)",   bdr:"#d4a038", bbg:"linear-gradient(180deg,#14412a,#1b5e3a)",              fbg:"rgba(0,0,0,.15)",       ftx:"rgba(168,213,186,.6)", lf:"'Dancing Script',cursive",   mf:"'Dancing Script',cursive",   dc:"❄", dcol:"rgba(255,255,255,.15)",            hl:"Joyeuses Fêtes",  dark:true },
  stValentin:  { bg:"#6b0f2a", acc:"#ffd6e7", txt:"#f8bbd0", soft:"rgba(255,214,231,.35)", bdr:"#ffd6e7", bbg:"linear-gradient(135deg,#8e2040,#6b0f2a)",              fbg:"rgba(0,0,0,.15)",       ftx:"rgba(248,187,208,.5)", lf:"'Great Vibes',cursive",      mf:"'Cormorant Garamond',serif", dc:"♥", dcol:"rgba(255,107,157,.2)",             hl:"Avec tout mon amour", dark:true },
  feteMeres:   { bg:"#fff0f5", acc:"#c44c7a", txt:"#555",    soft:"rgba(196,76,122,.4)",  bdr:"#e91e63", bbg:"linear-gradient(180deg,#fce4ec,#fff0f5)",              fbg:"rgba(196,76,122,.04)",  ftx:"#999",                  lf:"'Dancing Script',cursive",   mf:"'Cormorant Garamond',serif", dc:"🌹", dcol:"#c44c7a",                    hl:"Bonne Fête Maman", dark:false },
  anniversaire:{ bg:"#311b92", acc:"#ffd54f", txt:"#e1bee7", soft:"rgba(255,213,79,.35)", bdr:"#ffd54f", bbg:"linear-gradient(180deg,#311b92,#4527a0)",              fbg:"rgba(0,0,0,.15)",       ftx:"rgba(206,147,216,.5)", lf:"'Dancing Script',cursive",   mf:"'Nunito',sans-serif",        dc:"🎉", dcol:"rgba(255,255,255,.08)",      hl:"Joyeux Anniversaire", dark:true },
  roseGold:    { bg:"#fdf2f8", acc:"#be185d", txt:"#555",    soft:"rgba(190,24,93,.35)",  bdr:"#be185d", bbg:"linear-gradient(135deg,#fdf2f8,#fce7f3)",              fbg:"rgba(190,24,93,.04)",   ftx:"#999",                  lf:"'Cormorant Garamond',serif", mf:"'Cormorant Garamond',serif", dc:"✦", dcol:"rgba(190,24,93,.15)",              hl:"Carte Cadeau",         dark:false },
  printemps:   { bg:"#f1f8e9", acc:"#2e7d32", txt:"#444",    soft:"rgba(46,125,50,.35)",  bdr:"#7cb342", bbg:"linear-gradient(135deg,#e8f5e9,#f1f8e9)",              fbg:"rgba(85,139,47,.04)",   ftx:"#888",                  lf:"'Cormorant Garamond',serif", mf:"'Cormorant Garamond',serif", dc:"🌼", dcol:"#7cb342",                    hl:"Carte Cadeau",         dark:false },
  ete:         { bg:"#fff8e1", acc:"#e65100", txt:"#555",    soft:"rgba(245,124,0,.35)",  bdr:"#f57c00", bbg:"linear-gradient(135deg,#fff8e1,#ffe0b2)",              fbg:"rgba(245,124,0,.04)",   ftx:"#999",                  lf:"'Dancing Script',cursive",   mf:"'Nunito',sans-serif",        dc:"☀", dcol:"#f57c00",                          hl:"Carte Cadeau",         dark:false },
  classique:   { bg:"#ffffff", acc:"#c8a84e", txt:"#333",    soft:"rgba(200,168,78,.4)",  bdr:"#c8a84e", bbg:"#ffffff",                                              fbg:"#fafafa",               ftx:"#999",                  lf:"'Playfair Display',serif",   mf:"'Georgia',serif",            dc:"",       dcol:"",                                 hl:"Carte Cadeau",         dark:false },
  midnight:    { bg:"#0d1b2a", acc:"#90caf9", txt:"#b0bec5", soft:"rgba(100,181,246,.3)", bdr:"#64b5f6", bbg:"linear-gradient(135deg,#0d1b2a,#1b2838)",              fbg:"rgba(100,181,246,.05)", ftx:"rgba(100,181,246,.45)", lf:"'Cormorant Garamond',serif", mf:"'Cormorant Garamond',serif", dc:"✧", dcol:"rgba(100,181,246,.15)",            hl:"Carte Cadeau",         dark:true }
};

// 2026-10-28 (-3) : QR généré par Luxyra (worker /api/qr, image GIF, codes de bon uniquement), plus de service tiers
function qrUrl(code:string){ return `https://luxyra.fr/api/qr?d=${encodeURIComponent(code)}&s=160`; }

// ---------------- 2026-10-31 : modèles « Maison » / « Écrin » (présentation seulement) ----------------
// 31/10 (-2) : couleurs, palettes et e-carte = bloc commun copié à l'identique de lx-bon-cadeau.js (docs/bons_1031/sync_partage.mjs)
  /*<<LXB-PARTAGE — bloc commun lx-bon-cadeau.js (navigateur) et edge gc-stripe-webhook (e-mail) : NE PAS MODIFIER À UN SEUL
    ENDROIT. Source : lx-bon-cadeau.js ; copie exacte dans l'edge par docs/bons_1031/sync_partage.mjs (contrôle d'égalité au banc).
    JavaScript pur (sans types, sans window) : couleurs, palettes, e-mail « e-carte ». Présentation uniquement. */
  function lxbEsc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function lxbHexOk(h) { return typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h.trim()); }
  function lxbH2r(h) { h = h.replace("#", ""); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function lxbR2h(r, gg, b) { return "#" + [r, gg, b].map(function (x) { return Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0"); }).join(""); }
  function lxbR2hsl(c) { var r = c[0] / 255, gg = c[1] / 255, b = c[2] / 255, M = Math.max(r, gg, b), m = Math.min(r, gg, b), h = 0, s = 0, l = (M + m) / 2; if (M !== m) { var d = M - m; s = l > .5 ? d / (2 - M - m) : d / (M + m); h = M === r ? (gg - b) / d + (gg < b ? 6 : 0) : M === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h *= 60; } return [h, s, l]; }
  function lxbHsl2h(h, s, l) { var k = function (n) { return (n + h / 30) % 12; }, a = s * Math.min(l, 1 - l), f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); }; return lxbR2h(f(0) * 255, f(8) * 255, f(4) * 255); }
  function lxbMix(a, b, t) { var A = lxbH2r(a), B = lxbH2r(b); return lxbR2h(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  function lxbLin(c) { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
  function lxbLum(h) { var c = lxbH2r(h); return .2126 * lxbLin(c[0]) + .7152 * lxbLin(c[1]) + .0722 * lxbLin(c[2]); }
  function lxbContraste(a, b) { var x = lxbLum(a), y = lxbLum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
  var LXB_PAPIER_A = "#F6F1E6", LXB_PAPIER_B = "#FBFAF7";
  // 2026-10-31 (-2) : palettes au choix de l'établissement (config_json.bonPalette). "" / "etab" = dérivée de sa couleur principale.
  // accent : liserés, filets (Maison) ; deep : aplat (Écrin) ; foil : dorure sur l'aplat ; ink / inkSoft : textes sur papier.
  var LXB_PALETTES = {
    etab:     { nom: "Couleur de l’établissement" },
    noir_or:  { nom: "Noir & or",        accent: "#C8A84E", deep: "#14120F", foil: "#C8A84E", ink: "#2B2418", inkSoft: "#6A5F4B" },
    bordeaux: { nom: "Bordeaux & or",    accent: "#8E2B3A", deep: "#3B1219", foil: "#D9B970", ink: "#4A1520", inkSoft: "#7A5A5E" },
    nuit:     { nom: "Bleu nuit & argent", accent: "#3B4F78", deep: "#121A2B", foil: "#C9D1DE", ink: "#1B2740", inkSoft: "#5A6478" },
    sauge:    { nom: "Vert sauge",       accent: "#7E9B83", deep: "#24312A", foil: "#CBD8C4", ink: "#23332A", inkSoft: "#5D6B60" },
    rose:     { nom: "Rose poudré",      accent: "#C98A93", deep: "#4E2C36", foil: "#EBC9CD", ink: "#4A2730", inkSoft: "#7D6064" },
    taupe:    { nom: "Taupe & or",       accent: "#A88B5C", deep: "#3A322A", foil: "#DCC287", ink: "#3A2E22", inkSoft: "#6E6253" }
  };
  function lxbPaletteValide(cle) { return (typeof cle === "string" && cle !== "etab" && Object.prototype.hasOwnProperty.call(LXB_PALETTES, cle)) ? cle : ""; }
  function lxbPalette(couleur, cle) {
    var P = LXB_PALETTES[lxbPaletteValide(cle)], acc, ink, inkSoft, deep, foil, h, s;
    if (P) {
      acc = P.accent; ink = P.ink; inkSoft = P.inkSoft; deep = P.deep; foil = P.foil;
      var hs = lxbR2hsl(lxbH2r(acc)); h = hs[0]; s = hs[1];
    } else {
      acc = lxbHexOk(couleur) ? ("#" + couleur.trim().replace("#", "")).toUpperCase() : "#C8A84E";
      var hsl = lxbR2hsl(lxbH2r(acc)); h = hsl[0]; s = hsl[1];
      var or = h >= 30 && h <= 60 && s > .25;                       // or / jaune : encre bronze, aplat noir chaud
      ink = or ? lxbHsl2h(h, .22, .13) : lxbHsl2h(h, Math.min(s, .5), .2);
      inkSoft = lxbHsl2h(h, Math.min(s, .18), .36);
      deep = or ? "#14120F" : lxbHsl2h(h, Math.min(s, .4), .14);
      foil = or ? acc : lxbHsl2h(h, Math.min(s, .5), .76);
    }
    // garde-fous de contraste (texte) : encre lisible sur le papier, dorure lisible sur l'aplat
    if (lxbContraste(ink, LXB_PAPIER_A) < 7) ink = lxbHsl2h(h, Math.min(s, .4), .16);
    if (lxbContraste(foil, deep) < 4.5) foil = lxbHsl2h(h, Math.min(s, .45), .82);
    // liserés / filets visibles même avec une couleur très claire (sans teinte : gris neutre)
    var accTrait = lxbContraste(acc, LXB_PAPIER_A) < 1.6 ? (s < .12 ? "#8A857C" : lxbHsl2h(h, Math.max(s, .3), .42)) : acc;
    var line = lxbMix(accTrait, LXB_PAPIER_A, .55); if (lxbContraste(line, LXB_PAPIER_A) < 1.2) line = lxbMix(accTrait, LXB_PAPIER_A, .3);
    return { accent: accTrait, accentBrut: acc, ink: ink, inkSoft: inkSoft, deep: deep, foil: foil, tint: lxbMix(acc, LXB_PAPIER_A, .9), line: line, paperA: LXB_PAPIER_A, paperB: LXB_PAPIER_B };
  }
  function lxbMontant(v) { var n = Number(v) || 0; return (Math.round(n * 100) % 100 === 0) ? String(Math.round(n)) : n.toFixed(2).replace(".", ","); }

  // E-carte (e-mail) au modèle de l'établissement : tableaux (Gmail / Outlook), sans police Google, QR = image hébergée
  // (https://luxyra.fr/api/qr, même générateur que l'application : les SVG sont mal affichés par les messageries).
  // o : {nom, sous, logo (https seulement), occasion, pour, de, msg, valeur, code, dateExp, perimetre, mentionTva, tkNum,
  //      couleur, palette, adresse, tel, siret, intro (texte, facultatif)} — tous les textes sont échappés ici.
  function lxbEmailCorps(modele, o) {
    modele = modele === "ecrin" ? "ecrin" : "maison";
    var p = lxbPalette(o.couleur, o.palette), E = lxbEsc;
    var nom = E(o.nom || ""), sous = E(o.sous || "");
    var logo = (typeof o.logo === "string" && /^https:\/\/[^\s"'<>]+$/i.test(o.logo)) ? o.logo : "";
    var serif = "'Cormorant Garamond',Georgia,'Times New Roman',serif", sans = (modele === "ecrin" ? "'DM Sans'," : "Inter,") + "Arial,Helvetica,sans-serif";
    var msg = o.msg && o.msg !== "Bon offert" ? E(o.msg) : "";
    var mt = lxbMontant(o.valeur), code = String(o.code || "");
    // 31/10 (-3, contre-audit R3) : QR par jeton opaque (le code du bon ne passe plus dans l'URL de l'image) quand l'appelant
    // (worker / edge) en fournit un ; sinon ancienne URL (compatibilité).
    var qr = (typeof o.qrUrl === "string" && /^https:\/\/luxyra\.fr\/api\/qr\/t\/[A-Za-z0-9_-]{24}$/.test(o.qrUrl)) ? o.qrUrl : "https://luxyra.fr/api/qr?d=" + encodeURIComponent(code) + "&s=160";
    var carte;
    if (modele === "maison") {
      carte = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:' + p.paperA + ';border:2px solid ' + p.accent + '">' +
        '<tr><td style="padding:5px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid ' + p.accent + '"><tr><td align="center" style="padding:30px 22px 26px;font-family:' + sans + ';color:#1C1A17">' +
        (logo ? '<img src="' + E(logo) + '" alt="" height="56" style="display:block;margin:0 auto 14px;height:56px;max-width:180px;border:0;border-radius:6px">' : "") +
        '<div style="font-family:' + serif + ';font-size:22px;letter-spacing:6px;text-transform:uppercase;color:' + p.ink + ';line-height:1.25">' + nom + "</div>" +
        (sous ? '<div style="font-size:10px;letter-spacing:4px;text-transform:uppercase;color:' + p.inkSoft + ';margin-top:6px">' + sous + "</div>" : "") +
        '<div style="width:34px;height:1px;background:' + p.accent + ';margin:18px auto 14px;font-size:0;line-height:0">&nbsp;</div>' +
        '<div style="font-family:' + serif + ';font-style:italic;font-size:20px;color:' + p.ink + '">' + (o.occasion ? E(o.occasion) : "Carte cadeau") + "</div>" +
        (o.pour ? '<div style="font-family:' + serif + ';font-size:30px;color:#1C1A17;margin-top:10px">' + E(o.pour) + ",</div>" : "") +
        '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:' + p.inkSoft + ';margin-top:8px">' + (o.de ? E(o.de) + " vous offre" : "Vous est offert") + "</div>" +
        '<div style="font-family:' + serif + ';font-weight:300;font-size:64px;line-height:1.05;color:' + p.ink + ';margin-top:6px">' + mt + '<span style="font-size:28px">&nbsp;€</span></div>' +
        '<div style="font-size:11px;letter-spacing:3px;text-transform:uppercase;color:' + p.inkSoft + '">à valoir chez ' + nom + "</div>" +
        (msg ? '<div style="font-family:' + serif + ';font-style:italic;font-size:18px;line-height:1.45;color:#3A352E;margin:18px auto 0;max-width:420px">« ' + msg + " »</div>" : "") +
        "</td></tr></table></td></tr></table>";
    } else {
      carte = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;background:' + p.deep + ';border-radius:12px">' +
        '<tr><td style="padding:26px 24px 8px;font-family:' + sans + ';color:#F4EFE6">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>' +
        (logo ? '<td style="padding-right:12px"><img src="' + E(logo) + '" alt="" height="40" style="display:block;height:40px;max-width:120px;border:0;border-radius:6px"></td>' : "") +
        '<td><div style="font-size:13px;letter-spacing:4px;text-transform:uppercase;color:#F4EFE6">' + nom + "</div>" + (sous ? '<div style="font-size:10px;letter-spacing:4px;text-transform:uppercase;color:' + p.foil + ';margin-top:4px">' + sous + "</div>" : "") + "</td></tr></table>" +
        "</td></tr>" +
        '<tr><td style="padding:18px 24px 6px;font-family:' + sans + ';color:#F4EFE6">' +
        (o.occasion ? '<div style="font-family:' + serif + ';font-style:italic;font-size:22px;color:' + p.foil + '">' + E(o.occasion) + "</div>" : "") +
        '<div style="font-size:14px;line-height:1.6;margin-top:6px">' + (o.pour ? 'Pour <b style="font-weight:600">' + E(o.pour) + "</b>" + (o.de ? ", " : "") : "") + (o.de ? 'de la part de <b style="font-weight:600">' + E(o.de) + "</b>" : "") + "</div>" +
        (msg ? '<div style="font-family:' + serif + ';font-style:italic;font-size:18px;line-height:1.45;color:#EDE6DA;margin-top:12px">« ' + msg + " »</div>" : "") +
        "</td></tr>" +
        '<tr><td style="padding:10px 24px 24px;font-family:' + sans + '"><table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse"><tr>' +
        '<td valign="bottom" style="font-size:11px;letter-spacing:4px;text-transform:uppercase;color:' + p.foil + ';padding-bottom:10px"><div style="width:30px;height:1px;background:' + p.foil + ';margin-bottom:10px;font-size:0;line-height:0">&nbsp;</div>Carte cadeau</td>' +
        '<td valign="bottom" align="right" style="font-weight:300;font-size:68px;line-height:1;color:#F4EFE6;letter-spacing:-2px">' + mt + '<span style="font-size:24px;color:' + p.foil + ';vertical-align:top;letter-spacing:0">€</span></td>' +
        "</tr></table></td></tr></table>";
    }
    // 31/10 (-2) : code du bon sur SA PROPRE ligne, pleine largeur, jamais coupé ; QR à côté des informations
    var infos = '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin-top:18px;border:1px solid #E6DFD0;background:#FFFFFF">' +
      '<tr><td colspan="2" style="padding:16px 18px 4px;font-family:' + sans + ';color:#1C1A17">' +
      '<div style="font-size:10px;letter-spacing:3px;text-transform:uppercase;color:#6A645B">Code de la carte</div>' +
      '<div style="font-size:20px;font-weight:700;letter-spacing:1.5px;margin-top:2px;color:#1C1A17;white-space:nowrap;word-break:keep-all">' + E(code) + "</div></td></tr>" +
      '<tr><td valign="top" style="padding:8px 18px 16px;font-family:' + sans + ';font-size:13px;line-height:1.6;color:#1C1A17">' +
      "<div><b>Valeur :</b> " + (Number(o.valeur) || 0).toFixed(2).replace(".", ",") + " €</div>" +
      "<div><b>Valable jusqu’au :</b> " + E(o.dateExp || "") + "</div>" +
      "<div><b>Utilisable sur :</b> " + E(o.perimetre || "Prestations et produits") + ", en une ou plusieurs fois</div>" +
      '</td><td valign="top" align="right" width="112" style="padding:6px 14px 16px 0"><img src="' + E(qr) + '" alt="QR ' + E(code) + '" width="96" height="96" style="display:block;border:0;background:#fff"></td></tr>' +
      '<tr><td colspan="2" style="padding:0 18px 16px;font-family:' + sans + ';font-size:11px;line-height:1.6;color:#6A645B;border-top:1px solid #EFE9DC">' +
      '<div style="padding-top:12px">' + E(o.mentionTva || "") + (o.tkNum ? " — ticket de caisse n°" + E(o.tkNum) : "") + "<br>Non remboursable, non échangeable contre espèces.</div></td></tr></table>";
    var intro = o.intro != null ? E(o.intro).replace(/\n/g, "<br>") : "Bonjour" + (o.de ? " " + E(o.de) : "") + ",<br>merci pour votre achat. Voici votre carte cadeau, à transmettre par e-mail ou à imprimer. Elle se présente sur place, sur papier ou sur téléphone.";
    var preheader = "Votre carte cadeau " + (o.nom || "") + " de " + mt + " € — code " + code;
    return '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + E(preheader) + "</div>" +
      '<div style="font-family:' + sans + ';font-size:14px;color:#4A453E;margin:0 0 16px;line-height:1.6">' + intro + "</div>" +
      carte + infos +
      '<div style="font-family:' + sans + ';font-size:12px;color:#6A645B;line-height:1.7;margin-top:16px">' + nom + (o.adresse ? " · " + E(o.adresse) : "") + (o.tel ? " · " + E(o.tel) : "") + (o.siret ? "<br>SIRET : " + E(o.siret) : "") + "</div>";
  }
  var LXB_EMAIL_POLICES = "<style>@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:300;src:url(https://luxyra.fr/fonts/cormorant-garamond-latin-300-normal.woff2) format('woff2')}@font-face{font-family:'Cormorant Garamond';font-style:italic;font-weight:400;src:url(https://luxyra.fr/fonts/cormorant-garamond-latin-400-italic.woff2) format('woff2')}@font-face{font-family:'Cormorant Garamond';font-style:normal;font-weight:400;src:url(https://luxyra.fr/fonts/cormorant-garamond-latin-400-normal.woff2) format('woff2')}</style>";
  /*LXB-PARTAGE>>*/
export const LX_OCCASIONS: Record<string,string> = { anniversaire:"Joyeux anniversaire", noel:"Joyeux Noël", feteMeres:"Bonne fête maman", stValentin:"Avec tout mon amour", roseGold:"Merci" };
export function buildBonHTMLModele(modele: "maison"|"ecrin", opts: { themeId:string; salonNom:string; salonSous?:string; salonAddr:string; salonTel:string; logoUrl:string|null; couleur?:string|null; palette?:string|null; qrUrl?:string; valeur:number; code:string; de:string; pour:string; message:string; dateExp:string; siret?:string; mentionTva:string; perimetre:string; tkNum?:number|null }): string {
  const corps = lxbEmailCorps(modele, {
    nom: opts.salonNom || "", sous: opts.salonSous || "", logo: opts.logoUrl || "", occasion: LX_OCCASIONS[opts.themeId] || "",
    pour: opts.pour || "", de: opts.de || "", msg: opts.message || "", valeur: opts.valeur, code: opts.code, dateExp: opts.dateExp,
    perimetre: opts.perimetre, mentionTva: opts.mentionTva, tkNum: opts.tkNum || null, couleur: opts.couleur || null, palette: opts.palette || "",
    adresse: opts.salonAddr || "", tel: opts.salonTel || "", siret: opts.siret || "", qrUrl: opts.qrUrl || ""
  });
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${LXB_EMAIL_POLICES}</head><body style="margin:0;padding:0">${lxMailLayout(corps, { titre: "Votre carte cadeau", salon: esc(opts.salonNom || "") || undefined })}</body></html>`;
}

function buildBonHTML(opts: { themeId:string; salonNom:string; salonAddr:string; salonTel:string; logoUrl:string|null; qrUrl?:string; valeur:number; code:string; de:string; pour:string; message:string; dateExp:string; siret?:string; mentionTva:string; perimetre:string; tkNum?:number|null }): string {
  const t = THEMES[opts.themeId] || THEMES.classique;
  const sNomCol = t.dark ? "#f5e9c3" : t.acc;
  const sSubCol = t.dark ? "rgba(255,255,255,.55)" : "rgba(0,0,0,.55)";
  const codeCol = t.dark ? "#f5e9c3" : t.acc;
  const codeBgCol = t.dark ? "rgba(0,0,0,.25)" : "rgba(255,255,255,.7)";
  const codeBorderCol = t.dark ? "rgba(245,233,195,.6)" : t.acc;
  const isScript = t.lf.indexOf("Dancing")>=0 || t.lf.indexOf("Vibes")>=0;
  const labelStyle = isScript
    ? `font-family:${t.lf};font-size:28px;color:${t.acc}`
    : `font-family:${t.lf};font-size:13px;letter-spacing:5px;text-transform:uppercase;color:${t.acc};font-weight:700`;
  const msgFontStyle = `font-family:${t.mf};font-style:italic;font-size:17px;color:${t.dark?"rgba(255,255,255,.7)":"rgba(0,0,0,.6)"}`;
  const logoBg = t.dark ? "#ffffff" : "rgba(255,255,255,.7)";
  const deco = t.dc ? `${t.dc}&nbsp;&nbsp;${t.dc}&nbsp;&nbsp;${t.dc}` : "";
  const corps = `
      <div style="font-size:13px;color:#666;margin-bottom:12px;text-align:center">Votre bon cadeau — à imprimer ou à présenter sur téléphone</div>
      <div style="border:3px solid ${t.bdr};background:${t.bg};border-radius:8px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.15)">
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
          <tr>
            <td width="180" valign="middle" style="padding:24px 16px;text-align:center;background:${t.bg};border-right:1px solid ${t.soft}">
              <div style="font-size:11px;letter-spacing:8px;color:${t.dcol};margin-bottom:10px">${deco}</div>
              ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="Logo" style="width:96px;height:96px;border-radius:12px;object-fit:contain;padding:8px;background:${logoBg};border:1.5px solid ${t.soft};display:block;margin:0 auto 12px">` : `<div style="width:96px;height:96px;border-radius:12px;background:${logoBg};border:1.5px solid ${t.soft};display:flex;align-items:center;justify-content:center;font-family:'Playfair Display',serif;font-size:32px;font-weight:800;color:${t.acc};margin:0 auto 12px">${esc((opts.salonNom||"S").charAt(0))}</div>`}
              <div style="font-family:'Playfair Display',serif;font-size:16px;font-weight:700;letter-spacing:1.5px;color:${sNomCol};text-align:center;line-height:1.2">${esc(opts.salonNom)}</div>
              <div style="font-size:11px;letter-spacing:6px;color:${t.dcol};margin-top:14px">${deco}</div>
            </td>
            <td valign="middle" style="padding:30px 24px;text-align:center;background:${t.bbg}">
              <div style="${labelStyle}">${esc(t.hl)}</div>
              <div style="height:1px;background:${t.soft};width:60%;margin:14px auto"></div>
              <div style="font-family:'Playfair Display',serif;font-weight:900;font-size:64px;color:${t.acc};line-height:1;margin:6px 0">${opts.valeur}<span style="font-size:32px;font-weight:600;margin-left:2px">€</span></div>
              <div style="height:1px;background:${t.soft};width:60%;margin:14px auto"></div>
              <div style="font-size:14px;color:${t.txt};margin:8px 0">De <strong>${esc(opts.de)}</strong>${opts.pour ? ` — Pour <strong>${esc(opts.pour)}</strong>` : ''}</div>
              ${opts.message ? `<div style="${msgFontStyle};margin:10px 16px;line-height:1.5">«&nbsp;${esc(opts.message)}&nbsp;»</div>` : ''}
              <table role="presentation" cellpadding="0" cellspacing="0" align="center" style="margin:16px auto 8px"><tr>
                <td valign="middle" style="padding-right:14px">
                  <div style="border:2px solid ${codeBorderCol};background:${codeBgCol};padding:10px 22px;font-family:'Courier New',monospace;font-size:18px;font-weight:800;letter-spacing:5px;color:${codeCol}">${esc(opts.code)}</div>
                </td>
                <td valign="middle">
                  <img src="${opts.qrUrl || qrUrl(opts.code)}" alt="QR ${esc(opts.code)}" width="70" height="70" style="background:#fff;padding:4px;border-radius:6px;display:block">
                </td>
              </tr></table>
              <div style="font-size:11px;color:${t.txt};font-weight:600;margin-top:6px">${opts.perimetre}</div>
              <div style="font-size:11px;color:${sSubCol};margin-top:3px">Valable jusqu'au <strong>${esc(opts.dateExp)}</strong></div>
            </td>
          </tr>
        </table>
        <div style="background:${t.fbg};padding:14px 24px;border-top:1px solid ${t.soft};color:${t.ftx};font-size:11px;line-height:1.7;text-align:center">
          <strong>${esc(opts.salonNom)}</strong>${opts.salonAddr ? ` • ${esc(opts.salonAddr)}` : ''}${opts.salonTel ? ` • ${esc(opts.salonTel)}` : ''}${opts.siret ? `<br>SIRET : ${esc(opts.siret)}` : ''}
          <br>${esc(opts.mentionTva)}${opts.tkNum ? ` — ticket de caisse n°${esc(opts.tkNum)}` : ''}
          <br>Utilisable en une ou plusieurs fois — Non remboursable, non échangeable contre espèces
        </div>
      </div>
      <div style="text-align:center;padding:20px;font-size:12px;color:#666;line-height:1.7">
        Présentez ce bon (papier ou écran) avec le code <strong>${esc(opts.code)}</strong> ou le QR ci-dessus en boutique.
        <br>Salon : <a href="https://luxyra.fr" style="color:#c8a84e">luxyra.fr</a>
      </div>`;
  return `<!doctype html><html><head><meta charset="utf-8"><link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Cormorant+Garamond:ital,wght@1,400;1,600&family=Dancing+Script:wght@400;700&family=Great+Vibes&family=Nunito:wght@400;700&display=swap" rel="stylesheet"></head><body style="margin:0;padding:0">${lxMailLayout(corps, { titre: "Votre bon cadeau", salon: opts.salonNom && opts.salonNom !== "Salon" ? esc(opts.salonNom) : undefined })}</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json(405, { error: "Method not allowed" });
  const sig = req.headers.get("stripe-signature") || "";
  const raw = await req.text();
  let event: any;
  try { event = JSON.parse(raw); } catch { return json(400, { error: "Invalid JSON" }); }
  const _interne = req.headers.get("x-lx-internal") || "";
  if (_interne && SB_SR && egalTempsConstant(_interne, SB_SR)) {
    // évènement déjà vérifié par le worker (relu chez Stripe au nom du compte du salon)
  } else if (WH_SECRET) {
    const ok = await verifyStripeSignature(raw, sig, WH_SECRET);
    if (!ok) {
      await reportError("Invalid Stripe signature", "warning", undefined, { sig_present: !!sig });
      return json(401, { error: "Invalid signature" });
    }
  } else {
    // Pas de secret configure : l'evenement est relu chez Stripe ; rien n'est cru sur parole.
    const relu = await relireEvenement(event);
    if (!relu) {
      await reportError("STRIPE_WEBHOOK_SECRET_GC absent et evenement non verifiable chez Stripe : refuse", "critical", undefined, { event_id: event?.id || null });
      return json(401, { error: "Evenement non verifiable" });
    }
    event = relu;
  }
  if (event.type !== "checkout.session.completed" && event.type !== "checkout.session.async_payment_succeeded") return json(200, { ok: true, skipped: true });
  const session = event.data?.object;
  if (!session || session.metadata?.type !== "bon_cadeau") return json(200, { ok: true, skipped: true });
  const bc_id = session.metadata.bc_id;
  const salon_id = session.metadata.salon_id;
  if (!bc_id || !salon_id) {
    await reportError("Webhook bon_cadeau sans bc_id/salon_id", "error", undefined, { metadata: session.metadata });
    return json(400, { error: "metadata invalide" });
  }
  if (session.payment_status && session.payment_status !== "paid") return json(200, { ok: true, skipped: "not_paid" });

  try {
    const [{ data: bon }, { data: salon }] = await Promise.all([
      sb.from("cartes_cadeaux").select("*").eq("id", bc_id).maybeSingle(),
      sb.from("salons").select("nom, sous_titre, adresse, cp, ville, tel, logo, slug, siret, taux_tva, couleur_primaire, config_json").eq("id", salon_id).maybeSingle()
    ]);
    if (!bon || !salon) {
      await reportError("Bon ou salon introuvable post-paiement Stripe", "critical", undefined, { bc_id, salon_id });
      return json(404, { error: "Bon ou salon introuvable" });
    }
    if (String(bon.salon_id || "") !== String(salon_id)) {
      await reportError("Bon cadeau : salon de la session different du salon du bon", "critical", undefined, { bc_id, salon_id });
      return json(400, { error: "metadata incoherente" });
    }
    if (bon.payment_status === "paid") return json(200, { ok: true, already: true });
    const attendu = Math.round(Number(bon.valeur) * 100);
    if (typeof session.amount_total === "number" && attendu > 0 && session.amount_total !== attendu) {
      await reportError("Bon cadeau : montant paye different de la valeur du bon", "critical", undefined, { bc_id, paye: session.amount_total, attendu });
      return json(400, { error: "montant incoherent" });
    }

    const pi = session.payment_intent || null;
    // 2026-10-28 (-2) : cette mise à jour crée aussi le ticket de caisse scellé de la vente (déclencheur zz_trg_cartes_cadeaux_recettes)
    const upd = await sb.from("cartes_cadeaux")
      .update({ payment_status: "paid", payment_intent_id: pi, paye_at: new Date((Number(event.created) > 0 ? Number(event.created) : Math.floor(Date.now() / 1000)) * 1000).toISOString() }) // 2026-10-28 (-3) : date Stripe
      .eq("id", bc_id).select("*").single();
    if (upd.error) {
      console.error("UPDATE paid échec", upd.error);
      await reportError("UPDATE cartes_cadeaux paid échec: " + upd.error.message, "critical", undefined, { bc_id, error_code: upd.error.code });
      return json(500, { error: "Erreur interne" });
    }
    const b = upd.data;
    const salonAddr = [salon.adresse, salon.cp, salon.ville].filter(Boolean).join(" ");
    const dateExp = b.date_expiration ? new Date(b.date_expiration).toLocaleDateString("fr-FR") : "";
    const mentionTva = lxBonMentionTva(b, salon.taux_tva);
    const perimetre = lxBonPerimetre(b.scope);

    // 2026-10-31 : modèle choisi par l'établissement (vide = e-mail historique)
    let modele: "maison"|"ecrin"|"" = "";
    let bonPalette = "";
    try { let c: any = (salon as any).config_json; if (typeof c === "string") c = JSON.parse(c); if (c && (c.bonModele === "maison" || c.bonModele === "ecrin")) modele = c.bonModele; if (c && typeof c.bonPalette === "string") bonPalette = lxbPaletteValide(c.bonPalette); } catch (_) { modele = ""; }
    // 2026-10-31 (-3, contre-audit bons v2 R3) : QR par jeton opaque (le code du bon n'est plus dans l'URL de l'image).
    let qrJ = "";
    try { const qj = await sb.rpc("lx_qr_jeton", { p_code: String(b.code || ""), p_salon: b.salon_id || null }); if (!qj.error && typeof qj.data === "string" && /^[A-Za-z0-9_-]{24}$/.test(qj.data)) qrJ = `https://luxyra.fr/api/qr/t/${qj.data}`; } catch (_) { qrJ = ""; }
    const buyerHtml = modele ? buildBonHTMLModele(modele, {
      themeId: b.theme_id || "classique",
      salonNom: salon.nom || "", salonSous: (salon as any).sous_titre || "", salonAddr, salonTel: salon.tel || "",
      logoUrl: salon.logo || null, couleur: (salon as any).couleur_primaire || null, palette: bonPalette, qrUrl: qrJ,
      valeur: Number(b.valeur), code: b.code,
      de: b.de || "", pour: b.pour || "", message: b.message || "",
      dateExp, siret: salon.siret || undefined,
      mentionTva, perimetre: (b.scope === "prestations" ? "Prestations" : (b.scope === "produits" ? "Produits" : "Prestations et produits")), tkNum: b.tk_num || null
    }) : buildBonHTML({
      themeId: b.theme_id || "classique",
      salonNom: salon.nom || "Salon", salonAddr, salonTel: salon.tel || "",
      logoUrl: salon.logo || null, qrUrl: qrJ,
      valeur: Number(b.valeur), code: b.code,
      de: b.de || "", pour: b.pour || "", message: b.message || "",
      dateExp, siret: salon.siret || undefined,
      mentionTva, perimetre, tkNum: b.tk_num || null
    });
    const subjectBuyer = modele ? `Votre carte cadeau ${salon.nom} — ${b.valeur} €` : `🎁 Votre bon cadeau ${b.valeur} € — ${salon.nom}`;
    const buyerText = `Bonjour,\n\nVotre bon cadeau de ${b.valeur} € chez ${salon.nom} est confirmé.\n\nCode : ${b.code}\nDe : ${b.de}${b.pour ? ` à ${b.pour}`: ''}\nValable jusqu'au ${b.date_expiration} — ${perimetre.replace("&amp;", "&")} du salon, en une ou plusieurs fois.\n${mentionTva}${b.tk_num ? ` (ticket de caisse n°${b.tk_num})` : ''}.\n\nPrésentez ce code (ou le QR de l'email) en boutique pour l'utiliser.\n\n${salon.nom}\n${salonAddr}`;
    await sendEmail({ to: b.buyer_email, toName: b.de, subject: subjectBuyer, htmlContent: buyerHtml, textContent: buyerText });

    try {
      await sb.from("notifications").insert({
        salon_id,
        type: "bon_cadeau_vente_ligne",
        title: `🎁 Bon cadeau ${b.valeur} € vendu en ligne`,
        detail: `Offert par ${b.de}${b.pour ? ` à ${b.pour}` : ''} · Code ${b.code} · ${b.buyer_email}${b.tk_num ? ` · ticket n°${b.tk_num}` : ''}`,
        source_table: "cartes_cadeaux",
        source_id: bc_id,
        data: { code: b.code, valeur: b.valeur, de: b.de, pour: b.pour, buyer_email: b.buyer_email, theme_id: b.theme_id || "classique", payment_intent_id: pi, tk_num: b.tk_num || null }
      });
    } catch(e) {
      console.warn("notifications insert fail", e);
      await reportError("notifications insert fail: " + (e as Error)?.message, "error", e as Error, { bc_id });
    }

    await sb.from("audit_log").insert({
      salon_id,
      action: "BON_CADEAU_ACHETE_LIGNE",
      details: `Bon ${b.code} ${b.valeur}€ (style ${b.theme_id||"classique"}) achete par ${b.de} (${b.buyer_email}) - Stripe ${pi||'?'}${b.tk_num ? ' - ticket #' + b.tk_num : ' - ticket en attente (voir recettes_en_ligne)'}`,
      operator_name: "Site public (Stripe)"
    });

    return json(200, { ok: true, bon_id: bc_id, tk_num: b.tk_num || null });
  } catch (e) {
    const err = e as Error;
    console.error("gc-stripe-webhook unexpected", err);
    await reportError("Exception non gérée: " + (err?.message || String(e)), "critical", err, { bc_id, salon_id, event_type: event.type });
    return json(500, { error: "Erreur interne" });
  }
});
