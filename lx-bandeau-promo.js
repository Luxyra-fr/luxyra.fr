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
    "#lxBP{position:relative;overflow:hidden;background:#040404;border-bottom:1px solid rgba(212,175,55,.55);color:#fff;font-family:Inter,Nunito,-apple-system,'Segoe UI',sans-serif;padding:20px 16px 20px;text-align:center}" +
    "#lxBP canvas{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none}" +
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
    '<div class="in"><div class="t"><b>' + e(C.titre1) + '</b><i>' + e(C.titre2) + '</i></div>' +
    '<div class="r">' + e(C.remise) + '</div>' +
    '<div class="m"><div class="x">' + e(C.texte) + '</div><div class="d">' + e(C.dates) + '</div></div>' +
    '<div class="m" style="align-items:center;gap:5px"><a class="a" id="lxBPr" href="#reserver">Réserver en ligne</a>' +
    '<a class="s" href="tel:' + e(C.tel) + '">ou par téléphone : ' + e(C.telAffiche) + '</a></div></div>';
  el.querySelector("#lxBPr").addEventListener("click", function (ev) {
    if (typeof window.goToBooking === "function") { ev.preventDefault(); try { window.goToBooking(); } catch (x) {} }
  });
  // Fond : pluie de paillettes d'or (proposition n° 4 validee sur maquette).
  (function () {
    var cv = document.createElement("canvas"); el.insertBefore(cv, el.firstChild);
    var x = cv.getContext("2d"); if (!x) return;
    var g0 = 99, alea = function () { g0 = (g0 * 1664525 + 1013904223) % 4294967296; return g0 / 4294967296; };
    var P = [], W = 0, H = 0, i;
    for (i = 0; i < 80; i++) P.push({ x: alea(), y: alea(), v: 0.03 + alea() * 0.09, s: 0.6 + alea() * 1.9, ph: alea() * 6.28, tw: 1 + alea() * 3, d: (alea() - 0.5) * 0.04 });
    function taille() { W = cv.width = el.clientWidth || 1; H = cv.height = el.clientHeight || 1; }
    function dessin(t) {
      x.clearRect(0, 0, W, H);
      var g = x.createRadialGradient(W / 2, H * 1.2, 0, W / 2, H * 1.2, W * 0.6); g.addColorStop(0, "#241a07"); g.addColorStop(1, "#040404");
      x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalCompositeOperation = "screen";
      for (var k = 0; k < P.length; k++) {
        var p = P[k], y = ((p.y + t * p.v) % 1.1) * H - 6, px = (((p.x + t * p.d + Math.sin(t * 0.6 + p.ph) * 0.01) % 1) + 1) % 1 * W;
        var tw = 0.35 + 0.65 * Math.abs(Math.sin(t * p.tw + p.ph)), rad = p.s * (1 + tw);
        var q = x.createRadialGradient(px, y, 0, px, y, rad * 3);
        q.addColorStop(0, "rgba(255,236,170," + (0.9 * tw) + ")"); q.addColorStop(0.35, "rgba(230,190,90," + (0.35 * tw) + ")"); q.addColorStop(1, "rgba(230,190,90,0)");
        x.fillStyle = q; x.beginPath(); x.arc(px, y, rad * 3, 0, 6.2832); x.fill();
        if (p.s > 1.9 && tw > 0.9) { x.strokeStyle = "rgba(255,240,190," + (tw * 0.55) + ")"; x.lineWidth = 0.7; x.beginPath(); x.moveTo(px - 7, y); x.lineTo(px + 7, y); x.moveTo(px, y - 7); x.lineTo(px, y + 7); x.stroke(); }
      }
      x.globalCompositeOperation = "source-over";
    }
    var fixe = false; try { fixe = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e2) {}
    var t0 = 0;
    function image(t) { if (!t0) t0 = t; if (cv.width !== (el.clientWidth || 1) || cv.height !== (el.clientHeight || 1)) taille(); dessin((t - t0) / 1000); if (!fixe && el.parentNode) requestAnimationFrame(image); }
    window.addEventListener("resize", taille);
    setTimeout(function () { taille(); requestAnimationFrame(image); }, 0);
  })();
  function poser() { if (document.body && el.parentNode !== document.body) document.body.insertBefore(el, document.body.firstChild); }
  function battre() { if (!actif()) { if (el.parentNode) el.parentNode.removeChild(el); return; } if (!el.parentNode) poser(); }
  poser();
  setInterval(battre, 30000);
})();
