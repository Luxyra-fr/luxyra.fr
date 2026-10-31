// Banc navigateur de l'application (mode démo) : choix palette, fenêtre d'impression (formats A4), e-carte, partager.
// node bons_v2_app.mjs <racine> <port> <captures>
import fs from "fs"; import path from "path"; import chromium from "@sparticuz/chromium"; import puppeteer from "puppeteer-core";
const ROOT = process.argv[2], PORT = process.argv[3] || "8790", OUT = process.argv[4] || "/tmp/livre2"; fs.mkdirSync(OUT, { recursive: true });
let ok = 0, ko = 0; const t = (n, c, d) => { if (c) ok++; else { ko++; console.log("KO", n, d !== undefined ? JSON.stringify(d).slice(0, 400) : ""); } };
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
for (const [w, h, nom] of [[1280, 900, "ordinateur"], [390, 844, "telephone"]]) {
  const pg = await b.newPage(); await pg.setViewport({ width: w, height: h });
  await pg.setRequestInterception(true); let envoi = null;
  pg.on("request", r => { const u = r.url();
    if (u.indexOf("/api/email/custom") >= 0) { envoi = JSON.parse(r.postData() || "{}"); return r.respond({ status: 200, contentType: "application/json", body: JSON.stringify({ success: true, messageId: "x", journalise: true }) }); }
    if (u.startsWith("http://localhost") || u.startsWith("data:") || u.startsWith("blob:")) return r.continue();
    if (u.startsWith("https://luxyra.fr/")) { const p = path.join(ROOT, new URL(u).pathname); if (fs.existsSync(p) && fs.statSync(p).isFile()) return r.respond({ status: 200, contentType: p.endsWith(".js") ? "application/javascript" : "application/octet-stream", body: fs.readFileSync(p) }); }
    r.abort(); });
  const errs = []; pg.on("pageerror", e => errs.push(e.message)); pg.on("dialog", d => d.dismiss());
  await pg.goto(`http://localhost:${PORT}/app.html?demo=coiffure`, { waitUntil: "domcontentloaded" });
  await pg.waitForFunction(() => window.CURRENT_OPERATOR && window.LXBon && typeof lxBonChoisirModele === "function" && window.GC, { timeout: 40000 });
  await new Promise(r => setTimeout(r, 1200));
  await pg.evaluate(() => { [...document.body.children].forEach(e => { if (getComputedStyle(e).position === "fixed" && /DÉMO/.test(e.innerText || "")) e.style.display = "none"; }); });
  // fenêtre de choix : palettes visibles quand un modèle est choisi
  const r1 = await pg.evaluate(() => { window.lxCfgEcrireSections = async function(o){ window.__ecrit = o; return true; }; window.auditLog = function(){};
    lxBonChoisirModele(); window._lxBonModeleChoix = "ecrin"; window._lxBonPaletteChoix = "bordeaux"; _lxBonRendreChoix();
    const m = document.getElementById("modal"); return { pal: (m.innerText.match(/Bordeaux & or|Bleu nuit|Vert sauge|Rose poudré|Taupe|Noir & or|Couleur de l’établissement/g) || []).length, cartes: m.querySelectorAll(".lxbB").length }; });
  t(`${nom} : 7 palettes proposées`, r1.pal === 7, r1); t(`${nom} : aperçu recto/verso`, r1.cartes === 2, r1);
  await pg.screenshot({ path: OUT + `/app_choix_palette_${nom}.png` });
  await pg.evaluate(async () => { await lxBonEnregistrerModele(); });
  const r2 = await pg.evaluate(() => ({ e: window.__ecrit, m: SALON_CONFIG.bonModele, p: SALON_CONFIG.bonPalette }));
  t(`${nom} : modèle + palette enregistrés`, r2.e && r2.e.bonModele === "ecrin" && r2.e.bonPalette === "bordeaux" && r2.p === "bordeaux", r2);
  // fenêtre d'impression d'un bon actif
  const r3 = await pg.evaluate(() => {
    let g = GC.find(x => x.st === "active" && Number(x.rem) > 0); if (!g) { g = { id: "gtest", code: "BC-TEST1", val: 50, rem: 50, st: "active", from: "Camille", to: "Léa", exp: "2027-12-31", buyerEmail: "lea@exemple.test" }; GC.push(g); }
    window.__g = g.id; _lxBonChoixImpression(g); const m = document.getElementById("modal");
    return { txt: m.innerText, boutons: [...m.querySelectorAll("button")].map(b => b.innerText.split("\n")[0]) };
  });
  for (const lib of ["Carte pliée en deux", "Carte 85 × 55 mm", "Carte A6 avec message", "Bon pleine page", "Envoyer l’e-carte", "Partager"]) t(`${nom} : bouton « ${lib} »`, r3.boutons.indexOf(lib) >= 0, r3.boutons);
  await pg.screenshot({ path: OUT + `/app_imprimer_${nom}.png` });
  // e-carte : saisie + envoi (intercepté)
  await pg.evaluate(() => { lxBonEcarte(window.__g); document.getElementById("lxEcMail").value = "lea@exemple.test"; });
  await pg.screenshot({ path: OUT + `/app_ecarte_saisie_${nom}.png` });
  // en démo, le réseau est simulé : on capte l'appel à sendEmailViaWorker (chemin réel = /api/email/custom, banc worker à part)
  const cap = await pg.evaluate(async () => { let c = null; const o = window.sendEmailViaWorker; window.sendEmailViaWorker = async function(to, nm, sub, html, opts){ c = { to, sub, html, opts }; return { ok: true, journalise: true }; };
    const dm = window._lxDemo; window._lxDemo = false; await lxBonEcarteEnvoyer(window.__g); window._lxDemo = dm; window.sendEmailViaWorker = o; return c; });
  envoi = cap ? { to: cap.to, context: cap.opts.context, dedupKey: cap.opts.dedupKey, htmlContent: cap.html } : null;
  t(`${nom} : e-carte envoyée par /api/email/custom`, envoi && envoi.to === "lea@exemple.test" && envoi.context === "bon_ecarte" && /\|ecarte\|/.test(envoi.dedupKey || "") && /Votre carte cadeau/.test(envoi.htmlContent || ""), envoi && { to: envoi.to, c: envoi.context, k: envoi.dedupKey });
  // bon annulé : refus
  const r4 = await pg.evaluate(() => { const g = { id: "gann", code: "BC-ANN", val: 20, rem: 20, st: "cancelled" }; GC.push(g); return _lxBonEcarteAutorise(g); });
  t(`${nom} : e-carte refusée pour un bon annulé`, r4.ok === false, r4);
  const r5 = await pg.evaluate(() => _lxBonEcarteAutorise({ id: "u", code: "x", val: 20, rem: 0, st: "active" }));
  t(`${nom} : e-carte refusée pour un bon épuisé`, r5.ok === false, r5);
  t(`${nom} : aucune erreur JS`, errs.length === 0, errs);
  await pg.close();
}
await b.close(); console.log(`Banc app bons v2 : ${ok}/${ok + ko} OK`); process.exit(ko ? 1 : 0);
