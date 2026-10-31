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

  // 2026-10-31 : inscription en 2 temps. 1) le serveur envoie un CODE À 6 CHIFFRES par e-mail (HTTP 428 code_requis) ;
  // 2) la fenêtre ci-dessous le fait saisir puis rappelle lx-signup avec { code } -> compte créé déjà confirmé.
  // La fenêtre est commune à toutes les pages qui inscrivent un client (compte.html, site.html…).
  // Annulation : { ok:false, status:499, data:{ error, annule:true } }.
  async function lxSignup(fields){
    var res = await call("lx-signup", fields);
    // 31/10 (B1) : la fenêtre s'ouvre aussi sur 429 + code_requis (trop de demandes : le dernier code reçu reste valable)
    if ((res.status === 428 || res.status === 429) && res.data && res.data.code_requis && typeof document !== "undefined") res = await saisirCode(fields, res.data, res.status);
    if (res.ok && res.data && res.data.session_token) ouvrirSession(res.data.session_token, res.data.user); // 2026-10-14 audit
    return res;
  }
  function escH(t){ return String(t == null ? "" : t).replace(/[&<>"']/g, function(c){ return { "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]; }); }
  function saisirCode(fields, info, statut){
    return new Promise(function(resolve){
      var old = document.getElementById("lxCodeBg"); if (old) old.remove();
      var bg = document.createElement("div"); bg.id = "lxCodeBg";
      bg.setAttribute("style", "position:fixed;inset:0;z-index:2147483000;background:rgba(10,10,12,.72);display:flex;align-items:center;justify-content:center;padding:16px;font-family:-apple-system,'Segoe UI',Arial,sans-serif");
      bg.innerHTML = '<div role="dialog" aria-modal="true" aria-labelledby="lxCodeT" style="width:100%;max-width:400px;background:#fff;color:#1a1a1a;border-radius:18px;padding:26px 22px 20px;box-shadow:0 18px 50px rgba(0,0,0,.35);text-align:center;border-top:4px solid #c8a84e">'
        + '<div id="lxCodeT" style="font-family:Georgia,\'Times New Roman\',serif;font-size:21px;margin-bottom:8px">Vérifiez votre e-mail</div>'
        + '<div style="font-size:14px;line-height:1.55;color:#444">Nous avons envoyé un code à 6 chiffres à<br><b style="color:#111;word-break:break-all">' + escH(fields.email) + '</b></div>'
        + '<input id="lxCodeIn" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]*" maxlength="6" aria-label="Code à 6 chiffres" placeholder="••••••" style="display:block;width:100%;box-sizing:border-box;margin:18px 0 6px;padding:14px 10px;font-size:30px;letter-spacing:12px;text-align:center;border:1.5px solid #d9cfb4;border-radius:12px;outline:none;font-family:Georgia,serif;color:#111;background:#fdfbf6">'
        + '<div id="lxCodeMsg" role="alert" style="min-height:20px;font-size:13px;color:#b3261e;margin:4px 0 8px"></div>'
        + '<button id="lxCodeOk" type="button" style="width:100%;padding:14px;border:none;border-radius:30px;background:linear-gradient(135deg,#d4a843,#b8960f);color:#111;font-weight:800;font-size:15px;cursor:pointer">Valider et créer mon compte</button>'
        + '<div style="font-size:12.5px;color:#777;margin-top:12px;line-height:1.5">Valable 15 minutes. Pensez à regarder vos courriers indésirables.</div>'
        + '<div style="display:flex;justify-content:space-between;gap:10px;margin-top:12px;font-size:13px">'
        +   '<button id="lxCodeRe" type="button" disabled style="background:none;border:none;color:#9a7b2c;font-weight:700;cursor:pointer;padding:6px 0">Renvoyer le code</button>'
        +   '<button id="lxCodeX" type="button" style="background:none;border:none;color:#666;text-decoration:underline;cursor:pointer;padding:6px 0">Modifier l\u2019adresse</button>'
        + '</div></div>';
      document.body.appendChild(bg);
      var inp = document.getElementById("lxCodeIn"), msg = document.getElementById("lxCodeMsg"), bOk = document.getElementById("lxCodeOk"), bRe = document.getElementById("lxCodeRe"), bX = document.getElementById("lxCodeX");
      var fini = false, minuteur = null, occupe = false;
      function fin(r){ if (fini) return; fini = true; if (minuteur) clearInterval(minuteur); try { bg.remove(); } catch(_){} resolve(r); }
      function attendre(sec){
        var n = Math.max(1, Number(sec) || 60); bRe.disabled = true; bRe.style.color = "#aaa";
        if (minuteur) clearInterval(minuteur);
        bRe.textContent = "Renvoyer le code (" + n + " s)";
        minuteur = setInterval(function(){ n--; if (n <= 0) { clearInterval(minuteur); minuteur = null; bRe.disabled = false; bRe.style.color = "#9a7b2c"; bRe.textContent = "Renvoyer le code"; } else bRe.textContent = "Renvoyer le code (" + n + " s)"; }, 1000);
      }
      attendre(info && (info.attente_s || info.renvoi_s) || 60);
      if (statut === 429 && info && info.error) { msg.style.color = "#444"; msg.textContent = info.error; }
      inp.addEventListener("input", function(){ var v = inp.value.replace(/\D/g, "").slice(0, 6); if (v !== inp.value) inp.value = v; msg.textContent = ""; if (v.length === 6) valider(); });
      inp.addEventListener("keydown", function(e){ if (e.key === "Enter") valider(); });
      setTimeout(function(){ try { inp.focus(); } catch(_){} }, 50);
      async function valider(){
        if (occupe) return; var c = inp.value.replace(/\D/g, "");
        if (c.length !== 6) { msg.textContent = "Saisissez les 6 chiffres reçus par e-mail."; return; }
        occupe = true; bOk.disabled = true; bOk.textContent = "Vérification…";
        var r = await call("lx-signup", Object.assign({}, fields, { code: c }));
        occupe = false; bOk.disabled = false; bOk.textContent = "Valider et créer mon compte";
        if (r.ok && r.data && r.data.session_token) { fin(r); return; }
        var d = r.data || {};
        if (r.status === 409 || r.status === 0 || r.status >= 500) { fin(r); return; } // compte existant / réseau : la page affiche le message
        msg.textContent = d.error || "Code incorrect.";
        if (d.code_expire) { inp.value = ""; bRe.disabled = false; bRe.style.color = "#9a7b2c"; bRe.textContent = "Renvoyer le code"; if (minuteur) { clearInterval(minuteur); minuteur = null; } }
        else { try { inp.select(); } catch(_){} }
      }
      bOk.onclick = valider;
      bRe.onclick = async function(){
        if (bRe.disabled) return; bRe.disabled = true; msg.style.color = "#444"; msg.textContent = "Envoi d\u2019un nouveau code…";
        var r = await call("lx-signup", fields); var d = r.data || {};
        if (r.status === 428) { msg.style.color = "#2e7d32"; msg.textContent = "Nouveau code envoyé."; inp.value = ""; attendre(d.renvoi_s || 60); }
        else { msg.style.color = "#b3261e"; msg.textContent = d.error || "Envoi impossible."; if (d.attente_s) attendre(d.attente_s); else { bRe.disabled = false; } }
        setTimeout(function(){ msg.style.color = "#b3261e"; }, 4000);
      };
      bX.onclick = function(){ fin({ ok: false, status: 499, data: { error: "Inscription non terminée : vérifiez votre adresse e-mail puis recommencez.", annule: true } }); };
    });
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
  // 2026-10-31 (contre-audit 3, M1) : le serveur exige d'être connecté à CE compte (jeton de session envoyé s'il existe)
  // ou le mot de passe du compte ; réponse 403 besoin_mot_de_passe sinon. En cas de succès, le serveur renvoie un nouveau
  // jeton (les autres appareils sont déconnectés) : la session de cet appareil est ouverte sur le compte confirmé.
  async function lxVerifyEmail(verifToken, password){
    var body = { action: "verify_email", token: verifToken };
    var tk = getToken(); if (tk) body.session_token = tk;
    if (password) body.password = password;
    var res = await call("lx-profile", body);
    if (res.ok && res.data && res.data.session_token) { ouvrirSession(res.data.session_token, res.data.user || null); return res; }
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
  var LX_DOMAINES = ["gmail.com","hotmail.fr","hotmail.com","outlook.fr","outlook.com","live.fr","live.com","msn.com","yahoo.fr","yahoo.com","icloud.com","me.com","laposte.net","orange.fr","wanadoo.fr","free.fr","sfr.fr","neuf.fr","bbox.fr","aliceadsl.fr","numericable.fr","gmx.fr","gmx.de","gmx.net","web.de","t-online.de","aol.com","protonmail.com","proton.me","mail.com","mail.de","posteo.de","freenet.de","arcor.de","online.de","bluewin.ch","skynet.be","telenet.be","pt.lu","tutanota.com"];
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
    // même fournisseur, autre pays (hotmail.be, yahoo.de, outlook.lu…) : domaine réel, on ne propose rien
    var base = dom2.replace(/\.[a-z]{2}$/, "");
    if (base !== dom2) for (var q = 0; q < LX_DOMAINES.length; q++){ if (LX_DOMAINES[q].replace(/\.[a-z]+$/, "") === base) return ""; }
    // faute dans le nom du fournisseur, pays conservé (hotmal.be -> hotmail.be)
    if (base !== dom2 && base.length >= 4) for (var w = 0; w < LX_DOMAINES.length; w++){ var kb = LX_DOMAINES[w].replace(/\.[a-z]+$/, ""); if (kb.length >= 4 && lxDistance(base, kb) === 1) return loc + "@" + kb + dom2.slice(base.length); }
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
        r.textContent = opts.texte || "Le code sera envoyé à : "; /* 31/10 : inscription par code (la correction d'adresse précise « lien ») */ var b = document.createElement("b"); b.style.color = "rgba(255,255,255,.85)"; b.textContent = v;
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
