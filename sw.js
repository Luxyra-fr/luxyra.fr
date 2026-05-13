// Luxyra SW v16 — push notifications only (no fetch interception) + bump for CSS cache
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
