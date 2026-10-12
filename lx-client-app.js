/* lx-client-app.js — 2026-10-11 : mode « application » pour les clients (Play Store / écran d'accueil).
   - détecte l'ouverture depuis l'application (TWA Android, PWA installée, ?source=app)
   - ajoute la barre d'onglets en bas : Accueil · Trouver · Mes RDV
   - mémorise les établissements consultés (« récemment consultés »)
   - aucun service worker (celui de l'espace pro occupe déjà la portée « / ») */
(function(){
  try{
    var p=new URLSearchParams(location.search);
    var app = p.get("source")==="app" || (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || String(document.referrer||"").indexOf("android-app://")===0;
    if(app) sessionStorage.setItem("lx_app","1");
    window.LX_APP_CLIENT = app || sessionStorage.getItem("lx_app")==="1";
  }catch(e){ window.LX_APP_CLIENT=false; }
  // Pas de service worker ici : la racine "/" est déjà réservée au service worker de l'espace pro (sw.js).
  // établissements récemment consultés (appelé par site.html une fois le salon chargé)
  window.lxClientRecent=function(o){
    try{
      if(!o||!o.slug) return;
      var r=JSON.parse(localStorage.getItem("lx_recents")||"[]").filter(function(x){ return x.slug!==o.slug; });
      r.unshift({slug:o.slug, nom:o.nom||o.slug, ville:o.ville||"", t:Date.now()});
      localStorage.setItem("lx_recents", JSON.stringify(r.slice(0,8)));
    }catch(e){}
  };
  if(window.LX_SALON_PAGE) window.lxClientRecent(window.LX_SALON_PAGE);
  if(!window.LX_APP_CLIENT) return;
  function barre(){
    if(document.getElementById("lxAppNav")) return;
    var path=location.pathname;
    var onglets=[
      {u:"/client.html", l:"Accueil", i:"🏠", on:path.indexOf("/client")===0},
      {u:"/recherche.html", l:"Trouver un pro", i:"🔍", on:path.indexOf("/recherche")===0},
      {u:"/compte.html", l:"Mes RDV", i:"📅", on:path.indexOf("/compte")===0}
    ];
    var nav=document.createElement("nav"); nav.id="lxAppNav";
    nav.style.cssText="position:fixed;left:0;right:0;bottom:0;z-index:150;display:flex;background:#0b0b0b;border-top:1px solid rgba(200,168,78,.35);padding:6px 4px calc(6px + env(safe-area-inset-bottom));font-family:-apple-system,'Segoe UI',Arial,sans-serif";
    nav.innerHTML=onglets.map(function(o){ return '<a href="'+o.u+'" style="flex:1;text-align:center;text-decoration:none;color:'+(o.on?'#d4a843':'#a8a29a')+';font-size:11px;font-weight:'+(o.on?'700':'500')+';padding:4px 0"><div style="font-size:21px;line-height:1.1">'+o.i+'</div>'+o.l+'</a>'; }).join("");
    document.body.appendChild(nav);
    document.body.style.paddingBottom="64px";
    document.body.classList.add("lx-app");
    var st=document.createElement("style");
    st.textContent="body.lx-app .cart-float,body.lx-app .toggle-view{bottom:84px!important}";
    document.head.appendChild(st);
  }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", barre); else barre();
})();
