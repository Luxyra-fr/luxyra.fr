// Test navigateur (Chromium sans affichage) de la page client « Votre proposition » branchée sur le VRAI code :
// edge rdv-demande-proposal-action v14 / v13, worker (connect-pay, finalize), base PGlite reconstruite depuis la production.
// Stripe Checkout simulé (la page de paiement marque la session payée puis renvoie vers success_url).
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { creerBase } from "./base.mjs";
import { seed, S, U, CL, C1, C2, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
import { creerMonde, chargerEdge, appelEdge, SERVICE } from "./harness.mjs";
const require = createRequire("/sessions/quirky-affectionate-hypatia/shot/x.js");
const puppeteer = require("puppeteer-core");
const chromium = (await import(require.resolve("@sparticuz/chromium"))).default;
const ROOT = "/sessions/quirky-affectionate-hypatia/wt-surmesure", OUT = process.argv[2] || "/tmp/sm/shots";
fs.mkdirSync(OUT, { recursive: true });
let nOk = 0, nKo = 0; const kos = [];
const ok = (n, c, d) => { if (c) nOk++; else { nKo++; kos.push(n + (d !== undefined ? " :: " + JSON.stringify(d).slice(0, 400) : "")); } };

const { db } = await creerBase(); await seed(db); await appliquerV2(db);
const monde = creerMonde(db);
monde.worker = (await import("./worker_bundle.mjs?" + Math.random())).default;
const propose = await chargerEdge("./edge_propose.mjs");
const action = await chargerEdge("./edge_action.mjs");
const action13 = await chargerEdge("./edge_action_v13.mjs");
monde.jwts.set("jwt-A", { id: U });
let k = 0;
async function demande(email = "julie@exemple.test") {
  return (await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, demande_text, dispo_text, status) values ($1,'M.','Julie','0600000000',$2,$3,'Couleur ou mèches coupe cheveux mi long','Après 15h30','pending') returning id`, [S, email, CL])).rows[0].id;
}
async function proposer(opts) { const id = await demande(); const r = await appelEdge(propose, { demande_id: id, options: opts }, "jwt-A"); if (r.status !== 200) throw new Error("propose " + JSON.stringify(r)); return { id, token: r.body.proposal_token, options: r.body.options }; }
const A = (x) => Object.assign({ rang: 1, libelle: "Couleur + coupe", date: jour(30 + (k++)), heure: "15:30", collaborateur_id: C1, items: [{ type: "service", id: 9003 }], acompte_mode: "aucun", note: "Couleur ton sur ton pour raviver vos reflets" }, x || {});
const B = (x) => Object.assign({ rang: 2, libelle: "Mèches + coupe", date: jour(30 + (k++)), heure: "12:30", collaborateur_id: C1, items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, note: "Les mèches demandent un peu moins de 3 h. Venez avec les cheveux secs, merci !" }, x || {});

const TYPES = { ".js": "application/javascript", ".css": "text/css", ".png": "image/png", ".woff2": "font/woff2", ".woff": "font/woff", ".html": "text/html; charset=utf-8" };
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, "--lang=fr-FR"], headless: true });
async function page(vp) {
  const pg = await b.newPage();
  await pg.setViewport(vp || { width: 1440, height: 1050 });
  await pg.setRequestInterception(true);
  pg.errors = [];
  pg.on("pageerror", (e) => pg.errors.push(e.message.slice(0, 200)));
  pg.on("dialog", (d) => d.accept());
  pg.on("request", async (r) => {
    try {
      const u = new URL(r.url());
      if (u.hostname === "luxyra.fr" && u.pathname.startsWith("/__sb/functions/v1/")) {
        const nom = u.pathname.split("/").pop(); const h = nom === "rdv-demande-proposal-action" ? (pg.v13 ? pg.v13 : action) : null;
        if (!h) return r.respond({ status: 404, body: "{}" });
        const rep = await h(new Request("https://edge.test/", { method: "POST", headers: { "Content-Type": "application/json" }, body: r.postData() || "{}" }));
        return r.respond({ status: rep.status, contentType: "application/json", body: await rep.text() });
      }
      if (u.hostname === "luxyra.fr" && u.pathname.startsWith("/api/")) {
        const rep = await monde.worker.fetch(new Request(r.url(), { method: r.method(), headers: { "Content-Type": "application/json" }, body: r.method() === "POST" ? (r.postData() || "{}") : undefined }), monde.env, { waitUntil() {} });
        return r.respond({ status: rep.status, contentType: "application/json", body: await rep.text() });
      }
      if (u.hostname === "checkout.stripe.test") {
        const id = u.pathname.slice(1); const s = monde.stripe.sessions.get(id);
        if (pg.stripeAbandon) return r.respond({ status: 302, headers: { Location: s.params.cancel_url } });
        monde.payer(id);
        return r.respond({ status: 302, headers: { Location: s.success_url.replace("{CHECKOUT_SESSION_ID}", id) } });
      }
      if (u.hostname === "luxyra.fr") {
        const p = path.join(ROOT, u.pathname === "/" ? "index.html" : u.pathname);
        if (fs.existsSync(p) && fs.statSync(p).isFile()) {
          let body = fs.readFileSync(p);
          if (u.pathname === "/proposal.html") body = Buffer.from(String(body).replace('var SB_URL="https://kxdgjtvrkwugbifgppai.supabase.co";', 'var SB_URL="https://luxyra.fr/__sb";'));
          return r.respond({ status: 200, contentType: TYPES[path.extname(p)] || "application/octet-stream", body });
        }
        return r.respond({ status: 404, body: "" });
      }
      return r.abort();
    } catch (e) { console.log("route", e.message); return r.abort(); }
  });
  return pg;
}
const txt = (pg) => pg.evaluate(() => document.getElementById("root").innerText);
const attendre = (pg, re, ms = 8000) => pg.waitForFunction((s) => new RegExp(s).test(document.getElementById("root").innerText), { timeout: ms }, re.source).then(() => true).catch(() => false);

// 1) ordinateur : 2 options, choix de B avec acompte -> Stripe (simulé) -> confirmation + ticket
{
  const p = await proposer([A(), B()]);
  const pg = await page();
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p.token, { waitUntil: "domcontentloaded" });
  ok("page : options affichées", await attendre(pg, /vous propose 2 rendez-vous/));
  const t1 = await txt(pg);
  ok("page (maquette 3) : demande, options A/B, dates, total, sans acompte / acompte, notes", /Votre demande : « Couleur ou mèches/.test(t1) && /Option A/.test(t1) && /Option B/.test(t1) && /Total/.test(t1) && /Sans acompte/.test(t1) && /Acompte à régler en ligne : 24,00 €/.test(t1) && /Reste à payer au salon : 56,00 €/.test(t1) && /Venez avec les cheveux secs/.test(t1) && /Refuser et écrire au salon/.test(t1) && /Proposition valable jusqu'au/.test(t1), t1.slice(0, 600));
  await pg.evaluate((id) => v2Choisir(id), p.options[1].id);
  const t2 = await txt(pg);
  ok("sélection B : barre « Payer 24,00 € et confirmer », créneau revérifié", /Option B sélectionnée/.test(t2) && /Payer 24,00 € et confirmer/.test(t2) && /revérifié au moment du paiement/.test(t2), t2.slice(-400));
  await pg.screenshot({ path: OUT + "/3-client-ordinateur.png" });
  const tk0 = (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;
  await Promise.all([pg.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), pg.click("#v2go")]);
  await pg.waitForFunction(() => /paid=success/.test(location.search) || /Rendez-vous confirmé/.test(document.body.innerText), { timeout: 10000 }).catch(() => {});
  ok("retour de Stripe : « Rendez-vous confirmé »", await attendre(pg, /Rendez-vous confirmé/, 12000), await txt(pg).catch(() => ""));
  const t3 = await txt(pg);
  ok("confirmation (maquette 4) : récapitulatif, acompte payé, reste, reçu d'acompte, option libérée", /Acompte payé\s*24,00 €/.test(t3) && /Reste au salon\s*56,00 €/.test(t3) && /Reçu d'acompte n° 900001/.test(t3) && /L'option A a été libérée/.test(t3) && /Calendrier/.test(t3) && /Itinéraire/.test(t3) && /Mon espace Luxyra/.test(t3), t3);
  const tk1 = (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;
  ok("ticket d'acompte scellé créé (1)", tk1 === tk0 + 1, { tk0, tk1 });
  ok("URL nettoyée après le paiement", await pg.evaluate(() => !/session_id/.test(location.search)));
  await pg.screenshot({ path: OUT + "/4-client-confirmation.png" });
  ok("aucune erreur JavaScript (paiement)", pg.errors.length === 0, pg.errors);
  await pg.close();
}
// 2) téléphone : choix de A sans acompte -> confirmé tout de suite
{
  const p = await proposer([A(), B()]);
  const pg = await page({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p.token, { waitUntil: "domcontentloaded" });
  await attendre(pg, /Option A/);
  const m = await pg.evaluate(() => ({ d: getComputedStyle(document.querySelector(".v2opt .v2d")).display, m: getComputedStyle(document.querySelector(".v2opt .v2m")).display, w: document.documentElement.scrollWidth }));
  ok("téléphone (maquette 4) : cartes compactes, pas de débordement", m.d === "none" && m.m === "block" && m.w <= 391, m);
  await pg.evaluate((id) => v2Choisir(id), p.options[1].id);
  await pg.screenshot({ path: OUT + "/4-client-telephone-choix.png" });
  await pg.evaluate((id) => v2Choisir(id), p.options[0].id);
  const bt = await pg.evaluate(() => document.getElementById("v2go").innerText);
  ok("option sans acompte : bouton « Confirmer ce rendez-vous »", /Confirmer ce rendez-vous/.test(bt), bt);
  await pg.click("#v2go");
  ok("sans acompte : confirmé immédiatement", await attendre(pg, /Rendez-vous confirmé/));
  const d = (await db.query(`select status from rdv_demandes where id=$1`, [p.id])).rows[0].status;
  ok("base : demande confirmée", d === "confirmed", d);
  ok("aucune erreur JavaScript (téléphone)", pg.errors.length === 0, pg.errors);
  await pg.close();
}
// 3) paiement abandonné (retour « annuler ») puis autre option ; créneau pris entre-temps
{
  const p = await proposer([A({ heure: "16:00" }), B({ heure: "10:00" })]);
  const pg = await page();
  pg.stripeAbandon = true;
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p.token, { waitUntil: "domcontentloaded" });
  await attendre(pg, /Option B/);
  await pg.evaluate((id) => v2Choisir(id), p.options[1].id);
  await Promise.all([pg.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => {}), pg.click("#v2go")]);
  await attendre(pg, /Option B sélectionnée/);
  ok("paiement abandonné : retour sur la proposition, option B toujours sélectionnée", /Option B sélectionnée/.test(await txt(pg)), (await txt(pg)).slice(-300));
  // contre-audit (a) : au retour, la page fait expirer la session abandonnée chez Stripe ; le paiement en cours est effacé
  await new Promise((r) => setTimeout(r, 500));
  const dd = (await db.query(`select checkout_session_id from rdv_demandes where id=$1`, [p.id])).rows[0];
  const sAb = [...monde.stripe.sessions.values()].filter((x) => x.metadata && x.metadata.proposal_token === p.token).pop();
  ok("a : retour « annuler » depuis Stripe : session expirée chez Stripe tout de suite, plus de paiement en cours", dd.checkout_session_id === null && sAb && sAb.status === "expired", { dd, st: sAb && sAb.status });
  // un autre client prend le créneau de A
  await db.query(`insert into appointments(id, salon_id, collab_id, date_rdv, heure, a_phases, status) values (gen_random_uuid(),$1,$2,$3,'16:00','[{"t":"w","d":30}]','conf')`, [S, C1, p.options[0].date_rdv]);
  await pg.evaluate((id) => v2Choisir(id), p.options[0].id);
  await pg.click("#v2go");
  await new Promise((r) => setTimeout(r, 1200));
  const t = await txt(pg);
  ok("créneau pris entre-temps : message clair, option marquée, autre option possible", /vient d'être pris/.test(t) && /Créneau pris entre-temps/.test(t), t.slice(-500));
  ok("aucune erreur JavaScript (créneau pris)", pg.errors.length === 0, pg.errors);
  await pg.close();
}
// 4) refus avec message ; proposition expirée ; ancien format (v13 = v14)
{
  const p = await proposer([A()]);
  const pg = await page();
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p.token, { waitUntil: "domcontentloaded" });
  await attendre(pg, /Option A/);
  await pg.evaluate(() => openRefuseModal());
  await pg.type("#refuseReason", "Je préfère un samedi matin");
  await pg.click("#refuseBtn");
  ok("refus : page « Proposition refusée »", await attendre(pg, /Proposition refusee|refus/i));
  const d = (await db.query(`select status, refuse_reason from rdv_demandes where id=$1`, [p.id])).rows[0];
  ok("refus : message transmis à l'établissement", d.status === "refused" && d.refuse_reason === "Je préfère un samedi matin", d);
  const p2 = await proposer([A()]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [p2.id]);
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p2.token, { waitUntil: "domcontentloaded" });
  ok("proposition expirée : page dédiée, rien débité", await attendre(pg, /Proposition expirée/));
  // ancien format
  const id3 = await demande(), tok = "v1v1v1v1v1v1v1v1v1v1v1v1v1v1v1v1";
  await db.query(`update rdv_demandes set status='proposed', proposal_token=$2, proposal_expires_at=now()+interval '72 hours', proposed_at=now(), proposed_data=$3 where id=$1`, [id3, tok,
    JSON.stringify({ date: jour(60), heure: "10:00", collaborateur_id: C2, collaborateur_nom: "Manue", items: [{ service_id: 9001, nom: "COUPE BRUSHING COURT", prix: 30, duree: 30 }], prix_total: 30, duree_minutes: 30, acompte_montant: 0 })]);
  await pg.goto("https://luxyra.fr/proposal.html?t=" + tok, { waitUntil: "domcontentloaded" });
  ok("ancien format : page d'origine (une proposition)", await attendre(pg, /vous propose un rendez-vous personnalise/));
  await pg.evaluate(() => confirmFree());
  ok("ancien format : confirmation d'origine", await attendre(pg, /RDV confirme/));
  ok("aucune erreur JavaScript (refus / expirée / ancien format)", pg.errors.length === 0, pg.errors);
  await pg.close();
}
// 5) contre-audit : clavier (i), liens « Refuser » avec adresse, compatibilité de déploiement (page v2 + fonction serveur v13)
{
  const p = await proposer([A({ heure: "09:00" }), B({ heure: "14:00" })]);
  const pg = await page();
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p.token, { waitUntil: "domcontentloaded" });
  await attendre(pg, /Option B/);
  const r0 = await pg.evaluate(() => ({ grp: !!document.querySelector('[role="radiogroup"]'), radios: document.querySelectorAll('.v2opt[role="radio"][tabindex="0"]').length,
    liens: [...document.querySelectorAll('a')].filter((a) => /Refuser/.test(a.innerText)).map((a) => a.getAttribute("href")) }));
  await pg.focus('.v2opt[tabindex="0"]'); await pg.keyboard.press("ArrowRight"); await pg.keyboard.press("Enter");
  const sel = await pg.evaluate(() => ({ sel: V2.sel, act: document.activeElement && document.activeElement.getAttribute("data-id"), aria: [...document.querySelectorAll('.v2opt')].map((e) => e.getAttribute("aria-checked")) }));
  ok("i : cartes d'options = groupe de boutons radio, sélection au clavier (flèche + Entrée)", r0.grp && r0.radios === 2 && sel.sel === p.options[1].id && sel.act === p.options[1].id && sel.aria[1] === "true", { r0, sel });
  ok("i : liens « Refuser » avec adresse (href) et rôle bouton", r0.liens.length >= 1 && r0.liens.every((h) => h && h.length > 1), r0.liens);
  await pg.evaluate(() => { const a = [...document.querySelectorAll('a')].find((x) => /Refuser et écrire/.test(x.innerText)); a.click(); });
  ok("i : lien « Refuser » ouvre la fenêtre de refus", await pg.evaluate(() => !!document.getElementById("refuseModal")));
  // fonction serveur de l'ANCIEN format (v13) face à une proposition v2 (pendant un déploiement / retour arrière) : message, aucun bouton
  const p1 = await proposer([A({ heure: "11:00" }), B({ heure: "15:00" })]);
  pg.v13 = action13;
  await pg.goto("https://luxyra.fr/proposal.html?t=" + p1.token, { waitUntil: "domcontentloaded" });
  ok("compat : page v2 + fonction serveur v13 sur une proposition v2 -> « momentanément indisponible », aucun bouton", await attendre(pg, /momentanément indisponible/) && (await pg.evaluate(() => document.querySelectorAll("#root button").length)) === 0, await txt(pg));
  // page v2 + fonction v13 sur une proposition de l'ancien format : affichage d'origine
  const id3 = await demande(), tok = "v1v1v1v1v1v1v1v1v1v1v1v1v1v1v1v2";
  await db.query(`update rdv_demandes set status='proposed', proposal_token=$2, proposal_expires_at=now()+interval '72 hours', proposed_at=now(), proposed_data=$3 where id=$1`, [id3, tok,
    JSON.stringify({ date: jour(61), heure: "10:00", collaborateur_id: C2, collaborateur_nom: "Manue", items: [{ service_id: 9001, nom: "COUPE BRUSHING COURT", prix: 30, duree: 30 }], prix_total: 30, duree_minutes: 30, acompte_montant: 0 })]);
  await pg.goto("https://luxyra.fr/proposal.html?t=" + tok, { waitUntil: "domcontentloaded" });
  ok("compat : page v2 + fonction serveur v13 sur l'ancien format : page d'origine", await attendre(pg, /vous propose un rendez-vous personnalise/));
  pg.v13 = null;
  ok("aucune erreur JavaScript (clavier / compatibilité)", pg.errors.length === 0, pg.errors);
  await pg.close();
}
await b.close();
monde.restaurer();
console.log(`Navigateur — page client « Votre proposition » : ${nOk}/${nOk + nKo} OK`);
if (kos.length) console.log("ÉCHECS :\n- " + kos.join("\n- "));
process.exit(nKo ? 1 : 0);
