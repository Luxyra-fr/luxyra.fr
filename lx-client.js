// ============================================================================
// lx-client.js — Client helper pour les edge functions Luxyra
// ============================================================================
// Wrapper autour des edge functions lx-signup / lx-login / lx-profile pour
// l'authentification cliente Luxyra (compte cliente unique cross-salons).
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
  function getUser(){
    try { var d = localStorage.getItem("lx_account"); return d ? JSON.parse(d) : null; } catch(e){ return null; }
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
    if (res.ok && res.data && res.data.session_token) {
      setToken(res.data.session_token);
      setUser(res.data.user);
    }
    return res;
  }

  async function lxLogin(email, password){
    var res = await call("lx-login", { email: email, password: password });
    if (res.ok && res.data && res.data.session_token) {
      setToken(res.data.session_token);
      setUser(res.data.user);
    }
    return res;
  }

  async function lxGet(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", { session_token: token, action: "get" });
    if (res.ok && res.data && res.data.user) setUser(res.data.user);
    else if (res.status === 401) { setToken(""); setUser(null); }
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
    return await call("lx-profile", {
      session_token: token, action: "change_password",
      old_password: oldPass, new_password: newPass
    });
  }

  async function lxDelete(password){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("lx-profile", {
      session_token: token, action: "delete",
      password: password || ""
    });
    if (res.ok) { setToken(""); setUser(null); }
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

  // Expose globalement
  window.LX = {
    signup: lxSignup,
    login: lxLogin,
    get: lxGet,
    update: lxUpdate,
    changePassword: lxChangePassword,
    delete: lxDelete,
    toggleNotif: lxToggleNotif,
    removePayment: lxRemovePayment,
    logout: lxLogout,
    hasSession: lxHasSession,
    getUser: getUser,
    getToken: getToken,
    checkPasswordLeaked: lxCheckPasswordLeaked
  };
})();
