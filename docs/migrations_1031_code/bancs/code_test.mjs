// Banc « code à 6 chiffres à l'inscription client » (31/10/2026) : lx-signup v14 + code_inscription.sql, base reconstruite depuis la prod.
import { creerBase, commeRole } from "./base.mjs";
import { seed, S } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
import { creerMonde, chargerEdge, appelWorker, SERVICE, ANON } from "./harness.mjs";
import fs from "node:fs";
let nOk = 0, nKo = 0; const kos = [];
function ok(nom, cond, detail) { if (cond) nOk++; else { nKo++; kos.push(nom + (detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 500) : "")); } }
async function garde(nom, fn) { try { await fn(); } catch (e) { ok(nom + " (exception)", false, e.stack || e.message); } }
const W = "/sessions/quirky-affectionate-hypatia/wt-code/docs/";
const { db } = await creerBase();
await seed(db); await appliquerV2(db);
for (const f of ["migrations_1030_email/email_client_rejete.sql", "migrations_1030_email/verification_email.sql"]) { await db.exec("set search_path = public, extensions;"); await db.exec(fs.readFileSync(W + f, "utf8")); }
await db.exec("alter table public.client_password_resets add column if not exists email text;");
await db.exec("set search_path = public, extensions;"); await db.exec(fs.readFileSync(W + "migrations_1031_comptes/comptes_securite.sql", "utf8"));
const SQL = fs.readFileSync(W + "migrations_1031_code/code_inscription.sql", "utf8");
await db.exec("set search_path = public, extensions;"); await db.exec(SQL);
await db.exec("set search_path = public, extensions;"); await db.exec(SQL); // rejouable
const monde = creerMonde(db);
monde.worker = (await import("./worker_bundle_code.mjs?" + Math.random())).default;
const signup = await chargerEdge("./edge_signup_code.mjs");
monde.edges = { "lx-signup": signup };
let _ipn = 0;
async function appel(body, { bearer = ANON, ip = "203.0.113." + (++_ipn % 250) } = {}) {
  const h = { "Content-Type": "application/json", Authorization: "Bearer " + bearer, apikey: ANON }; if (ip) h["x-forwarded-for"] = ip + ", 10.0.0.1";
  const r = await signup(new Request("https://edge.test/", { method: "POST", headers: h, body: JSON.stringify(body) }));
  return { status: r.status, body: await r.json().catch(() => null) };
}
const dernierCode = () => { for (let i = monde.emails.length - 1; i >= 0; i--) { const m = JSON.stringify(monde.emails[i]).match(/code pour créer votre compte Luxyra : (\d{6})/); if (m) return m[1]; } return null; };
const champs = (email) => ({ email, password: "Un-Mot-De-Passe-Solide-91", nom: "TEST", prenom: "Nina", telephone: "0612345678", genre: "F", adresse: "1 rue A", cp: "57200", ville: "Sarreguemines", pays: "France" });
const compte = async (e) => (await db.query(`select * from clients_luxyra where email=$1`, [e])).rows[0];
const avance = async (e, sec) => db.query(`update clients_signup_codes set dernier_envoi = dernier_envoi - make_interval(secs => $2), expires_at = expires_at - make_interval(secs => $2), fenetre = fenetre - make_interval(secs => $2) where email=$1`, [e, sec]);

await garde("droits", async () => {
  const g = (await db.query(`select has_table_privilege('anon','public.clients_signup_codes','SELECT') a, has_table_privilege('authenticated','public.clients_signup_codes','SELECT') b, has_function_privilege('anon','public.lx_signup_code_verifier(text,text)','EXECUTE') c, has_function_privilege('authenticated','public.lx_signup_code_demander(text,text,text)','EXECUTE') d, has_table_privilege('anon','public.clients_signup_ip','SELECT') e`)).rows[0];
  ok("SQL : tables et fonctions fermées à anon/authenticated", !g.a && !g.b && !g.c && !g.d && !g.e, g);
});
await garde("nominal", async () => {
  const e = "nina.code@exemple.test"; const n0 = monde.emails.length;
  const r1 = await appel(champs(e));
  ok("étape 1 : 428 code_requis, aucun compte créé", r1.status === 428 && r1.body.code_requis === true && !(await compte(e)), r1);
  const m = JSON.stringify(monde.emails.slice(n0)); const code = dernierCode();
  ok("e-mail du code : 6 chiffres, style Luxyra (logo léger), sans prénom, « ignorez ce message »", !!code && /luxyra-logo-128\.png/.test(m) && !/Nina/.test(m) && /ignorez ce message/.test(m), m.slice(0, 300));
  ok("code stocké seulement en empreinte", !(await db.query(`select code_hash from clients_signup_codes where email=$1`, [e])).rows[0].code_hash.includes(code));
  const bad = await appel({ ...champs(e), code: code === "000000" ? "111111" : "000000" });
  ok("mauvais code : 400 code_faux, 4 essais restants, pas de compte", bad.status === 400 && bad.body.code_faux === true && bad.body.reste === 4 && !(await compte(e)), bad);
  const r2 = await appel({ ...champs(e), code });
  const u = await compte(e);
  ok("bon code : 200, compte créé CONFIRMÉ, jeton de session, sans mot de passe dans la réponse", r2.status === 200 && r2.body.session_token && u && u.email_verified === true && r2.body.user.email_verified === true && r2.body.user.password_hash === undefined && u.verification_code === null, r2);
  ok("aucun lien de confirmation envoyé (adresse déjà prouvée)", !/verif=/.test(JSON.stringify(monde.emails.slice(n0))));
  const r3 = await appel({ ...champs(e), code });
  ok("code à usage unique : rejouer -> refus, pas de doublon", r3.status === 400 || r3.status === 409, r3);
});
await garde("autolink", async () => {
  const e = "fiche.salon@exemple.test";
  await db.query(`insert into clients(id,salon_id,nom,prenom,email) values ('99770000-0000-4000-8000-000000000077',$1,'TEST','Nina',$2)`, [S, e]);
  await appel(champs(e)); const code = dernierCode();
  const r = await appel({ ...champs(e), code });
  const f = (await db.query(`select client_luxyra_id from clients where id='99770000-0000-4000-8000-000000000077'`)).rows[0];
  ok("rattachement de la fiche de l'établissement (même e-mail, nom, prénom) à la création confirmée", r.status === 200 && f.client_luxyra_id === r.body.user.id, { r: r.status, f });
});
await garde("existant-neutre", async () => {
  const e = "nina.code@exemple.test"; const n0 = monde.emails.length;
  await db.query(`update clients_signup_codes set dernier_envoi = now() - interval '2 minutes' where email=$1`, [e]);
  const r = await appel(champs(e));
  const m = JSON.stringify(monde.emails.slice(n0));
  ok("adresse déjà inscrite : MÊME réponse (428) et e-mail « vous avez déjà un compte » sans code", r.status === 428 && r.body.code_requis === true && /déjà un compte/.test(m) && !/code pour créer/.test(m), { r, m: m.slice(0, 200) });
  ok("réponse sans « déjà » ni « existe » (anciennes pages en cache)", !/d[eé]j[aà]|existe/i.test(r.body.error), r.body.error);
});
await garde("limites", async () => {
  const e = "limite@exemple.test";
  const a = await appel(champs(e)); const b = await appel(champs(e));
  ok("60 s entre deux envois : 2e demande -> 429 attente_s", a.status === 428 && b.status === 429 && b.body.attente_s > 0, b);
  await avance(e, 61); const c = await appel(champs(e)); await avance(e, 61); const d = await appel(champs(e)); await avance(e, 61); const f = await appel(champs(e));
  ok("3 envois / heure / adresse : 4e -> 429", c.status === 428 && d.status === 428 && f.status === 429 && /Trop de codes/.test(f.body.error), [c.status, d.status, f.status]);
  await db.query(`update clients_signup_codes set fenetre = now() - interval '61 minutes', dernier_envoi = now() - interval '61 minutes' where email=$1`, [e]);
  const g = await appel(champs(e));
  ok("après 1 h : de nouveau possible", g.status === 428, g);
});
await garde("brute-force", async () => {
  const e = "brute@exemple.test"; await appel(champs(e)); const code = dernierCode();
  const faux = String((Number(code) + 1) % 1000000).padStart(6, "0");
  let last; for (let i = 0; i < 5; i++) last = await appel({ ...champs(e), code: faux });
  ok("5 mauvais codes -> bloqué (429)", last.status === 429, last);
  const r = await appel({ ...champs(e), code });
  ok("même le bon code est refusé après 5 essais, aucun compte", r.status !== 200 && !(await compte(e)), r);
});
await garde("expiration", async () => {
  const e = "expire@exemple.test"; await appel(champs(e)); const code = dernierCode();
  await db.query(`update clients_signup_codes set expires_at = now() - interval '1 second' where email=$1`, [e]);
  const r = await appel({ ...champs(e), code });
  ok("code de plus de 15 min -> refusé (code_expire)", r.status === 400 && r.body.code_expire === true && !(await compte(e)), r);
});
await garde("autre-adresse", async () => {
  const e = "proprio@exemple.test"; await appel(champs(e)); const code = dernierCode();
  const r = await appel({ ...champs("intrus@exemple.test"), code });
  ok("code d'une adresse utilisé pour une autre -> refusé", r.status === 400 && !(await compte("intrus@exemple.test")), r);
});
await garde("ip", async () => {
  let st = []; for (let i = 0; i < 11; i++) st.push((await appel(champs("ip" + i + "@exemple.test"), { ip: "198.51.100.9" })).status);
  ok("10 envois / heure / IP : 11e -> 429", st.slice(0, 10).every((x) => x === 428) && st[10] === 429, st);
});
await garde("validation", async () => {
  const a = await appel({ ...champs("jöhn@exemple.test") });
  const b = await appel({ ...champs("court@exemple.test"), password: "court" });
  const c = await appel({ ...champs("valid@exemple.test"), code: "12ab56" });
  ok("adresse non ASCII / mot de passe court refusés AVANT tout envoi ; code non numérique refusé", a.status === 400 && b.status === 400 && c.status === 400 && !(await db.query(`select 1 from clients_signup_codes where email in ('court@exemple.test')`)).rows.length, [a.status, b.status, c.status]);
});
await garde("course", async () => {
  const e = "course@exemple.test"; await appel(champs(e)); const code = dernierCode();
  const [x, y] = await Promise.all([appel({ ...champs(e), code }), appel({ ...champs(e), code })]);
  const n = (await db.query(`select count(*)::int n from clients_luxyra where email=$1`, [e])).rows[0].n;
  ok("double envoi simultané du bon code : un seul compte", n === 1 && [x.status, y.status].filter((s) => s === 200).length === 1, [x.status, y.status, n]);
});
await garde("interne", async () => {
  const v = await appel({ action: "verif_interne" }, { bearer: SERVICE });
  const v2 = await appel({ action: "verif_interne" });
  ok("verif_interne : jeton service reconnu, anon non", v.body.interne === true && v2.body.interne === false, [v.body, v2.body]);
  const fiche = (await db.query(`update clients set client_luxyra_id=null where id=(select id from clients where salon_id=$1 and client_luxyra_id is not null order by id desc limit 1) returning id`, [S])).rows[0];
  const inv = (await db.query(`insert into client_invites(salon_id,client_id,email) values ($1,$2,'invite.code@exemple.test') returning token`, [S, fiche.id])).rows[0];
  const r = await appelWorker(monde, "/api/client/invite/verify", { token: inv.token, password: "Mdp-Invite-2026!Lx" });
  const u = await compte("invite.code@exemple.test");
  ok("non-régression invitation (worker -> lx-signup sans code) : compte créé et confirmé", r.status === 200 && u && u.email_verified === true, { r: r.status, b: r.body });
});
await garde("menage", async () => {
  await db.query(`insert into clients_signup_codes(email,cree_le,dernier_envoi) values ('vieux@exemple.test', now()-interval '3 days', now()-interval '3 days')`);
  await appel(champs("declencheur@exemple.test"));
  ok("ménage : lignes de plus de 2 jours supprimées", !(await db.query(`select 1 from clients_signup_codes where email='vieux@exemple.test'`)).rows.length);
});
monde.restaurer();
console.log(`Code d'inscription : ${nOk}/${nOk + nKo} OK`);
if (kos.length) { console.log("ÉCHECS :\n- " + kos.join("\n- ")); process.exitCode = 1; }
