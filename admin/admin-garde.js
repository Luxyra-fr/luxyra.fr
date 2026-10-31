// Gardes de l'administration (déplacées depuis admin.html le 31/10/2026, lot B : aucune exécution de script inline).
// Chargé en premier dans <head>, de façon synchrone.
// 2026-10-31 (audit sécurité M5) : l'administration ne fonctionne QUE sur https://admin.luxyra.fr (en-têtes de sécurité,
// cookies/stockage isolés). Toute autre adresse (copie GitHub Pages luxyra-fr.github.io, ancien luxyra.fr/admin…) -> redirection,
// et aucun script de l'admin ne s'exécute. localhost / 127.0.0.1 gardés pour les tests.
(function(){ var h=location.hostname; if(h!=="admin.luxyra.fr" && h!=="localhost" && h!=="127.0.0.1"){ try{ location.replace("https://admin.luxyra.fr/"+location.search+location.hash); }catch(_e){} document.documentElement.innerHTML=""; throw new Error("admin : adresse non autorisée"); } })();
// 2026-10-31 : l'administration ne s'ouvre JAMAIS dans les applis Play (Luxyra Pro fr.luxyra.pro / Luxyra fr.luxyra.client).
// Android confie les notifications de luxyra.fr à l'appli vérifiée (délégation TWA) : toucher une notification admin ouvrait
// /admin DANS Luxyra Pro, et relancer l'appli reprenait l'admin. Ici : détection de l'appli -> page qui renvoie vers Chrome,
// et aucune inscription aux notifications depuis l'appli (aucun script de l'admin ne s'exécute).
(function(){try{
  var ref=String(document.referrer||""), ss=window.sessionStorage, qs=location.search||"";
  var pkg=(ref.match(/^android-app:\/\/(fr\.luxyra\.(?:pro|client))/i)||[])[1]||"";
  if(pkg){ try{ ss.setItem("lx_twa_pkg",pkg); }catch(_){} }
  if(!pkg){ try{ pkg=ss.getItem("lx_twa_pkg")||(ss.getItem("lx_play")==="1"?"fr.luxyra.pro":""); }catch(_){} }
  if(!pkg && /[?&]source=(play|app)\b/.test(qs)) pkg="fr.luxyra.pro";
  if(pkg && /chrome/i.test(navigator.userAgent) && /android/i.test(navigator.userAgent)){
    location.replace("/admin-twa.html?pkg="+encodeURIComponent(pkg)+"&dest="+encodeURIComponent(location.pathname+location.search+location.hash));
    document.write('<style>body{background:#06080f}</style>'); throw "lx-twa";
  }
}catch(e){ if(e==="lx-twa") throw e; }})();
