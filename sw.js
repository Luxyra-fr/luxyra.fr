const CACHE_PREFIX = 'coiffpro-';
const STATIC_ASSETS = [
  '/app.html',
  '/coiffpro-supabase.js',
  '/manifest.json'
];

// Install: always skip waiting to activate immediately
self.addEventListener('install', event => {
  self.skipWaiting();
});

// Activate: clean ALL old caches
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => 
      Promise.all(keys.filter(k => k.startsWith(CACHE_PREFIX)).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: ALWAYS network first for HTML/JS - never serve stale
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Skip Supabase, APIs, external resources - always direct network
  if (url.hostname !== location.hostname) return;
  
  // For ALL local files: network first, cache fallback (offline only)
  event.respondWith(
    fetch(event.request)
      .then(response => {
        // Cache the fresh response for offline use
        const clone = response.clone();
        caches.open(CACHE_PREFIX + 'latest').then(cache => cache.put(event.request, clone));
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// Force update when messaged
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
