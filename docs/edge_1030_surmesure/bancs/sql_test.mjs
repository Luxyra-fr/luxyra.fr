// Banc SQL — RDV sur mesure v2 sur la base reconstruite depuis la production (PGlite = PostgreSQL 17).
import { creerBase, commeRole } from "./base.mjs";
import { seed, S, S2, U, U2, CL, C1, C2, C3, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";

let nOk = 0, nKo = 0; const kos = [];
function ok(nom, cond, detail) { if (cond) { nOk++; } else { nKo++; kos.push(nom + (detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 400) : "")); } }
let _bloc = 0;
async function garde(fn) { _bloc++; try { await fn(); } catch (e) { ok("bloc " + _bloc + " sans exception", false, e.message); } }
const srv = (db, fn) => commeRole(db, "service_role", null, fn);
const pg = (db, fn) => fn();
async function rpc(db, f, args) {
  try { const r = await srv(db, () => db.query(`select public.${f}(${args.map((_, i) => "$" + (i + 1)).join(",")}) r`, args)); return { r: r.rows[0].r }; }
  catch (e) { return { err: e.message, code: e.hint || e.code }; }
}
async function demande(db, salon = S, extra = {}) {
  const r = await srv(db, () => db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, demande_text, dispo_text, status, created_at)
     values ($1,'M.','Julie','0600000000','julie@exemple.test',$2,'Couleur ou mèches coupe cheveux mi long','Après 15h30 ou samedi','pending', coalesce($3::timestamptz, now())) returning id`, [salon, CL, extra.created_at || null]));
  return r.rows[0].id;
}
const D = jour(6), D2 = jour(8);
const optA = { rang: 1, libelle: "Couleur + coupe", date: D, heure: "15:30", collaborateur_id: C1, items: [{ type: "service", id: 9003 }], acompte_mode: "aucun", note: "Couleur ton sur ton" };
const optB = { rang: 2, libelle: "Mèches + coupe", date: D2, heure: "12:30", collaborateur_id: C1, items: [{ type: "service", id: 9002, prix: 1 }], acompte_mode: "pct", acompte_valeur: 30, note: "Venez avec les cheveux secs" };
const optC = { rang: 3, date: D2, heure: "15:00", collaborateur_id: null, items: [{ type: "forfait", id: 7001 }], acompte_mode: "montant", acompte_valeur: 50 };

let _k = 30;
function neuves() { _k += 3; return [{ ...optA, date: jour(_k) }, { ...optB, date: jour(_k + 1) }, { ...optC, date: jour(_k + 1) }]; }
const { db } = await creerBase();
await seed(db);
await appliquerV2(db);
const T0 = Date.now();

// ---------- 1. Calculs serveur ----------
await garde(async () => {
  const id = await demande(db);
  let x = await rpc(db, "lx_demande_proposer", [id, U2, JSON.stringify([optA]), 72, false]);
  ok("propriétaire vérifié (autre établissement refusé)", x.code === "LX_SM_INTERDIT", x);
  x = await commeRole(db, "authenticated", U, async () => { try { await db.query(`select lx_demande_proposer($1,$2,'[]',72,false)`, [id, U]); return "passé"; } catch (e) { return e.message; } });
  ok("RPC interdite au rôle authenticated (navigateur)", /permission denied/.test(x), x);
  x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optA, optB, optC]), 72, false]);
  ok("3 options envoyées", x.r && x.r.ok === true && x.r.options.length === 3, x);
  const o = x.r.options;
  ok("A : 68 € / 90 min dont 30 de pose / sans acompte", +o[0].prix_total === 68 && o[0].duree_minutes === 90 && o[0].pose_minutes === 30 && +o[0].acompte_montant === 0, o[0]);
  ok("B : prix falsifié ignoré (80 €), 170 min dont 65 de pose, acompte 30 % = 24,00 €", +o[1].prix_total === 80 && o[1].duree_minutes === 170 && o[1].pose_minutes === 65 && +o[1].acompte_montant === 24, o[1]);
  ok("C : forfait 150 €, 120 min, acompte 50 € fixe, pas de préférence", +o[2].prix_total === 150 && o[2].duree_minutes === 120 && +o[2].acompte_montant === 50 && o[2].collaborateur_id === null, o[2]);
  ok("C : intitulé par défaut = noms des prestations", o[2].libelle === "FORFAIT MARIEE", o[2].libelle);
  const d = (await db.query(`select status, proposal_version, envoi, length(proposal_token) lt, round(extract(epoch from proposal_expires_at - proposed_at)/3600) h from rdv_demandes where id=$1`, [id])).rows[0];
  ok("demande proposée, format 2, jeton 32 car., 72 h", d.status === "proposed" && d.proposal_version === 2 && d.envoi === 1 && d.lt === 32 && +d.h === 72, d);
  globalThis.DEM1 = { id, token: x.r.token, opts: o };
});
for (const [nom, opt, code] of [
  ["prestation sur devis refusée", { ...optA, items: [{ type: "service", id: 9005 }] }, "LX_SM_DEVIS"],
  ["forfait sur devis refusé", { ...optA, items: [{ type: "forfait", id: 7002 }] }, "LX_SM_DEVIS"],
  ["acompte > total refusé", { ...optA, acompte_mode: "montant", acompte_valeur: 100 }, "LX_SM_ACOMPTE"],
  ["acompte 101 % refusé", { ...optA, acompte_mode: "pct", acompte_valeur: 101 }, "LX_SM_ACOMPTE"],
  ["acompte < 1 € refusé", { ...optA, acompte_mode: "montant", acompte_valeur: 0.5 }, "LX_SM_ACOMPTE"],
  ["collaborateur d'un autre établissement refusé", { ...optA, collaborateur_id: C3 }, "LX_SM_COLLAB"],
  ["prestation d'un autre établissement refusée", { ...optA, items: [{ type: "service", id: 9101 }] }, "LX_SM_ITEM"],
  ["date passée refusée", { ...optA, date: "2026-01-02" }, "LX_SM_PASSE"],
  ["aucune prestation refusée", { ...optA, items: [] }, "LX_SM_ITEMS"],
]) {
  const id = await demande(db);
  const x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([opt]), 72, false]);
  ok(nom, x.code === code, x);
}
await garde(async () => {
  const id = await demande(db);
  let x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optA, optB, optC, { ...optA, rang: 1 }]), 72, false]);
  ok("4 options refusées", x.code === "LX_SM_OPTION", x);
  x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optA, { ...optB, rang: 1 }]), 72, false]);
  ok("même lettre deux fois refusée", x.code === "LX_SM_OPTION", x);
  x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optA]), 24, false]);
  const h = (await db.query(`select round(extract(epoch from proposal_expires_at - proposed_at)/3600) h from rdv_demandes where id=$1`, [id])).rows[0].h;
  ok("validité réglable 24 h", x.r && x.r.ok && +h === 24, { x, h });
});
await garde(async () => {
  // établissement sans Stripe actif
  const id = await demande(db, S2);
  let x = await rpc(db, "lx_demande_proposer", [id, U2, JSON.stringify([{ ...optA, collaborateur_id: C3, items: [{ type: "service", id: 9101 }], acompte_mode: "pct", acompte_valeur: 30 }]), 72, false]);
  ok("sans Stripe : acompte en ligne refusé par le serveur", x.code === "LX_SM_STRIPE", x);
  x = await rpc(db, "lx_demande_proposer", [id, U2, JSON.stringify([{ ...optA, collaborateur_id: C3, items: [{ type: "service", id: 9101 }] }]), 72, false]);
  ok("sans Stripe : proposition sans acompte acceptée", x.r && x.r.ok, x);
});

// ---------- 2. Créneaux (temps de pose, pas de préférence) ----------
await garde(async () => {
  const DJ = jour(10);
  // RDV interne de Amandine 12:00-12:30
  await db.query(`insert into appointments(id, salon_id, collab_id, date_rdv, heure, a_phases, status) values (gen_random_uuid(), $1, $2, $3, '12:00', '[{"t":"w","d":30}]', 'conf')`, [S, C1, DJ]).catch(async (e) => {
    console.log("appointments insert:", e.message);
  });
  const ph = JSON.stringify([{ t: "w", d: 60 }, { t: "p", d: 65 }, { t: "w", d: 45 }]);
  let r = (await pg(db, () => db.query(`select lx_prive.demande_creneau($1,$2,$3,'10:00',$4::jsonb) r`, [S, C1, DJ, ph]))).rows[0].r;
  ok("mèches 10:00 avec Amandine : conflit avec son RDV de 12:00 (phase de travail 12:05)", r.libre === false, r);
  r = (await pg(db, () => db.query(`select lx_prive.demande_creneau($1,$2,$3,'09:40',$4::jsonb) r`, [S, C1, DJ, ph]))).rows[0].r;
  ok("mèches 09:40 : RDV de 12:00 pendant la pose (10:40-11:45 pose, 11:45-12:30 travail) -> conflit", r.libre === false, r);
  const ph2 = JSON.stringify([{ t: "w", d: 30 }, { t: "p", d: 60 }, { t: "w", d: 15 }]);
  r = (await pg(db, () => db.query(`select lx_prive.demande_creneau($1,$2,$3,'11:30',$4::jsonb) r`, [S, C1, DJ, ph2]))).rows[0].r;
  ok("temps de pose libre : 11:30 (travail 11:30-12:00, pose 12:00-13:00) compatible avec le RDV de 12:00", r.libre === true, r);
  const vieux = (await srv(db, () => db.query(`select lx_creneau_libre($1,$2,$3,'11:30',105) r`, [S, C1, DJ]))).rows[0].r;
  ok("ancienne signature (durée d'un bloc) : 11:30 + 105 min occupé", vieux === false, vieux);
  // pas de préférence : Manue occupée 15:00-16:00 et Amandine aussi -> pas libre
  await db.query(`insert into appointments(id, salon_id, collab_id, date_rdv, heure, a_phases, status) values (gen_random_uuid(),$1,$2,$3,'15:00','[{"t":"w","d":60}]','conf'), (gen_random_uuid(),$1,$4,$3,'15:00','[{"t":"w","d":60}]','conf')`, [S, C1, DJ, C2]);
  r = (await pg(db, () => db.query(`select lx_prive.demande_creneau($1,null,$2,'15:15','[{"t":"w","d":30}]'::jsonb) r`, [S, DJ]))).rows[0].r;
  ok("pas de préférence : les deux collaboratrices occupées -> pas libre", r.libre === false, r);
  const nl = (await srv(db, () => db.query(`select lx_creneau_libre($1,null,$2,'15:15',30) r`, [S, DJ]))).rows[0].r;
  ok("lx_creneau_libre corrigé : « pas de préférence » vérifié (avant : toujours libre)", nl === false, nl);
  r = (await pg(db, () => db.query(`select lx_prive.demande_creneau($1,null,$2,'16:30','[{"t":"w","d":30}]'::jsonb) r`, [S, DJ]))).rows[0].r;
  ok("pas de préférence : une collaboratrice libre -> libre + collaboratrice trouvée", r.libre === true && [C1, C2].includes(r.collab), r);
  r = (await pg(db, () => db.query(`select lx_prive.demande_creneau($1,$2,$3,'20:00','[{"t":"w","d":30}]'::jsonb) r`, [S, C1, DJ]))).rows[0].r;
  ok("hors horaires : libre mais avertissement", r.libre === true && /Hors horaires/.test(r.avertissement || ""), r);
  // conflit à l'envoi : non forcé -> rien d'écrit ; forcé -> écrit avec avertissement
  const id = await demande(db);
  let x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...optB, rang: 1, date: DJ, heure: "10:00" }]), 72, false]);
  const n0 = (await db.query(`select count(*)::int n from rdv_demande_options where demande_id=$1`, [id])).rows[0].n;
  ok("conflit à l'envoi : rien n'est écrit, conflit renvoyé", x.r && x.r.ok === false && x.r.code === "conflit" && n0 === 0, x);
  x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...optB, rang: 1, date: DJ, heure: "10:00" }]), 72, true]);
  const av = (await db.query(`select avertissement from rdv_demande_options where demande_id=$1`, [id])).rows[0];
  ok("« envoyer quand même » : écrit avec l'avertissement", x.r && x.r.ok && /déjà un rendez-vous/.test(av.avertissement || ""), { x, av });
});

// ---------- 3. Protection d'une proposition envoyée ----------
await garde(async () => {
  const { id } = globalThis.DEM1;
  const essai = (sql, args) => commeRole(db, "authenticated", U, async () => { try { const r = await db.query(sql, args); return "ok:" + r.affectedRows; } catch (e) { return e.hint || e.message; } });
  let x = await essai(`update rdv_demandes set proposal_expires_at = now() + interval '30 days' where id=$1`, [id]);
  ok("établissement : prolonger / modifier une proposition envoyée refusé", x === "LX_DEMANDE_PROTEGEE", x);
  x = await essai(`update rdv_demandes set proposed_data='{"prix_total":1}' where id=$1`, [id]);
  ok("établissement : modifier les montants refusé", x === "LX_DEMANDE_PROTEGEE", x);
  x = await essai(`update rdv_demandes set status='confirmed' where id=$1`, [id]);
  ok("établissement : confirmer à la place du client refusé", x === "LX_DEMANDE_STATUT", x);
  x = await commeRole(db, "authenticated", U, async () => { try { await db.query(`update rdv_demande_options set prix_total = 1`); return "ok"; } catch (e) { return e.message; } });
  ok("établissement : écriture directe des options refusée", /permission denied/.test(x), x);
  x = await commeRole(db, "authenticated", U2, async () => (await db.query(`select count(*)::int n from rdv_demande_options where salon_id=$1`, [S])).rows[0].n);
  ok("RLS : un autre établissement ne voit pas les options", x === 0, x);
  x = await commeRole(db, "authenticated", U, async () => (await db.query(`select count(*)::int n from rdv_demande_options where demande_id=$1`, [id])).rows[0].n);
  ok("RLS : l'établissement voit ses options", x === 3, x);
  x = await commeRole(db, "anon", null, async () => { try { return (await db.query(`select count(*)::int n from rdv_demande_options`)).rows[0].n; } catch (e) { return e.message; } });
  ok("anonyme : aucun accès aux options", /permission denied/.test(String(x)), x);
  x = await commeRole(db, "anon", null, async () => { try { await db.query(`insert into rdv_demandes(id, salon_id, client_nom, client_tel, demande_text, status, proposal_version, envoi, checkout_session_id) values ('99999999-9999-4999-8999-999999999999',$1,'X','06','t','pending',2,5,'cs_pirate')`, [S]); return "ok"; } catch (e) { return e.message; } });
  const pirate = (await db.query(`select proposal_version, envoi, checkout_session_id from rdv_demandes where id='99999999-9999-4999-8999-999999999999'`)).rows[0];
  ok("insertion anonyme : colonnes serveur remises à zéro", x === "ok" && pirate && pirate.proposal_version === 1 && pirate.envoi === 0 && pirate.checkout_session_id === null, { x, pirate });
});

// ---------- 4. Consultation, choix sans acompte, conflits ----------
await garde(async () => {
  const { id, token, opts } = globalThis.DEM1;
  let x = await rpc(db, "lx_demande_consulter", [token]);
  ok("consultation : 3 options, statut proposé", x.r && x.r.ok && x.r.options.length === 3 && x.r.demande.status === "proposed", x);
  ok("consultation : reste à payer calculé (B : 56 €)", +x.r.options[1].reste === 56, x.r.options[1]);
  const nv = (await db.query(`select count(*)::int n from notifications where type='rdv_demande_vue' and source_id=$1`, [id])).rows[0].n;
  await rpc(db, "lx_demande_consulter", [token]);
  const nv2 = (await db.query(`select count(*)::int n from notifications where type='rdv_demande_vue' and source_id=$1`, [id])).rows[0].n;
  ok("« vue par le client » notifiée une seule fois", nv === 1 && nv2 === 1, { nv, nv2 });
  x = await rpc(db, "lx_demande_choisir", [token, opts[1].id]);
  ok("choisir une option avec acompte sans payer : refusé (paiement)", x.r && x.r.code === "paiement", x);
  x = await rpc(db, "lx_demande_paiement_preparer", [token, opts[0].id]);
  ok("payer une option sans acompte : refusé", x.r && x.r.code === "sans_acompte", x);
  x = await rpc(db, "lx_demande_choisir", [token, opts[0].id]);
  ok("choix A sans acompte : RDV confirmé", x.r && x.r.ok && x.r.rdv_online_id, x);
  const rdv = (await db.query(`select status, acompte_paye, service_prix, duree_minutes, collaborateur_id, salon_edit, items, date_rdv::text d, to_char(heure_rdv,'HH24:MI') h from rdv_online where id=$1`, [x.r.rdv_online_id])).rows[0];
  ok("RDV : 68 €, 90 min, Amandine, phases réelles (pose) pour le planning", rdv.status === "confirmed" && +rdv.service_prix === 68 && rdv.duree_minutes === 90 && rdv.collaborateur_id === C1 && rdv.salon_edit.phases.length === 3 && rdv.salon_edit.phases[1].t === "p" && rdv.d === D && rdv.h === "15:30", rdv);
  const dm = (await db.query(`select status, option_choisie_id, proposed_data from rdv_demandes where id=$1`, [id])).rows[0];
  ok("demande confirmée, option recopiée au format v1 (date/heure/items/prix)", dm.status === "confirmed" && dm.option_choisie_id === opts[0].id && dm.proposed_data.date === D && dm.proposed_data.heure === "15:30" && +dm.proposed_data.prix_total === 68 && dm.proposed_data.items[0].service_id === 9003, dm);
  const st = (await db.query(`select rang, statut from rdv_demande_options where demande_id=$1 order by rang`, [id])).rows.map((r) => r.statut).join(",");
  ok("une seule option : A choisie, B et C libérées", st === "choisie,liberee,liberee", st);
  x = await rpc(db, "lx_demande_choisir", [token, opts[1].id]);
  ok("deuxième choix (autre option) refusé : déjà confirmé", x.code === "LX_SM_DEJA", x);
  const tk = (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;
  ok("sans acompte : aucun ticket créé", tk === 0, tk);
});
await garde(async () => {
  // deux clients sur le même créneau ; créneau pris entre l'envoi et le choix
  const DJ = jour(12);
  const o1 = { ...optA, date: DJ, heure: "10:00" };
  const id1 = await demande(db), id2 = await demande(db);
  const p1 = (await rpc(db, "lx_demande_proposer", [id1, U, JSON.stringify([o1]), 72, false])).r;
  const p2 = (await rpc(db, "lx_demande_proposer", [id2, U, JSON.stringify([o1, { ...o1, rang: 2, heure: "16:00" }]), 72, false])).r;
  let x = await rpc(db, "lx_demande_choisir", [p1.token, p1.options[0].id]);
  ok("client 1 choisit 10:00", x.r && x.r.ok, x);
  x = await rpc(db, "lx_demande_choisir", [p2.token, p2.options[0].id]);
  ok("client 2, même créneau : refusé (créneau pris), rien de créé", x.r && x.r.code === "creneau_pris", x);
  const os = (await db.query(`select statut from rdv_demande_options where id=$1`, [p2.options[0].id])).rows[0].statut;
  const nf = (await db.query(`select count(*)::int n from notifications where type='demande_creneau_pris' and source_id=$1`, [p2.options[0].id])).rows[0].n;
  ok("option marquée « créneau pris » + notification à l'établissement", os === "creneau_pris" && nf === 1, { os, nf });
  x = await rpc(db, "lx_demande_choisir", [p2.token, p2.options[0].id]);
  ok("option prise : rechoisir refusé", x.code === "LX_SM_CRENEAU", x);
  x = await rpc(db, "lx_demande_choisir", [p2.token, p2.options[1].id]);
  ok("client 2 choisit l'autre option (16:00) : confirmé", x.r && x.r.ok, x);
});

// ---------- 5. Paiement de l'acompte (chemin existant -> ticket scellé) ----------
await garde(async () => {
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify(neuves()), 72, false])).r;
  const [A, B, C] = p.options;
  let x = await rpc(db, "lx_demande_paiement_preparer", [p.token, B.id]);
  ok("préparer B : 2400 centimes, compte du salon", x.r && x.r.ok && +x.r.montant_cents === 2400 && x.r.compte === "acct_TESTA" && x.r.session_precedente === null, x);
  x = await rpc(db, "lx_demande_paiement_enregistrer", [p.token, B.id, "cs_B1", new Date(Date.now() + 30 * 60e3).toISOString()]);
  ok("session B enregistrée", x.r && x.r.ok && x.r.session_precedente === null, x);
  x = await rpc(db, "lx_demande_paiement_preparer", [p.token, C.id]);
  ok("changement d'option : la session précédente est signalée (à expirer)", x.r && x.r.session_precedente === "cs_B1", x);
  x = await rpc(db, "lx_demande_paiement_enregistrer", [p.token, C.id, "cs_C1", new Date(Date.now() + 30 * 60e3).toISOString()]);
  ok("session C enregistrée, B signalée", x.r && x.r.session_precedente === "cs_B1", x);
  const avant = (await db.query(`select count(*)::int n, coalesce(max(num),0) m from tickets where salon_id=$1`, [S])).rows[0];
  x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_C1", C.id, "pi_C1", "acct_TESTA", 5000]);
  ok("paiement C : RDV créé", x.r && x.r.ok && x.r.rdv_online_id, x);
  const rdv = (await db.query(`select id, status, acompte_paye, acompte_montant, acompte_modele, payment_intent_id, collaborateur_id from rdv_online where id=$1`, [x.r.rdv_online_id])).rows[0];
  ok("RDV : confirmé, acompte 50 € payé, modèle « ticket »", rdv.status === "confirmed" && rdv.acompte_paye === true && +rdv.acompte_montant === 50 && rdv.acompte_modele === "ticket" && rdv.payment_intent_id === "pi_C1", rdv);
  const tks = (await db.query(`select num, total_ttc, hash, raw_data->>'acompteKey' k, raw_data->>'tkNum' tk, status from tickets where salon_id=$1 order by num`, [S])).rows;
  const t = tks[tks.length - 1];
  ok("ticket « Acompte en ligne » scellé par le serveur (chemin existant)", tks.length === avant.n + 1 && +t.total_ttc === 50 && t.k === "acompte:" + rdv.id && t.hash && t.status === "paid" && +t.tk >= 900001, t);
  const appt = (await db.query(`select count(*)::int n from appointments where salon_id=$1 and meta->>'serveur'='true'`, [S])).rows[0].n;
  ok("copie du ticket côté appointments (serveur)", appt >= 1, appt);
  const dm = (await db.query(`select status, option_choisie_id, stripe_session_id, checkout_session_id from rdv_demandes where id=$1`, [id])).rows[0];
  ok("demande confirmée par C, session mémorisée, paiement en cours effacé", dm.status === "confirmed" && dm.option_choisie_id === C.id && dm.stripe_session_id === "cs_C1" && dm.checkout_session_id === null, dm);
  x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_C1", C.id, "pi_C1", "acct_TESTA", 5000]);
  const n2 = (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;
  ok("rejeu (webhook après la page) : idempotent, aucun 2e ticket", x.r && x.r.ok && x.r.deja && x.r.rdv_online_id === rdv.id && n2 === avant.n + 1, { x, n2 });
  x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_B1", B.id, "pi_B1", "acct_TESTA", 2400]);
  const n3 = (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;
  const nr = (await db.query(`select count(*)::int n from rdv_online where payment_intent_id='pi_B1'`)).rows[0].n;
  ok("double paiement (session B payée aussi) : détecté, aucun RDV ni ticket", x.r && x.r.ok === false && x.r.code === "doublon" && n3 === n2 && nr === 0, { x, n3, nr });
  await rpc(db, "lx_demande_paiement_rembourse", [x.r.paiement_id, "re_TEST1", true, "remboursé automatiquement"]);
  const pr = (await db.query(`select statut, refund_id from rdv_demande_paiements where session_id='cs_B1'`)).rows[0];
  ok("double paiement : remboursement enregistré", pr.statut === "rembourse" && pr.refund_id === "re_TEST1", pr);
  x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_B1", B.id, "pi_B1", "acct_TESTA", 2400]);
  ok("rejeu du doublon : reconnu, pas de second remboursement demandé", x.r && x.r.deja && x.r.statut === "rembourse", x);
});
await garde(async () => {
  // montant insuffisant ; paiement d'une option devenue « créneau pris » (RDV créé quand même + alerte)
  const DJ = jour(14);
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...optB, rang: 1, date: DJ, heure: "10:00" }]), 72, false])).r;
  const B = p.options[0];
  let x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_low", B.id, "pi_low", "acct_TESTA", 100]);
  ok("montant payé inférieur à l'acompte : refusé (remboursement)", x.r && x.r.code === "montant", x);
  await rpc(db, "lx_demande_paiement_preparer", [p.token, B.id]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, B.id, "cs_pris", new Date(Date.now() + 30 * 60e3).toISOString()]);
  await srv(db, () => db.query(`insert into rdv_online(salon_id, client_nom, client_tel, service_id, service_nom, service_prix, collaborateur_id, date_rdv, heure_rdv, duree_minutes, status) values ($1,'Autre','07',9001,'COUPE',30,$2,$3,'10:15',30,'confirmed')`, [S, C1, DJ]));
  x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_pris", B.id, "pi_pris", "acct_TESTA", 2400]);
  const nf = (await db.query(`select count(*)::int n from notifications where type='rdv_demande_double_reservation' and source_id=$1`, [id])).rows[0].n;
  ok("créneau pris pendant le paiement : RDV créé (règle conservée) + alerte double réservation", x.r && x.r.ok && x.r.creneau_libre === false && nf === 1, { x, nf });
});

// ---------- 6. Expiration, annulation, relance, rappel ----------
await garde(async () => {
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify(neuves().slice(0,2)), 72, false])).r;
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  let x = await rpc(db, "lx_demande_choisir", [p.token, p.options[0].id]);
  ok("proposition expirée : choix refusé", x.code === "LX_SM_EXPIREE", x);
  x = await rpc(db, "lx_demande_consulter", [p.token]);
  const nf = (await db.query(`select count(*)::int n from notifications where type='rdv_demande_expiree' and source_id=$1`, [id])).rows[0].n;
  const st = (await db.query(`select string_agg(statut, ',' order by rang) s from rdv_demande_options where demande_id=$1`, [id])).rows[0].s;
  ok("expirée à la consultation : statut, options libérées, notification", x.r.demande.status === "expired" && nf === 1 && st === "liberee,liberee", { s: x.r.demande.status, nf, st });
});
await garde(async () => {
  // expiration pendant un paiement en cours : jamais (ni consultation, ni tâche)
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...optB, rang: 1, date: jour(15) }]), 72, false])).r;
  await rpc(db, "lx_demande_paiement_preparer", [p.token, p.options[0].id]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[0].id, "cs_exp", new Date(Date.now() + 20 * 60e3).toISOString()]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  await rpc(db, "lx_demande_consulter", [p.token]);
  let s = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  ok("paiement en cours : pas d'expiration (tâche + consultation)", s === "proposed", s);
  const x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_exp", p.options[0].id, "pi_exp", "acct_TESTA", 2400]);
  ok("paiement terminé après l'échéance : RDV confirmé", x.r && x.r.ok, x);
});
await garde(async () => {
  // session expirée côté Stripe (non payée) puis proposition expirée -> la tâche expire
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...optB, rang: 1, date: jour(16) }]), 72, false])).r;
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[0].id, "cs_morte", new Date(Date.now() + 30 * 60e3).toISOString()]);
  await db.query(`update rdv_demandes set checkout_expires_at = now() - interval '61 minutes', proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  const avant = (await db.query(`select count(*)::int n from net.lx_appels where body->>'type'='expiree'`)).rows[0].n;
  const r = (await db.query(`select lx_prive.demandes_sur_mesure_echeances() r`)).rows[0].r;
  const s = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  const apres = (await db.query(`select count(*)::int n, max(headers->>'x-lx-internal') k from net.lx_appels where body->>'type'='expiree'`)).rows[0];
  ok("session Stripe expirée + échéance : expirée par la tâche, e-mail demandé au worker (x-lx-internal)", s === "expired" && r.expirees >= 1 && apres.n === avant + 1 && apres.k === "cle-service-de-test", { r, s, apres });
});
await garde(async () => {
  // annulation par le salon, puis paiement qui arrive quand même -> inactive (remboursement)
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...optB, rang: 1, date: jour(17) }]), 72, false])).r;
  const x0 = await commeRole(db, "authenticated", U, async () => { try { const r = await db.query(`update rdv_demandes set status='cancelled_by_salon' where id=$1 and status='proposed' returning id`, [id]); return r.rows.length; } catch (e) { return e.message; } });
  const st = (await db.query(`select statut from rdv_demande_options where demande_id=$1`, [id])).rows[0].statut;
  ok("annulation par l'établissement autorisée, options libérées", x0 === 1 && st === "liberee", { x0, st });
  let x = await rpc(db, "lx_demande_paiement_preparer", [p.token, p.options[0].id]);
  ok("après annulation : paiement refusé", x.code === "LX_SM_INACTIVE", x);
  x = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_annule", p.options[0].id, "pi_annule", "acct_TESTA", 2400]);
  ok("paiement arrivé après annulation : refusé, à rembourser", x.r && x.r.code === "inactive", x);
});
await garde(async () => {
  // proposer un autre horaire (retour pending) -> options remplacées, nouvel envoi
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify(neuves().slice(0,1)), 72, false])).r;
  const r0 = await commeRole(db, "authenticated", U, async () => (await db.query(`update rdv_demandes set status='pending', refuse_reason=null where id=$1 and status='proposed' returning id`, [id])).rows.length);
  const st = (await db.query(`select statut from rdv_demande_options where demande_id=$1`, [id])).rows[0].statut;
  let x = await rpc(db, "lx_demande_choisir", [p.token, p.options[0].id]);
  ok("« proposer un autre horaire » : ancien lien inactif, options remplacées", r0 === 1 && st === "remplacee" && x.code === "LX_SM_REFAIRE", { r0, st, x });
  const p2 = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([{ ...neuves()[1], rang: 1 }]), 48, false])).r;
  x = await rpc(db, "lx_demande_choisir", [p.token, p.options[0].id]);
  ok("nouvel envoi : envoi 2, nouveau jeton, ancien jeton introuvable", p2.envoi === 2 && p2.token !== p.token && x.code === "LX_SM_INTROUVABLE", { e: p2.envoi, x });
});
await garde(async () => {
  // relance (24 h avant l'échéance) et rappel au salon (demande sans réponse depuis 24 h)
  const id = await demande(db);
  await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify(neuves().slice(0,1)), 72, false]);
  await db.query(`update rdv_demandes set proposed_at = now() - interval '62 hours', proposal_expires_at = now() + interval '10 hours' where id=$1`, [id]);
  const old = await demande(db, S, { created_at: new Date(Date.now() - 26 * 3600e3).toISOString() });
  const r1 = (await db.query(`select lx_prive.demandes_sur_mesure_echeances() r`)).rows[0].r;
  const r2 = (await db.query(`select lx_prive.demandes_sur_mesure_echeances() r`)).rows[0].r;
  const rel = (await db.query(`select relance_at is not null r from rdv_demandes where id=$1`, [id])).rows[0].r;
  const nrel = (await db.query(`select count(*)::int n from net.lx_appels where body->>'type'='relance' and body->>'demande_id'=$1`, [id])).rows[0].n;
  const nrap = (await db.query(`select count(*)::int n from notifications where type='rdv_demande_rappel' and source_id=$1`, [old])).rows[0].n;
  ok("relance du client : une seule fois", rel && nrel === 1 && r1.relances >= 1 && r2.relances === 0, { r1, r2, nrel });
  ok("rappel à l'établissement : une seule notification", nrap === 1 && r1.rappels >= 1 && r2.rappels === 0, { r1, r2, nrap });
});
await garde(async () => {
  // refus par le client avec message
  const id = await demande(db);
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify(neuves().slice(0,2)), 72, false])).r;
  const x = await rpc(db, "lx_demande_refuser", [p.token, "Je préfère un samedi matin"]);
  const d = (await db.query(`select status, refuse_reason from rdv_demandes where id=$1`, [id])).rows[0];
  const nf = (await db.query(`select count(*)::int n from notifications where type='rdv_demande_refused' and source_id=$1`, [id])).rows[0].n;
  ok("refus avec message : statut, motif, notification", x.r.ok && d.status === "refused" && d.refuse_reason === "Je préfère un samedi matin" && nf === 1, { x, d, nf });
});
await garde(async () => {
  // ancien format (v1) : chemin d'origine inchangé ; les RPC v2 le refusent
  const id = await demande(db);
  await srv(db, () => db.query(`update rdv_demandes set status='proposed', proposal_token='tokenv1tokenv1tokenv1tokenv1abcd', proposal_expires_at=now()+interval '72 hours', proposed_at=now(),
     proposed_data='{"date":"${jour(20)}","heure":"10:00","items":[{"service_id":9001,"nom":"COUPE","prix":30,"duree":30}],"prix_total":30,"duree_minutes":30,"acompte_montant":0}' where id=$1`, [id]));
  const x = await rpc(db, "lx_demande_choisir", ["tokenv1tokenv1tokenv1tokenv1abcd", "00000000-0000-4000-8000-000000000000"]);
  const c = await rpc(db, "lx_demande_consulter", ["tokenv1tokenv1tokenv1tokenv1abcd"]);
  ok("ancien format : consultation renvoie version 1 + proposed_data, choix v2 refusé", c.r.demande.version === 1 && c.r.demande.proposed_data.prix_total === 30 && x.code === "LX_SM_FORMAT", { c: c.r && c.r.demande, x });
  const l = (await srv(db, () => db.query(`select lx_creneau_libre($1,null,$2,'10:00',30) r`, [S, jour(20)]))).rows[0].r;
  ok("ancien format : lx_creneau_libre (signature d'origine) répond", l === true, l);
});

// ---------- 7. Non-régression : acompte en ligne classique -> ticket scellé ----------
await garde(async () => {
  const DJ = jour(21);
  await srv(db, async () => {
    const r = await db.query(`insert into rdv_online(salon_id, client_nom, client_prenom, client_tel, service_id, service_nom, service_prix, collaborateur_id, date_rdv, heure_rdv, duree_minutes, acompte_montant, acompte_paye, status, lieu, payment_intent_id, stripe_account)
      values ($1,'M.','Paul','07',9001,'COUPE',30,$2,$3,'09:00',30,10,false,'pending_payment','salon','pi_CLASSIQUE','acct_TESTA') returning id`, [S, C2, DJ]);
    await db.query(`update rdv_online set status='confirmed', acompte_paye=true where id=$1`, [r.rows[0].id]);
    const t = (await db.query(`select total_ttc from tickets where raw_data->>'acompteKey'=$1`, ["acompte:" + r.rows[0].id])).rows;
    ok("non-régression : acompte en ligne classique -> ticket scellé (10 €)", t.length === 1 && +t[0].total_ttc === 10, t);
  });
  const ch = (await db.query(`select count(*)::int n from (select num, lag(num) over (order by num) p from tickets where salon_id=$1) z where p is not null and num <> p + 1`, [S])).rows[0].n;
  ok("numérotation légale des tickets continue", ch === 0, ch);
  const nmd = (await db.query(`select count(*)::int n from tickets where salon_id=$1 and (hash is null or hash = '')`, [S])).rows[0].n;
  ok("tous les tickets sont scellés (empreinte)", nmd === 0, nmd);
});


// ---------- 8. Établissement en caisse de TEST ----------
await garde(async () => {
  const { db: dbt } = await creerBase();
  await seed(dbt, { modeCaisse: "test" });
  await appliquerV2(dbt);
  const id = (await commeRole(dbt, "service_role", null, () => dbt.query(`insert into rdv_demandes(salon_id, client_nom, client_tel, demande_text, status) values ($1,'M.','06','x','pending') returning id`, [S]))).rows[0].id;
  const p = (await commeRole(dbt, "service_role", null, () => dbt.query(`select lx_demande_proposer($1,$2,$3,72,false) r`, [id, U, JSON.stringify([{ ...optB, rang: 1, date: jour(40) }])]))).rows[0].r;
  const f = (await commeRole(dbt, "service_role", null, () => dbt.query(`select lx_demande_paiement_finaliser($1,'cs_T',$2,'pi_T','acct_TESTA',2400) r`, [p.token, p.options[0].id]))).rows[0].r;
  const t = (await dbt.query(`select mode_caisse, total_ttc from tickets where salon_id=$1`, [S])).rows;
  ok("caisse de test : acompte payé -> ticket marqué TEST (règle existante)", f.ok && t.length === 1 && t[0].mode_caisse === "test" && +t[0].total_ttc === 24, { f, t });
});

// ---------- 9. Contre-audit du 30/10 (NO GO) : correctifs C1, C2, C3, a, b, c, e, f, j, k + « jamais d'argent sans ticket » ----------
const nTk = async () => (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;
const optAc = (n, x) => Object.assign({ rang: 1, date: jour(n), heure: "10:00", collaborateur_id: C1, items: [{ type: "service", id: 9001 }], acompte_mode: "montant", acompte_valeur: 10 }, x || {});
async function prop(opts) { const id = await demande(db); const r = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify(opts), 72, true]); return { id, p: r.r, err: r }; }
await garde(async () => {
  // C1 : prestation / forfait / collaborateur supprimés entre l'envoi et le paiement -> RDV + ticket (jamais l'erreur de clé étrangère)
  await db.query(`insert into services(id, salon_id, nom, prix, phases, actif, prix_sur_devis, book_online, show_site, categorie) values (9301,$1,'TEMP C1',40,'[{"t":"w","d":30}]',true,false,true,true,'X')`, [S]);
  await db.query(`insert into collaborateurs(id, salon_id, nom, initiales, actif, inactif) values (598,$1,'Temp','TE',true,false)`, [S]);
  const { id, p } = await prop([optAc(90, { collaborateur_id: 598, items: [{ type: "service", id: 9301 }] })]);
  await db.query(`delete from services where id=9301`); await db.query(`delete from collaborateurs where id=598`);
  const t0 = await nTk();
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[0].id, "cs_C1x", new Date(Date.now() + 31 * 60e3).toISOString()]);
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_C1x", p.options[0].id, "pi_C1x", "acct_TESTA", 1000]);
  const r = f.r && f.r.rdv_online_id ? (await db.query(`select service_id, service_nom, collaborateur_id, collaborateur_nom, acompte_paye, acompte_tk_num from rdv_online where id=$1`, [f.r.rdv_online_id])).rows[0] : null;
  ok("C1 : prestation + collaborateur supprimés -> RDV (sans clés) + ticket scellé", f.r && f.r.ok && r && r.service_id === null && r.collaborateur_id === null && r.service_nom === "TEMP C1" && r.acompte_paye && r.acompte_tk_num && (await nTk()) === t0 + 1, { f, r });
  const st = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  ok("C1 : demande confirmée", st === "confirmed", st);
});
await garde(async () => {
  // BLOQUANT 1 : échec quelconque après paiement -> aucun RDV, aucun ticket, paiement « à rembourser » (code erreur) + alerte critique
  await db.exec(`create or replace function public._test_panne() returns trigger language plpgsql as $$ begin if NEW.client_prenom = 'PANNE' then raise exception 'panne simulée'; end if; return NEW; end $$;
    create trigger _test_panne before insert on public.rdv_online for each row execute function public._test_panne();`);
  const id = (await srv(db, () => db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, demande_text, status) values ($1,'M.','PANNE','0600000000','p@x.test','x','pending') returning id`, [S]))).rows[0].id;
  const p = (await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(91)]), 72, true])).r;
  const t0 = await nTk(), e0 = (await db.query(`select count(*)::int n from server_errors where severity='critical'`)).rows[0].n;
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_PANNE", p.options[0].id, "pi_PANNE", "acct_TESTA", 1000]);
  const nr = (await db.query(`select count(*)::int n from rdv_online where payment_intent_id='pi_PANNE'`)).rows[0].n;
  const pay = (await db.query(`select statut, detail from rdv_demande_paiements where session_id='cs_PANNE'`)).rows[0];
  const e1 = (await db.query(`select count(*)::int n from server_errors where severity='critical'`)).rows[0].n;
  ok("échec après paiement : code « erreur » (le worker rembourse), aucun RDV ni ticket, paiement à rembourser, alerte critique",
    f.r && f.r.ok === false && f.r.code === "erreur" && f.r.paiement_id && nr === 0 && (await nTk()) === t0 && pay && pay.statut === "doublon" && /panne simulée/.test(pay.detail) && e1 === e0 + 1, { f, nr, pay, e0, e1 });
  const st = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  ok("échec après paiement : la proposition reste ouverte (le client peut repayer ou choisir)", st === "proposed", st);
  const f2 = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_PANNE", p.options[0].id, "pi_PANNE", "acct_TESTA", 1000]);
  ok("échec après paiement : rejeu (webhook) reconnu, remboursement redemandé tant qu'il n'est pas fait", f2.r && f2.r.deja && f2.r.code === "doublon", f2);
  await db.exec(`drop trigger _test_panne on public.rdv_online; drop function public._test_panne();`);
});
await garde(async () => {
  // BLOQUANT 1 : ticket ni créé ni mis en file (déclencheur de recettes neutralisé pour l'essai) -> refusé + remboursé
  const def = (await db.query(`select pg_get_functiondef('lx_prive.zz_rdv_online_recettes()'::regprocedure) d`)).rows[0].d;
  await db.exec(`create or replace function lx_prive.zz_rdv_online_recettes() returns trigger language plpgsql as $$ begin return NEW; end $$;`);
  const { p } = await prop([optAc(92)]);
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_SANSTK", p.options[0].id, "pi_SANSTK", "acct_TESTA", 1000]);
  const nr = (await db.query(`select count(*)::int n from rdv_online where payment_intent_id='pi_SANSTK'`)).rows[0].n;
  ok("ticket non créé (ni file de rattrapage) : aucun RDV payé gardé, code « erreur » (remboursement)", f.r && f.r.code === "erreur" && nr === 0, { f, nr });
  await db.exec(def);
  const { p: p2 } = await prop([optAc(93)]);
  const f2 = await rpc(db, "lx_demande_paiement_finaliser", [p2.token, "cs_AVECTK", p2.options[0].id, "pi_AVECTK", "acct_TESTA", 1000]);
  ok("déclencheur rétabli : paiement -> RDV + ticket", f2.r && f2.r.ok, f2);
});
await garde(async () => {
  // C2 : écritures légitimes hors serveur ; colonnes de la proposition toujours protégées
  await db.query(`insert into services(id, salon_id, nom, prix, phases, actif, prix_sur_devis, book_online, show_site, categorie) values (9302,$1,'TEMP C2',40,'[{"t":"w","d":30}]',true,false,true,true,'X')`, [S]);
  const id = (await srv(db, () => db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, demande_text, status, service_id) values ($1,'M.','J','06','j@x.test','x','pending',9302) returning id`, [S]))).rows[0].id;
  const { p, id: id2 } = await prop([optAc(94)]);
  const del = await commeRole(db, "authenticated", U, async () => { try { const r = await db.query(`delete from services where id=9302 and salon_id=$1 returning id`, [S]); return r.rows.length; } catch (e) { return e.message; } });
  ok("C2 : le propriétaire supprime une prestation citée par une demande (mise à vide automatique)", del === 1, del);
  const an = await commeRole(db, "authenticated", U, async () => { await db.exec("reset role"); try { const r = await db.query(`update rdv_demandes set client_nom='Anonyme', client_prenom='', client_tel='', client_email='', client_luxyra_id=null where id in ($1,$2)`, [id, id2]); return r.affectedRows; } catch (e) { return e.message; } });
  ok("C2 : anonymisation RGPD (fermeture d'établissement), y compris d'une proposition envoyée", an === 2, an);
  for (const [nom, set] of [["proposal_expires_at", "proposal_expires_at = now() + interval '30 days'"], ["envoi", "envoi = 9"], ["checkout_session_id", "checkout_session_id='cs_forge'"], ["service_id -> autre valeur", "service_id = 9001"], ["client_luxyra_id -> autre compte", `client_luxyra_id = '${CL}'`]]) {
    const r = await commeRole(db, "authenticated", U, async () => { try { await db.query(`update rdv_demandes set ${set} where id=$1`, [id2]); return "modifié"; } catch (e) { return e.hint || e.message; } });
    ok("C2 : propriétaire modifie « " + nom + " » : refusé", r === "LX_DEMANDE_PROTEGEE", r);
  }
});
await garde(async () => {
  // C3 + k : expiration par N'IMPORTE QUEL chemin refusée pendant un paiement (et 60 min après la fin de la session)
  const { id, p } = await prop([optAc(95)]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[0].id, "cs_C3", new Date(Date.now() + 31 * 60e3).toISOString()]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  await db.query(`select public.fn_auto_expire_all()`);
  await srv(db, () => db.query(`update rdv_demandes set status='expired' where id=$1 and status='proposed'`, [id])); // edge v13
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`); await rpc(db, "lx_demande_consulter", [p.token]);
  let st = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  ok("C3 : fn_auto_expire_all, edge v13, tâche */15, consultation : pas d'expiration pendant le paiement", st === "proposed", st);
  await db.query(`update rdv_demandes set checkout_expires_at = now() - interval '20 minutes' where id=$1`, [id]);
  await db.query(`select public.fn_auto_expire_all()`); await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  st = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  ok("k : session finie depuis 20 min (webhook en retard possible) : toujours pas expirée", st === "proposed", st);
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_C3", p.options[0].id, "pi_C3", "acct_TESTA", 1000]);
  ok("k : webhook arrivé 20 min après la fin de la session : RDV + ticket (pas de remboursement)", f.r && f.r.ok, f);
  const { id: idb, p: pb } = await prop([optAc(96)]);
  await rpc(db, "lx_demande_paiement_enregistrer", [pb.token, pb.options[0].id, "cs_C3b", new Date(Date.now() + 31 * 60e3).toISOString()]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute', checkout_expires_at = now() - interval '61 minutes' where id=$1`, [idb]);
  await db.query(`select public.fn_auto_expire_all()`);
  st = (await db.query(`select status from rdv_demandes where id=$1`, [idb])).rows[0].status;
  ok("k : 61 min après la fin de la session : expiration normale", st === "expired", st);
  const f2 = await rpc(db, "lx_demande_paiement_finaliser", [pb.token, "cs_C3b", pb.options[0].id, "pi_C3b", "acct_TESTA", 1000]);
  ok("k : paiement arrivé encore plus tard : inactive -> remboursement (aucun RDV)", f2.r && f2.r.code === "inactive", f2);
});
await garde(async () => {
  // a : retour depuis Stripe puis autre choix / refus -> possibles tout de suite ; session signalée à expirer ; paiement tardif remboursé
  const { id, p } = await prop([optAc(97, { acompte_mode: "aucun" }), optAc(97, { rang: 2, heure: "14:00" })]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[1].id, "cs_A1", new Date(Date.now() + 31 * 60e3).toISOString()]);
  const c = await rpc(db, "lx_demande_choisir", [p.token, p.options[0].id]);
  ok("a : choix de A juste après l'abandon du paiement de B : confirmé, session B à expirer", c.r && c.r.ok && c.r.session_a_expirer === "cs_A1", c);
  const d = (await db.query(`select checkout_session_id, checkout_expires_at from rdv_demandes where id=$1`, [id])).rows[0];
  ok("a : paiement en cours effacé", d.checkout_session_id === null && d.checkout_expires_at === null, d);
  const t0 = await nTk();
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_A1", p.options[1].id, "pi_A1", "acct_TESTA", 1000]);
  ok("a : B payée quand même (expiration Stripe ratée) : doublon -> remboursement, aucun ticket", f.r && f.r.code === "doublon" && (await nTk()) === t0, f);
  const { id: id2, p: p2 } = await prop([optAc(98)]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p2.token, p2.options[0].id, "cs_A2", new Date(Date.now() + 31 * 60e3).toISOString()]);
  const rf = await rpc(db, "lx_demande_refuser", [p2.token, "finalement non"]);
  ok("a : refus juste après l'abandon du paiement : accepté, session à expirer", rf.r && rf.r.ok && rf.r.session_a_expirer === "cs_A2", rf);
  const f2 = await rpc(db, "lx_demande_paiement_finaliser", [p2.token, "cs_A2", p2.options[0].id, "pi_A2", "acct_TESTA", 1000]);
  ok("a : paiement tardif après refus : inactive -> remboursement", f2.r && f2.r.code === "inactive", f2);
  const { id: id3, p: p3 } = await prop([optAc(99)]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p3.token, p3.options[0].id, "cs_A3", new Date(Date.now() + 31 * 60e3).toISOString()]);
  const e1 = await rpc(db, "lx_demande_paiement_effacer", [p3.token, "cs_AUTRE"]);
  const e2 = await rpc(db, "lx_demande_paiement_effacer", [p3.token, "cs_A3"]);
  const d3 = (await db.query(`select checkout_session_id from rdv_demandes where id=$1`, [id3])).rows[0];
  ok("a : effacement du paiement en cours seulement pour la session enregistrée", e1.r && e1.r.ok === false && e2.r && e2.r.ok && d3.checkout_session_id === null, { e1, e2, d3 });
  const x = await commeRole(db, "authenticated", U, async () => { try { await db.query(`select public.lx_demande_paiement_effacer('x','y')`); return "ok"; } catch (e) { return e.message; } });
  ok("a : effacement interdit hors serveur", /permission denied/.test(x), x);
});
await garde(async () => {
  // b : proposition expirée -> préparer / enregistrer / choisir refusés même avec une session ouverte
  const { id, p } = await prop([optAc(100), optAc(100, { rang: 2, heure: "15:00", acompte_mode: "aucun" })]);
  await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[0].id, "cs_B_", new Date(Date.now() + 31 * 60e3).toISOString()]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  const a = await rpc(db, "lx_demande_paiement_preparer", [p.token, p.options[0].id]);
  const b = await rpc(db, "lx_demande_paiement_enregistrer", [p.token, p.options[0].id, "cs_B2", new Date(Date.now() + 31 * 60e3).toISOString()]);
  const c = await rpc(db, "lx_demande_choisir", [p.token, p.options[1].id]);
  ok("b : expirée : préparer, enregistrer et choisir refusés", a.code === "LX_SM_EXPIREE" && b.r && b.r.code === "expiree" && c.code === "LX_SM_EXPIREE", { a, b, c });
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_B_", p.options[0].id, "pi_B_", "acct_TESTA", 1000]);
  ok("b : la session ouverte AVANT l'échéance reste finalisée (RDV + ticket)", f.r && f.r.ok, f);
});
await garde(async () => {
  // c : heures
  for (const [h, att] of [["24:00", false], ["29:00", false], ["23:59", true], ["0:00", true], ["7:5", false], ["12h30", false]]) {
    const id = await demande(db);
    const x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(101, { heure: h, acompte_mode: "aucun", date: jour(101 + (h === "0:00" ? 1 : 0)) })]), 72, true]);
    ok("c : heure « " + h + " » " + (att ? "acceptée" : "refusée avec LX_SM_HEURE"), att ? (x.r && x.r.ok) : (x.code === "LX_SM_HEURE" && /00:00 à 23:59/.test(x.err)), x);
  }
});
await garde(async () => {
  // e : arrondi (centime inférieur) — mêmes valeurs que la fonction _lxSmCalc de app.html (banc arrondi_test.mjs)
  const cas = [["montant", "22.505", 22.5], ["pct", "33.333", 7.49], ["pct", "30", 6.75], ["pct", "33.335", 7.49], ["pct", "33.34", 7.5], ["montant", "1", 1], ["pct", "100", 22.5], ["montant", "7,499", null]];
  for (const [m, v, att] of cas) {
    const id = await demande(db);
    const x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(103, { items: [{ type: "service", id: 9006 }], acompte_mode: m, acompte_valeur: v })]), 72, true]);
    const ac = x.r && x.r.options ? Number(x.r.options[0].acompte_montant) : null;
    ok("e : acompte " + m + " " + v + " sur 22,50 € = " + att, att === null ? x.code === "LX_SM_ACOMPTE" : ac === att, x.r ? ac : x);
  }
});
await garde(async () => {
  // f : nouvelle proposition après refus / expiration (nouveau lien ; ancien lien mort ; paiement sur l'ancien lien -> introuvable = remboursé)
  const { id, p } = await prop([optAc(104)]);
  await rpc(db, "lx_demande_refuser", [p.token, "pas ce jour-là"]);
  const n = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(105)]), 72, true]);
  const d = (await db.query(`select status, envoi, refuse_reason, refused_at from rdv_demandes where id=$1`, [id])).rows[0];
  ok("f : nouvelle proposition après refus : envoi 2, nouveau lien, motif effacé", n.r && n.r.ok && n.r.token !== p.token && d.status === "proposed" && d.envoi === 2 && d.refuse_reason === null && d.refused_at === null, { n: n.r && n.r.ok, d });
  const old = await rpc(db, "lx_demande_consulter", [p.token]);
  const f = await rpc(db, "lx_demande_paiement_finaliser", [p.token, "cs_OLD", p.options[0].id, "pi_OLD", "acct_TESTA", 1000]);
  ok("f : ancien lien introuvable ; paiement sur l'ancien lien : code introuvable (remboursé par le worker)", old.r && old.r.code === "introuvable" && f.r && f.r.code === "introuvable", { old: old.r, f: f.r });
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  const n3 = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(106)]), 72, true]);
  ok("f : nouvelle proposition après expiration", n3.r && n3.r.ok && n3.r.envoi === 3, n3.r ? n3.r.envoi : n3);
  await db.query(`update rdv_demandes set status='refused' where id=$1`, [id]);
  await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(107)]), 72, true]); await db.query(`update rdv_demandes set status='refused' where id=$1`, [id]);
  await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(108)]), 72, true]); await db.query(`update rdv_demandes set status='refused' where id=$1`, [id]);
  const n6 = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(109)]), 72, true]);
  ok("f : 5 envois au maximum (anti-harcèlement)", n6.code === "LX_SM_LIMITE", n6);
  const { id: ic, p: pc } = await prop([optAc(110, { acompte_mode: "aucun" })]);
  await rpc(db, "lx_demande_choisir", [pc.token, pc.options[0].id]);
  const nc = await rpc(db, "lx_demande_proposer", [ic, U, JSON.stringify([optAc(111)]), 72, true]);
  ok("f : demande confirmée : pas de nouvelle proposition", nc.code === "LX_SM_STATUT", nc);
});
await garde(async () => {
  // j : établissement Essentiel -> message « offre Pro »
  const id = await demande(db); // demande reçue quand l'établissement était Pro, puis passage à l'offre Essentiel
  await db.query(`update salons set plan='essential', trial_end = now() - interval '1 day' where id=$1`, [S]);
  const x = await rpc(db, "lx_demande_proposer", [id, U, JSON.stringify([optAc(112)]), 72, true]);
  await db.query(`update salons set plan='pro', trial_end = now() + interval '300 days' where id=$1`, [S]);
  ok("j : offre Essentiel -> LX_SM_PRO « nécessite l'offre Pro »", x.code === "LX_SM_PRO" && /offre Pro/.test(x.err), x);
});
await garde(async () => {
  // compatibilité de déploiement : 1 option -> proposed_data au format d'origine (ancienne app) ; 2 options -> null
  const { id } = await prop([optAc(113)]);
  const { id: id2 } = await prop([optAc(114), optAc(114, { rang: 2, heure: "15:00" })]);
  const a = (await db.query(`select proposed_data from rdv_demandes where id=$1`, [id])).rows[0].proposed_data;
  const b = (await db.query(`select proposed_data from rdv_demandes where id=$1`, [id2])).rows[0].proposed_data;
  ok("compat : 1 option -> proposed_data lisible par l'ancienne app (date, heure, items, prix)", a && a.date && a.heure === "10:00" && Array.isArray(a.items) && a.items.length === 1 && +a.prix_total === 30 && +a.acompte_montant === 10, a);
  ok("compat : 2 options -> proposed_data vide (options dans rdv_demande_options)", b === null, b);
});

await garde(async () => {
  // contre-audit final (réserve 1) : insertion anonyme -> colonnes de proposition / verrou / paiement remises à zéro
  const x = await commeRole(db, "anon", null, async () => { try { await db.query(`insert into rdv_demandes(id, salon_id, client_nom, client_tel, demande_text, status, confirm_claim_at, stripe_session_id, proposal_expires_at, refuse_reason, proposed_at, confirmed_at, refused_at) values ('99999999-9999-4999-8999-999999999998',$1,'X','06','t','pending', now() + interval '1 day', 'cs_pirate2', now() + interval '30 days', 'motif forgé', now(), now(), now())`, [S]); return "ok"; } catch (e) { return e.message; } });
  const r = (await db.query(`select confirm_claim_at, stripe_session_id, proposal_expires_at, refuse_reason, proposed_at, confirmed_at, refused_at, proposed_data, proposal_token, rdv_online_id from rdv_demandes where id='99999999-9999-4999-8999-999999999998'`)).rows[0];
  ok("réserve 1 : insertion anonyme : confirm_claim_at, stripe_session_id, proposal_expires_at, refuse_reason… forcés à NULL", x === "ok" && r && Object.values(r).every((v) => v === null), { x, r });
});
await garde(async () => {
  // contre-audit final (réserve 6) : e-mail « expirée » quel que soit le chemin, une seule fois
  const nExp = async (id) => (await db.query(`select count(*)::int n from net.lx_appels where body->>'type'='expiree' and body->>'demande_id'=$1`, [id])).rows[0].n;
  const { id: ia } = await prop([optAc(115)]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [ia]);
  await db.query(`select public.fn_auto_expire_all()`);
  const sa = (await db.query(`select status from rdv_demandes where id=$1`, [ia])).rows[0].status;
  const na1 = await nExp(ia);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`); await db.query(`select public.fn_auto_expire_all()`);
  const na2 = await nExp(ia);
  ok("réserve 6 : expiration par la tâche de 02:30 (fn_auto_expire_all) : e-mail « expirée » demandé une fois (pas de second envoi par la tâche */15)", sa === "expired" && na1 === 1 && na2 === 1, { sa, na1, na2 });
  const { id: ib, p: pb } = await prop([optAc(116)]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [ib]);
  await rpc(db, "lx_demande_consulter", [pb.token]); await rpc(db, "lx_demande_consulter", [pb.token]);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  const sb = (await db.query(`select status from rdv_demandes where id=$1`, [ib])).rows[0].status;
  ok("réserve 6 : expiration à la lecture par le client : e-mail « expirée » demandé une fois", sb === "expired" && (await nExp(ib)) === 1, { sb, n: await nExp(ib) });
  const { id: ic } = await prop([optAc(117)]);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [ic]);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`); await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  ok("réserve 6 : expiration par la tâche */15 : e-mail « expirée » demandé une fois", (await nExp(ic)) === 1, await nExp(ic));
  const id1 = await demande(db);
  await db.query(`update rdv_demandes set status='proposed', proposal_token=md5(random()::text)||md5(random()::text), proposed_data='{}'::jsonb, proposal_expires_at=now()-interval '1 minute' where id=$1`, [id1]);
  await db.query(`select public.fn_auto_expire_all()`);
  ok("réserve 6 : ancien format (v1) expiré : pas d'e-mail serveur (inchangé)", (await nExp(id1)) === 0, await nExp(id1));
});

console.log(`SQL sur mesure v2 : ${nOk}/${nOk + nKo} OK (${((Date.now() - T0) / 1000).toFixed(1)} s)`);
if (kos.length) console.log("ÉCHECS :\n- " + kos.join("\n- "));
process.exit(nKo ? 1 : 0);
