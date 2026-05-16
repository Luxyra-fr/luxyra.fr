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
  var showWithPayload = function(data) {
    var title = (data && data.title) || '🔔 Luxyra';
    var options = {
      body: (data && data.body) || 'Nouvelle alerte (ouvrir l\'admin pour détails)',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data && data.severity === 'critical' ? 'lx-critical-' + (data.id || Date.now()) : 'lx-' + ((data && data.id) || Date.now()),
      requireInteraction: data && data.severity === 'critical',
      vibrate: data && data.severity === 'critical' ? [200, 100, 200, 100, 200] : [100, 50, 100],
      data: {
        url: (data && data.url) || 'https://luxyra.fr/admin?tab=monitoring',
        id: (data && data.id) || null,
        severity: (data && data.severity) || 'high'
      },
      actions: [
        { action: 'view', title: 'Voir' },
        { action: 'dismiss', title: 'Ignorer' }
      ]
    };
    return self.registration.showNotification(title, options);
  };

  event.waitUntil((async function(){
    var data = null;
    if (event.data) {
      try { data = event.data.json(); }
      catch(_) { try { data = { body: event.data.text() }; } catch(__) {} }
    }
    // Fallback : si pas de payload (chiffrement raté ou payload vide), on fetch
    // le dernier admin_push_payloads via REST anon (RLS limite à < 5 min).
    if (!data || (!data.title && !data.body)) {
      try {
        var SB_URL = 'https://kxdgjtvrkwugbifgppai.supabase.co';
        var SB_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI';
        var resp = await fetch(SB_URL + '/rest/v1/admin_push_payloads?order=created_at.desc&limit=1', {
          headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON }
        });
        var rows = await resp.json();
        if (rows && rows[0]) data = rows[0];
      } catch(_) {}
    }
    if (!data) data = { title: '🔔 Luxyra', body: 'Nouvelle alerte', severity: 'high' };
    return showWithPayload(data);
  })());
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
