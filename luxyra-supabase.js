// ============================================================
// LUXYRA — MODULE SUPABASE (luxyra-supabase.js)
// ============================================================
// Ce fichier remplace le stockage en mémoire par Supabase.
// À inclure dans le HTML AVANT le code existant de l'app.
//
// USAGE :
//   <script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
//   <script src="luxyra-supabase.js"></script>
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
  var bgEl=document.getElementById("appBg");if(bgEl){if(typeof APP_BG!=="undefined"&&APP_BG)bgEl.style.backgroundImage="url("+APP_BG+")";else bgEl.style.backgroundImage="url(https://images.unsplash.com/photo-1560066984-138dadb4c035?w=800&q=80)";bgEl.style.opacity="1";}
  var h = "";
  h += '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:var(--f1,sans-serif);position:relative">';
  h += '<div style="position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(4px)"></div>';
  h += '<div style="position:relative;z-index:1;background:rgba(10,10,20,.9);backdrop-filter:blur(20px);border:2px solid #c8a84e;border-radius:20px;padding:36px 28px;max-width:380px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.5),0 0 40px rgba(200,168,78,.08)">';
  h += '<div style="text-align:center;margin-bottom:28px">';
  // Logo
  h += '<svg width="64" height="78" viewBox="60 30 392 430" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="lgG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f0d78c"/><stop offset="35%" stop-color="#d4ab4a"/><stop offset="100%" stop-color="#a07828"/></linearGradient><linearGradient id="lgL" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f5e4a8"/><stop offset="50%" stop-color="#daba60"/><stop offset="100%" stop-color="#c49838"/></linearGradient><filter id="lgW"><feGaussianBlur stdDeviation="10" result="b"/><feFlood flood-color="#d4ab4a" flood-opacity=".25"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter><filter id="lgT"><feGaussianBlur stdDeviation="5" result="b"/><feFlood flood-color="#daba60" flood-opacity=".45"/><feComposite in2="b" operator="in" result="g"/><feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs><g filter="url(#lgW)"><polygon points="256,68 400,222 256,424 112,222" fill="none" stroke="url(#lgG)" stroke-width="4.5" stroke-linejoin="round"/><line x1="190" y1="142" x2="322" y2="142" stroke="#c8a848" stroke-width="2" opacity=".7"/><line x1="256" y1="68" x2="190" y2="142" stroke="#c8a848" stroke-width="1.8" opacity=".7"/><line x1="256" y1="68" x2="322" y2="142" stroke="#c8a848" stroke-width="1.8" opacity=".7"/><line x1="190" y1="142" x2="112" y2="222" stroke="#c8a848" stroke-width="1.5" opacity=".6"/><line x1="322" y1="142" x2="400" y2="222" stroke="#c8a848" stroke-width="1.5" opacity=".6"/><line x1="112" y1="222" x2="400" y2="222" stroke="#c8a848" stroke-width="1.8" opacity=".6"/><line x1="190" y1="142" x2="340" y2="222" stroke="#b89040" stroke-width="1.2" opacity=".4"/><line x1="322" y1="142" x2="172" y2="222" stroke="#b89040" stroke-width="1.2" opacity=".4"/><line x1="155" y1="222" x2="256" y2="424" stroke="#b89040" stroke-width="1.2" opacity=".4"/><line x1="358" y1="222" x2="256" y2="424" stroke="#b89040" stroke-width="1.2" opacity=".4"/><line x1="196" y1="222" x2="256" y2="424" stroke="#b89040" stroke-width="1" opacity=".32"/><line x1="316" y1="222" x2="256" y2="424" stroke="#b89040" stroke-width="1" opacity=".32"/><line x1="142" y1="262" x2="370" y2="262" stroke="#b89040" stroke-width=".9" opacity=".26"/><line x1="175" y1="305" x2="337" y2="305" stroke="#b89040" stroke-width=".8" opacity=".22"/></g><text x="256" y="242" text-anchor="middle" dominant-baseline="middle" font-size="115" font-family="Georgia,serif" fill="url(#lgL)" filter="url(#lgT)">L</text></svg><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);font-family:Georgia,serif;letter-spacing:3px">Luxyra</div>';
  h += '<div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:4px">Connectez-vous \u00e0 votre salon</div></div>';
  h += '<div id="loginError" style="display:none;background:rgba(248,113,113,.15);color:#f87171;padding:10px;border-radius:10px;font-size:13px;margin-bottom:14px;text-align:center"></div>';
  h += '<div style="margin-bottom:14px"><label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px;font-weight:600">Email</label>';
  h += '<input id="loginEmail" type="email" style="width:100%;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);color:#fff;font-size:15px;outline:none" placeholder="email@salon.fr"></div>';
  h += '<div style="margin-bottom:22px"><label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px;font-weight:600">Mot de passe</label>';
  h += '<input id="loginPass" type="password" style="width:100%;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);color:#fff;font-size:15px;outline:none" placeholder="••••••••" onkeydown="if(event.key===\'Enter\')doLogin()"></div>';
  h += '<button onclick="doLogin()" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,var(--gold,#d4a843),#b8960f);color:#000;font-weight:800;font-size:16px;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(212,168,67,.3);transition:transform .15s" onmouseover="this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.transform=\'none\'">Se connecter</button>';
  h += '<div style="text-align:center;margin-top:16px;font-size:12px;color:rgba(255,255,255,.35)">Pas encore de compte ? contact@luxyra.fr</div>';
  h += '<div style="text-align:center;margin-top:8px"><a href="#" onclick="doResetPwd()" style="font-size:12px;color:rgba(255,255,255,.35);text-decoration:none">Mot de passe oublié ?</a></div>';
  h += '</div></div>';
  // Hide the header
  var hdr = document.getElementById("hdr");
  if (hdr) hdr.style.display = "none";
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
  }).select();

  if (salonResult.error) { showLoginError("Erreur création salon : " + salonResult.error.message); return; }

  _salonId = salonResult.data[0].id;

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
  var sRes = await _sb.from("salons").select("*").eq("user_id", _userId).limit(1);
  if (sRes.error || !sRes.data || sRes.data.length === 0) { showLoginError("Salon introuvable"); return; }

  var salon = sRes.data[0];
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
  if(salon.config_json){try{var cfg=typeof salon.config_json==="string"?JSON.parse(salon.config_json):salon.config_json;if(cfg.slot)SLOT=cfg.slot;if(cfg.slot_h)SLOT_H=cfg.slot_h;if(cfg.fidconf)window.FIDCONF=cfg.fidconf;if(cfg.pay_active)window.PAY_ACTIVE=cfg.pay_active;if(cfg.fond_caisse!==undefined){if(!window.CAISSE_DATA)window.CAISSE_DATA={};window.CAISSE_DATA.fond=cfg.fond_caisse;}}catch(e){}}

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
        clients: a.clients || [], fromCaisse: a.from_caisse || false,
        cancelled: a.cancelled, cancelReason: a.cancel_reason
      };
    });
    // Restaurer le dernier hash + tkN
    var doneH = AP.filter(function(a) { return a.hash; });
    if (doneH.length) _lastTicketHash = doneH[0].hash || "00000000";
    var maxTkN=0;AP.forEach(function(a){if(a.tkNum&&a.tkNum>maxTkN)maxTkN=a.tkNum;});if(maxTkN>0)tkN=maxTkN;
  }

  // 6b. Charger RDV en ligne → window.RDV_ONLINE[]
  var today = new Date().toISOString().slice(0,10);
  var roRes = await _sb.from("rdv_online").select("*").eq("salon_id", _salonId).order("created_at", { ascending: false });
  if (roRes.data) {
    window.RDV_ONLINE = roRes.data.map(function(r) {
      return {
        id: r.id, salonId: r.salon_id,
        nom: r.client_nom, prenom: r.client_prenom, tel: r.client_tel, email: r.client_email,
        svcId: r.service_id, svcNom: r.service_nom, svcPrix: Number(r.service_prix),
        collabId: r.collaborateur_id, collabNom: r.collaborateur_nom,
        date: r.date_rdv, heure: r.heure_rdv ? r.heure_rdv.slice(0,5) : null,
        duree: r.duree_minutes,
        acompte: Number(r.acompte_montant), acomptePaye: r.acompte_paye,
        status: r.status, message: r.message,
        createdAt: r.created_at, confirmedAt: r.confirmed_at,
        isOnline: true
      };
    });
    // Merge pending+confirmed into AP for planning display
    window.RDV_ONLINE.forEach(function(r) {
      if (r.status === "pending" || r.status === "confirmed") {
        // Check if already in AP (avoid duplicates)
        var exists = false;
        for (var i = 0; i < AP.length; i++) {
          if (AP[i].onlineId === r.id) { exists = true; break; }
        }
        if (!exists) {
          var dur = r.duree || 60;
          // Get real phases from the service definition
          var realSvc = null;
          for (var si = 0; si < SVC.length; si++) { if (SVC[si].id === r.svcId) { realSvc = SVC[si]; break; } }
          var phases = realSvc && realSvc.phases && realSvc.phases.length > 0 ? realSvc.phases : [{t:"w", d: dur, l: r.svcNom}];
          AP.push({
            id: "online_" + r.id,
            onlineId: r.id,
            cId: null,
            sId: r.svcId,
            stId: r.collabId,
            date: r.date,
            time: r.heure,
            pr: r.svcPrix,
            st: r.status === "confirmed" ? "conf" : "conf",
            items: [{name: r.svcNom, price: r.svcPrix, qty: 1, remise: 0}],
            comment: "RDV EN LIGNE - " + r.nom + (r.prenom ? " " + r.prenom : "") + " - " + r.tel + (r.message ? " - " + r.message : ""),
            aPhases: phases,
            isOnline: true,
            onlineStatus: r.status,
            clientName: r.nom + (r.prenom ? " " + r.prenom : "")
          });
        }
      }
    });
    console.log("Luxyra: " + window.RDV_ONLINE.length + " RDV en ligne chargés");
  } else {
    window.RDV_ONLINE = [];
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
        used: Number(g.utilise), st: g.status, code: g.code, rem: Number(g.restant),
        scope: g.scope || "tout",
        gcNum: g.gc_num || null,
        payMethod: g.pay_method || null,
        isOffert: g.is_offert || false,
        ht: Number(g.ht) || 0,
        tva: Number(g.tva) || 0,
        tvaRate: Number(g.tva_rate) || 0.20,
        history: g.history || [],
        tkNum: g.tk_num || null
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
  console.log("Luxyra: Données chargées depuis Supabase (" + CL.length + " clients, " + AP.length + " RDV, " + PRODS.length + " produits)");
  // Show header again after login
  var hdr = document.getElementById("hdr");
  if (hdr) hdr.style.display = "";
  initApp(); // ← appelle la fonction d'init existante de l'app
  // Update notification badge after data is loaded
  setTimeout(function() {
    if (typeof updateNotifBadge === "function") updateNotifBadge();
    // Also show pending count in console
    var pending = (window.RDV_ONLINE || []).filter(function(r) { return r.status === "pending"; });
    if (pending.length > 0) console.log("Luxyra: " + pending.length + " RDV en ligne en attente de confirmation !");
  }, 500);
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
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a);font-family:var(--f1,sans-serif)"><div style="text-align:center;max-width:400px;padding:32px"><div style="font-size:48px;margin-bottom:16px">🔒</div><svg width="48" height="58" viewBox="60 30 392 430" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="sgG" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="#f0d78c"/><stop offset="35%" stop-color="#d4ab4a"/><stop offset="100%" stop-color="#a07828"/></linearGradient><linearGradient id="sgL" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f5e4a8"/><stop offset="50%" stop-color="#daba60"/><stop offset="100%" stop-color="#c49838"/></linearGradient></defs><g><polygon points="256,68 400,222 256,424 112,222" fill="none" stroke="url(#sgG)" stroke-width="4.5" stroke-linejoin="round"/><line x1="190" y1="142" x2="322" y2="142" stroke="#c8a848" stroke-width="2" opacity=".7"/><line x1="256" y1="68" x2="190" y2="142" stroke="#c8a848" stroke-width="1.8" opacity=".7"/><line x1="256" y1="68" x2="322" y2="142" stroke="#c8a848" stroke-width="1.8" opacity=".7"/><line x1="190" y1="142" x2="112" y2="222" stroke="#c8a848" stroke-width="1.5" opacity=".6"/><line x1="322" y1="142" x2="400" y2="222" stroke="#c8a848" stroke-width="1.5" opacity=".6"/><line x1="112" y1="222" x2="400" y2="222" stroke="#c8a848" stroke-width="1.8" opacity=".6"/><line x1="155" y1="222" x2="256" y2="424" stroke="#b89040" stroke-width="1.2" opacity=".4"/><line x1="358" y1="222" x2="256" y2="424" stroke="#b89040" stroke-width="1.2" opacity=".4"/><line x1="142" y1="262" x2="370" y2="262" stroke="#b89040" stroke-width=".9" opacity=".26"/><line x1="175" y1="305" x2="337" y2="305" stroke="#b89040" stroke-width=".8" opacity=".22"/></g><text x="256" y="242" text-anchor="middle" dominant-baseline="middle" font-size="115" font-family="Georgia,serif" fill="url(#sgL)">L</text></svg><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);font-family:Georgia,serif;letter-spacing:3px;margin-bottom:8px">Luxyra</div><p style="color:#94a3b8;margin-bottom:8px">Connexion au serveur impossible.</p><p style="color:#64748b;font-size:13px">Vérifiez votre connexion internet ou contactez contact@luxyra.fr.</p></div></div>';
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
    var res = await _sb.from("clients").insert(data).select();
    if (res.data && res.data[0]) client.id = res.data[0].id;
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
    a_phases: appt.aPhases || appt.phases || [],
    cancelled: appt.cancelled || false, cancel_reason: appt.cancelReason || ""
  };
  try{data.clients=appt.clients||[];data.from_caisse=appt.fromCaisse||false;}catch(e){}
  var r;
  if (appt.id && appt.id.indexOf("-") > 0 && appt.id.length > 30) {
    r=await _sb.from("appointments").update(data).eq("id", appt.id);
  } else {
    r=await _sb.from("appointments").insert(data).select();
    if (r.data && r.data[0]) appt.id = r.data[0].id;
  }
  if(r&&r.error){delete data.clients;delete data.from_caisse;if(appt.id&&appt.id.indexOf("-")>0&&appt.id.length>30){await _sb.from("appointments").update(data).eq("id",appt.id);}else{var r2=await _sb.from("appointments").insert(data).select();if(r2.data&&r2.data[0])appt.id=r2.data[0].id;}}
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
      var res = await _sb.from("produits").insert(data).select();
      if (res.data && res.data[0]) prod.id = res.data[0].id;
    }
  } else {
    var res = await _sb.from("produits").insert(data).select();
    if (res.data && res.data[0]) prod.id = res.data[0].id;
  }
}

// Sauvegarder une carte cadeau
async function saveGiftCard(gc) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    valeur: gc.val, de: gc.from, pour: gc.to, message: gc.msg,
    code: gc.code, date_creation: gc.cr, date_expiration: gc.exp,
    utilise: gc.used, restant: gc.rem, status: gc.st,
    scope: gc.scope || "tout",
    gc_num: gc.gcNum || null,
    pay_method: gc.payMethod || null,
    is_offert: gc.isOffert || false,
    ht: gc.ht || 0,
    tva: gc.tva || 0,
    tva_rate: gc.tvaRate || 0.20,
    history: gc.history || [],
    tk_num: gc.tkNum || null
  };
  if (gc.id && gc.id.indexOf("-") > 0 && gc.id.length > 30) {
    await _sb.from("cartes_cadeaux").update(data).eq("id", gc.id);
  } else {
    var res = await _sb.from("cartes_cadeaux").insert(data).select();
    if (res.data && res.data[0]) gc.id = res.data[0].id;
  }
}

// Confirmer/annuler un RDV en ligne
async function updateRdvOnline(rdvId, status, reason) {
  if (!_isOnline || !_salonId) return;
  var data = { status: status };
  if (status === "confirmed") data.confirmed_at = new Date().toISOString();
  if (status === "cancelled") { data.cancelled_at = new Date().toISOString(); data.cancel_reason = reason || ""; }
  await _sb.from("rdv_online").update(data).eq("id", rdvId);
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
  var res = await _sb.from("clotures").insert(data).select();
  if (res.data && res.data[0]) clot.id = res.data[0].id;
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
  var data = {
    nom: SALON_CONFIG.nom, sous_titre: SALON_CONFIG.sousTitre,
    logo: SALON_CONFIG.logo, adresse: SALON_CONFIG.adresse,
    cp: SALON_CONFIG.cp, ville: SALON_CONFIG.ville,
    tel: SALON_CONFIG.tel, email: SALON_CONFIG.email,
    site_web: SALON_CONFIG.siteWeb, siret: SALON_CONFIG.siret,
    tva: SALON_CONFIG.tva, couleur_primaire: SALON_CONFIG.couleurPrimaire,
    couleur_secondaire: SALON_CONFIG.couleurSecondaire,
    taux_tva: SALON_CONFIG.tauxTVA,
    show_tva_ticket: window.SHOW_TVA_TICKET
  };
  try{data.config_json=JSON.stringify({slot:typeof SLOT!=="undefined"?SLOT:15,slot_h:typeof SLOT_H!=="undefined"?SLOT_H:28,fidconf:window.FIDCONF||{seuil:10,remise:10},pay_active:window.PAY_ACTIVE||{},fond_caisse:window.CAISSE_DATA?window.CAISSE_DATA.fond:200});}catch(e){}
  var r=await _sb.from("salons").update(data).eq("id", _salonId);
  if(r&&r.error){delete data.config_json;await _sb.from("salons").update(data).eq("id", _salonId);}
}

// Sauvegarder les collaborateurs
async function saveCollaborateurs() {
  if (!_isOnline || !_salonId) return;
  // First, get all existing collab IDs from Supabase for this salon
  var existing = await _sb.from("collaborateurs").select("id").eq("salon_id", _salonId);
  var dbIds = {};
  if (existing.data) {
    for (var e = 0; e < existing.data.length; e++) {
      dbIds[existing.data[e].id] = true;
    }
  }
  // Now save each collab
  for (var i = 0; i < T.length; i++) {
    var c = T[i];
    var data = {
      salon_id: _salonId, nom: c.n, initiales: c.i,
      couleur: c.c, img: c.img || "", horaires: c.hrs || {}
    };
    if (c.id && dbIds[c.id]) {
      // Exists in DB → UPDATE
      await _sb.from("collaborateurs").update(data).eq("id", c.id);
    } else {
      // New → INSERT
      var res = await _sb.from("collaborateurs").insert(data).select();
      if (res.data && res.data[0]) c.id = res.data[0].id;
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

// Supprimer un bon cadeau
async function deleteGiftCard(gcId) {
  if (!_isOnline || !_salonId) return;
  await _sb.from("cartes_cadeaux").delete().eq("id", gcId);
  // Also remove from local array
  for (var i = 0; i < GC.length; i++) { if (GC[i].id === gcId) { GC.splice(i, 1); break; } }
}

// Purger TOUS les bons cadeaux du salon
async function purgeAllGiftCards() {
  if (!_isOnline || !_salonId) return;
  await _sb.from("cartes_cadeaux").delete().eq("salon_id", _salonId);
  GC.length = 0;
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
