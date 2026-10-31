// Banc bons cadeaux v2 (31/10 -2) : palettes, e-carte (e-mail), formats A4, XSS. node bons_v2_test.mjs <racine dépôt> <dossier captures>
import fs from "fs"; import path from "path";
import chromium from "@sparticuz/chromium"; import puppeteer from "puppeteer-core";
const ROOT = process.argv[2], OUT = process.argv[3] || "/tmp/livre2"; fs.mkdirSync(OUT, { recursive: true });
let ok = 0, ko = 0; const t = (n, c, d) => { if (c) ok++; else { ko++; console.log("KO", n, d !== undefined ? JSON.stringify(d).slice(0, 300) : ""); } };
const js = fs.readFileSync(path.join(ROOT, "lx-bon-cadeau.js"), "utf8"), qr = fs.readFileSync(path.join(ROOT, "lx-qrcode.js"), "utf8");
// QR des e-mails : servi par le vrai code du worker (/api/qr) si WORKER_MJS est fourni (sinon image absente, banc hors ligne)
let worker = null; if (process.env.WORKER_MJS) { try { worker = (await import(process.env.WORKER_MJS)).default; } catch (e) { console.log("worker non chargé", e.message); } }
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
async function page(w, h) {
  const pg = await b.newPage(); await pg.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await pg.setRequestInterception(true);
  pg.on("request", async r => { const u = r.url(); if (u.startsWith("data:") || u === "about:blank") return r.continue();
    if (worker && u.startsWith("https://luxyra.fr/api/qr")) { const rr = await worker.fetch(new Request(u), {}, { waitUntil() {}, passThroughOnException() {} }); return r.respond({ status: 200, contentType: "image/gif", body: Buffer.from(await rr.arrayBuffer()) }); }
    if (u.startsWith("https://luxyra.fr/")) { const p = path.join(ROOT, new URL(u).pathname); if (fs.existsSync(p) && fs.statSync(p).isFile()) return r.respond({ status: 200, body: fs.readFileSync(p) }); }
    r.abort(); });
  pg.errs = []; pg.on("pageerror", e => pg.errs.push(e.message)); pg.on("dialog", d => d.dismiss());
  await pg.setContent('<html><head><meta charset="utf-8"></head><body style="margin:0;background:#e9e4d8"><div id="z"></div><script>' + qr + "</script><script>" + js + "</script></body></html>");
  return pg;
}
const logo = "data:image/svg+xml;base64," + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="110"><rect width="200" height="110" fill="#111"/><text x="100" y="62" fill="#c8a84e" font-size="26" text-anchor="middle" font-family="Georgia">EXCELLENCE</text></svg>').toString("base64");
const BON = { code: "BC-7K4Q2M", val: 80, de: "Camille", pour: "Medico social 3s", msg: "Joyeux anniversaire ma Léa !", exp: "31/10/2027", scope: "Prestations et produits", tva: "TVA 20 % incluse", tk: "1842", occasion: "Joyeux anniversaire" };
const ETAB = { nom: "Excellence Coiffure", sous: "by Amandine J.", adresse: "20 rue Nationale", cpv: "57200 Sarreguemines", tel: "03 87 00 00 00", logo, couleur: "#7a2e3a" };

// 1) Palettes : contrastes et rendu de toutes les palettes, deux modèles
{
  const pg = await page(1500, 900);
  const r = await pg.evaluate((BON, ETAB) => {
    const z = document.getElementById("z"); z.style.cssText = "display:grid;grid-template-columns:repeat(4,auto);gap:10px;padding:12px";
    LXBon.poserCss(); const res = [];
    for (const k of Object.keys(LXBon.PALETTES)) { const cle = k === "etab" ? "" : k; const p = LXBon.palette(ETAB.couleur, cle);
      res.push({ k, inkPapier: LXBon.contraste(p.ink, p.paperA), foilDeep: LXBon.contraste(p.foil, p.deep) });
      for (const m of ["maison", "ecrin"]) { const e = Object.assign({}, ETAB, { palette: cle }); const d = document.createElement("div"); d.innerHTML = LXBon.carte(m, "recto", BON, e, { mm: 2.6 }) ; z.appendChild(d); const d2 = document.createElement("div"); d2.innerHTML = LXBon.carte(m, "verso", BON, e, { mm: 2.6 }); z.appendChild(d2); } }
    return { res, cle_inconnue: LXBon.paletteValide("xx"), etab: LXBon.paletteValide("etab"), versionOk: LXBon.version };
  }, BON, ETAB);
  for (const x of r.res) { t("contraste encre/papier " + x.k, x.inkPapier >= 7, x); t("contraste dorure/aplat " + x.k, x.foilDeep >= 4.5, x); }
  t("palette inconnue ignorée", r.cle_inconnue === "" && r.etab === "", r);
  t("aucune erreur JS (palettes)", pg.errs.length === 0, pg.errs);
  await pg.screenshot({ path: OUT + "/palettes_maison_ecrin.png", fullPage: true });
}
// 2) E-carte : desktop + téléphone, code sur une ligne, QR image luxyra.fr/api/qr, palettes
for (const [w, nom] of [[700, "ordinateur"], [390, "telephone"]]) for (const m of ["maison", "ecrin"]) {
  const pg = await page(w, 900);
  const r = await pg.evaluate((m, BON, ETAB) => {
    const o = { nom: ETAB.nom, sous: ETAB.sous, logo: "https://luxyra.fr/email/luxyra-logo-128.png", occasion: BON.occasion, pour: BON.pour, de: BON.de, msg: BON.msg, valeur: 80, code: BON.code, dateExp: BON.exp, perimetre: "Prestations et produits", mentionTva: "TVA 20 % incluse, due à l'achat du bon", tkNum: 1842, couleur: ETAB.couleur, palette: m === "ecrin" ? "nuit" : "", adresse: "20 rue Nationale 57200 Sarreguemines", tel: ETAB.tel, siret: "123" };
    const html = LXBon.emailDocument(m, o); document.open(); document.write(html); document.close();
    const cd = [...document.querySelectorAll("div")].find(d => d.textContent === BON.code);
    return { lignes: cd ? Math.round(cd.getBoundingClientRect().height / parseFloat(getComputedStyle(cd).lineHeight || 24)) : -1, h: cd ? cd.getBoundingClientRect().height : -1,
      qr: [...document.images].some(i => i.src.indexOf("https://luxyra.fr/api/qr?d=BC-7K4Q2M") === 0), svg: !!document.querySelector("svg"), scripts: document.querySelectorAll("script").length };
  }, m, BON, ETAB);
  t(`e-carte ${m} ${nom} : code sur une ligne`, r.h > 0 && r.h < 34, r);
  t(`e-carte ${m} ${nom} : QR image luxyra.fr/api/qr`, r.qr && !r.svg, r);
  t(`e-carte ${m} ${nom} : aucun script`, r.scripts === 0, r);
  await pg.screenshot({ path: OUT + `/ecarte_${m}_${nom}.png`, fullPage: true });
}
// 3) Formats A4 : une seule page, bonnes dimensions (PDF)
for (const m of ["maison", "ecrin"]) for (const f of ["plie", "carte", "a6a4", "pleine", "a6"]) {
  const pg = await page(900, 1200);
  await pg.evaluate((m, f, BON, ETAB) => { const h = LXBon.documentImpression(m, BON, Object.assign({}, ETAB, { palette: m === "ecrin" ? "bordeaux" : "" }), f); document.open(); document.write(h); document.close(); }, m, f, BON, ETAB);
  await new Promise(r => setTimeout(r, 400));
  const pdf = await pg.pdf({ preferCSSPageSize: true, printBackground: true });
  fs.writeFileSync("/tmp/_b.pdf", pdf); const info = (await import("child_process")).execSync("pdfinfo /tmp/_b.pdf").toString();
  const pages = +((info.match(/Pages:\s+(\d+)/) || [])[1] || 0); const mb = info.match(/Page size:\s+([\d.]+) x ([\d.]+)/);
  const wmm = mb ? +mb[1] * 25.4 / 72 : 0, hmm = mb ? +mb[2] * 25.4 / 72 : 0;
  const attendu = f === "a6" ? (m === "ecrin" ? [148, 105] : [105, 148]) : (f === "pleine" && m === "ecrin" ? [297, 210] : [210, 297]);
  t(`PDF ${m}/${f} : 1 page`, pages === 1, pages);
  t(`PDF ${m}/${f} : format ${attendu.join("x")}`, Math.abs(wmm - attendu[0]) < 1.5 && Math.abs(hmm - attendu[1]) < 1.5, [wmm, hmm]);
  fs.writeFileSync(OUT + `/impression_${m}_${f}.pdf`, pdf);
  if (f === "plie" || f === "pleine" || f === "a6a4") await pg.screenshot({ path: OUT + `/impression_${m}_${f}.png`, fullPage: true });
}
// 4) XSS : charges malveillantes partout (carte, A6, e-mail, documents d'impression)
{
  const pg = await page(900, 900);
  const X = '"><img src=x onerror="window.__x=1">\'</script><script>window.__x=1</script>';
  const r = await pg.evaluate((X, logo) => {
    window.__x = 0; LXBon.poserCss();
    const bon = { code: X, val: 50, de: X, pour: X, msg: X, exp: X, scope: X, tva: X, tk: X, occasion: X };
    const etab = { nom: X, sous: X, adresse: X, cpv: X, tel: X, logo: 'https://x"onerror="window.__x=1', couleur: X, palette: X };
    const z = document.getElementById("z"); let html = "";
    for (const m of ["maison", "ecrin"]) { html += LXBon.carte(m, "recto", bon, etab, {}) + LXBon.carte(m, "verso", bon, etab, {}) + LXBon.a6(m, bon, etab, {}); }
    z.innerHTML = html;
    const docs = []; for (const m of ["maison", "ecrin"]) { for (const f of ["plie", "carte", "a6a4", "pleine", "a6"]) docs.push(LXBon.documentImpression(m, bon, etab, f)); docs.push(LXBon.emailDocument(m, { nom: X, sous: X, logo: 'https://x"onerror="window.__x=1', occasion: X, pour: X, de: X, msg: X, valeur: 1, code: X, dateExp: X, perimetre: X, mentionTva: X, tkNum: X, couleur: X, palette: X, adresse: X, tel: X, siret: X, intro: X })); }
    const bad = docs.filter(d => /<img src=x|<script>window/.test(d)).length;
    docs.forEach(d => { const f = document.createElement("iframe"); f.srcdoc = d; document.body.appendChild(f); });
    return new Promise(res => setTimeout(() => res({ x: window.__x, bad, inline: /<img src=x|<script>window/.test(z.innerHTML), framesX: [...document.querySelectorAll("iframe")].some(f => { try { return f.contentWindow.__x === 1; } catch (e) { return false; } }) }), 1200));
  }, X, logo);
  t("XSS : aucune exécution (carte/A6)", r.x === 0 && !r.inline, r);
  t("XSS : aucune balise brute dans les documents (impression + e-mail)", r.bad === 0, r);
  t("XSS : aucune exécution dans les documents", !r.framesX, r);
}
await b.close();
console.log(`Banc bons v2 : ${ok}/${ok + ko} OK`); process.exit(ko ? 1 : 0);
