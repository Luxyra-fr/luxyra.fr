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
  h += '<img src="data:image/webp;base64,UklGRnwGAABXRUJQVlA4IHAGAACQHACdASpQAFAAPlEkj0YjoiEhJ7K42HAKCWMAwNQX0lJGX9dqf0h7cnnufPA9JnqRN5p/0FcQ5co+5/UcQswPgNxe98J9H9QD8q/6L06/+j/G/3z9gPZx+c/4D/wf5n4Cf5Z/T/+j1vv2U///uS/sAox4qNxjc2z+QvJYwk5NKrN684SJhDRixrQd4vKFsupNSRdWFwicaUeld9wRx31xtRYP8s3VifiGEz/9lqIdwkIHDGojAkxFqdHr1Kdmu8IA/XDloqCzpVXxD2g1KIf92mGHu9GT0MNcFZV7vGZDxJo7miBihDdkE1SyuoAA/v+Pkc+qL9+cD/eqz7FtP5sZ8oBn+jBmPGZ/29zPJ7cdunBwbze4ovC0f0XEUJvkvdi5cjHhXiJAU57jXANWflaoxofRmdFVA4VOSMhDlaOeehzCmxbxQt9NDSMHJiGK0LvzOuVWkPLoOpBd01ShcY4V/mFX9D38zYPr71WXF7xRG2N8m1igrsQ8L2P6jqz1zy2rNJrlPqjY/y5kXi8N454YFsUYP9RZiz55PYPJ1on1kwhH4p++Aiax8sW/8w+JNjpT1M9O/4lDoQoVydyZz3RZEGdZV/9IPAov2+eh3jTBMNexxeiiVvi8ogcbG6t6OipvuNGgjy5ghXbAShOiipARUX8Cpn6xBN6CPWKPzLhdy5Jhm2ve5Ox44Gc27Kmjsg1r8ao2/WagPRf+v5HXxvFHaIxLL5n+hyDgpks3iQ74n08puz1ePtiXy23lUF7SHM/k6O4YPg71dSxCCeS9EyCNQOE+NE6xnRP9GwVGiRa26DfOaa8qTI815/oyhjuaVKoezi+5zzVtnNNheepey0JEOGcsRVc4pz/qEIPKmpWDibXHbfrnWnGK/5YSfNUd8tpk/MWPC/l/fs4TSZF9qxwlQgEBOJOiccajn2R4oIG0e2FUxYh1zSRUMwdDuGMXB+F9Zvt0gUi9a4UMxY8VGW5aZs+pPoWvgLg+m9L/zJSDo3Ety/UGWi5Zbkh/NoVyq7Iq+zR04vxyqUX1FkEjySqlMXgKal/mb1GA+SoLCz8qSdhZmJzQlrnL/3GML4DSgHEZiDwEPNBK539PkG+0nz5QGv8FbqK3cnnCZt+3aJI4GKz0zv3JRS+pwbYjVI9lMH4//xQuKXk/VISJ52eRiMujm7H3PZ3VG2nRubZjOc7Gdtj8fR3DhLjKmriQztuopTnZYJKtjU71eVGzTTcCs1pHLqpX65CXZrvCF/75fVVbKA8So7Km7PT1owWmwWbylHuavo5nzCFvYwtTIIUTNSfHUvGY0MccrWiGYbO4vwX6nN0w4HCxu37VXzbfSd+Fb6VC6tL1Rre4sncorImz+vf3YVXbmPx6wxAk2ijhHpCda1HDkAe8qF2mzNi+MfiAQTGoePTDQlhBfSTq5CcN4UXO6JYKfSxfQaLb4JJnleVCNTKasJgQGZQ5qSUYuzRbMj8s0KdKkoUwgWZ9Bhh4Du0BkBMwZ2fPlFOSyVP4QzgYFxDPinUQusFI/0y5u+iP465KnR0TWTIeOTzD4dfp8f8nesvn7+FBPiBLV5dY83GYU0rliH9z7sZMpSWOC2d/kMCuWiobtCrorySo0hv05UAvufqkfdFj0BfyfRYVnKJiuZeJtyOxTqTSDDYKpfQ/mDZse3eULjt4+SKvoAMbKDAhhujxXrDueuH1xnew37KvcMGf/Ldz/hPfv3propwUsUJHWJgmQbnb6gk0TJSn2If2hVox7z3h07W3heEfFRM4/Jlv1wGilNfgvBBkhwciu6JroZ9pgT/8Nfwpwj31+UB9H28f8GW/Nvqd9psdz02Q96/NZpSO2Uas6wGiXa8tgrP6bOb4p3WusHmbdbvpjh/5fjAa+Yv08pUJg/8ksGaLvUPKq+hKXsLjirZavtbmkmSiXtvSoXkllsE3ouU5C35+jqrsmWKw9uF7SzqTtA7HFsnXBRHBSS+tZOX0hbq6bofF4+jhCrVAsN/rFrF5BZQu5zlqQqdXEiriuqS21SD8waU7EGqzftGpRxo+b9MPPqzjH2YDwtCmnN91jYrCQEmyW052fvEnMLSG0aS4Da4y+ctx8dj2LPwbZ9aR4hO9J06Y1H5UrLCmQucA8ITk21V2ZH8/HLHfD/x2Al/MtGXlAinax9+4ZjhX9p7xOx6QhH6ghcy6DqH3OstJZVTDAAAA" style="width:80px;height:80px;border-radius:16px;margin-bottom:8px;box-shadow:0 4px 16px rgba(200,168,78,.2)" alt="L"><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);font-family:Georgia,serif;letter-spacing:3px">Luxyra</div>';
  h += '<div style="font-size:13px;color:rgba(255,255,255,.5);margin-top:4px">Connectez-vous '+String.fromCharCode(224)+' votre espace</div></div>';
  h += '<div id="loginError" style="display:none;background:rgba(248,113,113,.15);color:#f87171;padding:10px;border-radius:10px;font-size:13px;margin-bottom:14px;text-align:center"></div>';
  h += '<div style="margin-bottom:14px"><label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px;font-weight:600">Email</label>';
  h += '<input id="loginEmail" type="email" style="width:100%;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);color:#fff;font-size:15px;outline:none" placeholder="email@monactivite.fr"></div>';
  h += '<div style="margin-bottom:22px"><label style="font-size:12px;color:rgba(255,255,255,.5);display:block;margin-bottom:5px;font-weight:600">Mot de passe</label>';
  h += '<input id="loginPass" type="password" style="width:100%;padding:12px 16px;border-radius:12px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.08);color:#fff;font-size:15px;outline:none" placeholder="••••••••" onkeydown="if(event.key===\'Enter\')doLogin()"></div>';
  h += '<button onclick="doLogin()" style="width:100%;padding:14px;border-radius:12px;background:linear-gradient(135deg,var(--gold,#d4a843),#b8960f);color:#000;font-weight:800;font-size:16px;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(212,168,67,.3);transition:transform .15s" onmouseover="this.style.transform=\'translateY(-1px)\'" onmouseout="this.style.transform=\'none\'">Se connecter</button>';
  h += '<div style="text-align:center;margin-top:16px;font-size:12px;color:rgba(255,255,255,.35)">Pas encore de compte ? <a href="inscription.html" style="color:#c8a84e;font-weight:700;text-decoration:none">Inscrire mon \u00e9tablissement \u2192</a></div>';
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

// Signup — handled by inscription.html (4-step flow with SIRET, contrat, etc.)
// doSignup() removed — was dead code creating incomplete salons without SIRET/contrat

// Reset password
async function doResetPwd() {
  if (!_sb) return;
  var email = document.getElementById("loginEmail").value.trim();
  if (!email) { showLoginError("Entrez votre email d'abord"); return; }
  var result = await _sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/reset-password.html' });
  if (result.error) { showLoginError(result.error.message); }
  else { showLoginError("Email de réinitialisation envoyé !"); }
}

// Logout
async function doLogout() {
  if (_sb) await _sb.auth.signOut();
  _salonId = null;
  _userId = null;
  _isOnline = false;
  // Cleanup polling and realtime
  if(window._rdvPollInterval){clearInterval(window._rdvPollInterval);window._rdvPollInterval=null;}
  if(window._realtimeChannel&&_sb){try{_sb.removeChannel(window._realtimeChannel);}catch(e){}window._realtimeChannel=null;}
  showLoginScreen();
}

// Check session on load
async function checkSession() {
  if (!_sb) { startOffline(); return; }
  try{
  var result = await _sb.auth.getSession();
  if (result.data && result.data.session) {
    _userId = result.data.session.user.id;
    await loadSalonData();
  } else {
    showLoginScreen();
  }
  }catch(err){showLoginScreen();}
}


// ============================================================
// LOAD DATA — Charger les données du salon depuis Supabase
// ============================================================

async function loadSalonData() {
  if (!_sb || !_userId) { startOffline(); return; }
  try{

  // 1. Charger le salon
  var sRes = await _sb.from("salons").select("*").eq("user_id", _userId).limit(1);
  if (sRes.error || !sRes.data || sRes.data.length === 0) { showLoginError("Salon introuvable"); return; }

  var salon = sRes.data[0];
  _salonId = salon.id;
  _isOnline = true;

  // Minimum config pour les écrans de blocage
  SALON_CONFIG.nom = salon.nom || "Mon Salon";
  SALON_CONFIG.email = salon.email || "";
  SALON_CONFIG.plan = salon.plan || "essential";

  // Vérifier statut abonnement
  if (salon.status === "suspended" || salon.status === "cancelled") {
    showSuspendedScreen(salon.status);
    return;
  }

  // Vérifier si plan offert (gratuit)
  if(salon.is_free){
    // Check if free plan has expired
    if(salon.free_until){
      var freeEnd=new Date(salon.free_until);
      if(new Date()>freeEnd){
        // Free plan expired, revert to trial
        salon.is_free=false;
        _sb.from("salons").update({is_free:false}).eq("id",salon.id);
      }
    }
    // If still free, skip trial/payment checks
    if(salon.is_free){
      window._trialDaysLeft=null;
      window._trialEnd=null;
    }
  }

  // Handle Stripe checkout return BEFORE trial check
  // FIX W2: Do NOT update DB from client (anyone can fake ?checkout=success)
  // Only skip the trial-block UI temporarily — the webhook will update the DB
  var _urlParams = new URLSearchParams(window.location.search);
  if(_urlParams.get("checkout") === "success"){
    var _checkoutPlan = _urlParams.get("plan") || "pro";
    // Temporarily treat as active in memory (UI only, NOT saved to DB)
    salon.plan = _checkoutPlan;
    salon.status = "active";
    window._trialDaysLeft = null;
    window._trialEnd = null;
    // DO NOT write to DB — webhook is the only trusted source
    // Old vulnerable code removed: _sb.from("salons").update({plan, status}).eq("id", salon.id)
  }

  // Vérifier expiration essai (sauf plan offert)
  if(!salon.is_free && salon.status === "trial" && salon.trial_end) {
    var now = new Date();
    var end = new Date(salon.trial_end);
    var daysLeft = Math.ceil((end - now) / 86400000);
    window._trialDaysLeft = daysLeft;
    window._trialEnd = salon.trial_end;
    // Blocking is handled in initApp() via isTrialExpired()
    // Don't return here — initApp must run for Stripe checkout return to work
  } else {
    window._trialDaysLeft = null;
    window._trialEnd = null;
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
  SALON_CONFIG.subdomain = salon.subdomain || "";
  SALON_CONFIG.tauxTVA = salon.taux_tva || 20;
  SALON_CONFIG.plan = salon.plan || "essential";
  SALON_CONFIG.metier = salon.metier || "coiffure";
  SALON_CONFIG.modeActivite = salon.mode_activite || "salon";
  SALON_CONFIG.zoneDeplacementKm = salon.zone_deplacement_km || 0;
  SALON_CONFIG.fraisDeplacement = salon.frais_deplacement || 0;
  if (salon.show_tva_ticket !== undefined) window.SHOW_TVA_TICKET = salon.show_tva_ticket;
  // SMS credits
  window.SMS_CREDITS = salon.sms_credits || 0;
  window.SMS_USED = salon.sms_used || 0;
  window.IS_FREE_PLAN = salon.is_free || false;
  window.FREE_UNTIL = salon.free_until || null;

  // Documents check (15 days after paid plan)
  SALON_CONFIG.docKbis = salon.documents_kbis || "";
  SALON_CONFIG.docId = salon.documents_id || "";
  SALON_CONFIG.verif = salon.verification_status || "pending";
  var hasAllDocs = salon.documents_kbis && salon.documents_id;
  if (!salon.is_free && salon.status === "active" && salon.stripe_subscription_id && !hasAllDocs) {
    var subStart = salon.contrat_accepted_at || salon.cgv_accepted_at || salon.created_at;
    if (subStart) {
      var daysSinceSub = Math.floor((new Date() - new Date(subStart)) / 86400000);
      window._docsMissing = true;
      window._docsDeadlineDays = Math.max(0, 15 - daysSinceSub);
      if (daysSinceSub > 15) {
        window._docsBlocked = true;
      }
    }
  }

  // Monthly SMS reset for Pro plans (30 free/month)
  if(salon.plan==="pro"){
    var today=new Date().toISOString().slice(0,10);
    var lastReset=salon.sms_last_reset||"";
    var resetMonth=lastReset?lastReset.slice(0,7):"";
    var currentMonth=today.slice(0,7);
    if(resetMonth!==currentMonth){
      // New month: add 30 free SMS
      var newCredits=(salon.sms_credits||0)+30;
      window.SMS_CREDITS=newCredits;
      _sb.from("salons").update({sms_credits:newCredits,sms_last_reset:today}).eq("id",salon.id);
    }
  }
  if(salon.config_json){try{var cfg=typeof salon.config_json==="string"?JSON.parse(salon.config_json):salon.config_json;if(cfg.slot)SLOT=cfg.slot;if(cfg.slot_h)SLOT_H=cfg.slot_h;if(cfg.fidconf)window.FIDCONF=cfg.fidconf;if(cfg.pay_active)window.PAY_ACTIVE=cfg.pay_active;if(cfg.fond_caisse!==undefined){if(!window.CAISSE_DATA)window.CAISSE_DATA={};window.CAISSE_DATA.fond=cfg.fond_caisse;}if(cfg.sms_config)window.SMS_CONFIG=cfg.sms_config;if(cfg.prodcolors){window.PRODCOLORS=cfg.prodcolors;try{localStorage.setItem("_lx_prodcolors",JSON.stringify(cfg.prodcolors));}catch(e){}}if(cfg.svccolors){window.SVCCOLORS=cfg.svccolors;try{localStorage.setItem("_lx_svccolors",JSON.stringify(cfg.svccolors));}catch(e){}}if(cfg.cartes_abo){window.CARTES_ABO=cfg.cartes_abo;}}catch(e){}}

  // 3. Charger collaborateurs → T[]
  var tRes = await _sb.from("collaborateurs").select("*").eq("salon_id", _salonId).order("id");
  if (tRes.data) {
    T = tRes.data.map(function(c) {
      return { id: c.id, n: c.nom, i: c.initiales, c: c.couleur, img: c.img || "",
               hrs: c.horaires || {}, pause: c.pause || null };
    });
  }

  // 4. Charger services → SVC[]
  var svcRes = await _sb.from("services").select("*").eq("salon_id", _salonId).order("id");
  if (svcRes.data) {
    SVC = svcRes.data.map(function(s) {
      return { id: s.id, n: s.nom, p: Number(s.prix), cat: s.categorie, phases: s.phases || [], showSite: s.show_site !== false, bookOnline: s.book_online !== false };
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
        smsOk: c.sms_ok, emOk: c.email_ok, fiches: c.fiches || [],
        clientBeautyproId: c.client_beautypro_id || null
      };
    });
  }

  // 5b. Sync fidelite points from fidelite_client (source of truth)
  try {
    var fidRes = await _sb.from("fidelite_client").select("client_beautypro_id,points").eq("salon_id", _salonId);
    if (fidRes.data) {
      fidRes.data.forEach(function(f) {
        for (var ci = 0; ci < CL.length; ci++) {
          if (CL[ci].em && CL[ci].em === f.client_beautypro_id) {
            CL[ci].fid = f.points || 0;
          }
        }
      });
    }
  } catch(e) {}

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
        cc: p.coup_coeur, img: p.img || "",
        forSale: p.for_sale !== false, forUse: p.for_use || false,
        fournisseurId: p.fournisseur_id || null,
        datePeremption: p.date_peremption || null,
        paoMois: p.pao_mois || null,
        dateOuverture: p.date_ouverture || null
      };
    });
    var pcatSet = {};
    PRODS.forEach(function(p) { if (p.cat) pcatSet[p.cat] = true; });
    PCATS = Object.keys(pcatSet);
  }

  // 7b. Charger fournisseurs → FOURNISSEURS[]
  window.FOURNISSEURS = [];
  try {
    var fRes = await _sb.from("fournisseurs").select("*").eq("salon_id", _salonId).order("nom");
    if (fRes.data) {
      window.FOURNISSEURS = fRes.data.map(function(f) {
        return { id: f.id, nom: f.nom, email: f.email || "", tel: f.telephone || "",
                 representant: f.representant || "", delai: f.delai_livraison || 7, notes: f.notes || "" };
      });
    }
  } catch(e) { console.log("[FOURNISSEURS] Skip:", e.message); }

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

  // 11. Charger forfaits → FORFAITS[]
  var fRes = await _sb.from("forfaits").select("*").eq("salon_id", _salonId).order("id");
  if (fRes.data && fRes.data.length > 0) {
    FORFAITS = fRes.data.map(function(f) {
      return { id: f.id, n: f.nom, p: Number(f.prix), cat: f.categorie || "", services: f.services || [], phases: f.phases || [], showSite: f.show_site !== false, bookOnline: f.book_online !== false };
    });
  }

  // 12. Charger packs clients → window.PACKS_CLIENTS[]
  var pkRes = await _sb.from("packs_clients").select("*").eq("salon_id", _salonId).order("created_at", { ascending: false });
  if (pkRes.data) {
    window.PACKS_CLIENTS = pkRes.data.map(function(p) {
      return { id: p.id, clientId: p.client_id, clientNom: p.client_nom, nom: p.nom, prestId: p.prestation_id, prestNom: p.prestation_nom, total: p.total_seances, used: p.seances_utilisees, prix: Number(p.prix_total), dateAchat: p.date_achat, dateExp: p.date_expiration, ticketNum: p.ticket_num, status: p.status };
    });
  } else {
    window.PACKS_CLIENTS = [];
  }

  // 13. Charger cartes d'abonnement clients → window.CARTES_ABO_CLIENTS[]
  if(!window.CARTES_ABO)window.CARTES_ABO=[];
  try{
    var caRes = await _sb.from("cartes_abo_clients").select("*").eq("salon_id", _salonId).order("created_at", { ascending: false });
    if (caRes.data) {
      window.CARTES_ABO_CLIENTS = caRes.data.map(function(c) {
        return { id: c.id, clientId: c.client_id, clientBpId: c.client_beautypro_id || null, clientNom: c.client_nom, carteId: c.carte_id, carteNom: c.carte_nom, tarif: Number(c.tarif), remiseServices: Number(c.remise_services), remiseForfaits: Number(c.remise_forfaits), dateAchat: c.date_achat, dateExp: c.date_expiration, status: c.status || "active", ticketNum: c.ticket_num || "", economiesTotales: Number(c.economies_totales) || 0 };
      });
    } else {
      window.CARTES_ABO_CLIENTS = [];
    }
  }catch(e){window.CARTES_ABO_CLIENTS=[];}

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
  }catch(err){console.error("loadSalonData error:",err);}
}

function showSuspendedScreen(status) {
  var el = document.getElementById("app") || document.body;
  var msg = status === "suspended" ? "Votre abonnement est suspendu suite à un défaut de paiement." : "Votre abonnement a été résilié.";
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a)"><div style="text-align:center;max-width:400px;padding:32px"><div style="font-size:48px;margin-bottom:16px">⚠️</div><h2 style="color:#f87171;margin-bottom:12px">Compte ' + status + '</h2><p style="color:#94a3b8;margin-bottom:20px">' + msg + '</p><button onclick="openCustomerPortal()" style="display:inline-block;padding:12px 24px;background:#d4a843;color:#000;border-radius:10px;font-weight:700;border:none;cursor:pointer;font-size:15px">Gérer mon abonnement</button><br><button onclick="doLogout()" style="margin-top:12px;background:none;border:none;color:#64748b;cursor:pointer;font-size:13px">Se déconnecter</button></div></div>';
  document.getElementById("hdr").style.display="none";
}

function showTrialExpiredScreen(salon) {
  var el = document.getElementById("app") || document.body;
  document.getElementById("hdr").style.display="none";
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a)">'+
    '<div style="text-align:center;max-width:440px;padding:32px">'+
    '<div style="font-size:56px;margin-bottom:16px">⏰</div>'+
    '<h2 style="color:var(--gold,#d4a843);margin-bottom:8px;font-size:24px">Votre essai est terminé</h2>'+
    '<p style="color:#94a3b8;margin-bottom:24px;font-size:15px;line-height:1.6">Merci d\u2019avoir testé Luxyra !<br>Pour continuer à utiliser toutes les fonctionnalités, choisissez votre formule.</p>'+
    '<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;justify-content:center">'+
    '<div style="flex:1;min-width:180px;background:rgba(96,165,250,.08);border:1px solid rgba(96,165,250,.2);border-radius:14px;padding:20px;text-align:center">'+
    '<div style="font-size:12px;color:#60a5fa;font-weight:700;letter-spacing:1px;margin-bottom:8px">ESSENTIEL</div>'+
    '<div style="font-size:28px;font-weight:800;color:#fff">14,99\u20ac<span style="font-size:14px;color:#94a3b8">/mois</span></div>'+
    '<div style="font-size:11px;color:#94a3b8;margin-top:8px">Planning \u2022 Encaissement \u2022 Clients</div>'+
    '<button onclick="checkCgvAndPay(\'essential\')" style="margin-top:12px;width:100%;padding:10px;border-radius:10px;background:#60a5fa;color:#fff;font-weight:700;border:none;cursor:pointer;font-size:13px">Choisir Essentiel</button>'+
    '</div>'+
    '<div style="flex:1;min-width:180px;background:rgba(212,168,67,.08);border:1.5px solid rgba(212,168,67,.3);border-radius:14px;padding:20px;text-align:center;position:relative">'+
    '<div style="position:absolute;top:-10px;left:50%;transform:translateX(-50%);background:#d4a843;color:#000;font-size:9px;font-weight:800;padding:3px 10px;border-radius:50px;letter-spacing:1px">RECOMMANDÉ</div>'+
    '<div style="font-size:12px;color:#d4a843;font-weight:700;letter-spacing:1px;margin-bottom:8px">PRO</div>'+
    '<div style="font-size:28px;font-weight:800;color:#fff">24,99\u20ac<span style="font-size:14px;color:#94a3b8">/mois</span></div>'+
    '<div style="font-size:11px;color:#94a3b8;margin-top:8px">Tout Essentiel + Site \u2022 Résa \u2022 SMS</div>'+
    '<button onclick="checkCgvAndPay(\'pro\')" style="margin-top:12px;width:100%;padding:10px;border-radius:10px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#000;font-weight:700;border:none;cursor:pointer;font-size:13px">Choisir Pro</button>'+
    '</div>'+
    '</div>'+
    '<label style="display:flex;align-items:flex-start;gap:8px;margin:16px 0 12px;cursor:pointer;font-size:11px;color:#94a3b8;line-height:1.4;text-align:left"><input type="checkbox" id="cgvCheck" style="margin-top:2px;flex-shrink:0"> J\u2019accepte les <a href="/cgv" target="_blank" style="color:#d4a843">CGV</a> et la <a href="/confidentialite" target="_blank" style="color:#d4a843">Politique de confidentialit\u00e9</a></label>'+
    '<button onclick="doLogout()" style="background:none;border:none;color:#64748b;cursor:pointer;font-size:13px">Se déconnecter</button>'+
    '</div></div>';
}

// Mode hors ligne (pas de Supabase configuré)
function startOffline() {
  _isOnline = false;
  // Bloquer l'accès sans Supabase
  var el = document.getElementById("app") || document.body;
  el.innerHTML = '<div style="min-height:100vh;display:flex;align-items:center;justify-content:center;background:var(--bg,#0a0e1a);font-family:var(--f1,sans-serif)"><div style="text-align:center;max-width:400px;padding:32px"><div style="font-size:48px;margin-bottom:16px">🔒</div><img src="data:image/webp;base64,UklGRigDAABXRUJQVlA4IBwDAACQDwCdASowADAAPlEij0WjoaETnASQOAUEsYBXJ605F9ePOejDbec73pwG84/6hxHu6q1dzC/+R9wHs1+hv+V/efgG/Vr/Z9eT9t/Yt/XlTKjrpPnVbcfCR8tAOR6dRsfqF3udzZAdGylkMu2pczclBrwDhuRUDlbkjXhfxbiQjs9IdEwgAP78pX/Fh/xQon4sa1CAyc1/ohBG4jmXYWWfjbcyo11jsoAEsbKeULzwh4FPpVJacD7br1LCiiTDp6xN56OfIpUJgCP+FWVUJOptF9MFJb8tE/3ifo4Ng0+lY/VlDL4D/TB2T4CbrArX9vFDoA8SUi/m517TEcmWSSbht5H+dTrB2o0es+G2o659GdTCDQNyr9Hh8vrb3Y6Cc6zsBIJZMqmmOLAm9+SJtf95P9+xYORz7ZuF8tvS94dtKJwJGMeX8OQXzRL0KFHATmXJUqnLKsq/v1Zf1kmomC9u7aTBJ/4O7vOnFN6wS2rvppGtBvfLZ/FtS03eYzgPGzOItPGsadUwy7fTb/FZEnSeVSH1zzIXIEq/8+S7Ccq2dHZ69n6L9OXHDU5ajWGModmSmmOJLh/aBVTZvjrBUfHG4B0cxIHE16Jy/o5+f+wQRxjDHFxSihTQKV4cl4Vb322dDJx61utw0XwrKdyfqVuW7nGFAECCSOFIpzrlhBKChYG2Vd9wgu58MRtO2nPzXO1PkMGAe+QaaBL1S71cD0zDIE3yhpFNwL+TMswCh6JWdmOur6ca76M1MH1a76WXsgpuEc7lPJi3+mziL0Dv52LSajdG/5teMdG2pP/5GsX1GyLUZK9NnA2iIGNVArxMbvXQ15D/UVozmLf0GPQ5ICgwSw5Iv76FLCxKVsgS8ARQG8E3hqqMSb7XYCoHuYkTlowqF0qTthXyq89GJ++pf7hud/OAcFnN3z5dNSSvK8XkfJdwyJKp9Pcsug48wzT+NiKadVrEIS2eKfhxhdS8bzoWPR96Ff4lh9zxrh2Q8iLrcjwyaE+NrgC+wprpy9eV3uy1L7nH2heVxDPHLS4Qou4afIINoUvdBbv7wAAA" style="width:48px;height:48px;border-radius:10px;margin-bottom:8px" alt="L"><div style="font-size:28px;font-weight:900;color:var(--gold,#d4a843);font-family:Georgia,serif;letter-spacing:3px;margin-bottom:8px">Luxyra</div><p style="color:#94a3b8;margin-bottom:8px">Connexion au serveur impossible.</p><p style="color:#64748b;font-size:13px">Vérifiez votre connexion internet ou contactez contact@luxyra.fr.</p></div></div>';
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
  // Cross-salon sync: update all client records + compte with same email
  if (client.em) {
    var syncClients = {}, syncBp = {};
    if (client.nom) { syncClients.nom = client.nom; syncBp.nom = client.nom; }
    if (client.pre) { syncClients.prenom = client.pre; syncBp.prenom = client.pre; }
    if (client.ph) { syncClients.telephone = client.ph; syncBp.telephone = client.ph; }
    if (client.sex) { syncClients.sexe = client.sex; syncBp.genre = client.sex; }
    if (client.adr) { syncClients.adresse = client.adr; syncBp.adresse = client.adr; }
    if (client.cp) { syncClients.cp = client.cp; syncBp.cp = client.cp; }
    if (client.ville) { syncClients.ville = client.ville; syncBp.ville = client.ville; }
    if (client.ddn) { syncClients.date_naissance = client.ddn; syncBp.date_naissance = client.ddn; }
    if (client.smsOk !== undefined) { syncClients.sms_ok = client.smsOk; syncBp.sms_ok = client.smsOk; }
    if (client.emOk !== undefined) { syncClients.email_ok = client.emOk; syncBp.email_ok = client.emOk; }
    try {
      if (Object.keys(syncClients).length) {
        await _sb.from("clients").update(syncClients).eq("email", client.em).neq("id", client.id);
      }
      if (Object.keys(syncBp).length) {
        await _sb.from("clients_beautypro").update(syncBp).eq("email", client.em);
      }
    } catch(e) { console.log("[SYNC]", e.message); }
  }
  // Sync fidelite_client.points when fid changes
  if (client.em && client.fid !== undefined && _salonId) {
    try {
      var fr = await _sb.from("fidelite_client").select("id").eq("client_beautypro_id", client.em).eq("salon_id", _salonId).limit(1);
      if (fr.data && fr.data[0]) {
        await _sb.from("fidelite_client").update({ points: client.fid }).eq("id", fr.data[0].id);
      }
    } catch(e) { console.log("[FIDELITE SYNC]", e.message); }
  }
}

// Sauvegarder un rendez-vous/ticket
async function saveAppointment(appt) {
  if (!_isOnline || !_salonId) return;
  // Resolve client email and collab name for compte client lookup
  var clEmail = null, collabName = null;
  if (appt.cId && typeof gC === "function") { var cl = gC(appt.cId); if (cl && cl.em) clEmail = cl.em; }
  if (appt.stId && typeof gT === "function") { var st = gT(appt.stId); if (st && st.n) collabName = st.n; }
  var data = {
    salon_id: _salonId,
    client_id: (appt.cId && appt.cId.indexOf("-") > 0 && appt.cId.length > 30) ? appt.cId : null, service_id: appt.sId, collab_id: appt.stId,
    date_rdv: appt.date, heure: appt.time, prix: appt.pr,
    brut_total: appt.brutTotal || null, remise: appt.remise || 0,
    status: appt.st, mode_paiement: appt.met || "",
    ticket_num: appt.tkNum || null, ticket_html: appt.ticketHtml || null, hash: appt.hash || "",
    prev_hash: appt.prevHash || "", hash_algo: appt.hashAlgo || "",
    items: appt.items || [], comment: appt.comment || "",
    a_phases: appt.aPhases || appt.phases || [],
    cancelled: appt.cancelled || false, cancel_reason: appt.cancelReason || "",
    client_email: clEmail, collab_name: collabName
  };
  try{data.clients=appt.clients||[];data.from_caisse=appt.fromCaisse||false;}catch(e){}
  var r;
  if (appt.id && appt.id.indexOf("-") > 0 && appt.id.length > 30) {
    r=await _sb.from("appointments").update(data).eq("id", appt.id);
  } else {
    r=await _sb.from("appointments").insert(data).select();
    if (r.data && r.data[0]) appt.id = r.data[0].id;
  }
  if(r&&r.error){delete data.clients;delete data.from_caisse;delete data.client_email;delete data.collab_name;if(appt.id&&appt.id.indexOf("-")>0&&appt.id.length>30){await _sb.from("appointments").update(data).eq("id",appt.id);}else{var r2=await _sb.from("appointments").insert(data).select();if(r2.data&&r2.data[0])appt.id=r2.data[0].id;}}
}

// Supprimer un RDV non-encaissé de la base
async function deleteAppointmentFromDb(apptId) {
  if (!_isOnline || !_salonId || !apptId) return;
  try {
    if (apptId.indexOf("-") > 0 && apptId.length > 30) {
      var r = await _sb.from("appointments").delete().eq("id", apptId).eq("salon_id", _salonId);
      if (r.error) console.error("[DEL APPT] Erreur:", r.error.message);
      else console.log("[DEL APPT] OK", apptId);
    }
  } catch(e) { console.error("[DEL APPT] Exception:", e.message); }
}

// Sauvegarder un produit
async function saveProduct(prod) {
  if (!_isOnline || !_salonId) return;
  var data = {
    salon_id: _salonId,
    nom: prod.n, prix: prod.p, prix_achat: prod.pa || 0,
    categorie: prod.cat, code_barre: prod.cb || "",
    stock: prod.stk, stock_min: prod.stkMin,
    coup_coeur: prod.cc || false, img: prod.img || "",
    for_sale: prod.forSale !== false, for_use: prod.forUse || false,
    fournisseur_id: prod.fournisseurId || null,
    date_peremption: prod.datePeremption || null,
    pao_mois: prod.paoMois || null,
    date_ouverture: prod.dateOuverture || null
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
    metier: SALON_CONFIG.metier || "coiffure",
    mode_activite: SALON_CONFIG.modeActivite || "salon",
    zone_deplacement_km: SALON_CONFIG.zoneDeplacementKm || 0,
    frais_deplacement: SALON_CONFIG.fraisDeplacement || 0,
    show_tva_ticket: window.SHOW_TVA_TICKET
  };
  try{var _sc=window.SITE_CONFIG||{};data.config_json=JSON.stringify({nom:SALON_CONFIG.nom,tel:SALON_CONFIG.tel,adresse:SALON_CONFIG.adresse,cp:SALON_CONFIG.cp,ville:SALON_CONFIG.ville,email:SALON_CONFIG.email,logo:SALON_CONFIG.logo,slogan:SALON_CONFIG.sousTitre||_sc.slogan,metier:SALON_CONFIG.metier,siteActif:_sc.siteActif||false,reservationActive:_sc.reservationActive||false,photoHero:_sc.photoHero,photoSalon:_sc.photoSalon,slot:typeof SLOT!=="undefined"?SLOT:15,slot_h:typeof SLOT_H!=="undefined"?SLOT_H:28,fidconf:window.FIDCONF||{seuil:10,remise:10},pay_active:window.PAY_ACTIVE||{},fond_caisse:window.CAISSE_DATA?window.CAISSE_DATA.fond:200,prodcolors:window.PRODCOLORS||{},svccolors:typeof SVCCOLORS!=="undefined"?SVCCOLORS:{},sms_config:window.SMS_CONFIG||{},cartes_abo:window.CARTES_ABO||[]});}catch(e){}
  var r=await _sb.from("salons").update(data).eq("id", _salonId);
  if(r&&r.error){delete data.config_json;await _sb.from("salons").update(data).eq("id", _salonId);}
}

// Sauvegarder les collaborateurs
// Sauvegarder les services
async function saveServices() {
  if (!_sb || !_salonId) return;
  for (var i = 0; i < SVC.length; i++) {
    var s = SVC[i];
    var data = {
      salon_id: _salonId, nom: s.n, prix: s.p,
      categorie: s.cat, phases: s.phases || [],
      show_site: s.showSite !== false, book_online: s.bookOnline !== false
    };
    if (typeof s.id === "number" && s.id > 0) {
      var check = await _sb.from("services").select("id").eq("id", s.id).eq("salon_id", _salonId);
      if (check.data && check.data.length > 0) {
        await _sb.from("services").update(data).eq("id", s.id);
      } else {
        var res = await _sb.from("services").insert(data).select();
        if (res.data && res.data[0]) s.id = res.data[0].id;
      }
    } else {
      var res = await _sb.from("services").insert(data).select();
      if (res.data && res.data[0]) s.id = res.data[0].id;
    }
  }
}

// Sauvegarder les forfaits
async function saveForfaits() {
  if (!_sb || !_salonId) return;
  for (var i = 0; i < FORFAITS.length; i++) {
    var f = FORFAITS[i];
    var data = {
      salon_id: _salonId, nom: f.n, prix: f.p,
      categorie: f.cat, services: f.services || [],
      phases: f.phases || [],
      show_site: f.showSite !== false, book_online: f.bookOnline !== false
    };
    if (typeof f.id === "number" && f.id > 0) {
      var check = await _sb.from("forfaits").select("id").eq("id", f.id).eq("salon_id", _salonId);
      if (check.data && check.data.length > 0) {
        await _sb.from("forfaits").update(data).eq("id", f.id);
      } else {
        var res = await _sb.from("forfaits").insert(data).select();
        if (res.data && res.data[0]) f.id = res.data[0].id;
      }
    } else {
      var res = await _sb.from("forfaits").insert(data).select();
      if (res.data && res.data[0]) f.id = res.data[0].id;
    }
  }
  // Also save to localStorage as backup
  try { localStorage.setItem("_cp_forfaits", JSON.stringify(FORFAITS)); } catch(e) {}
}

// Sauvegarder un pack client (achat ou validation séance)
async function savePack(pack) {
  if (!_sb || !_salonId) return;
  var data = {
    salon_id: _salonId,
    client_id: pack.clientId || "",
    client_nom: pack.clientNom || "",
    nom: pack.nom,
    prestation_id: pack.prestId || null,
    prestation_nom: pack.prestNom || "",
    total_seances: pack.total,
    seances_utilisees: pack.used || 0,
    prix_total: pack.prix,
    date_achat: pack.dateAchat,
    date_expiration: pack.dateExp || null,
    ticket_num: pack.ticketNum || "",
    status: pack.status || "active"
  };
  if (pack.id) {
    await _sb.from("packs_clients").update(data).eq("id", pack.id);
  } else {
    var res = await _sb.from("packs_clients").insert(data).select();
    if (res.data && res.data[0]) pack.id = res.data[0].id;
  }
}

// Valider une séance d'un pack
async function usePackSeance(packId) {
  if (!_sb) return;
  var pk = (window.PACKS_CLIENTS || []).find(function(p) { return p.id === packId; });
  if (!pk) return;
  pk.used = (pk.used || 0) + 1;
  if (pk.used >= pk.total) pk.status = "completed";
  await _sb.from("packs_clients").update({ seances_utilisees: pk.used, status: pk.status }).eq("id", packId);
  return pk;
}

// Sauvegarder une carte d'abonnement client
async function saveCarteAboClient(carte) {
  if (!_sb || !_salonId) return;
  // Always resolve email from clients table as cross-salon identifier (same pattern as fidelite)
  if (!carte.clientBpId && carte.clientId) {
    try {
      var clLookup = await _sb.from("clients").select("email").eq("id", carte.clientId).limit(1);
      if (clLookup.data && clLookup.data[0] && clLookup.data[0].email) {
        carte.clientBpId = clLookup.data[0].email;
      }
    } catch(e) {}
  }
  var data = {
    salon_id: _salonId,
    client_id: carte.clientId || "",
    client_beautypro_id: carte.clientBpId || null,
    client_nom: carte.clientNom || "",
    carte_id: carte.carteId || "",
    carte_nom: carte.carteNom || "",
    tarif: carte.tarif || 0,
    remise_services: carte.remiseServices || 0,
    remise_forfaits: carte.remiseForfaits || 0,
    date_achat: carte.dateAchat,
    date_expiration: carte.dateExp || null,
    status: carte.status || "active",
    ticket_num: carte.ticketNum || "",
    economies_totales: carte.economiesTotales || 0
  };
  if (carte.id) {
    await _sb.from("cartes_abo_clients").update(data).eq("id", carte.id);
  } else {
    var res = await _sb.from("cartes_abo_clients").insert(data).select();
    if (res.data && res.data[0]) carte.id = res.data[0].id;
  }
}

// Mettre à jour les économies totales d'une carte client
async function updateCarteAboEconomies(carteClientId, addedEconomies) {
  if (!_sb) return;
  var cc = (window.CARTES_ABO_CLIENTS || []).find(function(c) { return c.id === carteClientId; });
  if (!cc) return;
  cc.economiesTotales = (cc.economiesTotales || 0) + addedEconomies;
  await _sb.from("cartes_abo_clients").update({ economies_totales: cc.economiesTotales }).eq("id", carteClientId);
}

// Supprimer un forfait
async function deleteForfaitFromDb(forfaitId) {
  if (!_sb || !_salonId) return;
  await _sb.from("forfaits").delete().eq("id", forfaitId).eq("salon_id", _salonId);
}

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
      couleur: c.c, img: c.img || "", horaires: c.hrs || {},
      pause: c.pause || null
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
// FOURNISSEURS CRUD
// ============================================================
async function saveFournisseur(f) {
  if (!_isOnline || !_salonId) return;
  var data = { salon_id: _salonId, nom: f.nom, email: f.email || "", telephone: f.tel || "",
               representant: f.representant || "", delai_livraison: f.delai || 7, notes: f.notes || "" };
  if (f.id && String(f.id).indexOf("-") > 0) {
    await _sb.from("fournisseurs").update(data).eq("id", f.id);
  } else {
    var res = await _sb.from("fournisseurs").insert(data).select();
    if (res.data && res.data[0]) f.id = res.data[0].id;
  }
}
async function deleteFournisseur(fId) {
  if (!_isOnline || !_salonId) return;
  // Unlink products first
  await _sb.from("produits").update({ fournisseur_id: null }).eq("fournisseur_id", fId).eq("salon_id", _salonId);
  await _sb.from("fournisseurs").delete().eq("id", fId).eq("salon_id", _salonId);
}

// ============================================================
// MOUVEMENTS STOCK
// ============================================================
async function logMouvementStock(prodId, prodNom, type, qty, stkAvant, stkApres, ref, note) {
  if (!_isOnline || !_salonId) return;
  try {
    await _sb.from("mouvements_stock").insert({
      salon_id: _salonId, produit_id: prodId, produit_nom: prodNom,
      type: type, quantite: qty, stock_avant: stkAvant, stock_apres: stkApres,
      reference: ref || null, note: note || null
    });
  } catch(e) { console.error("[MVT STOCK]", e.message); }
}
async function getMouvementsStock(prodId, limit) {
  if (!_isOnline || !_salonId) return [];
  try {
    var r = await _sb.from("mouvements_stock").select("*")
      .eq("salon_id", _salonId).eq("produit_id", prodId)
      .order("created_at", { ascending: false }).limit(limit || 50);
    return r.data || [];
  } catch(e) { return []; }
}

// ============================================================
// SYNC: rdv_online client → salon clients table
// ============================================================
async function syncClientFromOnlineRdv(rdvData) {
  if (!_isOnline || !_salonId) return null;
  // Check if client already exists by email or beautypro_id
  var email = rdvData.client_email || "";
  var bpId = rdvData.client_beautypro_id || null;
  var existing = null;
  if (bpId) {
    var r = await _sb.from("clients").select("*").eq("salon_id", _salonId).eq("client_beautypro_id", bpId).limit(1);
    if (r.data && r.data.length) existing = r.data[0];
  }
  if (!existing && email) {
    var r2 = await _sb.from("clients").select("*").eq("salon_id", _salonId).eq("email", email).limit(1);
    if (r2.data && r2.data.length) existing = r2.data[0];
  }
  if (!existing && rdvData.client_telephone) {
    var r3 = await _sb.from("clients").select("*").eq("salon_id", _salonId).eq("telephone", rdvData.client_telephone).limit(1);
    if (r3.data && r3.data.length) existing = r3.data[0];
  }
  if (existing) {
    // Link beautypro_id if not set
    if (bpId && !existing.client_beautypro_id) {
      await _sb.from("clients").update({ client_beautypro_id: bpId }).eq("id", existing.id);
    }
    return existing.id;
  }
  // Create new client
  var newClient = {
    salon_id: _salonId,
    nom: rdvData.client_nom || "",
    prenom: rdvData.client_prenom || "",
    telephone: rdvData.client_telephone || "",
    email: email,
    client_beautypro_id: bpId,
    genre: rdvData.client_genre || "F",
    date_naissance: rdvData.client_ddn || null,
    created_at: new Date().toISOString()
  };
  var res = await _sb.from("clients").insert(newClient).select();
  if (res.data && res.data[0]) return res.data[0].id;
  return null;
}

// Update fidelite_client cross-salon table
async function updateFideliteClient(bpId, salonId, salonNom, currentFid, hasPrestation) {
  if (!_isOnline || !bpId) return;
  var fidconf = window.FIDCONF || { seuil: 10, remise: 10 };
  var pts = (typeof currentFid === "number") ? currentFid : null;
  var countVisit = hasPrestation !== false;
  try {
    var r = await _sb.from("fidelite_client").select("*").eq("client_beautypro_id", bpId).eq("salon_id", salonId).limit(1);
    if (r.data && r.data.length) {
      var f = r.data[0];
      var updateData = {
        points: pts !== null ? pts : (f.points || 0) + 1,
        derniere_visite: new Date().toISOString().slice(0, 10),
        salon_nom: salonNom || SALON_CONFIG.nom,
        seuil_fidelite: fidconf.seuil || 10,
        remise_fidelite: fidconf.remise || 10,
        remise_type: fidconf.type || "amount",
        updated_at: new Date().toISOString()
      };
      if (countVisit) updateData.visites = (f.visites || 0) + 1;
      await _sb.from("fidelite_client").update(updateData).eq("id", f.id);
    } else {
      await _sb.from("fidelite_client").insert({
        client_beautypro_id: bpId,
        salon_id: salonId,
        salon_nom: salonNom || SALON_CONFIG.nom,
        points: pts !== null ? pts : 1,
        visites: countVisit ? 1 : 0,
        derniere_visite: new Date().toISOString().slice(0, 10),
        seuil_fidelite: fidconf.seuil || 10,
        remise_fidelite: fidconf.remise || 10,
        remise_type: fidconf.type || "amount"
      });
    }
  } catch(e) { console.log("[FIDELITE]", e.message); }
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
