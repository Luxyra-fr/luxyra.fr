/* Bandeau promotionnel date, en haut de la page publique d'un etablissement (site.html).
   Actif pour les etablissements listes dans LX_BP, entre "debut" et "fin" (heure de Paris fixee en dur).
   La page n'est pas modifiee : le bandeau s'ajoute seulement tout en haut, puis disparait seul a la date de fin.
   ?apercu=promo force l'affichage (verification avant la date). */
(function () {
  "use strict";
  var LX_BP = {
    "excellence-coiffure": {
      debut: "2026-11-23T00:00:00+01:00",
      fin: "2026-12-01T00:00:00+01:00",
      titre1: "BLACK", titre2: "Friday",
      remise: "−20 %",
      texte: "sur tous les produits et toutes les techniques",
      dates: "Jusqu’au lundi 30 novembre",
      tel: "0387092196", telAffiche: "03 87 09 21 96"
    }
  };
  var slug = "";
  try { slug = String(window.__SALON_SLUG || new URLSearchParams(location.search).get("slug") || location.pathname.split("/")[1] || "").toLowerCase(); } catch (e) {}
  var C = LX_BP[slug];
  if (!C) return;
  var APERCU = /[?&]apercu=promo(&|$)/.test(location.search);
  var T1 = Date.parse(C.debut), T2 = Date.parse(C.fin);
  function actif() { var t = Date.now(); return APERCU || (t >= T1 && t < T2); }
  if (!actif()) return;

  var css = document.createElement("style");
  css.textContent =
    "#lxBP{position:relative;overflow:hidden;background:radial-gradient(120% 220% at 50% 0%,#2a2110 0%,#0b0906 55%,#050505 100%);border-bottom:1px solid rgba(212,175,55,.55);color:#fff;font-family:Inter,Nunito,-apple-system,'Segoe UI',sans-serif;padding:14px 16px 15px;text-align:center}" +
    "#lxBP:before{content:'';position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,rgba(255,224,140,.14) 48%,transparent 62%);transform:translateX(-100%);animation:lxBPs 5.5s ease-in-out infinite}" +
    "@keyframes lxBPs{0%,55%{transform:translateX(-100%)}100%{transform:translateX(100%)}}" +
    "@media(prefers-reduced-motion:reduce){#lxBP:before{animation:none;display:none}}" +
    "#lxBP .in{position:relative;max-width:1000px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:8px}" +
    "#lxBP .t{line-height:1;white-space:nowrap}" +
    "#lxBP .t b{font-family:'Playfair Display',Georgia,serif;font-weight:800;font-size:26px;letter-spacing:.08em;color:#fff}" +
    "#lxBP .t i{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif;font-style:italic;font-weight:600;font-size:34px;margin-left:6px;background:linear-gradient(180deg,#fff3c4,#e2bd55 55%,#a8821f);-webkit-background-clip:text;background-clip:text;color:transparent}" +
    "#lxBP .r{font-family:'Playfair Display',Georgia,serif;font-weight:800;font-size:34px;line-height:1;background:linear-gradient(180deg,#fff3c4,#e2bd55 55%,#a8821f);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}" +
    "#lxBP .x{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:600;font-size:20px;line-height:1.2;color:#fff}" +
    "#lxBP .d{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#f1cf6a;margin-top:2px}" +
    "#lxBP .a{display:inline-block;background:linear-gradient(180deg,#f6dc88,#c9a03a);color:#0a0a0a;font-weight:800;font-size:13px;letter-spacing:.04em;text-decoration:none;padding:10px 20px;border-radius:999px;white-space:nowrap;box-shadow:0 8px 20px -10px rgba(212,175,55,.9)}" +
    "#lxBP .m{display:flex;flex-direction:column;align-items:center}" +
    "@media(min-width:780px){#lxBP .in{flex-direction:row;justify-content:center;gap:26px}#lxBP .m{align-items:flex-start;text-align:left}}";
  document.head.appendChild(css);

  var el = document.createElement("div");
  el.id = "lxBP";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Offre " + C.titre1 + " " + C.titre2);
  var e = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  el.innerHTML =
    '<div class="in"><div class="t"><b>' + e(C.titre1) + '</b><i>' + e(C.titre2) + '</i></div>' +
    '<div class="r">' + e(C.remise) + '</div>' +
    '<div class="m"><div class="x">' + e(C.texte) + '</div><div class="d">' + e(C.dates) + '</div></div>' +
    '<a class="a" href="tel:' + e(C.tel) + '">Appeler le ' + e(C.telAffiche) + '</a></div>';
  function poser() { if (document.body && el.parentNode !== document.body) document.body.insertBefore(el, document.body.firstChild); }
  function battre() { if (!actif()) { if (el.parentNode) el.parentNode.removeChild(el); return; } if (!el.parentNode) poser(); }
  poser();
  setInterval(battre, 30000);
})();
