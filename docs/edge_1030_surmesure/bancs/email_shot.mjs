import { createRequire } from "node:module";
import fs from "node:fs";
import { creerBase } from "./base.mjs";
import { seed, S, U, CL, C1, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
import { creerMonde, chargerEdge, appelEdge } from "./harness.mjs";
const require = createRequire("/sessions/quirky-affectionate-hypatia/shot/x.js");
const puppeteer = require("puppeteer-core"); const chromium = (await import(require.resolve("@sparticuz/chromium"))).default;
const { db } = await creerBase(); await seed(db); await appliquerV2(db);
const monde = creerMonde(db); monde.worker = (await import("./worker_bundle.mjs")).default;
const propose = await chargerEdge("./edge_propose.mjs"); monde.jwts.set("jwt-A", { id: U });
const id = (await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, demande_text, status) values ($1,'M.','Julie','06','julie@exemple.test',$2,'Couleur ou mèches coupe cheveux mi long','pending') returning id`, [S, CL])).rows[0].id;
await appelEdge(propose, { demande_id: id, options: [
  { rang: 1, libelle: "Couleur + coupe", date: jour(4), heure: "15:30", collaborateur_id: C1, items: [{ type: "service", id: 9003 }], acompte_mode: "aucun" },
  { rang: 2, libelle: "Mèches + coupe", date: jour(8), heure: "12:30", collaborateur_id: C1, items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, note: "Les mèches demandent un peu moins de 3 h. Venez avec les cheveux secs, merci !" }] }, "jwt-A");
const m = monde.emails[monde.emails.length - 1];
fs.writeFileSync("/tmp/sm/shots/5-email.html", m.htmlContent);
monde.restaurer();
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: chromium.args, headless: true });
const pg = await b.newPage(); await pg.setViewport({ width: 720, height: 1300 });
await pg.setRequestInterception(true); pg.on("request", (r) => r.url().startsWith("data:") || r.url().startsWith("about:") ? r.continue() : r.url().includes("luxyra-logo-128") ? r.respond({ status: 200, contentType: "image/png", body: fs.readFileSync("/sessions/quirky-affectionate-hypatia/wt-surmesure/email/luxyra-logo-128.png") }) : r.abort());
await pg.setContent(m.htmlContent, { waitUntil: "load" }); await pg.screenshot({ path: "/tmp/sm/shots/5-email-nouvelle-proposition.png", fullPage: true });
await b.close(); console.log("sujet:", m.subject, "| expéditeur:", m.sender.name, "| texte:", m.textContent.length, "car.");
