// Luxyra SW v11 — Auto-update, no user action needed
var CACHE = 'luxyra-v11';
var NO_CACHE = ['app.html','luxyra-supabase.js','admin.html','marketplace.html','compte.html','sw.js','index.html'];

self.addEventListener('install', function(e) {
  self.skipWaiting();
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(names) {
      return Promise.all(names.filter(function(n) { return n !== CACHE; }).map(function(n) { return caches.delete(n); }));
    }).then(function() { return self.clients.claim(); })
  );
});

self.addEventListener('message', function(e) {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function(e) {
  var url = new URL(e.request.url);
  var isMainFile = NO_CACHE.some(function(f) { return url.pathname.endsWith(f); });
  var isAPI = url.pathname.startsWith('/api/') || url.hostname.includes('supabase');

  if (isMainFile || isAPI || e.request.method !== 'GET') {
    e.respondWith(fetch(e.request).catch(function() { return caches.match(e.request); }));
    return;
  }

  e.respondWith(
    fetch(e.request).then(function(r) {
      if (r.status === 200) {
        var c = r.clone();
        caches.open(CACHE).then(function(cache) { cache.put(e.request, c); });
      }
      return r;
    }).catch(function() {
      return caches.match(e.request);
    })
  );
});
