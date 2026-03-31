// Luxyra SW v13 — Minimal pass-through (no cache, PWA install only)
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
// No caching — all requests go to network directly
self.addEventListener('fetch', function(e) {
  e.respondWith(fetch(e.request));
});
