// Banc « e-mail client mal saisi » (30/10/2026) : lx-profile v11 (change_email, verify_email, get), lx-brevo-webhook v2,
// worker (/api/email/rejet-signale, notifier sur mesure), SQL email_client_rejete.sql, sur la base reconstruite depuis la prod.
import { creerBase, commeRole } from "./base.mjs";
import { seed, S, U, CL, C1, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
import { creerMonde, chargerEdge, appelEdge, appelWorker, SERVICE } from "./harness.mjs";
import { create, getNumericDate } from "./djwt/mod.mjs";
import fs from "node:fs";
import crypto from "node:crypto";

let nOk = 0, nKo = 0; const kos = [];
function ok(nom, cond, detail) { if (cond) nOk++; else { nKo++; kos.push(nom + (detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 500) : "")); } }
async function garde(nom, fn) { try { await fn(); } catch (e) { ok(nom + " (exception)", false, e.stack || e.message); } }

const { db } = await creerBase();
await seed(db);
await appliquerV2(db);
const SQL = fs.readFileSync("/sessions/quirky-affectionate-hypatia/wt-email/docs/migrations_1030_email/email_client_rejete.sql", "utf8");
await db.exec("set search_path = public, extensions;"); await db.exec(SQL);
await db.exec("set search_path = public, extensions;"); await db.exec(SQL); // rejouable
const monde = creerMonde(db);
monde.worker = (await import("./worker_bundle.mjs?" + Math.random())).default;
const profil = await chargerEdge("./edge_profile.mjs");
const webhook = await chargerEdge("./edge_webhook.mjs");
const propose = await chargerEdge("./edge_propose.mjs");
monde.jwts.set("jwt-A", { id: U, email: "pro-a@exemple.test" });
await db.query(`update salons set sms_credits = 50 where id=$1`, [S]);

const PASS = "Bonjour-Luxyra-2026";
function hash(p) { const salt = crypto.randomBytes(16); const h = crypto.pbkdf2Sync(p, salt, 120000, 32, "sha256").toString("hex"); return `pbkdf2$120000$${salt.toString("hex")}$${h}`; }
async function jeton(id, email, sv = 0) { const key = await globalThis.crypto.subtle.importKey("raw", new TextEncoder().encode(SERVICE), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]); return await create({ alg: "HS256", typ: "JWT" }, { lx_id: id, bp_id: id, email, sv, iat: getNumericDate(0), exp: getNumericDate(3600) }, key); }
const A = "dddddddd-dddd-4ddd-8ddd-dddddddddd01", B = "dddddddd-dddd-4ddd-8ddd-dddddddddd02", V = "dddddddd-dddd-4ddd-8ddd-dddddddddd03";
await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,telephone,email_verified,session_version) values
  ($1,'elise.test@laposte.fr',$4,'TESTEUR','Elise','0611111111',false,0),
  ($2,'deja.pris@exemple.test',$4,'AUTRE','Paul','0622222222',false,0),
  ($3,'verifiee@exemple.test',$4,'VERIF','Anne','0633333333',true,0)`, [A, B, V, hash(PASS)]);
const row = async (id) => (await db.query(`select * from clients_luxyra where id=$1`, [id])).rows[0];
let tokA = await jeton(A, "elise.test@laposte.fr");
const tokV = await jeton(V, "verifiee@exemple.test");

// ---------- SQL ----------
await garde("SQL", async () => {
  const c = await db.query(`select column_name from information_schema.columns where table_name='clients_luxyra' and column_name like 'email_rejet%' order by 1`);
  ok("SQL : 2 colonnes créées", c.rows.length === 2, c.rows);
  let err = null;
  try { await commeRole(db, "authenticated", A, () => db.query(`update clients_luxyra set email_rejete_at = now() where id=$1`, [A])); } catch (e) { err = e.message; }
  ok("SQL : un utilisateur connecté ne peut pas poser email_rejete_at", /email_rejete_at modifiable uniquement/.test(err || "") || /permission|policy|row-level/.test(err || "") || (await row(A)).email_rejete_at === null, err);
  err = null;
  try { await commeRole(db, "anon", null, () => db.query(`update clients_luxyra set email_rejet_motif = 'x' where id=$1`, [A])); } catch (e) { err = e.message; }
  ok("SQL : anon ne modifie rien", (await row(A)).email_rejet_motif === null, err);
});

// ---------- worker /api/email/rejet-signale ----------
await garde("W", async () => {
  let r = await appelWorker(monde, "/api/email/rejet-signale", { emails: ["elise.test@laposte.fr"] });
  ok("rejet-signale : appel non interne refusé (403)", r.status === 403, r);
  monde.brevoEvents = [];
  r = await appelWorker(monde, "/api/email/rejet-signale", { emails: ["elise.test@laposte.fr"] }, { "x-lx-internal": SERVICE });
  ok("rejet-signale : sans rejet réel chez Brevo -> rien marqué", r.status === 200 && (await row(A)).email_rejete_at === null && r.body.resultats[0].statut === "non_confirme", r);
  monde.brevoEvents = [{ email: "elise.test@laposte.fr", event: "delivered" }, { email: "autre@x.fr", event: "hardBounces" }];
  r = await appelWorker(monde, "/api/email/rejet-signale", { emails: ["elise.test@laposte.fr"] }, { "x-lx-internal": SERVICE });
  ok("rejet-signale : rejet d'une AUTRE adresse ne compte pas", (await row(A)).email_rejete_at === null, r);
  const n0 = monde.brevoEventsAppels || 0;
  r = await appelWorker(monde, "/api/email/rejet-signale", { emails: ["inconnu@exemple.test", "pas-une-adresse"] }, { "x-lx-internal": SERVICE });
  ok("rejet-signale : adresse sans compte Luxyra -> ignorée sans appel Brevo", r.body.resultats.length === 1 && r.body.resultats[0].statut === "ignore" && (monde.brevoEventsAppels || 0) === n0 && !JSON.stringify(r.body).includes("inconnu@"), r);
});

// ---------- webhook Brevo -> worker -> marquage ----------
await garde("H", async () => {
  monde.brevoEvents = [{ email: "elise.test@laposte.fr", event: "hardBounces", reason: "550 5.1.0 Address rejected" }];
  const e0 = (await db.query(`select count(*)::int n from server_errors where source='brevo_webhook'`)).rows[0].n;
  const r = await appelEdge(webhook, [{ event: "hard_bounce", email: "Elise.Test@laposte.fr", subject: "Confirmez votre adresse email Luxyra", reason: "550 5.1.0" }, { event: "opened", email: "x@y.fr" }]);
  const a = await row(A);
  ok("webhook : 200, événement journalisé, compte marqué", r.status === 200 && r.body.signales === 1 && a.email_rejete_at !== null && /Rejet définitif/.test(a.email_rejet_motif || "") && (await db.query(`select count(*)::int n from server_errors where source='brevo_webhook'`)).rows[0].n === e0 + 1, { r, a: { at: a.email_rejete_at, m: a.email_rejet_motif } });
  const r2 = await appelEdge(webhook, { event: "soft_bounce", email: "deja.pris@exemple.test" });
  ok("webhook : rejet temporaire -> pas de marquage", r2.status === 200 && !r2.body.signales && (await row(B)).email_rejete_at === null, r2);
  const at1 = (await row(A)).email_rejete_at;
  await appelEdge(webhook, { event: "hard_bounce", email: "elise.test@laposte.fr" });
  ok("webhook : 2e rejet -> date du 1er conservée", String((await row(A)).email_rejete_at) === String(at1));
});

// ---------- lx-profile get ----------
await garde("G", async () => {
  const r = await appelEdge(profil, { session_token: tokA, action: "get" });
  ok("get : email_rejete_at renvoyé, pas de motif ni de hash", r.status === 200 && r.body.user.email_rejete_at && r.body.user.password_hash === undefined && r.body.user.email_rejet_motif === undefined && r.body.user.verification_code === undefined, r.body);
});

// ---------- sur mesure : adresse rejetée -> SMS ----------
await garde("SM", async () => {
  const d = await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, demande_text, dispo_text, status)
    values ($1,'TESTEUR','Elise','0611111111','elise.test@laposte.fr',$2,'Couleur','Samedi','pending') returning id`, [S, A]);
  const e0 = monde.emails.length, s0 = monde.sms.length;
  const r = await appelEdge(propose, { demande_id: d.rows[0].id, options: [{ rang: 1, date: jour(20), heure: "10:00", collaborateur_id: C1, items: [{ type: "service", id: 9001 }], acompte_mode: "aucun" }] }, "jwt-A");
  ok("sur mesure : adresse rejetée -> pas d'e-mail, SMS avec le lien", r.status === 200 && r.body.envoi && r.body.envoi.email === "rejete" && r.body.envoi.sms === "envoye" && monde.emails.length === e0 && monde.sms.length === s0 + 1, { envoi: r.body && r.body.envoi, st: r.status, b: r.body });
  const d2 = await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, demande_text, dispo_text, status)
    values ($1,'M.','Julie','0600000000','julie@exemple.test','Coupe','Lundi','pending') returning id`, [S]);
  const r2 = await appelEdge(propose, { demande_id: d2.rows[0].id, options: [{ rang: 1, date: jour(21), heure: "10:00", collaborateur_id: C1, items: [{ type: "service", id: 9001 }], acompte_mode: "aucun" }] }, "jwt-A");
  ok("sur mesure : adresse normale -> e-mail comme avant", r2.status === 200 && r2.body.envoi.email === "envoye", r2.body && r2.body.envoi);
});

// ---------- lx-profile change_email ----------
let lienAvant = null;
await garde("C", async () => {
  // lien de confirmation existant (avant correction)
  const vieux = crypto.randomBytes(32).toString("hex");
  await db.query(`update clients_luxyra set verification_code=encode(extensions.digest($2,'sha256'),'hex'), verification_expires_at=now()+interval '1 day' where id=$1`, [A, vieux]);
  lienAvant = vieux;
  let r = await appelEdge(profil, { action: "change_email", new_email: "elise.test@laposte.net", password: PASS });
  ok("change_email : sans session -> 401", r.status === 401, r);
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "elise.test@laposte.net", password: "mauvais" });
  ok("change_email : mauvais mot de passe -> 401, rien changé", r.status === 401 && (await row(A)).email === "elise.test@laposte.fr", r);
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "elise.test@laposte.net" });
  ok("change_email : sans mot de passe -> 400", r.status === 400, r);
  for (const mauvaise of ["pas-une-adresse", "a@b", "a..b@gmail.com", "a@gmail..com", "<script>@x.fr", "a b@gmail.com", "x".repeat(195) + "@gmail.com"]) {
    r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: mauvaise, password: PASS });
    ok("change_email : forme refusée « " + mauvaise.slice(0, 20) + " »", r.status === 400, r);
  }
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "elise.test@laposte.fr", password: PASS });
  ok("change_email : même adresse -> 400", r.status === 400, r);
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "Deja.Pris@exemple.test", password: PASS });
  ok("change_email : adresse d'un autre compte (casse différente) -> 409", r.status === 409 && /déjà utilisée/.test(r.body.error) && (await row(A)).email === "elise.test@laposte.fr", r);
  r = await appelEdge(profil, { session_token: tokV, action: "change_email", new_email: "nouvelle@exemple.test", password: PASS });
  ok("change_email : adresse déjà confirmée -> 409, rien changé", r.status === 409 && (await row(V)).email === "verifiee@exemple.test", r);
  const svAvant = (await row(A)).session_version;
  const e0 = monde.emails.length;
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "  Elise.Test@LaPoste.net ", password: PASS });
  const a = await row(A);
  ok("change_email : OK (adresse en minuscules, non confirmée, marquage effacé)", r.status === 200 && a.email === "elise.test@laposte.net" && a.email_verified === false && a.email_rejete_at === null && a.email_rejet_motif === null, { r: r.body, a: { e: a.email, v: a.email_verified, rj: a.email_rejete_at } });
  ok("change_email : lien envoyé à la NOUVELLE adresse seulement", monde.emails.length === e0 + 1 && monde.emails[e0].to[0].email === "elise.test@laposte.net" && /compte\.html\?verif=[0-9a-f]{64}/.test(monde.emails[e0].htmlContent) && r.body.envoye === true, monde.emails.slice(e0).map((m) => m.to));
  ok("change_email : autres appareils déconnectés (ancien jeton refusé)", a.session_version === svAvant + 1 && (await appelEdge(profil, { session_token: tokA, action: "get" })).status === 401);
  ok("change_email : nouveau jeton valable, utilisateur renvoyé sans secret", !!r.body.session_token && (await appelEdge(profil, { session_token: r.body.session_token, action: "get" })).status === 200 && r.body.user.password_hash === undefined && r.body.user.verification_code === undefined);
  tokA = r.body.session_token;
  // ancien lien invalidé
  let rv = await appelEdge(profil, { action: "verify_email", token: lienAvant });
  ok("ancien lien de confirmation invalide après correction", rv.status === 400 && (await row(A)).email_verified === false, rv);
  // délai de 2 minutes
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "elise2@laposte.net", password: PASS });
  ok("change_email : 2e correction immédiate -> 429", r.status === 429 && (await row(A)).email === "elise.test@laposte.net", r);
  // fiche d'établissement : l'ancienne adresse ne doit jamais être rattachée, la nouvelle seulement après confirmation
  await db.query(`insert into clients(id, salon_id, nom, prenom, email) values ('99010000-0000-4000-8000-000000000001',$1,'TESTEUR','Elise','elise.test@laposte.net'), ('99020000-0000-4000-8000-000000000002',$1,'TESTEUR','Elise','elise.test@laposte.fr')`, [S]);
  ok("pas de rattachement avant confirmation", (await db.query(`select count(*)::int n from clients where client_luxyra_id=$1`, [A])).rows[0].n === 0);
  const lien = /verif=([0-9a-f]{64})/.exec(monde.emails[e0].htmlContent)[1];
  rv = await appelEdge(profil, { action: "verify_email", token: lien });
  const a2 = await row(A);
  ok("confirmation de la nouvelle adresse : vérifiée", rv.status === 200 && a2.email_verified === true && rv.body.email === "elise.test@laposte.net", rv);
  const liees = (await db.query(`select id from clients where client_luxyra_id=$1 order by id`, [A])).rows.map((x) => String(x.id));
  ok("rattachement : fiche de la nouvelle adresse seulement", liees.length === 1 && liees[0] === '99010000-0000-4000-8000-000000000001', liees);
  r = await appelEdge(profil, { session_token: tokA, action: "change_email", new_email: "encore@laposte.net", password: PASS });
  ok("après confirmation : plus de correction libre (409)", r.status === 409, r);
  // connexion avec la nouvelle adresse (même mot de passe)
  const ok2 = await (async () => { const [, it, salt, h] = a2.password_hash.split("$"); return crypto.pbkdf2Sync(PASS, Buffer.from(salt, "hex"), Number(it), 32, "sha256").toString("hex") === h; })();
  ok("mot de passe inchangé et valable", ok2);
});

// ---------- limite 5 par jour ----------
await garde("L", async () => {
  const tokB = await jeton(B, "deja.pris@exemple.test");
  await db.query(`update clients_luxyra set verification_envois=5, verification_jour=(now() at time zone 'utc')::date, verification_sent_at=now()-interval '1 hour' where id=$1`, [B]);
  const r = await appelEdge(profil, { session_token: tokB, action: "change_email", new_email: "paul@exemple.test", password: PASS });
  ok("change_email : 6e essai du jour -> 429", r.status === 429 && (await row(B)).email === "deja.pris@exemple.test", r);
  // tentatives de mot de passe limitées (8 échecs / 15 min)
  await db.query(`update clients_luxyra set verification_envois=0 where id=$1`, [B]);
  const tokB2 = await jeton(B, "x", (await row(B)).session_version);
  for (let i = 0; i < 8; i++) await appelEdge(profil, { session_token: tokB2, action: "change_email", new_email: "paul3@exemple.test", password: "faux" + i });
  const n = (await db.query(`select count(*)::int n from login_attempts where email='deja.pris@exemple.test' and not ok`)).rows[0].n;
  ok("change_email : chaque mauvais mot de passe est compté (blocage 15 min existant, compteur HEAD non simulé par le banc)", n >= 8, n);
});

// ---------- verify_email efface le marquage ----------
await garde("V", async () => {
  await db.query(`update clients_luxyra set email_rejete_at=now(), email_rejet_motif='x', email_verified=false, verification_code=encode(extensions.digest('${"a".repeat(64)}','sha256'),'hex'), verification_expires_at=now()+interval '1 day' where id=$1`, [B]);
  const rv = await appelEdge(profil, { action: "verify_email", token: "a".repeat(64) });
  const b = await row(B);
  ok("verify_email : marquage effacé à la confirmation", rv.status === 200 && b.email_verified === true && b.email_rejete_at === null && b.email_rejet_motif === null, rv);
});

// ---------- non-régression : actions existantes ----------
await garde("N", async () => {
  const avant = await chargerEdge("./edge_profile_avant.mjs");
  const tV = await jeton(V, "verifiee@exemple.test");
  for (const [nom, body] of [["get", { action: "get" }], ["send_verification (déjà vérifiée)", { action: "send_verification" }], ["update", { action: "update", ville: "Metz" }], ["toggle_notif", { action: "toggle_notif", field: "sms_ok", value: true }], ["action inconnue", { action: "zzz" }]]) {
    const r1 = await appelEdge(avant, Object.assign({ session_token: tV }, body));
    const r2 = await appelEdge(profil, Object.assign({ session_token: tV }, body));
    const norm = (x) => { const b = JSON.parse(JSON.stringify(x.body || {})); if (b.user) { delete b.user.email_rejete_at; delete b.user.updated_at; } return x.status + JSON.stringify(b); };
    ok("non-régression lx-profile : " + nom, norm(r1) === norm(r2), { avant: norm(r1).slice(0, 200), apres: norm(r2).slice(0, 200) });
  }
});

await garde("EN", async () => {
  const Z = "dddddddd-dddd-4ddd-8ddd-dddddddddd09";
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version) values ($1,'z@exemple.test',$2,'Z','Zoe',false,0)`, [Z, hash(PASS)]);
  const t = await jeton(Z, "z@exemple.test");
  let n409 = 0, last = 0;
  for (let i = 0; i < 7; i++) { const r = await appelEdge(profil, { session_token: t, action: "change_email", new_email: "verifiee@exemple.test", password: PASS }); if (r.status === 409) n409++; else last = r.status; }
  ok("énumération limitée : 5 refus « déjà utilisée » puis 429", n409 === 5 && last === 429 && (await row(Z)).email === "z@exemple.test", { n409, last });
});
monde.restaurer();
console.log(`E-mail client mal saisi : ${nOk}/${nOk + nKo} OK`);
if (kos.length) { console.log("ÉCHECS :\n- " + kos.join("\n- ")); process.exitCode = 1; }
