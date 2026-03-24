var CACHE_NAME = 'luxyra-v10';
self.addEventListener('install', function(e) { self.skipWaiting(); });
self.addEventListener('activate', function(e) {
  e.waitUntil(caches.keys().then(function(names) {
    return Promise.all(names.filter(function(n) { return n !== CACHE_NAME; }).map(function(n) { return caches.delete(n); }));
  }).then(function() { return self.clients.claim(); }));
});
self.addEventListener('message', function(e) { if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting(); });
self.addEventListener('fetch', function(e) {
  var url = e.request.url;
  // NEVER cache SW, HTML, or JS - always fresh from network
  if (url.indexOf('sw.js') !== -1 || url.endsWith('.html') || url.endsWith('.js') || url.indexOf('.js?') !== -1 || url.indexOf('.html?') !== -1) {
    e.respondWith(fetch(e.request).catch(function() { return caches.match(e.request); }));
    return;
  }
  // Other resources (images, fonts, css): network first, cache fallback
  e.respondWith(fetch(e.request).then(function(r) {
    if (r.status === 200 && e.request.method === 'GET') {
      var c = r.clone();
      caches.open(CACHE_NAME).then(function(cache) { cache.put(e.request, c); });
    }
    return r;
  }).catch(function() { return caches.match(e.request); }));
});
