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

  // Brume doree : bruit fractal (SVG feTurbulence) en trois couches qui derivent lentement.
  function brume(graine, f1, f2, k, o) {
    return 'url("data:image/svg+xml,' + encodeURIComponent("<svg xmlns='http://www.w3.org/2000/svg' width='1400' height='320'><filter id='f' x='0' y='0' width='100%' height='100%'><feTurbulence type='fractalNoise' baseFrequency='" + f1 + " " + f2 + "' numOctaves='4' seed='" + graine + "' stitchTiles='stitch'/><feColorMatrix values='0 0 0 0 0.96  0 0 0 0 0.84  0 0 0 0 0.56  " + k + " 0 0 0 " + o + "'/></filter><rect width='100%' height='100%' filter='url(#f)'/></svg>") + '")';
  }
  var css = document.createElement("style");
  css.textContent =
    "#lxBP{position:relative;overflow:hidden;background:radial-gradient(90% 160% at 50% 110%,#3a2c10 0%,#120e07 48%,#040404 100%);border-bottom:1px solid rgba(212,175,55,.55);color:#fff;font-family:Inter,Nunito,-apple-system,'Segoe UI',sans-serif;padding:20px 16px 20px;text-align:center}" +
    "#lxBP .bm{position:absolute;left:0;top:-30%;width:100%;height:160%;background-repeat:repeat-x;background-size:1400px 100%;pointer-events:none;mix-blend-mode:screen;will-change:background-position}" +
    "#lxBP .bm1{background-image:" + brume(7, 0.004, 0.018, 2.1, -0.86) + ";opacity:.55;filter:blur(7px);animation:lxBm1 46s linear infinite}" +
    "#lxBP .bm2{background-image:" + brume(23, 0.007, 0.03, 2.4, -1.05) + ";opacity:.5;filter:blur(3px);animation:lxBm2 31s linear infinite}" +
    "#lxBP .bm3{background-image:" + brume(41, 0.0025, 0.012, 1.8, -0.7) + ";opacity:.35;filter:blur(14px);animation:lxBm1 70s linear infinite reverse}" +
    "@keyframes lxBm1{from{background-position:0 0}to{background-position:-1400px 0}}@keyframes lxBm2{from{background-position:-1400px 0}to{background-position:0 0}}" +
    "@media(prefers-reduced-motion:reduce){#lxBP .bm{animation:none}}" +
    "#lxBP .t b,#lxBP .x{text-shadow:0 2px 14px rgba(0,0,0,.85)}" +
    "#lxBP .in{position:relative;z-index:2;max-width:1000px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:8px}" +
    "#lxBP .t{line-height:1;white-space:nowrap}" +
    "#lxBP .t b{font-family:'Playfair Display',Georgia,serif;font-weight:800;font-size:26px;letter-spacing:.08em;color:#fff}" +
    "#lxBP .t i{font-family:'Cormorant Garamond','Playfair Display',Georgia,serif;font-style:italic;font-weight:600;font-size:34px;margin-left:6px;background:linear-gradient(180deg,#fff3c4,#e2bd55 55%,#a8821f);-webkit-background-clip:text;background-clip:text;color:transparent}" +
    "#lxBP .r{font-family:'Playfair Display',Georgia,serif;font-weight:800;font-size:34px;line-height:1;background:linear-gradient(180deg,#fff3c4,#e2bd55 55%,#a8821f);-webkit-background-clip:text;background-clip:text;color:transparent;white-space:nowrap}" +
    "#lxBP .x{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:600;font-size:20px;line-height:1.2;color:#fff}" +
    "#lxBP .d{font-size:11px;font-weight:700;letter-spacing:.2em;text-transform:uppercase;color:#f1cf6a;margin-top:2px}" +
    "#lxBP .a{display:inline-block;background:linear-gradient(180deg,#f6dc88,#c9a03a);color:#0a0a0a;font-weight:800;font-size:13px;letter-spacing:.04em;text-decoration:none;padding:10px 20px;border-radius:999px;white-space:nowrap;box-shadow:0 8px 20px -10px rgba(212,175,55,.9)}" +
    "#lxBP .m{display:flex;flex-direction:column;align-items:center}" +
    "#lxBP .s{font-size:12px;color:#e9dfc6;text-decoration:none;white-space:nowrap}" +
    "@media(min-width:780px){#lxBP .in{flex-direction:row;justify-content:center;gap:26px}#lxBP .m{align-items:flex-start;text-align:left}}";
  document.head.appendChild(css);

  var el = document.createElement("div");
  el.id = "lxBP";
  el.setAttribute("role", "region");
  el.setAttribute("aria-label", "Offre " + C.titre1 + " " + C.titre2);
  var e = function (s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  el.innerHTML =
    '<div class="bm bm3"></div><div class="bm bm1"></div><div class="bm bm2"></div>' +
    '<div class="in"><div class="t"><b>' + e(C.titre1) + '</b><i>' + e(C.titre2) + '</i></div>' +
    '<div class="r">' + e(C.remise) + '</div>' +
    '<div class="m"><div class="x">' + e(C.texte) + '</div><div class="d">' + e(C.dates) + '</div></div>' +
    '<div class="m" style="align-items:center;gap:5px"><a class="a" id="lxBPr" href="#reserver">Réserver en ligne</a>' +
    '<a class="s" href="tel:' + e(C.tel) + '">ou par téléphone : ' + e(C.telAffiche) + '</a></div></div>';
  el.querySelector("#lxBPr").addEventListener("click", function (ev) {
    if (typeof window.goToBooking === "function") { ev.preventDefault(); try { window.goToBooking(); } catch (x) {} }
  });
  function poser() { if (document.body && el.parentNode !== document.body) document.body.insertBefore(el, document.body.firstChild); }
  function battre() { if (!actif()) { if (el.parentNode) el.parentNode.removeChild(el); return; } if (!el.parentNode) poser(); }
  poser();
  setInterval(battre, 30000);
})();
