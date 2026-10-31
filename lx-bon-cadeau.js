/* Luxyra — lx-bon-cadeau.js — 2026-10-31
 * Rendu des bons cadeaux, modèles « Maison » (papeterie sobre) et « Écrin » (aplat graphique),
 * choisis par chaque établissement (config_json.bonModele = "maison" | "ecrin" ; vide = rendu historique inchangé).
 * PRÉSENTATION UNIQUEMENT : ce fichier ne lit ni n'écrit aucune donnée, ne calcule aucun montant ni aucune TVA.
 * Les textes fiscaux (mention TVA, BUU/BUM) sont fournis tels quels par l'appelant.
 * Utilisé par : app.html (impression en caisse, réglage + aperçu), bons-cadeaux.html (aperçu), bons-cadeaux-success.html.
 * L'e-mail (edge gc-stripe-webhook) a son propre gabarit en tableaux, aux mêmes règles de couleur.
 * Dépendance facultative : window.qrcode (lx-qrcode.js) pour le QR ; sans elle, pas de QR (le code reste écrit).
 */
(function (g) {
  "use strict";
  var MODELES = { maison: "Maison", ecrin: "Écrin" };
  var PAPIER_A = "#F6F1E6", PAPIER_B = "#FBFAF7";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function modeleValide(m) { return m === "maison" || m === "ecrin" ? m : ""; }

  // ---------- couleurs (dérivées de LA couleur de l'établissement) ----------
  function hexOk(h) { return typeof h === "string" && /^#?[0-9a-f]{6}$/i.test(h.trim()); }
  function h2r(h) { h = h.replace("#", ""); var n = parseInt(h, 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  function r2h(r, gg, b) { return "#" + [r, gg, b].map(function (x) { return Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, "0"); }).join(""); }
  function r2hsl(c) { var r = c[0] / 255, gg = c[1] / 255, b = c[2] / 255, M = Math.max(r, gg, b), m = Math.min(r, gg, b), h = 0, s = 0, l = (M + m) / 2; if (M !== m) { var d = M - m; s = l > .5 ? d / (2 - M - m) : d / (M + m); h = M === r ? (gg - b) / d + (gg < b ? 6 : 0) : M === gg ? (b - r) / d + 2 : (r - gg) / d + 4; h *= 60; } return [h, s, l]; }
  function hsl2h(h, s, l) { var k = function (n) { return (n + h / 30) % 12; }, a = s * Math.min(l, 1 - l), f = function (n) { return l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1))); }; return r2h(f(0) * 255, f(8) * 255, f(4) * 255); }
  function mix(a, b, t) { var A = h2r(a), B = h2r(b); return r2h(A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t); }
  function lin(c) { c /= 255; return c <= .03928 ? c / 12.92 : Math.pow((c + .055) / 1.055, 2.4); }
  function lum(h) { var c = h2r(h); return .2126 * lin(c[0]) + .7152 * lin(c[1]) + .0722 * lin(c[2]); }
  function contraste(a, b) { var x = lum(a), y = lum(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }

  function palette(couleur) {
    var acc = hexOk(couleur) ? ("#" + couleur.trim().replace("#", "")).toUpperCase() : "#C8A84E";
    var hsl = r2hsl(h2r(acc)), h = hsl[0], s = hsl[1];
    var or = h >= 30 && h <= 60 && s > .25;                       // or / jaune : encre bronze, aplat noir chaud
    var ink = or ? hsl2h(h, .22, .13) : hsl2h(h, Math.min(s, .5), .2);
    var inkSoft = hsl2h(h, Math.min(s, .18), .36);
    var deep = or ? "#14120F" : hsl2h(h, Math.min(s, .4), .14);
    var foil = or ? acc : hsl2h(h, Math.min(s, .5), .76);
    // garde-fou de contraste (texte) : l'encre doit rester lisible sur le papier, la dorure sur l'aplat
    if (contraste(ink, PAPIER_A) < 7) ink = hsl2h(h, Math.min(s, .4), .16);
    if (contraste(foil, deep) < 4.5) foil = hsl2h(h, Math.min(s, .45), .82);
    // 31/10 (contre-audit R7) : liserés / filets visibles même avec une couleur très claire (blanc, crème…)
    // seuil bas : l'or Luxyra et les couleurs habituelles ne changent pas ; seules les couleurs presque blanches sont foncées
    // (sans teinte : gris neutre, pour ne pas inventer une couleur)
    var accTrait = contraste(acc, PAPIER_A) < 1.6 ? (s < .12 ? "#8A857C" : hsl2h(h, Math.max(s, .3), .42)) : acc;
    var line = mix(accTrait, PAPIER_A, .55); if (contraste(line, PAPIER_A) < 1.2) line = mix(accTrait, PAPIER_A, .3);
    return { accent: accTrait, accentBrut: acc, ink: ink, inkSoft: inkSoft, deep: deep, foil: foil, tint: mix(acc, PAPIER_A, .9), line: line, paperA: PAPIER_A, paperB: PAPIER_B };
  }

  // ---------- QR (SVG vectoriel : net à l'impression) ----------
  function qrSvg(texte, couleur) {
    try {
      if (typeof g.qrcode !== "function") return "";
      var q = g.qrcode(0, "M"); q.addData(String(texte || " ")); q.make();
      var n = q.getModuleCount(), p = "";
      for (var r = 0; r < n; r++) for (var c = 0; c < n; c++) if (q.isDark(r, c)) p += "M" + c + " " + r + "h1v1h-1z";
      return '<svg viewBox="-1 -1 ' + (n + 2) + " " + (n + 2) + '" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" style="display:block;width:100%;height:100%"><rect x="-1" y="-1" width="' + (n + 2) + '" height="' + (n + 2) + '" fill="#fff"/><path d="' + p + '" fill="' + (couleur || "#1C1A17") + '"/></svg>';
    } catch (e) { return ""; }
  }

  function montant(v) { var n = Number(v) || 0; return (Math.round(n * 100) % 100 === 0) ? String(Math.round(n)) : n.toFixed(2).replace(".", ","); }
  function montantLong(v) { return (Number(v) || 0).toFixed(2).replace(".", ",") + " €"; }
  function logoSrcOk(src) { return typeof src === "string" && /^(https:\/\/|data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,|\/)/i.test(src); }

  // ---------- CSS (scopé par classe ; unité --mm : px à l'écran, 1mm à l'impression) ----------
  function css() {
    return [
      ".lxbA,.lxbB,.lxb6A,.lxb6B{box-sizing:border-box;text-align:left;line-height:normal;letter-spacing:normal;-webkit-print-color-adjust:exact;print-color-adjust:exact}",
      ".lxbA.lxbA *,.lxbB.lxbB *,.lxb6A.lxb6A *,.lxb6B.lxb6B *{box-sizing:border-box;margin:0;padding:0;color:inherit;font-family:inherit;background:none;border:0;box-shadow:none;text-shadow:none;text-transform:none;letter-spacing:inherit;font-weight:inherit;font-size:inherit;line-height:inherit;border-radius:0;width:auto;height:auto;min-width:0;min-height:0;max-width:none;opacity:1}",
      // ===== Maison : carte 85 x 55 =====
      ".lxbA{position:relative;width:calc(var(--mm)*85);height:calc(var(--mm)*55);background:var(--paper);color:#1C1A17;overflow:hidden;font-family:Inter,Arial,sans-serif}",
      ".lxbA.lxb-ecran{box-shadow:0 1px 1px rgba(40,30,10,.08),0 10px 30px rgba(40,30,10,.10)}",
      ".lxbA .lxb-l1{position:absolute;inset:calc(var(--mm)*3);border:calc(var(--mm)*.35) solid var(--acc)}",
      ".lxbA .lxb-l2{position:absolute;inset:calc(var(--mm)*4);border:calc(var(--mm)*.12) solid var(--acc)}",
      ".lxbA .lxb-rec{position:absolute;inset:calc(var(--mm)*6);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}",
      ".lxbA .lxb-lg{max-height:calc(var(--mm)*12);max-width:calc(var(--mm)*30);object-fit:contain;margin-bottom:calc(var(--mm)*2.4);display:block}",
      ".lxbA .lxb-nm{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;text-transform:uppercase;letter-spacing:.3em;margin-right:-.3em;color:var(--ink);line-height:1.15;overflow-wrap:anywhere}",
      ".lxbA .lxb-sb{font-size:calc(var(--mm)*1.75);letter-spacing:.32em;margin-right:-.32em;text-transform:uppercase;color:var(--inkSoft);margin-top:calc(var(--mm)*1.4)}",
      ".lxbA .lxb-rl{width:calc(var(--mm)*7);height:calc(var(--mm)*.2);background:var(--acc);margin:calc(var(--mm)*3.2) 0 calc(var(--mm)*2.6)}",
      ".lxbA .lxb-cc{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:calc(var(--mm)*4.4);color:var(--ink)}",
      ".lxbA .lxb-vs{position:absolute;inset:calc(var(--mm)*6) calc(var(--mm)*6.5) calc(var(--mm)*5);display:grid;grid-template-columns:1fr calc(var(--mm)*19);grid-template-rows:1fr auto;column-gap:calc(var(--mm)*5)}",
      ".lxbA .lxb-lab{font-size:calc(var(--mm)*1.65);letter-spacing:.22em;text-transform:uppercase;color:var(--inkSoft);font-weight:500}",
      ".lxbA .lxb-val{font-family:'Cormorant Garamond',Georgia,serif;font-size:calc(var(--mm)*4.1);line-height:1.05;color:#1C1A17;margin:calc(var(--mm)*.6) 0 calc(var(--mm)*1.8);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".lxbA .lxb-amt{font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-size:calc(var(--mm)*10);line-height:.9;color:var(--ink);font-variant-numeric:tabular-nums}",
      ".lxbA .lxb-amt small{font-size:.45em;margin-left:.12em}",
      ".lxbA .lxb-qr{width:calc(var(--mm)*19);height:calc(var(--mm)*19);margin-top:calc(var(--mm)*.6)}",
      ".lxbA .lxb-code{font-weight:600;font-size:calc(var(--mm)*2.15);letter-spacing:.12em;text-align:center;margin-top:calc(var(--mm)*1.4);font-variant-numeric:tabular-nums;white-space:nowrap}",
      ".lxbA .lxb-mn{grid-column:1/3;border-top:calc(var(--mm)*.12) solid var(--line);padding-top:calc(var(--mm)*1.4);margin-top:calc(var(--mm)*1.6);font-size:calc(var(--mm)*1.72);line-height:1.42;color:#5E5850}",
      // ===== Écrin : carte 85 x 55 =====
      ".lxbB{position:relative;width:calc(var(--mm)*85);height:calc(var(--mm)*55);border-radius:calc(var(--mm)*3.2);overflow:hidden;font-family:'DM Sans',Arial,sans-serif}",
      ".lxbB.lxb-ecran{box-shadow:0 1px 2px rgba(0,0,0,.12),0 16px 40px rgba(0,0,0,.18)}",
      ".lxbB.lxb-r{background:var(--deep);color:#F4EFE6}",
      ".lxbB .lxb-wm{position:absolute;right:calc(var(--mm)*-4);bottom:calc(var(--mm)*-27);font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:calc(var(--mm)*88);line-height:1;color:var(--foil);opacity:.16;pointer-events:none}",
      ".lxbB .lxb-hd{position:absolute;left:calc(var(--mm)*6);top:calc(var(--mm)*6);right:calc(var(--mm)*6);display:flex;gap:calc(var(--mm)*2.4);align-items:center}",
      ".lxbB .lxb-lgw{background:#FBFAF7;border-radius:calc(var(--mm)*1.6);padding:calc(var(--mm)*.8);flex:none}",
      ".lxbB .lxb-lgw img{display:block;max-height:calc(var(--mm)*8);max-width:calc(var(--mm)*16);object-fit:contain}",
      ".lxbB .lxb-nm{font-weight:500;font-size:calc(var(--mm)*2.15);letter-spacing:.26em;text-transform:uppercase;line-height:1.3;overflow-wrap:anywhere}",
      ".lxbB .lxb-sb{font-size:calc(var(--mm)*1.6);letter-spacing:.26em;text-transform:uppercase;color:var(--foil);margin-top:calc(var(--mm)*.9)}",
      ".lxbB .lxb-lb{position:absolute;left:calc(var(--mm)*6);bottom:calc(var(--mm)*6.2);font-size:calc(var(--mm)*1.9);letter-spacing:.26em;text-transform:uppercase;color:var(--foil);font-weight:500}",
      ".lxbB .lxb-ru{position:absolute;left:calc(var(--mm)*6);bottom:calc(var(--mm)*10);width:calc(var(--mm)*8);height:calc(var(--mm)*.25);background:var(--foil)}",
      ".lxbB .lxb-am{position:absolute;right:calc(var(--mm)*6);bottom:calc(var(--mm)*4.6);font-weight:300;font-size:calc(var(--mm)*17);line-height:.8;letter-spacing:-.03em;font-variant-numeric:tabular-nums}",
      ".lxbB .lxb-am small{font-size:.34em;letter-spacing:0;margin-left:.08em;color:var(--foil);vertical-align:.95em;font-weight:400}",
      ".lxbB.lxb-v{background:var(--paper);color:#17161A}",
      ".lxbB .lxb-edge{position:absolute;left:0;top:0;bottom:0;width:calc(var(--mm)*3);background:var(--deep)}",
      ".lxbB .lxb-gr{position:absolute;inset:calc(var(--mm)*5.5) calc(var(--mm)*6) calc(var(--mm)*4.5) calc(var(--mm)*9);display:grid;grid-template-columns:1fr 1fr calc(var(--mm)*19);grid-template-rows:auto auto 1fr;column-gap:calc(var(--mm)*4);row-gap:calc(var(--mm)*3)}",
      ".lxbB .lxb-k{font-size:calc(var(--mm)*1.55);letter-spacing:.2em;text-transform:uppercase;color:#5F5D63;font-weight:500}",
      ".lxbB .lxb-vv{font-size:calc(var(--mm)*3.1);font-weight:500;margin-top:calc(var(--mm)*.6);font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}",
      ".lxbB .lxb-q{grid-column:3;grid-row:1/3;width:calc(var(--mm)*19);height:calc(var(--mm)*19)}",
      ".lxbB .lxb-cd{grid-column:3;grid-row:3;font-weight:600;font-size:calc(var(--mm)*2.1);letter-spacing:.1em;text-align:center;align-self:start;white-space:nowrap}",
      ".lxbB .lxb-mn{grid-column:1/3;grid-row:3;align-self:end;font-size:calc(var(--mm)*1.72);line-height:1.42;color:#5F5D63;border-top:calc(var(--mm)*.12) solid #E3E0DA;padding-top:calc(var(--mm)*1.4)}",
      // ===== Maison : carte A6 105 x 148 (portrait) =====
      ".lxb6A{position:relative;width:calc(var(--mm)*105);height:calc(var(--mm)*148);background:var(--paper);color:#1C1A17;font-family:Inter,Arial,sans-serif;overflow:hidden}",
      ".lxb6A .lxb-l1{position:absolute;inset:calc(var(--mm)*4);border:calc(var(--mm)*.4) solid var(--acc)}",
      ".lxb6A .lxb-l2{position:absolute;inset:calc(var(--mm)*5.2);border:calc(var(--mm)*.15) solid var(--acc)}",
      ".lxb6A .lxb-in{position:absolute;inset:calc(var(--mm)*11) calc(var(--mm)*11) calc(var(--mm)*9);text-align:center;display:flex;flex-direction:column;align-items:center}",
      ".lxb6A .lxb-lg{max-height:calc(var(--mm)*15);max-width:calc(var(--mm)*40);object-fit:contain;margin-bottom:calc(var(--mm)*3);display:block}",
      ".lxb6A .lxb-nm{font-family:'Cormorant Garamond',Georgia,serif;font-weight:500;text-transform:uppercase;letter-spacing:.3em;margin-right:-.3em;font-size:calc(var(--mm)*3.6);color:var(--ink)}",
      ".lxb6A .lxb-rl{width:calc(var(--mm)*8);height:calc(var(--mm)*.25);background:var(--acc);margin:calc(var(--mm)*4) 0}",
      ".lxb6A .lxb-oc{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:calc(var(--mm)*4.6);color:var(--ink)}",
      ".lxb6A .lxb-to{font-family:'Cormorant Garamond',Georgia,serif;font-size:calc(var(--mm)*8);line-height:1.1;margin-top:calc(var(--mm)*2);max-width:100%;overflow-wrap:anywhere}",
      ".lxb6A .lxb-lb{font-size:calc(var(--mm)*2);letter-spacing:.22em;text-transform:uppercase;color:var(--inkSoft);margin-top:calc(var(--mm)*1.5)}",
      ".lxb6A .lxb-am{font-family:'Cormorant Garamond',Georgia,serif;font-weight:300;font-size:calc(var(--mm)*21);line-height:1;color:var(--ink);margin-top:calc(var(--mm)*2);font-variant-numeric:tabular-nums}",
      ".lxb6A .lxb-am small{font-size:.42em;margin-left:.1em}",
      ".lxb6A .lxb-ms{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:calc(var(--mm)*4);line-height:1.35;color:#3A352E;margin-top:calc(var(--mm)*4);max-width:calc(var(--mm)*76);overflow-wrap:anywhere}",
      ".lxb6A .lxb-ft{margin-top:auto;display:flex;gap:calc(var(--mm)*4);align-items:center;text-align:left;border-top:calc(var(--mm)*.15) solid var(--line);padding-top:calc(var(--mm)*3.5);width:100%}",
      ".lxb6A .lxb-q{width:calc(var(--mm)*17);height:calc(var(--mm)*17);flex:none}",
      ".lxb6A .lxb-cd{font-weight:600;font-size:calc(var(--mm)*2.6);letter-spacing:.12em}",
      ".lxb6A .lxb-mt{font-size:calc(var(--mm)*1.85);line-height:1.45;color:#5E5850;margin-top:calc(var(--mm)*1)}",
      // ===== Écrin : carte A6 148 x 105 (paysage, deux volets) =====
      ".lxb6B{position:relative;width:calc(var(--mm)*148);height:calc(var(--mm)*105);background:var(--deep);color:#F4EFE6;overflow:hidden;display:grid;grid-template-columns:1fr 1fr;font-family:'DM Sans',Arial,sans-serif}",
      ".lxb6B .lxb-wm{position:absolute;left:calc(var(--mm)*-10);bottom:calc(var(--mm)*-55);font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-weight:300;font-size:calc(var(--mm)*170);line-height:1;color:var(--foil);opacity:.13;pointer-events:none}",
      ".lxb6B .lxb-c1{position:relative;padding:calc(var(--mm)*10);display:flex;flex-direction:column}",
      ".lxb6B .lxb-c2{position:relative;padding:calc(var(--mm)*10) calc(var(--mm)*10) calc(var(--mm)*9);border-left:calc(var(--mm)*.2) solid rgba(255,255,255,.14);display:flex;flex-direction:column}",
      ".lxb6B .lxb-lgw{background:#FBFAF7;border-radius:calc(var(--mm)*2);padding:calc(var(--mm)*1.2);align-self:flex-start;margin-bottom:calc(var(--mm)*4)}",
      ".lxb6B .lxb-lgw img{display:block;max-height:calc(var(--mm)*11);max-width:calc(var(--mm)*28);object-fit:contain}",
      ".lxb6B .lxb-nm{font-weight:500;font-size:calc(var(--mm)*2.6);letter-spacing:.26em;text-transform:uppercase;overflow-wrap:anywhere}",
      ".lxb6B .lxb-lb{font-size:calc(var(--mm)*2.1);letter-spacing:.26em;text-transform:uppercase;color:var(--foil);font-weight:500}",
      ".lxb6B .lxb-am{font-weight:300;font-size:calc(var(--mm)*28);line-height:.8;letter-spacing:-.03em;font-variant-numeric:tabular-nums}",
      ".lxb6B .lxb-am small{font-size:.32em;color:var(--foil);vertical-align:1.05em;margin-left:.06em}",
      ".lxb6B .lxb-oc{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:calc(var(--mm)*5.6);color:var(--foil)}",
      ".lxb6B .lxb-to{font-size:calc(var(--mm)*3);margin-top:calc(var(--mm)*3);line-height:1.5;overflow-wrap:anywhere}",
      ".lxb6B .lxb-ms{font-family:'Cormorant Garamond',Georgia,serif;font-style:italic;font-size:calc(var(--mm)*4.1);line-height:1.35;margin-top:calc(var(--mm)*4);color:#EDE6DA;overflow-wrap:anywhere}",
      ".lxb6B .lxb-ft{margin-top:auto;display:flex;gap:calc(var(--mm)*3.5);align-items:flex-end}",
      ".lxb6B .lxb-qt{background:#fff;padding:calc(var(--mm)*1.2);width:calc(var(--mm)*19);height:calc(var(--mm)*19);flex:none}",
      ".lxb6B .lxb-cd{font-weight:600;font-size:calc(var(--mm)*2.6);letter-spacing:.1em}",
      ".lxb6B .lxb-mt{font-size:calc(var(--mm)*1.85);line-height:1.45;color:rgba(244,239,230,.82);margin-top:calc(var(--mm)*1.2)}"
    ].join("\n");
  }

  function vars(p, mm) {
    return "--mm:" + mm + ";--paper:" + p.paperA + ";--ink:" + p.ink + ";--inkSoft:" + p.inkSoft + ";--acc:" + p.accent + ";--line:" + p.line + ";--deep:" + p.deep + ";--foil:" + p.foil;
  }
  function mmUnit(mm) { return (typeof mm === "number") ? mm + "px" : (mm || "6px"); }

  // bon : {code, val, de, pour, msg, exp (texte), scope (texte), tva (texte court, fourni par l'appelant), tk, occasion}
  // etab : {nom, sous, adresse, cpv, tel, logo, couleur}
  function mentions(bon, etab, court) {
    var l1 = [], l2 = [], l3 = [];
    if (bon.exp) l1.push("Valable jusqu’au " + esc(bon.exp));
    l1.push(esc(bon.scope || "Prestations et produits"));
    if (!court) l1.push("en une ou plusieurs fois");
    l2.push("Non remboursable" + (court ? "" : ", non échangeable"));
    if (bon.tva) l2.push(esc(bon.tva));
    if (bon.tk) l2.push("ticket n° " + esc(bon.tk));
    l3.push(esc(etab.nom || ""));
    var adr = [etab.adresse, etab.cpv].filter(Boolean).join(", ");
    if (adr) l3.push(esc(adr));
    if (etab.tel) l3.push(esc(etab.tel));
    return l1.join(" · ") + "<br>" + l2.join(" · ") + "<br>" + l3.join(" · ");
  }

  function qrOuApercu(opts, code, coul) {
    if (opts && opts.apercu) return '<svg viewBox="0 0 10 10" style="display:block;width:100%;height:100%"><rect x=".3" y=".3" width="9.4" height="9.4" fill="none" stroke="' + coul + '" stroke-width=".15" stroke-dasharray=".5 .4"/><text x="5" y="5.6" font-size="1.25" text-anchor="middle" fill="' + coul + '" font-family="Inter,Arial,sans-serif">QR code</text></svg>';
    return qrSvg(code, coul);
  }
  function carte(modele, face, bon, etab, opts) {
    modele = modeleValide(modele) || "maison"; opts = opts || {};
    var p = palette(etab.couleur), mm = mmUnit(opts.mm), ecran = opts.impression ? "" : " lxb-ecran";
    var logo = (opts.sansLogo || !logoSrcOk(etab.logo)) ? "" : etab.logo;
    var nom = esc(etab.nom || "Établissement"), sous = esc(etab.sous || "");
    if (modele === "maison") {
      if (face === "recto") {
        var long = String(etab.nom || "").length, t = logo ? 3.6 : (long > 22 ? 3.4 : long > 14 ? 4 : 4.6);
        return '<div class="lxbA' + ecran + '" style="' + vars(p, mm) + '"><div class="lxb-l1"></div><div class="lxb-l2"></div><div class="lxb-rec">' +
          (logo ? '<img class="lxb-lg" src="' + esc(logo) + '" alt="">' : "") +
          '<div class="lxb-nm" style="font-size:calc(var(--mm)*' + t + ')">' + nom + "</div>" + (sous ? '<div class="lxb-sb">' + sous + "</div>" : "") +
          '<div class="lxb-rl"></div><div class="lxb-cc">Carte cadeau</div></div></div>';
      }
      return '<div class="lxbA' + ecran + '" style="' + vars(p, mm) + '"><div class="lxb-vs"><div>' +
        (bon.pour ? '<div class="lxb-lab">Pour</div><div class="lxb-val">' + esc(bon.pour) + "</div>" : "") +
        '<div class="lxb-lab">De la part de</div><div class="lxb-val">' + esc(bon.de || "—") + "</div>" +
        '<div class="lxb-amt">' + montant(bon.val) + "<small>€</small></div></div>" +
        '<div><div class="lxb-qr">' + qrOuApercu(opts, bon.code, "#1C1A17") + '</div><div class="lxb-code">' + esc(bon.code || "") + "</div></div>" +
        '<div class="lxb-mn">' + mentions(bon, etab, true) + "</div></div></div>";
    }
    var init = esc(String(etab.nom || "L").trim().charAt(0).toUpperCase());
    if (face === "recto") {
      return '<div class="lxbB lxb-r' + ecran + '" style="' + vars(p, mm) + '"><div class="lxb-wm">' + init + "</div>" +
        '<div class="lxb-hd">' + (logo ? '<div class="lxb-lgw"><img src="' + esc(logo) + '" alt=""></div>' : "") + '<div><div class="lxb-nm">' + nom + "</div>" + (sous ? '<div class="lxb-sb">' + sous + "</div>" : "") + "</div></div>" +
        '<div class="lxb-ru"></div><div class="lxb-lb">Carte cadeau</div><div class="lxb-am">' + montant(bon.val) + "<small>€</small></div></div>";
    }
    return '<div class="lxbB lxb-v' + ecran + '" style="' + vars(p, mm).replace("--paper:" + p.paperA, "--paper:" + p.paperB) + '"><div class="lxb-edge"></div><div class="lxb-gr">' +
      '<div><div class="lxb-k">Pour</div><div class="lxb-vv">' + esc(bon.pour || "—") + '</div></div><div><div class="lxb-k">De la part de</div><div class="lxb-vv">' + esc(bon.de || "—") + "</div></div>" +
      '<div class="lxb-q">' + qrOuApercu(opts, bon.code, "#17161A") + "</div>" +
      '<div><div class="lxb-k">Valeur</div><div class="lxb-vv">' + montantLong(bon.val) + '</div></div><div><div class="lxb-k">Valable jusqu’au</div><div class="lxb-vv">' + esc(bon.exp || "—") + "</div></div>" +
      '<div class="lxb-mn">' + mentions(bon, etab, true) + '</div><div class="lxb-cd">' + esc(bon.code || "") + "</div></div></div>";
  }

  function a6(modele, bon, etab, opts) {
    modele = modeleValide(modele) || "maison"; opts = opts || {};
    var p = palette(etab.couleur), mm = mmUnit(opts.mm);
    var logo = logoSrcOk(etab.logo) ? etab.logo : "", nom = esc(etab.nom || "Établissement");
    var msg = bon.msg && bon.msg !== "Bon offert" ? esc(bon.msg) : "";
    var adr = [etab.adresse, etab.cpv].filter(Boolean).join(", ");
    var mt = (bon.exp ? "Valable jusqu’au " + esc(bon.exp) + "<br>" : "") + esc(bon.scope || "Prestations et produits") + ", en une ou plusieurs fois<br>Non remboursable" + (bon.tva ? " · " + esc(bon.tva) : "") + (adr ? "<br>" + esc(adr) : "");
    if (modele === "maison") {
      return '<div class="lxb6A" style="' + vars(p, mm) + '"><div class="lxb-l1"></div><div class="lxb-l2"></div><div class="lxb-in">' +
        (logo ? '<img class="lxb-lg" src="' + esc(logo) + '" alt="">' : "") + '<div class="lxb-nm">' + nom + '</div><div class="lxb-rl"></div>' +
        '<div class="lxb-oc">' + esc(bon.occasion || "Carte cadeau") + "</div>" +
        (bon.pour ? '<div class="lxb-to">' + esc(bon.pour) + ",</div>" : "") +
        '<div class="lxb-lb">' + (bon.de ? esc(bon.de) + " vous offre" : "Vous est offert") + "</div>" +
        '<div class="lxb-am">' + montant(bon.val) + "<small>€</small></div>" +
        '<div class="lxb-lb">à valoir chez ' + nom + "</div>" + (msg ? '<div class="lxb-ms">« ' + msg + " »</div>" : "") +
        '<div class="lxb-ft"><div class="lxb-q">' + qrSvg(bon.code, "#1C1A17") + '</div><div><div class="lxb-cd">' + esc(bon.code || "") + '</div><div class="lxb-mt">' + mt + "</div></div></div></div></div>";
    }
    var init = esc(String(etab.nom || "L").trim().charAt(0).toUpperCase());
    return '<div class="lxb6B" style="' + vars(p, mm) + '"><div class="lxb-wm">' + init + "</div>" +
      '<div class="lxb-c1">' + (logo ? '<div class="lxb-lgw"><img src="' + esc(logo) + '" alt=""></div>' : "") + '<div class="lxb-nm">' + nom + "</div>" + (etab.sous ? '<div class="lxb-lb" style="margin-top:calc(var(--mm)*1.6)">' + esc(etab.sous) + "</div>" : "") +
      '<div class="lxb-lb" style="margin-top:auto;margin-bottom:calc(var(--mm)*5)">Carte cadeau</div><div class="lxb-am">' + montant(bon.val) + "<small>€</small></div></div>" +
      '<div class="lxb-c2"><div class="lxb-oc">' + esc(bon.occasion || "Pour vous") + '</div><div class="lxb-to">' + (bon.pour ? "Pour <b style=\"font-weight:500\">" + esc(bon.pour) + "</b>" + (bon.de ? ", " : "") : "") + (bon.de ? "de la part de <b style=\"font-weight:500\">" + esc(bon.de) + "</b>" : "") + "</div>" +
      (msg ? '<div class="lxb-ms">« ' + msg + " »</div>" : "") +
      '<div class="lxb-ft"><div class="lxb-qt">' + qrSvg(bon.code, "#17161A") + '</div><div><div class="lxb-cd">' + esc(bon.code || "") + '</div><div class="lxb-mt">' + mt + "</div></div></div></div></div>";
  }

  // Document complet à imprimer. format : "carte" (85 x 55 à plier, sur A4) | "a6"
  function documentImpression(modele, bon, etab, format) {
    modele = modeleValide(modele) || "maison";
    var titre = "Carte cadeau " + esc(bon.code || "");
    var base = (g.location && /^https?:/.test(g.location.protocol)) ? g.location.origin : "https://luxyra.fr";
    var corps, page;
    if (format === "a6") {
      var paysage = modele === "ecrin";
      page = "@page{size:" + (paysage ? "148mm 105mm" : "105mm 148mm") + ";margin:0}";
      corps = '<div class="feuille a6">' + a6(modele, bon, etab, { mm: "1mm" }) + "</div>";
    } else {
      page = "@page{size:A4 portrait;margin:0}";
      corps = '<div class="feuille a4"><div class="plie">' +
        '<div class="face">' + carte(modele, "verso", bon, etab, { mm: "1mm", impression: true }) + "</div>" +
        '<div class="face">' + carte(modele, "recto", bon, etab, { mm: "1mm", impression: true }) + "</div>" +
        '<div class="pli"></div><i class="tc tl"></i><i class="tc tr"></i><i class="tc bl"></i><i class="tc br"></i></div>' +
        '<div class="aide">Découpez le long des repères (170 × 55 mm), puis pliez au milieu sur le pointillé : la carte fait 85 × 55 mm, recto et verso. Papier conseillé : 250 à 350 g.</div></div>';
    }
    return "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>" + titre + "</title>" +
      '<link rel="stylesheet" href="' + base + '/fonts/luxyra-fonts.css"><style>' + page +
      "html,body{margin:0;padding:0}body{background:#e8e6e1;font-family:Inter,Arial,sans-serif}" +
      ".barre{position:sticky;top:0;z-index:5;background:#1c1a17;color:#fff;padding:10px 14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:13px}" +
      ".barre button{border:0;border-radius:8px;padding:9px 16px;font:600 13px Inter,Arial,sans-serif;cursor:pointer;background:#fff;color:#1c1a17}" +
      ".feuille{box-sizing:border-box;background:#fff;margin:18px auto;box-shadow:0 4px 24px rgba(0,0,0,.18);position:relative;overflow:hidden}" +
      ".feuille.a4{width:210mm;height:297mm;padding-top:30mm}" +
      ".feuille.a6{width:fit-content}" +
      ".plie{position:relative;width:170mm;height:55mm;margin:0 auto;display:flex}" +
      ".plie .face{width:85mm;height:55mm}" +
      ".pli{position:absolute;left:85mm;top:-6mm;bottom:-6mm;border-left:.2mm dashed #999}" +
      ".tc{position:absolute;width:5mm;height:5mm}" +
      ".tl{left:-6mm;top:-6mm;border-right:.2mm solid #888;border-bottom:.2mm solid #888}.tr{right:-6mm;top:-6mm;border-left:.2mm solid #888;border-bottom:.2mm solid #888}" +
      ".bl{left:-6mm;bottom:-6mm;border-right:.2mm solid #888;border-top:.2mm solid #888}.br{right:-6mm;bottom:-6mm;border-left:.2mm solid #888;border-top:.2mm solid #888}" +
      ".aide{width:170mm;margin:14mm auto 0;font-size:3mm;color:#666;line-height:1.5}" +
      "@media print{body{background:#fff}.barre{display:none}.feuille{margin:0;box-shadow:none}}" +
      css() + "</style></head><body>" +
      '<div class="barre"><button onclick="window.print()">Imprimer</button><span>Dans la fenêtre d’impression : échelle 100 %, marges « aucune », et cochez « Graphiques d’arrière-plan ».</span></div>' +
      corps + "</body></html>";
  }

  function imprimer(modele, bon, etab, format) {
    var w = g.open("", "_blank", "width=900,height=700");
    if (!w) return false;
    w.document.open(); w.document.write(documentImpression(modele, bon, etab, format)); w.document.close();
    return true;
  }

  // Occasion choisie sur la page publique -> libellé + theme_id historique (compatibilité gc-create-checkout / e-mail)
  var OCCASIONS = [
    { id: "", nom: "Aucune", libelle: "", theme: "classique" },
    { id: "anniversaire", nom: "Anniversaire", libelle: "Joyeux anniversaire", theme: "anniversaire" },
    { id: "noel", nom: "Noël", libelle: "Joyeux Noël", theme: "noel" },
    { id: "feteMeres", nom: "Fête des mères", libelle: "Bonne fête maman", theme: "feteMeres" },
    { id: "stValentin", nom: "Saint-Valentin", libelle: "Avec tout mon amour", theme: "stValentin" },
    { id: "merci", nom: "Merci", libelle: "Merci", theme: "roseGold" }
  ];
  function occasionDepuisTheme(themeId) {
    for (var i = 0; i < OCCASIONS.length; i++) if (OCCASIONS[i].id && OCCASIONS[i].theme === themeId) return OCCASIONS[i].libelle;
    return "";
  }

  var _cssPose = false;
  function poserCss(doc) {
    doc = doc || g.document; if (!doc) return;
    if (doc.getElementById("lxBonCss")) return;
    var s = doc.createElement("style"); s.id = "lxBonCss"; s.textContent = css(); (doc.head || doc.documentElement).appendChild(s); _cssPose = true;
  }

  g.LXBon = {
    version: "20261031-2", MODELES: MODELES, OCCASIONS: OCCASIONS,
    modeleValide: modeleValide, palette: palette, contraste: contraste, css: css, poserCss: poserCss,
    carte: carte, a6: a6, documentImpression: documentImpression, imprimer: imprimer,
    occasionDepuisTheme: occasionDepuisTheme, qrSvg: qrSvg, esc: esc
  };
})(typeof window !== "undefined" ? window : globalThis);
