// Luxyra SW v17 — push notifications + error reporting
//
// 2026-05-18 : ajout hook erreurs SW. Avant ça, un échec dans push handler
// ou notificationclick était invisible (le SW n'a pas console accessible
// depuis l'app). Maintenant tout va dans server_errors source=service_worker.
(function(){
  var SB_URL = 'https://kxdgjtvrkwugbifgppai.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE1MDc2NTksImV4cCI6MjA1NzA4MzY1OX0.qIaCntFlYqp_TQrkmgUrtTNzaIddtfWG7tIBNqcwdcw';
  function reportSW(msg, stack) {
    try {
      fetch(SB_URL+'/rest/v1/rpc/report_server_error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer '+ANON_KEY },
        body: JSON.stringify({
          p_source: 'service_worker',
          p_message: String(msg||'unknown').slice(0, 500),
          p_severity: 'warning',
          p_stack: stack ? String(stack).slice(0, 1500) : '',
          p_context: null
        })
      }).catch(function(){});
    } catch(_) {}
  }
  self.addEventListener('error', function(e) {
    reportSW('SW error: '+(e.message||'unknown')+' ['+(e.filename||'?')+':'+(e.lineno||0)+']', e.error && e.error.stack);
  });
  self.addEventListener('unhandledrejection', function(e) {
    reportSW('SW rejection: '+(e.reason && e.reason.message || String(e.reason||'unknown')), e.reason && e.reason.stack);
  });
  self._lxReportSW = reportSW;
})();

self.addEventListener('install', function() { self.skipWaiting(); });

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(k) {
      return Promise.all(k.map(function(n) { return caches.delete(n); }));
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// Pas de handler 'fetch' : on laisse le browser gérer toutes les requêtes
// normalement. Intercepter pour juste refetch ne sert à rien et cause des
// "Uncaught (in promise) TypeError: Failed to fetch" dès qu'une requête
// échoue (timeout, extension qui bloque, etc).

// --- Push reception ---
self.addEventListener('push', function(e) {
  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { title: 'Luxyra', body: e.data ? e.data.text() : '' };
  }
  var title = data.title || 'Luxyra';
  var opts = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    data: { url: data.url || '/app.html' },
    tag: data.tag || undefined,
    renotify: !!data.tag,
    requireInteraction: !!data.requireInteraction
  };
  e.waitUntil(self.registration.showNotification(title, opts));
});

// --- Click handling ---
self.addEventListener('notificationclick', function(e) {
  e.notification.close();
  var url = (e.notification.data && e.notification.data.url) || '/app.html';
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(list) {
      var base = url.split('#')[0];
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(base) !== -1 && 'focus' in c) {
          if (url.indexOf('#') !== -1 && 'navigate' in c) {
            return c.navigate(url).then(function(x) { return x && x.focus(); });
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
