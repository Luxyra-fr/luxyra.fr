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
await db.exec("alter table public.client_password_resets add column if not exists email text;");
await db.exec("set search_path = public, extensions;");
await db.exec(fs.readFileSync("/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/migrations_1030_email/verification_email.sql", "utf8"));
await db.exec("set search_path = public, extensions;");
await db.exec(fs.readFileSync("/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/migrations_1030_email/verification_email.sql", "utf8")); // rejouable
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
  const s1 = monde.sms.length;
  const rn = await appelWorker(monde, "/api/rdv-demande/notifier", { demande_id: d.rows[0].id, type: "proposition" }, { "x-lx-internal": SERVICE });
  ok("m4 : nouvel essai du notifier -> SMS non renvoyé (anti-doublon)", rn.status === 200 && rn.body.sms === "deja" && monde.sms.length === s1, { rn: rn.body, n: monde.sms.length - s1 });
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
  await db.query(`update clients_luxyra set email_rejete_at=now(), email_rejet_motif='x', email_verified=false, verification_code=encode(extensions.digest('${"a".repeat(64)}','sha256'),'hex'), verification_expires_at=now()+interval '1 day', verification_email=email where id=$1`, [B]);
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
// ---------- contre-audit B1 / M1 / M2 / m2 (30/10 soir) ----------
await db.exec("alter table public.client_password_resets add column if not exists email text;");
const reset = await chargerEdge("./edge_reset.mjs");
const dernierLien = (re) => { for (let i = monde.emails.length - 1; i >= 0; i--) { const m = JSON.stringify(monde.emails[i]).match(re); if (m) return m[1]; } return null; };
await garde("B1", async () => {
  const X = "dddddddd-dddd-4ddd-8ddd-dddddddddd21";
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version) values ($1,'attaquant@exemple.test',$2,'ATT','Max',false,0)`, [X, hash(PASS)]);
  const r1 = await appelEdge(reset, { action: "request", email: "attaquant@exemple.test" });
  const tok = dernierLien(/reset=([0-9a-f]{64})/);
  const rr = (await db.query(`select email, used_at from client_password_resets where client_id=$1`, [X])).rows;
  ok("B1 : le jeton de réinitialisation garde l'adresse d'envoi", r1.status === 200 && !!tok && rr.length === 1 && rr[0].email === "attaquant@exemple.test", { r1, rr });
  const tX = await jeton(X, "attaquant@exemple.test");
  const rc = await appelEdge(profil, { session_token: tX, action: "change_email", new_email: "victime@exemple.test", password: PASS });
  const rr2 = (await db.query(`select used_at from client_password_resets where client_id=$1`, [X])).rows;
  ok("B1a : change_email annule le jeton de réinitialisation en attente", rc.status === 200 && rr2[0].used_at !== null, { rc: rc.status, rr2 });
  const rf = await appelEdge(reset, { action: "confirm", token: tok, password: "Nouveau-Mdp-2026!x" });
  const x = await row(X);
  ok("B1 : l'ancien lien ne confirme JAMAIS la nouvelle adresse (email_verified reste false)", x.email_verified === false && x.email === "victime@exemple.test", { status: rf.status, body: rf.body, v: x.email_verified });
  // B1b : même si le jeton n'avait pas été annulé (course), confirm ne vérifie pas une adresse différente
  const tk2 = "b".repeat(64);
  await db.query(`insert into client_password_resets(client_id,email,token_hash,expires_at) values ($1,'attaquant@exemple.test',encode(extensions.digest($2,'sha256'),'hex'),now()+interval '1 hour')`, [X, tk2]);
  const rf2 = await appelEdge(reset, { action: "confirm", token: tk2, password: "Nouveau-Mdp-2026!y" });
  const x2 = await row(X);
  ok("B1b : jeton d'une autre adresse : mot de passe changé, adresse NON vérifiée", rf2.status === 200 && x2.email_verified === false, { rf2, v: x2.email_verified });
  // jeton ancien format (sans e-mail) : ne vérifie pas
  const tk3 = "c".repeat(64);
  await db.query(`insert into client_password_resets(client_id,token_hash,expires_at) values ($1,encode(extensions.digest($2,'sha256'),'hex'),now()+interval '1 hour')`, [X, tk3]);
  await appelEdge(reset, { action: "confirm", token: tk3, password: "Nouveau-Mdp-2026!z" });
  ok("B1c : jeton sans adresse (avant correctif) : pas de vérification", (await row(X)).email_verified === false);
});
await garde("B1-normal", async () => {
  const Y = "dddddddd-dddd-4ddd-8ddd-dddddddddd22";
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version) values ($1,'normal@exemple.test',$2,'NOR','Lea',false,0)`, [Y, hash(PASS)]);
  await appelEdge(reset, { action: "request", email: "normal@exemple.test" });
  const tok = dernierLien(/reset=([0-9a-f]{64})/);
  const rf = await appelEdge(reset, { action: "confirm", token: tok, password: "Nouveau-Mdp-2026!n" });
  const y = await row(Y);
  ok("non-régression : réinitialisation normale vérifie l'adresse et change le mot de passe", rf.status === 200 && rf.body.ok === true && y.email_verified === true && y.password_hash !== null, { rf });
  const rf2 = await appelEdge(reset, { action: "confirm", token: tok, password: "Nouveau-Mdp-2026!m" });
  ok("non-régression : lien à usage unique", rf2.status === 400, rf2);
});
await garde("M1", async () => {
  const W = "dddddddd-dddd-4ddd-8ddd-dddddddddd23";
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version) values ($1,'w@exemple.test',$2,'W','Marie',false,0)`, [W, hash(PASS)]);
  const n0 = monde.emails.length;
  const r = await appelEdge(profil, { session_token: await jeton(W, "w@exemple.test"), action: "change_email", new_email: "w2@exemple.test", password: PASS });
  const m = JSON.stringify(monde.emails.slice(n0));
  ok("M1 : e-mail de confirmation sans prénom + avertissement « ne cliquez pas »", r.status === 200 && !/Marie/.test(m) && /ne cliquez pas/.test(m), { st: r.status, m: m.slice(0, 300) });
});
await garde("m2", async () => {
  const t = await jeton(V, "verifiee@exemple.test");
  const r1 = await appelEdge(profil, { session_token: t, action: "update", prenom: "Cliquez https://evil.example" });
  const r2 = await appelEdge(profil, { session_token: t, action: "update", prenom: "x".repeat(81) });
  const r3 = await appelEdge(profil, { session_token: t, action: "update", prenom: "  Anne-Marie  " });
  ok("m2 : prénom avec lien ou trop long refusé, prénom normal accepté (espaces retirés)", r1.status === 400 && r2.status === 400 && r3.status === 200 && (await row(V)).prenom === "Anne-Marie", [r1.status, r2.status, r3.status]);
});
await garde("M2", async () => {
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version) values ('dddddddd-dddd-4ddd-8ddd-dddddddddd24','occupee@exemple.test',$1,'OCC','Bob',false,0)`, [hash(PASS)]);
  const fiche = (await db.query(`select id from clients where salon_id=$1 limit 1`, [S])).rows[0];
  if (!fiche) { ok("M2 : fiche client de test disponible", false); return; }
  await db.query(`update clients set client_luxyra_id=null where id=$1`, [fiche.id]);
  const inv = (await db.query(`insert into client_invites(salon_id,client_id,email) values ($1,$2,'occupee@exemple.test') returning token`, [S, fiche.id])).rows[0];
  const r = await appelWorker(monde, "/api/client/invite/verify", { token: inv.token, password: "Mdp-Invite-2026!" });
  const f = (await db.query(`select client_luxyra_id from clients where id=$1`, [fiche.id])).rows[0];
  ok("M2 : invitation vers une adresse portée par un compte NON confirmé : pas de rattachement (409)", r.status === 409 && f.client_luxyra_id === null && r.body.compte_non_confirme === true, { r, f });
  await db.query(`update clients_luxyra set email_verified=true where id='dddddddd-dddd-4ddd-8ddd-dddddddddd24'`);
  const inv2 = (await db.query(`insert into client_invites(salon_id,client_id,email) values ($1,$2,'occupee@exemple.test') returning token`, [S, fiche.id])).rows[0];
  const r2 = await appelWorker(monde, "/api/client/invite/verify", { token: inv2.token, password: "Mdp-Invite-2026!" });
  const f2 = (await db.query(`select client_luxyra_id from clients where id=$1`, [fiche.id])).rows[0];
  ok("non-régression M2 : compte confirmé -> fiche reliée (409 compte_existant)", r2.status === 409 && r2.body.compte_existant === true && f2.client_luxyra_id === "dddddddd-dddd-4ddd-8ddd-dddddddddd24", { r2, f2 });
});

// ---------- contre-audit 2 (30/10 nuit) : lien de confirmation lié à l'adresse (verification_email) ----------
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
await garde("C2-course", async () => {
  const Z = "dddddddd-dddd-4ddd-8ddd-dddddddddd31";
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version) values ($1,'a31@exemple.test',$2,'Z','Zoe',false,0)`, [Z, hash(PASS)]);
  const rc = await appelEdge(profil, { session_token: await jeton(Z, "a31@exemple.test"), action: "change_email", new_email: "victime31@exemple.test", password: PASS });
  ok("C2 : change_email lie le lien à la nouvelle adresse", rc.status === 200 && (await row(Z)).verification_email === "victime31@exemple.test", rc.status);
  // course simulée : un send_verification « en retard » écrit un code destiné à l'ANCIENNE adresse
  const tk = "e".repeat(64);
  await db.query(`update clients_luxyra set verification_code=$2, verification_email='a31@exemple.test', verification_expires_at=now()+interval '1 day' where id=$1`, [Z, sha(tk)]);
  const rv = await appelEdge(profil, { action: "verify_email", token: tk });
  ok("C2 : un lien parti à l'ancienne adresse ne confirme PAS la nouvelle", rv.status === 400 && (await row(Z)).email_verified === false, rv);
  // send_verification juste après change_email : refusé atomiquement (délai 2 min), aucun envoi
  const n0 = monde.emails.length;
  const rs = await appelEdge(profil, { session_token: rc.body.session_token, action: "send_verification" });
  ok("C2 : renvoi dans les 2 min refusé, aucun e-mail", rs.status === 429 && monde.emails.length === n0, rs.status);
  // send_verification alors que l'adresse a changé depuis la lecture : 0 ligne -> aucun envoi (filtre .eq(email))
  await db.query(`update clients_luxyra set verification_sent_at=now()-interval '1 hour' where id=$1`, [Z]);
  const okLien = await appelEdge(profil, { session_token: rc.body.session_token, action: "send_verification" });
  const lien = (() => { for (let i = monde.emails.length - 1; i >= 0; i--) { const m = JSON.stringify(monde.emails[i]).match(/verif=([0-9a-f]{64})/); if (m) return m[1]; } return null; })();
  const z = await row(Z);
  ok("C2 : renvoi normal -> lien lié à l'adresse actuelle, e-mail sans prénom", okLien.status === 200 && z.verification_email === "victime31@exemple.test" && !/Zoe/.test(JSON.stringify(monde.emails.at(-1))), okLien);
  const rv2 = await appelEdge(profil, { action: "verify_email", token: lien });
  ok("non-régression : le bon lien confirme l'adresse et efface verification_email", rv2.status === 200 && (await row(Z)).email_verified === true && (await row(Z)).verification_email === null, rv2);
});
await garde("C2-ancien-null", async () => {
  const Q = "dddddddd-dddd-4ddd-8ddd-dddddddddd32"; const tk = "f".repeat(64);
  await db.query(`insert into clients_luxyra(id,email,password_hash,nom,prenom,email_verified,session_version,verification_code,verification_expires_at,verification_sent_at) values ($1,'a32@exemple.test',$2,'Q','Quentin',false,0,$3,now()+interval '1 day',now())`, [Q, hash(PASS), sha(tk)]);
  const rv = await appelEdge(profil, { action: "verify_email", token: tk });
  ok("C2 : code récent sans verification_email -> refusé", rv.status === 400 && (await row(Q)).email_verified === false, rv);
  await db.query(`update clients_luxyra set verification_email=null, verification_sent_at='2026-10-29 10:00+00' where id=$1`, [Q]);
  await db.exec(fs.readFileSync("/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/migrations_1030_email/verification_email.sql", "utf8").replace(/^begin;|commit;/gm, ""));
  const rv2 = await appelEdge(profil, { action: "verify_email", token: tk });
  ok("C2 : code antérieur au 30/10 20:15 UTC repris par la migration -> accepté", rv2.status === 200 && (await row(Q)).email_verified === true, rv2);
});
await garde("C2-signup", async () => {
  const signup = await chargerEdge("./edge_signup.mjs");
  const n0 = monde.emails.length;
  const r = await appelEdge(signup, { email: "nouveau33@exemple.test", password: "Tres-Long-Mdp-2026!q", nom: "NOUV", prenom: "Visitez evil.fr" });
  const r2 = await appelEdge(signup, { email: "nouveau34@exemple.test", password: "Tres-Long-Mdp-2026!q", nom: "NOUV", prenom: "Sandra" });
  const u = (await db.query(`select verification_email from clients_luxyra where email='nouveau34@exemple.test'`)).rows[0];
  const m = JSON.stringify(monde.emails.slice(n0));
  ok("C2 : inscription -> lien lié à l'adresse, e-mail sans prénom", r2.status === 200 && u && u.verification_email === "nouveau34@exemple.test" && !/Sandra|evil\.fr/.test(m), { r: r.status, r2: r2.status, u, m: m.slice(0, 200) });
});
await garde("C2-invitation", async () => {
  const fiche = (await db.query(`update clients set client_luxyra_id=null where id=(select id from clients where salon_id=$1 order by id desc limit 1) returning id`, [S])).rows[0];
  if (!fiche) { ok("invitation : fiche libre disponible", false); return; }
  monde.edges = { "lx-signup": await chargerEdge("./edge_signup.mjs") };
  const inv = (await db.query(`insert into client_invites(salon_id,client_id,email) values ($1,$2,'invite35@exemple.test') returning token`, [S, fiche.id])).rows[0];
  const r = await appelWorker(monde, "/api/client/invite/verify", { token: inv.token, password: "Mdp-Invite-2026!Lx" });
  const u = (await db.query(`select id,email_verified,verification_email from clients_luxyra where email='invite35@exemple.test'`)).rows[0];
  const f = (await db.query(`select client_luxyra_id from clients where id=$1`, [fiche.id])).rows[0];
  ok("non-régression invitation : compte créé, confirmé (écriture conditionnelle), fiche reliée", r.status === 200 && u && u.email_verified === true && f.client_luxyra_id === u.id, { r: r.status, b: r.body, u, f });
});
await garde("C2-update", async () => {
  const t = await jeton(V, "verifiee@exemple.test");
  const a = await appelEdge(profil, { session_token: t, action: "update", telephone: "appelez-moi" });
  const b = await appelEdge(profil, { session_token: t, action: "update", avatar_url: "https://evil.example/x.png" });
  const c = await appelEdge(profil, { session_token: t, action: "update", prenom: "evil.fr" });
  const d = await appelEdge(profil, { session_token: t, action: "update", adresse: "x".repeat(201) });
  const e = await appelEdge(profil, { session_token: t, action: "update", telephone: "06 12 34 56 78", ville: "Sarreguemines", cp: "57200", adresse: "20 rue Nationale" });
  ok("C2 : champs de update bornés (téléphone, avatar, domaine nu, adresse) ; valeurs normales acceptées", [a, b, c, d].every((x) => x.status === 400) && e.status === 200, [a.status, b.status, c.status, d.status, e.status]);
});
monde.restaurer();
console.log(`E-mail client mal saisi : ${nOk}/${nOk + nKo} OK`);
if (kos.length) { console.log("ÉCHECS :\n- " + kos.join("\n- ")); process.exitCode = 1; }
