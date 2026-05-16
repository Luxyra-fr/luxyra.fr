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
  try {
    var data = { title: '🔔 Luxyra', body: 'Nouvelle alerte', severity: 'high' };
    if (event.data) {
      try { data = event.data.json(); } catch(_) {
        try { data.body = event.data.text(); } catch(__) {}
      }
    }
    var title = data.title || '🔔 Luxyra';
    var options = {
      body: data.body || '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.severity === 'critical' ? 'lx-critical-' + (data.id || Date.now()) : 'lx-' + (data.id || Date.now()),
      requireInteraction: data.severity === 'critical',
      vibrate: data.severity === 'critical' ? [200, 100, 200, 100, 200] : [100, 50, 100],
      data: {
        url: data.url || 'https://luxyra.fr/admin?tab=monitoring',
        id: data.id || null,
        severity: data.severity || 'high'
      },
      actions: [
        { action: 'view', title: 'Voir' },
        { action: 'dismiss', title: 'Ignorer' }
      ]
    };
    event.waitUntil(self.registration.showNotification(title, options));
  } catch (e) {
    // Si tout casse, afficher au moins une notif générique
    event.waitUntil(
      self.registration.showNotification('🔔 Luxyra', {
        body: 'Nouvelle alerte (détails dans l\'admin)',
        icon: '/icon-192.png'
      })
    );
  }
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
