// Tests unitaires edge functions (rdv-demande-propose v6, rdv-demande-proposal-action v14 / v13) + worker (Stripe simulé)
// sur la base reconstruite depuis la production + SQL v2.
import { creerBase } from "./base.mjs";
import { seed, S, S2, U, U2, CL, C1, C2, C3, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
import { creerMonde, chargerEdge, appelEdge, appelWorker, SERVICE } from "./harness.mjs";

let nOk = 0, nKo = 0; const kos = [];
function ok(nom, cond, detail) { if (cond) nOk++; else { nKo++; kos.push(nom + (detail !== undefined ? " :: " + JSON.stringify(detail).slice(0, 500) : "")); } }
async function garde(nom, fn) { try { await fn(); } catch (e) { ok(nom + " (exception)", false, e.stack || e.message); } }

const { db } = await creerBase();
await seed(db);
await appliquerV2(db);
await db.query(`update salons set sms_credits = 50 where id=$1`, [S]);
const monde = creerMonde(db);
monde.worker = (await import("./worker_bundle.mjs?" + Math.random())).default;
const propose = await chargerEdge("./edge_propose.mjs");
const action = await chargerEdge("./edge_action.mjs");
const action13 = await chargerEdge("./edge_action_v13.mjs");
monde.jwts.set("jwt-A", { id: U, email: "pro-a@exemple.test" });
monde.jwts.set("jwt-B", { id: U2, email: "pro-b@exemple.test" });

let k = 0;
const opt = (r, extra) => Object.assign({ rang: r, date: jour(20 + (k++)), heure: "10:00", collaborateur_id: C1, items: [{ type: "service", id: 9001 }], acompte_mode: "aucun" }, extra || {});
async function demande(salon = S, email = "julie@exemple.test", tel = "0600000000") {
  const r = await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, client_luxyra_id, demande_text, dispo_text, status)
    values ($1,'M.','Julie',$3,$2,$4,'Couleur ou mèches coupe cheveux mi long','Après 15h30','pending') returning id`, [salon, email, tel, salon === S ? CL : null]);
  return r.rows[0].id;
}
const nbTickets = async () => (await db.query(`select count(*)::int n from tickets where salon_id=$1`, [S])).rows[0].n;

// ---------- Edge « rdv-demande-propose » v6 ----------
await garde("E1", async () => {
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1)] });
  ok("propose : sans session -> 401", r.status === 401, r);
  r = await appelEdge(propose, { demande_id: id, options: [opt(1)] }, "jwt-B");
  ok("propose : autre établissement -> 403", r.status === 403 && r.body.code === "LX_SM_INTERDIT", r);
  const e0 = monde.emails.length;
  r = await appelEdge(propose, { demande_id: id, expire_heures: 48, options: [
    opt(1, { libelle: "Couleur + coupe", items: [{ type: "service", id: 9003 }], heure: "15:30", note: "Couleur ton sur ton" }),
    opt(2, { libelle: "Mèches + coupe", items: [{ type: "service", id: 9002, prix: 1 }], heure: "12:30", acompte_mode: "pct", acompte_valeur: 30, note: "Venez avec les cheveux secs" })] }, "jwt-A");
  ok("propose : 2 options envoyées (montants serveur : 68 € / 80 € acompte 24 €)", r.status === 200 && r.body.options.length === 2 && +r.body.options[1].prix_total === 80 && +r.body.options[1].acompte_montant === 24, r);
  ok("propose : lien de proposition", /^https:\/\/luxyra\.fr\/proposal\.html\?t=[0-9a-f]{32}$/.test(r.body.proposal_url), r.body.proposal_url);
  const m = monde.emails[e0];
  ok("e-mail « Nouvelle proposition » envoyé par le serveur", monde.emails.length === e0 + 1 && r.body.envoi.email === "envoye" && m.to[0].email === "julie@exemple.test", { e: monde.emails.length - e0, envoi: r.body.envoi });
  ok("e-mail : gabarit lxMailLayout + logo 128, 2 options, bouton, échéance", m && /luxyra-logo-128\.png/.test(m.htmlContent) && /OPTION A/.test(m.htmlContent) && /OPTION B/.test(m.htmlContent) && /Voir et choisir ma proposition/.test(m.htmlContent) && /Valable jusqu'au/.test(m.htmlContent) && /Acompte de 24,00 € à régler en ligne/.test(m.htmlContent) && /Sans acompte : confirmé tout de suite/.test(m.htmlContent) && /Envoi pour le compte de <b>Salon Test A<\/b>/.test(m.htmlContent), m && m.subject);
  ok("e-mail : expéditeur = nom de l'établissement, réponse à l'établissement", m && m.sender.name === "Salon Test A" && m.replyTo && m.replyTo.email === "salon-a@exemple.test", m && { s: m.sender, r: m.replyTo });
  const notif = (await db.query(`select count(*)::int n from client_notifications where client_luxyra_id=$1 and type='sur_mesure_proposition'`, [CL])).rows[0].n;
  ok("notification dans l'espace client Luxyra", notif === 1, notif);
  globalThis.P1 = { id, token: r.body.proposal_token, options: r.body.options };
  r = await appelEdge(propose, { demande_id: id, options: [opt(1)] }, "jwt-A");
  ok("propose : deuxième envoi sur une proposition en cours refusé", r.status === 409 && r.body.code === "LX_SM_STATUT", r);
});
await garde("E2", async () => {
  const id = await demande();
  const d = jour(19);
  await db.query(`insert into appointments(id, salon_id, collab_id, date_rdv, heure, a_phases, status) values (gen_random_uuid(),$1,$2,$3,'10:00','[{"t":"w","d":30}]','conf')`, [S, C1, d]);
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: d })] }, "jwt-A");
  ok("propose : créneau pris -> 409 conflit, rien d'écrit", r.status === 409 && r.body.conflit === true && r.body.conflits.length === 1, r);
  r = await appelEdge(propose, { demande_id: id, forcer: true, options: [opt(1, { date: d })] }, "jwt-A");
  ok("propose : « envoyer quand même » -> 200 avec avertissement", r.status === 200 && r.body.force === true, r);
  const id2 = await demande();
  r = await appelEdge(propose, { demande_id: id2, options: [opt(1, { items: [{ type: "service", id: 9005 }] })] }, "jwt-A");
  ok("propose : prestation sur devis -> 409 explicite", r.status === 409 && r.body.code === "LX_SM_DEVIS" && /sur devis/.test(r.body.error), r);
});
await garde("E3", async () => {
  // ancienne app (corps « proposed_data », montants du navigateur) -> 1 option, montants recalculés, pas d'e-mail serveur
  const id = await demande();
  const e0 = monde.emails.length;
  const r = await appelEdge(propose, { demande_id: id, proposed_data: { date: jour(18), heure: "11:00", collaborateur_id: C2, items: [{ service_id: 9002, nom: "X", prix: 1, duree: 30 }], duree_minutes: 30, prix_total: 1, acompte_pct: 30, acompte_montant: 0.3, message_salon: "ancien" } }, "jwt-A");
  ok("ancienne app : acceptée, convertie en 1 option, prix recalculé 80 € / acompte 24 €", r.status === 200 && r.body.options.length === 1 && +r.body.options[0].prix_total === 80 && +r.body.options[0].acompte_montant === 24 && r.body.options[0].duree_minutes === 170, r);
  ok("ancienne app : réponse compatible (proposal_url, client, salon_nom), pas d'e-mail serveur (l'app l'envoie)", r.body.proposal_url && r.body.client.email === "julie@exemple.test" && r.body.salon_nom === "Salon Test A" && monde.emails.length === e0, r.body);
});

// ---------- Edge « rdv-demande-proposal-action » v14 ----------
await garde("E4", async () => {
  const { token, options } = globalThis.P1;
  let r = await appelEdge(action, { token, action: "get" });
  ok("get v2 : options + établissement (Stripe actif)", r.status === 200 && r.body.version === 2 && r.body.options.length === 2 && r.body.salon.nom === "Salon Test A" && r.body.salon.stripe_actif === true && r.body.salon.stripe_connect_id === undefined, r.body && { v: r.body.version, s: r.body.salon });
  ok("get v2 : détail d'option (heure de fin, reste à payer, note)", r.body.options[1].heure_fin === "15:20" && +r.body.options[1].reste === 56 && r.body.options[1].note === "Venez avec les cheveux secs", r.body.options[1]);
  r = await appelEdge(action, { token, action: "confirm" });
  ok("ancienne page (confirm) sur une proposition v2 : 409 « rechargez »", r.status === 409, r);
  r = await appelEdge(action, { token, action: "choose", option_id: options[1].id });
  ok("choose : option avec acompte -> 409 « paiement en ligne »", r.status === 409 && r.body.code === "paiement", r);
  const e0 = monde.emails.length;
  r = await appelEdge(action, { token, action: "choose", option_id: options[0].id });
  ok("choose : option A sans acompte -> RDV confirmé", r.status === 200 && r.body.ok && r.body.rdv_online_id, r);
  const m = monde.emails[e0];
  ok("e-mail de confirmation (récapitulatif, itinéraire)", m && /Rendez-vous confirmé/.test(m.subject) && /Itinéraire/.test(m.htmlContent) && /68,00 €/.test(m.htmlContent), m && m.subject);
  r = await appelEdge(action, { token, action: "choose", option_id: options[1].id });
  ok("choose : deuxième choix refusé (déjà confirmé)", r.status === 409 && r.body.code === "LX_SM_DEJA", r);
  r = await appelEdge(action, { token, action: "get" });
  ok("get après choix : confirmée, option choisie", r.body.demande.status === "confirmed" && r.body.demande.option_choisie_id === options[0].id && r.body.options[0].statut === "choisie" && r.body.options[1].statut === "liberee", r.body.demande);
});
await garde("E5", async () => {
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1), opt(2, { heure: "14:00" })] }, "jwt-A");
  const t = r.body.proposal_token;
  r = await appelEdge(action, { token: t, action: "refuse", reason: "Je préfère un samedi" });
  const d = (await db.query(`select status, refuse_reason from rdv_demandes where id=$1`, [id])).rows[0];
  ok("refuse v2 avec message", r.status === 200 && d.status === "refused" && d.refuse_reason === "Je préfère un samedi", { r, d });
  r = await appelEdge(action, { token: "x".repeat(32), action: "get" });
  ok("jeton inconnu -> 404", r.status === 404, r);
});

// ---------- Worker : paiement de l'acompte de l'option choisie ----------
await garde("W1", async () => {
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [
    opt(1, { libelle: "Coupe" }),
    opt(2, { libelle: "Mèches", items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" }),
    opt(3, { libelle: "Forfait", items: [{ type: "forfait", id: 7001 }], collaborateur_id: null, acompte_mode: "montant", acompte_valeur: 50, heure: "14:00" })] }, "jwt-A");
  const { proposal_token: token, options: [A, B, C] } = r.body;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id });
  const sB = monde.stripe.sessions.get(r.body.session_id);
  ok("connect-pay B : session Stripe 24,00 € sur le compte du salon, 31 min, option en métadonnée", r.status === 200 && sB && sB.amount_total === 2400 && sB.compte === "acct_TESTA" && sB.metadata.option_id === B.id && sB.expires_at - Date.now() / 1000 > 30 * 60 && sB.expires_at - Date.now() / 1000 < 32 * 60, { r, sB: sB && { a: sB.amount_total, c: sB.compte } });
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: C.id });
  const sC = monde.stripe.sessions.get(r.body.session_id);
  ok("changement d'option (C) : session B expirée chez Stripe, nouvelle session 50,00 €", r.status === 200 && sB.status === "expired" && sC.amount_total === 5000, { st: sB.status, c: sC && sC.amount_total });
  const tk0 = await nbTickets(), e0 = monde.emails.length;
  monde.payer(sC.id);
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: sC.id });
  ok("finalize C : RDV confirmé", r.status === 200 && r.body.ok === true && r.body.rdv_online_id, r);
  const t = (await db.query(`select total_ttc, raw_data->>'acompteKey' k from tickets where salon_id=$1 order by num desc limit 1`, [S])).rows[0];
  ok("ticket « Acompte en ligne » 50 € scellé (chemin existant)", (await nbTickets()) === tk0 + 1 && +t.total_ttc === 50 && t.k === "acompte:" + r.body.rdv_online_id, t);
  ok("e-mail de confirmation (acompte payé)", monde.emails.length === e0 + 1 && /Acompte payé/.test(monde.emails[e0].htmlContent), monde.emails[e0] && monde.emails[e0].subject);
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: sC.id });
  ok("finalize rejoué (webhook) : idempotent, aucun ticket ni e-mail de plus", r.status === 200 && r.body.already_confirmed === true && (await nbTickets()) === tk0 + 1 && monde.emails.length === e0 + 1, r);
  globalThis.W1 = { token, A, B, C, id };
});
await garde("W2", async () => {
  // double paiement : B payée dans un onglet (non finalisée), puis C payée dans un autre -> B remboursée automatiquement
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [
    opt(1, { items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" }),
    opt(2, { items: [{ type: "service", id: 9004 }], acompte_mode: "montant", acompte_valeur: 10, heure: "16:00" })] }, "jwt-A");
  const { proposal_token: token, options: [B, C] } = r.body;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id }); const sB = r.body.session_id;
  monde.payer(sB); // payée mais l'onglet est fermé avant le retour
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: C.id }); const sC = r.body.session_id;
  ok("session B déjà payée : l'expiration échoue sans bloquer la nouvelle session", r.status === 200 && monde.stripe.sessions.get(sB).status === "complete", r);
  monde.payer(sC);
  const tk0 = await nbTickets(), rf0 = monde.stripe.refunds.length;
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: sC });
  ok("finalize C : RDV confirmé", r.status === 200 && r.body.ok, r);
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: sB });
  const rf = monde.stripe.refunds[rf0];
  ok("double paiement (B) détecté : remboursé automatiquement sur le compte du salon", r.status === 200 && r.body.ok === false && r.body.rembourse === true && rf && rf.payment_intent === "pi_" + sB && rf.compte === "acct_TESTA" && rf.metadata.motif === "lx_sur_mesure_paiement_en_trop", { r, rf });
  ok("double paiement : un seul RDV et un seul ticket", (await nbTickets()) === tk0 + 1 && (await db.query(`select count(*)::int n from rdv_online where payment_intent_id=$1`, ["pi_" + sB])).rows[0].n === 0, null);
  const p = (await db.query(`select statut, refund_id from rdv_demande_paiements where session_id=$1`, [sB])).rows[0];
  const al = (await db.query(`select count(*)::int n from server_errors where source='worker:rdv-demande-finalize' and severity='critical'`)).rows[0].n;
  ok("double paiement : tracé (remboursé) + alerte critique", p.statut === "rembourse" && p.refund_id === rf.id && al >= 1, { p, al });
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: sB });
  ok("doublon rejoué : pas de second remboursement", monde.stripe.refunds.length === rf0 + 1 && r.body.rembourse === true && r.body.deja === true, r);
});
await garde("W3", async () => {
  // annulation par le salon pendant un paiement ; paiement après annulation -> remboursé
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30 })] }, "jwt-A");
  const { proposal_token: token, options: [B] } = r.body;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id }); const sB = r.body.session_id;
  r = await appelWorker(monde, "/api/rdv-demande/salon-action", { demande_id: id, op: "annuler" }, { Authorization: "Bearer jwt-B" });
  ok("salon-action : autre établissement -> 403", r.status === 403, r);
  r = await appelWorker(monde, "/api/rdv-demande/salon-action", { demande_id: id, op: "annuler" }, { Authorization: "Bearer jwt-A" });
  ok("annulation par l'établissement : session de paiement expirée chez Stripe, proposition annulée", r.status === 200 && monde.stripe.sessions.get(sB).status === "expired" && (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status === "cancelled_by_salon", r);
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id });
  ok("après annulation : payer refusé", r.status === 409 && r.body.code === "LX_SM_INACTIVE", r);
  // cas limite : payé juste avant l'annulation -> l'annulation est refusée
  const id2 = await demande();
  r = await appelEdge(propose, { demande_id: id2, options: [opt(1, { items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "17:00" })] }, "jwt-A");
  const t2 = r.body.proposal_token, B2 = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t2, option_id: B2.id }); monde.payer(r.body.session_id);
  const sid2 = r.body.session_id;
  r = await appelWorker(monde, "/api/rdv-demande/salon-action", { demande_id: id2, op: "annuler" }, { Authorization: "Bearer jwt-A" });
  ok("annulation refusée si le client vient de payer", r.status === 409 && r.body.paye === true, r);
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token: t2, session_id: sid2 });
  ok("… et le RDV est bien créé ensuite", r.status === 200 && r.body.ok, r);
  // « proposer un autre horaire » par le worker
  const id3 = await demande();
  r = await appelEdge(propose, { demande_id: id3, options: [opt(1)] }, "jwt-A");
  r = await appelWorker(monde, "/api/rdv-demande/salon-action", { demande_id: id3, op: "reproposer" }, { Authorization: "Bearer jwt-A" });
  ok("« proposer un autre horaire » : demande à nouveau en attente", r.status === 200 && r.body.status === "pending", r);
});
await garde("W4", async () => {
  // sans Stripe actif ; ancienne page (sans option) ; e-mails de relance / expiration ; SMS sans e-mail ; accès interne
  const idB = await demande(S2);
  let r = await appelEdge(propose, { demande_id: idB, options: [{ rang: 1, date: jour(25), heure: "10:00", collaborateur_id: C3, items: [{ type: "service", id: 9101 }], acompte_mode: "pct", acompte_valeur: 30 }] }, "jwt-B");
  ok("établissement sans Stripe : acompte refusé à l'envoi", r.status === 409 && r.body.code === "LX_SM_STRIPE", r);
  const { token } = globalThis.W1;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token });
  ok("ancienne page (sans option) sur une proposition v2 : 409 « rechargez »", r.status === 409 && /rechargez/.test(r.body.error), r);
  r = await appelWorker(monde, "/api/rdv-demande/notifier", { demande_id: globalThis.W1.id, type: "confirmation" });
  ok("notifier : appel non interne refusé", r.status === 403, r);
  const id = await demande();
  r = await appelEdge(propose, { demande_id: id, options: [opt(1), opt(2, { heure: "16:00" })] }, "jwt-A");
  let e0 = monde.emails.length;
  r = await appelWorker(monde, "/api/rdv-demande/notifier", { demande_id: id, type: "relance" }, { "x-lx-internal": SERVICE });
  ok("relance : e-mail « expire bientôt »", r.status === 200 && r.body.email === "envoye" && /expire bientôt/.test(monde.emails[e0].subject), r);
  r = await appelWorker(monde, "/api/rdv-demande/notifier", { demande_id: id, type: "relance" }, { "x-lx-internal": SERVICE });
  ok("relance rejouée : pas de doublon", r.body.email === "deja" && monde.emails.length === e0 + 1, r);
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  e0 = monde.emails.length;
  r = await appelWorker(monde, "/api/rdv-demande/notifier", { demande_id: id, type: "expiree" }, { "x-lx-internal": SERVICE });
  ok("expiration : e-mail « Proposition expirée »", r.status === 200 && r.body.email === "envoye" && /expirée/.test(monde.emails[e0].subject), r);
  const idS = await demande(S, null, "0611223344");
  const s0 = monde.sms.length;
  r = await appelEdge(propose, { demande_id: idS, options: [opt(1)] }, "jwt-A");
  ok("client sans e-mail : SMS court avec le lien", r.status === 200 && r.body.envoi.sms === "envoye" && monde.sms.length === s0 + 1 && /proposal\.html\?t=/.test(JSON.stringify(monde.sms[s0])), { envoi: r.body.envoi, sms: monde.sms[s0] });
});
await garde("W5", async () => {
  // session Stripe expirée (non payée) : le client peut choisir une autre option ; proposition expirée pendant le paiement
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1), opt(2, { items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })] }, "jwt-A");
  const { proposal_token: token, options: [A, B] } = r.body;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id });
  monde.stripe.sessions.get(r.body.session_id).status = "expired";
  await db.query(`update rdv_demandes set checkout_expires_at = now() - interval '1 minute' where id=$1`, [id]);
  r = await appelEdge(action, { token, action: "choose", option_id: A.id });
  ok("session Stripe expirée sans paiement : choix d'une autre option possible", r.status === 200 && r.body.ok, r);
  // proposition échue pendant un paiement en cours : paiement accepté
  const id2 = await demande();
  r = await appelEdge(propose, { demande_id: id2, options: [opt(1, { items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })] }, "jwt-A");
  const t2 = r.body.proposal_token, B2 = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t2, option_id: B2.id }); const s2 = r.body.session_id;
  await db.query(`update rdv_demandes set proposal_expires_at = now() - interval '1 minute' where id=$1`, [id2]);
  await db.query(`select lx_prive.demandes_sur_mesure_echeances()`);
  monde.payer(s2);
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token: t2, session_id: s2 });
  ok("proposition échue pendant le paiement : paiement honoré, RDV créé", r.status === 200 && r.body.ok, r);
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t2, option_id: B2.id });
  ok("après confirmation : nouveau paiement refusé", r.status === 409 && r.body.code === "LX_SM_DEJA", r);
});

await garde("W6", async () => {
  // webhook « comptes connectés » seul (le client a fermé l'onglet avant le retour) -> RDV + ticket, puis la page -> déjà fait
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })] }, "jwt-A");
  const token = r.body.proposal_token, B = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id });
  const s = monde.payer(r.body.session_id);
  monde.stripe.events = monde.stripe.events || {};
  monde.stripe.events["evt_TEST1"] = { id: "evt_TEST1", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: s } };
  const tk0 = await nbTickets();
  r = await appelWorker(monde, "/api/stripe/webhook-connect", { id: "evt_TEST1", account: "acct_TESTA" });
  const d = (await db.query(`select status from rdv_demandes where id=$1`, [id])).rows[0].status;
  ok("webhook seul : RDV confirmé + ticket d'acompte", r.status === 200 && d === "confirmed" && (await nbTickets()) === tk0 + 1, { r, d });
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: s.id });
  ok("retour de la page après le webhook : « déjà confirmé », rien de plus", r.status === 200 && r.body.already_confirmed === true && (await nbTickets()) === tk0 + 1, r);
});


// ---------- Contre-audit du 30/10 : (a) retour depuis Stripe, BLOQUANT 1 (jamais d'argent sans ticket), (f), (g) ----------
let _kCA = 0; const jourCA = () => { const d = new Date(Date.UTC(2027, 2, 1) + (_kCA++) * 864e5); if (d.getUTCDay() === 0) { d.setUTCDate(d.getUTCDate() + 1); _kCA++; } return d.toISOString().slice(0, 10); };
await garde("CA-a", async () => {
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: jourCA() }), opt(2, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })], forcer: true }, "jwt-A");
  const { proposal_token: token, options: [A, B] } = r.body;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id }); const sB = r.body.session_id;
  // le client revient de Stripe sans payer (cancel_url) : la page appelle liberer-paiement
  r = await appelWorker(monde, "/api/rdv-demande/liberer-paiement", { token });
  const d = (await db.query(`select checkout_session_id from rdv_demandes where id=$1`, [id])).rows[0];
  ok("a : retour depuis Stripe -> session expirée chez Stripe tout de suite, paiement en cours effacé", r.status === 200 && r.body.expiree && monde.stripe.sessions.get(sB).status === "expired" && d.checkout_session_id === null, { r, d });
  r = await appelEdge(action, { token, action: "choose", option_id: A.id });
  ok("a : choix de A immédiatement possible (pas d'attente de 31 min)", r.status === 200 && r.body.ok, r);
  // choix direct sans passer par la page (onglet resté sur Stripe) : l'edge expire elle-même la session
  const id2 = await demande();
  r = await appelEdge(propose, { demande_id: id2, options: [opt(1, { date: jourCA(), heure: "16:30" }), opt(2, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })], forcer: true }, "jwt-A");
  const t2 = r.body.proposal_token, [A2, B2] = r.body.options;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t2, option_id: B2.id }); const sB2 = r.body.session_id;
  r = await appelEdge(action, { token: t2, action: "choose", option_id: A2.id });
  ok("a : choix de A pendant la session de B : session B expirée par l'edge AVANT, A confirmée", r.status === 200 && monde.stripe.sessions.get(sB2).status === "expired", { r, st: monde.stripe.sessions.get(sB2).status });
  // refus juste après l'abandon
  const id3 = await demande();
  r = await appelEdge(propose, { demande_id: id3, options: [opt(1, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })], forcer: true }, "jwt-A");
  const t3 = r.body.proposal_token, B3 = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t3, option_id: B3.id }); const sB3 = r.body.session_id;
  r = await appelEdge(action, { token: t3, action: "refuse", reason: "finalement non" });
  ok("a : refus immédiat après abandon : accepté, session expirée", r.status === 200 && monde.stripe.sessions.get(sB3).status === "expired", r);
  // la session avait en fait été PAYÉE (webhook pas encore arrivé) : le choix d'une autre option est refusé, B est confirmée
  const id4 = await demande();
  r = await appelEdge(propose, { demande_id: id4, options: [opt(1, { date: jourCA(), heure: "17:30" }), opt(2, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })], forcer: true }, "jwt-A");
  const t4 = r.body.proposal_token, [A4, B4] = r.body.options;
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t4, option_id: B4.id }); monde.payer(r.body.session_id);
  const tk0 = await nbTickets();
  r = await appelEdge(action, { token: t4, action: "choose", option_id: A4.id });
  const st4 = (await db.query(`select status, option_choisie_id from rdv_demandes where id=$1`, [id4])).rows[0];
  ok("a : session déjà payée : finalisée (B confirmée + ticket), choix de A refusé « paiement reçu »", r.status === 409 && r.body.deja_paye && st4.status === "confirmed" && st4.option_choisie_id === B4.id && (await nbTickets()) === tk0 + 1, { r, st4 });
  // liberer-paiement avec la session d'une autre proposition : refusé
  r = await appelWorker(monde, "/api/rdv-demande/liberer-paiement", { token: t3, session_id: sB2 });
  ok("a : liberer-paiement : session d'une autre proposition refusée", r.status === 403, r);
});
await garde("CA-B1", async () => {
  // échec quelconque de la création du RDV après paiement -> remboursement automatique + alerte, aucun RDV ni ticket
  await db.exec(`create or replace function public._test_panne() returns trigger language plpgsql as $$ begin if NEW.client_prenom = 'PANNE' then raise exception 'panne simulée'; end if; return NEW; end $$;
    create trigger _test_panne before insert on public.rdv_online for each row execute function public._test_panne();`);
  const id = (await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, demande_text, status) values ($1,'M.','PANNE','0600000000','p@x.test','x','pending') returning id`, [S])).rows[0].id;
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })], forcer: true }, "jwt-A");
  const token = r.body.proposal_token, B = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id }); const s = monde.payer(r.body.session_id);
  const tk0 = await nbTickets(), rf0 = monde.stripe.refunds.length;
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: s.id });
  const rf = monde.stripe.refunds[rf0];
  const nr = (await db.query(`select count(*)::int n from rdv_online where payment_intent_id=$1`, [s.payment_intent])).rows[0].n;
  const p = (await db.query(`select statut, refund_id from rdv_demande_paiements where session_id=$1`, [s.id])).rows[0];
  ok("B1 : RDV impossible après paiement -> remboursé automatiquement (compte du salon), aucun RDV ni ticket, message clair",
    r.status === 200 && r.body.code === "erreur" && r.body.rembourse === true && rf && rf.payment_intent === s.payment_intent && rf.compte === "acct_TESTA" && nr === 0 && (await nbTickets()) === tk0 && p.statut === "rembourse" && /remboursé/.test(r.body.error), { r, nr, p });
  monde.stripe.events = monde.stripe.events || {};
  monde.stripe.events["evt_PANNE"] = { id: "evt_PANNE", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: s } };
  r = await appelWorker(monde, "/api/stripe/webhook-connect", { id: "evt_PANNE", account: "acct_TESTA" });
  ok("B1 : webhook rejoué : aucun second remboursement", r.status === 200 && monde.stripe.refunds.length === rf0 + 1, { r, n: monde.stripe.refunds.length - rf0 });
  await db.exec(`drop trigger _test_panne on public.rdv_online; drop function public._test_panne();`);
  // remboursement refusé par Stripe : tracé « remboursement_echec » + alerte critique (à faire dans Stripe)
  const id2 = (await db.query(`insert into rdv_demandes(salon_id, client_nom, client_prenom, client_tel, client_email, demande_text, status) values ($1,'M.','J','06','j@x.test','x','pending') returning id`, [S])).rows[0].id;
  r = await appelEdge(propose, { demande_id: id2, options: [opt(1, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "13:30" }), opt(2, { date: jourCA(), items: [{ type: "service", id: 9004 }], acompte_mode: "montant", acompte_valeur: 10, heure: "16:00" })], forcer: true }, "jwt-A");
  const t2 = r.body.proposal_token, [X, Y] = r.body.options;
  const r0 = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: t2, option_id: X.id });
  if (!r0.body || !r0.body.session_id) throw new Error("connect-pay X : " + JSON.stringify(r0));
  const sx = monde.payer(r0.body.session_id);
  await appelWorker(monde, "/api/rdv-demande/finalize", { token: t2, session_id: sx.id });
  const sy = { id: "cs_test_Y" + Date.now(), object: "checkout.session", status: "complete", payment_status: "paid", payment_intent: "pi_Y" + Date.now(), amount_total: 1000, metadata: { type: "rdv_demande_acompte", proposal_token: t2, option_id: Y.id, demande_id: id2 } };
  monde.stripe.sessions.set(sy.id, sy); monde.stripe.refuserRefund = true;
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token: t2, session_id: sy.id });
  monde.stripe.refuserRefund = false;
  const p2 = (await db.query(`select statut from rdv_demande_paiements where session_id=$1`, [sy.id])).rows[0];
  ok("B1 : remboursement refusé par Stripe -> « remboursement_echec » + message « l'établissement va vous rembourser »", r.body.rembourse === false && p2 && p2.statut === "remboursement_echec" && /va vous rembourser/.test(r.body.error), { r, p2 });
});
await garde("CA-B1-lien", async () => {
  // paiement sur un lien REMPLACÉ (nouvelle proposition après refus) arrivé par le webhook : remboursé (compte connu par le webhook)
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "12:30" })], forcer: true }, "jwt-A");
  const token = r.body.proposal_token, B = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id }); const s = monde.payer(r.body.session_id);
  await db.query(`update rdv_demandes set status='refused', checkout_session_id=null, checkout_expires_at=null where id=$1`, [id]);
  r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: jourCA(), heure: "17:00" })], forcer: true }, "jwt-A");
  ok("f : nouvelle proposition après refus (edge)", r.status === 200 && r.body.proposal_token !== token && r.body.envoi_n === 2, r);
  monde.stripe.events["evt_OLD"] = { id: "evt_OLD", type: "checkout.session.completed", created: Math.floor(Date.now() / 1000), data: { object: s } };
  const rf0 = monde.stripe.refunds.length;
  r = await appelWorker(monde, "/api/stripe/webhook-connect", { id: "evt_OLD", account: "acct_TESTA" });
  ok("B1 : paiement sur l'ancien lien (remplacé) -> remboursé automatiquement", r.status === 200 && monde.stripe.refunds.length === rf0 + 1 && monde.stripe.refunds[rf0].payment_intent === s.payment_intent, { r, n: monde.stripe.refunds.length - rf0 });
});
await garde("CA-B1-rb", async () => {
  // fonction de finalisation absente (retour arrière SQL pendant un paiement) : 404 PostgREST -> remboursement, pas de rejeu sans fin
  const id = await demande();
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: jourCA(), items: [{ type: "service", id: 9002 }], acompte_mode: "pct", acompte_valeur: 30, heure: "18:00" })], forcer: true }, "jwt-A");
  const token = r.body.proposal_token, B = r.body.options[0];
  r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token, option_id: B.id }); const s = monde.payer(r.body.session_id);
  await db.exec(`alter function public.lx_demande_paiement_finaliser(text, text, uuid, text, text, bigint) rename to lx_demande_paiement_finaliser_x`);
  const rf0 = monde.stripe.refunds.length;
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token, session_id: s.id });
  await db.exec(`alter function public.lx_demande_paiement_finaliser_x(text, text, uuid, text, text, bigint) rename to lx_demande_paiement_finaliser`);
  ok("B1 : finalisation impossible (fonction absente) -> remboursé + alerte, pas de 503 sans fin", r.status === 200 && r.body.code === "erreur" && monde.stripe.refunds.length === rf0 + 1, r);
});
await garde("CA-g", async () => {
  const id = await demande();
  const e0 = monde.emails.length;
  let r = await appelEdge(propose, { demande_id: id, options: [opt(1, { date: jourCA(), heure: "09:30", note: "Cheveux secs svp" }), opt(2, { date: jourCA(), heure: "11:00" })], forcer: true }, "jwt-A");
  const h = monde.emails[e0] && monde.emails[e0].htmlContent || "", txt = monde.emails[e0] && monde.emails[e0].textContent || "";
  const iA = h.indexOf("OPTION A"), iB = h.indexOf("OPTION B"), iN = h.indexOf("Note pour l'option A");
  ok("g : e-mail : la note est dans la carte de l'option A (avant l'option B) et nommée", r.status === 200 && iN > iA && iN < iB && /Note pour l'option A : « Cheveux secs svp »/.test(txt), { iA, iB, iN });
});
// ---------- Ancien format : v13 et v14 identiques ; worker v1 inchangé (acompte -> ticket) ----------
await garde("V1", async () => {
  let hv = 9;
  async function v1(acompte) {
    hv++;
    const id = await demande();
    const tok = ("v1" + Math.random().toString(16).slice(2) + "0".repeat(32)).slice(0, 32);
    await db.query(`update rdv_demandes set status='proposed', proposal_token=$2, proposal_expires_at=now()+interval '72 hours', proposed_at=now(), proposed_data=$3 where id=$1`, [id, tok,
      JSON.stringify({ date: jour(70), heure: hv + ":00", collaborateur_id: C2, collaborateur_nom: "Manue", items: [{ service_id: 9001, nom: "COUPE BRUSHING COURT", prix: 30, duree: 30 }], prix_total: 30, duree_minutes: 30, acompte_montant: acompte })]);
    return { id, tok };
  }
  const a = await v1(0), b = await v1(0);
  const g13 = await appelEdge(action13, { token: a.tok, action: "get" }), g14 = await appelEdge(action, { token: b.tok, action: "get" });
  const norm = (x) => JSON.stringify(Object.assign({}, x.body, { demande: Object.assign({}, x.body.demande, { id: 0, proposed_data: { ...x.body.demande.proposed_data, date: 0, heure: 0 }, expires_at: 0 }) }));
  ok("ancien format : get identique v13 / v14", g13.status === 200 && g14.status === 200 && norm(g13) === norm(g14), { g13: g13.body && g13.body.demande.status, g14: g14.body && g14.body.demande.status });
  const c13 = await appelEdge(action13, { token: a.tok, action: "confirm" }), c14 = await appelEdge(action, { token: b.tok, action: "confirm" });
  const r13 = (await db.query(`select status, service_prix, duree_minutes, collaborateur_id, message from rdv_online where id=$1`, [c13.body.rdv_online_id])).rows[0];
  const r14 = (await db.query(`select status, service_prix, duree_minutes, collaborateur_id, message from rdv_online where id=$1`, [c14.body.rdv_online_id])).rows[0];
  ok("ancien format : confirm identique v13 / v14 (RDV confirmé)", c13.status === 200 && c14.status === 200 && r13 && r14 && r13.status === r14.status && r13.service_prix === r14.service_prix && r13.duree_minutes === r14.duree_minutes && r13.message.replace(/#\w+/, "") === r14.message.replace(/#\w+/, ""), { c13, c14, r13, r14 });
  // worker v1 : acompte d'une ancienne proposition -> Stripe -> finalize -> ticket (non-régression)
  const c = await v1(9);
  let r = await appelWorker(monde, "/api/rdv-demande/connect-pay", { token: c.tok });
  const s = monde.stripe.sessions.get(r.body.session_id);
  ok("ancien format : connect-pay (sans option) inchangé", r.status === 200 && s.amount_total === 900 && !s.metadata.option_id, r);
  monde.payer(s.id);
  const tk0 = await nbTickets();
  r = await appelWorker(monde, "/api/rdv-demande/finalize", { token: c.tok, session_id: s.id });
  ok("ancien format : finalize inchangé -> RDV + ticket d'acompte 9 €", r.status === 200 && r.body.ok && (await nbTickets()) === tk0 + 1, r);
});

console.log(`Edge + worker sur mesure v2 : ${nOk}/${nOk + nKo} OK`);
if (kos.length) console.log("ÉCHECS :\n- " + kos.join("\n- "));
monde.restaurer();
process.exit(nKo ? 1 : 0);
