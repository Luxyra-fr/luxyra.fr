// Luxyra SW v12 — Self-destruct: supprime tous les caches et se désinscrit
self.addEventListener('install', function() { self.skipWaiting(); });
self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(k) {
      return Promise.all(k.map(function(n) { return caches.delete(n); }));
    }).then(function() {
      return self.clients.claim();
    }).then(function() {
      return self.registration.unregister();
    })
  );
});
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request));
});
