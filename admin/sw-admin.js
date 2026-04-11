// ============================================================
// LUXYRA Admin — Service Worker pour Web Push notifications
// Gère la réception des push et leur affichage côté OS
// Séparé de sw.js (app.html) pour ne pas interférer
// ============================================================

const SW_VERSION = 'lx-admin-sw-v1';

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
    badge: data.badge || '/icon-96.png',
    tag: data.tag || 'lx-admin-' + Date.now(),
    data: {
      url: data.url || '/admin.html',
      type: data.type || 'generic'
    },
    requireInteraction: data.requireInteraction || false,
    vibrate: [200, 100, 200],
    actions: data.actions || []
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Click sur la notification → ouvre/focus admin.html
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const targetUrl = (event.notification.data && event.notification.data.url) || '/admin.html';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const c = clientList[i];
        if (c.url.indexOf('/admin.html') !== -1 && 'focus' in c) {
          c.postMessage({ type: 'lx-notif-click', payload: event.notification.data });
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});

self.addEventListener('pushsubscriptionchange', function(event) {
  console.log('[lx-admin-sw] pushsubscriptionchange — re-subscribe needed');
});
