/* lx-play-banner.js — 2026-10-16 : application clients Luxyra sur Google Play (fr.luxyra.client).
   Inclus (defer) par index.html, recherche.html, site.html, compte.html, aide.html.
   1. Détecte l'ouverture DANS l'application (TWA Android / écran d'accueil) :
        ?source=app (start_url et raccourcis de manifest-client.json), referrer android-app://fr.luxyra.client,
        sessionStorage lx_app (posé par lx-client-app.js), display-mode standalone/fullscreen/minimal-ui,
        navigator.standalone (iOS).
      -> classe html.lx-in-app : les blocs .lxgp-hide-app (badges Google Play des pages) sont masqués.
   2. Petit bandeau « Luxyra – l'application » en bas d'écran, UNIQUEMENT sur un navigateur Android
      (jamais dans l'appli, jamais sur iPhone/iPad, jamais sur ordinateur), ni si l'appli est déjà
      installée (getInstalledRelatedApps, related_applications de manifest-client.json).
      Fermeture (✕) ou clic « Installer » mémorisés 30 jours (localStorage lx_play_bandeau). */
(function(){
  var PKG = "fr.luxyra.client";
  var CLE = "lx_play_bandeau";
  var DUREE = 30 * 24 * 3600 * 1000;

  function enApp(){
    try{
      if(window.LX_APP_CLIENT === true) return true;
      if(/[?&]source=(app|pwa|twa)(&|$)/.test(location.search)) return true;
      if(String(document.referrer || "").indexOf("android-app://") === 0) return true;
      try{ if(sessionStorage.getItem("lx_app") === "1") return true; }catch(e){}
      if(window.navigator.standalone === true) return true;
      if(window.matchMedia){
        if(matchMedia("(display-mode: standalone)").matches) return true;
        if(matchMedia("(display-mode: fullscreen)").matches) return true;
        if(matchMedia("(display-mode: minimal-ui)").matches) return true;
      }
    }catch(e){}
    return false;
  }
  var APP = enApp();
  window.LX_EN_APP = APP;

  // Masquage des badges Google Play dans l'application
  try{
    var st = document.createElement("style");
    st.textContent = "html.lx-in-app .lxgp-hide-app{display:none!important}"
      + "@media (display-mode: standalone){.lxgp-hide-app{display:none!important}}";
    (document.head || document.documentElement).appendChild(st);
    if(APP) document.documentElement.classList.add("lx-in-app");
  }catch(e){}
  if(APP) return;

  // Android uniquement (pas iPhone/iPad, pas ordinateur)
  var ua = navigator.userAgent || "";
  var android = /Android/i.test(ua) && !/iPhone|iPad|iPod/i.test(ua);
  try{ if(!android && navigator.userAgentData && navigator.userAgentData.platform === "Android") android = true; }catch(e){}
  if(!android) return;

  try{
    var t = parseInt(localStorage.getItem(CLE) || "0", 10);
    if(t && (Date.now() - t) < DUREE) return;
  }catch(e){}

  function memoriser(){ try{ localStorage.setItem(CLE, String(Date.now())); }catch(e){} }

  function lien(){
    var ref = "utm_source=site&utm_medium=bandeau";
    try{
      var slug = window.LX_SALON_PAGE && window.LX_SALON_PAGE.slug;
      if(slug) ref += "&utm_campaign=" + String(slug).replace(/[^a-z0-9_-]/gi, "").slice(0, 60);
    }catch(e){}
    return "https://play.google.com/store/apps/details?id=" + PKG + "&referrer=" + encodeURIComponent(ref);
  }

  function afficher(){
    if(document.getElementById("lxPlayBandeau") || !document.body) return;
    var css = document.createElement("style");
    css.textContent =
      "#lxPlayBandeau{position:fixed;left:10px;right:10px;bottom:calc(10px + env(safe-area-inset-bottom));z-index:9998;max-width:520px;margin:0 auto;"
      + "display:flex;align-items:center;gap:11px;padding:10px 10px 10px 12px;background:#0d0c0a;border:1px solid rgba(200,168,78,.55);border-radius:16px;"
      + "box-shadow:0 10px 32px rgba(0,0,0,.65);color:#f5f0e8;font:14px/1.3 'DM Sans',-apple-system,'Segoe UI',Roboto,Arial,sans-serif;"
      + "transform:translateY(140%);transition:transform .45s cubic-bezier(.2,.8,.2,1)}"
      + "#lxPlayBandeau.on{transform:none}"
      + "#lxPlayBandeau img{width:44px;height:44px;border-radius:11px;flex:none;border:1px solid rgba(200,168,78,.35)}"
      + "#lxPlayBandeau .t{flex:1;min-width:0}"
      + "#lxPlayBandeau b{display:block;color:#c8a84e;font-size:14.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}"
      + "#lxPlayBandeau span{display:block;color:#bdb6aa;font-size:12.5px;margin-top:2px}"
      + "#lxPlayBandeau a{flex:none;background:linear-gradient(135deg,#d4b45c,#b8960f);color:#111;font-weight:800;font-size:13.5px;text-decoration:none;padding:10px 15px;border-radius:11px;letter-spacing:.2px}"
      + "#lxPlayBandeau button{flex:none;background:none;border:0;color:#8f887d;font-size:20px;line-height:1;padding:6px 4px 6px 2px;cursor:pointer}"
      + "body.lxgp-on .toggle-view,body.lxgp-on .cart-float{bottom:96px!important}";
    document.head.appendChild(css);

    var d = document.createElement("div");
    d.id = "lxPlayBandeau";
    d.setAttribute("role", "dialog");
    d.setAttribute("aria-label", "Application Luxyra sur Google Play");
    d.innerHTML = '<img src="/icon-192.png" alt="">'
      + '<div class="t"><b>Luxyra – l’application</b><span>Réservez plus vite, gratuit sur Google Play</span></div>'
      + '<a href="' + lien() + '" target="_blank" rel="noopener">Installer</a>'
      + '<button type="button" aria-label="Fermer">✕</button>';
    function fermer(){
      memoriser();
      d.classList.remove("on");
      document.body.classList.remove("lxgp-on");
      setTimeout(function(){ if(d.parentNode) d.parentNode.removeChild(d); }, 500);
    }
    d.querySelector("button").onclick = fermer;
    d.querySelector("a").addEventListener("click", function(){
      try{ this.href = lien(); }catch(e){}
      memoriser();
      setTimeout(fermer, 300);
    });
    document.body.appendChild(d);
    document.body.classList.add("lxgp-on");
    setTimeout(function(){ d.classList.add("on"); }, 30);
  }

  function lancer(){
    setTimeout(function(){
      if(enApp()) return; // lx-client-app.js a pu poser lx_app entre-temps
      try{
        if(navigator.getInstalledRelatedApps){
          navigator.getInstalledRelatedApps().then(function(apps){
            var deja = (apps || []).some(function(a){ return a && a.id === PKG; });
            if(!deja) afficher();
          }).catch(afficher);
          return;
        }
      }catch(e){}
      afficher();
    }, 1800);
  }
  if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", lancer); else lancer();
})();
