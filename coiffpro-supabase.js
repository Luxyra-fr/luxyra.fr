// ============================================================
// COIFFPRO — MODULE SUPABASE (coiffpro-supabase.js)
// ============================================================
// Ce fichier remplace le stockage en mémoire par Supabase.
// À inclure dans le HTML AVANT le code existant de l'app.
//
// USAGE :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="coiffpro-supabase.js"></script>
//   <script> ... code app existant ... </script>
//
// CONFIGURATION :
//   Remplace SUPABASE_URL et SUPABASE_ANON_KEY par tes valeurs
//   (trouvables dans Supabase Dashboard > Settings > API)
// ============================================================

// ===== CONFIGURATION =====
var SUPABASE_URL = "https://kxdgjtvrkwugbifgppai.supabase.co";
var SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI";

// ===== INIT SUPABASE CLIENT =====
var _sb = null;
if (typeof supabase !== "undefined" && supabase.createClient) {
  _sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// ===== STATE =====
var _salonId = null;       // UUID du salon connecté
var _userId = null;        // UUID auth de l'utilisateur
var _isOnline = false;     // true si connecté à Supabase
var _isSaving = false;     // évite les sauvegardes concurrentes
var _saveQueue = [];       // file d'attente des sauvegardes


// ============================================================
// AUTH — LOGIN / LOGOUT / SESSION
// ============================================================

// Afficher l'écran de login
function showLoginScreen() {
  var el = document.getElementById("app") || document.body;
  var h = "";
  h += '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a);font-family:var(--f1,sans-serif)">';
  h += '<div style="background:var(--bg2,#111827);border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:32px;max-width:380px;width:100%">';
  h += '<div style="text-align:center;margin-bottom:24px"><div style="font-size:32px;font-weight:900;color:var(--gold,#d4a843)">CoiffPro</div>';
  h += '<div style="font-size:13px;color:var(--text3,#64748b)">Connectez-vous à votre salon</div></div>';
  h += '<div id="loginError" style="display:none;background:rgba(248,113,113,.1);color:#f87171;padding:10px;border-radius:8px;font-size:13px;margin-bottom:12px"></div>';
  h += '<div style="margin-bottom:12px"><label style="font-size:12px;color:var(--text2,#94a3b8);display:block;margin-bottom:4px">Email</label>';
  h += '<input id="loginEmail" type="email" style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:var(--bg3,#1a2035);color:var(--text,#e2e8f0);font-size:14px;outline:none" placeholder="email@salon.fr"></div>';
  h += '<div style="margin-bottom:20px"><label style="font-size:12px;color:var(--text2,#94a3b8);display:block;margin-bottom:4px">Mot de passe</label>';
  h += '<input id="loginPass" type="password" style="width:100%;padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,.1);background:var(--bg3,#1a2035);color:var(--text,#e2e8f0);font-size:14px;outline:none" placeholder="••••••••"></div>';
  h += '<button onclick="doLogin()" style="width:100%;padding:12px;border-radius:10px;background:var(--gold,#d4a843);color:#000;font-weight:700;font-size:15px;border:none;cursor:pointer;margin-bottom:10px">Se connecter</button>';
  h += '<div style="text-align:center;margin-top:12px;font-size:12px;color:var(--text3,#64748b)">Pas encore de compte ? Contactez votre éditeur CoiffPro.</div>';
  h += '<div style="text-align:center;margin-top:8px"><a href="#" onclick="doResetPwd()" style="font-size:12px;color:var(--text3,#64748b)">Mot de passe oublié ?</a></div>';
  h += '</div></div>';
  el.innerHTML = h;
}

function showLoginError(msg) {
  var el = document.getElementById("loginError");
  if (el) { el.style.display = "block"; el.textContent = msg; }
}

// Login
async function doLogin() {
  if (!_sb) { showLoginError("Erreur de connexion au serveur"); return; }
  var email = document.getElementById("loginEmail").value.trim();
  var pass = document.getElementById("loginPass").value;
  if (!email || !pass) { showLoginError("Remplissez email et mot de passe"); return; }

  var result = await _sb.auth.signInWithPassword({ email: email, password: pass });
  if (result.error) { showLoginError(result.error.message); return; }

  _userId = result.data.user.id;
  await loadSalonData();
}

// Signup
async function doSignup() {
  if (!_sb) { showLoginError("Erreur de connexion au serveur"); return; }
  var email = document.getElementById("loginEmail").value.trim();
  var pass = document.getElementById("loginPass").value;
  if (!email || !pass) { showLoginError("Remplissez email et mot de passe"); return; }
  if (pass.length < 6) { showLoginError("Le mot de passe doit faire au moins 6 caractères"); return; }

  var result = await _sb.auth.signUp({ email: email, password: pass });
  if (result.error) { showLoginError(result.error.message); return; }

  _userId = result.data.user.id;

  // Créer le salon
  var salonResult = await _sb.from("salons").insert({
    user_id: _userId,
    nom: "Mon Salon",
    status: "trial",
    plan: "essential"
  }).select().single();

  if (salonResult.error) { showLoginError("Erreur création salon : " + salonResult.error.message); return; }

  _salonId = salonResult.data.id;

  // Créer 2 collaborateurs par défaut
  await _sb.from("collaborateurs").insert([
    { salon_id: _salonId, nom: "Coiffeur 1", initiales: "C1", couleur: "#c9a227" },
    { salon_id: _salonId, nom: "Coiffeur 2", initiales: "C2", couleur: "#7d3c98" }
  ]);

  await loadSalonData();
}

// Reset password
async function doResetPwd() {
  if (!_sb) return;
  var email = document.getElementById("loginEmail").value.trim();
  if (!email) { showLoginError("Entrez votre email d'abord"); return; }
  var result = await _sb.auth.resetPasswordForEmail(email);
  if (result.error) { showLoginError(result.error.message); }
  else { showLoginError("Email de réinitialisation envoyé !"); }
}

// Logout
async function doLogout() {
  if (_sb) await _sb.auth.signOut();
  _salonId = null;
  _userId = null;
  _isOnline = false;
  showLoginScreen();
}

// Check session on load
async function checkSession() {
  if (!_sb) { startOffline(); return; }
  var result = await _sb.auth.getSession();
  if (result.data && result.data.session) {
    _userId = result.data.session.user.id;
    await loadSalonData();
  } else {
    showLoginScreen();
  }
}


// ============================================================
// LOAD DATA — Charger les données du salon depuis Supabase
// ============================================================

async function loadSalonData() {
  if (!_sb || !_userId) { startOffline(); return; }

  // 1. Charger le salon
  var sRes = await _sb.from("salons").select("*").eq("user_id", _userId).single();
  if (sRes.error || !sRes.data) { showLoginError("Salon introuvable"); return; }

  var salon = sRes.data;
  _salonId = salon.id;
  _isOnline = true;

  // Vérifier statut abonnement
  if (salon.status === "suspended" || salon.status === "cancelled") {
    showSuspendedScreen(salon.status);
    return;
  }

  // 2. Mapper vers SALON_CONFIG (format existant de l'app)
  SALON_CONFIG.nom = salon.nom || "Mon Salon";
  SALON_CONFIG.sousTitre = salon.sous_titre || "";
  SALON_CONFIG.logo = salon.logo || "";
  SALON_CONFIG.adresse = salon.adresse || "";
  SALON_CONFIG.cp = salon.cp || "";
  SALON_CONFIG.ville = salon.ville || "";
  SALON_CONFIG.tel = salon.tel || "";
  SALON_CONFIG.email = salon.email || "";
  SALON_CONFIG.siteWeb = salon.site_web || "";
  SALON_CONFIG.siret = salon.siret || "";
  SALON_CONFIG.tva = salon.tva || "";
  SALON_CONFIG.couleurPrimaire = salon.couleur_primaire || "#c8a84e";
  SALON_CONFIG.couleurSecondaire = salon.couleur_secondaire || "#1a1a1a";
  SALON_CONFIG.tauxTVA = salon.taux_tva || 20;
  if (salon.show_tva_ticket !== undefined) window.SHOW_TVA_TICKET = salon.show_tva_ticket;

  // 3. Charger collaborateurs → T[]
  var tRes = await _sb.from("collaborateurs").select("*").eq("salon_id", _salonId).order("id");
  if (tRes.data) {
    T = tRes.data.map(function(c) {
      return { id: c.id, n: c.nom, i: c.initiales, c: c.couleur, img: c.img || "",
               hrs: c.horaires || {} };
    });
  }

  // 4. Charger services → SVC[]
  var svcRes = await _sb.from("services").select("*").eq("salon_id", _salonId).order("id");
  if (svcRes.data) {
    SVC = svcRes.data.map(function(s) {
      return { id: s.id, n: s.nom, p: Number(s.prix), cat: s.categorie, phases: s.phases || [] };
    });
    // Recalculer CATS
    var catSet = {};
    SVC.forEach(function(s) { if (s.cat) catSet[s.cat] = true; });
    CATS = Object.keys(catSet);
  }

  // 5. Charger clients → CL[]
  var clRes = await _sb.from("clients").select("*").eq("salon_id", _salonId).order("nom");
  if (clRes.data) {
    CL = clRes.data.map(function(c) {
      return {
        id: c.id, nom: c.nom, pre: c.prenom, sex: c.sexe,
        ph: c.telephone, ph2: c.telephone2, em: c.email,
        adr: c.adresse, cp: c.cp, ville: c.ville, ddn: c.date_naissance,
        cr: c.created_at ? c.created_at.slice(0,10) : "",
        no: c.notes, natChev: c.nature_cheveux, typeChev: c.type_cheveux,
        detChev: c.details_cheveux, collab: c.collab_pref,
        actif: c.actif, fid: c.points_fidelite,
        smsOk: c.sms_ok, emOk: c.email_ok, fiches: c.fiches || []
      };
    });
  }

  // 6. Charger rendez-vous/tickets → AP[]
  var apRes = await _sb.from("appointments").select("*").eq("salon_id", _salonId).order("date_rdv", { ascending: false }).limit(500);
  if (apRes.data) {
    AP = apRes.data.map(function(a) {
      return {
        id: a.id, cId: a.client_id, sId: a.service_id, stId: a.collab_id,
        date: a.date_rdv, time: a.heure, pr: Number(a.prix),
        brutTotal: a.brut_total ? Number(a.brut_total) : undefined,
        remise: Number(a.remise || 0),
        st: a.status, met: a.mode_paiement,
        tkNum: a.ticket_num, hash: a.hash, prevHash: a.prev_hash, hashAlgo: a.hash_algo,
        items: a.items || [], comment: a.comment || "",
        aPhases: a.a_phases || [],
        cancelled: a.cancelled, cancelReason: a.cancel_reason
      };
    });
    // Restaurer le dernier hash pour le chaînage
    var doneH = AP.filter(function(a) { return a.hash; });
    if (doneH.length) _lastTicketHash = doneH[0].hash || "00000000";
  }

  // 7. Charger produits → PRODS[]
  var prRes = await _sb.from("produits").select("*").eq("salon_id", _salonId).order("nom");
  if (prRes.data) {
    PRODS = prRes.data.map(function(p) {
      return {
        id: p.id, n: p.nom, p: Number(p.prix), pa: Number(p.prix_achat || 0),
        cat: p.categorie, cb: p.code_barre, stk: p.stock, stkMin: p.stock_min,
        cc: p.coup_coeur, img: p.img || ""
      };
    });
    var pcatSet = {};
    PRODS.forEach(function(p) { if (p.cat) pcatSet[p.cat] = true; });
    PCATS = Object.keys(pcatSet);
  }

  // 8. Charger cartes cadeaux → GC[]
  var gcRes = await _sb.from("cartes_cadeaux").select("*").eq("salon_id", _salonId).order("date_creation", { ascending: false });
  if (gcRes.data) {
    GC = gcRes.data.map(function(g) {
      return {
        id: g.id, val: Number(g.valeur), from: g.de, to: g.pour, msg: g.message,
        cr: g.date_creation, exp: g.date_expiration,
        used: Number(g.utilise), st: g.status, code: g.code, rem: Number(g.restant)
      };
    });
  }

  // 9. Charger clôtures → window.CLOTURES[]
  var clotRes = await _sb.from("clotures").select("*").eq("salon_id", _salonId).order("num");
  if (clotRes.data) {
    window.CLOTURES = clotRes.data.map(function(c) {
      return {
        id: c.id, date: c.date_cloture, ts: c.timestamp_cloture, num: c.num,
        totalCA: Number(c.total_ca), totalHT: Number(c.total_ht),
        nbTickets: c.nb_tickets, nbAnnul: c.nb_annulations,
        perPay: c.detail_paiements || {}, perSty: c.detail_collabs || {},
        cumulMoisCA: Number(c.cumul_mois_ca), cumulMoisTk: c.cumul_mois_tickets,
        cumulAnCA: Number(c.cumul_annee_ca), cumulAnTk: c.cumul_annee_tickets,
        hash: c.hash, hashAlgo: c.hash_algo
      };
    });
  }

  // 10. Charger audit log → window.AUDIT_LOG[]
  var auRes = await _sb.from("audit_log").select("*").eq("salon_id", _salonId).order("timestamp_action", { ascending: false }).limit(500);
  if (auRes.data) {
    window.AUDIT_LOG = auRes.data.map(function(a) {
      return { ts: a.timestamp_action, action: a.action, detail: a.details };
    });
  }

  // Lancer l'app !
  console.log("CoiffPro: Données chargées depuis Supabase (" + CL.length + " clients, " + AP.length + " RDV, " + PRODS.length + " produits)");
  initApp(); // ← appelle la fonction d'init existante de l'app
}

function showSuspendedScreen(status) {
  var el = document.getElementById("app") || document.body;
  var msg = status === "suspended" ? "Votre abonnement est suspendu suite à un défaut de paiement." : "Votre abonnement a été résilié.";
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a)"><div style="text-align:center;max-width:400px;padding:32px"><div style="font-size:48px;margin-bottom:16px">⚠️</div><h2 style="color:#f87171;margin-bottom:12px">Compte ' + status + '</h2><p style="color:#94a3b8;margin-bottom:20px">' + msg + '</p><a href="https://billing.stripe.com/p/login/XXXXX" style="display:inline-block;padding:12px 24px;background:#d4a843;color:#000;border-radius:10px;font-weight:700;text-decoration:none">Gérer mon abonnement</a><br><button onclick="doLogout()" style="margin-top:12px;background:none;border:none;color:#64748b;cursor:pointer;font-size:13px">Se déconnecter</button></div></div>';
}

// Mode hors ligne (pas de Supabase configuré)
function startOffline() {
  _isOnline = false;
  // Bloquer l'accès sans Supabase
  var el = document.getElementById("app") || document.body;
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a);font-family:var(--f1,sans-serif)"><div style="text-align:center;max-width:400px;padding:32px"><div style="font-size:48px;margin-bottom:16px">🔒</div><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);margin-bottom:8px">CoiffPro</div><p style="color:#94a3b8;margin-bottom:8px">Connexion au serveur impossible.</p><p style="color:#64748b;font-size:13px">Vérifiez votre connexion internet ou contactez le support.</p></div></div>';
}


// ============================================================
// SAVE DATA — Sauvegarder vers Supabase après chaque action
// ============================================================

// Sauvegarder un client (create ou update)
async function saveClient(client) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    nom: client.nom, prenom: client.pre, sexe: client.sex,
    telephone: client.ph, telephone2: client.ph2, email: client.em,
    adresse: client.adr, cp: client.cp, ville: client.ville,
    date_naissance: client.ddn, notes: client.no,
    nature_cheveux: client.natChev, type_cheveux: client.typeChev,
    details_cheveux: client.detChev, collab_pref: client.collab,
    actif: client.actif, points_fidelite: client.fid,
    sms_ok: client.smsOk, email_ok: client.emOk, fiches: client.fiches || []
  };
  // UUID = update, local ID = insert
  if (client.id && client.id.indexOf("-") > 0 && client.id.length > 30) {
    await _sb.from("clients").update(data).eq("id", client.id);
  } else {
    var res = await _sb.from("clients").insert(data).select().single();
    if (res.data) client.id = res.data.id;
  }
}

// Sauvegarder un rendez-vous/ticket
async function saveAppointment(appt) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    client_id: (appt.cId && appt.cId.indexOf("-") > 0 && appt.cId.length > 30) ? appt.cId : null, service_id: appt.sId, collab_id: appt.stId,
    date_rdv: appt.date, heure: appt.time, prix: appt.pr,
    brut_total: appt.brutTotal || null, remise: appt.remise || 0,
    status: appt.st, mode_paiement: appt.met || "",
    ticket_num: appt.tkNum || null, hash: appt.hash || "",
    prev_hash: appt.prevHash || "", hash_algo: appt.hashAlgo || "",
    items: appt.items || [], comment: appt.comment || "",
    a_phases: appt.aPhases || [],
    cancelled: appt.cancelled || false, cancel_reason: appt.cancelReason || ""
  };
  if (appt.id && appt.id.indexOf("-") > 0 && appt.id.length > 30) {
    await _sb.from("appointments").update(data).eq("id", appt.id);
  } else {
    var res = await _sb.from("appointments").insert(data).select().single();
    if (res.data) appt.id = res.data.id;
  }
}

// Sauvegarder un produit
async function saveProduct(prod) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    nom: prod.n, prix: prod.p, prix_achat: prod.pa || 0,
    categorie: prod.cat, code_barre: prod.cb || "",
    stock: prod.stk, stock_min: prod.stkMin,
    coup_coeur: prod.cc || false, img: prod.img || ""
  };
  if (typeof prod.id === "number" && prod.id > 0) {
    // Check if exists in Supabase
    var check = await _sb.from("produits").select("id").eq("id", prod.id).eq("salon_id", _salonId);
    if (check.data && check.data.length > 0) {
      await _sb.from("produits").update(data).eq("id", prod.id);
    } else {
      var res = await _sb.from("produits").insert(data).select().single();
      if (res.data) prod.id = res.data.id;
    }
  } else {
    var res = await _sb.from("produits").insert(data).select().single();
    if (res.data) prod.id = res.data.id;
  }
}

// Sauvegarder une carte cadeau
async function saveGiftCard(gc) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    valeur: gc.val, de: gc.from, pour: gc.to, message: gc.msg,
    code: gc.code, date_creation: gc.cr, date_expiration: gc.exp,
    utilise: gc.used, restant: gc.rem, status: gc.st
  };
  if (gc.id && gc.id.indexOf("-") > 0 && gc.id.length > 30) {
    await _sb.from("cartes_cadeaux").update(data).eq("id", gc.id);
  } else {
    var res = await _sb.from("cartes_cadeaux").insert(data).select().single();
    if (res.data) gc.id = res.data.id;
  }
}

// Sauvegarder une clôture Z
async function saveCloture(clot) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    date_cloture: clot.date, num: clot.num,
    total_ca: clot.totalCA, total_ht: clot.totalHT,
    nb_tickets: clot.nbTickets, nb_annulations: clot.nbAnnul,
    detail_paiements: clot.perPay || {}, detail_collabs: clot.perSty || {},
    cumul_mois_ca: clot.cumulMoisCA || 0, cumul_mois_tickets: clot.cumulMoisTk || 0,
    cumul_annee_ca: clot.cumulAnCA || 0, cumul_annee_tickets: clot.cumulAnTk || 0,
    hash: clot.hash, hash_algo: clot.hashAlgo || "SHA-256"
  };
  var res = await _sb.from("clotures").insert(data).select().single();
  if (res.data) clot.id = res.data.id;
}

// Sauvegarder une entrée d'audit
async function saveAuditEntry(action, detail) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("audit_log").insert({
    salon_id: _salonId, action: action, details: detail || ""
  });
}

// Sauvegarder la config du salon
async function saveSalonConfig() {
  if (!_isOnline || !_salonId) return;
  await _sb.from("salons").update({
    nom: SALON_CONFIG.nom, sous_titre: SALON_CONFIG.sousTitre,
    logo: SALON_CONFIG.logo, adresse: SALON_CONFIG.adresse,
    cp: SALON_CONFIG.cp, ville: SALON_CONFIG.ville,
    tel: SALON_CONFIG.tel, email: SALON_CONFIG.email,
    site_web: SALON_CONFIG.siteWeb, siret: SALON_CONFIG.siret,
    tva: SALON_CONFIG.tva, couleur_primaire: SALON_CONFIG.couleurPrimaire,
    couleur_secondaire: SALON_CONFIG.couleurSecondaire,
    taux_tva: SALON_CONFIG.tauxTVA,
    show_tva_ticket: window.SHOW_TVA_TICKET
  }).eq("id", _salonId);
}

// Sauvegarder les collaborateurs
async function saveCollaborateurs() {
  if (!_isOnline || !_salonId) return;
  for (var i = 0; i < T.length; i++) {
    var c = T[i];
    var data = {
      salon_id: _salonId, nom: c.n, initiales: c.i,
      couleur: c.c, img: c.img || "", horaires: c.hrs || {}
    };
    if (c.id && typeof c.id === "number") {
      var check = await _sb.from("collaborateurs").select("id").eq("id", c.id).eq("salon_id", _salonId);
      if (check.data && check.data.length > 0) {
        await _sb.from("collaborateurs").update(data).eq("id", c.id);
      } else {
        var res = await _sb.from("collaborateurs").insert(data).select().single();
        if (res.data) c.id = res.data.id;
      }
    } else {
      var res = await _sb.from("collaborateurs").insert(data).select().single();
      if (res.data) c.id = res.data.id;
    }
  }
}

// Supprimer un client
async function deleteClient(clientId) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("clients").delete().eq("id", clientId);
}

// Supprimer un produit
async function deleteProduct(productId) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("produits").delete().eq("id", productId);
}


// ============================================================
// HOOKS — À injecter dans le code existant de l'app
// ============================================================
// 
// Dans le code existant, après chaque action qui modifie les données,
// appeler la fonction save correspondante. Exemples :
//
// Après création/modif d'un client :
//   saveClient(CL[index]);
//
// Après encaissement d'un ticket :
//   saveAppointment(AP[index]);
//   saveAuditEntry("ENCAISSEMENT", "Ticket #" + tk.tkNum + " - " + tk.pr + "€");
//
// Après clôture Z :
//   saveCloture(cloture);
//   saveAuditEntry("CLOTURE_Z", "Z#" + cloture.num);
//
// Après modif config salon :
//   saveSalonConfig();
//
// Après modif stock produit :
//   saveProduct(PRODS[index]);
//
// IMPORTANT : ces appels sont async mais on n'attend pas le résultat
// pour ne pas bloquer l'UI. Les erreurs sont loguées en console.


// ============================================================
// INIT — Démarrage de l'app
// ============================================================

// Wrapper : remplace l'ancienne fonction auditLog pour sauver aussi en base
var _originalAuditLog = (typeof auditLog === "function") ? auditLog : null;

function auditLogWrapper(action, detail) {
  // Appeler l'original (ajoute dans window.AUDIT_LOG en mémoire)
  if (_originalAuditLog) _originalAuditLog(action, detail);
  // Sauver en base
  saveAuditEntry(action, detail);
}

// Au chargement de la page, vérifier la session
document.addEventListener("DOMContentLoaded", function() {
  // Remplacer auditLog par le wrapper si la fonction existe
  if (typeof window.auditLog === "function") {
    _originalAuditLog = window.auditLog;
    window.auditLog = auditLogWrapper;
  }
  // Vérifier session
  checkSession();
});
