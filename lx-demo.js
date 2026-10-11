/* =====================================================================
 * LUXYRA — MODE DÉMO (app.html?demo=<metier>[&mode=salon|domicile|mixte][&page=...])
 * 2026-10-11
 * La VRAIE application tourne avec des données FICTIVES générées ici, en mémoire.
 *  - aucun compte, aucune connexion, aucune requête vers la base ni vers les paiements ;
 *  - toute modification reste dans l'onglet et disparaît au rechargement ;
 *  - stockage du navigateur isolé (rien d'une vraie session n'est lu ni modifié).
 * Chargé uniquement par app.html quand ?demo= est présent, APRÈS supabase.min.js et AVANT
 * luxyra-supabase.js : on remplace supabase.createClient par un client simulé.
 * ===================================================================== */
(function () {
  "use strict";
  var P = new URLSearchParams(location.search);
  var METIERS = ["coiffure", "barbier", "esthetique", "ongles", "regard", "maquillage", "tatouage", "spa", "bien_etre"];
  var METIER = METIERS.indexOf(P.get("demo")) >= 0 ? P.get("demo") : "coiffure";
  var MODE_DEF = { coiffure: "salon", barbier: "salon", esthetique: "mixte", ongles: "salon", regard: "salon", maquillage: "domicile", tatouage: "salon", spa: "mixte", bien_etre: "domicile" };
  var MODE = ["salon", "domicile", "mixte"].indexOf(P.get("mode")) >= 0 ? P.get("mode") : MODE_DEF[METIER];
  window.LX_DEMO = { metier: METIER, mode: MODE };

  // ---------- utilitaires ----------
  var seed = 0; for (var si = 0; si < METIER.length; si++) seed = (seed * 31 + METIER.charCodeAt(si)) >>> 0;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  function pick(a) { return a[Math.floor(rnd() * a.length)]; }
  function uuid() { var s = ""; for (var i = 0; i < 32; i++) { s += Math.floor(rnd() * 16).toString(16); } return s.slice(0, 8) + "-" + s.slice(8, 12) + "-4" + s.slice(13, 16) + "-a" + s.slice(17, 20) + "-" + s.slice(20, 32); }
  function ymd(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function hm(min) { return String(Math.floor(min / 60)).padStart(2, "0") + ":" + String(min % 60).padStart(2, "0"); }
  function r2(n) { return Math.round(n * 100) / 100; }
  var NOW = new Date(), TODAY = ymd(NOW);
  var SALON_ID = "00000000-de00-4000-a000-" + ("000000000000" + (METIERS.indexOf(METIER) + 1)).slice(-12);
  var USER_ID = "00000000-de00-4000-b000-000000000001";

  // ---------- catalogues par métier ----------
  var C = {
    coiffure: { nom: "Maison Lumière", slogan: "Coiffure & couleur sur-mesure", collabs: ["Camille", "Julie", "Thomas"],
      svc: [["Coupe & brushing femme", 42, 60, "Coupe"], ["Coupe homme", 24, 30, "Coupe"], ["Brushing", 28, 30, "Brushing"], ["Couleur racines", 48, 90, "Coloration", 30], ["Balayage", 95, 150, "Mèches", 40], ["Soin profond", 18, 20, "Soin"], ["Chignon", 55, 60, "Technique"]],
      prod: [["Shampoing réparateur", 16.9], ["Masque nutrition", 22.5], ["Huile sublimatrice", 19.9], ["Spray thermo-protecteur", 14.5]] },
    barbier: { nom: "Le Barbier du Quai", slogan: "Coupes, barbes & rasage à l'ancienne", collabs: ["Karim", "Lucas", "Enzo"],
      svc: [["Coupe homme", 22, 30, "Coupe"], ["Dégradé américain", 25, 40, "Dégradé"], ["Taille de barbe", 15, 20, "Barbe"], ["Rasage traditionnel", 28, 30, "Rasage"], ["Coupe + barbe", 35, 50, "Coupe"], ["Coupe enfant", 15, 20, "Coupe"]],
      prod: [["Huile à barbe", 18], ["Cire coiffante", 14.5], ["Baume après-rasage", 16]] },
    esthetique: { nom: "Institut Éclat", slogan: "Soins visage, corps & épilations", collabs: ["Léa", "Inès"],
      svc: [["Soin visage éclat", 55, 60, "Soin visage"], ["Épilation jambes complètes", 32, 40, "Épilation"], ["Épilation maillot", 18, 20, "Épilation"], ["Massage relaxant", 60, 60, "Massage"], ["Beauté des mains", 28, 40, "Onglerie"], ["Teinture des cils", 15, 20, "Maquillage"]],
      prod: [["Crème hydratante", 34], ["Sérum éclat", 42], ["Gommage douceur", 24]] },
    ongles: { nom: "Nail Studio Rose", slogan: "Gel, semi-permanent & nail art", collabs: ["Sarah", "Mélissa"],
      svc: [["Pose gel complète", 45, 75, "Gel"], ["Remplissage gel", 35, 60, "Gel"], ["Semi-permanent mains", 30, 40, "Semi-permanent"], ["Semi-permanent pieds", 32, 45, "Pédicure"], ["Nail art (10 ongles)", 15, 20, "Nail art"], ["Dépose", 15, 20, "Réparation"]],
      prod: [["Huile cuticules", 9.9], ["Crème mains", 12], ["Kit lime & polissoir", 6.5]] },
    regard: { nom: "Studio Regard", slogan: "Extensions de cils & sourcils", collabs: ["Chloé", "Yasmine"],
      svc: [["Extension cil à cil", 89, 120, "Extension de cils"], ["Remplissage 2 semaines", 45, 60, "Remplissage"], ["Rehaussement + teinture", 59, 60, "Rehaussement de cils"], ["Restructuration sourcils", 20, 20, "Sourcils"], ["Brow lift", 49, 45, "Brow lift"], ["Teinture sourcils", 12, 15, "Teinture"]],
      prod: [["Sérum de croissance cils", 39], ["Nettoyant cils", 15], ["Brosse goupillon", 5]] },
    maquillage: { nom: "Clara Make-up", slogan: "Maquilleuse professionnelle à domicile", collabs: ["Clara"],
      svc: [["Maquillage jour", 40, 45, "Maquillage jour"], ["Maquillage soirée", 55, 60, "Maquillage soirée"], ["Mariée (essai + jour J)", 180, 120, "Mariée"], ["Cours d'auto-maquillage", 70, 90, "Retouche"], ["Maquillage invitée", 50, 45, "Maquillage soirée"]],
      prod: [["Fixateur de maquillage", 19], ["Rouge à lèvres longue tenue", 22], ["Palette regard", 35]] },
    tatouage: { nom: "Encre Noire Tattoo", slogan: "Tatouage & piercing", collabs: ["Max", "Nina"],
      svc: [["Consultation & projet", 0, 30, "Consultation"], ["Petit tatouage", 80, 60, "Tatouage"], ["Tatouage moyen", 180, 180, "Tatouage"], ["Séance journée", 450, 360, "Tatouage"], ["Piercing oreille", 35, 20, "Piercing"], ["Piercing nez", 40, 20, "Piercing"]],
      prod: [["Crème cicatrisante", 15], ["Bijou titane", 25], ["Solution saline", 9]] },
    spa: { nom: "Spa Sérénité", slogan: "Massages, hammam & rituels", collabs: ["Aurélie", "Sofia", "Hugo"],
      svc: [["Massage californien 1 h", 75, 60, "Massage"], ["Massage pierres chaudes", 85, 75, "Massage"], ["Hammam + gommage", 49, 45, "Hammam"], ["Soin corps enveloppant", 70, 60, "Soin corps"], ["Rituel duo", 150, 90, "Rituel"], ["Réflexologie plantaire", 55, 50, "Réflexologie"]],
      prod: [["Huile de massage", 24], ["Bougie de massage", 19], ["Sels de bain", 16]] },
    bien_etre: { nom: "Émilie Bien-être", slogan: "Massages & relaxation à domicile", collabs: ["Émilie"],
      svc: [["Massage relaxant 1 h", 60, 60, "Massage"], ["Réflexologie plantaire", 50, 50, "Réflexologie"], ["Shiatsu", 60, 60, "Shiatsu"], ["Drainage lymphatique", 70, 60, "Drainage"], ["Séance découverte 30 min", 35, 30, "Massage"]],
      prod: [["Huile essentielle lavande", 12], ["Baume relaxant", 18]] }
  };
  var CAT = C[METIER];
  var PRENOMS_F = ["Sophie", "Emma", "Manon", "Laura", "Chloé", "Sarah", "Julie", "Léa", "Camille", "Inès", "Nadia", "Pauline", "Lucie", "Margaux", "Élodie", "Anaïs", "Clara", "Océane"];
  var PRENOMS_H = ["Lucas", "Hugo", "Nathan", "Karim", "Antoine", "Julien", "Mehdi", "Théo", "Maxime", "Yanis"];
  var NOMS = ["Martin", "Bernard", "Dubois", "Moreau", "Laurent", "Simon", "Michel", "Lefebvre", "Leroy", "Roux", "David", "Bertrand", "Morel", "Fournier", "Girard", "Bonnet", "Dupont", "Lambert", "Fontaine", "Rousseau", "Vincent", "Muller", "Faure", "André"];
  var COULEURS = ["#c8a84e", "#e91e63", "#4a85b5", "#2d9a5e", "#8050a8"];
  var homme = METIER === "barbier";

  // ---------- génération ----------
  var T = {};
  var cfg = {
    metier: METIER, modeActivite: MODE, mode_activite: MODE, verrouillage_min: 0, validite_devis: 30,
    fidconf: { mode: "passages", seuil: 10, remise: 10, remiseType: "pct" },
    pay_active: { cb: true, esp: true, chq: true, vir: true, bon: true },
    categories_services: CAT.svc.map(function (s) { return s[3]; }).filter(function (v, i, a) { return a.indexOf(v) === i; })
  };
  if (MODE !== "salon") cfg.domicile = { type: "km", forfait: 15, prixKm: 0.6, zone: 25, gratuitKm: 5, communes: [] };
  T.salons = [{
    id: SALON_ID, user_id: USER_ID, nom: CAT.nom, sous_titre: CAT.slogan, logo: "", adresse: MODE === "domicile" ? "" : "12 rue de la République", cp: "57000", ville: "Metz",
    tel: "03 87 00 00 00", email: "demo@luxyra.fr", site_web: "", siret: "12345678900012", tva: "", taux_tva: 20, taux_tva_produits: 20,
    plan: "pro", billing: "monthly", status: "active", trial_end: null, is_free: true, free_until: null, show_tva_ticket: true,
    config_json: JSON.stringify(cfg), metier: METIER, subdomain: "demo", slug: "demo-" + METIER, forme_juridique: "sasu", verification_status: "verified",
    documents_kbis: "demo", documents_id: "demo", documents_uploaded_at: NOW.toISOString(), mode_activite: MODE, zone_deplacement_km: MODE === "salon" ? 0 : 25,
    frais_deplacement: MODE === "salon" ? 0 : 0.6, frais_deplacement_type: "par_km", sms_credits: 250, sms_mode: "brevo", stripe_connect_id: "acct_demo", stripe_connect_status: "active",
    cgv_accepted_at: NOW.toISOString(), contrat_accepted_at: NOW.toISOString(), contrat_signature: { demo: true }, code_parrainage: "DEMO2026", exercice_fin_mois: 12,
    couleur_primaire: "#c8a84e", couleur_secondaire: "#1a1a1a", abonne_depuis: NOW.toISOString(), created_at: addDays(NOW, -200).toISOString(), note_moyenne: 4.9, nb_avis: 37
  }];
  // Démo : ouvert tous les jours (une visite le dimanche montre aussi une journée remplie)
  var hor = { "0": { o: "10:00", c: "17:00" }, "1": { o: "09:00", c: "19:00" }, "2": { o: "09:00", c: "19:00" }, "3": { o: "09:00", c: "19:00" }, "4": { o: "09:00", c: "19:00" }, "5": { o: "09:00", c: "19:00" }, "6": { o: "09:00", c: "17:00" } };
  T.collaborateurs = CAT.collabs.map(function (n, i) { return { id: 9001 + i, salon_id: SALON_ID, nom: n, initiales: n.slice(0, 2).toUpperCase(), couleur: COULEURS[i % COULEURS.length], img: "", horaires: hor, actif: true, inactif: false, pause: { o: "12:30", c: "13:30" }, competences: null, photo_visible: false, horaires_overrides: {}, date_entree: "2024-01-08", created_at: NOW.toISOString() }; });
  T.services = CAT.svc.map(function (s, i) { var ph = s[4] ? [{ l: s[0], d: Math.round((s[2] - s[4]) / 2), t: "w" }, { l: "Temps de pose", d: s[4], t: "p" }, { l: "Finition", d: s[2] - s[4] - Math.round((s[2] - s[4]) / 2), t: "w" }] : [{ l: s[0], d: s[2], t: "w" }]; return { id: 7001 + i, salon_id: SALON_ID, nom: s[0], prix: s[1], categorie: s[3], phases: ph, actif: true, show_site: true, book_online: true, ordre: i, cat_genre: homme ? "H" : "F", created_at: NOW.toISOString() }; });
  T.produits = CAT.prod.map(function (p, i) { return { id: 8001 + i, salon_id: SALON_ID, nom: p[0], prix: p[1], prix_achat: r2(p[1] * 0.45), categorie: "Revente", stock: 6 + i * 3, stock_min: 3, actif: true, for_sale: true, for_use: false, tva_taux: 20, created_at: NOW.toISOString() }; });
  T.clients = [];
  for (var ci = 0; ci < 32; ci++) {
    var h = homme ? rnd() < 0.85 : rnd() < 0.15;
    var pr, nm, tries = 0; do { pr = h ? pick(PRENOMS_H) : pick(PRENOMS_F); nm = pick(NOMS); tries++; } while (T.clients.some(function (x) { return x.prenom === pr && x.nom === nm; }) && tries < 50);
    T.clients.push({ id: uuid(), salon_id: SALON_ID, nom: nm, prenom: pr, sexe: h ? "H" : "F", telephone: "06 " + String(10 + ci).padStart(2, "0") + " " + String(Math.floor(rnd() * 90 + 10)) + " " + String(Math.floor(rnd() * 90 + 10)) + " " + String(Math.floor(rnd() * 90 + 10)), email: (pr + "." + nm).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") + "@exemple.fr", adresse: MODE === "salon" ? "" : (Math.floor(rnd() * 40) + 1) + " rue des Lilas", cp: "57000", ville: "Metz", actif: true, points_fidelite: Math.floor(rnd() * 9), sms_ok: true, email_ok: true, fiches: [], fiche_tech: {}, created_at: addDays(NOW, -Math.floor(rnd() * 300)).toISOString(), acompte_online: "defaut", collab_pref: T.collaborateurs[ci % T.collaborateurs.length].id });
  }
  T.appointments = []; T.tickets = []; T.clotures = [];
  var tk = 0, lieuDom = MODE === "domicile";
  function mkAppt(dateStr, startMin, st, collab) {
    var s = T.services[Math.floor(rnd() * T.services.length)];
    if (Number(s.prix) === 0 && st === "done") s = T.services[1];
    var cl = T.clients[Math.floor(rnd() * T.clients.length)];
    var items = [{ sId: s.id, name: s.nom, price: Number(s.prix), qty: 1, remise: 0 }];
    if (st === "done" && rnd() < 0.25 && T.produits.length) { var p = T.produits[Math.floor(rnd() * T.produits.length)]; items.push({ name: p.nom, price: Number(p.prix), qty: 1, remise: 0, isProd: true, pId: p.id }); }
    var dom = MODE === "domicile" || (MODE === "mixte" && rnd() < 0.35);
    var frais = 0;
    if (dom && st === "done") { frais = r2(0.6 * Math.floor(rnd() * 12 + 3)); items.push({ name: "🚗 Déplacement", price: frais, qty: 1, remise: 0, isFraisDepl: true }); }
    var total = r2(items.reduce(function (a, it) { return a + it.price * it.qty; }, 0));
    var met = st === "done" ? pick(["CB", "CB", "CB", "Especes", "Especes + CB", "Cheque"]) : "";
    var pays = null;
    if (met === "Especes + CB") { var e = Math.min(20, r2(total / 2)); pays = [{ method: "Especes", amount: e }, { method: "CB", amount: r2(total - e) }]; }
    var a = { id: uuid(), salon_id: SALON_ID, client_id: cl.id, service_id: s.id, collab_id: collab.id, date_rdv: dateStr, heure: hm(startMin), prix: total, brut_total: total, remise: 0, status: st, mode_paiement: met || null, items: st === "done" ? items : [], comment: "", a_phases: s.phases, cancelled: false, clients: [], from_caisse: false, printed: false, payments: pays, created_at: NOW.toISOString(), lieu: dom ? "domicile" : null, adresse_domicile: dom ? cl.adresse + ", 57000 Metz" : null };
    if (st === "done") {
      tk++; a.ticket_num = tk; a.hash = "demo" + tk; a.hash_algo = "SHA-256"; a.heure_encaissement = hm(startMin + 50);
      var b = { cb: 0, esp: 0, chq: 0 }; if (pays) { b.esp = pays[0].amount; b.cb = pays[1].amount; } else if (met === "Especes") b.esp = total; else if (met === "Cheque") b.chq = total; else b.cb = total;
      var det = {}; Object.keys(b).forEach(function (k) { if (b[k]) det[k] = b[k]; });
      T.tickets.push({ id: uuid(), salon_id: SALON_ID, num: tk, date_ticket: dateStr, heure_ticket: hm(startMin + 50) + ":00", ts_created: new Date(dateStr + "T" + hm(startMin + 50) + ":00").toISOString(), client_id: cl.id, client_nom: cl.nom, client_prenom: cl.prenom, collaborateur_id: collab.id, collaborateur_nom: collab.nom, items: items, total_brut: total, total_remise: 0, total_ttc: total, total_ht: r2(total / 1.2), total_tva: r2(total - total / 1.2), taux_tva: 20, mode_paiement: Object.keys(det).length > 1 ? "mixte" : (Object.keys(det)[0] || "cb"), detail_paiement: det, status: "paid", hash: "demo" + tk, hash_algo: "SHA-256", locked: true, created_at: NOW.toISOString(), raw_data: {} });
      a._det = det;
    }
    T.appointments.push(a);
    return s.phases.reduce(function (x, p) { return x + p.d; }, 0);
  }
  var cumulMois = {}, cumulAn = 0, cumulTk = 0, zNum = 0;
  for (var d = -45; d <= 7; d++) {
    var day = addDays(NOW, d), dow = day.getDay(), ds = ymd(day);
    if (!hor[String(dow)]) continue;
    T.collaborateurs.forEach(function (co) {
      var t = (dow === 0 ? 10 : 9) * 60 + Math.floor(rnd() * 3) * 15, fin = (dow === 0 || dow === 6 ? 17 : 19) * 60, n = 0;
      while (t < fin - 30 && n < 6) {
        if (t >= 12 * 60 + 30 && t < 13 * 60 + 30) { t = 13 * 60 + 30; continue; }
        // aujourd'hui : les 2 premiers rendez-vous de chaque collaborateur sont déjà encaissés (démo parlante à toute heure)
        var st = d < 0 ? "done" : (d === 0 ? ((n < 2 || t < NOW.getHours() * 60 + NOW.getMinutes() - 60) ? "done" : "conf") : "conf");
        if (d > 0 && rnd() < 0.3) { t += 60; continue; }
        var dur = mkAppt(ds, t, st, co); t += dur + (rnd() < 0.5 ? 15 : 45); n++;
      }
    });
    if (d < 0) {
      var dn = T.appointments.filter(function (a) { return a.date_rdv === ds && a.status === "done"; });
      var ca = r2(dn.reduce(function (s, a) { return s + Number(a.prix); }, 0)), det = { cb: 0, esp: 0, chq: 0, bon: 0, vir: 0, aut: 0 };
      dn.forEach(function (a) { Object.keys(a._det || {}).forEach(function (k) { det[k] = r2(det[k] + a._det[k]); }); });
      var mk = ds.slice(0, 7); cumulMois[mk] = r2((cumulMois[mk] || 0) + ca); cumulAn = r2(cumulAn + ca); cumulTk += dn.length; zNum++;
      T.clotures.push({ id: uuid(), salon_id: SALON_ID, date_cloture: ds, timestamp_cloture: new Date(ds + "T19:30:00").toISOString(), num: zNum, total_ca: ca, total_ht: r2(ca / 1.2), nb_tickets: dn.length, nb_annulations: 0, detail_paiements: det, detail_collabs: {}, cumul_mois_ca: cumulMois[mk], cumul_mois_tickets: dn.length, cumul_annee_ca: cumulAn, cumul_annee_tickets: cumulTk, cumul_perpetuel_ca: cumulAn, cumul_perpetuel_tickets: cumulTk, hash: "demoZ" + zNum, hash_algo: "SHA-256", created_at: NOW.toISOString(), raw_data: { details: det, txTVA: 20, totalPrest: ca, totalProd: 0 } });
    }
  }
  T.appointments.forEach(function (a) { delete a._det; });
  T.site_config = [{ id: uuid(), salon_id: SALON_ID, site_actif: true, reservation_active: true, boutique_active: true, acompte_obligatoire: METIER === "tatouage" || METIER === "regard", acompte_montant: 30, acompte_type: "pourcentage", delai_min_heures: 2, delai_max_jours: 60, creneau_intervalle: 15, confirmation_auto: MODE === "salon", services_en_ligne: [], produits_en_ligne: [], couleur_primaire: "#c8a84e", message_accueil: "Bienvenue chez " + CAT.nom + " !", slogan: CAT.slogan, description_salon: CAT.slogan + ". Réservez en ligne 24 h/24.", fidelite_active: true, fidelite_seuil: 10, fidelite_type: "pct", fidelite_valeur: 10, politique_annulation: "48h", remboursement_annulation: true, horaires_salon: hor, absences: [], accept_rdv_sur_mesure: true, mode_caution: METIER === "barbier" ? "empreinte" : "aucun", empreinte_montant: 20, photos_salon: [] }];
  T.salon_operateurs = [{ id: "00000000-de00-4000-c000-000000000001", salon_id: SALON_ID, prenom: CAT.collabs[0], nom: "", role: "admin", avatar_color: "#c8a84e", avatar_initials: CAT.collabs[0].slice(0, 2).toUpperCase(), pin_hash: "demo", pin_length: 4, permissions: null, collab_id: T.collaborateurs[0].id, actif: true, failed_attempts: 0, created_at: NOW.toISOString() }];
  T.cartes_cadeaux = [{ id: uuid(), salon_id: SALON_ID, valeur: 50, de: "Marc", pour: "Sophie", message: "Joyeux anniversaire !", code: "BC-0001", date_creation: ymd(addDays(NOW, -20)), date_expiration: ymd(addDays(NOW, 345)), utilise: 0, restant: 50, status: "active", scope: "tout", gc_num: 1, pay_method: "CB", is_offert: false, ht: 41.67, tva: 8.33, tva_rate: 0.2, history: [], created_at: NOW.toISOString() }];
  // RDV en ligne : une demande à valider (domicile / mixte), un RDV confirmé
  var c0 = T.clients[3], c1 = T.clients[7], s0 = T.services[0], d1 = ymd(addDays(NOW, 2)), d2 = ymd(addDays(NOW, 3));
  T.rdv_online = [];
  T.rdv_online.push({ id: uuid(), salon_id: SALON_ID, client_nom: c1.nom, client_prenom: c1.prenom, client_tel: c1.telephone, client_email: c1.email, service_id: T.services[1].id, service_nom: T.services[1].nom, service_prix: T.services[1].prix, collaborateur_id: T.collaborateurs[0].id, collaborateur_nom: T.collaborateurs[0].nom, date_rdv: d2, heure_rdv: "11:00:00", duree_minutes: 45, acompte_montant: 0, acompte_paye: false, status: "confirmed", message: "", created_at: NOW.toISOString(), lieu: null, empreinte_status: "none" });
  if (MODE !== "salon") T.rdv_online.push({ id: uuid(), salon_id: SALON_ID, client_nom: c0.nom, client_prenom: c0.prenom, client_tel: c0.telephone, client_email: c0.email, service_id: s0.id, service_nom: s0.nom, service_prix: s0.prix, collaborateur_id: T.collaborateurs[0].id, collaborateur_nom: T.collaborateurs[0].nom, date_rdv: d1, heure_rdv: "14:30:00", duree_minutes: 60, acompte_montant: r2(s0.prix * 0.3), acompte_paye: false, status: "pending", message: "Interphone au nom de " + c0.nom, created_at: NOW.toISOString(), lieu: "domicile", client_adresse: "8 rue des Lilas", client_adresse_cp: "57070", client_adresse_ville: "Metz", distance_km: 6.4, frais_deplacement_montant: 0.84, empreinte_status: "none" });
  T.notifications = [{ id: uuid(), salon_id: SALON_ID, type: "rdv_online_new", title: "📅 Nouveau RDV en ligne", detail: c1.prenom + " " + c1.nom + " · " + T.services[1].nom, data: {}, created_at: NOW.toISOString() }];
  T.forfaits = []; T.devis = []; T.tickets_attente = []; T.packs_clients = []; T.audit_log = []; T.messaging_log = []; T.fidelite_client = [];
  T.app_config = [{ id: 1, config: { plan_pro_eur: 24.99, plan_essential_eur: 14.99, urssaf_services_pct: 21.2, urssaf_ventes_pct: 12.3 } }];

  // ---------- client simulé ----------
  var INT_ID = { collaborateurs: 1, services: 1, produits: 1, forfaits: 1 };
  function val(row, col) { if (col.indexOf("->>") > 0) { var p = col.split("->>"); var o = row[p[0]]; if (typeof o === "string") { try { o = JSON.parse(o); } catch (e) { o = null; } } return o ? o[p[1]] : undefined; } return row[col]; }
  function cmp(a, b) { if (a == null) return -1; if (b == null) return 1; return a < b ? -1 : a > b ? 1 : 0; }
  function parseVal(v) { if (v === "null") return null; if (v === "true") return true; if (v === "false") return false; return v; }
  function Q(table) { this.t = table; this.f = []; this.o = []; this.lim = null; this.rg = null; this.op = "select"; this.sg = 0; this.ret = false; this.cnt = null; this.head = false; }
  var QP = Q.prototype;
  QP.select = function (c, o) { if (this.op !== "select") this.ret = true; if (o && o.count) this.cnt = o.count; if (o && o.head) this.head = true; return this; };
  function add(name, fn) { QP[name] = function () { var a = arguments, me = this; this.f.push(function (r) { return fn.apply(null, [r].concat(Array.prototype.slice.call(a))); }); return me; }; }
  add("eq", function (r, c, v) { return String(val(r, c)) === String(v) || val(r, c) === v; });
  add("neq", function (r, c, v) { return String(val(r, c)) !== String(v); });
  add("gt", function (r, c, v) { return cmp(val(r, c), v) > 0; });
  add("gte", function (r, c, v) { return cmp(val(r, c), v) >= 0; });
  add("lt", function (r, c, v) { return cmp(val(r, c), v) < 0; });
  add("lte", function (r, c, v) { return cmp(val(r, c), v) <= 0; });
  add("in", function (r, c, v) { return (v || []).map(String).indexOf(String(val(r, c))) >= 0; });
  add("is", function (r, c, v) { return v === null ? val(r, c) == null : val(r, c) === v; });
  add("like", function (r, c, v) { return new RegExp("^" + String(v).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$").test(String(val(r, c) || "")); });
  add("ilike", function (r, c, v) { return new RegExp("^" + String(v).replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*") + "$", "i").test(String(val(r, c) || "")); });
  add("not", function (r, c, op, v) { if (op === "is") return v === null ? val(r, c) != null : val(r, c) !== v; if (op === "eq") return String(val(r, c)) !== String(v); if (op === "in") { var l = String(v).replace(/[()]/g, "").split(","); return l.indexOf(String(val(r, c))) < 0; } return true; });
  add("contains", function () { return true; });
  add("overlaps", function () { return true; });
  add("textSearch", function () { return true; });
  add("match", function (r, o) { return Object.keys(o || {}).every(function (k) { return String(r[k]) === String(o[k]); }); });
  add("filter", function (r, c, op, v) { if (op === "eq") return String(val(r, c)) === String(v); if (op === "is") return val(r, c) == null; return true; });
  add("or", function (r, s) {
    return String(s).split(/,(?![^(]*\))/).some(function (part) {
      var m = part.match(/^([^.]+)\.([a-z]+)\.(.*)$/); if (!m) return false; var c = m[1], op = m[2], v = parseVal(m[3]), x = val(r, c);
      if (op === "eq") return String(x) === String(v); if (op === "neq") return String(x) !== String(v); if (op === "is") return v === null ? x == null : x === v;
      if (op === "gte") return cmp(x, v) >= 0; if (op === "gt") return cmp(x, v) > 0; if (op === "lt") return cmp(x, v) < 0; if (op === "lte") return cmp(x, v) <= 0;
      if (op === "in") return String(m[3]).replace(/[()]/g, "").split(",").indexOf(String(x)) >= 0; if (op === "ilike") return String(x || "").toLowerCase().indexOf(String(v).replace(/[%*]/g, "").toLowerCase()) >= 0;
      return false;
    });
  });
  QP.order = function (c, o) { this.o.push([c, !(o && o.ascending === false)]); return this; };
  QP.limit = function (n) { this.lim = n; return this; };
  QP.range = function (a, b) { this.rg = [a, b]; return this; };
  QP.single = function () { this.sg = 1; return this; };
  QP.maybeSingle = function () { this.sg = 2; return this; };
  QP.abortSignal = function () { return this; };
  QP.returns = function () { return this; };
  QP.csv = function () { return this; };
  QP.insert = function (rows) { this.op = "insert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; };
  QP.upsert = function (rows) { this.op = "upsert"; this.payload = Array.isArray(rows) ? rows : [rows]; return this; };
  QP.update = function (o) { this.op = "update"; this.payload = o; return this; };
  QP["delete"] = function () { this.op = "delete"; return this; };
  QP.exec = function () {
    var tb = T[this.t] || (T[this.t] = []), me = this, out;
    var rows = tb.filter(function (r) { return me.f.every(function (fn) { return fn(r); }); });
    if (this.op === "insert" || this.op === "upsert") {
      out = this.payload.map(function (p) {
        var row = JSON.parse(JSON.stringify(p || {}));
        if (me.op === "upsert" && row.id != null) { var ex = tb.find(function (r) { return String(r.id) === String(row.id); }); if (ex) { Object.assign(ex, row); return ex; } }
        if (row.id == null) row.id = INT_ID[me.t] ? (tb.reduce(function (m, r) { return Math.max(m, Number(r.id) || 0); }, 9000) + 1) : uuid();
        if (!row.created_at) row.created_at = new Date().toISOString();
        if (me.t === "tickets" && !row.num) { row.num = tb.reduce(function (m, r) { return Math.max(m, Number(r.num) || 0); }, 0) + 1; row.hash = "demo" + row.num; row.hash_algo = "SHA-256"; }
        tb.push(row); return row;
      });
    } else if (this.op === "update") { rows.forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(me.payload || {}))); }); out = rows; }
    else if (this.op === "delete") { rows.forEach(function (r) { var i = tb.indexOf(r); if (i >= 0) tb.splice(i, 1); }); out = rows; }
    else {
      out = rows.slice();
      this.o.slice().reverse().forEach(function (o) { out.sort(function (a, b) { var x = cmp(val(a, o[0]), val(b, o[0])); return o[1] ? x : -x; }); });
      var total = out.length;
      if (this.rg) out = out.slice(this.rg[0], this.rg[1] + 1);
      if (this.lim != null) out = out.slice(0, this.lim);
      if (this.cnt) { if (this.head) return { data: null, count: total, error: null, status: 200 }; }
      out = JSON.parse(JSON.stringify(out));
      if (this.sg) { if (!out.length) return this.sg === 1 ? { data: null, error: { message: "No rows", code: "PGRST116" } } : { data: null, error: null }; return { data: out[0], error: null, count: total }; }
      return { data: out, error: null, count: total, status: 200 };
    }
    if (this.op !== "select" && !this.ret) return { data: null, error: null, status: 204 };
    out = JSON.parse(JSON.stringify(out || []));
    if (this.sg) return { data: out[0] || null, error: null };
    return { data: out, error: null };
  };
  QP.then = function (res, rej) { var me = this; return new Promise(function (ok) { setTimeout(function () { ok(me.exec()); }, 0); }).then(res, rej); };
  QP["catch"] = function (rej) { return this.then(null, rej); };
  QP["finally"] = function (fn) { return this.then(function (v) { fn && fn(); return v; }, function (e) { fn && fn(); throw e; }); };

  var SESSION = { access_token: "demo", refresh_token: "demo", expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: USER_ID, email: "demo@luxyra.fr", app_metadata: {}, user_metadata: {} } };
  function ok(d) { return Promise.resolve({ data: d === undefined ? null : d, error: null }); }
  var auth = {
    getSession: function () { return ok({ session: SESSION }); }, getUser: function () { return ok({ user: SESSION.user }); },
    onAuthStateChange: function () { return { data: { subscription: { unsubscribe: function () {} } } }; },
    signOut: function () { setTimeout(function () { location.href = "/demo.html"; }, 50); return ok(); },
    signInWithPassword: function () { return ok({ session: SESSION, user: SESSION.user }); }, refreshSession: function () { return ok({ session: SESSION }); },
    updateUser: function () { return ok({ user: SESSION.user }); }, resetPasswordForEmail: function () { return ok(); },
    mfa: { listFactors: function () { return ok({ all: [], totp: [] }); }, getAuthenticatorAssuranceLevel: function () { return ok({ currentLevel: "aal1", nextLevel: "aal1" }); }, enroll: function () { return ok(); }, challenge: function () { return ok(); }, verify: function () { return ok(); }, unenroll: function () { return ok(); } }
  };
  function chan() { var c = { on: function () { return c; }, subscribe: function (cb) { try { cb && cb("SUBSCRIBED"); } catch (e) {} return c; }, unsubscribe: function () { return ok(); }, send: function () { return ok(); }, track: function () { return ok(); } }; return c; }
  var client = {
    from: function (t) { return new Q(t); },
    rpc: function () { return ok(null); },
    auth: auth,
    channel: chan, removeChannel: function () { return ok(); }, removeAllChannels: function () { return ok(); }, getChannels: function () { return []; },
    storage: { from: function () { return { upload: function () { return ok({ path: "demo" }); }, remove: function () { return ok(); }, list: function () { return ok([]); }, getPublicUrl: function () { return { data: { publicUrl: "" } }; }, createSignedUrl: function () { return ok({ signedUrl: "" }); }, download: function () { return ok(null); } }; } },
    functions: { invoke: function () { return ok({ ok: true, demo: true }); } }
  };
  window._lxDemoTables = T;
  if (window.supabase) window.supabase.createClient = function () { return client; };

  // ---------- aucun appel réseau sortant hors fichiers du site ----------
  var fetchOrig = window.fetch.bind(window);
  window.fetch = function (u, o) {
    try {
      var url = new URL(typeof u === "string" ? u : (u && u.url) || "", location.href);
      var m = String((o && o.method) || "GET").toUpperCase();
      var api = (url.origin === location.origin && url.pathname.indexOf("/api/") === 0) || /supabase\.co$/.test(url.hostname) || /stripe|brevo|sendgrid/.test(url.hostname);
      if (api || (m !== "GET" && m !== "HEAD")) return Promise.resolve(new Response(JSON.stringify({ ok: true, demo: true, slots: [], data: [] }), { status: 200, headers: { "Content-Type": "application/json" } }));
    } catch (e) {}
    return fetchOrig(u, o);
  };
  try { navigator.sendBeacon = function () { return true; }; } catch (e) {}

  // ---------- session opérateur pré-ouverte (pas de code PIN en démo) ----------
  try {
    localStorage.setItem("lx_salon_last_activity", String(Date.now()));
    localStorage.setItem("lx_current_op", JSON.stringify({ id: T.salon_operateurs[0].id, prenom: T.salon_operateurs[0].prenom, nom: "", role: "admin", lastActivity: Date.now() }));
    localStorage.setItem("_cp_active_salon", SALON_ID);
    localStorage.setItem("caisseOpenDate", TODAY);
    localStorage.setItem("lx_parr_masque", "1");
    localStorage.setItem("lx_install_masque", "1");
  } catch (e) {}

  // ---------- bandeau + page de départ ----------
  var LABELS = { coiffure: "Coiffure", barbier: "Barbier", esthetique: "Esthétique", ongles: "Ongles", regard: "Cils & sourcils", maquillage: "Maquillage", tatouage: "Tatouage & piercing", spa: "Spa & massages", bien_etre: "Bien-être" };
  document.addEventListener("DOMContentLoaded", function () {
    if (P.get("embed") === "1") document.documentElement.classList.add("lx-demo-embed");
    var b = document.createElement("div");
    b.id = "lxDemoBandeau";
    b.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:2147483000;background:linear-gradient(90deg,#1a1408,#2a2010);border-top:1px solid #c8a84e;color:#fff;font:600 12px/1.4 system-ui,sans-serif;padding:5px 8px;display:flex;gap:6px;align-items:center;justify-content:center;flex-wrap:wrap";
    var opts = METIERS.map(function (m) { return '<option value="' + m + '"' + (m === METIER ? " selected" : "") + ">" + LABELS[m] + "</option>"; }).join("");
    b.innerHTML = '<span style="color:#c8a84e">✨ DÉMO Luxyra</span><span style="opacity:.7;font-size:11px">fictif · rien n\'est enregistré</span>' +
      '<select id="lxDemoMetier" style="background:#111;color:#fff;border:1px solid #555;border-radius:6px;padding:3px 6px;font-size:12px;width:auto;min-width:0;max-width:150px;margin:0">' + opts + "</select>" +
      '<select id="lxDemoMode" style="background:#111;color:#fff;border:1px solid #555;border-radius:6px;padding:3px 6px;font-size:12px;width:auto;min-width:0;max-width:150px;margin:0">' + ["salon", "domicile", "mixte"].map(function (m) { return '<option value="' + m + '"' + (m === MODE ? " selected" : "") + ">" + (m === "salon" ? "En établissement" : m === "domicile" ? "À domicile" : "Mixte") + "</option>"; }).join("") + "</select>" +
      '<a href="/inscription.html" target="_top" style="background:#c8a84e;color:#111;border-radius:6px;padding:4px 10px;text-decoration:none;font-weight:800">Essai gratuit 14 j</a>';
    if (P.get("embed") !== "1") document.body.appendChild(b);
    function go() { location.href = "/app.html?demo=" + document.getElementById("lxDemoMetier").value + "&mode=" + document.getElementById("lxDemoMode").value; }
    document.getElementById("lxDemoMetier") && document.getElementById("lxDemoMetier").addEventListener("change", go);
    document.getElementById("lxDemoMode") && document.getElementById("lxDemoMode").addEventListener("change", go);
    var page = P.get("page");
    if (page) { var tries = 0; var iv = setInterval(function () { tries++; if (typeof window.go === "function" && window._salonId && typeof CURRENT_OPERATOR !== "undefined" && CURRENT_OPERATOR && !document.getElementById("opSelectorOverlay")) { clearInterval(iv); try { window.go(page); } catch (e) {} } if (tries > 80) clearInterval(iv); }, 150); }
  });
})();
