// ============================================================================
// Luxyra Service Worker — v18 (2026-07-09)
//
// OBJECTIF : auto-update SANS /clear.
//   Après avoir été chargé une fois, un simple rafraîchissement (ou relance de
//   la PWA) charge toujours la dernière version déployée. Plus besoin d'ouvrir
//   luxyra.fr/clear a chaque mise a jour sur chaque appareil de chaque salon.
//
// STRATEGIE :
//   - install  : precache resilient du shell + skipWaiting()
//                -> le nouveau SW ne reste jamais coince derriere l'ancien.
//   - activate : purge des caches d'ANCIENNES versions (on garde le notre)
//                + clients.claim() -> le nouveau SW prend la main tout de suite.
//   - fetch    : NETWORK-FIRST pour le CODE (navigations, *.html, *.js,
//                manifest*.json). Un rafraichissement charge donc toujours le
//                code le plus recent ; repli sur le cache SEULEMENT si le reseau
//                echoue -> le mode hors-ligne reste fonctionnel. Chaque reponse
//                reseau OK re-alimente le cache, donc le repli hors-ligne est
//                toujours la derniere version vue en ligne.
//                CACHE-FIRST (stale-while-revalidate) pour les assets statiques
//                immuables (icones, logo, images, polices) -> rapide + offline.
//
// GARDE-FOUS (app fiscale NF525 — ne rien casser) :
//   - On ne touche JAMAIS a IndexedDB. Le snapshot fiscal (store IndexedDB
//     "LX_CACHE") est de la DONNEE applicative, pas du cache SW. Ce SW ne gere
//     QUE l'API Cache Storage (caches.*). Aucun code ci-dessous n'ouvre idb.
//   - On n'intercepte QUE les GET same-origin. Les POST/PUT (Supabase, Stripe),
//     les appels /api/* et TOUT le cross-origin (Supabase REST/realtime, Stripe,
//     Google Fonts, ...) passent SANS interception -> impossible de casser une
//     ecriture fiscale ou une requete dynamique.
//   - Le handler fetch ne REJETTE JAMAIS (tout est encapsule, il renvoie
//     toujours une Response) -> fini les "Uncaught (in promise) TypeError:
//     Failed to fetch" qui avaient fait retirer l'ancien handler.
//   - Aucun reload force cote SW -> aucun risque de boucle de rechargement.
//   - La page /clear reste le filet de secours manuel (inchangee, cote Worker).
// ============================================================================

// --- Report d'erreurs SW (inchange depuis v17) ---------------------------
// 2026-05-18 : un echec dans le push handler ou notificationclick etait
// invisible (le SW n'a pas de console accessible depuis l'app). Tout va
// maintenant dans server_errors source=service_worker.
(function(){
  var SB_URL = 'https://kxdgjtvrkwugbifgppai.supabase.co';
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE1MDc2NTksImV4cCI6MjA1NzA4MzY1OX0.qIaCntFlYqp_TQrkmgUrtTNzaIddtfWG7tIBNqcwdcw';
  function reportSW(msg, stack) {
    try {
      fetch(SB_URL+'/rest/v1/rpc/report_server_error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'apikey': ANON_KEY, 'Authorization': 'Bearer '+ANON_KEY },
        body: JSON.stringify({
          p_source: 'service_worker',
          p_message: String(msg||'unknown').slice(0, 500),
          p_severity: 'warning',
          p_stack: stack ? String(stack).slice(0, 1500) : '',
          p_context: null
        })
      }).catch(function(){});
    } catch(_) {}
  }
  self.addEventListener('error', function(e) {
    reportSW('SW error: '+(e.message||'unknown')+' ['+(e.filename||'?')+':'+(e.lineno||0)+']', e.error && e.error.stack);
  });
  self.addEventListener('unhandledrejection', function(e) {
    reportSW('SW rejection: '+(e.reason && e.reason.message || String(e.reason||'unknown')), e.reason && e.reason.stack);
  });
  self._lxReportSW = reportSW;
})();

// --- Versionnage du cache -------------------------------------------------
// Bumper cette chaine a CHAQUE deploiement qui doit invalider l'ancien cache
// (la strategie network-first sert deja du frais ; le bump nettoie surtout les
// vieux caches et marque le SW comme "mis a jour").
var LX_CACHE = 'luxyra-sw-shell-v18-2026-07-09';

// Shell precache pour un 1er chargement hors-ligne. RESILIENT : un echec
// unitaire (404, reseau) ne fait PAS echouer l'installation (allSettled).
var LX_PRECACHE = [
  '/app.html',
  '/luxyra-supabase.js',
  '/supabase.min.js',
  '/manifest-app.json',
  '/manifest.json',
  '/icon-192.png',
  '/icon-512.png',
  '/luxyra-logo.png'
];

// Fichier de CODE ? -> network-first (fraicheur). Jamais pour /api/*.
function lxIsCodeFile(url) {
  var p = url.pathname;
  if (p.indexOf('/api/') === 0) return false;
  return p === '/' ||
         p.slice(-5) === '.html' ||
         p.slice(-3) === '.js'   ||
         p.slice(-5) === '.json';
}

// Asset statique immuable ? -> cache-first (rapide + offline).
function lxIsStaticAsset(url) {
  return /\.(png|jpe?g|gif|svg|webp|ico|woff2?|ttf|eot)$/i.test(url.pathname);
}

// Reponse "hors-ligne" neutre (jamais de rejet qui remonterait au navigateur).
function lxOffline() {
  return new Response('', { status: 504, statusText: 'Offline', headers: { 'Content-Type': 'text/plain' } });
}

// N'accepter en cache que les reponses 200 same-origin NON redirigees
// (une reponse redirigee remise a une navigation ferait planter le navigateur).
function lxCacheable(res) {
  return !!res && res.status === 200 && res.type === 'basic' && !res.redirected;
}

self.addEventListener('install', function(e) {
  // Ne pas attendre derriere l'ancien SW.
  self.skipWaiting();
  e.waitUntil(
    caches.open(LX_CACHE).then(function(cache) {
      // allSettled : un echec unitaire ne bloque PAS l'install.
      return Promise.allSettled(LX_PRECACHE.map(function(u) {
        return cache.add(new Request(u, { cache: 'reload' }));
      }));
    }).catch(function(){ /* install jamais bloquante */ })
  );
});

self.addEventListener('activate', function(e) {
  e.waitUntil(
    caches.keys().then(function(keys) {
      // Supprimer UNIQUEMENT les caches d'autres versions (pas le notre).
      return Promise.all(keys.map(function(n) {
        return n === LX_CACHE ? null : caches.delete(n);
      }));
    }).then(function() {
      return self.clients.claim();
    }).catch(function(){ /* activate jamais bloquante */ })
  );
});

self.addEventListener('fetch', function(e) {
  var req = e.request;

  // On n'intercepte QUE les GET. Les POST/PUT/DELETE (Supabase, Stripe, ...)
  // passent tels quels -> aucune ecriture fiscale ne transite par le cache.
  if (req.method !== 'GET') return;

  var url;
  try { url = new URL(req.url); } catch (_) { return; }

  // Cross-origin (Supabase REST/realtime, Stripe, Google Fonts, ...) : on ne
  // touche a rien -> comportement reseau natif.
  if (url.origin !== self.location.origin) return;

  // API dynamique du Worker : jamais de cache, comportement natif.
  if (url.pathname.indexOf('/api/') === 0) return;

  var isNav = req.mode === 'navigate';

  if (isNav || lxIsCodeFile(url)) {
    // CODE : reseau d'abord (frais a chaque refresh), cache en repli offline.
    e.respondWith(lxNetworkFirst(req, isNav));
  } else if (lxIsStaticAsset(url)) {
    // ASSET STATIQUE : cache d'abord (rapide), revalidation en arriere-plan.
    e.respondWith(lxCacheFirst(req));
  }
  // sinon : pas de respondWith -> le navigateur gere normalement.
});

// NETWORK-FIRST : reseau prioritaire (fraicheur du code), repli cache si le
// reseau echoue. Chaque reponse OK re-alimente le cache. Ne rejette jamais.
function lxNetworkFirst(req, isNav) {
  return caches.open(LX_CACHE).then(function(cache) {
    return fetch(req).then(function(net) {
      if (lxCacheable(net)) { cache.put(req, net.clone()).catch(function(){}); }
      return net;
    }).catch(function() {
      // Reseau KO -> on sert le cache si dispo.
      return cache.match(req).then(function(hit) {
        if (hit) return hit;
        // Navigation hors-ligne sans copie : repli sur le shell app.
        if (isNav) {
          return cache.match('/app.html').then(function(shell) {
            return shell || lxOffline();
          });
        }
        return lxOffline();
      });
    });
  }).catch(function() { return lxOffline(); });
}

// CACHE-FIRST (stale-while-revalidate) : renvoie le cache tout de suite s'il
// existe, et rafraichit la copie en arriere-plan. Ne rejette jamais.
function lxCacheFirst(req) {
  return caches.open(LX_CACHE).then(function(cache) {
    return cache.match(req).then(function(hit) {
      var fromNet = fetch(req).then(function(res) {
        if (lxCacheable(res)) { cache.put(req, res.clone()).catch(function(){}); }
        return res;
      }).catch(function() { return hit || lxOffline(); });
      return hit || fromNet;
    });
  }).catch(function() { return lxOffline(); });
}

// --- Push reception (inchange depuis v17) --------------------------------
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

// --- Click handling (inchange depuis v17) --------------------------------
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
