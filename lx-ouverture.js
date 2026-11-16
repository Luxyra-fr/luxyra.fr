/* 2026-11-16 - Bandeau d'annonce d'ouverture (valide par l'etablissement le 16/11/2026).
   Actif pour les etablissements listes dans LX_OUV ; ?apercu=ouverture ajoute la barre de demonstration.
   Heure de Paris fixee (UTC+1 fin novembre / debut decembre). Disparait seul a l'ouverture. */
(function () {
  "use strict";
  var LX_OUV = { "o-r-studio": { resa: "2026-11-30T09:00:00+01:00", salon: "2026-12-07T13:30:00+01:00", tel: "0745332225" } };
  var DEMO = /[?&]apercu=ouverture(&|$)/.test(location.search);
  var slug = "";
  try { slug = String(window.__SALON_SLUG || new URLSearchParams(location.search).get("slug") || location.pathname.split("/")[1] || "").toLowerCase(); } catch (e) {}
  var CFG = LX_OUV[slug];
  if (!CFG) return;
  var telAff = CFG.tel.replace(/(\d\d)(?=\d)/g, "$1 ");
  var T1 = Date.parse(CFG.resa), T2 = Date.parse(CFG.salon);
  var decalage = 0, simu = null, etat = "";
  var css = document.createElement("style");
  css.textContent =
    "#lxOuv{background:linear-gradient(180deg,#141210,#0a0a0a);border-bottom:1px solid rgba(200,168,78,.35);color:#f5f0e8;font-family:Inter,Nunito,-apple-system,'Segoe UI',sans-serif;padding:18px 16px 16px;text-align:center}" +
    "#lxOuv .in{max-width:980px;margin:0 auto;display:flex;flex-direction:column;align-items:center;gap:12px}" +
    "#lxOuv .sur{font-size:11px;letter-spacing:.26em;text-transform:uppercase;color:#c8a84e}" +
    "#lxOuv .tit{font-family:'Playfair Display',Georgia,serif;font-size:22px;line-height:1.2;color:#fff}" +
    "#lxOuv .tit em{color:#c8a84e;font-style:italic}" +
    "#lxOuv .cpt{display:flex;gap:8px}" +
    "#lxOuv .c{min-width:58px;padding:8px 6px 6px;border:1px solid rgba(200,168,78,.35);border-radius:10px;background:rgba(255,255,255,.03)}" +
    "#lxOuv .c b{display:block;font-family:'Playfair Display',Georgia,serif;font-size:26px;font-weight:500;line-height:1;font-variant-numeric:tabular-nums;color:#fff}" +
    "#lxOuv .c span{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:#a89f8e}" +
    "#lxOuv .lib{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:#d8d0c2}" +
    "#lxOuv .dates{font-size:13px;color:#cfc7b8;line-height:1.7}" +
    "#lxOuv .dates b{color:#fff;font-weight:600}" +
    "#lxOuv .cta{display:inline-block;background:#c8a84e;color:#0a0a0a;font-weight:700;font-size:13px;letter-spacing:.08em;text-transform:uppercase;text-decoration:none;padding:12px 22px;border-radius:999px}" +
    "#lxOuv .att{display:inline-block;border:1px solid rgba(200,168,78,.5);color:#c8a84e;font-size:12px;letter-spacing:.06em;padding:10px 18px;border-radius:999px}" +
    "@media(min-width:760px){#lxOuv .in{flex-direction:row;justify-content:space-between;text-align:left;gap:22px}#lxOuv .g{flex:1}#lxOuv .m{display:flex;flex-direction:column;align-items:center;gap:6px}}" +
    "#lxOuvDemo{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);z-index:99999;background:rgba(245,240,232,.96);color:#0a0a0a;border-radius:999px;padding:5px;display:flex;gap:3px;font:500 12px Inter,sans-serif;white-space:nowrap;max-width:calc(100vw - 16px);overflow-x:auto;box-shadow:0 8px 30px rgba(0,0,0,.5)}" +
    "#lxOuvDemo b{padding:7px 4px 7px 12px;color:#8a6d1f}#lxOuvDemo button{border:0;background:transparent;font:inherit;padding:7px 11px;border-radius:999px;cursor:pointer;color:#0a0a0a}#lxOuvDemo button.on,#lxOuvDemo button:hover{background:#c8a84e}";
  document.head.appendChild(css);
  var el = document.createElement("div");
  el.id = "lxOuv";
  el.innerHTML =
    '<div class="in"><div class="g"><div class="sur">Nouveau salon</div>' +
    '<div class="tit">Ouverture le <em>lundi 7 d\u00e9cembre</em> \u00e0 13h30</div>' +
    '<div class="dates" id="lxOuvD"></div></div>' +
    '<div class="m"><div class="lib" id="lxOuvL"></div><div class="cpt">' +
    '<div class="c"><b id="lxOJ">--</b><span>Jours</span></div><div class="c"><b id="lxOH">--</b><span>Heures</span></div>' +
    '<div class="c"><b id="lxOM">--</b><span>Min</span></div><div class="c"><b id="lxOS">--</b><span>Sec</span></div></div></div>' +
    '<div id="lxOuvA"></div></div>';
  function poser() { if (document.body.firstChild !== el) document.body.insertBefore(el, document.body.firstChild); }
  poser(); setInterval(poser, 1000);
  var $ = function (i) { return document.getElementById(i); };
  function maintenant() { return Date.now() + (simu !== null ? simu : decalage); }
  function synchro() {
    var t0 = Date.now();
    fetch(location.pathname + "?t=" + t0, { method: "HEAD", cache: "no-store" }).then(function (r) {
      var d = Date.parse(r.headers.get("Date") || ""); if (!isNaN(d)) decalage = d + (Date.now() - t0) / 2 - Date.now();
    }).catch(function () {});
  }
  function deux(n) { return n < 10 ? "0" + n : "" + n; }
  function rendre(n) {
    if (n === etat) return; etat = n;
    if (n === "fin") { el.style.display = "none"; return; }
    el.style.display = "";
    $("lxOuvL").textContent = n === "avant" ? "Prise de rendez-vous dans" : "Ouverture du salon dans";
    $("lxOuvD").innerHTML = n === "avant"
      ? "Prise de rendez-vous par t\u00e9l\u00e9phone d\u00e8s le <b>lundi 30 novembre \u00e0 9h</b>"
      : "Prenez rendez-vous d\u00e8s maintenant <b>par t\u00e9l\u00e9phone</b>";
    $("lxOuvA").innerHTML = n === "avant"
      ? '<span class="att">Rendez-vous par t\u00e9l\u00e9phone d\u00e8s le 30 novembre \u00e0 9h</span>'
      : '<a class="cta" href="tel:' + CFG.tel + '">Appeler le ' + telAff + '</a>';
  }
  function battre() {
    var t = maintenant();
    if (t >= T2) { rendre("fin"); return; }
    rendre(t < T1 ? "avant" : "resa");
    var r = Math.max(0, Math.floor(((t < T1 ? T1 : T2) - t) / 1000));
    $("lxOJ").textContent = deux(Math.floor(r / 86400)); $("lxOH").textContent = deux(Math.floor(r % 86400 / 3600));
    $("lxOM").textContent = deux(Math.floor(r % 3600 / 60)); $("lxOS").textContent = deux(r % 60);
  }
  if (DEMO) {
    var d = document.createElement("div"); d.id = "lxOuvDemo";
    d.innerHTML = '<b>D\u00e9mo</b><button data-e="avant">Avant le 30/11</button><button data-e="resa">R\u00e9servations ouvertes</button><button data-e="j10">10 s avant</button><button data-e="fin">Le 7/12 \u00e0 13h30</button><button data-e="reel">Heure r\u00e9elle</button>';
    document.body.appendChild(d);
    var cibles = { avant: T1 - 9 * 86400e3, resa: T1 + 5000, j10: T2 - 10000, fin: T2 };
    d.addEventListener("click", function (ev) {
      var b = ev.target.closest("button"); if (!b) return; var k = b.getAttribute("data-e");
      simu = k === "reel" ? null : cibles[k] - Date.now();
      d.querySelectorAll("button").forEach(function (x) { x.classList.toggle("on", x === b); }); battre();
    });
  }
  synchro(); battre(); setInterval(battre, 250); setInterval(synchro, 600000);
})();