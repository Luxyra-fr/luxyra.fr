// 31/10/2026 (lot D) : script de la page de renvoi des applis Play, sorti de admin-twa.html (CSP stricte, aucun script inline).
(function(){
  var q=new URLSearchParams(location.search), pkg=q.get("pkg")||"fr.luxyra.pro", dest=q.get("dest")||"/admin";
  if(!/^\/admin(\.html)?([?#/].*)?$/.test(dest)) dest="/admin";
  var client=pkg==="fr.luxyra.client", retour=client?"/client.html?source=app":"/app.html?source=play";
  document.getElementById("app").textContent=client?"Luxyra":"Luxyra Pro";
  // les liens de retour sont sur luxyra.fr (l'application), pas sur admin.luxyra.fr
  var base=(location.hostname==="admin.luxyra.fr")?"https://luxyra.fr":"";
  document.getElementById("retour").href=base+retour;
  var url="https://admin.luxyra.fr"+dest.replace(/^\/admin(\.html)?\/?/,"/"); // 31/10 : admin sur son sous-domaine
  var intent="intent://admin.luxyra.fr"+dest.replace(/^\/admin(\.html)?\/?/,"/").replace(/#.*$/,"")+"#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url="+encodeURIComponent(url)+";end";
  var b=document.getElementById("chrome"); b.href=intent;
  b.addEventListener("click",function(){ setTimeout(function(){ location.replace(base+retour); },1500); });
})();
