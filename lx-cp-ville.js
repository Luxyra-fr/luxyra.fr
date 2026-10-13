/* Luxyra — code postal -> liste des communes (2026-10-11)
 * Dès qu'un code postal français à 5 chiffres est saisi, la ville se choisit dans une liste
 * (base officielle des communes, geo.api.gouv.fr). Fonctionne sur tous les formulaires, même
 * affichés après coup : un seul écouteur global. Le champ « Ville » d'origine reste la source
 * de vérité (les formulaires le lisent comme avant) ; il est simplement rempli par la liste.
 * Si le service ne répond pas, ou pour un code étranger, la saisie libre reste possible. */
(function () {
  if (window.__lxCpVille) return; window.__lxCpVille = true;
  var cache = {};
  function estCp(el) {
    if (!el || el.tagName !== "INPUT") return false;
    var id = String(el.id || ""), ac = String(el.getAttribute("autocomplete") || "");
    return ac === "postal-code" || /(^|[^a-z])(cp|Cp)$/.test(id) || /Cp$/.test(id) || id === "mcp";
  }
  function villeDe(cp) {
    var box = cp, i;
    for (i = 0; i < 4 && box; i++) {
      box = box.parentElement; if (!box) break;
      var v = box.querySelector('input[autocomplete="address-level2"], input[id$="Ville"], input[id$="ville"], input[id="mville"]');
      if (v && v !== cp) return v;
    }
    return null;
  }
  function paysEtranger(cp) {
    try { var p = document.getElementById("fPays"); if (p && p.value && p.value !== "France") return true; } catch (e) {}
    return false;
  }
  function charger(code) {
    if (cache[code]) return Promise.resolve(cache[code]);
    return fetch("https://geo.api.gouv.fr/communes?codePostal=" + code + "&fields=nom&format=json")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (l) { if (l === null) return null; var n = (l || []).map(function (c) { return c.nom; }).filter(Boolean).sort(function (a, b) { return a.localeCompare(b, "fr"); }); cache[code] = n; return n; })
      .catch(function () { return null; });
  }
  function maj(cp) {
    var v = villeDe(cp); if (!v) return;
    var code = String(cp.value || "").replace(/\D/g, "");
    var sel = v.__lxSel;
    // 2026-10-13 : champ « ville à choisir » (comptes clients) : verrouillé tant que le code postal n'a pas donné la liste ;
    // saisie libre seulement pour un code étranger (4 chiffres, pays autre que la France) ou si le service ne répond pas.
    var liste = v.getAttribute("data-lx-ville-liste") === "1";
    if (code.length !== 5 || paysEtranger(cp)) { if (sel) { sel.remove(); v.__lxSel = null; v.style.display = ""; } if (liste) v.readOnly = !(code.length === 4 || paysEtranger(cp)); return; }
    charger(code).then(function (noms) {
      if (String(cp.value || "").replace(/\D/g, "") !== code) return;
      if (noms === null) { if (liste) v.readOnly = false; return; }
      var _msg = cp.parentNode && cp.parentNode.querySelector(".lx-cp-msg");
      if (!noms.length) {
        if (v.__lxSel) { v.__lxSel.remove(); v.__lxSel = null; } v.style.display = "";
        // 2026-10-11 : code postal inexistant (ex. 75000) -> on le signale, sans bloquer
        if (!_msg && cp.parentNode) { _msg = document.createElement("div"); _msg.className = "lx-cp-msg"; _msg.style.cssText = "font-size:11px;color:#ef9a9a;margin-top:4px"; cp.parentNode.appendChild(_msg); }
        if (_msg) _msg.textContent = "Code postal introuvable : vérifiez-le.";
        if (liste) { v.readOnly = true; v.value = ""; }
        return;
      }
      if (_msg) _msg.remove();
      if (!v.__lxSel) {
        sel = document.createElement("select");
        sel.className = v.className; sel.setAttribute("style", v.getAttribute("style") || ""); sel.style.display = "";
        sel.setAttribute("aria-label", "Ville");
        sel.addEventListener("change", function () { v.value = sel.value; v.dispatchEvent(new Event("input", { bubbles: true })); v.dispatchEvent(new Event("change", { bubbles: true })); });
        v.parentNode.insertBefore(sel, v.nextSibling); v.__lxSel = sel;
      }
      sel = v.__lxSel;
      var actuel = String(v.value || "").trim().toLowerCase();
      var choisi = noms.filter(function (n) { return n.toLowerCase() === actuel; })[0] || (noms.length === 1 ? noms[0] : "");
      sel.innerHTML = (noms.length > 1 ? '<option value="">Choisissez la ville…</option>' : "") + noms.map(function (n) { return '<option' + (n === choisi ? " selected" : "") + ">" + n.replace(/</g, "&lt;") + "</option>"; }).join("");
      v.style.display = "none";
      if (choisi && v.value !== choisi) { v.value = choisi; v.dispatchEvent(new Event("input", { bubbles: true })); v.dispatchEvent(new Event("change", { bubbles: true })); }
      if (!choisi && v.value && noms.indexOf(v.value) < 0) v.value = "";
    });
  }
  document.addEventListener("input", function (e) { if (estCp(e.target)) maj(e.target); }, true);
  // Formulaires pré-remplis (fiche, profil) : à l'affichage
  var t = null;
  new MutationObserver(function () { clearTimeout(t); t = setTimeout(function () {
    document.querySelectorAll('input[autocomplete="postal-code"], input[id="mcp"]').forEach(function (cp) { if (!cp.__lxVu && String(cp.value || "").replace(/\D/g, "").length === 5) { cp.__lxVu = true; maj(cp); } });
  }, 250); }).observe(document.documentElement, { childList: true, subtree: true });
})();
