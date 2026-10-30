// ============================================================================
// lx-client.js — Client helper pour les edge functions Luxyra
// ============================================================================
// Wrapper autour des edge functions lx-signup / lx-login / lx-profile pour
// l'authentification client Luxyra (compte client unique cross-salons).
//
// Stockage session :
//   - localStorage["lx_token"]   : session_token JWT HS256 (30 jours)
//   - localStorage["lx_account"] : objet user (SANS password_hash)
//
// Compat legacy : lit aussi localStorage["lx_bp_token"] et le migre
// silencieusement vers "lx_token" pour ne pas déconnecter les sessions actives.
// ============================================================================

(function(){
  var LX_API = "https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1";
  var LX_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI";

  // Migration silencieuse : si l'ancien token existe mais pas le nouveau, copie-le
  try {
    if (!localStorage.getItem("lx_token") && localStorage.getItem("lx_bp_token")) {
      localStorage.setItem("lx_token", localStorage.getItem("lx_bp_token"));
      localStorage.removeItem("lx_bp_token");
    }
  } catch(e){}

  function getToken(){
    try { return localStorage.getItem("lx_token") || ""; } catch(e){ return ""; }
  }
  function setToken(t){
    try { if(t) localStorage.setItem("lx_token", t); else localStorage.removeItem("lx_token"); } catch(e){}
  }
  function setUser(u){
    try { if(u) localStorage.setItem("lx_account", JSON.stringify(u)); else localStorage.removeItem("lx_account"); } catch(e){}
  }
  // 2026-10-14 : crochet appelé JUSTE AVANT d'effacer le jeton (la page peut retirer l'abonnement aux
  // notifications du navigateur tant que le jeton existe encore). window.lxAvantDeconnexion est défini par compte.html.
  function avantDeconnexion(){
    try { if (typeof window.lxAvantDeconnexion === "function") window.lxAvantDeconnexion(); } catch(e){}
  }
  function getUser(){
    try { var d = localStorage.getItem("lx_account"); return d ? JSON.parse(d) : null; } catch(e){ return null; }
  }
  // 2026-10-14 audit : ouverture d'une session (connexion, inscription, lien de réinitialisation ou
  // d'invitation). Si un AUTRE compte était connecté sur cet appareil, on exécute d'abord le crochet de
  // déconnexion (désabonnement des notifications de l'ancien compte) puis window.lxChangementCompte
  // (la page efface les données de l'ancien compte : RDV, favoris, récents…).
  function ouvrirSession(token, user){
    if (!token) return;
    var avant = getUser(), avantTok = getToken();
    var autre = !!(avantTok && (!avant || !user || String(avant.id || avant.email || "") !== String(user.id || user.email || "")));
    if (autre) {
      avantDeconnexion();
      try { if (typeof window.lxChangementCompte === "function") window.lxChangementCompte(avant, user); } catch(e){}
    }
    setToken(token);
    setUser(user || null);
  }

  async function call(endpoint, body){
    try {
      var r = await fetch(LX_API + "/" + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": LX_ANON,
          "Authorization": "Bearer " + LX_ANON
        },
        body: JSON.stringify(body || {})
      });
      var data;
      try { data = await r.json(); } catch(_){ data = {}; }
      return { ok: r.ok, status: r.status, data: data };
    } catch(e){
      return { ok: false, status: 0, data: { error: "Erreur réseau: " + (e.message || e) } };
    }
  }

  // ------------------------ Public API ------------------------

  async function lxSignup(fields){
    var res = await call("lx-signup", fields);
    if (res.ok && res.data && res.data.session_token) ouvrirSession(res.data.session_token, res.data.user); // 2026-10-14 audit
    return res;
  }

  async function lxLogin(email, password){
    var res = await call("lx-login", { email: email, password: password });
    if (res.ok && res.data && res.data.session_token) ouvrirSession(res.data.session_token, res.data.user); // 2026-10-14 audit
    return res;
  }

  async function lxGet(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", { session_token: token, action: "get" });
    if (res.ok && res.data && res.data.user) setUser(res.data.user);
    else if (res.status === 401) { avantDeconnexion(); setToken(""); setUser(null); } // 2026-10-14 : session expirée
    return res;
  }

  async function lxUpdate(patch){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var body = Object.assign({ session_token: token, action: "update" }, patch || {});
    var res = await call("lx-profile", body);
    if (res.ok && res.data && res.data.user) setUser(res.data.user);
    return res;
  }

  async function lxChangePassword(oldPass, newPass){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", {
      session_token: token, action: "change_password",
      old_password: oldPass, new_password: newPass
    });
    // 2026-10-14 : les autres appareils sont déconnectés ; cet appareil reçoit un nouveau jeton
    if (res.ok && res.data && res.data.session_token) setToken(res.data.session_token);
    return res;
  }

  async function lxDelete(password){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", {
      session_token: token, action: "delete",
      password: password || ""
    });
    if (res.ok) { avantDeconnexion(); setToken(""); setUser(null); } // 2026-10-14
    return res;
  }

  async function lxToggleNotif(field, value){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", {
      session_token: token, action: "toggle_notif",
      field: field, value: value
    });
    if (res.ok) {
      var u = getUser();
      if (u) { u[field] = value; setUser(u); }
    }
    return res;
  }

  async function lxRemovePayment(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", { session_token: token, action: "remove_payment" });
    if (res.ok) {
      var u = getUser();
      if (u) { u.stripe_pm = null; u.card_last4 = null; u.card_exp = null; setUser(u); }
    }
    return res;
  }

  function lxLogout(){
    avantDeconnexion(); // 2026-10-14
    setToken("");
    setUser(null);
  }

  function lxHasSession(){
    return !!getToken();
  }

  // Check HaveIBeenPwned via k-anonymity API (SHA-1, 5 premiers chars seulement envoyés)
  async function lxCheckPasswordLeaked(password){
    if(!password) return false;
    try {
      var enc = new TextEncoder().encode(password);
      var hashBuf = await crypto.subtle.digest("SHA-1", enc);
      var hashHex = Array.from(new Uint8Array(hashBuf))
        .map(function(b){ return b.toString(16).padStart(2, "0"); })
        .join("").toUpperCase();
      var prefix = hashHex.slice(0, 5);
      var suffix = hashHex.slice(5);
      var r = await fetch("https://api.pwnedpasswords.com/range/" + prefix, {
        headers: { "Add-Padding": "true" }
      });
      if(!r.ok) return false;
      var text = await r.text();
      var lines = text.split("\n");
      for(var i = 0; i < lines.length; i++){
        var parts = lines[i].trim().split(":");
        if(parts[0] === suffix && parseInt(parts[1], 10) > 0) return true;
      }
      return false;
    } catch(e) {
      console.log("HIBP check failed:", e);
      return false;
    }
  }

  // 2026-10-08 : mot de passe oublie (lien par email, valable 1 h)
  async function lxRequestReset(email, retour){ return await call("lx-password-reset", { action: "request", email: email, retour: retour || "" }); }
  async function lxConfirmReset(token, password){ return await call("lx-password-reset", { action: "confirm", token: token, password: password }); }

  // 2026-10-14 : vérification de l'adresse email du compte (lien reçu par email ; renvoi limité côté serveur)
  async function lxVerifyEmail(verifToken){
    var res = await call("lx-profile", { action: "verify_email", token: verifToken });
    // 2026-10-14 intégration : le compte local n'est marqué vérifié que si l'adresse confirmée est la sienne
    if (res.ok) {
      var u = getUser();
      var mv = String((res.data && res.data.email) || "").trim().toLowerCase();
      if (u && mv && String(u.email || "").trim().toLowerCase() === mv) { u.email_verified = true; setUser(u); }
    }
    return res;
  }
  async function lxSendVerification(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    return await call("lx-profile", { session_token: token, action: "send_verification" });
  }
  // 2026-10-30 : correction de l'adresse e-mail tant qu'elle n'est pas confirmée (mot de passe exigé ; nouveau lien envoyé
  // à la nouvelle adresse ; les autres appareils sont déconnectés, cet appareil reçoit un nouveau jeton)
  async function lxChangeEmail(newEmail, password){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", { session_token: token, action: "change_email", new_email: String(newEmail || "").trim(), password: password || "" });
    if (res.ok && res.data) { if (res.data.session_token) setToken(res.data.session_token); if (res.data.user) setUser(res.data.user); }
    return res;
  }
  // 2026-10-30 : fautes de frappe courantes dans le domaine (« gmial.com », « hotmail.fe », « laposte.fr »…).
  // Renvoie l'adresse corrigée proposée, ou "" s'il n'y a rien à proposer. Jamais bloquant.
  var LX_DOMAINES = ["gmail.com","hotmail.fr","hotmail.com","outlook.fr","outlook.com","live.fr","live.com","msn.com","yahoo.fr","yahoo.com","icloud.com","me.com","laposte.net","orange.fr","wanadoo.fr","free.fr","sfr.fr","neuf.fr","bbox.fr","aliceadsl.fr","numericable.fr","gmx.fr","gmx.de","gmx.net","web.de","t-online.de","aol.com","protonmail.com","proton.me"];
  var LX_FAUTES = { "laposte.fr": "laposte.net", "lapost.net": "laposte.net", "gmail.fr": "gmail.com", "gmal.com": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmai.com": "gmail.com", "gnail.com": "gmail.com", "hotmial.fr": "hotmail.fr", "hotmal.fr": "hotmail.fr", "hotmail.fe": "hotmail.fr", "hotmial.com": "hotmail.com", "outlok.fr": "outlook.fr", "outlok.com": "outlook.com", "yahooo.fr": "yahoo.fr", "yaho.fr": "yahoo.fr", "orange.fe": "orange.fr", "free.fe": "free.fr", "sfr.fe": "sfr.fr", "icloud.co": "icloud.com", "icloud.fr": "icloud.com", "wanado.fr": "wanadoo.fr", "wanadoo.com": "wanadoo.fr" };
  function lxDistance(a, b){
    if (Math.abs(a.length - b.length) > 2) return 9;
    var d = []; for (var i = 0; i <= a.length; i++){ d[i] = [i]; } for (var j = 1; j <= b.length; j++) d[0][j] = j;
    for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++){
      d[i][j] = Math.min(d[i-1][j] + 1, d[i][j-1] + 1, d[i-1][j-1] + (a[i-1] === b[j-1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i-1] === b[j-2] && a[i-2] === b[j-1]) d[i][j] = Math.min(d[i][j], d[i-2][j-2] + 1); // lettres inversées
    }
    return d[a.length][b.length];
  }
  function lxSuggererEmail(email){
    var e = String(email || "").trim().toLowerCase();
    var m = /^([^\s@]+)@([^\s@]+)$/.exec(e); if (!m) return "";
    var loc = m[1], dom = m[2].replace(/\.+$/, "");
    if (LX_DOMAINES.indexOf(dom) >= 0) return "";
    if (LX_FAUTES[dom]) return loc + "@" + LX_FAUTES[dom];
    var dom2 = dom.replace(/\.(con|cmo|ocm|vom|comm|co)$/, ".com").replace(/\.(fe|frr|ft|rf|fr\.)$/, ".fr");
    if (dom2 !== dom && LX_DOMAINES.indexOf(dom2) >= 0) return loc + "@" + dom2;
    var mieux = "", best = 9;
    for (var k = 0; k < LX_DOMAINES.length; k++){ var dd = lxDistance(dom2, LX_DOMAINES[k]); if (dd < best){ best = dd; mieux = LX_DOMAINES[k]; } }
    // 1 faute (ou 2 sur un nom long) sur un domaine connu ; jamais sur un domaine d'entreprise très différent
    if (mieux && (best === 1 || (best === 2 && dom2.length >= 9))) return loc + "@" + mieux;
    return "";
  }
  // Branche la suggestion sous un champ e-mail : « Vouliez-vous dire … ? » (cliquable) + rappel de l'adresse saisie.
  function lxBrancherSuggestionEmail(input, opts){
    if (!input || input._lxSugg) return; input._lxSugg = true; opts = opts || {};
    var box = document.createElement("div");
    box.className = "lx-email-sugg"; box.setAttribute("aria-live", "polite");
    box.style.cssText = "font-size:12.5px;line-height:1.45;margin-top:6px;display:none";
    input.insertAdjacentElement("afterend", box);
    function maj(){
      var v = String(input.value || "").trim(), sg = lxSuggererEmail(v);
      box.innerHTML = ""; box.style.display = "none";
      if (!v || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return;
      box.style.display = "block";
      if (sg){
        var t = document.createElement("span"); t.style.color = "#fbbf24"; t.textContent = "Vouliez-vous dire ";
        var a = document.createElement("a"); a.href = "#"; a.style.cssText = "color:#e6c066;font-weight:800;text-decoration:underline"; a.textContent = sg;
        a.onclick = function(ev){ ev.preventDefault(); input.value = sg; try { input.dispatchEvent(new Event("input", { bubbles: true })); } catch(_){} maj(); input.focus(); };
        box.appendChild(t); box.appendChild(a); box.appendChild(document.createTextNode(" ?"));
      } else if (opts.rappel !== false){
        var r = document.createElement("span"); r.style.color = "rgba(255,255,255,.55)";
        r.textContent = opts.texte || "Le lien de confirmation sera envoyé à : "; var b = document.createElement("b"); b.style.color = "rgba(255,255,255,.85)"; b.textContent = v;
        r.appendChild(b); box.appendChild(r);
      }
    }
    input.addEventListener("input", maj); input.addEventListener("blur", maj); maj();
  }
  // Branchement automatique : tout champ <input data-lx-sugg="..."> reçoit la suggestion dès qu'on y entre
  // (valeur « 1 » = texte de rappel par défaut, « 0 » = pas de rappel, autre = texte de rappel).
  try { document.addEventListener("focusin", function(ev){ var t = ev.target; if (t && t.tagName === "INPUT" && t.hasAttribute("data-lx-sugg")){ var v = t.getAttribute("data-lx-sugg"); lxBrancherSuggestionEmail(t, v === "0" ? { rappel: false } : (v && v !== "1" ? { texte: v } : {})); } }, true); } catch(_){}
  // 2026-10-14 : déconnecter tous les AUTRES appareils (cet appareil reçoit un nouveau jeton)
  async function lxLogoutAll(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", { session_token: token, action: "logout_all" });
    if (res.ok && res.data && res.data.session_token) setToken(res.data.session_token);
    return res;
  }

  // Expose globalement
  window.LX = {
    verifyEmail: lxVerifyEmail,
    changeEmail: lxChangeEmail,
    suggererEmail: lxSuggererEmail,
    brancherSuggestionEmail: lxBrancherSuggestionEmail,
    sendVerification: lxSendVerification,
    logoutAll: lxLogoutAll,
    requestReset: lxRequestReset,
    confirmReset: lxConfirmReset,
    signup: lxSignup,
    login: lxLogin,
    get: lxGet,
    update: lxUpdate,
    changePassword: lxChangePassword,
    delete: lxDelete,
    toggleNotif: lxToggleNotif,
    removePayment: lxRemovePayment,
    logout: lxLogout,
    ouvrirSession: ouvrirSession,
    hasSession: lxHasSession,
    getUser: getUser,
    getToken: getToken,
    checkPasswordLeaked: lxCheckPasswordLeaked
  };
})();
