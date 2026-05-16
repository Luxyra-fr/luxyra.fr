/* Service Worker — Luxyra Admin Web Push notifications
 * Reçoit les push events depuis Supabase edge function lx-web-push,
 * affiche les notifications natives même quand l'app/onglet est fermé.
 */

self.addEventListener('install', function(event) {
  // Skip waiting pour activer immédiatement le nouveau SW
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', function(event) {
  // CRITIQUE Chrome Android : on AFFICHE IMMÉDIATEMENT une notif (sans await fetch)
  // car Chrome kill le SW si showNotification n'arrive pas dans les ~3s.
  // On essaie d'extraire les données du payload event.data en SYNCHRONE.
  var quickData = { title: '🔔 Luxyra', body: 'Nouvelle alerte', severity: 'high', id: 'lx-' + Date.now() };
  if (event.data) {
    try {
      var parsed = event.data.json();
      if (parsed && (parsed.title || parsed.body)) quickData = Object.assign(quickData, parsed);
    } catch(_) {
      try { quickData.body = event.data.text() || quickData.body; } catch(__) {}
    }
  }

  var options = {
    body: quickData.body,
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: quickData.severity === 'critical' ? 'lx-critical-' + quickData.id : 'lx-' + quickData.id,
    requireInteraction: quickData.severity === 'critical',
    vibrate: quickData.severity === 'critical' ? [200, 100, 200, 100, 200] : [100, 50, 100],
    data: {
      url: quickData.url || 'https://luxyra.fr/admin?tab=monitoring',
      id: quickData.id,
      severity: quickData.severity || 'high'
    },
    actions: [
      { action: 'view', title: 'Voir' },
      { action: 'dismiss', title: 'Ignorer' }
    ]
  };

  // showNotification est appelé en TOUT PREMIER, pas de await avant
  var showPromise = self.registration.showNotification(quickData.title, options);

  // En arrière-plan (sans bloquer l'affichage), on tente de récupérer le payload
  // riche via REST si le push était wake-up (sans data) — pour MAJ la notif
  var enrichPromise = (async function(){
    if (event.data) return; // déjà eu les données via payload
    try {
      var SB_URL = 'https://kxdgjtvrkwugbifgppai.supabase.co';
      var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI';
      var resp = await fetch(SB_URL + '/rest/v1/admin_push_payloads?order=created_at.desc&limit=1', {
        headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON }
      });
      var rows = await resp.json();
      if (rows && rows[0]) {
        var rich = rows[0];
        // Re-show la notif avec le vrai titre/body
        await self.registration.showNotification(rich.title || quickData.title, Object.assign({}, options, {
          body: rich.body || options.body,
          tag: (rich.severity === 'critical' ? 'lx-critical-' : 'lx-') + rich.id
        }));
      }
    } catch(_) {}
  })();

  event.waitUntil(Promise.all([showPromise, enrichPromise]));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  if (event.action === 'dismiss') return;
  var targetUrl = (event.notification.data && event.notification.data.url) || 'https://luxyra.fr/admin?tab=monitoring';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      // Si un onglet admin existe déjà, le focus
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (c.url.indexOf('/admin') >= 0 && 'focus' in c) {
          c.postMessage({ type: 'navigate', url: targetUrl });
          return c.focus();
        }
      }
      // Sinon ouvrir nouvel onglet
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

self.addEventListener('pushsubscriptionchange', function(event) {
  // Si le navigateur change la subscription, on tente de re-subscribe
  // (l'admin devra cliquer "Activer" à nouveau si ça échoue)
  event.waitUntil(
    fetch('https://kxdgjtvrkwugbifgppai.supabase.co/functions/v1/lx-push-public-key')
      .then(function(r) { return r.json(); })
      .then(function(data) {
        if (!data.publicKey) return;
        return self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: data.publicKey
        });
      })
      .catch(function(e) { console.warn('[admin-sw] resubscribe failed:', e); })
  );
});
