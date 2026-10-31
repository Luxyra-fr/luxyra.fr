// ============================================================
// LUXYRA Admin — Service Worker pour Web Push notifications
// Gère la réception des push et leur affichage côté OS
// Séparé de sw.js (app.html) pour ne pas interférer
// ============================================================

const SW_VERSION = 'lx-admin-sw-v2';

self.addEventListener('install', function(event) {
  console.log('[lx-admin-sw] install', SW_VERSION);
  self.skipWaiting();
});

self.addEventListener('activate', function(event) {
  console.log('[lx-admin-sw] activate', SW_VERSION);
  event.waitUntil(self.clients.claim());
});

// Réception d'un push depuis l'Edge Function Supabase
self.addEventListener('push', function(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { title: 'Luxyra Admin', body: event.data ? event.data.text() : 'Nouvelle notification' };
  }

  const title = data.title || 'Luxyra Admin';
  const options = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png', // 2026-10-31 : /icon-96.png n'existait pas
    tag: data.tag || 'lx-admin-' + Date.now(),
    data: {
      // 2026-10-12 : send-push place l'adresse dans data.data.url
      url: data.url || (data.data && data.data.url) || '/admin',
      type: data.type || 'generic'
    },
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
    actions: data.actions || []
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click sur la notification → ouvre l'admin sur la bonne page (2026-10-12)
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  var targetUrl = (event.notification.data && event.notification.data.url) || '/admin';
  try { targetUrl = new URL(targetUrl, self.location.origin).href; } catch (_) {}
  // 31/10/2026 : une URL d'admin absolue sur luxyra.fr est ramenée sur l'origine de ce service worker (admin.luxyra.fr),
  // sinon l'appli Luxyra Pro (TWA, propriétaire de luxyra.fr) l'intercepterait.
  try { var _t = new URL(targetUrl); if (_t.origin !== self.location.origin && /(^|\.)luxyra\.fr$/.test(_t.hostname) && /^\/admin/.test(_t.pathname)) targetUrl = self.location.origin + (self.location.hostname === 'admin.luxyra.fr' ? '/' : _t.pathname) + _t.search + _t.hash; } catch (_) {}
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (var i = 0; i < clientList.length; i++) {
        var c = clientList[i];
        var u = '';
        try { u = new URL(c.url).pathname; } catch (_) {}
        if ((u === '/admin' || u === '/admin.html' || u.indexOf('/admin/') === 0 || (u === '/' && self.location.hostname === 'admin.luxyra.fr')) && 'focus' in c) {
          c.postMessage({ type: 'lx-notif-click', url: targetUrl, payload: event.notification.data });
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(targetUrl);
    })
  );
});

// 31/10/2026 : le service de push a remplacé ou expiré l'abonnement -> on en recrée un tout de suite avec la même clé,
// et on prévient l'admin ouverte (elle l'enregistre en base). Sinon, la prochaine ouverture de l'admin le répare
// (lxPushAutoRepare dans admin.html).
self.addEventListener('pushsubscriptionchange', function(event) {
  var opts = (event.oldSubscription && event.oldSubscription.options) || null;
  if (!opts || !opts.applicationServerKey) return;
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: opts.applicationServerKey })
      .then(function () { return self.clients.matchAll({ type: 'window', includeUncontrolled: true }); })
      .then(function (list) { (list || []).forEach(function (c) { try { c.postMessage({ type: 'lx-push-renouvele' }); } catch (_) {} }); })
      .catch(function (e) { console.log('[lx-admin-sw] ré-abonnement impossible', e); })
  );
});
