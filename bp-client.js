// ============================================================================
// bp-client.js — Client helper pour les edge functions BeautyPro
// ============================================================================
// Remplace les accès directs à la table clients_beautypro par des appels
// aux edge functions bp-signup / bp-login / bp-profile.
//
// Stockage session :
//   - localStorage["lx_bp_token"] : session_token JWT HS256 (30 jours)
//   - localStorage["lx_account"]  : objet user (SANS password_hash)
// ============================================================================

(function(){
  var BP_API = "https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1";
  var BP_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI";

  function getToken(){
    try { return localStorage.getItem("lx_bp_token") || ""; } catch(e){ return ""; }
  }
  function setToken(t){
    try { if(t) localStorage.setItem("lx_bp_token", t); else localStorage.removeItem("lx_bp_token"); } catch(e){}
  }
  function setUser(u){
    try { if(u) localStorage.setItem("lx_account", JSON.stringify(u)); else localStorage.removeItem("lx_account"); } catch(e){}
  }
  function getUser(){
    try { var d = localStorage.getItem("lx_account"); return d ? JSON.parse(d) : null; } catch(e){ return null; }
  }

  async function call(endpoint, body){
    try {
      var r = await fetch(BP_API + "/" + endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": BP_ANON,
          "Authorization": "Bearer " + BP_ANON
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

  async function bpSignup(fields){
    // fields : { email, password, nom, prenom, telephone?, date_naissance?, genre?, sms_ok?, email_ok? }
    var res = await call("bp-signup", fields);
    if (res.ok && res.data && res.data.session_token) {
      setToken(res.data.session_token);
      setUser(res.data.user);
    }
    return res;
  }

  async function bpLogin(email, password){
    var res = await call("bp-login", { email: email, password: password });
    if (res.ok && res.data && res.data.session_token) {
      setToken(res.data.session_token);
      setUser(res.data.user);
    }
    return res;
  }

  async function bpGet(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("bp-profile", { session_token: token, action: "get" });
    if (res.ok && res.data && res.data.user) setUser(res.data.user);
    else if (res.status === 401) { setToken(""); setUser(null); }
    return res;
  }

  async function bpUpdate(patch){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var body = Object.assign({ session_token: token, action: "update" }, patch || {});
    var res = await call("bp-profile", body);
    if (res.ok && res.data && res.data.user) setUser(res.data.user);
    return res;
  }

  async function bpChangePassword(oldPass, newPass){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    return await call("bp-profile", {
      session_token: token, action: "change_password",
      old_password: oldPass, new_password: newPass
    });
  }

  async function bpDelete(password){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("bp-profile", {
      session_token: token, action: "delete",
      password: password || ""
    });
    if (res.ok) { setToken(""); setUser(null); }
    return res;
  }

  async function bpToggleNotif(field, value){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("bp-profile", {
      session_token: token, action: "toggle_notif",
      field: field, value: value
    });
    if (res.ok) {
      var u = getUser();
      if (u) { u[field] = value; setUser(u); }
    }
    return res;
  }

  async function bpRemovePayment(){
    var token = getToken();
    if (!token) return { ok: false, status: 401, data: { error: "Pas de session" } };
    var res = await call("bp-profile", { session_token: token, action: "remove_payment" });
    if (res.ok) {
      var u = getUser();
      if (u) { u.stripe_pm = null; u.card_last4 = null; u.card_exp = null; setUser(u); }
    }
    return res;
  }

  function bpLogout(){
    setToken("");
    setUser(null);
  }

  function bpHasSession(){
    return !!getToken();
  }

  // Expose globalement
  window.BP = {
    signup: bpSignup,
    login: bpLogin,
    get: bpGet,
    update: bpUpdate,
    changePassword: bpChangePassword,
    delete: bpDelete,
    toggleNotif: bpToggleNotif,
    removePayment: bpRemovePayment,
    logout: bpLogout,
    hasSession: bpHasSession,
    getUser: getUser,
    getToken: getToken
  };
})();
