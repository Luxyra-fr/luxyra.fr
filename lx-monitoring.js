/* lx-monitoring.js — Hook erreurs JS pour toutes les pages publiques Luxyra
 *
 * Capture automatiquement :
 *  - window.onerror (erreurs JS non catchées)
 *  - unhandledrejection (promesses rejetées non catchées)
 *  - console.error (logging d'erreurs explicites par le code)
 *
 * Envoie un POST best-effort à l'edge function lx-error-report qui
 * insère dans audit_log pour le panel admin Monitoring.
 *
 * À inclure dans tous les fichiers HTML publics :
 *   <script src="/lx-monitoring.js" defer></script>
 *
 * Léger (~2KB minified), aucune dépendance, ne ralentit pas la page.
 */
(function(){
  if (window.__LX_MONITORING_LOADED) return;
  window.__LX_MONITORING_LOADED = true;

  var SB_URL = "https://kxdgjtvrkwugbifgppai.supabase.co";
  var SB_ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI";

  var lastReportTs = 0;
  var reportsThisSession = 0;
  var MAX_REPORTS_PER_SESSION = 30;
  var THROTTLE_MS = 1500;
  var skipPat = /ResizeObserver loop|Script error|Non-Error promise|Load failed|AbortError|cancelled/i;

  function report(type, message, stack, extra) {
    try {
      // Throttle : pas plus d'un rapport toutes les 1.5s
      var now = Date.now();
      if (now - lastReportTs < THROTTLE_MS) return;
      // Limite globale par session
      if (reportsThisSession >= MAX_REPORTS_PER_SESSION) return;
      // Skip patterns bénins
      if (skipPat.test(String(message || ""))) return;
      lastReportTs = now;
      reportsThisSession++;

      var payload = {
        type: type,
        message: String(message || "").slice(0, 800),
        stack: stack ? String(stack).slice(0, 3000) : null,
        page: location.pathname,
        url: location.href.slice(0, 500),
        salon_slug: window.__SALON_SLUG || null,
        ua: navigator.userAgent.slice(0, 300),
        ts: new Date().toISOString()
      };
      if (extra && typeof extra === "object") {
        if (extra.file) payload.file = String(extra.file).slice(0, 300);
        if (extra.line != null) payload.line = Number(extra.line);
        if (extra.col != null) payload.col = Number(extra.col);
      }

      fetch(SB_URL + "/functions/v1/lx-error-report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SB_ANON,
          "Authorization": "Bearer " + SB_ANON
        },
        body: JSON.stringify(payload),
        keepalive: true,
        mode: "cors"
      }).catch(function(){});
    } catch (_) { /* never throw from monitoring */ }
  }

  // Hook 1 : window.onerror (erreurs JS sync non catchées)
  window.addEventListener("error", function(e) {
    if (!e) return;
    if (e.target && e.target !== window && e.target.nodeName) {
      // Erreur de ressource (img, script, link) → on ne report pas
      return;
    }
    report("error", e.message || "Unknown error",
           e.error && e.error.stack ? e.error.stack : null,
           { file: e.filename, line: e.lineno, col: e.colno });
  }, true);

  // Hook 2 : unhandledrejection (Promise.reject() non catchée)
  window.addEventListener("unhandledrejection", function(e) {
    if (!e) return;
    var r = e.reason;
    var msg = (r && r.message) ? r.message : String(r);
    var stack = (r && r.stack) ? r.stack : null;
    report("unhandledrejection", msg, stack);
  });

  // Hook 3 : console.error (erreurs loguées explicitement par le code)
  // On wrap proprement pour ne pas casser le comportement console standard.
  try {
    var origConsoleError = console.error;
    console.error = function() {
      try {
        var args = Array.prototype.slice.call(arguments);
        // Skip les patterns internes pour ne pas se reporter soi-même
        var first = String(args[0] || "");
        if (first.indexOf("[lx-monitoring]") < 0 && first.indexOf("[WAL]") < 0 && first.indexOf("[AUDIT]") < 0) {
          var msg = args.map(function(a){
            if (a instanceof Error) return a.message + (a.stack ? "\n" + a.stack : "");
            if (typeof a === "object") try { return JSON.stringify(a).slice(0, 300); } catch(_) { return "[obj]"; }
            return String(a);
          }).join(" ").slice(0, 800);
          report("console.error", msg, null);
        }
      } catch (_) {}
      return origConsoleError.apply(console, arguments);
    };
  } catch (_) {}
})();
