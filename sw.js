// ============================================================================
// Luxyra Service Worker — v22 (2026-10-12) — cle de cache sans parametres + delai reseau (voir plus bas)
// (v21 2026-08-30)
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
  var ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI';
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
var LX_CACHE = 'luxyra-sw-shell-v23-2026-10-14';

// v22 (2026-10-12) — deux correctifs de robustesse :
//  1. CLE DE CACHE SANS PARAMETRES : avant, chaque variante d'URL (?v=, ?x=, ?demo=...)
//     etait stockee a part -> le cache grossissait sans fin (des centaines d'entrees
//     constatees). Desormais une seule copie par fichier (la derniere vue en ligne).
//     Les anciennes entrees sont migrees (la plus recente par fichier) puis purgees.
//  2. DELAI RESEAU : sur reseau tres faible, la page attendait le reseau sans limite
//     (ecran blanc). Si une copie existe en cache et que le reseau ne repond pas sous
//     LX_NET_TIMEOUT ms, on sert la copie ; la reponse reseau, si elle arrive, met
//     quand meme le cache a jour pour la prochaine ouverture.
var LX_NET_TIMEOUT = 4000;

// Cle de cache normalisee : meme origine + chemin, SANS parametres.
function lxKey(req) {
  try { var u = new URL(req.url); return new Request(u.origin + u.pathname); } catch (_) { return req; }
}
function lxNoop() {}

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
    lxMigrateOldCaches().then(function() {
      return caches.keys();
    }).then(function(keys) {
      return Promise.all(keys.map(function(n) {
        return n === LX_CACHE ? null : caches.delete(n);
      }));
    }).then(function() {
      return self.clients.claim();
    }).catch(function(){ /* activate jamais bloquante */ })
  );
});

// Recopie dans le nouveau cache la copie la plus recente de chaque fichier des
// anciens caches (cle sans parametres), sans ecraser ce que l'install vient de
// precharger (plus frais). Garantit que le hors-ligne reste complet juste apres
// la mise a jour. Ne touche qu'a Cache Storage (jamais a IndexedDB).
function lxMigrateOldCaches() {
  return caches.keys().then(function(names) {
    var olds = names.filter(function(n) { return n !== LX_CACHE && n.indexOf('luxyra-sw-') === 0; });
    if (!olds.length) return null;
    return caches.open(LX_CACHE).then(function(dest) {
      var latest = {}; // chemin normalise -> {cache, req}
      return olds.reduce(function(p, name) {
        return p.then(function() {
          return caches.open(name).then(function(c) {
            return c.keys().then(function(reqs) {
              reqs.forEach(function(r) { latest[lxKey(r).url] = { c: c, r: r }; }); // dernier ecrit = plus recent
            });
          });
        });
      }, Promise.resolve()).then(function() {
        return Promise.all(Object.keys(latest).map(function(k) {
          return dest.match(k).then(function(have) {
            if (have) return null;
            return latest[k].c.match(latest[k].r).then(function(res) {
              return (res && res.status === 200) ? dest.put(k, res) : null;
            });
          }).catch(lxNoop);
        }));
      });
    });
  }).catch(lxNoop);
}

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
    e.respondWith(lxNetworkFirst(req, isNav, e));
  } else if (lxIsStaticAsset(url)) {
    // ASSET STATIQUE : cache d'abord (rapide), revalidation en arriere-plan.
    e.respondWith(lxCacheFirst(req));
  }
  // sinon : pas de respondWith -> le navigateur gere normalement.
});

// NETWORK-FIRST : reseau prioritaire (fraicheur du code), repli cache si le
// reseau echoue. Chaque reponse OK re-alimente le cache. Ne rejette jamais.
function lxNetworkFirst(req, isNav, evt) {
  var key = lxKey(req);
  return caches.open(LX_CACHE).then(function(cache) {
    var netP = fetch(req).then(function(net) {
      if (lxCacheable(net)) { cache.put(key, net.clone()).catch(lxNoop); }
      return net;
    });
    // La mise a jour du cache continue meme si on a deja repondu avec la copie.
    try { if (evt && evt.waitUntil) evt.waitUntil(netP.catch(lxNoop)); } catch (_) {}
    return cache.match(key).then(function(hit) {
      return new Promise(function(resolve) {
        var done = false;
        var timer = hit ? setTimeout(function() {
          if (!done) { done = true; resolve(hit); }
        }, LX_NET_TIMEOUT) : null;
        netP.then(function(net) {
          if (done) return;
          done = true; if (timer) clearTimeout(timer);
          resolve(net);
        }, function() {
          if (done) return;
          done = true; if (timer) clearTimeout(timer);
          if (hit) { resolve(hit); return; }
          if (isNav) {
            resolve(cache.match('/app.html').then(function(shell) { return shell || lxOffline(); }));
            return;
          }
          resolve(lxOffline());
        });
      });
    });
  }).catch(function() { return lxOffline(); });
}

function lxCacheFirst(req) {
  var key = lxKey(req);
  return caches.open(LX_CACHE).then(function(cache) {
    return cache.match(key).then(function(hit) {
      var fromNet = fetch(req).then(function(res) {
        if (lxCacheable(res)) { cache.put(key, res.clone()).catch(lxNoop); }
        return res;
      }).catch(function() { return hit || lxOffline(); });
      return hit || fromNet;
    });
  }).catch(function() { return lxOffline(); });
}

self.addEventListener('push', function(e) {
  // FIX 2026-08-30 : temoin de reception. Sans lui, impossible de savoir a distance
  // si un push arrive jusqu'a l'appareil : le serveur voit « accepte par FCM », mais
  // rien ne dit si le service worker a ete reveille. On trace donc CHAQUE reception
  // dans server_errors (source sw_push_recu), avant tout traitement — SANS le contenu (2026-10-14).
  // Le temoin ne doit jamais retarder ni empecher l'affichage : Chrome exige qu'un
  // push aboutisse RAPIDEMENT a une notification visible. On trace donc SANS
  // e.waitUntil, en pur « au mieux ».
  try {
    var _sbu='https://kxdgjtvrkwugbifgppai.supabase.co';
    var _ak='eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt4ZGdqdHZya3d1Z2JpZmdwcGFpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzMwNDE2NTgsImV4cCI6MjA4ODYxNzY1OH0.J3jVuoHSWA0wXyaWxiRzILEWVNr8hbbgVYg73UEDTuI';
    // 2026-10-14 SECURITE : on ne journalise PLUS le contenu du push (titre / texte = donnees personnelles :
    // nom du client, prestation, horaire...). Seuls la taille et le type d'evenement sont traces.
    var _taille=0, _evt=''; try { var _t = e.data ? e.data.text() : ''; _taille = _t.length; try { var _j = JSON.parse(_t); _evt = String((_j && _j.data && _j.data.event_type) || '').replace(/[^a-z0-9_\-]/gi,'').slice(0,40); } catch(_y){} } catch(_x){}
    fetch(_sbu+'/rest/v1/rpc/report_server_error',{
      method:'POST',
      headers:{'Content-Type':'application/json','apikey':_ak,'Authorization':'Bearer '+_ak},
      body:JSON.stringify({
        p_source:'sw_push_recu',
        p_message:'Push recu par le service worker (contenu non journalise) — '+_taille+' octets'+(_evt?' — '+_evt:''),
        p_severity:'warning', p_stack:'', p_context:null
      })
    }).catch(function(){});
  } catch(_e) {}

  var data = {};
  try {
    data = e.data ? e.data.json() : {};
  } catch (err) {
    data = { title: 'Luxyra', body: e.data ? e.data.text() : '' };
  }
  var title = data.title || 'Luxyra';
  // FIX 2026-08-30 : l'URL de destination est envoyee par send-push DANS data.data
  // ({title, body, icon, badge, data:{url, event_type, ...}, tag}), pas a la racine.
  // On lisait data.url, toujours undefined -> le clic retombait systematiquement sur
  // /app.html et le lien profond (conversation support, etc.) etait perdu.
  // On lit les deux, en gardant la racine en repli pour ne rien casser.
  var _payload = (data && typeof data.data === 'object' && data.data) ? data.data : {};
  var _url = _payload.url || data.url || '/app.html';
  var opts = {
    body: data.body || '',
    icon: data.icon || '/icon-192.png',
    badge: data.badge || '/icon-192.png',
    data: { url: _url, event_type: _payload.event_type || data.event_type || '' },
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
      // 2026-10-14 audit : notification de l'ESPACE CLIENT -> la fenêtre déjà ouverte de /compte est
      // NAVIGUÉE vers l'URL cible (onglet + données rechargées) ; avant : simple focus, page périmée.
      // La caisse (/app.html) garde le simple focus (jamais de rechargement pendant un encaissement).
      var cible = null; try { cible = new URL(url, self.location.origin); } catch (_e) {}
      var estCompte = function(u) { try { return /^\/compte(\.html)?$/.test(new URL(u, self.location.origin).pathname); } catch (_e) { return false; } };
      if (cible && estCompte(cible.href)) {
        for (var k = 0; k < list.length; k++) {
          var cc = list[k];
          if (estCompte(cc.url) && 'navigate' in cc) {
            return cc.navigate(cible.href).then(function(x) { return (x || cc).focus(); }).catch(function() { return cc.focus(); });
          }
        }
      }
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
