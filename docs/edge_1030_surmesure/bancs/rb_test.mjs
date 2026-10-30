import fs from "node:fs";
import { creerBase, commeRole } from "./base.mjs";
import { seed, S, U, C1, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
const { db } = await creerBase(); await seed(db); await appliquerV2(db);
const id = (await commeRole(db, "service_role", null, () => db.query(`insert into rdv_demandes(salon_id, client_nom, client_tel, demande_text, status) values ($1,'M.','06','x','pending') returning id`, [S]))).rows[0].id;
await commeRole(db, "service_role", null, () => db.query(`select lx_demande_proposer($1,$2,$3,72,false)`, [id, U, JSON.stringify([{ rang: 1, date: jour(9), heure: "10:00", collaborateur_id: C1, items: [{ type: "service", id: 9001 }], acompte_mode: "aucun" }])]));
let ok = 0, n = 0; const t = (c, m) => { n++; if (c) ok++; else console.log("KO", m); };
try { await db.exec(fs.readFileSync("/sessions/quirky-affectionate-hypatia/wt-surmesure/docs/migrations_1030_surmesure/surmesure_v2_retour_arriere.sql", "utf8")); t(true); } catch (e) { t(false, e.message); }
const m = (await db.query(`select md5(pg_get_functiondef('public.lx_creneau_libre(uuid,integer,date,time,integer)'::regprocedure)) m`)).rows[0].m;
t(m === "608615e8c8faa8621b0306ff6abec150", "md5 " + m);
t((await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status === "cancelled_by_salon", "statut");
t((await db.query(`select count(*)::int n from cron.job where jobname='rdv-sur-mesure-echeances'`)).rows[0].n === 0, "cron");
t((await db.query(`select count(*)::int n from pg_proc where proname like 'lx_demande_%'`)).rows[0].n === 0, "rpc");
t((await db.query(`select count(*)::int n from rdv_demande_options`)).rows[0].n === 1, "options conservées");
// rejouer le SQL v2 après retour arrière (réapplication)
try { await appliquerV2(db); t(true); } catch (e) { t(false, "réapplication " + e.message); }
console.log(`retour arrière : ${ok}/${n} OK`);
