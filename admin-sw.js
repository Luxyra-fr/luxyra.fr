/* Service Worker — Luxyra Admin
 * Sert UNIQUEMENT de canal d'affichage local pour les notifs déclenchées
 * par le watcher d'erreurs côté admin.html (reg.showNotification).
 *
 * Pas de Web Push externe : FCM/Doze sur Android n'était pas fiable, on a
 * tout repris en local (poll 15s + showNotification + mail Brevo backup).
 * Voir admin.html `lxStartErrorWatcher` et la migration
 * `disable_external_webpush_keep_local_polling`.
 */

self.addEventListener('install', function(event) {
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  event.waitUntil(self.clients.claim());
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
