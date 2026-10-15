/* Service Worker — Luxyra Admin (portée /admin)
 * Rôle (mis à jour le 15/10/2026) : canal d'affichage des notifications LOCALES déclenchées par le watcher
 * d'erreurs d'admin.html (lxStartErrorWatcher -> reg.showNotification), quand l'admin est ouverte.
 *
 * Les notifications PUSH (admin fermée comprise) passent par un AUTRE service : /admin/sw-admin.js
 * (abonnements push_subscriptions target_type='admin', envoi par l'edge function send-push, appelée par
 * public.notify_admins()). Ce fichier ne reçoit pas de push.
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
  var targetUrl = (event.notification.data && event.notification.data.url) || '/admin?tab=qualite&sub=monitoring';
  try { targetUrl = new URL(targetUrl, self.location.origin).href; } catch (_) {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      // Si un onglet admin existe déjà : même message que /admin/sw-admin.js (la page navigue vers ?tab=&sub=)
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (c.url.indexOf('/admin') >= 0 && 'focus' in c) {
          c.postMessage({ type: 'lx-notif-click', url: targetUrl });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});
